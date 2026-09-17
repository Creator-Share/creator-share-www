import { expect, test } from "@playwright/test"

import {
  classifyLegacyPayPalReturnResponse,
  classifyLegacyStripeReturnResponse,
} from "../../src/lib/payments/legacyPaymentReturn"

test.describe("legacy payment return response classification", () => {
  test("confirms only exact personalized terminal success states", () => {
    expect(
      classifyLegacyStripeReturnResponse({
        personalized: true,
        status: "complete",
        payment_status: "paid",
      }),
    ).toBe("success")

    for (const status of ["ACTIVE", "active", "complete"]) {
      expect(
        classifyLegacyPayPalReturnResponse({
          personalized: true,
          subscription: { status },
        }),
      ).toBe("success")
    }

    expect(
      classifyLegacyStripeReturnResponse({
        personalized: false,
        status: "complete",
        payment_status: "paid",
      }),
    ).toBe("error")
    expect(
      classifyLegacyPayPalReturnResponse({
        personalized: false,
        subscription: { status: "ACTIVE" },
      }),
    ).toBe("error")
  })

  test("keeps exact generic compatibility responses neutral", () => {
    expect(
      classifyLegacyStripeReturnResponse({
        personalized: false,
        status: "processing",
        payment_status: "processing",
        customer_email: "must-not-affect-classification@example.test",
        customer: { id: "cus_not_trusted" },
      }),
    ).toBe("processing")
    expect(
      classifyLegacyPayPalReturnResponse({
        personalized: false,
        subscription: {
          status: "processing",
          subscriber: { email_address: "must-not-be-read@example.test" },
        },
        paypal_order: { id: "provider-object-not-trusted" },
      }),
    ).toBe("processing")
  })

  test("rejects explicit terminal failures and malformed lookalikes", () => {
    for (const value of [
      { personalized: true, status: "expired", payment_status: "unpaid" },
      { personalized: true, status: "complete", payment_status: "unpaid" },
      { personalized: true, status: "complete", payment_status: "PAID" },
      { status: "complete", payment_status: "paid" },
      null,
    ]) {
      expect(classifyLegacyStripeReturnResponse(value)).toBe("error")
    }

    for (const status of [
      "CANCELLED",
      "CANCELED",
      "EXPIRED",
      "FAILED",
      "cancelled",
      "canceled",
      "expired",
      "failed",
    ]) {
      expect(
        classifyLegacyPayPalReturnResponse({
          personalized: true,
          subscription: { status },
        }),
      ).toBe("error")
    }
    expect(
      classifyLegacyPayPalReturnResponse({
        personalized: true,
        subscription: { status: "ACTIVE because maybe" },
      }),
    ).toBe("error")
  })

  test("recognizes only bounded intermediate status allowlists", () => {
    for (const stripe of [
      { status: "open", payment_status: "unpaid" },
      { status: "processing", payment_status: "processing" },
      { status: "complete", payment_status: "processing" },
    ]) {
      expect(
        classifyLegacyStripeReturnResponse({ personalized: true, ...stripe }),
      ).toBe("processing")
    }

    for (const status of [
      "APPROVAL_PENDING",
      "APPROVED",
      "processing",
      "pending",
    ]) {
      expect(
        classifyLegacyPayPalReturnResponse({
          personalized: true,
          subscription: { status },
        }),
      ).toBe("processing")
    }
  })
})
