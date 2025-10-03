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
import { Beneficiaries } from "@/types"
import { useAuthStore } from "@/store/authStore"
import { BeneficiaryMedia } from "@/types/admin.types"

const isInIframe = typeof window !== "undefined" && window.self !== window.top

const placeholderImage =
  "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="

export default function SponsorshipEmbedChildrenPage() {
  const [children, setChildren] = useState<Beneficiaries[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [amount, setAmount] = useState<number>(0)
  const [inputValue, setInputValue] = useState<string>("")
  const [selectedOption, setSelectedOption] = useState<string>("subscription")
  const [value, setValue] = useState<number[]>([0])
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingChildren, setLoadingChildren] = useState<boolean>(true)
  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    async function fetchChildren() {
      setLoadingChildren(true)
      try {
        const queryParams = new URLSearchParams()
        queryParams.append("status", ["New", "Partially Funded"].join(","))
        queryParams.append(
          "excludeStatus",
          ["Budget Fulfilled", "Fulfilled"].join(","),
        )
        const url = `/api/beneficiaries/getByAgeAndGender?${queryParams.toString()}`
        console.log("Fetching children from:", url)
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        })
        console.log("API Response Status:", res.status, res.statusText)
        if (res.ok) {
          const data = await res.json()
          console.log("Fetched Children Data:", data)
          if (!data.people || !Array.isArray(data.people)) {
            console.error(
              "Expected array of children in data.people, got:",
              data,
            )
            setChildren([])
            return
          }
          setChildren(data.people)
          if (data.people.length > 0) {
            console.log("First Child:", data.people[0])
            const remaining =
              (data.people[0].budget_goal - data.people[0].budget_raised) / 100
            setAmount(remaining)
            setValue([remaining])
            setInputValue(remaining.toString())
          } else {
            console.log("No children data in response")
          }
        } else {
          const errorText = await res.text()
          console.error("API Error Status:", res.status)
          console.error("API Error Text:", errorText)
          throw new Error(`API Error: ${res.status} - ${errorText}`)
        }
      } catch (e) {
        console.error("Fetch Error:", e)
        setChildren([])
        toaster.create({
          title: "Error",
          description: "Failed to load children.",
        })
      } finally {
        setLoadingChildren(false)
      }
    }
    fetchChildren()
  }, [])

  useEffect(() => {
    if (!children[currentIndex]) return

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/admin/beneficiaries/images/${children[currentIndex].id}`,
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
  }, [currentIndex, children])

  if (loadingChildren) {
    return (
      <Flex
        minH="100vh"
        align="center"
        justify="center"
        direction="column"
        gap={4}
      >
        <Spinner size="xl" />
        <Text>Loading children data...</Text>
      </Flex>
    )
  }

  const people = children[currentIndex]
  console.log("Selected Child:", people)

  if (!people) {
    return (
      <Flex
        minH="100vh"
        align="center"
        justify="center"
        direction="column"
        gap={4}
      >
        <Text>No children available for sponsorship</Text>
        <Text color="gray.500" fontSize="sm">
          {children.length === 0
            ? "No children data found"
            : "Error loading child data"}
        </Text>
      </Flex>
    )
  }

  // Public hardcoded override for front-end (dollars are provided as cents integer)
  const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
  const publicHardcodedCents = publicHardcodedRaw
    ? parseInt(publicHardcodedRaw, 10)
    : null
  const effectiveGoalCents =
    publicHardcodedCents !== null
      ? publicHardcodedCents
      : people?.budget_goal || 0

  const remainingAmount =
    (effectiveGoalCents - (people?.budget_raised || 0)) / 100
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
        beneficiaryId: people.id,
        beneficiaryName: people.name,
        beneficiaryImage:
          images[currentImageIndex]?.image_url ||
          people.image_url ||
          placeholderImage,
        amount: amount * 100,
        paymentType: selectedOption,
        location: people.country,
        userId: user?.id,
        isEmbedded: true,
        allowBelowMinimum:
          remainingAmount < minimumAmount && amount === remainingAmount,
      }
      console.log("Sending payment request with payload:", payload)
      if (selectedOption !== "subscription") {
        console.error("Invalid payment type:", selectedOption)
        toaster.create({
          title: "Payment Error",
          description: "Invalid payment frequency selected. Please try again.",
        })
        setLoading(false)
        return
      }
      if (!people.country) {
        console.error("Missing location in payload")
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
      console.log("Payment API Response Status:", res.status)
      const data = await res.json()
      console.log("Payment API Response Data:", data)

      if (!res.ok) {
        console.error("Payment API Error:", data)
        toaster.create({
          title: "Payment Error",
          description: data?.error || "Something went wrong. Please try again.",
        })
        setLoading(false)
        return
      }

      const { clientSecret, url } = data
      if (!clientSecret && !url) {
        console.error("Missing checkout information:", data)
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

          console.log("Redirecting to:", checkoutUrl)
          window.location.href = checkoutUrl
          return
        } catch (e) {
          console.error("[Child Frame] Error handling checkout:", e)
          toaster.create({
            title: "Payment Error",
            description: "Failed to process checkout. Please try again.",
          })
        }
      } else {
        const checkoutUrl =
          url || `/sponsorships/checkout?client_secret=${clientSecret}`
        console.log("Redirecting to:", checkoutUrl)
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
      selectedOption === "subscription" ? (amount / 12).toFixed(2) : amount
    if (people.budget_goal - people.budget_raised - amount * 100 > 0) {
      return (
        <>
          This child has a monthly budget goal that must be met for enrollment
          in school.
          {selectedOption === "subscription" && (
            <>
              <br />
              Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
              monthly for this child.
            </>
          )}
          <br />
          Additional sponsors are required to meet this goal.
        </>
      )
    } else if (people.budget_raised > 0) {
      return (
        <>
          This child is partially sponsored. Your contribution will help reach
          their monthly budget goal!
          {selectedOption === "subscription" && (
            <>
              <br />
              Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
              monthly for this child.
            </>
          )}
        </>
      )
    }
    return (
      <>
        Your sponsorship will be applied towards the child's monthly budget
        goals.
        {selectedOption === "subscription" && (
          <>
            <br />
            Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
            monthly for this child.
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
              if (currentIndex < children.length - 1) {
                setCurrentIndex(currentIndex + 1)
              }
            }}
            disabled={currentIndex >= children.length - 1}
          >
            {"Next >>"}
          </Button>
        </Flex>
        <Text fontWeight="bold" fontSize="lg" textAlign="center" mb={2}>
          Share With a Child With Special Needs
        </Text>
        <Box position="relative">
          <Flex justify="center" mb={3}>
            <Image
              src={
                images.length > 0
                  ? images[currentImageIndex]?.image_url
                  : people.image_url || placeholderImage
              }
              alt={people.name}
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
          {people.name}
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
                        (people.budget_raised / effectiveGoalCents) * 100,
                        100,
                      )
                    : 0
                }%`}
                transition="width 0.3s"
              />
            </Box>
            <Flex justify="space-between" mt={1}>
              <Text fontSize="xs" color="gray.500">
                Raised: ${centsToDollars(people.budget_raised)}
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
                people.username
                  ? "bg-[#D1D1D1] text-[#1C3C8C] hover:bg-[#E8F0FF] cursor-pointer"
                  : "bg-[#D1D1D1] text-[#858585] opacity-50 cursor-not-allowed"
              }`}
            href={
              people.username
                ? `https://dev.creatorshare.com/sponsorships/${people.username}`
                : undefined
            }
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={people.username ? 0 : -1}
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
          See more children
        </a>
      </Box>
    </Flex>
  )
}
