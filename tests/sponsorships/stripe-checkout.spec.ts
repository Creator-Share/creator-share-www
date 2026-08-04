import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { VerifiedSponsorshipVisitorToken } from "../../src/lib/sponsorships/visitorCookie"

import type {
  AttachProviderObjectInput,
  AuthoritativeBeneficiary,
  BeginPaymentInput,
  HostedStripeSessionInput,
  IssueQuoteInput,
  PrepareIntentInput,
  StripeSponsorshipCheckoutDependencies,
} from "../../src/lib/sponsorships/checkout/stripeCheckout"

type CheckoutModule =
  typeof import("../../src/lib/sponsorships/checkout/stripeCheckout")
type VisitorCookieModule =
  typeof import("../../src/lib/sponsorships/visitorCookie")
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
  resolve(process.cwd(), "tests/sponsorships/stripe-checkout.spec.ts"),
)
const checkoutModule = testRequire(
  "../../src/lib/sponsorships/checkout/stripeCheckout",
) as CheckoutModule
const { createSponsorshipCrypto } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as typeof import("../../src/lib/sponsorships/crypto")
const { createSponsorshipVisitorToken } = testRequire(
  "../../src/lib/sponsorships/visitorCookie",
) as VisitorCookieModule
nodeModule._load = originalModuleLoad

const {
  BLIND_SPONSORSHIP_AMOUNT_USD_CENTS,
  SponsorshipCheckoutError,
  buildHostedStripeSessionParams,
  createStripeSponsorshipCheckout,
  prepareServerOwnedSponsorshipPayment,
  readSponsorshipVisitorCookie,
  resolveSponsorshipCheckoutHost,
} = checkoutModule

const INTENT_ID = "11111111-1111-4111-8111-111111111111"
const QUOTE_ID = "22222222-2222-4222-8222-222222222222"
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333"
const OPERATION_ID = "44444444-4444-4444-8444-444444444444"
const CHECKOUT_SESSION_ID = "cs_test_authoritative123"
const CHECKOUT_URL =
  "https://checkout.stripe.com/c/pay/cs_test_authoritative123"
const NOW = new Date("2026-07-18T08:00:00.000Z")
const VISITOR_TOKEN =
  `v2.${Buffer.alloc(32, 9).toString("base64url")}.${"A".repeat(22)}` as VerifiedSponsorshipVisitorToken
const APP_SECRET = Buffer.alloc(48, 7).toString("base64")
const VISITOR_REQUEST_CONTEXT = Object.freeze({
  rawHost: "creatorshare.com",
})

interface RecordedCalls {
  beneficiaryIds: string[]
  prepare: PrepareIntentInput[]
  quote: IssueQuoteInput[]
  begin: BeginPaymentInput[]
  stripe: HostedStripeSessionInput[]
  attach: AttachProviderObjectInput[]
}

function dependenciesFor(beneficiary: AuthoritativeBeneficiary | null): {
  dependencies: StripeSponsorshipCheckoutDependencies
  calls: RecordedCalls
} {
  const calls: RecordedCalls = {
    beneficiaryIds: [],
    prepare: [],
    quote: [],
    begin: [],
    stripe: [],
    attach: [],
  }
  const sponsorshipCrypto = createSponsorshipCrypto(
    { appSecretBase64: APP_SECRET },
    { randomBytes: (size) => Buffer.alloc(size, 5) },
  )

  const dependencies: StripeSponsorshipCheckoutDependencies = {
    crypto: sponsorshipCrypto,
    async loadBeneficiary(id) {
      calls.beneficiaryIds.push(id)
      return beneficiary
    },
    async prepareIntent(input) {
      calls.prepare.push(input)
      return {
        sponsorshipIntentId: INTENT_ID,
        intentStatus: "created",
        isReplay: false,
      }
    },
    async issueQuote(input) {
      calls.quote.push(input)
      const prepared = calls.prepare[0]
      return {
        paymentQuoteId: QUOTE_ID,
        sponsorshipIntentId: input.sponsorshipIntentId,
        provider: input.provider,
        providerAccountScope: input.providerAccountScope,
        baseAmountUsdCents: prepared.baseAmountUsdCents,
        chargedAmountMinor: prepared.chargedAmountMinor,
        chargedCurrency: prepared.chargedCurrency,
        conversionRate: prepared.conversionRate,
        expiresAt: "2026-07-18T08:15:00.000Z",
      }
    },
    async beginPayment(input) {
      calls.begin.push(input)
      const prepared = calls.prepare[0]
      return {
        paymentAttemptId: ATTEMPT_ID,
        sponsorshipIntentId: input.sponsorshipIntentId,
        provider: input.provider,
        providerAccountScope: input.providerAccountScope,
        paymentMode: prepared.paymentMode,
        baseAmountUsdCents: prepared.baseAmountUsdCents,
        chargedAmountMinor: prepared.chargedAmountMinor,
        chargedCurrency: prepared.chargedCurrency,
        conversionRate: prepared.conversionRate,
      }
    },
    async createHostedSession(input) {
      calls.stripe.push(input)
      return {
        id: CHECKOUT_SESSION_ID,
        url: CHECKOUT_URL,
        expiresAtUnixSeconds: input.expiresAtUnixSeconds,
      }
    },
    async attachProviderObject(input) {
      calls.attach.push(input)
    },
    createOperationId: () => OPERATION_ID,
    now: () => NOW,
  }

  return { dependencies, calls }
}

function baseInput(body: Record<string, unknown>) {
  return {
    body,
    host: {
      source: "advocate_domain" as const,
      advocateHostname: "alice.creatorshare.com",
      checkoutBaseUrl: "https://alice.creatorshare.com",
    },
    authenticatedUser: {
      id: "55555555-5555-4555-8555-555555555555",
      email: " Verified.Sponsor+Account@Example.com ",
    },
    visitorToken: VISITOR_TOKEN,
    requestContext: {
      requestId: "request-123",
      traceId: "trace-123",
      clientIp: "203.0.113.42",
      userAgent: "checkout-test",
    },
  }
}

test.describe("server owned Stripe sponsorship checkout", () => {
  test("ignores browser fixed terms and sends only accepted terms to Stripe", async () => {
    const beneficiary = {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Amina",
      budgetGoalUsdCents: 3333,
      imageUrl: "https://assets.creatorshare.com/amina.jpg",
    }
    const { dependencies, calls } = dependenciesFor(beneficiary)

    const result = await createStripeSponsorshipCheckout(
      baseInput({
        type: "sponsorship",
        beneficiaryId: beneficiary.id,
        beneficiaryName: "Browser Invented Name",
        beneficiaryType: "Browser Invented Type",
        location: "Browser Invented Country",
        userId: "77777777-7777-4777-8777-777777777777",
        amount: 999_999,
        paymentType: "subscription",
        email: "attacker-selected@example.com",
        currency: "GBP",
        checkoutRequestId: OPERATION_ID,
        isEmbedded: true,
        providerAccountScope: "attacker_scope",
        conversionRate: 9000,
      }),
      dependencies,
    )

    const expectedReceipt =
      dependencies.crypto.deriveCheckoutReceipt(OPERATION_ID)
    expect(result).toEqual({
      url: CHECKOUT_URL,
      checkoutReceipt: expectedReceipt.token,
    })
    expect(calls.prepare).toHaveLength(1)
    expect(calls.prepare[0].idempotencyKey).toBe(`checkout:${OPERATION_ID}`)
    expect(calls.prepare[0]).toMatchObject({
      source: "advocate_domain",
      advocateHostname: "alice.creatorshare.com",
      authUserId: "55555555-5555-4555-8555-555555555555",
      subjectKind: "standard",
      beneficiaryId: beneficiary.id,
      paymentMode: "recurring",
      recurrenceInterval: "month",
      baseAmountUsdCents: 3333,
      chargedAmountMinor: 2466,
      chargedCurrency: "GBP",
      conversionRate: 0.74,
      currencyQuoteAt: NOW.toISOString(),
    })
    expect(calls.prepare[0].contactEmailDigest.normalizedEmail).toBe(
      "verified.sponsor+account@example.com",
    )
    expect(calls.prepare[0].visitorTokenDigest).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(calls.prepare[0].visitorTokenDigest).not.toContain(VISITOR_TOKEN)
    expect(calls.quote[0].providerAccountScope).toBe("stripe_uk")
    expect(calls.begin[0].providerAccountScope).toBe("stripe_uk")
    expect(calls.begin[0].providerIdempotencyKey).toBe(
      `stripe-checkout:${OPERATION_ID}`,
    )
    expect(calls.begin[0].checkoutReceiptDigest).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(calls.begin[0].checkoutReceiptDigest).toBe(
      expectedReceipt.digestRpcBytea,
    )
    expect(calls.begin[0].checkoutReceiptDigest).not.toContain(
      result.checkoutReceipt,
    )
    expect(calls.stripe[0]).toMatchObject({
      customerEmail: "verified.sponsor+account@example.com",
      productName: "Monthly Sponsorship for Amina",
      productImageUrl: beneficiary.imageUrl,
      sponsorshipIntentId: INTENT_ID,
      paymentAttemptId: ATTEMPT_ID,
      providerAccountScope: "stripe_uk",
      chargedAmountMinor: 2466,
      chargedCurrency: "GBP",
      checkoutBaseUrl: "https://alice.creatorshare.com",
      stripeRegion: "uk",
    })
    expect(calls.attach[0]).toMatchObject({
      paymentAttemptId: ATTEMPT_ID,
      providerObjectId: CHECKOUT_SESSION_ID,
    })

    const params = buildHostedStripeSessionParams(calls.stripe[0])
    expect(params.ui_mode).toBeUndefined()
    expect(params.return_url).toBeUndefined()
    expect(params.mode).toBe("subscription")
    expect(params.success_url).toContain("https://alice.creatorshare.com/")
    expect(params.metadata).toEqual({
      creatorshare_platform: "true",
      sponsorship_schema: "server_intent_v1",
      sponsorship_intent_id: INTENT_ID,
      payment_attempt_id: ATTEMPT_ID,
      provider_account_scope: "stripe_uk",
    })
    expect(JSON.stringify(params)).not.toContain("Browser Invented")
    expect(JSON.stringify(params)).not.toContain("attacker-selected")
    expect(JSON.stringify(params)).not.toContain("999999")
  })

  test("accepts a bounded user choice only for an authoritative open sponsorship", async () => {
    const beneficiary = {
      id: "88888888-8888-4888-8888-888888888888",
      name: "Neema",
      budgetGoalUsdCents: -1,
      imageUrl: null,
    }
    const { dependencies, calls } = dependenciesFor(beneficiary)

    await createStripeSponsorshipCheckout(
      baseInput({
        type: "sponsorship",
        beneficiaryId: beneficiary.id,
        amount: 1200,
        paymentType: "one_time",
        currency: "USD",
        email: "ignored-for-auth-user@example.com",
      }),
      dependencies,
    )

    expect(calls.prepare[0]).toMatchObject({
      baseAmountUsdCents: 1200,
      chargedAmountMinor: 1200,
      paymentMode: "one_time",
      recurrenceInterval: null,
    })
    expect(calls.stripe[0]).toMatchObject({
      paymentMode: "one_time",
      recurrenceInterval: null,
      chargedAmountMinor: 1200,
    })
    const params = buildHostedStripeSessionParams(calls.stripe[0])
    expect(params.mode).toBe("payment")
    expect(params.payment_intent_data).toBeDefined()
    expect(params.subscription_data).toBeUndefined()
    expect(params.line_items?.[0]).not.toHaveProperty("price_data.recurring")
  })

  test("normalizes the required guest email without accepting a browser user id", async () => {
    const beneficiary = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "Guest checkout",
      budgetGoalUsdCents: 3333,
      imageUrl: null,
    }
    const { dependencies, calls } = dependenciesFor(beneficiary)
    const input = {
      ...baseInput({
        type: "sponsorship",
        beneficiaryId: beneficiary.id,
        amount: 99_999,
        paymentType: "subscription",
        currency: "USD",
        email: "  Guest.Sponsor+Mobile@Example.com  ",
        userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
      authenticatedUser: null,
    }

    await createStripeSponsorshipCheckout(input, dependencies)

    expect(calls.prepare[0].authUserId).toBeNull()
    expect(calls.prepare[0].contactEmailDigest.normalizedEmail).toBe(
      "guest.sponsor+mobile@example.com",
    )
    expect(calls.stripe[0].customerEmail).toBe(
      "guest.sponsor+mobile@example.com",
    )
  })

  test("forces blind sponsorship subject, amount, and recurrence on the server", async () => {
    const { dependencies, calls } = dependenciesFor(null)

    await createStripeSponsorshipCheckout(
      baseInput({
        type: "blind_sponsorship",
        sponsorshipMode: "blind",
        beneficiaryId: "99999999-9999-4999-8999-999999999999",
        beneficiaryName: "Invented child",
        amount: 1,
        paymentType: "subscription",
        currency: "AUD",
        email: "ignored-for-auth-user@example.com",
      }),
      dependencies,
    )

    expect(calls.beneficiaryIds).toEqual([])
    expect(calls.prepare[0]).toMatchObject({
      subjectKind: "blind",
      beneficiaryId: null,
      baseAmountUsdCents: BLIND_SPONSORSHIP_AMOUNT_USD_CENTS,
      chargedAmountMinor: 4666,
      chargedCurrency: "AUD",
      paymentMode: "recurring",
      recurrenceInterval: "month",
    })
    expect(calls.stripe[0].productName).toBe("Monthly Blind Sponsorship")
  })

  test("fails closed if a dependency returns terms different from the database request", async () => {
    const beneficiary = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Zawadi",
      budgetGoalUsdCents: 3333,
      imageUrl: null,
    }
    const { dependencies, calls } = dependenciesFor(beneficiary)
    const originalBegin = dependencies.beginPayment
    dependencies.beginPayment = async (input) => ({
      ...(await originalBegin(input)),
      chargedAmountMinor: 1,
    })

    await expect(
      createStripeSponsorshipCheckout(
        baseInput({
          type: "sponsorship",
          beneficiaryId: beneficiary.id,
          amount: 3333,
          paymentType: "subscription",
          currency: "USD",
          email: "ignored-for-auth-user@example.com",
        }),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "checkout-failed" })
    expect(calls.stripe).toEqual([])
  })

  test("rejects blind one-time checkout and malformed open amounts", async () => {
    const blind = dependenciesFor(null)
    await expect(
      createStripeSponsorshipCheckout(
        baseInput({
          type: "blind_sponsorship",
          paymentType: "one_time",
          amount: 3333,
          currency: "USD",
          email: "guest@example.com",
        }),
        blind.dependencies,
      ),
    ).rejects.toBeInstanceOf(SponsorshipCheckoutError)
    expect(blind.calls.prepare).toEqual([])

    const openBeneficiary = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Open sponsorship",
      budgetGoalUsdCents: -1,
      imageUrl: null,
    }
    const open = dependenciesFor(openBeneficiary)
    await expect(
      createStripeSponsorshipCheckout(
        baseInput({
          type: "sponsorship",
          beneficiaryId: openBeneficiary.id,
          paymentType: "subscription",
          amount: 499,
          currency: "USD",
          email: "guest@example.com",
        }),
        open.dependencies,
      ),
    ).rejects.toMatchObject({ code: "invalid-request" })
    expect(open.calls.prepare).toEqual([])
  })
})

test.describe("shared server owned gateway boundary", () => {
  test("binds a non-Stripe provider before any external gateway object exists", async () => {
    const { dependencies, calls } = dependenciesFor(null)
    const contactEmailDigest = dependencies.crypto.digestEmail(
      "gateway@example.com",
    )
    const result = await prepareServerOwnedSponsorshipPayment(
      {
        source: "primary_site",
        advocateHostname: null,
        visitorTokenDigest: null,
        authUserId: null,
        contactEmailDigest,
        subjectKind: "blind",
        beneficiaryId: null,
        partnershipProject: null,
        paymentMode: "recurring",
        recurrenceInterval: "month",
        baseAmountUsdCents: 3333,
        chargedAmountMinor: 3333,
        chargedCurrency: "USD",
        conversionRate: 1,
        currencyQuoteAt: NOW.toISOString(),
        currencyRateSource: "test-rate-source",
        requestId: "request-shared",
        traceId: null,
        provider: "PAYPAL",
        providerAccountScope: "paypal",
        providerIdempotencyPrefix: "paypal-order",
        requestContext: {
          requestId: "request-shared",
          traceId: null,
          clientIp: null,
          userAgent: null,
        },
      },
      dependencies,
    )

    expect(calls.quote[0]).toMatchObject({
      provider: "PAYPAL",
      providerAccountScope: "paypal",
    })
    expect(calls.begin[0]).toMatchObject({
      provider: "PAYPAL",
      providerAccountScope: "paypal",
      providerIdempotencyKey: `paypal-order:${OPERATION_ID}`,
    })
    expect(result.paymentAttempt.provider).toBe("PAYPAL")
    expect(calls.stripe).toEqual([])
  })

  test("recovers an exact in-flight checkout with the same stable receipt", async () => {
    const { dependencies, calls } = dependenciesFor(null)
    dependencies.prepareIntent = async (input) => {
      calls.prepare.push(input)
      return {
        sponsorshipIntentId: INTENT_ID,
        intentStatus: "processing",
        isReplay: true,
      }
    }
    const contactEmailDigest =
      dependencies.crypto.digestEmail("replay@example.com")

    const result = await prepareServerOwnedSponsorshipPayment(
      {
        operationId: OPERATION_ID,
        source: "primary_site",
        advocateHostname: null,
        visitorTokenDigest: null,
        authUserId: null,
        contactEmailDigest,
        subjectKind: "blind",
        beneficiaryId: null,
        partnershipProject: null,
        paymentMode: "recurring",
        recurrenceInterval: "month",
        baseAmountUsdCents: 3333,
        chargedAmountMinor: 3333,
        chargedCurrency: "USD",
        conversionRate: 1,
        currencyQuoteAt: NOW.toISOString(),
        currencyRateSource: "test-rate-source",
        requestId: "request-replay",
        traceId: null,
        provider: "STRIPE",
        providerAccountScope: "stripe_us",
        providerIdempotencyPrefix: "stripe-checkout",
        requestContext: {
          requestId: "request-replay",
          traceId: null,
          clientIp: null,
          userAgent: null,
        },
      },
      dependencies,
    )

    expect(result.checkoutReceipt).toEqual(
      dependencies.crypto.deriveCheckoutReceipt(OPERATION_ID),
    )
    expect(calls.prepare[0].idempotencyKey).toBe(`checkout:${OPERATION_ID}`)
    expect(calls.begin[0].providerIdempotencyKey).toBe(
      `stripe-checkout:${OPERATION_ID}`,
    )
  })
})

test.describe("checkout host and visitor classification", () => {
  test("preserves the exact advocate host for branded return navigation", () => {
    expect(
      resolveSponsorshipCheckoutHost("Alice.CreatorShare.com", {
        allowLocalhostDevelopment: false,
      }),
    ).toEqual({
      source: "advocate_domain",
      advocateHostname: "alice.creatorshare.com",
      checkoutBaseUrl: "https://alice.creatorshare.com",
    })
  })

  test("maps the isolated canary host to its canonical database domain only when enabled", () => {
    expect(
      resolveSponsorshipCheckoutHost(
        "canary.advocate-staging.creatorshare.com",
        {
          allowLocalhostDevelopment: false,
          allowStagingEnvironment: true,
        },
      ),
    ).toEqual({
      source: "advocate_domain",
      advocateHostname: "canary.creatorshare.com",
      checkoutBaseUrl: "https://canary.advocate-staging.creatorshare.com",
    })
    expect(() =>
      resolveSponsorshipCheckoutHost(
        "canary.advocate-staging.creatorshare.com",
        {
          allowLocalhostDevelopment: false,
        },
      ),
    ).toThrowError(SponsorshipCheckoutError)
  })

  test("rejects production primary aliases and tenants from staging gateway resolution", () => {
    const options = {
      allowLocalhostDevelopment: false,
      allowStagingEnvironment: true,
      allowedPrimaryHostnames: [
        "advocate-staging.creatorshare.com",
        "www.creatorshare.com",
        "creator-share-www.vercel.app",
        "creator-share-www-git-dev.example.vercel.app",
      ],
    }
    expect(
      resolveSponsorshipCheckoutHost(
        "advocate-staging.creatorshare.com",
        options,
      ),
    ).toEqual({
      source: "primary_site",
      advocateHostname: null,
      checkoutBaseUrl: "https://advocate-staging.creatorshare.com",
    })
    for (const rawHost of [
      "creatorshare.com",
      "www.creatorshare.com",
      "creator-share-www.vercel.app",
      "creator-share-www-git-dev.example.vercel.app",
      "alice.creatorshare.com",
      "hope.advocate-staging.creatorshare.com",
    ]) {
      expect(() =>
        resolveSponsorshipCheckoutHost(rawHost, options),
      ).toThrowError(SponsorshipCheckoutError)
    }
  })

  test("uses conceptual primary source only for an explicit primary host", () => {
    expect(
      resolveSponsorshipCheckoutHost("creator-share-www.vercel.app", {
        allowLocalhostDevelopment: false,
        allowedPrimaryHostnames: ["creator-share-www.vercel.app"],
      }),
    ).toEqual({
      source: "primary_site",
      advocateHostname: null,
      checkoutBaseUrl: "https://creator-share-www.vercel.app",
    })

    expect(() =>
      resolveSponsorshipCheckoutHost("attacker.example", {
        allowLocalhostDevelopment: false,
      }),
    ).toThrowError(SponsorshipCheckoutError)
    expect(() =>
      resolveSponsorshipCheckoutHost("admin.creatorshare.com", {
        allowLocalhostDevelopment: false,
      }),
    ).toThrowError(SponsorshipCheckoutError)
  })

  test("accepts one authentic visitor candidate and rejects true ambiguity", async () => {
    const environment = {
      NODE_ENV: "production",
      SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: APP_SECRET,
    }
    const signedToken = await createSponsorshipVisitorToken(
      VISITOR_REQUEST_CONTEXT,
      environment,
    )
    const secondSignedToken = await createSponsorshipVisitorToken(
      VISITOR_REQUEST_CONTEXT,
      environment,
    )
    expect(signedToken).not.toBeNull()
    expect(secondSignedToken).not.toBeNull()
    await expect(
      readSponsorshipVisitorCookie(
        `other=value; cs_sponsorship_visitor_v1=${signedToken}`,
        VISITOR_REQUEST_CONTEXT,
        environment,
      ),
    ).resolves.toBe(signedToken)
    await expect(
      readSponsorshipVisitorCookie(
        `cs_sponsorship_visitor_v1=${signedToken}; ` +
          `cs_sponsorship_visitor_v1=${secondSignedToken}`,
        VISITOR_REQUEST_CONTEXT,
        environment,
      ),
    ).resolves.toBeNull()
    await expect(
      readSponsorshipVisitorCookie(
        `cs_sponsorship_visitor_v1=${signedToken}; ` +
          `cs_sponsorship_visitor_v1=${VISITOR_TOKEN}`,
        VISITOR_REQUEST_CONTEXT,
        environment,
      ),
    ).resolves.toBe(signedToken)
    await expect(
      readSponsorshipVisitorCookie(
        "cs_sponsorship_visitor_v1=not-a-token",
        VISITOR_REQUEST_CONTEXT,
        environment,
      ),
    ).resolves.toBeNull()
  })
})
