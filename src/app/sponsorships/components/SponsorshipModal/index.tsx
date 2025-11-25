import React, { useEffect, useState, useCallback } from "react"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
} from "@/components/ui/dialog"
import {
  FaCalendar,
  FaUser,
  FaLocationDot,
  FaCircleInfo,
  FaLink,
  FaShare,
  FaChevronDown,
  FaChevronUp,
} from "react-icons/fa6"
import { Beneficiaries } from "@/types/index"
import {
  fetchActivitiesByBeneficiaryId,
  fetchSponsorshipDetailsByBeneficiaryId,
} from "@/actions"
import BeneficiaryActivity from "../SponsorshipActivity"
import { toaster } from "@/components/ui/toaster"
import { Box, Text, Spinner, Flex, Input } from "@chakra-ui/react"

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
import { useAuthStore } from "@/store/authStore"
import { paymentOptionsCollection } from "../Payments/config"
import { Button } from "@/components/ui/button"
import { BeneficiaryMedia } from "@/types/admin.types"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import { useSponsorship } from "../../hooks/useSponsorship"
import { usePresence } from "@/hooks/usePresence"
import ViewerIndicator from "@/components/presence/ViewerIndicator"

interface BeneficiaryModalProps {
  open: boolean
  onClose: () => void
  beneficiary: Beneficiaries
}

const BeneficiaryModal: React.FC<BeneficiaryModalProps> = ({
  open,
  onClose,
  beneficiary,
}) => {
  const [toastCount, setToastCount] = useState(0)
  const [lastToastTime, setLastToastTime] = useState(0)
  const user = useAuthStore((state) => state.user)
  const { setSponsorshipInProgress } = useSponsorship()
  const { joinProfilePresence, leaveProfilePresence } = usePresence()
  const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
  const publicHardcodedCents = publicHardcodedRaw
    ? parseInt(publicHardcodedRaw, 10)
    : null
  const effectiveGoalCents =
    publicHardcodedCents !== null
      ? publicHardcodedCents
      : beneficiary.budget_goal || 0
  const remainingAmount =
    (effectiveGoalCents - (beneficiary.budget_raised || 0)) / 100

  const minimumAmount = 10
  const maxSelectableAmount =
    remainingAmount > minimumAmount
      ? remainingAmount - minimumAmount < minimumAmount
        ? remainingAmount
        : remainingAmount - ((remainingAmount - minimumAmount) % minimumAmount)
      : remainingAmount

  const publicHardcodedDollars =
    publicHardcodedCents !== null ? publicHardcodedCents / 100 : null
  const [amount, setAmount] = useState<number>(
    publicHardcodedDollars ?? remainingAmount
  )
  const [selectedOption, setSelectedOption] = useState<string>(
    paymentOptionsCollection.items[0].value
  )
  const [loading, setLoading] = useState<boolean>(false)
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [imageLoading, setImageLoading] = useState<boolean>(false)
  const [activitiesExpanded, setActivitiesExpanded] = useState<boolean>(false)
  const [hasActivities, setHasActivities] = useState<boolean>(false)

  const [, setPrimaryImageUrl] = useState<string | null>(null)

  // Join presence when modal opens
  useEffect(() => {
    if (open && beneficiary?.id) {
      joinProfilePresence(beneficiary.id)
      return () => {
        leaveProfilePresence(beneficiary.id)
      }
    }
  }, [open, beneficiary?.id, joinProfilePresence, leaveProfilePresence])

  // Clear sponsorship state when modal closes
  useEffect(() => {
    if (!open) {
      setSponsorshipInProgress(beneficiary.id, false)
    }
  }, [open, beneficiary.id, setSponsorshipInProgress])

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

          if (sortedImages.length > 0) {
            try {
              setPrimaryImageUrl(
                generatePublicUrl(sortedImages[0] as unknown as MediaRow)
              )
            } catch {
              setPrimaryImageUrl(sortedImages[0]?.image_url || null)
            }
          } else {
            setPrimaryImageUrl(null)
          }

          // Also look for videos and update the beneficiary's video_url
          const videoMedia =
            data?.filter((m: BeneficiaryMedia) => m.type === "VIDEO") || []

          if (videoMedia.length > 0) {
            const video = videoMedia[0]
            const videoSrc = video?.id
              ? generatePublicUrl(video as unknown as MediaRow)
              : video?.image_url || ""

            if (videoSrc && videoSrc.trim() !== "") {
              // Update the beneficiary object with the video URL
              beneficiary.video_url = videoSrc
            }
          }
        }
      } catch (error) {
        console.error("Failed to load images:", error)
        setImages([])
        setPrimaryImageUrl(null)
      } finally {
        setImageLoading(false)
      }
    },
    [beneficiary]
  )

  useEffect(() => {
    if (!open || !beneficiary.id) return

    fetchSponsorshipDetailsByBeneficiaryId(beneficiary.id)

    // Check if there are activities
    fetchActivitiesByBeneficiaryId(beneficiary.id).then((activities) => {
      setHasActivities(activities && activities.length > 0)
    })

    loadImages(beneficiary.id)
  }, [open, beneficiary.id, loadImages])

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

  const fallbackImageSrc =
    "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="

  const alreadyFulfilled =
    beneficiary.status === "Budget Fulfilled" ||
    effectiveGoalCents <= (beneficiary.budget_raised || 0)

  const canPay =
    process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL ||
    (!alreadyFulfilled &&
      (publicHardcodedDollars !== null
        ? amount === publicHardcodedDollars
        : remainingAmount < minimumAmount
        ? amount > 0
        : amount >= minimumAmount))

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

  const handleCopyLink = async () => {
    const now = Date.now()
    if (now - lastToastTime < 2000 || toastCount >= 3) {
      return
    }

    try {
      const profileUrl = `${window.location.origin}/sponsorships/${beneficiary.username}`

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
      const textArea = document.createElement("textarea")
      const profileUrl = `${window.location.origin}/sponsorships/${beneficiary.username}`
      textArea.value = profileUrl
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand("copy")
      document.body.removeChild(textArea)

      setToastCount((prev) => prev + 1)
      setLastToastTime(now)

      toaster.create({
        title: "Link Copied!",
        description: "Profile link has been copied to clipboard",
        duration: 3000,
      })
    }
  }

  const handleShareProfile = async () => {
    const profileUrl = `${window.location.origin}/sponsorships/${beneficiary.username}`
    const shareText = `Check out ${beneficiary.name}'s profile on Creator Share. Help make a difference in their life!`
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${beneficiary.name} - Creator Share`,
          text: shareText,
          url: profileUrl,
        })

        toaster.create({
          title: "Shared Successfully!",
          description: "Profile has been shared",
          duration: 3000,
        })
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Share failed:", error)
          toaster.create({
            title: "Share Failed",
            description:
              "Unable to share profile. Please try copying the link instead.",
            duration: 3000,
          })
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n\n${profileUrl}`)
        toaster.create({
          title: "Link Copied!",
          description: "Profile link and description copied to clipboard",
          duration: 3000,
        })
      } catch {
        const textArea = document.createElement("textarea")
        textArea.value = `${shareText}\n\n${profileUrl}`
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand("copy")
        document.body.removeChild(textArea)

        toaster.create({
          title: "Link Copied!",
          description: "Profile link and description copied to clipboard",
          duration: 3000,
        })
      }
    }
  }

  useEffect(() => {
    if (!open) {
      setToastCount(0)
      setLastToastTime(0)
      setPrimaryImageUrl(null)
      setAmount(remainingAmount)
      setSelectedOption(paymentOptionsCollection.items[0].value)
      setLoading(false)
    }
  }, [open, remainingAmount])

  useEffect(() => {
    setPrimaryImageUrl(null)
  }, [beneficiary.id])

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
        description:
          remainingAmount < minimumAmount
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

    setLoading(true)

    try {
      // Prefer the first carousel image's public URL if available
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
        beneficiaryImage:
          primaryImageUrl ||
          "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=",
        amount:
          publicHardcodedCents !== null ? publicHardcodedCents : amount * 100,
        paymentType: selectedOption,
        location: beneficiary.country,
        userId: user?.id,
        isEmbedded: window.self !== window.top,
        allowBelowMinimum:
          remainingAmount < minimumAmount && amount === remainingAmount,
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
        // Handle duplicate sponsorship error specifically
        if (data?.error === "DUPLICATE_SPONSORSHIP") {
          toaster.create({
            title: "Child Already Sponsored",
            description: data?.message || "This child already has an active sponsorship. Please choose a different child to sponsor.",
            duration: 8000,
          })
          // Close modal and let user select a different child
          setTimeout(() => {
            handleClose()
          }, 2000)
          return
        }
        
        toaster.create({
          title: "Payment Error",
          description: data?.error || "Something went wrong. Please try again.",
        })
        return
      }

      const { clientSecret, url } = data

      // Store beneficiary ID in localStorage to cleanup on return
      localStorage.setItem('pending_checkout_beneficiary', beneficiary.id)

      // Dispatch payment success event before redirecting
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
      setLoading(false)
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
        description:
          remainingAmount < minimumAmount
            ? `Please enter an amount greater than $0 to complete the sponsorship.`
            : `Minimum amount is $${minimumAmount}.`,
      })
      throw new Error("Invalid amount")
    }

    const paymentAmount =
      remainingAmount < minimumAmount ? remainingAmount : amount

    return actions.order.create({
      purchase_units: [
        {
          description: `${
            selectedOption === "subscription" ? "Monthly" : "Yearly"
          } Sponsorship for ${beneficiary.name}`,
          amount: { value: paymentAmount.toFixed(2), currency_code: "USD" },
        },
      ],
    })
  }

  const handlePayPalApproval = async (data: { orderID: string }) => {
    try {
      console.log("PayPal Approval - selectedOption:", selectedOption)
      console.log("PayPal Approval - beneficiary:", beneficiary)
      console.log("PayPal Approval - amount:", amount)

      if (selectedOption === "subscription") {
        console.log("Creating PayPal subscription...")

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
        console.log("Plan creation response:", planData)

        if (!planRes.ok) {
          console.error("Plan creation failed:", planData)
          throw new Error(
            planData.error?.message || "Failed to create/get PayPal plan"
          )
        }

        const plan_id = planData.plan.id
        console.log("Plan ID:", plan_id)

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
        console.log("Subscription creation response:", subData)

        if (!subRes.ok) {
          console.error("Subscription creation failed:", subData)
          throw new Error(
            subData.error?.message || "Failed to create PayPal subscription"
          )
        }

        type PayPalLink = { rel?: string; href?: string }
        const approvalUrl = subData.subscription?.links?.find(
          (l: PayPalLink) => l.rel === "approve"
        )?.href

        console.log("Approval URL:", approvalUrl)

        if (approvalUrl) {
          // Dispatch payment success event before redirecting to PayPal
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

      console.log("Creating one-time payment...")
      // One-time legacy flow
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
        console.error("PayPal error response:", responseData)
        throw new Error(responseData.error || "Failed to process payment")
      }

      toaster.create({
        title: "Success",
        description: "Your payment has been processed successfully!",
      })
      window.location.href = `/payments/success?order_id=${data.orderID}`
    } catch (error) {
      const err = error as Error
      console.error("PayPal Error:", error)
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
  }

  const renderDisclaimer = () => {
    const monthlyAmount =
      selectedOption === "payment" ? (amount / 12).toFixed(2) : amount
    if (
      beneficiary.budget_goal - beneficiary.budget_raised - amount * 100 >
      0
    ) {
      return (
        <>
          This child has a monthly budget goal that must be met for enrollment
          in school.
          {selectedOption === "payment" && (
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
    } else if (beneficiary.budget_raised > 0) {
      return (
        <>
          This child is partially sponsored. Your contribution will help reach
          their monthly budget goal!
          {selectedOption === "payment" && (
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
        {selectedOption === "payment" && (
          <>
            <br />
            Your yearly contribution of ${amount} provides ${monthlyAmount}{" "}
            monthly for this child.
          </>
        )}
      </>
    )
  }

  // Clear sponsorship in progress when modal closes
  const handleClose = () => {
    onClose()
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(details) => {
        if (!details.open) handleClose()
      }}
    >
      <DialogContent className="max-w-[95vw] md:max-w-[1100px] w-full relative rounded-2xl p-0 mt-8 md:mt-24">
        <DialogHeader className="flex justify-between items-center px-6 md:px-8 pt-6 pb-4">
          <Flex align="center" gap={3} flex="1">
            <Text className="text-xl md:text-2xl font-bold text-gray-800">
              Sponsorship Details
            </Text>
            <ViewerIndicator
              profileId={beneficiary.id}
              variant="badge"
              showWhenZero={false}
            />
          </Flex>
          <DialogCloseTrigger>
            <Box className="text-2xl font-normal cursor-pointer hover:bg-gray-100 rounded-full w-8 h-8 flex items-center justify-center transition-colors">
              ×
            </Box>
          </DialogCloseTrigger>
        </DialogHeader>
        <DialogBody className="p-8">
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
                          )} years old`
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

            {/* RIGHT COLUMN - Sponsorship Action */}
            <Box
              flex={{ base: "1", md: "0 0 60%" }}
              className="flex flex-col"
              px={{ base: 0, md: 6 }}
            >
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

              {/* Bio Section - Clean, Integrated */}
              <Box className="bg-gray-100 rounded-xl p-5 space-y-2 mb-8">
                <Text className="text-lg font-semibold text-gray-900">
                  About {beneficiary.name?.split(" ")[0] || "Child"}
                </Text>
                <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
                  {beneficiary.biography || "No biography available."}
                </Text>
              </Box>

              {/* Sponsorship Section */}
              <Box className="space-y-4">
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
                      loading={loading}
                      loadingText="Processing..."
                      disabled={loading || !canPay}
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

          {/* Footer - Disclaimer and Share Actions */}
          <Flex
            className="mt-6 pt-4 border-t"
            justify="space-between"
            align="center"
            direction={{ base: "column", md: "row" }}
            gap={4}
          >
            <Text
              color="gray.400"
              fontSize="xs"
              textAlign="center"
              className="leading-relaxed"
              flex="1"
            >
              {renderDisclaimer()}
            </Text>

            {/* Share Actions - Bottom Right */}
            <Flex gap={2} flexShrink={0}>
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
          </Flex>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}

export default BeneficiaryModal
