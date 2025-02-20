"use client";
import React, { useState, useEffect } from "react";
import { Box, Text, Image, Flex } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot, FaPerson } from "react-icons/fa6";
import { calculateAge } from "@/utils/ageCalculator";
import { centsToDollars } from "@/utils/currency";
import { ChildCardProps } from "@/types/propTypes";
import SponsorDialog from "../SponsorDialog";
import { Button } from "@/components/ui/button";
import {
    DialogRoot,
    DialogContent,
    DialogHeader,
    DialogBody,
    DialogCloseTrigger,
    DialogTrigger,
} from "@/components/ui/dialog";

interface SponsorPeopleImage {
    id: string;
    sponsor_people_id: string;
    image_url: string;
    order_index: number;
}

const ChildCard: React.FC<ChildCardProps> = ({ people, isSelected }) => {
    const [images, setImages] = useState<SponsorPeopleImage[]>([]);
    const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
    const [dialogImageIndex, setDialogImageIndex] = useState<number>(0);

    const placeholderImage = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";

    useEffect(() => {
        const fetchImages = async () => {
            try {
                const response = await fetch(`/api/admin/children/images/${people.id}`);
                if (response.ok) {
                    const data = await response.json();
                    setImages(data.sort((a: SponsorPeopleImage, b: SponsorPeopleImage) => a.order_index - b.order_index));
                }
            } catch (error) {
                console.error("Error fetching images:", error);
            }
        };

        fetchImages();
    }, [people.id]);

    useEffect(() => {

        setDialogImageIndex(currentImageIndex);
    }, [currentImageIndex]);

    const age = calculateAge(new Date(people.birth_date).toISOString());

    const handleNextImage = () => {
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    };

    const handleDialogNextImage = () => {
        setDialogImageIndex((prev) => (prev + 1) % images.length);
    };

    return (
        <Flex
            direction={{ base: "column", md: "row" }}
            align={{ base: "center", md: "flex-start" }}
            textAlign={{ base: "center", md: "left" }}
            borderColor={isSelected ? "blue.500" : "gray.200"}
            borderRadius={{ base: 'md', md: 'md' }}
            className="bg-white mb-6 p-0 border-0 md:border md:mb-0 md:p-0"
        >
            <DialogRoot>
                <DialogTrigger asChild>
                    <Box position="relative">
                        <Image
                            src={images[currentImageIndex]?.image_url || people.image_url || placeholderImage}
                            alt={people.name}
                            objectFit="cover"
                            className="mb-4 md:mb-0 rounded-t-md h-[400px] w-[550px] md:rounded-l-md md:rounded-t-none md:h-[273px] md:w-[450px] cursor-pointer"
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
                                src={images[dialogImageIndex]?.image_url || people.image_url || placeholderImage}
                                alt={`${people.name} - ${dialogImageIndex + 1}`}
                                objectFit="contain"
                                className="w-full max-h-[90vh] rounded-lg"
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
                        {people.name}
                    </Text>
                    <Box fontSize="base" className="text-[#767070] bg-[#DFDFDF] rounded-md md:bg-white p-4 mb-4 text-left md:text-center">
                        <Flex align="center" gap={2} mb={4}>
                            <FaCalendar />
                            <Text fontSize="sm" className="text-gray-500">
                                {age} year{age > 1 ? 's' : ''} old
                            </Text>
                        </Flex>
                        <Flex align="center" gap={2} mb={4}>
                            <FaPerson />
                            <Text fontSize="sm" className="text-gray-500">
                                {people.gender}
                            </Text>
                        </Flex>
                        <Flex align="center" gap={2}>
                            <FaLocationDot />
                            <Text fontSize="sm" className="text-gray-500">
                                {people.country}
                            </Text>
                        </Flex>
                    </Box>
                    <Box mb={4}>
                        <Box bg="gray.200" h="2px" w="full" borderRadius="full">
                            <Box
                                bg="#1C3C8C"
                                h="2px"
                                w={`${Math.min((people.budget_raised / people.budget_goal) * 100, 100)}%`}
                                borderRadius="full"
                            />
                        </Box>
                        <Text fontSize="sm" mt={1} className="text-gray-500">
                            ${centsToDollars(people.budget_raised)} raised of ${centsToDollars(people.budget_goal)}
                        </Text>
                    </Box>
                </Box>
                <Box className="md:ml-14 px-4 md:px-0">
                    <Text fontSize="4xl" fontWeight="bold" className="text-[#03150E] mb-1">
                        Introduction
                    </Text>
                    <Text fontSize="base" className="text-[#767070]">
                        {people.introduction}
                    </Text>
                    <SponsorDialog
                        people={people}
                        trigger={
                            <Box fontSize="base" mb={3}>
                                <Button fontWeight="md" className="text-[#FFFFFF] w-full md:w-11/12 cursor-pointer bg-[#1C3C8C] px-4 mt-8">
                                    Sponsor
                                </Button>
                            </Box>
                        }
                    />
                </Box>
            </Box>
        </Flex>
    );
};

export default ChildCard;
