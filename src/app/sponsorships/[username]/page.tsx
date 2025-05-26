"use client";
import React, { useEffect, useState } from "react";
import { fetchActivitiesByBeneficiaryId } from "@/actions";
import Link from "next/link";
import {
  Box,
  Button,
  Flex,
  Heading,
  Image,
  Text,
  VStack,
  Input,
  Spinner,
} from "@chakra-ui/react";
import { useParams } from "next/navigation";
import SponsorshipDetails from "../components/SponsorshipDetails";
import { Activity, Beneficiaries, BeneficiaryMedia } from "@/types";
import SponsorDialog from "../components/SponsorDialog";

export default function FullProfileDynamic() {
  const { username } = useParams();
  const [beneficiary, setBeneficiary] = useState<Beneficiaries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sponsorDialogOpen, setSponsorDialogOpen] = useState(false);
  const [images, setImages] = useState<BeneficiaryMedia[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiaries[]>([]);
  const [currentBeneficiaryIndex, setCurrentBeneficiaryIndex] = useState(0);
  const [activities, setActivities] = useState<Activity[]>([]);

  const placeholderImage = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";

  const fetchImages = async (beneficiaryId: string) => {
    try {
      const response = await fetch(`/api/admin/children/images/${beneficiaryId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        console.error("Expected array of images but got:", data);
        return;
      }
      if (data.length > 0) {
        setImages(data.sort((a: BeneficiaryMedia, b: BeneficiaryMedia) => a.order_index - b.order_index));
      }
    } catch (error) {
      console.error("Error fetching images:", error);
    }
  };

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/children/get/username/${username}`);
        if (!res.ok) {
          throw new Error("Beneficiary not found");
        }
        const data = await res.json();
        console.log("Full API response:", data);
        const { child } = data;
        console.log("Beneficiary data:", child);
        console.log("Image URL:", child?.image_url);
        if (!child) {
          throw new Error("Beneficiary data is empty");
        }
        setBeneficiary(child);
        if (child?.id) {
          await fetchImages(child.id);
          
          // Fetch activities
          const activitiesData = await fetchActivitiesByBeneficiaryId(child.id);
          setActivities(activitiesData);
          
          // Fetch all beneficiaries
          const res = await fetch('/api/children/get');
          const data = await res.json();
          if (data.people) {
            setBeneficiaries(data.people);
            // Find current beneficiary index
            const index = data.people.findIndex((b: Beneficiaries) => b.username === username);
            if (index !== -1) {
              setCurrentBeneficiaryIndex(index);
            }
          }
        }
      } catch (err) {
        setError("Beneficiary not found.");
        setBeneficiary(null);
        console.error(err)
      } finally {
        setLoading(false);
      }
    }
    if (username) fetchData();
  }, [username]);

  if (loading) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Spinner size="xl" color="blue.500" />
      </Flex>
    );
  }

  if (error || !beneficiary) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Text color="red.500" fontSize="xl">{error || "Beneficiary not found."}</Text>
      </Flex>
    );
  }

  return (
    <Box minH="100vh" p={6}>
      <Box maxW="6xl" mx="auto">
        {/* Navigation */}
        <Flex justify="space-between" mb={4}>
          <Button
            onClick={() => {
              const newIndex = currentBeneficiaryIndex - 1;
              if (newIndex >= 0 && beneficiaries[newIndex]?.username) {
                window.location.href = `/sponsorships/${beneficiaries[newIndex].username}`;
              }
            }}
            disabled={currentBeneficiaryIndex === 0}
            variant="outline"
            className={`px-4 py-2 ${currentBeneficiaryIndex === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            ← Previous Beneficiary
          </Button>
          <Button
            onClick={() => {
              const newIndex = currentBeneficiaryIndex + 1;
              if (newIndex < beneficiaries.length && beneficiaries[newIndex]?.username) {
                window.location.href = `/sponsorships/${beneficiaries[newIndex].username}`;
              }
            }}
            disabled={currentBeneficiaryIndex === beneficiaries.length - 1}
            variant="outline"
            className={`px-4 py-2 ${currentBeneficiaryIndex === beneficiaries.length - 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Next Beneficiary →
          </Button>
        </Flex>

        {/* Header */}
        <Flex justify="space-between" align="center" mb={6}>
          <Heading as="h1" className="font-bold text-2xl md:text-[55px]" color="#2B7FF9">
            {beneficiary.name}
          </Heading>
          <Button
            bg="#1C3C8C"
            color="white"
            px={6}
            py={2}
            _hover={{ bg: "#1C2B7A" }}
            onClick={() => setSponsorDialogOpen(true)}
            className="font-semibold text-[15px]"
          >
            Sponsor Me
          </Button>
          <SponsorDialog
            people={beneficiary}
            isOpen={sponsorDialogOpen}
            onOpenChange={setSponsorDialogOpen}
            trigger={<div style={{ display: "none" }} />}
          />
        </Flex>
        <Box mb={8} rounded="xl" overflow="hidden" position="relative" h={{ base: "300px", md: "440px" }}>
          <Image
            src={images.length > 0 ? images[0].image_url : placeholderImage}
            alt={beneficiary.name}
            position="absolute"
            w="100%"
            h="100%"
            objectFit="cover"
          />
        </Box>
        <Box mb={8}>
          <Heading as="h2" className="font-bold text-2xl" mb={4}>
            About Me
          </Heading>
          <Text className="text-[#767070] text-base">
            {beneficiary.biography || beneficiary.introduction || "No biography available."}
          </Text>
        </Box>
        <Heading as="h3" size="lg" color="#2B7FF9" mb={6} className="font-bold text-2xl">
          Latest Updates on {beneficiary.name}
        </Heading>
        <Box className="md:grid md:grid-cols-5 gap-4">
          <Box mb={8} className="md:col-span-3">
            <VStack gap={6} align="stretch">
              {activities.length > 0 ? (
                activities.map((activity: Activity) => (
                  <Link
                    key={activity.id}
                    href={`/sponsorships/${username}/activity/${activity.id}`}
                    style={{ textDecoration: "none" }}
                  >
                    <Flex bg="white" rounded="xl" overflow="hidden" boxShadow="sm" _hover={{ bg: "gray.50" }}>
                      <Box flex="1" p={4}>
                        <Text color="gray.700" mb={2}>{activity.description}</Text>
                        <Text color="gray.500" fontSize="xs">
                          📅 {new Date(activity.created_at).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </Text>
                      </Box>
                    </Flex>
                  </Link>
                ))
              ) : (
                <Text color="gray.500" textAlign="center">No activities available yet.</Text>
              )}
            </VStack>
          </Box>
          <Box className="md:col-span-2">
            <VStack align={"stretch"} gap={6}>
              <SponsorshipDetails beneficiaryId={beneficiary.id} hideStatus />
              <Box bg="#4169E1" rounded="xl" p={8} color="white">
                <Heading as="h3" className="text-2xl font-bold" mb={4} textAlign="center">
                  Sign up to receive FREE monthly updates on {beneficiary.name}
                </Heading>
                <Text fontSize="md" mb={6} textAlign="center">
                  A spirited young girl from France discovering local delicacies.
                </Text>
                <Box maxW="md" mx="auto">
                  <Input
                    type="email"
                    placeholder="name@email.com"
                    bg="white"
                    color="gray.900"
                    mb={4}
                    size="lg"
                    _placeholder={{ color: "gray.500" }}
                    p={2}
                  />
                  <Button
                    bg="white"
                    color="#4169E1"
                    size="lg"
                    width="full"
                    fontWeight="bold"
                    _hover={{ bg: "gray.100" }}
                  >
                    Subscribe
                  </Button>
                </Box>
              </Box>
            </VStack>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
