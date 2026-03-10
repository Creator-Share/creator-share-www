"use client"
import React, { useState, useEffect } from "react"
import Image from "next/image"
import { Box, Text, Flex } from "@chakra-ui/react"
import { FaCalendar, FaLocationDot } from "react-icons/fa6"
import { FaPerson } from "react-icons/fa6"
import { Beneficiaries } from "@/types"
import { BeneficiaryMedia } from "@/types/admin.types"
import { getImageSrc } from "@/utils/supabase/media"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import { calculateAge } from "@/utils/ageCalculator"

interface PortraitBeneficiaryCardProps {
  beneficiary: Beneficiaries
  onOpenDialog: () => void
  isSelected?: boolean
  /** Optional node rendered as an absolute overlay on top of the card image. */
  imageOverlay?: React.ReactNode
}

const PortraitBeneficiaryCard: React.FC<PortraitBeneficiaryCardProps> = ({
  beneficiary,
  onOpenDialog,
  isSelected = false,
  imageOverlay,
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

  const age = beneficiary.birth_date
    ? calculateAge(new Date(beneficiary.birth_date).toISOString())
    : null

  const firstName = beneficiary.name?.split(" ")[0] ?? "Child"
  const lastInitial = beneficiary.name?.split(" ")[1]?.[0]
  const displayName = lastInitial ? `${firstName} ${lastInitial}.` : firstName

  return (
    <Box
      w="240px"
      h="270px"
      flexShrink={0}
      borderRadius="20px"
      overflow="hidden"
      bg="white"
      borderWidth={isSelected ? "4px" : "1px"}
      borderColor={isSelected ? "blue.500" : "gray.200"}
      cursor="pointer"
      onClick={onOpenDialog}
      display="flex"
      flexDirection="column"
      className="transition-all duration-300 hover:scale-[1.02]"
      transform="translateZ(0)"
    >
      {/* Portrait image -- 210px tall, cropped from the top to frame faces */}
      <Box position="relative" w="240px" h="210px" flexShrink={0}>
        <Image
          src={imageSrc}
          alt={displayName}
          fill
          sizes="240px"
          className="object-cover object-top"
          unoptimized
        />
        {imageOverlay}
      </Box>

      {/* Info below image -- fills remaining height */}
      <Box px={3} py={3} flex={1}>
        <Text fontWeight="bold" fontSize="sm" color="gray.900" mb={1} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
          {displayName}
        </Text>
        <Flex gap={2} flexWrap="wrap" color="gray.500">
          {age !== null && (
            <Flex align="center" gap={1}>
              <FaCalendar size={10} />
              <Text fontSize="11px">{age}y</Text>
            </Flex>
          )}
          <Flex align="center" gap={1}>
            <FaPerson size={10} />
            <Text fontSize="11px">{beneficiary.gender || "—"}</Text>
          </Flex>
          <Flex align="center" gap={1}>
            <FaLocationDot size={10} />
            <Text fontSize="11px">{beneficiary.country || "—"}</Text>
          </Flex>
        </Flex>
      </Box>
    </Box>
  )
}

export default PortraitBeneficiaryCard
