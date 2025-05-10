"use client";
import { Box, Flex, Skeleton, VStack } from "@chakra-ui/react";
import React from "react";

export const FamilyListingsSkeleton = () => {
  return (
    <VStack gap={8} width="100%" align="stretch">
      {[...Array(3)].map((_, i) => (
        <Box
          key={i}
          p={6}
          borderWidth="1px"
          borderRadius="lg"
          overflow="hidden"
          bg="white"
        >
          <Flex direction={{ base: "column", md: "row" }} gap={6}>
            <Skeleton
              height={{ base: "400px", md: "273px" }}
              width={{ base: "100%", md: "450px" }}
              borderRadius="md"
            />
            <Box flex="1">
              <VStack align="stretch" gap={4}>
                <Skeleton height="2.5rem" width="60%" />
                <Box
                  p={4}
                  bg="gray.50"
                  borderRadius="xl"
                >
                  <VStack align="stretch" gap={4}>
                    <Skeleton height="1.25rem" width="40%" />
                    <Skeleton height="1.25rem" width="30%" />
                  </VStack>
                </Box>
                <Skeleton height="0.5rem" width="100%" />
                <Skeleton height="1rem" width="40%" />
              </VStack>
            </Box>
            <Box flex="1">
              <VStack align="stretch" gap={4}>
                <Skeleton height="2.5rem" width="40%" />
                <Skeleton height="4rem" width="100%" />
                <Skeleton height="2.5rem" width="100%" />
                <Skeleton height="1.5rem" width="60%" />
              </VStack>
            </Box>
          </Flex>
        </Box>
      ))}
    </VStack>
  );
};

export default FamilyListingsSkeleton;
