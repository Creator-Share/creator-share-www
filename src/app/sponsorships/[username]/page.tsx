"use client"
import React, { useEffect, useState } from "react"
import { Box, Spinner, Flex, Text, Button } from "@chakra-ui/react"
import { useParams } from "next/navigation"
import { Beneficiaries } from "@/types"
import BeneficiaryModal from "../components/SponsorshipModal"

export default function FullProfileDynamic() {
  const { username } = useParams()
  const [beneficiary, setBeneficiary] = useState<Beneficiaries | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [beneficiaries, setBeneficiaries] = useState<Beneficiaries[]>([])
  const [currentBeneficiaryIndex, setCurrentBeneficiaryIndex] = useState(0)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError("")
      try {
        const res = await fetch(`/api/beneficiaries/get/username/${username}`)
        if (!res.ok) {
          throw new Error("Beneficiary not found")
        }
        const data = await res.json()
        const { child } = data
        if (!child) {
          throw new Error("Beneficiary data is empty")
        }
        setBeneficiary(child)
        if (child?.id) {
          const res = await fetch("/api/beneficiaries/get")
          const data = await res.json()
          if (data.people) {
            setBeneficiaries(data.people)
            const index = data.people.findIndex(
              (b: Beneficiaries) => b.username === username
            )
            if (index !== -1) {
              setCurrentBeneficiaryIndex(index)
            }
          }
        }
      } catch (err) {
        setError("Beneficiary not found.")
        setBeneficiary(null)
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    if (username) fetchData()
  }, [username])

  if (loading) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Spinner size="xl" color="blue.500" />
      </Flex>
    )
  }

  if (error || !beneficiary) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Text color="red.500" fontSize="xl">
          {error || "Beneficiary not found."}
        </Text>
      </Flex>
    )
  }

  // Just open the modal directly - the modal contains all the redesigned content
  return (
    <Box minH="100vh" p={6} pt={12}>
      <Box maxW="6xl" mx="auto">
        {/* Navigation */}
        <Flex justify="space-between" mb={8}>
          <Button
            onClick={() => {
              const newIndex = currentBeneficiaryIndex - 1
              if (newIndex >= 0 && beneficiaries[newIndex]?.username) {
                window.location.href = `/sponsorships/${beneficiaries[newIndex].username}`
              }
            }}
            disabled={currentBeneficiaryIndex === 0}
            variant="outline"
            className={`px-4 py-2 ${
              currentBeneficiaryIndex === 0
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            ← Previous Beneficiary
          </Button>
          <Button
            onClick={() => {
              const newIndex = currentBeneficiaryIndex + 1
              if (
                newIndex < beneficiaries.length &&
                beneficiaries[newIndex]?.username
              ) {
                window.location.href = `/sponsorships/${beneficiaries[newIndex].username}`
              }
            }}
            disabled={currentBeneficiaryIndex === beneficiaries.length - 1}
            variant="outline"
            className={`px-4 py-2 ${
              currentBeneficiaryIndex === beneficiaries.length - 1
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            Next Beneficiary →
          </Button>
        </Flex>

        {/* Header */}
        <Flex justify="space-between" align="center" mb={6}>
          <Heading
            as="h1"
            className="font-bold text-2xl md:text-[55px]"
            color="#2B7FF9"
          >
            {beneficiary.name}
          </Heading>
          <Button
            bg="#1C3C8C"
            color="white"
            px={6}
            py={2}
            _hover={{ bg: "#1C2B7A" }}
            onClick={() => setActivityOpen(true)}
            className="font-semibold text-[15px]"
          >
            Sponsor this child
          </Button>
          <BeneficiaryModal
            open={activityOpen}
            onClose={() => setActivityOpen(false)}
            beneficiary={beneficiary}
          />
        </Flex>
        <Box
          mb={8}
          rounded="xl"
          overflow="hidden"
          position="relative"
          h={{ base: "300px", md: "440px" }}
        >
          <Image
            src={
              images.length > 0
                ? images[0].id
                  ? generatePublicUrl(images[0] as unknown as MediaRow)
                  : images[0].image_url
                : placeholderImage
            }
            alt={beneficiary.name}
            position="absolute"
            w="100%"
            h="100%"
            objectFit="cover"
          />
        </Box>
        <Box mb={8}>
          <Heading as="h2" className="font-bold text-2xl" mb={4}>
            About Me
          </Heading>
          <Text className="text-[#767070] text-base">
            {beneficiary.biography || "No biography available."}
          </Text>
        </Box>
        <Heading
          as="h3"
          size="lg"
          color="#2B7FF9"
          mb={6}
          className="font-bold text-2xl"
        >
          Latest Updates on {beneficiary.name}
        </Heading>
        <Box className="md:grid md:grid-cols-5 gap-4">
          <Box mb={8} className="md:col-span-3">
            <VStack gap={6} align="stretch">
              {activities.length > 0 ? (
                activities.map((activity: Activity) => (
                  <Link
                    key={activity.id}
                    href={`/sponsorships/${username}/activity/${activity.id}`}
                    style={{ textDecoration: "none" }}
                  >
                    <Flex
                      bg="white"
                      rounded="xl"
                      overflow="hidden"
                      boxShadow="sm"
                      _hover={{ bg: "gray.50" }}
                    >
                      <Box flex="1" p={4}>
                        <Text color="gray.700" mb={2}>
                          {activity.description}
                        </Text>
                        <Text color="gray.500" fontSize="xs">
                          📅{" "}
                          {new Date(activity.created_at).toLocaleString(
                            "en-GB",
                            {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            },
                          )}
                        </Text>
                      </Box>
                    </Flex>
                  </Link>
                ))
              ) : (
                <Text color="gray.500" textAlign="center">
                  No activities available yet.
                </Text>
              )}
            </VStack>
          </Box>
          <Box className="md:col-span-2">
            <VStack align={"stretch"} gap={6}>
              <SponsorshipDetails beneficiaryId={beneficiary.id} hideStatus />
              <BeneficiarySubscribeBox beneficiary={beneficiary} />
            </VStack>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
