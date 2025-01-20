"use client";

import { Box, Button, Input, Stack, Text } from "@chakra-ui/react";
import { Field } from "@/components/ui/field";
import { useForm } from "react-hook-form";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";

interface FormValues {
    email: string;
    password: string;
}

const Login = () => {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<FormValues>();

    const onSubmit = handleSubmit((data) => console.log(data));

    return (
        <div className="flex items-center justify-center min-h-screen p-4">
            <form
                onSubmit={onSubmit}
                className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-lg md:border md:shadow-sm md:px-8 md:py-12"
            >
                <div className="flex justify-center">
                    <Image width={200} height={200} alt="creator" src="/creator-text.svg" />
                </div>
                <div className="text-center my-8">
                    <h1 className="text-[#03150E] font-semibold text-2xl">Welcome</h1>
                    <p className="text-[#8D9692] text-base">Sign in to your Creator Share account</p>
                </div>
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
                            <Text as="label">
                                Password
                            </Text>
                            <Link
                                className="text-[#1C3C8C] text-xs hover:underline"
                                href="#"
                            >
                                Forgot Password
                            </Link>
                        </Box>
                        <Field
                            invalid={!!errors.password}
                            errorText={errors.password?.message}
                        >
                            <Input
                                type="password"
                                {...register("password", { required: "Password is required" })}
                                className="border border-[#8D9692] p-2"
                            />
                        </Field>
                    </Box>
                    <div>
                        <Checkbox className="border rounded-md mr-1 border-[#8D9692]" /><span>Keep me signed in</span>
                    </div>
                    <Button type="submit" className="bg-[#1C3C8C] text-white" width="full">
                        Submit
                    </Button>
                    <div className="mt-6 text-center">
                        <Text fontSize="sm" color="gray.600">
                            New to Creator Share?{" "}
                            <Link
                                href="/signup"
                                className="text-[#1C3C8C] hover:underline"
                            >
                                Sign up here →
                            </Link>
                        </Text>
                    </div>
                </Stack>
            </form>
        </div>
    );
};

export default Login;
