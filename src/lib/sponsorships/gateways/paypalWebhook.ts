import "server-only"

import type {
  SponsorshipCrypto,
  SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import { sha256Digest, toSupabaseRpcBytea } from "@/lib/sponsorships/crypto"
import type { SupportedCurrency } from "@/utils/currency"

export const MAXIMUM_PAYPAL_WEBHOOK_BYTES = 64 * 1024
const MAXIMUM_VERIFICATION_RESPONSE_BYTES = 16 * 1024
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PAYPAL_EVENT_ID_PATTERN = /^WH-[A-Z0-9-]{8,252}$/
const PAYPAL_ORDER_ID_PATTERN = /^[A-Z0-9]{17}$/
const PAYPAL_SUBSCRIPTION_ID_PATTERN = /^I-[A-Z0-9]{10,32}$/
const PAYPAL_MOVEMENT_ID_PATTERN = /^[A-Z0-9]{10,64}$/
const PAYPAL_PLAN_ID_PATTERN = /^P-[A-Z0-9]{24}$/
const PAYPAL_CUSTOMER_ID_PATTERN = /^[A-Z0-9]{5,64}$/
const PAYPAL_DISPUTE_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{4,127}$/
const SUPPORTED_CURRENCIES = new Set<SupportedCurrency>([
  "USD",
  "AUD",
  "GBP",
  "EUR",
])
const SUPPORTED_PAYMENT_EVENT_TYPES = new Set([
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.DENIED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
])
const SUPPORTED_ADJUSTMENT_EVENT_TYPES = new Set([
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.RESOLVED",
])
const SUPPORTED_DISPUTE_EVENT_TYPES = new Set([
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
])
const PAYPAL_SELLER_DISPUTE_OUTCOMES = new Set([
  "RESOLVED_SELLER_FAVOR",
  "RESOLVED_SELLER_FAVOUR",
  "RESOLVED_WITH_PAYOUT",
  "CANCELED_BY_BUYER",
  "DENIED",
])

export type PayPalWebhookErrorCode =
  | "invalid-header"
  | "invalid-payload"
  | "payload-too-large"
  | "verification-failed"
  | "unsupported-event"
  | "invalid-custom-id"
  | "boundary-mismatch"
  | "provider-fact-mismatch"
  | "provider-chain-unavailable"
  | "infrastructure"

export class PayPalWebhookError extends Error {
  readonly code: PayPalWebhookErrorCode
  readonly retryable: boolean
  readonly httpStatus: number

  constructor(
    code: PayPalWebhookErrorCode,
    options: { retryable?: boolean; httpStatus?: number } = {},
  ) {
    super(
      options.retryable
        ? "PayPal webhook ingestion is temporarily unavailable"
        : "PayPal webhook evidence was rejected",
    )
    this.name = "PayPalWebhookError"
    this.code = code
    this.retryable = options.retryable === true
    this.httpStatus = options.httpStatus ?? (this.retryable ? 503 : 400)
  }
}

export interface PayPalWebhookHeaders {
  transmissionId: string
  transmissionTime: string
  transmissionSignature: string
  certificateUrl: string
  authenticationAlgorithm: string
}

export interface PayPalWebhookRequestContext {
  requestId: string
  traceId: string | null
  clientIp: string | null
  userAgent: string | null
  headers: PayPalWebhookHeaders
  verificationResponseSha256: string
}

export interface PayPalWebhookEvent {
  id: string
  eventType: string
  createTime: string
  resourceType: string
  resource: Record<string, unknown>
  raw: Record<string, unknown>
}

export interface PayPalVerificationResult {
  verified: boolean
  responseSha256: string
}

export interface AuthoritativePayPalPaymentBoundary {
  attemptId: string
  intentId: string
  provider: "PAYPAL"
  providerAccountScope: "paypal"
  attemptStatus: string
  paymentMode: "one_time" | "recurring"
  recurrenceInterval: "month" | "year" | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  providerObjectType: "order" | "billing_subscription"
  providerObjectId: string
  providerCustomerId: string | null
  providerSubscriptionObjectType: "billing_subscription" | null
  providerSubscriptionId: string | null
  expectedProviderPlanId: string | null
  intentPaymentMode: "one_time" | "recurring"
  intentRecurrenceInterval: "month" | "year" | null
  intentBaseAmountUsdCents: number
  intentChargedAmountMinor: number
  intentChargedCurrency: SupportedCurrency
  intentConversionRate: number
}

export interface AuthoritativePayPalFinancialMovement {
  id: string
  paymentAttemptId: string
  sponsorshipIntentId: string
  provider: "PAYPAL"
  providerAccountScope: "paypal"
  providerMovementType: "capture" | "sale"
  providerMovementId: string
  entryKind: "sponsorship_payment"
  originalFinancialMovementId: null
  paymentMode: "one_time" | "recurring"
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  occurredAt: string
}

export interface VerifiedPayPalGatewayEventInput {
  paymentAttemptId: string
  providerAccountScope: "paypal"
  providerEventId: string
  eventType: string
  providerObjectType: "capture" | "sale" | "billing_subscription"
  providerObjectId: string
  redactedPayload: Record<string, unknown>
  payloadCiphertext: SupabaseRpcBytea
  payloadSha256: SupabaseRpcBytea
  signatureVerifiedAt: string
  occurredAt: string
  verificationMethod: "paypal_webhook_signature_api"
  factPaymentStatus: string | null
  factServerPaymentAttemptId: string
  factParentProviderObjectType: string | null
  factParentProviderObjectId: string | null
  factProviderMovementType: string | null
  factProviderMovementId: string | null
  factProviderCustomerId: string | null
  factProviderSubscriptionId: string | null
  factBaseAmountUsdCents: number | null
  factChargedAmountMinor: number | null
  factChargedCurrency: SupportedCurrency | null
  factConversionRate: number | null
  factPeriodStart: string | null
  factPeriodEnd: string | null
  factFailureCode: string | null
  factLifecycleState: string | null
  requestContext: PayPalWebhookRequestContext
}

export interface VerifiedPayPalGatewayEventResult {
  gatewayEventId: string
  sponsorshipIntentId: string
  paymentAttemptId: string
  processingStatus: string
  isDuplicate: boolean
}

export interface VerifiedPayPalQuarantineInput {
  providerAccountScope: "paypal"
  providerEventId: string
  eventType: string
  providerObjectType: string | null
  providerObjectId: string | null
  redactedPayload: Record<string, unknown>
  payloadCiphertext: SupabaseRpcBytea
  payloadSha256: SupabaseRpcBytea
  signatureVerifiedAt: string
  occurredAt: string
  verificationMethod: "paypal_webhook_signature_api"
  errorCode: PayPalWebhookErrorCode
  reason: string
  requestContext: PayPalWebhookRequestContext
}

export interface VerifiedPayPalQuarantineResult {
  gatewayEventId: string
  processingStatus: string
  isDuplicate: boolean
}

export interface VerifiedPayPalFinancialAdjustmentInput {
  originalFinancialMovementId: string
  providerAccountScope: "paypal"
  providerEventId: string
  eventType: string
  providerObjectType: "capture" | "sale"
  providerObjectId: string
  adjustmentProviderMovementType: "refund" | "reversal" | "dispute"
  adjustmentProviderMovementId: string
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  redactedPayload: Record<string, unknown>
  payloadCiphertext: SupabaseRpcBytea
  payloadSha256: SupabaseRpcBytea
  signatureVerifiedAt: string
  occurredAt: string
  verificationMethod: "paypal_webhook_signature_api"
  requestContext: PayPalWebhookRequestContext
}

export interface VerifiedPayPalFinancialAdjustmentResult {
  gatewayEventId: string
  originalFinancialMovementId: string
  paymentAttemptId: string
  sponsorshipIntentId: string
  processingStatus: string
  adjustmentKind: string
  isDuplicate: boolean
}

export interface VerifiedPayPalNoEffectInput {
  providerAccountScope: "paypal"
  providerEventId: string
  eventType: "CUSTOMER.DISPUTE.UPDATED" | "CUSTOMER.DISPUTE.RESOLVED"
  providerObjectType: "dispute"
  providerObjectId: string
  providerState: string
  redactedPayload: Record<string, unknown>
  payloadCiphertext: SupabaseRpcBytea
  payloadSha256: SupabaseRpcBytea
  signatureVerifiedAt: string
  occurredAt: string
  verificationMethod: "paypal_webhook_signature_api"
  requestContext: PayPalWebhookRequestContext
}

export interface VerifiedPayPalNoEffectResult {
  gatewayEventId: string
  processingStatus: string
  isDuplicate: boolean
}

export interface PayPalWebhookDependencies {
  crypto: SponsorshipCrypto
  verifyWebhookSignature(requestBody: string): Promise<{
    ok: boolean
    status: number
    body: string
  }>
  retrieveOrder(id: string): Promise<unknown>
  retrieveSubscription(id: string): Promise<unknown>
  loadPaymentBoundary(
    paymentAttemptId: string,
  ): Promise<AuthoritativePayPalPaymentBoundary>
  loadOriginalMovement(input: {
    providerMovementType: "capture" | "sale" | null
    providerMovementId: string
  }): Promise<AuthoritativePayPalFinancialMovement>
  ingestVerifiedEvent(
    input: VerifiedPayPalGatewayEventInput,
  ): Promise<VerifiedPayPalGatewayEventResult>
  quarantineVerifiedEvent(
    input: VerifiedPayPalQuarantineInput,
  ): Promise<VerifiedPayPalQuarantineResult>
  ingestVerifiedAdjustment(
    input: VerifiedPayPalFinancialAdjustmentInput,
  ): Promise<VerifiedPayPalFinancialAdjustmentResult>
  ingestVerifiedNoEffect(
    input: VerifiedPayPalNoEffectInput,
  ): Promise<VerifiedPayPalNoEffectResult>
  now(): Date
}

export type IngestedPayPalWebhookResult =
  | ({ kind: "payment" } & VerifiedPayPalGatewayEventResult)
  | ({ kind: "adjustment" } & VerifiedPayPalFinancialAdjustmentResult)
  | ({ kind: "no_effect" } & VerifiedPayPalNoEffectResult)

function reject(
  code: Exclude<
    PayPalWebhookErrorCode,
    "infrastructure" | "provider-chain-unavailable"
  >,
  httpStatus?: number,
): never {
  throw new PayPalWebhookError(code, { httpStatus })
}

function infrastructure(
  code: "infrastructure" | "provider-chain-unavailable" = "infrastructure",
): PayPalWebhookError {
  return new PayPalWebhookError(code, { retryable: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requiredString(
  value: unknown,
  maximumLength: number,
  code: "invalid-payload" | "provider-fact-mismatch" = "provider-fact-mismatch",
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    reject(code)
  }
  return value
}

function requiredUuid(
  value: unknown,
  code: "invalid-custom-id" | "boundary-mismatch",
): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) reject(code)
  return value.toLowerCase()
}

function requiredPayPalId(
  value: unknown,
  pattern: RegExp,
  code: "invalid-payload" | "provider-fact-mismatch" = "provider-fact-mismatch",
): string {
  const id = requiredString(value, 255, code)
  if (!pattern.test(id)) reject(code)
  return id
}

function requiredTimestamp(
  value: unknown,
  code: "invalid-payload" | "provider-fact-mismatch" = "provider-fact-mismatch",
): string {
  const timestamp = requiredString(value, 64, code)
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime())) reject(code)
  return parsed.toISOString()
}

function requiredCurrency(value: unknown): SupportedCurrency {
  if (
    typeof value !== "string" ||
    !SUPPORTED_CURRENCIES.has(value.toUpperCase() as SupportedCurrency)
  ) {
    reject("provider-fact-mismatch")
  }
  return value.toUpperCase() as SupportedCurrency
}

function moneyAmountMinor(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(value)) {
    reject("provider-fact-mismatch")
  }
  const [major, fraction] = value.split(".")
  const parsed = Number(major) * 100 + Number(fraction)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    reject("provider-fact-mismatch")
  }
  return parsed
}

function money(value: unknown): {
  amountMinor: number
  currency: SupportedCurrency
} {
  if (!isRecord(value)) reject("provider-fact-mismatch")
  const amountValue = value.value ?? value.total
  const currencyValue = value.currency_code ?? value.currency
  return {
    amountMinor: moneyAmountMinor(amountValue),
    currency: requiredCurrency(currencyValue),
  }
}

function boundedRequestHeader(
  headers: Headers,
  name: string,
  maximumLength: number,
  pattern: RegExp,
): string {
  const value = headers.get(name)
  if (
    !value ||
    value !== value.trim() ||
    value.length > maximumLength ||
    /[\r\n\0]/.test(value) ||
    !pattern.test(value)
  ) {
    reject("invalid-header")
  }
  return value
}

function expectedPayPalEnvironment(apiUrl: string): "live" | "sandbox" {
  let parsed: URL
  try {
    parsed = new URL(apiUrl)
  } catch {
    throw infrastructure()
  }
  if (parsed.origin === "https://api-m.paypal.com") return "live"
  if (parsed.origin === "https://api-m.sandbox.paypal.com") return "sandbox"
  throw infrastructure()
}

function validatedCertificateUrl(headers: Headers, apiUrl: string): string {
  const raw = boundedRequestHeader(
    headers,
    "paypal-cert-url",
    2048,
    /^https:\/\/[A-Za-z0-9./_-]+$/,
  )
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    reject("invalid-header")
  }
  const environment = expectedPayPalEnvironment(apiUrl)
  const allowedHosts =
    environment === "live"
      ? new Set(["api.paypal.com", "api-m.paypal.com"])
      : new Set(["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"])
  if (
    parsed.protocol !== "https:" ||
    !allowedHosts.has(parsed.hostname) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/v1\/notifications\/certs\/[A-Za-z0-9_-]{1,255}$/.test(parsed.pathname)
  ) {
    reject("invalid-header")
  }
  return parsed.toString()
}

export function parsePayPalWebhookHeaders(
  headers: Headers,
  apiUrl: string,
): PayPalWebhookHeaders {
  const transmissionTime = boundedRequestHeader(
    headers,
    "paypal-transmission-time",
    64,
    /^[0-9T:.+Z-]+$/,
  )
  if (!Number.isFinite(Date.parse(transmissionTime))) reject("invalid-header")

  return {
    transmissionId: boundedRequestHeader(
      headers,
      "paypal-transmission-id",
      128,
      /^[A-Za-z0-9-]+$/,
    ),
    transmissionTime,
    transmissionSignature: boundedRequestHeader(
      headers,
      "paypal-transmission-sig",
      4096,
      /^[A-Za-z0-9+/=_-]+$/,
    ),
    certificateUrl: validatedCertificateUrl(headers, apiUrl),
    authenticationAlgorithm: boundedRequestHeader(
      headers,
      "paypal-auth-algo",
      64,
      /^[A-Za-z0-9_-]+$/,
    ),
  }
}

export function validatePayPalWebhookId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !/^[A-Z0-9]{8,64}$/.test(value)
  ) {
    throw infrastructure()
  }
  return value
}

/**
 * The exact webhook JSON is embedded without parsing and reserialization.
 * PayPal documents that even formatting changes can invalidate verification.
 */
export function buildPayPalSignatureVerificationBody(
  rawBody: string,
  headers: PayPalWebhookHeaders,
  configuredWebhookId: string,
): string {
  if (
    typeof rawBody !== "string" ||
    Buffer.byteLength(rawBody, "utf8") < 1 ||
    Buffer.byteLength(rawBody, "utf8") > MAXIMUM_PAYPAL_WEBHOOK_BYTES
  ) {
    reject("invalid-payload")
  }
  try {
    const parsed = JSON.parse(rawBody) as unknown
    if (!isRecord(parsed)) reject("invalid-payload")
  } catch (error) {
    if (error instanceof PayPalWebhookError) throw error
    reject("invalid-payload")
  }
  const webhookId = validatePayPalWebhookId(configuredWebhookId)
  const field = (name: string, value: string) =>
    `${JSON.stringify(name)}:${JSON.stringify(value)}`
  return `{${[
    field("auth_algo", headers.authenticationAlgorithm),
    field("cert_url", headers.certificateUrl),
    field("transmission_id", headers.transmissionId),
    field("transmission_sig", headers.transmissionSignature),
    field("transmission_time", headers.transmissionTime),
    field("webhook_id", webhookId),
    `${JSON.stringify("webhook_event")}:${rawBody}`,
  ].join(",")}}`
}

export async function readBoundedPayPalWebhookPayload(
  request: Request,
): Promise<string> {
  const declaredLength = request.headers.get("content-length")
  if (declaredLength !== null) {
    if (!/^[0-9]+$/.test(declaredLength)) reject("invalid-payload")
    const parsed = Number(declaredLength)
    if (!Number.isSafeInteger(parsed)) reject("invalid-payload")
    if (parsed > MAXIMUM_PAYPAL_WEBHOOK_BYTES) reject("payload-too-large", 413)
  }
  if (!request.body) reject("invalid-payload")

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw infrastructure()
      total += value.byteLength
      if (total > MAXIMUM_PAYPAL_WEBHOOK_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // The bounded rejection remains authoritative.
        }
        reject("payload-too-large", 413)
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (error instanceof PayPalWebhookError) throw error
    throw infrastructure()
  } finally {
    reader.releaseLock()
  }
  if (total < 1) reject("invalid-payload")

  const bytes = Buffer.concat(chunks, total)
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new PayPalWebhookError("invalid-payload")
  } finally {
    bytes.fill(0)
    for (const chunk of chunks) chunk.fill(0)
  }
  return decoded
}

export function parsePayPalWebhookEvent(rawBody: string): PayPalWebhookEvent {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody) as unknown
  } catch {
    reject("invalid-payload")
  }
  if (!isRecord(parsed) || !isRecord(parsed.resource)) {
    reject("invalid-payload")
  }
  const id = requiredPayPalId(
    parsed.id,
    PAYPAL_EVENT_ID_PATTERN,
    "invalid-payload",
  )
  const eventType = requiredString(parsed.event_type, 200, "invalid-payload")
  if (!/^[A-Z][A-Z0-9._-]+$/.test(eventType)) reject("invalid-payload")
  const resourceType = requiredString(
    parsed.resource_type,
    80,
    "invalid-payload",
  ).toLowerCase()
  if (!/^[a-z][a-z0-9_]*$/.test(resourceType)) reject("invalid-payload")
  return {
    id,
    eventType,
    createTime: requiredTimestamp(parsed.create_time, "invalid-payload"),
    resourceType,
    resource: parsed.resource,
    raw: parsed,
  }
}

export async function verifyPayPalWebhookSignature(
  input: {
    rawBody: string
    headers: PayPalWebhookHeaders
    configuredWebhookId: string
  },
  dependencies: Pick<PayPalWebhookDependencies, "verifyWebhookSignature">,
): Promise<PayPalVerificationResult> {
  const requestBody = buildPayPalSignatureVerificationBody(
    input.rawBody,
    input.headers,
    input.configuredWebhookId,
  )
  let response: { ok: boolean; status: number; body: string }
  try {
    response = await dependencies.verifyWebhookSignature(requestBody)
  } catch {
    throw infrastructure()
  }
  if (
    typeof response.body !== "string" ||
    Buffer.byteLength(response.body, "utf8") >
      MAXIMUM_VERIFICATION_RESPONSE_BYTES
  ) {
    throw infrastructure()
  }
  if (!response.ok) throw infrastructure()

  let parsed: unknown
  try {
    parsed = JSON.parse(response.body) as unknown
  } catch {
    throw infrastructure()
  }
  if (
    !isRecord(parsed) ||
    (parsed.verification_status !== "SUCCESS" &&
      parsed.verification_status !== "FAILURE")
  ) {
    throw infrastructure()
  }
  return {
    verified: parsed.verification_status === "SUCCESS",
    responseSha256: sha256Digest(Buffer.from(response.body, "utf8")).toString(
      "hex",
    ),
  }
}

function canonicalJson(value: unknown): string | undefined {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("invalid-payload")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item) ?? "null").join(",")}]`
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, item]) => {
        const encoded = canonicalJson(item)
        return encoded === undefined
          ? []
          : [`${JSON.stringify(key)}:${encoded}`]
      })
    return `{${entries.join(",")}}`
  }
  if (value === undefined) return undefined
  reject("invalid-payload")
}

export function paypalEventImmutableDigest(event: PayPalWebhookEvent): Buffer {
  const canonical = canonicalJson({
    create_time: event.createTime,
    event_type: event.eventType,
    id: event.id,
    resource: event.resource,
    resource_type: event.resourceType,
  })
  if (!canonical) reject("invalid-payload")
  return sha256Digest(Buffer.from(canonical, "utf8"))
}

function encryptedPayload(
  payloadToEncrypt: string,
  event: PayPalWebhookEvent,
  crypto: SponsorshipCrypto,
  deliveryPayload: string = payloadToEncrypt,
): {
  ciphertext: SupabaseRpcBytea
  immutableSha256: SupabaseRpcBytea
  deliverySha256: string
} {
  const bytes = Buffer.from(payloadToEncrypt, "utf8")
  const deliveryBytes = Buffer.from(deliveryPayload, "utf8")
  if (
    bytes.length < 1 ||
    bytes.length > MAXIMUM_PAYPAL_WEBHOOK_BYTES ||
    deliveryBytes.length < 1 ||
    deliveryBytes.length > MAXIMUM_PAYPAL_WEBHOOK_BYTES
  ) {
    reject("payload-too-large", 413)
  }
  try {
    const envelope = crypto.encryptSecretPayload(bytes)
    return {
      ciphertext: envelope.ciphertextRpcBytea,
      immutableSha256: toSupabaseRpcBytea(paypalEventImmutableDigest(event)),
      deliverySha256: sha256Digest(deliveryBytes).toString("hex"),
    }
  } catch {
    throw infrastructure()
  } finally {
    bytes.fill(0)
    deliveryBytes.fill(0)
  }
}

function minimizedUnsupportedEvidence(event: PayPalWebhookEvent): string {
  const identity = quarantineIdentity(event)
  const canonical = canonicalJson({
    evidence_version: "paypal_unsupported_v1",
    provider: "PAYPAL",
    provider_event_id: event.id,
    event_type: event.eventType,
    resource_type: event.resourceType,
    provider_object_type: identity.providerObjectType,
    provider_object_id: identity.providerObjectId,
    immutable_event_sha256: paypalEventImmutableDigest(event).toString("hex"),
  })
  if (!canonical) reject("invalid-payload")
  return canonical
}

function fixedRedactedPayload(
  event: PayPalWebhookEvent,
  objectType: string | null,
  encrypted: { deliverySha256: string },
  requestContext: PayPalWebhookRequestContext,
): Record<string, unknown> {
  return {
    redaction_version: "paypal_server_intent_v1",
    provider: "PAYPAL",
    source: "verified_webhook",
    event_type: event.eventType,
    provider_object_type: objectType,
    delivery_payload_sha256: encrypted.deliverySha256,
    paypal_transmission_id: requestContext.headers.transmissionId,
    paypal_transmission_time: requestContext.headers.transmissionTime,
    paypal_transmission_signature: requestContext.headers.transmissionSignature,
    paypal_cert_url: requestContext.headers.certificateUrl,
    paypal_auth_algorithm: requestContext.headers.authenticationAlgorithm,
    paypal_verification_response_sha256:
      requestContext.verificationResponseSha256,
  }
}

function validateBoundary(
  boundary: AuthoritativePayPalPaymentBoundary,
  attemptId: string,
): void {
  const validCommon =
    requiredUuid(boundary.attemptId, "boundary-mismatch") === attemptId &&
    UUID_PATTERN.test(boundary.intentId) &&
    boundary.provider === "PAYPAL" &&
    boundary.providerAccountScope === "paypal" &&
    boundary.intentPaymentMode === boundary.paymentMode &&
    boundary.intentRecurrenceInterval === boundary.recurrenceInterval &&
    boundary.intentBaseAmountUsdCents === boundary.baseAmountUsdCents &&
    boundary.intentChargedAmountMinor === boundary.chargedAmountMinor &&
    boundary.intentChargedCurrency === boundary.chargedCurrency &&
    boundary.intentConversionRate === boundary.conversionRate &&
    Number.isSafeInteger(boundary.baseAmountUsdCents) &&
    boundary.baseAmountUsdCents > 0 &&
    Number.isSafeInteger(boundary.chargedAmountMinor) &&
    boundary.chargedAmountMinor > 0 &&
    SUPPORTED_CURRENCIES.has(boundary.chargedCurrency) &&
    Number.isFinite(boundary.conversionRate) &&
    boundary.conversionRate > 0 &&
    Math.round(boundary.baseAmountUsdCents * boundary.conversionRate) ===
      boundary.chargedAmountMinor
  if (!validCommon) reject("boundary-mismatch")

  if (boundary.paymentMode === "one_time") {
    if (
      boundary.recurrenceInterval !== null ||
      boundary.providerObjectType !== "order" ||
      !PAYPAL_ORDER_ID_PATTERN.test(boundary.providerObjectId) ||
      boundary.providerSubscriptionObjectType !== null ||
      boundary.providerSubscriptionId !== null ||
      boundary.expectedProviderPlanId !== null
    ) {
      reject("boundary-mismatch")
    }
    return
  }

  if (
    (boundary.recurrenceInterval !== "month" &&
      boundary.recurrenceInterval !== "year") ||
    boundary.providerObjectType !== "billing_subscription" ||
    !PAYPAL_SUBSCRIPTION_ID_PATTERN.test(boundary.providerObjectId) ||
    boundary.expectedProviderPlanId === null ||
    !PAYPAL_PLAN_ID_PATTERN.test(boundary.expectedProviderPlanId) ||
    (boundary.providerSubscriptionObjectType !== null &&
      boundary.providerSubscriptionObjectType !== "billing_subscription") ||
    (boundary.providerSubscriptionId !== null &&
      boundary.providerSubscriptionId !== boundary.providerObjectId)
  ) {
    reject("boundary-mismatch")
  }
}

function assertExactAmount(
  boundary: AuthoritativePayPalPaymentBoundary,
  actual: { amountMinor: number; currency: SupportedCurrency },
): void {
  if (
    actual.amountMinor !== boundary.chargedAmountMinor ||
    actual.currency !== boundary.chargedCurrency
  ) {
    reject("provider-fact-mismatch")
  }
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key]
  return isRecord(nested) ? nested : null
}

function signedOrderId(resource: Record<string, unknown>): string {
  const relatedIds = nestedRecord(
    nestedRecord(resource, "supplementary_data") ?? {},
    "related_ids",
  )
  return requiredPayPalId(
    relatedIds?.order_id ?? resource.order_id,
    PAYPAL_ORDER_ID_PATTERN,
  )
}

function signedSubscriptionId(resource: Record<string, unknown>): string {
  const relatedIds = nestedRecord(
    nestedRecord(resource, "supplementary_data") ?? {},
    "related_ids",
  )
  return requiredPayPalId(
    resource.billing_agreement_id ??
      resource.subscription_id ??
      relatedIds?.subscription_id,
    PAYPAL_SUBSCRIPTION_ID_PATTERN,
  )
}

interface SupplementedOrder {
  id: string
  customId: string
  intentId: string
  amount: { amountMinor: number; currency: SupportedCurrency }
}

function parseOrderSupplement(
  value: unknown,
  expectedOrderId: string,
): SupplementedOrder {
  if (
    !isRecord(value) ||
    value.id !== expectedOrderId ||
    value.intent !== "CAPTURE" ||
    !Array.isArray(value.purchase_units) ||
    value.purchase_units.length !== 1 ||
    !isRecord(value.purchase_units[0])
  ) {
    reject("provider-fact-mismatch")
  }
  const unit = value.purchase_units[0]
  return {
    id: expectedOrderId,
    customId: requiredUuid(unit.custom_id, "invalid-custom-id"),
    intentId: requiredUuid(unit.reference_id, "boundary-mismatch"),
    amount: money(unit.amount),
  }
}

interface SupplementedSubscription {
  id: string
  customId: string
  status: string
  planId: string
  customerId: string
  nextBillingTime: string | null
}

function parseSubscriptionSupplement(
  value: unknown,
  expectedSubscriptionId: string,
): SupplementedSubscription {
  if (!isRecord(value) || value.id !== expectedSubscriptionId) {
    reject("provider-fact-mismatch")
  }
  const subscriber = nestedRecord(value, "subscriber")
  const billingInfo = nestedRecord(value, "billing_info")
  return {
    id: expectedSubscriptionId,
    customId: requiredUuid(value.custom_id, "invalid-custom-id"),
    status: requiredString(value.status, 40),
    planId: requiredPayPalId(value.plan_id, PAYPAL_PLAN_ID_PATTERN),
    customerId: requiredPayPalId(
      subscriber?.payer_id,
      PAYPAL_CUSTOMER_ID_PATTERN,
    ),
    nextBillingTime:
      billingInfo?.next_billing_time === undefined ||
      billingInfo.next_billing_time === null
        ? null
        : requiredTimestamp(billingInfo.next_billing_time),
  }
}

async function withProviderLookup<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback()
  } catch (error) {
    if (error instanceof PayPalWebhookError) throw error
    throw infrastructure("provider-chain-unavailable")
  }
}

async function resolveCaptureAttempt(
  resource: Record<string, unknown>,
  dependencies: PayPalWebhookDependencies,
): Promise<{
  attemptId: string
  orderId: string
  order: SupplementedOrder | null
}> {
  const orderId = signedOrderId(resource)
  if (resource.custom_id !== undefined && resource.custom_id !== null) {
    return {
      attemptId: requiredUuid(resource.custom_id, "invalid-custom-id"),
      orderId,
      order: null,
    }
  }
  const order = await withProviderLookup(async () =>
    parseOrderSupplement(await dependencies.retrieveOrder(orderId), orderId),
  )
  return { attemptId: order.customId, orderId, order }
}

async function resolveSubscriptionAttempt(
  resource: Record<string, unknown>,
  subscriptionId: string,
  dependencies: PayPalWebhookDependencies,
): Promise<{
  attemptId: string
  subscription: SupplementedSubscription | null
}> {
  if (resource.custom_id !== undefined && resource.custom_id !== null) {
    return {
      attemptId: requiredUuid(resource.custom_id, "invalid-custom-id"),
      subscription: null,
    }
  }
  const subscription = await withProviderLookup(async () =>
    parseSubscriptionSupplement(
      await dependencies.retrieveSubscription(subscriptionId),
      subscriptionId,
    ),
  )
  return { attemptId: subscription.customId, subscription }
}

interface TypedPaymentFacts {
  providerObjectType: "capture" | "sale" | "billing_subscription"
  providerObjectId: string
  factPaymentStatus: string | null
  factParentProviderObjectType: string | null
  factParentProviderObjectId: string | null
  factProviderMovementType: string | null
  factProviderMovementId: string | null
  factProviderCustomerId: string | null
  factProviderSubscriptionId: string | null
  factBaseAmountUsdCents: number | null
  factChargedAmountMinor: number | null
  factChargedCurrency: SupportedCurrency | null
  factConversionRate: number | null
  factPeriodStart: string | null
  factPeriodEnd: string | null
  factFailureCode: string | null
  factLifecycleState: string | null
}

function baseFacts(
  type: TypedPaymentFacts["providerObjectType"],
  id: string,
): TypedPaymentFacts {
  return {
    providerObjectType: type,
    providerObjectId: id,
    factPaymentStatus: null,
    factParentProviderObjectType: null,
    factParentProviderObjectId: null,
    factProviderMovementType: null,
    factProviderMovementId: null,
    factProviderCustomerId: null,
    factProviderSubscriptionId: null,
    factBaseAmountUsdCents: null,
    factChargedAmountMinor: null,
    factChargedCurrency: null,
    factConversionRate: null,
    factPeriodStart: null,
    factPeriodEnd: null,
    factFailureCode: null,
    factLifecycleState: null,
  }
}

function validateSupplementedOrder(
  order: SupplementedOrder | null,
  boundary: AuthoritativePayPalPaymentBoundary,
): void {
  if (!order) return
  if (order.intentId !== boundary.intentId) reject("provider-fact-mismatch")
  assertExactAmount(boundary, order.amount)
}

function validateProviderPlan(
  boundary: AuthoritativePayPalPaymentBoundary,
  resource: Record<string, unknown>,
  supplement: SupplementedSubscription | null,
): void {
  if (boundary.expectedProviderPlanId === null) {
    reject("boundary-mismatch")
  }
  const candidate = resource.plan_id ?? supplement?.planId
  const actual = requiredPayPalId(candidate, PAYPAL_PLAN_ID_PATTERN)
  if (actual !== boundary.expectedProviderPlanId) {
    reject("provider-fact-mismatch")
  }
  if (
    supplement !== null &&
    supplement.planId !== boundary.expectedProviderPlanId
  ) {
    reject("provider-fact-mismatch")
  }
}

async function captureFacts(
  event: PayPalWebhookEvent,
  boundary: AuthoritativePayPalPaymentBoundary,
  resolved: Awaited<ReturnType<typeof resolveCaptureAttempt>>,
): Promise<TypedPaymentFacts> {
  if (
    event.resourceType !== "capture" ||
    boundary.paymentMode !== "one_time" ||
    boundary.providerObjectType !== "order" ||
    boundary.providerObjectId !== resolved.orderId
  ) {
    reject("provider-fact-mismatch")
  }
  validateSupplementedOrder(resolved.order, boundary)
  const captureId = requiredPayPalId(
    event.resource.id,
    PAYPAL_MOVEMENT_ID_PATTERN,
  )
  const status = requiredString(event.resource.status, 40).toUpperCase()
  const facts = baseFacts("capture", captureId)
  facts.factParentProviderObjectType = "order"
  facts.factParentProviderObjectId = resolved.orderId
  if (
    event.eventType === "PAYMENT.CAPTURE.DENIED" ||
    event.eventType === "PAYMENT.CAPTURE.DECLINED"
  ) {
    const expectedStatus = event.eventType.endsWith(".DECLINED")
      ? "DECLINED"
      : "DENIED"
    if (status !== expectedStatus) {
      reject("provider-fact-mismatch")
    }
    facts.factFailureCode = event.eventType.endsWith(".DECLINED")
      ? "paypal_capture_declined"
      : "paypal_capture_denied"
    return facts
  }
  if (status !== "COMPLETED" || event.resource.final_capture !== true) {
    reject("provider-fact-mismatch")
  }
  assertExactAmount(boundary, money(event.resource.amount))
  facts.factPaymentStatus = "paid"
  facts.factProviderMovementType = "capture"
  facts.factProviderMovementId = captureId
  facts.factBaseAmountUsdCents = boundary.baseAmountUsdCents
  facts.factChargedAmountMinor = boundary.chargedAmountMinor
  facts.factChargedCurrency = boundary.chargedCurrency
  facts.factConversionRate = boundary.conversionRate
  return facts
}

function addCalendarInterval(
  start: string,
  recurrenceInterval: "month" | "year" | null,
): string {
  if (recurrenceInterval !== "month" && recurrenceInterval !== "year") {
    reject("boundary-mismatch")
  }
  const value = new Date(start)
  const startYear = value.getUTCFullYear()
  const startMonth = value.getUTCMonth()
  const targetMonthIndex =
    recurrenceInterval === "month"
      ? startYear * 12 + startMonth + 1
      : (startYear + 1) * 12 + startMonth
  const targetYear = Math.floor(targetMonthIndex / 12)
  const targetMonth = targetMonthIndex % 12
  const lastTargetDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate()
  const target = new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(value.getUTCDate(), lastTargetDay),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    ),
  )
  return target.toISOString()
}

function salePeriod(
  resource: Record<string, unknown>,
  supplement: SupplementedSubscription | null,
  recurrenceInterval: "month" | "year" | null,
): { start: string; end: string } {
  const billingPeriod = nestedRecord(resource, "billing_period")
  const start = requiredTimestamp(
    billingPeriod?.start_time ?? resource.create_time,
  )
  const endValue = billingPeriod?.end_time ?? supplement?.nextBillingTime
  const end =
    endValue === null || endValue === undefined
      ? addCalendarInterval(start, recurrenceInterval)
      : requiredTimestamp(endValue)
  if (Date.parse(end) <= Date.parse(start)) reject("provider-fact-mismatch")
  return { start, end }
}

function providerCustomerId(
  resource: Record<string, unknown>,
  supplement: SupplementedSubscription | null,
  boundary: AuthoritativePayPalPaymentBoundary,
): string {
  const payer = nestedRecord(resource, "payer")
  const payerInfo = payer ? nestedRecord(payer, "payer_info") : null
  const subscriber = nestedRecord(resource, "subscriber")
  const candidate =
    resource.payer_id ??
    payerInfo?.payer_id ??
    subscriber?.payer_id ??
    supplement?.customerId ??
    boundary.providerCustomerId
  return requiredPayPalId(candidate, PAYPAL_CUSTOMER_ID_PATTERN)
}

async function saleFacts(
  event: PayPalWebhookEvent,
  boundary: AuthoritativePayPalPaymentBoundary,
  subscriptionId: string,
  supplement: SupplementedSubscription | null,
): Promise<TypedPaymentFacts> {
  if (
    event.resourceType !== "sale" ||
    boundary.paymentMode !== "recurring" ||
    boundary.providerObjectType !== "billing_subscription" ||
    boundary.providerObjectId !== subscriptionId
  ) {
    reject("provider-fact-mismatch")
  }
  validateProviderPlan(boundary, event.resource, supplement)
  const saleId = requiredPayPalId(event.resource.id, PAYPAL_MOVEMENT_ID_PATTERN)
  const state = requiredString(
    event.resource.state ?? event.resource.status,
    40,
  ).toUpperCase()
  const customerId = providerCustomerId(event.resource, supplement, boundary)
  if (
    boundary.providerCustomerId !== null &&
    boundary.providerCustomerId !== customerId
  ) {
    reject("provider-fact-mismatch")
  }
  const facts = baseFacts("sale", saleId)
  facts.factParentProviderObjectType = "billing_subscription"
  facts.factParentProviderObjectId = subscriptionId
  facts.factProviderCustomerId = customerId
  facts.factProviderSubscriptionId = subscriptionId
  if (event.eventType === "PAYMENT.SALE.DENIED") {
    if (state !== "DENIED") reject("provider-fact-mismatch")
    facts.factFailureCode = "paypal_sale_denied"
    return facts
  }
  if (state !== "COMPLETED") reject("provider-fact-mismatch")
  assertExactAmount(boundary, money(event.resource.amount))
  const period = salePeriod(
    event.resource,
    supplement,
    boundary.recurrenceInterval,
  )
  facts.factPaymentStatus = "paid"
  facts.factProviderMovementType = "sale"
  facts.factProviderMovementId = saleId
  facts.factBaseAmountUsdCents = boundary.baseAmountUsdCents
  facts.factChargedAmountMinor = boundary.chargedAmountMinor
  facts.factChargedCurrency = boundary.chargedCurrency
  facts.factConversionRate = boundary.conversionRate
  facts.factPeriodStart = period.start
  facts.factPeriodEnd = period.end
  return facts
}

function lifecycleState(eventType: string, status: string): string {
  const normalized = status.toUpperCase()
  if (
    eventType === "BILLING.SUBSCRIPTION.ACTIVATED" &&
    normalized === "ACTIVE"
  ) {
    return "active"
  }
  if (
    eventType === "BILLING.SUBSCRIPTION.CANCELLED" &&
    normalized === "CANCELLED"
  ) {
    return "cancelled"
  }
  if (
    eventType === "BILLING.SUBSCRIPTION.EXPIRED" &&
    normalized === "EXPIRED"
  ) {
    return "cancelled"
  }
  if (
    eventType === "BILLING.SUBSCRIPTION.SUSPENDED" &&
    normalized === "SUSPENDED"
  ) {
    return "incomplete"
  }
  if (eventType === "BILLING.SUBSCRIPTION.UPDATED") {
    if (normalized === "ACTIVE") return "active"
    if (normalized === "CANCELLED" || normalized === "EXPIRED") {
      return "cancelled"
    }
    if (
      normalized === "SUSPENDED" ||
      normalized === "APPROVAL_PENDING" ||
      normalized === "APPROVED"
    ) {
      return "incomplete"
    }
  }
  reject("provider-fact-mismatch")
}

async function lifecycleFacts(
  event: PayPalWebhookEvent,
  boundary: AuthoritativePayPalPaymentBoundary,
  subscriptionId: string,
  supplement: SupplementedSubscription | null,
): Promise<TypedPaymentFacts> {
  if (
    (event.resourceType !== "subscription" &&
      event.resourceType !== "billing_subscription") ||
    boundary.paymentMode !== "recurring" ||
    boundary.providerObjectType !== "billing_subscription" ||
    boundary.providerObjectId !== subscriptionId
  ) {
    reject("provider-fact-mismatch")
  }
  validateProviderPlan(boundary, event.resource, supplement)
  const status = requiredString(event.resource.status ?? supplement?.status, 40)
  const customerId = providerCustomerId(event.resource, supplement, boundary)
  if (
    boundary.providerCustomerId !== null &&
    boundary.providerCustomerId !== customerId
  ) {
    reject("provider-fact-mismatch")
  }
  const lastPayment = nestedRecord(
    nestedRecord(event.resource, "billing_info") ?? {},
    "last_payment",
  )
  if (lastPayment) {
    assertExactAmount(boundary, money(lastPayment.amount))
  }
  const facts = baseFacts("billing_subscription", subscriptionId)
  facts.factProviderCustomerId = customerId
  facts.factProviderSubscriptionId = subscriptionId
  facts.factLifecycleState = lifecycleState(event.eventType, status)
  return facts
}

async function subscriptionPaymentFailureFacts(
  event: PayPalWebhookEvent,
  boundary: AuthoritativePayPalPaymentBoundary,
  subscriptionId: string,
  supplement: SupplementedSubscription | null,
): Promise<TypedPaymentFacts> {
  if (
    event.eventType !== "BILLING.SUBSCRIPTION.PAYMENT.FAILED" ||
    (event.resourceType !== "subscription" &&
      event.resourceType !== "billing_subscription") ||
    boundary.paymentMode !== "recurring" ||
    boundary.providerObjectType !== "billing_subscription" ||
    boundary.providerObjectId !== subscriptionId
  ) {
    reject("provider-fact-mismatch")
  }
  validateProviderPlan(boundary, event.resource, supplement)
  const customerId = providerCustomerId(event.resource, supplement, boundary)
  if (
    boundary.providerCustomerId !== null &&
    boundary.providerCustomerId !== customerId
  ) {
    reject("provider-fact-mismatch")
  }
  const facts = baseFacts("billing_subscription", subscriptionId)
  facts.factProviderCustomerId = customerId
  facts.factProviderSubscriptionId = subscriptionId
  facts.factFailureCode = "paypal_subscription_payment_failed"
  return facts
}

async function paymentFacts(
  event: PayPalWebhookEvent,
  dependencies: PayPalWebhookDependencies,
): Promise<{
  boundary: AuthoritativePayPalPaymentBoundary
  facts: TypedPaymentFacts
}> {
  if (event.eventType.startsWith("PAYMENT.CAPTURE.")) {
    const resolved = await resolveCaptureAttempt(event.resource, dependencies)
    const boundary = await dependencies.loadPaymentBoundary(resolved.attemptId)
    validateBoundary(boundary, resolved.attemptId)
    return {
      boundary,
      facts: await captureFacts(event, boundary, resolved),
    }
  }

  const subscriptionId = event.eventType.startsWith("BILLING.SUBSCRIPTION.")
    ? requiredPayPalId(event.resource.id, PAYPAL_SUBSCRIPTION_ID_PATTERN)
    : signedSubscriptionId(event.resource)
  const resolved = await resolveSubscriptionAttempt(
    event.resource,
    subscriptionId,
    dependencies,
  )
  let boundary: AuthoritativePayPalPaymentBoundary
  try {
    boundary = await dependencies.loadPaymentBoundary(resolved.attemptId)
  } catch (error) {
    if (error instanceof PayPalWebhookError) throw error
    throw infrastructure()
  }
  validateBoundary(boundary, resolved.attemptId)
  return {
    boundary,
    facts:
      event.eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED"
        ? await subscriptionPaymentFailureFacts(
            event,
            boundary,
            subscriptionId,
            resolved.subscription,
          )
        : event.eventType.startsWith("PAYMENT.SALE.")
          ? await saleFacts(
              event,
              boundary,
              subscriptionId,
              resolved.subscription,
            )
          : await lifecycleFacts(
              event,
              boundary,
              subscriptionId,
              resolved.subscription,
            ),
  }
}

function occurredAt(event: PayPalWebhookEvent, now: Date): string {
  const value = new Date(event.createTime)
  if (
    !Number.isFinite(value.getTime()) ||
    value.getTime() > now.getTime() + 5 * 60 * 1000
  ) {
    reject("provider-fact-mismatch")
  }
  return value.toISOString()
}

function verifiedAt(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw infrastructure()
  }
  return now.toISOString()
}

function adjustmentOriginalIdentity(event: PayPalWebhookEvent): {
  type: "capture" | "sale"
  id: string
  adjustmentType: "refund" | "reversal"
  adjustmentId: string
} {
  const type = event.eventType.includes(".CAPTURE.") ? "capture" : "sale"
  const relatedIds = nestedRecord(
    nestedRecord(event.resource, "supplementary_data") ?? {},
    "related_ids",
  )
  const relatedId =
    type === "capture"
      ? (relatedIds?.capture_id ?? event.resource.capture_id)
      : (relatedIds?.sale_id ?? event.resource.sale_id)
  const resourceId = requiredPayPalId(
    event.resource.id,
    PAYPAL_MOVEMENT_ID_PATTERN,
  )
  const status = String(
    event.resource.status ?? event.resource.state ?? "",
  ).toUpperCase()
  const originalId = relatedId
    ? requiredPayPalId(relatedId, PAYPAL_MOVEMENT_ID_PATTERN)
    : status === "REFUNDED" || status === "REVERSED"
      ? resourceId
      : reject("provider-fact-mismatch")
  const adjustmentType = event.eventType.endsWith(".REFUNDED")
    ? "refund"
    : "reversal"
  return {
    type,
    id: originalId,
    adjustmentType,
    adjustmentId: resourceId === originalId ? event.id : resourceId,
  }
}

function deriveBaseAmount(
  chargedAmountMinor: number,
  movement: AuthoritativePayPalFinancialMovement,
): number {
  if (chargedAmountMinor === movement.chargedAmountMinor) {
    return movement.baseAmountUsdCents
  }
  const approximate = Math.round(
    (chargedAmountMinor * movement.baseAmountUsdCents) /
      movement.chargedAmountMinor,
  )
  for (
    let candidate = Math.max(1, approximate - 2);
    candidate <= approximate + 2;
    candidate += 1
  ) {
    if (
      candidate <= movement.baseAmountUsdCents &&
      Math.round(candidate * movement.conversionRate) === chargedAmountMinor
    ) {
      return candidate
    }
  }
  reject("provider-fact-mismatch")
}

async function adjustmentFacts(
  event: PayPalWebhookEvent,
  dependencies: PayPalWebhookDependencies,
): Promise<{
  movement: AuthoritativePayPalFinancialMovement
  input: Omit<
    VerifiedPayPalFinancialAdjustmentInput,
    | "redactedPayload"
    | "payloadCiphertext"
    | "payloadSha256"
    | "signatureVerifiedAt"
    | "occurredAt"
    | "verificationMethod"
    | "requestContext"
  >
}> {
  const identity = adjustmentOriginalIdentity(event)
  let movement: AuthoritativePayPalFinancialMovement
  try {
    movement = await dependencies.loadOriginalMovement({
      providerMovementType: identity.type,
      providerMovementId: identity.id,
    })
  } catch (error) {
    if (error instanceof PayPalWebhookError) throw error
    throw infrastructure()
  }
  if (
    !UUID_PATTERN.test(movement.id) ||
    movement.provider !== "PAYPAL" ||
    movement.providerAccountScope !== "paypal" ||
    movement.providerMovementType !== identity.type ||
    movement.providerMovementId !== identity.id ||
    movement.entryKind !== "sponsorship_payment" ||
    movement.originalFinancialMovementId !== null ||
    (identity.type === "capture" && movement.paymentMode !== "one_time") ||
    (identity.type === "sale" && movement.paymentMode !== "recurring")
  ) {
    reject("boundary-mismatch")
  }
  const adjusted = money(event.resource.amount)
  if (
    adjusted.currency !== movement.chargedCurrency ||
    adjusted.amountMinor > movement.chargedAmountMinor
  ) {
    reject("provider-fact-mismatch")
  }
  const baseAmountUsdCents = deriveBaseAmount(adjusted.amountMinor, movement)
  return {
    movement,
    input: {
      originalFinancialMovementId: movement.id,
      providerAccountScope: "paypal",
      providerEventId: event.id,
      eventType: event.eventType,
      providerObjectType: identity.type,
      providerObjectId: identity.id,
      adjustmentProviderMovementType: identity.adjustmentType,
      adjustmentProviderMovementId: identity.adjustmentId,
      baseAmountUsdCents,
      chargedAmountMinor: adjusted.amountMinor,
      chargedCurrency: adjusted.currency,
      conversionRate: movement.conversionRate,
    },
  }
}

function validateOriginalPayPalMovement(
  movement: AuthoritativePayPalFinancialMovement,
  expectedId: string,
  expectedType: "capture" | "sale" | null,
): void {
  if (
    !UUID_PATTERN.test(movement.id) ||
    !UUID_PATTERN.test(movement.paymentAttemptId) ||
    !UUID_PATTERN.test(movement.sponsorshipIntentId) ||
    movement.provider !== "PAYPAL" ||
    movement.providerAccountScope !== "paypal" ||
    (movement.providerMovementType !== "capture" &&
      movement.providerMovementType !== "sale") ||
    (expectedType !== null && movement.providerMovementType !== expectedType) ||
    movement.providerMovementId !== expectedId ||
    movement.entryKind !== "sponsorship_payment" ||
    movement.originalFinancialMovementId !== null ||
    (movement.providerMovementType === "capture" &&
      movement.paymentMode !== "one_time") ||
    (movement.providerMovementType === "sale" &&
      movement.paymentMode !== "recurring") ||
    !Number.isSafeInteger(movement.baseAmountUsdCents) ||
    movement.baseAmountUsdCents < 1 ||
    !Number.isSafeInteger(movement.chargedAmountMinor) ||
    movement.chargedAmountMinor < 1 ||
    !SUPPORTED_CURRENCIES.has(movement.chargedCurrency) ||
    !Number.isFinite(movement.conversionRate) ||
    movement.conversionRate <= 0
  ) {
    reject("boundary-mismatch")
  }
}

function disputeTransactionId(resource: Record<string, unknown>): string {
  if (
    !Array.isArray(resource.disputed_transactions) ||
    resource.disputed_transactions.length !== 1 ||
    !isRecord(resource.disputed_transactions[0])
  ) {
    reject("provider-fact-mismatch")
  }
  return requiredPayPalId(
    resource.disputed_transactions[0].seller_transaction_id,
    PAYPAL_MOVEMENT_ID_PATTERN,
  )
}

function disputeOutcome(resource: Record<string, unknown>): string {
  const outcome = nestedRecord(resource, "dispute_outcome")
  const value = requiredString(
    outcome?.outcome_code ?? resource.outcome,
    80,
  ).toUpperCase()
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(value)) {
    reject("provider-fact-mismatch")
  }
  return value
}

type DisputeDisposition =
  | {
      kind: "adjustment"
      movement: AuthoritativePayPalFinancialMovement
      input: Omit<
        VerifiedPayPalFinancialAdjustmentInput,
        | "redactedPayload"
        | "payloadCiphertext"
        | "payloadSha256"
        | "signatureVerifiedAt"
        | "occurredAt"
        | "verificationMethod"
        | "requestContext"
      >
    }
  | {
      kind: "no_effect"
      movement: AuthoritativePayPalFinancialMovement
      providerObjectId: string
      providerState: string
      eventType: "CUSTOMER.DISPUTE.UPDATED" | "CUSTOMER.DISPUTE.RESOLVED"
    }

async function disputeFacts(
  event: PayPalWebhookEvent,
  dependencies: PayPalWebhookDependencies,
): Promise<DisputeDisposition> {
  if (
    !SUPPORTED_DISPUTE_EVENT_TYPES.has(event.eventType) ||
    (event.resourceType !== "customer_dispute" &&
      event.resourceType !== "dispute")
  ) {
    reject("provider-fact-mismatch")
  }
  const disputeId = requiredPayPalId(
    event.resource.dispute_id ?? event.resource.id,
    PAYPAL_DISPUTE_ID_PATTERN,
  )
  const originalMovementId = disputeTransactionId(event.resource)
  let movement: AuthoritativePayPalFinancialMovement
  try {
    movement = await dependencies.loadOriginalMovement({
      providerMovementType: null,
      providerMovementId: originalMovementId,
    })
  } catch (error) {
    if (error instanceof PayPalWebhookError) throw error
    throw infrastructure()
  }
  validateOriginalPayPalMovement(movement, originalMovementId, null)

  const disputed = money(event.resource.dispute_amount)
  if (
    disputed.currency !== movement.chargedCurrency ||
    disputed.amountMinor > movement.chargedAmountMinor
  ) {
    reject("provider-fact-mismatch")
  }
  const baseAmountUsdCents = deriveBaseAmount(disputed.amountMinor, movement)
  const status = requiredString(event.resource.status, 72).toUpperCase()
  if (!/^[A-Z][A-Z0-9_]{1,71}$/.test(status)) {
    reject("provider-fact-mismatch")
  }

  if (event.eventType === "CUSTOMER.DISPUTE.UPDATED") {
    return {
      kind: "no_effect",
      movement,
      providerObjectId: disputeId,
      providerState: `updated_${status}`.toLowerCase(),
      eventType: "CUSTOMER.DISPUTE.UPDATED",
    }
  }

  if (event.eventType === "CUSTOMER.DISPUTE.RESOLVED") {
    if (status !== "RESOLVED") reject("provider-fact-mismatch")
    const outcome = disputeOutcome(event.resource)
    if (!PAYPAL_SELLER_DISPUTE_OUTCOMES.has(outcome)) {
      if (
        outcome !== "RESOLVED_BUYER_FAVOR" &&
        outcome !== "RESOLVED_BUYER_FAVOUR"
      ) {
        reject("provider-fact-mismatch")
      }
      return {
        kind: "no_effect",
        movement,
        providerObjectId: disputeId,
        providerState: outcome.toLowerCase(),
        eventType: "CUSTOMER.DISPUTE.RESOLVED",
      }
    }
  } else if (status === "RESOLVED") {
    reject("provider-fact-mismatch")
  }

  return {
    kind: "adjustment",
    movement,
    input: {
      originalFinancialMovementId: movement.id,
      providerAccountScope: "paypal",
      providerEventId: event.id,
      eventType: event.eventType,
      providerObjectType: movement.providerMovementType,
      providerObjectId: movement.providerMovementId,
      adjustmentProviderMovementType: "dispute",
      adjustmentProviderMovementId: disputeId,
      baseAmountUsdCents,
      chargedAmountMinor: disputed.amountMinor,
      chargedCurrency: disputed.currency,
      conversionRate: movement.conversionRate,
    },
  }
}

export async function ingestVerifiedPayPalEvent(
  input: {
    event: PayPalWebhookEvent
    rawPayload: string
    requestContext: PayPalWebhookRequestContext
  },
  dependencies: PayPalWebhookDependencies,
): Promise<IngestedPayPalWebhookResult> {
  if (
    !SUPPORTED_PAYMENT_EVENT_TYPES.has(input.event.eventType) &&
    !SUPPORTED_ADJUSTMENT_EVENT_TYPES.has(input.event.eventType) &&
    !SUPPORTED_DISPUTE_EVENT_TYPES.has(input.event.eventType)
  ) {
    reject("unsupported-event")
  }
  const now = dependencies.now()
  const signatureVerifiedAt = verifiedAt(now)
  const eventOccurredAt = occurredAt(input.event, now)
  const encrypted = encryptedPayload(
    input.rawPayload,
    input.event,
    dependencies.crypto,
  )

  if (SUPPORTED_DISPUTE_EVENT_TYPES.has(input.event.eventType)) {
    const disposition = await disputeFacts(input.event, dependencies)
    if (disposition.kind === "no_effect") {
      let result: VerifiedPayPalNoEffectResult
      try {
        result = await dependencies.ingestVerifiedNoEffect({
          providerAccountScope: "paypal",
          providerEventId: input.event.id,
          eventType: disposition.eventType,
          providerObjectType: "dispute",
          providerObjectId: disposition.providerObjectId,
          providerState: disposition.providerState,
          redactedPayload: fixedRedactedPayload(
            input.event,
            "dispute",
            encrypted,
            input.requestContext,
          ),
          payloadCiphertext: encrypted.ciphertext,
          payloadSha256: encrypted.immutableSha256,
          signatureVerifiedAt,
          occurredAt: eventOccurredAt,
          verificationMethod: "paypal_webhook_signature_api",
          requestContext: input.requestContext,
        })
      } catch (error) {
        if (error instanceof PayPalWebhookError) throw error
        throw infrastructure()
      }
      if (
        !UUID_PATTERN.test(result.gatewayEventId) ||
        result.processingStatus !== "ignored" ||
        typeof result.isDuplicate !== "boolean"
      ) {
        throw infrastructure()
      }
      return { kind: "no_effect", ...result }
    }

    let result: VerifiedPayPalFinancialAdjustmentResult
    try {
      result = await dependencies.ingestVerifiedAdjustment({
        ...disposition.input,
        redactedPayload: fixedRedactedPayload(
          input.event,
          disposition.input.providerObjectType,
          encrypted,
          input.requestContext,
        ),
        payloadCiphertext: encrypted.ciphertext,
        payloadSha256: encrypted.immutableSha256,
        signatureVerifiedAt,
        occurredAt: eventOccurredAt,
        verificationMethod: "paypal_webhook_signature_api",
        requestContext: input.requestContext,
      })
    } catch (error) {
      if (error instanceof PayPalWebhookError) throw error
      throw infrastructure()
    }
    if (
      !UUID_PATTERN.test(result.gatewayEventId) ||
      result.originalFinancialMovementId !== disposition.movement.id ||
      result.paymentAttemptId !== disposition.movement.paymentAttemptId ||
      result.sponsorshipIntentId !== disposition.movement.sponsorshipIntentId ||
      typeof result.isDuplicate !== "boolean"
    ) {
      throw infrastructure()
    }
    return { kind: "adjustment", ...result }
  }

  if (SUPPORTED_ADJUSTMENT_EVENT_TYPES.has(input.event.eventType)) {
    const adjustment = await adjustmentFacts(input.event, dependencies)
    let result: VerifiedPayPalFinancialAdjustmentResult
    try {
      result = await dependencies.ingestVerifiedAdjustment({
        ...adjustment.input,
        redactedPayload: fixedRedactedPayload(
          input.event,
          adjustment.input.providerObjectType,
          encrypted,
          input.requestContext,
        ),
        payloadCiphertext: encrypted.ciphertext,
        payloadSha256: encrypted.immutableSha256,
        signatureVerifiedAt,
        occurredAt: eventOccurredAt,
        verificationMethod: "paypal_webhook_signature_api",
        requestContext: input.requestContext,
      })
    } catch (error) {
      if (error instanceof PayPalWebhookError) throw error
      throw infrastructure()
    }
    if (
      !UUID_PATTERN.test(result.gatewayEventId) ||
      result.originalFinancialMovementId !== adjustment.movement.id ||
      result.paymentAttemptId !== adjustment.movement.paymentAttemptId ||
      result.sponsorshipIntentId !== adjustment.movement.sponsorshipIntentId ||
      typeof result.isDuplicate !== "boolean"
    ) {
      throw infrastructure()
    }
    return { kind: "adjustment", ...result }
  }

  const { boundary, facts } = await paymentFacts(input.event, dependencies)
  let result: VerifiedPayPalGatewayEventResult
  try {
    result = await dependencies.ingestVerifiedEvent({
      paymentAttemptId: boundary.attemptId,
      providerAccountScope: "paypal",
      providerEventId: input.event.id,
      eventType: input.event.eventType,
      redactedPayload: fixedRedactedPayload(
        input.event,
        facts.providerObjectType,
        encrypted,
        input.requestContext,
      ),
      payloadCiphertext: encrypted.ciphertext,
      payloadSha256: encrypted.immutableSha256,
      signatureVerifiedAt,
      occurredAt: eventOccurredAt,
      verificationMethod: "paypal_webhook_signature_api",
      factServerPaymentAttemptId: boundary.attemptId,
      requestContext: input.requestContext,
      ...facts,
    })
  } catch (error) {
    if (error instanceof PayPalWebhookError) throw error
    throw infrastructure()
  }
  if (
    !UUID_PATTERN.test(result.gatewayEventId) ||
    result.paymentAttemptId !== boundary.attemptId ||
    result.sponsorshipIntentId !== boundary.intentId ||
    typeof result.isDuplicate !== "boolean"
  ) {
    throw infrastructure()
  }
  return { kind: "payment", ...result }
}

function quarantineIdentity(event: PayPalWebhookEvent): {
  providerObjectType: string | null
  providerObjectId: string | null
} {
  const objectId = event.resource.id
  if (
    typeof objectId !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,255}$/.test(objectId) ||
    !/^[a-z][a-z0-9_]{0,79}$/.test(event.resourceType)
  ) {
    return { providerObjectType: null, providerObjectId: null }
  }
  return {
    providerObjectType:
      event.resourceType === "subscription"
        ? "billing_subscription"
        : event.resourceType,
    providerObjectId: objectId,
  }
}

export async function quarantineVerifiedPayPalEvent(
  input: {
    event: PayPalWebhookEvent
    rawPayload: string
    requestContext: PayPalWebhookRequestContext
    error: PayPalWebhookError
  },
  dependencies: PayPalWebhookDependencies,
): Promise<VerifiedPayPalQuarantineResult & { quarantined: true }> {
  if (input.error.retryable) throw input.error
  const now = dependencies.now()
  const payloadToEncrypt =
    input.error.code === "unsupported-event"
      ? minimizedUnsupportedEvidence(input.event)
      : input.rawPayload
  const encrypted = encryptedPayload(
    payloadToEncrypt,
    input.event,
    dependencies.crypto,
    input.rawPayload,
  )
  const identity = quarantineIdentity(input.event)
  let result: VerifiedPayPalQuarantineResult
  try {
    result = await dependencies.quarantineVerifiedEvent({
      providerAccountScope: "paypal",
      providerEventId: input.event.id,
      eventType: input.event.eventType,
      ...identity,
      redactedPayload: fixedRedactedPayload(
        input.event,
        identity.providerObjectType,
        encrypted,
        input.requestContext,
      ),
      payloadCiphertext: encrypted.ciphertext,
      payloadSha256: encrypted.immutableSha256,
      signatureVerifiedAt: verifiedAt(now),
      occurredAt: occurredAt(input.event, now),
      verificationMethod: "paypal_webhook_signature_api",
      errorCode: input.error.code,
      reason: `Verified PayPal event requires review: ${input.error.code}`,
      requestContext: input.requestContext,
    })
  } catch (error) {
    if (error instanceof PayPalWebhookError) throw error
    throw infrastructure()
  }
  if (
    !UUID_PATTERN.test(result.gatewayEventId) ||
    result.processingStatus !== "ignored" ||
    typeof result.isDuplicate !== "boolean"
  ) {
    throw infrastructure()
  }
  return { quarantined: true, ...result }
}

export function asPayPalWebhookError(error: unknown): PayPalWebhookError {
  return error instanceof PayPalWebhookError ? error : infrastructure()
}
