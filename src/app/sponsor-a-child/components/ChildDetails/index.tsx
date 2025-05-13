"use client";
import { Box, Flex, Text, Image, Button } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot } from "react-icons/fa6";
import { calculateAge } from "@/utils/ageCalculator";
import { formatDate } from "@/utils/dateFormatter";
import { ChildSponsorship, SponsorshipImage } from "@/types";
import { useState, useEffect } from "react";

interface ChildDetailsCardProps {
  id: string;
  child: ChildSponsorship;
}

const ChildDetailsCard: React.FC<ChildDetailsCardProps> = ({ child }) => {
    const [images, setImages] = useState<SponsorshipImage[]>([]);
    const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

    const placeholderImage = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";

    useEffect(() => {
        const fetchImages = async () => {
            try {
                const response = await fetch(`/api/admin/sponsorships/images/${child.id}`);
                if (response.ok) {
                    const data = await response.json();
                    setImages(data.sort((a: SponsorshipImage, b: SponsorshipImage) => a.order_index - b.order_index));
                }
            } catch (error) {
                console.error("Error fetching images:", error);
            }
        };

        fetchImages();
    }, [child.id]);

    const age = calculateAge(new Date(child.birth_date).toISOString());
    const formattedBirthDate = formatDate(new Date(child.birth_date).toISOString());

    const handleNextImage = () => {
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case "INACTIVE":
                return (
                    <Box>
                        <Image src="/fulfilled.png" alt="Fulfilled" width={24} height={24} />
                        <Text className="text-[#03150E] font-bold text-center">Sponsored</Text>
                        <Text></Text>
                    </Box>
                );
            case "PENDING":
                return (
                    <Box gap={2}>
                        <Image src="/pending.png" alt="Pending" width={24} height={24} />
                        <Text className="text-[#767070] text-center">Pending</Text>
                    </Box>
                );
            case "ACTIVE":
                return <Text className="text-[#767070] text-center">Available for Sponsorship</Text>;
            default:
                return <Text className="text-[#767070] text-center">Nothing to show</Text>;
        }
    };

    return (
        <Flex direction={{ base: "column", md: "row" }} gap={6}>
            <Flex
                direction={{ base: "column", md: "row" }}
                align={{ base: "center", md: "flex-start" }}
                textAlign={{ base: "center", md: "left" }}
                borderWidth="1px"
                borderRadius={{ base: 'lg', md: 'md' }}
                className="bg-white p-6 mb-6 md:p-0 md:mb-0 w-full"
            >
                <Box position="relative" p={"10px"}>
                    <Image
                        src={images.length > 0 && images[currentImageIndex]?.image_url ? images[currentImageIndex].image_url : placeholderImage}
                        alt={child.name}
                        objectFit="cover"
                        rounded={"full"}
                        className="mb-4 md:mb-0"
                        w={{ base: "150px", md: "115px" }}
                        h={{ base: "150px", md: "115px" }}
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
                <Box className="md:grid md:grid-cols-2 pt-[20px] gap-3">
                    <Box ml={{ md: 6 }} w="full">
                        <Text fontSize="4xl" fontWeight="bold" mb={2} className="text-[#03150E]">
                            {child.name}
                        </Text>
                        <Flex fontSize="base" className="text-[#767070] gap-3" display={{ base: "column", md: "flex" }}>
                            <Flex justify={{ base: "center", md: "flex-start" }} align="center" className="gap-3">
                                <FaCalendar />
                                <Text fontSize="sm" className="text-gray-500">
                                    {formattedBirthDate} | {age} years old
                                </Text>
                            </Flex>
                            <Flex justify={{ base: "center", md: "flex-start" }} align="center" gap={2}>
                                <FaLocationDot />
                                <Text fontSize="sm" className="text-gray-500">
                                    {child.country}
                                </Text>
                            </Flex>
                        </Flex>
                    </Box>
                    <Box className="md:ml-14">
                        <Text fontSize="4xl" fontWeight="bold" className="text-[#03150E] mb-1">
                            Bio
                        </Text>
                        <Box fontSize="base" mb={3}>
                            <Text className="text-[#767070] mb-4">
                                {child.biography}
                            </Text>
                        </Box>
                    </Box>
                </Box>
            </Flex>
            <Flex direction={{ base: "column", md: "row" }} borderWidth="1px" borderRadius={{ base: 'lg', md: 'md' }} className="bg-white p-6 mb-6 md:p-0 md:mb-0">
                <Box className="flex justify-center items-center h-full px-8">
                    {getStatusText(child.status)}
                </Box>
            </Flex>
        </Flex>
    );
};

export default ChildDetailsCard;
