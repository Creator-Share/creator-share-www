import React from "react"
import { Box, Heading, Text } from "@chakra-ui/react"

export const HomeHero = () => {
  return (
    <Box className="text-center py-10 md:py-14">
      {/* Logo - Centered */}
      {/*<Image*/}
      {/*  src="/logo_text.svg"*/}
      {/*  alt="Creator Share"*/}
      {/*  height={{ base: "64px", md: "96px" }}*/}
      {/*  mx="auto"*/}
      {/*  mb={6}*/}
      {/*/>*/}

      {/* Heading Content */}
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        gap={3}
        px={4}
      >
        <Heading
          as="h1"
          fontSize={{ base: "3xl", md: "5xl" }}
          fontWeight="bold"
          color="black"
          lineHeight="1.1"
          maxW="4xl"
        >
          One child at a time, we can
          <br />
          <Box
            as="span"
            display="inline-block"
            bg="blue.100"
            color="blue.600"
            px={3}
            py={1}
            borderRadius="full"
            fontWeight="bold"
          >
            change
          </Box>{" "}
          thousands of lives
        </Heading>
        <Text
          fontSize={{ base: "md", md: "lg" }}
          color="gray.700"
          lineHeight="1.6"
          maxW="3xl"
        >
          Sharing with the children you see here provides education, medical care, access to adequate nutrition, and the hope to pursue their dreams.
        </Text>
      </Box>
    </Box>
  )
}
