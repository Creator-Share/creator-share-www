"use client";
import React, { useState, useEffect } from "react";
import { Box, Text, Flex, Badge } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot, FaPerson } from "react-icons/fa6";
import { calculateAge } from "@/utils/ageCalculator";
import { BeneficiaryCardProps } from "@/types/propTypes";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import {
    DialogRoot,
    DialogContent,
    DialogHeader,
    DialogBody,
    DialogCloseTrigger,
    DialogTrigger,
} from "@/components/ui/dialog";
import { BeneficiaryMedia } from "@/types/admin.types";
import BeneficiaryActivityModal from "../SponsorshipActivity/BeneficiaryActivityModal";
import { centsToDollars } from "@/utils/currency";

const BeneficiaryCard: React.FC<BeneficiaryCardProps> = ({
    beneficiary,
    isSelected,
    id,
    onOpenDialog,
    beneficiaryType = "CHILD"
}) => {
    const [images, setImages] = useState<BeneficiaryMedia[]>([]);
    const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
    const [dialogImageIndex, setDialogImageIndex] = useState<number>(0);

    const placeholderImage = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";

    useEffect(() => {
        const fetchImages = async () => {
            try {
                const response = await fetch(`/api/admin/beneficiaries/images/${beneficiary.id}`);
                if (response.ok) {
                    const data = await response.json();
                    setImages(data.sort((a: BeneficiaryMedia, b: BeneficiaryMedia) => a.order_index - b.order_index));
                }
            } catch (error) {
                console.error("Error fetching images:", error);
            }
        };

        fetchImages();
    }, [beneficiary.id, beneficiaryType]);

    useEffect(() => {
        setDialogImageIndex(currentImageIndex);
    }, [currentImageIndex]);

    

    const age = calculateAge(new Date(beneficiary.birth_date).toISOString());

    // const handleNextImage = () => {
    //     setCurrentImageIndex((prev) => (prev + 1) % images.length);
    // };

    const handleDialogNextImage = () => {
        setDialogImageIndex((prev) => (prev + 1) % images.length);
    };

    const [showActivityModal, setShowActivityModal] = useState(false);

    const handleViewActivity = (e: React.MouseEvent) => {
        e.preventDefault();
        setShowActivityModal(true);
    };

    const handleSponsorClick = () => {
        if (onOpenDialog) {
            onOpenDialog();
        } else {
            console.warn("onOpenDialog prop is not defined in BeneficiaryCard");
        }
    };

    return (
        <Box
            id={id}
            borderColor={isSelected ? "blue.500" : "#000000"}
            className={`bg-white mb-6 border rounded-[20px] ${isSelected ? 'highlight-child' : ''} hover:shadow-xl hover:shadow-black/20 transition-all duration-300 hover:scale-105`}
            suppressHydrationWarning={true}
            style={{ overflow: "hidden" }}
            maxW="sm"
            mx="auto"
            height="100%"
            display="flex"
            flexDirection="column"
            cursor="pointer"
            onClick={handleViewActivity}
            transform="translateZ(0)" // Force hardware acceleration
        >
            {/* Card Header: Image with Target Badge */}
            <Box position="relative" flexShrink={0}>
                <DialogRoot>
                    <DialogTrigger asChild>
                        <Box position="relative" cursor="pointer">
                            <Image
                                src={images.length > 0 && images[currentImageIndex]?.image_url ? images[currentImageIndex].image_url : placeholderImage}
                                alt={beneficiary.name?.split(" ")[0] ?? ""}
                                width={500}
                                height={500}
                                style={{ objectFit: "cover", objectPosition: "center 20%" }} // Changed to center
                                className="w-full h-64 rounded-[20px] p-4 transition-transform duration-300 hover:scale-105"
                            />
                            {/* Target Badge - positioned relative to the image container */}
                            <Box
                                position="absolute"
                                bottom="6"
                                right="6"
                                zIndex={10}
                            >
                                <Badge
                                    bg="black"
                                    color="white"
                                    borderRadius="md"
                                    px={2}
                                    py={1}
                                    fontSize="sm"
                                    fontWeight="medium"
                                >
                                    ${centsToDollars(beneficiary.budget_goal)}
                                </Badge>
                            </Box>
                            
                            {/* Image Navigation Dots */}
                            {images.length > 0 && (
                                <Flex
                                    position="absolute"
                                    bottom="12"
                                    left="50%"
                                    transform="translateX(-50%)"
                                    gap={2}
                                    zIndex={5}
                                >
                                    {images.map((_, index) => (
                                        <Box
                                            key={index}
                                            w="2"
                                            h="2"
                                            borderRadius="full"
                                            bg={currentImageIndex === index ? "white" : "whiteAlpha.600"}
                                            cursor="pointer"
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent card click when clicking dots
                                                setCurrentImageIndex(index);
                                            }}
                                        />
                                    ))}
                                </Flex>
                            )}
                        </Box>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogCloseTrigger />
                        </DialogHeader>
                        <DialogBody>
                            <Box position="relative">
                                <Image
                                    src={images.length > 0 && images[dialogImageIndex]?.image_url ? images[dialogImageIndex].image_url : placeholderImage}
                                    alt={`${beneficiary.name?.split(" ")[0] ?? ""} - ${dialogImageIndex + 1}`}
                                    width={800}
                                    height={600}
                                    style={{ objectFit: "contain" }}
                                    className="w-full max-h-[90vh] rounded-xl"
                                />
                                {images.length > 1 && (
                                    <>
                                        <Flex
                                            position="absolute"
                                            bottom="4"
                                            left="50%"
                                            transform="translateX(-50%)"
                                            gap={2}
                                            zIndex={10}
                                        >
                                            {images.map((_, index) => (
                                                <Box
                                                    key={index}
                                                    w="2"
                                                    h="2"
                                                    borderRadius="full"
                                                    bg={dialogImageIndex === index ? "white" : "whiteAlpha.600"}
                                                    cursor="pointer"
                                                    onClick={() => setDialogImageIndex(index)}
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
                                                setDialogImageIndex((prev) => (prev - 1 + images.length) % images.length);
                                            }}
                                            size="sm"
                                            variant="ghost"
                                            color="white"
                                            _hover={{ bg: 'whiteAlpha.200' }}
                                            zIndex={10}
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
                                                handleDialogNextImage();
                                            }}
                                            size="sm"
                                            variant="ghost"
                                            color="white"
                                            _hover={{ bg: 'whiteAlpha.200' }}
                                            zIndex={10}
                                        >
                                            →
                                        </Button>
                                    </>
                                )}
                            </Box>
                        </DialogBody>
                    </DialogContent>
                </DialogRoot>
            </Box>

            {/* Card Content */}
            <Box p={4} flex="1" display="flex" flexDirection="column"> {/* Add flex="1" and display="flex" flexDirection="column" */}
                {/* Full Name Heading */}
                <Text fontSize="xl" fontWeight="bold" mb={3} className="text-gray-800">
                    {beneficiary.name || "Full Name"}
                </Text>

                {/* Information Row */}
                <Flex gap={4} mb={4} flexWrap="wrap">
                    <Flex align="center" gap={1}>
                        <FaCalendar/>
                        <Text fontSize="sm">
                            {age ? `${age} years` : "DOB"}
                        </Text>
                    </Flex>
                    <Flex align="center" gap={1}>
                        <FaPerson/>
                        <Text fontSize="sm">
                            {beneficiary.gender || "Gender"}
                        </Text>
                    </Flex>
                    <Flex align="center" gap={1}>
                        <FaLocationDot/>
                        <Text fontSize="sm">
                            {beneficiary.country || "Location"}
                        </Text>
                    </Flex>
                </Flex>

                {/* Info Section */}
                <Box mb={4} flex="1"> {/* Add flex="1" to take available space */}
                    <Text fontSize="lg" fontWeight="semibold" mb={2} className="text-gray-800">
                        Info
                    </Text>
                    <Text 
                        fontSize="sm" 
                        style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            lineHeight: '1.4'
                        }}
                    >
                        {beneficiary.biography || "Brief description"}
                    </Text>
                </Box>

                {/* Action Buttons - Push to bottom */}
                <Box mt="auto" pt={4}>
                    <Flex gap={2}>
                        {beneficiary.status !== "Budget Fulfilled" ? (
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent card click when clicking button
                                    handleSponsorClick();
                                }}
                                className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
                                size="sm"
                            >
                                {beneficiaryType === "ANIMAL" ? "Adopt" : "Sponsor"}
                            </Button>
                        ) : (
                            <Button
                                className="flex-1 bg-gray-400 text-white cursor-not-allowed"
                                disabled
                                size="sm"
                            >
                                {beneficiaryType === "ANIMAL" ? "Adopted" : "Budget Fulfilled"}
                            </Button>
                        )}
                    </Flex>
                </Box>

                {/* Learn More Section */}
                {/* <Box mt={3}>
                    <Text
                        className="text-blue-600 cursor-pointer text-sm flex items-center gap-1"
                        onClick={() => setIsLearnMoreOpen(!isLearnMoreOpen)}
                    >
                        More about {beneficiary.name?.split(" ")[0] || "this person"} {isLearnMoreOpen ? <FaCaretUp /> : <FaCaretDown />}
                    </Text>
                </Box> */}
            </Box>

            {/* Collapsible Content */}
            {/* <Collapsible.Root
                open={isLearnMoreOpen}
                onOpenChange={() => setIsLearnMoreOpen(!isLearnMoreOpen)}
                style={{ overflow: 'hidden', transition: 'height 0.3s ease' }}
            >
                <Collapsible.Content>
                    <Box p={4} bg="gray.50" borderTop="1px solid" borderColor="gray.200">
                        <Text fontSize="md" fontWeight="semibold" mb={2} color="blue.600">
                            About {beneficiary.name?.split(" ")[0] || "this person"}
                        </Text>
                        <Text fontSize="sm" className="text-gray-700 mb-4">
                            {beneficiary.biography || "No biography available."}
                        </Text>

                        {beneficiary.video_url && (
                            <Box mt={4} mb={4}>
                                <video width="100%" height="auto" controls preload="none" className="border rounded-lg">
                                    <source src={beneficiary.video_url} type="video/mp4" />
                                </video>
                            </Box>
                        )}
 
                        {beneficiary.status !== "Budget Fulfilled" ? (
                            <Button
                                className="w-full bg-blue-600 text-white hover:bg-blue-700"
                                onClick={handleSponsorClick}
                                size="sm"
                            >
                                {beneficiaryType === "ANIMAL" ? "Adopt" : "Sponsor"} {beneficiary.name?.split(" ")[0] || "this person"}
                            </Button>
                        ) : (
                            <Button
                                className="w-full bg-gray-400 text-white cursor-not-allowed"
                                disabled
                                size="sm"
                            >
                                {beneficiaryType === "ANIMAL" ? "Adopted" : "Budget Fulfilled"}
                            </Button>
                        )}
                    </Box>
                </Collapsible.Content>
            </Collapsible.Root> */}

            <BeneficiaryActivityModal
                open={showActivityModal}
                onClose={() => setShowActivityModal(false)}
                beneficiary={{ ...beneficiary, image_url: images.length > 0 && images[currentImageIndex]?.image_url ? images[currentImageIndex].image_url : undefined }}
            />
        </Box>
    );
};

export default BeneficiaryCard;
