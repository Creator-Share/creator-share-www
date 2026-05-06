"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Box, Button, Input, Stack, Text } from "@chakra-ui/react"
import Image from "next/image"

function VerifyOtpComponent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get("email") || ""

  const [otp, setOtp] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  const handleVerifyOtp = async () => {
    setLoading(true)
    setMessage("")

    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          token: otp,
          type: "recovery",
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to verify OTP.")
      }

      router.push(`/forgot-password/reset?email=${encodeURIComponent(email)}`)
    } catch (err) {
      setMessage((err as Error).message || "Failed to verify OTP.")
    } finally {
      setLoading(false)
    }
  }

  if (!email) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-screen p-4">
        <Text color="red.500">Invalid request. Email is required.</Text>
      </Box>
    )
  }

  return (
    <Box className="flex flex-col items-center justify-center min-h-screen p-4">
      <form className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-xl md:border md:shadow-sm md:px-8 md:py-12">
        <Box className="flex justify-center">
          <Image
            width={200}
            height={200}
            alt="creator"
            src="/creator-text.svg"
          />
        </Box>
        <Box className="text-center my-8">
          <Text className="text-[#03150E] font-semibold text-2xl">
            Forgot your password?
          </Text>
          <Text className="text-[#8D9692] text-base">
            Enter the 6-digit code sent to your email.
          </Text>
        </Box>
        <Stack gap={4} className="text-[#8D9692]">
          <Input
            type="text"
            placeholder="Enter OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className="border border-[#8D9692] p-2"
          />
          <Button
            onClick={handleVerifyOtp}
            className="bg-[#2b7ff9] text-white mt-4"
            disabled={!otp || loading}
          >
            {loading ? "Verifying..." : "Continue"}
          </Button>
        </Stack>
        {message && (
          <Text color="red.500" mt={4}>
            {message}
          </Text>
        )}
      </form>
    </Box>
  )
}

export default function VerifyOtp() {
  return (
    <Suspense fallback={<Box>Loading...</Box>}>
      <VerifyOtpComponent />
    </Suspense>
  )
}
