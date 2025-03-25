'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Box, Flex, Text, Spinner } from '@chakra-ui/react';
import dynamic from 'next/dynamic';
import { SponsorPeople } from '@/types';

// Components that require client-side only rendering
const ChildMap = dynamic(() => import('./components/ChildMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] bg-gray-100 animate-pulse rounded-lg" />
  ),
});

// These components can be rendered on server but may need client interactivity
const Filters = dynamic(() => import('./components/Filters'));
const ChildListings = dynamic(() => import('./components/ChildListings'));
const ChildListingsSkeleton = dynamic(() => 
  import('./components/ChildListings/Skeleton').then(mod => mod.ChildListingsSkeleton)
);

interface Filters {
  gender: string;
  ageRange: [number, number];
  status: string[];
}

const SponsorChild = () => {
  // State
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [childrenData, setChildrenData] = useState<SponsorPeople[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [visibleChildren, setVisibleChildren] = useState<SponsorPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ gender: "", ageRange: [0, 14], status: ["New", "Partially Funded"] });
  
  // Refs
  const listingsRef = useRef<HTMLDivElement>(null);
  const childListingsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Load Leaflet on mount
  useEffect(() => {
    import("leaflet")
      .then(setL)
      .catch(error => console.error('Error loading Leaflet:', error));
  }, []);

  const handleFilterChange = React.useCallback((newFilters: Partial<Filters>) => {
    // Update filters
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

    try {
      setListingsLoading(true);

      const filtered = childrenData.filter((child) => {
        if (!child.location_geo) return false;
        const [lng, lat] = child.location_geo.coordinates;
        return bounds.contains(L.latLng(lat, lng));
      });

      setVisibleChildren(filtered);
    } catch (error) {
      console.error('Error handling bounds change:', error);
    } finally {
      setListingsLoading(false);
    }
  }, [childrenData, L]);

  const handleMarkerClick = React.useCallback((id: string) => {
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
    }
  }, [childrenData]);

  const onResetView = React.useCallback(() => {
    setSelectedCountry(null);
    setVisibleChildren(childrenData);
  }, [childrenData]);

  // Handle iframe height updates
  const sendHeight = React.useCallback(() => {
    if (window.self === window.top) return;

    try {
      // Get all relevant heights
      const contentHeight = contentRef.current?.offsetHeight || 0;
      const listingsHeight = listingsRef.current?.offsetHeight || 0;
      const childListingsHeight = childListingsRef.current?.offsetHeight || 0;

      // Log individual heights for debugging
      console.log('[Child Frame] Heights:', {
        contentHeight,
        listingsHeight,
        childListingsHeight,
      });

      // Calculate new height based only on actual content
      const newHeight = Math.max(
        contentHeight,
        listingsHeight,
        childListingsHeight
      );

      // Get parent origin from URL params
      const urlParams = new URLSearchParams(window.location.search);
      const parentOrigin = urlParams.get('parentOrigin') || '*';

      // Send height update
      window.parent.postMessage({
        type: 'resize',
        height: newHeight
      }, parentOrigin);

      console.log('[Child Frame] Sent height:', newHeight);
    } catch (error) {
      console.error('[Child Frame] Error sending height:', error);
    }
  }, []);

  // Setup iframe resizing
  useEffect(() => {
    if (window.self === window.top) return;

    let resizeObserver: ResizeObserver | null = null;
    let resizeTimeout: NodeJS.Timeout | null = null;

    try {
      // Handle height request messages
      const handleMessage = (event: MessageEvent) => {
        if (!event.origin.includes('share-tanzania.webflow.io') && 
            !event.origin.includes('localhost:3000')) {
          return;
        }

        if (event.data?.type === 'requestHeight') {
          sendHeight();
        }
      };

      window.addEventListener('message', handleMessage);

      // Setup resize observer with debounce
      const debouncedSendHeight = () => {
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(sendHeight, 100);
      };

      const observer = new ResizeObserver(debouncedSendHeight);
      resizeObserver = observer;

      // Only observe content-specific elements
      [
        contentRef.current,
        listingsRef.current,
        childListingsRef.current
      ].forEach(element => {
        if (element) observer.observe(element);
      });

      // Send initial height
      sendHeight();

      return () => {
        window.removeEventListener('message', handleMessage);
        if (resizeObserver) resizeObserver.disconnect();
        if (resizeTimeout) clearTimeout(resizeTimeout);
      };
    } catch (error) {
      console.error('[Child Frame] Error setting up resize handling:', error);
    }
  }, [sendHeight]);

  return (
    <Box 
      ref={contentRef}
      className="flex flex-col items-center justify-center px-4 md:px-32 py-12 md:py-16"
    >
      <Box className="text-center justify-center my-12">
        <Text className="text-[#1C3C8C] font-semibold text-5xl mb-4">
          Sponsoring a Child with Creator Share
        </Text>
        <Text className="text-base font-normal text-[#03150E99]">
          Sponsoring a child is a personal way to show God&apos;s love to a child in need. For $39 a month,
        </Text>
        <Text className="md:px-[200px] text-base font-normal text-[#03150E99]">
          you&apos;ll help that child and other vulnerable children in their community to stand tall, free from poverty.
        </Text>
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
        <ChildListingsSkeleton />
      ) : visibleChildren.length > 0 ? (
        <ChildListings
          ref={childListingsRef}
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
