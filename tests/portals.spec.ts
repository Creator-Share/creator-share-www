import { expect, test } from "@playwright/test"

import {
  buildStripePortalLinks,
  DEFAULT_STRIPE_PORTAL_URL,
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
        us: "https://stripe.example.com/portal",
        uk: "https://stripe.example.com/portal",
      }),
    ).toEqual([
      {
        provider: "STRIPE",
        href: "https://stripe.example.com/portal",
        label: "Manage Subscription",
      },
    ])
  })

  test("labels Stripe portal links by region only when destinations differ", () => {
    expect(
      buildStripePortalLinks({
        us: "https://stripe.example.com/us",
        uk: "https://stripe.example.com/uk",
      }),
    ).toEqual([
      {
        provider: "STRIPE",
        region: "us",
        href: "https://stripe.example.com/us",
        label: "Manage Subscription (US)",
      },
      {
        provider: "STRIPE",
        region: "uk",
        href: "https://stripe.example.com/uk",
        label: "Manage Subscription (UK)",
      },
    ])
  })
})
