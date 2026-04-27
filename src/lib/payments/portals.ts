// Self-service portal links for Stripe (per-region) and PayPal. Reads only
// NEXT_PUBLIC_* env vars and the lightweight region type module, so it is
// safe to import from client components (Footer, FAQ, About) as well as
// server-side email rendering.
//
// When no region-specific NEXT_PUBLIC_STRIPE_PORTAL_URL_* var is set, falls
// back to a single legacy portal link so existing single-account deployments
// keep working unchanged.

import {
  ALL_STRIPE_REGIONS,
  type StripeRegion,
} from "@/lib/stripe/region"

export const DEFAULT_STRIPE_PORTAL_URL = "https://stripe.creatorshare.com"
export const PAYPAL_MANAGE_URL = "https://www.paypal.com/myaccount/autopay/"

export interface PortalLink {
  provider: "STRIPE" | "PAYPAL"
  region?: StripeRegion
  href: string
  label: string
}

const STRIPE_REGION_LABELS: Record<StripeRegion, string> = {
  us: "US",
  uk: "UK",
}

// Reading from a static lookup so Next.js can inline the NEXT_PUBLIC_* vars at
// build time. Dynamic key access (`process.env[key]`) is NOT inlined and would
// always come back undefined in client bundles.
const PUBLIC_PORTAL_URLS: Record<StripeRegion, string | undefined> = {
  us: process.env.NEXT_PUBLIC_STRIPE_PORTAL_URL_US,
  uk: process.env.NEXT_PUBLIC_STRIPE_PORTAL_URL_UK,
}

export function getPublicPortalLinks(): PortalLink[] {
  const links: PortalLink[] = []

  for (const region of ALL_STRIPE_REGIONS) {
    const href = PUBLIC_PORTAL_URLS[region]
    if (!href) continue
    links.push({
      provider: "STRIPE",
      region,
      href,
      label: `Manage Subscription (${STRIPE_REGION_LABELS[region]})`,
    })
  }

  if (links.length === 0) {
    links.push({
      provider: "STRIPE",
      href: DEFAULT_STRIPE_PORTAL_URL,
      label: "Manage Subscription",
    })
  }

  if (process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) {
    links.push({
      provider: "PAYPAL",
      href: PAYPAL_MANAGE_URL,
      label: "Manage in PayPal",
    })
  }

  return links
}
