"use client"

import {
  Box,
  Text,
  Flex,
  Input,
} from "@chakra-ui/react"
import React, { useState } from "react"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { paymentOptionsCollection } from "./Payments/config"
import { toaster } from "@/components/ui/toaster"
import { useAuthStore } from "@/store/authStore"
import { useSponsorship } from "../hooks/useSponsorship"

type BlindSponsorshipModalProps = {
  open: boolean
  onClose: () => void
}

const FALLBACK_IMAGE =
  "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="
const BLIND_LABEL = "the next child who needs support"

const BlindSponsorshipModal: React.FC<BlindSponsorshipModalProps> = ({
  open,
  onClose,
}) => {
  const user = useAuthStore((state) => state.user)
  const { setSponsorshipInProgress } = useSponsorship()
  const isEmbedded =
    typeof window !== "undefined" && window.self !== window.top

  // Fixed amount for blind sponsorships - always $33.33
  const FIXED_AMOUNT = 33.33
  const [selectedOption, setSelectedOption] = useState<string>(
    paymentOptionsCollection.items[0].value
  )
  const [loading, setLoading] = useState(false)

  // Amount is fixed, no change handler needed

  const handleSubmit = async () => {
    // Amount is fixed at $33.33
    const resolvedAmountCents = Math.round(FIXED_AMOUNT * 100) // 3333 cents

    setLoading(true)
    setSponsorshipInProgress("blind_sponsorship", true)

    try {
      const payload = {
        amount: resolvedAmountCents,
        paymentType: selectedOption,
        beneficiaryName: `Blind sponsorship for ${BLIND_LABEL}`,
        beneficiaryImage: FALLBACK_IMAGE,
        location: "Flexible",
        userId: user?.id,
        isEmbedded,
        allowBelowMinimum: false,
        type: "blind_sponsorship",
        sponsorshipMode: "blind",
        blindLabel: BLIND_LABEL,
      }

      const res = await fetch("/api/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        toaster.create({
          title: "Unable to start sponsorship",
          description:
            data?.error ||
            "Something went wrong while starting your sponsorship. Please try again.",
          type: "error",
        })
        return
      }

      if (data.url) {
        window.location.href = data.url
      } else if (data.clientSecret) {
        // Embedded checkout flow
        window.location.href = `/sponsorships/checkout?client_secret=${data.clientSecret}`
      } else {
        toaster.create({
          title: "Unexpected response",
          description: "Checkout link was not provided. Please try again.",
          type: "error",
        })
      }
    } catch (error) {
      console.error("Blind sponsorship checkout error:", error)
      toaster.create({
        title: "Something went wrong",
        description: "Please try again or contact support if the issue persists.",
        type: "error",
      })
    } finally {
      setLoading(false)
      setSponsorshipInProgress("blind_sponsorship", false)
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={(e) => !e.open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <Text fontSize="xl" fontWeight="bold">
            We&apos;ll match you with a child
          </Text>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <Text mb={4} color="gray.700">
            Choose your monthly sponsorship amount and we&apos;ll pair you with
            the next child who needs support. You&apos;ll receive updates as
            soon as your sponsorship is matched.
          </Text>

          <Box mb={6}>
            <Text mb={2} fontWeight="semibold">
              Monthly amount
            </Text>
            <Flex
              className="border border-gray-300 rounded-xl bg-gray-100 overflow-hidden"
              align="center"
              h="56px"
            >
              <Box className="bg-gray-100 px-4 h-full flex items-center text-gray-700 font-medium border-r border-gray-300">
                $
              </Box>
              <Input
                type="number"
                value={FIXED_AMOUNT}
                readOnly
                disabled
                className="px-4 h-full border-0 outline-none focus:ring-0 text-lg text-gray-700 bg-gray-100 cursor-not-allowed"
              />
            </Flex>
            <Text fontSize="sm" color="gray.500" mt={2}>
              Fixed monthly sponsorship amount of ${FIXED_AMOUNT}.
            </Text>
          </Box>

          <Box>
            <Text mb={2} fontWeight="semibold">
              Payment schedule
            </Text>
            <Flex gap={4}>
              {paymentOptionsCollection.items.map((item: { label: string; value: string }) => (
                <Button
                  key={item.value}
                  variant={selectedOption === item.value ? "solid" : "outline"}
                  onClick={() => setSelectedOption(item.value)}
                  className={
                    selectedOption === item.value
                      ? "bg-[#0654C6] text-white"
                      : ""
                  }
                >
                  {item.label}
                </Button>
              ))}
            </Flex>
          </Box>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={loading}
            loadingText="Redirecting"
            className="bg-[#0654C6] text-white hover:bg-[#0545A5]"
          >
            Start blind sponsorship
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  )
}

export default BlindSponsorshipModal

