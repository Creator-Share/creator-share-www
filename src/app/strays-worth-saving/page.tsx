'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Box, Flex, Text, Spinner } from '@chakra-ui/react';
import dynamic from 'next/dynamic';
import { Beneficiaries } from '@/types';
import { useFilterStore } from '@/store/filterStore';

const SponsorshipMap = dynamic(() => import('../sponsorships/components/SponsorshipMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] bg-gray-100 animate-pulse rounded-lg" />
  ),
});

const Filters = dynamic(() => import('../sponsorships/components/Filters'));
const BeneficiaryListings = dynamic(() => import('../sponsorships/components/SponsorshipListings'));
const BeneficiaryListingsSkeleton = dynamic(() => 
  import('../sponsorships/components/SponsorshipListings/Skeleton').then(mod => mod.ChildListingsSkeleton)
);

interface Filters {
  gender: string;
  ageRange: [number, number];
  status: string[];
}

const StraySponsorPage = () => {
  const { setStatus } = useFilterStore();

  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [currentBounds, setCurrentBounds] = useState<L.LatLngBounds | undefined>(undefined);
  const [animalsData, setAnimalsData] = useState<Beneficiaries[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ gender: "", ageRange: [0, 20], status: ["New", "Partially Funded"] });

  const listingsRef = useRef<HTMLDivElement>(null);
  const animalListingsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    import("leaflet")
      .then(setL)
      .catch(error => console.error('Error loading Leaflet:', error));
  }, []);


  const handleFilterChange = React.useCallback((newFilters: Partial<Filters>) => {
    const updatedFilters = {
      ...newFilters,
      status: newFilters.status ?? filters.status
    };
    
    setFilters(prev => ({ ...prev, ...updatedFilters }));
    setStatus(updatedFilters.status);
  }, [setStatus, filters.status]);

  const fetchAnimals = React.useCallback(async (filters: Filters) => {
    setLoading(true);
    setError(null);

    try {
      const endpoint = "/api/beneficiaries/getByAgeAndGender";
      const queryParams = new URLSearchParams();

      queryParams.append("beneficiary_type", "ANIMAL");
      queryParams.append("status", filters.status.join(','));

      if (filters.gender) {
        queryParams.append("gender", filters.gender);
      }
      if (filters.ageRange && (filters.ageRange[0] > 0 || filters.ageRange[1] < 20)) {
        queryParams.append("ageRange", filters.ageRange.join(','));
      }

      const url = `${endpoint}?${queryParams.toString()}`;
      console.log('Fetching animals with URL:', url);
      console.log('Filters:', {
        beneficiary_type: "ANIMAL",
        status: filters.status,
        gender: filters.gender,
        ageRange: filters.ageRange
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch animals data");

      const data = await res.json();
      console.log('API response:', {
        status: res.status,
        statusText: res.statusText,
        data: data
      });
      const animals = data.people || data.beneficiary || [];
      if (animals.length > 0) {
        console.log('First animal:', animals[0]);
      }
      setAnimalsData(animals);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnimals(filters);
  }, [fetchAnimals, filters]);

  const handleBoundsChange = React.useCallback((bounds: L.LatLngBounds) => {
    if (!L) return;
    setCurrentBounds(bounds);
  }, [L]);

  const handleMarkerClick = React.useCallback((id: string) => {
    setSelectedAnimalId(id);
    const selectedAnimal = animalsData.find((animal) => animal.id === id);
    
    if (selectedAnimal) {
      setSelectedCountry(selectedAnimal.country);
    }
  }, [animalsData]);

  const onResetView = React.useCallback(() => {
    setSelectedCountry(null);
  }, []);

  return (
    <Box 
      ref={contentRef}
      className="flex flex-col items-center justify-center px-4 md:px-10 py-12 md:py-16"
      suppressHydrationWarning={true}
    >
      <Box className="text-center justify-center my-12">
        <Text className="text-[#1C3C8C] font-semibold text-5xl mb-4">
          Adopt a Stray with Strays Worth Saving
        </Text>
        <Text className="text-base font-normal text-[#03150E99]">
          Adopting a stray animal is a compassionate way to give them a second chance at life. For $39 a month,
        </Text>
        <Text className="md:px-[200px] text-base font-normal text-[#03150E99]">
          you&apos;ll help provide food, shelter, and medical care for a stray animal in need.
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
          <SponsorshipMap
            beneficiaryData={animalsData}
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
              {animalsData.length} Animals Available
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
            <button
              style={{
                marginBottom: "1rem",
                padding: "0.5rem 1rem",
                background: "#e2e8f0",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer"
              }}
              onClick={() => setSelectedCountry(null)}
            >
              Clear Country Filter
            </button>
          </Box>
        </div>
      )}

      {loading ? (
        <Flex justify="center" align="center" minH="20vh">
          <Spinner size="xl" mr={4} />
          <BeneficiaryListingsSkeleton />
        </Flex>
      ) : (
        <>
          {animalsData.length > 0 ? (
            <BeneficiaryListings
              ref={animalListingsRef}
              beneficiaryData={animalsData}
              selectedBeneficiaryId={selectedAnimalId}
              selectedCountry={selectedCountry}
              mapBounds={currentBounds}
              setSelectedBeneficiaryId={setSelectedAnimalId}
              beneficiaryType="ANIMAL"
            />
          ) : (
            <Flex justify="center" align="center" minH="20vh">
              <Text fontSize="xl" color="gray.500">
                No animals listed in this area.
              </Text>
            </Flex>
          )}
        </>
      )}
    </Box>
  );
};

export default React.memo(StraySponsorPage);
