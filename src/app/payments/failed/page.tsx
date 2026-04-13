"use client"
import {
  Box,
  Text,
  Button,
  Link,
  Spinner,
  Center,
  VStack,
} from "@chakra-ui/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState, Suspense } from "react"
import NextLink from "next/link"

const FailedPageContent = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, setChildDetails] = useState({
    name: "this beneficiary",
    location: "",
  })
  const [isLoading, setIsLoading] = useState(true)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    const fetchSessionDetails = async () => {
      const sessionId = searchParams.get("session_id")
      if (!sessionId) {
        setIsLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/stripe/session?id=${sessionId}`)
        const data = await response.json()

        if (!response.ok) {
          if (data.code === "SESSION_NOT_FOUND" && retryCount < 2) {
            setTimeout(() => {
              setRetryCount((prev) => prev + 1)
            }, 1000)
            return
          }
          throw new Error(data.error || "Failed to fetch session")
        }

        const { session } = data
        setChildDetails({
          name: session.metadata?.childName || "this beneficiary",
          location: session.metadata?.childLocation || "",
        })

      } catch (error) {
        console.error("Error fetching session:", error)
        // Even if we can't get the session, we can still show the failed page
      } finally {
        setIsLoading(false)
      }
    }

    fetchSessionDetails()
  }, [searchParams, retryCount])

  if (isLoading) {
    return (
      <Center className="min-h-screen">
        <Box className="text-center">
          <Spinner size="xl" color="blue.500" mb={4} />
          <Text>Loading payment details...</Text>
        </Box>
      </Center>
    )
  }

  return (
    <Center className="bg-gray-50 items-center justify-center min-h-screen">
      <Box
        maxW="md"
        w="full"
        bg="white"
        p={8}
        borderRadius="2xl"
        boxShadow="md"
        className="text-center mx-4"
      >
        {/* Error Icon */}
        <Center mb={6}>
          <Box
            borderRadius="full"
            bg="#F7CACA"
            p={4}
            width="80px"
            height="80px"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Box as="span" color="#F30000" fontSize="3xl" fontWeight="bold">
              ✕
            </Box>
          </Box>
        </Center>

        {/* Heading */}
        <Text
          fontSize="2xl"
          fontWeight="bold"
          mb={4}
          color="#2b7ff9"
          className="text-center"
        >
          Sorry that didn't work out
        </Text>

        {/* Message */}
        <Text mb={6} color="gray.600" fontSize="sm" className="text-center">
          You can always{" "}
          <Link as={NextLink} href="/sponsorships" color="blue.500">
            click here
          </Link>{" "}
          to see other ways you can share with our children or work
        </Text>

        {/* Buttons */}
        <VStack gap={4} mb={6}>
          <Button
            onClick={() => router.back()}
            colorScheme="blue"
            size="md"
            width="full"
            borderRadius="md"
            bg="#2b7ff9"
            _hover={{ bg: "#34495e" }}
            color={"#FFFFFF"}
            fontWeight={"semibold"}
          >
            Retry Payment
          </Button>

          <Link
            as={NextLink}
            href="/sponsorships"
            fontSize="sm"
            fontWeight="medium"
          >
            &lt;&lt; Back to Beneficiaries listing
          </Link>
        </VStack>

        {/* Support Info */}
        <Text fontSize="sm" color="gray.600" className="text-center">
          If you're running into any issues or have questions,
          <br />
          we're here to help! Just reach out to us
          <br />
          at{" "}
          <Link href="mailto:support@sharetanzania.co.uk" color="blue.500">
            support@sharetanzania.co.uk
          </Link>{" "}
          or visit our{" "}
          <Link href="/help" color="blue.500">
            Help Center
          </Link>
          .
        </Text>
      </Box>
    </Center>
  )
}

const FailedPage = () => {
  return (
    <Suspense
      fallback={
        <Center className="min-h-screen">
          <Spinner size="xl" color="blue.500" />
        </Center>
      }
    >
      <FailedPageContent />
    </Suspense>
  )
}

export default FailedPage
