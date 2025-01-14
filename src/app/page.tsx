"use client";

import { PageWrapper } from "@/components/PageWrapper";
import { Box, Container, Heading, Text, VStack } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";

async function fetchHello() {
  const res = await fetch("/api/hello");
  if (!res.ok) throw new Error("Network response was not ok");
  return res.json();
}

export default function Home() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hello"],
    queryFn: fetchHello,
  });

  return (
    <PageWrapper>
      <Container maxW="container.xl" py={10}>
        <VStack gap={8} align="stretch">
          <Box textAlign="center">
            <Heading as="h1" size="2xl" mb={4}>
              Welcome to Creator Share
            </Heading>
            <Text fontSize="xl" color="gray.500">
              {/* Your platform for sharing creative work */}
            </Text>
          </Box>

          <Box textAlign="center">
            <Box mt={8}>
              <Heading as="h2" size="md" mb={4}>
                API Test
              </Heading>
              {isLoading && <Text>Loading...</Text>}
              {error && (
                <Text color="red.500">Error: {(error as Error).message}</Text>
              )}
              {data && <Text color="green.500">Response: {data.message}</Text>}
            </Box>
          </Box>
        </VStack>
      </Container>
    </PageWrapper>
  );
}
