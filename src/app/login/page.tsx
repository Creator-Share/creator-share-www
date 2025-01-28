"use client";

import { Box, Button, Input, Stack, Text } from "@chakra-ui/react";
import { FaRegEye, FaRegEyeSlash } from "react-icons/fa";
import { Field } from "@/components/ui/field";
import { useForm } from "react-hook-form";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useState, useEffect } from "react";
import { loginForm } from "@/types";
import ToS from "@/components/ui/ToS";

const Login = () => {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<loginForm>();
  const user = useAuthStore((state) => state.user);
  const router = useRouter();

  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isDisabled, setIsDisabled] = useState<boolean>(true);

  const email = watch("email", "");
  const password = watch("password", "");
  const togglePasswordVisibility = () => setShowPassword(!showPassword);

  useEffect(() => {
    if (user) {
      router.push("/");
    }
  }, [user, router]);

  useEffect(() => {
    setIsDisabled(!email || !password);
  }, [email, password]);

  const onSubmit = async (data: loginForm) => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(errorData.error || "An unexpected error occurred");
        return;
      }
      router.push("/");
    } catch (error) {
      alert("An unexpected error occurred. Please try again.");
      console.error(error);
    }
  };


  return (
    <Box className="flex flex-col items-center justify-center min-h-screen p-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-md p-6 md:border bg-[#FFFFFF] md:rounded-lg md:shadow-sm md:px-8 md:py-12"
      >
        <Box className="flex justify-center">
          <Image width={200} height={200} alt="creator" src="/creator-text.svg" />
        </Box>
        <Box className="text-center my-8">
          <Text className="text-[#03150E] font-semibold text-2xl">Welcome</Text>
          <Text className="text-[#8D9692] text-base">Sign in to your Creator Share account</Text>
        </Box>
        <Stack gap="4" className="text-[#8D9692]">
          <Box>
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
          </Box>
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb="1">
              <Text as="label">Password</Text>
              <Link
                className="text-[#1C3C8C] text-xs hover:underline"
                href="/forgot-password"
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
                  {...register("password", { required: "Password is required" })}
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
            <Checkbox className="border rounded-md mr-1 border-[#8D9692]" />
            <span>Keep me signed in</span>
          </Box>
          <Button
            type="submit"
            className="bg-[#1C3C8C] text-white"
            width="full"
            disabled={isDisabled}
          >
            Submit
          </Button>
          <Box className="mt-6 text-center">
            <Text fontSize="sm" color="gray.600">
              New to Creator Share?{" "}
              <Link
                href="/registration"
                className="text-[#1C3C8C] hover:underline"
              >
                Sign up here →
              </Link>
            </Text>
          </Box>
        </Stack>
      </form>
      <Box mt="6" className="max-w-md">
        <ToS />
      </Box>
    </Box>
  );
};

export default Login;
