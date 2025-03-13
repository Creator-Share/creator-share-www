"use client"
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import ChildCard from "../ChildCard";
import { SponsorPeople } from "@/types";
import { ChildListingsProps } from "@/types/propTypes";

const ChildListings: React.FC<ChildListingsProps> = React.memo(({
  peopleData,
  selectedChildId,
  selectedCountry,
}) => {
  const [visiblePeople, setVisiblePeople] = useState<SponsorPeople[]>([]);
  const [loadedCount, setLoadedCount] = useState<number>(4);

  const handleScroll = useCallback(() => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 10) {
      setLoadedCount((prevCount) => Math.min(prevCount + 2, peopleData.length));
    }
  }, [peopleData.length]);

  useEffect(() => {
    let filteredPeople = peopleData;

    if (selectedCountry) {
      filteredPeople = peopleData.filter(person => person.country === selectedCountry);
    }

    setVisiblePeople(filteredPeople.slice(0, loadedCount));
  }, [peopleData, selectedCountry, loadedCount]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);

  useEffect(() => {
    setVisiblePeople(peopleData);
  }, [peopleData]);

  return (
    <Box width="100%" className="border border-b-none bg-white rounded-2xl" px={{ base: 3, md: 8 }} mt={4}>
      <VStack align="stretch" pt={10}>
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
