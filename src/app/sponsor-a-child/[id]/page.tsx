"use client"
import React, { useEffect, useState } from "react";
import { Box, Flex, Text, Spinner } from "@chakra-ui/react";
import { People } from "@/types";

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

  return (
    <Box px={8} py={4}>
      <Text fontSize="2xl" fontWeight="bold" mb={4}>
        Child Details
      </Text>
      <Text><strong>ID:</strong> {child?.id}</Text>
      <Text><strong>Name:</strong> {child?.name}</Text>
      <Text><strong>Biography:</strong> {child?.biography}</Text>
      <Text><strong>Birth Date:</strong> {child?.birth_date}</Text>
      <Text><strong>Country:</strong> {child?.country}</Text>
    </Box>
  );
};

export default ChildDetails;
