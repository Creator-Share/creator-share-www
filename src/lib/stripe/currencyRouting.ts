import type { StripeRegion } from "@/lib/stripe/region"
import { coerceSupportedCurrency } from "@/utils/currency"

export function getStripeRegionForPaymentCurrency(
  currency: string | null | undefined,
): StripeRegion {
  return coerceSupportedCurrency(currency) === "USD" ? "us" : "uk"
}
