"use client"
import React, { useState, useEffect } from "react"
import { Box, Text, Flex } from "@chakra-ui/react"
import { FaCalendar } from "react-icons/fa"
import { FaLocationDot, FaPerson } from "react-icons/fa6"
import { calculateAge } from "@/utils/ageCalculator"
import { BeneficiaryCardProps } from "@/types/propTypes"
import { BeneficiaryMedia } from "@/types/admin.types"
import { getImageSrc, getThumbnailSrc } from "@/utils/supabase/media"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import SupportedRibbon from "@/components/common/SupportedRibbon"
import { isOpenSponsorshipType } from "@/config/beneficiaryTypes"
import { RIM_OVERLAY, CARD_SHADOW, CARD_SHADOW_SELECTED } from "./cardStyles"

const BeneficiaryCard: React.FC<BeneficiaryCardProps> = ({
  beneficiary,
  isSelected,
  id,
  onOpenDialog,
  beneficiaryType = "CHILD",
}) => {
  const [images, setImages] = useState<BeneficiaryMedia[]>([])

  const isOpen = isOpenSponsorshipType(beneficiary.beneficiary_type)
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
          const imageMedia = data.filter(
            (item: BeneficiaryMedia) => item.type === "IMAGE",
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
      ?.birth_date_is_estimate,
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
        height={{ base: "225px", md: "270px", xl: "300px" }}
        minHeight={{ base: "225px", md: "270px", xl: "300px" }}
        maxHeight={{ base: "225px", md: "270px", xl: "300px" }}
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

        {!isOpen && beneficiary.status === "Budget Fulfilled" && <SupportedRibbon />}

        {/* Goal Badge — only show for fixed sponsorship types with a real goal */}
        {/* {beneficiary.budget_goal > 0 && (
          <Box position="absolute" top="0" right="0" zIndex={10}>
            <Badge
              bg="#CDE1FE"
              color="#011532"
              borderRadius="0"
              borderTopRightRadius="20px"
              borderBottomLeftRadius="20px"
              className="p-[10px] text-sm font-medium"
            >
              <span className="text-xl font-semibold">
                ${centsToDollars(beneficiary.budget_goal)}
              </span>
              /mo
            </Badge>
          </Box>
        )} */}
      </Box>

      {/* Card Content */}
      <Box
        px={{ base: 2.5, md: 4 }}
        pt={{ base: 2, md: 3 }}
        pb={{ base: 2.5, md: 4 }}
        display="flex"
        flexDirection="column"
        className="items-center text-center"
      >
        {/* Name */}
        <Box
          mb={{ base: 1, md: 1.5 }}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Text
            fontSize={{ base: "md", md: "lg" }}
            fontWeight="bold"
            className="text-gray-800"
            lineHeight="1.2"
          >
            {beneficiary.name
              ? `${beneficiary.name.split(" ")[0]} ${beneficiary.name.split(" ")[2]?.[0] || ""}`.trim()
              : "Name"}
          </Text>
        </Box>

        {/* Info row — capped at 2 lines on mobile */}
        <Box
          mb={{ base: 0.25, md: 2.5 }}
          display="flex"
          alignItems="center"
          justifyContent="center"
          overflow="hidden"
          maxHeight={{ base: "2.6em", md: "none" }}
        >
          <Flex
            columnGap={{ base: 1.5, md: 3 }}
            rowGap={{ base: 0, md: 2 }}
            flexWrap="wrap"
            className="text-[#666666]"
            justifyContent="center"
          >
            {age !== null && (
              <Flex align="center" gap={1}>
                <FaCalendar size={11} />
                <Text fontSize="xs">
                  {age} years{birthDateIsEstimate ? " (est.)" : ""}
                </Text>
              </Flex>
            )}
            <Flex align="center" gap={1}>
              <FaPerson size={11} />
              <Text fontSize="xs">{beneficiary.gender || "Gender"}</Text>
            </Flex>
            <Flex align="center" gap={1}>
              <FaLocationDot size={11} />
              <Text fontSize="xs">{beneficiary.country || "Location"}</Text>
            </Flex>
          </Flex>
        </Box>

        {/* Biography — hard-clamp to 3 lines, no forced min-height */}
        <Box width="100%" pt={{ base: 1, md: 0 }}>
          <Text
            fontSize="xs"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: "1.4",
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
