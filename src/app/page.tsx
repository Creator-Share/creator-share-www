"use client"
import { Box } from "@chakra-ui/react"
import React from "react"
import { HomeHero } from "@/components/HomeHero"
import SponsorshipFilters from "./sponsorships/components/SponsorshipFilters"
import SponsorshipListings from "./sponsorships/components/SponsorshipListings"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"

export default function Home() {
  const listRef = React.useRef<HTMLDivElement>(null)

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
      initialStatus: ["New", "Partially Funded"],
    })

  return (
    <Box>
      {/* Home Hero Section */}
      <HomeHero />

      {/* Filters and Listings Container */}
      <Box px={{ base: 4, md: 8 }}>
        {/* Filters */}
        <SponsorshipFilters onFilterChange={handleFilterChange} />

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
