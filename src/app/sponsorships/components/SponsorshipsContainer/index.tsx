"use client"
import React, { useState, useEffect, useCallback, useRef } from "react"
import { Box } from "@chakra-ui/react"
import { Beneficiaries, Activity } from "@/types"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import { fetchActivitiesByBeneficiaryId } from "@/actions"
import SponsorshipFilters from "../SponsorshipFilters"
import SponsorshipListings from "../SponsorshipListings"
import BeneficiaryModal from "../SponsorshipModal"
import SponsoredStoriesStrip from "../SponsoredStoriesStrip"

/**
 * Owns all state that was previously split between page.tsx and SponsorshipListings:
 *   - Beneficiary pagination
 *   - Sticky filter scroll detection
 *   - Active beneficiary + modal open/close (by object, not by index)
 *   - URL pushState/popState for deep-linkable modal URLs
 *   - Activities fetch (single fetch, passed as prop to modal)
 *
 * Exposes a simple onOpenModal(beneficiary) callback to both
 * SponsoredStoriesStrip and SponsorshipListings.
 */
const SponsorshipsContainer: React.FC = () => {
  const filtersRef = useRef<HTMLDivElement>(null)
  const previousUrlRef = useRef<string | null>(null)
  const isInitialOpenHandledRef = useRef(false)

  const [isFiltersSticky, setIsFiltersSticky] = useState(false)
  const [activeBeneficiary, setActiveBeneficiary] = useState<Beneficiaries | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activities, setActivities] = useState<Activity[]>([])

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
      initialStatus: ["New", "Partially Funded", "Sponsorship Cancelled"],
    })

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

  // Fetch activities whenever the active beneficiary changes.
  // This replaces the double-fetch that previously happened in BeneficiaryModal
  // (to derive hasActivities) and again inside BeneficiaryActivity (to render).
  useEffect(() => {
    if (!activeBeneficiary?.id) {
      setActivities([])
      return
    }
    fetchActivitiesByBeneficiaryId(activeBeneficiary.id).then(setActivities)
  }, [activeBeneficiary?.id])

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
          `/sponsorships/${beneficiary.username}`
        )
      }
    },
    []
  )

  const closeModal = useCallback(() => {
    setIsModalOpen(false)

    if (typeof window !== "undefined") {
      const currentPath = window.location.pathname
      if (
        currentPath.startsWith("/sponsorships/") &&
        currentPath !== "/sponsorships/checkout"
      ) {
        window.history.replaceState(
          {},
          "",
          previousUrlRef.current || "/"
        )
      }
      previousUrlRef.current = null
    }
  }, [])

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname
      if (
        path.startsWith("/sponsorships/") &&
        path !== "/sponsorships/checkout"
      ) {
        const username = path.split("/sponsorships/")[1]
        if (username) {
          const match = beneficiaries.find((b) => b.username === username)
          if (match) {
            setActiveBeneficiary(match)
            setIsModalOpen(true)
            return
          }
        }
      }
      setIsModalOpen(false)
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [beneficiaries])

  // Open the modal on initial load when the URL already points at a child page
  useEffect(() => {
    if (isInitialOpenHandledRef.current || beneficiaries.length === 0) return

    const path = window.location.pathname
    if (
      path.startsWith("/sponsorships/") &&
      path !== "/sponsorships/checkout"
    ) {
      const username = path.split("/sponsorships/")[1]
      if (username) {
        const match = beneficiaries.find((b) => b.username === username)
        if (match) {
          setActiveBeneficiary(match)
          setIsModalOpen(true)
          isInitialOpenHandledRef.current = true
        }
      }
    }
  }, [beneficiaries])

  return (
    <Box>
      {/* Social proof story strip -- sponsored children with recent updates */}
      <SponsoredStoriesStrip onOpenModal={openModal} />

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

      {/* Listings grid */}
      <SponsorshipListings
        beneficiaryData={beneficiaries}
        selectedBeneficiaryId={null}
        selectedCountry={null}
        onLoadMore={loadMore}
        hasMore={hasMore}
        isLoading={isLoading}
        onOpenModal={openModal}
      />

      {/* Single modal instance -- identified by beneficiary object, not array index */}
      {activeBeneficiary && (
        <BeneficiaryModal
          open={isModalOpen}
          onClose={closeModal}
          beneficiary={activeBeneficiary}
          activities={activities}
        />
      )}
    </Box>
  )
}

export default SponsorshipsContainer
