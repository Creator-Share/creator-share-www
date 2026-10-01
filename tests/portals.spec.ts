import { expect, test } from "@playwright/test"

import {
  buildPublicPortalLinks,
  buildStripePortalLinks,
  DEFAULT_STRIPE_PORTAL_URL,
  normalizePublicStripePortalUrl,
  PAYPAL_SANDBOX_MANAGE_URL,
} from "../src/lib/payments/portals"

test.describe("public portal links", () => {
  test("uses one generic Stripe link when no region portal URLs are configured", () => {
    expect(buildStripePortalLinks({ us: undefined, uk: undefined })).toEqual([
      {
        provider: "STRIPE",
        href: DEFAULT_STRIPE_PORTAL_URL,
        label: "Manage Subscription",
      },
    ])
  })

  test("dedupes region portal URLs that point to the same destination", () => {
    expect(
      buildStripePortalLinks({
        us: "https://billing.stripe.com/p/login/shared",
        uk: "https://billing.stripe.com/p/login/shared",
      }),
    ).toEqual([
      {
        provider: "STRIPE",
        href: "https://billing.stripe.com/p/login/shared",
        label: "Manage Subscription",
      },
    ])
  })

  test("labels Stripe portal links by region only when destinations differ", () => {
    expect(
      buildStripePortalLinks({
        us: "https://billing.stripe.com/p/login/us",
        uk: "https://billing.stripe.com/p/login/uk",
      }),
    ).toEqual([
      {
        provider: "STRIPE",
        region: "us",
        href: "https://billing.stripe.com/p/login/us",
        label: "Manage Subscription (US)",
      },
      {
        provider: "STRIPE",
        region: "uk",
        href: "https://billing.stripe.com/p/login/uk",
        label: "Manage Subscription (UK)",
      },
    ])
  })

  test("accepts only canonical approved HTTPS portal destinations", () => {
    expect(
      normalizePublicStripePortalUrl(
        "https://billing.stripe.com/p/login/approved",
      ),
    ).toBe("https://billing.stripe.com/p/login/approved")
    expect(
      normalizePublicStripePortalUrl("https://stripe.creatorshare.com"),
    ).toBe("https://stripe.creatorshare.com/")

    for (const unsafe of [
      "http://billing.stripe.com/p/login/unsafe",
      "https://billing.example.com/p/login/unsafe",
      "https://user:pass@billing.stripe.com/p/login/unsafe",
      "https://billing.stripe.com:8443/p/login/unsafe",
      "https://billing.stripe.com/p/login/unsafe?next=evil",
      "https://billing.stripe.com/p/login/unsafe#fragment",
      'https://billing.stripe.com/p/login/safe" onmouseover="unsafe',
      " https://billing.stripe.com/p/login/unsafe",
      "https:\\billing.stripe.com\\p\\login\\unsafe",
    ]) {
      expect(normalizePublicStripePortalUrl(unsafe), unsafe).toBeNull()
    }
  })

  test("drops malformed configured destinations instead of rendering them", () => {
    expect(
      buildStripePortalLinks({
        us: 'https://billing.stripe.com/p/login/safe" onclick="unsafe',
        uk: "https://billing.example.com/p/login/unsafe",
      }),
    ).toEqual([
      {
        provider: "STRIPE",
        href: DEFAULT_STRIPE_PORTAL_URL,
        label: "Manage Subscription",
      },
    ])
  })

  test("never exposes production Stripe portals from exact staging", () => {
    expect(
      buildPublicPortalLinks({
        environment: {
          NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
        },
        paypalConfigured: true,
        stripePortalUrls: {
          us: "https://billing.stripe.com/p/login/copied-production-us",
          uk: "https://stripe.creatorshare.com",
        },
      }),
    ).toEqual([
      {
        provider: "PAYPAL",
        href: PAYPAL_SANDBOX_MANAGE_URL,
        label: "Manage in PayPal",
      },
    ])
  })
})
