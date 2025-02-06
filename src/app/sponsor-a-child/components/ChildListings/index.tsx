"use client"
import { Box, VStack, Text, Collapsible, Button, Image, Flex, Input, InputAddon } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import ChildCard from "../ChildCard";
import { People } from "@/types";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog"
import { loadStripe } from "@stripe/stripe-js";
import { Checkbox } from "@/components/ui/checkbox";

interface ChildListingsProps {
  peopleData: People[];
  selectedChildId: string | null;
  selectedCountry: string | null;
}

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string);

const ChildListings: React.FC<ChildListingsProps> = ({
  peopleData,
  selectedChildId,
  selectedCountry
}) => {
  const [visiblePeople, setVisiblePeople] = useState<People[]>([]);
  const [loadedCount, setLoadedCount] = useState(4);
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      setAmount(value);
    }
  };

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

  const handleSponsor = async () => {
    if (!peopleData || !amount || parseFloat(amount) <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    try {
      const stripe = await stripePromise;
      const res = await fetch("/api/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId: selectedChildId,
          childName: peopleData[0].name,
          childImage: peopleData[0].image_url,
          amount: parseFloat(amount) * 100,
          paymentType: selectedOption,
        }),
      });

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
      console.log(stripe)
    } catch (err) {
      console.error("Payment Error:", err);
    }
  };

  const handleCheckboxChange = (option: string) => {
    setSelectedOption((prev) => (prev === option ? null : option));
  };

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
                <DialogRoot size="cover" placement="center" motionPreset="slide-in-bottom">
                  <DialogTrigger asChild>
                    <Box fontSize="base" mb={3} className="w-full">
                      <Button fontWeight="md" className="text-[#FFFFFF] cursor-pointer bg-[#1C3C8C] px-4 w-full">
                        Sponsor {people.name}
                      </Button>
                    </Box>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogCloseTrigger />
                    </DialogHeader>
                    <DialogBody>
                      <Box className="flex flex-col md:grid md:grid-cols-2">
                        <Image src={people.image_url} alt={people.name} className="rounded-lg" />
                        <Box className="md:mr-14">
                          <Text className="text-2xl text-center font-bold mt-8 md:text-start">{people.name}</Text>
                          <Box mb={4} className="mt-4 md:mt-12">
                            <Box bg="gray.200" h="15px" w="full" borderRadius="full">
                              <Box
                                bg="#1C3C8C"
                                h="2px"
                                w={`${(people.budget_raised / people.budget_goal) * 100}%`}
                                borderRadius="full"
                              />
                            </Box>
                            <Text fontSize="sm" mt={3} ml={2} className="text-gray-500">
                              ${people.budget_raised / 100} raised of ${people.budget_goal / 100}
                            </Text>
                          </Box>
                          <Box>
                            <Flex
                              className="border rounded-lg"
                              mb={4}
                              align="center"
                              justify="center"
                              gap={2}
                            >
                              <InputAddon>
                                $
                              </InputAddon>
                              <Input
                                type="number"
                                min="1"
                                value={amount}
                                onChange={handleAmountChange}
                                className="px-4"
                                placeholder="Enter Amount"
                              />
                            </Flex>
                            <Flex justify="center" align="center" gap={8}>
                              <Flex align="center" gap={2}>
                                <Checkbox
                                  className="border rounded-md border-[#8D9692]"
                                  checked={selectedOption === "subscription"}
                                  onChange={() => handleCheckboxChange("subscription")}
                                />
                                <Text>Monthly</Text>
                              </Flex>
                              <Flex align="center" gap={2}>
                                <Checkbox
                                  className="border rounded-md border-[#8D9692]"
                                  checked={selectedOption === "payment"}
                                  onChange={() => handleCheckboxChange("payment")}
                                />
                                <Text>One-time</Text>
                              </Flex>
                            </Flex>
                          </Box>
                          <Button className="bg-[#1C3C8C] text-white w-full md:mt-8 mt-4" onClick={handleSponsor}>Save</Button>
                        </Box>
                      </Box>
                    </DialogBody>
                    <DialogCloseTrigger />
                  </DialogContent>
                </DialogRoot>
              </Collapsible.Content>
            </Collapsible.Root>
          </Box>
        ))}
      </VStack>
    </Box>
  );
};

export default ChildListings;
