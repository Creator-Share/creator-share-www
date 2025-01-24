"use client";

import { Box, VStack } from "@chakra-ui/react";
import React from "react";
import ChildCard from "../ChildCard";
import { Child } from "@/types";

interface ChildListingsProps {
  childData: Child[];
}

const ChildListings: React.FC<ChildListingsProps> = ({ childData }) => {
  return (
    <Box width="100%" className="border" px={12} py={6} mt={4}>
      <VStack align="stretch" pt={10}>
        {childData.map((child) => (
          <ChildCard key={child.id} child={child} />
        ))}
      </VStack>
    </Box>
  );
};

export default ChildListings;
