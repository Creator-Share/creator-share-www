"use client"
import React, { useEffect, useRef, useCallback, useState } from "react"
import { Box, Flex, Spinner, Text } from "@chakra-ui/react"
import { Beneficiaries } from "@/types"
import { SponsoredBeneficiary } from "@/actions"
import PortraitBeneficiaryCard from "../SponsorshipCard/PortraitCard"
import SupportedRibbon from "@/components/common/SupportedRibbon"
import type { BeneficiaryTabType } from "@/components/BeneficiaryTypeNav"

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
      w="135px"
      h="202px"
      flexShrink={0}
      borderRadius="16px"
      bg="white"
      borderWidth="1px"
      borderColor="gray.200"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap={4}
      px={6}
      style={{ boxShadow: "0 4px 24px -4px rgba(0,0,0,0.08), 0 2px 8px -2px rgba(0,0,0,0.04)" }}
    >
      {loading ? (
        <Spinner size="lg" color="gray.300" />
      ) : (
        <>
          <Flex direction="column" align="center">
            <Text
              fontSize="2xl"
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
              Waiting
            </Text>
          </Flex>

          <Box w="40px" h="1px" bg="gray.200" />

          <Flex direction="column" align="center">
            <Text
              fontSize="2xl"
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
              Sponsored
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
    h="202px"
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
  activeType?: BeneficiaryTabType | null
}

function getSectionLabels(activeType: BeneficiaryTabType | null | undefined): {
  sponsored: string
  waiting: string
} {
  if (activeType === "ANIMAL") {
    return { sponsored: "Dogs Sponsored", waiting: "Dogs Waiting" }
  }
  return { sponsored: "Sponsored", waiting: "Waiting" }
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
  activeType,
}) => {
  const sectionLabels = getSectionLabels(activeType)
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
      overflowX="auto"
      overflowY="hidden"
      style={{
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        // Gradient mask: transparent at both screen edges, opaque in the
        // primary-content zone.  Uses the same calc as the inner Flex's
        // paddingLeft so the opaque region aligns with the card grid below.
        maskImage: [
          "linear-gradient(to right,",
          "  transparent 0,",
          "  black max(48px, calc((100vw - 1200px) / 2 + 48px)),",
          "  black calc(100% - max(32px, calc((100vw - 1200px) / 2 + 32px))),",
          "  transparent 100%",
          ")",
        ].join(""),
        WebkitMaskImage: [
          "linear-gradient(to right,",
          "  transparent 0,",
          "  black max(48px, calc((100vw - 1200px) / 2 + 48px)),",
          "  black calc(100% - max(32px, calc((100vw - 1200px) / 2 + 32px))),",
          "  transparent 100%",
          ")",
        ].join(""),
      }}
      className="[&::-webkit-scrollbar]:hidden"
    >
      <Flex
        gap={4}
        align="flex-start"
        w="max-content"
        minH="202px"
        paddingLeft={{ base: "16px", lg: "max(36px, calc((100vw - 1200px) / 2 + 36px))" }}
        paddingRight="16px"
      >
        {/* Stats card -- always first */}
        <StatsCard />

        {/* Sponsored */}
        {sponsored.length > 0 && (
          <>
            <SectionDivider label={sectionLabels.sponsored} />
            {sponsored.map((b) => (
              <PortraitBeneficiaryCard
                key={b.id}
                beneficiary={b}
                onOpenDialog={() => onOpenModal(b)}
                isSelected={selectedBeneficiaryId === b.id}
                imageOverlay={<SupportedRibbon />}
                lastActivityAt={b.last_activity_at}
              />
            ))}
          </>
        )}

        {/* Waiting */}
        {beneficiaries.length > 0 && (
          <>
            <SectionDivider label={sectionLabels.waiting} />
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
          h="202px"
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
          h="202px"
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
