"use client"

import { Box, Button, Input, Stack, Text } from "@chakra-ui/react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { type FieldErrors, useForm } from "react-hook-form"
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa"

import { Field } from "@/components/ui/field"
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator"
import { classifyPasswordChangeResponse } from "@/lib/auth/passwordRecoveryClient"
import { validatePassword } from "@/utils/passwordValidation"

interface FormValues {
  password: string
  confirmPassword: string
}

const PASSWORD_CHANGE_AMBIGUOUS_MESSAGE =
  "We couldn't confirm whether your password changed. Try signing in with the new password before submitting another reset."
const PASSWORD_MISMATCH_MESSAGE = "Passwords do not match"

const ResetPassword = () => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
    watch,
  } = useForm<FormValues>({ mode: "onChange" })

  const router = useRouter()
  const operationEpoch = useRef(0)
  const mounted = useRef(false)
  const navigationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [clientReady, setClientReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const password = watch("password")
  const confirmPassword = watch("confirmPassword")
  const isDisabled = !password || !confirmPassword

  useEffect(() => {
    mounted.current = true
    setClientReady(true)
    return () => {
      mounted.current = false
      operationEpoch.current += 1
      if (navigationTimeout.current !== null) {
        clearTimeout(navigationTimeout.current)
      }
    }
  }, [])

  const clearPasswords = () => {
    reset({ password: "", confirmPassword: "" })
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  const onSubmit = async (data: FormValues) => {
    if (data.password !== data.confirmPassword) {
      clearPasswords()
      setSuccessMessage("")
      setErrorMessage(PASSWORD_MISMATCH_MESSAGE)
      return
    }

    const validation = validatePassword(data.password)
    if (!validation.isValid) {
      setErrorMessage(validation.error)
      return
    }

    setLoading(true)
    setSuccessMessage("")
    setErrorMessage("")
    const epoch = ++operationEpoch.current
    const isCurrent = () => mounted.current && operationEpoch.current === epoch

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: data.password }),
      })

      let responseBody: unknown = null
      try {
        responseBody = await response.json()
      } catch {
        if (isCurrent()) {
          clearPasswords()
          setErrorMessage(PASSWORD_CHANGE_AMBIGUOUS_MESSAGE)
        }
        return
      }

      const disposition = classifyPasswordChangeResponse(
        response.status,
        responseBody,
      )
      if (!isCurrent()) return

      clearPasswords()
      if (disposition === "rejected") {
        setErrorMessage(
          "The password request was invalid. Review the requirements and try again.",
        )
        return
      }
      if (disposition === "unauthorized") {
        setErrorMessage(
          "Your recovery session has expired. Request a new code and try again.",
        )
        return
      }
      if (disposition === "ambiguous") {
        setErrorMessage(PASSWORD_CHANGE_AMBIGUOUS_MESSAGE)
        return
      }

      setSuccessMessage("Password reset successful! Please log in again.")
      navigationTimeout.current = setTimeout(() => {
        if (isCurrent()) router.replace("/login")
      }, 2000)
    } catch {
      if (!isCurrent()) return
      clearPasswords()
      setErrorMessage(PASSWORD_CHANGE_AMBIGUOUS_MESSAGE)
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  const onInvalid = (formErrors: FieldErrors<FormValues>) => {
    if (formErrors.confirmPassword?.message === PASSWORD_MISMATCH_MESSAGE) {
      clearPasswords()
      setSuccessMessage("")
      setErrorMessage(PASSWORD_MISMATCH_MESSAGE)
    }
  }

  return (
    <Box className="flex flex-col items-center justify-center min-h-screen p-4">
      <form
        onSubmit={handleSubmit(onSubmit, onInvalid)}
        className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-xl md:border md:shadow-sm md:px-8 md:py-12"
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
            New password
          </Text>
          <Text className="text-[#8D9692] text-base">
            Kindly enter a new password combination.
          </Text>
        </Box>
        <Stack gap="4" className="text-[#8D9692]">
          <Field
            label="Password"
            invalid={!!errors.password}
            errorText={errors.password?.message}
          >
            <Box className="relative w-full">
              <Input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                disabled={!clientReady || loading}
                {...register("password", {
                  required: "Password is required",
                  validate: (value) => {
                    const result = validatePassword(value)
                    return result.isValid || result.error
                  },
                })}
                className="border border-[#8D9692] p-2 pr-12 w-full"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={showPassword ? "Hide password" : "Show password"}
                disabled={!clientReady || loading}
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute right-1 top-1/2 -translate-y-1/2"
              >
                {showPassword ? (
                  <FaRegEyeSlash aria-hidden="true" />
                ) : (
                  <FaRegEye aria-hidden="true" />
                )}
              </Button>
            </Box>
            <PasswordStrengthIndicator password={password} />
            <Text fontSize="xs" color="gray.600" mt={1}>
              Password must contain at least 8 characters, including uppercase,
              lowercase, number, and special character (!@#$%^&*(),.?":{}
              |&lt;&gt;).
            </Text>
          </Field>
          <Field
            label="Confirm Password"
            invalid={
              !!errors.confirmPassword ||
              (!!confirmPassword && password !== confirmPassword)
            }
            errorText={
              !!confirmPassword && password !== confirmPassword
                ? PASSWORD_MISMATCH_MESSAGE
                : errors.confirmPassword?.message
            }
          >
            <Box className="relative w-full">
              <Input
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                disabled={!clientReady || loading}
                {...register("confirmPassword", {
                  required: "Confirm Password is required",
                  validate: (value) =>
                    value === password || PASSWORD_MISMATCH_MESSAGE,
                })}
                className="border border-[#8D9692] p-2 pr-12 w-full"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={
                  showConfirmPassword
                    ? "Hide password confirmation"
                    : "Show password confirmation"
                }
                disabled={!clientReady || loading}
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                className="absolute right-1 top-1/2 -translate-y-1/2"
              >
                {showConfirmPassword ? (
                  <FaRegEyeSlash aria-hidden="true" />
                ) : (
                  <FaRegEye aria-hidden="true" />
                )}
              </Button>
            </Box>
          </Field>
          <Button
            type="submit"
            disabled={!clientReady || isDisabled || loading}
            className="bg-[#2b7ff9] text-white"
          >
            {loading ? "Resetting..." : "Continue"}
          </Button>
        </Stack>
        <Text
          color={successMessage ? "green.500" : undefined}
          mt={4}
          role="status"
          aria-live="polite"
        >
          {successMessage}
        </Text>
        <Text
          color={errorMessage ? "red.500" : undefined}
          mt={4}
          role="status"
          aria-live="polite"
        >
          {errorMessage}
        </Text>
      </form>
    </Box>
  )
}

export default ResetPassword
