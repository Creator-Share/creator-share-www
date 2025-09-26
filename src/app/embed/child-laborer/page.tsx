"use client"
import React, { useState, useEffect } from "react"
import {
  Box,
  Text,
  Image,
  Flex,
  Input,
  InputAddon,
  Spinner,
} from "@chakra-ui/react"
import { Button } from "@/components/ui/button"
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { centsToDollars } from "@/utils/currency"
import { toaster } from "@/components/ui/toaster"
import { paymentOptionsCollection } from "@/app/sponsorships/components/Payments/config"
import { useAuthStore } from "@/store/authStore"
import { Beneficiaries, BeneficiaryMedia } from "@/types/admin.types"

const isInIframe = typeof window !== "undefined" && window.self !== window.top

const placeholderImage =
  "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="

export default function SponsorshipEmbedChildLaborerPage() {
  const [laborers, setLaborers] = useState<Beneficiaries[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [amount, setAmount] = useState<number>(0)
  const [inputValue, setInputValue] = useState<string>("")
  const [selectedOption, setSelectedOption] = useState<string>("subscription")
  const [value, setValue] = useState<number[]>([0])
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingLaborers, setLoadingLaborers] = useState<boolean>(true)
  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    async function fetchLaborers() {
      setLoadingLaborers(true)
      try {
        const queryParams = new URLSearchParams()
        queryParams.append("status", ["New", "Partially Funded"].join(","))
        queryParams.append(
          "excludeStatus",
          ["Budget Fulfilled", "Fulfilled"].join(","),
        )
        queryParams.append("beneficiary_type", "CHILD_LABORER")
        const url = `/api/beneficiaries/getByAgeAndGender?${queryParams.toString()}`
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        })
        if (res.ok) {
          const data = await res.json()
          const laborerList = data.people
          if (!laborerList || !Array.isArray(laborerList)) {
            setLaborers([])
            return
          }
          setLaborers(laborerList)
          if (laborerList.length > 0) {
            const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
            const publicHardcodedCents = publicHardcodedRaw
              ? parseInt(publicHardcodedRaw, 10)
              : null
            const effectiveGoal =
              publicHardcodedCents !== null
                ? publicHardcodedCents
                : laborerList[0].budget_goal
            const remaining =
              (effectiveGoal - laborerList[0].budget_raised) / 100
            setAmount(remaining)
            setValue([remaining])
            setInputValue(remaining.toString())
          }
        } else {
          setLaborers([])
          toaster.create({
            title: "Error",
            description: "Failed to load child laborers.",
          })
        }
      } catch {
        setLaborers([])
        toaster.create({
          title: "Error",
          description: "Failed to load child laborers.",
        })
      } finally {
        setLoadingLaborers(false)
      }
    }
    fetchLaborers()
  }, [])

  useEffect(() => {
    if (!laborers[currentIndex]) return

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/admin/beneficiaries/images/${laborers[currentIndex].id}`,
        )
        if (response.ok) {
          const data = await response.json()
          setImages(
            data.sort(
              (a: BeneficiaryMedia, b: BeneficiaryMedia) =>
                a.order_index - b.order_index,
            ),
          )
          setCurrentImageIndex(0)
        } else {
          setImages([])
          setCurrentImageIndex(0)
        }
      } catch {
        setImages([])
        setCurrentImageIndex(0)
      }
    }, 0)

    return () => clearTimeout(timeout)
  }, [currentIndex, laborers])

  if (loadingLaborers) {
    return (
      <Flex
        minH="100vh"
        align="center"
        justify="center"
        direction="column"
        gap={4}
      >
        <Spinner size="xl" />
        <Text>Loading child laborers data...</Text>
      </Flex>
    )
  }

  const laborer = laborers[currentIndex]

  if (!laborer) {
    return (
      <Flex
        minH="100vh"
        align="center"
        justify="center"
        direction="column"
        gap={4}
      >
        <Text>No child laborers available for sponsorship</Text>
        <Text color="gray.500" fontSize="sm">
          {laborers.length === 0
            ? "No child laborers data found"
            : "Error loading child laborer data"}
        </Text>
      </Flex>
    )
  }
  // Public hardcoded override for front-end (dollars are provided as cents integer)
  const publicHardcodedRaw =
    process.env.NEXT_PUBLIC_HARDCODE_CHILD_BUDGET_PRICE_CENTS
  const publicHardcodedCents = publicHardcodedRaw
    ? parseInt(publicHardcodedRaw, 10)
    : null
  const effectiveGoalCents =
    publicHardcodedCents !== null
      ? publicHardcodedCents
      : laborer?.budget_goal || 0

  const remainingAmount =
    (effectiveGoalCents - (laborer?.budget_raised || 0)) / 100
  const minimumAmount = 10
  const maxSelectableAmount =
    remainingAmount > minimumAmount
      ? remainingAmount - minimumAmount < minimumAmount
        ? remainingAmount
        : remainingAmount - ((remainingAmount - minimumAmount) % minimumAmount)
      : remainingAmount

  const handleSliderChange = (e: { value: number[] }) => {
    const newValue = Math.min(e.value[0], remainingAmount)
    setValue([newValue])
    setAmount(newValue)
    setInputValue(newValue.toString())
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === "" || /^\d+$/.test(value)) {
      if (value !== "") {
        const numericValue = parseInt(value)
        if (!isNaN(numericValue)) {
          if (numericValue > remainingAmount) {
            setInputValue(remainingAmount.toString())
            setAmount(remainingAmount)
            setValue([remainingAmount])
            toaster.create({
              title: "Amount Adjusted",
              description: `Maximum sponsorship amount is $${remainingAmount}.`,
            })
            return
          }
        }
      }

      setInputValue(value)

      if (value === "") {
        setAmount(0)
        setValue([0])
      } else {
        const numericValue = parseInt(value)
        if (!isNaN(numericValue)) {
          setAmount(numericValue)
          setValue([numericValue])
        }
      }
    }
  }

  const handleSponsor = async () => {
    if (
      amount < minimumAmount &&
      !(remainingAmount < minimumAmount && amount === remainingAmount)
    ) {
      toaster.create({
        title: "Invalid Amount",
        description: `Minimum sponsorship amount is $${minimumAmount}.`,
      })
      return
    }
    if (amount > remainingAmount) {
      toaster.create({
        title: "Invalid Amount",
        description: "Amount exceeds the remaining budget needed.",
      })
      return
    }
    setLoading(true)
    try {
      const payload = {
        beneficiaryId: laborer.id,
        beneficiaryName: laborer.name,
        beneficiaryImage:
          images[currentImageIndex]?.image_url || placeholderImage,
        // If public hardcoded amount is set, send that exact cents value to server.
        amount:
          publicHardcodedCents !== null ? publicHardcodedCents : amount * 100,
        paymentType: selectedOption,
        location: laborer.country,
        userId: user?.id,
        isEmbedded: true,
        allowBelowMinimum:
          remainingAmount < minimumAmount && amount === remainingAmount,
      }
      if (selectedOption !== "payment" && selectedOption !== "subscription") {
        toaster.create({
          title: "Payment Error",
          description: "Invalid payment frequency selected. Please try again.",
        })
        setLoading(false)
        return
      }
      if (!laborer.country) {
        toaster.create({
          title: "Payment Error",
          description: "Missing location information. Please try again.",
        })
        setLoading(false)
        return
      }
      const res = await fetch("/api/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        toaster.create({
          title: "Payment Error",
          description: data?.error || "Something went wrong. Please try again.",
        })
        setLoading(false)
        return
      }
      const { clientSecret, url } = data
      if (!clientSecret && !url) {
        toaster.create({
          title: "Payment Error",
          description: "Failed to create checkout session. Please try again.",
        })
        setLoading(false)
        return
      }

      if (isInIframe) {
        try {
          const urlParams = new URLSearchParams(window.location.search)
          const parentOrigin = urlParams.get("parentOrigin") || "*"
          const checkoutUrl = clientSecret
            ? `/sponsorships/checkout?client_secret=${clientSecret}&parentOrigin=${encodeURIComponent(
                parentOrigin,
              )}&embedded=true`
            : url
          window.location.href = checkoutUrl
          return
        } catch {
          toaster.create({
            title: "Payment Error",
            description: "Failed to process checkout. Please try again.",
          })
        }
      } else {
        const checkoutUrl =
          url || `/sponsorships/checkout?client_secret=${clientSecret}`
        window.location.href = checkoutUrl
        return
      }
    } catch {
      toaster.create({
        title: "Payment Error",
        description: "Something went wrong. Please try again.",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSelectChange = (value: string) => {
    setSelectedOption(value)
  }

  const renderDisclaimer = () => {
    const monthlyAmount =
      selectedOption === "payment" ? (amount / 12).toFixed(2) : amount
    if (laborer.budget_goal - laborer.budget_raised - amount * 100 > 0) {
      return (
        <>
          This child laborer has a monthly budget goal that must be met for
          their support.
          {selectedOption === "payment" && (
            <>
              <br />
              Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
              monthly for this child laborer.
            </>
          )}
          <br />
          Additional sponsors are required to meet this goal.
        </>
      )
    } else if (laborer.budget_raised > 0) {
      return (
        <>
          This child laborer is partially sponsored. Your contribution will help
          reach their monthly budget goal!
          {selectedOption === "payment" && (
            <>
              <br />
              Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
              monthly for this child laborer.
            </>
          )}
        </>
      )
    }
    return (
      <>
        Your sponsorship will be applied towards the child laborer's monthly
        budget goals.
        {selectedOption === "payment" && (
          <>
            <br />
            Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
            monthly for this child laborer.
          </>
        )}
      </>
    )
  }

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
                setCurrentIndex(currentIndex - 1)
              }
            }}
            disabled={currentIndex === 0}
          >
            {"<< Previous"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (currentIndex < laborers.length - 1) {
                setCurrentIndex(currentIndex + 1)
              }
            }}
            disabled={currentIndex >= laborers.length - 1}
          >
            {"Next >>"}
          </Button>
        </Flex>
        <Text fontWeight="bold" fontSize="lg" textAlign="center" mb={2}>
          Sponsor a Child Laborer
        </Text>
        <Box position="relative">
          <Flex justify="center" mb={3}>
            <Image
              src={
                images.length > 0
                  ? images[currentImageIndex]?.image_url
                  : placeholderImage
              }
              alt={laborer.name}
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
                    (prev) => (prev - 1 + images.length) % images.length,
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
          {laborer.name}
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
                width={`${
                  effectiveGoalCents > 0
                    ? Math.min(
                        (laborer.budget_raised / effectiveGoalCents) * 100,
                        100,
                      )
                    : 0
                }%`}
                transition="width 0.3s"
              />
            </Box>
            <Flex justify="space-between" mt={1}>
              <Text fontSize="xs" color="gray.500">
                Raised: ${centsToDollars(laborer.budget_raised)}
              </Text>
              <Text fontSize="xs" color="gray.500">
                Pending: ${remainingAmount}
              </Text>
            </Flex>
          </Box>
        </Flex>
        <Flex justify="flex-end" mb={2}>
          <Text color="blue.700" fontWeight="semibold" fontSize="md">
            Monthly Goal: ${centsToDollars(effectiveGoalCents)}
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
                laborer.username
                  ? "bg-[#D1D1D1] text-[#1C3C8C] hover:bg-[#E8F0FF] cursor-pointer"
                  : "bg-[#D1D1D1] text-[#858585] opacity-50 cursor-not-allowed"
              }`}
            href={
              laborer.username
                ? `https://dev.creatorshare.com/sponsorships/${laborer.username}`
                : undefined
            }
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={laborer.username ? 0 : -1}
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
          See more child laborers
        </a>
      </Box>
    </Flex>
  )
}
