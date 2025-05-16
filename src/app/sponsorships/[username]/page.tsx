"use client";
import React, { useEffect, useState } from "react";
import {
  Box,
  Flex,
  Text,
  Spinner
} from "@chakra-ui/react";
import { Beneficiaries } from "@/types";
import GoBackButton from "@/components/ui/goBack";
import SponsorshipDetails from "../components/SponsorshipDetails";
import BeneficiaryActivity from "../components/SponsorshipActivity";
import BeneficiaryDetailsCard from "../components/BeneficiaryDetails";


const BeneficiaryDetails: React.FC<{ params: Promise<{ username: string }> }> = ({ params }) => {
  const { username } = React.use(params);
  const [beneficiary, setBeneficiary] = useState<Beneficiaries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchChild = async () => {
      try {
        const res = await fetch(`/api/children/get/username/${username}`);
        
        if (!res.ok) {
          console.error("Failed to fetch child data:", await res.text());
          throw new Error("Failed to fetch child data");
        }
        
        const data = await res.json();
        setBeneficiary(data.child);
      } catch (err: unknown) {
        console.error("Error in child details page:", err);
        if (err instanceof Error) {
          setError(err.message || "Unexpected error occurred");
        } else {
          setError("Unexpected error occurred");
        }
      } finally {
        setLoading(false);
      }
    };

    if (username) {
      fetchChild();
    }
  }, [username]);

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

  if (!beneficiary) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Text color="gray.500">No child data found.</Text>
      </Flex>
    );
  }

  return (
    <Box className="md:px-36 p-8">
      <GoBackButton />
      <Text fontSize="2xl" fontWeight="bold" mb={4} mt={8}>
        Details
      </Text>
      <Box className="mb-6">
        <BeneficiaryDetailsCard id={beneficiary?.id} beneficiary={beneficiary} />
      </Box>
      <Box className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SponsorshipDetails beneficiaryId={beneficiary?.id} />
        <BeneficiaryActivity beneficiaryId={beneficiary?.id} />
      </Box>

    </Box>
  );
};

export default BeneficiaryDetails;
