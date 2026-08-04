import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ProviderRequestModule =
  typeof import("../../src/lib/sponsorships/checkout/paypalProviderRequest")
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
  resolve(process.cwd(), "tests/sponsorships/paypal-provider-request.spec.ts"),
)
const providerRequestModule = testRequire(
  "../../src/lib/sponsorships/checkout/paypalProviderRequest",
) as ProviderRequestModule
const { createSponsorshipCrypto, fromSupabaseRpcBytea } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as typeof import("../../src/lib/sponsorships/crypto")
nodeModule._load = originalModuleLoad

const {
  PayPalProviderRequestError,
  buildPayPalProviderRequestTemplateClaims,
  createPayPalProviderRequestTemplate,
  openSealedPayPalProviderRequest,
  sealPayPalProviderRequest,
} = providerRequestModule

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const INTENT_ID = "22222222-2222-4222-8222-222222222222"
const QUOTE_ID = "33333333-3333-4333-8333-333333333333"
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444"
const APP_SECRET = Buffer.alloc(48, 8).toString("base64")

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

function recurringTemplateInput() {
  return {
    operationId: OPERATION_ID,
    providerIdempotencyKey: OPERATION_ID,
    sponsorshipIntentId: INTENT_ID,
    paymentQuoteId: QUOTE_ID,
    providerAccountScope: "paypal" as const,
    customerEmail: "sponsor+mobile@example.com",
    productName: "Monthly Sponsorship for Amina",
    paymentMode: "recurring" as const,
    recurrenceInterval: "month" as const,
    baseAmountUsdCents: 3333,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP" as const,
    conversionRate: 0.74,
    currencyQuoteAt: "2026-07-18T08:00:00.000Z",
    currencyRateSource: "test-rate-source",
    checkoutBaseUrl: "https://alice.creatorshare.com",
    paypalPlanId: "P-5ML4271244454362WXNWU5NQ",
    providerRequestExpiresAt: "2026-07-18T08:20:00.000Z",
  }
}

function exactOpenInput(sealed: ReturnType<typeof sealPayPalProviderRequest>) {
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
    expectedProviderAccountScope: "paypal",
    expectedProviderIdempotencyKey: OPERATION_ID,
  }
}

test.describe("sealed PayPal provider request", () => {
  test("seals recurring terms and materializes only the database attempt ID", () => {
    const crypto = cryptoWithChangingNonces()
    const template = createPayPalProviderRequestTemplate(
      recurringTemplateInput(),
    )
    const sealed = sealPayPalProviderRequest(template, crypto)

    expect(template.paymentAttemptId).toEqual({
      $creator_share: "server_payment_attempt_id",
      type: "uuid",
    })
    expect(sealed.fingerprint).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(sealed.ciphertext).not.toContain(template.customerEmail)

    expect(
      openSealedPayPalProviderRequest(exactOpenInput(sealed), crypto),
    ).toEqual({
      idempotencyKey: OPERATION_ID,
      customerEmail: "sponsor+mobile@example.com",
      productName: "Monthly Sponsorship for Amina",
      sponsorshipIntentId: INTENT_ID,
      paymentAttemptId: ATTEMPT_ID,
      providerAccountScope: "paypal",
      paymentMode: "recurring",
      recurrenceInterval: "month",
      baseAmountUsdCents: 3333,
      chargedAmountMinor: 2466,
      chargedCurrency: "GBP",
      conversionRate: 0.74,
      currencyQuoteAt: "2026-07-18T08:00:00.000Z",
      currencyRateSource: "test-rate-source",
      checkoutBaseUrl: "https://alice.creatorshare.com",
      paypalPlanId: "P-5ML4271244454362WXNWU5NQ",
      expiresAtUnixSeconds: 1784362800,
    })
  })

  test("supports one time orders without accepting a billing plan", () => {
    const crypto = cryptoWithChangingNonces()
    const template = createPayPalProviderRequestTemplate({
      ...recurringTemplateInput(),
      paymentMode: "one_time",
      recurrenceInterval: null,
      paypalPlanId: null,
    })
    const sealed = sealPayPalProviderRequest(template, crypto)

    expect(
      openSealedPayPalProviderRequest(exactOpenInput(sealed), crypto),
    ).toMatchObject({
      paymentMode: "one_time",
      recurrenceInterval: null,
      paypalPlanId: null,
    })
  })

  test("builds database claims without exposing sponsor contact", () => {
    const crypto = cryptoWithChangingNonces()
    const template = createPayPalProviderRequestTemplate(
      recurringTemplateInput(),
    )
    const sealed = sealPayPalProviderRequest(template, crypto)
    const emailDigest = crypto.digestEmail(template.customerEmail)
    const claims = buildPayPalProviderRequestTemplateClaims(
      template,
      sealed,
      emailDigest,
    )

    expect(claims).toMatchObject({
      canonical_json_version: 1,
      provider: "PAYPAL",
      provider_account_scope: "paypal",
      checkout_operation_id: OPERATION_ID,
      sponsorship_intent_id: INTENT_ID,
      payment_quote_id: QUOTE_ID,
      financial_terms: {
        payment_mode: "recurring",
        recurrence_interval: "month",
        base_amount_usd_cents: 3333,
        charged_amount_minor: 2466,
        charged_currency: "GBP",
        conversion_rate: 0.74,
      },
      sponsor_email_binding: {
        representation: "encrypted_in_template",
        normalization_version: 1,
        hmac_key_version: 1,
        hmac_sha256: emailDigest.digestRpcBytea.slice(2),
      },
      product_display_fields_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      return_urls_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      canonical_template_sha256: sealed.fingerprint.slice(2),
    })
    expect(JSON.stringify(claims)).not.toContain(template.customerEmail)

    expect(
      openSealedPayPalProviderRequest(
        {
          ...exactOpenInput(sealed),
          expectedTemplateClaims: claims,
          expectedEmailDigest: emailDigest,
        },
        crypto,
      ),
    ).toMatchObject({ customerEmail: template.customerEmail })
  })

  test("fails closed on ciphertext, scope, claims, and mode tampering", () => {
    const crypto = cryptoWithChangingNonces()
    const template = createPayPalProviderRequestTemplate(
      recurringTemplateInput(),
    )
    const sealed = sealPayPalProviderRequest(template, crypto)
    const ciphertext = fromSupabaseRpcBytea(sealed.ciphertext)
    ciphertext[ciphertext.length - 1] ^= 1

    expect(() =>
      openSealedPayPalProviderRequest(
        {
          ...exactOpenInput(sealed),
          ciphertext: `\\x${ciphertext.toString("hex")}`,
        },
        crypto,
      ),
    ).toThrow(PayPalProviderRequestError)
    expect(() =>
      openSealedPayPalProviderRequest(
        {
          ...exactOpenInput(sealed),
          expectedProviderAccountScope: "paypal_other",
        },
        crypto,
      ),
    ).toThrow(PayPalProviderRequestError)
    expect(() =>
      createPayPalProviderRequestTemplate({
        ...recurringTemplateInput(),
        paypalPlanId: null,
      }),
    ).toThrow(PayPalProviderRequestError)
    expect(() =>
      createPayPalProviderRequestTemplate({
        ...recurringTemplateInput(),
        chargedAmountMinor: 1,
      }),
    ).toThrow(PayPalProviderRequestError)
    expect(() =>
      createPayPalProviderRequestTemplate({
        ...recurringTemplateInput(),
        injectedPlanId: "P-ATTACKER",
      } as ReturnType<typeof recurringTemplateInput>),
    ).toThrow(PayPalProviderRequestError)
  })
})
