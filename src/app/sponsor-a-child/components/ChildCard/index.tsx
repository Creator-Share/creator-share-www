"use client";
import React, { useState } from "react";
import { Box, Text, Button, Image, Flex, Input, InputAddon } from "@chakra-ui/react";
import { FaCalendar, FaCaretDown } from "react-icons/fa";
import { FaLocationDot, FaPerson } from "react-icons/fa6";
import { People } from "@/types";
import { calculateAge } from "@/utils/ageCalculator";
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

interface ChildCardProps {
    people: People;
    isSelected?: boolean;
    id: string;
}

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string);

const ChildCard: React.FC<ChildCardProps> = ({ people, isSelected }) => {
    const age = calculateAge(new Date(people.birth_date).toISOString());
    const [amount, setAmount] = useState<string>("");
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (/^\d*\.?\d*$/.test(value)) {
            setAmount(value);
        }
    };

    const handleSponsor = async () => {
        if (!people || !amount || parseFloat(amount) <= 0) {
            alert("Please enter a valid amount.");
            return;
        }

        try {
            const stripe = await stripePromise;
            const res = await fetch("/api/stripe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    childId: people.id,
                    childName: people.name,
                    childImage: people.image_url,
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
        <Flex
            direction={{ base: "column", md: "row" }}
            align={{ base: "center", md: "flex-start" }}
            textAlign={{ base: "center", md: "left" }}
            borderWidth="1px"
            borderColor={isSelected ? "blue.500" : "gray.200"}
            borderRadius={{ base: 'lg', md: 'md' }}
            boxShadow="sm"
            className="bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer p-6 mb-6 md:p-0 md:mb-0 "
        >
            <Box>
                <Image
                    src={people.image_url}
                    alt={people.name}
                    boxSize={{ base: "150px", md: "273px" }}
                    objectFit="cover"
                    borderRadius={{ base: "full", md: "md" }}
                    className="mb-4 md:mb-0"
                />
            </Box>
            <Box className="md:grid md:grid-cols-2 pt-[20px]">
                <Box ml={{ md: 6 }} w="full">
                    <Text fontSize="4xl" fontWeight="bold" mb={2} className="text-[#03150E]">
                        {people.name}
                    </Text>
                    <Box fontSize="base" className="text-[#767070] mb-4">
                        <Flex justify={{ base: "center", md: "flex-start" }} align="center" gap={2} mb={4}>
                            <FaCalendar />
                            <Text fontSize="sm" className="text-gray-500">
                                {age} year{age > 1 ? 's' : ''} old
                            </Text>
                        </Flex>
                        <Flex justify={{ base: "center", md: "flex-start" }} align="center" gap={2} mb={4}>
                            <FaPerson />
                            <Text fontSize="sm" className="text-gray-500">
                                {people.gender}
                            </Text>
                        </Flex>
                        <Flex justify={{ base: "center", md: "flex-start" }} align="center" gap={2}>
                            <FaLocationDot />
                            <Text fontSize="sm" className="text-gray-500">
                                {people.country}
                            </Text>
                        </Flex>
                    </Box>
                    <Box mb={4}>
                        <Box bg="gray.200" h="2px" w="full" borderRadius="full">
                            <Box
                                bg="#1C3C8C"
                                h="2px"
                                w={`${(people.budget_raised / people.budget_goal) * 100}%`}
                                borderRadius="full"
                            />
                        </Box>
                        <Text fontSize="sm" mt={1} className="text-gray-500">
                            ${people.budget_raised / 100} raised of ${people.budget_goal / 100}
                        </Text>
                    </Box>
                    <DialogRoot size="cover" placement="center" motionPreset="slide-in-bottom">
                        <DialogTrigger asChild>
                            <Box fontSize="base" mb={3}>
                                <Button fontWeight="md" className="text-[#FFFFFF] cursor-pointer bg-[#1C3C8C] px-4">
                                    Sponsor
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
                </Box>
                <Box className="md:ml-14">
                    <Text fontSize="4xl" fontWeight="bold" className="text-[#03150E] mb-1">
                        Introduction
                    </Text>
                    <Text fontSize="base" className="text-[#767070]">
                        {people.introduction}
                    </Text>
                    <Text fontSize="base" className="text-[#767070] mt-4">
                        <span className="text-[#1C3C8C] cursor-pointer whitespace-nowrap flex items-center gap-1">
                            Learn more about {people.name} <FaCaretDown />
                        </span>
                    </Text>
                </Box>
            </Box>
        </Flex>
    );
};

export default ChildCard;
