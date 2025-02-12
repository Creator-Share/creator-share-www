"use client"
import { Box, VStack, Text, Collapsible } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import React, { useState, useEffect, useCallback } from "react";
import ChildCard from "../ChildCard";
import { SponsorPeople } from "@/types";
import { ChildListingsProps } from "@/types/propTypes";
import SponsorDialog from "../SponsorDialog";

const ChildListings: React.FC<ChildListingsProps> = ({
  peopleData,
  selectedChildId,
  selectedCountry
}) => {
  const [visiblePeople, setVisiblePeople] = useState<SponsorPeople[]>([]);
  const [loadedCount, setLoadedCount] = useState<number>(4);
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
            <Collapsible.Root
              open={openId === people.id}
              onOpenChange={() => setOpenId(openId === people.id ? null : people.id)}
            >
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
                  <Box mr="8" className="md:w-2/5 md:text-start w-full text-center">
                    <Text fontSize="xl" fontWeight="semibold" mb={4} color="#1C3C8C">
                      About {people.name}
                    </Text>
                    <Text mb={4}>
                      {people.biography}
                    </Text>
                  </Box>
                  <Box mt="12" className="md:w-3/5 w-full">
                    <video width="800" height="600" controls preload="none" className="border rounded-lg">
                      <source src={people.video_url} type="video/mp4" />
                    </video>
                  </Box>
                </Box>
                <SponsorDialog
                  people={people}
                  trigger={
                    <Box fontSize="base" mb={3}>
                      <Button fontWeight="md" className="text-[#FFFFFF] w-full cursor-pointer bg-[#1C3C8C] px-4 mt-8">
                        Sponsor {people.name}
                      </Button>
                    </Box>
                  }
                />
              </Collapsible.Content>
            </Collapsible.Root>
          </Box>
        ))}
      </VStack>
    </Box>
  );
};

export default ChildListings;
