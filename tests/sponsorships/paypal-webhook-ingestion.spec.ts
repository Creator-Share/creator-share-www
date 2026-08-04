import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  AuthoritativePayPalFinancialMovement,
  AuthoritativePayPalPaymentBoundary,
  PayPalWebhookDependencies,
  VerifiedPayPalFinancialAdjustmentInput,
  VerifiedPayPalGatewayEventInput,
  VerifiedPayPalNoEffectInput,
  VerifiedPayPalQuarantineInput,
} from "../../src/lib/sponsorships/gateways/paypalWebhook"

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
  resolve(process.cwd(), "tests/sponsorships/paypal-webhook-ingestion.spec.ts"),
)
const { createSponsorshipCrypto, fromSupabaseRpcBytea } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as typeof import("../../src/lib/sponsorships/crypto")
const {
  MAXIMUM_PAYPAL_WEBHOOK_BYTES,
  PayPalWebhookError,
  buildPayPalSignatureVerificationBody,
  ingestVerifiedPayPalEvent,
  parsePayPalWebhookEvent,
  parsePayPalWebhookHeaders,
  quarantineVerifiedPayPalEvent,
  readBoundedPayPalWebhookPayload,
  verifyPayPalWebhookSignature,
} = testRequire(
  "../../src/lib/sponsorships/gateways/paypalWebhook",
) as typeof import("../../src/lib/sponsorships/gateways/paypalWebhook")
nodeModule._load = originalModuleLoad

const INTENT_ID = "11111111-1111-4111-8111-111111111111"
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222"
const GATEWAY_EVENT_ID = "33333333-3333-4333-8333-333333333333"
const MOVEMENT_ID = "44444444-4444-4444-8444-444444444444"
const ORDER_ID = "5O190127TN364715T"
const CAPTURE_ID = "3Y662965014333303"
const SALE_ID = "34P65696MB8050805"
const REFUND_ID = "8Y662965014333304"
const DISPUTE_ID = "PP-D-123456789"
const SUBSCRIPTION_ID = "I-BW452GLLEP1G"
const CUSTOMER_ID = "QDGTZ7B92B9QT"
const PLAN_ID = "P-5ML4271244454362WXNWU5NQ"
const EVENT_ID = "WH-3F562076HD293871E-75F399086E414290U"
const NOW = new Date("2026-07-18T10:00:00.000Z")
const OCCURRED_AT = "2026-07-18T09:59:30.000Z"
const PERIOD_END = "2026-08-18T09:59:00.000Z"
const APP_SECRET = Buffer.alloc(48, 21).toString("base64")

function boundary(
  overrides: Partial<AuthoritativePayPalPaymentBoundary> = {},
): AuthoritativePayPalPaymentBoundary {
  const paymentMode = overrides.paymentMode ?? "one_time"
  const recurrenceInterval =
    overrides.recurrenceInterval ??
    (paymentMode === "recurring" ? "month" : null)
  return {
    attemptId: ATTEMPT_ID,
    intentId: INTENT_ID,
    provider: "PAYPAL",
    providerAccountScope: "paypal",
    attemptStatus: "pending",
    paymentMode,
    recurrenceInterval,
    baseAmountUsdCents: 1200,
    chargedAmountMinor: 1200,
    chargedCurrency: "USD",
    conversionRate: 1,
    providerObjectType:
      paymentMode === "one_time" ? "order" : "billing_subscription",
    providerObjectId: paymentMode === "one_time" ? ORDER_ID : SUBSCRIPTION_ID,
    providerCustomerId: paymentMode === "one_time" ? null : CUSTOMER_ID,
    providerSubscriptionObjectType: null,
    providerSubscriptionId: null,
    intentPaymentMode: overrides.intentPaymentMode ?? paymentMode,
    intentRecurrenceInterval:
      overrides.intentRecurrenceInterval ?? recurrenceInterval,
    intentBaseAmountUsdCents:
      overrides.intentBaseAmountUsdCents ??
      overrides.baseAmountUsdCents ??
      1200,
    intentChargedAmountMinor:
      overrides.intentChargedAmountMinor ??
      overrides.chargedAmountMinor ??
      1200,
    intentChargedCurrency:
      overrides.intentChargedCurrency ?? overrides.chargedCurrency ?? "USD",
    intentConversionRate:
      overrides.intentConversionRate ?? overrides.conversionRate ?? 1,
    ...overrides,
    expectedProviderPlanId:
      overrides.expectedProviderPlanId === undefined
        ? paymentMode === "recurring"
          ? PLAN_ID
          : null
        : overrides.expectedProviderPlanId,
  }
}

function originalMovement(
  overrides: Partial<AuthoritativePayPalFinancialMovement> = {},
): AuthoritativePayPalFinancialMovement {
  return {
    id: MOVEMENT_ID,
    paymentAttemptId: ATTEMPT_ID,
    sponsorshipIntentId: INTENT_ID,
    provider: "PAYPAL",
    providerAccountScope: "paypal",
    providerMovementType: "capture",
    providerMovementId: CAPTURE_ID,
    entryKind: "sponsorship_payment",
    originalFinancialMovementId: null,
    paymentMode: "one_time",
    baseAmountUsdCents: 1200,
    chargedAmountMinor: 1200,
    chargedCurrency: "USD",
    conversionRate: 1,
    occurredAt: OCCURRED_AT,
    ...overrides,
  }
}

function rawEvent(
  eventType: string,
  resourceType: string,
  resource: Record<string, unknown>,
  id = EVENT_ID,
): string {
  return JSON.stringify({
    id,
    event_version: "1.0",
    create_time: OCCURRED_AT,
    resource_type: resourceType,
    resource_version: "2.0",
    event_type: eventType,
    summary: "Provider supplied text that must not be copied",
    resource,
  })
}

function captureResource(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: CAPTURE_ID,
    status: "COMPLETED",
    custom_id: ATTEMPT_ID,
    amount: { value: "12.00", currency_code: "USD" },
    final_capture: true,
    supplementary_data: { related_ids: { order_id: ORDER_ID } },
    payer: { email_address: "private.sponsor@example.com" },
    ...overrides,
  }
}

function saleResource(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SALE_ID,
    state: "completed",
    amount: { total: "12.00", currency: "USD" },
    billing_agreement_id: SUBSCRIPTION_ID,
    create_time: "2026-07-18T09:59:00.000Z",
    billing_period: {
      start_time: "2026-07-18T09:59:00.000Z",
      end_time: PERIOD_END,
    },
    payer: { email_address: "private.sponsor@example.com" },
    ...overrides,
  }
}

function subscriptionResource(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUBSCRIPTION_ID,
    custom_id: ATTEMPT_ID,
    status: "ACTIVE",
    plan_id: PLAN_ID,
    subscriber: {
      payer_id: CUSTOMER_ID,
      email_address: "private.sponsor@example.com",
    },
    billing_info: {
      last_payment: {
        amount: { value: "12.00", currency_code: "USD" },
      },
    },
    ...overrides,
  }
}

function disputeResource(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    dispute_id: DISPUTE_ID,
    status: "UNDER_REVIEW",
    dispute_amount: { value: "5.00", currency_code: "USD" },
    disputed_transactions: [{ seller_transaction_id: CAPTURE_ID }],
    buyer: { email: "private.sponsor@example.com" },
    ...overrides,
  }
}

function orderSupplement(): Record<string, unknown> {
  return {
    id: ORDER_ID,
    intent: "CAPTURE",
    status: "COMPLETED",
    purchase_units: [
      {
        reference_id: INTENT_ID,
        custom_id: ATTEMPT_ID,
        amount: { value: "12.00", currency_code: "USD" },
      },
    ],
  }
}

function subscriptionSupplement(): Record<string, unknown> {
  return {
    id: SUBSCRIPTION_ID,
    custom_id: ATTEMPT_ID,
    status: "ACTIVE",
    plan_id: PLAN_ID,
    subscriber: { payer_id: CUSTOMER_ID },
    billing_info: { next_billing_time: PERIOD_END },
  }
}

function requestContext() {
  return {
    requestId: "55555555-5555-4555-8555-555555555555",
    traceId: null,
    clientIp: null,
    userAgent: "PayPal/AUHD-214.0-59081590",
    headers: {
      transmissionId: "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
      transmissionTime: "2026-07-18T09:59:31Z",
      transmissionSignature: "c2lnbmF0dXJl",
      certificateUrl:
        "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-123",
      authenticationAlgorithm: "SHA256withRSA",
    },
    verificationResponseSha256: "a".repeat(64),
  } as const
}

function dependencies(
  paymentBoundary: AuthoritativePayPalPaymentBoundary = boundary(),
) {
  const calls = {
    verificationBodies: [] as string[],
    orderIds: [] as string[],
    subscriptionIds: [] as string[],
    movementLookups: [] as Array<{
      providerMovementType: "capture" | "sale" | null
      providerMovementId: string
    }>,
    ingested: [] as VerifiedPayPalGatewayEventInput[],
    quarantined: [] as VerifiedPayPalQuarantineInput[],
    adjustments: [] as VerifiedPayPalFinancialAdjustmentInput[],
    noEffects: [] as VerifiedPayPalNoEffectInput[],
  }
  const value: PayPalWebhookDependencies = {
    crypto: createSponsorshipCrypto({ appSecretBase64: APP_SECRET }),
    async verifyWebhookSignature(requestBody) {
      calls.verificationBodies.push(requestBody)
      return {
        ok: true,
        status: 200,
        body: '{"verification_status":"SUCCESS"}',
      }
    },
    async retrieveOrder(id) {
      calls.orderIds.push(id)
      return orderSupplement()
    },
    async retrieveSubscription(id) {
      calls.subscriptionIds.push(id)
      return subscriptionSupplement()
    },
    async loadPaymentBoundary() {
      return paymentBoundary
    },
    async loadOriginalMovement(input) {
      calls.movementLookups.push(input)
      return originalMovement()
    },
    async ingestVerifiedEvent(input) {
      calls.ingested.push(input)
      return {
        gatewayEventId: GATEWAY_EVENT_ID,
        sponsorshipIntentId: INTENT_ID,
        paymentAttemptId: ATTEMPT_ID,
        processingStatus: "received",
        isDuplicate: false,
      }
    },
    async quarantineVerifiedEvent(input) {
      calls.quarantined.push(input)
      return {
        gatewayEventId: GATEWAY_EVENT_ID,
        processingStatus: "ignored",
        isDuplicate: false,
      }
    },
    async ingestVerifiedAdjustment(input) {
      calls.adjustments.push(input)
      return {
        gatewayEventId: GATEWAY_EVENT_ID,
        originalFinancialMovementId: MOVEMENT_ID,
        paymentAttemptId: ATTEMPT_ID,
        sponsorshipIntentId: INTENT_ID,
        processingStatus: "received",
        adjustmentKind: "sponsorship_refund",
        isDuplicate: false,
      }
    },
    async ingestVerifiedNoEffect(input) {
      calls.noEffects.push(input)
      return {
        gatewayEventId: GATEWAY_EVENT_ID,
        processingStatus: "ignored",
        isDuplicate: false,
      }
    },
    now: () => NOW,
  }
  return { calls, value }
}

test.describe("PayPal webhook trust boundary", () => {
  test("preserves the exact webhook representation in the signature request", async () => {
    const raw = ` {\n  "id": "${EVENT_ID}", "resource": { "value": "x" }\n}`
    const context = requestContext()
    const body = buildPayPalSignatureVerificationBody(
      raw,
      context.headers,
      "5BW96656R1645",
    )

    expect(body).toContain(`"webhook_event":${raw}`)
    expect(body).not.toContain(
      `"webhook_event":${JSON.stringify(JSON.parse(raw))}`,
    )

    const { calls, value } = dependencies()
    const result = await verifyPayPalWebhookSignature(
      {
        rawBody: raw,
        headers: context.headers,
        configuredWebhookId: "5BW96656R1645",
      },
      value,
    )
    expect(result.verified).toBe(true)
    expect(calls.verificationBodies).toEqual([body])
  })

  test("refuses a signature the provider does not confirm", async () => {
    // The only verification coverage asserted the SUCCESS path, so the
    // negative verdict was unproven. FAILURE is the verdict an attacker
    // produces, and it must resolve to an explicit refusal.
    const context = requestContext()
    const { value } = dependencies()

    const result = await verifyPayPalWebhookSignature(
      {
        rawBody: `{"id":"${EVENT_ID}"}`,
        headers: context.headers,
        configuredWebhookId: "5BW96656R1645",
      },
      {
        ...value,
        async verifyWebhookSignature() {
          return {
            ok: true,
            status: 200,
            body: '{"verification_status":"FAILURE"}',
          }
        },
      },
    )

    expect(result.verified).toBe(false)
  })

  test("fails closed on any verdict that is not exactly SUCCESS or FAILURE", async () => {
    // Anything outside the two known verdicts throws a retryable error, which
    // the route maps to unavailable rather than treating as authentic. The
    // lowercase case matters: a case-insensitive comparison here would let
    // "success" authenticate a forged event.
    const context = requestContext()
    const { value } = dependencies()

    for (const verification_status of ["", "success", "Success", "UNKNOWN"]) {
      await expect(
        verifyPayPalWebhookSignature(
          {
            rawBody: `{"id":"${EVENT_ID}"}`,
            headers: context.headers,
            configuredWebhookId: "5BW96656R1645",
          },
          {
            ...value,
            async verifyWebhookSignature() {
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({ verification_status }),
              }
            },
          },
        ),
        `verification_status ${JSON.stringify(verification_status)} must not verify`,
      ).rejects.toThrow(PayPalWebhookError)
    }
  })

  test("refuses a verification the provider could not answer", async () => {
    const context = requestContext()
    const { value } = dependencies()

    for (const response of [
      { ok: false, status: 401, body: "{}" },
      { ok: true, status: 200, body: "not-json" },
      { ok: true, status: 200, body: "{}" },
    ]) {
      await expect(
        verifyPayPalWebhookSignature(
          {
            rawBody: `{"id":"${EVENT_ID}"}`,
            headers: context.headers,
            configuredWebhookId: "5BW96656R1645",
          },
          {
            ...value,
            async verifyWebhookSignature() {
              return response
            },
          },
        ),
        `response ${JSON.stringify(response)} must never verify`,
      ).rejects.toThrow(PayPalWebhookError)
    }
  })

  test("bounds required headers and rejects a cross-environment certificate", () => {
    const valid = new Headers({
      "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
      "paypal-transmission-time": "2026-07-18T09:59:31Z",
      "paypal-transmission-sig": "c2lnbmF0dXJl",
      "paypal-cert-url":
        "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-123",
      "paypal-auth-algo": "SHA256withRSA",
    })
    expect(
      parsePayPalWebhookHeaders(valid, "https://api-m.sandbox.paypal.com")
        .certificateUrl,
    ).toContain("api-m.sandbox.paypal.com")

    valid.set(
      "paypal-cert-url",
      "https://api-m.paypal.com/v1/notifications/certs/CERT-123",
    )
    expect(() =>
      parsePayPalWebhookHeaders(valid, "https://api-m.sandbox.paypal.com"),
    ).toThrow(PayPalWebhookError)
  })

  test("rejects malformed and oversized raw bodies before parsing", async () => {
    await expect(
      readBoundedPayPalWebhookPayload(
        new Request("https://example.test", {
          method: "POST",
          body: "{",
          headers: { "content-length": "not-a-number" },
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid-payload" })

    await expect(
      readBoundedPayPalWebhookPayload(
        new Request("https://example.test", {
          method: "POST",
          body: "x".repeat(MAXIMUM_PAYPAL_WEBHOOK_BYTES + 1),
        }),
      ),
    ).rejects.toMatchObject({ code: "payload-too-large", httpStatus: 413 })
  })

  test("ingests exact capture success facts without a provider lookup", async () => {
    const raw = rawEvent(
      "PAYMENT.CAPTURE.COMPLETED",
      "capture",
      captureResource(),
    )
    const { calls, value } = dependencies()
    const result = await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )

    expect(result).toMatchObject({ kind: "payment", isDuplicate: false })
    expect(calls.orderIds).toEqual([])
    expect(calls.ingested[0]).toMatchObject({
      paymentAttemptId: ATTEMPT_ID,
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      providerObjectType: "capture",
      providerObjectId: CAPTURE_ID,
      factPaymentStatus: "paid",
      factParentProviderObjectType: "order",
      factParentProviderObjectId: ORDER_ID,
      factProviderMovementType: "capture",
      factProviderMovementId: CAPTURE_ID,
      factChargedAmountMinor: 1200,
      factChargedCurrency: "USD",
    })
    const redacted = JSON.stringify(calls.ingested[0].redactedPayload)
    expect(redacted).not.toContain("private.sponsor@example.com")
    expect(
      fromSupabaseRpcBytea(calls.ingested[0].payloadCiphertext).length,
    ).toBeGreaterThan(0)
  })

  test("supplements a capture only when signed resource lacks custom_id", async () => {
    const raw = rawEvent(
      "PAYMENT.CAPTURE.COMPLETED",
      "capture",
      captureResource({ custom_id: undefined }),
    )
    const { calls, value } = dependencies()
    await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )
    expect(calls.orderIds).toEqual([ORDER_ID])
    expect(calls.ingested).toHaveLength(1)
  })

  test("ingests a recurring sale against the supplemented subscription chain", async () => {
    const raw = rawEvent("PAYMENT.SALE.COMPLETED", "sale", saleResource())
    const { calls, value } = dependencies(
      boundary({ paymentMode: "recurring" }),
    )
    await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )

    expect(calls.subscriptionIds).toEqual([SUBSCRIPTION_ID])
    expect(calls.ingested[0]).toMatchObject({
      eventType: "PAYMENT.SALE.COMPLETED",
      providerObjectType: "sale",
      providerObjectId: SALE_ID,
      factProviderMovementType: "sale",
      factProviderMovementId: SALE_ID,
      factProviderCustomerId: CUSTOMER_ID,
      factProviderSubscriptionId: SUBSCRIPTION_ID,
      factPeriodStart: "2026-07-18T09:59:00.000Z",
      factPeriodEnd: PERIOD_END,
    })
  })

  test("ingests lifecycle state without copying subscriber contact", async () => {
    const raw = rawEvent(
      "BILLING.SUBSCRIPTION.ACTIVATED",
      "subscription",
      subscriptionResource(),
    )
    const { calls, value } = dependencies(
      boundary({ paymentMode: "recurring" }),
    )
    await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )
    expect(calls.subscriptionIds).toEqual([])
    expect(calls.ingested[0]).toMatchObject({
      eventType: "BILLING.SUBSCRIPTION.ACTIVATED",
      providerObjectType: "billing_subscription",
      providerObjectId: SUBSCRIPTION_ID,
      factProviderCustomerId: CUSTOMER_ID,
      factProviderSubscriptionId: SUBSCRIPTION_ID,
      factLifecycleState: "active",
    })
    expect(JSON.stringify(calls.ingested[0].redactedPayload)).not.toContain(
      "private.sponsor@example.com",
    )
  })

  test("requires recurring webhook plan evidence to match the server catalog", async () => {
    const raw = rawEvent(
      "BILLING.SUBSCRIPTION.ACTIVATED",
      "subscription",
      subscriptionResource({ plan_id: `P-${"A".repeat(24)}` }),
    )
    const { value } = dependencies(boundary({ paymentMode: "recurring" }))
    await expect(
      ingestVerifiedPayPalEvent(
        {
          event: parsePayPalWebhookEvent(raw),
          rawPayload: raw,
          requestContext: requestContext(),
        },
        value,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
  })

  test("derives a terminal sale period from signed recurrence when no next billing time exists", async () => {
    const raw = rawEvent(
      "PAYMENT.SALE.COMPLETED",
      "sale",
      saleResource({ billing_period: undefined }),
    )
    const { calls, value } = dependencies(
      boundary({ paymentMode: "recurring" }),
    )
    value.retrieveSubscription = async (id) => {
      calls.subscriptionIds.push(id)
      return {
        ...subscriptionSupplement(),
        billing_info: {},
      }
    }
    await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )
    expect(calls.ingested[0]).toMatchObject({
      factPeriodStart: "2026-07-18T09:59:00.000Z",
      factPeriodEnd: "2026-08-18T09:59:00.000Z",
    })
  })

  test("ingests capture declined as a typed payment failure", async () => {
    const raw = rawEvent(
      "PAYMENT.CAPTURE.DECLINED",
      "capture",
      captureResource({ status: "DECLINED", final_capture: false }),
    )
    const { calls, value } = dependencies()
    await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )
    expect(calls.ingested[0]).toMatchObject({
      eventType: "PAYMENT.CAPTURE.DECLINED",
      providerObjectType: "capture",
      factParentProviderObjectType: "order",
      factParentProviderObjectId: ORDER_ID,
      factFailureCode: "paypal_capture_declined",
    })
  })

  test("ingests subscription payment failed against the exact plan and customer chain", async () => {
    const raw = rawEvent(
      "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      "subscription",
      subscriptionResource(),
    )
    const { calls, value } = dependencies(
      boundary({ paymentMode: "recurring" }),
    )
    await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )
    expect(calls.ingested[0]).toMatchObject({
      eventType: "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      providerObjectType: "billing_subscription",
      providerObjectId: SUBSCRIPTION_ID,
      factProviderCustomerId: CUSTOMER_ID,
      factProviderSubscriptionId: SUBSCRIPTION_ID,
      factFailureCode: "paypal_subscription_payment_failed",
      factLifecycleState: null,
    })
  })

  test("binds a refund through its original movement without requiring custom_id", async () => {
    const raw = rawEvent("PAYMENT.CAPTURE.REFUNDED", "refund", {
      id: REFUND_ID,
      status: "COMPLETED",
      amount: { value: "5.00", currency_code: "USD" },
      supplementary_data: { related_ids: { capture_id: CAPTURE_ID } },
    })
    const { calls, value } = dependencies()
    await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )
    expect(calls.movementLookups).toEqual([
      { providerMovementType: "capture", providerMovementId: CAPTURE_ID },
    ])
    expect(calls.adjustments[0]).toMatchObject({
      originalFinancialMovementId: MOVEMENT_ID,
      adjustmentProviderMovementType: "refund",
      adjustmentProviderMovementId: REFUND_ID,
      chargedAmountMinor: 500,
    })
  })

  test("refuses a refund denominated in a different currency than the capture", async () => {
    // The refund path compared amounts but its currency check was unasserted,
    // so a mutation dropping it left the suite green. A 5.00 EUR refund
    // against a 12.00 USD capture would then be recorded as 500 minor units
    // against a USD movement, understating the refund and corrupting both the
    // net collected figure and the advocate's reported funds.
    const raw = rawEvent("PAYMENT.CAPTURE.REFUNDED", "refund", {
      id: REFUND_ID,
      status: "COMPLETED",
      amount: { value: "5.00", currency_code: "EUR" },
      supplementary_data: { related_ids: { capture_id: CAPTURE_ID } },
    })
    const { calls, value } = dependencies()

    await expect(
      ingestVerifiedPayPalEvent(
        {
          event: parsePayPalWebhookEvent(raw),
          rawPayload: raw,
          requestContext: requestContext(),
        },
        value,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })

    // No financial adjustment may be written from a mismatched fact.
    expect(calls.adjustments).toHaveLength(0)
  })

  test("refuses a refund larger than the original capture", async () => {
    // The other half of the same guard, which the amount comparison enforces.
    const raw = rawEvent("PAYMENT.CAPTURE.REFUNDED", "refund", {
      id: REFUND_ID,
      status: "COMPLETED",
      amount: { value: "12.01", currency_code: "USD" },
      supplementary_data: { related_ids: { capture_id: CAPTURE_ID } },
    })
    const { calls, value } = dependencies()

    await expect(
      ingestVerifiedPayPalEvent(
        {
          event: parsePayPalWebhookEvent(raw),
          rawPayload: raw,
          requestContext: requestContext(),
        },
        value,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    expect(calls.adjustments).toHaveLength(0)
  })

  test("creates one partial dispute debit and preserves a durable duplicate", async () => {
    const raw = rawEvent(
      "CUSTOMER.DISPUTE.CREATED",
      "customer_dispute",
      disputeResource(),
    )
    const { calls, value } = dependencies()
    value.ingestVerifiedAdjustment = async (input) => {
      calls.adjustments.push(input)
      return {
        gatewayEventId: GATEWAY_EVENT_ID,
        originalFinancialMovementId: MOVEMENT_ID,
        paymentAttemptId: ATTEMPT_ID,
        sponsorshipIntentId: INTENT_ID,
        processingStatus: "processed",
        adjustmentKind: "sponsorship_dispute_debit",
        isDuplicate: true,
      }
    }
    const result = await ingestVerifiedPayPalEvent(
      {
        event: parsePayPalWebhookEvent(raw),
        rawPayload: raw,
        requestContext: requestContext(),
      },
      value,
    )
    expect(result).toMatchObject({ kind: "adjustment", isDuplicate: true })
    expect(calls.movementLookups).toEqual([
      { providerMovementType: null, providerMovementId: CAPTURE_ID },
    ])
    expect(calls.adjustments[0]).toMatchObject({
      eventType: "CUSTOMER.DISPUTE.CREATED",
      providerObjectType: "capture",
      providerObjectId: CAPTURE_ID,
      adjustmentProviderMovementType: "dispute",
      adjustmentProviderMovementId: DISPUTE_ID,
      baseAmountUsdCents: 500,
      chargedAmountMinor: 500,
    })
  })

  test("records dispute updates and buyer wins as no financial effect", async () => {
    const updatedRaw = rawEvent(
      "CUSTOMER.DISPUTE.UPDATED",
      "customer_dispute",
      disputeResource({ status: "WAITING_FOR_SELLER_RESPONSE" }),
    )
    const updated = dependencies()
    await expect(
      ingestVerifiedPayPalEvent(
        {
          event: parsePayPalWebhookEvent(updatedRaw),
          rawPayload: updatedRaw,
          requestContext: requestContext(),
        },
        updated.value,
      ),
    ).resolves.toMatchObject({ kind: "no_effect" })
    expect(updated.calls.adjustments).toHaveLength(0)
    expect(updated.calls.noEffects[0]).toMatchObject({
      eventType: "CUSTOMER.DISPUTE.UPDATED",
      providerObjectId: DISPUTE_ID,
      providerState: "updated_waiting_for_seller_response",
    })

    const buyerRaw = rawEvent(
      "CUSTOMER.DISPUTE.RESOLVED",
      "customer_dispute",
      disputeResource({
        status: "RESOLVED",
        dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOR" },
      }),
    )
    const buyer = dependencies()
    await expect(
      ingestVerifiedPayPalEvent(
        {
          event: parsePayPalWebhookEvent(buyerRaw),
          rawPayload: buyerRaw,
          requestContext: requestContext(),
        },
        buyer.value,
      ),
    ).resolves.toMatchObject({ kind: "no_effect" })
    expect(buyer.calls.adjustments).toHaveLength(0)
    expect(buyer.calls.noEffects[0].providerState).toBe("resolved_buyer_favor")
  })

  test("credits a resolved dispute for both PayPal seller favour spellings", async () => {
    for (const outcome of ["RESOLVED_SELLER_FAVOR", "RESOLVED_SELLER_FAVOUR"]) {
      const raw = rawEvent(
        "CUSTOMER.DISPUTE.RESOLVED",
        "customer_dispute",
        disputeResource({
          status: "RESOLVED",
          dispute_outcome: { outcome_code: outcome },
        }),
      )
      const { calls, value } = dependencies()
      await ingestVerifiedPayPalEvent(
        {
          event: parsePayPalWebhookEvent(raw),
          rawPayload: raw,
          requestContext: requestContext(),
        },
        value,
      )
      expect(calls.adjustments[0]).toMatchObject({
        eventType: "CUSTOMER.DISPUTE.RESOLVED",
        adjustmentProviderMovementType: "dispute",
        adjustmentProviderMovementId: DISPUTE_ID,
        chargedAmountMinor: 500,
      })
    }
  })

  test("rejects ambiguous or oversized dispute movement evidence", async () => {
    const ambiguousRaw = rawEvent(
      "CUSTOMER.DISPUTE.CREATED",
      "customer_dispute",
      disputeResource({
        disputed_transactions: [
          { seller_transaction_id: CAPTURE_ID },
          { seller_transaction_id: SALE_ID },
        ],
      }),
    )
    const oversizedRaw = rawEvent(
      "CUSTOMER.DISPUTE.CREATED",
      "customer_dispute",
      disputeResource({
        dispute_amount: { value: "12.01", currency_code: "USD" },
      }),
    )
    const oversizedStateRaw = rawEvent(
      "CUSTOMER.DISPUTE.UPDATED",
      "customer_dispute",
      disputeResource({ status: "A".repeat(73) }),
    )
    for (const raw of [ambiguousRaw, oversizedRaw, oversizedStateRaw]) {
      const { value } = dependencies()
      await expect(
        ingestVerifiedPayPalEvent(
          {
            event: parsePayPalWebhookEvent(raw),
            rawPayload: raw,
            requestContext: requestContext(),
          },
          value,
        ),
      ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    }
  })

  test("quarantines an exact amount mismatch after signature verification", async () => {
    const raw = rawEvent(
      "PAYMENT.CAPTURE.COMPLETED",
      "capture",
      captureResource({
        amount: { value: "12.01", currency_code: "USD" },
      }),
    )
    const { calls, value } = dependencies()
    const event = parsePayPalWebhookEvent(raw)
    let safeError: InstanceType<typeof PayPalWebhookError> | undefined
    try {
      await ingestVerifiedPayPalEvent(
        { event, rawPayload: raw, requestContext: requestContext() },
        value,
      )
    } catch (error) {
      safeError = error as InstanceType<typeof PayPalWebhookError>
    }
    expect(safeError).toMatchObject({
      code: "provider-fact-mismatch",
      retryable: false,
    })
    await quarantineVerifiedPayPalEvent(
      {
        event,
        rawPayload: raw,
        requestContext: requestContext(),
        error: safeError!,
      },
      value,
    )
    expect(calls.ingested).toHaveLength(0)
    expect(calls.quarantined).toHaveLength(1)
  })

  test("returns the durable duplicate result without a second business write", async () => {
    const raw = rawEvent(
      "PAYMENT.CAPTURE.COMPLETED",
      "capture",
      captureResource(),
    )
    const { value } = dependencies()
    value.ingestVerifiedEvent = async () => ({
      gatewayEventId: GATEWAY_EVENT_ID,
      sponsorshipIntentId: INTENT_ID,
      paymentAttemptId: ATTEMPT_ID,
      processingStatus: "processed",
      isDuplicate: true,
    })
    await expect(
      ingestVerifiedPayPalEvent(
        {
          event: parsePayPalWebhookEvent(raw),
          rawPayload: raw,
          requestContext: requestContext(),
        },
        value,
      ),
    ).resolves.toMatchObject({ kind: "payment", isDuplicate: true })
  })

  test("durably quarantines an unsupported but signed event", async () => {
    const raw = rawEvent("CATALOG.PRODUCT.UPDATED", "product", {
      id: "PROD-5RN21878H3527870P",
      name: "Sensitive provider text",
    })
    const { calls, value } = dependencies()
    const event = parsePayPalWebhookEvent(raw)
    let safeError: InstanceType<typeof PayPalWebhookError> | undefined
    try {
      await ingestVerifiedPayPalEvent(
        { event, rawPayload: raw, requestContext: requestContext() },
        value,
      )
    } catch (error) {
      safeError = error as InstanceType<typeof PayPalWebhookError>
    }
    expect(safeError?.code).toBe("unsupported-event")
    const result = await quarantineVerifiedPayPalEvent(
      {
        event,
        rawPayload: raw,
        requestContext: requestContext(),
        error: safeError!,
      },
      value,
    )
    expect(result.quarantined).toBe(true)
    expect(calls.quarantined[0]).toMatchObject({
      eventType: "CATALOG.PRODUCT.UPDATED",
      errorCode: "unsupported-event",
    })
    expect(JSON.stringify(calls.quarantined[0].redactedPayload)).not.toContain(
      "Sensitive provider text",
    )
    const encryptedEvidence = value.crypto
      .decryptSecretPayload(
        fromSupabaseRpcBytea(calls.quarantined[0].payloadCiphertext),
      )
      .toString("utf8")
    expect(encryptedEvidence).toContain("paypal_unsupported_v1")
    expect(encryptedEvidence).toContain(EVENT_ID)
    expect(encryptedEvidence).not.toContain("Sensitive provider text")
  })

  test("fails retryably when bounded provider supplementation is unavailable", async () => {
    const raw = rawEvent(
      "PAYMENT.CAPTURE.COMPLETED",
      "capture",
      captureResource({ custom_id: undefined }),
    )
    const { value } = dependencies()
    value.retrieveOrder = async () => {
      throw new Error("provider response containing private data")
    }
    await expect(
      ingestVerifiedPayPalEvent(
        {
          event: parsePayPalWebhookEvent(raw),
          rawPayload: raw,
          requestContext: requestContext(),
        },
        value,
      ),
    ).rejects.toMatchObject({
      code: "provider-chain-unavailable",
      retryable: true,
      message: "PayPal webhook ingestion is temporarily unavailable",
    })
  })
})
