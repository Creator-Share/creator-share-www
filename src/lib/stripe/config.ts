import Stripe from "stripe"
import {
  ALL_STRIPE_REGIONS,
  isValidStripeRegion,
  type StripeRegion,
} from "./region"

export type { StripeRegion }
export { ALL_STRIPE_REGIONS, isValidStripeRegion }

export const STRIPE_API_VERSION = "2025-02-24.acacia" as const

export interface StripeRegionConfig {
  secretKey: string
  publishableKey: string
  webhookSecret: string
  previousWebhookSecret: string
  portalUrl: string
  label: string
}

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

// Stripe accounts are configured explicitly per region. STRIPE_DEFAULT_REGION
// only selects which configured account is used when a caller does not provide
// a valid region.
const REGION_ENV_MAP: Record<StripeRegion, StripeRegionConfig> = {
  us: {
    secretKey: process.env.STRIPE_SECRET_KEY_US || "",
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET_US || "",
    previousWebhookSecret:
      process.env.STRIPE_WEBHOOK_SECRET_US_PREVIOUS || "",
    portalUrl: process.env.NEXT_PUBLIC_STRIPE_PORTAL_URL_US || "",
    label: "Creator Share US",
  },
  uk: {
    secretKey: process.env.STRIPE_SECRET_KEY_UK || "",
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET_UK || "",
    previousWebhookSecret:
      process.env.STRIPE_WEBHOOK_SECRET_UK_PREVIOUS || "",
    portalUrl: process.env.NEXT_PUBLIC_STRIPE_PORTAL_URL_UK || "",
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
      `Stripe region "${region}" is not configured, missing STRIPE_SECRET_KEY_${region.toUpperCase()}`,
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
  const client = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
  })
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

export interface StripeWebhookSecretCandidate {
  secret: string
  version: "current" | "previous"
}

export interface ScopedStripeWebhookSecretCandidate
  extends StripeWebhookSecretCandidate {
  region: StripeRegion
}

/**
 * A signing secret must identify exactly one regional Stripe account. If the
 * same secret is configured for two regions, signature verification alone
 * cannot determine which provider account owns the event.
 */
export function assertUnambiguousStripeWebhookSecrets(
  candidates: readonly ScopedStripeWebhookSecretCandidate[],
): void {
  const ownerBySecret = new Map<string, StripeRegion>()
  for (const candidate of candidates) {
    if (
      !isValidStripeRegion(candidate.region) ||
      (candidate.version !== "current" && candidate.version !== "previous") ||
      typeof candidate.secret !== "string" ||
      candidate.secret.length < 16 ||
      candidate.secret.length > 255 ||
      /\s/.test(candidate.secret)
    ) {
      throw new Error("Stripe webhook signing configuration is invalid")
    }
    const owner = ownerBySecret.get(candidate.secret)
    if (owner !== undefined && owner !== candidate.region) {
      throw new Error("Stripe webhook signing configuration is ambiguous")
    }
    ownerBySecret.set(candidate.secret, candidate.region)
  }
}

export function getWebhookSecretCandidates(
  region: StripeRegion,
): StripeWebhookSecretCandidate[] {
  const config = getStripeConfig(region)
  const candidates: StripeWebhookSecretCandidate[] = []
  if (config.webhookSecret) {
    candidates.push({ secret: config.webhookSecret, version: "current" })
  }
  if (
    config.previousWebhookSecret &&
    config.previousWebhookSecret !== config.webhookSecret
  ) {
    candidates.push({
      secret: config.previousWebhookSecret,
      version: "previous",
    })
  }
  if (candidates.length === 0) {
    throw new Error(
      `Stripe region "${region}" has no configured webhook signing secret`,
    )
  }
  return candidates
}

export function getStripeAccountLivemode(region: StripeRegion): boolean {
  const secretKey = getStripeConfig(region).secretKey
  if (/^(?:sk|rk)_live_/.test(secretKey)) return true
  if (/^(?:sk|rk)_test_/.test(secretKey)) return false
  throw new Error(
    `Stripe region "${region}" has an unrecognized server key environment`,
  )
}

export function getPortalUrl(
  region: StripeRegion = STRIPE_DEFAULT_REGION,
): string {
  return getStripeConfig(region).portalUrl
}

export function getAvailableRegions(): StripeRegion[] {
  return ALL_STRIPE_REGIONS.filter(isRegionConfigured)
}

// Single-word tokens that route to the UK Stripe entity. We match against
// individual words after stripping punctuation, so "England, UK", "London /
// United Kingdom", and "Wales" all hit. ISO codes + the constituent country
// names are listed here. Phrases that contain a space (e.g. "united kingdom")
// must go in UK_COUNTRY_PHRASES below instead.
const UK_COUNTRY_TOKENS = new Set([
  "uk",
  "gb",
  "gbr",
  "england",
  "scotland",
  "wales",
  // Ireland routes to the UK entity until a dedicated EU Stripe account is
  // brought online (PR scope: shared EU/UK billing surface).
  "ie",
  "irl",
  "ireland",
])

// Multi-word phrases that route to the UK entity. Matched as substrings on
// the normalised (lowercase, punctuation collapsed to spaces) input. Listed
// separately so we never get false positives from a single word like "great"
// or "kingdom" appearing in an unrelated country name.
const UK_COUNTRY_PHRASES = [
  "united kingdom",
  "great britain",
  "northern ireland",
  "republic of ireland",
]

// Normalises free-text admin-entered country strings into a tokenisable form.
// Lowercases, collapses any non-letter character (punctuation, digits,
// underscores) into a single space, then trims. Examples:
//   "England, UK"        -> "england uk"
//   "London / Scotland." -> "london scotland"
//   "U.K."               -> "u k"  (matched via UK_COUNTRY_TOKENS short codes)
function normalizeCountry(country: string | null | undefined): string {
  return (country || "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
}

function matchesUk(normalized: string): boolean {
  if (!normalized) return false
  const tokens = new Set(normalized.split(" "))
  for (const t of UK_COUNTRY_TOKENS) {
    if (tokens.has(t)) return true
  }
  // Phrase match needs space-separated comparison so we don't match a phrase
  // hidden inside a longer word; the normaliser already guarantees single
  // spaces between tokens, so substring checks here are word-boundary safe.
  const padded = ` ${normalized} `
  for (const phrase of UK_COUNTRY_PHRASES) {
    if (padded.includes(` ${phrase} `)) return true
  }
  return false
}

// Returns the configured region for a beneficiary, falling back to the default
// when the beneficiary's country doesn't map to a configured region. Callers
// that need explicit override should prefer `coerceRegion` on a request param.
//
// Country is treated as free text rather than an enum because the admin form
// accepts arbitrary strings ("Greater London", "Glasgow, Scotland", "United
// Kingdom (Wales)" have all appeared in production). We tokenise and phrase-
// match instead of doing a strict equality check to avoid silently routing UK
// sponsorships through the US Stripe account.
export function getRegionForBeneficiary(
  beneficiary?: { country?: string | null } | null,
): StripeRegion {
  const normalized = normalizeCountry(beneficiary?.country)
  if (matchesUk(normalized) && isRegionConfigured("uk")) {
    return "uk"
  }
  return STRIPE_DEFAULT_REGION
}
