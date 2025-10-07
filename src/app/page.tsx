"use client"
import { Box } from "@chakra-ui/react"
import React from "react"
import { CompactHero } from "@/components/CompactHero"
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
    })

  return (
    <Box>
      {/* Compact Hero Section */}
      <CompactHero />

      {/* Filters and Listings Container with consistent margins */}
      <Box px={{ base: 2, md: 0 }}>
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
