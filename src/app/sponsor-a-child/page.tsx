"use client";
import dynamic from "next/dynamic";
import React, { useEffect, useState, useRef } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import Filters from "./components/Filters";
import ChildListings from "./components/ChildListings";
import { SponsorPeople } from "@/types";
import { ChildListingsSkeleton } from "./components/ChildListings/Skeleton";

const ChildMap = dynamic(() => import("./components/ChildMap"), { ssr: false });
interface Filters {
  gender: string;
  ageRange: [number, number];
  status: string[];
}

const SponsorChild = () => {
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [childrenData, setChildrenData] = useState<SponsorPeople[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [visibleChildren, setVisibleChildren] = useState<SponsorPeople[]>([]);
  const [loading, setLoading] = useState(false);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ gender: "", ageRange: [0, 14], status: ["New", "Partially Funded"] });
  const listingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    import("leaflet").then((module) => {
      setL(module);
    });
  }, []);

  const handleFilterChange = React.useCallback((newFilters: Partial<Filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const fetchChildren = React.useCallback(async (filters: Filters) => {
    setLoading(true);
    setError(null);

    try {
      let endpoint = "/api/children/get";
      const queryParams = new URLSearchParams();
      if (filters.gender || (filters.ageRange && (filters.ageRange[0] > 0 || filters.ageRange[1] < 14)) || filters.status.length > 0) {
        endpoint = "/api/children/getByAgeAndGender";
        if (filters.gender) queryParams.append("gender", filters.gender);
        if (filters.ageRange && (filters.ageRange[0] > 0 || filters.ageRange[1] < 14)) {
          queryParams.append("ageRange", filters.ageRange.join(','));
        }
        if (filters.status.length > 0) {
          queryParams.append("status", filters.status.join(','));
        }
      }

      const res = await fetch(`${endpoint}?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch children data");

      const data = await res.json();
      console.log("API response children:", data.people.length);
      console.log("Current age filter:", filters.ageRange);

      setChildrenData(data.people || []);
      setVisibleChildren(data.people || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChildren(filters);
  }, [fetchChildren, filters]);

  const handleBoundsChange = React.useCallback((bounds: L.LatLngBounds) => {
    if (!L) return;
    setListingsLoading(true);

    const filtered = childrenData.filter((child) => {
      if (!child.location_geo) return false;
      const [lng, lat] = child.location_geo.coordinates;
      return bounds.contains(L.latLng(lat, lng));
    });

    console.log("Map bounds changed:");
    console.log("- Total children from API:", childrenData.length);
    console.log("- Children visible in current map view:", filtered.length);
    console.log("- Current age range filter:", filters.ageRange);

    setVisibleChildren(filtered);
    setListingsLoading(false);
  }, [childrenData, L, filters.ageRange]);

  const handleMarkerClick = (id: string) => {
    setSelectedChildId(id);
    const selectedPerson = childrenData.find((child) => child.id === id);
    
    if (selectedPerson) {
      setSelectedCountry(selectedPerson.country);

      setVisibleChildren(prev => {
        if (!prev.some(child => child.id === id)) {
          return [...prev, selectedPerson];
        }
        return prev;
      });

      const element = document.getElementById(`child-${id}`);
      
      if (element) {
        const headerOffset = 250;
        const elementPosition = element.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: "smooth"
        });

        element.style.boxShadow = '0 0 0 5px #1C3C8C, 0 0 15px rgba(28, 60, 140, 0.7)';
        element.style.transition = 'box-shadow 0.3s ease-in-out';
        element.style.zIndex = '10';

        setTimeout(() => {
          element.style.boxShadow = 'none';
          element.style.zIndex = 'auto';
        }, 3000);
      } else {
        console.error(`Element with id child-${id} not found after delay`);
        if (listingsRef.current) {
          const yOffset = -50;
          const y = listingsRef.current.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      }
    }
  };

  const onResetView = () => {
    setSelectedCountry(null);
    setVisibleChildren(childrenData);
  };

  console.log("Passing to ChildMap:", childrenData.length, "children");

  useEffect(() => {
    // Send height updates to parent
    const sendHeight = () => {
      if (window.self !== window.top) {
        window.parent.postMessage({
          type: 'resize',
          height: document.documentElement.scrollHeight
        }, '*');
      }
    };

    // Send initial height
    sendHeight();

    // Send height on content changes
    const resizeObserver = new ResizeObserver(() => {
      sendHeight();
    });

    resizeObserver.observe(document.documentElement);

    return () => resizeObserver.disconnect();
  }, []);

  return (
    <Box
      className="flex flex-col items-center justify-center"
      px={{ base: 4, md: 32 }}
      py={{ base: 12, md: 16 }}
    >
      <Box className="text-center justify-center my-12">
        <Text className="text-[#1C3C8C] font-semibold text-5xl mb-4">
          Sponsoring a Child with Creator Share
        </Text>
        <Text className="text-base font-normal text-[#03150E99]">
          Sponsoring a child is a personal way to show God&apos;s love to a child in need. For $39 a month,
        </Text>
        <Text className="md:px-[200px] text-base font-normal text-[#03150E99]">you&apos;ll help that child and other vulnerable children in their community to stand tall, free from poverty.</Text>
      </Box>

      {error && (
        <Text color="red.500" mb={4}>
          {error}
        </Text>
      )}

      <Flex 
        width="100%" 
        direction={{ base: "column", md: "row" }}
        gap={{ base: 0, md: 4 }}
        position="relative"
      >
        <Box 
          flex="1"
          position="sticky"
          top="20px"
          height="fit-content"
          zIndex={10}
        >
          <ChildMap
            childData={childrenData}
            onMarkerClick={handleMarkerClick}
            onBoundsChange={handleBoundsChange}
            onResetView={onResetView}
            onFilterChange={handleFilterChange}
          />
          
          <Box 
            position="absolute" 
            bottom={12} 
            right={4} 
            zIndex={1000}
            className="bg-white bg-opacity-90 backdrop-blur-sm rounded-xl p-2 shadow-md"
          >
            <Text fontSize="sm" fontWeight="bold">
              {childrenData.length} Children Available
            </Text>
          </Box>
        </Box>
      </Flex>

      {selectedCountry && (
        <Box width="100%" ref={listingsRef}>
          <Text
            mb={8}
            mt={5}
            fontSize="4xl"
            color="#1C3C8C"
            fontWeight="semibold"
            textAlign="left"
          >
            Showing results from {selectedCountry}
          </Text>
        </Box>
      )}
      {loading ? (
        <ChildListingsSkeleton />
      ) : visibleChildren.length > 0 ? (
        <ChildListings
          peopleData={visibleChildren}
          selectedChildId={selectedChildId}
          selectedCountry={selectedCountry}
        />
      ) : (
        <Flex justify="center" align="center" minH="20vh">
          <Text fontSize="xl" color="gray.500">
            No children listed in this area.
          </Text>
        </Flex>
      )}
      {listingsLoading && (
        <Flex justify="center" align="center" mt={4}>
          <Spinner size="md" />
          <Text ml={2}>Updating listings…</Text>
        </Flex>
      )}
    </Box>
  );
};

export default React.memo(SponsorChild);
