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

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
      initialStatus: ["New", "Partially Funded", "Sponsorship Cancelled"],
    })

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
    const path =
      typeof window !== "undefined" &&
      pathname === "/" &&
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
    const onPopState = () => bumpUrlSync()
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [bumpUrlSync])

  return (
    <Box>
      {/* Horizontal row: "Children Sponsored" cards on the left,
          "Children Waiting" cards on the right, all identical portrait format.
          Infinite scroll is wired to the same pagination hook as the grid below. */}
      <HorizontalSponsorshipRow
        sponsored={sponsored}
        beneficiaries={beneficiaries}
        selectedBeneficiaryId={null}
        hasMore={hasMore}
        isLoading={isLoading}
        onLoadMore={loadMore}
        onOpenModal={openModal}
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
        />
      </Box>

      {/* Primary card grid -- narrower than the row/filters so the sticky
         filter's bottom border-radius is visible outside the card edges */}
      <Box mx={{ base: 0, lg: 5 }}>
        <SponsorshipListings
          beneficiaryData={beneficiaries}
          selectedBeneficiaryId={null}
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
