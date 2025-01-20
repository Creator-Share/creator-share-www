"use client";

import React, { useState } from "react";
import {
  Box,
  Flex,
  Heading,
  Input,
  Button,
  Checkbox,
  Text,
  VStack,
  FormControl,
  FormLabel,
  FormErrorMessage,
  Alert,
  AlertIcon,
} from "@chakra-ui/react";
import Link from "next/link";
import { useAuthStore } from "@/stores/authStore";
import next from "next";

const LogIn: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const login = useAuthStore((state) => state.login);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const { error: loginError } = await login(email, password);

    if (loginError) {
      setError(loginError);
    } else {
      console.log("Logged in successfully");
    }
  };

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      minHeight="100vh"
      bg="#F5F5F5"
      padding="178px 8px 38px"
    >
      <Box
        width="100%"
        maxWidth="400px"
        bg="white"
        p="8"
        borderRadius="md"
        boxShadow="lg"
      >
        <Flex direction="column" align="center" mb="6">
          <Heading size="md" mb="2">
            Welcome
          </Heading>
          <Text color="gray.600" fontSize="sm">
            Sign in to your Creator Share account
          </Text>
        </Flex>

        {error && (
          <Alert status="error" mb="4">
            <AlertIcon />
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <VStack spacing="4" align="stretch">
            <FormControl isInvalid={!email}>
              <FormLabel>Email Address</FormLabel>
              <Input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <FormErrorMessage>Email is required</FormErrorMessage>
            </FormControl>

            <FormControl isInvalid={!password}>
              <FormLabel>Password</FormLabel>
              <Input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <FormErrorMessage>Password is required</FormErrorMessage>
            </FormControl>

            <Flex justify="space-between" fontSize="sm">
              <Checkbox>Keep me signed in</Checkbox>
              <Link color="blue.500" href="#">
                Forgot Password?
              </Link>
            </Flex>

            <Button
              type="submit"
              colorScheme="blue"
              width="full"
              mt="4"
              size="md"
            >
              Sign In
            </Button>
          </VStack>
        </form>

        <Text mt="6" textAlign="center" fontSize="sm">
          New to Creator Share?{" "}
          <Link className="!text-[#1C3C8C] text-bold" href="#">
            Sign up here
          </Link>
        </Text>
      </Box>
    </Flex>
  );
};

export default LogIn;
