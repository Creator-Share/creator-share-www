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
  const isInIframe = window.self !== window.top;
  
  useEffect(() => {
    let filteredPeople = peopleData;

    if (selectedCountry) {
      filteredPeople = peopleData.filter(person => person.country === selectedCountry);
    }

    setVisiblePeople(isInIframe ? filteredPeople : filteredPeople.slice(0, 8));

    if (isInIframe) {
      setTimeout(() => {
        window.parent.postMessage({
          type: 'resize',
          height: document.documentElement.scrollHeight + 200
        }, '*');
      }, 100);
    }
  }, [peopleData, selectedCountry, isInIframe]);

  const handleScroll = useCallback(() => {
    if (isInIframe) return;

    if (
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 500 &&
      visiblePeople.length < peopleData.length
    ) {
      setVisiblePeople(prev => [
        ...prev,
        ...peopleData.slice(prev.length, prev.length + 8)
      ]);
    }
  }, [peopleData, visiblePeople.length, isInIframe]);

  useEffect(() => {
    if (!isInIframe) {
      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll, isInIframe]);

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
