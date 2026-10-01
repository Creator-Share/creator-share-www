import { isAdvocateStagingEnvironmentEnabled } from "../../advocates/host"

export type StagingPaymentEnvironment = Readonly<
  Record<string, string | undefined>
>

export const ADVOCATE_STAGING_PAYPAL_API_ORIGIN =
  "https://api-m.sandbox.paypal.com"

const STRIPE_SERVER_KEY_NAMES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_SECRET_KEY_US",
  "STRIPE_SECRET_KEY_UK",
] as const

const STRIPE_PUBLISHABLE_KEY_NAMES = [
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK",
] as const

function isRecognizedStripeTestServerKey(value: string): boolean {
  return (
    /^(?:sk|rk)_test_/.test(value) &&
    value.length > "sk_test_".length &&
    !/\s/.test(value)
  )
}

export function isRecognizedStripeTestPublishableKey(value: string): boolean {
  return (
    value.startsWith("pk_test_") &&
    value.length > "pk_test_".length &&
    !/\s/.test(value)
  )
}

function stripeMode(
  value: string,
  prefix: "pk" | "cs",
): "test" | "live" | null {
  if (value !== value.trim() || value.length > 4_096 || /\s/.test(value)) {
    return null
  }
  if (value.startsWith(`${prefix}_test_`)) return "test"
  if (value.startsWith(`${prefix}_live_`)) return "live"
  return null
}

export function isAllowedEmbeddedStripeCheckoutMaterial(options: {
  clientSecret: string
  environment: StagingPaymentEnvironment
  publishableKey: string
}): boolean {
  const publishableMode = stripeMode(options.publishableKey, "pk")
  const clientSecretMode = stripeMode(options.clientSecret, "cs")
  if (
    publishableMode === null ||
    clientSecretMode === null ||
    publishableMode !== clientSecretMode
  ) {
    return false
  }

  const configuredPublishableKeys = new Set(
    [
      options.environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      options.environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US,
      options.environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK,
    ].filter((value): value is string => Boolean(value)),
  )
  if (!configuredPublishableKeys.has(options.publishableKey)) return false

  return (
    !isAdvocateStagingEnvironmentEnabled(options.environment) ||
    publishableMode === "test"
  )
}

/**
 * Exact advocate staging may never inherit a live or unrecognized Stripe key.
 * Empty keys remain governed by the existing per-region configuration checks.
 */
export function assertStagingStripePaymentEnvironment(
  environment: StagingPaymentEnvironment = process.env,
): void {
  if (!isAdvocateStagingEnvironmentEnabled(environment)) return

  for (const name of STRIPE_SERVER_KEY_NAMES) {
    const value = environment[name]
    if (value && !isRecognizedStripeTestServerKey(value)) {
      throw new Error(
        `Advocate staging requires a recognized Stripe test-mode server key in ${name}`,
      )
    }
  }

  for (const name of STRIPE_PUBLISHABLE_KEY_NAMES) {
    const value = environment[name]
    if (value && !isRecognizedStripeTestPublishableKey(value)) {
      throw new Error(
        `Advocate staging requires a recognized Stripe test-mode publishable key in ${name}`,
      )
    }
  }
}

/**
 * Exact advocate staging has one allowed PayPal environment. Missing, live,
 * malformed, and lookalike API origins are rejected before checkout work.
 */
export function assertStagingPayPalPaymentEnvironment(
  environment: StagingPaymentEnvironment = process.env,
): void {
  if (!isAdvocateStagingEnvironmentEnabled(environment)) return
  if (environment.PAYPAL_API_URL !== ADVOCATE_STAGING_PAYPAL_API_ORIGIN) {
    throw new Error(
      "Advocate staging requires the exact PayPal sandbox API origin",
    )
  }
}
