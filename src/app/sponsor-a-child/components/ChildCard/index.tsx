"use client";

import { Box, Flex, Text, Image, Button } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot } from "react-icons/fa6";
import { People } from "@/types";
import { useRouter } from "next/navigation";

const ChildCard: React.FC<{ people: People }> = ({ people }) => {
  const router = useRouter();

  const handleNavigateChild = () => {
    router.push(`/sponsor-a-child/${people.id}`);
  };

  return (
    <Flex
      mb={6}
      border="1px"
      borderColor="gray.200"
      borderRadius="md"
      boxShadow="sm"
      onClick={handleNavigateChild}
      cursor='pointer'
    >
      {/* Photo */}
      <Image
        src={people.image}
        alt={people.name}
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
          {people.name}
        </Text>
        <Box display="flex" alignItems="center" gap={2} mb={4}>
          <FaCalendar className="text-[#1C3C8C]" />
          <Text fontSize="sm" color="gray.500">
            {people.birth_date}
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <FaLocationDot className="text-[#1C3C8C]" />
          <Text fontSize="sm" color="gray.500">
            {people.country}
          </Text>
        </Box>
        <Button
          mt={4}
          className="bg-[#1C3C8C] text-white font-semibold text-base"
          px={4}
          py={2}
        >
          Sponsor
        </Button>
      </Box>

      {/* Bio */}
      <Box flex="2" ml={6} mt={4}>
        <Text fontSize="4xl" fontWeight="semibold" mb={4}>
          Bio
        </Text>
        <Text fontSize="sm" mb={4}>
          {people.biography}
        </Text>
        <Text mt={2} fontSize="sm" color="blue.500">
          Learn more about {people.name}
        </Text>
      </Box>
    </Flex>
  );
};

export default ChildCard;
