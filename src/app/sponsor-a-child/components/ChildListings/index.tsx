"use client"
import { Box, VStack, Text, Heading, Collapsible } from "@chakra-ui/react";
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
    <Box width="100%" className="border" px={{ base: 3, md: 8 }} mt={4}>
      <VStack align="stretch" pt={10}>
        {visiblePeople.map((people) => (
          <Box key={people.id}>
            <Collapsible.Root>
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
                  <Box mr="8">
                    <Text fontSize="xl" fontWeight="semibold" mb={4} color="#1C3C8C">
                      About {people.name}
                    </Text>
                    <Text mb={4}>
                      {people.name} lives with her grandmother and has no brothers or sisters.
                      Her grandmother struggles to provide for the family and works as a
                      construction worker. Despite their efforts, it is difficult to meet
                      the family's needs.
                    </Text>

                    <Text mb={4}>
                      {people.gender === "male" ? "He" : "She"} helps at home by being good.
                      {people.gender === "male" ? "He" : "She"} likes to play cooking and baking.
                      {people.gender === "male" ? "He" : "She"} is in satisfactory health.
                    </Text>

                    <Text mb={4}>
                      {people.name} is growing up in a poor rural community in the beautiful
                      country of {people.country}. Family homes are constructed with wood and
                      palm leaves and sit on stilts to keep floodwaters out during the rainy
                      season. Families survive on rice, fish and home-grown vegetables.
                      The climate in the region is hot.
                    </Text>

                    <Heading size="md" mb={4} color="#1C3C8C">
                      How Sponsorship Helps
                    </Heading>

                    <Text mb={4}>
                      Your sponsorship commitment will help provide {people.name} and her
                      community with improved health through training in nutrition and
                      maternal healthcare. Education on hygiene and sanitation, as well as
                      access to clean water, will reduce illnesses.
                    </Text>

                    <Text mb={4}>
                      Schools will benefit from educational materials and trainings for
                      teachers. Parents will learn skills to improve their financial
                      situations. And our caring staff will reflect Christ's love to
                      these children through their actions and lives.
                    </Text>
                  </Box>
                  <Box mt="12">
                    <video width="3000" height="56000" controls preload="none" className="border rounded-lg">
                      <source src={people.video} type="video/mp4" />
                    </video>
                  </Box>
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
