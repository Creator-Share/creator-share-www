"use client"

import { Box, Button, Input, Stack, Text } from "@chakra-ui/react"
import Image from "next/image"
import { type FormEvent, useEffect, useRef, useState } from "react"

import { Field } from "@/components/ui/field"
import {
  classifyPasswordRecoveryRequestResponse,
  normalizePasswordRecoveryEmail,
} from "@/lib/auth/passwordRecoveryClient"

import { PasswordRecoveryVerificationForm } from "./PasswordRecoveryVerificationForm"

const REQUEST_AMBIGUOUS_MESSAGE =
  "Your request may have been received, but we couldn't confirm it. Check for the email or enter a code you already received."

type RecoveryStep = "request" | "verify"

const ForgotPassword = () => {
  const operationEpoch = useRef(0)
  const mounted = useRef(false)
  const [clientReady, setClientReady] = useState(false)
  const [step, setStep] = useState<RecoveryStep>("request")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [requestAmbiguous, setRequestAmbiguous] = useState(false)

  useEffect(() => {
    mounted.current = true
    setClientReady(true)
    return () => {
      mounted.current = false
      operationEpoch.current += 1
    }
  }, [])

  const continueToVerification = () => {
    operationEpoch.current += 1
    const normalizedEmail = normalizePasswordRecoveryEmail(email)
    if (normalizedEmail !== null) setEmail(normalizedEmail)
    setMessage("")
    setRequestAmbiguous(false)
    setStep("verify")
  }

  const handleSendOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedEmail = normalizePasswordRecoveryEmail(email)
    if (normalizedEmail === null) {
      setMessage("Enter a valid email address.")
      return
    }

    setEmail(normalizedEmail)
    setLoading(true)
    setMessage("")
    setRequestAmbiguous(false)
    const epoch = ++operationEpoch.current
    const isCurrent = () => mounted.current && operationEpoch.current === epoch

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      })

      let responseBody: unknown = null
      try {
        responseBody = await response.json()
      } catch {
        if (isCurrent()) {
          setMessage(REQUEST_AMBIGUOUS_MESSAGE)
          setRequestAmbiguous(true)
        }
        return
      }

      const disposition = classifyPasswordRecoveryRequestResponse(
        response.status,
        responseBody,
      )
      if (!isCurrent()) return

      if (disposition === "rejected") {
        setMessage("We couldn't send a code. Please try again.")
        return
      }

      if (disposition === "ambiguous") {
        setMessage(REQUEST_AMBIGUOUS_MESSAGE)
        setRequestAmbiguous(true)
        return
      }

      setMessage("")
      setStep("verify")
    } catch {
      if (!isCurrent()) return
      setMessage(REQUEST_AMBIGUOUS_MESSAGE)
      setRequestAmbiguous(true)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  if (step === "verify") {
    return (
      <PasswordRecoveryVerificationForm
        email={email}
        onEmailChange={setEmail}
        onRequestNewCode={() => {
          operationEpoch.current += 1
          setMessage("")
          setRequestAmbiguous(false)
          setStep("request")
        }}
      />
    )
  }

  return (
    <Box className="flex items-center justify-center min-h-screen p-4">
      <form
        className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-xl md:border md:shadow-sm md:px-8 md:py-12"
        onSubmit={handleSendOtp}
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
            Forgot your password?
          </Text>
          <Text className="text-[#8D9692] text-base">
            No worries! We'll send you an email with a code to enter below.
          </Text>
        </Box>
        <Stack className="text-[#8D9692]">
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
              className="border border-[#8D9692] p-2"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            className="bg-[#2b7ff9] text-white mt-9 p-2.5"
            disabled={!clientReady || !email || loading}
          >
            {loading ? "Sending..." : "Send verification code"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!clientReady || loading}
            onClick={continueToVerification}
          >
            Already have a code
          </Button>
          {requestAmbiguous && (
            <Button
              type="button"
              variant="outline"
              onClick={continueToVerification}
            >
              Enter a received code
            </Button>
          )}
        </Stack>
        <Text
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

export default ForgotPassword
