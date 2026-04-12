"use client"
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
  FaArrowRight,
} from "react-icons/fa6"
import { Beneficiaries, Activity } from "@/types"
import { toaster } from "@/components/ui/toaster"
import { Box, Text, Spinner, Flex, Input } from "@chakra-ui/react"
import { useAuthStore } from "@/store/authStore"
import { paymentOptionsCollection, specialNeedsFrequencyOptions } from "../Payments/config"
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
import { FAQModal } from "@/components/FAQModal"
import { getDefaultSponsorshipAmount } from "@/components/BeneficiaryTypeNav"

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

  // Per-type default amount (NEXT_PUBLIC_SPONSORSHIP_AMOUNT_*) takes priority over the global goal
  const typeDefaultCents = getDefaultSponsorshipAmount(beneficiary.beneficiary_type)
  const typeDefaultDollars = typeDefaultCents !== null ? typeDefaultCents / 100 : null
  const isSpecialNeeds = (beneficiary.beneficiary_type as string) === "SPECIAL_NEEDS"

  // Effective goal for progress bar / remaining calculation
  // For SPECIAL_NEEDS there is no budget goal — progress bar is hidden anyway
  const effectiveGoalCents =
    typeDefaultCents !== null
      ? typeDefaultCents
      : publicHardcodedCents !== null
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
    typeDefaultDollars ?? publicHardcodedDollars ?? remainingAmount,
  )
  const [selectedOption, setSelectedOption] = useState<string>(
    paymentOptionsCollection.items[0].value,
  )
  const [loading, setLoading] = useState<boolean>(false)
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [imageLoading, setImageLoading] = useState<boolean>(false)
  const [videoUrl, setVideoUrl] = useState<string>(beneficiary.video_url?.trim() || "")
  const [bioExpanded, setBioExpanded] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)

  const hasActivities = activities.length > 0

  // About card: collapsed by default when there are updates (room for Latest Updates);
  // expanded by default when there are none (full bio visible, button reads "Show less").
  // Wait until activities have loaded so an empty in-flight list is not treated as "no updates".
  useEffect(() => {
    if (!open || !beneficiary.id || activitiesLoading) return
    setBioExpanded(!hasActivities)
  }, [open, beneficiary.id, hasActivities, activitiesLoading])

  // SPECIAL_NEEDS beneficiaries receive continuous sponsorship —
  // never treat them as "fully sponsored" regardless of status or budget.
  const alreadyFulfilled =
    !isSpecialNeeds &&
    (beneficiary.status === "Budget Fulfilled" ||
      effectiveGoalCents <= (beneficiary.budget_raised || 0))

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
              setVideoUrl(videoSrc)
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
    [],
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
      // SPECIAL_NEEDS: reset to the suggested default rather than the (meaningless) remainingAmount
      setAmount(
        isSpecialNeeds
          ? (typeDefaultDollars ?? publicHardcodedDollars ?? minimumAmount)
          : remainingAmount,
      )
      setSelectedOption(paymentOptionsCollection.items[0].value)
      setLoading(false)
      setBioExpanded(false)
      setFaqOpen(false)
      setVideoUrl(beneficiary.video_url?.trim() || "")
    }
  }, [open, remainingAmount, beneficiary.video_url, isSpecialNeeds, typeDefaultDollars, publicHardcodedDollars])

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

  const firstName = beneficiary.name?.split(" ")[0] || "Child"

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
    // Global hardcoded amount always locks the field (non-SPECIAL_NEEDS only)
    if (!isSpecialNeeds && publicHardcodedDollars !== null) return
    const inputValue = e.target.value
    if (inputValue === "") {
      setAmount(0)
      return
    }
    // SPECIAL_NEEDS has no budget cap — allow any positive amount
    const newValue = isSpecialNeeds
      ? parseInt(inputValue) || 0
      : Math.min(parseInt(inputValue) || 0, remainingAmount)
    setAmount(newValue)
  }

  // Per-type default (or SPECIAL_NEEDS) always enables payment regardless of remaining amount
  const hasFixedAmount = !isSpecialNeeds && (typeDefaultCents !== null || publicHardcodedCents !== null)
  const canPay =
    (isSpecialNeeds && amount >= minimumAmount) ||
    hasFixedAmount ||
    (!isSpecialNeeds &&
      !alreadyFulfilled &&
      (remainingAmount < minimumAmount
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
    if (!hasFixedAmount && !isSpecialNeeds && amount > remainingAmount) {
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
        // SPECIAL_NEEDS: always use the user-entered amount (custom per sponsorship).
        // Others: per-type default → global goal override → user-entered amount.
        amount: isSpecialNeeds
          ? amount * 100
          : typeDefaultCents !== null
          ? typeDefaultCents
          : publicHardcodedCents !== null
          ? publicHardcodedCents
          : amount * 100,
        paymentType: selectedOption,
        location: beneficiary.country,
        userId: user?.id,
        isEmbedded: window.self !== window.top,
        allowBelowMinimum:
          !isSpecialNeeds &&
          remainingAmount < minimumAmount &&
          amount === remainingAmount,
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
    // SPECIAL_NEEDS: always use the user-entered amount (no budget cap)
    const paymentAmount = isSpecialNeeds
      ? amount
      : remainingAmount < minimumAmount
      ? remainingAmount
      : amount
    const orderLabel =
      isSpecialNeeds && selectedOption === "one_time"
        ? "One-time"
        : selectedOption === "subscription"
        ? "Monthly"
        : "Yearly"
    return actions.order.create({
      purchase_units: [
        {
          description: `${orderLabel} Sponsorship for ${beneficiary.name}`,
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
            // SPECIAL_NEEDS: use user-entered amount; others: cap to remaining if near goal
            amount: isSpecialNeeds ? amount : (remainingAmount < minimumAmount ? remainingAmount : amount),
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
          // SPECIAL_NEEDS: use user-entered amount; others: cap to remaining if near goal
          amount: isSpecialNeeds ? amount : (remainingAmount < minimumAmount ? remainingAmount : amount),
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

  const renderSponsorshipDisclaimer = () => {
    const gapAfterThisPaymentCents =
      beneficiary.budget_goal - beneficiary.budget_raised - amount * 100

    const faqLink = (
      <button
        type="button"
        onClick={() => setFaqOpen(true)}
        className="group inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 pb-0.5 text-sm md:text-base font-medium text-[#0654C6] border-b border-[#0654C6]/35 transition-colors hover:text-[#0545A5] hover:border-[#0545A5]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0654C6]/40 focus-visible:ring-offset-2 rounded-sm"
      >
        <span>Common questions</span>
        <FaArrowRight
          className="h-3 w-3 shrink-0 opacity-80 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
          aria-hidden
        />
      </button>
    )

    // SPECIAL_NEEDS: continuous sponsorship with a custom amount — no budget gap concept
    if (isSpecialNeeds) {
      const isMonthlyFrequency = selectedOption === "subscription"
      return (
        <Box className="space-y-2">
          <Text className="text-lg font-semibold text-gray-900">
            Support {firstName}&apos;s ongoing care
          </Text>
          {isMonthlyFrequency ? (
            <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
              {firstName} has special needs that require continuous, dedicated
              support. Your monthly contribution helps cover therapy, specialized
              care, medical needs, and the qualified carers who look after{" "}
              {firstName} every day. You can choose any amount — and you can
              cancel at any time. You will receive updates on {firstName}
              &apos;s progress directly from our care team.
            </Text>
          ) : (
            <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
              {firstName} has special needs that require dedicated, ongoing
              support. Your one-time gift helps cover therapy, specialized care,
              medical needs, and the qualified carers who look after {firstName}.
              You can choose any amount. You will receive updates on {firstName}
              &apos;s progress directly from our care team.
            </Text>
          )}
          <Box className="mt-5">{faqLink}</Box>
        </Box>
      )
    }

    if (gapAfterThisPaymentCents > 0) {
      return (
        <Box className="space-y-2">
          <Text className="text-lg font-semibold text-gray-900">
            {firstName}&apos;s monthly budget is not yet funded
          </Text>
          <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
            Until enough sponsors come together, {firstName} cannot reach the
            monthly budget required for school enrollment. Your sponsorship
            covers school fees, uniforms, supplies, and meals, and funds the
            care team who visit {firstName} in person. You will receive updates
            on {firstName}&apos;s progress directly from our care team.
          </Text>
          <Box className="mt-5">{faqLink}</Box>
        </Box>
      )
    }

    if (beneficiary.budget_raised > 0) {
      return (
        <Box className="space-y-2">
          <Text className="text-lg font-semibold text-gray-900">
            Other sponsors are already giving. Help close the gap.
          </Text>
          <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
            {firstName}&apos;s monthly budget is partially funded but not yet
            secure. Your gift helps reach the full goal so {firstName} stays
            enrolled, fed, and supported. Sponsorships cover tuition, uniforms,
            supplies, meals, and the outreach workers who check in on{" "}
            {firstName} regularly. You will receive updates on {firstName}
            &apos;s progress directly from our care team.
          </Text>
          <Box className="mt-5">{faqLink}</Box>
        </Box>
      )
    }

    return (
      <Box className="space-y-2">
        <Text className="text-lg font-semibold text-gray-900">
          {firstName} is ready for a sponsor
        </Text>
        <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
          Your monthly sponsorship goes toward school fees, a uniform, shoes,
          supplies, and regular meals for {firstName}. It also funds the social
          workers and field teams who make sure your support reaches them
          safely. You will receive updates on {firstName}&apos;s progress
          directly from our care team.
        </Text>
        <Box className="mt-5">{faqLink}</Box>
      </Box>
    )
  }

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

        <DialogBody className="p-7 md:p-8">
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
                  className="text-gray-600 text-sm"
                >
                  <Flex align="center" gap={1.5}>
                    <FaCalendar className="text-[#0654C6]" />
                    <Text className="text-sm">
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
                    <Text className="text-sm">
                      {beneficiary.gender || "Gender"}
                    </Text>
                  </Flex>
                  <Flex align="center" gap={1.5}>
                    <FaLocationDot className="text-[#0654C6]" />
                    <Text className="text-sm">
                      {beneficiary.country || "Location"}
                    </Text>
                  </Flex>
                </Flex>
              </Box>

              {videoUrl && (
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
                      src={videoUrl}
                      controls
                    />
                  </Box>
                </Box>
              )}
            </Box>

            {/* RIGHT COLUMN */}
            <Box
              flex={{ base: "1", md: "0 0 60%" }}
              className="flex flex-col"
              pr={{ base: 0, md: 4 }}
            >
              {/* Progress bar -- only when goal tracking is enabled (hidden for SPECIAL_NEEDS) */}
              {publicHardcodedCents == null && !isSpecialNeeds && (
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

          {/* Sponsorship CTA — same place & card for fully sponsored + active checkout */}
          <Box className="mt-8 mb-8 md:mt-16 md:mb-16 w-full flex justify-center">
            <Box
              className="w-full min-w-0 md:w-3/4 lg:w-2/3 rounded-xl p-5 md:p-10 space-y-2 text-center"
              style={{
                background: "linear-gradient(135deg, #EEF6FF 0%, #F3EEFF 100%)",
                border: "1px solid #CDE1FE",
              }}
            >
              {alreadyFulfilled ? (
                <>
                  <Flex justify="center">
                    <FaCircleCheck size={28} color="#0654C6" />
                  </Flex>
                  <Text className="text-lg font-semibold text-gray-900">
                    This child is fully sponsored
                  </Text>
                  <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
                    {firstName} is already receiving support. You can still
                    share their story, or find another child to sponsor.
                  </Text>
                  <Button
                    onClick={onClose}
                    className="w-full h-11 text-sm font-semibold bg-[#0654C6] text-white hover:bg-[#0545A5] rounded-xl transition-all shadow-md hover:shadow-lg"
                  >
                    <FaArrowDown className="mr-2" />
                    Sponsor a child like {firstName}
                  </Button>
                </>
              ) : (
                <>
                  {/* Frequency selector — Monthly vs One-time (SPECIAL_NEEDS only) */}
                  {isSpecialNeeds && (
                    <div className="flex justify-center mb-3">
                      <div className="inline-flex items-center bg-[#E5ECF9] rounded-2xl p-1 gap-1">
                        {specialNeedsFrequencyOptions.map((opt) => {
                          const isActive = selectedOption === opt.value
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setSelectedOption(opt.value)}
                              style={{ outline: "none", boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}
                              className={`rounded-xl px-6 py-2 text-sm font-semibold transition-all ${
                                isActive
                                  ? "bg-white text-[#0654C6]"
                                  : "bg-transparent text-gray-500 hover:bg-white/50"
                              }`}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <Flex
                    gap={3}
                    align="start"
                    direction={{ base: "column", md: "row" }}
                    className="text-left"
                  >
                    <Box
                      flex={{ base: "1", md: "0 0 50%" }}
                      width={{ base: "100%", md: "auto" }}
                    >
                      {/* SPECIAL_NEEDS always shows the editable input with no budget cap.
                          Non-SPECIAL_NEEDS: uses the existing locked/near-goal branch. */}
                      {!isSpecialNeeds && remainingAmount < minimumAmount ? (
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
                              typeDefaultDollars !== null
                                ? typeDefaultDollars
                                : publicHardcodedDollars !== null
                                ? publicHardcodedDollars
                                : remainingAmount
                            }
                            readOnly={typeDefaultDollars !== null || publicHardcodedDollars !== null}
                            disabled={typeDefaultDollars !== null || publicHardcodedDollars !== null}
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
                            // SPECIAL_NEEDS has no budget cap — omit the max attribute
                            max={isSpecialNeeds ? undefined : maxSelectableAmount}
                            value={amount || ""}
                            onChange={handleAmountChange}
                            // SPECIAL_NEEDS is always editable; others locked when a type default or
                            // global override is set.
                            readOnly={
                              !isSpecialNeeds &&
                              (typeDefaultDollars !== null || publicHardcodedDollars !== null)
                            }
                            className="px-4 h-full border-0 outline-none focus:ring-0 text-lg text-gray-700"
                            placeholder="Enter Amount"
                          />
                        </Flex>
                      )}
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
                        className={`w-full h-[3.25rem] text-lg font-semibold bg-[#0654C6] text-white hover:bg-[#0545A5] rounded-xl transition-all shadow-md hover:shadow-lg${
                          !canPay ? " opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        Sponsor {firstName} 🪽
                      </Button>
                    </Box>
                  </Flex>

                  {isPayPalEnabled && PayPalScriptProvider && PayPalButtons && (
                    <Box className="pt-1">
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
                          <Box className="h-12 bg-white/80 rounded-xl flex items-center justify-center border border-gray-200">
                            <Text className="text-sm text-gray-500 text-center px-2">
                              {isSpecialNeeds
                                ? selectedOption === "one_time"
                                  ? `Enter at least $${minimumAmount} to give once`
                                  : `Enter at least $${minimumAmount}/month to sponsor`
                                : remainingAmount < minimumAmount
                                ? "Enter amount greater than $0"
                                : `Minimum amount is $${minimumAmount}`}
                            </Text>
                          </Box>
                        )}
                      </PayPalScriptProvider>
                    </Box>
                  )}

                  {/* Context copy inside the card */}
                  <Box className="pt-4 mt-6 text-left">
                    {renderSponsorshipDisclaimer()}
                  </Box>
                </>
              )}
            </Box>
          </Box>

          {/* Footer — actions only */}
          <Flex className="mt-6 pt-2 w-full" justify="flex-end" gap={2}>
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
        </DialogBody>
      </DialogContent>
      <FAQModal open={faqOpen} onClose={() => setFaqOpen(false)} />
    </DialogRoot>
  )
}

export default BeneficiaryModal
