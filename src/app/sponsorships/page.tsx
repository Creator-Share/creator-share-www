"use client";

import React, { useEffect, useState, useRef } from "react";
import { Box, Flex, Text, Button } from "@chakra-ui/react";
import dynamic from "next/dynamic";
import { Beneficiaries } from "@/types";
import { FaCaretDown, FaCaretUp, FaCompass } from "react-icons/fa";

// Map temporarily disabled from UI; keeping dynamic import commented for future multi-location rollout.
// const SponsorshipMap = dynamic(() => import('./components/SponsorshipMap'), {
//   ssr: false,
//   loading: () => (
//     <div className="w-full h-[400px] bg-gray-100 animate-pulse rounded-lg" />
//   ),
// });

const Filters = dynamic(() => import("./components/Filters"));
const ChildListings = dynamic(() => import("./components/SponsorshipListings"));
const ChildListingsSkeleton = dynamic(() =>
  import("./components/SponsorshipListings/Skeleton").then(
    (mod) => mod.ChildListingsSkeleton
  )
);

interface Filters {
  gender: string;
  ageRange: [number, number];
  status: string[];
}

const SponsorChild = () => {
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [currentBounds, setCurrentBounds] = useState<
    L.LatLngBounds | undefined
  >(undefined);
  const [childrenData, setChildrenData] = useState<Beneficiaries[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    gender: "",
    ageRange: [0, 14],
    status: ["New", "Partially Funded"],
  });
  // Map visibility/state no longer needed with toolbar layout
  // const [showMap, setShowMap] = useState<boolean>(true);
  const [isMapSticky, setIsMapSticky] = useState(false);
  const listingsRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const childListingsRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    import("leaflet")
      .then(setL)
      .catch((error) => console.error("Error loading Leaflet:", error));
  }, []);

  // Fixed scroll listener to detect when we reach the listings section
  useEffect(() => {
    const handleScroll = () => {
      if (!listingsRef.current) return;

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Debounce scroll events
      scrollTimeoutRef.current = setTimeout(() => {
        if (!listingsRef.current) return;

        const listingsRect = listingsRef.current.getBoundingClientRect();

        // Make map sticky only when the top of the listings section
        // reaches the top of the viewport (not just the bottom)
        setIsMapSticky(listingsRect.top <= 0);
      }, 10);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    // Check initial state
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Map visibility removed; keep sticky state false
  useEffect(() => {
    setIsMapSticky(false);
  }, []);

  const handleFilterChange = React.useCallback(
    (newFilters: Partial<Filters>) => {
      setFilters((prev) => ({ ...prev, ...newFilters }));
    },
    []
  );

  const fetchChildren = React.useCallback(async (filters: Filters) => {
    setLoading(true);
    setError(null);

    try {
      let endpoint = "/api/beneficiaries/get";
      const queryParams = new URLSearchParams();
      if (
        filters.gender ||
        (filters.ageRange &&
          (filters.ageRange[0] > 0 || filters.ageRange[1] < 14)) ||
        filters.status.length > 0
      ) {
        endpoint = "/api/beneficiaries/getByAgeAndGender";
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
      if (!res.ok) throw new Error("Failed to fetch children data");

      const data = await res.json();
      setChildrenData(data.people || []);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChildren(filters);
  }, [fetchChildren, filters]);

  const handleBoundsChange = React.useCallback(
    (bounds: L.LatLngBounds) => {
      if (!L) return;
      setCurrentBounds(bounds);
    },
    [L]
  );

  const handleMarkerClick = React.useCallback(
    (id: string) => {
      setSelectedChildId(id);
      const selectedPerson = childrenData.find((child) => child.id === id);

      if (selectedPerson) {
        setSelectedCountry(selectedPerson.country);
      }
    },
    [childrenData]
  );

  const onResetView = React.useCallback(() => {
    setSelectedCountry(null);
  }, []);

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
        // TODO: Respect .env instead of hardcode
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
    <Box className="px-6 py-6 md:px-12 md:py-12">
      <Box className="text-center justify-center my-12">
        <Text className="text-[#1C3C8C] font-semibold text-5xl mb-4">
          Sponsoring a Child with Creator Share
        </Text>
        <Text className="text-base font-normal text-[#03150E99]">
          Sponsoring a child brings hope to those facing isolation, poverty, or
          neglect. Your support provides a safe environment where vulnerable
          children.
        </Text>
      </Box>

      {error && (
        <Text color="red.500" mb={4}>
          {error}
        </Text>
      )}

      {/* Map (temporarily disabled) - keeping embed for future multi-location rollout */}
      {/**
       * <Box
       *   ref={mapRef}
       *   position={{ base: isMapSticky ? "fixed" : "relative", md: "relative" }}
       *   top={{ base: isMapSticky ? "0" : "auto", md: "auto" }}
       *   left={{ base: isMapSticky ? "0" : "auto", md: "auto" }}
       *   right={{ base: isMapSticky ? "0" : "auto", md: "auto" }}
       *   width={{ base: isMapSticky ? "100%" : "auto", md: "auto" }}
       *   height={{ base: "auto", md: "auto" }}
       *   zIndex={{ base: isMapSticky ? 50 : 10, md: 10 }}
       *   bg={{ base: isMapSticky ? "transparent" : "transparent", md: "transparent" }}
       *   borderColor={{ base: isMapSticky ? "gray.200" : "transparent", md: "transparent" }}
       *   pb={{ base: isMapSticky ? 4 : 0, md: 0 }}
       *   px={{ base: isMapSticky ? 6 : 0, md: 0 }}
       *   transition="all 0.3s ease"
       *   className='flex flex-col w-full'
       *   style={{ transform: isMapSticky ? 'translateZ(0)' : 'none' }}
       * >
       *   <SponsorshipMap
       *     beneficiaryData={childrenData}
       *     onMarkerClick={handleMarkerClick}
       *     onBoundsChange={handleBoundsChange}
       *     onResetView={onResetView}
       *     onFilterChange={handleFilterChange}
       *   />
       * </Box>
       */}

      {/* Toolbar: Always-visible filters replacing map UI. */}
      <Box ref={mapRef} className="w-full">
        <Box className="w-full max-w-7xl mx-auto">
          <Box
            className="bg-white border rounded-2xl shadow-sm"
            p={{ base: 3, md: 4 }}
          >
            <Filters onFilterChange={handleFilterChange} />
          </Box>
        </Box>
      </Box>

      {/* Content area */}
      <Box>
        {selectedCountry && (
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
        )}

        {/* The actual listings section - this is where sticky behavior triggers */}
        <div ref={listingsRef}>
          {loading ? (
            <Box className="flex justify-center items-center min-h-20vh">
              <ChildListingsSkeleton />
            </Box>
          ) : (
            <>
              {childrenData.length > 0 ? (
                <ChildListings
                  ref={childListingsRef}
                  beneficiaryData={childrenData}
                  selectedBeneficiaryId={selectedChildId}
                  selectedCountry={selectedCountry}
                  mapBounds={currentBounds}
                  setSelectedBeneficiaryId={setSelectedChildId}
                />
              ) : (
                <Flex justify="center" align="center" minH="20vh">
                  <Text fontSize="xl" color="gray.500">
                    No children listed in this area.
                  </Text>
                </Flex>
              )}
            </>
          )}
        </div>
      </Box>
    </Box>
  );
};

export default React.memo(SponsorChild);
