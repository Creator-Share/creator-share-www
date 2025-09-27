import React, { useEffect, useState } from "react"
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
} from "react-icons/fa6"
import { Beneficiaries } from "@/types/index"
import {
  fetchActivitiesByBeneficiaryId,
  fetchSponsorshipDetailsByBeneficiaryId,
} from "@/actions"
import BeneficiaryActivity from "../SponsorshipActivity"
import BeneficiarySubscribeBox from "@/components/BeneficiarySubscribeBox"
import { toaster } from "@/components/ui/toaster"
import {
  Box,
  Text,
  Image,
  Spinner,
  Flex,
  Input,
  InputAddon,
} from "@chakra-ui/react"
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js"
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { useAuthStore } from "@/store/authStore"
import { paymentOptionsCollection } from "../Payments/config"
import { Button } from "@/components/ui/button"
import { BeneficiaryMedia } from "@/types/admin.types"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { LuChevronLeft, LuChevronRight } from "react-icons/lu"
import { IconButton } from "@chakra-ui/react"

interface BeneficiaryActivityModalProps {
  open: boolean
  onClose: () => void
  beneficiary: Beneficiaries
}

const BeneficiaryActivityModal: React.FC<BeneficiaryActivityModalProps> = ({
  open,
  onClose,
  beneficiary,
}) => {
  const [toastCount, setToastCount] = useState(0)
  const [lastToastTime, setLastToastTime] = useState(0)
  const user = useAuthStore((state) => state.user)
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
    publicHardcodedDollars ?? remainingAmount,
  )
  const [selectedOption, setSelectedOption] = useState<string>(
    paymentOptionsCollection.items[0].value,
  )
  const [loading, setLoading] = useState<boolean>(false)
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [imageLoading, setImageLoading] = useState<boolean>(false)

  const [, setPrimaryImageUrl] = useState<string | null>(null)

  const loadImages = async (beneficiaryId: string) => {
    setImageLoading(true)
    try {
      const res = await fetch(`/api/admin/beneficiaries/images/${beneficiaryId}`)
      if (res.ok) {
        const data: BeneficiaryMedia[] = await res.json()
        const sortedImages = data
          ?.filter((m: BeneficiaryMedia) => m.type === "IMAGE" || m.type === "images")
          ?.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)) || []
        
        setImages(sortedImages)
        
        if (sortedImages.length > 0) {
          try {
            setPrimaryImageUrl(generatePublicUrl(sortedImages[0] as unknown as MediaRow))
          } catch {
            setPrimaryImageUrl(sortedImages[0]?.image_url || null)
          }
        } else {
          setPrimaryImageUrl(null)
        }
      }
    } catch (error) {
      console.error("Failed to load images:", error)
      setImages([])
      setPrimaryImageUrl(null)
    } finally {
      setImageLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !beneficiary.id) return
    
    fetchSponsorshipDetailsByBeneficiaryId(beneficiary.id)
    fetchActivitiesByBeneficiaryId(beneficiary.id)
    loadImages(beneficiary.id)
  }, [open, beneficiary.id])

  const getValidImageUrl = (url: string | null | undefined): string => {
    const fallback = "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="
    
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return fallback
    }
    
    return url.trim()
  }

  const getImageSrc = () => {
    if (images.length > 0) {
      const currentImage = images[currentImageIndex]
      if (currentImage) {
        let imageUrl = ""
        
        if (currentImage.id) {
          try {
            imageUrl = generatePublicUrl(currentImage as unknown as MediaRow)
          } catch {
            imageUrl = currentImage.image_url || ""
          }
        } else {
          imageUrl = currentImage.image_url || ""
        }
        
        return getValidImageUrl(imageUrl)
      }
    }
    
    return getValidImageUrl(beneficiary.image_url)
  }

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

  const handleSelectChange = (value: string) => {
    setSelectedOption(value)
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
      const payload = {
        beneficiaryId: beneficiary.id,
        beneficiaryName: beneficiary.name,
        beneficiaryImage:
          beneficiary.image_url ||
          "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=",
        // If public hardcoded amount is set, send that exact cents value to server.
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
        toaster.create({
          title: "Payment Error",
          description: data?.error || "Something went wrong. Please try again.",
        })
        return
      }

      const { clientSecret, url } = data
      if (window.self !== window.top) {
        if (clientSecret)
          window.location.href = `/sponsorships/checkout?client_secret=${clientSecret}`
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    // When remaining amount is less than minimum, use the exact remaining amount
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
      if (selectedOption === "subscription" || selectedOption === "payment") {
        const planRes = await fetch("/api/paypal/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            beneficiary_id: beneficiary.id,
            name: `${
              selectedOption === "subscription" ? "Monthly" : "Yearly"
            } Sponsorship for ${beneficiary.name}`,
            description: `Recurring sponsorship for ${beneficiary.name}`,
            amount: remainingAmount < minimumAmount ? remainingAmount : amount,
            interval_unit: selectedOption === "subscription" ? "MONTH" : "YEAR",
            interval_count: 1,
            currency_code: "USD",
          }),
        })
        const planData = await planRes.json()
        if (!planRes.ok)
          throw new Error(
            planData.error?.message || "Failed to create/get PayPal plan",
          )
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
        if (!subRes.ok)
          throw new Error(
            subData.error?.message || "Failed to create PayPal subscription",
          )

        type PayPalLink = { rel?: string; href?: string }
        const approvalUrl = subData.subscription?.links?.find(
          (l: PayPalLink) => l.rel === "approve",
        )?.href
        if (approvalUrl) {
          window.location.href = approvalUrl
          return
        }
        throw new Error("No approval link returned from PayPal")
      }

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
        description:
          err.message || "Failed to process payment. Please try again.",
      })
      window.location.href = "/payments/failed"
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

  const nextImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentImageIndex((prev) => (prev + 1) % images.length)
  }

  const prevImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
  }

  const goToImage = (index: number) => {
    setCurrentImageIndex(index)
  }

  // Reset to first image when images change
  useEffect(() => {
    setCurrentImageIndex(0)
  }, [images])

  return (
    <DialogRoot
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose()
      }}
    >
      <DialogContent className="max-w-[400px] md:min-w-[1000px] md:max-w-[1000px] w-full relative rounded-2xl">
        <DialogHeader className="flex justify-between items-center p-6 pb-2">
          <Text className="text-2xl font-bold text-gray-800">
            Child Details
          </Text>
          <DialogCloseTrigger>
            <Box className="text-lg font-semibold cursor-pointer border-2 border-[#000000] rounded-full px-2">
              ×
            </Box>
          </DialogCloseTrigger>
        </DialogHeader>
        <DialogBody className="p-0">
          <Box className="px-8 md:grid md:grid-cols-12 md:gap-4 md:my-2.5">
            <Box className="border border-[#0654C6] rounded-[10px] flex flex-col text-center gap-[11px] relative md:max-h-[523px] md:col-span-5">
              {/* Status Overlay */}
              <Box className="absolute top-3 right-3 z-10 bg-[#CDE1FE] text-[#0654C6] rounded-[10px] p-[10px] flex items-center gap-2">
                <FaCircleInfo />
                <Text className="text-xs font-medium">
                  {getStatusText(beneficiary.status)}
                </Text>
              </Box>
              {/* Update the image section to show a simple spinner */}
              <Box position="relative" className="group">
                {imageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-80 z-10 rounded-[15px]">
                    <Spinner size="lg" color="#1C3C8C" />
                  </div>
                )}
                <Image
                  src={getImageSrc()}
                  alt={beneficiary.name || "Child"}
                  width={500}
                  height={405}
                  className="rounded-[15px] p-2"
                  style={{ objectFit: "cover", objectPosition: "center 20%" }}
                />
                
                {/* Navigation arrows and dots */}
                {images.length > 1 && (
                  <>
                    <IconButton
                      aria-label="Previous image"
                      size="sm"
                      position="absolute"
                      left="2"
                      top="50%"
                      transform="translateY(-50%)"
                      bg="rgba(0, 0, 0, 0.5)"
                      color="white"
                      _hover={{ bg: "rgba(0, 0, 0, 0.7)" }}
                      onClick={prevImage}
                      zIndex={20}
                      opacity={0}
                      _groupHover={{ opacity: 1 }}
                      transition="opacity 0.2s"
                    >
                      <LuChevronLeft />
                    </IconButton>
                    
                    <IconButton
                      aria-label="Next image"
                      size="sm"
                      position="absolute"
                      right="2"
                      top="50%"
                      transform="translateY(-50%)"
                      bg="rgba(0, 0, 0, 0.5)"
                      color="white"
                      _hover={{ bg: "rgba(0, 0, 0, 0.7)" }}
                      onClick={nextImage}
                      zIndex={20}
                      opacity={0}
                      _groupHover={{ opacity: 1 }}
                      transition="opacity 0.2s"
                    >
                      <LuChevronRight />
                    </IconButton>
                  </>
                )}

                {/* Image Dots Indicator */}
                {images.length > 1 && (
                  <Flex
                    position="absolute"
                    bottom="2"
                    left="50%"
                    transform="translateX(-50%)"
                    gap={1}
                    zIndex={20}
                  >
                    {images.map((_, index) => (
                      <Box
                        key={index}
                        w="6px"
                        h="6px"
                        borderRadius="50%"
                        bg={index === currentImageIndex ? "white" : "rgba(255, 255, 255, 0.5)"}
                        cursor="pointer"
                        onClick={(e) => {
                          e.stopPropagation()
                          goToImage(index)
                        }}
                        transition="background-color 0.2s"
                        _hover={{ bg: "white" }}
                      />
                    ))}
                  </Flex>
                )}
              </Box>
              <Box className="text-center mb-4 md:mb-0">
                <Text className="text-xl font-bold text-gray-800 mb-2">
                  {beneficiary.name || "Full Name"}
                </Text>
                <Flex align="center" gap={2} mb={1} justify="center">
                  <FaCalendar className="text-[#0654C6]" />
                  <Text fontSize="md">
                    {beneficiary.birth_date
                      ? new Date(beneficiary.birth_date).toLocaleDateString(
                          "en-GB",
                          { day: "numeric", month: "long", year: "numeric" },
                        )
                      : "DOB"}
                  </Text>
                  <FaUser className="text-[#0654C6]" />
                  <Text fontSize="md">{beneficiary.gender || "Gender"}</Text>
                  <FaLocationDot className="text-[#0654C6]" />
                  <Text fontSize="md">{beneficiary.country || "Location"}</Text>
                </Flex>
              </Box>
            </Box>
            <Box
              borderRadius="xl"
              className="h-[523px] mt-3 mb-2.5 md:my-0 md:col-span-7 md:gap-4"
            >
              {/* Sponsorship Target */}
              {publicHardcodedCents == null && (
                <Box mb={2} gap={10}>
                  <Box className="flex justify-between">
                    <Text
                      className="text-base text-[#52667A] font-normal"
                      mb={2}
                    >
                      Sponsorship Target
                    </Text>
                    <Text className="text-base font-semibold" mb={2}>
                      {beneficiary.budget_goal > 0
                        ? Math.round(
                            (beneficiary.budget_raised /
                              beneficiary.budget_goal) *
                              100,
                          )
                        : 0}
                      %
                    </Text>
                  </Box>
                  <Box className="w-full bg-[#CDE1FE] h-[13px] rounded-full mb-3">
                    <Box
                      className="bg-[#0654C6] h-[13px] rounded-full"
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
                  <Text className="text-sm text-[#52667A] font-normal">
                    {`$${(
                      (beneficiary.budget_raised || 0) / 100
                    ).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })} of $${(
                      (beneficiary.budget_goal || 0) / 100
                    ).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  </Text>
                </Box>
              )}

              <Box className="grid grid-cols-2 gap-2">
                <Box>
                  <Text mt={1} className="font-medium text-sm mb-[10px]">
                    Amount
                  </Text>

                  {remainingAmount < minimumAmount ? (
                    <Box>
                      <Flex
                        className="border rounded-xl"
                        align="center"
                        justify="center"
                        gap={2}
                      >
                        <InputAddon className="bg-[#E3EEFF] px-[15px] py-[5px] m-1 text-black text-base font-medium">
                          $
                        </InputAddon>
                        <Input
                          type="number"
                          value={
                            publicHardcodedDollars !== null
                              ? publicHardcodedDollars
                              : remainingAmount
                          }
                          readOnly={publicHardcodedDollars !== null}
                          disabled={publicHardcodedDollars !== null}
                          className="px-4 h-[50px] bg-gray-100"
                          placeholder="Enter Amount"
                        />
                      </Flex>
                    </Box>
                  ) : (
                    <>
                      <Flex
                        className="border rounded-xl"
                        align="center"
                        justify="center"
                        gap={2}
                      >
                        <InputAddon className="bg-[#E3EEFF] px-[15px] py-[5px] m-1 text-black text-base font-medium">
                          $
                        </InputAddon>
                        <Input
                          type="number"
                          min="1"
                          max={maxSelectableAmount}
                          value={amount || ""}
                          onChange={handleAmountChange}
                          readOnly={publicHardcodedDollars !== null}
                          className="px-4 h-[48px]"
                          placeholder="Enter Amount"
                        />
                      </Flex>
                    </>
                  )}
                </Box>
                <Box>
                  <Text className="font-medium text-sm mb-[10px]" mt={1}>
                    Frequency
                  </Text>
                  <SelectRoot
                    collection={paymentOptionsCollection}
                    className="border rounded-xl"
                    mt={2}
                    mb={4}
                    px={1}
                    py={1}
                    value={[selectedOption]}
                    onValueChange={(details) =>
                      handleSelectChange(details.value[0])
                    }
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
              <Box className="grid grid-cols-2 gap-2.5 mb-1.5">
                <Button
                  onClick={handleStripePayment}
                  loading={loading}
                  loadingText="Processing..."
                  disabled={loading || !canPay}
                  className={`flex-1 py-2 bg-blue-700 text-white hover:bg-blue-800${
                    !canPay ? " opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  Sponsor this child
                </Button>
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
                        height: 40,
                      }}
                      createOrder={handleCreateOrder}
                      onApprove={handlePayPalApproval}
                      onError={handlePayPalError}
                    />
                  ) : (
                    <Box className="h-[40px] bg-gray-200 rounded flex items-center justify-center">
                      <Text color="gray.500" fontSize="sm">
                        {remainingAmount < minimumAmount
                          ? "Enter amount greater than $0"
                          : `Minimum amount is $${minimumAmount}`}
                      </Text>
                    </Box>
                  )}
                </PayPalScriptProvider>
              </Box>

              <Box bg="#CDE1FE" p={4} borderRadius="xl">
                <Box className="max-h-[200px] overflow-hidden overflow-y-scroll">
                  <Text fontSize="lg" fontWeight="bold" mb={2}>
                    Child Bio
                  </Text>
                  <Text color="gray.600" fontSize="base">
                    {beneficiary.biography}
                  </Text>
                </Box>
              </Box>
              <Flex mt={4} className="justify-center w-full">
                <Flex gap={4} className="w-full md:w-50%">
                  <Button
                    className="flex-1 border border-black"
                    height="40px"
                    variant="outline"
                    _hover={{ bg: "black", color: "white" }}
                    onClick={handleCopyLink}
                    bg="white"
                  >
                    <FaLink style={{ marginRight: 6 }} />
                    Copy Link
                  </Button>
                  <Button
                    className="flex-1 border border-black"
                    height="40px"
                    variant="outline"
                    _hover={{ bg: "black", color: "white" }}
                    onClick={handleShareProfile}
                    bg="white"
                  >
                    <FaShare style={{ marginRight: 6 }} />
                    Share Profile
                  </Button>
                </Flex>
              </Flex>
            </Box>
          </Box>
          <Box className="border mx-8 mb-2.5" />
          <Box className="px-8 md:grid md:grid-cols-2 md:items-stretch gap-4">
            <Box>
              <BeneficiaryActivity
                beneficiaryId={beneficiary.id}
                username={beneficiary.username}
              />
            </Box>
            <Box className="my-3 md:my-0">
              <Box
                bg="white"
                borderRadius="xl"
                mt={4}
                className="flex justify-center items-center md:min-h-[191px] mb-2"
              >
                {beneficiary.video_url?.trim() !== "" ? (
                  <video
                    className="rounded-xl max-h-40 w-full"
                    src={beneficiary.video_url?.trim() || undefined}
                    controls
                  />
                ) : (
                  <Text className="text-center text-gray-500">
                    No videos available
                  </Text>
                )}
              </Box>
              <BeneficiarySubscribeBox beneficiary={beneficiary} />
            </Box>
          </Box>
          <Box className="px-8 my-4">
            <Text color="gray.500" textAlign="center" p={1} fontSize="sm">
              {renderDisclaimer()}
            </Text>
          </Box>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}

export default BeneficiaryActivityModal
