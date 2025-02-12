"use client";
import React from "react";
import { Box, Text, Image, Flex } from "@chakra-ui/react";
import { FaCalendar, FaCaretDown } from "react-icons/fa";
import { FaLocationDot, FaPerson } from "react-icons/fa6";
import { calculateAge } from "@/utils/ageCalculator";
import { centsToDollars } from "@/utils/currency";
import { ChildCardProps } from "@/types/propTypes";
import SponsorDialog from "../SponsorDialog";
import { Button } from "@/components/ui/button";

const ChildCard: React.FC<ChildCardProps> = ({ people, isSelected }) => {
    const age = calculateAge(new Date(people.birth_date).toISOString());

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
                    <SponsorDialog
                        people={people}
                        trigger={
                            <Box fontSize="base" mb={3}>
                                <Button fontWeight="md" className="text-[#FFFFFF] w-full md:w-11/12 cursor-pointer bg-[#1C3C8C] px-4 mt-8">
                                    Sponsor
                                </Button>
                            </Box>
                        }
                    />
                </Box>
            </Box>
        </Flex>
    );
};

export default ChildCard;
