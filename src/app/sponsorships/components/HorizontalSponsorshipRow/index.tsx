"use client"
import React, { useEffect, useRef, useCallback, useState } from "react"
import { Box, Flex, Spinner, Text } from "@chakra-ui/react"
import { Beneficiaries } from "@/types"
import { SponsoredBeneficiary } from "@/actions"
import PortraitBeneficiaryCard from "../SponsorshipCard/PortraitCard"
import SupportedRibbon from "@/components/common/SupportedRibbon"

// ---------------------------------------------------------------------------
// StatsCard -- first item in the row; replaces the StatsSection above the fold
// ---------------------------------------------------------------------------

interface StatsData {
  childrenInNeed: number
  childrenSupported: number
}

const StatsCard: React.FC = () => {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStats(d)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <Box
      w="180px"
      h="270px"
      flexShrink={0}
      borderRadius="20px"
      bg="white"
      borderWidth="1px"
      borderColor="gray.200"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap={4}
      px={6}
    >
      {loading ? (
        <Spinner size="lg" color="gray.300" />
      ) : (
        <>
          <Flex direction="column" align="center">
            <Text
              fontSize="4xl"
              fontWeight="bold"
              color="gray.800"
              lineHeight={1}
            >
              {stats?.childrenInNeed.toLocaleString() ?? "—"}
            </Text>
            <Text
              fontSize="xs"
              color="gray.500"
              fontWeight="medium"
              mt={1}
              textAlign="center"
            >
              Children Waiting
            </Text>
          </Flex>

          <Box w="40px" h="1px" bg="gray.200" />

          <Flex direction="column" align="center">
            <Text
              fontSize="4xl"
              fontWeight="bold"
              color="gray.800"
              lineHeight={1}
            >
              {stats?.childrenSupported.toLocaleString() ?? "—"}
            </Text>
            <Text
              fontSize="xs"
              color="gray.500"
              fontWeight="medium"
              mt={1}
              textAlign="center"
            >
              Children Sponsored
            </Text>
          </Flex>
        </>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Image overlays
// ---------------------------------------------------------------------------

const InNeedBadge: React.FC = () => (
  <Flex
    position="absolute"
    bottom={2}
    left={2}
    align="center"
    bg="orange.500"
    borderRadius="full"
    px="7px"
    py="3px"
    zIndex={1}
    pointerEvents="none"
  >
    <Text fontSize="10px" fontWeight="bold" color="white" lineHeight={1}>
      Waiting
    </Text>
  </Flex>
)

// ---------------------------------------------------------------------------
// Section divider between groups
// ---------------------------------------------------------------------------

const SectionDivider: React.FC<{ label: string }> = ({ label }) => (
  <Flex
    flexShrink={0}
    direction="column"
    align="center"
    justify="center"
    gap={3}
    w="32px"
    h="270px"
    mx={2}
  >
    <Box flex={1} w="1px" bg="gray.200" />
    <Text
      fontSize="9px"
      fontWeight="bold"
      color="gray.400"
      textTransform="uppercase"
      letterSpacing="0.12em"
      whiteSpace="nowrap"
      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
    >
      {label}
    </Text>
    <Box flex={1} w="1px" bg="gray.200" />
  </Flex>
)

// ---------------------------------------------------------------------------
// HorizontalSponsorshipRow
// ---------------------------------------------------------------------------

interface HorizontalSponsorshipRowProps {
  sponsored: SponsoredBeneficiary[]
  beneficiaries: Beneficiaries[]
  selectedBeneficiaryId: string | null
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  onOpenModal: (beneficiary: Beneficiaries) => void
}

const SCROLL_THRESHOLD_PX = 400
const LOAD_THROTTLE_MS = 500

const HorizontalSponsorshipRow: React.FC<HorizontalSponsorshipRowProps> = ({
  sponsored,
  beneficiaries,
  selectedBeneficiaryId,
  hasMore,
  isLoading,
  onLoadMore,
  onOpenModal,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastLoadTimeRef = useRef(0)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const now = Date.now()
    const distanceFromRight = el.scrollWidth - el.scrollLeft - el.clientWidth
    if (
      distanceFromRight <= SCROLL_THRESHOLD_PX &&
      hasMore &&
      !isLoading &&
      now - lastLoadTimeRef.current > LOAD_THROTTLE_MS
    ) {
      lastLoadTimeRef.current = now
      onLoadMore()
    }
  }, [hasMore, isLoading, onLoadMore])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  return (
    <Box
      ref={scrollRef}
      mt={4}
      py={4}
      mx={{ base: -4, md: 0 }}
      overflowX="auto"
      overflowY="hidden"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      className="[&::-webkit-scrollbar]:hidden"
    >
      <Flex gap={4} align="flex-start" w="max-content" minH="270px" px={{ base: 4, md: 0 }}>
        {/* Stats card -- always first */}
        <StatsCard />

        {/* Children Sponsored */}
        {sponsored.length > 0 && (
          <>
            <SectionDivider label="Children Sponsored" />
            {sponsored.map((b) => (
              <PortraitBeneficiaryCard
                key={b.id}
                beneficiary={b}
                onOpenDialog={() => onOpenModal(b)}
                isSelected={selectedBeneficiaryId === b.id}
                imageOverlay={<SupportedRibbon />}
              />
            ))}
          </>
        )}

        {/* Children Waiting */}
        {beneficiaries.length > 0 && (
          <>
            <SectionDivider label="Children Waiting" />
            {beneficiaries.map((b) =>
              b.id ? (
                <PortraitBeneficiaryCard
                  key={b.id}
                  beneficiary={b}
                  onOpenDialog={() => onOpenModal(b)}
                  isSelected={selectedBeneficiaryId === b.id}
                  imageOverlay={<InNeedBadge />}
                />
              ) : null,
            )}
          </>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <Flex
            align="center"
            justify="center"
            w="80px"
            h="270px"
            flexShrink={0}
          >
            <Spinner size="lg" color="gray.300" />
          </Flex>
        )}

        {/* End-of-results cap */}
        {!isLoading && !hasMore && beneficiaries.length > 0 && (
          <Flex
            align="center"
            justify="center"
            w="100px"
            h="270px"
            flexShrink={0}
          >
            <Text
              fontSize="xs"
              color="gray.400"
              textAlign="center"
              lineHeight="short"
            >
              {"That's\neveryone"}
            </Text>
          </Flex>
        )}
      </Flex>
    </Box>
  )
}

export default HorizontalSponsorshipRow
