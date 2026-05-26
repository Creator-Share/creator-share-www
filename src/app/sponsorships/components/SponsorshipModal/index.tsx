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
import {
  paymentOptionsCollection,
  openSponsorshipFrequencyOptions,
  type SponsorshipFrequency,
} from "../Payments/config"
import { Button } from "@/components/ui/button"
import { HeartHandMark } from "@/components/common/HeartHandMark"
import { Tooltip } from "@/components/ui/tooltip"
import { BeneficiaryMedia } from "@/types/admin.types"
import {
  generatePublicUrl,
  getImageSrc,
  MediaRow,
} from "@/utils/supabase/media"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import SupportedRibbon from "@/components/common/SupportedRibbon"
import SupportedCheckBadge from "@/components/common/SupportedCheckBadge"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import { useSponsorship } from "../../hooks/useSponsorship"
import BeneficiaryActivity, { SHOW_MORE_CLASS } from "../SponsorshipActivity"
import { FAQModal } from "@/components/FAQModal"
import { NativeSelectField, NativeSelectRoot } from "@/components/ui/native-select"
import {
  hasOpenSponsorshipSupport,
  isOpenSponsorshipType,
  MINIMUM_OPEN_SPONSORSHIP_CENTS,
} from "@/config/beneficiaryTypes"
import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
  coerceSupportedCurrency,
  convertCurrencyMinorToUsdCents,
  convertUsdCentsToCurrency,
  formatConversionForDisplay,
  getDefaultCurrencyForLocale,
} from "@/utils/currency"
import { encodePayPalPaymentContext } from "@/utils/paypalCurrencyContext"

/** Lower-tier quick picks (left column, monthly path). */
const OPEN_SPONSORSHIP_LEFT_PRESETS_USD = [14, 33, 50] as const
/** Higher-tier quick picks (right column, one-time gift path). */
const OPEN_SPONSORSHIP_RIGHT_PRESETS_USD = [50, 100, 1111] as const

/** Default open-amount preset selected when the modal first opens. */
const OPEN_SPONSORSHIP_DEFAULT_USD = 33
const OPEN_SPONSORSHIP_DEFAULT_CENTS = OPEN_SPONSORSHIP_DEFAULT_USD * 100
const SPONSORSHIP_CURRENCY_STORAGE_KEY = "creator-share:sponsorship-currency"

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
  /** Activities pre-fetched by SponsorshipsContainer, avoids a double fetch. */
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
  const hasOpenSupport = isOpen && hasOpenSponsorshipSupport(beneficiary)

  // For fixed types the budget_goal IS the sponsorship amount (set at create time).
  // For open types there is no goal. Sponsors choose their own amount.
  const fixedAmountCents = !isOpen ? (beneficiary.budget_goal ?? 0) : 0
  const birthDateIsEstimate = Boolean(
    (beneficiary.metadata as { birth_date_is_estimate?: boolean } | undefined)
      ?.birth_date_is_estimate,
  )

  const [monthlyAmountCents, setMonthlyAmountCents] = useState<number>(
    isOpen ? OPEN_SPONSORSHIP_DEFAULT_CENTS : fixedAmountCents,
  )
  const [oneTimeAmountCents, setOneTimeAmountCents] = useState<number>(
    isOpen ? OPEN_SPONSORSHIP_DEFAULT_CENTS : fixedAmountCents,
  )
  const [tipOpen, setTipOpen] = useState(false)
  const [selectedOption, setSelectedOption] = useState<string>(
    paymentOptionsCollection.items[0].value,
  )
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingFrequency, setLoadingFrequency] =
    useState<SponsorshipFrequency | null>(null)
  const [monthlyCustomMode, setMonthlyCustomMode] = useState<boolean>(false)
  const [oneTimeCustomMode, setOneTimeCustomMode] = useState<boolean>(false)
  const [monthlyCustomCents, setMonthlyCustomCents] = useState<number>(0)
  const [oneTimeCustomCents, setOneTimeCustomCents] = useState<number>(0)
  const [selectedCurrency, setSelectedCurrency] =
    useState<SupportedCurrency>("USD")
  const [activeColumn, setActiveColumn] = useState<
    "monthly" | "one_time" | null
  >(isOpen ? "monthly" : null)
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [imageLoading, setImageLoading] = useState<boolean>(false)
  const [videoUrl, setVideoUrl] = useState<string>(
    beneficiary.video_url?.trim() || "",
  )
  const [bioExpanded, setBioExpanded] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)

  const hasActivities = activities.length > 0

  const getConvertedAmount = useCallback(
    (usdCents: number) => convertUsdCentsToCurrency(usdCents, selectedCurrency),
    [selectedCurrency],
  )
  const formatUsdCentsForSponsor = useCallback(
    (usdCents: number) => formatConversionForDisplay(getConvertedAmount(usdCents)),
    [getConvertedAmount],
  )
  const getConvertedMajorAmount = useCallback(
    (usdCents: number) => {
      const conversion = getConvertedAmount(usdCents)
      return (
        conversion.chargedAmountMinor /
        10 ** conversion.chargedCurrencyMinorUnit
      )
    },
    [getConvertedAmount],
  )
  const openSponsorshipRangeMessage = `Minimum amount is ${formatUsdCentsForSponsor(
    MINIMUM_OPEN_SPONSORSHIP_CENTS,
  )}`

  // About card: collapsed by default when there are updates (room for Latest Updates);
  // expanded by default when there are none (full bio visible, button reads "Show less").
  // Wait until activities have loaded so an empty in-flight list is not treated as "no updates".
  useEffect(() => {
    if (!open || !beneficiary.id || activitiesLoading) return
    setBioExpanded(!hasActivities)
  }, [open, beneficiary.id, hasActivities, activitiesLoading])

  // Open types are never "fully sponsored". They accept unlimited sponsors.
  const alreadyFulfilled =
    !isOpen &&
    (beneficiary.status === "Budget Fulfilled" ||
      (beneficiary.budget_goal > 0 &&
        beneficiary.budget_goal <= (beneficiary.budget_raised || 0)))

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
    if (!open) return
    const stored = window.localStorage.getItem(SPONSORSHIP_CURRENCY_STORAGE_KEY)
    if (stored) {
      setSelectedCurrency(coerceSupportedCurrency(stored))
      return
    }
    let cancelled = false
    fetch("/api/payments/currency")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { currency?: string } | null) => {
        if (cancelled) return
        const detected =
          data?.currency || getDefaultCurrencyForLocale(navigator.language)
        setSelectedCurrency(coerceSupportedCurrency(detected))
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedCurrency(getDefaultCurrencyForLocale(navigator.language))
        }
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setToastCount(0)
      setLastToastTime(0)
      setMonthlyAmountCents(
        isOpen ? OPEN_SPONSORSHIP_DEFAULT_CENTS : fixedAmountCents,
      )
      setOneTimeAmountCents(
        isOpen ? OPEN_SPONSORSHIP_DEFAULT_CENTS : fixedAmountCents,
      )
      setSelectedOption(paymentOptionsCollection.items[0].value)
      setLoading(false)
      setLoadingFrequency(null)
      setMonthlyCustomMode(false)
      setOneTimeCustomMode(false)
      setMonthlyCustomCents(0)
      setOneTimeCustomCents(0)
      setActiveColumn(isOpen ? "monthly" : null)
      setBioExpanded(false)
      setFaqOpen(false)
      setVideoUrl(beneficiary.video_url?.trim() || "")
    }
  }, [open, isOpen, fixedAmountCents, beneficiary.video_url])

  const handleCurrencyChange = (value: string) => {
    const currency = coerceSupportedCurrency(value)
    setSelectedCurrency(currency)
    window.localStorage.setItem(SPONSORSHIP_CURRENCY_STORAGE_KEY, currency)
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

  const canPayMonthly = isOpen
    ? monthlyAmountCents >= MINIMUM_OPEN_SPONSORSHIP_CENTS
    : !alreadyFulfilled
  const canPayOneTime = isOpen
    ? oneTimeAmountCents >= MINIMUM_OPEN_SPONSORSHIP_CENTS
    : !alreadyFulfilled

  const monthlyDisabledReason =
    isOpen && monthlyAmountCents < MINIMUM_OPEN_SPONSORSHIP_CENTS
      ? openSponsorshipRangeMessage
      : null
  const oneTimeDisabledReason =
    isOpen && oneTimeAmountCents < MINIMUM_OPEN_SPONSORSHIP_CENTS
      ? openSponsorshipRangeMessage
      : null
  const oneTimeButtonDisabled =
    loading || !canPayOneTime || activeColumn !== "one_time"

  const handleStripePayment = async (
    paymentType: SponsorshipFrequency = "subscription",
  ) => {
    const amountCents =
      paymentType === "subscription" ? monthlyAmountCents : oneTimeAmountCents
    const canPay =
      paymentType === "subscription" ? canPayMonthly : canPayOneTime
    if (!canPay) {
      toaster.create({
        title: "Invalid Amount",
        description: isOpen
          ? openSponsorshipRangeMessage
          : "This beneficiary is already fully sponsored.",
      })
      return
    }

    setSelectedOption(paymentType)
    setLoading(true)
    setLoadingFrequency(paymentType)
    try {
      const payload = {
        beneficiaryId: beneficiary.id,
        beneficiaryName: beneficiary.name,
        amount: isOpen ? amountCents : beneficiary.budget_goal,
        paymentType,
        location: beneficiary.country,
        userId: user?.id,
        isEmbedded: window.self !== window.top,
        email: user?.email || undefined,
        type: "sponsorship",
        currency: selectedCurrency,
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

      const { clientSecret, url, publishableKey, region } = data
      window.dispatchEvent(
        new CustomEvent("payment-success", {
          detail: { beneficiaryId: beneficiary.id },
        }),
      )

      if (window.self !== window.top) {
        if (clientSecret) {
          const params = new URLSearchParams({
            client_secret: clientSecret,
            beneficiary_id: beneficiary.id ?? "",
          })
          if (publishableKey) params.set("publishable_key", publishableKey)
          if (region) params.set("region", region)
          params.set("currency", selectedCurrency)
          window.location.href = `/sponsorships/checkout?${params.toString()}`
        } else if (url) window.location.href = url
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
      setLoadingFrequency(null)
    }
  }

  const handleCreateOrder = async (
    _data: Record<string, unknown>,
    actions: {
      order: {
        create: (options: {
          purchase_units: Array<{
            description: string
            custom_id?: string
            amount: { value: string; currency_code: string }
          }>
        }) => Promise<string>
      }
    },
  ) => {
    const paypalAmountCents =
      selectedOption === "subscription"
        ? monthlyAmountCents
        : oneTimeAmountCents
    const canPayPayPal =
      selectedOption === "subscription" ? canPayMonthly : canPayOneTime
    if (!canPayPayPal) {
      toaster.create({
        title: "Invalid Amount",
        description: isOpen
          ? openSponsorshipRangeMessage
          : "This beneficiary is already fully sponsored.",
      })
      throw new Error("Invalid amount")
    }
    const conversion = getConvertedAmount(
      isOpen ? paypalAmountCents : fixedAmountCents,
    )
    const paymentAmount =
      conversion.chargedAmountMinor / 10 ** conversion.chargedCurrencyMinorUnit
    const frequencyLabel =
      selectedOption === "subscription"
        ? "Monthly"
        : selectedOption === "one_time"
          ? "One-time"
          : "Yearly"
    return actions.order.create({
      purchase_units: [
        {
          description: `${frequencyLabel} Sponsorship for ${beneficiary.name}`,
          custom_id: encodePayPalPaymentContext(beneficiary.id, conversion),
          amount: {
            value: paymentAmount.toFixed(2),
            currency_code: conversion.chargedCurrency,
          },
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
            base_amount_usd_cents: isOpen
              ? monthlyAmountCents
              : fixedAmountCents,
            interval_unit: "MONTH",
            interval_count: 1,
            currency_code: selectedCurrency,
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
            base_amount_usd_cents: isOpen
              ? monthlyAmountCents
              : fixedAmountCents,
            currency_code: selectedCurrency,
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
            base_amount_usd_cents: isOpen
              ? oneTimeAmountCents
              : fixedAmountCents,
            currency_code: selectedCurrency,
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

  /**
   * Vertical segmented radio, presets plus custom in a single bordered container.
   * with thin dividers between rows, no gaps.
   *
   * isActive is gated on activeColumn === column so that picking anything in one
   * column automatically deselects the other without wiping its persisted values.
   * The custom input value is stored separately (customCents/setCustomCents) so
   * it survives switching to a preset and back.
   */
  const renderAmountPicker = ({
    presets,
    ariaLabel,
    column,
    amountCents,
    setAmountCents,
    customMode,
    setCustomMode,
    customCents,
    setCustomCents,
    clearOtherColumn,
    focusOnOpen = false,
  }: {
    presets: readonly number[]
    ariaLabel: string
    column: "monthly" | "one_time"
    amountCents: number
    setAmountCents: React.Dispatch<React.SetStateAction<number>>
    customMode: boolean
    setCustomMode: React.Dispatch<React.SetStateAction<boolean>>
    customCents: number
    setCustomCents: React.Dispatch<React.SetStateAction<number>>
    clearOtherColumn: () => void
    focusOnOpen?: boolean
  }) => {
    const isColumnActive = activeColumn === column
    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isOpen) return
      const inputValue = e.target.value
      const cents =
        inputValue === ""
          ? 0
          : Number.isFinite(parseFloat(inputValue))
            ? convertCurrencyMinorToUsdCents(
                Math.round(parseFloat(inputValue) * 100),
                selectedCurrency,
              )
            : 0
      setCustomCents(cents)
      setAmountCents(cents)
    }
    const allItems = [...presets, "custom"] as const
    return (
      <Box
        role="radiogroup"
        aria-label={ariaLabel}
        borderWidth="1px"
        borderColor="gray.300"
        borderRadius="xl"
        overflow="hidden"
        bg="white"
      >
        {allItems.map((item, idx) => {
          const isCustom = item === "custom"
          const isActive =
            isColumnActive &&
            (isCustom
              ? customMode
              : !customMode && amountCents === (item as number) * 100)
          const isLast = idx === allItems.length - 1

          return (
            <Box
              key={isCustom ? "custom" : (item as number)}
              borderBottomWidth={isLast ? 0 : "1px"}
              borderColor="gray.200"
            >
              {isCustom ? (
                <Flex
                  h="44px"
                  align="center"
                  overflow="hidden"
                  bg={isActive ? "#2b7ff9" : "white"}
                  cursor={isActive ? "text" : "pointer"}
                  role="radio"
                  aria-checked={isActive}
                  tabIndex={isActive ? -1 : 0}
                  onClick={() => {
                    if (!isActive) {
                      clearOtherColumn()
                      setCustomMode(true)
                      setActiveColumn(column)
                      setAmountCents(customCents)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!isActive && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault()
                      clearOtherColumn()
                      setCustomMode(true)
                      setActiveColumn(column)
                      setAmountCents(customCents)
                    }
                  }}
                  _hover={!isActive ? { bg: "gray.50" } : undefined}
                  transition="background 0.1s"
                >
                  <Box
                    className={`px-4 h-full flex items-center font-medium border-r text-sm select-none ${
                      isActive
                        ? "text-white border-white/30"
                        : "text-gray-400 border-gray-200"
                    }`}
                  >
	                    {selectedCurrency}
                  </Box>
                  {isActive ? (
                    <Input
	                      type="number"
	                      step="0.01"
	                      autoFocus={focusOnOpen || isActive}
	                      value={
	                        customCents > 0
	                          ? getConvertedMajorAmount(customCents)
	                          : ""
	                      }
                      onChange={handleAmountChange}
                      className="px-3 h-full border-0 outline-none focus:ring-0 text-sm text-white placeholder-white/60 flex-1 bg-transparent"
                      placeholder="Enter amount"
                    />
                  ) : (
                    <Text
                      flex="1"
                      pl={3}
                      color="gray.400"
                      fontWeight="medium"
                      fontSize="sm"
                    >
	                      {customCents > 0
	                        ? formatUsdCentsForSponsor(customCents)
	                        : "Custom"}
                    </Text>
                  )}
                </Flex>
              ) : (
                <Box
                  as="button"
                  role="radio"
                  aria-checked={isActive}
                  width="100%"
                  h="44px"
                  px={4}
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  bg={isActive ? "#2b7ff9" : "white"}
                  color={isActive ? "white" : "gray.700"}
                  fontWeight={isActive ? "semibold" : "medium"}
                  fontSize="sm"
                  cursor="pointer"
                  transition="background 0.1s"
                  _hover={{ bg: isActive ? "#1a6fe0" : "gray.50" }}
                  onClick={() => {
                    clearOtherColumn()
                    setCustomMode(false)
                    setAmountCents((item as number) * 100)
                    setActiveColumn(column)
                  }}
                >
	                  <Text as="span">
	                    {formatUsdCentsForSponsor((item as number) * 100)}
	                  </Text>
                  {isActive && (
                    <HeartHandMark width={16} height={14} color="white" />
                  )}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
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
      const supportCopy = hasOpenSupport
        ? {
            heading: `${firstName} is already receiving support`,
            body: (
              <>
                {firstName} is already receiving support, and additional gifts
                help keep care steady for {firstName} and all children
                receiving care. Your contribution strengthens daily meals,
                health care, schooling, and the care team supporting them. You
                will receive updates from our team as that support continues.
              </>
            ),
          }
        : {
            heading: `Support ${firstName} with any amount`,
            body: (
              <>
                Your contribution helps support {firstName} and all children
                receiving care. Every gift strengthens daily care, meals, health
                care, schooling, and the care team supporting them. You will
                receive updates on {firstName}&apos;s progress directly from our
                team.
              </>
            ),
          }

      return (
        <Box className="space-y-2 mt">
          <Text className="text-lg font-semibold text-gray-900">
            {supportCopy.heading}
          </Text>
          <Text className="text-gray-700 leading-relaxed text-sm md:text-base">
            {supportCopy.body}
          </Text>
          <Box className="mt-5">{faqLink}</Box>
        </Box>
      )
    }

    const activeAmountCents =
      activeColumn === "one_time" ? oneTimeAmountCents : monthlyAmountCents
    const gapAfterThisPaymentCents =
      beneficiary.budget_goal - beneficiary.budget_raised - activeAmountCents

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
              <Box
                flex={{ base: "1", md: "0 0 40%" }}
                className="flex flex-col"
              >
                <Box className="relative">
                  {/* Status pill: hidden for open sponsorships (indistinguishable across statuses) and for fulfilled fixed types (ribbon conveys sponsored state). */}
                  {!alreadyFulfilled && !isOpen && (
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
                      fallbackSrc={PERSON_PLACEHOLDER_PATH}
                      alt={beneficiary.name || "Beneficiary"}
                      className="rounded-2xl aspect-[4/5] object-cover"
                      showArrowsOnHover={true}
                    />
                    {hasOpenSupport && <SupportedCheckBadge size="lg" />}
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
                      <video className="w-full" src={videoUrl} controls />
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

                {/* Latest Updates, styled identically to About card */}
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

            {/* Sponsorship CTA, same place and card for fully sponsored plus active checkout */}
            <Box className="mt-8 mb-8 md:mt-16 md:mb-16 w-full flex justify-center">
              <Box
                className="w-full min-w-0 md:w-5/6 rounded-xl px-8 py-6 md:px-16 md:py-12 space-y-2 text-center"
                style={{
                  background:
                    "linear-gradient(135deg, #EEF6FF 0%, #F3EEFF 100%)",
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
                    {/* Amount input, combined chips plus custom field for open types, inline disabled input for fixed types. */}
                    <Box
                      textAlign="left"
                      mb={{ base: 8, md: 10 }}
                      maxW={{ base: "100%", md: "360px" }}
                    >
                      <Text
                        fontWeight="semibold"
                        fontSize="sm"
                        color="gray.600"
                        mb={2}
                      >
                        Payment Currency
                      </Text>
                      <NativeSelectRoot
                        size="sm"
                        width="100%"
                        bg="white"
                        borderRadius="xl"
                      >
                        <NativeSelectField
                          aria-label="Payment currency"
                          value={selectedCurrency}
                          onChange={(e) =>
                            handleCurrencyChange(e.target.value)
                          }
                          h="56px"
                          borderRadius="xl"
                          borderColor="gray.300"
                          bg="white"
                          px={4}
                          fontSize="md"
                          color="gray.700"
                          boxShadow="sm"
                          transition="border-color 0.15s ease, box-shadow 0.15s ease"
                          _focusVisible={{
                            borderColor: "#2b7ff9",
                            boxShadow: "0 0 0 1px #2b7ff9",
                            outline: "none",
                          }}
                          className="rounded-xl border border-gray-300 bg-white text-base text-gray-700"
                        >
                          {SUPPORTED_CURRENCIES.map((currency) => (
                            <option key={currency} value={currency}>
                              {currency}
                            </option>
                          ))}
                        </NativeSelectField>
                      </NativeSelectRoot>
                    </Box>
                    {isOpen ? (
                      <Box className="text-left w-full">
                        <Flex
                          direction={{ base: "column", md: "row" }}
                          gap={{ base: 8, md: 16 }}
                          alignItems="stretch"
                          width="100%"
                        >
                          {/* Left column, monthly, wider */}
                          <Box flex={3} minW={0}>
                            <Text
                              fontWeight="semibold"
                              fontSize="sm"
                              color="gray.600"
                              mb={2}
                            >
                              Monthly Sponsorship
                            </Text>
                            {renderAmountPicker({
                              presets: OPEN_SPONSORSHIP_LEFT_PRESETS_USD,
                              ariaLabel: "Monthly suggested amounts",
                              column: "monthly",
                              amountCents: monthlyAmountCents,
                              setAmountCents: setMonthlyAmountCents,
                              customMode: monthlyCustomMode,
                              setCustomMode: setMonthlyCustomMode,
                              customCents: monthlyCustomCents,
                              setCustomCents: setMonthlyCustomCents,
                              clearOtherColumn: () =>
                                setOneTimeCustomMode(false),
                              focusOnOpen: true,
                            })}
                            <Tooltip
                              content={monthlyDisabledReason}
                              showArrow
                              disabled={!monthlyDisabledReason}
                              open={tipOpen}
                              onOpenChange={(e) => setTipOpen(e.open)}
                            >
                              <Box
                                as="span"
                                display="block"
                                width="100%"
                                mt={3}
                                tabIndex={0}
                                onPointerDown={() => {
                                  if (monthlyDisabledReason) setTipOpen(true)
                                }}
                              >
                                <Button
                                  onClick={() =>
                                    handleStripePayment("subscription")
                                  }
                                  loading={loadingFrequency === "subscription"}
                                  loadingText="Processing..."
                                  disabled={
                                    loading ||
                                    !canPayMonthly ||
                                    activeColumn !== "monthly"
                                  }
                                  width="100%"
                                  opacity={
                                    activeColumn !== "monthly" || !canPayMonthly
                                      ? 0.5
                                      : 1
                                  }
                                  h="auto"
                                  minH="52px"
                                  py={3}
                                  px={3}
                                  bg="#2b7ff9"
                                  color="white"
                                  fontWeight="semibold"
                                  borderRadius="xl"
                                  boxShadow="md"
                                  _hover={{ bg: "#1a6fe0", boxShadow: "lg" }}
                                  _disabled={{ bg: "#2b7ff9" }}
                                >
                                  <Flex
                                    direction="column"
                                    align="center"
                                    gap={0.5}
                                    textAlign="center"
                                  >
                                    <Text
                                      fontWeight="semibold"
                                      fontSize="sm"
                                      lineHeight="short"
                                    >
                                      Sponsor {firstName} 🪽
                                    </Text>
                                    <Text
                                      fontWeight="medium"
                                      fontSize="xs"
                                      opacity={0.9}
                                    >
                                      {canPayMonthly
                                        ? `${formatUsdCentsForSponsor(monthlyAmountCents)}/month`
                                        : "Monthly Sponsorship"}
                                    </Text>
                                  </Flex>
                                </Button>
                              </Box>
                            </Tooltip>
                          </Box>

                          {/* Right column, one-time gift, narrower */}
                          <Box flex={2} minW={0}>
                            <Text
                              fontWeight="semibold"
                              fontSize="sm"
                              color="gray.600"
                              mb={2}
                            >
                              One-Time Gift
                            </Text>
                            {renderAmountPicker({
                              presets: OPEN_SPONSORSHIP_RIGHT_PRESETS_USD,
                              ariaLabel: "Gift suggested amounts",
                              column: "one_time",
                              amountCents: oneTimeAmountCents,
                              setAmountCents: setOneTimeAmountCents,
                              customMode: oneTimeCustomMode,
                              setCustomMode: setOneTimeCustomMode,
                              customCents: oneTimeCustomCents,
                              setCustomCents: setOneTimeCustomCents,
                              clearOtherColumn: () =>
                                setMonthlyCustomMode(false),
                            })}
                            <Tooltip
                              content={oneTimeDisabledReason}
                              showArrow
                              disabled={!oneTimeDisabledReason}
                              open={tipOpen}
                              onOpenChange={(e) => setTipOpen(e.open)}
                            >
                              <Box
                                as="span"
                                display="block"
                                width="100%"
                                mt={3}
                                tabIndex={0}
                                onPointerDown={() => {
                                  if (oneTimeDisabledReason) setTipOpen(true)
                                }}
                              >
                                <Button
                                  onClick={() =>
                                    handleStripePayment("one_time")
                                  }
                                  loading={loadingFrequency === "one_time"}
                                  loadingText="Processing..."
                                  disabled={
                                    oneTimeButtonDisabled
                                  }
                                  width="100%"
                                  opacity={
                                    oneTimeButtonDisabled
                                      ? 0.5
                                      : 1
                                  }
                                  h="44px"
                                  px={4}
                                  bg="#EEF6FF"
                                  color="#2b7ff9"
                                  borderWidth="1px"
                                  borderColor="#CDE1FE"
                                  fontWeight="medium"
                                  fontSize="sm"
                                  borderRadius="xl"
                                  boxShadow="sm"
                                  _hover={{
                                    bg: "#E3EEFE",
                                    borderColor: "#A8CDEF",
                                  }}
                                  _disabled={{ bg: "#EEF6FF" }}
                                >
                                  {!oneTimeButtonDisabled
                                    ? `Gift ${formatUsdCentsForSponsor(oneTimeAmountCents)}`
                                    : "One-Time Gift"}
                                </Button>
                              </Box>
                            </Tooltip>
                          </Box>
                        </Flex>
                      </Box>
                    ) : (
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
                          <Tooltip
                            content={`For ${firstName}, this is what every month looks like: classroom days, full meals, real healthcare, and an outreach team who knows them by name.`}
                            showArrow
                          >
                            <Flex
                              className="border border-gray-300 rounded-xl bg-white focus-within:border-[#2b7ff9] transition-colors overflow-hidden"
                              align="center"
                              h="56px"
                            >
                              <Box className="bg-gray-100 px-4 h-full flex items-center text-gray-700 font-medium border-r border-gray-300">
                                {selectedCurrency}
                              </Box>
                              <Input
                                type="number"
                                step="0.01"
                                value={getConvertedMajorAmount(fixedAmountCents)}
                                readOnly
                                disabled
                                className="px-4 h-full border-0 outline-none focus:ring-0 text-lg text-gray-700 bg-gray-100 cursor-help"
                                placeholder="Enter Amount"
                              />
                            </Flex>
                          </Tooltip>
                        </Box>
                        <Box
                          flex={{ base: "1", md: "0 0 calc(50% - 12px)" }}
                          width={{ base: "100%", md: "auto" }}
                        >
                          <Button
                            onClick={() => handleStripePayment("subscription")}
                            loading={loading}
                            loadingText="Processing..."
                            disabled={loading || alreadyFulfilled}
                            className={`w-full h-[3.25rem] text-lg font-semibold bg-[#2b7ff9] text-white hover:bg-[#1a6fe0] rounded-xl transition-all shadow-md hover:shadow-lg${
                              alreadyFulfilled
                                ? " opacity-50 cursor-not-allowed"
                                : ""
                            }`}
                          >
                            Sponsor {firstName} 🪽
                          </Button>
                        </Box>
                      </Flex>
                    )}

                    {isPayPalEnabled &&
                      PayPalScriptProvider &&
                      PayPalButtons && (
                        <Box className="pt-1">
                          {isOpen && (
                            <Flex
                              align="center"
                              justify="center"
                              gap={2}
                              wrap="wrap"
                              mb={2}
                              role="radiogroup"
                              aria-label="PayPal payment frequency"
                            >
                              <Text className="text-xs text-gray-500">
                                PayPal frequency:
                              </Text>
                              {openSponsorshipFrequencyOptions.map((option) => {
                                const isActive = selectedOption === option.value
                                return (
                                  <Button
                                    key={option.value}
                                    type="button"
                                    size="xs"
                                    role="radio"
                                    aria-checked={isActive}
                                    onClick={() =>
                                      setSelectedOption(option.value)
                                    }
                                    borderRadius="full"
                                    px={3}
                                    h="28px"
                                    fontSize="xs"
                                    fontWeight={
                                      isActive ? "semibold" : "medium"
                                    }
                                    bg={isActive ? "#2b7ff9" : "gray.100"}
                                    color={isActive ? "white" : "gray.600"}
                                    borderWidth="1px"
                                    borderColor={
                                      isActive ? "#2b7ff9" : "gray.200"
                                    }
                                    _hover={{
                                      bg: isActive ? "#1a6fe0" : "gray.200",
                                    }}
                                    transition="all 0.15s"
                                  >
                                    {option.label}
                                  </Button>
                                )
                              })}
                            </Flex>
                          )}
                          <PayPalScriptProvider
                            key={selectedCurrency}
                            options={{
                              "client-id": process.env
                                .NEXT_PUBLIC_PAYPAL_CLIENT_ID as string,
                              currency: selectedCurrency,
                              intent: "capture",
                            }}
                          >
                            {(
                              isOpen
                                ? canPayMonthly || canPayOneTime
                                : !alreadyFulfilled
                            ) ? (
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
                                    ? openSponsorshipRangeMessage
                                    : "This beneficiary is already fully sponsored"}
                                </Text>
                              </Box>
                            )}
                          </PayPalScriptProvider>
                        </Box>
                      )}

                    {/* Context copy inside the card */}
                    <Box className="pt-8 text-left">
                      {renderSponsorshipDisclaimer()}
                    </Box>
                  </>
                )}
              </Box>
            </Box>

            {/* Footer, actions only */}
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
