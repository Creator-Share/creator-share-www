import React from "react"
import { Box, Heading, Text, Image } from "@chakra-ui/react"

export const HomeHero = () => {
  return (
    <Box className="text-center py-8 md:py-12">
      {/* Logo - Centered */}
      <Image
        src="/logo_text.svg"
        alt="Creator Share"
        height={{ base: "64px", md: "96px" }}
        mx="auto"
        mb={6}
      />

      {/* Heading Content */}
      <Heading
        as="h1"
        fontSize={{ base: "3xl", md: "5xl" }}
        fontWeight="bold"
        mb={4}
        color="#1C3C8C"
        lineHeight="1.1"
      >
        Be the Reason Someone{" "}
        <span className="font-['Dancing_Script'] italic text-[#4B84F7]">
          Smiles
        </span>{" "}
        Today
      </Heading>
      <Text
        fontSize={{ base: "md", md: "lg" }}
        color="gray.600"
        maxW="2xl"
        mx="auto"
        mb={8}
      >
        Partner with us to bring relief, support, and opportunity to vulnerable
        children. Browse available sponsorships below.
      </Text>
    </Box>
  )
}
