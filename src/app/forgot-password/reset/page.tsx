"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Field } from "@/components/ui/field"
import { Box, Button, Input, Stack, Text } from "@chakra-ui/react"
import { useForm } from "react-hook-form"
import Image from "next/image"
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa"
import { create } from "zustand"
import { validatePassword } from "@/utils/passwordValidation"
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator"

interface FormValues {
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

const ResetPassword = () => {
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    mode: "onChange",
  })

  const router = useRouter()
  const [loading, setLoading] = useState<boolean>(false)
  const [successMessage, setSuccessMessage] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string>("")
  const setIsDisabled = useFormStore((state) => state.setIsDisabled)
  const isDisabled = useFormStore((state) => state.isDisabled)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const togglePasswordVisibility = () => setShowPassword(!showPassword)
  const toggleConfirmPasswordVisibility = () =>
    setShowConfirmPassword(!showConfirmPassword)

  const password = watch("password")
  const confirmPassword = watch("confirmPassword")
  const fields = watch()

  useEffect(() => {
    const hasEmptyFields = Object.values(fields).some((value) => !value)
    const passwordsMatch = password === confirmPassword

    setIsDisabled(hasEmptyFields || !passwordsMatch)
  }, [fields, password, confirmPassword, setIsDisabled])

  const onSubmit = async (data: FormValues) => {
    setLoading(true)
    setSuccessMessage("")
    setErrorMessage("")

    const validation = validatePassword(data.password)
    if (!validation.isValid) {
      setErrorMessage(validation.error)
      setLoading(false)
      return
    }

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: data.password }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to reset password.")
      }

      setSuccessMessage("Password reset successful! Please log in again.")
      setTimeout(() => router.push("/login"), 2000)
    } catch (err) {
      setErrorMessage((err as Error).message || "Failed to reset password.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box className="flex flex-col items-center justify-center min-h-screen p-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-xl md:border md:shadow-sm md:px-8 md:py-12"
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
          <Box>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              mb="1"
            >
              <Text as="label">Password</Text>
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
                    validate: (value) => {
                      const validation = validatePassword(value)
                      return validation.isValid || validation.error
                    }
                  })}
                  className="border border-[#8D9692] p-2 w-full"
                />
                <PasswordStrengthIndicator password={watch("password")} />
                <Text fontSize="xs" color="gray.600" mt={1}>
                  Password must contain at least 8 characters, including uppercase, lowercase, 
                  number, and special character (!@#$%^&*(),.?":{}|&lt;&gt;).
                </Text>
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
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              mb="1"
            >
              <Text as="label">Confirm Password</Text>
            </Box>
            <Field
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
          </Box>
          <Button
            type="submit"
            disabled={isDisabled || loading}
            className="bg-[#2b7ff9] text-white"
          >
            {loading ? "Resetting..." : "Continue"}
          </Button>
        </Stack>
        {successMessage && (
          <Text color="green.500" mt={4}>
            {successMessage}
          </Text>
        )}
        {errorMessage && (
          <Text color="red.500" mt={4}>
            {errorMessage}
          </Text>
        )}
      </form>
    </Box>
  )
}

export default ResetPassword
