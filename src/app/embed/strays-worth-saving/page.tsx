"use client";
import React, { useState, useEffect } from "react";
import {
  Box,
  Text,
  Image,
  Flex,
  Input,
  InputAddon,
  Spinner,
} from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
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
import { paymentOptionsCollection } from "@/app/sponsorships/components/Payments/config";
import { useAuthStore } from "@/store/authStore";
import { AnimalBeneficiary, BeneficiaryMedia } from "@/types/admin.types";

const isInIframe = typeof window !== "undefined" && window.self !== window.top;

const placeholderImage =
  "https://cdn-icons-png.flaticon.com/512/616/616408.png";

export default function SponsorshipEmbedStraysPage() {
  const [animals, setAnimals] = useState<AnimalBeneficiary[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [images, setImages] = useState<BeneficiaryMedia[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const [inputValue, setInputValue] = useState<string>("");
  const [selectedOption, setSelectedOption] = useState<string>("subscription");
  const [value, setValue] = useState<number[]>([0]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingAnimals, setLoadingAnimals] = useState<boolean>(true);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    async function fetchAnimals() {
      setLoadingAnimals(true);
      try {
        const queryParams = new URLSearchParams();
        queryParams.append("status", ["New", "Partially Funded"].join(","));
        queryParams.append("excludeStatus", ["Budget Fulfilled"].join(","));
        queryParams.append("beneficiary_type", "ANIMAL");
        const url = `/api/beneficiaries/getByAgeAndGender?${queryParams.toString()}`;
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        if (res.ok) {
          const data = await res.json();
          const animalList = data.people;
          if (!animalList || !Array.isArray(animalList)) {
            setAnimals([]);
            return;
          }
          setAnimals(animalList);
          if (animalList.length > 0) {
            const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL;
            const publicHardcodedCents = publicHardcodedRaw ? parseInt(publicHardcodedRaw, 10) : null;
            const effectiveGoal = publicHardcodedCents !== null ? publicHardcodedCents : Number(animalList[0].budget_goal);
            const remaining =
              (effectiveGoal - animalList[0].budget_raised) / 100;
            setAmount(remaining);
            setValue([remaining]);
            setInputValue(remaining.toString());
          }
        } else {
          setAnimals([]);
          toaster.create({
            title: "Error",
            description: "Failed to load strays.",
          });
        }
      } catch {
        setAnimals([]);
        toaster.create({
          title: "Error",
          description: "Failed to load strays.",
        });
      } finally {
        setLoadingAnimals(false);
      }
    }
    fetchAnimals();
  }, []);

  useEffect(() => {
    if (!animals[currentIndex]) return;

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/admin/animals/images/${animals[currentIndex].id}`
        );
        if (response.ok) {
          const data = await response.json();
          setImages(
            data.sort(
              (a: BeneficiaryMedia, b: BeneficiaryMedia) =>
                a.order_index - b.order_index
            )
          );
          setCurrentImageIndex(0);
        } else {
          setImages([]);
          setCurrentImageIndex(0);
        }
      } catch {
        setImages([]);
        setCurrentImageIndex(0);
      }
    }, 0);

    return () => clearTimeout(timeout);
  }, [currentIndex, animals]);

  if (loadingAnimals) {
    return (
      <Flex
        minH="100vh"
        align="center"
        justify="center"
        direction="column"
        gap={4}
      >
        <Spinner size="xl" />
        <Text>Loading strays data...</Text>
      </Flex>
    );
  }

  const animal = animals[currentIndex];

  if (!animal) {
    return (
      <Flex
        minH="100vh"
        align="center"
        justify="center"
        direction="column"
        gap={4}
      >
        <Text>No strays available for sponsorship</Text>
        <Text color="gray.500" fontSize="sm">
          {animals.length === 0
            ? "No strays data found"
            : "Error loading stray data"}
        </Text>
      </Flex>
    );
  }
  // Public hardcoded override for front-end (dollars are provided as cents integer)
  const publicHardcodedRaw = process.env.NEXT_PUBLIC_HARDCODE_CHILD_BUDGET_PRICE_CENTS;
  const publicHardcodedCents = publicHardcodedRaw ? parseInt(publicHardcodedRaw, 10) : null;
  const effectiveGoalCents = publicHardcodedCents !== null ? publicHardcodedCents : Number(animal?.budget_goal || 0);

  const remainingAmount =
    (effectiveGoalCents - animal.budget_raised) / 100;
  const minimumAmount = 10;
  const maxSelectableAmount =
    remainingAmount > minimumAmount
      ? remainingAmount - minimumAmount < minimumAmount
        ? remainingAmount
        : remainingAmount - ((remainingAmount - minimumAmount) % minimumAmount)
      : remainingAmount;

  const handleSliderChange = (e: { value: number[] }) => {
    const newValue = Math.min(e.value[0], remainingAmount);
    setValue([newValue]);
    setAmount(newValue);
    setInputValue(newValue.toString());
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === "" || /^\d+$/.test(value)) {
      if (value !== "") {
        const numericValue = parseInt(value);
        if (!isNaN(numericValue)) {
          if (numericValue > remainingAmount) {
            setInputValue(remainingAmount.toString());
            setAmount(remainingAmount);
            setValue([remainingAmount]);
            toaster.create({
              title: "Amount Adjusted",
              description: `Maximum sponsorship amount is $${remainingAmount}.`,
            });
            return;
          }
        }
      }

      setInputValue(value);

      if (value === "") {
        setAmount(0);
        setValue([0]);
      } else {
        const numericValue = parseInt(value);
        if (!isNaN(numericValue)) {
          setAmount(numericValue);
          setValue([numericValue]);
        }
      }
    }
  };

  const handleSponsor = async () => {
    if (
      amount < minimumAmount &&
      !(remainingAmount < minimumAmount && amount === remainingAmount)
    ) {
      toaster.create({
        title: "Invalid Amount",
        description: `Minimum sponsorship amount is $${minimumAmount}.`,
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
        beneficiaryId: animal.id,
        beneficiaryName: animal.name,
        beneficiaryImage:
          images[currentImageIndex]?.image_url || placeholderImage,
        // If public hardcoded amount is set, send that exact cents value to server.
        amount: publicHardcodedCents !== null ? publicHardcodedCents : amount * 100,
        paymentType: selectedOption,
        location: animal.country,
        userId: user?.id,
        isEmbedded: true,
        allowBelowMinimum:
          remainingAmount < minimumAmount && amount === remainingAmount,
      };
      if (selectedOption !== "payment" && selectedOption !== "subscription") {
        toaster.create({
          title: "Payment Error",
          description: "Invalid payment frequency selected. Please try again.",
        });
        setLoading(false);
        return;
      }
      if (!animal.country) {
        toaster.create({
          title: "Payment Error",
          description: "Missing location information. Please try again.",
        });
        setLoading(false);
        return;
      }
      const res = await fetch("/api/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
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
      if (!clientSecret && !url) {
        toaster.create({
          title: "Payment Error",
          description: "Failed to create checkout session. Please try again.",
        });
        setLoading(false);
        return;
      }

      if (isInIframe) {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const parentOrigin = urlParams.get("parentOrigin") || "*";
          const checkoutUrl = clientSecret
            ? `/sponsorships/checkout?client_secret=${clientSecret}&parentOrigin=${encodeURIComponent(
                parentOrigin
              )}&embedded=true`
            : url;
          window.location.href = checkoutUrl;
          return;
        } catch {
          toaster.create({
            title: "Payment Error",
            description: "Failed to process checkout. Please try again.",
          });
        }
      } else {
        const checkoutUrl =
          url || `/sponsorships/checkout?client_secret=${clientSecret}`;
        window.location.href = checkoutUrl;
        return;
      }
    } catch {
      toaster.create({
        title: "Payment Error",
        description: "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChange = (value: string) => {
    setSelectedOption(value);
  };

  const renderDisclaimer = () => {
    const monthlyAmount =
      selectedOption === "payment" ? (amount / 12).toFixed(2) : amount;
    if (Number(animal.budget_goal) - animal.budget_raised - amount * 100 > 0) {
      return (
        <>
          This stray has a monthly budget goal that must be met for their care.
          {selectedOption === "payment" && (
            <>
              <br />
              Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
              monthly for this stray.
            </>
          )}
          <br />
          Additional sponsors are required to meet this goal.
        </>
      );
    } else if (animal.budget_raised > 0) {
      return (
        <>
          This stray is partially sponsored. Your contribution will help reach
          their monthly budget goal!
          {selectedOption === "payment" && (
            <>
              <br />
              Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
              monthly for this stray.
            </>
          )}
        </>
      );
    }
    return (
      <>
        Your sponsorship will be applied towards the stray's monthly budget
        goals.
        {selectedOption === "payment" && (
          <>
            <br />
            Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
            monthly for this stray.
          </>
        )}
      </>
    );
  };

  return (
    <Flex minH="100vh" align="center" justify="center" bg="white" py={8}>
      <Box
        bg="white"
        borderRadius="xl"
        maxW="400px"
        w="100%"
        p={6}
        border="1px solid #E8E8EA"
      >
        <Flex justify="space-between" align="center" mb={2}>
          <Button
            variant="ghost"
            onClick={() => {
              if (currentIndex > 0) {
                setCurrentIndex(currentIndex - 1);
              }
            }}
            disabled={currentIndex === 0}
          >
            {"<< Previous"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (currentIndex < animals.length - 1) {
                setCurrentIndex(currentIndex + 1);
              }
            }}
            disabled={currentIndex >= animals.length - 1}
          >
            {"Next >>"}
          </Button>
        </Flex>
        <Text fontWeight="bold" fontSize="lg" textAlign="center" mb={2}>
          Sponsor a Stray Worth Saving
        </Text>
        <Box position="relative">
          <Flex justify="center" mb={3}>
            <Image
              src={
                images.length > 0
                  ? images[currentImageIndex]?.image_url
                  : placeholderImage
              }
              alt={animal.name}
              borderRadius="xl"
              boxSize="120px"
              objectFit="cover"
            />
          </Flex>
          {images.length > 1 && (
            <>
              <Flex
                position="absolute"
                bottom="-2"
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
                    bg={currentImageIndex === index ? "#1C3C8C" : "gray.300"}
                    cursor="pointer"
                    onClick={() => setCurrentImageIndex(index)}
                  />
                ))}
              </Flex>
              <Button
                position="absolute"
                left="-2"
                top="50%"
                transform="translateY(-50%)"
                onClick={() =>
                  setCurrentImageIndex(
                    (prev) => (prev - 1 + images.length) % images.length
                  )
                }
                size="sm"
                variant="ghost"
                color="#1C3C8C"
                _hover={{ bg: "gray.100" }}
              >
                ←
              </Button>
              <Button
                position="absolute"
                right="-2"
                top="50%"
                transform="translateY(-50%)"
                onClick={() =>
                  setCurrentImageIndex((prev) => (prev + 1) % images.length)
                }
                size="sm"
                variant="ghost"
                color="#1C3C8C"
                _hover={{ bg: "gray.100" }}
              >
                →
              </Button>
            </>
          )}
        </Box>
        <Text fontWeight="bold" fontSize="xl" textAlign="center" mb={2}>
          {animal.name}
        </Text>
        <Flex align="center" justify="space-between" mb={1}>
          <Box flex="1">
            <Box
              w="100%"
              h="8px"
              bg="#E8E8EA"
              borderRadius="md"
              overflow="hidden"
              mb={1}
            >
              <Box
                h="100%"
                bg="#1C3C8C"
                borderRadius="md"
                width={`${Math.min(
                  (animal.budget_raised / Number(animal.budget_goal)) * 100,
                  100
                )}%`}
                transition="width 0.3s"
              />
            </Box>
            <Flex justify="space-between" mt={1}>
              <Text fontSize="xs" color="gray.500">
                Raised: ${centsToDollars(animal.budget_raised)}
              </Text>
              <Text fontSize="xs" color="gray.500">
                Pending: ${remainingAmount}
              </Text>
            </Flex>
          </Box>
        </Flex>
        <Flex justify="flex-end" mb={2}>
          <Text color="blue.700" fontWeight="semibold" fontSize="md">
            Monthly Goal: ${centsToDollars(Number(animal.budget_goal))}
          </Text>
        </Flex>
        <Box mb={2}>
          <Text fontWeight="semibold" fontSize="sm" mb={1}>
            Amount
          </Text>
          {remainingAmount < minimumAmount ? (
            <Box mb={4}>
              <Flex
                align="center"
                border="1px solid #E8E8EA"
                borderRadius="md"
                mb={2}
                bg="gray.100"
              >
                <InputAddon
                  bg="#F3F3F3"
                  px={4}
                  py={2}
                  color="#959090"
                  fontSize="md"
                  border="none"
                >
                  $
                </InputAddon>
                <Input
                  type="text"
                  value={remainingAmount}
                  readOnly
                  border="none"
                  px={2}
                  py={2}
                  fontSize="md"
                  _focus={{ boxShadow: "none" }}
                  bg="gray.100"
                />
              </Flex>
              <Box my={2}>
                <Slider
                  value={[remainingAmount]}
                  min={remainingAmount}
                  max={remainingAmount}
                  step={1}
                  variant="solid"
                  disabled
                  onValueChange={() => {}}
                />
                <Text textAlign="center" mt={2}>
                  You can sponsor the final ${remainingAmount} to fully fund
                  this beneficiary, even though it is below the usual minimum.
                </Text>
              </Box>
            </Box>
          ) : (
            <>
              <Flex
                align="center"
                border="1px solid #E8E8EA"
                borderRadius="md"
                mb={2}
              >
                <InputAddon
                  bg="#F3F3F3"
                  px={4}
                  py={2}
                  color="#959090"
                  fontSize="md"
                  border="none"
                >
                  $
                </InputAddon>
                <Input
                  type="text"
                  pattern="\d*"
                  min={1}
                  max={maxSelectableAmount}
                  value={inputValue}
                  onChange={handleAmountChange}
                  border="none"
                  px={2}
                  py={2}
                  fontSize="md"
                  _focus={{ boxShadow: "none" }}
                  placeholder="Enter Amount"
                />
              </Flex>
              <Box my={2}>
                <Slider
                  value={value}
                  min={0}
                  max={remainingAmount}
                  step={5}
                  variant="solid"
                  onValueChange={handleSliderChange}
                />
                <Text textAlign="center" mt={2}>
                  Selected Amount: ${value[0]}
                </Text>
                {amount > 0 && amount < minimumAmount && (
                  <Text
                    color="gray.400"
                    fontSize="sm"
                    textAlign="center"
                    mt={1}
                  >
                    Minimum sponsorship amount is ${minimumAmount}.
                  </Text>
                )}
              </Box>
            </>
          )}
        </Box>
        <Box mb={2}>
          <Text fontWeight="semibold" fontSize="sm" mb={1}>
            Frequency
          </Text>
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
        <Flex gap={2} mb={2}>
          <a
            className={`flex-1 py-2 rounded-md text-center transition-colors duration-150
              ${
                animal.username
                  ? "bg-[#D1D1D1] text-[#1C3C8C] hover:bg-[#E8F0FF] cursor-pointer"
                  : "bg-[#D1D1D1] text-[#858585] opacity-50 cursor-not-allowed"
              }`}
            href={
              animal.username
                ? `https://dev.creatorshare.com/sponsorships/${animal.username}`
                : undefined
            }
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={animal.username ? 0 : -1}
          >
            More info
          </a>
          <Button
            className="flex-1 py-2 bg-blue-700 text-white hover:bg-blue-800"
            onClick={handleSponsor}
            loading={loading}
            loadingText="Processing..."
            disabled={
              loading ||
              (remainingAmount < minimumAmount
                ? amount !== remainingAmount
                : amount < minimumAmount)
            }
          >
            Checkout
          </Button>
        </Flex>
        <Text color="gray.500" fontSize="sm" textAlign="center" mb={3}>
          {renderDisclaimer()}
        </Text>
        <a
          href="https://dev.creatorshare.com/sponsorships"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block",
            width: "100%",
            background: "#E8F0FF",
            color: "#1C3C8C",
            borderRadius: "0.75rem",
            fontWeight: 600,
            textAlign: "center",
            padding: "0.75rem 0",
            textDecoration: "none",
            marginTop: "0.5rem",
          }}
        >
          See more strays
        </a>
      </Box>
    </Flex>
  );
}
