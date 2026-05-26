import Stripe from "stripe"
import {
  ALL_STRIPE_REGIONS,
  isValidStripeRegion,
  type StripeRegion,
} from "./region"

export type { StripeRegion }
export { ALL_STRIPE_REGIONS, isValidStripeRegion }

export interface StripeRegionConfig {
  secretKey: string
  publishableKey: string
  webhookSecret: string
  portalUrl: string
  currency: string
  label: string
}

const LEGACY_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const LEGACY_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
const LEGACY_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const LEGACY_PORTAL_URL = process.env.STRIPE_PORTAL_URL

// Validate STRIPE_DEFAULT_REGION at module load: a typo like
// STRIPE_DEFAULT_REGION=eu otherwise short-circuits coerceRegion() into
// returning "eu", then crashes inside getStripeConfig with a confusing
// "Cannot read properties of undefined (reading 'secretKey')" error rather
// than the cleanly worded missing-region error we expect.
const RAW_DEFAULT_REGION_ENV = process.env.STRIPE_DEFAULT_REGION
if (
  RAW_DEFAULT_REGION_ENV !== undefined &&
  RAW_DEFAULT_REGION_ENV !== "" &&
  !isValidStripeRegion(RAW_DEFAULT_REGION_ENV)
) {
  throw new Error(
    `Invalid STRIPE_DEFAULT_REGION="${RAW_DEFAULT_REGION_ENV}". ` +
      `Expected one of: ${ALL_STRIPE_REGIONS.join(", ")}.`,
  )
}

export const STRIPE_DEFAULT_REGION: StripeRegion = isValidStripeRegion(
  RAW_DEFAULT_REGION_ENV,
)
  ? RAW_DEFAULT_REGION_ENV
  : "us"

// Region-specific env vars take precedence; legacy unsuffixed vars act as
// fallbacks for the primary region during migration.
const REGION_ENV_MAP: Record<StripeRegion, StripeRegionConfig> = {
  us: {
    secretKey:
      process.env.STRIPE_SECRET_KEY_US ||
      (STRIPE_DEFAULT_REGION === "us" ? LEGACY_SECRET_KEY || "" : ""),
    publishableKey:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US ||
      (STRIPE_DEFAULT_REGION === "us" ? LEGACY_PUBLISHABLE_KEY || "" : ""),
    webhookSecret:
      process.env.STRIPE_WEBHOOK_SECRET_US ||
      (STRIPE_DEFAULT_REGION === "us" ? LEGACY_WEBHOOK_SECRET || "" : ""),
    portalUrl:
      process.env.STRIPE_PORTAL_URL_US ||
      (STRIPE_DEFAULT_REGION === "us" ? LEGACY_PORTAL_URL || "" : ""),
    currency: "usd",
    label: "Creator Share US",
  },
  uk: {
    secretKey:
      process.env.STRIPE_SECRET_KEY_UK ||
      (STRIPE_DEFAULT_REGION === "uk" ? LEGACY_SECRET_KEY || "" : ""),
    publishableKey:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK ||
      (STRIPE_DEFAULT_REGION === "uk" ? LEGACY_PUBLISHABLE_KEY || "" : ""),
    webhookSecret:
      process.env.STRIPE_WEBHOOK_SECRET_UK ||
      (STRIPE_DEFAULT_REGION === "uk" ? LEGACY_WEBHOOK_SECRET || "" : ""),
    portalUrl:
      process.env.STRIPE_PORTAL_URL_UK ||
      (STRIPE_DEFAULT_REGION === "uk" ? LEGACY_PORTAL_URL || "" : ""),
    // TODO(uk-pricing): switch to "gbp" once the UI supports per-region
    // currency display + a price table denominated in pence. Until then,
    // bill UK Stripe in USD so the dollar amounts the UI shows match what
    // the customer is charged. Otherwise a sponsor picking "$15/month"
    // gets charged £15 (~$19), a ~25% silent overcharge.
    currency: "usd",
    label: "Creator Share UK",
  },
}

const clientCache = new Map<StripeRegion, Stripe>()

function isRegionConfigured(region: StripeRegion): boolean {
  return !!REGION_ENV_MAP[region]?.secretKey
}

// Kept as `isValidRegion` alias for backward compat with existing callers.
export const isValidRegion = isValidStripeRegion

// Permissive coercion: invalid input (including attacker-supplied query
// strings like ?region=foobar) silently maps to STRIPE_DEFAULT_REGION
// rather than throwing. This is intentional because the canonical region
// for a checkout lives on the Stripe session or DB row, not the URL;
// downstream lookups against the wrong account fail closed with a
// cleanly worded error. Do not use this function as an authorization
// boundary.
export function coerceRegion(
  value: string | null | undefined,
): StripeRegion {
  return isValidStripeRegion(value) ? value : STRIPE_DEFAULT_REGION
}

export function getStripeConfig(
  region: StripeRegion = STRIPE_DEFAULT_REGION,
): StripeRegionConfig {
  const config = REGION_ENV_MAP[region]
  if (!config.secretKey) {
    throw new Error(
      `Stripe region "${region}" is not configured — missing STRIPE_SECRET_KEY_${region.toUpperCase()}`,
    )
  }
  return config
}

export function getStripeClient(
  region: StripeRegion = STRIPE_DEFAULT_REGION,
): Stripe {
  const cached = clientCache.get(region)
  if (cached) return cached
  const config = getStripeConfig(region)
  const client = new Stripe(config.secretKey)
  clientCache.set(region, client)
  return client
}

export function getPublishableKey(
  region: StripeRegion = STRIPE_DEFAULT_REGION,
): string {
  return getStripeConfig(region).publishableKey
}

export function getWebhookSecret(region: StripeRegion): string {
  const secret = getStripeConfig(region).webhookSecret
  if (!secret) {
    throw new Error(
      `Stripe region "${region}" is missing STRIPE_WEBHOOK_SECRET_${region.toUpperCase()}`,
    )
  }
  return secret
}

export function getPortalUrl(
  region: StripeRegion = STRIPE_DEFAULT_REGION,
): string {
  return getStripeConfig(region).portalUrl
}

export function getAvailableRegions(): StripeRegion[] {
  return ALL_STRIPE_REGIONS.filter(isRegionConfigured)
}

// Country codes (ISO 3166-1 alpha-2 + a couple of common full-name forms) that
// route to the UK Stripe entity. Anything not in this set falls through to the
// default region. The map is intentionally conservative — production routing
// rules (e.g. EU vs UK split, currency-driven overrides) will need to be
// extended here as new entities come online.
const UK_COUNTRY_CODES = new Set([
  "uk",
  "gb",
  "gbr",
  "united kingdom",
  "great britain",
  "england",
  "scotland",
  "wales",
  "northern ireland",
  // Ireland routes to the UK entity (per PR scope: shared EU/UK billing
  // surface until a dedicated EU Stripe account is brought online).
  "ie",
  "irl",
  "ireland",
])

function normalizeCountry(country: string | null | undefined): string {
  return (country || "").trim().toLowerCase()
}

// Returns the configured region for a beneficiary, falling back to the default
// when the beneficiary's country doesn't map to a configured region. Callers
// that need explicit override should prefer `coerceRegion` on a request param.
export function getRegionForBeneficiary(
  beneficiary?: { country?: string | null } | null,
): StripeRegion {
  const country = normalizeCountry(beneficiary?.country)
  if (country && UK_COUNTRY_CODES.has(country) && isRegionConfigured("uk")) {
    return "uk"
  }
  return STRIPE_DEFAULT_REGION
}

export function getRegionForCurrency(currency: string): StripeRegion {
  const lower = currency.toLowerCase()
  for (const region of getAvailableRegions()) {
    if (REGION_ENV_MAP[region].currency === lower) return region
  }
  return STRIPE_DEFAULT_REGION
}
