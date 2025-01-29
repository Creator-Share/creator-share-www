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
  const [loadedCount, setLoadedCount] = useState(2);

  const handleScroll = useCallback(() => {
    const scrollableDiv = document.getElementById("scrollable-box");
    if (scrollableDiv) {
      const { scrollTop, scrollHeight, clientHeight } = scrollableDiv;
      if (scrollTop + clientHeight >= scrollHeight - 5) {
        setLoadedCount((prevCount) => Math.min(prevCount + 2, peopleData.length));
      }
    }
  }, [peopleData.length]);

  useEffect(() => {
    if (selectedCountry) {
      const filteredPeople = peopleData.filter(person => person.country === selectedCountry);
      setVisiblePeople(filteredPeople.slice(0, loadedCount));
    } else {
      setVisiblePeople([]);
    }
  }, [peopleData, selectedCountry, loadedCount]);

  useEffect(() => {
    const scrollableDiv = document.getElementById("scrollable-box");
    if (scrollableDiv) {
      scrollableDiv.addEventListener("scroll", handleScroll);
    }
    return () => {
      if (scrollableDiv) {
        scrollableDiv.removeEventListener("scroll", handleScroll);
      }
    };
  }, [handleScroll]);

  if (!selectedCountry) return null;

  return (
    <Box
      id="scrollable-box"
      width="100%"
      className="border"
      px={12}
      mt={4}
      overflowY="auto"
    >
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
