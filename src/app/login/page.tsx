"use client"
import { Box } from "@chakra-ui/react"
import React, { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { HomeHero } from "@/components/HomeHero"
import SponsorshipFilters from "../sponsorships/components/SponsorshipFilters"
import SponsorshipListings from "../sponsorships/components/SponsorshipListings"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import { useAuthStore } from "@/store/authStore"

// This page renders the homepage content with the sign-in modal open.
// The PageNavbar detects the /login path and opens the SignInModal.
export default function LoginPage() {
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
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

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      router.push("/")
    }
  }, [user, router])


  // Detect when filters become sticky
  const handleScroll = useCallback(() => {
    if (!filtersRef.current) return
    const rect = filtersRef.current.getBoundingClientRect()
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
