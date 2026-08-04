"use client"

import { Box, Button, Input, Stack, Text, Spinner } from "@chakra-ui/react"
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa"
import { toaster } from "@/components/ui/toaster"
import { Field } from "@/components/ui/field"
import { useForm } from "react-hook-form"
import Image from "next/image"
import { Checkbox } from "@/components/ui/checkbox"
import Link from "next/link"
import { create } from "zustand"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/authStore"
import { validatePassword } from "@/utils/passwordValidation"
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator"
import { AuthMessage } from "@/components/ui/AuthMessage"

interface FormValues {
  first_name: string
  last_name: string
  email: string
  password: string
  confirmPassword: string
}

const useFormStore = create<{
  isDisabled: boolean
  setIsDisabled: (value: boolean) => void
}>((set) => ({
  isDisabled: true,
  setIsDisabled: (value) => set({ isDisabled: value }),
}))

const Register = () => {
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    mode: "onChange",
  })
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const [isLoading, setIsLoading] = useState(false)

  const setIsDisabled = useFormStore((state) => state.setIsDisabled)
  const isDisabled = useFormStore((state) => state.isDisabled)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const togglePasswordVisibility = () => setShowPassword(!showPassword)
  const toggleConfirmPasswordVisibility = () =>
    setShowConfirmPassword(!showConfirmPassword)

  useEffect(() => {
    if (user) {
      router.push("/")
    }
  }, [user, router])

  const passwordValidation = {
    required: "Password is required",
    validate: (value: string) => {
      const validation = validatePassword(value)
      return validation.isValid ? true : validation.error
    },
  }

  const onSubmit = async (data: FormValues) => {
    setIsLoading(true)
    const { email, password, first_name, last_name } = data

    try {
      const response = await fetch("/api/auth/registration", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, first_name, last_name }),
      })

      const result: unknown = await response.json().catch(() => null)
      const exactAcceptedResponse =
        response.status === 202 &&
        result !== null &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        Object.keys(result).length === 1 &&
        (result as { status?: unknown }).status === "check-email"

      if (!exactAcceptedResponse) {
        toaster.create({
          title: "Signup unavailable",
          description: "Please review the form and try again shortly.",
          duration: 5000,
        })
        return
      }

      toaster.create({
        title: "Check your email",
        description:
          "If the account can be created, a secure confirmation link is on its way.",
        duration: 5000,
      })

      router.push("/verifyAccount")
    } catch {
      toaster.create({
        title: "Unexpected Error",
        description: "Something went wrong. Please try again later.",
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const password = watch("password")
  const confirmPassword = watch("confirmPassword")
  const fields = watch()

  useEffect(() => {
    const hasEmptyFields = Object.values(fields).some((value) => !value)
    const passwordsMatch = password === confirmPassword

    setIsDisabled(hasEmptyFields || !passwordsMatch)
  }, [fields, password, confirmPassword, setIsDisabled])

  return (
    <Box className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] p-4 md:p-12">
      <Box mb="6" className="max-w-md">
        <AuthMessage />
      </Box>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-md p-6 md:border bg-[#FFFFFF] md:rounded-xl md:shadow-sm md:px-8 md:py-12"
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
            Create account
          </Text>
        </Box>
        <Stack gap="4" className="text-[#8D9692]">
          <Field
            label="First Name"
            invalid={!!errors.first_name}
            errorText={errors.first_name?.message}
          >
            <Input
              {...register("first_name", {
                required: "First Name is required",
              })}
              className="border border-[#8D9692] p-2"
            />
          </Field>
          <Field
            label="Last Name"
            invalid={!!errors.last_name}
            errorText={errors.last_name?.message}
          >
            <Input
              {...register("last_name", { required: "Last Name is required" })}
              className="border border-[#8D9692] p-2"
            />
          </Field>
          <Field
            label="Email Address"
            invalid={!!errors.email}
            errorText={errors.email?.message}
          >
            <Input
              type="email"
              autoComplete="email"
              {...register("email", { required: "Email Address is required" })}
              className="border border-[#8D9692] p-2"
            />
          </Field>
          <Field
            label="Password"
            invalid={!!errors.password}
            errorText={errors.password?.message}
          >
            <Box className="relative w-full">
              <Box className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  {...register("password", passwordValidation)}
                  className="border border-[#8D9692] p-2 w-full"
                />
                <Box
                  onClick={togglePasswordVisibility}
                  className="absolute right-[10px] top-1/2 -translate-y-1/2 cursor-pointer"
                >
                  {showPassword ? <FaRegEyeSlash /> : <FaRegEye />}
                </Box>
              </Box>
              <PasswordStrengthIndicator password={watch("password")} />
              <Text fontSize="xs" color="gray.600" mt={1}>
                Password must contain at least 8 characters, including
                uppercase, lowercase, number, and special character
                (!@#$%^&*(),.?":{}|&lt;&gt;).
              </Text>
            </Box>
          </Field>
          <Field
            label="Confirm Password"
            invalid={
              !!errors.confirmPassword ||
              (!!confirmPassword && password !== confirmPassword)
            }
            errorText={
              !!confirmPassword && password !== confirmPassword
                ? "Passwords do not match"
                : errors.confirmPassword?.message
            }
          >
            <Box className="relative w-full">
              <Box className="relative">
                <Input
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  {...register("confirmPassword", {
                    required: "Confirm Password is required",
                  })}
                  className="border border-[#8D9692] p-2 w-full"
                />
                <Box
                  onClick={toggleConfirmPasswordVisibility}
                  className="absolute right-[10px] top-1/2 -translate-y-1/2 cursor-pointer"
                >
                  {showConfirmPassword ? <FaRegEyeSlash /> : <FaRegEye />}
                </Box>
              </Box>
            </Box>
          </Field>
          <Box mt={2}>
            <Checkbox className="border rounded-xl mr-1 border-[#8D9692]" />
            <span>Send me occasional Creator Share news.</span>
          </Box>
          <Button
            type="submit"
            className="bg-[#2b7ff9] text-white"
            width="full"
            disabled={isDisabled || isLoading}
            mt={4}
          >
            {isLoading ? (
              <Box display="flex" alignItems="center" gap={2}>
                <Spinner size="sm" color="white" />
                <Text>Creating Account...</Text>
              </Box>
            ) : (
              "Submit"
            )}
          </Button>
          <Box className="mt-6 text-center">
            <Text fontSize="sm" color="gray.600">
              Already have an account?{" "}
              <Link href="/login" className="text-[#2b7ff9] hover:underline">
                Sign in here
              </Link>
            </Text>
          </Box>
        </Stack>
      </form>
    </Box>
  )
}

export default Register
