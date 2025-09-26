"use client"
import { Button, Container, Heading, Text, VStack } from "@chakra-ui/react"
import Link from "next/link"
import React from "react"

export default function NotFound() {
  return (
    <Container maxW="container.xl" py={20}>
      <VStack gap={8} alignItems="center" textAlign="center">
        <Heading as="h1" size="4xl">
          404
        </Heading>
        <Heading as="h2" size="xl">
          Page Not Found
        </Heading>
        <Text fontSize="xl" color="gray.500">
          Oops! The page you&apos;re looking for seems to have wandered off into
          the creative ether.
        </Text>
        <Link href="/" passHref>
          <Button colorScheme="blue" size="lg">
            Return Home
          </Button>
        </Link>
      </VStack>
    </Container>
  )
}
