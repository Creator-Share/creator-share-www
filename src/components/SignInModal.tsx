"use client"
import React, { useState, useEffect, useCallback } from "react"
import { Box, Button, Input, Stack, Text, Spinner } from "@chakra-ui/react"
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa"
import { Field } from "@/components/ui/field"
import { useForm } from "react-hook-form"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/authStore"
import { loginForm } from "@/types"
import { toaster } from "@/components/ui/toaster"
import { AuthMessage } from "@/components/ui/AuthMessage"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
  DialogTitle,
} from "@/components/ui/dialog"

interface SignInModalProps {
  open: boolean
  onClose: () => void
}

function isExactCheckEmailResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 1 && record.status === "check-email"
}

export const SignInModal: React.FC<SignInModalProps> = ({ open, onClose }) => {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    unregister,
    formState: { errors },
  } = useForm<loginForm>()
  const router = useRouter()

  const [showPassword, setShowPassword] = useState<boolean>(false)
  const [signInMode, setSignInMode] = useState<"passwordless" | "password">(
    "passwordless",
  )
  const [magicLinkRequested, setMagicLinkRequested] = useState<boolean>(false)
  const [isDisabled, setIsDisabled] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const email = watch("email", "")
  const password = watch("password", "")
  const togglePasswordVisibility = () => setShowPassword(!showPassword)
  const toggleSignInMode = () => {
    const nextMode = signInMode === "passwordless" ? "password" : "passwordless"
    if (nextMode === "passwordless") unregister("password")
    setSignInMode(nextMode)
    setMagicLinkRequested(false)
    setShowPassword(false)
  }

  // Restore URL when modal closes (no navigation, just like child modals)
  const handleClose = useCallback(() => {
    if (typeof window !== "undefined") {
      const currentPath = window.location.pathname
      if (currentPath === "/login") {
        // Restore URL to homepage without navigation
        window.history.replaceState({}, "", "/")
      } else if (window.location.hash === "#signin") {
        // Just clear the hash if on another page
        window.history.replaceState(
          null,
          "",
          currentPath + window.location.search,
        )
      }
    }
    reset()
    unregister("password")
    setSignInMode("passwordless")
    setMagicLinkRequested(false)
    setShowPassword(false)
    onClose()
  }, [onClose, reset, unregister])

  useEffect(() => {
    setIsDisabled(!email || (signInMode === "password" && !password))
  }, [email, password, signInMode])

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      reset()
      unregister("password")
      setShowPassword(false)
      setSignInMode("passwordless")
      setMagicLinkRequested(false)
    }
  }, [open, reset, unregister])

  const onSubmit = async (data: loginForm) => {
    setIsLoading(true)
    try {
      const passwordless = signInMode === "passwordless"
      const response = await fetch(
        passwordless ? "/api/auth/passwordless" : "/api/auth/login",
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(passwordless ? { email: data.email } : data),
        },
      )

      const result: unknown = await response.json().catch(() => null)

      if (
        !response.ok ||
        (passwordless &&
          (response.status !== 202 || !isExactCheckEmailResponse(result)))
      ) {
        const errorData =
          typeof result === "object" &&
          result !== null &&
          !Array.isArray(result)
            ? (result as { error?: string })
            : {}
        toaster.create({
          title: passwordless ? "Sign in unavailable" : "Login Failed",
          description: passwordless
            ? "Please check the email address and try again."
            : errorData.error || "Invalid email or password",
          duration: 5000,
        })
        return
      }

      if (passwordless) {
        setMagicLinkRequested(true)
        toaster.create({
          title: "Check your email",
          description:
            "If an account exists for that email, a secure sign-in link is on its way.",
          duration: 5000,
        })
        return
      }

      await useAuthStore.getState().fetchUser()

      handleClose()

      // Only redirect if there's a specific redirect URL (not home)
      const passwordRedirect =
        typeof result === "object" &&
        result !== null &&
        !Array.isArray(result) &&
        typeof (result as { redirect?: unknown }).redirect === "string"
          ? (result as { redirect: string }).redirect
          : null
      if (passwordRedirect !== null && passwordRedirect !== "/") {
        router.push(passwordRedirect)
      }
    } catch {
      toaster.create({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(e) => !e.open && handleClose()}
      size="md"
    >
      <DialogContent
        className="max-w-md mx-4 rounded-3xl overflow-hidden"
        style={{
          boxShadow:
            "0 60px 120px -20px rgba(0, 0, 0, 0.6), 0 24px 48px -8px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.06)",
          borderRadius: "24px",
        }}
      >
        <DialogHeader className="bg-[#2b7ff9] text-white px-10 py-6">
          <DialogTitle fontSize="xl" fontWeight="bold">
            Sign In
          </DialogTitle>
          <DialogCloseTrigger className="text-white hover:bg-white/20" />
        </DialogHeader>

        <DialogBody p={10}>
          {/* Admin-only message */}
          <Box className="text-center mb-6 p-4 bg-gray-50 rounded-xl">
            <AuthMessage />
          </Box>

          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack gap="4" className="text-[#8D9692]">
              <Box>
                <Field
                  label="Email Address"
                  invalid={!!errors.email}
                  errorText={errors.email?.message}
                >
                  <Input
                    type="email"
                    autoComplete="email"
                    {...register("email", {
                      required: "Email Address is required",
                    })}
                    className="border border-[#8D9692] p-2"
                  />
                </Field>
              </Box>
              {signInMode === "password" ? (
                <>
                  <Box>
                    <Box
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      mb="1"
                    >
                      <label
                        htmlFor="creator-share-sign-in-password"
                        className="text-sm"
                      >
                        Password
                      </label>
                      <Link
                        className="text-[#2b7ff9] text-xs hover:underline"
                        href="/forgot-password"
                        onClick={handleClose}
                      >
                        Forgot Password
                      </Link>
                    </Box>
                    <Field
                      invalid={!!errors.password}
                      errorText={errors.password?.message}
                    >
                      <Box className="relative w-full">
                        <Input
                          id="creator-share-sign-in-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          {...register("password", {
                            required:
                              signInMode === "password"
                                ? "Password is required"
                                : false,
                          })}
                          className="border border-[#8D9692] p-2 w-full"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                          aria-pressed={showPassword}
                          onClick={togglePasswordVisibility}
                          className="absolute right-[4px] top-1/2 -translate-y-1/2"
                          minWidth="40px"
                          height="40px"
                          padding={0}
                        >
                          {showPassword ? <FaRegEyeSlash /> : <FaRegEye />}
                        </Button>
                      </Box>
                    </Field>
                  </Box>
                </>
              ) : magicLinkRequested ? (
                <Box
                  className="rounded-xl bg-blue-50 p-4 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <Text color="gray.700" fontSize="sm">
                    If an account exists for this email, we sent a secure
                    sign-in link. The link opens your sponsorship dashboard.
                  </Text>
                </Box>
              ) : (
                <Text color="gray.600" fontSize="sm" textAlign="center">
                  We will email you a secure link. No password is required.
                </Text>
              )}
              <Button
                type="submit"
                bg="#2b7ff9"
                color="white"
                borderRadius="16px"
                _hover={{ bg: "#1a6fe0" }}
                width="full"
                disabled={isDisabled || isLoading}
              >
                {isLoading ? (
                  <Box display="flex" alignItems="center" gap={2}>
                    <Spinner size="sm" color="white" />
                    <Text>
                      {signInMode === "passwordless"
                        ? "Sending link..."
                        : "Signing in..."}
                    </Text>
                  </Box>
                ) : signInMode === "passwordless" ? (
                  magicLinkRequested ? (
                    "Send another link"
                  ) : (
                    "Email me a sign-in link"
                  )
                ) : (
                  "Sign In"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                borderRadius="16px"
                width="full"
                onClick={toggleSignInMode}
                disabled={isLoading}
              >
                {signInMode === "passwordless"
                  ? "Use a password instead"
                  : "Use an email link instead"}
              </Button>
              <Box className="mt-4 text-center">
                <Text fontSize="sm" color="gray.600">
                  New to Creator Share?{" "}
                  <Link
                    href="/register"
                    className="text-[#2b7ff9] hover:underline"
                    onClick={handleClose}
                  >
                    Sign up here
                  </Link>
                </Text>
              </Box>
            </Stack>
          </form>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}
