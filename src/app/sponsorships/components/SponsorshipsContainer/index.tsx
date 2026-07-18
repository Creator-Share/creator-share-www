"use client"
import React, { useState, useEffect, useCallback, useRef } from "react"
import { usePathname } from "next/navigation"
import { Box } from "@chakra-ui/react"
import { Beneficiaries, Activity } from "@/types"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import { subscribeToSubscriptions } from "@/lib/subscriptionsRealtime"
import { PUBLIC_STATUSES } from "@/config/beneficiaryStatuses"
import { useFilterStore } from "@/store/filterStore"
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
  ROUTE_TO_TYPE,
  getApiTypes,
} from "@/config/beneficiaryTypes"
import { usePublicSite } from "@/components/advocates/PublicSiteProvider"

/** Set of pathname values that are "type landing pages" (the modal push uses pushState, not router). */
const TYPE_ROUTE_PATHS = new Set([
  "/",
  "/child_laborers",
  "/special_needs",
  "/in_our_care",
  "/dogs",
])

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
  const publicSite = usePublicSite()
  const pathname = usePathname()
  const filtersRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
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

  const {
    beneficiaries,
    totalCount,
    hasMore,
    isLoading,
    isRefreshing,
    fetchError,
    handleFilterChange,
    loadMore,
    retryFetch,
  } = useBeneficiaryPagination({
    recordsPerPage: 9,
    autoRetry: true,
    initialStatus: PUBLIC_STATUSES as string[],
  })

  const resetToDefaults = useFilterStore((s) => s.resetToDefaults)

  // Stable ref so the filter-sync effect never needs handleFilterChange as a dep.
  const handleFilterChangeRef = useRef(handleFilterChange)
  handleFilterChangeRef.current = handleFilterChange

  // Scroll the viewport up so the unified card's top edge sits just below
  // the sticky navbar. Only fires when the user is already scrolled past that
  // point so interacting with filters while at the top of the page is a no-op.
  const scrollToCard = useCallback(() => {
    if (!cardRef.current) return
    const NAVBAR_HEIGHT = 72
    const cardTop = cardRef.current.getBoundingClientRect().top + window.scrollY
    const target = Math.max(0, cardTop - NAVBAR_HEIGHT)
    if (window.scrollY > target) {
      window.scrollTo({ top: target, behavior: "smooth" })
    }
  }, [])

  // Resets all active filters and scrolls to the top of the card.
  // Passed to SponsorshipListings so the empty-state "Show all" button works.
  const handleShowAll = useCallback(() => {
    resetToDefaults()
    handleFilterChange({
      gender: "",
      ageRange: [0, 14],
      status: PUBLIC_STATUSES as string[],
      search: "",
    })
    onTypeChange(null)
    scrollToCard()
  }, [resetToDefaults, handleFilterChange, onTypeChange, scrollToCard])

  // Exposed to SponsorshipFilters — wraps the pagination handler with a
  // smooth scroll back to the top of the unified card.
  const handleFilterChangeAndScroll = useCallback(
    (...args: Parameters<typeof handleFilterChange>) => {
      handleFilterChange(...args)
      scrollToCard()
    },
    [handleFilterChange, scrollToCard],
  )

  // Sync the pagination filter whenever activeType changes (from hero, URL nav, or popstate).
  useEffect(() => {
    handleFilterChangeRef.current({ beneficiary_type: getApiTypes(activeType) })
  }, [activeType])

  // Fetch sponsored beneficiaries once on mount (all types, not filtered by activeType).
  useEffect(() => {
    if (publicSite.kind === "advocate") {
      setSponsored([])
      return
    }

    let cancelled = false

    const refresh = () => {
      fetchAllSponsored(undefined)
        .then((data) => {
          if (!cancelled) setSponsored(data)
        })
        .catch((err) => {
          if (cancelled) return
          console.warn("[SponsorshipsContainer] fetchAllSponsored failed:", err)
        })
    }

    refresh()

    // Keep sponsored set in sync with subscription changes
    const unsubscribe = subscribeToSubscriptions("sponsored-container", () => {
      if (!cancelled) refresh()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [publicSite.kind])

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

  const handleTypeChange = useCallback(
    (type: BeneficiaryTabType | null) => {
      onTypeChange(type)
      scrollToCard()
    },
    [onTypeChange, scrollToCard],
  )

  // Sticky filter detection — only meaningful at lg+ where position:sticky applies.
  // Below that breakpoint the filter scrolls with the page so isFiltersSticky
  // must stay false regardless of scroll position.
  const handleScroll = useCallback(() => {
    if (!filtersRef.current) return
    const isLgViewport = window.innerWidth >= 992
    setIsFiltersSticky(
      isLgViewport && filtersRef.current.getBoundingClientRect().top <= 64,
    )
  }, [])

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("resize", handleScroll, { passive: true })
    handleScroll()
    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleScroll)
    }
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
        previousUrlRef.current =
          window.location.pathname + window.location.search
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
        const data = (await res.json()) as { beneficiary?: Beneficiaries }
        if (cancelled || !data?.beneficiary) {
          if (!cancelled) {
            setActiveBeneficiary(null)
            setIsModalOpen(false)
          }
          return
        }
        setActiveBeneficiary(data.beneficiary)
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
    <Box
      style={{
        animation:
          "pageContentFadeUp 0.6s 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      {/* Horizontal row: sponsored + recent cards, always shows all types. */}
      <HorizontalSponsorshipRow
        sponsored={sponsored}
        beneficiaries={beneficiaries}
        selectedBeneficiaryId={activeBeneficiary?.id ?? null}
        hasMore={hasMore}
        isLoading={isLoading}
        onLoadMore={loadMore}
        onOpenModal={openModal}
      />

      {/* Unified card: filter header + primary content grid.
          Mobile: full-bleed (negates PageWrapper's px-4), no radius, fills
          remaining viewport height so the page background appears white.
          Desktop (lg+): inset margins, rounded corners, natural height. */}
      <Box
        ref={cardRef}
        mt={{ base: 4, lg: 8 }}
        mx={{ base: -4, lg: 5 }}
        minHeight={{ base: "100dvh", lg: "auto" }}
        className="bg-white border border-gray-200 lg:rounded-2xl overflow-clip"
        style={{
          boxShadow:
            "0 4px 24px -4px rgba(0,0,0,0.08), 0 2px 8px -2px rgba(0,0,0,0.04)",
        }}
      >
        {/* Filter header — sticky on desktop; hard bottom border separates it from the grid */}
        <Box
          ref={filtersRef}
          position={{ base: "relative", lg: "sticky" }}
          top={{ lg: "60px" }}
          zIndex={100}
          className="bg-white lg:rounded-t-2xl border-b border-gray-200"
          style={{
            boxShadow: isFiltersSticky
              ? "0 4px 16px -4px rgba(0,0,0,0.10)"
              : undefined,
          }}
        >
          <SponsorshipFilters
            onFilterChange={handleFilterChangeAndScroll}
            isSticky={isFiltersSticky}
            beneficiaryType={activeType === "ANIMAL" ? "ANIMAL" : "CHILD"}
            activeType={activeType}
            onTypeChange={handleTypeChange}
            resultCount={totalCount ?? beneficiaries.length}
            hasMoreResults={totalCount === null && hasMore}
            noCard
          />
        </Box>

        {/* Content grid — shares the unified card; no separate border/shadow */}
        <SponsorshipListings
          beneficiaryData={beneficiaries}
          selectedBeneficiaryId={activeBeneficiary?.id ?? null}
          selectedCountry={null}
          onLoadMore={loadMore}
          hasMore={hasMore}
          isLoading={isLoading}
          isRefreshing={isRefreshing}
          onOpenModal={openModal}
          onClearFilters={handleShowAll}
          fetchError={fetchError}
          onRetry={retryFetch}
          noCard
        />
      </Box>

      {/* Single modal instance -- key resets local state when switching beneficiaries */}
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
