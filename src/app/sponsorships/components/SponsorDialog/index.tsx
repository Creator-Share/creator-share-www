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
import { Beneficiaries } from "@/types";
import { useAuthStore } from "@/store/authStore";
import { BeneficiaryMedia } from "@/types/admin.types";


interface SponsorDialogProps {
    people: Beneficiaries;
    trigger: React.ReactNode;
    useEmbedded?: boolean;
    onNext?: () => void;
    onPrevious?: () => void;
    hasNext?: boolean;
    hasPrevious?: boolean;
    isOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
}

const placeholderImage = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";

// Check if we're in an iframe
const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

const SponsorDialog: React.FC<SponsorDialogProps> = ({ 
    people, 
    trigger = false, 
    onNext, 
    onPrevious,
    hasNext = false,
    hasPrevious = false,
    isOpen = false,
    onOpenChange
}) => {
    const remainingAmount = (people.budget_goal - people.budget_raised) / 100;
    const [amount, setAmount] = useState<number>(remainingAmount);
    const [selectedOption, setSelectedOption] = useState<string>(paymentOptionsCollection.items[0].value);
    const [value, setValue] = useState<number[]>([remainingAmount]);
    const [loading, setLoading] = useState<boolean>(false);
    const user = useAuthStore((state) => state.user);
    const [images, setImages] = useState<BeneficiaryMedia[]>([]);
    const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

    useEffect(() => {
        setAmount(remainingAmount);
        setValue([remainingAmount]);
        setCurrentImageIndex(0);
        setSelectedOption(paymentOptionsCollection.items[0].value);
        
        const fetchImages = async () => {
            try {
                const response = await fetch(`/api/admin/children/images/${people.id}`);
                if (response.ok) {
                    const data = await response.json();
                    setImages(data.sort((a: BeneficiaryMedia, b: BeneficiaryMedia) => 
                        a.order_index - b.order_index
                    ));
                }
            } catch (error) {
                console.error("Error fetching images:", error);
            }
        };

        fetchImages();
        
        // Send dialog position to parent after a short delay to allow rendering
        if (isInIframe && isOpen) {
            setTimeout(() => {
                try {
                    const dialogElement = document.querySelector('[role="alertdialog"]');
                    const dialogRect = dialogElement?.getBoundingClientRect();
                    
                    if (dialogRect) {
                        const urlParams = new URLSearchParams(window.location.search);
                        const parentOrigin = urlParams.get('parentOrigin') || '*';
                        
                        window.parent.postMessage({
                            type: 'makeDialogSticky',
                            from: 'sponsor-dialog-update',
                            dialogPosition: {
                                top: dialogRect.top,
                                left: dialogRect.left,
                                height: dialogRect.height,
                                width: dialogRect.width
                            }
                        }, parentOrigin);
                        
                    }
                } catch (e) {
                    console.error('[Child Frame] Error sending dialog position:', e);
                }
            }, 200);
        }
    }, [people.id, remainingAmount, people.name, isOpen]);
    
    // Effect for making the dialog sticky when it opens
    useEffect(() => {
        if (isInIframe && isOpen) {
            try {
                // Send a message to parent window to make the dialog sticky
                const urlParams = new URLSearchParams(window.location.search);
                const parentOrigin = urlParams.get('parentOrigin') || '*';
                
                // Send dialog position information to parent
                const dialogElement = document.querySelector('[role="alertdialog"]');
                const dialogRect = dialogElement?.getBoundingClientRect();
                
                window.parent.postMessage({
                    type: 'makeDialogSticky',
                    from: 'sponsor-dialog',
                    dialogPosition: dialogRect ? {
                        top: dialogRect.top,
                        left: dialogRect.left,
                        height: dialogRect.height,
                        width: dialogRect.width
                    } : null
                }, parentOrigin);
                
                console.log('[Child Frame] Sent makeDialogSticky request to parent');
            } catch (e) {
                // Ignore errors from cross-origin restrictions
                console.error('[Child Frame] Error sending makeDialogSticky:', e);
            }
        }
    }, [isOpen]);

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
        // Minimum amount should be $10 (1000 cents)
        if (amount < 10) {
            toaster.create({
                title: "Invalid Amount",
                description: "Minimum sponsorship amount is $10.",
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
            const payload = {
                beneficiaryId: people.id,
                beneficiaryName: people.name,
                beneficiaryImage: images[currentImageIndex]?.image_url || people.image_url || placeholderImage,
                amount: amount * 100,
                paymentType: selectedOption,
                location: people.country,
                userId: user?.id,
                isEmbedded: window.self !== window.top,
            };
            console.log("SponsorDialog: Stripe payload", payload);

            const res = await fetch("/api/stripe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                toaster.create({
                    title: "Payment Error",
                    description: data?.error || "Something went wrong. Please try again.",
                });
                setLoading(false);
                return;
            }

            const { clientSecret, url } = data;

            if (window.self !== window.top) {
                if (clientSecret) {
                    window.location.href = `/sponsorships/checkout?client_secret=${clientSecret}`;
                } else if (url) {
                    window.location.href = url;
                } else {
                    toaster.create({
                        title: "Payment Error",
                        description: "No checkout information returned. Please try again.",
                    });
                }
            } else {
                if (url) {
                    window.location.href = url;
                } else {
                    toaster.create({
                        title: "Payment Error",
                        description: "No checkout URL returned. Please try again.",
                    });
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
                    This  has a monthly budget goal that must be met for enrollment in school.
                    {selectedOption === "payment" && (
                        <>
                            <br />
                            Your yearly contribution of ${amount} provides ${monthlyAmount} monthly for this .
                        </>
                    )}
                    <br />
                    Additional sponsors are required to meet this goal.
                </>
            );
        } else if (people.budget_raised > 0) {
            return (
                <>
                    This  is partially sponsored. Your contribution will help reach their monthly budget goal!
                    {selectedOption === "payment" && (
                        <>
                            <br />
                            Your yearly contribution of ${amount} provides ${monthlyAmount} monthly for this .
                        </>
                    )}
                </>
            );
        }
        return (
            <>
                Your sponsorship will be applied towards the 's monthly budget goals.
                {selectedOption === "payment" && (
                    <>
                        <br />
                        Your yearly contribution of ${amount} provides ${monthlyAmount} monthly for this .
                    </>
                )}
            </>
        );
    };

    const handleNextImage = () => {
        setCurrentImageIndex((prev) => (prev + 1) % images.length);
    };

    const handlePrevious = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (onPrevious) {
            onPrevious();
            // No scrolling - we want the dialog to stay in place
        }
    };

    const handleNext = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (onNext) {
            onNext();
        }
    };

    return (
        <DialogRoot
            open={isOpen}
            onOpenChange={(details) => {
                onOpenChange?.(details.open);
            }}
            size={isInIframe ? { base: "lg", md: "lg" } : { base: "full", md: "xl" }}
            placement={isInIframe ? "top" : "center"}
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
                <DialogBody suppressHydrationWarning={true}>
                    <Box 
                        className={isInIframe 
                            ? "flex flex-col gap-4 p-3" 
                            : "flex flex-col md:flex-row gap-8 p-5"
                        } 
                        suppressHydrationWarning={true}
                    >
                        <Box className="w-full md:w-[359px]">
                            <Box position="relative">
                                <Image
                                    src={images[currentImageIndex]?.image_url || people.image_url || placeholderImage}
                                    alt={people.name}
                                    className={isInIframe 
                                        ? "rounded-xl h-[300px] w-full object-cover" 
                                        : "rounded-xl md:h-[479px] w-full object-cover"
                                    }
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
                            <Flex justify="space-between" mt={4}>
                                <Button
                                    onClick={handlePrevious}
                                    disabled={!hasPrevious}
                                    variant="outline"
                                    className={`px-4 py-2 ${!hasPrevious ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    ← Previous Beneficiary
                                </Button>
                                <Button
                                    onClick={handleNext}
                                    disabled={!hasNext}
                                    variant="outline"
                                    className={`px-4 py-2 ${!hasNext ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    Next Beneficiary →
                                </Button>
                            </Flex>
                        </Box>
                        <Box className="flex-1 border border-[#E8E8EA] p-5">
                            <Text className="text-2xl text-center font-bold md:mt-0 md:text-start">
                                {people.name}
                            </Text>
                            <Progress.Root
                                value={Math.min((people.budget_raised / people.budget_goal) * 100, 100)}
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
                                        value={[selectedOption]}
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
                    <Text 
                        color="gray.500" 
                        textAlign="center" 
                        p={1}
                        fontSize={isInIframe ? "xs" : "sm"}
                    >
                        {renderDisclaimer()}
                    </Text>
                </DialogBody>
            </DialogContent>
        </DialogRoot>
    );
};

export default SponsorDialog;
