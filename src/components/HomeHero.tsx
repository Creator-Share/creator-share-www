import React from "react"
import { Box, Heading, Text, Image } from "@chakra-ui/react"

export const HomeHero = () => {
  return (
    <Box className="text-center py-8 md:py-12" position="relative">
      {/* Badge - Far Upper Right */}
      <Box
        position="absolute"
        top={{ base: 2, md: 4 }}
        right={{ base: 2, md: 4 }}
        display={{ base: "none", sm: "block" }}
      >
        <div className="inline-flex items-center bg-white rounded-full px-4 py-2 shadow-sm border border-gray-100">
          <div className="bg-[#4B84F7] rounded-full p-1 mr-2">
            <svg
              className="w-4 h-4 text-white"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <span className="text-gray-600 text-sm">
            Charity funding platform
          </span>
        </div>
      </Box>

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
