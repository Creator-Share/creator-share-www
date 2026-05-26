// Self-service portal links for Stripe (per-region) and PayPal. Reads only
// NEXT_PUBLIC_* env vars and the lightweight region type module, so it is
// safe to import from client components (Footer, FAQ, About) as well as
// server-side email rendering.
//
// Fallback semantics (per-region, not all-or-nothing): any region that is
// not configured via NEXT_PUBLIC_STRIPE_PORTAL_URL_<REGION> falls back to
// DEFAULT_STRIPE_PORTAL_URL. This means a deployment that configures only
// UK during rollout still renders a working US "Manage Subscription" link
// pointed at the legacy hosted portal.

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

  // If NO region-specific URLs are configured at all, render the legacy
  // single "Manage Subscription" link (no region label) to keep single-
  // account deployments looking unchanged.
  const anyRegionConfigured = ALL_STRIPE_REGIONS.some(
    (region) => !!PUBLIC_PORTAL_URLS[region],
  )

  if (!anyRegionConfigured) {
    links.push({
      provider: "STRIPE",
      href: DEFAULT_STRIPE_PORTAL_URL,
      label: "Manage Subscription",
    })
  } else {
    // At least one region is configured. Render a link for every region,
    // falling back to the legacy URL for any region without a NEXT_PUBLIC_
    // override so partial-rollout deployments don't drop the other regions.
    for (const region of ALL_STRIPE_REGIONS) {
      const href = PUBLIC_PORTAL_URLS[region] || DEFAULT_STRIPE_PORTAL_URL
      links.push({
        provider: "STRIPE",
        region,
        href,
        label: `Manage Subscription (${STRIPE_REGION_LABELS[region]})`,
      })
    }
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
