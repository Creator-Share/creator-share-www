"use client"
import { Box, VStack, Text, Heading, Collapsible, Button } from "@chakra-ui/react";
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
  const [openId, setOpenId] = useState<string | null>(null);

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
    <Box width="100%" className="border" px={{ base: 3, md: 8 }} mt={4}>
      <VStack align="stretch" pt={10}>
        {visiblePeople.map((people) => (
          <Box key={people.id}>
            <Collapsible.Root open={openId === people.id} onOpenChange={(open) => setOpenId(open ? people.id : null)}>
              <Collapsible.Trigger as={Box} cursor="pointer">
                <ChildCard
                  people={people}
                  isSelected={selectedChildId === people.id}
                  id={`child-${people.id}`}
                />
              </Collapsible.Trigger>
              <Collapsible.Content>
                <Box
                  p={6}
                  bg="white"
                  borderRadius="lg"
                  mx="auto"
                  mt={4}
                  className="flex flex-col md:flex-row"
                >
                  <Box mr="8" className="w-2/5">
                    <Text fontSize="xl" fontWeight="semibold" mb={4} color="#1C3C8C">
                      About {people.name}
                    </Text>
                    <Text mb={4}>
                      {people.biography}
                    </Text>

                  </Box>
                  <Box mt="12" className="w-3/5">
                    <video width="800" height="600" controls preload="none" className="border rounded-lg">
                      <source src={people.video_url} type="video/mp4" />
                    </video>
                  </Box>
                </Box>
                <Box fontSize="base" mb={3} className="w-full">
                  <Button fontWeight="md" className="text-[#FFFFFF] cursor-pointer bg-[#1C3C8C] px-4 w-full" onClick={() => alert('connect to stripe')}>
                      Sponsor {people.name}
                  </Button>
                </Box>
              </Collapsible.Content>
            </Collapsible.Root>
          </Box>
        ))}
      </VStack>
    </Box>
  );
};

export default ChildListings;
