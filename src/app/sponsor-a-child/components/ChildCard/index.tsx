"use client";
import React, { useState } from "react";
import { Box, Text, Image, Flex, Input, InputAddon } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { centsToDollars } from "@/utils/currency";
import { toaster } from "@/components/ui/toaster"

interface ChildCardProps {
    people: People;
    isSelected?: boolean;
    id: string;
}


const ChildCard: React.FC<ChildCardProps> = ({ people, isSelected }) => {
    const age = calculateAge(new Date(people.birth_date).toISOString());
    const [amount, setAmount] = useState<number>(0);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [value, setValue] = useState<number[]>([0]);
    const [loading, setLoading] = useState<boolean>(false);

    const handleSliderChange = (e: { value: number[] }) => {
        const newValue = Math.min(e.value[0], people.budget_goal / 100);
        setValue([newValue]);
        setAmount(newValue);
    };
    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let newValue = parseInt(e.target.value) || 0;
        newValue = Math.min(newValue, people.budget_goal / 100);
        setAmount(newValue);
        setValue([newValue]);
    };

    const handleSponsor = async () => {
        if (amount <= 0) {
            toaster.create({
                title: "Invalid Amount",
                description: "Please enter a valid amount.",
            });
            return;
        }

        const totalAfterDonation = people.budget_raised / 100 + amount;

        if (totalAfterDonation > people.budget_goal / 100) {
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
                    childId: people.id,
                    childName: people.name,
                    childImage: people.image_url,
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
        <Flex
            direction={{ base: "column", md: "row" }}
            align={{ base: "center", md: "flex-start" }}
            textAlign={{ base: "center", md: "left" }}
            borderColor={isSelected ? "blue.500" : "gray.200"}
            borderRadius={{ base: 'md', md: 'md' }}
            className="bg-white cursor-pointer mb-6 p-0 border-0 md:border md:mb-8 md:p-0"
        >
            <Box>
                <Image
                    src={people.image_url}
                    alt={people.name}
                    objectFit="cover"
                    className="mb-4 md:mb-0 rounded-t-md h-[400px] w-[550px] md:rounded-l-md md:rounded-t-none md:h-[273px] md:w-[450px]"
                />
            </Box>
            <Box className="md:grid md:grid-cols-2 pt-[20px] w-full md:w-screen">
                <Box ml={{ md: 6 }} w="full">
                    <Text fontSize="4xl" fontWeight="bold" mb={2} className="text-[#03150E]">
                        {people.name}
                    </Text>
                    <Box fontSize="base" className="text-[#767070] bg-[#DFDFDF] rounded-md md:bg-white p-4 mb-4 text-left md:text-center">
                        <Flex align="center" gap={2} mb={4}>
                            <FaCalendar />
                            <Text fontSize="sm" className="text-gray-500">
                                {age} year{age > 1 ? 's' : ''} old
                            </Text>
                        </Flex>
                        <Flex align="center" gap={2} mb={4}>
                            <FaPerson />
                            <Text fontSize="sm" className="text-gray-500">
                                {people.gender}
                            </Text>
                        </Flex>
                        <Flex align="center" gap={2}>
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
                                w={`${Math.min((people.budget_raised / people.budget_goal) * 100, 100)}%`}
                                borderRadius="full"
                            />
                        </Box>
                        <Text fontSize="sm" mt={1} className="text-gray-500">
                            ${centsToDollars(people.budget_raised)} raised of ${centsToDollars(people.budget_goal)}
                        </Text>
                    </Box>
                </Box>
                <Box className="md:ml-14 px-4 md:px-0">
                    <Text fontSize="4xl" fontWeight="bold" className="text-[#03150E] mb-1">
                        Introduction
                    </Text>
                    <Text fontSize="base" className="text-[#767070]">
                        {people.introduction}
                    </Text>
                    <Text fontSize="base" className="text-[#767070] mt-4">
                        <span className="text-[#1C3C8C] ml-2 cursor-pointer whitespace-nowrap flex items-center gap-1">
                            Learn more about {people.name} <FaCaretDown />
                        </span>
                    </Text>
                    <DialogRoot size="cover" placement="center" motionPreset="slide-in-bottom" role="alertdialog">
                        <DialogTrigger asChild>
                            <Box fontSize="base" mb={3}>
                                <Button fontWeight="md" className="text-[#FFFFFF] w-full md:w-11/12 cursor-pointer bg-[#1C3C8C] px-4 mt-8">
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
                                    <Image src={people.image_url} alt={people.name} width={500} height={500} className="rounded-lg" />
                                    <Box className="md:mr-14">
                                        <Text className="text-2xl text-center font-bold mt-8 md:text-start">{people.name}</Text>
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
                                                    max={people.budget_goal / 100}
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
                                                    max={people.budget_goal / 100}
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
                                            mt={4}
                                            loading={loading}
                                            loadingText="Processing..."
                                            onClick={handleSponsor}
                                            disabled={loading}
                                            className="w-full"
                                        >
                                            Sponsor
                                        </Button>
                                    </Box>
                                </Box>
                            </DialogBody>
                            <DialogCloseTrigger />
                        </DialogContent>
                    </DialogRoot>
                </Box>
            </Box>
        </Flex>
    );
};

export default ChildCard;
