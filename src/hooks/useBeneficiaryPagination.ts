import { useState, useCallback, useRef, useEffect } from "react"
import { Beneficiaries } from "@/types"
import { toaster } from "@/components/ui/toaster"
import { createClient } from '@supabase/supabase-js'

type FiltersState = {
  gender: string
  ageRange: [number, number]
  status: string[]
  search?: string
  beneficiary_type?: "CHILD" | "ANIMAL" | "FAMILY" | "STREET_INVOLVED"
}

interface UseBeneficiaryPaginationOptions {
  recordsPerPage?: number
  beneficiaryType?: "CHILD" | "ANIMAL" | "FAMILY" | "STREET_INVOLVED"
  autoRetry?: boolean
  initialStatus?: string[] // Optional initial status filter (for admin mode)
  isAdminMode?: boolean // Flag to indicate admin mode (affects ageRange filtering with Draft)
}

interface UseBeneficiaryPaginationReturn {
  beneficiaries: Beneficiaries[]
  cursor: string | null
  hasMore: boolean
  isLoading: boolean
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

/**
 * Custom hook for managing beneficiary pagination with cursor-based loading
 * Includes Fibonacci-based auto-retry logic for failed requests
 */
export function useBeneficiaryPagination(
  options: UseBeneficiaryPaginationOptions = {}
): UseBeneficiaryPaginationReturn {
  const {
    recordsPerPage = 3,
    beneficiaryType = "CHILD",
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
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [retryCount, setRetryCount] = useState<number>(0)

  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const toastIdRef = useRef<string | null>(null)
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
      params.set(
        "beneficiary_type",
        filters.beneficiary_type || beneficiaryType
      )
      if (filters.gender) params.set("gender", filters.gender)
      if (filters.status?.length) params.set("status", filters.status.join(","))
      const includesDraft = (filters.status || []).includes("Draft")
      if (filters.ageRange && !includesDraft) {
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

      // Abort any in-flight request when starting a fresh query (filters changed)
      if (nextCursor === null && abortControllerRef.current) {
        abortControllerRef.current.abort()
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
        const people = (data?.people || []) as Beneficiaries[]

        setBeneficiaries((prev) => {
          if (!nextCursor) {
            console.log(
              `[useBeneficiaryPagination] Initial load: ${people.length} items`
            )
            return people
          }

          // Deduplicate by ID to prevent duplicate key errors
          const existingIds = new Set(prev.map((b) => b.id))
          const newItems = people.filter((b) => !existingIds.has(b.id))

          const duplicateCount = people.length - newItems.length
          if (duplicateCount > 0) {
            console.error(
              `[useBeneficiaryPagination] ⚠️  Filtered out ${duplicateCount} duplicate(s) from API response`
            )
            console.error(
              `[useBeneficiaryPagination] Duplicate IDs:`,
              people.filter((b) => existingIds.has(b.id)).map((b) => b.id)
            )
          }

          console.log(
            `[useBeneficiaryPagination] Loading more: ${newItems.length} new items (${duplicateCount} duplicates filtered)`
          )
          return [...prev, ...newItems]
        })
        setCursor(data?.pageInfo?.nextCursor || null)
        setHasMore(Boolean(data?.pageInfo?.hasMore))
        setRetryCount(0) // Reset retry count on success

        // Dismiss any existing error toast
        if (toastIdRef.current) {
          toaster.dismiss(toastIdRef.current)
          toastIdRef.current = null
        }

      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          console.log("[useBeneficiaryPagination] Previous request aborted")
          return
        }

        const message = e instanceof Error ? e.message : "Unexpected error"
        console.error("[useBeneficiaryPagination] Fetch error:", message)

        // Show toast with manual retry button
        const toastId = toaster.create({
          title: "Failed to load beneficiaries",
          description: autoRetry
            ? `Retrying automatically in ${Math.ceil(
                getFibonacciDelay(retryCount) / 1000
              )}s...`
            : "Click retry to try again",
          type: "error",
          duration: autoRetry ? getFibonacciDelay(retryCount) : 10000,
          action: {
            label: "Retry Now",
            onClick: () => {
              if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current)
              }
              setRetryCount(0)
              fetchPage(null)
            },
          },
        })
        toastIdRef.current = toastId

        // Auto-retry with Fibonacci backoff if enabled
        if (autoRetry) {
          const delay = getFibonacciDelay(retryCount)
          retryTimeoutRef.current = setTimeout(() => {
            setRetryCount((prev) => prev + 1)
            fetchPage(nextCursor)
          }, delay)
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
          setIsLoading(false)
        }
      }
    },
    [buildQuery, autoRetry, getFibonacciDelay, retryCount, setRetryCount]
  )

  const memoizedRetryFetch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
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
      console.log("[useBeneficiaryPagination] Filter change:", newFilters)
      setFilters((prev) => ({ ...prev, ...newFilters }))
    },
    []
  )

  // Fetch initial data and when filters change
  useEffect(() => {
    console.log("[useBeneficiaryPagination] Filters changed, resetting list")
    setBeneficiaries([]) // Clear list immediately when filters change
    setCursor(null)
    fetchPage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  // === Supabase Realtime subscription for instant updates ===
  useEffect(() => {
    // Avoid SSR: only subscribe in browser
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn("[useBeneficiaryPagination] Supabase env missing, realtime not enabled")
      return
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Listen for changes to the subscriptions table (relevant to locking logic)
    const channel = supabase
      .channel("beneficiary_subscriptions_rt")
      .on(
        "postgres_changes",
        { schema: "public", table: "subscriptions", event: "*" },
        payload => {
          // Any row insert/update/delete, refetch the list
          console.log("[useBeneficiaryPagination] Supabase realtime: subscriptions event received, reloading list...", payload)
          fetchPage(null)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
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
    cursor,
    hasMore,
    isLoading,
    filters,
    setFilters,
    handleFilterChange,
    fetchPage,
    loadMore,
    retryFetch: memoizedRetryFetch,
    retryCount,
  }
}
