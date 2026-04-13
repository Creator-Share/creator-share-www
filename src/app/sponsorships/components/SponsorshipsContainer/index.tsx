"use client"
import React, { useState, useEffect, useCallback, useRef } from "react"
import { usePathname } from "next/navigation"
import { Box } from "@chakra-ui/react"
import { Beneficiaries, Activity } from "@/types"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import { ACTIVE_STATUSES } from "@/config/beneficiaryStatuses"
import {
  fetchActivitiesByBeneficiaryId,
  fetchAllSponsored,
  SponsoredBeneficiary,
} from "@/actions"
import SponsorshipFilters from "../SponsorshipFilters"
import SponsorshipListings from "../SponsorshipListings"
import BeneficiaryModal from "../SponsorshipModal"
import HorizontalSponsorshipRow from "../HorizontalSponsorshipRow"
import {
  BeneficiaryTabType,
  TYPE_TO_ROUTE,
  ROUTE_TO_TYPE,
  getApiTypes,
} from "@/config/beneficiaryTypes"

/** Set of pathname values that are "type landing pages" (the modal push uses pushState, not router). */
const TYPE_ROUTE_PATHS = new Set(["/", "/street", "/care", "/dogs"])

/**
 * Maps a UI tab type to the DB beneficiary_type values used by fetchAllSponsored.
 * Null (All) returns undefined so no type filter is applied.
 */
function getSponsoredBeneficiaryTypes(type: BeneficiaryTabType | null): string[] | undefined {
  const types = getApiTypes(type)
  return types ? types.split(",") : undefined
}

/** First segment after `/sponsorships/`, or null when not on a profile URL. */
function getSponsorshipUsernameFromPath(path: string): string | null {
  if (!path.startsWith("/sponsorships/") || path === "/sponsorships/checkout") {
    return null
  }
  const rest = path.slice("/sponsorships/".length).split("/")[0]
  return rest ? decodeURIComponent(rest) : null
}

interface SponsorshipsContainerProps {
  /** Controlled active type — drives filter, social row, and URL. */
  activeType: BeneficiaryTabType | null
  /** Called whenever the container wants to change the active type (URL nav, popstate). */
  onTypeChange: (type: BeneficiaryTabType | null) => void
}

/**
 * Owns the sponsorships section state:
 *   - Beneficiary pagination (for portrait cards)
 *   - Sticky filter scroll detection
 *   - Active beneficiary + modal open/close (by object, not by index)
 *   - URL pushState/popState for deep-linkable modal URLs
 *   - Activities fetch (single fetch, passed as prop to modal)
 *
 * `activeType` is a controlled prop — page.tsx owns it so HomeHero and this
 * container stay in sync.  The named routes /street, /care and /dogs are served
 * via Next.js rewrites so the browser URL reflects the selected type.
 * On mount this component reads window.location.pathname and notifies the parent
 * via `onTypeChange` so the shared state is corrected.
 */
const SponsorshipsContainer: React.FC<SponsorshipsContainerProps> = ({
  activeType,
  onTypeChange,
}) => {
  const pathname = usePathname()
  const filtersRef = useRef<HTMLDivElement>(null)
  const previousUrlRef = useRef<string | null>(null)

  const [isFiltersSticky, setIsFiltersSticky] = useState(false)
  const [activeBeneficiary, setActiveBeneficiary] =
    useState<Beneficiaries | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activities, setActivities] = useState<Activity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [sponsored, setSponsored] = useState<SponsoredBeneficiary[]>([])
  /** Bumps when history or our pushState/replaceState changes the meaningful URL so we re-sync modal to pathname. */
  const [urlSyncGeneration, setUrlSyncGeneration] = useState(0)

  // Ref mirror so the popstate handler can read the current type without being
  // recreated every render (avoids re-attaching the listener on every type change).
  const activeTypeRef = useRef<BeneficiaryTabType | null>(null)
  activeTypeRef.current = activeType

  const { beneficiaries, totalCount, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      autoRetry: true,
      initialStatus: ACTIVE_STATUSES as string[],
    })

  // Stable ref so the filter-sync effect never needs handleFilterChange as a dep.
  const handleFilterChangeRef = useRef(handleFilterChange)
  handleFilterChangeRef.current = handleFilterChange

  // Sync the pagination filter whenever activeType changes (from hero, URL nav, or popstate).
  useEffect(() => {
    handleFilterChangeRef.current({ beneficiary_type: getApiTypes(activeType) })
  }, [activeType])

  // Re-fetch sponsored beneficiaries whenever the active type changes.
  useEffect(() => {
    const types = getSponsoredBeneficiaryTypes(activeType)
    fetchAllSponsored(types).then(setSponsored)
  }, [activeType])

  // On mount: read the real browser URL (window.location.pathname) and notify
  // the parent if a specific type route is active.  This handles /street, /care,
  // /dogs served via Next.js rewrites — usePathname() always returns "/" for those
  // paths, but window.location reflects the actual URL the user requested.
  useEffect(() => {
    if (typeof window === "undefined") return
    const typeFromUrl = ROUTE_TO_TYPE[window.location.pathname] ?? null
    if (typeFromUrl !== null) {
      onTypeChange(typeFromUrl)
    }
    // Only run once on mount — subsequent type changes come through onTypeChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTypeChange = useCallback((type: BeneficiaryTabType | null) => {
    onTypeChange(type)

    // Update the URL so the link is shareable / bookmarkable, without
    // triggering a full Next.js page navigation.
    const route = type === null ? "/" : (TYPE_TO_ROUTE[type] ?? "/")
    if (typeof window !== "undefined") {
      window.history.pushState({ beneficiaryType: type }, "", route)
    }
  }, [onTypeChange])

  // Sticky filter detection
  const handleScroll = useCallback(() => {
    if (!filtersRef.current) return
    setIsFiltersSticky(filtersRef.current.getBoundingClientRect().top <= 64)
  }, [])

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  // Fetch activities whenever the active beneficiary changes (single fetch,
  // shared between BeneficiaryModal and BeneficiaryActivity to avoid duplicate calls).
  useEffect(() => {
    if (!activeBeneficiary?.id) {
      setActivities([])
      setActivitiesLoading(false)
      return
    }
    const id = activeBeneficiary.id
    setActivities([])
    setActivitiesLoading(true)
    const controller = new AbortController()
    let cancelled = false

    fetchActivitiesByBeneficiaryId(id, controller.signal)
      .then((data) => {
        if (!cancelled) setActivities(data)
      })
      .finally(() => {
        if (!cancelled) setActivitiesLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [activeBeneficiary?.id])

  const bumpUrlSync = useCallback(() => {
    setUrlSyncGeneration((k) => k + 1)
  }, [])

  const openModal = useCallback(
    (beneficiary: Beneficiaries) => {
      setActiveBeneficiary(beneficiary)
      setIsModalOpen(true)

      if (typeof window !== "undefined" && beneficiary.username) {
        previousUrlRef.current = window.location.pathname + window.location.search
        window.history.pushState(
          { modal: true, username: beneficiary.username },
          "",
          `/sponsorships/${beneficiary.username}`,
        )
        bumpUrlSync()
      }
    },
    [bumpUrlSync],
  )

  const closeModal = useCallback(() => {
    setIsModalOpen(false)

    if (typeof window !== "undefined") {
      const currentPath = window.location.pathname
      if (
        currentPath.startsWith("/sponsorships/") &&
        currentPath !== "/sponsorships/checkout"
      ) {
        window.history.replaceState({}, "", previousUrlRef.current || "/")
      }
      previousUrlRef.current = null
      bumpUrlSync()
    }
  }, [bumpUrlSync])

  // Reconcile modal + active beneficiary with the current URL (deep links, client nav, back/forward).
  useEffect(() => {
    // When a modal is opened via window.history.pushState (not router.push), Next.js's
    // usePathname stays on the type-route path while window.location moves to
    // /sponsorships/:username.  Use the real window URL in that situation.
    const path =
      typeof window !== "undefined" &&
      TYPE_ROUTE_PATHS.has(pathname) &&
      window.location.pathname.startsWith("/sponsorships/")
        ? window.location.pathname
        : pathname

    const username = getSponsorshipUsernameFromPath(path)

    if (!username) {
      setIsModalOpen(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    const match =
      beneficiaries.find((b) => b.username === username) ||
      sponsored.find((b) => b.username === username)

    if (match) {
      setActiveBeneficiary(match)
      setIsModalOpen(true)
      return () => {
        cancelled = true
        controller.abort()
      }
    }

    ;(async () => {
      try {
        const res = await fetch(
          `/api/beneficiaries/get/username/${encodeURIComponent(username)}`,
          { signal: controller.signal },
        )
        if (cancelled) return
        if (!res.ok) {
          setActiveBeneficiary(null)
          setIsModalOpen(false)
          return
        }
        const data = (await res.json()) as { child?: Beneficiaries }
        if (cancelled || !data?.child) {
          if (!cancelled) {
            setActiveBeneficiary(null)
            setIsModalOpen(false)
          }
          return
        }
        setActiveBeneficiary(data.child)
        setIsModalOpen(true)
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        console.error("Failed to load beneficiary by username:", e)
        if (!cancelled) {
          setActiveBeneficiary(null)
          setIsModalOpen(false)
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [beneficiaries, sponsored, urlSyncGeneration, pathname])

  useEffect(() => {
    const onPopState = () => {
      bumpUrlSync()
      // Re-sync the active tab and list filter when the user navigates
      // back/forward through type-route history entries.
      // Guard: skip the onTypeChange call if the type hasn't actually changed.
      if (typeof window !== "undefined") {
        const restoredType = ROUTE_TO_TYPE[window.location.pathname] ?? null
        if (restoredType !== activeTypeRef.current) {
          onTypeChange(restoredType)
        }
      }
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [bumpUrlSync, onTypeChange])

  return (
    <Box>
      {/* Horizontal row: sponsored + waiting cards, both filtered by activeType. */}
      <HorizontalSponsorshipRow
        sponsored={sponsored}
        beneficiaries={beneficiaries}
        selectedBeneficiaryId={activeBeneficiary?.id ?? null}
        hasMore={hasMore}
        isLoading={isLoading}
        onLoadMore={loadMore}
        onOpenModal={openModal}
        activeType={activeType}
      />

      {/* Sticky filter bar */}
      <Box
        ref={filtersRef}
        position={{ base: "relative", lg: "sticky" }}
        top={{ lg: "60px" }}
        zIndex={100}
      >
        <SponsorshipFilters
          onFilterChange={handleFilterChange}
          isSticky={isFiltersSticky}
          beneficiaryType={activeType === "ANIMAL" ? "ANIMAL" : "CHILD"}
          activeType={activeType}
          onTypeChange={handleTypeChange}
          resultCount={totalCount ?? beneficiaries.length}
          hasMoreResults={totalCount === null && hasMore}
        />
      </Box>

      {/* Primary card grid -- narrower than the row/filters so the sticky
         filter's bottom border-radius is visible outside the card edges */}
      <Box mx={{ base: 0, lg: 5 }}>
        <SponsorshipListings
          beneficiaryData={beneficiaries}
          selectedBeneficiaryId={activeBeneficiary?.id ?? null}
          selectedCountry={null}
          onLoadMore={loadMore}
          hasMore={hasMore}
          isLoading={isLoading}
          onOpenModal={openModal}
        />
      </Box>

      {/* Single modal instance -- key resets local state when switching children */}
      {activeBeneficiary && (
        <BeneficiaryModal
          key={activeBeneficiary.id}
          open={isModalOpen}
          onClose={closeModal}
          beneficiary={activeBeneficiary}
          activities={activities}
          activitiesLoading={activitiesLoading}
        />
      )}
    </Box>
  )
}

export default SponsorshipsContainer
