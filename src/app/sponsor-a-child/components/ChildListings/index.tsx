"use client"
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import ChildCard from "../ChildCard";
import { SponsorPeople } from "@/types";
import { ChildListingsProps } from "@/types/propTypes";

const ChildListings = React.forwardRef<HTMLDivElement, ChildListingsProps>(({
  peopleData,
  selectedChildId,
  selectedCountry,
}, ref) => {
  const [visiblePeople, setVisiblePeople] = useState<SponsorPeople[]>([]);
  const [loadedCount, setLoadedCount] = useState<number>(8);
  
  const handleScroll = useCallback(() => {
    if (
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 500 &&
      loadedCount < peopleData.length
    ) {
      setLoadedCount((prevCount) => Math.min(prevCount + 4, peopleData.length));
    }
  }, [peopleData.length, loadedCount]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);

  useEffect(() => {
    let filteredPeople = peopleData;

    if (selectedCountry) {
      filteredPeople = peopleData.filter(person => person.country === selectedCountry);
    }

    // Only show the loaded amount
    setVisiblePeople(filteredPeople.slice(0, loadedCount));
  }, [peopleData, selectedCountry, loadedCount]);


  return (
    <Box 
      ref={ref}
      width="100%" 
      className="border bg-white rounded-xl" 
      px={{ base: 3, md: 8 }} 
      mt={4}
      style={{ minHeight: visiblePeople.length ? 'auto' : '100px' }}
    >
      <VStack 
        align="stretch" 
        pt={10}
        pb={10}
        gap="1.5rem"
      >
        {visiblePeople.map((people) => (
          <Box key={people.id}>
            <ChildCard
              people={people}
              isSelected={selectedChildId === people.id}
              id={`child-${people.id}`}
            />
          </Box>
        ))}
      </VStack>
    </Box>
  );
});

ChildListings.displayName = 'ChildListings';

export default ChildListings;
