import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  ClaimedPaymentGatewayEvent,
  PaymentGatewayApplicationEffect,
  PaymentGatewayEventRepository,
  PaymentGatewayWelcomeBundle,
} from "../../src/lib/sponsorships/gateways/paymentGatewayEventWorker"

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
    "tests/sponsorships/payment-gateway-event-worker.spec.ts",
  ),
)
const { createStripeProviderRequestTemplate, sealStripeProviderRequest } =
  testRequire(
    "../../src/lib/sponsorships/checkout/stripeProviderRequest",
  ) as typeof import("../../src/lib/sponsorships/checkout/stripeProviderRequest")
const { createPayPalProviderRequestTemplate, sealPayPalProviderRequest } =
  testRequire(
    "../../src/lib/sponsorships/checkout/paypalProviderRequest",
  ) as typeof import("../../src/lib/sponsorships/checkout/paypalProviderRequest")
const { createSponsorshipCrypto, fromSupabaseRpcBytea, toSupabaseRpcBytea } =
  testRequire(
    "../../src/lib/sponsorships/crypto",
  ) as typeof import("../../src/lib/sponsorships/crypto")
const { stripeEventImmutableDigest } = testRequire(
  "../../src/lib/sponsorships/gateways/stripeWebhook",
) as typeof import("../../src/lib/sponsorships/gateways/stripeWebhook")
const { requireLegacyStripeDatabaseSuccess } = testRequire(
  "../../src/lib/sponsorships/gateways/legacyStripeWebhook",
) as typeof import("../../src/lib/sponsorships/gateways/legacyStripeWebhook")
const { isAuthorizedPaymentGatewayEventWorkerRequest } = testRequire(
  "../../src/lib/sponsorships/gateways/paymentGatewayEventAuth",
) as typeof import("../../src/lib/sponsorships/gateways/paymentGatewayEventAuth")
const {
  loadPaymentGatewayEventWorkerConfig,
  loadPaymentGatewayEventWorkerSecret,
} = testRequire(
  "../../src/lib/sponsorships/gateways/paymentGatewayEventConfig",
) as typeof import("../../src/lib/sponsorships/gateways/paymentGatewayEventConfig")
const { createSupabasePaymentGatewayEventRepository } = testRequire(
  "../../src/lib/sponsorships/gateways/paymentGatewayEventRepository",
) as typeof import("../../src/lib/sponsorships/gateways/paymentGatewayEventRepository")
const {
  PaymentGatewayEventRepositoryError,
  processPaymentGatewayEvent,
  runPaymentGatewayEventBatch,
} = testRequire(
  "../../src/lib/sponsorships/gateways/paymentGatewayEventWorker",
) as typeof import("../../src/lib/sponsorships/gateways/paymentGatewayEventWorker")
nodeModule._load = originalModuleLoad

const EVENT_ID = "11111111-1111-4111-8111-111111111111"
const LEASE_ID = "22222222-2222-4222-8222-222222222222"
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333"
const OPERATION_ID = "44444444-4444-4444-8444-444444444444"
const INTENT_ID = "55555555-5555-4555-8555-555555555555"
const QUOTE_ID = "66666666-6666-4666-8666-666666666666"
const context = { requestId: "worker-request", traceId: "worker-trace" }

const welcomeBundle: PaymentGatewayWelcomeBundle = {
  claimTokenDigest: `\\x${"a1".repeat(32)}`,
  recipientEmailCiphertext: "\\xa2",
  emailEncryptionKeyVersion: 1,
  secretPayloadCiphertext: "\\xa3",
  welcomeTemplateKey: "sponsor-welcome-v1",
  welcomeTemplateData: {},
}

function claimedEvent(
  overrides: Partial<ClaimedPaymentGatewayEvent> = {},
): ClaimedPaymentGatewayEvent {
  return {
    gatewayEventId: EVENT_ID,
    processingLeaseToken: LEASE_ID,
    provider: "STRIPE",
    providerAccountScope: "stripe_us",
    providerEventId: "evt_worker_test",
    eventType: "checkout.session.completed",
    providerObjectType: "checkout_session",
    paymentAttemptId: ATTEMPT_ID,
    verificationMethod: "stripe_webhook_signature",
    processingAttemptCount: 1,
    ...overrides,
  }
}

function repository(
  overrides: Partial<PaymentGatewayEventRepository> = {},
): PaymentGatewayEventRepository {
  const application = async (effect: PaymentGatewayApplicationEffect) => ({
    effect,
  })
  return {
    async claimEvents() {
      return []
    },
    async prepareWelcomeBundle() {
      return welcomeBundle
    },
    async applySuccess() {
      return application("payment_succeeded")
    },
    async applyFailure() {
      return application("payment_failed")
    },
    async applyCheckoutExpiration() {
      return application("checkout_expired")
    },
    async applySubscriptionLifecycle() {
      return application("subscription_lifecycle")
    },
    async applyFinancialAdjustment() {
      return application("refund_applied")
    },
    async applyLegacyStripe() {
      return application("legacy_applied")
    },
    async ignore() {},
    async retry() {
      return {
        processingAttemptCount: 1,
        maxProcessingAttempts: 12,
        terminal: false,
      }
    },
    async purgeCheckoutContactEnvelopes() {
      return {
        erased: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        expired: 0,
      }
    },
    ...overrides,
  }
}

test.describe("payment gateway event application dispatch", () => {
  const cases: Array<{
    name: string
    event: Partial<ClaimedPaymentGatewayEvent>
    method:
      | "applySuccess"
      | "applyFailure"
      | "applyCheckoutExpiration"
      | "applySubscriptionLifecycle"
      | "applyFinancialAdjustment"
      | "applyLegacyStripe"
    effect: PaymentGatewayApplicationEffect
  }> = [
    {
      name: "Stripe Checkout success",
      event: {},
      method: "applySuccess",
      effect: "payment_succeeded",
    },
    {
      name: "Stripe invoice success",
      event: { eventType: "invoice.paid", providerObjectType: "invoice" },
      method: "applySuccess",
      effect: "payment_succeeded",
    },
    {
      name: "Stripe invoice failure",
      event: {
        eventType: "invoice.payment_failed",
        providerObjectType: "invoice",
      },
      method: "applyFailure",
      effect: "payment_failed",
    },
    {
      name: "Stripe Checkout expiration",
      event: {
        eventType: "checkout.session.expired",
        providerObjectType: "checkout_session",
      },
      method: "applyCheckoutExpiration",
      effect: "checkout_expired",
    },
    {
      name: "Stripe subscription lifecycle",
      event: {
        eventType: "customer.subscription.updated",
        providerObjectType: "subscription",
      },
      method: "applySubscriptionLifecycle",
      effect: "subscription_lifecycle",
    },
    {
      name: "Stripe refund",
      event: { eventType: "refund.updated", providerObjectType: "refund" },
      method: "applyFinancialAdjustment",
      effect: "refund_applied",
    },
    {
      name: "Stripe dispute debit",
      event: {
        eventType: "charge.dispute.funds_withdrawn",
        providerObjectType: "dispute",
      },
      method: "applyFinancialAdjustment",
      effect: "dispute_debit_applied",
    },
    {
      name: "Stripe dispute credit",
      event: {
        eventType: "charge.dispute.funds_reinstated",
        providerObjectType: "dispute",
      },
      method: "applyFinancialAdjustment",
      effect: "dispute_credit_applied",
    },
    {
      name: "retained legacy Stripe invoice",
      event: {
        eventType: "invoice.paid",
        providerObjectType: "invoice",
        paymentAttemptId: null,
        verificationMethod: "stripe_webhook_signature_legacy",
      },
      method: "applyLegacyStripe",
      effect: "legacy_applied",
    },
    {
      name: "PayPal capture success",
      event: {
        provider: "PAYPAL",
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        providerObjectType: "capture",
      },
      method: "applySuccess",
      effect: "payment_succeeded",
    },
    {
      name: "PayPal sale failure",
      event: {
        provider: "PAYPAL",
        eventType: "PAYMENT.SALE.DENIED",
        providerObjectType: "sale",
      },
      method: "applyFailure",
      effect: "payment_failed",
    },
    {
      name: "PayPal capture declined",
      event: {
        provider: "PAYPAL",
        eventType: "PAYMENT.CAPTURE.DECLINED",
        providerObjectType: "capture",
      },
      method: "applyFailure",
      effect: "payment_failed",
    },
    {
      name: "PayPal subscription payment failure",
      event: {
        provider: "PAYPAL",
        eventType: "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
        providerObjectType: "billing_subscription",
      },
      method: "applyFailure",
      effect: "payment_failed",
    },
    {
      name: "PayPal subscription lifecycle",
      event: {
        provider: "PAYPAL",
        eventType: "BILLING.SUBSCRIPTION.SUSPENDED",
        providerObjectType: "billing_subscription",
      },
      method: "applySubscriptionLifecycle",
      effect: "subscription_lifecycle",
    },
    {
      name: "PayPal reversal",
      event: {
        provider: "PAYPAL",
        eventType: "PAYMENT.CAPTURE.REVERSED",
        providerObjectType: "capture",
      },
      method: "applyFinancialAdjustment",
      effect: "reversal_applied",
    },
    {
      name: "PayPal dispute debit from capture",
      event: {
        provider: "PAYPAL",
        eventType: "CUSTOMER.DISPUTE.CREATED",
        providerObjectType: "capture",
      },
      method: "applyFinancialAdjustment",
      effect: "dispute_debit_applied",
    },
    {
      name: "PayPal dispute credit from sale",
      event: {
        provider: "PAYPAL",
        eventType: "CUSTOMER.DISPUTE.RESOLVED",
        providerObjectType: "sale",
      },
      method: "applyFinancialAdjustment",
      effect: "dispute_credit_applied",
    },
  ]

  for (const item of cases) {
    test(`routes ${item.name} only to its typed resolver`, async () => {
      const calls: string[] = []
      const base = repository()
      const repo = repository({
        async prepareWelcomeBundle(event, workerContext) {
          calls.push("prepareWelcomeBundle")
          expect(event.paymentAttemptId).toBe(ATTEMPT_ID)
          expect(workerContext).toEqual(context)
          return welcomeBundle
        },
        async applySuccess(event, bundle, workerContext) {
          calls.push("applySuccess")
          expect(bundle).toEqual(welcomeBundle)
          expect(workerContext).toEqual(context)
          return { effect: item.effect }
        },
        async applyFailure(event, workerContext) {
          calls.push("applyFailure")
          expect(event.gatewayEventId).toBe(EVENT_ID)
          expect(workerContext).toEqual(context)
          return { effect: item.effect }
        },
        async applyCheckoutExpiration(event, workerContext) {
          calls.push("applyCheckoutExpiration")
          expect(event.gatewayEventId).toBe(EVENT_ID)
          expect(workerContext).toEqual(context)
          return { effect: item.effect }
        },
        async applySubscriptionLifecycle(event, workerContext) {
          calls.push("applySubscriptionLifecycle")
          expect(event.gatewayEventId).toBe(EVENT_ID)
          expect(workerContext).toEqual(context)
          return { effect: item.effect }
        },
        async applyFinancialAdjustment(event, workerContext) {
          calls.push("applyFinancialAdjustment")
          expect(event.gatewayEventId).toBe(EVENT_ID)
          expect(workerContext).toEqual(context)
          return { effect: item.effect }
        },
        async applyLegacyStripe(event, workerContext) {
          calls.push("applyLegacyStripe")
          expect(event.paymentAttemptId).toBeNull()
          expect(event.verificationMethod).toBe(
            "stripe_webhook_signature_legacy",
          )
          expect(workerContext).toEqual(context)
          return { effect: item.effect }
        },
        ignore: base.ignore,
        retry: base.retry,
      })

      const result = await processPaymentGatewayEvent({
        repository: repo,
        event: claimedEvent(item.event),
        context,
      })

      expect(result).toMatchObject({
        gatewayEventId: EVENT_ID,
        status: item.effect === "ignored" ? "ignored" : "applied",
        effect: item.effect,
      })
      expect(calls).toEqual(
        item.method === "applySuccess"
          ? ["prepareWelcomeBundle", "applySuccess"]
          : [item.method],
      )
    })
  }

  test("never routes a typed v2 event through the retained legacy replay", async () => {
    let legacyCalls = 0
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async applySuccess() {
          return { effect: "payment_succeeded" }
        },
        async applyLegacyStripe() {
          legacyCalls += 1
          return { effect: "legacy_applied" }
        },
      }),
      event: claimedEvent({
        eventType: "invoice.paid",
        providerObjectType: "invoice",
        verificationMethod: "stripe_webhook_signature",
      }),
      context,
    })

    expect(result).toMatchObject({
      status: "applied",
      effect: "payment_succeeded",
    })
    expect(legacyCalls).toBe(0)
  })

  test("does not silently ignore a new or mismatched typed event", async () => {
    const retries: Array<{ summary: string; delay: number }> = []
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async retry(event, summary, delay) {
          retries.push({ summary, delay })
          return {
            processingAttemptCount: event.processingAttemptCount,
            maxProcessingAttempts: 12,
            terminal: false,
          }
        },
      }),
      event: claimedEvent({
        eventType: "refund.updated",
        providerObjectType: "checkout_session",
        processingAttemptCount: 3,
      }),
      context,
    })

    expect(result).toMatchObject({
      status: "retried",
      code: "typed_gateway_event_resolver_missing",
    })
    expect(retries).toEqual([
      { summary: "typed_gateway_event_resolver_missing", delay: 120 },
    ])
  })

  test("settles a duplicate provider movement without counting another application", async () => {
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async applyFinancialAdjustment() {
          return { effect: "duplicate_movement" }
        },
      }),
      event: claimedEvent({
        eventType: "refund.created",
        providerObjectType: "refund",
      }),
      context,
    })

    expect(result).toEqual({
      gatewayEventId: EVENT_ID,
      status: "ignored",
      effect: "duplicate_movement",
    })
  })

  test("applies a renewal success without reopening welcome material", async () => {
    let appliedBundle: PaymentGatewayWelcomeBundle | null | undefined
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async prepareWelcomeBundle() {
          return null
        },
        async applySuccess(_event, bundle) {
          appliedBundle = bundle
          return { effect: "payment_succeeded" }
        },
      }),
      event: claimedEvent({
        eventType: "invoice.paid",
        providerObjectType: "invoice",
      }),
      context,
    })

    expect(result.status).toBe("applied")
    expect(appliedBundle).toBeNull()
  })
})

test.describe("payment gateway event failure settlement", () => {
  test("retries a retained event when an authoritative database update fails", async () => {
    const retries: string[] = []
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async applyLegacyStripe() {
          requireLegacyStripeDatabaseSuccess(
            true,
            { code: "database_unavailable" },
            "invoice_success_subscription_update",
          )
          return { effect: "legacy_applied" }
        },
        async retry(_event, summary) {
          retries.push(summary)
          return {
            processingAttemptCount: 1,
            maxProcessingAttempts: 12,
            terminal: false,
          }
        },
      }),
      event: claimedEvent({
        eventType: "invoice.paid",
        providerObjectType: "invoice",
        paymentAttemptId: null,
        verificationMethod: "stripe_webhook_signature_legacy",
      }),
      context,
    })

    expect(result).toMatchObject({
      status: "retried",
      code: "typed_gateway_event_application_failed",
    })
    expect(retries).toEqual(["typed_gateway_event_application_failed"])
  })

  test("retries a typed resolver failure using only a fixed error code", async () => {
    const summaries: string[] = []
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async applyFailure() {
          throw new Error("sponsor@example.com must never escape")
        },
        async retry(event, summary) {
          summaries.push(summary)
          return {
            processingAttemptCount: event.processingAttemptCount,
            maxProcessingAttempts: 12,
            terminal: false,
          }
        },
      }),
      event: claimedEvent({
        eventType: "invoice.payment_failed",
        providerObjectType: "invoice",
      }),
      context,
    })

    expect(result.status).toBe("retried")
    expect(summaries).toEqual(["typed_gateway_event_application_failed"])
    expect(JSON.stringify(result)).not.toContain("sponsor@example.com")
  })

  test("reports terminal failure when the database retry cap is exhausted", async () => {
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async applyFinancialAdjustment() {
          throw new PaymentGatewayEventRepositoryError("apply_adjustment")
        },
        async retry() {
          return {
            processingAttemptCount: 12,
            maxProcessingAttempts: 12,
            terminal: true,
          }
        },
      }),
      event: claimedEvent({
        eventType: "refund.created",
        providerObjectType: "refund",
        processingAttemptCount: 12,
      }),
      context,
    })

    expect(result.status).toBe("terminal_failed")
  })

  test("recognizes a lease lost during application", async () => {
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async applyFailure() {
          throw new PaymentGatewayEventRepositoryError("apply_failure", {
            leaseLost: true,
          })
        },
      }),
      event: claimedEvent({
        eventType: "invoice.payment_failed",
        providerObjectType: "invoice",
      }),
      context,
    })

    expect(result.status).toBe("lease_lost")
  })

  test("reports unknown settlement without leaking the repository failure", async () => {
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async applyFailure() {
          throw new Error("database transport included private evidence")
        },
        async retry() {
          throw new Error("settlement response was lost")
        },
      }),
      event: claimedEvent({
        eventType: "invoice.payment_failed",
        providerObjectType: "invoice",
      }),
      context,
    })

    expect(result).toEqual({
      gatewayEventId: EVENT_ID,
      status: "settlement_unknown",
      code: "typed_gateway_event_application_failed",
    })
  })

  test("honors lifecycle deferral performed atomically by the resolver", async () => {
    const result = await processPaymentGatewayEvent({
      repository: repository({
        async applySubscriptionLifecycle() {
          return {
            effect: null,
            retryState: {
              processingAttemptCount: 4,
              maxProcessingAttempts: 12,
              terminal: false,
            },
          }
        },
      }),
      event: claimedEvent({
        eventType: "customer.subscription.created",
        providerObjectType: "subscription",
      }),
      context,
    })

    expect(result.status).toBe("retried")
  })
})

test.describe("payment gateway event bounded batch", () => {
  test("does no work for no-effect and quarantine events settled at ingestion", async () => {
    let applicationCalls = 0
    let purgeCalls = 0
    const batch = await runPaymentGatewayEventBatch({
      repository: repository({
        async claimEvents() {
          return []
        },
        async applySuccess() {
          applicationCalls += 1
          return { effect: "payment_succeeded" }
        },
        async purgeCheckoutContactEnvelopes(workerContext) {
          expect(workerContext).toEqual(context)
          purgeCalls += 1
          return {
            erased: 3,
            succeeded: 1,
            failed: 1,
            cancelled: 0,
            expired: 1,
          }
        },
      }),
      config: { batchSize: 20, concurrency: 4 },
      workerId: "payment-gateway-event-worker:test",
      context,
    })

    expect(batch).toMatchObject({
      claimed: 0,
      applied: 0,
      ignored: 0,
      retried: 0,
      contactErasure: {
        erased: 3,
        succeeded: 1,
        failed: 1,
        cancelled: 0,
        expired: 1,
      },
    })
    expect(applicationCalls).toBe(0)
    expect(purgeCalls).toBe(1)
  })

  test("never exceeds configured concurrency", async () => {
    let active = 0
    let maximumActive = 0
    const events = Array.from({ length: 7 }, (_, index) =>
      claimedEvent({
        gatewayEventId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
        eventType: "invoice.payment_failed",
        providerObjectType: "invoice",
      }),
    )
    const batch = await runPaymentGatewayEventBatch({
      repository: repository({
        async claimEvents() {
          return events
        },
        async applyFailure() {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await new Promise((resolve) => setTimeout(resolve, 5))
          active -= 1
          return { effect: "payment_failed" }
        },
      }),
      config: { batchSize: 10, concurrency: 2 },
      workerId: "payment-gateway-event-worker:test",
      context,
    })

    expect(batch.claimed).toBe(7)
    expect(batch.applied).toBe(7)
    expect(maximumActive).toBe(2)
  })
})

test.describe("payment gateway event repository", () => {
  const crypto = createSponsorshipCrypto({
    appSecretBase64: Buffer.alloc(32, 7).toString("base64"),
  })

  function retainedLegacyInvoice() {
    return {
      id: "evt_legacy_worker_test",
      object: "event",
      api_version: "2025-02-24.acacia",
      created: 1_753_000_000,
      data: {
        object: {
          id: "in_legacy_worker_test",
          object: "invoice",
          subscription: "sub_legacy_worker_test",
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "invoice.paid",
    } as unknown as import("stripe").default.Event
  }

  test("reopens legacy ciphertext only behind its lease and atomically completes replay", async () => {
    const stripeEvent = retainedLegacyInvoice()
    const rawPayload = JSON.stringify(stripeEvent)
    const sealed = crypto.encryptSecretPayload(rawPayload)
    const calls: string[] = []
    const client = {
      async rpc(name: string) {
        calls.push(name)
        if (name === "read_legacy_stripe_gateway_event_payload") {
          return {
            data: [
              {
                gateway_event_id: EVENT_ID,
                provider_account_scope: "stripe_us",
                provider_event_id: stripeEvent.id,
                event_type: stripeEvent.type,
                payload_ciphertext: sealed.ciphertextRpcBytea,
                payload_sha256: toSupabaseRpcBytea(
                  stripeEventImmutableDigest(stripeEvent),
                ),
              },
            ],
            error: null,
          }
        }
        if (name === "complete_legacy_stripe_gateway_event") {
          return {
            data: [
              {
                gateway_event_id: EVENT_ID,
                processing_status: "processed",
                application_effect: "legacy_applied",
              },
            ],
            error: null,
          }
        }
        throw new Error(`unexpected rpc ${name}`)
      },
    } as unknown as SupabaseClient
    const replays: string[] = []
    const repo = createSupabasePaymentGatewayEventRepository(client, crypto, {
      async processLegacyStripeEvent(input) {
        replays.push(input.rawPayload)
        expect(input.event).toEqual(stripeEvent)
        expect(input.region).toBe("us")
        expect(input.requestId).toBe(context.requestId)
        return { status: 200 }
      },
    })

    await expect(
      repo.applyLegacyStripe(
        claimedEvent({
          providerAccountScope: "stripe_us",
          providerEventId: stripeEvent.id,
          eventType: stripeEvent.type,
          providerObjectType: "invoice",
          paymentAttemptId: null,
          verificationMethod: "stripe_webhook_signature_legacy",
        }),
        context,
      ),
    ).resolves.toEqual({ effect: "legacy_applied" })
    expect(replays).toEqual([rawPayload])
    expect(calls).toEqual([
      "read_legacy_stripe_gateway_event_payload",
      "complete_legacy_stripe_gateway_event",
    ])
  })

  test("rejects legacy ciphertext whose immutable digest does not match the inbox", async () => {
    const stripeEvent = retainedLegacyInvoice()
    const sealed = crypto.encryptSecretPayload(JSON.stringify(stripeEvent))
    let replayed = false
    const client = {
      async rpc(name: string) {
        expect(name).toBe("read_legacy_stripe_gateway_event_payload")
        return {
          data: [
            {
              gateway_event_id: EVENT_ID,
              provider_account_scope: "stripe_us",
              provider_event_id: stripeEvent.id,
              event_type: stripeEvent.type,
              payload_ciphertext: sealed.ciphertextRpcBytea,
              payload_sha256: `\\x${"00".repeat(32)}`,
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient
    const repo = createSupabasePaymentGatewayEventRepository(client, crypto, {
      async processLegacyStripeEvent() {
        replayed = true
        return { status: 200 }
      },
    })

    await expect(
      repo.applyLegacyStripe(
        claimedEvent({
          providerAccountScope: "stripe_us",
          providerEventId: stripeEvent.id,
          eventType: stripeEvent.type,
          providerObjectType: "invoice",
          paymentAttemptId: null,
          verificationMethod: "stripe_webhook_signature_legacy",
        }),
        context,
      ),
    ).rejects.toMatchObject({ stage: "legacy_payload_binding" })
    expect(replayed).toBe(false)
  })

  test("uses the scoped PayPal v2 failure resolver for newly typed failures", async () => {
    const rpcNames: string[] = []
    const client = {
      async rpc(name: string) {
        rpcNames.push(name)
        return {
          data: [{ application_effect: "payment_failed" }],
          error: null,
        }
      },
    } as unknown as SupabaseClient
    const repo = createSupabasePaymentGatewayEventRepository(client, crypto)
    for (const event of [
      claimedEvent({
        provider: "PAYPAL",
        eventType: "PAYMENT.CAPTURE.DECLINED",
        providerObjectType: "capture",
      }),
      claimedEvent({
        provider: "PAYPAL",
        eventType: "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
        providerObjectType: "billing_subscription",
      }),
    ]) {
      await expect(repo.applyFailure(event, context)).resolves.toEqual({
        effect: "payment_failed",
      })
    }
    expect(rpcNames).toEqual([
      "apply_paypal_payment_failure_v2",
      "apply_paypal_payment_failure_v2",
    ])
  })

  test("discards webhook payload columns while parsing a claim", async () => {
    const rawClaim: Record<string, unknown> = {
      gateway_event_id: EVENT_ID,
      processing_lease_token: LEASE_ID,
      provider: "STRIPE",
      provider_account_scope: "stripe_us",
      provider_event_id: "evt_worker_test",
      event_type: "invoice.payment_failed",
      provider_object_type: "invoice",
      payment_attempt_id: ATTEMPT_ID,
      verification_method: "stripe_webhook_signature",
      processing_attempt_count: 1,
    }
    Object.defineProperties(rawClaim, {
      redacted_payload: {
        enumerable: true,
        get() {
          throw new Error("redacted payload must not be interpreted")
        },
      },
      payload_ciphertext: {
        enumerable: true,
        get() {
          throw new Error("ciphertext must not enter dispatch")
        },
      },
    })
    const client = {
      async rpc(name: string) {
        expect(name).toBe("claim_payment_gateway_events")
        return { data: [rawClaim], error: null }
      },
    } as unknown as SupabaseClient

    const claimed = await createSupabasePaymentGatewayEventRepository(
      client,
      crypto,
    ).claimEvents({ workerId: "worker:test", batchSize: 1, context })

    expect(claimed).toEqual([
      claimedEvent({
        eventType: "invoice.payment_failed",
        providerObjectType: "invoice",
      }),
    ])
    expect(claimed[0]).not.toHaveProperty("redactedPayload")
    expect(claimed[0]).not.toHaveProperty("payloadCiphertext")
  })

  test("reopens only lease-fenced sealed email material and builds encrypted claim evidence", async () => {
    const expiresAt = "2026-07-18T12:31:00.000Z"
    const template = createStripeProviderRequestTemplate({
      operationId: OPERATION_ID,
      providerIdempotencyKey: `stripe-checkout:${OPERATION_ID}`,
      sponsorshipIntentId: INTENT_ID,
      paymentQuoteId: QUOTE_ID,
      providerAccountScope: "stripe_us",
      customerEmail: "sponsor@example.com",
      productName: "Creator Share sponsorship",
      productImageUrl: null,
      paymentMode: "one_time",
      recurrenceInterval: null,
      baseAmountUsdCents: 1600,
      chargedAmountMinor: 1600,
      chargedCurrency: "USD",
      conversionRate: 1,
      currencyQuoteAt: "2026-07-18T12:00:00.000Z",
      currencyRateSource: "worker-test",
      checkoutBaseUrl: "https://creatorshare.com",
      stripeRegion: "us",
      providerRequestExpiresAt: expiresAt,
    })
    const sealed = sealStripeProviderRequest(template, crypto)
    const email = crypto.digestEmail(template.customerEmail)
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return {
          data: [
            {
              gateway_event_id: EVENT_ID,
              payment_attempt_id: ATTEMPT_ID,
              welcome_required: true,
              checkout_operation_id: OPERATION_ID,
              sponsorship_intent_id: INTENT_ID,
              payment_quote_id: QUOTE_ID,
              provider: "STRIPE",
              provider_account_scope: "stripe_us",
              provider_idempotency_key: `stripe-checkout:${OPERATION_ID}`,
              provider_request_schema_version: sealed.schemaVersion,
              provider_request_fingerprint: sealed.fingerprint,
              provider_request_expires_at: expiresAt,
              provider_request_ciphertext: sealed.ciphertext,
              provider_request_encryption_key_version:
                sealed.encryptionKeyVersion,
              provider_request_ciphertext_sha256: sealed.ciphertextSha256,
              contact_email_hmac: email.digestRpcBytea,
              contact_email_normalization_version: email.normalizationVersion,
              contact_email_hmac_key_version: email.hmacKeyVersion,
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient

    const bundle = await createSupabasePaymentGatewayEventRepository(
      client,
      crypto,
    ).prepareWelcomeBundle(claimedEvent(), context)
    if (!bundle) throw new Error("Expected first-success welcome material")

    expect(calls).toEqual([
      {
        name: "read_payment_gateway_event_success_material",
        args: {
          target_gateway_event_id: EVENT_ID,
          target_processing_lease_token: LEASE_ID,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
        },
      },
    ])
    expect(
      crypto.decryptRecipientEmail(
        fromSupabaseRpcBytea(bundle.recipientEmailCiphertext),
      ),
    ).toBe("sponsor@example.com")

    const secretBytes = crypto.decryptSecretPayload(
      fromSupabaseRpcBytea(bundle.secretPayloadCiphertext),
    )
    try {
      const secret = JSON.parse(secretBytes.toString("utf8")) as {
        version: number
        claimToken: string
      }
      expect(secret.version).toBe(1)
      expect(
        `\\x${crypto.digestOpaqueToken(secret.claimToken).toString("hex")}`,
      ).toBe(bundle.claimTokenDigest)
    } finally {
      secretBytes.fill(0)
    }
  })

  test("does not read sealed fields when the database says no welcome is required", async () => {
    const material: Record<string, unknown> = {
      gateway_event_id: EVENT_ID,
      payment_attempt_id: ATTEMPT_ID,
      welcome_required: false,
    }
    for (const key of [
      "provider_request_ciphertext",
      "provider_request_ciphertext_sha256",
      "contact_email_hmac",
    ]) {
      Object.defineProperty(material, key, {
        enumerable: true,
        get() {
          throw new Error(`${key} must not be read for a renewal`)
        },
      })
    }
    const client = {
      async rpc() {
        return { data: [material], error: null }
      },
    } as unknown as SupabaseClient

    await expect(
      createSupabasePaymentGatewayEventRepository(
        client,
        crypto,
      ).prepareWelcomeBundle(
        claimedEvent({
          eventType: "invoice.paid",
          providerObjectType: "invoice",
        }),
        context,
      ),
    ).resolves.toBeNull()
  })

  test("reopens a PayPal first-success envelope through the same lease boundary", async () => {
    const expiresAt = "2026-07-18T12:31:00.000Z"
    const template = createPayPalProviderRequestTemplate({
      operationId: OPERATION_ID,
      providerIdempotencyKey: OPERATION_ID,
      sponsorshipIntentId: INTENT_ID,
      paymentQuoteId: QUOTE_ID,
      providerAccountScope: "paypal",
      customerEmail: "paypal-sponsor@example.com",
      productName: "Creator Share sponsorship",
      paymentMode: "one_time",
      recurrenceInterval: null,
      baseAmountUsdCents: 1600,
      chargedAmountMinor: 1600,
      chargedCurrency: "USD",
      conversionRate: 1,
      currencyQuoteAt: "2026-07-18T12:00:00.000Z",
      currencyRateSource: "worker-test",
      checkoutBaseUrl: "https://creatorshare.com",
      paypalPlanId: null,
      providerRequestExpiresAt: expiresAt,
    })
    const sealed = sealPayPalProviderRequest(template, crypto)
    const email = crypto.digestEmail(template.customerEmail)
    const client = {
      async rpc() {
        return {
          data: [
            {
              gateway_event_id: EVENT_ID,
              payment_attempt_id: ATTEMPT_ID,
              welcome_required: true,
              checkout_operation_id: OPERATION_ID,
              sponsorship_intent_id: INTENT_ID,
              payment_quote_id: QUOTE_ID,
              provider: "PAYPAL",
              provider_account_scope: "paypal",
              provider_idempotency_key: OPERATION_ID,
              provider_request_schema_version: sealed.schemaVersion,
              provider_request_fingerprint: sealed.fingerprint,
              provider_request_expires_at: expiresAt,
              provider_request_ciphertext: sealed.ciphertext,
              provider_request_encryption_key_version:
                sealed.encryptionKeyVersion,
              provider_request_ciphertext_sha256: sealed.ciphertextSha256,
              contact_email_hmac: email.digestRpcBytea,
              contact_email_normalization_version: email.normalizationVersion,
              contact_email_hmac_key_version: email.hmacKeyVersion,
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient

    const bundle = await createSupabasePaymentGatewayEventRepository(
      client,
      crypto,
    ).prepareWelcomeBundle(
      claimedEvent({
        provider: "PAYPAL",
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        providerObjectType: "capture",
      }),
      context,
    )

    if (!bundle) throw new Error("Expected PayPal first-success welcome")
    expect(
      crypto.decryptRecipientEmail(
        fromSupabaseRpcBytea(bundle.recipientEmailCiphertext),
      ),
    ).toBe("paypal-sponsor@example.com")
  })

  test("rejects sealed email material that conflicts with immutable intent HMAC", async () => {
    const expiresAt = "2026-07-18T12:31:00.000Z"
    const template = createStripeProviderRequestTemplate({
      operationId: OPERATION_ID,
      providerIdempotencyKey: `stripe-checkout:${OPERATION_ID}`,
      sponsorshipIntentId: INTENT_ID,
      paymentQuoteId: QUOTE_ID,
      providerAccountScope: "stripe_us",
      customerEmail: "sponsor@example.com",
      productName: "Creator Share sponsorship",
      productImageUrl: null,
      paymentMode: "one_time",
      recurrenceInterval: null,
      baseAmountUsdCents: 1600,
      chargedAmountMinor: 1600,
      chargedCurrency: "USD",
      conversionRate: 1,
      currencyQuoteAt: "2026-07-18T12:00:00.000Z",
      currencyRateSource: "worker-test",
      checkoutBaseUrl: "https://creatorshare.com",
      stripeRegion: "us",
      providerRequestExpiresAt: expiresAt,
    })
    const sealed = sealStripeProviderRequest(template, crypto)
    const client = {
      async rpc() {
        return {
          data: [
            {
              gateway_event_id: EVENT_ID,
              payment_attempt_id: ATTEMPT_ID,
              welcome_required: true,
              checkout_operation_id: OPERATION_ID,
              sponsorship_intent_id: INTENT_ID,
              payment_quote_id: QUOTE_ID,
              provider: "STRIPE",
              provider_account_scope: "stripe_us",
              provider_idempotency_key: `stripe-checkout:${OPERATION_ID}`,
              provider_request_schema_version: sealed.schemaVersion,
              provider_request_fingerprint: sealed.fingerprint,
              provider_request_expires_at: expiresAt,
              provider_request_ciphertext: sealed.ciphertext,
              provider_request_encryption_key_version:
                sealed.encryptionKeyVersion,
              provider_request_ciphertext_sha256: sealed.ciphertextSha256,
              contact_email_hmac: `\\x${"ff".repeat(32)}`,
              contact_email_normalization_version: 1,
              contact_email_hmac_key_version: 1,
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient

    await expect(
      createSupabasePaymentGatewayEventRepository(
        client,
        crypto,
      ).prepareWelcomeBundle(claimedEvent(), context),
    ).rejects.toMatchObject({
      name: "PaymentGatewayEventRepositoryError",
      stage: "welcome_email_binding",
    })
  })

  test("applies a signed Checkout expiration through its exact RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return {
          data: [{ application_effect: "checkout_expired" }],
          error: null,
        }
      },
    } as unknown as SupabaseClient

    const result = await createSupabasePaymentGatewayEventRepository(
      client,
      crypto,
    ).applyCheckoutExpiration(
      claimedEvent({ eventType: "checkout.session.expired" }),
      context,
    )

    expect(result).toEqual({ effect: "checkout_expired" })
    expect(calls).toEqual([
      {
        name: "apply_sponsorship_checkout_expiration",
        args: {
          target_gateway_event_id: EVENT_ID,
          target_processing_lease_token: LEASE_ID,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
          context_client_ip: null,
          context_user_agent: null,
        },
      },
    ])
  })

  test("parses one bounded checkout contact erasure batch", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return {
          data: [
            {
              erased_count: "6",
              succeeded_count: "2",
              failed_count: "1",
              cancelled_count: "1",
              expired_count: "2",
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient

    const result = await createSupabasePaymentGatewayEventRepository(
      client,
      crypto,
    ).purgeCheckoutContactEnvelopes(context)

    expect(result).toEqual({
      erased: 6,
      succeeded: 2,
      failed: 1,
      cancelled: 1,
      expired: 2,
    })
    expect(calls).toEqual([
      {
        name: "purge_sponsorship_checkout_contact_envelopes",
        args: {
          target_batch_size: 100,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
        },
      },
    ])
  })

  test("rejects internally inconsistent contact erasure counts", async () => {
    const client = {
      async rpc() {
        return {
          data: [
            {
              erased_count: 2,
              succeeded_count: 1,
              failed_count: 0,
              cancelled_count: 0,
              expired_count: 0,
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient

    await expect(
      createSupabasePaymentGatewayEventRepository(
        client,
        crypto,
      ).purgeCheckoutContactEnvelopes(context),
    ).rejects.toMatchObject({
      name: "PaymentGatewayEventRepositoryError",
      stage: "purge_contact_shape",
    })
  })
})

test.describe("payment gateway event worker access", () => {
  test("uses constant time bearer authentication and bounded configuration", () => {
    const secret = "s".repeat(40)
    expect(
      isAuthorizedPaymentGatewayEventWorkerRequest(`Bearer ${secret}`, secret),
    ).toBe(true)
    expect(
      isAuthorizedPaymentGatewayEventWorkerRequest(`Bearer ${secret} `, secret),
    ).toBe(false)
    expect(
      loadPaymentGatewayEventWorkerConfig({
        PAYMENT_GATEWAY_EVENT_BATCH_SIZE: "40",
        PAYMENT_GATEWAY_EVENT_CONCURRENCY: "6",
      }),
    ).toEqual({ batchSize: 40, concurrency: 6 })
    expect(
      loadPaymentGatewayEventWorkerSecret({
        PAYMENT_GATEWAY_EVENT_WORKER_SECRET: secret,
      }),
    ).toBe(secret)
    expect(loadPaymentGatewayEventWorkerSecret({ CRON_SECRET: secret })).toBe(
      secret,
    )
    expect(
      loadPaymentGatewayEventWorkerSecret({
        PAYMENT_GATEWAY_EVENT_WORKER_SECRET: "",
        CRON_SECRET: secret,
      }),
    ).toBe(secret)
    expect(() =>
      loadPaymentGatewayEventWorkerSecret({
        PAYMENT_GATEWAY_EVENT_WORKER_SECRET: "invalid",
        CRON_SECRET: secret,
      }),
    ).toThrow("Payment gateway event worker secret is unavailable")
    expect(() =>
      loadPaymentGatewayEventWorkerConfig({
        PAYMENT_GATEWAY_EVENT_BATCH_SIZE: "101",
      }),
    ).toThrow("Invalid payment gateway event worker configuration")
  })
})
