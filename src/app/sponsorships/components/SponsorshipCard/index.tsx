"use client"
import React, { useState, useEffect } from "react"
import { Box, Text, Flex, Badge } from "@chakra-ui/react"
import { FaCalendar } from "react-icons/fa"
import { FaLocationDot, FaPerson } from "react-icons/fa6"
import { calculateAge } from "@/utils/ageCalculator"
import { BeneficiaryCardProps } from "@/types/propTypes"
import { BeneficiaryMedia } from "@/types/admin.types"
import { centsToDollars } from "@/utils/currency"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import ViewerIndicator from "@/components/presence/ViewerIndicator"

const BeneficiaryCard: React.FC<BeneficiaryCardProps> = ({
  beneficiary,
  isSelected,
  id,
  onOpenDialog,
  beneficiaryType = "CHILD",
}) => {
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  // Note: Presence tracking removed from card list view
  // Only track presence when viewing the actual profile (modal or detail page)

  const placeholderImage =
    "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="

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

  // Primary content - only calculate age if birth_date exists
  const age = beneficiary.birth_date 
    ? calculateAge(new Date(beneficiary.birth_date).toISOString())
    : null
  
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
      <Box position="relative" flexShrink={0} className="group">
        <ImageCarousel
          images={images}
          getImageSrc={getImageSrc}
          fallbackSrc={placeholderImage}
          alt={beneficiary.name?.split(" ")[0] ?? ""}
          className="w-full h-[300px] rounded-t-[20px] object-cover"
          showArrowsOnHover={true}
        />

        {/* Viewer Indicator */}
        <Box position="absolute" top="12px" left="12px" zIndex={10}>
          <ViewerIndicator
            profileId={beneficiary.id}
            variant="badge"
            showWhenZero={false}
          />
        </Box>

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
        p={6}
        flex="1"
        display="flex"
        flexDirection="column"
        className="items-center text-center justify-center"
      >
        {/* Full Name Heading */}
        <Text fontSize="xl" fontWeight="bold" mb={3} className="text-gray-800">
          {beneficiary.name ? 
            `${beneficiary.name.split(" ")[0]} ${beneficiary.name.split(" ")[2]?.[0] || ""}`.trim()
            : "Name"
          }
        </Text>

        {/* Information Row */}
        <Flex gap={4} mb={4} flexWrap="wrap" className="text-[#666666]">
          {age !== null && (
            <Flex align="center" gap={1}>
              <FaCalendar />
              <Text fontSize="sm">{age} years</Text>
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

        {/* Info Section */}
        <Box mb={4} flex="1">
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
            }}
          >
            {beneficiary?.biography}
          </Text>
        </Box>
      </Box>

    </Box>
  )
}

export default BeneficiaryCard
