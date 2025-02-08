"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import Filters from "./components/Filters";
import ChildListings from "./components/ChildListings";
import { People } from "@/types";

const ChildMap = dynamic(() => import("./components/ChildMap"), { ssr: false });

interface Filters {
  gender: string;
  age: string;
}

const SponsorChild = () => {
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [childrenData, setChildrenData] = useState<People[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [visibleChildren, setVisibleChildren] = useState<People[]>([]);
  const [loading, setLoading] = useState(false);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ age: "", gender: "" });

  useEffect(() => {
    import("leaflet").then((module) => {
      setL(module);
    });
  }, []);

  const fetchChildren = async (filters: Filters) => {
    setLoading(true);
    setError(null);

    try {
      let endpoint = "/api/children/get";
      const queryParams = new URLSearchParams();

      if (filters.gender || filters.age) {
        endpoint = "/api/children/getByAgeAndGender";
        if (filters.gender) queryParams.append("gender", filters.gender);
        if (filters.age) queryParams.append("age", filters.age);
      }

      const res = await fetch(`${endpoint}?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch children data");

      const data = await res.json();
      setChildrenData(data.people || []);
      setVisibleChildren(data.people || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChildren(filters);
  }, [filters]);

  const handleBoundsChange = (bounds: L.LatLngBounds) => {
    if (!L) return;
    setListingsLoading(true);
    const filtered = childrenData.filter((child) => {
      const [lng, lat] = child.location_geo.coordinates;
      return bounds.contains(L.latLng(lat, lng));
    });
    setTimeout(() => {
      setVisibleChildren(filtered);
      setListingsLoading(false);
    }, 500);
  };

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
    <Box className="flex flex-col items-center justify-center" px={{ base: 4, md: 32 }} py={{ base: 12, md: 16 }}>
      <Filters
        onFilterChange={(newFilters) => setFilters((prev) => ({ ...prev, ...newFilters }))}
      />
      <ChildMap
        childData={childrenData}
        onMarkerClick={handleMarkerClick}
        onBoundsChange={handleBoundsChange}
      />
      {selectedCountry && (
        <Box width="100%">
          <Text mb={8} mt={5} fontSize="4xl" color="#1C3C8C" fontWeight="semibold" textAlign="left">
            Showing results from {selectedCountry}
          </Text>
        </Box>
      )}
      {listingsLoading ? (
        <Flex justify="center" align="center" minH="20vh">
          <Spinner size="lg" />
        </Flex>
      ) : visibleChildren.length > 0 ? (
        <ChildListings peopleData={visibleChildren} selectedChildId={selectedChildId} selectedCountry={selectedCountry} />
      ) : (
        <Flex justify="center" align="center" minH="20vh">
          <Text fontSize="xl" color="gray.500">
            No children listed in this area.
          </Text>
        </Flex>
      )}
    </Box>
  );
};

export default SponsorChild;
