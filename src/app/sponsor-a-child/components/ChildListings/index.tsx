"use client"
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import ChildCard from "../ChildCard";
import { People } from "@/types";

interface ChildListingsProps {
  peopleData: People[];
  selectedChildId: string | null;
  selectedCountry: string | null;
}

const ChildListings: React.FC<ChildListingsProps> = ({ 
  peopleData,
  selectedChildId,
  selectedCountry
}) => {
  const [visiblePeople, setVisiblePeople] = useState<People[]>([]);
  const [loadedCount, setLoadedCount] = useState(4);

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

  return (
    <Box width="100%" className="border" px={{ base:3, md:8}} mt={4}>
      <VStack align="stretch" pt={10}>
        {visiblePeople.map((people) => (
          <ChildCard 
            key={people.id}
            people={people}
            isSelected={selectedChildId === people.id}
            id={`child-${people.id}`}
          />
        ))}
      </VStack>
    </Box>
  );
};

export default ChildListings;
