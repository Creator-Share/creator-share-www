"use client";

import { Box, Button, Input, Stack, Text } from "@chakra-ui/react";
import {
    FaRegEye,
    FaRegEyeSlash
} from "react-icons/fa";
import { toaster } from "@/components/ui/toaster"
import { Field } from "@/components/ui/field";
import { useForm } from "react-hook-form";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import ToS from "@/components/ui/ToS";
import Link from "next/link";
import { create } from "zustand";
import { useEffect, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

interface FormValues {
    email: string;
    password: string;
    name: string;
    confirmPassword: string;
}

const useFormStore = create<{
    isDisabled: boolean;
    setIsDisabled: (value: boolean) => void;
}>((set) => ({
    isDisabled: true,
    setIsDisabled: (value) => set({ isDisabled: value }),
}));

const Register = () => {
    const {
        register,
        handleSubmit,
        formState: { errors },
        watch,
    } = useForm<FormValues>({
        mode: "onChange",
    });
    const router = useRouter();
    const user = useAuthStore((state) => state.user);
    useEffect(() => {
        if (user) {
            router.push("/");
        }
    }, [user, router]);
    const setIsDisabled = useFormStore((state) => state.setIsDisabled);
    const isDisabled = useFormStore((state) => state.isDisabled);
    const setRegistrationEmail = useAuthStore((state) => state.setRegistrationEmail);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const togglePasswordVisibility = () => setShowPassword(!showPassword);
    const toggleConfirmPasswordVisibility = () => setShowConfirmPassword(!showConfirmPassword);
    const onSubmit = async (data: FormValues) => {
        const { email, password } = data;

        try {
            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: `http://localhost:3000/onboarding`,
                },
            });

            if (error) {
                toaster.create({
                    title: "Signup Failed",
                    description: error.message,
                    duration: 5000,
                });
            } else {
                toaster.create({
                    title: "Signup Successful",
                    description: "Please check your email to verify your account.",
                    duration: 5000,
                });
                setRegistrationEmail(email);
                router.push(`/verifyAccount/${encodeURIComponent(email)}`);
            }
        } catch (err) {
            console.error(err);
            toaster.create({
                title: "Unexpected Error",
                description: "Something went wrong. Please try again later.",
                duration: 5000,
            });
        }
    };

    const password = watch("password");
    const confirmPassword = watch("confirmPassword");
    const fields = watch();

    useEffect(() => {
        const hasEmptyFields = Object.values(fields).some((value) => !value);
        const passwordsMatch = password === confirmPassword;

        setIsDisabled(hasEmptyFields || !passwordsMatch);
    }, [fields, password, confirmPassword, setIsDisabled]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 md:p-12">
            <form
                onSubmit={handleSubmit(onSubmit)}
                className="w-full max-w-md p-6 md:border bg-[#FFFFFF] md:rounded-lg md:shadow-sm md:px-8 md:py-12"
            >
                <div className="flex justify-center">
                    <Image width={200} height={200} alt="creator" src="/creator-text.svg" />
                </div>
                <div className="text-center my-8">
                    <h1 className="text-[#03150E] font-semibold text-2xl">Create account</h1>
                    <p className="text-[#8D9692] text-base">Register to Creator Share</p>
                </div>
                <Stack gap="4" className="text-[#8D9692]">
                    <Box>
                        <Field
                            label="Name"
                            invalid={!!errors.name}
                            errorText={errors.name?.message}
                        >
                            <Input
                                {...register("name", { required: "Name is required" })}
                                className="border border-[#8D9692] p-2"
                            />
                        </Field>
                    </Box>
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
                        </Box>
                        <Field
                            invalid={!!errors.password}
                            errorText={errors.password?.message}
                        >
                            <div className="relative w-full">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    {...register("password", { required: "Password is required" })}
                                    className="border border-[#8D9692] p-2 w-full"
                                />
                                <div
                                    onClick={togglePasswordVisibility}
                                    className="absolute right-[10px] top-1/2 -translate-y-1/2 cursor-pointer"
                                >
                                    {showPassword ? <FaRegEyeSlash /> : <FaRegEye />}
                                </div>
                            </div>
                        </Field>
                    </Box>
                    <Box>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb="1">
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
                            <div className="relative w-full">
                                <Input
                                    type={showConfirmPassword ? "text" : "password"}
                                    {...register("confirmPassword", { required: "Confirm Password is required" })}
                                    className="border border-[#8D9692] p-2 w-full"
                                />
                                <div
                                    onClick={toggleConfirmPasswordVisibility}
                                    className="absolute right-[10px] top-1/2 -translate-y-1/2 cursor-pointer"
                                >
                                    {showConfirmPassword ? <FaRegEyeSlash /> : <FaRegEye />}
                                </div>
                            </div>
                        </Field>
                    </Box>
                    <div>
                        <Checkbox className="border rounded-md mr-1 border-[#8D9692]" />
                        <span>Send me occasional Creator Share news.</span>
                    </div>
                    <Button
                        type="submit"
                        className="bg-[#1C3C8C] text-white"
                        width="full"
                        disabled={isDisabled}
                    >
                        Submit
                    </Button>
                    <div className="mt-6 text-center">
                        <Text fontSize="sm" color="gray.600">
                            Already have an account?{" "}
                            <Link
                                href="/signin"
                                className="text-[#1C3C8C] hover:underline"
                            >
                                Sign in here →
                            </Link>
                        </Text>
                    </div>
                </Stack>
            </form>
            <Box mt="6" className="max-w-md">
                <ToS />
            </Box>
        </div>
    );
};

export default Register;
