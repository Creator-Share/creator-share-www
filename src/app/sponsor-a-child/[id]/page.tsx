"use client";
import React, { useEffect, useState } from "react";
import { Box, Flex, Text, Spinner, Button, Heading } from "@chakra-ui/react";
import { People } from "@/types";
import { useRouter } from "next/navigation";
import ChildCard from "../components/ChildCard";
import { RiArrowGoBackLine } from "react-icons/ri";

const ChildDetails: React.FC<{ params: Promise<{ id: string }> }> = ({ params }) => {
  const { id } = React.use(params);
  const [child, setChild] = useState<People | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();

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
    <Box px={32} py={16}>
      <Button
        mb={4}
        colorScheme="blue"
        onClick={() => router.back()}
      >
        <RiArrowGoBackLine /> Go Back
      </Button>
      <Text fontSize="2xl" fontWeight="bold" mb={4}>
        Details
      </Text>
      <ChildCard id={child.id} people={child} />
      <Box
        p={6}
        bg="white"
        borderRadius="lg"
        mx="auto"
        className="flex flex-row"
      >
        <Box mr="8">
          <Text fontSize="xl" fontWeight="semibold" mb={4} color="#1C3C8C">
            About {child.name}
          </Text>
          <Text mb={4}>
            {child.name} lives with her grandmother and has no brothers or sisters.
            Her grandmother struggles to provide for the family and works as a
            construction worker. Despite their efforts, it is difficult to meet
            the family's needs.
          </Text>

          <Text mb={4}>
            {child.gender === 'male' ? 'He' : 'She'} helps at home by being good.
            {child.gender === 'male' ? 'He' : 'She'} likes to play cooking and baking.
            {child.gender === 'male' ? 'He' : 'She'} is in satisfactory health.
          </Text>

          <Text mb={4}>
            {child.name} is growing up in a poor rural community in the beautiful
            country of {child.country}. Family homes are constructed with wood and
            palm leaves and sit on stilts to keep floodwaters out during the rainy
            season. Families survive on rice, fish and home-grown vegetables.
            The climate in the region is hot.
          </Text>

          <Heading size="md" mb={4} color="#1C3C8C">
            How Sponsorship Helps
          </Heading>

          <Text mb={4}>
            Your sponsorship commitment will help provide {child.name} and her
            community with improved health through training in nutrition and
            maternal healthcare. Education on hygiene and sanitation, as well as
            access to clean water, will reduce illnesses.
          </Text>

          <Text mb={4}>
            Schools will benefit from educational materials and trainings for
            teachers. Parents will learn skills to improve their financial
            situations. And our caring staff will reflect Christ's love to
            these children through their actions and lives.
          </Text>
        </Box>
        <Box mt="12">
          <video width="3000" height="56000" controls preload="none">
            <source src="/path/to/video.mp4" type="video/mp4" />
            <track
              src="https://d4j0oemdjsbb4.cloudfront.net/child/video/221653-RTVW_20250116_103806_CGV_Web.mp4"
              kind="subtitles"
              srcLang="en"
              label="English"
            />
            Your browser does not support the video tag.
          </video>
        </Box>
      </Box>

      <Button
          className="bg-[#1C3C8C] text-base font-semibold text-white"
          w="full"
          mt={6}
          onClick={() => alert(`Initiating sponsorship for ${child.name}`)}
        >
          Sponsor {child.name}
        </Button>
    </Box>
  );
};

export default ChildDetails;