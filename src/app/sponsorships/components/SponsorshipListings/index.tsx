"use client"
import { Box, Button, Flex, SimpleGrid, Spinner, Text } from "@chakra-ui/react"
import React, { useState, useEffect, useRef, useCallback } from "react"
import BeneficiaryCard from "../SponsorshipCard"
import BeneficiaryModal from "../SponsorshipModal"
import { BeneficiaryListingsProps } from "@/types/propTypes"
import BlindSponsorshipModal from "../BlindSponsorshipModal"

const BeneficiaryListings = React.forwardRef<
  HTMLDivElement,
  BeneficiaryListingsProps & {
    onLoadMore?: () => void
    hasMore?: boolean
    isLoading?: boolean
    initialOpenUsername?: string | null
  }
>(
  (
    {
      beneficiaryData,
      selectedBeneficiaryId,
      selectedCountry,
      mapBounds,
      beneficiaryType = "CHILD",
      onLoadMore,
      hasMore = false,
      isLoading = false,
      initialOpenUsername = null,
    },
    ref
  ) => {
    // Infinite scroll state: how many items are currently visible
    const itemsPerPage = 3
    const SCROLL_THRESHOLD_PX = 300
    const [visibleCount, setVisibleCount] = useState(itemsPerPage)
    const [dialogOpen, setDialogOpen] = useState<boolean>(false)
    const [blindModalOpen, setBlindModalOpen] = useState<boolean>(false)
    // const [activeBeneficiaryId, setActiveBeneficiaryId] = useState<string | null>(null);
    const isInIframe =
      typeof window !== "undefined" && window.self !== window.top
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [animatingItems, setAnimatingItems] = useState<Set<string>>(new Set())
    const prevVisibleCountRef = useRef(visibleCount)
    const previousUrlRef = useRef<string | null>(null)
    const isInitialOpenHandledRef = useRef(false)

    const filteredBeneficiary = React.useMemo(() => {
      const safeBeneficiaryData = Array.isArray(beneficiaryData)
        ? beneficiaryData
        : []

      const filtered = safeBeneficiaryData.filter((beneficiary) => {
        // Filter by country if selected
        if (selectedCountry && beneficiary.country !== selectedCountry) {
          return false
        }

        if (mapBounds) {
          if (beneficiary.location_geo) {
            const [lng, lat] = beneficiary.location_geo.coordinates
            return mapBounds.contains([lat, lng])
          } else {
            // Include listings with null location_geo
            return true
          }
        }

        return true
      })

      return filtered
    }, [beneficiaryData, selectedCountry, mapBounds])

    const visibleBeneficiary = React.useMemo(() => {
      return filteredBeneficiary
    }, [filteredBeneficiary])

    // Track new items for fade-in animation
    useEffect(() => {
      if (visibleCount > prevVisibleCountRef.current) {
        const newItems = visibleBeneficiary.slice(
          prevVisibleCountRef.current,
          visibleCount
        )
        const newItemIds = new Set(
          newItems.map((item) => item.id).filter(Boolean)
        )
        setAnimatingItems(newItemIds)

        // Remove animation class after animation completes
        setTimeout(() => setAnimatingItems(new Set()), 500)
      }
      prevVisibleCountRef.current = visibleCount
    }, [visibleCount, visibleBeneficiary])

    useEffect(() => {
      if (isInIframe) {
        setTimeout(() => {
          window.parent.postMessage(
            {
              type: "resize",
              height: document.documentElement.scrollHeight + 200,
            },
            "*"
          )
        }, 100)
      }
    }, [isInIframe, visibleCount])

    useEffect(() => {
      // Reset back to the first "page" worth of items on filter/map changes
      setVisibleCount(itemsPerPage)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCountry, JSON.stringify(mapBounds || {})])

    // Ensure the selected beneficiary is visible; expand the list if needed
    useEffect(() => {
      if (!selectedBeneficiaryId) return

      // Find the index of the selected beneficiary in the filtered list
      const index = filteredBeneficiary.findIndex(
        (b) => b.id === selectedBeneficiaryId
      )

      if (index === -1) return // Not found in filtered list

      const requiredCount = Math.ceil((index + 1) / itemsPerPage) * itemsPerPage
      if (requiredCount > visibleCount) {
        setPageChangeFromSelection(true)
        setVisibleCount(requiredCount)
      } else {
        setPageChangeFromSelection(true)
      }
    }, [selectedBeneficiaryId, filteredBeneficiary, visibleCount, itemsPerPage])

    // Track if page change was triggered by beneficiary selection
    const [pageChangeFromSelection, setPageChangeFromSelection] =
      useState(false)

    // No need to clear selection on infinite scroll expansion

    // Scroll to selected beneficiary after expansion (from map click)
    useEffect(() => {
      if (selectedBeneficiaryId && pageChangeFromSelection) {
        // Wait for DOM update
        setTimeout(() => {
          const el = document.getElementById(selectedBeneficiaryId)
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" })
          }
          setPageChangeFromSelection(false)
        }, 100)
      }
    }, [selectedBeneficiaryId, pageChangeFromSelection])

    // Reset pageChangeFromSelection after a delay to allow the beneficiary to be shown
    useEffect(() => {
      if (pageChangeFromSelection) {
        const timer = setTimeout(() => {
          setPageChangeFromSelection(false)
        }, 500)
        return () => clearTimeout(timer)
      }
    }, [pageChangeFromSelection])

    // Remove the scroll effect from listings component since it's now handled in the map component

    // Reset active beneficiary when selectedBeneficiaryId is cleared or page changes
    useEffect(() => {
      // if (!selectedBeneficiaryId) setActiveBeneficiaryId(null);
    }, [selectedBeneficiaryId])

    // useEffect(() => {
    //   setActiveBeneficiaryId(null);
    // }, [currentPage]);

    const [currentDialogIndex, setCurrentDialogIndex] = useState<number>(0)

    // Handle opening the dialog for a specific child (with URL update)
    const handleOpenDialog = useCallback((beneficiaryId?: string) => {
      if (!beneficiaryId) return
      const index = visibleBeneficiary.findIndex(
        (beneficiary) => beneficiary.id === beneficiaryId
      )
      if (index !== -1) {
        const beneficiary = visibleBeneficiary[index]
        setCurrentDialogIndex(index)
        setDialogOpen(true)
        
        // Update URL to bookmarkable child page without navigation
        if (typeof window !== "undefined" && beneficiary?.username) {
          previousUrlRef.current = window.location.pathname + window.location.search
          window.history.pushState(
            { modal: true, username: beneficiary.username },
            "",
            `/sponsorships/${beneficiary.username}`
          )
        }
      }
    }, [visibleBeneficiary])

    // Handle closing the dialog (restore URL)
    const handleCloseDialog = useCallback(() => {
      setDialogOpen(false)
      
      // Restore URL to homepage
      if (typeof window !== "undefined") {
        const currentPath = window.location.pathname
        if (currentPath.startsWith("/sponsorships/") && currentPath !== "/sponsorships/checkout") {
          // Use replaceState to go back to homepage without adding to history
          window.history.replaceState({}, "", previousUrlRef.current || "/")
        }
        previousUrlRef.current = null
      }
    }, [])

    // Handle browser back/forward navigation
    useEffect(() => {
      const handlePopState = () => {
        const path = window.location.pathname
        if (path.startsWith("/sponsorships/") && path !== "/sponsorships/checkout") {
          // URL is for a child, try to open their modal
          const username = path.split("/sponsorships/")[1]
          if (username) {
            const index = visibleBeneficiary.findIndex(
              (b) => b.username === username
            )
            if (index !== -1) {
              setCurrentDialogIndex(index)
              setDialogOpen(true)
              return
            }
          }
        }
        // Otherwise close the modal
        setDialogOpen(false)
      }

      window.addEventListener("popstate", handlePopState)
      return () => window.removeEventListener("popstate", handlePopState)
    }, [visibleBeneficiary])

    // Handle initial open from URL or prop
    useEffect(() => {
      if (isInitialOpenHandledRef.current || visibleBeneficiary.length === 0) return
      
      // Check for initialOpenUsername prop (from redirect)
      if (initialOpenUsername) {
        const index = visibleBeneficiary.findIndex(
          (b) => b.username === initialOpenUsername
        )
        if (index !== -1) {
          setCurrentDialogIndex(index)
          setDialogOpen(true)
          isInitialOpenHandledRef.current = true
          // Update URL to reflect the child page
          window.history.replaceState(
            { modal: true, username: initialOpenUsername },
            "",
            `/sponsorships/${initialOpenUsername}`
          )
          return
        }
      }

      // Check URL for /sponsorships/[username] pattern (direct navigation)
      const path = window.location.pathname
      if (path.startsWith("/sponsorships/") && path !== "/sponsorships/checkout") {
        const username = path.split("/sponsorships/")[1]
        if (username) {
          const index = visibleBeneficiary.findIndex(
            (b) => b.username === username
          )
          if (index !== -1) {
            setCurrentDialogIndex(index)
            setDialogOpen(true)
            isInitialOpenHandledRef.current = true
          }
        }
      }
    }, [visibleBeneficiary, initialOpenUsername])

    // Scroll detection for infinite loading (uses window scroll for full-page infinite scroll)
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      let ticking = false
      let lastLoadTime = 0
      const LOAD_THROTTLE_MS = 500 // Prevent loads within 500ms of each other

      const onScroll = () => {
        if (ticking) return
        ticking = true
        requestAnimationFrame(() => {
          const now = Date.now()

          // Use window scroll position - container is now full-page
          const rect = container.getBoundingClientRect()
          const distanceFromBottom = rect.bottom - window.innerHeight

          if (
            distanceFromBottom <= SCROLL_THRESHOLD_PX &&
            hasMore &&
            !isLoading &&
            now - lastLoadTime > LOAD_THROTTLE_MS
          ) {
            lastLoadTime = now
            onLoadMore?.()
          }
          ticking = false
        })
      }

      // Listen to window scroll for full-page infinite scroll
      window.addEventListener("scroll", onScroll, { passive: true })
      return () => {
        window.removeEventListener("scroll", onScroll)
      }
    }, [hasMore, isLoading, onLoadMore])

    return (
      <Box
        ref={(el: HTMLDivElement | null) => {
          // Set both refs - containerRef for scrolling, ref for forwarded ref
          containerRef.current = el
          if (typeof ref === "function") ref(el)
          else if (ref) ref.current = el
        }}
        width="100%"
        className="border bg-white rounded-2xl"
        mt={4}
        suppressHydrationWarning={true}
      >
        <BlindSponsorshipModal
          open={blindModalOpen}
          onClose={() => setBlindModalOpen(false)}
        />
        {visibleBeneficiary.length > 0 && (
          <BeneficiaryModal
            open={dialogOpen}
            onClose={() => handleCloseDialog()}
            beneficiary={
              visibleBeneficiary[currentDialogIndex] || visibleBeneficiary[0]
            }
          />
        )}

        {/* Children grid - only render wrapper when there are children */}
        {visibleBeneficiary.length > 0 && (
          <Box p={{ base: 4, lg: 8 }}>
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="1rem">
              {visibleBeneficiary.map((beneficiary) =>
                beneficiary.id ? (
                  <Box
                    key={beneficiary.id}
                    className={
                      animatingItems.has(beneficiary.id)
                        ? "fade-in-new-item"
                        : ""
                    }
                  >
                    <BeneficiaryCard
                      beneficiary={beneficiary}
                      isSelected={selectedBeneficiaryId === beneficiary.id}
                      id={beneficiary.id}
                      onOpenDialog={() => handleOpenDialog(beneficiary.id)}
                      beneficiaryType={beneficiaryType}
                    />
                  </Box>
                ) : null
              )}
            </SimpleGrid>
          </Box>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <Flex justify="center" py={12} align="center">
            <Spinner size="xl" color="gray.300" />
          </Flex>
        )}
        
        {/* End state messages - styled identically */}
        {!isLoading && (
          <>
            {/* No matching children */}
            {visibleBeneficiary.length === 0 && (
              <Flex 
                justify="center" 
                py={20}
                align="center" 
                direction="column"
                mx={8}
              >
                <Text 
                  fontSize="lg" 
                  fontWeight="medium" 
                  color="gray.500"
                  textAlign="center"
                >
                  No matching children
                </Text>
                <Text 
                  fontSize="sm" 
                  color="gray.400" 
                  textAlign="center" 
                  mt={1}
                >
                  Try adjusting your search or filters to find more results
                </Text>
                <Button
                  mt={6}
                  bg="#1C3C8C"
                  color="white"
                  borderRadius="16px"
                  _hover={{ bg: "#1C2B7A" }}
                  onClick={() => setBlindModalOpen(true)}
                >
                  Start a blind sponsorship instead
                </Button>
              </Flex>
            )}

            {/* End of results - shown when we have children and no more to load */}
            {visibleBeneficiary.length > 0 && !hasMore && (
              <Flex 
                justify="center" 
                py={20} 
                align="center" 
                direction="column"
                mx={8}
              >
                <Text 
                  fontSize="lg" 
                  fontWeight="medium" 
                  color="gray.500"
                  textAlign="center"
                >
                  That&apos;s all for now.
                </Text>
                <Text 
                  fontSize="sm" 
                  color="gray.400" 
                  textAlign="center" 
                  mt={1}
                >
                  {visibleBeneficiary.length === 1 
                    ? "No further matching children found"
                    : `No further matching children found (${visibleBeneficiary.length} total)`
                  }
                </Text>
              </Flex>
            )}
          </>
        )}
      </Box>
    )
  }
)

BeneficiaryListings.displayName = "BeneficiaryListings"

export default BeneficiaryListings
