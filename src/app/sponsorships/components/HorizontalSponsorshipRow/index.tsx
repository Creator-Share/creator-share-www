"use client"
import React, { useEffect, useRef, useCallback, useState } from "react"
import { Box, Flex, Text } from "@chakra-ui/react"
import { Beneficiaries } from "@/types"
import { SponsoredBeneficiary } from "@/actions"
import PortraitBeneficiaryCard from "../SponsorshipCard/PortraitCard"
import SupportedRibbon from "@/components/common/SupportedRibbon"
import type { BeneficiaryTabType } from "@/config/beneficiaryTypes"
import { getApiTypes } from "@/config/beneficiaryTypes"

// ---------------------------------------------------------------------------
// StatsCard -- first item in the row; replaces the StatsSection above the fold
// ---------------------------------------------------------------------------

interface StatsData {
  childrenInNeed: number
  childrenSupported: number
}

interface StatsCardProps {
  activeType: BeneficiaryTabType | null | undefined
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally retained while StatsCard is hidden in the row; see the JSX comment below.
const StatsCard: React.FC<StatsCardProps> = ({ activeType }) => {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const typeParam = getApiTypes(activeType ?? null)
    const url = typeParam
      ? `/api/stats?beneficiary_type=${encodeURIComponent(typeParam)}`
      : "/api/stats"
    setLoading(true)
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStats(d)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activeType])

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
      <Flex direction="column" align="center" style={{ opacity: loading ? 0 : 1, transition: "opacity 0.3s ease" }}>
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
          Open
        </Text>
      </Flex>

      <Box w="40px" h="1px" bg="gray.200" style={{ opacity: loading ? 0 : 1, transition: "opacity 0.3s ease" }} />

      <Flex direction="column" align="center" style={{ opacity: loading ? 0 : 1, transition: "opacity 0.3s ease" }}>
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
      Open
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

function getSectionLabels(): { sponsored: string; waiting: string } {
  return { sponsored: "Updates", waiting: "Recent" }
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
  // activeType is accepted for API stability and used by the (currently
  // commented-out) StatsCard. Kept on the props type for callers.
}) => {
  const sectionLabels = getSectionLabels()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastLoadTimeRef = useRef(0)
  const [scrolledLeft, setScrolledLeft] = useState(false)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    setScrolledLeft(el.scrollLeft > 4)

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

  // Right-edge mask: static, fades content as it scrolls beneath the gradient zone.
  const rightEdgeMask = "linear-gradient(to right, black 0, black calc(100% - max(32px, calc((100vw - 1200px) / 2 + 32px))), transparent 100%)"

  return (
    <Box
      position="relative"
      mt={4}
      style={{
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
      }}
    >
      <Box
        ref={scrollRef}
        py={4}
        overflowX="auto"
        overflowY="hidden"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          maskImage: rightEdgeMask,
          WebkitMaskImage: rightEdgeMask,
        }}
        className="[&::-webkit-scrollbar]:hidden"
      >
        <Flex
          gap={4}
          align="flex-start"
          w="max-content"
          minH="202px"
          // On desktop: pull the row 64px (SectionDivider mx+width+flex-gap)
          // left of the content edge so the first sponsored card aligns
          // with the primary content region below, and the vertical
          // "Sponsored" bar floats into the left gutter.
          paddingLeft={{
            base: "16px",
            lg: "max(16px, calc((100vw - 1200px) / 2 - 28px))",
          }}
          paddingRight="16px"
        >
          {/*
            Stats card temporarily hidden -- may bring back later.
            <StatsCard activeType={activeType} />
          */}

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

          {/* Spacer while loading — preserves row width without a spinner */}
          {isLoading && (
            <Box w="80px" h="202px" flexShrink={0} />
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
      <Box
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        pointerEvents="none"
        zIndex={1}
        style={{
          width: "max(48px, calc((100vw - 1200px) / 2 + 48px))",
          background: "linear-gradient(to right, white, transparent)",
          opacity: scrolledLeft ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />
    </Box>
  )
}

export default HorizontalSponsorshipRow
