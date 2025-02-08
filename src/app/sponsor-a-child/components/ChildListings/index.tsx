"use client"
import { Box, VStack, Text, Collapsible, Image, Flex, Input, InputAddon } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { centsToDollars } from "@/utils/currency";
import { toaster } from "@/components/ui/toaster";

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
  const [loadedCount, setLoadedCount] = useState<number>(4);
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [value, setValue] = useState<number[]>([0]);
  const [loading, setLoading] = useState<boolean>(false);

  const handleSliderChange = (e: { value: number[] }) => {
    const newValue = Math.min(e.value[0], peopleData[0].budget_goal / 100);
    setValue([newValue]);
    setAmount(newValue);
  };
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = parseInt(e.target.value) || 0;
    newValue = Math.min(newValue, peopleData[0].budget_goal / 100);
    setAmount(newValue);
    setValue([newValue]);
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
    if (amount <= 0) {
      toaster.create({
        title: "Invalid Amount",
        description: "Please enter a valid amount.",
      });
      return;
    }

    const totalAfterDonation = peopleData[0].budget_raised / 100 + amount;

    if (totalAfterDonation > peopleData[0].budget_goal / 100) {
      toaster.create({
        title: "Sponsorship amount exceeds the budget goal.",
        description: "Please enter a lower amount.",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId: peopleData[0].id,
          childName: peopleData[0].name,
          childImage: peopleData[0].image_url,
          amount: amount * 100,
          paymentType: selectedOption,
        }),
      });

      const { url } = await res.json();
      if (url) {
        toaster.create({
          title: "Redirecting...",
          description: "You will be redirected to complete the sponsorship.",
        });
        window.location.href = url;
      }
    } catch (err) {
      toaster.create({
        title: "Payment Error",
        description: "Something went wrong. Please try again.",
      });
      console.error("Payment Error:", err);
    } finally {
      setLoading(false);
    }
  };


  const handleCheckboxChange = (option: string) => {
    setSelectedOption((prev) => {
      if (prev === option) {
        return null;
      } else {
        const newAmount = option === "payment" ? amount * 12 : amount / 12;
        setAmount(newAmount);
        setValue([newAmount]);
        return option;
      }
    });
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
                        <Image src={people.image_url} alt={people.name} width={500} height={500} className="rounded-lg" />
                        <Box className="md:mr-14">
                          <Text className="text-2xl text-center font-bold mt-8 md:text-start">{people.name}</Text>
                          <Box mb={4} className="mt-4 md:mt-12">
                            <Box bg="gray.200" h="2px" w="full" borderRadius="full">
                              <Box
                                bg="#1C3C8C"
                                h="2px"
                                w={`${Math.min((people.budget_raised / people.budget_goal) * 100, 100)}%`}
                                borderRadius="full"
                              />
                            </Box>
                            <Text fontSize="sm" mt={1} className="text-gray-500">
                              ${centsToDollars(people.budget_raised)} raised of ${centsToDollars(people.budget_goal)}
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
                                max={parseFloat(centsToDollars(people.budget_goal))}
                                value={amount}
                                onChange={handleAmountChange}
                                className="px-4"
                                placeholder="Enter Amount"
                              />
                            </Flex>
                            <Box my={4}>
                              <Slider
                                value={value}
                                min={0}
                                max={parseFloat(centsToDollars(people.budget_goal))}
                                step={5}
                                variant="solid"
                                onValueChange={handleSliderChange}
                              />
                              <Text textAlign="center" mt={2}>Selected Amount: ${value[0]}</Text>
                            </Box>
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
                                <Text>Yearly</Text>
                              </Flex>
                            </Flex>
                          </Box>
                          <Button
                            bg="#1C3C8C"
                            color="white"
                            w="full"
                            mt={4}
                            loading={loading}
                            loadingText="Processing..."      
                            onClick={handleSponsor}
                            disabled={loading}
                          >
                            Sponsor
                          </Button>
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
