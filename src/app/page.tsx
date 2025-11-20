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
    })

  // Cleanup abandoned checkout when returning to homepage
  React.useEffect(() => {
    const pendingBeneficiaryId = localStorage.getItem('pending_checkout_beneficiary')
    if (pendingBeneficiaryId) {
      console.log('🧹 Found abandoned checkout, cleaning up:', pendingBeneficiaryId)
      
      fetch('/api/sponsorships/checkout/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiaryId: pendingBeneficiaryId }),
      })
        .then(res => {
          if (res.ok) {
            console.log('✅ Abandoned checkout cleaned up successfully')
            localStorage.removeItem('pending_checkout_beneficiary')
          }
        })
        .catch(err => console.error('Failed to cleanup abandoned checkout:', err))
    }
  }, [])

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
