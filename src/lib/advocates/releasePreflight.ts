import "server-only"

import {
  loadAdvocateInvitationEmailCanonicalOrigin,
  loadAdvocateInvitationEmailTransportConfig,
  loadAdvocateInvitationEmailWorkerConfig,
  loadAdvocateInvitationEmailWorkerSecret,
} from "@/lib/advocates/invitations/emailConfig"
import {
  COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE,
  CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE,
  evaluateCrossSubdomainCookieTrustGate,
} from "@/lib/advocates/crossSubdomainAttributionGate"
import { loadArchivedAdvocateDomainCleanupWorkerSecret } from "@/lib/advocates/lifecycleCleanup/auth"
import { loadArchivedAdvocateDomainCleanupWorkerConfig } from "@/lib/advocates/lifecycleCleanup/config"
import { loadAdvocateLogoReconciliationWorkerSecret } from "@/lib/advocates/logoReconciliation/auth"
import { loadAdvocateLogoReconciliationWorkerConfig } from "@/lib/advocates/logoReconciliation/config"
import {
  loadCloudflareProvisioningConfig,
  loadDomainWorkerConfig,
  loadPublicationPaymentCanaryConfig,
  loadVercelProvisioningConfig,
  loadWorkerRouteSecret,
} from "@/lib/advocates/provisioning/config"
import { loadProviderAutomationMode } from "@/lib/advocates/providerAutomation"
import { loadAdvocatePublicMetricReleaseWorkerSecret } from "@/lib/advocates/publicMetrics/releaseAuth"
import { loadAdvocatePublicMetricReleaseWorkerConfig } from "@/lib/advocates/publicMetrics/releaseConfig"
import { createPublicationCanaryToken } from "@/lib/advocates/publicationCanary/challenge"
import { loadPublicationCanaryWorkerSecret } from "@/lib/advocates/publicationCanary/workerAuth"
import {
  loadDataRetentionWorkerConfig,
  loadDataRetentionWorkerSecret,
} from "@/lib/retention/dataRetentionConfig"
import {
  loadSubscriptionCancellationWorkerConfig,
  loadSubscriptionCancellationWorkerSecret,
} from "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerConfig"
import { normalizePublicStripePortalUrl } from "@/lib/payments/portals"
import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import {
  loadSponsorWelcomeEmailCanonicalOrigin,
  loadSponsorWelcomeEmailTransportConfig,
  loadSponsorWelcomeEmailWorkerConfig,
  loadSponsorWelcomeEmailWorkerSecret,
} from "@/lib/sponsorships/email/sponsorWelcomeEmailConfig"
import {
  loadPaymentGatewayEventWorkerConfig,
  loadPaymentGatewayEventWorkerSecret,
} from "@/lib/sponsorships/gateways/paymentGatewayEventConfig"

export type AdvocateReleasePreflightEnvironment = Readonly<
  Record<string, string | undefined>
>

export const ADVOCATE_RELEASE_PREFLIGHT_CHECK_NAMES = Object.freeze([
  "deployment_identity",
  "provider_automation_gate",
  "cross_subdomain_cookie_trust",
  "cross_subdomain_cookie_trusted_collector",
  "cross_subdomain_cookie_fresh_provider_evidence",
  "supabase_configuration",
  "worker_configuration",
  "email_configuration",
  "cloudflare_configuration",
  "vercel_configuration",
  "stripe_us_configuration",
  "stripe_uk_configuration",
  "paypal_configuration",
  "cryptographic_configuration",
  "secret_separation",
] as const)

export type AdvocateReleasePreflightCheckName =
  (typeof ADVOCATE_RELEASE_PREFLIGHT_CHECK_NAMES)[number]
export type AdvocateReleasePreflightConfigurationState =
  "configured" | "invalid" | "unverified"

export interface AdvocateReleasePreflightCheck {
  name: AdvocateReleasePreflightCheckName
  state: AdvocateReleasePreflightConfigurationState
}

export interface AdvocateReleasePreflightResult {
  schemaVersion: 1
  configurationState: AdvocateReleasePreflightConfigurationState
  providerReadiness: "not_probed"
  checks: readonly AdvocateReleasePreflightCheck[]
}

const VERCEL_INCOMPATIBLE_WORKER_SECRET_OVERRIDES = Object.freeze([
  "PAYMENT_GATEWAY_EVENT_WORKER_SECRET",
  "SPONSOR_WELCOME_EMAIL_WORKER_SECRET",
  "SUBSCRIPTION_CANCELLATION_WORKER_SECRET",
  "ADVOCATE_INVITATION_EMAIL_WORKER_SECRET",
  "ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET",
  "ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET",
  "ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_WORKER_SECRET",
  "DATA_RETENTION_WORKER_SECRET",
  "ADVOCATE_PROVISIONING_WORKER_SECRET",
] as const)

const PRIVATE_SECRET_ENVIRONMENT_NAMES = Object.freeze([
  "NEXT_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "PAYMENT_GATEWAY_EVENT_WORKER_SECRET",
  "SPONSOR_WELCOME_EMAIL_WORKER_SECRET",
  "SUBSCRIPTION_CANCELLATION_WORKER_SECRET",
  "ADVOCATE_INVITATION_EMAIL_WORKER_SECRET",
  "ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET",
  "ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET",
  "ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_WORKER_SECRET",
  "DATA_RETENTION_WORKER_SECRET",
  "ADVOCATE_PROVISIONING_WORKER_SECRET",
  "ADVOCATE_CLOUDFLARE_API_TOKEN",
  "ADVOCATE_VERCEL_API_TOKEN",
  "STRIPE_SECRET_KEY_US",
  "STRIPE_SECRET_KEY_UK",
  "STRIPE_WEBHOOK_SECRET_US",
  "STRIPE_WEBHOOK_SECRET_US_PREVIOUS",
  "STRIPE_WEBHOOK_SECRET_UK",
  "STRIPE_WEBHOOK_SECRET_UK_PREVIOUS",
  "PAYPAL_CLIENT_SECRET",
  "EMAIL_PASSWORD",
  "TELEGRAM_BOT_TOKEN",
  "LLM_API_KEY",
  "ADVOCATE_PUBLICATION_CANARY_SECRET_V1",
  "SPONSORSHIP_CRYPTO_SECRET_V1",
  "SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1",
  "ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1",
  "SPONSORSHIP_VISITOR_COOKIE_SECRET_V1",
  "ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1",
  "ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS",
] as const)

const REQUIRED_PRIVATE_SECRET_ENVIRONMENT_NAMES = Object.freeze([
  "NEXT_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "ADVOCATE_CLOUDFLARE_API_TOKEN",
  "ADVOCATE_VERCEL_API_TOKEN",
  "STRIPE_SECRET_KEY_US",
  "STRIPE_SECRET_KEY_UK",
  "STRIPE_WEBHOOK_SECRET_US",
  "STRIPE_WEBHOOK_SECRET_UK",
  "PAYPAL_CLIENT_SECRET",
  "EMAIL_PASSWORD",
  "ADVOCATE_PUBLICATION_CANARY_SECRET_V1",
  "SPONSORSHIP_CRYPTO_SECRET_V1",
  "SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1",
  "ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1",
  "SPONSORSHIP_VISITOR_COOKIE_SECRET_V1",
  "ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1",
] as const)

const PUBLIC_CREDENTIAL_ENVIRONMENT_NAMES = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK",
  "NEXT_PUBLIC_PAYPAL_CLIENT_ID",
] as const)

const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const CANONICAL_BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/
const SERVER_SECRET_PATTERN = /^[\x21-\x7e]+$/
const STORAGE_BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/
const BILLING_PORTAL_CONFIGURATION_PATTERN = /^bpc_[A-Za-z0-9]+$/
const SUPABASE_PUBLISHABLE_KEY_PATTERN =
  /^sb_publishable_[A-Za-z0-9_-]{16,2033}$/
const SUPABASE_SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,2038}$/
const VERCEL_DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]{8,128}$/
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/

function isMissing(
  environment: AdvocateReleasePreflightEnvironment,
  name: string,
): boolean {
  const value = environment[name]
  return value === undefined || value === ""
}

function evaluateCheck(options: {
  environment: AdvocateReleasePreflightEnvironment
  name: AdvocateReleasePreflightCheckName
  required: readonly string[]
  validate: () => void
}): AdvocateReleasePreflightCheck {
  const hasMissingRequirement = options.required.some((name) =>
    isMissing(options.environment, name),
  )
  try {
    options.validate()
    return Object.freeze({
      name: options.name,
      state: hasMissingRequirement ? "unverified" : "configured",
    })
  } catch {
    return Object.freeze({
      name: options.name,
      state: hasMissingRequirement ? "unverified" : "invalid",
    })
  }
}

function requireServerSecret(value: string | undefined): void {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 4_096 ||
    !SERVER_SECRET_PATTERN.test(value)
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
}

function requireCanonicalBase64Secret(
  value: string | undefined,
  exactBytes?: number,
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_368 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(value)
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
  const decoded = Buffer.from(value, "base64")
  if (
    decoded.toString("base64") !== value ||
    decoded.byteLength < 32 ||
    decoded.byteLength > 1_024 ||
    (exactBytes !== undefined && decoded.byteLength !== exactBytes)
  ) {
    decoded.fill(0)
    throw new Error("release_preflight_configuration_invalid")
  }
  decoded.fill(0)
}

function legacySupabaseApiKeyRole(
  value: string,
): "anon" | "service_role" | null {
  const segments = value.split(".")
  if (
    segments.length !== 3 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        !CANONICAL_BASE64URL_SEGMENT_PATTERN.test(segment),
    )
  ) {
    return null
  }

  let payloadBytes: Buffer
  try {
    payloadBytes = Buffer.from(segments[1], "base64url")
  } catch {
    return null
  }
  try {
    if (
      payloadBytes.length === 0 ||
      payloadBytes.toString("base64url") !== segments[1]
    ) {
      return null
    }
    const decoded: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
    )
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      return null
    }
    const role = (decoded as Record<string, unknown>).role
    return role === "anon" || role === "service_role" ? role : null
  } catch {
    return null
  } finally {
    payloadBytes.fill(0)
  }
}

function requireSupabaseApiKey(
  value: string | undefined,
  expectedRole: "anon" | "service_role",
): void {
  requireServerSecret(value)
  const key = value as string
  const expectedPattern =
    expectedRole === "anon"
      ? SUPABASE_PUBLISHABLE_KEY_PATTERN
      : SUPABASE_SECRET_KEY_PATTERN
  if (expectedPattern.test(key)) {
    return
  }
  if (legacySupabaseApiKeyRole(key) === expectedRole) return
  throw new Error("release_preflight_configuration_invalid")
}

function validateDeploymentIdentity(
  environment: AdvocateReleasePreflightEnvironment,
): void {
  if (
    environment.NODE_ENV !== "production" ||
    environment.VERCEL !== "1" ||
    environment.VERCEL_ENV !== "production" ||
    !VERCEL_DEPLOYMENT_ID_PATTERN.test(
      environment.VERCEL_DEPLOYMENT_ID ?? "",
    ) ||
    !GIT_REVISION_PATTERN.test(environment.VERCEL_GIT_COMMIT_SHA ?? "")
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
}

function validateSupabaseConfiguration(
  environment: AdvocateReleasePreflightEnvironment,
): void {
  const rawUrl = environment.NEXT_PUBLIC_SUPABASE_URL
  let url: URL
  try {
    url = new URL(rawUrl ?? "")
  } catch {
    throw new Error("release_preflight_configuration_invalid")
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
  requireSupabaseApiKey(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY, "anon")
  requireSupabaseApiKey(environment.NEXT_SERVICE_ROLE_KEY, "service_role")
  if (
    !STORAGE_BUCKET_PATTERN.test(
      environment.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? "",
    )
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
}

function validateWorkerConfiguration(
  environment: AdvocateReleasePreflightEnvironment,
): void {
  if (
    environment.VERCEL === "1" &&
    VERCEL_INCOMPATIBLE_WORKER_SECRET_OVERRIDES.some(
      (name) => !isMissing(environment, name),
    )
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }

  loadDomainWorkerConfig(environment)
  loadWorkerRouteSecret(environment)
  loadPublicationCanaryWorkerSecret(environment)
  loadAdvocateInvitationEmailWorkerConfig(environment)
  loadAdvocateInvitationEmailWorkerSecret(environment)
  loadAdvocateLogoReconciliationWorkerConfig(environment)
  loadAdvocateLogoReconciliationWorkerSecret(environment)
  loadAdvocatePublicMetricReleaseWorkerConfig(environment)
  loadAdvocatePublicMetricReleaseWorkerSecret(environment)
  loadArchivedAdvocateDomainCleanupWorkerConfig(environment)
  loadArchivedAdvocateDomainCleanupWorkerSecret(environment)
  loadDataRetentionWorkerConfig(environment)
  loadDataRetentionWorkerSecret(environment)
  loadPaymentGatewayEventWorkerConfig(environment)
  loadPaymentGatewayEventWorkerSecret(environment)
  loadSponsorWelcomeEmailWorkerConfig(environment)
  loadSponsorWelcomeEmailWorkerSecret(environment)
  loadSubscriptionCancellationWorkerConfig(environment)
  loadSubscriptionCancellationWorkerSecret(environment)
}

function validateEmailConfiguration(
  environment: AdvocateReleasePreflightEnvironment,
): void {
  if (environment.NEXT_PUBLIC_BASE_URL !== "https://creatorshare.com") {
    throw new Error("release_preflight_configuration_invalid")
  }
  if (
    environment.NEXT_PUBLIC_SITE_URL !== undefined &&
    environment.NEXT_PUBLIC_SITE_URL !== "" &&
    environment.NEXT_PUBLIC_SITE_URL !== "https://creatorshare.com"
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
  const invitationTransport =
    loadAdvocateInvitationEmailTransportConfig(environment)
  loadAdvocateInvitationEmailCanonicalOrigin(environment)
  const welcomeTransport = loadSponsorWelcomeEmailTransportConfig(environment)
  const brandedSender = environment.EMAIL_FROM?.match(
    /^(?:"Creator Share"|Creator Share)\s*<([^<>\s]+)>$/,
  )
  const approvedAddress = brandedSender?.[1]?.toLowerCase()
  if (
    approvedAddress === undefined ||
    !approvedAddress.endsWith("@creatorshare.com") ||
    approvedAddress.slice(0, -"@creatorshare.com".length).length === 0 ||
    invitationTransport.fromAddress.toLowerCase() !== approvedAddress ||
    welcomeTransport.fromAddress.toLowerCase() !== approvedAddress
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
  if (
    loadSponsorWelcomeEmailCanonicalOrigin(environment) !==
    "https://creatorshare.com"
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
}

function requireBillingPortalConfiguration(value: string | undefined): void {
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    !BILLING_PORTAL_CONFIGURATION_PATTERN.test(value)
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
}

function validateStripeConfiguration(
  region: "US" | "UK",
  environment: AdvocateReleasePreflightEnvironment,
): void {
  if (region === "US" && environment.STRIPE_DEFAULT_REGION !== "us") {
    throw new Error("release_preflight_configuration_invalid")
  }
  loadPublicationPaymentCanaryConfig(
    region === "US" ? "stripe_us" : "stripe_uk",
    environment,
  )
  requireBillingPortalConfiguration(
    environment[`STRIPE_BILLING_PORTAL_CONFIGURATION_ID_${region}`],
  )
  if (
    normalizePublicStripePortalUrl(
      environment[`NEXT_PUBLIC_STRIPE_PORTAL_URL_${region}`],
    ) === null
  ) {
    throw new Error("release_preflight_configuration_invalid")
  }
  const previousWebhookSecret =
    environment[`STRIPE_WEBHOOK_SECRET_${region}_PREVIOUS`]
  if (previousWebhookSecret !== undefined && previousWebhookSecret !== "") {
    requireServerSecret(previousWebhookSecret)
    if (!/^whsec_[A-Za-z0-9_]+$/.test(previousWebhookSecret)) {
      throw new Error("release_preflight_configuration_invalid")
    }
  }
}

function validateCryptographicConfiguration(
  environment: AdvocateReleasePreflightEnvironment,
): void {
  createSponsorshipCryptoFromEnvironment(environment)
  requireCanonicalBase64Secret(
    environment.SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1,
  )
  requireCanonicalBase64Secret(
    environment.ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1,
  )
  requireCanonicalBase64Secret(environment.SPONSORSHIP_VISITOR_COOKIE_SECRET_V1)
  requireCanonicalBase64Secret(
    environment.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1,
  )
  if (
    environment.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS !==
    undefined
  ) {
    requireCanonicalBase64Secret(
      environment.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS,
    )
  }
  requireCanonicalBase64Secret(
    environment.ADVOCATE_PUBLICATION_CANARY_SECRET_V1,
    32,
  )

  createPublicationCanaryToken(
    {
      runId: "11111111-1111-4111-8111-111111111111",
      advocateId: "22222222-2222-4222-8222-222222222222",
      domainId: "33333333-3333-4333-8333-333333333333",
      hostname: "release-preflight.creatorshare.com",
      advocateVersion: 1,
      deploymentId: "release-preflight",
      revision: "0".repeat(40),
      ttlSeconds: 1,
    },
    {
      environment,
      now: () => 1_000,
      randomBytes: () => new Uint8Array(32),
    },
  )
}

function secretSeparationState(
  environment: AdvocateReleasePreflightEnvironment,
): AdvocateReleasePreflightConfigurationState {
  const publicValues = new Set(
    Object.entries(environment)
      .filter(
        ([name, value]) =>
          name.startsWith("NEXT_PUBLIC_") &&
          value !== undefined &&
          value !== "",
      )
      .map(([, value]) => value as string),
  )
  const seenPublicCredentials = new Set<string>()
  for (const name of PUBLIC_CREDENTIAL_ENVIRONMENT_NAMES) {
    const value = environment[name]
    if (value === undefined || value === "") continue
    if (seenPublicCredentials.has(value)) return "invalid"
    seenPublicCredentials.add(value)
  }
  const seenPrivateValues = new Set<string>()
  for (const name of PRIVATE_SECRET_ENVIRONMENT_NAMES) {
    const value = environment[name]
    if (value === undefined || value === "") continue
    if (seenPrivateValues.has(value) || publicValues.has(value))
      return "invalid"
    seenPrivateValues.add(value)
  }
  return REQUIRED_PRIVATE_SECRET_ENVIRONMENT_NAMES.some((name) =>
    isMissing(environment, name),
  )
    ? "unverified"
    : "configured"
}

function overallConfigurationState(
  checks: readonly AdvocateReleasePreflightCheck[],
): AdvocateReleasePreflightConfigurationState {
  if (checks.some((check) => check.state === "invalid")) return "invalid"
  if (checks.some((check) => check.state === "unverified")) return "unverified"
  return "configured"
}

export function runAdvocateReleasePreflight(
  environment: AdvocateReleasePreflightEnvironment = process.env,
): AdvocateReleasePreflightResult {
  const checks: readonly AdvocateReleasePreflightCheck[] = Object.freeze([
    evaluateCheck({
      environment,
      name: "deployment_identity",
      required: [
        "NODE_ENV",
        "VERCEL",
        "VERCEL_ENV",
        "VERCEL_DEPLOYMENT_ID",
        "VERCEL_GIT_COMMIT_SHA",
      ],
      validate: () => validateDeploymentIdentity(environment),
    }),
    evaluateCheck({
      environment,
      name: "provider_automation_gate",
      required: ["ADVOCATE_PROVIDER_AUTOMATION_MODE"],
      validate: () => {
        if (loadProviderAutomationMode(environment) !== "active") {
          throw new Error("release_preflight_configuration_invalid")
        }
      },
    }),
    evaluateCheck({
      environment,
      name: "cross_subdomain_cookie_trust",
      required: [
        CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE,
        COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE,
      ],
      validate: () => {
        const trustGate = evaluateCrossSubdomainCookieTrustGate(environment)
        if (trustGate.state !== "active" || trustGate.reason !== "active") {
          throw new Error("release_preflight_configuration_invalid")
        }
      },
    }),
    Object.freeze({
      name: "cross_subdomain_cookie_trusted_collector",
      state: "unverified",
    }),
    Object.freeze({
      name: "cross_subdomain_cookie_fresh_provider_evidence",
      state: "unverified",
    }),
    evaluateCheck({
      environment,
      name: "supabase_configuration",
      required: [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET",
      ],
      validate: () => validateSupabaseConfiguration(environment),
    }),
    evaluateCheck({
      environment,
      name: "worker_configuration",
      required: ["CRON_SECRET"],
      validate: () => validateWorkerConfiguration(environment),
    }),
    evaluateCheck({
      environment,
      name: "email_configuration",
      required: [
        "NEXT_PUBLIC_BASE_URL",
        "EMAIL_HOST",
        "EMAIL_USER",
        "EMAIL_PASSWORD",
        "EMAIL_FROM",
      ],
      validate: () => validateEmailConfiguration(environment),
    }),
    evaluateCheck({
      environment,
      name: "cloudflare_configuration",
      required: [
        "ADVOCATE_CLOUDFLARE_API_TOKEN",
        "ADVOCATE_CLOUDFLARE_ZONE_ID",
        "ADVOCATE_CLOUDFLARE_CNAME_TARGET",
      ],
      validate: () => loadCloudflareProvisioningConfig(environment),
    }),
    evaluateCheck({
      environment,
      name: "vercel_configuration",
      required: ["ADVOCATE_VERCEL_API_TOKEN", "ADVOCATE_VERCEL_PROJECT_ID"],
      validate: () => loadVercelProvisioningConfig(environment),
    }),
    evaluateCheck({
      environment,
      name: "stripe_us_configuration",
      required: [
        "STRIPE_DEFAULT_REGION",
        "STRIPE_SECRET_KEY_US",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US",
        "STRIPE_WEBHOOK_SECRET_US",
        "NEXT_PUBLIC_STRIPE_PORTAL_URL_US",
        "STRIPE_BILLING_PORTAL_CONFIGURATION_ID_US",
        "ADVOCATE_STRIPE_CANARY_RECURRING_PRICE_ID_US",
      ],
      validate: () => validateStripeConfiguration("US", environment),
    }),
    evaluateCheck({
      environment,
      name: "stripe_uk_configuration",
      required: [
        "STRIPE_SECRET_KEY_UK",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK",
        "STRIPE_WEBHOOK_SECRET_UK",
        "NEXT_PUBLIC_STRIPE_PORTAL_URL_UK",
        "STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK",
        "ADVOCATE_STRIPE_CANARY_RECURRING_PRICE_ID_UK",
      ],
      validate: () => validateStripeConfiguration("UK", environment),
    }),
    evaluateCheck({
      environment,
      name: "paypal_configuration",
      required: [
        "NEXT_PUBLIC_PAYPAL_CLIENT_ID",
        "PAYPAL_CLIENT_SECRET",
        "PAYPAL_WEBHOOK_ID",
        "ADVOCATE_PAYPAL_CANARY_RECURRING_PLAN_ID",
      ],
      validate: () => loadPublicationPaymentCanaryConfig("paypal", environment),
    }),
    evaluateCheck({
      environment,
      name: "cryptographic_configuration",
      required: [
        "ADVOCATE_PUBLICATION_CANARY_SECRET_V1",
        "SPONSORSHIP_CRYPTO_SECRET_V1",
        "SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1",
        "ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1",
        "SPONSORSHIP_VISITOR_COOKIE_SECRET_V1",
        "ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1",
      ],
      validate: () => validateCryptographicConfiguration(environment),
    }),
    Object.freeze({
      name: "secret_separation",
      state: secretSeparationState(environment),
    }),
  ])

  return Object.freeze({
    schemaVersion: 1,
    configurationState: overallConfigurationState(checks),
    providerReadiness: "not_probed",
    checks,
  })
}
