"use client";

import React, { useEffect, useState } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import Filters from "@/app/sponsor-a-child/components/Filters";
import ChildListings from "./components/ChildListings";
import { Child } from "@/types";

interface Filters {
  location: string;
  gender: string;
}

const SponsorChild = () => {
  const [childrenData, setChildrenData] = useState<Child[]>([]);
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
        setChildrenData(data.children || []);
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
      <Filters onFilterChange={handleFiltersChange} />
      <ChildListings childData={childrenData} />
    </Box>
  );
};

export default SponsorChild;
