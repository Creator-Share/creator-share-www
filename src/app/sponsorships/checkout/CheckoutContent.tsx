"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Box, Text, Button, Spinner, Center } from "@chakra-ui/react"
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js"
import { loadStripe } from "@stripe/stripe-js"

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string,
)

export default function CheckoutContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [ ,setBeneficiaryId] = useState<string | null>(null)

  useEffect(() => {
    const secret = searchParams.get("client_secret")
    const bId = searchParams.get("beneficiary_id")
    if (secret) {
      setClientSecret(secret)
      setBeneficiaryId(bId)
      setLoading(false)
    } else {
      setError("No client secret provided")
      setLoading(false)
    }
  }, [searchParams])

  const handleReturn = () => {
    router.push("/sponsorships")
  }

  if (loading) {
    return (
      <Center className="min-h-screen">
        <Box className="text-center">
          <Spinner size="xl" color="blue.500" mb={4} />
          <Text>Loading checkout...</Text>
        </Box>
      </Center>
    )
  }

  if (error) {
    return (
      <Box className="p-8 text-center">
        <Text className="text-xl mb-4 text-red-600">{error}</Text>
        <Text className="mb-4">
          There was a problem loading the checkout page. Please try again.
        </Text>
        <Button onClick={handleReturn} className="mt-4 bg-blue-700 text-white">
          Return to Sponsorship Page
        </Button>
      </Box>
    )
  }

  if (!clientSecret) {
    return (
      <Box className="p-8 text-center">
        <Text className="text-xl mb-4 text-red-600">
          Missing checkout information
        </Text>
        <Text className="mb-4">
          The checkout session could not be initialized. Please try again.
        </Text>
        <Button onClick={handleReturn} className="mt-4 bg-blue-700 text-white">
          Return to Sponsorship Page
        </Button>
      </Box>
    )
  }
  return (
    <Box className="w-full min-h-screen p-4">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </Box>
  )
}
