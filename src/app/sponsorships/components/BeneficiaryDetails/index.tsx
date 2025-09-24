"use client";
import { Box, Flex, Text, Image, Button } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot } from "react-icons/fa6";
import { calculateAge } from "@/utils/ageCalculator";
import { formatDate } from "@/utils/dateFormatter";
import { BeneficiaryCardProps } from "@/types/propTypes";
import { useState, useEffect } from "react";
import { BeneficiaryMedia } from "@/types";
import { generatePublicUrl } from "@/utils/supabase/media";


const BeneficiaryDetailsCard: React.FC<BeneficiaryCardProps> = ({ beneficiary }) => {
    const [images, setImages] = useState<BeneficiaryMedia[]>([]);
    const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

    const placeholderImage = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";

    useEffect(() => {
        const fetchImages = async () => {
            try {
                const response = await fetch(`/api/admin/beneficiaries/images/${beneficiary.id}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                if (!Array.isArray(data)) {
                    console.error("Expected array of images but got:", data);
                    return;
                }
                if (data.length === 0) {
                    return;
                }
                setImages(data.sort((a: BeneficiaryMedia, b: BeneficiaryMedia) => a.order_index - b.order_index));
            } catch (error) {
                console.error("Error fetching images:", error);
            }
        };

        fetchImages();
    }, [beneficiary.id]);

    const age = calculateAge(new Date(beneficiary.birth_date).toISOString());
    const formattedBirthDate = formatDate(new Date(beneficiary.birth_date).toISOString());

    const handleNextImage = () => {
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case "Budget Fulfilled":
                return (
                    <Box>
                        <Image src="/fulfilled.png" alt="Fulfilled" width={24} height={24} />
                        <Text className="text-[#03150E] font-bold text-center">Sponsored</Text>
                        <Text></Text>
                    </Box>
                );
            case "Partially Funded":
                return (
                    <Box gap={2}>
                        <Image src="/pending.png" alt="Pending" width={24} height={24} />
                        <Text className="text-[#767070] text-center">Pending</Text>
                    </Box>
                );
            case "New":
                return <Text className="text-[#767070] text-center">Sponsor</Text>;
            default:
                return <Text className="text-[#767070] text-center">Nothing to show</Text>;
        }
    };

    return (
        <Flex
            maxW="1100px"
            mx="auto"
            mt={10}
            gap={8}
            direction={{ base: "column", md: "row" }}
        >
            <Box
                minW={{ base: "auto", md: "400px" }}
                maxW="400px"
                h="400px"
                borderRadius="xl"
                overflow="hidden"
                boxShadow="md"
                bg="gray.50"
                display="flex"
                alignItems="center"
                justifyContent="center"
                position="relative"
                p={0}
            >
                <Box
                    position="relative"
                    width="100%"
                    height="100%"
                >
                    <Image
                        src={
                          images.length > 0 && images[currentImageIndex]?.id
                            ? generatePublicUrl(images[currentImageIndex] as any)
                            : images.length > 0 && images[currentImageIndex]?.id
                              ? generatePublicUrl(images[currentImageIndex] as any)
                              : images.length > 0 && images[currentImageIndex]?.image_url
                                ? images[currentImageIndex].image_url
                                : placeholderImage
                        }
                        alt={beneficiary.name}
                        objectFit="cover"
                        width="100%"
                        height="100%"
                        borderRadius="xl"
                    />
                    {images.length > 1 && (
                        <>
                            <Flex
                                position="absolute"
                                bottom="4"
                                left="50%"
                                transform="translateX(-50%)"
                                gap={2}
                            >
                                {images.map((_, index) => (
                                    <Box
                                        key={index}
                                        w="2"
                                        h="2"
                                        borderRadius="full"
                                        bg={currentImageIndex === index ? "white" : "whiteAlpha.600"}
                                        cursor="pointer"
                                        onClick={() => setCurrentImageIndex(index)}
                                    />
                                ))}
                            </Flex>
                            <Button
                                position="absolute"
                                left="2"
                                top="50%"
                                transform="translateY(-50%)"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
                                }}
                                size="sm"
                                variant="ghost"
                                color="white"
                                _hover={{ bg: 'whiteAlpha.200' }}
                            >
                                ←
                            </Button>
                            <Button
                                position="absolute"
                                right="2"
                                top="50%"
                                transform="translateY(-50%)"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleNextImage();
                                }}
                                size="sm"
                                variant="ghost"
                                color="white"
                                _hover={{ bg: 'whiteAlpha.200' }}
                            >
                                →
                            </Button>
                        </>
                    )}
                </Box>
            </Box>
            <Box flex="1" px={{ base: 0, md: 6 }} py={4}>
                <Text fontSize="4xl" fontWeight="bold" mb={2} className="text-[#03150E]">
                    {beneficiary.name}
                </Text>
                <Flex align="center" gap={3} mb={4}>
                    <FaCalendar />
                    <Text fontSize="sm" color="gray.500">
                        {formattedBirthDate} | {age} years old
                    </Text>
                    <FaLocationDot />
                    <Text fontSize="sm" color="gray.500">
                        {beneficiary.country}
                    </Text>
                </Flex>
                <Box bg="gray.50" borderRadius="md" p={4}>
                    <Text fontSize="xl" fontWeight="bold" mb={2} className="text-[#03150E]">
                        Bio
                    </Text>
                    <Text color="gray.700" lineHeight="tall">
                        {beneficiary.biography}
                    </Text>
                </Box>
            </Box>
            <Box
                minW="200px"
                bg="white"
                borderRadius="xl"
                boxShadow="md"
                display="flex"
                alignItems="center"
                justifyContent="center"
                p={6}
            >
                {getStatusText(beneficiary.status)}
            </Box>
        </Flex>
    );
};

export default BeneficiaryDetailsCard;
