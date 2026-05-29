// Self-service portal links for Stripe and PayPal. Reads only
// NEXT_PUBLIC_* env vars and the lightweight region type module, so it is
// safe to import from client components (Footer, FAQ, About) as well as
// server-side email rendering.

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

export function buildStripePortalLinks(
  portalUrls: Record<StripeRegion, string | undefined>,
): PortalLink[] {
  const linksByHref = new Map<string, StripeRegion[]>()

  for (const region of ALL_STRIPE_REGIONS) {
    const href = portalUrls[region]?.trim()
    if (!href) continue

    const regions = linksByHref.get(href) || []
    regions.push(region)
    linksByHref.set(href, regions)
  }

  if (linksByHref.size === 0) {
    return [
      {
        provider: "STRIPE",
        href: DEFAULT_STRIPE_PORTAL_URL,
        label: "Manage Subscription",
      },
    ]
  }

  if (linksByHref.size === 1) {
    const [href] = linksByHref.keys()
    return [
      {
        provider: "STRIPE",
        href,
        label: "Manage Subscription",
      },
    ]
  }

  return Array.from(linksByHref.entries()).map(([href, regions]) => {
    const [primaryRegion] = regions
    const label = regions
      .map((region) => STRIPE_REGION_LABELS[region])
      .join(", ")

    return {
      provider: "STRIPE",
      region: primaryRegion,
      href,
      label: `Manage Subscription (${label})`,
    }
  })
}

export function getPublicPortalLinks(): PortalLink[] {
  const links = buildStripePortalLinks(PUBLIC_PORTAL_URLS)

  if (process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) {
    links.push({
      provider: "PAYPAL",
      href: PAYPAL_MANAGE_URL,
      label: "Manage in PayPal",
    })
  }

  return links
}
