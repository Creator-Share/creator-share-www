"use client"
import React, { useState, useEffect } from "react"
import Image from "next/image"
import { Box, Text } from "@chakra-ui/react"
import { Beneficiaries } from "@/types"
import { BeneficiaryMedia } from "@/types/admin.types"
import { getImageSrc } from "@/utils/supabase/media"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
// Rim glass shine: tight white highlight at the very top of the photo only.
const RIM_OVERLAY =
  "linear-gradient(to bottom, rgba(255,255,255,0.62) 0px, rgba(255,255,255,0.28) 2px, rgba(255,255,255,0.06) 14px, transparent 32px)"
const CARD_SHADOW = "0 2px 8px rgba(0,0,0,0.07), 0 6px 24px rgba(0,0,0,0.05)"
const CARD_SHADOW_SELECTED = "0 0 0 2px rgba(43,127,249,0.18), 0 2px 8px rgba(0,0,0,0.07), 0 6px 24px rgba(0,0,0,0.05)"

interface PortraitBeneficiaryCardProps {
  beneficiary: Beneficiaries
  onOpenDialog: () => void
  isSelected?: boolean
  /** Optional node rendered as an absolute overlay on top of the card image. */
  imageOverlay?: React.ReactNode
  /**
   * ISO timestamp of the most recent public activity update.
   * When present, row 2 shows a relative date ("3 days ago").
   * When absent, row 2 shows how long the child has been waiting.
   */
  lastActivityAt?: string | null
}

/** "3 days ago", "2w ago", "1mo ago", etc. */
function formatRelativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return "updated today"
  if (days === 1) return "updated yesterday"
  if (days < 7) return `updated ${days}d ago`
  if (days < 30) return `updated ${Math.floor(days / 7)}w ago`
  if (days < 365) return `updated ${Math.floor(days / 30)}mo ago`
  return `updated ${Math.floor(days / 365)}y ago`
}

/** "waiting 3 days", "waiting 2w", etc. */
function formatWaiting(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return "added today"
  if (days === 1) return "waiting 1 day"
  if (days < 14) return `waiting ${days} days`
  if (days < 30) return `waiting ${Math.floor(days / 7)}w`
  if (days < 365) return `waiting ${Math.floor(days / 30)}mo`
  return `waiting ${Math.floor(days / 365)}y`
}

const PortraitBeneficiaryCard: React.FC<PortraitBeneficiaryCardProps> = ({
  beneficiary,
  onOpenDialog,
  isSelected = false,
  imageOverlay,
  lastActivityAt,
}) => {
  const [imageSrc, setImageSrc] = useState<string>(PERSON_PLACEHOLDER_PATH)

  useEffect(() => {
    const fetchImage = async () => {
      try {
        const res = await fetch(`/api/beneficiaries/images/${beneficiary.id}`)
        if (!res.ok) return
        const data: BeneficiaryMedia[] = await res.json()
        const first = data
          ?.filter((m) => m.type === "IMAGE")
          ?.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0))[0]
        if (first) setImageSrc(getImageSrc(first))
      } catch {
        // fallback to placeholder
      }
    }
    fetchImage()
  }, [beneficiary.id])

  const firstName = beneficiary.name?.split(" ")[0] ?? "Child"
  const lastInitial = beneficiary.name?.split(" ")[1]?.[0]
  const displayName = lastInitial ? `${firstName} ${lastInitial}.` : firstName

  const subline = lastActivityAt
    ? formatRelativeDate(lastActivityAt)
    : beneficiary.created_at
      ? formatWaiting(beneficiary.created_at)
      : null

  return (
    <Box
      w="135px"
      h="202px"
      flexShrink={0}
      borderRadius="16px"
      cursor="pointer"
      onClick={onOpenDialog}
      display="flex"
      flexDirection="column"
      className="transition-all duration-300 hover:scale-[1.01]"
      transform="translateZ(0)"
      style={{
        overflow: "hidden",
        background: "#fff",
        boxShadow: isSelected ? CARD_SHADOW_SELECTED : CARD_SHADOW,
      }}
    >
      {/* Portrait image -- 2:3 card, cropped from the top to frame faces */}
      <Box position="relative" w="135px" h="158px" flexShrink={0} overflow="hidden">
        <Image
          src={imageSrc}
          alt={displayName}
          fill
          sizes="135px"
          className="object-cover object-top"
          unoptimized
        />
        {/* Glass shine overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            pointerEvents: "none",
            background: RIM_OVERLAY,
          }}
        />
        {imageOverlay}
      </Box>

      {/* Info below image — two rows only */}
      <Box pl={3} pr={2} pt={1.5} pb={2} flex={1} display="flex" flexDirection="column" justifyContent="flex-start">
        <Text
          fontWeight="semibold"
          fontSize="xs"
          color="gray.900"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          lineHeight="1.3"
        >
          {displayName}
        </Text>
        {subline && (
          <Text fontSize="10px" color="gray.400" lineHeight="1.3" mt="2px" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
            {subline}
          </Text>
        )}
      </Box>
    </Box>
  )
}

export default PortraitBeneficiaryCard
