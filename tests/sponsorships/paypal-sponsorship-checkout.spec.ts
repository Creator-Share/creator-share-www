import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type CheckoutModule = typeof import("../../src/lib/paypal/sponsorshipCheckout")
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
    "tests/sponsorships/paypal-sponsorship-checkout.spec.ts",
  ),
)
const checkoutModule = testRequire(
  "../../src/lib/paypal/sponsorshipCheckout",
) as CheckoutModule
nodeModule._load = originalModuleLoad

const {
  PayPalSponsorshipCheckoutError,
  buildPayPalOrderCreatePayload,
  buildPayPalSubscriptionCreatePayload,
  capturePayPalSponsorshipOrder,
  createPayPalSponsorshipProviderObject,
} = checkoutModule

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const INTENT_ID = "22222222-2222-4222-8222-222222222222"
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333"
const ORDER_ID = "5O190127TN364715T"

function materialized(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: OPERATION_ID,
    customerEmail: "sponsor@example.com",
    productName: "Monthly Sponsorship for Amina",
    sponsorshipIntentId: INTENT_ID,
    paymentAttemptId: ATTEMPT_ID,
    providerAccountScope: "paypal" as const,
    paymentMode: "recurring" as const,
    recurrenceInterval: "month" as const,
    baseAmountUsdCents: 3333,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP" as const,
    conversionRate: 0.74,
    currencyQuoteAt: "2026-07-18T08:00:00.000Z",
    currencyRateSource: "test-rate-source",
    checkoutBaseUrl: "https://alice.creatorshare.com",
    paypalPlanId: "P-5ML4271244454362WXNWU5NQ",
    expiresAtUnixSeconds: 1784362800,
    ...overrides,
  }
}

test.describe("PayPal server owned sponsorship requests", () => {
  test("builds exact one time order terms from materialized database evidence", () => {
    const request = materialized({
      paymentMode: "one_time",
      recurrenceInterval: null,
      paypalPlanId: null,
    })

    expect(buildPayPalOrderCreatePayload(request)).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: INTENT_ID,
          custom_id: ATTEMPT_ID,
          description: "Monthly Sponsorship for Amina",
          amount: { currency_code: "GBP", value: "24.66" },
        },
      ],
      application_context: {
        brand_name: "Creator Share",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    })
  })

  test("builds exact recurring approval and return terms", () => {
    expect(buildPayPalSubscriptionCreatePayload(materialized())).toEqual({
      plan_id: "P-5ML4271244454362WXNWU5NQ",
      custom_id: ATTEMPT_ID,
      subscriber: { email_address: "sponsor@example.com" },
      application_context: {
        brand_name: "Creator Share",
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        return_url:
          "https://alice.creatorshare.com/payments/success?provider=paypal",
        cancel_url:
          "https://alice.creatorshare.com/payments/failed?provider=paypal",
      },
    })
  })

  test("creates an order with one provider idempotency key", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const created = await createPayPalSponsorshipProviderObject(
      materialized({
        paymentMode: "one_time",
        recurrenceInterval: null,
        paypalPlanId: null,
      }),
      {
        apiUrl: "https://api-m.paypal.com",
        async fetch(path, init) {
          calls.push({ path, init })
          return Response.json({ id: ORDER_ID, status: "CREATED" })
        },
      },
    )

    expect(created).toEqual({
      providerObjectType: "order",
      providerObjectId: ORDER_ID,
      approvalUrl: null,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe("/v2/checkout/orders")
    expect(new Headers(calls[0].init?.headers).get("PayPal-Request-Id")).toBe(
      OPERATION_ID,
    )
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      purchase_units: [
        {
          custom_id: ATTEMPT_ID,
          amount: { value: "24.66", currency_code: "GBP" },
        },
      ],
    })
  })

  test("accepts only the environment matching PayPal approval origin", async () => {
    const request = materialized()
    const responseBody = {
      id: "I-BW452GLLEP1G",
      status: "APPROVAL_PENDING",
      links: [
        {
          rel: "approve",
          method: "GET",
          href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-123",
        },
      ],
    }
    const created = await createPayPalSponsorshipProviderObject(request, {
      apiUrl: "https://api-m.sandbox.paypal.com",
      async fetch() {
        return Response.json(responseBody)
      },
    })
    expect(created).toEqual({
      providerObjectType: "billing_subscription",
      providerObjectId: "I-BW452GLLEP1G",
      approvalUrl: responseBody.links[0].href,
    })

    await expect(
      createPayPalSponsorshipProviderObject(request, {
        apiUrl: "https://api-m.paypal.com",
        async fetch() {
          return Response.json(responseBody)
        },
      }),
    ).rejects.toBeInstanceOf(PayPalSponsorshipCheckoutError)
  })

  test("captures only the exact order, attempt, amount, and currency", async () => {
    const request = materialized({
      paymentMode: "one_time",
      recurrenceInterval: null,
      paypalPlanId: null,
    })
    const payload = {
      id: ORDER_ID,
      status: "COMPLETED",
      purchase_units: [
        {
          reference_id: INTENT_ID,
          custom_id: ATTEMPT_ID,
          payments: {
            captures: [
              {
                id: "3C679366HH908993F",
                status: "COMPLETED",
                final_capture: true,
                amount: { value: "24.66", currency_code: "GBP" },
                create_time: "2026-07-18T08:05:00Z",
              },
            ],
          },
        },
      ],
    }
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const capture = await capturePayPalSponsorshipOrder(ORDER_ID, request, {
      async fetch(path, init) {
        calls.push({ path, init })
        return Response.json(payload)
      },
    })

    expect(capture).toEqual({
      orderId: ORDER_ID,
      captureId: "3C679366HH908993F",
      status: "COMPLETED",
      chargedAmountMinor: 2466,
      chargedCurrency: "GBP",
      occurredAt: "2026-07-18T08:05:00.000Z",
      providerPayload: payload,
    })
    expect(calls[0].path).toBe(`/v2/checkout/orders/${ORDER_ID}/capture`)
    expect(new Headers(calls[0].init?.headers).get("PayPal-Request-Id")).toBe(
      ATTEMPT_ID,
    )

    payload.purchase_units[0].payments.captures[0].amount.value = "24.67"
    await expect(
      capturePayPalSponsorshipOrder(ORDER_ID, request, {
        async fetch() {
          return Response.json(payload)
        },
      }),
    ).rejects.toBeInstanceOf(PayPalSponsorshipCheckoutError)
  })

  test("does not echo provider rejection details", async () => {
    await expect(
      createPayPalSponsorshipProviderObject(materialized(), {
        apiUrl: "https://api-m.paypal.com",
        async fetch() {
          return Response.json(
            { message: "sponsor@example.com plan rejected" },
            { status: 422 },
          )
        },
      }),
    ).rejects.toMatchObject({
      code: "provider-rejected",
      message: "PayPal sponsorship checkout failed",
    })
  })
})
