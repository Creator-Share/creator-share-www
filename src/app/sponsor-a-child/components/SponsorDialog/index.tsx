"use client"
import React, { useState, useEffect } from "react";
import { Box, Text, Image, Flex, Input, InputAddon, Progress, HStack } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
    DialogBody,
    DialogCloseTrigger,
    DialogContent,
    DialogHeader,
    DialogRoot,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    SelectRoot,
    SelectTrigger,
    SelectValueText,
    SelectContent,
    SelectItem,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { centsToDollars } from "@/utils/currency";
import { toaster } from "@/components/ui/toaster";
import { paymentOptionsCollection } from "./config";
import { SponsorPeople } from "@/types";
import { useAuthStore } from "@/store/authStore";
interface SponsorPeopleImage {
    id: string;
    sponsor_people_id: string;
    image_url: string;
    order_index: number;
}

interface SponsorDialogProps {
    people: SponsorPeople;
    trigger: React.ReactNode;
    useEmbedded?: boolean;
}

const placeholderImage = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";

const SponsorDialog: React.FC<SponsorDialogProps> = ({ people, trigger = false }) => {
    const remainingAmount = (people.budget_goal - people.budget_raised) / 100;
    const [amount, setAmount] = useState<number>(remainingAmount);
    const [selectedOption, setSelectedOption] = useState<string>(paymentOptionsCollection.items[0].value);
    const [value, setValue] = useState<number[]>([remainingAmount]);
    const [loading, setLoading] = useState<boolean>(false);
    const user = useAuthStore((state) => state.user);
    const [images, setImages] = useState<SponsorPeopleImage[]>([]);
    const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

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

    const handleSliderChange = (e: { value: number[] }) => {
        const newValue = Math.min(e.value[0], remainingAmount);
        setValue([newValue]);
        setAmount(newValue);
    };

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value;
        if (inputValue === '') {
            setAmount(0);
            setValue([0]);
            return;
        }
        
        let newValue = parseInt(inputValue) || 0;
        newValue = Math.min(newValue, remainingAmount);
        setAmount(newValue);
        setValue([newValue]);
    };

    const handleSponsor = async () => {
        if (amount <= 0) {
            toaster.create({
                title: "Invalid Amount",
                description: "Please enter a valid amount.",
            });
            return;
        }

        if (amount > remainingAmount) {
            toaster.create({
                title: "Invalid Amount",
                description: "Amount exceeds the remaining budget needed.",
            });
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/api/stripe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    childId: people.id,
                    childName: people.name,
                    childImage: images[currentImageIndex]?.image_url || people.image_url || placeholderImage,
                    amount: amount * 100,
                    paymentType: selectedOption,
                    location: people.country,
                    userId: user?.id,
                    isEmbedded: window.self !== window.top,
                }),
            });

            const { clientSecret, url } = await res.json();
            
            if (window.self !== window.top) {
                if (clientSecret) {
                    window.location.href = `/sponsor-a-child/checkout?client_secret=${clientSecret}`;
                } else if (url) {
                    window.location.href = url;
                }
            } else {
                if (url) {
                    window.location.href = url;
                }
            }
        } catch (err) {
            toaster.create({
                title: "Payment Error",
                description: "Something went wrong. Please try again.",
            });
            console.error("Payment Error:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectChange = (value: string) => {
        setSelectedOption(value);
    };

    const renderDisclaimer = () => {
        const monthlyAmount = selectedOption === "payment" ? (amount / 12).toFixed(2) : amount;
        
        if ((people.budget_goal - people.budget_raised - amount * 100) > 0) {
            return (
                <>
                    This child has a monthly budget goal that must be met for enrollment in school.
                    {selectedOption === "payment" && (
                        <>
                            <br />
                            Your yearly contribution of ${amount} provides ${monthlyAmount} monthly for this child.
                        </>
                    )}
                    <br />
                    Additional sponsors are required to meet this goal.
                </>
            );
        } else if (people.budget_raised > 0) {
            return (
                <>
                    This child is partially sponsored. Your contribution will help reach their monthly budget goal!
                    {selectedOption === "payment" && (
                        <>
                            <br />
                            Your yearly contribution of ${amount} provides ${monthlyAmount} monthly for this child.
                        </>
                    )}
                </>
            );
        }
        return (
            <>
                Your sponsorship will be applied towards the child's monthly budget goals.
                {selectedOption === "payment" && (
                    <>
                        <br />
                        Your yearly contribution of ${amount} provides ${monthlyAmount} monthly for this child.
                    </>
                )}
            </>
        );
    };

    const handleNextImage = () => {
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    };

    return (
        <DialogRoot
            size={{ base: "full", md: "xl" }}
            placement="center"
            motionPreset="slide-in-bottom"
            role="alertdialog"
        >
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogCloseTrigger id="closeDialog" />
                </DialogHeader>
                <DialogBody>
                    <Box className="flex flex-col md:flex-row gap-8 p-5">
                        <Box className="w-full md:w-[359px]">
                            <Box position="relative">
                                <Image
                                    src={images[currentImageIndex]?.image_url || people.image_url || placeholderImage}
                                    alt={people.name}
                                    className="rounded-xl md:h-[479px] w-full object-cover"
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
                        </Box>
                        <Box className="flex-1 border border-[#E8E8EA] p-5">
                            <Text className="text-2xl text-center font-bold md:mt-0 md:text-start">
                                {people.name}
                            </Text>
                            <Progress.Root
                                defaultValue={Math.min((people.budget_raised / people.budget_goal) * 100, 100)}
                                my={8}
                            >
                                <Text className="text-end text-base text-[#959090] font-normal">
                                    Goal: {`$${centsToDollars(people.budget_goal)}`}
                                </Text>
                                <Tooltip
                                    content={`$${centsToDollars(people.budget_raised)} raised`}
                                    showArrow
                                    positioning={{ placement: "right-end" }}
                                >
                                    <HStack gap="5">
                                        <Progress.Track className="rounded-xl h-3" flex="1">
                                            <Progress.Range className="bg-[#1C3C8C]" />
                                        </Progress.Track>
                                    </HStack>
                                </Tooltip>
                            </Progress.Root>
                            <Box>
                                <Text mt={1} className="font-semibold text-base mb-[10px]">
                                    Amount
                                </Text>
                                <Flex
                                    className="border rounded-xl"
                                    mb={4}
                                    align="center"
                                    justify="center"
                                    gap={2}
                                >
                                    <InputAddon className="bg-[#D6D6D6] px-[15px] py-[5px] m-1 text-[#959090] text-base font-medium">
                                        $
                                    </InputAddon>
                                    <Input
                                        type="number"
                                        min="1"
                                        max={remainingAmount}
                                        value={amount || ''}
                                        onChange={handleAmountChange}
                                        className="px-4 h-[50px]"
                                        placeholder="Enter Amount"
                                    />
                                </Flex>
                                <Box my={4}>
                                    <Slider
                                        value={value}
                                        min={0}
                                        max={remainingAmount}
                                        step={5}
                                        variant="solid"
                                        onValueChange={handleSliderChange}
                                    />
                                    <Text textAlign="center" mt={2}>Selected Amount: ${value[0]}</Text>
                                </Box>
                                <Box>
                                    <Text className="font-semibold text-base">Frequency</Text>
                                    <SelectRoot
                                        collection={paymentOptionsCollection}
                                        className="border rounded-xl"
                                        mt={2}
                                        mb={4}
                                        px={4}
                                        py={2}
                                        defaultValue={[paymentOptionsCollection.items[0].value]}
                                        onValueChange={(details) => handleSelectChange(details.value[0])}
                                    >
                                        <SelectTrigger className="w-full">
                                            <SelectValueText />
                                        </SelectTrigger>
                                        <SelectContent className="z-[9999]">
                                            {paymentOptionsCollection.items.map((option) => (
                                                <SelectItem key={option.value} item={option}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </SelectRoot>
                                </Box>
                            </Box>
                            <Flex gap={4}>
                                <Button
                                    onClick={() => document.getElementById('closeDialog')?.click()}
                                    className="flex-1 py-3 bg-[#D1D1D1] text-[#858585]"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleSponsor}
                                    loading={loading}
                                    loadingText="Processing..."
                                    disabled={loading}
                                    className="flex-1 py-3 bg-blue-700 text-white hover:bg-blue-800"
                                >
                                    Checkout
                                </Button>
                            </Flex>
                        </Box>
                    </Box>
                    <Text color="gray.500" textAlign="center" p={1}>
                        {renderDisclaimer()}
                    </Text>
                </DialogBody>
            </DialogContent>
        </DialogRoot>
    );
};

export default SponsorDialog; 