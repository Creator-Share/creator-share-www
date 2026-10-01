import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { getPayPalApiUrl } from "../../src/lib/paypal/client"
import {
  ADVOCATE_STAGING_PAYPAL_API_ORIGIN,
  assertStagingPayPalPaymentEnvironment,
  assertStagingStripePaymentEnvironment,
  isAllowedEmbeddedStripeCheckoutMaterial,
  type StagingPaymentEnvironment,
} from "../../src/lib/sponsorships/checkout/stagingPaymentBoundary"
import { getStripeConfig } from "../../src/lib/stripe/config"

const STAGING_ORIGIN = "https://advocate-staging.creatorshare.com"

test.describe.configure({ mode: "serial" })

function stagingEnvironment(
  overrides: StagingPaymentEnvironment = {},
): StagingPaymentEnvironment {
  return {
    NEXT_PUBLIC_BASE_URL: STAGING_ORIGIN,
    STRIPE_SECRET_KEY_US: "sk_test_us_safe",
    STRIPE_SECRET_KEY_UK: "rk_test_uk_safe",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: "pk_test_us_safe",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK: "pk_test_uk_safe",
    PAYPAL_API_URL: ADVOCATE_STAGING_PAYPAL_API_ORIGIN,
    ...overrides,
  }
}

test.describe("advocate staging payment boundary", () => {
  test("accepts only recognized Stripe test-mode keys in exact staging", () => {
    expect(() =>
      assertStagingStripePaymentEnvironment(stagingEnvironment()),
    ).not.toThrow()
    expect(() =>
      assertStagingStripePaymentEnvironment({
        NEXT_PUBLIC_BASE_URL: STAGING_ORIGIN,
      }),
    ).not.toThrow()

    for (const unsafe of [
      { STRIPE_SECRET_KEY_US: "sk_live_us_unsafe" },
      { STRIPE_SECRET_KEY_UK: "unrecognized_server_key" },
      { STRIPE_SECRET_KEY: "rk_live_legacy_unsafe" },
      { STRIPE_SECRET_KEY_US: "sk_test_trailing-newline\n" },
      {
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: "pk_live_us_unsafe",
      },
      {
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK: "unrecognized_publishable_key",
      },
      {
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_legacy_unsafe",
      },
      {
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: " pk_test_leading-space",
      },
    ]) {
      expect(() =>
        assertStagingStripePaymentEnvironment(
          stagingEnvironment(unsafe as StagingPaymentEnvironment),
        ),
      ).toThrow(/Stripe test-mode/)
    }
  })

  test("requires the exact PayPal sandbox API origin in exact staging", () => {
    expect(() =>
      assertStagingPayPalPaymentEnvironment(stagingEnvironment()),
    ).not.toThrow()

    for (const PAYPAL_API_URL of [
      undefined,
      "https://api-m.paypal.com",
      `${ADVOCATE_STAGING_PAYPAL_API_ORIGIN}/`,
      "https://api-m.sandbox.paypal.com.example.test",
    ]) {
      expect(() =>
        assertStagingPayPalPaymentEnvironment(
          stagingEnvironment({ PAYPAL_API_URL }),
        ),
      ).toThrow(/exact PayPal sandbox API origin/)
    }
  })

  test("does not change production or lookalike deployment behavior", () => {
    for (const NEXT_PUBLIC_BASE_URL of [
      "https://creatorshare.com",
      "https://www.creatorshare.com",
      "https://canary.advocate-staging.creatorshare.com",
      "https://advocate-staging.creatorshare.com.example.test",
      undefined,
    ]) {
      const environment = {
        NEXT_PUBLIC_BASE_URL,
        STRIPE_SECRET_KEY_US: "sk_live_production",
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: "pk_live_production",
        PAYPAL_API_URL: "https://api-m.paypal.com",
      }
      expect(() =>
        assertStagingStripePaymentEnvironment(environment),
      ).not.toThrow()
      expect(() =>
        assertStagingPayPalPaymentEnvironment(environment),
      ).not.toThrow()
    }
  })

  test("shared provider helpers enforce the staging boundary", async () => {
    const [stripeConfigSource, paypalClientSource] = await Promise.all([
      readFile(resolve(process.cwd(), "src/lib/stripe/config.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/lib/paypal/client.ts"), "utf8"),
    ])

    const stripeConfigFunction = stripeConfigSource.slice(
      stripeConfigSource.indexOf("export function getStripeConfig"),
      stripeConfigSource.indexOf("export function getStripeClient"),
    )
    expect(stripeConfigFunction).toContain(
      "assertStagingStripePaymentEnvironment(process.env)",
    )

    const paypalApiUrlFunction = paypalClientSource.slice(
      paypalClientSource.indexOf("export function getPayPalApiUrl"),
      paypalClientSource.indexOf("function getClientCredentials"),
    )
    expect(paypalApiUrlFunction).toContain(
      "assertStagingPayPalPaymentEnvironment(process.env)",
    )
  })

  test("shared provider helpers reject unsafe exact staging at runtime", () => {
    const original = {
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
      PAYPAL_API_URL: process.env.PAYPAL_API_URL,
      STRIPE_SECRET_KEY_US: process.env.STRIPE_SECRET_KEY_US,
    }
    try {
      process.env.NEXT_PUBLIC_BASE_URL = STAGING_ORIGIN
      process.env.PAYPAL_API_URL = ADVOCATE_STAGING_PAYPAL_API_ORIGIN
      expect(getPayPalApiUrl()).toBe(ADVOCATE_STAGING_PAYPAL_API_ORIGIN)

      process.env.PAYPAL_API_URL = "https://api-m.paypal.com"
      expect(() => getPayPalApiUrl()).toThrow(/exact PayPal sandbox API origin/)

      process.env.STRIPE_SECRET_KEY_US = "sk_live_staging_unsafe"
      expect(() => getStripeConfig("us")).toThrow(/Stripe test-mode/)
    } finally {
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  test("checkout routes reject unsafe staging before database or provider work", async () => {
    const [stripeRouteSource, paypalRouteSource] = await Promise.all([
      readFile(resolve(process.cwd(), "src/app/api/stripe/route.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/app/api/paypal/route.ts"), "utf8"),
    ])

    const stripePost = stripeRouteSource.slice(
      stripeRouteSource.indexOf("export async function POST"),
    )
    const stripeBoundary = stripePost.indexOf(
      "assertStagingStripePaymentEnvironment(process.env)",
    )
    expect(stripeBoundary).toBeGreaterThan(-1)
    expect(stripeBoundary).toBeLessThan(
      stripePost.indexOf("createServiceRoleClient()"),
    )
    expect(stripeBoundary).toBeLessThan(
      stripePost.indexOf("authenticatedCheckoutUser()"),
    )
    expect(stripeBoundary).toBeLessThan(
      stripePost.indexOf("createStripeSponsorshipCheckoutV2("),
    )

    const paypalPost = paypalRouteSource.slice(
      paypalRouteSource.indexOf("export async function POST"),
    )
    const paypalBoundary = paypalPost.indexOf(
      "assertStagingPayPalPaymentEnvironment(process.env)",
    )
    expect(paypalBoundary).toBeGreaterThan(-1)
    expect(paypalBoundary).toBeLessThan(
      paypalPost.indexOf("createServiceRoleClient()"),
    )
    expect(paypalBoundary).toBeLessThan(
      paypalPost.indexOf("authenticatedCheckoutUser()"),
    )
    expect(paypalBoundary).toBeLessThan(
      paypalPost.indexOf("createPayPalSponsorshipCheckoutV2("),
    )
    expect(paypalBoundary).toBeLessThan(
      paypalPost.indexOf("capturePayPalSponsorshipCheckoutV2("),
    )
  })

  test("embedded checkout accepts only configured same-mode Stripe material", () => {
    const environment = stagingEnvironment()
    expect(
      isAllowedEmbeddedStripeCheckoutMaterial({
        clientSecret: "cs_test_checkout_secret",
        environment,
        publishableKey: "pk_test_us_safe",
      }),
    ).toBe(true)

    for (const candidate of [
      {
        clientSecret: "cs_live_checkout_secret",
        publishableKey: "pk_test_us_safe",
      },
      {
        clientSecret: "cs_test_checkout_secret",
        publishableKey: "pk_live_production",
      },
      {
        clientSecret: "cs_test_checkout_secret",
        publishableKey: "pk_test_attacker_account",
      },
    ]) {
      expect(
        isAllowedEmbeddedStripeCheckoutMaterial({
          ...candidate,
          environment,
        }),
      ).toBe(false)
    }

    expect(
      isAllowedEmbeddedStripeCheckoutMaterial({
        clientSecret: "cs_live_checkout_secret",
        environment: {
          NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: "pk_live_production",
        },
        publishableKey: "pk_live_production",
      }),
    ).toBe(true)
  })

  test("build and browser initialization enforce the staging payment boundary", async () => {
    const [nextConfig, checkoutSource, stripeWebhookSource] = await Promise.all(
      [
        readFile(resolve(process.cwd(), "next.config.ts"), "utf8"),
        readFile(
          resolve(
            process.cwd(),
            "src/app/sponsorships/checkout/CheckoutContent.tsx",
          ),
          "utf8",
        ),
        readFile(
          resolve(process.cwd(), "src/app/api/webhooks/stripe/handler.ts"),
          "utf8",
        ),
      ],
    )
    expect(nextConfig).toContain(
      "assertStagingStripePaymentEnvironment(process.env)",
    )
    expect(nextConfig).toContain(
      "assertStagingPayPalPaymentEnvironment(process.env)",
    )
    expect(checkoutSource).toContain(
      "isAllowedEmbeddedStripeCheckoutMaterial({",
    )
    expect(
      checkoutSource.indexOf("isAllowedEmbeddedStripeCheckoutMaterial({"),
    ).toBeLessThan(
      checkoutSource.indexOf("setPublishableKey(candidatePublishableKey)"),
    )
    expect(stripeWebhookSource).not.toContain(
      "process.env.NEXT_PUBLIC_SITE_URL",
    )
    expect(stripeWebhookSource).toContain("getSponsorClaimCanonicalOrigin()")
  })
})
