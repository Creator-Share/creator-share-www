"use client"
import { Box, Flex, SimpleGrid, Spinner } from "@chakra-ui/react"
import React, { useState, useEffect, useRef } from "react"
import BeneficiaryCard from "../SponsorshipCard"
import BeneficiaryActivityModal from "../SponsorshipActivity/BeneficiaryActivityModal"
import { BeneficiaryListingsProps } from "@/types/propTypes"

const BeneficiaryListings = React.forwardRef<
  HTMLDivElement,
  BeneficiaryListingsProps
>(
  (
    {
      beneficiaryData,
      selectedBeneficiaryId,
      selectedCountry,
      setSelectedBeneficiaryId,
      mapBounds,
      beneficiaryType = "CHILD",
    },
    ref
  ) => {
    // Infinite scroll state: how many items are currently visible
    const itemsPerPage = 3
    const ARTIFICIAL_DELAY_MS = 5000 // artificial delay to demo spinner
    const OBSERVER_THRESHOLD = 1 // require the sentinel to be fully visible
    const SENTINEL_HEIGHT_PX = 300 // make sentinel tall so intersection happens very close to bottom
    const [visibleCount, setVisibleCount] = useState(itemsPerPage)
    const [dialogOpen, setDialogOpen] = useState<boolean>(false)
    // const [activeBeneficiaryId, setActiveBeneficiaryId] = useState<string | null>(null);
    const isInIframe = window.self !== window.top
    const sentinelRef = useRef<HTMLDivElement | null>(null)
    const [isLoadingMore, setIsLoadingMore] = useState(false)

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
            // Include animals with null location_geo in the listings
            return true
          }
        }

        return true
      })

      return filtered
    }, [beneficiaryData, selectedCountry, mapBounds])

    const visibleBeneficiary = React.useMemo(() => {
      return filteredBeneficiary.slice(
        0,
        Math.min(visibleCount, filteredBeneficiary.length)
      )
    }, [filteredBeneficiary, visibleCount])

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

    // IntersectionObserver to load more when the sentinel comes into view
    useEffect(() => {
      if (!sentinelRef.current) return
      const element = sentinelRef.current

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          const rect = entry.target.getBoundingClientRect()
          const info = {
            time: new Date().toISOString(),
            isIntersecting: entry.isIntersecting,
            intersectionRatio: entry.intersectionRatio,
            sentinelTop: Math.round(rect.top),
            viewportHeight: window.innerHeight,
            visibleCount,
            total: filteredBeneficiary.length,
          }
          // Debug log every time the observer fires
          console.log("[Listings] IO event", info)

          if (
            entry.isIntersecting &&
            entry.intersectionRatio >= 0.99 &&
            !isLoadingMore &&
            visibleCount < filteredBeneficiary.length
          ) {
            console.log("[Listings] Loading more…", {
              add: itemsPerPage,
              delayMs: ARTIFICIAL_DELAY_MS,
            })
            setIsLoadingMore(true)
            // Small timeout to coalesce rapid intersections and show spinner
            setTimeout(() => {
              setVisibleCount((prev) =>
                Math.min(prev + itemsPerPage, filteredBeneficiary.length)
              )
              setIsLoadingMore(false)
              console.log("[Listings] Load complete")
            }, ARTIFICIAL_DELAY_MS)
          }
        },
        {
          root: null,
          rootMargin: "0px 0px 0px 0px",
          threshold: OBSERVER_THRESHOLD,
        }
      )

      observer.observe(element)
      return () => observer.unobserve(element)
    }, [filteredBeneficiary.length, visibleCount, itemsPerPage, isLoadingMore])

    return (
      <Box
        ref={ref}
        width="100%"
        className="border bg-white rounded-2xl"
        px={{ base: 3, md: 8 }}
        mt={4}
        style={{ minHeight: visibleBeneficiary.length ? "auto" : "100px" }}
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

        <Box pt={10} pb={6}>
          <SimpleGrid columns={{ base: 1, md: 3 }} gap="1.5rem">
            {visibleBeneficiary.map((beneficiary) =>
              beneficiary.id ? (
                <Box key={beneficiary.id}>
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
        {/* Infinite scroll sentinel + loading indicator */}
        <Flex justify="center" pb={10} align="center" gap={3}>
          {isLoadingMore && <Spinner size="xl" color="gray.600" />}
          <Spinner size="xl" color="gray.600" />
          <div ref={sentinelRef} style={{ height: SENTINEL_HEIGHT_PX }} />
        </Flex>
      </Box>
    )
  }
)

BeneficiaryListings.displayName = "BeneficiaryListings"

export default BeneficiaryListings
