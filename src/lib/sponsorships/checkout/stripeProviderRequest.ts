import "server-only"

import type { StripeRegion } from "@/lib/stripe/config"
import { stripeCheckoutReturnUrls } from "@/lib/sponsorships/checkout/providerReturnUrls"
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

export const STRIPE_PROVIDER_REQUEST_SCHEMA_VERSION = 1 as const
export const STRIPE_PROVIDER_REQUEST_SCHEMA =
  "creator_share_stripe_checkout_request_v1" as const

const PAYMENT_ATTEMPT_PLACEHOLDER = {
  $creator_share: "server_payment_attempt_id",
  type: "uuid",
} as const
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PROVIDER_IDEMPOTENCY_KEY_PATTERN =
  /^[a-z0-9][a-z0-9_-]{2,63}:[0-9a-f-]{36}$/
const PROVIDER_SCOPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,119}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SUPPORTED_CURRENCIES = new Set<SupportedCurrency>([
  "USD",
  "AUD",
  "GBP",
  "EUR",
])
const MAXIMUM_AMOUNT_MINOR = 2_147_483_647

export interface StripeProviderRequestTemplateInput {
  operationId: string
  providerIdempotencyKey: string
  sponsorshipIntentId: string
  paymentQuoteId: string
  providerAccountScope: string
  customerEmail: string
  productName: string
  productImageUrl: string | null
  paymentMode: "one_time" | "recurring"
  recurrenceInterval: "month" | "year" | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  currencyQuoteAt: string
  currencyRateSource: string
  checkoutBaseUrl: string
  stripeRegion: StripeRegion
  providerRequestExpiresAt: string
}

export interface StripeProviderRequestTemplate extends StripeProviderRequestTemplateInput {
  schema: typeof STRIPE_PROVIDER_REQUEST_SCHEMA
  provider: "STRIPE"
  paymentAttemptId: typeof PAYMENT_ATTEMPT_PLACEHOLDER
}

export interface SealedStripeProviderRequest {
  schemaVersion: typeof STRIPE_PROVIDER_REQUEST_SCHEMA_VERSION
  fingerprint: SupabaseRpcBytea
  expiresAt: string
  ciphertext: SupabaseRpcBytea
  encryptionKeyVersion: number
  ciphertextSha256: SupabaseRpcBytea
}

export interface StripeProviderRequestTemplateClaims {
  canonical_json_version: 1
  provider: "STRIPE"
  provider_account_scope: string
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

export interface MaterializedStripeProviderRequest {
  idempotencyKey: string
  customerEmail: string
  productName: string
  productImageUrl: string | null
  sponsorshipIntentId: string
  paymentAttemptId: string
  providerAccountScope: string
  paymentMode: "one_time" | "recurring"
  recurrenceInterval: "month" | "year" | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  currencyRateSource: string
  currencyQuoteAt: string
  checkoutBaseUrl: string
  stripeRegion: StripeRegion
  expiresAtUnixSeconds: number
}

export interface OpenSealedStripeProviderRequestInput {
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
  expectedTemplateClaims?: StripeProviderRequestTemplateClaims
  expectedEmailDigest?: VersionedEmailDigest
}

export class StripeProviderRequestError extends Error {
  constructor() {
    super("Invalid sealed Stripe provider request")
    this.name = "StripeProviderRequestError"
  }
}

function reject(): never {
  throw new StripeProviderRequestError()
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
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${entries.join(",")}}`
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
    value.length > maximumLength
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

function requiredImageUrl(value: unknown): string | null {
  if (value === null) return null
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
    url.password !== ""
  ) {
    reject()
  }
  return url.toString()
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

function requiredRegion(value: unknown): StripeRegion {
  if (value !== "us" && value !== "uk") reject()
  return value
}

function validateTemplate(value: unknown): StripeProviderRequestTemplate {
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
      "productImageUrl",
      "paymentMode",
      "recurrenceInterval",
      "baseAmountUsdCents",
      "chargedAmountMinor",
      "chargedCurrency",
      "conversionRate",
      "currencyQuoteAt",
      "currencyRateSource",
      "checkoutBaseUrl",
      "stripeRegion",
      "providerRequestExpiresAt",
    ]) ||
    value.schema !== STRIPE_PROVIDER_REQUEST_SCHEMA ||
    value.provider !== "STRIPE" ||
    !isRecord(value.paymentAttemptId) ||
    !hasExactKeys(value.paymentAttemptId, ["$creator_share", "type"]) ||
    value.paymentAttemptId.$creator_share !==
      PAYMENT_ATTEMPT_PLACEHOLDER.$creator_share ||
    value.paymentAttemptId.type !== PAYMENT_ATTEMPT_PLACEHOLDER.type
  ) {
    reject()
  }

  const operationId = requiredUuid(value.operationId)
  const providerIdempotencyKey = requiredString(
    value.providerIdempotencyKey,
    16,
    255,
  )
  const providerAccountScope = requiredString(
    value.providerAccountScope,
    1,
    120,
  )
  if (
    !PROVIDER_IDEMPOTENCY_KEY_PATTERN.test(providerIdempotencyKey) ||
    !providerIdempotencyKey.endsWith(`:${operationId}`) ||
    !PROVIDER_SCOPE_PATTERN.test(providerAccountScope)
  ) {
    reject()
  }

  const paymentMode = value.paymentMode
  const recurrenceInterval = value.recurrenceInterval
  if (
    (paymentMode !== "one_time" && paymentMode !== "recurring") ||
    !(
      (paymentMode === "one_time" && recurrenceInterval === null) ||
      (paymentMode === "recurring" &&
        (recurrenceInterval === "month" || recurrenceInterval === "year"))
    )
  ) {
    reject()
  }

  const customerEmail = requiredString(value.customerEmail, 3, 254)
  if (normalizeSponsorEmailV1(customerEmail) !== customerEmail) reject()
  const stripeRegion = requiredRegion(value.stripeRegion)
  if (providerAccountScope !== `stripe_${stripeRegion}`) reject()

  const baseAmountUsdCents = requiredInteger(value.baseAmountUsdCents)
  const chargedAmountMinor = requiredInteger(value.chargedAmountMinor)
  const conversionRate = requiredConversionRate(value.conversionRate)
  if (Math.round(baseAmountUsdCents * conversionRate) !== chargedAmountMinor) {
    reject()
  }

  return {
    schema: STRIPE_PROVIDER_REQUEST_SCHEMA,
    operationId,
    provider: "STRIPE",
    providerIdempotencyKey,
    sponsorshipIntentId: requiredUuid(value.sponsorshipIntentId),
    paymentQuoteId: requiredUuid(value.paymentQuoteId),
    paymentAttemptId: PAYMENT_ATTEMPT_PLACEHOLDER,
    providerAccountScope,
    customerEmail,
    productName: requiredString(value.productName, 1, 200),
    productImageUrl: requiredImageUrl(value.productImageUrl),
    paymentMode,
    recurrenceInterval,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency: requiredCurrency(value.chargedCurrency),
    conversionRate,
    currencyQuoteAt: requiredIsoTimestamp(value.currencyQuoteAt),
    currencyRateSource: requiredString(value.currencyRateSource, 1, 120),
    checkoutBaseUrl: requiredBaseUrl(value.checkoutBaseUrl),
    stripeRegion,
    providerRequestExpiresAt: requiredIsoTimestamp(
      value.providerRequestExpiresAt,
    ),
  }
}

function epochMicroseconds(timestamp: string): number {
  const milliseconds = Date.parse(requiredIsoTimestamp(timestamp))
  const microseconds = milliseconds * 1000
  if (!Number.isSafeInteger(microseconds)) reject()
  return microseconds
}

function canonicalDigestHex(value: unknown): string {
  return sha256Digest(Buffer.from(canonicalJson(value), "utf8")).toString("hex")
}

export function buildStripeProviderRequestTemplateClaims(
  templateInput: StripeProviderRequestTemplate,
  sealed: SealedStripeProviderRequest,
  emailDigest: VersionedEmailDigest,
): StripeProviderRequestTemplateClaims {
  const template = validateTemplate(templateInput)
  const returnUrls = stripeCheckoutReturnUrls(template.checkoutBaseUrl)
  const expectedFingerprint = toSupabaseRpcBytea(
    sha256Digest(Buffer.from(canonicalJson(template), "utf8")),
  )
  if (
    sealed.schemaVersion !== STRIPE_PROVIDER_REQUEST_SCHEMA_VERSION ||
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
    provider: "STRIPE",
    provider_account_scope: template.providerAccountScope,
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
      product_image_url: template.productImageUrl,
      product_name: template.productName,
    }),
    return_urls_sha256: canonicalDigestHex({
      cancel_url: returnUrls.cancelUrl,
      success_url: returnUrls.successUrl,
    }),
    provider_request_expires_at_epoch_microseconds: epochMicroseconds(
      template.providerRequestExpiresAt,
    ),
    canonical_template_sha256: sealed.fingerprint.slice(2),
  }
}

export function createStripeProviderRequestTemplate(
  input: StripeProviderRequestTemplateInput,
): StripeProviderRequestTemplate {
  return validateTemplate({
    schema: STRIPE_PROVIDER_REQUEST_SCHEMA,
    ...input,
    provider: "STRIPE",
    paymentAttemptId: PAYMENT_ATTEMPT_PLACEHOLDER,
  })
}

export function sealStripeProviderRequest(
  templateInput: StripeProviderRequestTemplate,
  crypto: SponsorshipCrypto,
): SealedStripeProviderRequest {
  const template = validateTemplate(templateInput)
  const canonical = canonicalJson(template)
  const canonicalBytes = Buffer.from(canonical, "utf8")
  try {
    const fingerprint = sha256Digest(canonicalBytes)
    const envelope = crypto.encryptSecretPayload(canonicalBytes)
    return {
      schemaVersion: STRIPE_PROVIDER_REQUEST_SCHEMA_VERSION,
      fingerprint: toSupabaseRpcBytea(fingerprint),
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

export function materializeStripeProviderRequest(
  templateInput: StripeProviderRequestTemplate,
  paymentAttemptIdInput: string,
): MaterializedStripeProviderRequest {
  const template = validateTemplate(templateInput)
  const paymentAttemptId = requiredUuid(paymentAttemptIdInput)
  return {
    idempotencyKey: template.providerIdempotencyKey,
    customerEmail: template.customerEmail,
    productName: template.productName,
    productImageUrl: template.productImageUrl,
    sponsorshipIntentId: template.sponsorshipIntentId,
    paymentAttemptId,
    providerAccountScope: template.providerAccountScope,
    paymentMode: template.paymentMode,
    recurrenceInterval: template.recurrenceInterval,
    baseAmountUsdCents: template.baseAmountUsdCents,
    chargedAmountMinor: template.chargedAmountMinor,
    chargedCurrency: template.chargedCurrency,
    conversionRate: template.conversionRate,
    currencyQuoteAt: template.currencyQuoteAt,
    currencyRateSource: template.currencyRateSource,
    checkoutBaseUrl: template.checkoutBaseUrl,
    stripeRegion: template.stripeRegion,
    expiresAtUnixSeconds: Math.floor(
      Date.parse(template.providerRequestExpiresAt) / 1000,
    ),
  }
}

export function openSealedStripeProviderRequest(
  input: OpenSealedStripeProviderRequestInput,
  crypto: SponsorshipCrypto,
): MaterializedStripeProviderRequest {
  if (
    input.schemaVersion !== STRIPE_PROVIDER_REQUEST_SCHEMA_VERSION ||
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
    const parsed = JSON.parse(canonical) as unknown
    const template = validateTemplate(parsed)
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
      const actualClaims = buildStripeProviderRequestTemplateClaims(
        template,
        {
          schemaVersion: input.schemaVersion,
          fingerprint: input.fingerprint,
          expiresAt: template.providerRequestExpiresAt,
          ciphertext: input.ciphertext,
          encryptionKeyVersion: input.encryptionKeyVersion,
          ciphertextSha256: input.ciphertextSha256,
        },
        input.expectedEmailDigest,
      )
      if (
        canonicalJson(actualClaims) !==
        canonicalJson(input.expectedTemplateClaims)
      ) {
        reject()
      }
    }
    return materializeStripeProviderRequest(
      template,
      input.expectedPaymentAttemptId,
    )
  } catch (error) {
    if (error instanceof StripeProviderRequestError) throw error
    reject()
  } finally {
    plaintext.fill(0)
    ciphertext.fill(0)
    expectedCiphertextDigest.fill(0)
    expectedFingerprint.fill(0)
  }
}
