"use client"
import { Box } from "@chakra-ui/react"
import React, { useState, useEffect, useCallback, useRef } from "react"
import { HomeHero } from "@/components/HomeHero"
import { StatsSection } from "@/components/StatsSection"
import SponsorshipFilters from "./sponsorships/components/SponsorshipFilters"
import SponsorshipListings from "./sponsorships/components/SponsorshipListings"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"

export default function Home() {
  const listRef = React.useRef<HTMLDivElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const [isFiltersSticky, setIsFiltersSticky] = useState(false)

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
      initialStatus: ["New", "Partially Funded", "Sponsorship Cancelled"],
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

      {/* Stats Section */}
      <StatsSection />

      {/* Filters and Listings Container */}
      <Box>
        {/* Filters - sticky on desktop below navbar */}
        <Box
          ref={filtersRef}
          position={{ base: "relative", lg: "sticky" }}
          top={{ lg: "60px" }} // dock seamlessly into navbar
          zIndex={100}
        >
          <SponsorshipFilters 
            onFilterChange={handleFilterChange} 
            isSticky={isFiltersSticky}
          />
        </Box>

        {/* Listings */}
        <SponsorshipListings
          ref={listRef}
          beneficiaryData={beneficiaries}
          selectedBeneficiaryId={null}
          selectedCountry={null}
          setSelectedBeneficiaryId={() => {}}
          onLoadMore={loadMore}
          hasMore={hasMore}
          isLoading={isLoading}
        />
      </Box>
    </Box>
  )
}
