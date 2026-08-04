import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type Stripe from "stripe"

import type {
  StripeNoEffectRefundStatus,
  VerifiedStripeNoEffectRefundInput,
} from "../../src/lib/sponsorships/gateways/stripeFinancialAdjustments"
import type {
  AuthoritativeStripePaymentBoundary,
  ServerIntentStripeWebhookDependencies,
  ServerIntentStripeWebhookError as ServerIntentStripeWebhookErrorInstance,
  VerifiedStripeGatewayEventInput,
  VerifiedStripeQuarantineInput,
} from "../../src/lib/sponsorships/gateways/stripeWebhook"
import type {
  LegacyStripeWebhookDependencies,
  VerifiedLegacyStripeEventInput,
} from "../../src/lib/sponsorships/gateways/legacyStripeWebhook"

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
  resolve(process.cwd(), "tests/sponsorships/stripe-webhook-ingestion.spec.ts"),
)
const { buildHostedStripeSessionParams } = testRequire(
  "../../src/lib/sponsorships/checkout/stripeCheckout",
) as typeof import("../../src/lib/sponsorships/checkout/stripeCheckout")
const { createSponsorshipCrypto, fromSupabaseRpcBytea } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as typeof import("../../src/lib/sponsorships/crypto")
const {
  SERVER_INTENT_STRIPE_SCHEMA,
  ServerIntentStripeWebhookError,
  classifyServerIntentStripeEvent,
  classifyServerIntentStripeEventWithProviderLookup,
  ingestServerIntentStripeEvent,
  MAXIMUM_SIGNED_PAYLOAD_BYTES,
  readBoundedStripeWebhookPayload,
  stripeEventImmutableDigest,
  quarantineVerifiedStripeEvent,
  validateStripeEventAccountEnvelope,
  validateServerIntentStripeEventEnvelope,
} = testRequire(
  "../../src/lib/sponsorships/gateways/stripeWebhook",
) as typeof import("../../src/lib/sponsorships/gateways/stripeWebhook")
const { ingestVerifiedNoEffectRefund: ingestVerifiedNoEffectRefundRuntime } =
  testRequire(
    "../../src/lib/sponsorships/gateways/stripeFinancialAdjustmentsRuntime",
  ) as typeof import("../../src/lib/sponsorships/gateways/stripeFinancialAdjustmentsRuntime")
const { captureVerifiedLegacyStripeEvent, isRetainedLegacyStripeEvent } =
  testRequire(
    "../../src/lib/sponsorships/gateways/legacyStripeWebhook",
  ) as typeof import("../../src/lib/sponsorships/gateways/legacyStripeWebhook")
nodeModule._load = originalModuleLoad

const INTENT_ID = "11111111-1111-4111-8111-111111111111"
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222"
const GATEWAY_EVENT_ID = "33333333-3333-4333-8333-333333333333"
const SESSION_ID = "cs_test_serverintent123"
const PAYMENT_INTENT_ID = "pi_serverintent123"
const INVOICE_ID = "in_serverintent123"
const RENEWAL_INVOICE_ID = "in_serverintent456"
const SUBSCRIPTION_ID = "sub_serverintent123"
const CUSTOMER_ID = "cus_serverintent123"
const NOW = new Date("2026-07-18T10:00:00.000Z")
const EVENT_CREATED = Math.floor(NOW.getTime() / 1000) - 30
const PERIOD_START = EVENT_CREATED - 60
const PERIOD_END = PERIOD_START + 30 * 24 * 60 * 60
const APP_SECRET = Buffer.alloc(48, 11).toString("base64")

function stripeMetadata(
  paymentMode: "one_time" | "recurring",
  chargedAmountMinor: number,
  chargedCurrency: "USD" | "GBP" = "USD",
): Stripe.Metadata {
  const params = buildHostedStripeSessionParams({
    idempotencyKey: "stripe-checkout:test",
    customerEmail: "private.sponsor@example.com",
    productName: "Authoritative sponsorship",
    productImageUrl: null,
    sponsorshipIntentId: INTENT_ID,
    paymentAttemptId: ATTEMPT_ID,
    providerAccountScope: chargedCurrency === "USD" ? "stripe_us" : "stripe_uk",
    paymentMode,
    recurrenceInterval: paymentMode === "recurring" ? "month" : null,
    chargedAmountMinor,
    chargedCurrency,
    checkoutBaseUrl: "https://alice.creatorshare.com",
    stripeRegion: chargedCurrency === "USD" ? "us" : "uk",
    expiresAtUnixSeconds: EVENT_CREATED + 31 * 60,
  })
  return params.metadata as Stripe.Metadata
}

function boundary(
  overrides: Partial<AuthoritativeStripePaymentBoundary> = {},
): AuthoritativeStripePaymentBoundary {
  const paymentMode = overrides.paymentMode ?? "one_time"
  const recurrenceInterval =
    overrides.recurrenceInterval ??
    (paymentMode === "recurring" ? "month" : null)
  return {
    attemptId: ATTEMPT_ID,
    intentId: INTENT_ID,
    provider: "STRIPE",
    providerAccountScope: "stripe_us",
    attemptStatus: "pending",
    paymentMode,
    recurrenceInterval,
    baseAmountUsdCents: 1200,
    chargedAmountMinor: 1200,
    chargedCurrency: "USD",
    conversionRate: 1,
    providerObjectType: "checkout_session",
    providerObjectId: SESSION_ID,
    providerCustomerId: null,
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
  }
}

function event<T>(type: string, object: T, id = "evt_serverintent123") {
  return {
    id,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: EVENT_CREATED,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  } as unknown as Stripe.Event
}

function checkoutSession(
  metadata: Stripe.Metadata,
  overrides: Record<string, unknown> = {},
): Stripe.Checkout.Session {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    metadata,
    client_reference_id: ATTEMPT_ID,
    amount_total: 1200,
    currency: "usd",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    payment_intent: PAYMENT_INTENT_ID,
    subscription: null,
    customer: null,
    invoice: null,
    customer_details: { email: "private.sponsor@example.com" },
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

function invoice(
  metadata: Stripe.Metadata,
  overrides: Record<string, unknown> = {},
): Stripe.Invoice {
  return {
    id: INVOICE_ID,
    object: "invoice",
    metadata: {},
    subscription_details: { metadata },
    subscription: SUBSCRIPTION_ID,
    customer: CUSTOMER_ID,
    amount_paid: 1200,
    amount_due: 1200,
    amount_remaining: 0,
    currency: "usd",
    status: "paid",
    paid: true,
    attempted: true,
    attempt_count: 1,
    paid_out_of_band: false,
    collection_method: "charge_automatically",
    billing_reason: "subscription_cycle",
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    lines: {
      data: [
        {
          id: "il_serverintent123",
          object: "line_item",
          amount: 1200,
          currency: "usd",
          type: "subscription",
          proration: false,
          quantity: 1,
          subscription: SUBSCRIPTION_ID,
          price: {
            unit_amount: 1200,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
          },
          period: { start: PERIOD_START + 60, end: PERIOD_END - 60 },
        },
      ],
      has_more: false,
    },
    ...overrides,
  } as unknown as Stripe.Invoice
}

function subscription(
  metadata: Stripe.Metadata,
  overrides: Record<string, unknown> = {},
): Stripe.Subscription {
  return {
    id: SUBSCRIPTION_ID,
    object: "subscription",
    metadata,
    customer: CUSTOMER_ID,
    status: "active",
    collection_method: "charge_automatically",
    trial_start: null,
    trial_end: null,
    pause_collection: null,
    current_period_start: PERIOD_START,
    current_period_end: PERIOD_END,
    items: {
      data: [
        {
          quantity: 1,
          price: {
            unit_amount: 1200,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription
}

interface DependencyCalls {
  loadedAttemptIds: string[]
  checkoutSessionIds: string[]
  invoiceIds: string[]
  subscriptionIds: string[]
  ingested: VerifiedStripeGatewayEventInput[]
  quarantined: VerifiedStripeQuarantineInput[]
}

function dependenciesFor(
  authoritativeBoundary: AuthoritativeStripePaymentBoundary,
  options: {
    checkout?: Stripe.Checkout.Session
    invoice?: Stripe.Invoice
    subscription?: Stripe.Subscription
    duplicate?: boolean
  } = {},
): {
  dependencies: ServerIntentStripeWebhookDependencies
  calls: DependencyCalls
} {
  const calls: DependencyCalls = {
    loadedAttemptIds: [],
    checkoutSessionIds: [],
    invoiceIds: [],
    subscriptionIds: [],
    ingested: [],
    quarantined: [],
  }
  const crypto = createSponsorshipCrypto(
    { appSecretBase64: APP_SECRET },
    { randomBytes: (size) => Buffer.alloc(size, 17) },
  )
  return {
    calls,
    dependencies: {
      crypto,
      async loadPaymentBoundary(paymentAttemptId) {
        calls.loadedAttemptIds.push(paymentAttemptId)
        return authoritativeBoundary
      },
      async retrieveCheckoutSession(id) {
        calls.checkoutSessionIds.push(id)
        if (!options.checkout) throw new Error("Unexpected Checkout lookup")
        return options.checkout
      },
      async retrieveInvoice(id) {
        calls.invoiceIds.push(id)
        if (!options.invoice) throw new Error("Unexpected Invoice lookup")
        return options.invoice
      },
      async retrieveSubscription(id) {
        calls.subscriptionIds.push(id)
        if (!options.subscription) {
          throw new Error("Unexpected Subscription lookup")
        }
        return options.subscription
      },
      async ingestVerifiedEvent(input) {
        calls.ingested.push(input)
        return {
          gatewayEventId: GATEWAY_EVENT_ID,
          sponsorshipIntentId: INTENT_ID,
          paymentAttemptId: ATTEMPT_ID,
          processingStatus: "received",
          isDuplicate: options.duplicate === true,
        }
      },
      async quarantineVerifiedEvent(input) {
        calls.quarantined.push(input)
        return {
          gatewayEventId: GATEWAY_EVENT_ID,
          processingStatus: "ignored",
          isDuplicate: options.duplicate === true,
        }
      },
      now: () => NOW,
    },
  }
}

const requestContext = {
  requestId: "request-stripe-webhook",
  traceId: "trace-stripe-webhook",
  clientIp: "203.0.113.10",
  userAgent: "stripe-webhook-test",
  signatureHeader: "t=1784368800,v1=verified-test-signature",
  webhookSecretVersion: "current" as const,
}

type NoEffectRuntimeClient = Parameters<
  typeof ingestVerifiedNoEffectRefundRuntime
>[0]

function noEffectRuntimeInput(
  providerState: StripeNoEffectRefundStatus,
  providerEventId = `evt_runtime_${providerState}123`,
): VerifiedStripeNoEffectRefundInput {
  return {
    providerAccountScope: "stripe_us",
    providerEventId,
    eventType:
      providerState === "pending" ? "refund.created" : "refund.updated",
    providerObjectType: "refund",
    providerObjectId: `re_runtime_${providerState}123`,
    providerState,
    redactedPayload: {
      redaction_version: "stripe_refund_no_effect_v1",
      delivery_payload_sha256: "12".repeat(32),
      stripe_signature: requestContext.signatureHeader,
      webhook_secret_version: requestContext.webhookSecretVersion,
    },
    payloadCiphertext:
      `\\x${"ab".repeat(48)}` as VerifiedStripeNoEffectRefundInput["payloadCiphertext"],
    payloadSha256:
      `\\x${"cd".repeat(32)}` as VerifiedStripeNoEffectRefundInput["payloadSha256"],
    signatureVerifiedAt: NOW.toISOString(),
    occurredAt: new Date(EVENT_CREATED * 1000).toISOString(),
    verificationMethod: "stripe_webhook_signature",
    requestContext,
  }
}

async function ingestFixture(
  stripeEvent: Stripe.Event,
  rawPayload: string,
  dependencies: ServerIntentStripeWebhookDependencies,
  region: "us" | "uk" = "us",
) {
  return ingestServerIntentStripeEvent(
    {
      event: stripeEvent,
      region,
      rawPayload,
      requestContext,
    },
    dependencies,
  )
}

test.describe("verified server intent Stripe webhook ingestion", () => {
  test("maps every no-effect refund state into the terminal ignored RPC", async () => {
    const calls: Array<{
      name: string
      args: Record<string, unknown>
    }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return {
          data: [
            {
              gateway_event_id: GATEWAY_EVENT_ID,
              processing_status: "ignored",
              is_duplicate: false,
            },
          ],
          error: null,
        }
      },
    } as unknown as NoEffectRuntimeClient
    const statuses = [
      "pending",
      "requires_action",
      "failed",
      "canceled",
    ] as const

    for (const status of statuses) {
      await expect(
        ingestVerifiedNoEffectRefundRuntime(
          client,
          noEffectRuntimeInput(status),
        ),
      ).resolves.toEqual({
        gatewayEventId: GATEWAY_EVENT_ID,
        processingStatus: "ignored",
        isDuplicate: false,
      })
    }

    expect(calls).toHaveLength(4)
    expect(calls.map((call) => call.name)).toEqual(
      Array(4).fill("ingest_verified_payment_gateway_event_no_effect"),
    )
    expect(calls.map((call) => call.args.target_provider_state)).toEqual(
      statuses,
    )
    expect(calls[0].args).toMatchObject({
      target_provider: "STRIPE",
      target_provider_account_scope: "stripe_us",
      target_event_type: "refund.created",
      target_provider_object_type: "refund",
      target_verification_method: "stripe_webhook_signature",
      context_request_id: requestContext.requestId,
      context_trace_id: requestContext.traceId,
    })
  })

  test("returns the exact durable duplicate result for a no-effect replay", async () => {
    let deliveryCount = 0
    const client = {
      async rpc() {
        const isDuplicate = deliveryCount > 0
        deliveryCount += 1
        return {
          data: [
            {
              gateway_event_id: GATEWAY_EVENT_ID,
              processing_status: "ignored",
              is_duplicate: isDuplicate,
            },
          ],
          error: null,
        }
      },
    } as unknown as NoEffectRuntimeClient
    const input = noEffectRuntimeInput("failed", "evt_runtime_exact_replay123")

    await expect(
      ingestVerifiedNoEffectRefundRuntime(client, input),
    ).resolves.toMatchObject({ isDuplicate: false })
    await expect(
      ingestVerifiedNoEffectRefundRuntime(client, input),
    ).resolves.toMatchObject({
      processingStatus: "ignored",
      isDuplicate: true,
    })
  })

  test("maps no-effect database conflicts permanently and storage failures to 503", async () => {
    const conflictClient = {
      async rpc() {
        return { data: null, error: { code: "23505" } }
      },
    } as unknown as NoEffectRuntimeClient
    await expect(
      ingestVerifiedNoEffectRefundRuntime(
        conflictClient,
        noEffectRuntimeInput("canceled"),
      ),
    ).rejects.toMatchObject({
      code: "boundary-mismatch",
      retryable: false,
      httpStatus: 409,
    })

    const unavailableClient = {
      async rpc() {
        return { data: null, error: { code: "08006" } }
      },
    } as unknown as NoEffectRuntimeClient
    await expect(
      ingestVerifiedNoEffectRefundRuntime(
        unavailableClient,
        noEffectRuntimeInput("requires_action"),
      ),
    ).rejects.toMatchObject({
      code: "infrastructure",
      retryable: true,
      httpStatus: 503,
    })

    const unclosedClient = {
      async rpc() {
        return {
          data: [
            {
              gateway_event_id: GATEWAY_EVENT_ID,
              processing_status: "received",
              is_duplicate: false,
            },
          ],
          error: null,
        }
      },
    } as unknown as NoEffectRuntimeClient
    await expect(
      ingestVerifiedNoEffectRefundRuntime(
        unclosedClient,
        noEffectRuntimeInput("pending"),
      ),
    ).rejects.toMatchObject({
      code: "infrastructure",
      retryable: true,
      httpStatus: 503,
    })
  })

  test("pins the signed event API, account mode, and non-Connect envelope", () => {
    const metadata = stripeMetadata("one_time", 1200)
    const signed = event(
      "checkout.session.completed",
      checkoutSession(metadata),
    )
    expect(() =>
      validateServerIntentStripeEventEnvelope(signed, false),
    ).not.toThrow()
    expect(() =>
      validateServerIntentStripeEventEnvelope(
        { ...signed, api_version: "2024-06-20" } as Stripe.Event,
        false,
      ),
    ).toThrow(ServerIntentStripeWebhookError)
    expect(() =>
      validateStripeEventAccountEnvelope(
        { ...signed, api_version: "2024-06-20" } as Stripe.Event,
        false,
      ),
    ).not.toThrow()
    expect(() => validateServerIntentStripeEventEnvelope(signed, true)).toThrow(
      ServerIntentStripeWebhookError,
    )
    expect(() =>
      validateServerIntentStripeEventEnvelope(
        { ...signed, account: "acct_unexpected" } as Stripe.Event,
        false,
      ),
    ).toThrow(ServerIntentStripeWebhookError)
  })

  test("reads only bounded signed payloads without trusting a length header", async () => {
    const payload = JSON.stringify({ id: "evt_bounded", value: "safe" })
    await expect(
      readBoundedStripeWebhookPayload(
        new Request("https://creatorshare.com/api/webhooks/stripe", {
          method: "POST",
          body: payload,
        }),
      ),
    ).resolves.toBe(payload)

    await expect(
      readBoundedStripeWebhookPayload(
        new Request("https://creatorshare.com/api/webhooks/stripe", {
          method: "POST",
          body: "small",
          headers: {
            "content-length": String(MAXIMUM_SIGNED_PAYLOAD_BYTES + 1),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "payload-too-large" })

    await expect(
      readBoundedStripeWebhookPayload(
        new Request("https://creatorshare.com/api/webhooks/stripe", {
          method: "POST",
          body: "x".repeat(MAXIMUM_SIGNED_PAYLOAD_BYTES + 1),
        }),
      ),
    ).rejects.toMatchObject({ code: "payload-too-large" })
  })

  test("maps one-time Checkout success from server metadata and encrypts the signed payload", async () => {
    const metadata = stripeMetadata("one_time", 1200)
    const session = checkoutSession(metadata)
    const stripeEvent = event("checkout.session.completed", session)
    const rawPayload = JSON.stringify({
      id: stripeEvent.id,
      type: stripeEvent.type,
      data: {
        object: {
          id: session.id,
          customer_details: { email: "private.sponsor@example.com" },
          metadata,
        },
      },
    })
    const { dependencies, calls } = dependenciesFor(boundary())

    const result = await ingestFixture(stripeEvent, rawPayload, dependencies)

    expect(result).toMatchObject({
      handled: true,
      gatewayEventId: GATEWAY_EVENT_ID,
      isDuplicate: false,
    })
    expect(calls.loadedAttemptIds).toEqual([ATTEMPT_ID])
    expect(calls.checkoutSessionIds).toEqual([])
    expect(calls.invoiceIds).toEqual([])
    expect(calls.ingested).toHaveLength(1)
    const ingested = calls.ingested[0]
    expect(ingested).toMatchObject({
      paymentAttemptId: ATTEMPT_ID,
      providerAccountScope: "stripe_us",
      providerEventId: stripeEvent.id,
      eventType: "checkout.session.completed",
      providerObjectType: "checkout_session",
      providerObjectId: SESSION_ID,
      verificationMethod: "stripe_webhook_signature",
      factPaymentStatus: "paid",
      factServerPaymentAttemptId: ATTEMPT_ID,
      factProviderMovementType: "payment_intent",
      factProviderMovementId: PAYMENT_INTENT_ID,
      factBaseAmountUsdCents: 1200,
      factChargedAmountMinor: 1200,
      factChargedCurrency: "USD",
      factConversionRate: 1,
      factProviderCustomerId: null,
      factProviderSubscriptionId: null,
    })
    expect(ingested.payloadSha256).toBe(
      `\\x${stripeEventImmutableDigest(stripeEvent).toString("hex")}`,
    )
    expect(
      dependencies.crypto
        .decryptSecretPayload(fromSupabaseRpcBytea(ingested.payloadCiphertext))
        .toString("utf8"),
    ).toBe(rawPayload)
    const redacted = JSON.stringify(ingested.redactedPayload)
    expect(redacted).toContain(SERVER_INTENT_STRIPE_SCHEMA)
    expect(redacted).toContain(
      createHash("sha256").update(rawPayload).digest("hex"),
    )
    expect(redacted).not.toContain("private.sponsor")
    expect(redacted).not.toContain(PAYMENT_INTENT_ID)
    expect(ingested.payloadCiphertext).not.toContain("private.sponsor")
  })

  test("fails closed when the intent and the attempt disagree on terms", async () => {
    // The webhook trusts the payment attempt for the facts it records, and the
    // sponsorship intent is the authority the sponsor actually approved. The
    // parity gate between them was unasserted, so a mutation reading both
    // sides from the attempt row made the comparison vacuous while the suite
    // stayed green. Drift, a checkout bug, or a tampered attempt row would
    // then be ingested at an amount the intent never authorized.
    const divergences = [
      { intentChargedAmountMinor: 1201 },
      { intentBaseAmountUsdCents: 1201 },
      { intentChargedCurrency: "GBP" as const },
      { intentConversionRate: 0.5 },
      { intentPaymentMode: "recurring" as const },
    ]

    for (const divergence of divergences) {
      const metadata = stripeMetadata("one_time", 1200)
      const session = checkoutSession(metadata)
      const { dependencies, calls } = dependenciesFor(boundary(divergence))

      await expect(
        ingestFixture(
          event("checkout.session.completed", session),
          JSON.stringify({ id: "evt_parity", data: { object: session } }),
          dependencies,
        ),
        `${JSON.stringify(divergence)} must fail closed`,
      ).rejects.toMatchObject({ code: "boundary-mismatch" })

      // Nothing may be recorded from a boundary the intent does not agree with.
      expect(calls.ingested).toHaveLength(0)
    }
  })

  test("maps recurring Checkout success and retrieves only the missing invoice facts", async () => {
    const metadata = stripeMetadata("recurring", 1200)
    const session = checkoutSession(metadata, {
      mode: "subscription",
      payment_intent: null,
      subscription: SUBSCRIPTION_ID,
      customer: CUSTOMER_ID,
      invoice: INVOICE_ID,
    })
    const recurringInvoice = invoice(metadata, {
      billing_reason: "subscription_create",
    })
    const { dependencies, calls } = dependenciesFor(
      boundary({ paymentMode: "recurring" }),
      { invoice: recurringInvoice },
    )

    await ingestFixture(
      event("checkout.session.completed", session),
      JSON.stringify({ id: "evt_recurring", data: { object: session } }),
      dependencies,
    )

    expect(calls.checkoutSessionIds).toEqual([])
    expect(calls.invoiceIds).toEqual([INVOICE_ID])
    expect(calls.ingested[0]).toMatchObject({
      factProviderMovementType: "invoice",
      factProviderMovementId: INVOICE_ID,
      factProviderCustomerId: CUSTOMER_ID,
      factProviderSubscriptionId: SUBSCRIPTION_ID,
      factPeriodStart: new Date((PERIOD_START + 60) * 1000).toISOString(),
      factPeriodEnd: new Date((PERIOD_END - 60) * 1000).toISOString(),
    })
  })

  test("maps signed invoice failure without trusting email or metadata amounts", async () => {
    const metadata = stripeMetadata("recurring", 1200)
    const authoritative = boundary({
      paymentMode: "recurring",
      providerCustomerId: CUSTOMER_ID,
      providerSubscriptionObjectType: "subscription",
      providerSubscriptionId: SUBSCRIPTION_ID,
    })
    const { dependencies, calls } = dependenciesFor(authoritative)
    const failedInvoice = invoice(metadata, {
      id: RENEWAL_INVOICE_ID,
      amount_paid: 0,
      amount_remaining: 1200,
      status: "open",
      paid: false,
      attempted: true,
      attempt_count: 1,
      customer_email: "must.not.persist@example.com",
    })

    await ingestFixture(
      event("invoice.payment_failed", failedInvoice, "evt_invoice_failed123"),
      JSON.stringify({
        id: "evt_invoice_failed123",
        data: { object: failedInvoice },
      }),
      dependencies,
    )

    expect(calls.checkoutSessionIds).toEqual([])
    expect(calls.ingested[0]).toMatchObject({
      providerObjectType: "invoice",
      providerObjectId: RENEWAL_INVOICE_ID,
      factParentProviderObjectType: "checkout_session",
      factParentProviderObjectId: SESSION_ID,
      factProviderCustomerId: CUSTOMER_ID,
      factProviderSubscriptionId: SUBSCRIPTION_ID,
      factFailureCode: "stripe_invoice_payment_failed",
      factProviderMovementType: null,
      factBaseAmountUsdCents: null,
    })
    expect(JSON.stringify(calls.ingested[0].redactedPayload)).not.toContain(
      "must.not.persist",
    )
  })

  test("maps recurring invoice success through the attached Checkout chain", async () => {
    const metadata = stripeMetadata("recurring", 1200)
    const attachedCheckout = checkoutSession(metadata, {
      mode: "subscription",
      payment_intent: null,
      subscription: SUBSCRIPTION_ID,
      customer: CUSTOMER_ID,
      invoice: INVOICE_ID,
    })
    const renewalInvoice = invoice(metadata, { id: RENEWAL_INVOICE_ID })
    const { dependencies, calls } = dependenciesFor(
      boundary({ paymentMode: "recurring" }),
      { checkout: attachedCheckout },
    )

    await ingestFixture(
      event("invoice.paid", renewalInvoice, "evt_invoice_paid123"),
      JSON.stringify({
        id: "evt_invoice_paid123",
        data: { object: renewalInvoice },
      }),
      dependencies,
    )

    expect(calls.checkoutSessionIds).toEqual([SESSION_ID])
    expect(calls.invoiceIds).toEqual([])
    expect(calls.ingested[0]).toMatchObject({
      providerObjectType: "invoice",
      providerObjectId: RENEWAL_INVOICE_ID,
      factProviderMovementType: "invoice",
      factProviderMovementId: RENEWAL_INVOICE_ID,
      factProviderCustomerId: CUSTOMER_ID,
      factProviderSubscriptionId: SUBSCRIPTION_ID,
      factBaseAmountUsdCents: 1200,
      factChargedAmountMinor: 1200,
      factChargedCurrency: "USD",
      factConversionRate: 1,
      factPeriodStart: new Date((PERIOD_START + 60) * 1000).toISOString(),
      factPeriodEnd: new Date((PERIOD_END - 60) * 1000).toISOString(),
    })
  })

  test("rejects and durably quarantines provider-side subscription mutation invoices", async () => {
    const metadata = stripeMetadata("recurring", 1200)
    const authoritative = boundary({
      paymentMode: "recurring",
      providerCustomerId: CUSTOMER_ID,
      providerSubscriptionObjectType: "subscription",
      providerSubscriptionId: SUBSCRIPTION_ID,
    })
    const mutatedInvoice = invoice(metadata, {
      id: RENEWAL_INVOICE_ID,
      billing_reason: "subscription_update",
    })
    const stripeEvent = event(
      "invoice.paid",
      mutatedInvoice,
      "evt_subscription_mutation123",
    )
    const rawPayload = JSON.stringify({
      id: stripeEvent.id,
      data: { object: mutatedInvoice },
    })
    const { dependencies, calls } = dependenciesFor(authoritative)

    let mismatch: ServerIntentStripeWebhookErrorInstance | null = null
    try {
      await ingestFixture(stripeEvent, rawPayload, dependencies)
    } catch (error) {
      expect(error).toBeInstanceOf(ServerIntentStripeWebhookError)
      expect(error).toMatchObject({
        code: "provider-fact-mismatch",
        retryable: false,
      })
      mismatch = error as ServerIntentStripeWebhookErrorInstance
    }

    expect(mismatch).not.toBeNull()
    expect(calls.ingested).toEqual([])

    const quarantined = await quarantineVerifiedStripeEvent(
      {
        event: stripeEvent,
        region: "us",
        rawPayload,
        requestContext,
        error: mismatch as ServerIntentStripeWebhookErrorInstance,
      },
      dependencies,
    )

    expect(quarantined).toMatchObject({
      quarantined: true,
      processingStatus: "ignored",
      isDuplicate: false,
    })
    expect(calls.quarantined).toHaveLength(1)
    expect(calls.quarantined[0]).toMatchObject({
      providerEventId: stripeEvent.id,
      providerObjectType: "invoice",
      providerObjectId: RENEWAL_INVOICE_ID,
      errorCode: "provider-fact-mismatch",
    })
  })

  test("rejects manual or partial invoice payment and wrong recurring cadence", async () => {
    const metadata = stripeMetadata("recurring", 1200)
    const authoritative = boundary({
      paymentMode: "recurring",
      providerCustomerId: CUSTOMER_ID,
      providerSubscriptionObjectType: "subscription",
      providerSubscriptionId: SUBSCRIPTION_ID,
    })

    const manual = dependenciesFor(authoritative)
    await expect(
      ingestFixture(
        event(
          "invoice.paid",
          invoice(metadata, { paid_out_of_band: true }),
          "evt_manual_invoice123",
        ),
        "manual-invoice",
        manual.dependencies,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    expect(manual.calls.ingested).toEqual([])

    const partial = dependenciesFor(authoritative)
    await expect(
      ingestFixture(
        event(
          "invoice.payment_failed",
          invoice(metadata, {
            status: "open",
            paid: false,
            amount_paid: 600,
            amount_remaining: 600,
            attempted: true,
            attempt_count: 1,
          }),
          "evt_partial_invoice123",
        ),
        "partial-invoice",
        partial.dependencies,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    expect(partial.calls.ingested).toEqual([])

    const wrongCadenceInvoice = invoice(metadata)
    ;(wrongCadenceInvoice.lines.data[0].price as Stripe.Price).recurring = {
      interval: "year",
      interval_count: 1,
    } as Stripe.Price.Recurring
    const cadence = dependenciesFor(authoritative)
    await expect(
      ingestFixture(
        event(
          "invoice.payment_succeeded",
          wrongCadenceInvoice,
          "evt_wrong_cadence123",
        ),
        "wrong-cadence",
        cadence.dependencies,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    expect(cadence.calls.ingested).toEqual([])
  })

  test("maps signed subscription lifecycle and validates price and period facts", async () => {
    const metadata = stripeMetadata("recurring", 1200)
    const authoritative = boundary({
      paymentMode: "recurring",
      providerCustomerId: CUSTOMER_ID,
      providerSubscriptionObjectType: "subscription",
      providerSubscriptionId: SUBSCRIPTION_ID,
    })
    const { dependencies, calls } = dependenciesFor(authoritative)
    const updated = subscription(metadata, { status: "past_due" })

    await ingestFixture(
      event(
        "customer.subscription.updated",
        updated,
        "evt_subscription_updated123",
      ),
      JSON.stringify({
        id: "evt_subscription_updated123",
        data: { object: updated },
      }),
      dependencies,
    )

    expect(calls.ingested[0]).toMatchObject({
      providerObjectType: "subscription",
      providerObjectId: SUBSCRIPTION_ID,
      factProviderCustomerId: CUSTOMER_ID,
      factProviderSubscriptionId: SUBSCRIPTION_ID,
      factLifecycleState: "incomplete",
      factPeriodStart: new Date(PERIOD_START * 1000).toISOString(),
      factPeriodEnd: new Date(PERIOD_END * 1000).toISOString(),
    })

    const trialing = dependenciesFor(authoritative)
    await expect(
      ingestFixture(
        event(
          "customer.subscription.updated",
          subscription(metadata, {
            status: "trialing",
            trial_start: PERIOD_START,
            trial_end: PERIOD_END,
          }),
          "evt_subscription_trialing123",
        ),
        "trialing-subscription",
        trialing.dependencies,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    expect(trialing.calls.ingested).toEqual([])

    const paused = dependenciesFor(authoritative)
    await expect(
      ingestFixture(
        event(
          "customer.subscription.updated",
          subscription(metadata, {
            pause_collection: { behavior: "void" },
          }),
          "evt_subscription_paused123",
        ),
        "paused-subscription",
        paused.dependencies,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    expect(paused.calls.ingested).toEqual([])
  })

  test("rejects signature-derived scope, amount, and attached object mismatches", async () => {
    const usMetadata = stripeMetadata("one_time", 1200)

    const scope = dependenciesFor(boundary())
    await expect(
      ingestFixture(
        event("checkout.session.completed", checkoutSession(usMetadata)),
        "scope-mismatch",
        scope.dependencies,
        "uk",
      ),
    ).rejects.toMatchObject({ code: "invalid-metadata" })
    expect(scope.calls.loadedAttemptIds).toEqual([])

    const amount = dependenciesFor(boundary())
    await expect(
      ingestFixture(
        event(
          "checkout.session.completed",
          checkoutSession(usMetadata, { amount_total: 1199 }),
          "evt_amount_mismatch123",
        ),
        "amount-mismatch",
        amount.dependencies,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    expect(amount.calls.ingested).toEqual([])

    const object = dependenciesFor(boundary())
    await expect(
      ingestFixture(
        event(
          "checkout.session.completed",
          checkoutSession(usMetadata, { id: "cs_test_wrongobject123" }),
          "evt_object_mismatch123",
        ),
        "object-mismatch",
        object.dependencies,
      ),
    ).rejects.toMatchObject({ code: "provider-fact-mismatch" })
    expect(object.calls.ingested).toEqual([])
  })

  test("returns exact duplicate ingestion and preserves the same immutable facts", async () => {
    const metadata = stripeMetadata("one_time", 1200)
    const stripeEvent = event(
      "checkout.session.completed",
      checkoutSession(metadata),
      "evt_duplicate_serverintent123",
    )
    const { dependencies, calls } = dependenciesFor(boundary(), {
      duplicate: true,
    })

    const result = await ingestFixture(
      stripeEvent,
      JSON.stringify({ id: stripeEvent.id, data: stripeEvent.data }),
      dependencies,
    )

    expect(result).toMatchObject({ handled: true, isDuplicate: true })
    expect(calls.ingested).toHaveLength(1)

    const redelivery = {
      ...stripeEvent,
      pending_webhooks: stripeEvent.pending_webhooks + 3,
    } as Stripe.Event
    expect(stripeEventImmutableDigest(redelivery)).toEqual(
      stripeEventImmutableDigest(stripeEvent),
    )
  })

  test("marks a missing provider chain lookup as retryable infrastructure failure", async () => {
    const metadata = stripeMetadata("recurring", 1200)
    const renewalInvoice = invoice(metadata, { id: RENEWAL_INVOICE_ID })
    const { dependencies, calls } = dependenciesFor(
      boundary({ paymentMode: "recurring" }),
    )

    await expect(
      ingestFixture(
        event(
          "invoice.payment_succeeded",
          renewalInvoice,
          "evt_provider_lookup_failure123",
        ),
        JSON.stringify({
          id: "evt_provider_lookup_failure123",
          data: { object: renewalInvoice },
        }),
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: "infrastructure",
      retryable: true,
      httpStatus: 503,
    })
    expect(calls.checkoutSessionIds).toEqual([SESSION_ID])
    expect(calls.ingested).toEqual([])
  })

  test("recovers server intent metadata from the authoritative subscription", async () => {
    const metadata = stripeMetadata("recurring", 1200)
    const metadataSparseInvoice = invoice(metadata, {
      metadata: {},
      subscription_details: null,
      subscription: SUBSCRIPTION_ID,
    })
    const { dependencies, calls } = dependenciesFor(
      boundary({ paymentMode: "recurring" }),
      { subscription: subscription(metadata) },
    )

    await expect(
      classifyServerIntentStripeEventWithProviderLookup(
        event("invoice.paid", metadataSparseInvoice),
        dependencies,
      ),
    ).resolves.toEqual({
      kind: "server-intent",
      metadata: {
        sponsorshipIntentId: INTENT_ID,
        paymentAttemptId: ATTEMPT_ID,
        providerAccountScope: "stripe_us",
      },
    })
    expect(calls.subscriptionIds).toEqual([SUBSCRIPTION_ID])
  })

  test("keeps a metadata sparse legacy invoice outside the server intent lane", async () => {
    const metadataSparseInvoice = invoice(
      {},
      {
        metadata: {},
        subscription_details: null,
        subscription: SUBSCRIPTION_ID,
      },
    )
    const { dependencies, calls } = dependenciesFor(boundary(), {
      subscription: subscription({
        creatorshare_platform: "true",
        type: "sponsorship",
      }),
    })

    await expect(
      classifyServerIntentStripeEventWithProviderLookup(
        event("invoice.paid", metadataSparseInvoice),
        dependencies,
      ),
    ).resolves.toEqual({ kind: "not-server-intent" })
    expect(calls.subscriptionIds).toEqual([SUBSCRIPTION_ID])
  })

  test("treats an unavailable subscription metadata lookup as retryable", async () => {
    const metadataSparseInvoice = invoice(
      {},
      {
        metadata: {},
        subscription_details: null,
        subscription: SUBSCRIPTION_ID,
      },
    )
    const { dependencies } = dependenciesFor(boundary())

    await expect(
      classifyServerIntentStripeEventWithProviderLookup(
        event("invoice.paid", metadataSparseInvoice),
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: "infrastructure",
      retryable: true,
      httpStatus: 503,
    })
  })

  test("leaves legacy metadata untouched and rejects unsupported server intent events", async () => {
    const legacy = event(
      "checkout.session.completed",
      checkoutSession({ creatorshare_platform: "true", type: "sponsorship" }),
    )
    expect(classifyServerIntentStripeEvent(legacy)).toEqual({
      kind: "not-server-intent",
    })

    expect(() =>
      classifyServerIntentStripeEvent(
        event(
          "checkout.session.completed",
          checkoutSession({
            creatorshare_platform: "true",
            payment_attempt_id: ATTEMPT_ID,
          }),
        ),
      ),
    ).toThrow(ServerIntentStripeWebhookError)

    const metadata = stripeMetadata("one_time", 1200)
    const unsupported = event(
      "checkout.session.opened",
      checkoutSession(metadata),
      "evt_opened_serverintent123",
    )
    const { dependencies } = dependenciesFor(boundary())
    await expect(
      ingestFixture(unsupported, "unsupported", dependencies),
    ).rejects.toBeInstanceOf(ServerIntentStripeWebhookError)
    await expect(
      ingestFixture(unsupported, "unsupported", dependencies),
    ).rejects.toMatchObject({ code: "unsupported-event", retryable: false })
  })

  test("durably records exact signed expired and unpaid Checkout facts", async () => {
    const metadata = stripeMetadata("one_time", 1200)
    const expired = checkoutSession(metadata, {
      status: "expired",
      payment_status: "unpaid",
      payment_intent: null,
    })
    const { dependencies, calls } = dependenciesFor(boundary())

    await ingestFixture(
      event("checkout.session.expired", expired, "evt_expired_exact123"),
      JSON.stringify({ id: "evt_expired_exact123", data: { object: expired } }),
      dependencies,
    )

    expect(calls.ingested[0]).toMatchObject({
      eventType: "checkout.session.expired",
      providerObjectType: "checkout_session",
      providerObjectId: SESSION_ID,
      factServerPaymentAttemptId: ATTEMPT_ID,
      factPaymentStatus: "unpaid",
      factProviderMovementType: null,
      factFailureCode: null,
      factLifecycleState: "expired",
    })
  })

  test("encrypts and durably quarantines a verified permanent mismatch", async () => {
    const metadata = stripeMetadata("one_time", 1200)
    const stripeEvent = event(
      "checkout.session.completed",
      checkoutSession(metadata),
      "evt_quarantine_exact123",
    )
    const rawPayload = JSON.stringify({
      id: stripeEvent.id,
      private_email: "private.sponsor@example.com",
      data: stripeEvent.data,
    })
    const { dependencies, calls } = dependenciesFor(boundary())
    const mismatch = new ServerIntentStripeWebhookError(
      "provider-fact-mismatch",
    )

    const result = await quarantineVerifiedStripeEvent(
      {
        event: stripeEvent,
        region: "us",
        rawPayload,
        requestContext,
        error: mismatch,
      },
      dependencies,
    )

    expect(result).toMatchObject({
      quarantined: true,
      processingStatus: "ignored",
      isDuplicate: false,
    })
    expect(calls.quarantined).toHaveLength(1)
    expect(calls.quarantined[0]).toMatchObject({
      providerAccountScope: "stripe_us",
      providerEventId: stripeEvent.id,
      providerObjectType: "checkout_session",
      providerObjectId: SESSION_ID,
      errorCode: "provider-fact-mismatch",
    })
    expect(JSON.stringify(calls.quarantined[0].redactedPayload)).not.toContain(
      "private.sponsor",
    )
    expect(
      dependencies.crypto
        .decryptSecretPayload(
          fromSupabaseRpcBytea(calls.quarantined[0].payloadCiphertext),
        )
        .toString("utf8"),
    ).toBe(rawPayload)
  })
})

test.describe("durable retained Stripe webhook capture", () => {
  function legacyDependencies(options: { duplicate?: boolean } = {}) {
    const captured: VerifiedLegacyStripeEventInput[] = []
    const dependencies: LegacyStripeWebhookDependencies = {
      crypto: createSponsorshipCrypto(
        { appSecretBase64: APP_SECRET },
        { randomBytes: (size) => Buffer.alloc(size, 19) },
      ),
      async ingestVerifiedLegacyEvent(input) {
        captured.push(input)
        return {
          gatewayEventId: GATEWAY_EVENT_ID,
          processingStatus: options.duplicate ? "processed" : "received",
          isDuplicate: options.duplicate === true,
        }
      },
      now: () => NOW,
    }
    return { captured, dependencies }
  }

  test("encrypts a legacy renewal before acknowledging its regional event identity", async () => {
    const stripeEvent = event(
      "invoice.paid",
      invoice({}, { metadata: {}, subscription_details: null }),
      "evt_legacy_durable123",
    )
    const rawPayload = JSON.stringify({
      ...stripeEvent,
      private_email: "private.legacy@example.com",
    })
    const { captured, dependencies } = legacyDependencies()

    await expect(
      captureVerifiedLegacyStripeEvent(
        {
          event: stripeEvent,
          region: "us",
          rawPayload,
          requestContext,
        },
        dependencies,
      ),
    ).resolves.toEqual({
      gatewayEventId: GATEWAY_EVENT_ID,
      processingStatus: "received",
      isDuplicate: false,
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      providerAccountScope: "stripe_us",
      providerEventId: stripeEvent.id,
      eventType: "invoice.paid",
      providerObjectType: "invoice",
      providerObjectId: INVOICE_ID,
    })
    expect(JSON.stringify(captured[0].redactedPayload)).not.toContain(
      "private.legacy",
    )
    expect(
      dependencies.crypto
        .decryptSecretPayload(
          fromSupabaseRpcBytea(captured[0].payloadCiphertext),
        )
        .toString("utf8"),
    ).toBe(rawPayload)
  })

  test("preserves the processed no-op result for an identical captured redelivery", async () => {
    const stripeEvent = event(
      "invoice.payment_succeeded",
      invoice({}, { metadata: {}, subscription_details: null }),
      "evt_legacy_duplicate123",
    )
    const { captured, dependencies } = legacyDependencies({ duplicate: true })

    await expect(
      captureVerifiedLegacyStripeEvent(
        {
          event: stripeEvent,
          region: "uk",
          rawPayload: JSON.stringify(stripeEvent),
          requestContext,
        },
        dependencies,
      ),
    ).resolves.toMatchObject({
      processingStatus: "processed",
      isDuplicate: true,
    })
    expect(captured[0].providerAccountScope).toBe("stripe_uk")
  })

  test("does not admit typed v2 metadata or unrelated signed events to legacy capture", async () => {
    const typedEvent = event(
      "checkout.session.completed",
      checkoutSession(stripeMetadata("one_time", 1200)),
      "evt_typed_never_legacy123",
    )
    const unrelatedEvent = event(
      "payment_intent.succeeded",
      { id: PAYMENT_INTENT_ID, object: "payment_intent" },
      "evt_unrelated_never_legacy123",
    )
    const { captured, dependencies } = legacyDependencies()

    expect(isRetainedLegacyStripeEvent(typedEvent)).toBe(false)
    expect(isRetainedLegacyStripeEvent(unrelatedEvent)).toBe(false)
    await expect(
      captureVerifiedLegacyStripeEvent(
        {
          event: typedEvent,
          region: "us",
          rawPayload: JSON.stringify(typedEvent),
          requestContext,
        },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "unsupported-event", retryable: false })
    expect(captured).toEqual([])
  })
})
