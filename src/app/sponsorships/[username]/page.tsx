"use client"
import { Box } from "@chakra-ui/react"
import React, { useState, useEffect, useCallback, useRef } from "react"
import { useParams } from "next/navigation"
import { HomeHero } from "@/components/HomeHero"
import SponsorshipFilters from "../components/SponsorshipFilters"
import SponsorshipListings from "../components/SponsorshipListings"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"

// This page renders the same homepage content but with the modal initially open
// for the child specified in the URL. This allows direct linking to child profiles
// while maintaining the modal-based UX.
export default function ChildProfilePage() {
  const params = useParams()
  const username = typeof params.username === "string" ? params.username : null
  const listRef = React.useRef<HTMLDivElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const [isFiltersSticky, setIsFiltersSticky] = useState(false)

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
      initialStatus: ["New", "Partially Funded"],
    })

  // Detect when filters become sticky
  const handleScroll = useCallback(() => {
    if (!filtersRef.current) return
    const rect = filtersRef.current.getBoundingClientRect()
    // Filters are sticky when their top is at or near the sticky position (60px)
    setIsFiltersSticky(rect.top <= 64)
  }, [])

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  return (
    <Box minH="130vh" pb={40}>
      {/* Home Hero Section */}
      <HomeHero />

      {/* Filters and Listings Container */}
      <Box>
        {/* Filters - sticky on desktop below navbar */}
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

        {/* Listings - with initial modal open for the username */}
        <SponsorshipListings
          ref={listRef}
          beneficiaryData={beneficiaries}
          selectedBeneficiaryId={null}
          selectedCountry={null}
          setSelectedBeneficiaryId={() => {}}
          onLoadMore={loadMore}
          hasMore={hasMore}
          isLoading={isLoading}
          initialOpenUsername={username}
        />
      </Box>
    </Box>
  )
}
