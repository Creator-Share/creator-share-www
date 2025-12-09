"use client"
import React, { useEffect, useState, useCallback } from "react"
import { Box, Spinner, Flex, Text, Button, Input } from "@chakra-ui/react"
import { useParams } from "next/navigation"
import { Beneficiaries } from "@/types"
import { usePresence } from "@/hooks/usePresence"
import { FaCalendar, FaUser, FaLocationDot, FaCircleInfo, FaLink, FaShare, FaChevronDown, FaChevronUp } from "react-icons/fa6"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import { BeneficiaryMedia } from "@/types/admin.types"
import { generatePublicUrl, generateThumbnailUrl, MediaRow } from "@/utils/supabase/media"
import { useSponsorship } from "../hooks/useSponsorship"
import { useAuthStore } from "@/store/authStore"
import { paymentOptionsCollection } from "../components/Payments/config"
import { fetchActivitiesByBeneficiaryId } from "@/actions"
import { toaster } from "@/components/ui/toaster"
import BeneficiaryActivity from "../components/SponsorshipActivity"
import BeneficiarySubscribeBox from "@/components/BeneficiarySubscribeBox"

// Conditionally import PayPal components only if enabled
const isPayPalEnabled = !!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

// Type-safe PayPal component references
type PayPalComponent = React.ComponentType<Record<string, unknown>>
let PayPalScriptProvider: PayPalComponent | undefined
let PayPalButtons: PayPalComponent | undefined

if (isPayPalEnabled) {
  // Use dynamic import for PayPal components
  import("@paypal/react-paypal-js").then((module) => {
    PayPalScriptProvider = module.PayPalScriptProvider as unknown as PayPalComponent
    PayPalButtons = module.PayPalButtons as unknown as PayPalComponent
  }).catch((err) => {
    console.error("Failed to load PayPal SDK:", err)
  })
}

export default function FullProfileDynamic() {
  const { username } = useParams()
  const [beneficiary, setBeneficiary] = useState<Beneficiaries | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [beneficiaries, setBeneficiaries] = useState<Beneficiaries[]>([])
  const [currentBeneficiaryIndex, setCurrentBeneficiaryIndex] = useState(0)
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [imageLoading, setImageLoading] = useState<boolean>(false)
  const [activitiesExpanded, setActivitiesExpanded] = useState<boolean>(false)
  const [hasActivities, setHasActivities] = useState<boolean>(false)
  const [toastCount, setToastCount] = useState(0)
  const [lastToastTime, setLastToastTime] = useState(0)
  const { joinProfilePresence, leaveProfilePresence } = usePresence()
  const { setSponsorshipInProgress } = useSponsorship()
  const user = useAuthStore((state) => state.user)
  const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
  const publicHardcodedCents = publicHardcodedRaw ? parseInt(publicHardcodedRaw, 10) : null
  const effectiveGoalCents = publicHardcodedCents !== null ? publicHardcodedCents : beneficiary?.budget_goal || 0
  const remainingAmount = (effectiveGoalCents - (beneficiary?.budget_raised || 0)) / 100
  const minimumAmount = 10
  const maxSelectableAmount = remainingAmount > minimumAmount
    ? remainingAmount - minimumAmount < minimumAmount
      ? remainingAmount
      : remainingAmount - ((remainingAmount - minimumAmount) % minimumAmount)
    : remainingAmount
  const publicHardcodedDollars = publicHardcodedCents !== null ? publicHardcodedCents / 100 : null
  const [amount, setAmount] = useState<number>(publicHardcodedDollars ?? remainingAmount)
  const [selectedOption, setSelectedOption] = useState<string>(paymentOptionsCollection.items[0].value)
  const [paymentLoading, setPaymentLoading] = useState<boolean>(false)
  const alreadyFulfilled = beneficiary?.status === "Budget Fulfilled" || effectiveGoalCents <= (beneficiary?.budget_raised || 0)
  const canPay = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL || (!alreadyFulfilled && (publicHardcodedDollars !== null ? amount === publicHardcodedDollars : remainingAmount < minimumAmount ? amount > 0 : amount >= minimumAmount))


  const loadImages = useCallback(
    async (beneficiaryId: string) => {
      setImageLoading(true)
      try {
        const res = await fetch(
          `/api/admin/beneficiaries/images/${beneficiaryId}`
        )
        if (res.ok) {
          const data: BeneficiaryMedia[] = await res.json()
          const sortedImages =
            data
              ?.filter(
                (m: BeneficiaryMedia) =>
                  m.type === "IMAGE" || m.type === "images"
              )
              ?.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)) ||
            []

          setImages(sortedImages)

          // Also look for videos and update the beneficiary's video_url
          const videoMedia =
            data?.filter((m: BeneficiaryMedia) => m.type === "VIDEO") || []

          if (videoMedia.length > 0) {
            const video = videoMedia[0]
            const videoSrc = video?.id
              ? generatePublicUrl(video as unknown as MediaRow)
              : video?.image_url || ""

              if (videoSrc && videoSrc.trim() !== "" && beneficiary) {
                // Update the beneficiary object with the video URL
                beneficiary.video_url = videoSrc
              }
          }
        }
      } catch (error) {
        console.error("Failed to load images:", error)
        setImages([])
      } finally {
        setImageLoading(false)
      }
    },
    [beneficiary]
  )

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError("")
      try {
        const res = await fetch(`/api/beneficiaries/get/username/${username}`)
        if (!res.ok) {
          throw new Error("Beneficiary not found")
        }
        const data = await res.json()
        const { child } = data
        if (!child) {
          throw new Error("Beneficiary data is empty")
        }
        setBeneficiary(child)
        if (child?.id) {
          const res = await fetch("/api/beneficiaries/get")
          const data = await res.json()
          if (data.people) {
            setBeneficiaries(data.people)
            const index = data.people.findIndex(
              (b: Beneficiaries) => b.username === username
            )
            if (index !== -1) {
              setCurrentBeneficiaryIndex(index)
            }
          }
        }
      } catch (err) {
        setError("Beneficiary not found.")
        setBeneficiary(null)
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    if (username) fetchData()
  }, [username])

  // Join presence when beneficiary is loaded
  useEffect(() => {
    if (beneficiary?.id) {
      joinProfilePresence(beneficiary.id)
      return () => {
        leaveProfilePresence(beneficiary.id)
      }
    }
  }, [beneficiary?.id, joinProfilePresence, leaveProfilePresence])

  // Load images and check activities when beneficiary is loaded
  useEffect(() => {
    if (!beneficiary?.id) return

    loadImages(beneficiary.id)

    // Check if there are activities
    fetchActivitiesByBeneficiaryId(beneficiary.id).then((activities) => {
      setHasActivities(activities && activities.length > 0)
    })
  }, [beneficiary?.id, loadImages])

  const handleCopyLink = async () => {
    const now = Date.now()
    if (now - lastToastTime < 2000 || toastCount >= 3) {
      return
    }

    try {
      const profileUrl = `${window.location.origin}/sponsorships/${beneficiary?.username}`
      await navigator.clipboard.writeText(profileUrl)
      setToastCount((prev) => prev + 1)
      setLastToastTime(now)
      toaster.create({
        title: "Link Copied!",
        description: "Profile link has been copied to clipboard",
        duration: 3000,
      })
    } catch (err) {
      console.error("Failed to copy link:", err)
    }
  }

  const handleShareProfile = async () => {
    const profileUrl = `${window.location.origin}/sponsorships/${beneficiary?.username}`
    const shareText = `Check out ${beneficiary?.name}'s profile on Creator Share. Help make a difference in their life!`
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${beneficiary?.name} - Creator Share`,
          text: shareText,
          url: profileUrl,
        })
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Share failed:", error)
        }
      }
    } else {
      handleCopyLink()
    }
  }

  // Helper function for ImageCarousel
  const getImageSrc = (image: { id?: string; image_url?: string }) => {
    if (image.id) {
      try {
        return generatePublicUrl(image as unknown as MediaRow)
      } catch {
        return image.image_url || ""
      }
    }
    return image.image_url || ""
  }

  // Helper function for generating thumbnail URLs for progressive loading
  // Returns undefined if thumbnail generation fails, which will skip progressive loading
  const getThumbnailSrc = (image: { id?: string; image_url?: string }) => {
    if (image.id) {
      try {
        return generateThumbnailUrl(image as unknown as MediaRow)
      } catch {
        // Silently fail and skip thumbnail - component will use full image
        return undefined
      }
    }
    return undefined
  }

  const fallbackImageSrc = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="

  if (loading) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Spinner size="xl" color="blue.500" />
      </Flex>
    )
  }

  if (error || !beneficiary) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Text color="red.500" fontSize="xl">
          {error || "Beneficiary not found."}
        </Text>
      </Flex>
    )
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (publicHardcodedDollars !== null) return

    const inputValue = e.target.value
    if (inputValue === "") {
      setAmount(0)
      return
    }
    let newValue = parseInt(inputValue) || 0
    newValue = Math.min(newValue, remainingAmount)
    setAmount(newValue)
  }

  const handleStripePayment = async () => {
    if (!canPay) {
      toaster.create({
        title: "Invalid Amount",
        description: remainingAmount < minimumAmount
          ? `Please enter an amount greater than $0 to complete the sponsorship.`
          : `Minimum sponsorship amount is $${minimumAmount}.`,
      })
      return
    }
    if (!process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL && amount > remainingAmount) {
      toaster.create({
        title: "Invalid Amount",
        description: "Amount exceeds the remaining budget needed.",
      })
      return
    }

    setPaymentLoading(true)

    try {
      const primaryImage = images && images.length > 0 ? images[0] : null
      let primaryImageUrl = beneficiary.image_url || ""
      if (primaryImage) {
        try {
          primaryImageUrl = generatePublicUrl(primaryImage as unknown as MediaRow)
        } catch {
          primaryImageUrl = primaryImage.image_url || primaryImageUrl
        }
      }

      const payload = {
        beneficiaryId: beneficiary.id,
        beneficiaryName: beneficiary.name,
        beneficiaryImage: primaryImageUrl || fallbackImageSrc,
        amount: publicHardcodedCents !== null ? publicHardcodedCents : amount * 100,
        paymentType: selectedOption,
        location: beneficiary.country,
        userId: user?.id,
        isEmbedded: window.self !== window.top,
        allowBelowMinimum: remainingAmount < minimumAmount && amount === remainingAmount,
        email: user?.email || undefined,
        type: "sponsorship",
      }

      const res = await fetch("/api/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data?.error === "DUPLICATE_SPONSORSHIP") {
          toaster.create({
            title: "Child Already Sponsored",
            description: data?.message || "This child already has an active sponsorship. Please choose a different child to sponsor.",
            duration: 8000,
          })
          return
        }
        
        toaster.create({
          title: "Payment Error",
          description: data?.error || "Something went wrong. Please try again.",
        })
        return
      }

      const { clientSecret, url } = data

      window.dispatchEvent(
        new CustomEvent("payment-success", {
          detail: { beneficiaryId: beneficiary.id },
        })
      )

      if (window.self !== window.top) {
        if (clientSecret)
          window.location.href = `/sponsorships/checkout?client_secret=${clientSecret}&beneficiary_id=${beneficiary.id}`
        else if (url) window.location.href = url
        else
          toaster.create({
            title: "Payment Error",
            description: "No checkout information returned. Please try again.",
          })
      } else {
        if (url) window.location.href = url
        else
          toaster.create({
            title: "Payment Error",
            description: "No checkout URL returned. Please try again.",
          })
      }
    } catch (err) {
      toaster.create({
        title: "Payment Error",
        description: "Something went wrong. Please try again.",
      })
      console.error("Payment Error:", err)
    } finally {
      setPaymentLoading(false)
    }
  }

  const handleCreateOrder = async (
    _data: Record<string, unknown>,
    actions: {
      order: {
        create: (options: {
          purchase_units: Array<{
            description: string
            amount: { value: string; currency_code: string }
          }>
        }) => Promise<string>
      }
    }
  ) => {
    if (!canPay) {
      toaster.create({
        title: "Invalid Amount",
        description: remainingAmount < minimumAmount
          ? `Please enter an amount greater than $0 to complete the sponsorship.`
          : `Minimum amount is $${minimumAmount}.`,
      })
      throw new Error("Invalid amount")
    }

    const paymentAmount = remainingAmount < minimumAmount ? remainingAmount : amount

    return actions.order.create({
      purchase_units: [
        {
          description: `${selectedOption === "subscription" ? "Monthly" : "Yearly"} Sponsorship for ${beneficiary.name}`,
          amount: { value: paymentAmount.toFixed(2), currency_code: "USD" },
        },
      ],
    })
  }

  const handlePayPalApproval = async (data: { orderID: string }) => {
    try {
      setSponsorshipInProgress(beneficiary.id, true)
      if (selectedOption === "subscription") {
        const planRes = await fetch("/api/paypal/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            beneficiary_id: beneficiary.id,
            name: `Monthly Sponsorship for ${beneficiary.name}`,
            description: `Recurring monthly sponsorship for ${beneficiary.name}`,
            amount: remainingAmount < minimumAmount ? remainingAmount : amount,
            interval_unit: "MONTH",
            interval_count: 1,
            currency_code: "USD",
          }),
        })

        const planData = await planRes.json()

        if (!planRes.ok) {
          throw new Error(planData.error?.message || "Failed to create/get PayPal plan")
        }

        const plan_id = planData.plan.id

        const subRes = await fetch("/api/paypal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id,
            beneficiaryId: beneficiary.id,
            subscriber_email: user?.email,
            subscriber_name: user?.email || "",
          }),
        })

        const subData = await subRes.json()

        if (!subRes.ok) {
          throw new Error(subData.error?.message || "Failed to create PayPal subscription")
        }

        type PayPalLink = { rel?: string; href?: string }
        const approvalUrl = subData.subscription?.links?.find(
          (l: PayPalLink) => l.rel === "approve"
        )?.href

        if (approvalUrl) {
          window.dispatchEvent(
            new CustomEvent("payment-success", {
              detail: { beneficiaryId: beneficiary.id },
            })
          )
          window.location.href = approvalUrl
          return
        }
        throw new Error("No approval link returned from PayPal")
      }

      const response = await fetch("/api/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId: beneficiary.id,
          beneficiaryName: beneficiary.name,
          amount: remainingAmount < minimumAmount ? remainingAmount : amount,
          paymentType: selectedOption,
          location: beneficiary.country,
          userId: user?.id,
          email: user?.email,
          orderID: data.orderID,
        }),
      })

      const responseText = await response.text()
      const responseData = JSON.parse(responseText)

      if (!response.ok) {
        throw new Error(responseData.error || "Failed to process payment")
      }

      toaster.create({
        title: "Success",
        description: "Your payment has been processed successfully!",
      })
      window.location.href = `/payments/success?order_id=${data.orderID}`
    } catch (error) {
      const err = error as Error
      toaster.create({
        title: "Payment Error",
        description: err.message || "Something went wrong. Please try again.",
        duration: 5000,
      })
    }
  }

  const handlePayPalError = (err: Error) => {
    console.error("PayPal Error:", err)
    toaster.create({
      title: "Payment Error",
      description: "Something went wrong with PayPal. Please try again.",
    })
    setSponsorshipInProgress(beneficiary.id, false)
  }

  // Handle subscription type change
  const handleSubscriptionChange = (type: string) => {
    setSelectedOption(type)
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case "Budget Fulfilled":
        return "Sponsored"
      case "Partially Funded":
        return "Ongoing"
      case "New":
        return "Not funded"
      default:
        return "Not funded"
    }
  }

  return (
    <Box minH="100vh" p={6} pt={12}>
      <Box maxW="6xl" mx="auto">
        {/* Navigation */}
        <Flex justify="space-between" mb={8}>
          <Button
            onClick={() => {
              const newIndex = currentBeneficiaryIndex - 1
              if (newIndex >= 0 && beneficiaries[newIndex]?.username) {
                window.location.href = `/sponsorships/${beneficiaries[newIndex].username}`
              }
            }}
            disabled={currentBeneficiaryIndex === 0}
            variant="outline"
            className={`px-4 py-2 ${
              currentBeneficiaryIndex === 0
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            ← Previous Beneficiary
          </Button>
          <Button
            onClick={() => {
              const newIndex = currentBeneficiaryIndex + 1
              if (
                newIndex < beneficiaries.length &&
                beneficiaries[newIndex]?.username
              ) {
                window.location.href = `/sponsorships/${beneficiaries[newIndex].username}`
              }
            }}
            disabled={currentBeneficiaryIndex === beneficiaries.length - 1}
            variant="outline"
            className={`px-4 py-2 ${
              currentBeneficiaryIndex === beneficiaries.length - 1
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            Next Beneficiary →
          </Button>
        </Flex>

        {/* Main Content - Two Column Layout */}
        <Flex
          direction={{ base: "column", md: "row" }}
          gap={{ base: 6, md: 8 }}
          mb={6}
        >
          {/* LEFT COLUMN - Image & Basic Info */}
          <Box flex={{ base: "1", md: "0 0 40%" }} className="flex flex-col">
            {/* Status Badge */}
            <Box className="relative">
              <Box className="absolute top-3 right-3 z-10 bg-[#CDE1FE] text-[#0654C6] rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm">
                <FaCircleInfo />
                <Text className="text-xs font-semibold">
                  {getStatusText(beneficiary.status)}
                </Text>
              </Box>
              {/* Hero Image Carousel */}
              <Box
                position="relative"
                className="rounded-2xl overflow-hidden"
              >
                {imageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 z-10">
                    <Spinner size="lg" color="#0654C6" />
                  </div>
                )}
                <ImageCarousel
                  images={images}
                  getImageSrc={getImageSrc}
                  getThumbnailSrc={getThumbnailSrc}
                  fallbackSrc={fallbackImageSrc}
                  alt={beneficiary.name || "Child"}
                  className="rounded-2xl aspect-[4/5] object-cover"
                  showArrowsOnHover={true}
                />
              </Box>
            </Box>

            {/* Name & Details */}
            <Box className="text-center space-y-3 mt-4">
              <Text className="text-3xl md:text-4xl font-bold text-gray-900">
                {beneficiary.name || "Full Name"}
              </Text>
              <Flex
                align="center"
                gap={{ base: 2, md: 3 }}
                justify="center"
                wrap="wrap"
                className="text-gray-600"
                fontSize={{ base: "sm", md: "md" }}
              >
                <Flex align="center" gap={1.5}>
                  <FaCalendar className="text-[#0654C6]" />
                  <Text>
                    {beneficiary.birth_date
                      ? `${Math.floor(
                          (Date.now() -
                            new Date(beneficiary.birth_date).getTime()) /
                            (365.25 * 24 * 60 * 60 * 1000)
                        )} years old${
                          (beneficiary.metadata as { birth_date_is_estimate?: boolean } | undefined)
                            ?.birth_date_is_estimate
                            ? " (estimated)"
                            : ""
                        }`
                      : "Age unknown"}
                  </Text>
                </Flex>
                <Flex align="center" gap={1.5}>
                  <FaUser className="text-[#0654C6]" />
                  <Text>{beneficiary.gender || "Gender"}</Text>
                </Flex>
                <Flex align="center" gap={1.5}>
                  <FaLocationDot className="text-[#0654C6]" />
                  <Text>{beneficiary.country || "Location"}</Text>
                </Flex>
              </Flex>
            </Box>

            {/* Video - Only show if exists */}
            {beneficiary.video_url?.trim() && (
              <Box className="mt-4">
                <Box
                  bg="white"
                  borderRadius="xl"
                  overflow="hidden"
                  borderWidth="1px"
                  borderColor="gray.200"
                  boxShadow="sm"
                >
                  <video
                    className="w-full"
                    src={beneficiary.video_url.trim()}
                    controls
                  />
                </Box>
              </Box>
            )}
          </Box>

          {/* RIGHT COLUMN - Bio & Sponsorship */}
          <Box
            flex={{ base: "1", md: "0 0 60%" }}
            className="flex flex-col"
            px={{ base: 0, md: 6 }}
          >
            {/* Bio Section */}
            <Box className="bg-gray-100 rounded-xl p-5 space-y-2 mb-8">
              <Text className="text-lg font-semibold text-gray-900">
                About {beneficiary.name?.split(" ")[0] || "Child"}
              </Text>
              <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
                {beneficiary.biography || "No biography available."}
              </Text>
            </Box>

            {/* Share Actions */}
            <Flex gap={2} mb={6}>
              <Button
                className="border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                size="sm"
                variant="outline"
                onClick={handleCopyLink}
              >
                <FaLink className="mr-2" />
                Copy Link
              </Button>
              <Button
                className="border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                size="sm"
                variant="outline"
                onClick={handleShareProfile}
              >
                <FaShare className="mr-2" />
                Share
              </Button>
            </Flex>

            {/* Progress Bar - Cleaner Design */}
            {publicHardcodedCents == null && (
              <Box className="space-y-2 mb-8">
                <Flex justify="space-between" align="center">
                  <Text className="text-sm font-medium text-gray-600">
                    Sponsorship Progress
                  </Text>
                  <Text className="text-lg font-bold text-[#0654C6]">
                    {beneficiary.budget_goal > 0
                      ? Math.round(
                          (beneficiary.budget_raised /
                            beneficiary.budget_goal) *
                            100
                        )
                      : 0}
                    %
                  </Text>
                </Flex>
                <Box className="w-full bg-gray-200 h-3 rounded-full overflow-hidden">
                  <Box
                    className="bg-[#0654C6] h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${
                        beneficiary.budget_goal > 0
                          ? Math.min(
                              (beneficiary.budget_raised /
                                beneficiary.budget_goal) *
                                100,
                              100
                            )
                          : 0
                      }%`,
                    }}
                  />
                </Box>
                <Text className="text-sm text-gray-500">
                  $
                  {((beneficiary.budget_raised || 0) / 100).toLocaleString(
                    undefined,
                    {
                      maximumFractionDigits: 0,
                    }
                  )}{" "}
                  raised of $
                  {((beneficiary.budget_goal || 0) / 100).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 0 }
                  )}{" "}
                  goal
                </Text>
              </Box>
            )}

            {/* Sponsorship Section */}
            <Box className="space-y-4 mb-8">
              <Text className="font-medium text-sm mb-2 text-gray-500">
                Monthly Sponsorship Amount
              </Text>
              <Flex gap={3} align="start">
                <Box flex="0 0 50%">
                  {remainingAmount < minimumAmount ? (
                    <Flex
                      className="border border-gray-300 rounded-xl bg-white overflow-hidden"
                      align="center"
                      h="56px"
                    >
                      <Box className="bg-gray-100 px-4 h-full flex items-center text-gray-700 font-medium border-r border-gray-300">
                        $
                      </Box>
                      <Input
                        type="number"
                        value={
                          publicHardcodedDollars !== null
                            ? publicHardcodedDollars
                            : remainingAmount
                        }
                        readOnly={publicHardcodedDollars !== null}
                        disabled={publicHardcodedDollars !== null}
                        className="px-4 h-full bg-gray-100 border-0 outline-none focus:ring-0 text-lg text-gray-700"
                        placeholder="Enter Amount"
                      />
                    </Flex>
                  ) : (
                    <Flex
                      className="border border-gray-300 rounded-xl bg-white focus-within:border-[#0654C6] transition-colors overflow-hidden"
                      align="center"
                      h="56px"
                    >
                      <Box className="bg-gray-100 px-4 h-full flex items-center text-gray-700 font-medium border-r border-gray-300">
                        $
                      </Box>
                      <Input
                        type="number"
                        min="1"
                        max={maxSelectableAmount}
                        value={amount || ""}
                        onChange={handleAmountChange}
                        readOnly={publicHardcodedDollars !== null}
                        className="px-4 h-full border-0 outline-none focus:ring-0 text-lg text-gray-700"
                        placeholder="Enter Amount"
                      />
                    </Flex>
                  )}
                  <Text className="text-xs text-gray-500 mt-2">
                    Fixed monthly contribution
                  </Text>
                </Box>
                <Box flex="0 0 calc(50% - 12px)">
                  <Button
                    onClick={handleStripePayment}
                    loading={paymentLoading}
                    loadingText="Processing..."
                    disabled={paymentLoading || !canPay}
                    className={`w-full h-14 text-lg font-semibold bg-[#0654C6] text-white hover:bg-[#0545A5] rounded-xl transition-all shadow-md hover:shadow-lg${
                      !canPay ? " opacity-50 cursor-not-allowed" : ""
                    }`}
                  >
                    Sponsor {beneficiary.name?.split(" ")[0] || "Child"} 🪽
                  </Button>
                </Box>
              </Flex>

              {/* PayPal Alternative */}
              {isPayPalEnabled && PayPalScriptProvider && PayPalButtons && (
                <Box>
                  <PayPalScriptProvider
                    options={{
                      "client-id": process.env
                        .NEXT_PUBLIC_PAYPAL_CLIENT_ID as string,
                      currency: "USD",
                      intent: "capture",
                    }}
                  >
                    {canPay ? (
                      <PayPalButtons
                        style={{
                          layout: "horizontal",
                          tagline: false,
                          height: 48,
                        }}
                        onShippingChange={() => handleSubscriptionChange("subscription")}
                        createOrder={handleCreateOrder}
                        onApprove={handlePayPalApproval}
                        onError={handlePayPalError}
                      />
                    ) : (
                      <Box className="h-12 bg-gray-200 rounded-xl flex items-center justify-center">
                        <Text color="gray.500" fontSize="sm">
                          {remainingAmount < minimumAmount
                            ? "Enter amount greater than $0"
                            : `Minimum amount is $${minimumAmount}`}
                        </Text>
                      </Box>
                    )}
                  </PayPalScriptProvider>
                </Box>
              )}
            </Box>

            {/* Subscribe Box */}
            <Box>
              <BeneficiarySubscribeBox beneficiary={beneficiary} />
            </Box>
          </Box>
        </Flex>

        {/* Collapsible Activities Section - Only show if activities exist */}
        {hasActivities && (
          <Box className="mt-8 border-t pt-6">
            <Box
              className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-3 rounded-lg transition-colors"
              onClick={() => setActivitiesExpanded(!activitiesExpanded)}
            >
              <Flex align="center" gap={2}>
                <Text className="text-base font-semibold text-gray-700">
                  ⚡ Latest Updates
                </Text>
                <Text className="text-sm text-gray-500">
                  (Recent activities)
                </Text>
              </Flex>
              <Box className="text-gray-500">
                {activitiesExpanded ? <FaChevronUp /> : <FaChevronDown />}
              </Box>
            </Box>

            {activitiesExpanded && (
              <Box className="mt-4 animate-in fade-in duration-300">
                <BeneficiaryActivity
                  beneficiaryId={beneficiary.id}
                  username={beneficiary.username}
                />
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}
