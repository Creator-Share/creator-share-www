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
import { paymentOptionsCollection } from "../Payments/config"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
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
import {
  isOpenSponsorshipType,
  MAXIMUM_OPEN_SPONSORSHIP_CENTS,
  MINIMUM_OPEN_SPONSORSHIP_CENTS,
} from "@/config/beneficiaryTypes"
import { centsToDollars } from "@/utils/currency"

const OPEN_SPONSORSHIP_MIN_DOLLARS = Number(
  centsToDollars(MINIMUM_OPEN_SPONSORSHIP_CENTS),
)
const OPEN_SPONSORSHIP_MAX_DOLLARS = Number(
  centsToDollars(MAXIMUM_OPEN_SPONSORSHIP_CENTS),
)
const OPEN_SPONSORSHIP_RANGE_MESSAGE = `Amount must be between $${OPEN_SPONSORSHIP_MIN_DOLLARS} and $${OPEN_SPONSORSHIP_MAX_DOLLARS}`

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
  const isOpen = isOpenSponsorshipType(beneficiary.beneficiary_type)

  // For fixed types the budget_goal IS the sponsorship amount (set at create time).
  // For open types there is no goal — sponsors choose their own amount.
  const fixedAmountCents = !isOpen ? (beneficiary.budget_goal ?? 0) : 0
  const birthDateIsEstimate = Boolean(
    (beneficiary.metadata as { birth_date_is_estimate?: boolean } | undefined)
      ?.birth_date_is_estimate,
  )

  const [amountCents, setAmountCents] = useState<number>(
    isOpen ? 0 : fixedAmountCents,
  )
  const [tipOpen, setTipOpen] = useState(false)
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

  // Open types are never "fully sponsored" — they accept unlimited sponsors.
  const alreadyFulfilled =
    !isOpen &&
    (beneficiary.status === "Budget Fulfilled" ||
      (beneficiary.budget_goal > 0 && beneficiary.budget_goal <= (beneficiary.budget_raised || 0)))

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
      setAmountCents(isOpen ? 0 : fixedAmountCents)
      setSelectedOption(paymentOptionsCollection.items[0].value)
      setLoading(false)
      setBioExpanded(false)
      setFaqOpen(false)
      setVideoUrl(beneficiary.video_url?.trim() || "")
    }
  }, [open, isOpen, fixedAmountCents, beneficiary.video_url])

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
    if (!isOpen) return
    const inputValue = e.target.value
    if (inputValue === "") {
      setAmountCents(0)
      return
    }
    const dollars = parseFloat(inputValue)
    setAmountCents(Number.isFinite(dollars) ? Math.round(dollars * 100) : 0)
  }

  const canPay = isOpen
    ? amountCents >= MINIMUM_OPEN_SPONSORSHIP_CENTS &&
      amountCents <= MAXIMUM_OPEN_SPONSORSHIP_CENTS
    : !alreadyFulfilled

  const outOfRange =
    isOpen &&
    (amountCents < MINIMUM_OPEN_SPONSORSHIP_CENTS ||
      amountCents > MAXIMUM_OPEN_SPONSORSHIP_CENTS)
  const disabledReason = outOfRange ? OPEN_SPONSORSHIP_RANGE_MESSAGE : null

  const handleStripePayment = async () => {
    if (!canPay) {
      toaster.create({
        title: "Invalid Amount",
        description: isOpen
          ? OPEN_SPONSORSHIP_RANGE_MESSAGE
          : "This beneficiary is already fully sponsored.",
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
        amount: isOpen ? amountCents : beneficiary.budget_goal,
        paymentType: selectedOption,
        location: beneficiary.country,
        userId: user?.id,
        isEmbedded: window.self !== window.top,
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
            title: "Already Sponsored",
            description:
              data?.message ||
              "This beneficiary already has an active sponsorship. Please choose a different one.",
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
        description: isOpen
          ? OPEN_SPONSORSHIP_RANGE_MESSAGE
          : "This beneficiary is already fully sponsored.",
      })
      throw new Error("Invalid amount")
    }
    const paymentAmount = (isOpen ? amountCents : fixedAmountCents) / 100
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
            amount: (isOpen ? amountCents : fixedAmountCents) / 100,
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
          amount: (isOpen ? amountCents : fixedAmountCents) / 100,
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
    const faqLink = (
      <button
        type="button"
        onClick={() => setFaqOpen(true)}
        className="group inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 pb-0.5 text-sm md:text-base font-medium text-[#2b7ff9] border-b border-[#2b7ff9]/35 transition-colors hover:text-[#1a6fe0] hover:border-[#1a6fe0]/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2b7ff9]/40 focus-visible:ring-offset-2 rounded-sm"
      >
        <span>Common questions</span>
        <FaArrowRight
          className="h-3 w-3 shrink-0 opacity-80 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
          aria-hidden
        />
      </button>
    )

    if (isOpen) {
      return (
        <Box className="space-y-2">
          <Text className="text-lg font-semibold text-gray-900">
            Support {firstName} with any amount
          </Text>
          <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
            Your contribution goes directly toward supporting {firstName}
            &apos;s care and well-being. Every dollar makes a difference. You
            will receive updates on {firstName}&apos;s progress directly from
            our care team.
          </Text>
          <Box className="mt-5">{faqLink}</Box>
        </Box>
      )
    }

    const gapAfterThisPaymentCents =
      beneficiary.budget_goal - beneficiary.budget_raised - amountCents

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
    <>
    <FAQModal open={faqOpen} onClose={() => setFaqOpen(false)} />
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
        <DialogHeader className="bg-[#2b7ff9] text-white px-8 py-6">
          <Text fontSize="xl" fontWeight="bold">
            {beneficiary.name || "Sponsor"}
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
                {/* Status pill: only shown for non-sponsored beneficiaries; sponsored state is conveyed by the ribbon */}
                {!alreadyFulfilled && (
                  <Box className="absolute top-3 right-3 z-10 bg-[#CDE1FE] text-[#2b7ff9] rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm">
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
                      <Spinner size="lg" color="#2b7ff9" />
                    </div>
                  )}
                  <ImageCarousel
                    images={images}
                    getImageSrc={getImageSrc}
                    getThumbnailSrc={getThumbnailSrc}
                    fallbackSrc={PERSON_PLACEHOLDER_PATH}
                    alt={beneficiary.name || "Beneficiary"}
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
                    <FaCalendar className="text-[#2b7ff9]" />
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
                    <FaUser className="text-[#2b7ff9]" />
                    <Text className="text-sm">
                      {beneficiary.gender || "Gender"}
                    </Text>
                  </Flex>
                  <Flex align="center" gap={1.5}>
                    <FaLocationDot className="text-[#2b7ff9]" />
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
                    <FaCircleCheck size={28} color="#2b7ff9" />
                  </Flex>
                  <Text className="text-lg font-semibold text-gray-900">
                    This beneficiary is fully sponsored
                  </Text>
                  <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
                    {firstName} is already receiving support. You can still
                    share their story, or find another to sponsor.
                  </Text>
                  <Button
                    onClick={onClose}
                    className="w-full h-11 text-sm font-semibold bg-[#2b7ff9] text-white hover:bg-[#1a6fe0] rounded-xl transition-all shadow-md hover:shadow-lg"
                  >
                    <FaArrowDown className="mr-2" />
                    Sponsor someone like {firstName}
                  </Button>
                </>
              ) : (
                <>
                  {/*                   <Text className="text-xl font-normal text-[#2b7ff9]/75 mb-8">
                    Monthly Sponsorship Amount
                  </Text> */}
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
                      <Flex
                        className="border border-gray-300 rounded-xl bg-white focus-within:border-[#2b7ff9] transition-colors overflow-hidden"
                        align="center"
                        h="56px"
                      >
                        <Box className="bg-gray-100 px-4 h-full flex items-center text-gray-700 font-medium border-r border-gray-300">
                          $
                        </Box>
                        <Input
                          type="number"
                          step="0.01"
                          value={isOpen ? (amountCents > 0 ? amountCents / 100 : "") : fixedAmountCents / 100}
                          onChange={handleAmountChange}
                          readOnly={!isOpen}
                          disabled={!isOpen}
                          className={`px-4 h-full border-0 outline-none focus:ring-0 text-lg text-gray-700${!isOpen ? " bg-gray-100" : ""}`}
                          placeholder="Enter Amount"
                        />
                      </Flex>
                    </Box>
                    <Box
                      flex={{ base: "1", md: "0 0 calc(50% - 12px)" }}
                      width={{ base: "100%", md: "auto" }}
                    >
                      <Tooltip
                        content={disabledReason}
                        showArrow
                        disabled={!disabledReason}
                        open={tipOpen}
                        onOpenChange={(e) => setTipOpen(e.open)}
                      >
                        <Box
                          as="span"
                          display="inline-block"
                          width="100%"
                          tabIndex={0}
                          onPointerDown={() => {
                            if (disabledReason) setTipOpen(true)
                          }}
                        >
                          <Button
                            onClick={handleStripePayment}
                            loading={loading}
                            loadingText="Processing..."
                            disabled={loading || !canPay}
                            className={`w-full h-[3.25rem] text-lg font-semibold bg-[#2b7ff9] text-white hover:bg-[#1a6fe0] rounded-xl transition-all shadow-md hover:shadow-lg${
                              !canPay ? " opacity-50 cursor-not-allowed" : ""
                            }`}
                          >
                            Sponsor {firstName} 🪽
                          </Button>
                        </Box>
                      </Tooltip>
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
                              {isOpen
                                ? OPEN_SPONSORSHIP_RANGE_MESSAGE
                                : "This beneficiary is already fully sponsored"}
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
    </DialogRoot>
    </>
  )
}

export default BeneficiaryModal
