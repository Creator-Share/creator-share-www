import { expect, test } from "@playwright/test"

import {
  buildPayPalBrowserCapturePayload,
  buildPayPalBrowserStartPayload,
} from "../../src/lib/sponsorships/checkout/paypalBrowserPayload"

test.describe("PayPal browser payload minimization", () => {
  test("sends only sponsor choices and an opaque checkout operation", () => {
    const payload = buildPayPalBrowserStartPayload({
      beneficiaryId: "11111111-1111-4111-8111-111111111111",
      requestedAmountUsdCents: 3333,
      paymentType: "subscription",
      sponsorEmail: "sponsor@example.com",
      currency: "GBP",
      checkoutRequestId: "22222222-2222-4222-8222-222222222222",
    })
    expect(payload).toEqual({
      action: "start",
      beneficiaryId: "11111111-1111-4111-8111-111111111111",
      amount: 3333,
      paymentType: "subscription",
      email: "sponsor@example.com",
      type: "sponsorship",
      currency: "GBP",
      checkoutRequestId: "22222222-2222-4222-8222-222222222222",
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /plan|provider|product|name|conversion|custom_id|order/i,
    )
  })

  test("capture sends no order or financial authority", () => {
    const payload = buildPayPalBrowserCapturePayload({
      checkoutRequestId: "22222222-2222-4222-8222-222222222222",
      checkoutReceipt: "a".repeat(43),
    })
    expect(payload).toEqual({
      action: "capture",
      checkoutRequestId: "22222222-2222-4222-8222-222222222222",
      checkoutReceipt: "a".repeat(43),
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /order|capture_id|amount|currency|plan|provider/i,
    )
  })
})
