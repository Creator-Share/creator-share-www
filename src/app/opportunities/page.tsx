"use client";

import { PageWrapper } from "@/components/PageWrapper";
import {
  Box,
  Container,
  Heading,
  Text,
  SimpleGrid,
  Badge,
  VStack,
  HStack,
} from "@chakra-ui/react";
import { FaInfoCircle, FaDollarSign, FaClock } from "react-icons/fa";

const opportunities = [
  {
    title: "Creative Director Needed",
    company: "Design Studio X",
    location: "Remote",
    type: "Full-time",
    salary: "$80k - $120k",
    deadline: "2 weeks left",
    tags: ["Design", "Leadership", "Creative"],
  },
  {
    title: "Content Creator Partnership",
    company: "Social Media Co",
    location: "Flexible",
    type: "Contract",
    salary: "Revenue Share",
    deadline: "1 month left",
    tags: ["Content", "Social Media", "Creative"],
  },
  {
    title: "NFT Artist Collaboration",
    company: "Web3 Gallery",
    location: "Remote",
    type: "Project",
    salary: "Commission",
    deadline: "3 weeks left",
    tags: ["NFT", "Digital Art", "Blockchain"],
  },
  {
    title: "Photography Workshop Lead",
    company: "Creative Academy",
    location: "Hybrid",
    type: "Part-time",
    salary: "$50/hour",
    deadline: "5 days left",
    tags: ["Photography", "Education", "Workshop"],
  },
];

export default function OpportunitiesPage() {
  return (
    <PageWrapper>
      <Container maxW="container.xl" py={8}>
        <VStack gap={8} align="stretch">
          <Box textAlign="center" mb={8}>
            <Heading as="h1" size="2xl" mb={4}>
              Creative Opportunities
            </Heading>
            <Text fontSize="xl" color="gray.500">
              Discover opportunities to collaborate, create, and grow
            </Text>
          </Box>

          <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap={6}>
            {opportunities.map((opp, index) => (
              <Box
                key={index}
                p={6}
                bg="bg.subtle"
                borderRadius="lg"
                border="1px"
                _hover={{
                  transform: "translateY(-4px)",
                  shadow: "md",
                  transition: "all 0.2s",
                }}
              >
                <VStack align="stretch" gap={4}>
                  <Heading as="h3" size="md">
                    {opp.title}
                  </Heading>

                  <Text fontSize="md">{opp.company}</Text>

                  <HStack gap={4}>
                    <HStack>
                      <FaInfoCircle />
                      <Text fontSize="sm">{opp.location}</Text>
                    </HStack>
                    <HStack>
                      <FaDollarSign />
                      <Text fontSize="sm">{opp.salary}</Text>
                    </HStack>
                  </HStack>

                  <HStack>
                    <FaClock />
                    <Text fontSize="sm" color="orange.500">
                      {opp.deadline}
                    </Text>
                  </HStack>

                  <HStack gap={2} flexWrap="wrap">
                    {opp.tags.map((tag) => (
                      <Badge
                        key={tag}
                        colorScheme="blue"
                        variant="subtle"
                        px={2}
                        py={1}
                        borderRadius="full"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </HStack>
                </VStack>
              </Box>
            ))}
          </SimpleGrid>
        </VStack>
      </Container>
    </PageWrapper>
  );
}
