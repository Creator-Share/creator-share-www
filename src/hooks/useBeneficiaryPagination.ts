import { useState, useCallback, useRef, useEffect } from "react"
import { Beneficiaries } from "@/types"
import { subscribeToSubscriptions } from "@/lib/subscriptionsRealtime"
import { INACTIVE_STATUSES } from "@/config/beneficiaryStatuses"

type FiltersState = {
  gender: string
  ageRange: [number, number]
  status: string[]
  search?: string
  /** Accepts single type or comma-separated types (e.g. "CHILD,CHILD_LABORER") */
  beneficiary_type?: string
}

interface UseBeneficiaryPaginationOptions {
  recordsPerPage?: number
  /** Accepts single type or comma-separated types (e.g. "CHILD,CHILD_LABORER") */
  beneficiaryType?: string
  autoRetry?: boolean
  initialStatus?: string[] // Optional initial status filter (for admin mode)
  isAdminMode?: boolean // Flag to indicate admin mode (affects ageRange filtering with Draft)
}

interface UseBeneficiaryPaginationReturn {
  beneficiaries: Beneficiaries[]
  totalCount: number | null
  cursor: string | null
  hasMore: boolean
  isLoading: boolean
  /** True while a fresh (non-pagination) fetch is in flight. The previous page's data stays visible during this time. */
  isRefreshing: boolean
  /** Non-null when the most recent fetch failed and no data is available. */
  fetchError: string | null
  filters: FiltersState
  setFilters: (
    filters: FiltersState | ((prev: FiltersState) => FiltersState)
  ) => void
  handleFilterChange: (newFilters: Partial<FiltersState>) => void
  fetchPage: (nextCursor: string | null) => Promise<void>
  loadMore: () => void
  retryFetch: () => void
  retryCount: number
}

/** In-place Fisher-Yates shuffle — O(n), unbiased. */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

/**
 * Custom hook for managing beneficiary pagination with cursor-based loading
 * Includes Fibonacci-based auto-retry logic for failed requests
 */
export function useBeneficiaryPagination(
  options: UseBeneficiaryPaginationOptions = {}
): UseBeneficiaryPaginationReturn {
  const {
    recordsPerPage = 3,
    beneficiaryType,
    autoRetry = true,
    initialStatus,
    isAdminMode = false,
  } = options

  const [filters, setFilters] = useState<FiltersState>({
    gender: "",
    ageRange: [0, beneficiaryType === "ANIMAL" ? 20 : 14],
    status: initialStatus || ["New", "Partially Funded"],
    search: "",
    beneficiary_type: beneficiaryType,
  })

  const [beneficiaries, setBeneficiaries] = useState<Beneficiaries[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [retryCount, setRetryCount] = useState<number>(0)
  const retryCountRef = useRef<number>(0)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Fibonacci sequence for retry delays (in seconds): 1, 1, 2, 3, 5, 8, 13...
  const getFibonacciDelay = useCallback((n: number): number => {
    if (n <= 1) return 1000 // 1 second
    let a = 1,
      b = 1
    for (let i = 2; i <= n; i++) {
      const temp = a + b
      a = b
      b = temp
    }
    return Math.min(b * 1000, 30000) // Cap at 30 seconds
  }, [])

  const buildQuery = useCallback(
    (nextCursor: string | null) => {
      const params = new URLSearchParams()
      const type = (filters.beneficiary_type || beneficiaryType) as string | undefined;
      if (type && type !== "null" && type !== "undefined") {
        params.set("beneficiary_type", type);
      }
      if (filters.gender) params.set("gender", filters.gender)
      if (filters.status?.length) params.set("status", filters.status.join(","))
      
      // Skip age range filtering when:
      //  • the type is ANIMAL (dogs don't have human-comparable ages), or
      //  • status includes an inactive value that may cover beneficiaries of any age
      const isAnimalType = (type ?? "").split(",").includes("ANIMAL")
      const shouldSkipAgeRange =
        isAnimalType ||
        (filters.status || []).some((status) => (INACTIVE_STATUSES as string[]).includes(status))

      // Only apply the age range when the user has moved the slider away from its
      // default position (0 → type max). At the default, treat as "no upper bound"
      // so beneficiaries older than the slider maximum still appear in the listing.
      // This prevents the stats card and the filter strip from diverging on a fresh page load.
      const defaultMaxAge = isAnimalType ? 20 : 14
      const isDefaultAgeRange =
        filters.ageRange[0] === 0 && filters.ageRange[1] >= defaultMaxAge
      if (filters.ageRange && !shouldSkipAgeRange && !isDefaultAgeRange) {
        params.set("ageRange", filters.ageRange.join(","))
      }
      if (filters.search) params.set("search", filters.search)
      params.set("limit", String(recordsPerPage))
      if (nextCursor) params.set("cursor", nextCursor)
      if (isAdminMode) params.set("admin_mode", "true")
      
      
      return params.toString()
    },
    [filters, beneficiaryType, recordsPerPage, isAdminMode]
  )

  const fetchPage = useCallback(
    async (nextCursor: string | null) => {
      const queryString = buildQuery(nextCursor)

      // Abort any in-flight request. Stale data is kept visible (dimmed) while
      // the new page loads so the page height doesn't collapse and scroll
      // position is preserved. isRefreshing signals the UI to apply the overlay.
      if (nextCursor === null) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
        }
        setIsRefreshing(true)
        setFetchError(null)
      }

      const controller = new AbortController()
      abortControllerRef.current = controller
      setIsLoading(true)
      try {
        const res = await fetch(
          `/api/beneficiaries/get?${queryString}`,
          { signal: controller.signal }
        )
        if (!res.ok) throw new Error("Failed to load beneficiaries")
        const data = await res.json()
        if (data?.totalCount != null) setTotalCount(data.totalCount)
        const people = (data?.people || []) as Beneficiaries[]
        shuffle(people)

        setBeneficiaries((prev) => {
          if (!nextCursor) {
            return people
          }

          // Deduplicate: filter out any items that already exist in prev
          const existingIds = new Set(prev.map(b => b.id))
          const newItems = people.filter(b => !existingIds.has(b.id))
          const duplicatesFiltered = people.length - newItems.length
          
          
          if (duplicatesFiltered > 0) {
            console.warn(
              `[useBeneficiaryPagination] ⚠️  ${duplicatesFiltered} duplicate(s) detected! Total unique items: ${prev.length + newItems.length}`
            )
          }
          
          return [...prev, ...newItems]
        })
        setCursor(data?.pageInfo?.nextCursor || null)
        setHasMore(Boolean(data?.pageInfo?.hasMore))
        retryCountRef.current = 0
        setRetryCount(0)
        setFetchError(null)

      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return
        }

        const message = e instanceof Error ? e.message : "Unexpected error"
        console.error("[useBeneficiaryPagination] Fetch error:", message)

        // Only surface fetchError for fresh fetches (cursor === null).
        // loadMore failures keep existing data visible; surfacing them here would
        // either be hidden by the consumer's "no items" gate or, worse, leak into
        // the next fresh fetch and show a stale error message.
        if (nextCursor === null) {
          setFetchError(message)
        }

        const MAX_AUTO_RETRIES = 3
        if (autoRetry && retryCountRef.current < MAX_AUTO_RETRIES) {
          const delay = getFibonacciDelay(retryCountRef.current)
          retryCountRef.current += 1
          setRetryCount(retryCountRef.current)
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current)
          }
          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null
            fetchPage(nextCursor)
          }, delay)
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
          setIsLoading(false)
          if (nextCursor === null) setIsRefreshing(false)
        }
      }
    },
    [buildQuery, autoRetry, getFibonacciDelay]
  )

  const memoizedRetryFetch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    retryCountRef.current = 0
    setRetryCount(0)
    fetchPage(null)
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      fetchPage(cursor)
    }
  }, [cursor, hasMore, isLoading, fetchPage])

  const handleFilterChange = useCallback(
    (newFilters: Partial<FiltersState>) => {
      setFilters((prev) => ({ ...prev, ...newFilters }))
    },
    []
  )

  useEffect(() => {
    setCursor(null)
    fetchPage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  useEffect(() => {
    const unsubscribe = subscribeToSubscriptions("beneficiary-pagination", () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      retryCountRef.current = 0
      setRetryCount(0)
      fetchPage(null)
    })
    return unsubscribe
  }, [fetchPage])

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [])

  return {
    beneficiaries,
    totalCount,
    cursor,
    hasMore,
    isLoading,
    isRefreshing,
    fetchError,
    filters,
    setFilters,
    handleFilterChange,
    fetchPage,
    loadMore,
    retryFetch: memoizedRetryFetch,
    retryCount,
  }
}
