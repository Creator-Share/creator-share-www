// Self-service portal links for Stripe and PayPal. Reads only
// NEXT_PUBLIC_* env vars and the lightweight region type module, so it is
// safe to import from client components (Footer, FAQ, About) as well as
// server-side email rendering.

import { ALL_STRIPE_REGIONS, type StripeRegion } from "@/lib/stripe/region"
import { isAdvocateStagingEnvironmentEnabled } from "@/lib/advocates/host"

export const DEFAULT_STRIPE_PORTAL_URL = "https://stripe.creatorshare.com"
export const PAYPAL_MANAGE_URL = "https://www.paypal.com/myaccount/autopay/"
export const PAYPAL_SANDBOX_MANAGE_URL =
  "https://www.sandbox.paypal.com/myaccount/autopay/"

export function resolvePayPalManageUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): typeof PAYPAL_MANAGE_URL | typeof PAYPAL_SANDBOX_MANAGE_URL {
  return isAdvocateStagingEnvironmentEnabled(environment)
    ? PAYPAL_SANDBOX_MANAGE_URL
    : PAYPAL_MANAGE_URL
}

const APPROVED_STRIPE_PORTAL_HOSTS = new Set([
  "billing.stripe.com",
  "stripe.creatorshare.com",
])
const UNSAFE_RAW_URL_CHARACTERS = /[\u0000-\u0020\u007f"'<>\\]/

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

export function normalizePublicStripePortalUrl(
  value: string | undefined,
): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2_048 ||
    UNSAFE_RAW_URL_CHARACTERS.test(value)
  ) {
    return null
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (
    url.protocol !== "https:" ||
    !APPROVED_STRIPE_PORTAL_HOSTS.has(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null
  }
  return url.toString()
}

export function buildStripePortalLinks(
  portalUrls: Record<StripeRegion, string | undefined>,
): PortalLink[] {
  const linksByHref = new Map<string, StripeRegion[]>()

  for (const region of ALL_STRIPE_REGIONS) {
    const href = normalizePublicStripePortalUrl(portalUrls[region])
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

export function buildPublicPortalLinks(options: {
  environment: Readonly<Record<string, string | undefined>>
  paypalConfigured: boolean
  stripePortalUrls: Record<StripeRegion, string | undefined>
}): PortalLink[] {
  const links = isAdvocateStagingEnvironmentEnabled(options.environment)
    ? []
    : buildStripePortalLinks(options.stripePortalUrls)

  if (options.paypalConfigured) {
    links.push({
      provider: "PAYPAL",
      href: resolvePayPalManageUrl(options.environment),
      label: "Manage in PayPal",
    })
  }

  return links
}

export function getPublicPortalLinks(): PortalLink[] {
  return buildPublicPortalLinks({
    environment: {
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    },
    paypalConfigured: Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID),
    stripePortalUrls: PUBLIC_PORTAL_URLS,
  })
}
