"use client"
import React, { useEffect, useRef, useCallback, useState } from "react"
import Image from "next/image"
import { Box, Flex, Spinner, Text } from "@chakra-ui/react"
import { Beneficiaries } from "@/types"
import { SponsoredWithActivity } from "@/actions"
import { getImageSrc } from "@/utils/supabase/media"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import PortraitBeneficiaryCard from "../SponsorshipCard/PortraitCard"

/** Relative time label used on story circles. */
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
// StoryCircle -- sponsored child with gradient ring and activity timestamp
// ---------------------------------------------------------------------------

interface StoryCircleProps {
  beneficiary: SponsoredWithActivity
  onOpenModal: (b: Beneficiaries) => void
}

const StoryCircle: React.FC<StoryCircleProps> = ({ beneficiary, onOpenModal }) => {
  const [avatarSrc, setAvatarSrc] = useState(PERSON_PLACEHOLDER_PATH)
  const firstName = beneficiary.name?.split(" ")[0] ?? "Child"

  useEffect(() => {
    fetch(`/api/beneficiaries/images/${beneficiary.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const first = data?.find((m: { type: string }) => m.type === "IMAGE")
        if (first) setAvatarSrc(getImageSrc(first))
      })
      .catch(() => {})
  }, [beneficiary.id])

  return (
    <Flex
      direction="column"
      align="center"
      gap={1.5}
      flexShrink={0}
      cursor="pointer"
      onClick={() => onOpenModal(beneficiary)}
      role="button"
      aria-label={`View ${firstName}'s latest update`}
      className="group"
      pt={1}
    >
      {/* Gradient ring */}
      <Box
        w="76px"
        h="76px"
        borderRadius="full"
        p="2.5px"
        style={{
          background: "linear-gradient(135deg, #0654C6 0%, #7C3AED 100%)",
        }}
        className="transition-transform duration-200 group-hover:scale-105"
      >
        <Box
          w="full"
          h="full"
          borderRadius="full"
          overflow="hidden"
          border="2.5px solid white"
          position="relative"
        >
          <Image
            src={avatarSrc}
            alt={firstName}
            fill
            sizes="72px"
            className="object-cover"
            unoptimized
          />
        </Box>
      </Box>

      <Text
        fontSize="xs"
        fontWeight="semibold"
        color="gray.800"
        textAlign="center"
        maxW="76px"
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
      >
        {firstName}
      </Text>

      <Text fontSize="10px" color="gray.400" textAlign="center" mt="-4px">
        {formatRelativeTime(beneficiary.last_activity_at)}
      </Text>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// HorizontalSponsorshipRow
// ---------------------------------------------------------------------------

interface HorizontalSponsorshipRowProps {
  sponsored: SponsoredWithActivity[]
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

  const isEmpty = sponsored.length === 0 && beneficiaries.length === 0

  if (isEmpty && !isLoading) return null

  return (
    <Box
      className="bg-white border rounded-2xl"
      mt={4}
      overflow="hidden"
    >
      {/* Scrollable row */}
      <Box
        ref={scrollRef}
        overflowX="auto"
        overflowY="hidden"
        px={{ base: 4, lg: 6 }}
        py={5}
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
        className="[&::-webkit-scrollbar]:hidden"
      >
        <Flex
          gap={4}
          align="flex-start"
          w="max-content"
          minH="420px"
        >
          {/* Story circles -- sponsored children with recent activity */}
          {sponsored.map((b) => (
            <StoryCircle key={b.id} beneficiary={b} onOpenModal={onOpenModal} />
          ))}

          {/* Portrait child cards -- available children */}
          {beneficiaries.map((b) =>
            b.id ? (
              <PortraitBeneficiaryCard
                key={b.id}
                beneficiary={b}
                onOpenDialog={() => onOpenModal(b)}
                isSelected={selectedBeneficiaryId === b.id}
              />
            ) : null
          )}

          {/* Loading indicator at the right edge */}
          {isLoading && (
            <Flex
              align="center"
              justify="center"
              w="80px"
              h="320px"
              flexShrink={0}
            >
              <Spinner size="lg" color="gray.300" />
            </Flex>
          )}

          {/* End-of-results ghost -- keeps the row from collapsing */}
          {!isLoading && !hasMore && beneficiaries.length > 0 && (
            <Flex
              align="center"
              justify="center"
              w="120px"
              h="320px"
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
    </Box>
  )
}

export default HorizontalSponsorshipRow
