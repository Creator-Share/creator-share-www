"use client";

import { PageWrapper } from "@/components/PageWrapper";
import {
  Box,
  Container,
  Heading,
  HStack,
  Icon,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import React, { useState, useEffect } from "react";

async function fetchHello() {
  const res = await fetch("/api/hello");
  if (!res.ok) throw new Error("Network response was not ok");
  return res.json();
}

const IconComponent = ({ iconName }) => {
  const [Icon, setIcon] = useState(null);

  useEffect(() => {
    const loadIcon = async () => {
      try {
        const { [iconName]: LoadedIcon } = await import("react-icons/fa");
        setIcon(() => LoadedIcon);
      } catch (error) {
        console.error("Error loading icon:", error);
      }
    };

    loadIcon();
  }, [iconName]);

  if (!Icon) return null; // Ensure a single element is returned

  return <Icon w={10} />;
};

export default function Home() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hello"],
    queryFn: fetchHello,
  });

  return (
    <PageWrapper>
      <Container maxW="1200px" py={10}>
        <VStack gap={8} align="stretch">
          <Box textAlign="center">
            <Heading as="h1" size="2xl" mb={4}>
              Welcome, friend
            </Heading>
            <Text fontSize="md" color="gray.500">
              The Creator Share Foundation is dedicated to bringing hope and
              support to special needs children in developing countries, often
              referred to as the "invisible children." These children endure
              unimaginable suffering in environments devoid of basic necessities
              such as water, electricity, and adequate shelter. In addition to
              the hardships faced by loving families trying to care for them,
              many of these children experience severe neglect due to economic
              hardship or cultural beliefs. Tragically, some are confined in
              dark rooms or restrained, left isolated with no means to call for
              help. These children may endure such conditions for years, either
              passing away in their suffering or, by God’s grace, being
              discovered by our team. Founded by John St. Julien, The Creator
              Share Foundation is driven by a mission to rescue these vulnerable
              children and create innovative solutions and infrastructure in the
              form of our children's villages and homes. Our aim is to extend
              love, support, healing, and faith to the most marginalized members
              of our global community.
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

          <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={10} mt={8}>
            {[
              {
                title: "Education",
                icon: "FaBook",
                description:
                  "Support educational programs for children in need.",
              },
              {
                title: "Healthcare",
                icon: "FaHeartbeat",
                description:
                  "Provide medical care and supplies to underserved communities.",
              },
              {
                title: "Clean Water",
                icon: "FaTint",
                description: "Help build wells and water purification systems.",
              },
              {
                title: "Food Security",
                icon: "FaAppleAlt",
                description: "Ensure access to nutritious food for families.",
              },
              {
                title: "Shelter",
                icon: "FaHome",
                description: "Build safe and secure homes for those without.",
              },
              {
                title: "Mental Health",
                icon: "FaBrain",
                description: "Support mental health services and counseling.",
              },
              {
                title: "Disaster Relief",
                icon: "FaHandsHelping",
                description:
                  "Provide aid to those affected by natural disasters.",
              },
              {
                title: "Animal Welfare",
                icon: "FaPaw",
                description: "Protect and care for animals in need.",
              },
              {
                title: "Environmental Conservation",
                icon: "FaLeaf",
                description: "Support efforts to preserve our planet.",
              },
              {
                title: "Arts and Culture",
                icon: "FaPalette",
                description: "Promote arts and cultural programs.",
              },
              {
                title: "Community Development",
                icon: "FaUsers",
                description: "Help build strong and resilient communities.",
              },
              {
                title: "Human Rights",
                icon: "FaBalanceScale",
                description: "Advocate for justice and equality for all.",
              },
            ].map((cause) => (
              <Box
                key={cause.title}
                p={6}
                shadow="md"
                bg="bg.subtle"
                borderRadius="lg"
                border="1px"
                _hover={{
                  transition: "all 0.2s",
                  transform: "translateY(-4px)",
                  shadow: "lg",
                }}
              >
                <HStack gap={4} align="center" mb={2}>
                  <IconComponent iconName={cause.icon} />
                  <Heading fontSize="xl">{cause.title}</Heading>
                </HStack>
                <Text mt={4}>{cause.description}</Text>
              </Box>
            ))}
          </SimpleGrid>
        </VStack>
      </Container>
    </PageWrapper>
  );
}
