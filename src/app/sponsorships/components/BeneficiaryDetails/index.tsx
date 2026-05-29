"use client"
import { Box, Flex, Text, Image } from "@chakra-ui/react"
import { FaCalendar } from "react-icons/fa"
import { FaLocationDot } from "react-icons/fa6"
import { calculateAge } from "@/utils/ageCalculator"
import { formatDate } from "@/utils/dateFormatter"
import { Beneficiaries, BeneficiaryMedia } from "@/types"
import { useState, useEffect } from "react"
import { getImageSrc } from "@/utils/supabase/media"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"

interface BeneficiaryDetailsProps {
  beneficiary: Beneficiaries
}

const BeneficiaryDetailsCard: React.FC<BeneficiaryDetailsProps> = ({
  beneficiary,
}) => {
  const [images, setImages] = useState<BeneficiaryMedia[]>([])

  const placeholderImage = PERSON_PLACEHOLDER_PATH

  useEffect(() => {
    const fetchImages = async () => {
      try {
        const response = await fetch(
          `/api/beneficiaries/images/${beneficiary.id}`,
        )
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        if (!Array.isArray(data)) {
          console.error("Expected array of images but got:", data)
          return
        }
        if (data.length === 0) {
          return
        }
        setImages(
          data.sort(
            (a: BeneficiaryMedia, b: BeneficiaryMedia) =>
              (a.weight ?? 0) - (b.weight ?? 0),
          ),
        )
      } catch (error) {
        console.error("Error fetching images:", error)
      }
    }

    fetchImages()
  }, [beneficiary.id])

  const age = beneficiary.birth_date 
    ? calculateAge(new Date(beneficiary.birth_date).toISOString())
    : null
  const formattedBirthDate = beneficiary.birth_date
    ? formatDate(new Date(beneficiary.birth_date).toISOString())
    : null
  const birthDateIsEstimate = Boolean(
    (beneficiary.metadata as { birth_date_is_estimate?: boolean } | undefined)
      ?.birth_date_is_estimate
  )

  const getStatusText = (status: string) => {
    switch (status) {
      case "Budget Fulfilled":
        return (
          <Box>
            <Image
              src="/fulfilled.png"
              alt="Fulfilled"
              width={24}
              height={24}
            />
            <Text className="text-[#03150E] font-bold text-center">
              Sponsored
            </Text>
            <Text></Text>
          </Box>
        )
      case "Partially Funded":
        return (
          <Box gap={2}>
            <Image src="/pending.png" alt="Pending" width={24} height={24} />
            <Text className="text-[#767070] text-center">Pending</Text>
          </Box>
        )
      case "New":
        return <Text className="text-[#767070] text-center">Sponsor</Text>
      default:
        return (
          <Text className="text-[#767070] text-center">Nothing to show</Text>
        )
    }
  }

  return (
    <Flex
      maxW="1100px"
      mx="auto"
      mt={10}
      gap={8}
      direction={{ base: "column", md: "row" }}
    >
      <Box
        minW={{ base: "auto", md: "400px" }}
        maxW="400px"
        h="400px"
        borderRadius="xl"
        overflow="hidden"
        boxShadow="md"
        bg="gray.50"
        display="flex"
        alignItems="center"
        justifyContent="center"
        position="relative"
        p={0}
      >
        <Box position="relative" width="100%" height="100%">
          <ImageCarousel
            images={images}
            getImageSrc={getImageSrc}
            fallbackSrc={placeholderImage}
            alt={beneficiary.name}
            className="w-full h-full rounded-xl object-cover"
            showArrowsOnHover={true}
          />
        </Box>
      </Box>
      <Box flex="1" px={{ base: 0, md: 6 }} py={4}>
        <Text
          fontSize="4xl"
          fontWeight="bold"
          mb={2}
          className="text-[#03150E]"
        >
          {beneficiary.name}
        </Text>
        <Flex align="center" gap={3} mb={4}>
          {formattedBirthDate && (
            <>
              <FaCalendar />
              <Text fontSize="sm" color="gray.500">
                {formattedBirthDate}
                {age !== null &&
                  ` | ${age} years old${birthDateIsEstimate ? " (estimated)" : ""}`}
              </Text>
            </>
          )}
          <FaLocationDot />
          <Text fontSize="sm" color="gray.500">
            {beneficiary.country}
          </Text>
        </Flex>
        <Box bg="gray.50" borderRadius="md" p={4}>
          <Text
            fontSize="xl"
            fontWeight="bold"
            mb={2}
            className="text-[#03150E]"
          >
            Bio
          </Text>
          <Text color="gray.700" lineHeight="tall">
            {beneficiary.biography}
          </Text>
        </Box>
      </Box>
      <Box
        minW="200px"
        bg="white"
        borderRadius="xl"
        boxShadow="md"
        display="flex"
        alignItems="center"
        justifyContent="center"
        p={6}
      >
        {getStatusText(beneficiary.status)}
      </Box>
    </Flex>
  )
}

export default BeneficiaryDetailsCard
