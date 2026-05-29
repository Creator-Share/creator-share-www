import {
  isValidStripeRegion,
  type StripeRegion,
} from "@/lib/stripe/region"
import { coerceSupportedCurrency } from "@/utils/currency"

export function getStripeRegionForPaymentCurrency(
  currency: string | null | undefined,
): StripeRegion {
  return coerceSupportedCurrency(currency) === "USD" ? "us" : "uk"
}

export function getStripeRegionForPaymentMetadata(
  metadata: Record<string, string | null | undefined> | null | undefined,
  fallback: StripeRegion,
): StripeRegion {
  return isValidStripeRegion(metadata?.region) ? metadata.region : fallback
}
