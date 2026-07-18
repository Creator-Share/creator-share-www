import "server-only"

import {
  constantTimeDigestEqual,
  fromSupabaseRpcBytea,
  normalizeSponsorEmailV1,
  sha256Digest,
  SPONSORSHIP_CRYPTO_KEY_VERSION,
  toSupabaseRpcBytea,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
  type VersionedEmailDigest,
} from "@/lib/sponsorships/crypto"
import type { SupportedCurrency } from "@/utils/currency"

export const PAYPAL_PROVIDER_REQUEST_SCHEMA_VERSION = 1 as const
export const PAYPAL_PROVIDER_REQUEST_SCHEMA =
  "creator_share_paypal_checkout_request_v1" as const

const PAYMENT_ATTEMPT_PLACEHOLDER = {
  $creator_share: "server_payment_attempt_id",
  type: "uuid",
} as const
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PROVIDER_IDEMPOTENCY_KEY_PATTERN = UUID_PATTERN
const PAYPAL_PLAN_ID_PATTERN = /^P-[A-Z0-9]{24}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SUPPORTED_CURRENCIES = new Set<SupportedCurrency>([
  "USD",
  "AUD",
  "GBP",
  "EUR",
])
const MAXIMUM_AMOUNT_MINOR = 2_147_483_647

export interface PayPalProviderRequestTemplateInput {
  operationId: string
  providerIdempotencyKey: string
  sponsorshipIntentId: string
  paymentQuoteId: string
  providerAccountScope: "paypal"
  customerEmail: string
  productName: string
  paymentMode: "one_time" | "recurring"
  recurrenceInterval: "month" | "year" | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  currencyQuoteAt: string
  currencyRateSource: string
  checkoutBaseUrl: string
  paypalPlanId: string | null
  providerRequestExpiresAt: string
}

export interface PayPalProviderRequestTemplate extends PayPalProviderRequestTemplateInput {
  schema: typeof PAYPAL_PROVIDER_REQUEST_SCHEMA
  provider: "PAYPAL"
  paymentAttemptId: typeof PAYMENT_ATTEMPT_PLACEHOLDER
}

export interface SealedPayPalProviderRequest {
  schemaVersion: typeof PAYPAL_PROVIDER_REQUEST_SCHEMA_VERSION
  fingerprint: SupabaseRpcBytea
  expiresAt: string
  ciphertext: SupabaseRpcBytea
  encryptionKeyVersion: number
  ciphertextSha256: SupabaseRpcBytea
}

export interface PayPalProviderRequestTemplateClaims {
  canonical_json_version: 1
  provider: "PAYPAL"
  provider_account_scope: "paypal"
  checkout_operation_id: string
  sponsorship_intent_id: string
  payment_quote_id: string
  payment_attempt_id_placeholder: typeof PAYMENT_ATTEMPT_PLACEHOLDER
  payment_attempt_id_placeholder_path: "/paymentAttemptId"
  unresolved_placeholder_count: 1
  financial_terms: {
    payment_mode: "one_time" | "recurring"
    recurrence_interval: "month" | "year" | null
    base_amount_usd_cents: number
    charged_amount_minor: number
    charged_currency: SupportedCurrency
    conversion_rate: number
    currency_quote_at_epoch_microseconds: number
  }
  sponsor_email_binding: {
    representation: "encrypted_in_template"
    normalization_version: number
    hmac_key_version: number
    hmac_sha256: string
  }
  product_display_fields_sha256: string
  return_urls_sha256: string
  provider_request_expires_at_epoch_microseconds: number
  canonical_template_sha256: string
}

export interface MaterializedPayPalProviderRequest {
  idempotencyKey: string
  customerEmail: string
  productName: string
  sponsorshipIntentId: string
  paymentAttemptId: string
  providerAccountScope: "paypal"
  paymentMode: "one_time" | "recurring"
  recurrenceInterval: "month" | "year" | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  currencyQuoteAt: string
  currencyRateSource: string
  checkoutBaseUrl: string
  paypalPlanId: string | null
  expiresAtUnixSeconds: number
}

export interface OpenSealedPayPalProviderRequestInput {
  ciphertext: SupabaseRpcBytea
  ciphertextSha256: SupabaseRpcBytea
  encryptionKeyVersion: number
  fingerprint: SupabaseRpcBytea
  schemaVersion: number
  expectedOperationId: string
  expectedPaymentAttemptId: string
  expectedSponsorshipIntentId: string
  expectedPaymentQuoteId: string
  expectedProviderAccountScope: string
  expectedProviderIdempotencyKey: string
  expectedTemplateClaims?: PayPalProviderRequestTemplateClaims
  expectedEmailDigest?: VersionedEmailDigest
}

export class PayPalProviderRequestError extends Error {
  constructor() {
    super("Invalid sealed PayPal provider request")
    this.name = "PayPalProviderRequestError"
  }
}

function reject(): never {
  throw new PayPalProviderRequestError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject()
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  reject()
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) reject()
  return value
}

function requiredString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < minimumLength ||
    value.length > maximumLength ||
    /[\r\n\0]/.test(value)
  ) {
    reject()
  }
  return value
}

function requiredInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAXIMUM_AMOUNT_MINOR
  ) {
    reject()
  }
  return value
}

function requiredConversionRate(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value >= 10_000_000_000
  ) {
    reject()
  }
  return value
}

function requiredIsoTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    reject()
  }
  return value
}

function requiredBaseUrl(value: unknown): string {
  const raw = requiredString(value, 8, 2048)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    reject()
  }
  const localDevelopment =
    url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (
    (url.protocol !== "https:" &&
      !(localDevelopment && url.protocol === "http:")) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    reject()
  }
  return url.origin
}

function requiredCurrency(value: unknown): SupportedCurrency {
  if (
    typeof value !== "string" ||
    !SUPPORTED_CURRENCIES.has(value as SupportedCurrency)
  ) {
    reject()
  }
  return value as SupportedCurrency
}

function optionalPayPalPlanId(value: unknown): string | null {
  if (value === null) return null
  const planId = requiredString(value, 26, 26)
  if (!PAYPAL_PLAN_ID_PATTERN.test(planId)) reject()
  return planId
}

function validateTemplate(value: unknown): PayPalProviderRequestTemplate {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema",
      "operationId",
      "provider",
      "providerIdempotencyKey",
      "sponsorshipIntentId",
      "paymentQuoteId",
      "paymentAttemptId",
      "providerAccountScope",
      "customerEmail",
      "productName",
      "paymentMode",
      "recurrenceInterval",
      "baseAmountUsdCents",
      "chargedAmountMinor",
      "chargedCurrency",
      "conversionRate",
      "currencyQuoteAt",
      "currencyRateSource",
      "checkoutBaseUrl",
      "paypalPlanId",
      "providerRequestExpiresAt",
    ]) ||
    value.schema !== PAYPAL_PROVIDER_REQUEST_SCHEMA ||
    value.provider !== "PAYPAL" ||
    value.providerAccountScope !== "paypal" ||
    !isRecord(value.paymentAttemptId) ||
    !hasExactKeys(value.paymentAttemptId, ["$creator_share", "type"]) ||
    value.paymentAttemptId.$creator_share !==
      PAYMENT_ATTEMPT_PLACEHOLDER.$creator_share ||
    value.paymentAttemptId.type !== PAYMENT_ATTEMPT_PLACEHOLDER.type
  ) {
    reject()
  }

  const paymentMode = requiredString(value.paymentMode, 1, 20)
  const recurrenceInterval = value.recurrenceInterval
  if (
    (paymentMode === "one_time" && recurrenceInterval !== null) ||
    (paymentMode === "recurring" &&
      recurrenceInterval !== "month" &&
      recurrenceInterval !== "year") ||
    (paymentMode !== "one_time" && paymentMode !== "recurring")
  ) {
    reject()
  }

  const paypalPlanId = optionalPayPalPlanId(value.paypalPlanId)
  if (
    (paymentMode === "one_time" && paypalPlanId !== null) ||
    (paymentMode === "recurring" && paypalPlanId === null)
  ) {
    reject()
  }

  const providerIdempotencyKey = requiredString(
    value.providerIdempotencyKey,
    16,
    38,
  )
  if (!PROVIDER_IDEMPOTENCY_KEY_PATTERN.test(providerIdempotencyKey)) {
    reject()
  }

  const customerEmail = requiredString(value.customerEmail, 3, 254)
  if (normalizeSponsorEmailV1(customerEmail) !== customerEmail) reject()

  const baseAmountUsdCents = requiredInteger(value.baseAmountUsdCents)
  const chargedAmountMinor = requiredInteger(value.chargedAmountMinor)
  const conversionRate = requiredConversionRate(value.conversionRate)
  if (Math.round(baseAmountUsdCents * conversionRate) !== chargedAmountMinor) {
    reject()
  }

  return {
    schema: PAYPAL_PROVIDER_REQUEST_SCHEMA,
    operationId: requiredUuid(value.operationId),
    provider: "PAYPAL",
    providerIdempotencyKey,
    sponsorshipIntentId: requiredUuid(value.sponsorshipIntentId),
    paymentQuoteId: requiredUuid(value.paymentQuoteId),
    paymentAttemptId: PAYMENT_ATTEMPT_PLACEHOLDER,
    providerAccountScope: "paypal",
    customerEmail,
    productName: requiredString(value.productName, 1, 127),
    paymentMode: paymentMode as "one_time" | "recurring",
    recurrenceInterval: recurrenceInterval as "month" | "year" | null,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency: requiredCurrency(value.chargedCurrency),
    conversionRate,
    currencyQuoteAt: requiredIsoTimestamp(value.currencyQuoteAt),
    currencyRateSource: requiredString(value.currencyRateSource, 1, 120),
    checkoutBaseUrl: requiredBaseUrl(value.checkoutBaseUrl),
    paypalPlanId,
    providerRequestExpiresAt: requiredIsoTimestamp(
      value.providerRequestExpiresAt,
    ),
  }
}

function epochMicroseconds(timestamp: string): number {
  const microseconds = Date.parse(requiredIsoTimestamp(timestamp)) * 1000
  if (!Number.isSafeInteger(microseconds)) reject()
  return microseconds
}

function canonicalDigestHex(value: unknown): string {
  return sha256Digest(Buffer.from(canonicalJson(value), "utf8")).toString("hex")
}

export function createPayPalProviderRequestTemplate(
  input: PayPalProviderRequestTemplateInput,
): PayPalProviderRequestTemplate {
  return validateTemplate({
    schema: PAYPAL_PROVIDER_REQUEST_SCHEMA,
    ...input,
    provider: "PAYPAL",
    paymentAttemptId: PAYMENT_ATTEMPT_PLACEHOLDER,
  })
}

export function sealPayPalProviderRequest(
  templateInput: PayPalProviderRequestTemplate,
  crypto: SponsorshipCrypto,
): SealedPayPalProviderRequest {
  const template = validateTemplate(templateInput)
  const canonicalBytes = Buffer.from(canonicalJson(template), "utf8")
  try {
    const envelope = crypto.encryptSecretPayload(canonicalBytes)
    return {
      schemaVersion: PAYPAL_PROVIDER_REQUEST_SCHEMA_VERSION,
      fingerprint: toSupabaseRpcBytea(sha256Digest(canonicalBytes)),
      expiresAt: template.providerRequestExpiresAt,
      ciphertext: envelope.ciphertextRpcBytea,
      encryptionKeyVersion: envelope.encryptionKeyVersion,
      ciphertextSha256: toSupabaseRpcBytea(sha256Digest(envelope.ciphertext)),
    }
  } catch {
    reject()
  } finally {
    canonicalBytes.fill(0)
  }
}

export function buildPayPalProviderRequestTemplateClaims(
  templateInput: PayPalProviderRequestTemplate,
  sealed: SealedPayPalProviderRequest,
  emailDigest: VersionedEmailDigest,
): PayPalProviderRequestTemplateClaims {
  const template = validateTemplate(templateInput)
  const expectedFingerprint = toSupabaseRpcBytea(
    sha256Digest(Buffer.from(canonicalJson(template), "utf8")),
  )
  if (
    sealed.schemaVersion !== PAYPAL_PROVIDER_REQUEST_SCHEMA_VERSION ||
    sealed.expiresAt !== template.providerRequestExpiresAt ||
    !/^\\x[0-9a-f]{64}$/.test(sealed.fingerprint) ||
    sealed.fingerprint !== expectedFingerprint ||
    emailDigest.normalizedEmail !== template.customerEmail ||
    !/^\\x[0-9a-f]{64}$/.test(emailDigest.digestRpcBytea)
  ) {
    reject()
  }

  return {
    canonical_json_version: 1,
    provider: "PAYPAL",
    provider_account_scope: "paypal",
    checkout_operation_id: template.operationId,
    sponsorship_intent_id: template.sponsorshipIntentId,
    payment_quote_id: template.paymentQuoteId,
    payment_attempt_id_placeholder: PAYMENT_ATTEMPT_PLACEHOLDER,
    payment_attempt_id_placeholder_path: "/paymentAttemptId",
    unresolved_placeholder_count: 1,
    financial_terms: {
      payment_mode: template.paymentMode,
      recurrence_interval: template.recurrenceInterval,
      base_amount_usd_cents: template.baseAmountUsdCents,
      charged_amount_minor: template.chargedAmountMinor,
      charged_currency: template.chargedCurrency,
      conversion_rate: template.conversionRate,
      currency_quote_at_epoch_microseconds: epochMicroseconds(
        template.currencyQuoteAt,
      ),
    },
    sponsor_email_binding: {
      representation: "encrypted_in_template",
      normalization_version: emailDigest.normalizationVersion,
      hmac_key_version: emailDigest.hmacKeyVersion,
      hmac_sha256: emailDigest.digestRpcBytea.slice(2),
    },
    product_display_fields_sha256: canonicalDigestHex({
      paypal_plan_id: template.paypalPlanId,
      product_name: template.productName,
    }),
    return_urls_sha256: canonicalDigestHex({
      cancel_url: `${template.checkoutBaseUrl}/payments/failed?provider=paypal`,
      success_url: `${template.checkoutBaseUrl}/payments/success?provider=paypal`,
    }),
    provider_request_expires_at_epoch_microseconds: epochMicroseconds(
      template.providerRequestExpiresAt,
    ),
    canonical_template_sha256: sealed.fingerprint.slice(2),
  }
}

export function materializePayPalProviderRequest(
  templateInput: PayPalProviderRequestTemplate,
  paymentAttemptIdInput: string,
): MaterializedPayPalProviderRequest {
  const template = validateTemplate(templateInput)
  return {
    idempotencyKey: template.providerIdempotencyKey,
    customerEmail: template.customerEmail,
    productName: template.productName,
    sponsorshipIntentId: template.sponsorshipIntentId,
    paymentAttemptId: requiredUuid(paymentAttemptIdInput),
    providerAccountScope: "paypal",
    paymentMode: template.paymentMode,
    recurrenceInterval: template.recurrenceInterval,
    baseAmountUsdCents: template.baseAmountUsdCents,
    chargedAmountMinor: template.chargedAmountMinor,
    chargedCurrency: template.chargedCurrency,
    conversionRate: template.conversionRate,
    currencyQuoteAt: template.currencyQuoteAt,
    currencyRateSource: template.currencyRateSource,
    checkoutBaseUrl: template.checkoutBaseUrl,
    paypalPlanId: template.paypalPlanId,
    expiresAtUnixSeconds: Math.floor(
      Date.parse(template.providerRequestExpiresAt) / 1000,
    ),
  }
}

export function openSealedPayPalProviderRequest(
  input: OpenSealedPayPalProviderRequestInput,
  crypto: SponsorshipCrypto,
): MaterializedPayPalProviderRequest {
  if (
    input.schemaVersion !== PAYPAL_PROVIDER_REQUEST_SCHEMA_VERSION ||
    input.encryptionKeyVersion !== SPONSORSHIP_CRYPTO_KEY_VERSION
  ) {
    reject()
  }

  let ciphertext: Buffer
  let expectedCiphertextDigest: Buffer
  let expectedFingerprint: Buffer
  try {
    ciphertext = fromSupabaseRpcBytea(input.ciphertext)
    expectedCiphertextDigest = fromSupabaseRpcBytea(input.ciphertextSha256)
    expectedFingerprint = fromSupabaseRpcBytea(input.fingerprint)
  } catch {
    reject()
  }
  if (
    expectedCiphertextDigest.length !== 32 ||
    expectedFingerprint.length !== 32 ||
    !constantTimeDigestEqual(sha256Digest(ciphertext), expectedCiphertextDigest)
  ) {
    reject()
  }

  const plaintext = crypto.decryptSecretPayload(ciphertext)
  try {
    const canonical = new TextDecoder("utf-8", { fatal: true }).decode(
      plaintext,
    )
    const template = validateTemplate(JSON.parse(canonical) as unknown)
    const canonicalAgain = canonicalJson(template)
    const fingerprint = sha256Digest(Buffer.from(canonicalAgain, "utf8"))
    const hasExpectedClaims = input.expectedTemplateClaims !== undefined
    const hasExpectedEmailDigest = input.expectedEmailDigest !== undefined
    if (
      canonicalAgain !== canonical ||
      !constantTimeDigestEqual(fingerprint, expectedFingerprint) ||
      template.operationId !== requiredUuid(input.expectedOperationId) ||
      template.sponsorshipIntentId !==
        requiredUuid(input.expectedSponsorshipIntentId) ||
      template.paymentQuoteId !== requiredUuid(input.expectedPaymentQuoteId) ||
      template.providerAccountScope !== input.expectedProviderAccountScope ||
      template.providerIdempotencyKey !==
        input.expectedProviderIdempotencyKey ||
      hasExpectedClaims !== hasExpectedEmailDigest
    ) {
      reject()
    }

    if (input.expectedTemplateClaims && input.expectedEmailDigest) {
      const claims = buildPayPalProviderRequestTemplateClaims(
        template,
        {
          schemaVersion: PAYPAL_PROVIDER_REQUEST_SCHEMA_VERSION,
          fingerprint: input.fingerprint,
          expiresAt: template.providerRequestExpiresAt,
          ciphertext: input.ciphertext,
          encryptionKeyVersion: input.encryptionKeyVersion,
          ciphertextSha256: input.ciphertextSha256,
        },
        input.expectedEmailDigest,
      )
      if (
        canonicalJson(claims) !== canonicalJson(input.expectedTemplateClaims)
      ) {
        reject()
      }
    }

    return materializePayPalProviderRequest(
      template,
      input.expectedPaymentAttemptId,
    )
  } catch (error) {
    if (error instanceof PayPalProviderRequestError) throw error
    reject()
  } finally {
    plaintext.fill(0)
    ciphertext.fill(0)
    expectedCiphertextDigest.fill(0)
    expectedFingerprint.fill(0)
  }
}
