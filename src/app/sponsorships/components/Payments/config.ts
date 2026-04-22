import { createListCollection } from "@chakra-ui/react"

export const paymentOptionsCollection = createListCollection({
  items: [
    { label: "Monthly Recurring", value: "subscription" },
    // { label: "Yearly Recurring", value: "payment" },
  ],
})

/**
 * Payment frequency options shown inside the SPECIAL_NEEDS sponsorship modal.
 * "subscription" → Stripe/PayPal recurring monthly charge.
 * "one_time"     → Stripe/PayPal single charge.
 */
export const specialNeedsFrequencyOptions = [
  { label: "Monthly", value: "subscription" },
  { label: "One-time", value: "one_time" },
] as const

export type SpecialNeedsFrequency = (typeof specialNeedsFrequencyOptions)[number]["value"]
