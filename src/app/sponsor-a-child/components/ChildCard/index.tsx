import { Box, Flex, Text, Image, Button, VStack } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot } from "react-icons/fa6";

interface Child {
    name: string;
    location: string;
    age: number;
    day: number;
    month: string;
    image: string;
    bio: string;
}

const children: Child[] = [
    {
        name: "Sylvain",
        location: "DR Congo",
        age: 6,
        day: 19,
        month: "January",
        image: "https://d4j0oemdjsbb4.cloudfront.net/child/images/213908-RPPP_20241103_150452_CGP.jpg",
        bio: "A 6-year-old boy from Congo – Democratic Republic of full of hope",
    },
    {
        name: "Sophia",
        location: "Brazil",
        age: 9,
        day: 25,
        month: "March",
        image: "https://d4j0oemdjsbb4.cloudfront.net/child/images/213908-RPPP_20241103_150452_CGP.jpg",
        bio: "A compassionate 9-year-old girl from Brazil with a passion for helping others",
    },
    {
        name: "Khaled",
        location: "Syria",
        age: 7,
        day: 10,
        month: "August",
        image: "https://d4j0oemdjsbb4.cloudfront.net/child/images/213908-RPPP_20241103_150452_CGP.jpg",
        bio: "A resilient 7-year-old boy from Syria who dreams of a better future",
    },
    {
        name: "Lina",
        location: "Yemen",
        age: 8,
        day: 5,
        month: "May",
        image: "https://d4j0oemdjsbb4.cloudfront.net/child/images/213908-RPPP_20241103_150452_CGP.jpg",
        bio: "An inspiring 8-year-old girl from Yemen advocating for children’s rights",
    },
];

const ChildCard: React.FC<{ child: Child }> = ({ child }) => {
    return (
        <Flex
            mb={6}
            border="1px"
            borderColor="gray.200"
            borderRadius="md"
            boxShadow="sm"
        >
            {/* Photo */}
            <Image
                src={child.image}
                alt={child.name}
                p={0}
                boxSize="120px"
                objectFit="cover"
                borderRadius="md"
                mr={6}
                width={273}
                height={273}
            />

            {/* Details */}
            <Box flex="1" mt={4}>
                <Text fontSize="4xl" fontWeight="semibold" mb={4}>
                    {child.name}
                </Text>
                <Box display="flex" alignItems="center" gap={2} mb={4}>
                    <FaCalendar className="text-[#1C3C8C]" />
                    <Text fontSize="sm" color="gray.500">
                        {child.month} {child.day}, {2023 - child.age} | {child.age} years old
                    </Text>
                </Box>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                    <FaLocationDot className="text-[#1C3C8C]" />
                    <Text fontSize="sm" color="gray.500">
                        {child.location}
                    </Text>
                </Box>
                <Button mt={4} className="bg-[#1C3C8C] text-white font-semibold text-base" px={4} py={2}>
                    Sponsor
                </Button>
            </Box>

            {/* Bio */}
            <Box flex="2" ml={6} mt={4}>
                <Text fontSize="4xl" fontWeight="semibold" mb={4}>Bio</Text>
                <Text fontSize="sm" mb={4}>{child.bio}</Text>
                <Text mt={2} fontSize="sm" color="blue.500">
                    Learn more about {child.name}
                </Text>
            </Box>
        </Flex>

    );
};

const ChildListing = () => {
    return (
        <Box width="100%" className="border" px={12} py={6} mt={4}>
            <VStack align="stretch" pt={10}>
                {children.map((child, index) => (
                    <ChildCard key={index} child={child} />
                ))}
            </VStack>
        </Box>
    );
};

export default ChildListing;
