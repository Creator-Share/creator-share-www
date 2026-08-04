import "server-only"

import type Stripe from "stripe"

import type {
  SponsorshipCrypto,
  SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import { sha256Digest, toSupabaseRpcBytea } from "@/lib/sponsorships/crypto"
import { STRIPE_API_VERSION, type StripeRegion } from "@/lib/stripe/config"
import type { SupportedCurrency } from "@/utils/currency"

export const SERVER_INTENT_STRIPE_SCHEMA = "server_intent_v1"
export const SERVER_INTENT_STRIPE_API_VERSION = STRIPE_API_VERSION

export const MAXIMUM_SIGNED_PAYLOAD_BYTES = 64 * 1024
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUPPORTED_CURRENCIES = new Set<SupportedCurrency>([
  "USD",
  "AUD",
  "GBP",
  "EUR",
])
const SUPPORTED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
])

export type ServerIntentStripeWebhookErrorCode =
  | "invalid-metadata"
  | "unsupported-event"
  | "boundary-mismatch"
  | "provider-fact-mismatch"
  | "event-envelope-mismatch"
  | "invalid-payload"
  | "payload-too-large"
  | "provider-chain-unavailable"
  | "infrastructure"

export class ServerIntentStripeWebhookError extends Error {
  readonly code: ServerIntentStripeWebhookErrorCode
  readonly httpStatus: number
  readonly retryable: boolean

  constructor(
    code: ServerIntentStripeWebhookErrorCode,
    options: { retryable?: boolean; httpStatus?: number } = {},
  ) {
    super(
      options.retryable
        ? "Server intent Stripe webhook ingestion is temporarily unavailable"
        : "Server intent Stripe webhook evidence was rejected",
    )
    this.name = "ServerIntentStripeWebhookError"
    this.code = code
    this.retryable = options.retryable === true
    this.httpStatus = options.httpStatus ?? (this.retryable ? 503 : 400)
  }
}

export interface ServerIntentStripeMetadata {
  sponsorshipIntentId: string
  paymentAttemptId: string
  providerAccountScope: string
}

export type ServerIntentStripeClassification =
  | { kind: "not-server-intent" }
  | {
      kind: "server-intent"
      metadata: ServerIntentStripeMetadata
    }

export interface AuthoritativeStripePaymentBoundary {
  attemptId: string
  intentId: string
  provider: "STRIPE"
  providerAccountScope: string
  attemptStatus: string
  paymentMode: "one_time" | "recurring"
  recurrenceInterval: "month" | "year" | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  providerObjectType: "checkout_session"
  providerObjectId: string
  providerCustomerId: string | null
  providerSubscriptionObjectType: "subscription" | null
  providerSubscriptionId: string | null
  intentPaymentMode: "one_time" | "recurring"
  intentRecurrenceInterval: "month" | "year" | null
  intentBaseAmountUsdCents: number
  intentChargedAmountMinor: number
  intentChargedCurrency: SupportedCurrency
  intentConversionRate: number
}

export interface StripeWebhookRequestContext {
  requestId: string
  traceId: string | null
  clientIp: string | null
  userAgent: string | null
  signatureHeader: string | null
  webhookSecretVersion: "current" | "previous" | null
}

export interface VerifiedStripeGatewayEventInput {
  paymentAttemptId: string
  providerAccountScope: string
  providerEventId: string
  eventType: string
  providerObjectType: "checkout_session" | "invoice" | "subscription"
  providerObjectId: string
  redactedPayload: Record<string, unknown>
  payloadCiphertext: SupabaseRpcBytea
  payloadSha256: SupabaseRpcBytea
  signatureVerifiedAt: string
  occurredAt: string
  verificationMethod: "stripe_webhook_signature"
  factPaymentStatus: string | null
  factServerPaymentAttemptId: string | null
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
  requestContext: StripeWebhookRequestContext
}

export interface VerifiedStripeGatewayEventResult {
  gatewayEventId: string
  sponsorshipIntentId: string
  paymentAttemptId: string
  processingStatus: string
  isDuplicate: boolean
}

export interface VerifiedStripeQuarantineInput {
  providerAccountScope: string
  providerEventId: string
  eventType: string
  providerObjectType: string | null
  providerObjectId: string | null
  redactedPayload: Record<string, unknown>
  payloadCiphertext: SupabaseRpcBytea
  payloadSha256: SupabaseRpcBytea
  signatureVerifiedAt: string
  occurredAt: string
  verificationMethod: "stripe_webhook_signature"
  errorCode: ServerIntentStripeWebhookErrorCode
  reason: string
  requestContext: StripeWebhookRequestContext
}

export interface VerifiedStripeQuarantineResult {
  gatewayEventId: string
  processingStatus: string
  isDuplicate: boolean
}

export interface ServerIntentStripeWebhookDependencies {
  crypto: SponsorshipCrypto
  loadPaymentBoundary(
    paymentAttemptId: string,
  ): Promise<AuthoritativeStripePaymentBoundary>
  retrieveCheckoutSession(id: string): Promise<Stripe.Checkout.Session>
  retrieveInvoice(id: string): Promise<Stripe.Invoice>
  retrieveSubscription(id: string): Promise<Stripe.Subscription>
  ingestVerifiedEvent(
    input: VerifiedStripeGatewayEventInput,
  ): Promise<VerifiedStripeGatewayEventResult>
  quarantineVerifiedEvent(
    input: VerifiedStripeQuarantineInput,
  ): Promise<VerifiedStripeQuarantineResult>
  now(): Date
}

export type ServerIntentStripeWebhookResult =
  { handled: false } | ({ handled: true } & VerifiedStripeGatewayEventResult)

export interface QuarantinedStripeWebhookResult extends VerifiedStripeQuarantineResult {
  quarantined: true
}

export function validateServerIntentStripeEventEnvelope(
  event: Stripe.Event,
  expectedLivemode: boolean,
): void {
  validateStripeEventAccountEnvelope(event, expectedLivemode)
  if (event.api_version !== SERVER_INTENT_STRIPE_API_VERSION) {
    reject("event-envelope-mismatch")
  }
}

export function validateStripeEventAccountEnvelope(
  event: Stripe.Event,
  expectedLivemode: boolean,
): void {
  if (
    event.object !== "event" ||
    event.livemode !== expectedLivemode ||
    event.account !== undefined
  ) {
    reject("event-envelope-mismatch")
  }
}

type TypedFacts = Omit<
  VerifiedStripeGatewayEventInput,
  | "paymentAttemptId"
  | "providerAccountScope"
  | "providerEventId"
  | "eventType"
  | "redactedPayload"
  | "payloadCiphertext"
  | "payloadSha256"
  | "signatureVerifiedAt"
  | "occurredAt"
  | "verificationMethod"
  | "factServerPaymentAttemptId"
  | "requestContext"
>

function reject(
  code: Exclude<
    ServerIntentStripeWebhookErrorCode,
    "infrastructure" | "provider-chain-unavailable"
  >,
): never {
  throw new ServerIntentStripeWebhookError(code)
}

function infrastructure(
  code: "infrastructure" | "provider-chain-unavailable" = "infrastructure",
): ServerIntentStripeWebhookError {
  return new ServerIntentStripeWebhookError(code, { retryable: true })
}

/**
 * Reads the exact signed webhook payload without allowing an absent or forged
 * Content-Length header to turn the route into an unbounded memory sink.
 */
export async function readBoundedStripeWebhookPayload(
  request: Request,
): Promise<string> {
  const declaredLength = request.headers.get("content-length")
  if (declaredLength !== null) {
    if (!/^[0-9]+$/.test(declaredLength)) reject("invalid-payload")
    const parsedLength = Number(declaredLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength > MAXIMUM_SIGNED_PAYLOAD_BYTES
    ) {
      reject("payload-too-large")
    }
  }

  if (!request.body) reject("invalid-payload")

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw infrastructure()

      totalBytes += value.byteLength
      if (totalBytes > MAXIMUM_SIGNED_PAYLOAD_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // The size rejection remains authoritative if cancellation fails.
        }
        reject("payload-too-large")
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (error instanceof ServerIntentStripeWebhookError) throw error
    throw infrastructure()
  } finally {
    reader.releaseLock()
  }

  if (totalBytes === 0) reject("invalid-payload")

  const payload = Buffer.concat(chunks, totalBytes)
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload)
  } catch {
    throw new ServerIntentStripeWebhookError("invalid-payload")
  } finally {
    payload.fill(0)
    for (const chunk of chunks) chunk.fill(0)
  }
  return decoded
}

function requiredUuid(
  value: unknown,
  code: "invalid-metadata" | "boundary-mismatch",
) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) reject(code)
  return value.toLowerCase()
}

function requiredProviderId(
  value: unknown,
  prefix: string,
  code:
    "boundary-mismatch" | "provider-fact-mismatch" = "provider-fact-mismatch",
): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    value.length > 255 ||
    !/^[A-Za-z0-9_]+$/.test(value)
  ) {
    reject(code)
  }
  return value
}

function expandableId(
  value: string | { id: string } | null | undefined,
  prefix: string,
): string | null {
  if (value === null || value === undefined) return null
  return requiredProviderId(
    typeof value === "string" ? value : value.id,
    prefix,
  )
}

function metadataCandidates(event: Stripe.Event): Stripe.Metadata[] {
  const object = event.data.object

  if (event.type.startsWith("checkout.session.")) {
    const session = object as Stripe.Checkout.Session
    return session.metadata ? [session.metadata] : []
  }

  if (event.type.startsWith("invoice.")) {
    const invoice = object as Stripe.Invoice
    const candidates = [
      invoice.metadata,
      invoice.subscription_details?.metadata,
    ]
    if (invoice.subscription && typeof invoice.subscription !== "string") {
      candidates.push(invoice.subscription.metadata)
    }
    return candidates.filter((value): value is Stripe.Metadata =>
      Boolean(value),
    )
  }

  if (event.type.startsWith("customer.subscription.")) {
    const subscription = object as Stripe.Subscription
    return subscription.metadata ? [subscription.metadata] : []
  }

  return []
}

function metadataIdentity(
  metadata: Stripe.Metadata,
): ServerIntentStripeMetadata {
  if (
    metadata.creatorshare_platform !== "true" ||
    metadata.sponsorship_schema !== SERVER_INTENT_STRIPE_SCHEMA
  ) {
    reject("invalid-metadata")
  }

  const providerAccountScope = metadata.provider_account_scope
  if (
    typeof providerAccountScope !== "string" ||
    !/^stripe_(?:us|uk)$/.test(providerAccountScope)
  ) {
    reject("invalid-metadata")
  }

  return {
    sponsorshipIntentId: requiredUuid(
      metadata.sponsorship_intent_id,
      "invalid-metadata",
    ),
    paymentAttemptId: requiredUuid(
      metadata.payment_attempt_id,
      "invalid-metadata",
    ),
    providerAccountScope,
  }
}

export function classifyServerIntentStripeEvent(
  event: Stripe.Event,
): ServerIntentStripeClassification {
  const matchingMetadata = metadataCandidates(event).filter(
    (metadata) =>
      metadata.sponsorship_schema !== undefined ||
      metadata.sponsorship_intent_id !== undefined ||
      metadata.payment_attempt_id !== undefined ||
      metadata.provider_account_scope !== undefined,
  )
  if (matchingMetadata.length === 0) return { kind: "not-server-intent" }

  const identities = matchingMetadata.map(metadataIdentity)
  const first = identities[0]
  if (
    identities.some(
      (identity) =>
        identity.sponsorshipIntentId !== first.sponsorshipIntentId ||
        identity.paymentAttemptId !== first.paymentAttemptId ||
        identity.providerAccountScope !== first.providerAccountScope,
    )
  ) {
    reject("invalid-metadata")
  }

  return { kind: "server-intent", metadata: first }
}

export async function classifyServerIntentStripeEventWithProviderLookup(
  event: Stripe.Event,
  dependencies: Pick<
    ServerIntentStripeWebhookDependencies,
    "retrieveSubscription"
  >,
): Promise<ServerIntentStripeClassification> {
  const directClassification = classifyServerIntentStripeEvent(event)
  if (
    directClassification.kind === "server-intent" ||
    !event.type.startsWith("invoice.")
  ) {
    return directClassification
  }

  const invoice = event.data.object as Stripe.Invoice
  if (!invoice.subscription || typeof invoice.subscription !== "string") {
    return directClassification
  }

  let subscription: Stripe.Subscription
  try {
    subscription = await dependencies.retrieveSubscription(invoice.subscription)
  } catch {
    throw infrastructure()
  }

  if (
    subscription.object !== "subscription" ||
    subscription.id !== invoice.subscription
  ) {
    reject("provider-fact-mismatch")
  }

  return classifyServerIntentStripeEvent({
    type: event.type,
    data: { object: { ...invoice, subscription } },
  } as unknown as Stripe.Event)
}

function validateBoundary(
  boundary: AuthoritativeStripePaymentBoundary,
  metadata: ServerIntentStripeMetadata,
  expectedScope: string,
): void {
  if (
    requiredUuid(boundary.attemptId, "boundary-mismatch") !==
      metadata.paymentAttemptId ||
    requiredUuid(boundary.intentId, "boundary-mismatch") !==
      metadata.sponsorshipIntentId ||
    boundary.provider !== "STRIPE" ||
    boundary.providerAccountScope !== expectedScope ||
    boundary.providerAccountScope !== metadata.providerAccountScope ||
    boundary.providerObjectType !== "checkout_session" ||
    boundary.intentPaymentMode !== boundary.paymentMode ||
    boundary.intentRecurrenceInterval !== boundary.recurrenceInterval ||
    boundary.intentBaseAmountUsdCents !== boundary.baseAmountUsdCents ||
    boundary.intentChargedAmountMinor !== boundary.chargedAmountMinor ||
    boundary.intentChargedCurrency !== boundary.chargedCurrency ||
    boundary.intentConversionRate !== boundary.conversionRate ||
    !Number.isSafeInteger(boundary.baseAmountUsdCents) ||
    boundary.baseAmountUsdCents < 1 ||
    !Number.isSafeInteger(boundary.chargedAmountMinor) ||
    boundary.chargedAmountMinor < 1 ||
    !SUPPORTED_CURRENCIES.has(boundary.chargedCurrency) ||
    !Number.isFinite(boundary.conversionRate) ||
    boundary.conversionRate <= 0
  ) {
    reject("boundary-mismatch")
  }

  requiredProviderId(boundary.providerObjectId, "cs_", "boundary-mismatch")

  if (
    (boundary.paymentMode === "one_time" &&
      boundary.recurrenceInterval !== null) ||
    (boundary.paymentMode === "recurring" &&
      boundary.recurrenceInterval !== "month" &&
      boundary.recurrenceInterval !== "year") ||
    (boundary.providerCustomerId === null) !==
      (boundary.providerSubscriptionId === null) ||
    (boundary.providerSubscriptionId !== null &&
      boundary.providerSubscriptionObjectType !== "subscription")
  ) {
    reject("boundary-mismatch")
  }
}

function assertCurrencyAndAmount(
  boundary: AuthoritativeStripePaymentBoundary,
  amount: number | null,
  currency: string | null,
): void {
  if (
    !Number.isSafeInteger(amount) ||
    amount !== boundary.chargedAmountMinor ||
    currency?.toUpperCase() !== boundary.chargedCurrency
  ) {
    reject("provider-fact-mismatch")
  }
}

function assertCheckoutMetadata(
  session: Stripe.Checkout.Session,
  metadata: ServerIntentStripeMetadata,
): void {
  const classification = classifyServerIntentStripeEvent({
    type: "checkout.session.completed",
    data: { object: session },
  } as Stripe.Event)
  if (
    classification.kind !== "server-intent" ||
    classification.metadata.paymentAttemptId !== metadata.paymentAttemptId ||
    classification.metadata.sponsorshipIntentId !==
      metadata.sponsorshipIntentId ||
    classification.metadata.providerAccountScope !==
      metadata.providerAccountScope ||
    session.client_reference_id !== metadata.paymentAttemptId
  ) {
    reject("provider-fact-mismatch")
  }
}

function normalizedPeriod(
  periodStart: number | null | undefined,
  periodEnd: number | null | undefined,
): { start: string; end: string } {
  if (
    !Number.isSafeInteger(periodStart) ||
    !Number.isSafeInteger(periodEnd) ||
    (periodStart as number) < 1 ||
    (periodEnd as number) <= (periodStart as number)
  ) {
    reject("provider-fact-mismatch")
  }
  return {
    start: new Date((periodStart as number) * 1000).toISOString(),
    end: new Date((periodEnd as number) * 1000).toISOString(),
  }
}

function exactRecurringInvoicePeriod(
  invoice: Stripe.Invoice,
  subscriptionId: string,
  boundary: AuthoritativeStripePaymentBoundary,
): { start: string; end: string } {
  if (
    invoice.collection_method !== "charge_automatically" ||
    invoice.lines.has_more ||
    invoice.lines.data.length !== 1
  ) {
    reject("provider-fact-mismatch")
  }

  const line = invoice.lines.data[0]
  const lineSubscriptionId = expandableId(line.subscription, "sub_")
  const expectedInterval = boundary.recurrenceInterval
  if (
    line.object !== "line_item" ||
    line.type !== "subscription" ||
    line.proration ||
    line.quantity !== 1 ||
    lineSubscriptionId !== subscriptionId ||
    line.amount !== boundary.chargedAmountMinor ||
    line.currency.toUpperCase() !== boundary.chargedCurrency ||
    line.price?.unit_amount !== boundary.chargedAmountMinor ||
    line.price.currency.toUpperCase() !== boundary.chargedCurrency ||
    line.price.recurring?.interval !== expectedInterval ||
    line.price.recurring.interval_count !== 1
  ) {
    reject("provider-fact-mismatch")
  }

  return normalizedPeriod(line.period.start, line.period.end)
}

function assertRecurringInvoice(
  invoice: Stripe.Invoice,
  expected: {
    invoiceId: string
    customerId: string
    subscriptionId: string
    boundary: AuthoritativeStripePaymentBoundary
  },
): { start: string; end: string } {
  const customerId = expandableId(invoice.customer, "cus_")
  const subscriptionId = expandableId(invoice.subscription, "sub_")
  if (
    requiredProviderId(invoice.id, "in_") !== expected.invoiceId ||
    customerId !== expected.customerId ||
    subscriptionId !== expected.subscriptionId ||
    invoice.status !== "paid" ||
    invoice.paid_out_of_band !== false ||
    invoice.amount_due !== expected.boundary.chargedAmountMinor
  ) {
    reject("provider-fact-mismatch")
  }
  assertCurrencyAndAmount(
    expected.boundary,
    invoice.amount_paid,
    invoice.currency,
  )
  return exactRecurringInvoicePeriod(
    invoice,
    expected.subscriptionId,
    expected.boundary,
  )
}

async function withProviderLookup<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback()
  } catch (error) {
    if (error instanceof ServerIntentStripeWebhookError) throw error
    throw infrastructure()
  }
}

async function assertRecurringProviderChain(
  boundary: AuthoritativeStripePaymentBoundary,
  metadata: ServerIntentStripeMetadata,
  customerId: string,
  subscriptionId: string,
  dependencies: ServerIntentStripeWebhookDependencies,
): Promise<void> {
  if (boundary.paymentMode !== "recurring") {
    reject("provider-fact-mismatch")
  }

  if (boundary.providerCustomerId && boundary.providerSubscriptionId) {
    if (
      boundary.providerCustomerId !== customerId ||
      boundary.providerSubscriptionId !== subscriptionId
    ) {
      reject("provider-fact-mismatch")
    }
    return
  }

  const checkoutSession = await withProviderLookup(() =>
    dependencies.retrieveCheckoutSession(boundary.providerObjectId),
  )
  if (checkoutSession.id !== boundary.providerObjectId) {
    reject("provider-fact-mismatch")
  }
  if (
    checkoutSession.object !== "checkout.session" ||
    checkoutSession.mode !== "subscription"
  ) {
    reject("provider-fact-mismatch")
  }
  assertCheckoutMetadata(checkoutSession, metadata)
  assertCurrencyAndAmount(
    boundary,
    checkoutSession.amount_total,
    checkoutSession.currency,
  )
  const checkoutCustomerId = expandableId(checkoutSession.customer, "cus_")
  const checkoutSubscriptionId = expandableId(
    checkoutSession.subscription,
    "sub_",
  )
  if (!checkoutCustomerId || !checkoutSubscriptionId) {
    throw infrastructure("provider-chain-unavailable")
  }
  if (
    checkoutCustomerId !== customerId ||
    checkoutSubscriptionId !== subscriptionId
  ) {
    reject("provider-fact-mismatch")
  }
}

function baseFacts(
  objectType: TypedFacts["providerObjectType"],
  objectId: string,
): TypedFacts {
  return {
    providerObjectType: objectType,
    providerObjectId: objectId,
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

async function checkoutFacts(
  event: Stripe.Event,
  boundary: AuthoritativeStripePaymentBoundary,
  metadata: ServerIntentStripeMetadata,
  dependencies: ServerIntentStripeWebhookDependencies,
): Promise<TypedFacts> {
  const session = event.data.object as Stripe.Checkout.Session
  const sessionId = requiredProviderId(session.id, "cs_")
  if (session.object !== "checkout.session") reject("provider-fact-mismatch")
  if (sessionId !== boundary.providerObjectId) reject("provider-fact-mismatch")
  assertCheckoutMetadata(session, metadata)
  assertCurrencyAndAmount(boundary, session.amount_total, session.currency)

  const expectedMode =
    boundary.paymentMode === "one_time" ? "payment" : "subscription"
  if (session.mode !== expectedMode) reject("provider-fact-mismatch")

  const facts = baseFacts("checkout_session", sessionId)
  if (event.type === "checkout.session.expired") {
    if (
      session.status !== "expired" ||
      session.payment_status !== "unpaid" ||
      session.payment_intent !== null ||
      session.subscription !== null ||
      session.invoice !== null
    ) {
      reject("provider-fact-mismatch")
    }
    facts.factPaymentStatus = "unpaid"
    facts.factLifecycleState = "expired"
    return facts
  }

  if (event.type === "checkout.session.async_payment_failed") {
    if (session.status !== "complete" || session.payment_status !== "unpaid") {
      reject("provider-fact-mismatch")
    }
    facts.factPaymentStatus = "unpaid"
    facts.factFailureCode = "stripe_checkout_async_payment_failed"
    if (boundary.paymentMode === "recurring") {
      const customerId = expandableId(session.customer, "cus_")
      const subscriptionId = expandableId(session.subscription, "sub_")
      if (!customerId || !subscriptionId) {
        reject("provider-fact-mismatch")
      }
      facts.factProviderCustomerId = customerId
      facts.factProviderSubscriptionId = subscriptionId
    } else if (
      session.customer !== null ||
      session.subscription !== null ||
      session.invoice !== null
    ) {
      reject("provider-fact-mismatch")
    }
    return facts
  }

  if (session.status !== "complete" || session.payment_status !== "paid") {
    reject("provider-fact-mismatch")
  }
  facts.factPaymentStatus = "paid"
  facts.factBaseAmountUsdCents = boundary.baseAmountUsdCents
  facts.factChargedAmountMinor = boundary.chargedAmountMinor
  facts.factChargedCurrency = boundary.chargedCurrency
  facts.factConversionRate = boundary.conversionRate

  if (boundary.paymentMode === "one_time") {
    const paymentIntentId = expandableId(session.payment_intent, "pi_")
    if (
      !paymentIntentId ||
      session.customer !== null ||
      session.subscription !== null ||
      session.invoice !== null
    ) {
      reject("provider-fact-mismatch")
    }
    facts.factProviderMovementType = "payment_intent"
    facts.factProviderMovementId = paymentIntentId
    return facts
  }

  const customerId = expandableId(session.customer, "cus_")
  const subscriptionId = expandableId(session.subscription, "sub_")
  const invoiceId = expandableId(session.invoice, "in_")
  if (!customerId || !subscriptionId || !invoiceId) {
    reject("provider-fact-mismatch")
  }

  const invoice =
    session.invoice && typeof session.invoice !== "string"
      ? session.invoice
      : await withProviderLookup(() => dependencies.retrieveInvoice(invoiceId))
  if (invoice.billing_reason !== "subscription_create") {
    reject("provider-fact-mismatch")
  }
  const period = assertRecurringInvoice(invoice, {
    invoiceId,
    customerId,
    subscriptionId,
    boundary,
  })

  facts.factProviderMovementType = "invoice"
  facts.factProviderMovementId = invoiceId
  facts.factProviderCustomerId = customerId
  facts.factProviderSubscriptionId = subscriptionId
  facts.factPeriodStart = period.start
  facts.factPeriodEnd = period.end
  return facts
}

async function invoiceFacts(
  event: Stripe.Event,
  boundary: AuthoritativeStripePaymentBoundary,
  metadata: ServerIntentStripeMetadata,
  dependencies: ServerIntentStripeWebhookDependencies,
): Promise<TypedFacts> {
  if (boundary.paymentMode !== "recurring") reject("provider-fact-mismatch")
  const invoice = event.data.object as Stripe.Invoice
  if (invoice.object !== "invoice") reject("provider-fact-mismatch")

  const invoiceId = requiredProviderId(invoice.id, "in_")
  const customerId = expandableId(invoice.customer, "cus_")
  const subscriptionId = expandableId(invoice.subscription, "sub_")
  if (!customerId || !subscriptionId) reject("provider-fact-mismatch")
  await assertRecurringProviderChain(
    boundary,
    metadata,
    customerId,
    subscriptionId,
    dependencies,
  )

  if (invoice.currency?.toUpperCase() !== boundary.chargedCurrency) {
    reject("provider-fact-mismatch")
  }
  const period = exactRecurringInvoicePeriod(invoice, subscriptionId, boundary)
  if (
    invoice.billing_reason !== "subscription_create" &&
    invoice.billing_reason !== "subscription_cycle"
  ) {
    reject("provider-fact-mismatch")
  }

  const facts = baseFacts("invoice", invoiceId)
  facts.factParentProviderObjectType = "checkout_session"
  facts.factParentProviderObjectId = boundary.providerObjectId
  facts.factProviderCustomerId = customerId
  facts.factProviderSubscriptionId = subscriptionId

  if (event.type === "invoice.payment_failed") {
    if (
      invoice.status !== "open" ||
      invoice.paid !== false ||
      invoice.attempted !== true ||
      !Number.isSafeInteger(invoice.attempt_count) ||
      invoice.attempt_count < 1 ||
      invoice.amount_due !== boundary.chargedAmountMinor ||
      invoice.amount_paid !== 0 ||
      invoice.amount_remaining !== boundary.chargedAmountMinor
    ) {
      reject("provider-fact-mismatch")
    }
    facts.factFailureCode = "stripe_invoice_payment_failed"
    return facts
  }

  if (
    invoice.status !== "paid" ||
    invoice.paid_out_of_band !== false ||
    invoice.amount_due !== boundary.chargedAmountMinor
  ) {
    reject("provider-fact-mismatch")
  }
  assertCurrencyAndAmount(boundary, invoice.amount_paid, invoice.currency)
  facts.factPaymentStatus = "paid"
  facts.factProviderMovementType = "invoice"
  facts.factProviderMovementId = invoiceId
  facts.factBaseAmountUsdCents = boundary.baseAmountUsdCents
  facts.factChargedAmountMinor = boundary.chargedAmountMinor
  facts.factChargedCurrency = boundary.chargedCurrency
  facts.factConversionRate = boundary.conversionRate
  facts.factPeriodStart = period.start
  facts.factPeriodEnd = period.end
  return facts
}

function lifecycleState(status: Stripe.Subscription.Status): string {
  if (status === "active") return "active"
  if (status === "canceled") return "cancelled"
  if (
    status === "incomplete" ||
    status === "incomplete_expired" ||
    status === "past_due" ||
    status === "unpaid"
  ) {
    return "incomplete"
  }
  reject("provider-fact-mismatch")
}

async function subscriptionFacts(
  event: Stripe.Event,
  boundary: AuthoritativeStripePaymentBoundary,
  metadata: ServerIntentStripeMetadata,
  dependencies: ServerIntentStripeWebhookDependencies,
): Promise<TypedFacts> {
  if (boundary.paymentMode !== "recurring") reject("provider-fact-mismatch")
  const subscription = event.data.object as Stripe.Subscription
  if (subscription.object !== "subscription") reject("provider-fact-mismatch")

  const subscriptionId = requiredProviderId(subscription.id, "sub_")
  const customerId = expandableId(subscription.customer, "cus_")
  if (
    !customerId ||
    subscription.collection_method !== "charge_automatically" ||
    subscription.trial_start !== null ||
    subscription.trial_end !== null ||
    subscription.pause_collection !== null
  ) {
    reject("provider-fact-mismatch")
  }
  await assertRecurringProviderChain(
    boundary,
    metadata,
    customerId,
    subscriptionId,
    dependencies,
  )

  if (subscription.items.data.length !== 1) reject("provider-fact-mismatch")
  const item = subscription.items.data[0]
  if (
    item.quantity !== 1 ||
    item.price.unit_amount !== boundary.chargedAmountMinor ||
    item.price.currency.toUpperCase() !== boundary.chargedCurrency ||
    item.price.recurring?.interval !== boundary.recurrenceInterval ||
    item.price.recurring.interval_count !== 1
  ) {
    reject("provider-fact-mismatch")
  }
  const period = normalizedPeriod(
    subscription.current_period_start,
    subscription.current_period_end,
  )
  const state = lifecycleState(subscription.status)
  if (event.type === "customer.subscription.deleted" && state !== "cancelled") {
    reject("provider-fact-mismatch")
  }

  const facts = baseFacts("subscription", subscriptionId)
  facts.factParentProviderObjectType = "checkout_session"
  facts.factParentProviderObjectId = boundary.providerObjectId
  facts.factProviderCustomerId = customerId
  facts.factProviderSubscriptionId = subscriptionId
  facts.factPeriodStart = period.start
  facts.factPeriodEnd = period.end
  facts.factLifecycleState = state
  return facts
}

async function typedFacts(
  event: Stripe.Event,
  boundary: AuthoritativeStripePaymentBoundary,
  metadata: ServerIntentStripeMetadata,
  dependencies: ServerIntentStripeWebhookDependencies,
): Promise<TypedFacts> {
  if (event.type.startsWith("checkout.session.")) {
    return checkoutFacts(event, boundary, metadata, dependencies)
  }
  if (event.type.startsWith("invoice.")) {
    return invoiceFacts(event, boundary, metadata, dependencies)
  }
  return subscriptionFacts(event, boundary, metadata, dependencies)
}

function occurredAt(event: Stripe.Event): string {
  if (!Number.isSafeInteger(event.created) || event.created < 1) {
    reject("provider-fact-mismatch")
  }
  return new Date(event.created * 1000).toISOString()
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
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
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

/**
 * Digests immutable Event fields rather than delivery counters, so a genuine
 * Stripe redelivery can match the first stored evidence without weakening the
 * typed financial comparisons in the database.
 */
export function stripeEventImmutableDigest(event: Stripe.Event): Buffer {
  const canonical = canonicalJson({
    account: event.account ?? null,
    api_version: event.api_version,
    created: event.created,
    data: event.data,
    id: event.id,
    livemode: event.livemode,
    object: event.object,
    type: event.type,
  })
  if (!canonical) reject("invalid-payload")
  return sha256Digest(Buffer.from(canonical, "utf8"))
}

function signatureVerifiedAt(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw infrastructure()
  }
  return now.toISOString()
}

function encryptedPayload(
  rawPayload: string,
  event: Stripe.Event,
  crypto: SponsorshipCrypto,
): {
  ciphertext: SupabaseRpcBytea
  immutableSha256: SupabaseRpcBytea
  deliverySha256Hex: string
} {
  const payload = Buffer.from(rawPayload, "utf8")
  if (payload.length === 0 || payload.length > MAXIMUM_SIGNED_PAYLOAD_BYTES) {
    reject("payload-too-large")
  }
  try {
    const envelope = crypto.encryptSecretPayload(payload)
    return {
      ciphertext: envelope.ciphertextRpcBytea,
      immutableSha256: toSupabaseRpcBytea(stripeEventImmutableDigest(event)),
      deliverySha256Hex: sha256Digest(payload).toString("hex"),
    }
  } catch {
    throw infrastructure()
  } finally {
    payload.fill(0)
  }
}

function quarantineObjectIdentity(event: Stripe.Event): {
  providerObjectType: string | null
  providerObjectId: string | null
} {
  const object = event.data?.object as unknown
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    return { providerObjectType: null, providerObjectId: null }
  }

  const candidate = object as Record<string, unknown>
  const objectType = candidate.object
  const objectId = candidate.id
  if (
    typeof objectType !== "string" ||
    !/^[a-z][a-z0-9_.]{0,79}$/.test(objectType) ||
    typeof objectId !== "string" ||
    objectId.length < 1 ||
    objectId.length > 255 ||
    !/^[A-Za-z0-9_]+$/.test(objectId)
  ) {
    return { providerObjectType: null, providerObjectId: null }
  }

  return {
    providerObjectType: objectType.replaceAll(".", "_"),
    providerObjectId: objectId,
  }
}

function quarantineOccurredAt(event: Stripe.Event, now: Date): string {
  if (
    Number.isSafeInteger(event.created) &&
    event.created >= 1 &&
    event.created * 1000 <= now.getTime() + 5 * 60 * 1000
  ) {
    return new Date(event.created * 1000).toISOString()
  }
  return now.toISOString()
}

export async function quarantineVerifiedStripeEvent(
  input: {
    event: Stripe.Event
    region: StripeRegion
    rawPayload: string
    requestContext: StripeWebhookRequestContext
    error: ServerIntentStripeWebhookError
  },
  dependencies: ServerIntentStripeWebhookDependencies,
): Promise<QuarantinedStripeWebhookResult> {
  const now = dependencies.now()
  const verifiedAt = signatureVerifiedAt(now)
  const payload = encryptedPayload(
    input.rawPayload,
    input.event,
    dependencies.crypto,
  )
  const providerEventId = requiredProviderId(input.event.id, "evt_")
  const objectIdentity = quarantineObjectIdentity(input.event)
  const reason = `Verified Stripe event requires review: ${input.error.code}`

  let result: VerifiedStripeQuarantineResult
  try {
    result = await dependencies.quarantineVerifiedEvent({
      providerAccountScope: `stripe_${input.region}`,
      providerEventId,
      eventType: input.event.type,
      ...objectIdentity,
      redactedPayload: {
        redaction_version: "stripe_verified_quarantine_v1",
        provider: "STRIPE",
        source: "verified_webhook",
        event_type: input.event.type,
        error_code: input.error.code,
        delivery_payload_sha256: payload.deliverySha256Hex,
        stripe_signature: input.requestContext.signatureHeader,
        webhook_secret_version: input.requestContext.webhookSecretVersion,
      },
      payloadCiphertext: payload.ciphertext,
      payloadSha256: payload.immutableSha256,
      signatureVerifiedAt: verifiedAt,
      occurredAt: quarantineOccurredAt(input.event, now),
      verificationMethod: "stripe_webhook_signature",
      errorCode: input.error.code,
      reason,
      requestContext: input.requestContext,
    })
  } catch {
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

export async function ingestServerIntentStripeEvent(
  input: {
    event: Stripe.Event
    region: StripeRegion
    rawPayload: string
    requestContext: StripeWebhookRequestContext
    classification?: ServerIntentStripeClassification
  },
  dependencies: ServerIntentStripeWebhookDependencies,
): Promise<ServerIntentStripeWebhookResult> {
  const classification =
    input.classification ?? classifyServerIntentStripeEvent(input.event)
  if (classification.kind === "not-server-intent") return { handled: false }
  if (!SUPPORTED_EVENT_TYPES.has(input.event.type)) reject("unsupported-event")

  const expectedScope = `stripe_${input.region}`
  if (classification.metadata.providerAccountScope !== expectedScope) {
    reject("invalid-metadata")
  }
  const verifiedAt = signatureVerifiedAt(dependencies.now())

  let boundary: AuthoritativeStripePaymentBoundary
  try {
    boundary = await dependencies.loadPaymentBoundary(
      classification.metadata.paymentAttemptId,
    )
  } catch (error) {
    if (error instanceof ServerIntentStripeWebhookError) throw error
    throw infrastructure()
  }
  validateBoundary(boundary, classification.metadata, expectedScope)

  const facts = await typedFacts(
    input.event,
    boundary,
    classification.metadata,
    dependencies,
  )
  const payload = encryptedPayload(
    input.rawPayload,
    input.event,
    dependencies.crypto,
  )
  const providerEventId = requiredProviderId(input.event.id, "evt_")
  const inputForDatabase: VerifiedStripeGatewayEventInput = {
    paymentAttemptId: boundary.attemptId,
    providerAccountScope: expectedScope,
    providerEventId,
    eventType: input.event.type,
    redactedPayload: {
      redaction_version: "stripe_server_intent_v1",
      provider: "STRIPE",
      source: "verified_webhook",
      schema: SERVER_INTENT_STRIPE_SCHEMA,
      event_type: input.event.type,
      provider_object_type: facts.providerObjectType,
      delivery_payload_sha256: payload.deliverySha256Hex,
      stripe_signature: input.requestContext.signatureHeader,
      webhook_secret_version: input.requestContext.webhookSecretVersion,
    },
    payloadCiphertext: payload.ciphertext,
    payloadSha256: payload.immutableSha256,
    signatureVerifiedAt: verifiedAt,
    occurredAt: occurredAt(input.event),
    verificationMethod: "stripe_webhook_signature",
    factServerPaymentAttemptId: boundary.attemptId,
    requestContext: input.requestContext,
    ...facts,
  }

  let result: VerifiedStripeGatewayEventResult
  try {
    result = await dependencies.ingestVerifiedEvent(inputForDatabase)
  } catch (error) {
    if (error instanceof ServerIntentStripeWebhookError) throw error
    throw infrastructure()
  }

  if (
    requiredUuid(result.gatewayEventId, "boundary-mismatch") !==
      result.gatewayEventId ||
    result.paymentAttemptId !== boundary.attemptId ||
    result.sponsorshipIntentId !== boundary.intentId ||
    !["received", "processing", "processed", "failed", "ignored"].includes(
      result.processingStatus,
    ) ||
    typeof result.isDuplicate !== "boolean"
  ) {
    throw infrastructure()
  }

  return { handled: true, ...result }
}

export function asServerIntentStripeWebhookError(
  error: unknown,
): ServerIntentStripeWebhookError {
  return error instanceof ServerIntentStripeWebhookError
    ? error
    : infrastructure()
}
