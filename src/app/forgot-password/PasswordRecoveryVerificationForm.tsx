"use client"

import { Box, Button, Input, Stack, Text } from "@chakra-ui/react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"

import { Field } from "@/components/ui/field"
import {
  classifyPasswordRecoveryVerificationResponse,
  normalizePasswordRecoveryEmail,
} from "@/lib/auth/passwordRecoveryClient"

const VERIFICATION_AMBIGUOUS_MESSAGE =
  "We couldn't confirm whether the code was accepted. Try continuing to password reset before requesting another code."

interface PasswordRecoveryVerificationFormProps {
  email: string
  onEmailChange: (email: string) => void
  onRequestNewCode: () => void
}

export function PasswordRecoveryVerificationForm({
  email,
  onEmailChange,
  onRequestNewCode,
}: PasswordRecoveryVerificationFormProps) {
  const router = useRouter()
  const operationEpoch = useRef(0)
  const mounted = useRef(false)
  const [clientReady, setClientReady] = useState(false)
  const [otp, setOtp] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [verificationAmbiguous, setVerificationAmbiguous] = useState(false)

  useEffect(() => {
    mounted.current = true
    setClientReady(true)
    return () => {
      mounted.current = false
      operationEpoch.current += 1
    }
  }, [])

  const clearSensitiveState = () => {
    setOtp("")
    onEmailChange("")
    setMessage("")
  }

  const markAmbiguous = () => {
    setMessage(VERIFICATION_AMBIGUOUS_MESSAGE)
    setVerificationAmbiguous(true)
  }

  const continueToPasswordReset = () => {
    flushSync(() => {
      clearSensitiveState()
      setVerificationAmbiguous(false)
    })
    router.replace("/forgot-password/reset")
  }

  const handleVerifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedEmail = normalizePasswordRecoveryEmail(email)
    if (normalizedEmail === null) {
      setMessage("Enter the email address that received the code.")
      return
    }
    if (!/^\d{6}$/.test(otp)) {
      setMessage("Enter the six-digit verification code.")
      return
    }

    onEmailChange(normalizedEmail)
    setLoading(true)
    setMessage("")
    setVerificationAmbiguous(false)
    const epoch = ++operationEpoch.current
    const isCurrent = () => mounted.current && operationEpoch.current === epoch

    try {
      const response = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          token: otp,
          type: "recovery",
        }),
      })

      let responseBody: unknown = null
      try {
        responseBody = await response.json()
      } catch {
        if (isCurrent()) markAmbiguous()
        return
      }

      const disposition = classifyPasswordRecoveryVerificationResponse(
        response.status,
        responseBody,
      )
      if (!isCurrent()) return

      if (disposition === "rejected") {
        setOtp("")
        setMessage("That code is invalid or expired. Enter a new code.")
        return
      }

      if (disposition === "ambiguous") {
        markAmbiguous()
        return
      }

      continueToPasswordReset()
    } catch {
      if (isCurrent()) markAmbiguous()
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  const requestNewCode = () => {
    operationEpoch.current += 1
    clearSensitiveState()
    setVerificationAmbiguous(false)
    onRequestNewCode()
  }

  const continueAfterAmbiguousVerification = () => {
    operationEpoch.current += 1
    continueToPasswordReset()
  }

  return (
    <Box className="flex flex-col items-center justify-center min-h-screen p-4">
      <form
        className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-xl md:border md:shadow-sm md:px-8 md:py-12"
        onSubmit={handleVerifyOtp}
        aria-busy={!clientReady || loading}
      >
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
            Enter your verification code
          </Text>
          <Text className="text-[#8D9692] text-base">
            Enter the email address that received the code and the six-digit
            code from the message.
          </Text>
        </Box>
        <Stack gap={4} className="text-[#8D9692]">
          <Field label="Email Address">
            <Input
              type="text"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={1024}
              placeholder="Enter your email address"
              value={email}
              disabled={!clientReady || loading}
              onChange={(event) => onEmailChange(event.target.value)}
              className="border border-[#8D9692] p-2"
            />
          </Field>
          <Field label="Verification code">
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              placeholder="Enter 6-digit code"
              value={otp}
              disabled={!clientReady || loading}
              aria-describedby="password-recovery-verification-status"
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="border border-[#8D9692] p-2"
            />
          </Field>
          <Button
            type="submit"
            className="bg-[#2b7ff9] text-white mt-4"
            disabled={!clientReady || !email || otp.length !== 6 || loading}
          >
            {loading ? "Verifying..." : "Verify code"}
          </Button>
          {verificationAmbiguous && (
            <Button
              type="button"
              variant="outline"
              onClick={continueAfterAmbiguousVerification}
            >
              Continue to password reset
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={loading}
            onClick={requestNewCode}
          >
            Request a new code
          </Button>
        </Stack>
        <Text
          id="password-recovery-verification-status"
          color={message ? "red.500" : undefined}
          mt={4}
          role="status"
          aria-live="polite"
        >
          {message}
        </Text>
      </form>
    </Box>
  )
}
