"use client";
import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Heading,
  Image,
  Text,
  VStack,
  HStack,
  Input,
  Spinner,
} from "@chakra-ui/react";
import { useParams } from "next/navigation";
import SponsorshipDetails from "../components/SponsorshipDetails";
import { Beneficiaries, BeneficiaryMedia } from "@/types";
import SponsorDialog from "../components/SponsorDialog";

export default function FullProfileDynamic() {
  const { username } = useParams();
  const [beneficiary, setBeneficiary] = useState<Beneficiaries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sponsorDialogOpen, setSponsorDialogOpen] = useState(false);
  const [images, setImages] = useState<BeneficiaryMedia[]>([]);

  const placeholderImage = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";
  const updates = [
    {
      image: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=facearea&w=400&q=80",
      title: "Sylvain Dada Goes to school",
      author: "Fritz",
      date: "19 January 2019",
      comments: 2,
      description: "A 6-year-old boy from Congo - Democratic Republic of full of hope",
    },
    {
      image: "https://images.unsplash.com/photo-1465101046530-73398c7f28ca?auto=format&fit=facearea&w=400&q=80",
      title: "Sylvain Dada Goes to school",
      author: "Fritz",
      date: "19 January 2019",
      comments: 2,
      description: "A 6-year-old boy from Congo - Democratic Republic of full of hope",
    },
    {
      image: "https://images.unsplash.com/photo-1519125323398-675f0ddb6308?auto=format&fit=facearea&w=400&q=80",
      title: "Sylvain Dada Visits the market",
      author: "Jules",
      date: "15 February 2020",
      comments: 5,
      description: "A spirited young girl from France discovering local delicacies.",
    },
    {
      image: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=facearea&w=400&q=80",
      title: "Sylvain Dada Explores the city",
      author: "Yuki",
      date: "3 March 2021",
      comments: 3,
      description: "A curious teenager from Japan experiencing urban life.",
    },
  ];

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
        <Box className="grid grid-cols-2 gap-4">
          <Box mb={8}>
            <VStack gap={6} align="stretch">
              {updates.map((update, idx) => (
                <Flex key={idx} bg="white" rounded="xl" overflow="hidden" boxShadow="sm">
                  <Image src={update.image} alt={update.title} w="144px" h="144px" objectFit="cover" />
                  <Box flex="1" p={4}>
                    <Text fontWeight="bold" fontSize="lg" mb={1}>
                      {update.title}
                    </Text>
                    <HStack color="gray.500" fontSize="xs" mb={2} gap={4}>
                      <Text>👤 {update.author}</Text>
                      <Text>📅 {update.date}</Text>
                      <Text>💬 {update.comments} Comments</Text>
                    </HStack>
                    <Text color="gray.700">{update.description}</Text>
                  </Box>
                </Flex>
              ))}
            </VStack>
            <Flex justify="center" align="center" gap={2} mt={6}>
              <Button size="sm" bg="white" border="1px" borderColor="gray.200" color="gray.500">
                {"<"}
              </Button>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  bg={n === 1 ? "#3b5bdb" : "white"}
                  color={n === 1 ? "white" : "gray.500"}
                  border="1px"
                  borderColor="gray.200"
                  _hover={{ bg: n === 1 ? "#274690" : "gray.100" }}
                >
                  {n}
                </Button>
              ))}
              <Button size="sm" bg="white" border="1px" borderColor="gray.200" color="gray.500">
                {">"}
              </Button>
            </Flex>
          </Box>
          <Box>
            <VStack align={"stretch"} gap={6}>
              <SponsorshipDetails beneficiaryId={beneficiary.id} hideStatus />
              <Box bg="#4169E1" rounded="xl" p={8} color="white">
                <Heading as="h3" size="lg" mb={4} textAlign="center">
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
