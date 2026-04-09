"use client"
import React, { useState, useEffect, useCallback, useRef } from "react"
import { usePathname } from "next/navigation"
import { Box } from "@chakra-ui/react"
import { Beneficiaries, Activity } from "@/types"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import {
  fetchActivitiesByBeneficiaryId,
  fetchAllSponsored,
  SponsoredBeneficiary,
} from "@/actions"
import SponsorshipFilters from "../SponsorshipFilters"
import SponsorshipListings from "../SponsorshipListings"
import BeneficiaryModal from "../SponsorshipModal"
import HorizontalSponsorshipRow from "../HorizontalSponsorshipRow"
import BeneficiaryTypeNav, {
  BeneficiaryTabType,
  ALL_BENEFICIARY_TABS,
  TYPE_TO_ROUTE,
  ROUTE_TO_TYPE,
} from "@/components/BeneficiaryTypeNav"

/** Set of pathname values that are "type landing pages" (the modal push uses pushState, not router). */
const TYPE_ROUTE_PATHS = new Set(["/", "/street", "/care", "/dogs"])

/** Returns the API beneficiary_type string for the pagination hook. */
function getApiBeneficiaryType(type: BeneficiaryTabType | null): string | undefined {
  if (!type) return undefined
  if (type === "CHILD_LABORER") return "CHILD,CHILD_LABORER"
  return type
}

/** First segment after `/sponsorships/`, or null when not on a profile URL. */
function getSponsorshipUsernameFromPath(path: string): string | null {
  if (!path.startsWith("/sponsorships/") || path === "/sponsorships/checkout") {
    return null
  }
  const rest = path.slice("/sponsorships/".length).split("/")[0]
  return rest ? decodeURIComponent(rest) : null
}

/**
 * Owns all shared state for the sponsorships section:
 *   - Sponsored children with recent activity (for story circles)
 *   - Beneficiary pagination (for portrait cards)
 *   - Sticky filter scroll detection
 *   - Active beneficiary + modal open/close (by object, not by index)
 *   - URL pushState/popState for deep-linkable modal URLs
 *   - Activities fetch (single fetch, passed as prop to modal)
 *
 * There is only one instance of this container (in src/app/page.tsx).
 * The named routes /street, /care and /dogs are served via Next.js rewrites so
 * the browser URL reflects the selected type while a single page.tsx is used.
 * On mount this component reads window.location.pathname and applies the
 * matching type filter automatically.
 */
const SponsorshipsContainer: React.FC = () => {
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

  // Always start as null (All) — the mount effect below corrects to the URL type.
  const [activeType, setActiveType] = useState<BeneficiaryTabType | null>(null)
  // Ref mirror so the popstate handler can read the current type without being
  // recreated every render (avoids re-attaching the listener on every type change).
  const activeTypeRef = useRef<BeneficiaryTabType | null>(null)
  activeTypeRef.current = activeType

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      autoRetry: true,
      initialStatus: ["New", "Partially Funded", "Sponsorship Cancelled"],
    })

  // On mount: read the real browser URL (window.location.pathname) and apply
  // the matching type filter.  This handles /street, /care, /dogs served via
  // Next.js rewrites — usePathname() always returns "/" for those paths, but
  // window.location reflects the actual URL the user requested.
  useEffect(() => {
    if (typeof window === "undefined") return
    const typeFromUrl = ROUTE_TO_TYPE[window.location.pathname] ?? null
    if (typeFromUrl !== null) {
      setActiveType(typeFromUrl)
      handleFilterChange({ beneficiary_type: getApiBeneficiaryType(typeFromUrl) })
    }
    // Only run once on mount — subsequent changes go through handleTypeChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTypeChange = useCallback((type: BeneficiaryTabType | null) => {
    // 1. Immediately switch the highlighted tab + re-fetch the list in-place.
    setActiveType(type)
    handleFilterChange({ beneficiary_type: getApiBeneficiaryType(type) })

    // 2. Update the URL so the link is shareable / bookmarkable, without
    //    triggering a full Next.js page navigation (same pushState pattern
    //    as the modal deep-link).
    const route = type === null ? "/" : (TYPE_TO_ROUTE[type] ?? "/")
    if (typeof window !== "undefined") {
      window.history.pushState({ beneficiaryType: type }, "", route)
    }
  }, [handleFilterChange])

  // Fetch all Budget Fulfilled children, ordered by most recent activity first.
  useEffect(() => {
    fetchAllSponsored().then(setSponsored)
  }, [])

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
      // Guard: skip the handleFilterChange call if the type hasn't actually
      // changed — calling it unconditionally would create a new filters object
      // reference and trigger an unnecessary list re-fetch in the hook.
      if (typeof window !== "undefined") {
        const restoredType = ROUTE_TO_TYPE[window.location.pathname] ?? null
        if (restoredType !== activeTypeRef.current) {
          setActiveType(restoredType)
          handleFilterChange({ beneficiary_type: getApiBeneficiaryType(restoredType) })
        }
      }
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [bumpUrlSync, handleFilterChange])

  return (
    <Box>
      {/* Horizontal row: "Children Sponsored" cards on the left,
          "Children Waiting" cards on the right, all identical portrait format.
          Infinite scroll is wired to the same pagination hook as the grid below. */}
      <HorizontalSponsorshipRow
        sponsored={sponsored}
        beneficiaries={beneficiaries}
        selectedBeneficiaryId={activeBeneficiary?.id ?? null}
        hasMore={hasMore}
        isLoading={isLoading}
        onLoadMore={loadMore}
        onOpenModal={openModal}
      />

      {/* Beneficiary type nav */}
      <Box px={{ base: 4, lg: 8 }} pt={4}>
        <BeneficiaryTypeNav
          tabs={ALL_BENEFICIARY_TABS}
          activeType={activeType}
          onChange={handleTypeChange}
        />
      </Box>

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
