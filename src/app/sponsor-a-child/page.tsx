"use client"
import React, { useEffect, useState, useCallback } from "react";
import { Box, Flex, Text, Spinner, Button } from "@chakra-ui/react";
import Filters from "@/app/sponsor-a-child/components/Filters";
import ChildListings from "./components/ChildListings";
import ChildMap from "./components/ChildMap";
import { People } from "@/types";

interface Filters {
  gender: string;
  age: string;
}

interface ViewportBounds {
  ne: number[];
  sw: number[];
}

const SponsorChild = () => {
  const [childrenData, setChildrenData] = useState<People[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({ age: "", gender: "" });

  const fetchChildren = useCallback(
    async (bounds?: ViewportBounds) => {
      setLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams();

        if (bounds) {
          queryParams.append("ne", JSON.stringify(bounds.ne));
          queryParams.append("sw", JSON.stringify(bounds.sw));
        }

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
    },
    [filters]
  );

  useEffect(() => {
    fetchChildren(viewportBounds || undefined);
  }, [viewportBounds, filters, fetchChildren]);

  const handleMarkerClick = (id: string) => {
    setSelectedChildId(id);
    
    const selectedPerson = childrenData.find(child => child.id === id);
    if (selectedPerson) {
      setSelectedCountry(selectedPerson.country);
    }

    const element = document.getElementById(`child-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const retryFetch = () => {
    fetchChildren(viewportBounds || undefined);
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
        <Button colorScheme="blue" onClick={retryFetch}>
          Retry
        </Button>
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
      <ChildMap
        childData={childrenData}
        onViewportChange={setViewportBounds}
        onMarkerClick={handleMarkerClick}
      />

      <Filters
        onFilterChange={(newFilters) => {
          setFilters(newFilters);
        }}
      />

      <ChildListings
        peopleData={childrenData}
        selectedChildId={selectedChildId}
        selectedCountry={selectedCountry}
      />
    </Box>
  );
};

export default SponsorChild;
