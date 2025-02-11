"use client";
import React, { useState } from "react";
import { Box, Text, Image, Flex, Input, InputAddon, Progress, HStack } from "@chakra-ui/react";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { FaCalendar, FaCaretDown } from "react-icons/fa";
import { FaLocationDot, FaPerson } from "react-icons/fa6";
import { calculateAge } from "@/utils/ageCalculator";
import {
    DialogBody,
    DialogCloseTrigger,
    DialogContent,
    DialogHeader,
    DialogRoot,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider";
import { centsToDollars } from "@/utils/currency";
import { toaster } from "@/components/ui/toaster"
import { ChildCardProps } from "@/types/propTypes";
import {
    SelectRoot,
    SelectTrigger,
    SelectValueText,
    SelectContent,
    SelectItem,
} from "@/components/ui/select";
import { paymentOptionsCollection } from "./config";

const ChildCard: React.FC<ChildCardProps> = ({ people, isSelected }) => {
    const age = calculateAge(new Date(people.birth_date).toISOString());
    const remainingAmount = (people.budget_goal - people.budget_raised) / 100;
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
                    location: people.country
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


    const handleSelectChange = (value: string) => {
        setSelectedOption(value);
    };

    const renderDisclaimer = () => {
        if ((people.budget_goal - people.budget_raised - amount * 100) > 0) {
            return (
                <>
                    This child has a monthly budget goal that must be met for enrollment in school.
                    <br />
                    Additional sponsors are required to meet this goal.
                </>
            )
        } else if (people.budget_raised > 0) {
            return "This child is partially sponsored. Your contribution will help reach their monthly budget goal!";
        }
        return "Your sponsorship will be applied towards the child's monthly budget goals.";
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
                        <DialogContent className="max-h-[90vh] overflow-y-auto mx-auto my-4">
                            <DialogHeader>
                                <DialogCloseTrigger />
                            </DialogHeader>
                            <DialogBody>
                                <Box className="flex flex-col md:grid md:grid-cols-2 gap-6">
                                    <Image
                                        src={people.image_url}
                                        alt={people.name}
                                        width={{ base: 300, md: 500 }}
                                        height={{ base: 300, md: 500 }}
                                        className="rounded-lg w-full h-auto object-cover"
                                    />
                                    <Box className="md:mr-14 flex flex-col">
                                        <Text className="text-2xl text-center font-bold mt-4 md:mt-0 md:text-start">
                                            {people.name}
                                        </Text>
                                        <Progress.Root
                                            defaultValue={Math.min((people.budget_raised / people.budget_goal) * 100, 100)}
                                            my={8}
                                        >
                                            <Text className="text-end text-base text-[#959090] font-normal">
                                                Goal: {`$${centsToDollars(people.budget_goal)}`}
                                            </Text>
                                            <Tooltip
                                                content={`$${centsToDollars(people.budget_raised)} raised`}
                                                showArrow
                                                positioning={{ placement: "right-end" }}
                                            >
                                                <HStack gap="5">
                                                    <Progress.Track className="rounded-lg h-3" flex="1">
                                                        <Progress.Range className="bg-[#1C3C8C]" />
                                                    </Progress.Track>
                                                </HStack>
                                            </Tooltip>
                                        </Progress.Root>
                                        <Box>
                                            <Text mt={1} className="font-semibold text-base mb-[10px]">
                                                Amount
                                            </Text>
                                            <Flex
                                                className="border rounded-lg"
                                                mb={4}
                                                align="center"
                                                justify="center"
                                                gap={2}
                                            >
                                                <InputAddon className="bg-[#D6D6D6] px-[15px] py-[5px] m-1 text-[#959090] text-base font-medium">
                                                    $
                                                </InputAddon>
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    max={people.budget_goal / 100}
                                                    value={amount}
                                                    onChange={handleAmountChange}
                                                    className="px-4 h-[50px]"
                                                    placeholder="Enter Amount"
                                                />
                                            </Flex>
                                            <Box my={4}>
                                                <Slider
                                                    value={value}
                                                    min={0}
                                                    max={remainingAmount}
                                                    step={5}
                                                    variant="solid"
                                                    onValueChange={handleSliderChange}
                                                />
                                                <Text textAlign="center" mt={2}>Selected Amount: ${value[0]}</Text>
                                            </Box>
                                            <Box gap={8}>
                                                <SelectRoot
                                                    collection={paymentOptionsCollection}
                                                    className="border rounded-lg"
                                                    my={8}
                                                    px={4}
                                                    py={2}
                                                    onValueChange={(details) => handleSelectChange(details.value[0])}
                                                >
                                                    <SelectTrigger className="w-full">
                                                        <SelectValueText placeholder="Select payment frequency" />
                                                    </SelectTrigger>
                                                    <SelectContent className="z-[9999]">
                                                        {paymentOptionsCollection.items.map((option) => (
                                                            <SelectItem key={option.value} item={option}>
                                                                {option.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </SelectRoot>
                                            </Box>
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
                                        <Text color="gray.500" textAlign="center" p={1}>
                                            {renderDisclaimer()}
                                        </Text>
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
