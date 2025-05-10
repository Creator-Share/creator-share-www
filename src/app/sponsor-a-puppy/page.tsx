"use client";

import React, { useEffect, useState, useRef } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import dynamic from "next/dynamic";
import { SponsorPeople } from "@/types";

const PuppyMap = dynamic(() => import("./components/PuppyMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] bg-gray-100 animate-pulse rounded-lg" />
  ),
});

const Filters = dynamic(() => import("./components/Filters"));
const PuppyListings = dynamic(() => import("./components/PuppyListings"));
const PuppyListingsSkeleton = dynamic(() =>
  import("./components/PuppyListings/Skeleton").then(
    (mod) => mod.PuppyListingsSkeleton
  )
);

interface Filters {
  gender: string;
  ageRange: [number, number];
  status: string[];
}

const SponsorPuppy = () => {
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [puppyData, setPuppyData] = useState<SponsorPeople[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [visiblePuppies, setVisiblePuppies] = useState<SponsorPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPuppyId, setSelectedPuppyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    gender: "",
    ageRange: [0, 14],
    status: ["New", "Partially Funded"],
  });

  const listingsRef = useRef<HTMLDivElement>(null);
  const puppyListingsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    import("leaflet")
      .then(setL)
      .catch((error) => console.error("Error loading Leaflet:", error));
  }, []);

  const handleFilterChange = React.useCallback(
    (newFilters: Partial<Filters>) => {
      setFilters((prev) => ({ ...prev, ...newFilters }));
    },
    []
  );

  const fetchPuppies = React.useCallback(async (filters: Filters) => {
    setLoading(true);
    setError(null);

    try {
      let endpoint = "/api/puppies/get";
      const queryParams = new URLSearchParams();
      if (
        filters.gender ||
        (filters.ageRange &&
          (filters.ageRange[0] > 0 || filters.ageRange[1] < 14)) ||
        filters.status.length > 0
      ) {
        endpoint = "/api/puppies/getByAgeAndGender";
        if (filters.gender) queryParams.append("gender", filters.gender);
        if (
          filters.ageRange &&
          (filters.ageRange[0] > 0 || filters.ageRange[1] < 14)
        ) {
          queryParams.append("ageRange", filters.ageRange.join(","));
        }
        if (filters.status.length > 0) {
          queryParams.append("status", filters.status.join(","));
        }
      }

      const res = await fetch(`${endpoint}?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch puppies data");

      const data = await res.json();
      setPuppyData(data.people || []);
      setVisiblePuppies(data.people || []);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPuppies(filters);
  }, [fetchPuppies, filters]);

  const handleBoundsChange = React.useCallback(
    (bounds: L.LatLngBounds) => {
      if (!L) return;

      try {
        setListingsLoading(true);

        const filtered = puppyData.filter((puppy) => {
          if (!puppy.location_geo) return false;
          const [lng, lat] = puppy.location_geo.coordinates;
          return bounds.contains(L.latLng(lat, lng));
        });

        setVisiblePuppies(filtered);
      } catch (error) {
        console.error("Error handling bounds change:", error);
      } finally {
        setListingsLoading(false);
      }
    },
    [puppyData, L]
  );

  const handleMarkerClick = React.useCallback(
    (id: string) => {
      setSelectedPuppyId(id);
      const selectedPuppy = puppyData.find((puppy) => puppy.id === id);

      if (selectedPuppy) {
        setSelectedCountry(selectedPuppy.country);

        setVisiblePuppies((prev) => {
          if (!prev.some((puppy) => puppy.id === id)) {
            return [...prev, selectedPuppy];
          }
          return prev;
        });
      }
    },
    [puppyData]
  );

  const onResetView = React.useCallback(() => {
    setSelectedCountry(null);
    setVisiblePuppies(puppyData);
  }, [puppyData]);

  const sendHeight = React.useCallback(() => {
    if (window.self === window.top) return;

    try {
      requestAnimationFrame(() => {
        const height = Math.max(
          document.documentElement.offsetHeight,
          document.documentElement.scrollHeight
        );

        const urlParams = new URLSearchParams(window.location.search);
        const parentOrigin = urlParams.get("parentOrigin") || "*";

        window.parent.postMessage(
          {
            type: "resize",
            height: height,
          },
          parentOrigin
        );

        console.log("[Child Frame] Sent height:", height);
      });
    } catch (error) {
      console.error("[Child Frame] Error sending height:", error);
    }
  }, []);

  useEffect(() => {
    if (window.self === window.top) return;

    let resizeObserver: ResizeObserver | null = null;
    let resizeTimeout: NodeJS.Timeout | null = null;

    try {
      const handleMessage = (event: MessageEvent) => {
        if (
          !event.origin.includes("share-tanzania.webflow.io") &&
          !event.origin.includes("localhost:3000")
        ) {
          return;
        }

        if (event.data?.type === "requestHeight") {
          sendHeight();
        }
      };

      window.addEventListener("message", handleMessage);

      const debouncedSendHeight = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(sendHeight, 100);
      };

      const observer = new ResizeObserver(debouncedSendHeight);
      resizeObserver = observer;

      observer.observe(document.documentElement);

      window.addEventListener("load", sendHeight);
      setTimeout(sendHeight, 100);
      setTimeout(sendHeight, 500);
      setTimeout(sendHeight, 1000);

      return () => {
        window.removeEventListener("message", handleMessage);
        window.removeEventListener("load", sendHeight);
        if (resizeObserver) resizeObserver.disconnect();
        if (resizeTimeout) clearTimeout(resizeTimeout);
      };
    } catch (error) {
      console.error("[Child Frame] Error setting up resize handling:", error);
    }
  }, [sendHeight]);

  return (
    <Box
      ref={contentRef}
      className="flex flex-col items-center justify-center px-4 md:px-32 py-12 md:py-16"
      suppressHydrationWarning={true}
    >
      <Box className="text-center justify-center my-12">
        <Text className="text-[#1C3C8C] font-semibold text-5xl mb-4">
          Sponsoring a Puppy with Creator Share
        </Text>
        <Text className="text-base font-normal text-[#03150E99]">
          Sponsoring a puppy is a compassionate way to help animals in need. For $39 a month,
        </Text>
        <Text className="md:px-[200px] text-base font-normal text-[#03150E99]">
          you'll help provide food, shelter, medical care, and love to a puppy and support other rescue animals in their community.
        </Text>
      </Box>

      {error && <Text color="red.500" mb={4}>{error}</Text>}

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
          <PuppyMap
            puppyData={puppyData}
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
              {puppyData.length} Puppies Available
            </Text>
          </Box>
        </Box>
      </Flex>

      {selectedCountry && (
        <div ref={listingsRef}>
          <Box width="100%">
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
        </div>
      )}

      {loading ? (
        <PuppyListingsSkeleton />
      ) : visiblePuppies.length > 0 ? (
        <PuppyListings
          ref={puppyListingsRef}
          peopleData={visiblePuppies}
          selectedPuppyId={selectedPuppyId}
          selectedCountry={selectedCountry}
          setSelectedPuppyId={setSelectedPuppyId}
        />
      ) : (
        <Flex justify="center" align="center" minH="20vh">
          <Text fontSize="xl" color="gray.500">
            No puppies listed in this area.
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

export default React.memo(SponsorPuppy);
