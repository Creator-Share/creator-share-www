"use client"
import { Box, Flex, SimpleGrid, Spinner, Text } from "@chakra-ui/react"
import React, { useState, useEffect, useRef } from "react"
import BeneficiaryCard from "../SponsorshipCard"
import BeneficiaryActivityModal from "../SponsorshipActivity/BeneficiaryActivityModal"
import { BeneficiaryListingsProps } from "@/types/propTypes"

const BeneficiaryListings = React.forwardRef<
  HTMLDivElement,
  BeneficiaryListingsProps & {
    onLoadMore?: () => void
    hasMore?: boolean
    isLoading?: boolean
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
    },
    ref
  ) => {
    // Infinite scroll state: how many items are currently visible
    const itemsPerPage = 3
    const SCROLL_THRESHOLD_PX = 300
    const [visibleCount, setVisibleCount] = useState(itemsPerPage)
    const [dialogOpen, setDialogOpen] = useState<boolean>(false)
    // const [activeBeneficiaryId, setActiveBeneficiaryId] = useState<string | null>(null);
    const isInIframe =
      typeof window !== "undefined" && window.self !== window.top
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [animatingItems, setAnimatingItems] = useState<Set<string>>(new Set())
    const prevVisibleCountRef = useRef(visibleCount)

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

    // Handle opening the dialog for a specific child
    const handleOpenDialog = (beneficiaryId?: string) => {
      if (!beneficiaryId) return
      const index = visibleBeneficiary.findIndex(
        (beneficiary) => beneficiary.id === beneficiaryId
      )
      if (index !== -1) {
        setCurrentDialogIndex(index)
        setDialogOpen(true)
      }
    }

    const [currentDialogIndex, setCurrentDialogIndex] = useState<number>(0)

    // Scroll detection for infinite loading
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

          // Check if container has internal scroll
          const hasInternalScroll =
            container.scrollHeight > container.clientHeight

          let distanceFromBottom
          if (hasInternalScroll) {
            // Container is scrolling internally
            const scrollTop = container.scrollTop
            const scrollHeight = container.scrollHeight
            const clientHeight = container.clientHeight
            distanceFromBottom = scrollHeight - (scrollTop + clientHeight)
          } else {
            // Container fits in viewport, use window scroll position
            const rect = container.getBoundingClientRect()
            distanceFromBottom = rect.bottom - window.innerHeight
          }

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

      // Listen to both container scroll and window scroll
      container.addEventListener("scroll", onScroll, { passive: true })
      window.addEventListener("scroll", onScroll, { passive: true })
      return () => {
        container.removeEventListener("scroll", onScroll)
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
        style={{
          minHeight: visibleBeneficiary.length ? "auto" : "100px",
          maxHeight: "200vh",
          overflowY: "auto",
        }}
        suppressHydrationWarning={true}
      >
        {visibleBeneficiary.length > 0 && (
          <BeneficiaryActivityModal
            open={dialogOpen}
            onClose={(open?: boolean) => setDialogOpen(Boolean(open))}
            beneficiary={
              visibleBeneficiary[currentDialogIndex] || visibleBeneficiary[0]
            }
          />
        )}

        <Box p={8}>
          {visibleBeneficiary.length === 0 && !isLoading ? (
            <Flex justify="center" py={12} align="center" direction="column">
              <Text fontSize="lg" color="gray.600" textAlign="center">
                No matching children
              </Text>
              <Text fontSize="sm" color="gray.500" textAlign="center" mt={2}>
                Try adjusting your search or filters to find more results
              </Text>
            </Flex>
          ) : (
            <SimpleGrid columns={{ base: 1, md: 3 }} gap="1.5rem">
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
          )}
        </Box>
        {/* Infinite scroll loading indicator */}
        {isLoading && (
          <Flex justify="center" py={12} align="center">
            <Spinner size="xl" color="gray.300" />
          </Flex>
        )}
      </Box>
    )
  }
)

BeneficiaryListings.displayName = "BeneficiaryListings"

export default BeneficiaryListings
