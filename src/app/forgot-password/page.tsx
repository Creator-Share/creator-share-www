"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Box, Button, Input, Stack, Text } from "@chakra-ui/react"
import { Field } from "@/components/ui/field"
import Image from "next/image"

const ForgotPassword = () => {
  const router = useRouter()
  const [email, setEmail] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [message, setMessage] = useState<string>("")

  const handleSendOtp = async () => {
    setLoading(true)
    setMessage("")

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to send OTP.")
      }

      setMessage("OTP sent to your email.")
      router.push(`/forgot-password/verify?email=${encodeURIComponent(email)}`)
    } catch (err: unknown) {
      setMessage((err as Error).message || "Failed to send OTP.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box className="flex items-center justify-center min-h-screen p-4">
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
            No worries! We'll immediately send you an email with a link to
            create a new one.
          </Text>
        </Box>
        <Stack className="text-[#8D9692]">
          <Box>
            <Field
              label="Email Address"
              invalid={!email}
              errorText={!email ? "Email is required." : ""}
            >
              <Input
                type="email"
                placeholder="Enter your email address"
                value={email}
                className="border border-[#8D9692] p-2"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </Box>
          <Button
            onClick={handleSendOtp}
            className="bg-[#2b7ff9] text-white mt-9 p-2.5"
            disabled={!email || loading}
          >
            {loading ? "Sending..." : "Continue"}
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

export default ForgotPassword
