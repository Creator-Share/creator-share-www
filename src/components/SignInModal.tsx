"use client"
import React, { useState, useEffect, useCallback } from "react"
import { Box, Button, Input, Stack, Text, Spinner } from "@chakra-ui/react"
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa"
import { Field } from "@/components/ui/field"
import { useForm } from "react-hook-form"
import { Checkbox } from "@/components/ui/checkbox"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/authStore"
import { loginForm } from "@/types"
import { toaster } from "@/components/ui/toaster"
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

export const SignInModal: React.FC<SignInModalProps> = ({ open, onClose }) => {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<loginForm>()
  const router = useRouter()

  const [showPassword, setShowPassword] = useState<boolean>(false)
  const [isDisabled, setIsDisabled] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const email = watch("email", "")
  const password = watch("password", "")
  const togglePasswordVisibility = () => setShowPassword(!showPassword)

  // Restore URL when modal closes (no navigation, just like child modals)
  const handleClose = useCallback(() => {
    if (typeof window !== "undefined") {
      const currentPath = window.location.pathname
      if (currentPath === "/auth/login") {
        // Restore URL to homepage without navigation
        window.history.replaceState({}, "", "/")
      } else if (window.location.hash === "#signin") {
        // Just clear the hash if on another page
        window.history.replaceState(null, "", currentPath + window.location.search)
      }
    }
    reset()
    onClose()
  }, [onClose, reset])

  useEffect(() => {
    setIsDisabled(!email || !password)
  }, [email, password])

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      reset()
      setShowPassword(false)
    }
  }, [open, reset])

  const onSubmit = async (data: loginForm) => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json()
        toaster.create({
          title: "Login Failed",
          description: errorData.error || "Invalid email or password",
          duration: 5000,
        })
        return
      }

      const result = await response.json()
      await useAuthStore.getState().fetchUser()

      handleClose()
      
      // Only redirect if there's a specific redirect URL (not home)
      if (result.redirect && result.redirect !== "/") {
        router.push(result.redirect)
      }
    } catch (error) {
      toaster.create({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        duration: 5000,
      })
      console.error(error)
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
          boxShadow: "0 4px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.04)",
          borderRadius: "24px"
        }}
      >
        <DialogHeader className="bg-[#1C3C8C] text-white px-10 py-6">
          <DialogTitle fontSize="xl" fontWeight="bold">
            Sign In
          </DialogTitle>
          <DialogCloseTrigger className="text-white hover:bg-white/20" />
        </DialogHeader>
        
        <DialogBody p={10}>
          {/* Admin-only message */}
          <Box className="text-center mb-6 p-4 bg-gray-50 rounded-xl">
            <Text className="text-[#8D9692] text-sm">
              👋 Login is only required to manage the platform. You can browse and support children without creating an account.
            </Text>
          </Box>

          <form onSubmit={handleSubmit(onSubmit)}>
            {/*<Box className="text-center mb-6">*/}
            {/*  <Text className="text-[#03150E] font-semibold text-xl">Welcome</Text>*/}
            {/*  <Text className="text-[#8D9692] text-sm">*/}
            {/*    Sign in to your Creator Share account*/}
            {/*  </Text>*/}
            {/*</Box>*/}
            <Stack gap="4" className="text-[#8D9692]">
              <Box>
                <Field
                  label="Email Address"
                  invalid={!!errors.email}
                  errorText={errors.email?.message}
                >
                  <Input
                    {...register("email", {
                      required: "Email Address is required",
                    })}
                    className="border border-[#8D9692] p-2"
                  />
                </Field>
              </Box>
              <Box>
                <Box
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  mb="1"
                >
                  <Text as="label" fontSize="sm">Password</Text>
                  <Link
                    className="text-[#1C3C8C] text-xs hover:underline"
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
                      type={showPassword ? "text" : "password"}
                      {...register("password", {
                        required: "Password is required",
                      })}
                      className="border border-[#8D9692] p-2 w-full"
                    />
                    <Box
                      onClick={togglePasswordVisibility}
                      className="absolute right-[10px] top-1/2 -translate-y-1/2 cursor-pointer"
                    >
                      {showPassword ? <FaRegEyeSlash /> : <FaRegEye />}
                    </Box>
                  </Box>
                </Field>
              </Box>
              <Box>
                <Checkbox className="border rounded-xl mr-1 border-[#8D9692]" />
                <span className="text-sm">Keep me signed in</span>
              </Box>
              <Button
                type="submit"
                bg="#1C3C8C"
                color="white"
                borderRadius="16px"
                _hover={{ bg: "#1C2B7A" }}
                width="full"
                disabled={isDisabled || isLoading}
              >
                {isLoading ? (
                  <Box display="flex" alignItems="center" gap={2}>
                    <Spinner size="sm" color="white" />
                    <Text>Signing in...</Text>
                  </Box>
                ) : (
                  "Sign In"
                )}
              </Button>
              {/*<Box className="mt-4 text-center">*/}
              {/*  <Text fontSize="sm" color="gray.600">*/}
              {/*    New to Creator Share?{" "}*/}
              {/*    <Link*/}
              {/*      href="/registration"*/}
              {/*      className="text-[#1C3C8C] hover:underline"*/}
              {/*      onClick={handleClose}*/}
              {/*    >*/}
              {/*      Sign up here →*/}
              {/*    </Link>*/}
              {/*  </Text>*/}
              {/*</Box>*/}
            </Stack>
          </form>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}
