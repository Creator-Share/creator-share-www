import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  BeginPayPalV2PaymentInput,
  CapturePayPalSponsorshipDependencies,
  PayPalCaptureMaterial,
  PayPalSponsorshipCheckoutV2Dependencies,
  ResumedPayPalV2Checkout,
  SettlePayPalProviderObjectInput,
  VerifiedPayPalCaptureInput,
} from "../../src/lib/sponsorships/checkout/paypalCheckout"
import type {
  AuthoritativeBeneficiary,
  IssueV2QuoteInput,
  PrepareV2IntentInput,
  RecoveredV2Checkout,
  ResumeV2CheckoutInput,
} from "../../src/lib/sponsorships/checkout/stripeCheckout"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type CheckoutModule =
  typeof import("../../src/lib/sponsorships/checkout/paypalCheckout")
type CryptoModule = typeof import("../../src/lib/sponsorships/crypto")
type ProviderRequestModule =
  typeof import("../../src/lib/sponsorships/checkout/paypalProviderRequest")
type CheckoutRuntimeModule =
  typeof import("../../src/lib/sponsorships/checkout/paypalCheckoutRuntime")

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/utils/supabase/server") {
    return { createServiceRoleClient: () => ({}) }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/sponsorships/paypal-checkout-v2.spec.ts"),
)
const {
  capturePayPalSponsorshipCheckoutV2,
  createPayPalSponsorshipCheckoutV2,
} = testRequire(
  "../../src/lib/sponsorships/checkout/paypalCheckout",
) as CheckoutModule
const { createSponsorshipCrypto } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as CryptoModule
const {
  buildPayPalProviderRequestTemplateClaims,
  createPayPalProviderRequestTemplate,
  openSealedPayPalProviderRequest,
  sealPayPalProviderRequest,
} = testRequire(
  "../../src/lib/sponsorships/checkout/paypalProviderRequest",
) as ProviderRequestModule
const { createCapturePayPalSponsorshipDependencies } = testRequire(
  "../../src/lib/sponsorships/checkout/paypalCheckoutRuntime",
) as CheckoutRuntimeModule
nodeModule._load = originalModuleLoad

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const INTENT_ID = "22222222-2222-4222-8222-222222222222"
const QUOTE_ID = "33333333-3333-4333-8333-333333333333"
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444"
const LEASE_ID = "55555555-5555-4555-8555-555555555555"
const BENEFICIARY_ID = "66666666-6666-4666-8666-666666666666"
const PLAN_ID = "P-ABCDEFGHIJKLMNOPQRSTUVWX"
const ORDER_ID = "5O190127TN364715T"
const CAPTURE_ID = "3C679366HH908993F"
const NOW = new Date("2026-07-18T08:00:00.000Z")
const QUOTE_EXPIRES_AT = "2026-07-18T08:15:00.000Z"
const REQUEST_EXPIRES_AT = "2026-07-18T08:31:00.000Z"
const APP_SECRET = Buffer.alloc(48, 13).toString("base64")
const VISITOR_TOKEN = Buffer.alloc(32, 8).toString("base64url")

const beneficiary: AuthoritativeBeneficiary = {
  id: BENEFICIARY_ID,
  name: "Amina",
  budgetGoalUsdCents: 3333,
  imageUrl: null,
}

function checkoutInput(
  paymentType: "subscription" | "one_time" = "subscription",
) {
  return {
    body: {
      action: "start",
      type: "sponsorship",
      beneficiaryId: BENEFICIARY_ID,
      amount: 3333,
      paymentType,
      email: "sponsor@example.com",
      currency: "GBP",
      checkoutRequestId: OPERATION_ID,
    },
    host: {
      source: "advocate_domain" as const,
      advocateHostname: "alice.creatorshare.com",
      checkoutBaseUrl: "https://alice.creatorshare.com",
    },
    authenticatedUser: null,
    visitorToken: VISITOR_TOKEN,
    requestContext: {
      requestId: "request-paypal-v2",
      traceId: "trace-paypal-v2",
      clientIp: "203.0.113.42",
      userAgent: "paypal-v2-test",
    },
  }
}

interface Calls {
  prepare: PrepareV2IntentInput[]
  quote: IssueV2QuoteInput[]
  begin: BeginPayPalV2PaymentInput[]
  resume: ResumeV2CheckoutInput[]
  attachedOrders: unknown[]
  plans: unknown[]
  provider: unknown[]
  settle: SettlePayPalProviderObjectInput[]
}

function recoveredAttempt(
  paymentMode: "one_time" | "recurring",
  overrides: Partial<RecoveredV2Checkout> = {},
): RecoveredV2Checkout {
  return {
    operationId: OPERATION_ID,
    operationCreatedAt: NOW.toISOString(),
    paymentAttemptId: ATTEMPT_ID,
    sponsorshipIntentId: INTENT_ID,
    paymentQuoteId: QUOTE_ID,
    provider: "PAYPAL",
    providerAccountScope: "paypal",
    intentStatus: "processing",
    attemptStatus: "pending",
    subjectKind: "standard",
    beneficiaryId: BENEFICIARY_ID,
    paymentMode,
    recurrenceInterval: paymentMode === "recurring" ? "month" : null,
    baseAmountUsdCents: 3333,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP",
    conversionRate: 0.74,
    currencyQuoteAt: NOW.toISOString(),
    quoteIssuedAt: NOW.toISOString(),
    quoteExpiresAt: QUOTE_EXPIRES_AT,
    checkoutReceiptExpiresAt: "2026-07-19T08:00:00.000Z",
    providerRequestSchemaVersion: 1,
    providerRequestFingerprint: `\\x${"1".repeat(64)}`,
    providerRequestExpiresAt: REQUEST_EXPIRES_AT,
    providerRequestEncryptionKeyVersion: 1,
    providerObjectAttached: true,
    recoveryStatus: "available",
    recoveryAttemptCount: 0,
    recoveryMaxAttempts: 8,
    nextReconciliationAt: REQUEST_EXPIRES_AT,
    ...overrides,
  }
}

function baseDependencies(
  options: {
    paymentMode?: "one_time" | "recurring"
    recovered?: RecoveredV2Checkout | null
    quoteExpiresAt?: string
    beginAmount?: number
    beginReplayed?: boolean
  } = {},
) {
  const paymentMode = options.paymentMode ?? "recurring"
  const calls: Calls = {
    prepare: [],
    quote: [],
    begin: [],
    resume: [],
    attachedOrders: [],
    plans: [],
    provider: [],
    settle: [],
  }
  const crypto = createSponsorshipCrypto(
    { appSecretBase64: APP_SECRET },
    { randomBytes: (size) => Buffer.alloc(size, 7) },
  )
  const dependencies: PayPalSponsorshipCheckoutV2Dependencies = {
    crypto,
    async loadBeneficiary() {
      return beneficiary
    },
    async recoverCheckout() {
      return options.recovered ?? null
    },
    async prepareIntent(input) {
      calls.prepare.push(input)
      return {
        sponsorshipIntentId: INTENT_ID,
        intentStatus: options.recovered?.intentStatus ?? "created",
        isReplay: Boolean(options.recovered),
      }
    },
    async issueQuote(input) {
      calls.quote.push(input)
      return {
        paymentQuoteId: QUOTE_ID,
        sponsorshipIntentId: INTENT_ID,
        provider: "PAYPAL",
        providerAccountScope: "paypal",
        baseAmountUsdCents: 3333,
        chargedAmountMinor: 2466,
        chargedCurrency: "GBP",
        conversionRate: 0.74,
        expiresAt: options.quoteExpiresAt ?? QUOTE_EXPIRES_AT,
      }
    },
    async beginPayment(input) {
      calls.begin.push(input)
      const reopened = openSealedPayPalProviderRequest(
        {
          ciphertext: input.providerRequest.ciphertext,
          ciphertextSha256: input.providerRequest.ciphertextSha256,
          encryptionKeyVersion: input.providerRequest.encryptionKeyVersion,
          fingerprint: input.providerRequest.fingerprint,
          schemaVersion: input.providerRequest.schemaVersion,
          expectedOperationId: OPERATION_ID,
          expectedPaymentAttemptId: ATTEMPT_ID,
          expectedSponsorshipIntentId: INTENT_ID,
          expectedPaymentQuoteId: QUOTE_ID,
          expectedProviderAccountScope: "paypal",
          expectedProviderIdempotencyKey: OPERATION_ID,
          expectedTemplateClaims: input.providerRequestClaims,
          expectedEmailDigest: crypto.digestEmail("sponsor@example.com"),
        },
        crypto,
      )
      expect(reopened.paypalPlanId).toBe(
        paymentMode === "recurring" ? PLAN_ID : null,
      )
      return {
        checkoutOperationId: OPERATION_ID,
        paymentAttemptId: ATTEMPT_ID,
        sponsorshipIntentId: INTENT_ID,
        provider: "PAYPAL",
        providerAccountScope: "paypal",
        paymentMode,
        baseAmountUsdCents: 3333,
        chargedAmountMinor: options.beginAmount ?? 2466,
        chargedCurrency: "GBP",
        conversionRate: 0.74,
        providerRequestExpiresAt: REQUEST_EXPIRES_AT,
        replayed: options.beginReplayed ?? false,
      }
    },
    async resumeCheckout(input) {
      calls.resume.push(input)
      throw new Error("Unexpected resume")
    },
    async readAttachedOneTimeOrder(input) {
      calls.attachedOrders.push(input)
      const evidence = replayEvidence({ paymentMode: "one_time", crypto })
      return {
        checkoutOperationId: OPERATION_ID,
        paymentAttemptId: ATTEMPT_ID,
        sponsorshipIntentId: INTENT_ID,
        paymentQuoteId: QUOTE_ID,
        providerAccountScope: "paypal",
        providerObjectType: "order",
        providerObjectId: ORDER_ID,
        providerRequestSchemaVersion: 1,
        providerRequestTemplateClaims: evidence.claims,
        providerRequestFingerprint: evidence.sealed.fingerprint,
        providerRequestExpiresAt: evidence.sealed.expiresAt,
        providerRequestCiphertext: evidence.sealed.ciphertext,
        providerRequestEncryptionKeyVersion:
          evidence.sealed.encryptionKeyVersion,
        providerRequestCiphertextSha256: evidence.sealed.ciphertextSha256,
      }
    },
    async ensureBillingPlan(planOptions) {
      calls.plans.push(planOptions)
      return { planId: PLAN_ID }
    },
    async createProviderObject(request) {
      calls.provider.push(request)
      return paymentMode === "one_time"
        ? {
            providerObjectType: "order",
            providerObjectId: ORDER_ID,
            approvalUrl: null,
          }
        : {
            providerObjectType: "billing_subscription",
            providerObjectId: "I-ABCDEFGHJKLMN",
            approvalUrl:
              "https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-1",
          }
    },
    async settleProviderObject(input) {
      calls.settle.push(input)
    },
    now: () => NOW,
  }
  return { dependencies, calls, crypto }
}

function replayEvidence(options: {
  paymentMode: "one_time" | "recurring"
  crypto: ReturnType<typeof createSponsorshipCrypto>
}) {
  const emailDigest = options.crypto.digestEmail("sponsor@example.com")
  const template = createPayPalProviderRequestTemplate({
    operationId: OPERATION_ID,
    providerIdempotencyKey: OPERATION_ID,
    sponsorshipIntentId: INTENT_ID,
    paymentQuoteId: QUOTE_ID,
    providerAccountScope: "paypal",
    customerEmail: "sponsor@example.com",
    productName:
      options.paymentMode === "recurring"
        ? "Monthly Sponsorship for Amina"
        : "One-time Sponsorship for Amina",
    paymentMode: options.paymentMode,
    recurrenceInterval: options.paymentMode === "recurring" ? "month" : null,
    baseAmountUsdCents: 3333,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP",
    conversionRate: 0.74,
    currencyQuoteAt: NOW.toISOString(),
    currencyRateSource: "creator-share-config-rates-2026-05-28",
    checkoutBaseUrl: "https://alice.creatorshare.com",
    paypalPlanId: options.paymentMode === "recurring" ? PLAN_ID : null,
    providerRequestExpiresAt: REQUEST_EXPIRES_AT,
  })
  const sealed = sealPayPalProviderRequest(template, options.crypto)
  return {
    sealed,
    claims: buildPayPalProviderRequestTemplateClaims(
      template,
      sealed,
      emailDigest,
    ),
  }
}

function resumedCheckout(
  evidence: ReturnType<typeof replayEvidence>,
): ResumedPayPalV2Checkout {
  return {
    checkoutOperationId: OPERATION_ID,
    paymentAttemptId: ATTEMPT_ID,
    provider: "PAYPAL",
    providerAccountScope: "paypal",
    providerIdempotencyKey: `paypal-checkout:${OPERATION_ID}`,
    attemptStatus: "pending",
    providerObjectAttached: true,
    providerRequestSchemaVersion: 1,
    providerRequestTemplateClaims: evidence.claims,
    providerRequestFingerprint: evidence.sealed.fingerprint,
    providerRequestExpiresAt: evidence.sealed.expiresAt,
    providerRequestCiphertext: evidence.sealed.ciphertext,
    providerRequestEncryptionKeyVersion: evidence.sealed.encryptionKeyVersion,
    providerRequestCiphertextSha256: evidence.sealed.ciphertextSha256,
    foregroundLeaseToken: LEASE_ID,
    foregroundLeaseExpiresAt: "2026-07-18T08:05:00.000Z",
  }
}

test.describe("v2 server owned PayPal checkout", () => {
  test("provisions the exact plan, seals it, and returns an advocate approval URL", async () => {
    const { dependencies, calls } = baseDependencies()
    const result = await createPayPalSponsorshipCheckoutV2(
      checkoutInput(),
      dependencies,
    )
    expect(result).toMatchObject({
      kind: "approval_redirect",
      approvalUrl:
        "https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-1",
    })
    expect(calls.prepare[0]).toMatchObject({
      provider: "PAYPAL",
      providerAccountScope: "paypal",
      providerIdempotencyKey: `paypal-checkout:${OPERATION_ID}`,
      source: "advocate_domain",
      advocateHostname: "alice.creatorshare.com",
    })
    expect(calls.plans[0]).toMatchObject({
      terms: {
        productName: "Monthly Sponsorship for Amina",
        chargedAmountMinor: 2466,
        chargedCurrency: "GBP",
        recurrenceInterval: "month",
      },
    })
    expect(calls.settle[0]).toMatchObject({
      providerObjectType: "billing_subscription",
      recoveryLeaseToken: null,
    })
    const providerRequest = calls.provider[0] as {
      checkoutBaseUrl: string
      customerEmail: string
      idempotencyKey: string
      paypalPlanId: string
    }
    expect(providerRequest).toMatchObject({
      checkoutBaseUrl: "https://alice.creatorshare.com",
      customerEmail: "sponsor@example.com",
      idempotencyKey: OPERATION_ID,
      paypalPlanId: PLAN_ID,
    })
  })

  test("creates a one-time order without provisioning or accepting a plan", async () => {
    const { dependencies, calls } = baseDependencies({
      paymentMode: "one_time",
    })
    await expect(
      createPayPalSponsorshipCheckoutV2(
        checkoutInput("one_time"),
        dependencies,
      ),
    ).resolves.toMatchObject({ kind: "order", orderId: ORDER_ID })
    expect(calls.plans).toHaveLength(0)
    expect(calls.provider[0]).toMatchObject({
      paypalPlanId: null,
      paymentMode: "one_time",
    })
  })

  test("reuses sealed provider evidence after a lost response", async () => {
    const recovered = recoveredAttempt("recurring")
    const { dependencies, calls, crypto } = baseDependencies({ recovered })
    const evidence = replayEvidence({ paymentMode: "recurring", crypto })
    dependencies.resumeCheckout = async (input) => {
      calls.resume.push(input)
      return resumedCheckout(evidence)
    }
    await expect(
      createPayPalSponsorshipCheckoutV2(checkoutInput(), dependencies),
    ).resolves.toMatchObject({ kind: "approval_redirect" })
    expect(calls.quote).toHaveLength(0)
    expect(calls.begin).toHaveLength(0)
    expect(calls.resume).toHaveLength(1)
    expect(calls.settle[0].recoveryLeaseToken).toBe(LEASE_ID)
  })

  test("returns the exact attached one-time order without another provider call", async () => {
    const recovered = recoveredAttempt("one_time")
    const { dependencies, calls } = baseDependencies({
      paymentMode: "one_time",
      recovered,
    })
    await expect(
      createPayPalSponsorshipCheckoutV2(
        checkoutInput("one_time"),
        dependencies,
      ),
    ).resolves.toMatchObject({ kind: "order", orderId: ORDER_ID })
    expect(calls.attachedOrders).toHaveLength(1)
    expect(calls.resume).toHaveLength(0)
    expect(calls.provider).toHaveLength(0)
    expect(calls.settle).toHaveLength(0)
  })

  test("reopens a replayed begin and keeps one provider request ID", async () => {
    const { dependencies, calls, crypto } = baseDependencies({
      beginReplayed: true,
    })
    const evidence = replayEvidence({ paymentMode: "recurring", crypto })
    dependencies.resumeCheckout = async (input) => {
      calls.resume.push(input)
      return resumedCheckout(evidence)
    }
    await createPayPalSponsorshipCheckoutV2(checkoutInput(), dependencies)
    expect(calls.begin).toHaveLength(1)
    expect(calls.resume).toHaveLength(1)
    expect(calls.provider[0]).toMatchObject({ idempotencyKey: OPERATION_ID })
  })

  test("rejects stale quotes and database amount drift before PayPal", async () => {
    const stale = baseDependencies({
      quoteExpiresAt: "2026-07-18T07:59:59.000Z",
    })
    await expect(
      createPayPalSponsorshipCheckoutV2(checkoutInput(), stale.dependencies),
    ).rejects.toMatchObject({ code: "sponsorship-unavailable" })
    expect(stale.calls.plans).toHaveLength(0)
    expect(stale.calls.provider).toHaveLength(0)

    const drift = baseDependencies({ beginAmount: 2467 })
    await expect(
      createPayPalSponsorshipCheckoutV2(checkoutInput(), drift.dependencies),
    ).rejects.toMatchObject({ code: "checkout-failed" })
    expect(drift.calls.provider).toHaveLength(0)
  })

  test("rejects browser supplied plan, provider, and display authority", async () => {
    const { dependencies, calls } = baseDependencies()
    await expect(
      createPayPalSponsorshipCheckoutV2(
        {
          ...checkoutInput(),
          body: {
            ...checkoutInput().body,
            plan_id: "P-ATTACKER",
            beneficiaryName: "Browser Name",
            providerObjectId: "I-ATTACKER",
          },
        },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "invalid-request" })
    expect(calls.prepare).toHaveLength(0)
  })
})

function captureDependencies(options: { succeeded?: boolean } = {}) {
  const crypto = createSponsorshipCrypto(
    { appSecretBase64: APP_SECRET },
    { randomBytes: (size) => Buffer.alloc(size, 9) },
  )
  const receipt = crypto.deriveCheckoutReceipt(OPERATION_ID)
  const evidence = replayEvidence({ paymentMode: "one_time", crypto })
  const material: PayPalCaptureMaterial = {
    checkoutOperationId: OPERATION_ID,
    paymentAttemptId: ATTEMPT_ID,
    sponsorshipIntentId: INTENT_ID,
    paymentQuoteId: QUOTE_ID,
    providerAccountScope: "paypal",
    providerObjectType: "order",
    providerObjectId: ORDER_ID,
    providerRequestSchemaVersion: 1,
    providerRequestTemplateClaims: evidence.claims,
    providerRequestFingerprint: evidence.sealed.fingerprint,
    providerRequestExpiresAt: evidence.sealed.expiresAt,
    providerRequestCiphertext: evidence.sealed.ciphertext,
    providerRequestEncryptionKeyVersion: evidence.sealed.encryptionKeyVersion,
    providerRequestCiphertextSha256: evidence.sealed.ciphertextSha256,
  }
  const ingested: VerifiedPayPalCaptureInput[] = []
  let captureCalls = 0
  let materialCalls = 0
  const dependencies: CapturePayPalSponsorshipDependencies = {
    crypto,
    async recoverCheckout() {
      return recoveredAttempt("one_time", {
        intentStatus: options.succeeded ? "succeeded" : "processing",
        attemptStatus: options.succeeded ? "succeeded" : "pending",
        recoveryStatus: options.succeeded ? "closed" : "available",
      })
    },
    async readCaptureMaterial() {
      materialCalls += 1
      return material
    },
    async captureOrder(orderId, request) {
      captureCalls += 1
      expect(orderId).toBe(ORDER_ID)
      expect(request.paymentAttemptId).toBe(ATTEMPT_ID)
      return {
        orderId: ORDER_ID,
        captureId: CAPTURE_ID,
        status: "COMPLETED",
        chargedAmountMinor: 2466,
        chargedCurrency: "GBP",
        occurredAt: "2026-07-18T08:00:00.000Z",
        providerPayload: { id: ORDER_ID, status: "COMPLETED" },
      }
    },
    async ingestCapture(input) {
      ingested.push(input)
    },
    now: () => NOW,
  }
  return {
    dependencies,
    receipt,
    ingested,
    captureCalls: () => captureCalls,
    materialCalls: () => materialCalls,
  }
}

test.describe("v2 server owned PayPal capture", () => {
  test("captures and ingests the exact attached order using the durable attempt ID", async () => {
    const fixture = captureDependencies()
    const result = await capturePayPalSponsorshipCheckoutV2(
      {
        operationId: OPERATION_ID,
        checkoutReceipt: fixture.receipt.token,
        requestContext: checkoutInput().requestContext,
      },
      fixture.dependencies,
    )
    expect(result).toMatchObject({
      replayed: false,
      statusUrl: "/payments/success?provider=paypal",
    })
    expect(fixture.captureCalls()).toBe(1)
    expect(fixture.ingested[0]).toMatchObject({
      paymentAttemptId: ATTEMPT_ID,
      providerEventId: CAPTURE_ID,
      providerObjectId: CAPTURE_ID,
      parentOrderId: ORDER_ID,
      baseAmountUsdCents: 3333,
      chargedAmountMinor: 2466,
      chargedCurrency: "GBP",
      conversionRate: 0.74,
    })
    expect(fixture.ingested[0].payloadCiphertext).toMatch(/^\\x[0-9a-f]+$/)
    expect(fixture.ingested[0].payloadSha256).toMatch(/^\\x[0-9a-f]{64}$/)
  })

  test("normalizes foreground provider API capture evidence to paid", async () => {
    const fixture = captureDependencies()
    await capturePayPalSponsorshipCheckoutV2(
      {
        operationId: OPERATION_ID,
        checkoutReceipt: fixture.receipt.token,
        requestContext: checkoutInput().requestContext,
      },
      fixture.dependencies,
    )

    const calls: Array<{
      name: string
      args: Record<string, unknown>
    }> = []
    const previousSecret = process.env.SPONSORSHIP_CRYPTO_SECRET_V1
    process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = APP_SECRET
    try {
      const runtime = createCapturePayPalSponsorshipDependencies({
        async rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args })
          return {
            data: [
              {
                payment_attempt_id: ATTEMPT_ID,
                processing_status: "received",
              },
            ],
            error: null,
          }
        },
      } as never)
      await runtime.ingestCapture(fixture.ingested[0])
    } finally {
      if (previousSecret === undefined) {
        delete process.env.SPONSORSHIP_CRYPTO_SECRET_V1
      } else {
        process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = previousSecret
      }
    }

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      name: "ingest_verified_payment_gateway_event",
      args: {
        target_verification_method: "provider_api_response",
        target_fact_payment_status: "paid",
      },
    })
  })

  test("treats an already succeeded capture as an idempotent replay", async () => {
    const fixture = captureDependencies({ succeeded: true })
    await expect(
      capturePayPalSponsorshipCheckoutV2(
        {
          operationId: OPERATION_ID,
          checkoutReceipt: fixture.receipt.token,
          requestContext: checkoutInput().requestContext,
        },
        fixture.dependencies,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      statusUrl: "/payments/success?provider=paypal",
    })
    expect(fixture.materialCalls()).toBe(0)
    expect(fixture.captureCalls()).toBe(0)
  })

  test("rejects a receipt from another operation before capture", async () => {
    const fixture = captureDependencies()
    const otherReceipt = fixture.dependencies.crypto.deriveCheckoutReceipt(
      "77777777-7777-4777-8777-777777777777",
    )
    fixture.dependencies.recoverCheckout = async () => null
    await expect(
      capturePayPalSponsorshipCheckoutV2(
        {
          operationId: OPERATION_ID,
          checkoutReceipt: otherReceipt.token,
          requestContext: checkoutInput().requestContext,
        },
        fixture.dependencies,
      ),
    ).rejects.toMatchObject({ code: "invalid-request" })
    expect(fixture.captureCalls()).toBe(0)
  })
})
