"use client";
import dynamic from "next/dynamic";
import React, { useEffect, useState, useCallback } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import Filters from "@/app/sponsor-a-child/components/Filters";
import ChildListings from "./components/ChildListings";
import { People } from "@/types";

const ChildMap = dynamic(() => import("./components/ChildMap"), { ssr: false });

interface Filters {
  gender: string;
  age: string;
}

const SponsorChild = () => {
  const [childrenData, setChildrenData] = useState<People[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ age: "", gender: "" });

  const fetchChildren = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams();
      if (filters.age) queryParams.append("location", filters.age);
      if (filters.gender) queryParams.append("gender", filters.gender);

      const res = await fetch(`/api/children/get?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch children data");

      const data = await res.json();
      setChildrenData(data.people || []);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Unexpected error occurred";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchChildren();
  }, [filters, fetchChildren]);

  const handleMarkerClick = (id: string) => {
    setSelectedChildId(id);
    const selectedPerson = childrenData.find((child) => child.id === id);
    if (selectedPerson) {
      setSelectedCountry(selectedPerson.country);
    }
  };

  if (loading) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Spinner size="xl" />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex direction="column" justify="center" align="center" minH="100vh">
        <Text color="red.500" mb={4}>
          {error}
        </Text>
      </Flex>
    );
  }

  return (
    <Box className="flex flex-col items-center justify-center" px={{base:4, md: 32}} py={{base:12, md:16}}>
      <Box className="justify-center items-center text-center md:px-[16rem]" mb={16}>
        <Text color="#1C3C8C" fontWeight="semibold" fontSize={{ base: "2xl", md: "4xl" }} mb={4}>
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
      <ChildMap childData={childrenData} onMarkerClick={handleMarkerClick} />
      {selectedCountry && (
        <Box width="100%">
          <Text mb={8} mt={5} fontSize="4xl" color="#1C3C8C" fontWeight="semibold" textAlign="left">
            Showing results from {selectedCountry}
          </Text>
        </Box>
      )}
      <Filters onFilterChange={(newFilters) => setFilters(newFilters)} />
      <ChildListings peopleData={childrenData} selectedChildId={selectedChildId} selectedCountry={selectedCountry} />
    </Box>
  );
};

export default SponsorChild;
