// Region types and validators with no Stripe SDK dependency, so this module
// can be safely imported from client components.

export type StripeRegion = "us" | "uk"

export const ALL_STRIPE_REGIONS: readonly StripeRegion[] = ["us", "uk"] as const

export function isValidStripeRegion(
  value: string | null | undefined,
): value is StripeRegion {
  return value === "us" || value === "uk"
}
