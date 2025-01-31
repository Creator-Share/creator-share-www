"use client";
import { Box, Flex, Text, Image } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot } from "react-icons/fa6";
import { People } from "@/types";
import { useRouter } from "next/navigation";
import { calculateAge } from "@/utils/ageCalculator";
import { formatDate } from "@/utils/dateFormatter";

interface ChildCardProps {
    people: People;
    isSelected?: boolean;
    id: string;
}

const ChildCard: React.FC<ChildCardProps> = ({ people, isSelected }) => {
    const router = useRouter();

    const handleNavigateChild = () => {
        router.push(`/sponsor-a-child/${people.id}`);
    };

    const age = calculateAge(new Date(people.birth_date).toISOString());
    const formattedBirthDate = formatDate(new Date(people.birth_date).toISOString());

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
            onClick={handleNavigateChild}
        >
            <Box>
                <Image
                    src={people.image}
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
                    <Box fontSize="base" className="text-[#767070]">
                        <Flex justify={{ base: "center", md: "flex-start" }} align="center" gap={2} mb={4}>
                            <FaCalendar />
                            <Text fontSize="sm" className="text-gray-500">
                                {formattedBirthDate} | {age} years old
                            </Text>
                        </Flex>
                        <Flex justify={{ base: "center", md: "flex-start" }} align="center" gap={2}>
                            <FaLocationDot />
                            <Text fontSize="sm" className="text-gray-500">
                                {people.country}
                            </Text>
                        </Flex>
                    </Box>
                </Box>
                <Box className="md:ml-14">
                    <Text fontSize="4xl" fontWeight="bold" className="text-[#03150E] mb-1">
                        Bio
                    </Text>
                    <Box fontSize="base" mb={3}>
                        <Text className="text-[#767070] mb-4">
                            {people.biography}
                        </Text>
                        <Text fontWeight="md" className="text-[#1C3C8C] cursor-pointer hover:underline">
                            Learn more about {people.name}
                        </Text>
                    </Box>
                </Box>
            </Box>
        </Flex>
    );
};

export default ChildCard;
