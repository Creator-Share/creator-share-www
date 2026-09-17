import { expect, test } from "@playwright/test"

import { assertUnambiguousStripeWebhookSecrets } from "../../src/lib/stripe/config"

const US_CURRENT = "whsec_us_current_123456789"
const US_PREVIOUS = "whsec_us_previous_1234567"
const UK_CURRENT = "whsec_uk_current_123456789"

test.describe("Stripe webhook signing topology", () => {
  test("accepts current and previous secrets owned by one regional account", () => {
    expect(() =>
      assertUnambiguousStripeWebhookSecrets([
        { region: "us", secret: US_CURRENT, version: "current" },
        { region: "us", secret: US_PREVIOUS, version: "previous" },
        { region: "uk", secret: UK_CURRENT, version: "current" },
      ]),
    ).not.toThrow()
  })

  test("rejects a signing secret shared by two regional accounts", () => {
    expect(() =>
      assertUnambiguousStripeWebhookSecrets([
        { region: "us", secret: US_CURRENT, version: "current" },
        { region: "uk", secret: US_CURRENT, version: "previous" },
      ]),
    ).toThrow("Stripe webhook signing configuration is ambiguous")
  })

  test("rejects malformed candidates without exposing their values", () => {
    let message = ""
    try {
      assertUnambiguousStripeWebhookSecrets([
        { region: "us", secret: "leaked bad secret", version: "current" },
      ])
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe("Stripe webhook signing configuration is invalid")
    expect(message).not.toContain("leaked")
  })
})
