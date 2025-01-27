"use client";

import React, { useEffect, useState } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import Filters from "@/app/sponsor-a-child/components/Filters";
import ChildListings from "./components/ChildListings";
import { People } from "@/types";

interface Filters {
  location: string;
  gender: string;
}

const SponsorChild = () => {
  const [childrenData, setChildrenData] = useState<People[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleFiltersChange = (filters: Filters) => {
    console.log("Applied Filters:", filters);
  };

  useEffect(() => {
    const fetchChildren = async () => {
      try {
        const res = await fetch("/api/children/get");
        if (!res.ok) throw new Error("Failed to fetch children data");
        const data = await res.json();
        setChildrenData(data.people || []);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message || "Unexpected error occurred");
        } else {
          setError("Unexpected error occurred");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchChildren();
  }, []);

  if (loading) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Spinner size="xl" />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Text color="red.500">{error}</Text>
      </Flex>
    );
  }

  return (
    <Box className="flex flex-col items-center justify-center" px={32} py={16}>
      <Box className="justify-center items-center text-center px-[16rem]" mb={16}>
        <Text
          color="#1C3C8C"
          fontWeight="semibold"
          fontSize={{ base: "2xl", md: "4xl" }}
          mb={4}
        >
          Sponsoring a Child with Creator Share
        </Text>
        <Text fontSize="base" color="gray.700" lineHeight="1.8">
          Sponsoring a child is a personal way to show God&apos;s love to a child in
          need. For{" "}
          <Text as="span" fontWeight="bold" color="black">
            $39 a month
          </Text>
          , you&apos;ll help that child and other vulnerable children in their
          community to stand tall, free from poverty.
        </Text>
      </Box>
      <Filters onFilterChange={handleFiltersChange} />
      <ChildListings peopleData={childrenData} />
    </Box>
  );
};

export default SponsorChild;
