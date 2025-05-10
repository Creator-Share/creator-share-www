"use client";

import React, { useEffect, useState, useRef } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import dynamic from "next/dynamic";
import { SponsorPeople } from "@/types";

const FamilyMap = dynamic(() => import("./components/FamilyMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] bg-gray-100 animate-pulse rounded-lg" />
  ),
});

const Filters = dynamic(() => import("./components/Filters"));
const FamilyListings = dynamic(() => import("./components/FamilyListings"));
const FamilyListingsSkeleton = dynamic(() =>
  import("./components/FamilyListings/Skeleton").then(
    (mod) => mod.FamilyListingsSkeleton
  )
);

interface Filters {
  gender: string;
  ageRange: [number, number];
  status: string[];
}

const SponsorFamily = () => {
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [familyData, setFamilyData] = useState<SponsorPeople[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [visibleFamilies, setVisibleFamilies] = useState<SponsorPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    gender: "",
    ageRange: [0, 14],
    status: ["New", "Partially Funded"],
  });

  const listingsRef = useRef<HTMLDivElement>(null);
  const familyListingsRef = useRef<HTMLDivElement>(null);
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

  const fetchFamilies = React.useCallback(async (filters: Filters) => {
    setLoading(true);
    setError(null);

    try {
      let endpoint = "/api/families/get";
      const queryParams = new URLSearchParams();
      if (
        filters.gender ||
        (filters.ageRange &&
          (filters.ageRange[0] > 0 || filters.ageRange[1] < 14)) ||
        filters.status.length > 0
      ) {
        endpoint = "/api/families/getByAgeAndGender";
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
      if (!res.ok) throw new Error("Failed to fetch families data");

      const data = await res.json();
      setFamilyData(data.people || []);
      setVisibleFamilies(data.people || []);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFamilies(filters);
  }, [fetchFamilies, filters]);

  const handleBoundsChange = React.useCallback(
    (bounds: L.LatLngBounds) => {
      if (!L) return;

      try {
        setListingsLoading(true);

        const filtered = familyData.filter((family) => {
          if (!family.location_geo) return false;
          const [lng, lat] = family.location_geo.coordinates;
          return bounds.contains(L.latLng(lat, lng));
        });

        setVisibleFamilies(filtered);
      } catch (error) {
        console.error("Error handling bounds change:", error);
      } finally {
        setListingsLoading(false);
      }
    },
    [familyData, L]
  );

  const handleMarkerClick = React.useCallback(
    (id: string) => {
      setSelectedFamilyId(id);
      const selectedFamily = familyData.find((family) => family.id === id);

      if (selectedFamily) {
        setSelectedCountry(selectedFamily.country);

        setVisibleFamilies((prev) => {
          if (!prev.some((family) => family.id === id)) {
            return [...prev, selectedFamily];
          }
          return prev;
        });
      }
    },
    [familyData]
  );

  const onResetView = React.useCallback(() => {
    setSelectedCountry(null);
    setVisibleFamilies(familyData);
  }, [familyData]);

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
          Sponsoring a Family with Creator Share
        </Text>
        <Text className="text-base font-normal text-[#03150E99]">
          Sponsoring a family is a powerful way to help those in need. For $39 a month,
        </Text>
        <Text className="md:px-[200px] text-base font-normal text-[#03150E99]">
          you'll help provide essential support to a family struggling with poverty and help create lasting change in their community.
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
          <FamilyMap
            familyData={familyData}
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
              {familyData.length} Families Available
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
        <FamilyListingsSkeleton />
      ) : visibleFamilies.length > 0 ? (
        <FamilyListings
          ref={familyListingsRef}
          peopleData={visibleFamilies}
          selectedFamilyId={selectedFamilyId}
          selectedCountry={selectedCountry}
          setSelectedFamilyId={setSelectedFamilyId}
        />
      ) : (
        <Flex justify="center" align="center" minH="20vh">
          <Text fontSize="xl" color="gray.500">
            No families listed in this area.
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

export default React.memo(SponsorFamily);
