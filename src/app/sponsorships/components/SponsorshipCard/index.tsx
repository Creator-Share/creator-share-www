"use client"
import React, { useState, useEffect } from "react"
import { Box, Text, Flex, Badge } from "@chakra-ui/react"
import { FaCalendar } from "react-icons/fa"
import { FaLocationDot, FaPerson } from "react-icons/fa6"
import { calculateAge } from "@/utils/ageCalculator"
import { BeneficiaryCardProps } from "@/types/propTypes"
import { BeneficiaryMedia } from "@/types/admin.types"
import { centsToDollars } from "@/utils/currency"
import { generatePublicUrl, generateThumbnailUrl, MediaRow } from "@/utils/supabase/media"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"

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
          `/api/admin/beneficiaries/images/${beneficiary.id}`,
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
                a.order_index - b.order_index,
            ),
          )
        }
      } catch (error) {
        console.error("Error fetching images:", error)
      }
    }

    fetchImages()
  }, [beneficiary.id, beneficiaryType])

  // Helper function for ImageCarousel
  const getImageSrc = (image: { id?: string; image_url?: string }) => {
    if (image.id) {
      try {
        return generatePublicUrl(image as unknown as MediaRow)
      } catch {
        return image.image_url || ""
      }
    }
    return image.image_url || ""
  }

  // Helper function for generating thumbnail URLs for progressive loading
  // Returns undefined if thumbnail generation fails, which will skip progressive loading
  const getThumbnailSrc = (image: { id?: string; image_url?: string }) => {
    if (image.id) {
      try {
        return generateThumbnailUrl(image as unknown as MediaRow)
      } catch {
        // Silently fail and skip thumbnail - component will use full image
        return undefined
      }
    }
    return undefined
  }

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
      borderColor={isSelected ? "blue.500" : "gray.200"}
      borderWidth={isSelected ? "4px" : "1px"}
      className={`bg-white mb-6 rounded-[20px] shadow-md ${
        isSelected ? "highlight-child" : ""
      } hover:shadow-xl hover:shadow-black/20 hover:scale-105 transition-all duration-300`}
      suppressHydrationWarning={true}
      style={{ overflow: "hidden" }}
      maxW="sm"
      mx="auto"
      height="100%"
      display="flex"
      flexDirection="column"
      transform="translateZ(0)"
      cursor="pointer"
      transition="border-color 200ms ease, border-width 200ms ease, box-shadow 200ms ease, transform 200ms ease"
      _hover={{ borderColor: "#2B7FF9", borderWidth: "1px" }}
      onClick={onOpenDialog}
      position="relative"
    >
      {/* Card Header: Image with Navigation using ImageCarousel */}
      <Box 
        position="relative" 
        flexShrink={0} 
        className="group" 
        height="300px" 
        minHeight="300px"
        maxHeight="300px"
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

      {/* Card Content - Fixed Layout Structure */}
      <Box
        p={6}
        display="flex"
        flexDirection="column"
        className="items-center text-center"
        minHeight="200px"
      >
        {/* Full Name Heading - Fixed height to prevent layout shift */}
        <Box minHeight="32px" mb={3} display="flex" alignItems="center" justifyContent="center">
          <Text fontSize="xl" fontWeight="bold" className="text-gray-800" lineHeight="1.2">
            {beneficiary.name ? 
              `${beneficiary.name.split(" ")[0]} ${beneficiary.name.split(" ")[2]?.[0] || ""}`.trim()
              : "Name"
            }
          </Text>
        </Box>

        {/* Information Row - Fixed minimum height */}
        <Box minHeight="48px" mb={4} display="flex" alignItems="center" justifyContent="center">
          <Flex gap={4} flexWrap="wrap" className="text-[#666666]" justifyContent="center">
            {age !== null && (
              <Flex align="center" gap={1}>
                <FaCalendar />
                <Text fontSize="sm">
                  {age} years{birthDateIsEstimate ? " (estimated)" : ""}
                </Text>
              </Flex>
            )}
            <Flex align="center" gap={1}>
              <FaPerson />
              <Text fontSize="sm">{beneficiary.gender || "Gender"}</Text>
            </Flex>
            <Flex align="center" gap={1}>
              <FaLocationDot />
              <Text fontSize="sm">{beneficiary.country || "Location"}</Text>
            </Flex>
          </Flex>
        </Box>

        {/* Biography Section - Fixed minimum height to maintain consistency */}
        <Box minHeight="84px" width="100%">
          <Text
            fontSize="sm"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: "1.4",
              color: "#666666",
              minHeight: "84px", // 3 lines × 1.4 line-height × 20px (approx)
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
