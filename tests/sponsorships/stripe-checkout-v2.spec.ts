import { createRequire } from "node:module"
import Module from "node:module"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  AuthoritativeBeneficiary,
  BeginV2PaymentInput,
  HostedStripeSessionInput,
  IssueV2QuoteInput,
  PrepareV2IntentInput,
  RecoveredV2Checkout,
  ResolvedSponsorshipCheckoutHost,
  ResumeV2CheckoutInput,
  SettleV2ProviderObjectInput,
  StripeSponsorshipCheckoutV2Dependencies,
} from "../../src/lib/sponsorships/checkout/stripeCheckout"
import type { VerifiedSponsorshipVisitorToken } from "../../src/lib/sponsorships/visitorCookie"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type CheckoutModule =
  typeof import("../../src/lib/sponsorships/checkout/stripeCheckout")
type CryptoModule = typeof import("../../src/lib/sponsorships/crypto")
type ProviderRequestModule =
  typeof import("../../src/lib/sponsorships/checkout/stripeProviderRequest")

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
  resolve(process.cwd(), "tests/sponsorships/stripe-checkout-v2.spec.ts"),
)
const {
  buildHostedStripeSessionParams,
  createStripeSponsorshipCheckoutV2,
  SponsorshipCheckoutError,
} = testRequire(
  "../../src/lib/sponsorships/checkout/stripeCheckout",
) as CheckoutModule
const { createSponsorshipCrypto } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as CryptoModule
const {
  buildStripeProviderRequestTemplateClaims,
  createStripeProviderRequestTemplate,
  openSealedStripeProviderRequest,
  sealStripeProviderRequest,
} = testRequire(
  "../../src/lib/sponsorships/checkout/stripeProviderRequest",
) as ProviderRequestModule
nodeModule._load = originalModuleLoad

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const INTENT_ID = "22222222-2222-4222-8222-222222222222"
const QUOTE_ID = "33333333-3333-4333-8333-333333333333"
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444"
const LEASE_TOKEN = "55555555-5555-4555-8555-555555555555"
const BENEFICIARY_ID = "66666666-6666-4666-8666-666666666666"
const SESSION_ID = "cs_test_v2authoritative123"
const SESSION_URL =
  "https://checkout.stripe.com/c/pay/cs_test_v2authoritative123"
const NOW = new Date("2026-07-18T08:00:00.000Z")
const QUOTE_EXPIRES_AT = "2026-07-18T08:15:00.000Z"
const REQUEST_EXPIRES_AT = "2026-07-18T08:31:00.000Z"
const APP_SECRET = Buffer.alloc(48, 11).toString("base64")
const VISITOR_TOKEN =
  `v1.${Buffer.alloc(32, 7).toString("base64url")}.${"A".repeat(22)}` as VerifiedSponsorshipVisitorToken

const beneficiary: AuthoritativeBeneficiary = {
  id: BENEFICIARY_ID,
  name: "Amina",
  budgetGoalUsdCents: 3333,
  imageUrl: "https://assets.creatorshare.com/amina.jpg",
}

function checkoutInput() {
  return {
    body: {
      type: "sponsorship",
      beneficiaryId: BENEFICIARY_ID,
      amount: 999_999,
      paymentType: "subscription",
      email: "browser-selected@example.com",
      currency: "GBP",
      checkoutRequestId: OPERATION_ID,
      providerAccountScope: "attacker_scope",
      conversionRate: 999,
    },
    host: {
      source: "advocate_domain" as const,
      advocateHostname: "alice.creatorshare.com",
      checkoutBaseUrl: "https://alice.creatorshare.com",
    },
    authenticatedUser: {
      id: "77777777-7777-4777-8777-777777777777",
      email: " Verified.Sponsor+Account@Example.com ",
    },
    visitorToken: VISITOR_TOKEN,
    requestContext: {
      requestId: "request-v2",
      traceId: "trace-v2",
      clientIp: "203.0.113.42",
      userAgent: "checkout-v2-test",
    },
  }
}

function partnershipCheckoutInput(
  options: {
    host?: ResolvedSponsorshipCheckoutHost
    amount?: number
    project?: string
  } = {},
) {
  return {
    ...checkoutInput(),
    body: {
      type: "partnership",
      amount: options.amount ?? 12_000,
      project: options.project ?? "education",
      paymentType: "subscription",
      email: "browser-selected@example.com",
      currency: "GBP",
      checkoutRequestId: OPERATION_ID,
      beneficiaryId: BENEFICIARY_ID,
      providerAccountScope: "attacker_scope",
      conversionRate: 999,
    },
    host: options.host ?? checkoutInput().host,
  }
}

function recoveredPartnershipAttempt(
  overrides: Partial<RecoveredV2Checkout> = {},
): RecoveredV2Checkout {
  return recoveredAttempt({
    subjectKind: "partnership",
    beneficiaryId: null,
    baseAmountUsdCents: 12_000,
    chargedAmountMinor: 8_880,
    ...overrides,
  })
}

interface Calls {
  authorize: unknown[]
  load: Array<{ id: string; allowCurrentlyIneligible: boolean }>
  recover: unknown[]
  prepare: PrepareV2IntentInput[]
  quote: IssueV2QuoteInput[]
  begin: BeginV2PaymentInput[]
  resume: ResumeV2CheckoutInput[]
  stripe: HostedStripeSessionInput[]
  settle: SettleV2ProviderObjectInput[]
}

function baseDependencies(
  options: {
    recovered?: RecoveredV2Checkout | null
    beginReplayed?: boolean
    baseAmountUsdCents?: number
    chargedAmountMinor?: number
  } = {},
): {
  dependencies: StripeSponsorshipCheckoutV2Dependencies
  calls: Calls
} {
  const calls: Calls = {
    authorize: [],
    load: [],
    recover: [],
    prepare: [],
    quote: [],
    begin: [],
    resume: [],
    stripe: [],
    settle: [],
  }
  const crypto = createSponsorshipCrypto(
    { appSecretBase64: APP_SECRET },
    { randomBytes: (size) => Buffer.alloc(size, 9) },
  )
  const dependencies: StripeSponsorshipCheckoutV2Dependencies = {
    crypto,
    async authorizeHost(host) {
      calls.authorize.push(host)
    },
    async loadBeneficiary(id, allowCurrentlyIneligible) {
      calls.load.push({ id, allowCurrentlyIneligible })
      return beneficiary
    },
    async recoverCheckout(input) {
      calls.recover.push(input)
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
        provider: "STRIPE",
        providerAccountScope: "stripe_uk",
        baseAmountUsdCents: options.baseAmountUsdCents ?? 3333,
        chargedAmountMinor: options.chargedAmountMinor ?? 2466,
        chargedCurrency: "GBP",
        conversionRate: 0.74,
        expiresAt: QUOTE_EXPIRES_AT,
      }
    },
    async beginPayment(input) {
      calls.begin.push(input)
      const reopened = openSealedStripeProviderRequest(
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
          expectedProviderAccountScope: "stripe_uk",
          expectedProviderIdempotencyKey: `stripe-checkout:${OPERATION_ID}`,
          expectedTemplateClaims: input.providerRequestClaims,
          expectedEmailDigest: crypto.digestEmail(
            "verified.sponsor+account@example.com",
          ),
        },
        crypto,
      )
      expect(reopened.customerEmail).toBe(
        "verified.sponsor+account@example.com",
      )
      return {
        checkoutOperationId: OPERATION_ID,
        paymentAttemptId: ATTEMPT_ID,
        sponsorshipIntentId: INTENT_ID,
        provider: "STRIPE",
        providerAccountScope: "stripe_uk",
        paymentMode: "recurring",
        baseAmountUsdCents: options.baseAmountUsdCents ?? 3333,
        chargedAmountMinor: options.chargedAmountMinor ?? 2466,
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
    async createHostedSession(input) {
      calls.stripe.push(input)
      return {
        id: SESSION_ID,
        url: SESSION_URL,
        expiresAtUnixSeconds: input.expiresAtUnixSeconds,
      }
    },
    async settleProviderObject(input) {
      calls.settle.push(input)
    },
    now: () => NOW,
  }
  return { dependencies, calls }
}

function recoveredAttempt(
  overrides: Partial<RecoveredV2Checkout> = {},
): RecoveredV2Checkout {
  return {
    operationId: OPERATION_ID,
    operationCreatedAt: NOW.toISOString(),
    paymentAttemptId: ATTEMPT_ID,
    sponsorshipIntentId: INTENT_ID,
    paymentQuoteId: QUOTE_ID,
    provider: "STRIPE",
    providerAccountScope: "stripe_uk",
    intentStatus: "processing",
    attemptStatus: "pending",
    subjectKind: "standard",
    beneficiaryId: BENEFICIARY_ID,
    paymentMode: "recurring",
    recurrenceInterval: "month",
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

function sealedReplayEvidence(
  crypto: CryptoModule["createSponsorshipCrypto"] extends (
    ...args: never[]
  ) => infer T
    ? T
    : never,
) {
  const emailDigest = crypto.digestEmail("verified.sponsor+account@example.com")
  const template = createStripeProviderRequestTemplate({
    operationId: OPERATION_ID,
    providerIdempotencyKey: `stripe-checkout:${OPERATION_ID}`,
    sponsorshipIntentId: INTENT_ID,
    paymentQuoteId: QUOTE_ID,
    providerAccountScope: "stripe_uk",
    customerEmail: emailDigest.normalizedEmail,
    productName: "Monthly Sponsorship for Amina",
    productImageUrl: beneficiary.imageUrl,
    paymentMode: "recurring",
    recurrenceInterval: "month",
    baseAmountUsdCents: 3333,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP",
    conversionRate: 0.74,
    currencyQuoteAt: NOW.toISOString(),
    currencyRateSource: "creator-share-config-rates-2026-05-28",
    checkoutBaseUrl: "https://alice.creatorshare.com",
    stripeRegion: "uk",
    providerRequestExpiresAt: REQUEST_EXPIRES_AT,
  })
  const sealed = sealStripeProviderRequest(template, crypto)
  return {
    sealed,
    claims: buildStripeProviderRequestTemplateClaims(
      template,
      sealed,
      emailDigest,
    ),
  }
}

test.describe("v2 server owned Stripe checkout", () => {
  test("persists and reopens the exact provider request before calling Stripe", async () => {
    const { dependencies, calls } = baseDependencies()
    const result = await createStripeSponsorshipCheckoutV2(
      checkoutInput(),
      dependencies,
    )

    expect(result.url).toBe(SESSION_URL)
    expect(result.checkoutReceipt).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(calls.load).toEqual([
      { id: BENEFICIARY_ID, allowCurrentlyIneligible: false },
    ])
    expect(calls.prepare[0]).toMatchObject({
      checkoutOperationId: OPERATION_ID,
      idempotencyKey: `checkout-v2:${OPERATION_ID}`,
      providerAccountScope: "stripe_uk",
      source: "advocate_domain",
      advocateHostname: "alice.creatorshare.com",
      baseAmountUsdCents: 3333,
      chargedAmountMinor: 2466,
      chargedCurrency: "GBP",
      conversionRate: 0.74,
    })
    expect(calls.begin).toHaveLength(1)
    expect(calls.stripe[0]).toMatchObject({
      idempotencyKey: `stripe-checkout:${OPERATION_ID}`,
      sponsorshipIntentId: INTENT_ID,
      paymentAttemptId: ATTEMPT_ID,
      customerEmail: "verified.sponsor+account@example.com",
      expiresAtUnixSeconds: Date.parse(REQUEST_EXPIRES_AT) / 1000,
    })
    expect(calls.settle[0]).toMatchObject({
      paymentAttemptId: ATTEMPT_ID,
      providerObjectId: SESSION_ID,
      providerRequestExpiresAt: REQUEST_EXPIRES_AT,
      recoveryLeaseToken: null,
    })
  })

  test("reopens stored evidence under a foreground lease after a lost response", async () => {
    const recovered = recoveredAttempt()
    const { dependencies, calls } = baseDependencies({ recovered })
    const evidence = sealedReplayEvidence(dependencies.crypto)
    dependencies.resumeCheckout = async (input) => {
      calls.resume.push(input)
      return {
        checkoutOperationId: OPERATION_ID,
        paymentAttemptId: ATTEMPT_ID,
        provider: "STRIPE",
        providerAccountScope: "stripe_uk",
        providerIdempotencyKey: `stripe-checkout:${OPERATION_ID}`,
        attemptStatus: "pending",
        providerObjectAttached: true,
        providerRequestSchemaVersion: 1,
        providerRequestTemplateClaims: evidence.claims,
        providerRequestFingerprint: evidence.sealed.fingerprint,
        providerRequestExpiresAt: evidence.sealed.expiresAt,
        providerRequestCiphertext: evidence.sealed.ciphertext,
        providerRequestEncryptionKeyVersion:
          evidence.sealed.encryptionKeyVersion,
        providerRequestCiphertextSha256: evidence.sealed.ciphertextSha256,
        foregroundLeaseToken: LEASE_TOKEN,
        foregroundLeaseExpiresAt: "2026-07-18T08:05:00.000Z",
      }
    }

    const result = await createStripeSponsorshipCheckoutV2(
      checkoutInput(),
      dependencies,
    )
    expect(result.url).toBe(SESSION_URL)
    expect(calls.load[0].allowCurrentlyIneligible).toBe(true)
    expect(calls.quote).toHaveLength(0)
    expect(calls.begin).toHaveLength(0)
    expect(calls.resume).toHaveLength(1)
    expect(calls.settle[0].recoveryLeaseToken).toBe(LEASE_TOKEN)
  })

  test("returns only the local status surface for a recovered success", async () => {
    const { dependencies, calls } = baseDependencies({
      recovered: recoveredAttempt({
        intentStatus: "succeeded",
        attemptStatus: "succeeded",
        recoveryStatus: "closed",
      }),
    })
    await expect(
      createStripeSponsorshipCheckoutV2(checkoutInput(), dependencies),
    ).resolves.toMatchObject({
      url: "https://alice.creatorshare.com/payments/success",
    })
    expect(calls.resume).toHaveLength(0)
    expect(calls.stripe).toHaveLength(0)
  })

  test("does not race recovery that a worker has already touched", async () => {
    const { dependencies, calls } = baseDependencies({
      recovered: recoveredAttempt({
        recoveryStatus: "leased",
        recoveryAttemptCount: 1,
      }),
    })
    await expect(
      createStripeSponsorshipCheckoutV2(checkoutInput(), dependencies),
    ).resolves.toMatchObject({
      url: "https://alice.creatorshare.com/payments/success",
    })
    expect(calls.resume).toHaveLength(0)
    expect(calls.stripe).toHaveLength(0)
  })

  test("requires one browser operation and rejects a changed replay scope", async () => {
    const { dependencies } = baseDependencies()
    await expect(
      createStripeSponsorshipCheckoutV2(
        {
          ...checkoutInput(),
          body: { ...checkoutInput().body, checkoutRequestId: undefined },
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(SponsorshipCheckoutError)

    const changed = baseDependencies({
      recovered: recoveredAttempt({ chargedCurrency: "EUR" }),
    })
    await expect(
      createStripeSponsorshipCheckoutV2(checkoutInput(), changed.dependencies),
    ).rejects.toMatchObject({ code: "sponsorship-unavailable" })
    expect(changed.calls.begin).toHaveLength(0)
    expect(changed.calls.stripe).toHaveLength(0)
  })
})

test.describe("v2 partnership Stripe checkout", () => {
  test("binds advocate attribution, identity evidence, project, amount, and exact return host before Stripe", async () => {
    const { dependencies, calls } = baseDependencies({
      baseAmountUsdCents: 12_000,
      chargedAmountMinor: 8_880,
    })

    await expect(
      createStripeSponsorshipCheckoutV2(
        partnershipCheckoutInput(),
        dependencies,
      ),
    ).resolves.toMatchObject({ url: SESSION_URL })

    expect(calls.authorize).toEqual([
      {
        source: "advocate_domain",
        advocateHostname: "alice.creatorshare.com",
        checkoutBaseUrl: "https://alice.creatorshare.com",
      },
    ])
    expect(calls.load).toEqual([])
    expect(calls.prepare).toHaveLength(1)
    expect(calls.prepare[0]).toMatchObject({
      checkoutOperationId: OPERATION_ID,
      idempotencyKey: `checkout-v2:${OPERATION_ID}`,
      source: "advocate_domain",
      advocateHostname: "alice.creatorshare.com",
      authUserId: "77777777-7777-4777-8777-777777777777",
      subjectKind: "partnership",
      beneficiaryId: null,
      partnershipProject: "education",
      baseAmountUsdCents: 12_000,
      chargedAmountMinor: 8_880,
      chargedCurrency: "GBP",
      provider: "STRIPE",
      providerAccountScope: "stripe_uk",
    })
    expect(calls.prepare[0].visitorTokenDigest).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(calls.stripe[0]).toMatchObject({
      idempotencyKey: `stripe-checkout:${OPERATION_ID}`,
      productName: "Monthly Partnership for Education",
      productImageUrl: null,
      chargedAmountMinor: 8_880,
      checkoutBaseUrl: "https://alice.creatorshare.com",
    })
    const request = buildHostedStripeSessionParams(calls.stripe[0])
    expect(request.success_url).toBe(
      "https://alice.creatorshare.com/payments/success",
    )
    expect(request.cancel_url).toBe(
      "https://alice.creatorshare.com/payments/failed",
    )
  })

  test("keeps primary host behavior canonical and unattributed", async () => {
    const { dependencies, calls } = baseDependencies({
      baseAmountUsdCents: 12_000,
      chargedAmountMinor: 8_880,
    })
    const host: ResolvedSponsorshipCheckoutHost = {
      source: "primary_site",
      advocateHostname: null,
      checkoutBaseUrl: "https://creatorshare.com",
    }

    await createStripeSponsorshipCheckoutV2(
      partnershipCheckoutInput({ host }),
      dependencies,
    )

    expect(calls.authorize).toEqual([host])
    expect(calls.prepare[0]).toMatchObject({
      source: "primary_site",
      advocateHostname: null,
      partnershipProject: "education",
    })
    expect(calls.stripe[0].checkoutBaseUrl).toBe("https://creatorshare.com")
  })

  test("fails an inactive advocate before recovery, intent preparation, or Stripe", async () => {
    const { dependencies, calls } = baseDependencies({
      baseAmountUsdCents: 12_000,
      chargedAmountMinor: 8_880,
    })
    dependencies.authorizeHost = async (host) => {
      calls.authorize.push(host)
      throw new SponsorshipCheckoutError(
        "sponsorship-unavailable",
        "This sponsorship is no longer available",
        409,
      )
    }

    await expect(
      createStripeSponsorshipCheckoutV2(
        partnershipCheckoutInput(),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "sponsorship-unavailable" })
    expect(calls.authorize).toHaveLength(1)
    expect(calls.recover).toHaveLength(0)
    expect(calls.prepare).toHaveLength(0)
    expect(calls.begin).toHaveLength(0)
    expect(calls.stripe).toHaveLength(0)
  })

  test("rejects project and amount tampering without creating a provider object", async () => {
    const invalidProject = baseDependencies({
      baseAmountUsdCents: 12_000,
      chargedAmountMinor: 8_880,
    })
    await expect(
      createStripeSponsorshipCheckoutV2(
        partnershipCheckoutInput({ project: "attacker_project" }),
        invalidProject.dependencies,
      ),
    ).rejects.toMatchObject({ code: "invalid-request" })
    expect(invalidProject.calls.authorize).toHaveLength(0)
    expect(invalidProject.calls.stripe).toHaveLength(0)

    const changedAmount = baseDependencies({
      recovered: recoveredPartnershipAttempt(),
      baseAmountUsdCents: 12_000,
      chargedAmountMinor: 8_880,
    })
    await expect(
      createStripeSponsorshipCheckoutV2(
        partnershipCheckoutInput({ amount: 13_000 }),
        changedAmount.dependencies,
      ),
    ).rejects.toMatchObject({ code: "sponsorship-unavailable" })
    expect(changedAmount.calls.prepare).toHaveLength(0)
    expect(changedAmount.calls.stripe).toHaveLength(0)

    const changedProject = baseDependencies({
      recovered: recoveredPartnershipAttempt(),
      baseAmountUsdCents: 12_000,
      chargedAmountMinor: 8_880,
    })
    changedProject.dependencies.prepareIntent = async (input) => {
      changedProject.calls.prepare.push(input)
      if (input.partnershipProject !== "education") {
        throw new SponsorshipCheckoutError(
          "sponsorship-unavailable",
          "This sponsorship is no longer available",
          409,
        )
      }
      return {
        sponsorshipIntentId: INTENT_ID,
        intentStatus: "processing",
        isReplay: true,
      }
    }
    await expect(
      createStripeSponsorshipCheckoutV2(
        partnershipCheckoutInput({ project: "shelter" }),
        changedProject.dependencies,
      ),
    ).rejects.toMatchObject({ code: "sponsorship-unavailable" })
    expect(changedProject.calls.prepare[0].partnershipProject).toBe("shelter")
    expect(changedProject.calls.stripe).toHaveLength(0)
  })

  test("reuses the exact operation, receipt, and provider idempotency key on retry", async () => {
    const { dependencies, calls } = baseDependencies({
      beginReplayed: true,
      baseAmountUsdCents: 12_000,
      chargedAmountMinor: 8_880,
    })
    dependencies.resumeCheckout = async (input) => {
      calls.resume.push(input)
      const begun = calls.begin[0]
      return {
        checkoutOperationId: OPERATION_ID,
        paymentAttemptId: ATTEMPT_ID,
        provider: "STRIPE",
        providerAccountScope: "stripe_uk",
        providerIdempotencyKey: `stripe-checkout:${OPERATION_ID}`,
        attemptStatus: "created",
        providerObjectAttached: false,
        providerRequestSchemaVersion: begun.providerRequest.schemaVersion,
        providerRequestTemplateClaims: begun.providerRequestClaims,
        providerRequestFingerprint: begun.providerRequest.fingerprint,
        providerRequestExpiresAt: begun.providerRequest.expiresAt,
        providerRequestCiphertext: begun.providerRequest.ciphertext,
        providerRequestEncryptionKeyVersion:
          begun.providerRequest.encryptionKeyVersion,
        providerRequestCiphertextSha256: begun.providerRequest.ciphertextSha256,
        foregroundLeaseToken: LEASE_TOKEN,
        foregroundLeaseExpiresAt: "2026-07-18T08:05:00.000Z",
      }
    }

    const result = await createStripeSponsorshipCheckoutV2(
      partnershipCheckoutInput(),
      dependencies,
    )

    expect(result.checkoutReceipt).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(calls.begin).toHaveLength(1)
    expect(calls.resume).toHaveLength(1)
    expect(calls.stripe).toHaveLength(1)
    expect(calls.stripe[0].idempotencyKey).toBe(
      `stripe-checkout:${OPERATION_ID}`,
    )
    expect(calls.settle[0].recoveryLeaseToken).toBe(LEASE_TOKEN)
  })

  test("contains no partnership provider creation outside the v2 boundary", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/app/api/stripe/route.ts"),
      "utf8",
    )
    expect(route).not.toContain("createLegacyPartnershipCheckout")
    expect(route).not.toContain("stripe.products.create")
    expect(route).not.toContain("stripe.prices.create")
    expect(route).toContain("createStripeSponsorshipCheckoutV2")
    expect(route).toContain(
      "target_partnership_project: input.partnershipProject",
    )
  })
})
