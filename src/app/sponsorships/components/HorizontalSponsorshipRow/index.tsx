"use client"
import React, { useEffect, useRef, useCallback, useState } from "react"
import { Box, Flex, Spinner, Text } from "@chakra-ui/react"
import { Beneficiaries } from "@/types"
import { SponsoredBeneficiary } from "@/actions"
import PortraitBeneficiaryCard from "../SponsorshipCard/PortraitCard"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

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
      .then((d) => { if (d) setStats(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <Box
      w="240px"
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
          <Flex align="center" gap={3}>
            <Text fontSize="2xl" lineHeight={1} flexShrink={0}>💛</Text>
            <Flex direction="column">
              <Text fontSize="4xl" fontWeight="bold" color="gray.800" lineHeight={1}>
                {stats?.childrenInNeed.toLocaleString() ?? "—"}
              </Text>
              <Text fontSize="xs" color="gray.500" fontWeight="medium" mt={1}>
                Children In Need
              </Text>
            </Flex>
          </Flex>

          <Box w="40px" h="1px" bg="gray.200" />

          <Flex align="center" gap={3}>
            <Text fontSize="2xl" lineHeight={1} flexShrink={0}>💚</Text>
            <Flex direction="column">
              <Text fontSize="4xl" fontWeight="bold" color="gray.800" lineHeight={1}>
                {stats?.childrenSupported.toLocaleString() ?? "—"}
              </Text>
              <Text fontSize="xs" color="gray.500" fontWeight="medium" mt={1}>
                Children Supported
              </Text>
            </Flex>
          </Flex>
        </>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Image overlays for portrait cards
// ---------------------------------------------------------------------------

const SupportedBadge: React.FC = () => (
  <Flex
    position="absolute"
    bottom={2}
    left={2}
    align="center"
    bg="green.500"
    borderRadius="full"
    px="7px"
    py="3px"
    zIndex={1}
    pointerEvents="none"
  >
    <Text fontSize="10px" fontWeight="bold" color="white" lineHeight={1}>
      Supported
    </Text>
  </Flex>
)

const UpdatedIndicator: React.FC<{ relativeTime: string }> = ({ relativeTime }) => (
  <Box
    position="absolute"
    top={2}
    right={2}
    w="10px"
    h="10px"
    borderRadius="full"
    bg="blue.500"
    border="2px solid white"
    zIndex={1}
    title={`Updated ${relativeTime}`}
    className="animate-pulse"
    pointerEvents="none"
  />
)

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
      In Need
    </Text>
  </Flex>
)

// ---------------------------------------------------------------------------
// Section divider between the two groups
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
      overflowX="auto"
      overflowY="hidden"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      className="[&::-webkit-scrollbar]:hidden"
    >
      <Flex gap={4} align="flex-start" w="max-content" minH="270px">
        {/* Stats card -- always first */}
        <StatsCard />

        {/* Children Supported -- portrait cards with Supported badge */}
        {sponsored.length > 0 && (
          <>
            <SectionDivider label="Children Supported" />
            {sponsored.map((b) => (
              <PortraitBeneficiaryCard
                key={b.id}
                beneficiary={b}
                onOpenDialog={() => onOpenModal(b)}
                isSelected={selectedBeneficiaryId === b.id}
                imageOverlay={
                  <>
                    <SupportedBadge />
                    {b.last_activity_at && (
                      <UpdatedIndicator relativeTime={formatRelativeTime(b.last_activity_at)} />
                    )}
                  </>
                }
              />
            ))}
          </>
        )}

        {/* Children In Need -- portrait cards with In Need badge */}
        {beneficiaries.length > 0 && (
          <>
            <SectionDivider label="Children In Need" />
            {beneficiaries.map((b) =>
              b.id ? (
                <PortraitBeneficiaryCard
                  key={b.id}
                  beneficiary={b}
                  onOpenDialog={() => onOpenModal(b)}
                  isSelected={selectedBeneficiaryId === b.id}
                  imageOverlay={<InNeedBadge />}
                />
              ) : null
            )}
          </>
        )}

        {/* Loading indicator at the right edge */}
        {isLoading && (
          <Flex align="center" justify="center" w="80px" h="270px" flexShrink={0}>
            <Spinner size="lg" color="gray.300" />
          </Flex>
        )}

        {/* End-of-results cap */}
        {!isLoading && !hasMore && beneficiaries.length > 0 && (
          <Flex align="center" justify="center" w="100px" h="270px" flexShrink={0}>
            <Text fontSize="xs" color="gray.400" textAlign="center" lineHeight="short">
              {"That's\neveryone"}
            </Text>
          </Flex>
        )}
      </Flex>
    </Box>
  )
}

export default HorizontalSponsorshipRow
