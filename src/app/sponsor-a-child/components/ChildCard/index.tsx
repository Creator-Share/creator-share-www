"use client";

import { Box, Flex, Text, Image, Button } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot } from "react-icons/fa6";
import { Child } from "@/types";

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
        <Text fontSize="4xl" fontWeight="semibold" mb={4}>
          Bio
        </Text>
        <Text fontSize="sm" mb={4}>
          {child.biography}
        </Text>
        <Text mt={2} fontSize="sm" color="blue.500">
          Learn more about {child.name}
        </Text>
      </Box>
    </Flex>
  );
};

export default ChildCard;
