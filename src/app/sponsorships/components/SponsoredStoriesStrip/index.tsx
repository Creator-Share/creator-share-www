"use client"
import React, { useEffect, useState } from "react"
import Image from "next/image"
import { Box, Flex, Text } from "@chakra-ui/react"
import { fetchSponsoredWithRecentActivity, SponsoredWithActivity } from "@/actions"
import { Beneficiaries } from "@/types"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import { getImageSrc } from "@/utils/supabase/media"

/** Format a date as a human-readable relative string ("3 days ago", "just now"). */
function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

interface StoryCircleProps {
  beneficiary: SponsoredWithActivity
  onClick: (beneficiary: Beneficiaries) => void
}

const StoryCircle: React.FC<StoryCircleProps> = ({ beneficiary, onClick }) => {
  const [avatarSrc, setAvatarSrc] = useState<string>(PERSON_PLACEHOLDER_PATH)
  const firstName = beneficiary.name?.split(" ")[0] ?? "Child"

  useEffect(() => {
    const fetchAvatar = async () => {
      try {
        const res = await fetch(`/api/beneficiaries/images/${beneficiary.id}`)
        if (!res.ok) return
        const data = await res.json()
        const firstImage = data?.find(
          (m: { type: string }) => m.type === "IMAGE"
        )
        if (firstImage) {
          setAvatarSrc(getImageSrc(firstImage))
        }
      } catch {
        // fallback to placeholder
      }
    }
    fetchAvatar()
  }, [beneficiary.id])

  return (
    <Flex
      direction="column"
      align="center"
      gap={1.5}
      flexShrink={0}
      cursor="pointer"
      onClick={() => onClick(beneficiary)}
      role="button"
      aria-label={`View ${firstName}'s latest update`}
      className="group"
    >
      {/* Gradient ring -- brand blue to purple, matches Creator Share palette */}
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

      {/* Name */}
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

      {/* Relative timestamp */}
      <Text fontSize="10px" color="gray.400" textAlign="center" mt="-4px">
        {formatRelativeTime(beneficiary.last_activity_at)}
      </Text>
    </Flex>
  )
}

interface SponsoredStoriesStripProps {
  onOpenModal: (beneficiary: Beneficiaries) => void
}

const SponsoredStoriesStrip: React.FC<SponsoredStoriesStripProps> = ({
  onOpenModal,
}) => {
  const [sponsored, setSponsored] = useState<SponsoredWithActivity[]>([])

  useEffect(() => {
    fetchSponsoredWithRecentActivity().then(setSponsored)
  }, [])

  // Render nothing if there are no sponsored children with activity
  if (sponsored.length === 0) return null

  return (
    <Box
      className="bg-white border rounded-2xl"
      px={{ base: 4, lg: 8 }}
      py={5}
      mt={4}
    >
      <Text
        fontSize="sm"
        fontWeight="semibold"
        color="gray.500"
        mb={4}
        letterSpacing="wide"
        textTransform="uppercase"
      >
        Children with recent updates
      </Text>

      {/* Horizontal scroll container with hidden scrollbar */}
      <Flex
        gap={5}
        overflowX="auto"
        pb={2}
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
        className="[&::-webkit-scrollbar]:hidden"
      >
        {sponsored.map((b) => (
          <StoryCircle key={b.id} beneficiary={b} onClick={onOpenModal} />
        ))}
      </Flex>
    </Box>
  )
}

export default SponsoredStoriesStrip
