import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ProviderRequestModule =
  typeof import("../../src/lib/sponsorships/checkout/stripeProviderRequest")
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
  resolve(process.cwd(), "tests/sponsorships/stripe-provider-request.spec.ts"),
)
const providerRequestModule = testRequire(
  "../../src/lib/sponsorships/checkout/stripeProviderRequest",
) as ProviderRequestModule
const { createSponsorshipCrypto, fromSupabaseRpcBytea } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as typeof import("../../src/lib/sponsorships/crypto")
nodeModule._load = originalModuleLoad

const {
  StripeProviderRequestError,
  buildStripeProviderRequestTemplateClaims,
  createStripeProviderRequestTemplate,
  materializeStripeProviderRequest,
  openSealedStripeProviderRequest,
  sealStripeProviderRequest,
} = providerRequestModule

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const INTENT_ID = "22222222-2222-4222-8222-222222222222"
const QUOTE_ID = "33333333-3333-4333-8333-333333333333"
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444"
const APP_SECRET = Buffer.alloc(48, 6).toString("base64")

function cryptoWithChangingNonces() {
  let call = 0
  return createSponsorshipCrypto(
    { appSecretBase64: APP_SECRET },
    {
      randomBytes: (size) => {
        call += 1
        return Buffer.alloc(size, call)
      },
    },
  )
}

function templateInput() {
  return {
    operationId: OPERATION_ID,
    providerIdempotencyKey: `stripe-checkout:${OPERATION_ID}`,
    sponsorshipIntentId: INTENT_ID,
    paymentQuoteId: QUOTE_ID,
    providerAccountScope: "stripe_uk",
    customerEmail: "sponsor+mobile@example.com",
    productName: "Monthly Sponsorship for Amina",
    productImageUrl: "https://assets.creatorshare.com/amina.jpg",
    paymentMode: "recurring" as const,
    recurrenceInterval: "month" as const,
    baseAmountUsdCents: 3333,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP" as const,
    conversionRate: 0.74,
    currencyQuoteAt: "2026-07-18T08:00:00.000Z",
    currencyRateSource: "test-rate-source",
    checkoutBaseUrl: "https://alice.creatorshare.com",
    stripeRegion: "uk" as const,
    providerRequestExpiresAt: "2026-07-18T08:31:00.000Z",
  }
}

function exactOpenInput(sealed: ReturnType<typeof sealStripeProviderRequest>) {
  return {
    ciphertext: sealed.ciphertext,
    ciphertextSha256: sealed.ciphertextSha256,
    encryptionKeyVersion: sealed.encryptionKeyVersion,
    fingerprint: sealed.fingerprint,
    schemaVersion: sealed.schemaVersion,
    expectedOperationId: OPERATION_ID,
    expectedPaymentAttemptId: ATTEMPT_ID,
    expectedSponsorshipIntentId: INTENT_ID,
    expectedPaymentQuoteId: QUOTE_ID,
    expectedProviderAccountScope: "stripe_uk",
    expectedProviderIdempotencyKey: `stripe-checkout:${OPERATION_ID}`,
  }
}

test.describe("sealed Stripe provider request", () => {
  test("seals the complete server request before materializing the database attempt ID", () => {
    const crypto = cryptoWithChangingNonces()
    const template = createStripeProviderRequestTemplate(templateInput())
    const sealed = sealStripeProviderRequest(template, crypto)

    expect(template.paymentAttemptId).toEqual({
      $creator_share: "server_payment_attempt_id",
      type: "uuid",
    })
    expect(sealed.fingerprint).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(sealed.ciphertextSha256).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(sealed.ciphertext).not.toContain(template.customerEmail)

    const materialized = openSealedStripeProviderRequest(
      exactOpenInput(sealed),
      crypto,
    )
    expect(materialized).toEqual({
      idempotencyKey: `stripe-checkout:${OPERATION_ID}`,
      customerEmail: "sponsor+mobile@example.com",
      productName: "Monthly Sponsorship for Amina",
      productImageUrl: "https://assets.creatorshare.com/amina.jpg",
      sponsorshipIntentId: INTENT_ID,
      paymentAttemptId: ATTEMPT_ID,
      providerAccountScope: "stripe_uk",
      paymentMode: "recurring",
      recurrenceInterval: "month",
      baseAmountUsdCents: 3333,
      chargedAmountMinor: 2466,
      chargedCurrency: "GBP",
      conversionRate: 0.74,
      currencyQuoteAt: "2026-07-18T08:00:00.000Z",
      currencyRateSource: "test-rate-source",
      checkoutBaseUrl: "https://alice.creatorshare.com",
      stripeRegion: "uk",
      expiresAtUnixSeconds: 1784363460,
    })
  })

  test("uses one canonical fingerprint across randomized encryption envelopes", () => {
    const crypto = cryptoWithChangingNonces()
    const template = createStripeProviderRequestTemplate(templateInput())
    const first = sealStripeProviderRequest(template, crypto)
    const second = sealStripeProviderRequest(template, crypto)

    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(first.ciphertextSha256).not.toBe(second.ciphertextSha256)
  })

  test("builds the exact database claims without exposing the sponsor email", () => {
    const crypto = cryptoWithChangingNonces()
    const template = createStripeProviderRequestTemplate(templateInput())
    const sealed = sealStripeProviderRequest(template, crypto)
    const emailDigest = crypto.digestEmail(template.customerEmail)
    const claims = buildStripeProviderRequestTemplateClaims(
      template,
      sealed,
      emailDigest,
    )

    expect(claims).toEqual({
      canonical_json_version: 1,
      provider: "STRIPE",
      provider_account_scope: "stripe_uk",
      checkout_operation_id: OPERATION_ID,
      sponsorship_intent_id: INTENT_ID,
      payment_quote_id: QUOTE_ID,
      payment_attempt_id_placeholder: {
        $creator_share: "server_payment_attempt_id",
        type: "uuid",
      },
      payment_attempt_id_placeholder_path: "/paymentAttemptId",
      unresolved_placeholder_count: 1,
      financial_terms: {
        payment_mode: "recurring",
        recurrence_interval: "month",
        base_amount_usd_cents: 3333,
        charged_amount_minor: 2466,
        charged_currency: "GBP",
        conversion_rate: 0.74,
        currency_quote_at_epoch_microseconds: 1784361600000000,
      },
      sponsor_email_binding: {
        representation: "encrypted_in_template",
        normalization_version: 1,
        hmac_key_version: 1,
        hmac_sha256: emailDigest.digestRpcBytea.slice(2),
      },
      product_display_fields_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      return_urls_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      provider_request_expires_at_epoch_microseconds: 1784363460000000,
      canonical_template_sha256: sealed.fingerprint.slice(2),
    })
    expect(JSON.stringify(claims)).not.toContain(template.customerEmail)
  })

  test("fails closed on ciphertext, fingerprint, scope, or attempt tampering", () => {
    const crypto = cryptoWithChangingNonces()
    const template = createStripeProviderRequestTemplate(templateInput())
    const sealed = sealStripeProviderRequest(template, crypto)
    const ciphertext = fromSupabaseRpcBytea(sealed.ciphertext)
    ciphertext[ciphertext.length - 1] ^= 1
    const tamperedCiphertext = `\\x${ciphertext.toString("hex")}` as const

    expect(() =>
      openSealedStripeProviderRequest(
        { ...exactOpenInput(sealed), ciphertext: tamperedCiphertext },
        crypto,
      ),
    ).toThrow(StripeProviderRequestError)
    expect(() =>
      openSealedStripeProviderRequest(
        {
          ...exactOpenInput(sealed),
          fingerprint: `\\x${"00".repeat(32)}`,
        },
        crypto,
      ),
    ).toThrow(StripeProviderRequestError)
    expect(() =>
      openSealedStripeProviderRequest(
        {
          ...exactOpenInput(sealed),
          expectedProviderAccountScope: "stripe_us",
        },
        crypto,
      ),
    ).toThrow(StripeProviderRequestError)
    expect(() =>
      openSealedStripeProviderRequest(
        {
          ...exactOpenInput(sealed),
          expectedPaymentAttemptId: "not-an-attempt-id",
        },
        crypto,
      ),
    ).toThrow(StripeProviderRequestError)

    const emailDigest = crypto.digestEmail(template.customerEmail)
    const claims = buildStripeProviderRequestTemplateClaims(
      template,
      sealed,
      emailDigest,
    )
    expect(() =>
      openSealedStripeProviderRequest(
        {
          ...exactOpenInput(sealed),
          expectedTemplateClaims: {
            ...claims,
            return_urls_sha256: "00".repeat(32),
          },
          expectedEmailDigest: emailDigest,
        },
        crypto,
      ),
    ).toThrow(StripeProviderRequestError)
    expect(() =>
      openSealedStripeProviderRequest(
        {
          ...exactOpenInput(sealed),
          expectedTemplateClaims: claims,
        },
        crypto,
      ),
    ).toThrow(StripeProviderRequestError)
  })

  test("rejects extra fields, mismatched routing, and inconsistent money", () => {
    expect(() =>
      createStripeProviderRequestTemplate({
        ...templateInput(),
        injectedProviderObjectId: "cs_test_attacker",
      } as ReturnType<typeof templateInput>),
    ).toThrow(StripeProviderRequestError)
    expect(() =>
      createStripeProviderRequestTemplate({
        ...templateInput(),
        stripeRegion: "us",
      }),
    ).toThrow(StripeProviderRequestError)
    expect(() =>
      createStripeProviderRequestTemplate({
        ...templateInput(),
        chargedAmountMinor: 1,
      }),
    ).toThrow(StripeProviderRequestError)
  })

  test("materializes only the supplied canonical database attempt ID", () => {
    const template = createStripeProviderRequestTemplate(templateInput())
    expect(
      materializeStripeProviderRequest(template, ATTEMPT_ID),
    ).toMatchObject({ paymentAttemptId: ATTEMPT_ID })
    expect(() =>
      materializeStripeProviderRequest(
        template,
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      ),
    ).toThrow(StripeProviderRequestError)
  })
})
