import { createListCollection } from "@chakra-ui/react"

export const paymentOptionsCollection = createListCollection({
  items: [
    { label: "Monthly Recurring", value: "subscription" },
    // { label: "Yearly Recurring", value: "payment" },
  ],
})

/**
 * Payment frequency options shown for open-amount sponsorship types
 * (SPECIAL_NEEDS, IN_OUR_CARE). Fixed-price types stay recurring-only.
 * "subscription" → Stripe/PayPal recurring monthly charge.
 * "one_time"     → Stripe/PayPal single charge.
 */
export const openSponsorshipFrequencyOptions = [
  { label: "Monthly", value: "subscription" },
  { label: "One-time", value: "one_time" },
] as const

export type SponsorshipFrequency =
  (typeof openSponsorshipFrequencyOptions)[number]["value"]
