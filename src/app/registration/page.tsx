"use client"

import { Box, Button, Input, Stack, Text, Spinner } from "@chakra-ui/react"
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa"
import { toaster } from "@/components/ui/toaster"
import { Field } from "@/components/ui/field"
import { useForm } from "react-hook-form"
import Image from "next/image"
import { Checkbox } from "@/components/ui/checkbox"
import AuthMessage from "@/components/ui/AuthMessage"
import Link from "next/link"
import { create } from "zustand"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/authStore"

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
  const setRegistrationEmail = useAuthStore(
    (state) => state.setRegistrationEmail
  )

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
    pattern: {
      value: /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/,
      message:
        "Password must contain at least one uppercase letter, one number, and one special character",
    },
    minLength: {
      value: 8,
      message: "Password must be at least 8 characters long",
    },
  }

  const onSubmit = async (data: FormValues) => {
    setIsLoading(true)
    const { email, password, first_name, last_name } = data

    try {
      const response = await fetch("/api/auth/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, first_name, last_name }),
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.error.includes("already exists")) {
          toaster.create({
            title: "Email Already Exists",
            description:
              "This email address is already registered. Please try logging in instead.",
            duration: 5000,
          })
        } else {
          toaster.create({
            title: "Signup Failed",
            description: result.error || "An unexpected error occurred",
            duration: 5000,
          })
        }
        return
      }

      toaster.create({
        title: "Signup Successful",
        description: "Please check your email to verify your account.",
        duration: 5000,
      })

      setRegistrationEmail(email)
      router.push(`/verifyAccount/${encodeURIComponent(email)}`)
    } catch (err) {
      console.error(err)
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
              <Input
                type={showPassword ? "text" : "password"}
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
              <Input
                type={showConfirmPassword ? "text" : "password"}
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
          </Field>
          <Box mt={2}>
            <Checkbox className="border rounded-xl mr-1 border-[#8D9692]" />
            <span>Send me occasional Creator Share news.</span>
          </Box>
          <Button
            type="submit"
            className="bg-[#1C3C8C] text-white"
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
              <Link href="/login" className="text-[#1C3C8C] hover:underline">
                Sign in here →
              </Link>
            </Text>
          </Box>
        </Stack>
      </form>
    </Box>
  )
}

export default Register
