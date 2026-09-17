import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type Stripe from "stripe"

import type {
  AuthoritativeStripeFinancialMovement,
  StripeFinancialAdjustmentDependencies,
  StripeFinancialMovementLookup,
  VerifiedStripeFinancialAdjustmentInput,
  VerifiedStripeFinancialAdjustmentResult,
  VerifiedStripeNoEffectRefundInput,
  VerifiedStripeNoEffectRefundResult,
} from "../../src/lib/sponsorships/gateways/stripeFinancialAdjustments"

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
    "tests/sponsorships/stripe-financial-adjustments.spec.ts",
  ),
)
const { createSponsorshipCrypto, fromSupabaseRpcBytea } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as typeof import("../../src/lib/sponsorships/crypto")
const {
  deriveProportionalBaseUsdCents,
  ingestStripeFinancialAdjustment,
  StripeFinancialAdjustmentError,
} = testRequire(
  "../../src/lib/sponsorships/gateways/stripeFinancialAdjustments",
) as typeof import("../../src/lib/sponsorships/gateways/stripeFinancialAdjustments")
const { stripeEventImmutableDigest } = testRequire(
  "../../src/lib/sponsorships/gateways/stripeWebhook",
) as typeof import("../../src/lib/sponsorships/gateways/stripeWebhook")
nodeModule._load = originalModuleLoad

const ORIGINAL_MOVEMENT_ID = "11111111-1111-4111-8111-111111111111"
const PAYMENT_ATTEMPT_ID = "22222222-2222-4222-8222-222222222222"
const SPONSORSHIP_INTENT_ID = "33333333-3333-4333-8333-333333333333"
const GATEWAY_EVENT_ID = "44444444-4444-4444-8444-444444444444"
const PAYMENT_INTENT_ID = "pi_adjustment123"
const OTHER_PAYMENT_INTENT_ID = "pi_adjustment456"
const CHARGE_ID = "ch_adjustment123"
const INVOICE_ID = "in_adjustment123"
const REFUND_ID = "re_adjustment123"
const DISPUTE_ID = "dp_adjustment123"
const DISPUTE_DEBIT_TRANSACTION_ID = "txn_dispute_debit123"
const DISPUTE_CREDIT_TRANSACTION_ID = "txn_dispute_credit123"
const NOW = new Date("2026-07-18T12:00:00.000Z")
const EVENT_CREATED = Math.floor(NOW.getTime() / 1000) - 30
const APP_SECRET = Buffer.alloc(48, 29).toString("base64")

const requestContext = {
  requestId: "request-stripe-adjustment",
  traceId: "trace-stripe-adjustment",
  clientIp: "203.0.113.20",
  userAgent: "stripe-adjustment-test",
  signatureHeader: "t=1784368800,v1=verified-adjustment-signature",
  webhookSecretVersion: "current" as const,
}

function event<T>(
  type: string,
  object: T,
  id = "evt_adjustment123",
): Stripe.Event {
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

function charge(overrides: Record<string, unknown> = {}): Stripe.Charge {
  return {
    id: CHARGE_ID,
    object: "charge",
    amount: 1250,
    amount_captured: 1250,
    amount_refunded: 0,
    captured: true,
    currency: "usd",
    invoice: null,
    paid: true,
    payment_intent: PAYMENT_INTENT_ID,
    status: "succeeded",
    ...overrides,
  } as unknown as Stripe.Charge
}

function paymentIntent(
  overrides: Record<string, unknown> = {},
): Stripe.PaymentIntent {
  return {
    id: PAYMENT_INTENT_ID,
    object: "payment_intent",
    amount: 1250,
    amount_received: 1250,
    currency: "usd",
    invoice: null,
    latest_charge: CHARGE_ID,
    status: "succeeded",
    ...overrides,
  } as unknown as Stripe.PaymentIntent
}

function refund(overrides: Record<string, unknown> = {}): Stripe.Refund {
  return {
    id: REFUND_ID,
    object: "refund",
    amount: 625,
    charge: CHARGE_ID,
    created: EVENT_CREATED - 5,
    currency: "usd",
    metadata: {},
    payment_intent: PAYMENT_INTENT_ID,
    status: "succeeded",
    ...overrides,
  } as unknown as Stripe.Refund
}

function dispute(overrides: Record<string, unknown> = {}): Stripe.Dispute {
  return {
    id: DISPUTE_ID,
    object: "dispute",
    amount: 500,
    balance_transactions: [],
    charge: CHARGE_ID,
    created: EVENT_CREATED - 10,
    currency: "usd",
    livemode: false,
    payment_intent: PAYMENT_INTENT_ID,
    status: "needs_response",
    ...overrides,
  } as unknown as Stripe.Dispute
}

function balanceTransaction(
  id: string,
  amount: number,
  overrides: Record<string, unknown> = {},
): Stripe.BalanceTransaction {
  return {
    id,
    object: "balance_transaction",
    amount,
    currency: "usd",
    created: EVENT_CREATED - 5,
    fee: 0,
    net: amount,
    reporting_category: "dispute",
    status: "available",
    type: "adjustment",
    ...overrides,
  } as unknown as Stripe.BalanceTransaction
}

function movement(
  overrides: Partial<AuthoritativeStripeFinancialMovement> = {},
): AuthoritativeStripeFinancialMovement {
  const providerMovementType =
    overrides.providerMovementType ?? "payment_intent"
  return {
    id: ORIGINAL_MOVEMENT_ID,
    paymentAttemptId: PAYMENT_ATTEMPT_ID,
    sponsorshipIntentId: SPONSORSHIP_INTENT_ID,
    provider: "STRIPE",
    providerAccountScope: "stripe_us",
    providerMovementType,
    providerMovementId:
      overrides.providerMovementId ??
      (providerMovementType === "invoice" ? INVOICE_ID : PAYMENT_INTENT_ID),
    entryKind: "sponsorship_payment",
    originalFinancialMovementId: null,
    paymentMode:
      overrides.paymentMode ??
      (providerMovementType === "invoice" ? "recurring" : "one_time"),
    baseAmountUsdCents: 1000,
    chargedAmountMinor: 1250,
    chargedCurrency: "USD",
    conversionRate: 1.25,
    occurredAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  }
}

interface DependencyCalls {
  chargeIds: string[]
  paymentIntentIds: string[]
  movementLookups: StripeFinancialMovementLookup[]
  ingested: VerifiedStripeFinancialAdjustmentInput[]
  noEffectIngested: VerifiedStripeNoEffectRefundInput[]
}

function dependenciesFor(
  original: AuthoritativeStripeFinancialMovement,
  options: {
    charge?: Stripe.Charge
    paymentIntent?: Stripe.PaymentIntent
    adjustmentKind?: VerifiedStripeFinancialAdjustmentResult["adjustmentKind"]
    duplicate?: boolean
    noEffectError?: unknown
    noEffectProcessingStatus?: string
  } = {},
): {
  dependencies: StripeFinancialAdjustmentDependencies
  calls: DependencyCalls
} {
  const calls: DependencyCalls = {
    chargeIds: [],
    paymentIntentIds: [],
    movementLookups: [],
    ingested: [],
    noEffectIngested: [],
  }
  const seenNoEffectEvents = new Set<string>()
  const crypto = createSponsorshipCrypto(
    { appSecretBase64: APP_SECRET },
    { randomBytes: (size) => Buffer.alloc(size, 31) },
  )
  return {
    calls,
    dependencies: {
      crypto,
      async retrieveCharge(id) {
        calls.chargeIds.push(id)
        if (!options.charge) throw new Error("Unexpected Charge lookup")
        return options.charge
      },
      async retrievePaymentIntent(id) {
        calls.paymentIntentIds.push(id)
        if (!options.paymentIntent) {
          throw new Error("Unexpected PaymentIntent lookup")
        }
        return options.paymentIntent
      },
      async loadOriginalMovement(lookup) {
        calls.movementLookups.push(lookup)
        return original
      },
      async ingestVerifiedAdjustment(input) {
        calls.ingested.push(input)
        return {
          gatewayEventId: GATEWAY_EVENT_ID,
          originalFinancialMovementId: ORIGINAL_MOVEMENT_ID,
          paymentAttemptId: PAYMENT_ATTEMPT_ID,
          sponsorshipIntentId: SPONSORSHIP_INTENT_ID,
          processingStatus: "received",
          adjustmentKind: options.adjustmentKind ?? "sponsorship_refund",
          isDuplicate: options.duplicate === true,
        }
      },
      async ingestVerifiedNoEffectRefund(input) {
        calls.noEffectIngested.push(input)
        if (options.noEffectError) throw options.noEffectError
        const isDuplicate = seenNoEffectEvents.has(input.providerEventId)
        seenNoEffectEvents.add(input.providerEventId)
        return {
          gatewayEventId: GATEWAY_EVENT_ID,
          processingStatus: options.noEffectProcessingStatus ?? "ignored",
          isDuplicate,
        } as VerifiedStripeNoEffectRefundResult
      },
      now: () => NOW,
    },
  }
}

async function ingestFixture(
  stripeEvent: Stripe.Event,
  rawPayload: string,
  dependencies: StripeFinancialAdjustmentDependencies,
  region: "us" | "uk" = "us",
) {
  return ingestStripeFinancialAdjustment(
    {
      event: stripeEvent,
      region,
      rawPayload,
      requestContext,
    },
    dependencies,
  )
}

test.describe("verified Stripe sponsorship financial adjustments", () => {
  test("ignores non-adjustment events without touching provider or database state", async () => {
    const { dependencies, calls } = dependenciesFor(movement())

    await expect(
      ingestFixture(
        event("checkout.session.completed", { id: "cs_unrelated" }),
        "{}",
        dependencies,
      ),
    ).resolves.toEqual({ handled: false })
    expect(calls).toEqual({
      chargeIds: [],
      paymentIntentIds: [],
      movementLookups: [],
      ingested: [],
      noEffectIngested: [],
    })
  })

  test("durably ignores every signed refund state with no current financial effect", async () => {
    const { dependencies, calls } = dependenciesFor(movement())
    const fixtures = [
      { status: "pending", eventType: "refund.created" },
      { status: "requires_action", eventType: "refund.updated" },
      { status: "failed", eventType: "refund.updated" },
      { status: "canceled", eventType: "refund.updated" },
    ] as const

    for (const [index, fixture] of fixtures.entries()) {
      const stripeEvent = event(
        fixture.eventType,
        refund({ status: fixture.status }),
        `evt_no_effect_${fixture.status}123`,
      )
      const rawPayload = JSON.stringify({
        id: stripeEvent.id,
        status: fixture.status,
        private_email: `private-${index}@example.com`,
      })

      await expect(
        ingestFixture(stripeEvent, rawPayload, dependencies),
      ).resolves.toEqual({
        handled: true,
        ingested: false,
        reason: "refund-not-succeeded",
        refundStatus: fixture.status,
        gatewayEventId: GATEWAY_EVENT_ID,
        processingStatus: "ignored",
        isDuplicate: false,
      })

      const ingested = calls.noEffectIngested[index]
      expect(ingested).toMatchObject({
        providerAccountScope: "stripe_us",
        providerEventId: stripeEvent.id,
        eventType: fixture.eventType,
        providerObjectType: "refund",
        providerObjectId: REFUND_ID,
        providerState: fixture.status,
        verificationMethod: "stripe_webhook_signature",
        occurredAt: new Date(EVENT_CREATED * 1000).toISOString(),
        signatureVerifiedAt: NOW.toISOString(),
        requestContext,
      })
      expect(ingested.payloadSha256).toBe(
        `\\x${stripeEventImmutableDigest(stripeEvent).toString("hex")}`,
      )
      expect(
        dependencies.crypto
          .decryptSecretPayload(
            fromSupabaseRpcBytea(ingested.payloadCiphertext),
          )
          .toString("utf8"),
      ).toBe(rawPayload)
      expect(ingested.redactedPayload).toMatchObject({
        redaction_version: "stripe_refund_no_effect_v1",
        delivery_payload_sha256: createHash("sha256")
          .update(rawPayload)
          .digest("hex"),
        stripe_signature: requestContext.signatureHeader,
        webhook_secret_version: "current",
      })
      const redacted = JSON.stringify(ingested.redactedPayload)
      expect(redacted).not.toContain(`private-${index}@example.com`)
      expect(redacted).not.toContain(REFUND_ID)
      expect(redacted).not.toContain("amount")
    }

    expect(calls.movementLookups).toEqual([])
    expect(calls.ingested).toEqual([])
    expect(calls.chargeIds).toEqual([])
    expect(calls.paymentIntentIds).toEqual([])
    expect(calls.noEffectIngested).toHaveLength(4)
  })

  test("returns the durable duplicate result for an exact no-effect replay", async () => {
    const { dependencies, calls } = dependenciesFor(movement())
    const stripeEvent = event(
      "refund.updated",
      refund({ status: "failed" }),
      "evt_no_effect_replay123",
    )
    const rawPayload = JSON.stringify({ id: stripeEvent.id, status: "failed" })

    await expect(
      ingestFixture(stripeEvent, rawPayload, dependencies),
    ).resolves.toMatchObject({
      processingStatus: "ignored",
      isDuplicate: false,
    })
    await expect(
      ingestFixture(stripeEvent, rawPayload, dependencies),
    ).resolves.toMatchObject({
      processingStatus: "ignored",
      isDuplicate: true,
    })

    expect(calls.noEffectIngested).toHaveLength(2)
    expect(calls.noEffectIngested[0].payloadSha256).toBe(
      calls.noEffectIngested[1].payloadSha256,
    )
  })

  test("rejects an unknown refund status before durable ingestion", async () => {
    const { dependencies, calls } = dependenciesFor(movement())

    await expect(
      ingestFixture(
        event("refund.updated", refund({ status: "unknown_transition" })),
        JSON.stringify({ id: "evt_unknown_refund" }),
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: "provider-fact-mismatch",
      retryable: false,
    })
    expect(calls.noEffectIngested).toEqual([])
  })

  test("preserves durable conflicts and treats no-effect storage failures as retryable", async () => {
    const conflict = dependenciesFor(movement(), {
      noEffectError: new StripeFinancialAdjustmentError("boundary-mismatch", {
        httpStatus: 409,
      }),
    })
    await expect(
      ingestFixture(
        event("refund.updated", refund({ status: "canceled" })),
        JSON.stringify({ id: "evt_no_effect_conflict" }),
        conflict.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "boundary-mismatch",
      retryable: false,
      httpStatus: 409,
    })

    const unavailable = dependenciesFor(movement(), {
      noEffectError: new Error("database unavailable"),
    })
    await expect(
      ingestFixture(
        event("refund.updated", refund({ status: "requires_action" })),
        JSON.stringify({ id: "evt_no_effect_unavailable" }),
        unavailable.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "infrastructure",
      retryable: true,
      httpStatus: 503,
    })

    const invalidStatus = dependenciesFor(movement(), {
      noEffectProcessingStatus: "received",
    })
    await expect(
      ingestFixture(
        event("refund.created", refund({ status: "pending" })),
        JSON.stringify({ id: "evt_no_effect_unclosed" }),
        invalidStatus.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "infrastructure",
      retryable: true,
      httpStatus: 503,
    })
  })

  test("ingests an exact successful one-time partial refund and encrypts signed evidence", async () => {
    const original = movement()
    const { dependencies, calls } = dependenciesFor(original, {
      charge: charge(),
    })
    const stripeEvent = event("refund.created", refund())
    const rawPayload = JSON.stringify({
      id: stripeEvent.id,
      type: stripeEvent.type,
      data: {
        object: {
          id: REFUND_ID,
          billing_email: "private.sponsor@example.com",
          evidence: "private dispute correspondence",
        },
      },
    })

    await expect(
      ingestFixture(stripeEvent, rawPayload, dependencies),
    ).resolves.toMatchObject({
      handled: true,
      ingested: true,
      adjustmentKind: "sponsorship_refund",
      isDuplicate: false,
    })

    expect(calls.chargeIds).toEqual([CHARGE_ID])
    expect(calls.paymentIntentIds).toEqual([])
    expect(calls.movementLookups).toEqual([
      {
        providerAccountScope: "stripe_us",
        providerMovementType: "payment_intent",
        providerMovementId: PAYMENT_INTENT_ID,
      },
    ])
    expect(calls.ingested).toHaveLength(1)
    const ingested = calls.ingested[0]
    expect(ingested).toMatchObject({
      originalFinancialMovementId: ORIGINAL_MOVEMENT_ID,
      providerAccountScope: "stripe_us",
      providerEventId: stripeEvent.id,
      eventType: "refund.created",
      providerObjectType: "refund",
      providerObjectId: REFUND_ID,
      adjustmentProviderMovementType: "refund",
      adjustmentProviderMovementId: REFUND_ID,
      baseAmountUsdCents: 500,
      chargedAmountMinor: 625,
      chargedCurrency: "USD",
      conversionRate: 1.25,
      verificationMethod: "stripe_webhook_signature",
      occurredAt: new Date(EVENT_CREATED * 1000).toISOString(),
      signatureVerifiedAt: NOW.toISOString(),
      requestContext,
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
    expect(ingested.redactedPayload).toMatchObject({
      delivery_payload_sha256: createHash("sha256")
        .update(rawPayload)
        .digest("hex"),
      stripe_signature: requestContext.signatureHeader,
      webhook_secret_version: "current",
    })
    expect(redacted).not.toContain("private.sponsor")
    expect(redacted).not.toContain(REFUND_ID)
    expect(redacted).not.toContain(PAYMENT_INTENT_ID)
  })

  test("preserves a successful refund.updated event and maps a recurring invoice without a provider lookup", async () => {
    const recurringCharge = charge({ invoice: INVOICE_ID })
    const original = movement({
      providerMovementType: "invoice",
      providerMovementId: INVOICE_ID,
      paymentMode: "recurring",
    })
    const { dependencies, calls } = dependenciesFor(original, {
      duplicate: true,
    })

    await expect(
      ingestFixture(
        event(
          "refund.updated",
          refund({ charge: recurringCharge }),
          "evt_refund_updated123",
        ),
        JSON.stringify({ id: "evt_refund_updated123" }),
        dependencies,
      ),
    ).resolves.toMatchObject({
      handled: true,
      ingested: true,
      isDuplicate: true,
    })

    expect(calls.chargeIds).toEqual([])
    expect(calls.movementLookups[0]).toEqual({
      providerAccountScope: "stripe_us",
      providerMovementType: "invoice",
      providerMovementId: INVOICE_ID,
    })
    expect(calls.ingested[0].eventType).toBe("refund.updated")
  })

  test("uses a PaymentIntent lookup only when a refund has no Charge chain", async () => {
    const { dependencies, calls } = dependenciesFor(movement(), {
      paymentIntent: paymentIntent(),
    })

    await ingestFixture(
      event("refund.created", refund({ charge: null })),
      JSON.stringify({ id: "evt_pi_refund" }),
      dependencies,
    )

    expect(calls.chargeIds).toEqual([])
    expect(calls.paymentIntentIds).toEqual([PAYMENT_INTENT_ID])
    expect(calls.movementLookups[0].providerMovementId).toBe(PAYMENT_INTENT_ID)
  })

  test("maps dispute withdrawal and reinstatement to exact original movement chains", async () => {
    const recurringOriginal = movement({
      providerMovementType: "invoice",
      providerMovementId: INVOICE_ID,
      paymentMode: "recurring",
    })
    const withdrawn = dependenciesFor(recurringOriginal, {
      charge: charge({ invoice: INVOICE_ID }),
      adjustmentKind: "sponsorship_dispute_debit",
    })

    await ingestFixture(
      event(
        "charge.dispute.funds_withdrawn",
        dispute({
          balance_transactions: [
            balanceTransaction(DISPUTE_DEBIT_TRANSACTION_ID, -500),
          ],
        }),
      ),
      JSON.stringify({ id: "evt_dispute_withdrawn" }),
      withdrawn.dependencies,
    )

    expect(withdrawn.calls.movementLookups[0]).toEqual({
      providerAccountScope: "stripe_us",
      providerMovementType: "invoice",
      providerMovementId: INVOICE_ID,
    })
    expect(withdrawn.calls.ingested[0]).toMatchObject({
      eventType: "charge.dispute.funds_withdrawn",
      providerObjectType: "dispute",
      providerObjectId: DISPUTE_ID,
      adjustmentProviderMovementType: "dispute",
      adjustmentProviderMovementId: DISPUTE_ID,
      baseAmountUsdCents: 400,
      chargedAmountMinor: 500,
      redactedPayload: {
        balance_transaction_id: DISPUTE_DEBIT_TRANSACTION_ID,
      },
    })

    const reinstated = dependenciesFor(movement(), {
      charge: charge(),
      adjustmentKind: "sponsorship_dispute_credit",
    })
    await expect(
      ingestFixture(
        event(
          "charge.dispute.funds_reinstated",
          dispute({
            balance_transactions: [
              balanceTransaction(DISPUTE_DEBIT_TRANSACTION_ID, -500),
              balanceTransaction(DISPUTE_CREDIT_TRANSACTION_ID, 375),
            ],
          }),
          "evt_dispute_reinstated123",
        ),
        JSON.stringify({ id: "evt_dispute_reinstated123" }),
        reinstated.dependencies,
      ),
    ).resolves.toMatchObject({
      handled: true,
      ingested: true,
      adjustmentKind: "sponsorship_dispute_credit",
    })
    expect(reinstated.calls.ingested[0]).toMatchObject({
      baseAmountUsdCents: 300,
      chargedAmountMinor: 375,
      redactedPayload: {
        balance_transaction_id: DISPUTE_CREDIT_TRANSACTION_ID,
      },
    })
  })

  test("maps exact cross-currency dispute evidence and rejects ambiguity", async () => {
    const { dependencies } = dependenciesFor(movement(), { charge: charge() })

    await expect(
      ingestFixture(
        event("charge.dispute.funds_reinstated", dispute()),
        "{}",
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: "provider-fact-mismatch",
      retryable: false,
    })

    const exact = dependenciesFor(movement(), {
      charge: charge(),
      adjustmentKind: "sponsorship_dispute_debit",
    })
    await expect(
      ingestFixture(
        event(
          "charge.dispute.funds_withdrawn",
          dispute({
            balance_transactions: [
              balanceTransaction(DISPUTE_DEBIT_TRANSACTION_ID, -500, {
                currency: "eur",
                amount: -400,
                exchange_rate: 0.8,
              }),
            ],
          }),
        ),
        "{}",
        exact.dependencies,
      ),
    ).resolves.toMatchObject({ handled: true, ingested: true })
    expect(exact.calls.ingested[0]).toMatchObject({
      chargedAmountMinor: 500,
      baseAmountUsdCents: 400,
    })

    await expect(
      ingestFixture(
        event(
          "charge.dispute.funds_withdrawn",
          dispute({
            balance_transactions: [
              balanceTransaction(DISPUTE_DEBIT_TRANSACTION_ID, -1, {
                currency: "eur",
                exchange_rate: 0.1,
              }),
            ],
          }),
        ),
        "{}",
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: "provider-fact-mismatch",
      retryable: false,
    })
  })

  test("rejects crossed provider chains before loading or ingesting database state", async () => {
    const { dependencies, calls } = dependenciesFor(movement(), {
      charge: charge({ payment_intent: OTHER_PAYMENT_INTENT_ID }),
    })

    await expect(
      ingestFixture(
        event("refund.created", refund()),
        JSON.stringify({ id: "evt_crossed_chain" }),
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: "provider-fact-mismatch",
      retryable: false,
    })
    expect(calls.movementLookups).toEqual([])
    expect(calls.ingested).toEqual([])
  })

  test("rejects an adjustment amount or regional scope that differs from the immutable movement", async () => {
    const overAmount = dependenciesFor(movement(), {
      charge: charge({ amount_captured: 2500 }),
    })
    await expect(
      ingestFixture(
        event("refund.created", refund({ amount: 1500 })),
        "{}",
        overAmount.dependencies,
      ),
    ).rejects.toMatchObject({ code: "boundary-mismatch" })
    expect(overAmount.calls.ingested).toEqual([])

    const wrongRegion = dependenciesFor(movement(), { charge: charge() })
    await expect(
      ingestFixture(
        event("refund.created", refund()),
        "{}",
        wrongRegion.dependencies,
        "uk",
      ),
    ).rejects.toMatchObject({ code: "boundary-mismatch" })
    expect(wrongRegion.calls.movementLookups[0].providerAccountScope).toBe(
      "stripe_uk",
    )
  })

  test("derives only exact proportional base values and rejects unrepresentable currency slices", () => {
    expect(
      deriveProportionalBaseUsdCents(625, {
        baseAmountUsdCents: 1000,
        chargedAmountMinor: 1250,
        conversionRate: 1.25,
      }),
    ).toBe(500)
    expect(
      deriveProportionalBaseUsdCents(1250, {
        baseAmountUsdCents: 1000,
        chargedAmountMinor: 1250,
        conversionRate: 1.25,
      }),
    ).toBe(1000)
    expect(() =>
      deriveProportionalBaseUsdCents(1, {
        baseAmountUsdCents: 5,
        chargedAmountMinor: 10,
        conversionRate: 2,
      }),
    ).toThrow(StripeFinancialAdjustmentError)
  })

  test("fails closed on oversized evidence and distinguishes permanent and transient provider lookup failures", async () => {
    const oversized = dependenciesFor(movement(), { charge: charge() })
    await expect(
      ingestFixture(
        event("refund.created", refund()),
        "x".repeat(64 * 1024 + 1),
        oversized.dependencies,
      ),
    ).rejects.toMatchObject({ code: "payload-too-large" })
    expect(oversized.calls.chargeIds).toEqual([])
    expect(oversized.calls.movementLookups).toEqual([])
    expect(oversized.calls.ingested).toEqual([])

    const permanent = dependenciesFor(movement(), { charge: charge() })
    permanent.dependencies.retrieveCharge = async () => {
      throw { statusCode: 404, code: "resource_missing" }
    }
    await expect(
      ingestFixture(
        event("refund.created", refund()),
        "{}",
        permanent.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "provider-fact-mismatch",
      retryable: false,
    })

    const transient = dependenciesFor(movement(), { charge: charge() })
    transient.dependencies.retrieveCharge = async () => {
      throw new Error("network unavailable")
    }
    await expect(
      ingestFixture(
        event("refund.created", refund()),
        "{}",
        transient.dependencies,
      ),
    ).rejects.toMatchObject({
      code: "provider-chain-unavailable",
      retryable: true,
    })
  })

  test("rejects forged database outcomes even after valid signed evidence", async () => {
    const { dependencies } = dependenciesFor(movement(), { charge: charge() })
    dependencies.ingestVerifiedAdjustment = async () => ({
      gatewayEventId: GATEWAY_EVENT_ID,
      originalFinancialMovementId: ORIGINAL_MOVEMENT_ID,
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      sponsorshipIntentId: SPONSORSHIP_INTENT_ID,
      processingStatus: "received",
      adjustmentKind: "sponsorship_dispute_credit",
      isDuplicate: false,
    })

    await expect(
      ingestFixture(event("refund.created", refund()), "{}", dependencies),
    ).rejects.toMatchObject({ code: "infrastructure", retryable: true })
  })
})
