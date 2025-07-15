"use client";
import React, { useState, useEffect } from "react";
import { Box, Text, Flex } from "@chakra-ui/react";
import { FaCalendar, FaCaretDown, FaCaretUp } from "react-icons/fa";
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
import { Collapsible } from "@chakra-ui/react";
import { BeneficiaryMedia } from "@/types/admin.types";
import BeneficiaryActivityModal from "../SponsorshipActivity/BeneficiaryActivityModal";
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
    const [isLearnMoreOpen, setIsLearnMoreOpen] = useState<boolean>(false);

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

    useEffect(() => {
        return () => {
            setIsLearnMoreOpen(false);
        };
    }, []);

    const age = calculateAge(new Date(beneficiary.birth_date).toISOString());

    const handleNextImage = () => {
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    };

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
            borderColor={isSelected ? "blue.500" : "gray.200"}
            borderRadius={{ base: 'md', md: 'md' }}
            className={`bg-white mb-6 ${isLearnMoreOpen ? 'border-t border-l border-r' : 'border-0 md:border'} md:mb-0 ${isSelected ? 'highlight-child' : ''}`}
            suppressHydrationWarning={true}
            style={{ overflow: "hidden" }}
        >
            {/* Card Header: Image, Name, Info, Buttons */}
            <Flex
                direction={{ base: "column", md: "row" }}
                align={{ base: "center", md: "flex-start" }}
                textAlign={{ base: "center", md: "left" }}
            >
                <DialogRoot>
                    <DialogTrigger asChild>
                        <Box position="relative">
                            <Image
                                src={images.length > 0 && images[currentImageIndex]?.image_url ? images[currentImageIndex].image_url : placeholderImage}
                                alt={beneficiary.name?.split(" ")[0] ?? ""}
                                width={140}
                                height={273}
                                style={{ objectFit: "cover" }}
                                className={`mb-4 md:mb-0 min-h-[400px] h-[400px] w-[550px] md:min-h-[273px] md:h-[273px] md:w-[450px] cursor-pointer ${isLearnMoreOpen ? '' : 'rounded-t-md md:rounded-l-md md:rounded-t-none'
                                    }`}
                            />
                            {images.length > 0 && (
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
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setCurrentImageIndex(index);
                                                }}
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
                <Box className="md:grid md:grid-cols-2 pt-[20px] w-full md:w-screen">
                    <Box ml={{ md: 6 }} w="full">
                        <Text fontSize="4xl" fontWeight="bold" mb={2} className="text-[#03150E]">
                            {beneficiary.name?.split(" ")[0]}
                        </Text>
                        <Box fontSize="base" className="text-[#767070] bg-[#DFDFDF] rounded-xl md:bg-white p-4 mb-4 text-left md:text-center">
                            <Flex align="center" gap={2} mb={4}>
                                <FaCalendar />
                                <Text fontSize="sm" className="text-gray-500">
                                    {age} year{age > 1 ? 's' : ''} old
                                </Text>
                            </Flex>
                            <Flex align="center" gap={2} mb={4}>
                                <FaPerson />
                                <Text fontSize="sm" className="text-gray-500">
                                    {beneficiary.gender}
                                </Text>
                            </Flex>
                            <Flex align="center" gap={2} mb={4}>
                                <FaLocationDot />
                                <Text fontSize="sm" className="text-gray-500">
                                    {beneficiary.country}
                                </Text>
                            </Flex>
                            <Flex cursor="pointer" align={"center"} gap={2}>
                                <Text fontSize="base" className="text-[#767070]">
                                    <span
                                        className="text-[#1C3C8C] cursor-pointer whitespace-nowrap flex items-center gap-1"
                                        onClick={() => setIsLearnMoreOpen(!isLearnMoreOpen)}
                                    >
                                        More about {beneficiary.name?.split(" ")[0]} {isLearnMoreOpen ? <FaCaretUp /> : <FaCaretDown />}
                                    </span>
                                </Text>
                            </Flex>
                        </Box>
                    </Box>
                    <Box className="px-4 md:px-4">
                        <Flex>
                            <Text fontSize="4xl" fontWeight="medium" mb={2} className="text-[#03150E]">Bio</Text>
                        </Flex>
                        <Flex gap={2} align="center" className="w-full flex">
                            <Button
                                onClick={handleViewActivity}
                                className="border-[#1C3C8C] font-semibold text-[#1C3C8C] border hover:bg-[#1C3C8C] px-4 hover:text-[#FFFFFF] w-1/2"
                            >
                                View Activity
                            </Button>
                            {beneficiary.status !== "Budget Fulfilled" ? (
                                <Button
                                    fontWeight="md"
                                    className="text-[#FFFFFF] px-4 cursor-pointer bg-[#1C3C8C] w-1/2"
                                    onClick={handleSponsorClick}
                                >
                                    {beneficiaryType === "ANIMAL" ? "Adopt" : "Sponsor"}
                                </Button>
                            ) : (
                                <Button
                                    fontWeight="md"
                                    className="text-[#FFFFFF] disabled cursor-not-allowed bg-gray-400 w-1/2"
                                    disabled
                                >
                                    {beneficiaryType === "ANIMAL" ? "Adopted" : "Budget Fulfilled"}
                                </Button>
                            )}
                        </Flex>
                        <BeneficiaryActivityModal
                            open={showActivityModal}
                            onClose={() => setShowActivityModal(false)}
                            beneficiary={{ ...beneficiary, image_url: images.length > 0 && images[currentImageIndex]?.image_url ? images[currentImageIndex].image_url : undefined }}
                        />
                    </Box>
                </Box>
            </Flex>

            <Collapsible.Root
                open={isLearnMoreOpen}
                onOpenChange={() => setIsLearnMoreOpen(!isLearnMoreOpen)}
                style={{ overflow: 'hidden', transition: 'height 0.3s ease' }}
            >
                <Collapsible.Content>
                    {/* About Section */}
                    <Box
                        p={6}
                        bg="white"
                        mx="auto"
                        mt={4}
                        className="w-full text-left"
                    >
                        <Text fontSize="xl" fontWeight="semibold" mb={4} color="#1C3C8C">
                            {beneficiary.biography}
                        </Text>
                    </Box>
                    {/* Video Section */}
                    {beneficiary.video_url && (
                        <Box
                            mt={4}
                            mb={4}
                            className="w-full flex justify-center"
                        >
                            <video width="100%" height="auto" controls preload="none" className="border rounded-xl max-w-full">
                                <source src={beneficiary.video_url} type="video/mp4" />
                            </video>
                        </Box>
                    )}
                    <Box className={isLearnMoreOpen ? 'border-b' : ''}>
                        {beneficiary.status !== "Budget Fulfilled" ? (
                            <Box fontSize="base" className="pb-6 px-6">
                                <Button
                                    fontWeight="md"
                                    className="text-[#FFFFFF] w-full cursor-pointer bg-[#1C3C8C] mt-8"
                                    onClick={handleSponsorClick}
                                >
                                    {beneficiaryType === "ANIMAL" ? "Adopt" : "Sponsor"} {beneficiary.name?.split(" ")[0]}
                                </Button>
                            </Box>
                        ) : (
                            <Box fontSize="base" className="pb-6 px-6">
                                <Button fontWeight="md" className="text-[#FFFFFF] disabled w-full cursor-not-allowed bg-gray-400 mt-8">
                                    {beneficiaryType === "ANIMAL" ? "Adopted" : "Budget Fulfilled"}
                                </Button>
                            </Box>
                        )}
                    </Box>
                </Collapsible.Content>
            </Collapsible.Root>
        </Box>
    );
};

export default BeneficiaryCard;
