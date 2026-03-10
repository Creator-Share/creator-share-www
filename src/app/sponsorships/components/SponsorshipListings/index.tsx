"use client"
import { Box, Button, Flex, SimpleGrid, Spinner, Text } from "@chakra-ui/react"
import React, { useState, useEffect, useRef, useCallback } from "react"
import BeneficiaryCard from "../SponsorshipCard"
import { BeneficiaryListingsProps } from "@/types/propTypes"
import BlindSponsorshipModal from "../BlindSponsorshipModal"
import { Beneficiaries } from "@/types"

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
      onOpenModal,
    },
    ref,
  ) => {
    const SCROLL_THRESHOLD_PX = 300
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [blindModalOpen, setBlindModalOpen] = useState<boolean>(false)
    const [animatingItems, setAnimatingItems] = useState<Set<string>>(new Set())
    const prevCountRef = useRef(0)

    const isInIframe =
      typeof window !== "undefined" && window.self !== window.top

    const filteredBeneficiaries = React.useMemo(() => {
      const safe = Array.isArray(beneficiaryData) ? beneficiaryData : []
      return safe.filter((b) => {
        if (selectedCountry && b.country !== selectedCountry) return false
        if (mapBounds) {
          if (b.location_geo) {
            const [lng, lat] = b.location_geo.coordinates
            return mapBounds.contains([lat, lng])
          }
          return true
        }
        return true
      })
    }, [beneficiaryData, selectedCountry, mapBounds])

    // Fade-in animation for newly loaded items
    useEffect(() => {
      const prev = prevCountRef.current
      const current = filteredBeneficiaries.length
      if (current > prev) {
        const newIds = new Set(
          filteredBeneficiaries
            .slice(prev, current)
            .map((b) => b.id)
            .filter(Boolean),
        )
        setAnimatingItems(newIds)
        setTimeout(() => setAnimatingItems(new Set()), 500)
      }
      prevCountRef.current = current
    }, [filteredBeneficiaries])

    // Notify parent iframe of height changes
    useEffect(() => {
      if (!isInIframe) return
      setTimeout(() => {
        window.parent.postMessage(
          {
            type: "resize",
            height: document.documentElement.scrollHeight + 200,
          },
          "*",
        )
      }, 100)
    }, [isInIframe, filteredBeneficiaries.length])

    // Scroll the selected beneficiary into view when highlighted from the map
    useEffect(() => {
      if (!selectedBeneficiaryId) return
      setTimeout(() => {
        const el = document.getElementById(selectedBeneficiaryId)
        el?.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 100)
    }, [selectedBeneficiaryId])

    // Infinite scroll -- trigger loadMore when near the bottom of the container
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      let ticking = false
      let lastLoadTime = 0
      const LOAD_THROTTLE_MS = 500

      const onScroll = () => {
        if (ticking) return
        ticking = true
        requestAnimationFrame(() => {
          const now = Date.now()
          const distanceFromBottom =
            container.getBoundingClientRect().bottom - window.innerHeight
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

      window.addEventListener("scroll", onScroll, { passive: true })
      return () => window.removeEventListener("scroll", onScroll)
    }, [hasMore, isLoading, onLoadMore])

    const handleCardClick = useCallback(
      (beneficiary: Beneficiaries) => {
        onOpenModal?.(beneficiary)
      },
      [onOpenModal],
    )

    return (
      <Box
        ref={(el: HTMLDivElement | null) => {
          containerRef.current = el
          if (typeof ref === "function") ref(el)
          else if (ref) ref.current = el
        }}
        width="100%"
        className="border bg-white rounded-2xl"
        mt={4}
        py={3}
        suppressHydrationWarning={true}
      >
        <BlindSponsorshipModal
          open={blindModalOpen}
          onClose={() => setBlindModalOpen(false)}
        />

        {filteredBeneficiaries.length > 0 && (
          <Box p={{ base: 4, lg: 8 }}>
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="1rem">
              {filteredBeneficiaries.map((beneficiary) =>
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
                      onOpenDialog={() => handleCardClick(beneficiary)}
                      beneficiaryType={beneficiaryType}
                    />
                  </Box>
                ) : null,
              )}
            </SimpleGrid>
          </Box>
        )}

        {isLoading && (
          <Flex justify="center" py={12} align="center">
            <Spinner size="xl" color="gray.300" />
          </Flex>
        )}

        {!isLoading && (
          <>
            {filteredBeneficiaries.length === 0 && (
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
                <Text fontSize="sm" color="gray.400" textAlign="center" mt={1}>
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

            {/* {filteredBeneficiaries.length > 0 && !hasMore && (
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
                  {"That's all for now."}
                </Text>
                <Text
                  fontSize="sm"
                  color="gray.400"
                  textAlign="center"
                  mt={1}
                >
                  {filteredBeneficiaries.length === 1
                    ? "No further matching children found"
                    : `No further matching children found (${filteredBeneficiaries.length} total)`}
                </Text>
              </Flex>
            )} */}
          </>
        )}
      </Box>
    )
  },
)

BeneficiaryListings.displayName = "BeneficiaryListings"

export default BeneficiaryListings
