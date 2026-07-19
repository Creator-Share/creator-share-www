import { DomainProvisioningError } from "./types"

export interface CloudflareProvisioningConfig {
  apiToken: string
  zoneId: string
  cnameTarget: string
  ttl: number
  requestTimeoutMs: number
}

export interface VercelProvisioningConfig {
  apiToken: string
  projectId: string
  teamId?: string
  requestTimeoutMs: number
}

export type StripePaymentPathProvider = "stripe_us" | "stripe_uk"

export interface StripePaymentPathConfig {
  provider: StripePaymentPathProvider
  secretKey: string
  publishableKey: string
  webhookSecret: string
  requestTimeoutMs: number
}

export interface PayPalPaymentPathConfig {
  provider: "paypal"
  clientId: string
  clientSecret: string
  webhookId: string
  requestTimeoutMs: number
}

export interface StripePublicationPaymentCanaryConfig {
  provider: StripePaymentPathProvider
  secretKey: string
  recurringPriceId: string
  requestTimeoutMs: number
}

export interface PayPalPublicationPaymentCanaryConfig {
  provider: "paypal"
  clientId: string
  clientSecret: string
  recurringPlanId: string
  requestTimeoutMs: number
}

export type PublicationPaymentCanaryConfig =
  StripePublicationPaymentCanaryConfig | PayPalPublicationPaymentCanaryConfig

export interface DomainWorkerConfig {
  batchSize: number
  reconciliationBatchSize: number
  leaseSeconds: number
}

export type ProvisioningEnvironment = Readonly<
  Record<string, string | undefined>
>

const DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const PUBLICATION_PAYMENT_CANARY_MAX_TIMEOUT_MS = 15_000

function configurationError(cause?: unknown): DomainProvisioningError {
  return new DomainProvisioningError({
    code: "worker_configuration_invalid",
    retryable: false,
    cause,
  })
}

function requireSecret(
  env: ProvisioningEnvironment,
  key: string,
  minimumLength = 20,
): string {
  const value = env[key]
  if (
    typeof value !== "string" ||
    value.length < minimumLength ||
    value.length > 2048 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f\s]/.test(value)
  ) {
    throw configurationError()
  }
  return value
}

function requireCredential(
  env: ProvisioningEnvironment,
  key: string,
  pattern: RegExp,
  minimumLength = 20,
): string {
  const value = requireSecret(env, key, minimumLength)
  if (!pattern.test(value)) throw configurationError()
  return value
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw configurationError()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw configurationError()
  }
  return parsed
}

function normalizeDnsHostname(value: string | undefined): string {
  if (!value) throw configurationError()
  const normalized = value.toLowerCase().replace(/\.$/, "")
  if (
    normalized !== value.toLowerCase() ||
    !DNS_HOSTNAME_PATTERN.test(normalized)
  ) {
    throw configurationError()
  }
  return normalized
}

export function loadCloudflareProvisioningConfig(
  env: ProvisioningEnvironment = process.env,
): CloudflareProvisioningConfig {
  const zoneId = env.ADVOCATE_CLOUDFLARE_ZONE_ID
  if (!zoneId || !/^[0-9a-f]{32}$/i.test(zoneId)) {
    throw configurationError()
  }

  return {
    apiToken: requireSecret(env, "ADVOCATE_CLOUDFLARE_API_TOKEN"),
    zoneId,
    cnameTarget: normalizeDnsHostname(env.ADVOCATE_CLOUDFLARE_CNAME_TARGET),
    ttl: parseBoundedInteger(
      env.ADVOCATE_CLOUDFLARE_TTL_SECONDS,
      300,
      60,
      86400,
    ),
    requestTimeoutMs: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_REQUEST_TIMEOUT_MS,
      15_000,
      1_000,
      60_000,
    ),
  }
}

export function loadVercelProvisioningConfig(
  env: ProvisioningEnvironment = process.env,
): VercelProvisioningConfig {
  const projectId = env.ADVOCATE_VERCEL_PROJECT_ID
  const teamId = env.ADVOCATE_VERCEL_TEAM_ID

  if (!projectId || !/^prj_[A-Za-z0-9]{8,128}$/.test(projectId)) {
    throw configurationError()
  }
  if (teamId && !/^team_[A-Za-z0-9]{8,128}$/.test(teamId)) {
    throw configurationError()
  }

  return {
    apiToken: requireSecret(env, "ADVOCATE_VERCEL_API_TOKEN"),
    projectId,
    ...(teamId ? { teamId } : {}),
    requestTimeoutMs: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_REQUEST_TIMEOUT_MS,
      15_000,
      1_000,
      60_000,
    ),
  }
}

export function loadStripePaymentPathConfig(
  provider: StripePaymentPathProvider,
  env: ProvisioningEnvironment = process.env,
): StripePaymentPathConfig {
  const suffix = provider === "stripe_us" ? "US" : "UK"

  return {
    provider,
    secretKey: requireCredential(
      env,
      `STRIPE_SECRET_KEY_${suffix}`,
      /^sk_live_[A-Za-z0-9_]+$/,
    ),
    publishableKey: requireCredential(
      env,
      `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_${suffix}`,
      /^pk_live_[A-Za-z0-9_]+$/,
    ),
    webhookSecret: requireCredential(
      env,
      `STRIPE_WEBHOOK_SECRET_${suffix}`,
      /^whsec_[A-Za-z0-9_]+$/,
    ),
    requestTimeoutMs: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_REQUEST_TIMEOUT_MS,
      15_000,
      1_000,
      60_000,
    ),
  }
}

export function loadPayPalPaymentPathConfig(
  env: ProvisioningEnvironment = process.env,
): PayPalPaymentPathConfig {
  if (
    env.PAYPAL_API_URL !== undefined &&
    env.PAYPAL_API_URL !== "https://api-m.paypal.com"
  ) {
    throw configurationError()
  }

  const clientId = requireCredential(
    env,
    "NEXT_PUBLIC_PAYPAL_CLIENT_ID",
    /^[A-Za-z0-9_-]+$/,
  )
  if (env.PAYPAL_CLIENT_ID !== undefined && env.PAYPAL_CLIENT_ID !== clientId) {
    throw configurationError()
  }

  return {
    provider: "paypal",
    clientId,
    clientSecret: requireCredential(
      env,
      "PAYPAL_CLIENT_SECRET",
      /^[A-Za-z0-9_-]+$/,
    ),
    webhookId: requireCredential(
      env,
      "PAYPAL_WEBHOOK_ID",
      /^[A-Za-z0-9_-]+$/,
      8,
    ),
    requestTimeoutMs: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_REQUEST_TIMEOUT_MS,
      15_000,
      1_000,
      60_000,
    ),
  }
}

export function loadPublicationPaymentCanaryConfig(
  provider: StripePaymentPathProvider,
  env?: ProvisioningEnvironment,
): StripePublicationPaymentCanaryConfig
export function loadPublicationPaymentCanaryConfig(
  provider: "paypal",
  env?: ProvisioningEnvironment,
): PayPalPublicationPaymentCanaryConfig
export function loadPublicationPaymentCanaryConfig(
  provider: StripePaymentPathProvider | "paypal",
  env: ProvisioningEnvironment = process.env,
): PublicationPaymentCanaryConfig {
  if (provider === "paypal") {
    const paymentPath = loadPayPalPaymentPathConfig(env)
    return {
      provider,
      clientId: paymentPath.clientId,
      clientSecret: paymentPath.clientSecret,
      recurringPlanId: requireCredential(
        env,
        "ADVOCATE_PAYPAL_CANARY_RECURRING_PLAN_ID",
        /^P-[A-Z0-9]{24}$/,
        26,
      ),
      requestTimeoutMs: Math.min(
        paymentPath.requestTimeoutMs,
        PUBLICATION_PAYMENT_CANARY_MAX_TIMEOUT_MS,
      ),
    }
  }

  const paymentPath = loadStripePaymentPathConfig(provider, env)
  const suffix = provider === "stripe_us" ? "US" : "UK"
  return {
    provider,
    secretKey: paymentPath.secretKey,
    recurringPriceId: requireCredential(
      env,
      `ADVOCATE_STRIPE_CANARY_RECURRING_PRICE_ID_${suffix}`,
      /^price_[A-Za-z0-9]+$/,
    ),
    requestTimeoutMs: Math.min(
      paymentPath.requestTimeoutMs,
      PUBLICATION_PAYMENT_CANARY_MAX_TIMEOUT_MS,
    ),
  }
}

export function loadDomainWorkerConfig(
  env: ProvisioningEnvironment = process.env,
): DomainWorkerConfig {
  return {
    batchSize: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_BATCH_SIZE,
      3,
      1,
      10,
    ),
    reconciliationBatchSize: parseBoundedInteger(
      env.ADVOCATE_RECONCILIATION_BATCH_SIZE,
      20,
      1,
      100,
    ),
    leaseSeconds: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_LEASE_SECONDS,
      300,
      30,
      900,
    ),
  }
}

export function loadWorkerRouteSecret(
  env: ProvisioningEnvironment = process.env,
): string {
  const dedicated = env.ADVOCATE_PROVISIONING_WORKER_SECRET
  const selected =
    dedicated === undefined || dedicated === "" ? env.CRON_SECRET : dedicated

  return requireSecret(
    { ADVOCATE_PROVISIONING_WORKER_SECRET: selected },
    "ADVOCATE_PROVISIONING_WORKER_SECRET",
    32,
  )
}
