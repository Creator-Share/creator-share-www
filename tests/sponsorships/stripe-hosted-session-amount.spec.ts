import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type { HostedStripeSessionInput } from "@/lib/sponsorships/checkout/stripeCheckout"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/stripe-hosted-session-amount.spec.ts",
  ),
)
const { buildHostedStripeSessionParams } = testRequire(
  "../../src/lib/sponsorships/checkout/stripeCheckout",
) as typeof import("../../src/lib/sponsorships/checkout/stripeCheckout")
nodeModule._load = originalModuleLoad

/**
 * The amount Creator Share asks Stripe to charge.
 *
 * A mutation campaign found that multiplying every hosted line item by one
 * hundred left the entire required suite green. Two specs import this builder
 * and both assert `mode`, `ui_mode`, `return_url`, and `metadata`; neither
 * asserts `unit_amount`, and `unit_amount` appears nowhere else in the suite
 * except an inbound webhook fixture that is never compared with what the
 * builder produced.
 *
 * That is the one number the sponsor actually pays. The database issues an
 * authoritative quote, the intent, attempt, and sealed provider request all
 * record it, and this function is the single place it crosses to the provider.
 * A scaling or rounding error here charges the wrong amount while every stored
 * record still shows the right one, so reconciliation compares a settled
 * amount that can never match.
 */

function sessionInput(
  overrides: Partial<HostedStripeSessionInput> = {},
): HostedStripeSessionInput {
  return {
    idempotencyKey: "idem_hosted_amount",
    customerEmail: "sponsor@example.com",
    productName: "Sponsorship",
    productImageUrl: null,
    sponsorshipIntentId: "44444444-4444-4444-8444-444444444444",
    paymentAttemptId: "55555555-5555-4555-8555-555555555555",
    providerAccountScope: "stripe_us",
    paymentMode: "one_time",
    recurrenceInterval: null,
    chargedAmountMinor: 2_466,
    chargedCurrency: "GBP",
    checkoutBaseUrl: "https://creatorshare.com",
    stripeRegion: "uk",
    expiresAtUnixSeconds: 1_800_000_000,
    ...overrides,
  }
}

function onlyLineItem(input: HostedStripeSessionInput) {
  const params = buildHostedStripeSessionParams(input)
  const lineItems = params.line_items ?? []
  expect(lineItems).toHaveLength(1)
  const priceData = lineItems[0]?.price_data
  if (!priceData) throw new Error("hosted session produced no price data")
  return { params, lineItem: lineItems[0], priceData }
}

test.describe("hosted Stripe session amount fidelity", () => {
  test("charges exactly the authoritative minor amount, unscaled", async () => {
    const input = sessionInput({ chargedAmountMinor: 2_466 })
    const { priceData, lineItem } = onlyLineItem(input)

    // The decisive assertion. 2466 minor units is £24.66; any scaling here
    // charges a sponsor an amount no stored record agrees with.
    expect(priceData.unit_amount).toBe(2_466)
    // Quantity participates in the total, so asserting the unit alone would
    // still permit a doubled charge.
    expect(lineItem.quantity).toBe(1)
  })

  test("carries every amount through without rounding or scaling", async () => {
    // A single amount can pass by coincidence. These span the rounding-prone
    // cases: the smallest chargeable unit, a non-round value, and a large one.
    for (const amount of [1, 99, 2_466, 12_000, 999_999]) {
      const { priceData, lineItem } = onlyLineItem(
        sessionInput({ chargedAmountMinor: amount }),
      )
      expect(
        priceData.unit_amount,
        `amount ${amount} must cross unchanged`,
      ).toBe(amount)
      expect(lineItem.quantity).toBe(1)
    }
  })

  test("sends the authoritative currency, lowercased for the provider", async () => {
    const gbp = onlyLineItem(sessionInput({ chargedCurrency: "GBP" }))
    expect(gbp.priceData.currency).toBe("gbp")

    const usd = onlyLineItem(sessionInput({ chargedCurrency: "USD" }))
    expect(usd.priceData.currency).toBe("usd")

    // The amount is denominated in that currency, so a currency substitution
    // is a mispricing even when the number is right.
    expect(usd.priceData.unit_amount).toBe(2_466)
  })

  test("a recurring sponsorship charges the same amount on its stated interval", async () => {
    const monthly = onlyLineItem(
      sessionInput({ paymentMode: "recurring", recurrenceInterval: "month" }),
    )
    expect(monthly.params.mode).toBe("subscription")
    expect(monthly.priceData.recurring?.interval).toBe("month")
    expect(monthly.priceData.unit_amount).toBe(2_466)

    const yearly = onlyLineItem(
      sessionInput({ paymentMode: "recurring", recurrenceInterval: "year" }),
    )
    expect(yearly.priceData.recurring?.interval).toBe("year")
    expect(yearly.priceData.unit_amount).toBe(2_466)
  })

  test("a one-time sponsorship is never given a recurring schedule", async () => {
    const { params, priceData } = onlyLineItem(
      sessionInput({ paymentMode: "one_time", recurrenceInterval: null }),
    )

    // A one-time sponsorship acquiring a schedule would bill the sponsor
    // repeatedly for a payment they authorized once.
    expect(params.mode).toBe("payment")
    expect(priceData.recurring).toBeUndefined()
  })

  test("binds the session to the exact payment attempt and expiry", async () => {
    const { params } = onlyLineItem(
      sessionInput({
        paymentAttemptId: "55555555-5555-4555-8555-555555555555",
        expiresAtUnixSeconds: 1_800_000_000,
      }),
    )

    // Reconciliation joins the settled Stripe object back to this attempt.
    expect(params.client_reference_id).toBe(
      "55555555-5555-4555-8555-555555555555",
    )
    expect(params.expires_at).toBe(1_800_000_000)
  })
})
