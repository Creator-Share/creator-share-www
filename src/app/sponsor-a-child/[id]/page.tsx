"use client";
import React, { useEffect, useState } from "react";
import {
  Box,
  Flex,
  Text,
  Spinner,
  Heading,
} from "@chakra-ui/react";
import { People } from "@/types";
import ChildDetailsCard from "../components/ChildDetails";
import GoBackButton from "@/components/ui/goBack";

const ChildDetails: React.FC<{ params: Promise<{ id: string }> }> = ({ params }) => {
  const { id } = React.use(params);
  const [child, setChild] = useState<People | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchChild = async () => {
      try {
        const res = await fetch(`/api/children/get/${id}`);
        if (!res.ok) throw new Error("Failed to fetch child data");
        const data = await res.json();
        setChild(data.child);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message || "Unexpected error occurred");
        } else {
          setError("Unexpected error occurred");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchChild();
  }, [id]);

  if (loading) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Spinner size="xl" />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Text color="red.500">{error}</Text>
      </Flex>
    );
  }

  if (!child) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Text color="gray.500">No child data found.</Text>
      </Flex>
    );
  }

  return (
    <Box className="md:px-36 p-8">
      <GoBackButton />
      <Text fontSize="2xl" fontWeight="bold" mb={4}>
        Details
      </Text>
      
      {/* Wrap the child details card in a clickable container */}
      <Box cursor="pointer">
        <ChildDetailsCard id={child.id} people={child} />
      </Box>
    </Box>
  );
};

export default ChildDetails;
