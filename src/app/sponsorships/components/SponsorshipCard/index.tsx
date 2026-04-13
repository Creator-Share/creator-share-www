"use client"
import React, { useState, useEffect } from "react"
import { Box, Text, Flex, Badge } from "@chakra-ui/react"
import { FaCalendar } from "react-icons/fa"
import { FaLocationDot, FaPerson } from "react-icons/fa6"
import { calculateAge } from "@/utils/ageCalculator"
import { BeneficiaryCardProps } from "@/types/propTypes"
import { BeneficiaryMedia } from "@/types/admin.types"
import { centsToDollars } from "@/utils/currency"
import { getImageSrc, getThumbnailSrc } from "@/utils/supabase/media"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import SupportedRibbon from "@/components/common/SupportedRibbon"
import { RIM_OVERLAY, CARD_SHADOW, CARD_SHADOW_SELECTED } from "./cardStyles"

const BeneficiaryCard: React.FC<BeneficiaryCardProps> = ({
  beneficiary,
  isSelected,
  id,
  onOpenDialog,
  beneficiaryType = "CHILD",
}) => {
  const [images, setImages] = useState<BeneficiaryMedia[]>([])

  const placeholderImage = PERSON_PLACEHOLDER_PATH

  useEffect(() => {
    const fetchImages = async () => {
      try {
        const response = await fetch(
          `/api/beneficiaries/images/${beneficiary.id}`,
        )
        if (response.ok) {
          const data = await response.json()
          // Filter for only IMAGE type media
          const imageMedia = data.filter((item: BeneficiaryMedia) => 
            item.type === "IMAGE"
          )
          setImages(
            imageMedia.sort(
              (a: BeneficiaryMedia, b: BeneficiaryMedia) =>
                (a.weight || 0) - (b.weight || 0),
            ),
          )
        }
      } catch (error) {
        console.error("Error fetching images:", error)
      }
    }

    fetchImages()
  }, [beneficiary.id, beneficiaryType])

  // Primary content - only calculate age if birth_date exists
  const age = beneficiary.birth_date 
    ? calculateAge(new Date(beneficiary.birth_date).toISOString())
    : null
  const birthDateIsEstimate = Boolean(
    (beneficiary.metadata as { birth_date_is_estimate?: boolean } | undefined)
      ?.birth_date_is_estimate
  )
  
  return (
    <Box
      id={id}
      className={`rounded-[20px] ${
        isSelected ? "highlight-child" : ""
      } hover:scale-[1.025] transition-all duration-300`}
      suppressHydrationWarning={true}
      style={{
        overflow: "hidden",
        background: "#fff",
        boxShadow: isSelected ? CARD_SHADOW_SELECTED : CARD_SHADOW,
      }}
      maxW="100%"
      mx="auto"
      height="100%"
      display="flex"
      flexDirection="column"
      transform="translateZ(0)"
      cursor="pointer"
      onClick={onOpenDialog}
      position="relative"
      tabIndex={-1}
      data-card-no-focus
      _focus={{ outline: "none", boxShadow: "none" }}
      _focusVisible={{ outline: "none", boxShadow: "none" }}
    >
      {/* Card Header: Image with Navigation using ImageCarousel */}
      <Box 
        position="relative" 
        flexShrink={0} 
        className="group" 
        height="225px" 
        minHeight="225px"
        maxHeight="225px"
        width="100%" 
        overflow="hidden"
      >
        <ImageCarousel
          images={images}
          getImageSrc={getImageSrc}
          getThumbnailSrc={getThumbnailSrc}
          fallbackSrc={placeholderImage}
          alt={beneficiary.name?.split(" ")[0] ?? ""}
          className="w-full h-full rounded-t-[20px]"
          showArrowsOnHover={true}
        />

        {/* Glass shine overlay — sits above the photo, below interactive chrome */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            pointerEvents: "none",
            background: RIM_OVERLAY,
          }}
        />

        {beneficiary.status === "Budget Fulfilled" && <SupportedRibbon />}

        {/* Goal Badge */}
        {!process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL && (
          <Box position="absolute" top="0" right="0" zIndex={10}>
            <Badge
              bg="#CDE1FE"
              color="#011532"
              borderRadius="0"
              borderTopRightRadius="20px"
              borderBottomLeftRadius="20px"
              className="p-[10px] text-sm font-medium"
            >
              Goal{" "}
              <span className="text-xl font-semibold">
                ${centsToDollars(beneficiary.budget_goal)}
              </span>
            </Badge>
          </Box>
        )}
      </Box>

      {/* Card Content */}
      <Box
        px={4}
        pt={3}
        pb={4}
        display="flex"
        flexDirection="column"
        className="items-center text-center"
      >
        {/* Name */}
        <Box mb={1.5} display="flex" alignItems="center" justifyContent="center">
          <Text fontSize="lg" fontWeight="bold" className="text-gray-800" lineHeight="1.2">
            {beneficiary.name ? 
              `${beneficiary.name.split(" ")[0]} ${beneficiary.name.split(" ")[2]?.[0] || ""}`.trim()
              : "Name"
            }
          </Text>
        </Box>

        {/* Info row */}
        <Box mb={2.5} display="flex" alignItems="center" justifyContent="center">
          <Flex gap={3} flexWrap="wrap" className="text-[#666666]" justifyContent="center">
            {age !== null && (
              <Flex align="center" gap={1}>
                <FaCalendar size={12} />
                <Text fontSize="xs">
                  {age} years{birthDateIsEstimate ? " (est.)" : ""}
                </Text>
              </Flex>
            )}
            <Flex align="center" gap={1}>
              <FaPerson size={12} />
              <Text fontSize="xs">{beneficiary.gender || "Gender"}</Text>
            </Flex>
            <Flex align="center" gap={1}>
              <FaLocationDot size={12} />
              <Text fontSize="xs">{beneficiary.country || "Location"}</Text>
            </Flex>
          </Flex>
        </Box>

        {/* Biography — hard-clamp to 3 lines, no forced min-height */}
        <Box width="100%">
          <Text
            fontSize="sm"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: "1.5",
              color: "#666666",
            }}
          >
            {beneficiary?.biography || ""}
          </Text>
        </Box>
      </Box>

    </Box>
  )
}

export default BeneficiaryCard
