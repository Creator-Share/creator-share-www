import React, { useEffect, useState, useCallback } from "react"
import dynamic from "next/dynamic"
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
  FaCircleCheck,
  FaArrowDown,
} from "react-icons/fa6"
import { Beneficiaries, Activity } from "@/types"
import { toaster } from "@/components/ui/toaster"
import { Box, Text, Spinner, Flex, Input } from "@chakra-ui/react"
import { useAuthStore } from "@/store/authStore"
import { paymentOptionsCollection } from "../Payments/config"
import { Button } from "@/components/ui/button"
import { BeneficiaryMedia } from "@/types/admin.types"
import {
  generatePublicUrl,
  getImageSrc,
  getThumbnailSrc,
  MediaRow,
} from "@/utils/supabase/media"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import SupportedRibbon from "@/components/common/SupportedRibbon"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import { useSponsorship } from "../../hooks/useSponsorship"
import BeneficiaryActivity, { SHOW_MORE_CLASS } from "../SponsorshipActivity"

// PayPal components are optional and loaded only when the env var is set.
// Using next/dynamic avoids the broken module-level let + fire-and-forget import()
// pattern, which was a race condition (React never re-rendered when those vars
// were assigned by the async import).
const isPayPalEnabled = !!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

const PayPalScriptProvider = isPayPalEnabled
  ? dynamic(
      () =>
        import("@paypal/react-paypal-js").then((m) => ({
          default: m.PayPalScriptProvider,
        })),
      { ssr: false },
    )
  : null

const PayPalButtons = isPayPalEnabled
  ? dynamic(
      () =>
        import("@paypal/react-paypal-js").then((m) => ({
          default: m.PayPalButtons,
        })),
      { ssr: false },
    )
  : null

interface BeneficiaryModalProps {
  open: boolean
  onClose: () => void
  beneficiary: Beneficiaries
  /** Activities pre-fetched by SponsorshipsContainer -- avoids a double fetch. */
  activities?: Activity[]
  /** True while activities are being fetched for the active beneficiary. */
  activitiesLoading?: boolean
}

const BeneficiaryModal: React.FC<BeneficiaryModalProps> = ({
  open,
  onClose,
  beneficiary,
  activities = [],
  activitiesLoading = false,
}) => {
  const [toastCount, setToastCount] = useState(0)
  const [lastToastTime, setLastToastTime] = useState(0)
  const user = useAuthStore((state) => state.user)
  const { setSponsorshipInProgress } = useSponsorship()
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
  const birthDateIsEstimate = Boolean(
    (beneficiary.metadata as { birth_date_is_estimate?: boolean } | undefined)
      ?.birth_date_is_estimate,
  )

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
    publicHardcodedDollars ?? remainingAmount,
  )
  const [selectedOption, setSelectedOption] = useState<string>(
    paymentOptionsCollection.items[0].value,
  )
  const [loading, setLoading] = useState<boolean>(false)
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [imageLoading, setImageLoading] = useState<boolean>(false)
  const [bioExpanded, setBioExpanded] = useState(false)

  const hasActivities = activities.length > 0

  // About card: collapsed by default when there are updates (room for Latest Updates);
  // expanded by default when there are none (full bio visible, button reads "Show less").
  // Wait until activities have loaded so an empty in-flight list is not treated as "no updates".
  useEffect(() => {
    if (!open || !beneficiary.id || activitiesLoading) return
    setBioExpanded(!hasActivities)
  }, [open, beneficiary.id, hasActivities, activitiesLoading])

  const alreadyFulfilled =
    beneficiary.status === "Budget Fulfilled" ||
    effectiveGoalCents <= (beneficiary.budget_raised || 0)

  useEffect(() => {
    if (!open) {
      setSponsorshipInProgress(beneficiary.id, false)
    }
  }, [open, beneficiary.id, setSponsorshipInProgress])

  const loadImages = useCallback(
    async (beneficiaryId: string, signal?: AbortSignal) => {
      setImages([])
      setImageLoading(true)
      try {
        const res = await fetch(`/api/beneficiaries/images/${beneficiaryId}`, {
          signal,
        })
        if (res.ok) {
          const data: BeneficiaryMedia[] = await res.json()
          const sortedImages =
            data
              ?.filter((m: BeneficiaryMedia) => m.type === "IMAGE")
              ?.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0)) || []
          if (signal?.aborted) return
          setImages(sortedImages)

          const videoMedia =
            data?.filter((m: BeneficiaryMedia) => m.type === "VIDEO") || []
          if (videoMedia.length > 0) {
            const video = videoMedia[0]
            const videoSrc = video?.id
              ? generatePublicUrl(video as unknown as MediaRow)
              : ""
            if (videoSrc?.trim() && !signal?.aborted) {
              beneficiary.video_url = videoSrc
            }
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
        console.error("Failed to load images:", error)
        if (!signal?.aborted) setImages([])
      } finally {
        if (!signal?.aborted) setImageLoading(false)
      }
    },
    [beneficiary],
  )

  useEffect(() => {
    if (!open || !beneficiary.id) return
    const controller = new AbortController()
    loadImages(beneficiary.id, controller.signal)
    return () => controller.abort()
  }, [open, beneficiary.id, loadImages])

  useEffect(() => {
    if (!open) {
      setToastCount(0)
      setLastToastTime(0)
      setAmount(remainingAmount)
      setSelectedOption(paymentOptionsCollection.items[0].value)
      setLoading(false)
      setBioExpanded(false)
    }
  }, [open, remainingAmount])

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
    if (now - lastToastTime < 2000 || toastCount >= 3) return

    const profileUrl = `${window.location.origin}/sponsorships/${beneficiary.username}`
    try {
      await navigator.clipboard.writeText(profileUrl)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = profileUrl
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
    }
    setToastCount((prev) => prev + 1)
    setLastToastTime(now)
    toaster.create({
      title: "Link Copied!",
      description: "Profile link has been copied to clipboard",
      duration: 3000,
    })
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
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n\n${profileUrl}`)
      } catch {
        const ta = document.createElement("textarea")
        ta.value = `${shareText}\n\n${profileUrl}`
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      toaster.create({
        title: "Link Copied!",
        description: "Profile link and description copied to clipboard",
        duration: 3000,
      })
    }
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (publicHardcodedDollars !== null) return
    const inputValue = e.target.value
    if (inputValue === "") {
      setAmount(0)
      return
    }
    const newValue = Math.min(parseInt(inputValue) || 0, remainingAmount)
    setAmount(newValue)
  }

  const canPay =
    process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL ||
    (!alreadyFulfilled &&
      (publicHardcodedDollars !== null
        ? amount === publicHardcodedDollars
        : remainingAmount < minimumAmount
          ? amount > 0
          : amount >= minimumAmount))

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
      const primaryImage = images.length > 0 ? images[0] : null
      let primaryImageUrl = beneficiary.image_url || ""
      if (primaryImage) {
        try {
          primaryImageUrl = generatePublicUrl(
            primaryImage as unknown as MediaRow,
          )
        } catch {
          primaryImageUrl = beneficiary.image_url || ""
        }
      }

      const payload = {
        beneficiaryId: beneficiary.id,
        beneficiaryName: beneficiary.name,
        beneficiaryImage: primaryImageUrl || PERSON_PLACEHOLDER_PATH,
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
        if (data?.error === "DUPLICATE_SPONSORSHIP") {
          toaster.create({
            title: "Child Already Sponsored",
            description:
              data?.message ||
              "This child already has an active sponsorship. Please choose a different child to sponsor.",
            duration: 8000,
          })
          setTimeout(() => onClose(), 2000)
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
        }),
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
    },
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
        if (!planRes.ok)
          throw new Error(
            planData.error?.message || "Failed to create/get PayPal plan",
          )

        const subRes = await fetch("/api/paypal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: planData.plan.id,
            beneficiaryId: beneficiary.id,
            subscriber_email: user?.email,
            subscriber_name: user?.email || "",
          }),
        })
        const subData = await subRes.json()
        if (!subRes.ok)
          throw new Error(
            subData.error?.message || "Failed to create PayPal subscription",
          )

        type PayPalLink = { rel?: string; href?: string }
        const approvalUrl = subData.subscription?.links?.find(
          (l: PayPalLink) => l.rel === "approve",
        )?.href
        if (approvalUrl) {
          window.dispatchEvent(
            new CustomEvent("payment-success", {
              detail: { beneficiaryId: beneficiary.id },
            }),
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
      const responseData = await response.json()
      if (!response.ok)
        throw new Error(responseData.error || "Failed to process payment")

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
        Your sponsorship will be applied towards the child&apos;s monthly budget
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

  const firstName = beneficiary.name?.split(" ")[0] || "Child"

  return (
    <DialogRoot
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose()
      }}
    >
      <DialogContent
        className="max-w-[95vw] md:max-w-[1100px] w-full relative rounded-3xl p-0 mt-8 md:mt-24 mx-4 overflow-hidden"
        style={{
          boxShadow:
            "0 4px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.04)",
          borderRadius: "24px",
        }}
      >
        <DialogHeader className="bg-[#1C3C8C] text-white px-8 py-6">
          <Text fontSize="xl" fontWeight="bold">
            {beneficiary.name || "Sponsor a Child"}
          </Text>
          <DialogCloseTrigger className="text-white hover:bg-white/20" />
        </DialogHeader>

        <DialogBody className="p-8">
          {/* Main Content - Two Column Layout */}
          <Flex
            direction={{ base: "column", md: "row" }}
            gap={{ base: 5, md: 6 }}
            mb={4}
          >
            {/* LEFT COLUMN - Image & Basic Info */}
            <Box flex={{ base: "1", md: "0 0 40%" }} className="flex flex-col">
              <Box className="relative">
                {/* Status pill: only shown for non-sponsored children; sponsored state is conveyed by the ribbon */}
                {!alreadyFulfilled && (
                  <Box className="absolute top-3 right-3 z-10 bg-[#CDE1FE] text-[#0654C6] rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm">
                    <FaCircleInfo />
                    <Text className="text-xs font-semibold">
                      {getStatusText(beneficiary.status)}
                    </Text>
                  </Box>
                )}
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
                    fallbackSrc={PERSON_PLACEHOLDER_PATH}
                    alt={beneficiary.name || "Child"}
                    className="rounded-2xl aspect-[4/5] object-cover"
                    showArrowsOnHover={true}
                  />
                  {alreadyFulfilled && <SupportedRibbon size="lg" />}
                </Box>
              </Box>

              <Box className="text-center space-y-3 mt-4">
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
                              (365.25 * 24 * 60 * 60 * 1000),
                          )} years old${birthDateIsEstimate ? " (estimated)" : ""}`
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

              {/* Sponsored banner — left column, under image & details */}
              {alreadyFulfilled && (
                <Box
                  className="rounded-xl p-5 text-center space-y-3 mt-4"
                  style={{
                    background: "linear-gradient(135deg, #EEF6FF 0%, #F3EEFF 100%)",
                    border: "1.5px solid #CDE1FE",
                  }}
                >
                  <Flex justify="center" mb={1}>
                    <FaCircleCheck size={28} color="#0654C6" />
                  </Flex>
                  <Text className="text-base font-bold text-gray-900">
                    This child is fully sponsored
                  </Text>
                  <Text className="text-sm text-gray-500">
                    {firstName} is already receiving support. You can still share
                    their story or find another child to sponsor.
                  </Text>
                  <Button
                    onClick={onClose}
                    className="mt-2 w-full h-11 text-sm font-semibold bg-[#0654C6] text-white hover:bg-[#0545A5] rounded-xl transition-all shadow-md hover:shadow-lg"
                  >
                    <FaArrowDown className="mr-2" />
                    Sponsor a child like {firstName}
                  </Button>
                </Box>
              )}
            </Box>

            {/* RIGHT COLUMN */}
            <Box
              flex={{ base: "1", md: "0 0 60%" }}
              className="flex flex-col"
              pr={{ base: 0, md: 4 }}
            >
              {/* Progress bar -- only when goal tracking is enabled */}
              {publicHardcodedCents == null && (
                <Box className="space-y-2 mb-4">
                  <Flex justify="space-between" align="center">
                    <Text className="text-sm font-medium text-gray-600">
                      Sponsorship Progress
                    </Text>
                    <Text className="text-lg font-bold text-[#0654C6]">
                      {beneficiary.budget_goal > 0
                        ? Math.round(
                            (beneficiary.budget_raised /
                              beneficiary.budget_goal) *
                              100,
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
                                100,
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
                      { maximumFractionDigits: 0 },
                    )}{" "}
                    raised of $
                    {((beneficiary.budget_goal || 0) / 100).toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 },
                    )}{" "}
                    goal
                  </Text>
                </Box>
              )}

              {/* Bio */}
              <Box className="bg-gray-100 rounded-xl p-5 space-y-2 mb-4">
                <Text className="text-lg font-semibold text-gray-900">
                  About {firstName}
                </Text>
                <Text
                  className="text-gray-700 leading-relaxed text-sm md:text-base"
                  style={
                    alreadyFulfilled && !bioExpanded
                      ? {
                          display: "-webkit-box",
                          WebkitLineClamp: 5,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }
                      : undefined
                  }
                >
                  {beneficiary.biography || "No biography available."}
                </Text>
                {alreadyFulfilled && (
                  <button
                    onClick={() => setBioExpanded((v) => !v)}
                    className={SHOW_MORE_CLASS}
                  >
                    {bioExpanded ? "Show less" : "Show more"}
                    <span aria-hidden>{bioExpanded ? "▲" : "▼"}</span>
                  </button>
                )}
              </Box>

              {/* Latest Updates -- styled identically to About card */}
              {hasActivities && (
                <Box className="bg-gray-100 rounded-xl p-5 space-y-2">
                  <Text className="text-lg font-semibold text-gray-900">
                    Latest Updates
                  </Text>
                  <BeneficiaryActivity activities={activities} />
                </Box>
              )}
            </Box>
          </Flex>

          {/* Payment form — full width below the two-column layout (non-sponsored only) */}
          {!alreadyFulfilled && (
            <Box className="space-y-4 mt-8">
              <Text className="font-medium text-sm mb-2 text-gray-500">
                Monthly Sponsorship Amount
              </Text>
              <Flex
                gap={3}
                align="start"
                direction={{ base: "column", md: "row" }}
              >
                <Box
                  flex={{ base: "1", md: "0 0 50%" }}
                  width={{ base: "100%", md: "auto" }}
                >
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
                <Box
                  flex={{ base: "1", md: "0 0 calc(50% - 12px)" }}
                  width={{ base: "100%", md: "auto" }}
                >
                  <Button
                    onClick={handleStripePayment}
                    loading={loading}
                    loadingText="Processing..."
                    disabled={loading || !canPay}
                    className={`w-full h-14 text-lg font-semibold bg-[#0654C6] text-white hover:bg-[#0545A5] rounded-xl transition-all shadow-md hover:shadow-lg${
                      !canPay ? " opacity-50 cursor-not-allowed" : ""
                    }`}
                  >
                    Sponsor {firstName} 🪽
                  </Button>
                </Box>
              </Flex>

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
          )}

          {/* Footer */}
          <Flex
            className="mt-6 pt-4 border-t"
            justify="space-between"
            align="center"
            direction={{ base: "column", md: "row" }}
            gap={4}
          >
            {!alreadyFulfilled && (
              <Text
                color="gray.400"
                fontSize="xs"
                textAlign="center"
                className="leading-relaxed"
                flex="1"
              >
                {renderDisclaimer()}
              </Text>
            )}

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
