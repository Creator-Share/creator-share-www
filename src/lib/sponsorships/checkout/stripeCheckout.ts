import "server-only"

import type Stripe from "stripe"

import { MINIMUM_OPEN_SPONSORSHIP_CENTS } from "@/config/beneficiaryTypes"
import {
  ADVOCATE_STAGING_TENANT_ROOT,
  resolveAdvocateHost,
  type AdvocateHostResolution,
} from "@/lib/advocates/host"
import type {
  OpaqueToken,
  SponsorshipCrypto,
  VersionedEmailDigest,
} from "@/lib/sponsorships/crypto"
import {
  toSupabaseRpcBytea,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import {
  sponsorshipVisitorDigestFromToken,
  type VerifiedSponsorshipVisitorToken,
} from "@/lib/sponsorships/visitorCookie"
export { readSponsorshipVisitorCookie } from "@/lib/sponsorships/visitorCookie"
import type { StripeRegion } from "@/lib/stripe/config"
import { getStripeRegionForPaymentCurrency } from "@/lib/stripe/currencyRouting"
import {
  convertUsdCentsToCurrency,
  isSupportedCurrency,
  type SupportedCurrency,
} from "@/utils/currency"
import {
  buildStripeProviderRequestTemplateClaims,
  createStripeProviderRequestTemplate,
  openSealedStripeProviderRequest,
  sealStripeProviderRequest,
  type SealedStripeProviderRequest,
  type StripeProviderRequestTemplateClaims,
} from "@/lib/sponsorships/checkout/stripeProviderRequest"
import { stripeCheckoutReturnUrls } from "@/lib/sponsorships/checkout/providerReturnUrls"

export const BLIND_SPONSORSHIP_AMOUNT_USD_CENTS = 3333
export const SPONSORSHIP_CURRENCY_RATE_SOURCE =
  "creator-share-config-rates-2026-05-28"

const MAXIMUM_SPONSORSHIP_USD_CENTS = 2_147_483_647
const CHECKOUT_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{43}$/
const CHECKOUT_SESSION_LIFETIME_SECONDS = 31 * 60
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STRIPE_CHECKOUT_SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9]+$/

export type SponsorshipIntentSource = "primary_site" | "advocate_domain"
export type SponsorshipSubjectKind = "standard" | "blind" | "partnership"
export type PartnershipProject =
  "emergency" | "education" | "shelter" | "nutrition" | "general"
export type SponsorshipPaymentMode = "one_time" | "recurring"
export type SponsorshipPaymentProvider = "STRIPE" | "PAYPAL"

export interface AuthenticatedCheckoutUser {
  id: string
  email: string
}

export interface SponsorshipCheckoutRequestContext {
  requestId: string
  traceId: string | null
  clientIp: string | null
  userAgent: string | null
}

export interface ResolvedSponsorshipCheckoutHost {
  source: SponsorshipIntentSource
  advocateHostname: string | null
  checkoutBaseUrl: string
}

export interface AuthoritativeBeneficiary {
  id: string
  name: string | null
  budgetGoalUsdCents: number
  imageUrl: string | null
}

export interface PrepareIntentInput {
  idempotencyKey: string
  source: SponsorshipIntentSource
  advocateHostname: string | null
  visitorTokenDigest: SupabaseRpcBytea | null
  authUserId: string | null
  contactEmailDigest: VersionedEmailDigest
  subjectKind: SponsorshipSubjectKind
  beneficiaryId: string | null
  partnershipProject: PartnershipProject | null
  paymentMode: SponsorshipPaymentMode
  recurrenceInterval: "month" | "year" | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  currencyQuoteAt: string
  currencyRateSource: string
  requestId: string
  traceId: string | null
}

export interface PreparedIntent {
  sponsorshipIntentId: string
  intentStatus: string
  isReplay: boolean
}

export interface IssueQuoteInput {
  sponsorshipIntentId: string
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  idempotencyKey: string
  requestId: string
  traceId: string | null
}

export interface IssuedQuote {
  paymentQuoteId: string
  sponsorshipIntentId: string
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  expiresAt: string
}

export interface BeginPaymentInput {
  sponsorshipIntentId: string
  paymentQuoteId: string
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  providerIdempotencyKey: string
  checkoutReceiptDigest: SupabaseRpcBytea
  requestContext: SponsorshipCheckoutRequestContext
}

export interface BegunPayment {
  paymentAttemptId: string
  sponsorshipIntentId: string
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  paymentMode: SponsorshipPaymentMode
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
}

export interface AttachProviderObjectInput {
  paymentAttemptId: string
  providerObjectId: string
  expiresAt: string
  requestContext: SponsorshipCheckoutRequestContext
}

export interface HostedStripeSessionInput {
  idempotencyKey: string
  customerEmail: string
  productName: string
  productImageUrl: string | null
  sponsorshipIntentId: string
  paymentAttemptId: string
  providerAccountScope: string
  paymentMode: SponsorshipPaymentMode
  recurrenceInterval: "month" | "year" | null
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  checkoutBaseUrl: string
  stripeRegion: StripeRegion
  expiresAtUnixSeconds: number
}

export interface CreatedHostedStripeSession {
  id: string
  url: string
  expiresAtUnixSeconds: number
}

export interface StripeSponsorshipCheckoutDependencies {
  crypto: SponsorshipCrypto
  loadBeneficiary(id: string): Promise<AuthoritativeBeneficiary | null>
  prepareIntent(input: PrepareIntentInput): Promise<PreparedIntent>
  issueQuote(input: IssueQuoteInput): Promise<IssuedQuote>
  beginPayment(input: BeginPaymentInput): Promise<BegunPayment>
  createHostedSession(
    input: HostedStripeSessionInput,
  ): Promise<CreatedHostedStripeSession>
  attachProviderObject(input: AttachProviderObjectInput): Promise<void>
  createOperationId(): string
  now(): Date
}

export interface PrepareV2IntentInput extends Omit<
  PrepareIntentInput,
  "idempotencyKey"
> {
  checkoutOperationId: string
  checkoutReceiptDigest: SupabaseRpcBytea
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  providerIdempotencyKey: string
  idempotencyKey: string
}

export interface IssueV2QuoteInput extends IssueQuoteInput {
  checkoutOperationId: string
}

export interface RecoveredV2Checkout {
  operationId: string
  operationCreatedAt: string
  paymentAttemptId: string | null
  sponsorshipIntentId: string
  paymentQuoteId: string | null
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  intentStatus: string
  attemptStatus: string | null
  subjectKind: SponsorshipSubjectKind
  beneficiaryId: string | null
  paymentMode: SponsorshipPaymentMode
  recurrenceInterval: "month" | "year" | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
  currencyQuoteAt: string
  quoteIssuedAt: string | null
  quoteExpiresAt: string | null
  checkoutReceiptExpiresAt: string | null
  providerRequestSchemaVersion: number | null
  providerRequestFingerprint: SupabaseRpcBytea | null
  providerRequestExpiresAt: string | null
  providerRequestEncryptionKeyVersion: number | null
  providerObjectAttached: boolean
  recoveryStatus: string
  recoveryAttemptCount: number | null
  recoveryMaxAttempts: number | null
  nextReconciliationAt: string | null
}

export interface RecoverV2CheckoutInput {
  checkoutReceiptDigest: SupabaseRpcBytea
  operationId: string
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  providerIdempotencyKey: string
}

export interface BeginV2PaymentInput {
  checkoutOperationId: string
  sponsorshipIntentId: string
  paymentQuoteId: string
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  providerIdempotencyKey: string
  checkoutReceiptDigest: SupabaseRpcBytea
  providerRequest: SealedStripeProviderRequest
  providerRequestClaims: StripeProviderRequestTemplateClaims
  requestContext: SponsorshipCheckoutRequestContext
}

export interface BegunV2Payment extends BegunPayment {
  checkoutOperationId: string
  providerRequestExpiresAt: string
  replayed: boolean
}

export interface ResumeV2CheckoutInput extends RecoverV2CheckoutInput {
  requestId: string
  traceId: string | null
}

export interface ResumedV2Checkout {
  checkoutOperationId: string
  paymentAttemptId: string
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  providerIdempotencyKey: string
  attemptStatus: string
  providerObjectAttached: boolean
  providerRequestSchemaVersion: number
  providerRequestTemplateClaims: StripeProviderRequestTemplateClaims
  providerRequestFingerprint: SupabaseRpcBytea
  providerRequestExpiresAt: string
  providerRequestCiphertext: SupabaseRpcBytea
  providerRequestEncryptionKeyVersion: number
  providerRequestCiphertextSha256: SupabaseRpcBytea
  foregroundLeaseToken: string
  foregroundLeaseExpiresAt: string
}

export interface SettleV2ProviderObjectInput {
  paymentAttemptId: string
  providerObjectId: string
  providerRequestSchemaVersion: number
  providerRequestFingerprint: SupabaseRpcBytea
  providerRequestExpiresAt: string
  recoveryLeaseToken: string | null
  requestContext: SponsorshipCheckoutRequestContext
}

export interface StripeSponsorshipCheckoutV2Dependencies {
  crypto: SponsorshipCrypto
  authorizeHost(host: ResolvedSponsorshipCheckoutHost): Promise<void>
  loadBeneficiary(
    id: string,
    allowCurrentlyIneligible: boolean,
  ): Promise<AuthoritativeBeneficiary | null>
  recoverCheckout(
    input: RecoverV2CheckoutInput,
  ): Promise<RecoveredV2Checkout | null>
  prepareIntent(input: PrepareV2IntentInput): Promise<PreparedIntent>
  issueQuote(input: IssueV2QuoteInput): Promise<IssuedQuote>
  beginPayment(input: BeginV2PaymentInput): Promise<BegunV2Payment>
  resumeCheckout(input: ResumeV2CheckoutInput): Promise<ResumedV2Checkout>
  createHostedSession(
    input: HostedStripeSessionInput,
  ): Promise<CreatedHostedStripeSession>
  settleProviderObject(input: SettleV2ProviderObjectInput): Promise<void>
  now(): Date
}

export type ServerOwnedPaymentBoundaryDependencies = Pick<
  StripeSponsorshipCheckoutDependencies,
  | "crypto"
  | "prepareIntent"
  | "issueQuote"
  | "beginPayment"
  | "createOperationId"
>

export interface ServerOwnedPaymentBoundaryInput extends Omit<
  PrepareIntentInput,
  "idempotencyKey"
> {
  operationId?: string
  provider: SponsorshipPaymentProvider
  providerAccountScope: string
  providerIdempotencyPrefix: string
  requestContext: SponsorshipCheckoutRequestContext
}

export interface ServerOwnedPaymentBoundaryResult {
  preparedIntent: PreparedIntent
  quote: IssuedQuote
  paymentAttempt: BegunPayment
  checkoutReceipt: OpaqueToken
  providerIdempotencyKey: string
}

export interface CreateStripeSponsorshipCheckoutInput {
  body: unknown
  host: ResolvedSponsorshipCheckoutHost
  authenticatedUser: AuthenticatedCheckoutUser | null
  visitorToken: VerifiedSponsorshipVisitorToken | null
  requestContext: SponsorshipCheckoutRequestContext
}

export interface StripeSponsorshipCheckoutResult {
  url: string
  checkoutReceipt: string
}

export type SponsorshipCheckoutErrorCode =
  | "invalid-request"
  | "invalid-host"
  | "invalid-email"
  | "sponsorship-unavailable"
  | "checkout-failed"

export class SponsorshipCheckoutError extends Error {
  readonly code: SponsorshipCheckoutErrorCode
  readonly httpStatus: number

  constructor(
    code: SponsorshipCheckoutErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(message)
    this.name = "SponsorshipCheckoutError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export function checkoutError(
  code: SponsorshipCheckoutErrorCode,
): SponsorshipCheckoutError {
  switch (code) {
    case "invalid-request":
      return new SponsorshipCheckoutError(code, "Invalid checkout request", 400)
    case "invalid-host":
      return new SponsorshipCheckoutError(
        code,
        "Checkout is unavailable on this host",
        400,
      )
    case "invalid-email":
      return new SponsorshipCheckoutError(
        code,
        "A valid sponsor email is required",
        400,
      )
    case "sponsorship-unavailable":
      return new SponsorshipCheckoutError(
        code,
        "This sponsorship is no longer available",
        409,
      )
    default:
      return new SponsorshipCheckoutError(
        code,
        "Failed to create checkout session",
        500,
      )
  }
}

export function isCheckoutRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const isRecord = isCheckoutRecord

export function requiredCheckoutUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw checkoutError("invalid-request")
  }
  return value.toLowerCase()
}

const requiredUuid = requiredCheckoutUuid

export function selectedCheckoutCurrency(value: unknown): SupportedCurrency {
  if (value === undefined || value === null || value === "") return "USD"
  if (typeof value !== "string") throw checkoutError("invalid-request")

  const normalized = value.trim().toUpperCase()
  if (!isSupportedCurrency(normalized)) {
    throw checkoutError("invalid-request")
  }
  return normalized
}

const selectedCurrency = selectedCheckoutCurrency

export function requestedCheckoutPaymentTerms(value: unknown): {
  paymentMode: SponsorshipPaymentMode
  recurrenceInterval: "month" | "year" | null
} {
  if (value === "subscription") {
    return { paymentMode: "recurring", recurrenceInterval: "month" }
  }
  if (value === "payment") {
    return { paymentMode: "recurring", recurrenceInterval: "year" }
  }
  if (value === "one_time") {
    return { paymentMode: "one_time", recurrenceInterval: null }
  }
  throw checkoutError("invalid-request")
}

const requestedPaymentTerms = requestedCheckoutPaymentTerms

export function requestedCheckoutSubject(
  body: Record<string, unknown>,
): SponsorshipSubjectKind {
  if (body.type === "blind_sponsorship" || body.sponsorshipMode === "blind") {
    return "blind"
  }
  if (body.type === "sponsorship" || body.type === undefined) {
    return "standard"
  }
  if (body.type === "partnership") return "partnership"
  throw checkoutError("invalid-request")
}

const requestedSubject = requestedCheckoutSubject

const PARTNERSHIP_PROJECTS = new Set<PartnershipProject>([
  "emergency",
  "education",
  "shelter",
  "nutrition",
  "general",
])

export function requestedCheckoutPartnershipProject(
  subjectKind: SponsorshipSubjectKind,
  value: unknown,
): PartnershipProject | null {
  if (subjectKind !== "partnership") {
    if (value !== undefined && value !== null) {
      throw checkoutError("invalid-request")
    }
    return null
  }
  if (
    typeof value !== "string" ||
    !PARTNERSHIP_PROJECTS.has(value as PartnershipProject)
  ) {
    throw checkoutError("invalid-request")
  }
  return value as PartnershipProject
}

const requestedPartnershipProject = requestedCheckoutPartnershipProject

function requestedOpenAmount(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < MINIMUM_OPEN_SPONSORSHIP_CENTS ||
    value > MAXIMUM_SPONSORSHIP_USD_CENTS
  ) {
    throw checkoutError("invalid-request")
  }
  return value
}

export function trustedCheckoutBaseAmount(
  subjectKind: SponsorshipSubjectKind,
  beneficiary: AuthoritativeBeneficiary | null,
  requestedAmount: unknown,
): number {
  if (subjectKind === "blind") return BLIND_SPONSORSHIP_AMOUNT_USD_CENTS
  if (subjectKind === "partnership") return requestedOpenAmount(requestedAmount)
  if (!beneficiary) throw checkoutError("sponsorship-unavailable")

  if (beneficiary.budgetGoalUsdCents === -1) {
    return requestedOpenAmount(requestedAmount)
  }
  if (
    !Number.isSafeInteger(beneficiary.budgetGoalUsdCents) ||
    beneficiary.budgetGoalUsdCents < MINIMUM_OPEN_SPONSORSHIP_CENTS ||
    beneficiary.budgetGoalUsdCents > MAXIMUM_SPONSORSHIP_USD_CENTS
  ) {
    throw checkoutError("sponsorship-unavailable")
  }
  return beneficiary.budgetGoalUsdCents
}

const trustedBaseAmount = trustedCheckoutBaseAmount

export function sponsorshipCheckoutProductName(
  subjectKind: SponsorshipSubjectKind,
  beneficiary: AuthoritativeBeneficiary | null,
  paymentMode: SponsorshipPaymentMode,
  recurrenceInterval: "month" | "year" | null,
  partnershipProject: PartnershipProject | null = null,
): string {
  const cadence =
    paymentMode === "one_time"
      ? "One-time"
      : recurrenceInterval === "year"
        ? "Yearly"
        : "Monthly"

  if (subjectKind === "blind") return `${cadence} Blind Sponsorship`
  if (subjectKind === "partnership") {
    if (!partnershipProject) throw checkoutError("checkout-failed")
    const projectName =
      partnershipProject[0].toUpperCase() + partnershipProject.slice(1)
    return `${cadence} Partnership for ${projectName}`
  }

  const beneficiaryName = beneficiary?.name?.trim().slice(0, 180)
  return `${cadence} Sponsorship for ${beneficiaryName || "a Creator Share child"}`
}

const productName = sponsorshipCheckoutProductName

function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) throw checkoutError("checkout-failed")
}

function assertFinitePositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw checkoutError("checkout-failed")
  }
}

export function assertCheckoutQuoteTerms(
  quote: IssuedQuote,
  expected: {
    sponsorshipIntentId: string
    provider: SponsorshipPaymentProvider
    providerAccountScope: string
    baseAmountUsdCents: number
    chargedAmountMinor: number
    chargedCurrency: SupportedCurrency
    conversionRate: number
  },
): void {
  assertUuid(quote.paymentQuoteId)
  assertFinitePositiveInteger(quote.baseAmountUsdCents)
  assertFinitePositiveInteger(quote.chargedAmountMinor)

  if (
    quote.provider !== expected.provider ||
    quote.sponsorshipIntentId !== expected.sponsorshipIntentId ||
    quote.providerAccountScope !== expected.providerAccountScope ||
    quote.baseAmountUsdCents !== expected.baseAmountUsdCents ||
    quote.chargedAmountMinor !== expected.chargedAmountMinor ||
    quote.chargedCurrency !== expected.chargedCurrency ||
    quote.conversionRate !== expected.conversionRate
  ) {
    throw checkoutError("checkout-failed")
  }
}

const assertQuoteTerms = assertCheckoutQuoteTerms

export function assertCheckoutProviderTerms(
  quote: IssuedQuote,
  attempt: BegunPayment,
  expected: {
    sponsorshipIntentId: string
    provider: SponsorshipPaymentProvider
    providerAccountScope: string
    paymentMode: SponsorshipPaymentMode
    baseAmountUsdCents: number
    chargedAmountMinor: number
    chargedCurrency: SupportedCurrency
    conversionRate: number
  },
): void {
  assertQuoteTerms(quote, expected)
  assertUuid(attempt.paymentAttemptId)
  assertFinitePositiveInteger(attempt.baseAmountUsdCents)
  assertFinitePositiveInteger(attempt.chargedAmountMinor)

  if (
    attempt.provider !== expected.provider ||
    attempt.sponsorshipIntentId !== expected.sponsorshipIntentId ||
    attempt.providerAccountScope !== expected.providerAccountScope ||
    attempt.paymentMode !== expected.paymentMode ||
    attempt.baseAmountUsdCents !== expected.baseAmountUsdCents ||
    attempt.chargedAmountMinor !== expected.chargedAmountMinor ||
    attempt.chargedCurrency !== expected.chargedCurrency ||
    attempt.conversionRate !== expected.conversionRate
  ) {
    throw checkoutError("checkout-failed")
  }
}

const assertProviderTerms = assertCheckoutProviderTerms

function checkoutMetadata(
  input: HostedStripeSessionInput,
): Record<string, string> {
  return {
    creatorshare_platform: "true",
    sponsorship_schema: "server_intent_v1",
    sponsorship_intent_id: input.sponsorshipIntentId,
    payment_attempt_id: input.paymentAttemptId,
    provider_account_scope: input.providerAccountScope,
  }
}

/**
 * Builds one Hosted Checkout request from terms that have already crossed the
 * database payment boundary. No browser supplied descriptive or financial
 * field reaches Stripe through this function.
 */
export function buildHostedStripeSessionParams(
  input: HostedStripeSessionInput,
): Stripe.Checkout.SessionCreateParams {
  const metadata = checkoutMetadata(input)
  const returnUrls = stripeCheckoutReturnUrls(input.checkoutBaseUrl)

  const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
    currency: input.chargedCurrency.toLowerCase(),
    unit_amount: input.chargedAmountMinor,
    product_data: {
      name: input.productName,
      ...(input.productImageUrl ? { images: [input.productImageUrl] } : {}),
      metadata,
    },
    ...(input.paymentMode === "recurring"
      ? { recurring: { interval: input.recurrenceInterval || "month" } }
      : {}),
  }

  return {
    payment_method_types: ["card"],
    mode: input.paymentMode === "one_time" ? "payment" : "subscription",
    client_reference_id: input.paymentAttemptId,
    line_items: [{ price_data: priceData, quantity: 1 }],
    billing_address_collection: "required",
    payment_method_options: {
      card: { request_three_d_secure: "automatic" },
    },
    customer_email: input.customerEmail,
    metadata,
    ...(input.paymentMode === "recurring"
      ? { subscription_data: { metadata } }
      : { payment_intent_data: { metadata } }),
    success_url: returnUrls.successUrl,
    cancel_url: returnUrls.cancelUrl,
    expires_at: input.expiresAtUnixSeconds,
  }
}

function allowedPrimaryHostname(
  resolution: AdvocateHostResolution,
  allowedPrimaryHostnames: ReadonlySet<string>,
  allowLocalhostDevelopment: boolean,
  allowStagingEnvironment: boolean,
): string | null {
  if (resolution.kind !== "non-tenant") return null

  const hostname = resolution.normalizedHostname
  if (allowStagingEnvironment) {
    return hostname === ADVOCATE_STAGING_TENANT_ROOT ? hostname : null
  }
  if (
    hostname === "creatorshare.com" ||
    hostname === "www.creatorshare.com" ||
    allowedPrimaryHostnames.has(hostname)
  ) {
    return hostname
  }
  if (
    allowLocalhostDevelopment &&
    (resolution.reason === "localhost-root" ||
      resolution.reason === "loopback-address")
  ) {
    return hostname
  }
  return null
}

export function resolveSponsorshipCheckoutHost(
  rawHost: string | null,
  options: {
    allowLocalhostDevelopment: boolean
    allowStagingEnvironment?: boolean
    allowedPrimaryHostnames?: Iterable<string>
  },
): ResolvedSponsorshipCheckoutHost {
  const resolution = resolveAdvocateHost(rawHost, {
    allowLocalhostDevelopment: options.allowLocalhostDevelopment,
    allowStagingEnvironment: options.allowStagingEnvironment,
  })
  if (resolution.kind === "invalid") throw checkoutError("invalid-host")

  if (resolution.kind === "tenant-candidate") {
    const protocol =
      resolution.environment === "local-development" ? "http" : "https"
    const port =
      resolution.requestPort === null ? "" : `:${resolution.requestPort}`
    return {
      source: "advocate_domain",
      advocateHostname: resolution.domainLookup.hostname,
      checkoutBaseUrl: `${protocol}://${resolution.requestHostname}${port}`,
    }
  }

  const allowedPrimaryHostnames = new Set(
    [...(options.allowedPrimaryHostnames || [])].map((hostname) =>
      hostname.toLowerCase(),
    ),
  )
  const hostname = allowedPrimaryHostname(
    resolution,
    allowedPrimaryHostnames,
    options.allowLocalhostDevelopment,
    options.allowStagingEnvironment === true,
  )
  if (!hostname) throw checkoutError("invalid-host")

  const protocol =
    options.allowLocalhostDevelopment &&
    (resolution.reason === "localhost-root" ||
      resolution.reason === "loopback-address")
      ? "http"
      : "https"
  const port = resolution.port === null ? "" : `:${resolution.port}`
  return {
    source: "primary_site",
    advocateHostname: null,
    checkoutBaseUrl: `${protocol}://${hostname}${port}`,
  }
}

export function sponsorshipVisitorDigest(
  visitorToken: VerifiedSponsorshipVisitorToken | null,
): SupabaseRpcBytea | null {
  if (visitorToken === null) return null
  const digest = sponsorshipVisitorDigestFromToken(visitorToken)
  return digest === null ? null : toSupabaseRpcBytea(digest)
}

const visitorDigest = sponsorshipVisitorDigest

function safeOperationId(createOperationId: () => string): string {
  const operationId = createOperationId()
  if (!UUID_PATTERN.test(operationId)) throw checkoutError("checkout-failed")
  return operationId.toLowerCase()
}

export function validCheckoutDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw checkoutError("checkout-failed")
  }
  return value
}

const validDate = validCheckoutDate

/**
 * Shared transaction boundary for every sponsorship gateway. A provider may
 * create its external object only after this sequence returns the immutable
 * intent, server quote, payment attempt, and opaque browser receipt.
 */
export async function prepareServerOwnedSponsorshipPayment(
  input: ServerOwnedPaymentBoundaryInput,
  dependencies: ServerOwnedPaymentBoundaryDependencies,
): Promise<ServerOwnedPaymentBoundaryResult> {
  const {
    operationId: requestedOperationId,
    provider,
    providerAccountScope,
    providerIdempotencyPrefix,
    requestContext,
    ...intentInput
  } = input
  if (
    !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(providerIdempotencyPrefix) ||
    !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(providerAccountScope)
  ) {
    throw checkoutError("checkout-failed")
  }

  const operationId = requestedOperationId
    ? requiredUuid(requestedOperationId)
    : safeOperationId(dependencies.createOperationId)
  const receipt = dependencies.crypto.deriveCheckoutReceipt(operationId)
  assertReceipt(receipt)

  const preparedIntent = await dependencies.prepareIntent({
    ...intentInput,
    idempotencyKey: `checkout:${operationId}`,
  })
  assertUuid(preparedIntent.sponsorshipIntentId)
  const acceptableStatus = preparedIntent.isReplay
    ? ["created", "committed", "processing", "succeeded"].includes(
        preparedIntent.intentStatus,
      )
    : preparedIntent.intentStatus === "created"
  if (!acceptableStatus) {
    throw checkoutError("sponsorship-unavailable")
  }

  const quote = await dependencies.issueQuote({
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    provider,
    providerAccountScope,
    idempotencyKey: `quote:${operationId}`,
    requestId: intentInput.requestId,
    traceId: intentInput.traceId,
  })
  const providerIdempotencyKey = `${providerIdempotencyPrefix}:${operationId}`
  const paymentAttempt = await dependencies.beginPayment({
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    paymentQuoteId: quote.paymentQuoteId,
    provider,
    providerAccountScope,
    providerIdempotencyKey,
    checkoutReceiptDigest: receipt.digestRpcBytea,
    requestContext,
  })

  assertProviderTerms(quote, paymentAttempt, {
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    provider,
    providerAccountScope,
    paymentMode: intentInput.paymentMode,
    baseAmountUsdCents: intentInput.baseAmountUsdCents,
    chargedAmountMinor: intentInput.chargedAmountMinor,
    chargedCurrency: intentInput.chargedCurrency,
    conversionRate: intentInput.conversionRate,
  })

  return {
    preparedIntent,
    quote,
    paymentAttempt,
    checkoutReceipt: receipt,
    providerIdempotencyKey,
  }
}

function isTrustedStripeCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.hostname === "checkout.stripe.com" &&
      url.username === "" &&
      url.password === ""
    )
  } catch {
    return false
  }
}

function assertReceipt(receipt: OpaqueToken): void {
  if (
    typeof receipt.token !== "string" ||
    !CHECKOUT_RECEIPT_PATTERN.test(receipt.token) ||
    !/^\\x[0-9a-f]{64}$/.test(receipt.digestRpcBytea)
  ) {
    throw checkoutError("checkout-failed")
  }
}

export async function createStripeSponsorshipCheckout(
  input: CreateStripeSponsorshipCheckoutInput,
  dependencies: StripeSponsorshipCheckoutDependencies,
): Promise<StripeSponsorshipCheckoutResult> {
  if (!isRecord(input.body)) throw checkoutError("invalid-request")

  const subjectKind = requestedSubject(input.body)
  const partnershipProject = requestedPartnershipProject(
    subjectKind,
    input.body.project,
  )
  const requestedTerms = requestedPaymentTerms(input.body.paymentType)
  if (
    (subjectKind === "blind" || subjectKind === "partnership") &&
    requestedTerms.paymentMode === "one_time"
  ) {
    throw checkoutError("invalid-request")
  }

  const beneficiaryId =
    subjectKind === "standard" ? requiredUuid(input.body.beneficiaryId) : null
  const beneficiary = beneficiaryId
    ? await dependencies.loadBeneficiary(beneficiaryId)
    : null
  if (beneficiaryId && (!beneficiary || beneficiary.id !== beneficiaryId)) {
    throw checkoutError("sponsorship-unavailable")
  }

  const baseAmountUsdCents = trustedBaseAmount(
    subjectKind,
    beneficiary,
    input.body.amount,
  )
  const currency = selectedCurrency(input.body.currency)
  const conversion = convertUsdCentsToCurrency(baseAmountUsdCents, currency)
  const stripeRegion = getStripeRegionForPaymentCurrency(
    conversion.chargedCurrency,
  )
  const providerAccountScope = `stripe_${stripeRegion}`

  const sponsorEmail =
    input.authenticatedUser?.email ??
    (typeof input.body.email === "string" ? input.body.email : "")
  let contactEmailDigest: VersionedEmailDigest
  try {
    contactEmailDigest = dependencies.crypto.digestEmail(sponsorEmail)
  } catch {
    throw checkoutError("invalid-email")
  }

  const currencyQuoteAt = validDate(dependencies.now())
  const requestedOperationId =
    input.body.checkoutRequestId === undefined
      ? undefined
      : requiredUuid(input.body.checkoutRequestId)
  const boundary = await prepareServerOwnedSponsorshipPayment(
    {
      operationId: requestedOperationId,
      source: input.host.source,
      advocateHostname: input.host.advocateHostname,
      visitorTokenDigest: visitorDigest(input.visitorToken),
      authUserId: input.authenticatedUser?.id ?? null,
      contactEmailDigest,
      subjectKind,
      beneficiaryId,
      partnershipProject,
      paymentMode: requestedTerms.paymentMode,
      recurrenceInterval: requestedTerms.recurrenceInterval,
      baseAmountUsdCents,
      chargedAmountMinor: conversion.chargedAmountMinor,
      chargedCurrency: conversion.chargedCurrency,
      conversionRate: conversion.conversionRate,
      currencyQuoteAt: currencyQuoteAt.toISOString(),
      currencyRateSource: SPONSORSHIP_CURRENCY_RATE_SOURCE,
      requestId: input.requestContext.requestId,
      traceId: input.requestContext.traceId,
      provider: "STRIPE",
      providerAccountScope,
      providerIdempotencyPrefix: "stripe-checkout",
      requestContext: input.requestContext,
    },
    dependencies,
  )
  const attempt = boundary.paymentAttempt

  const sessionCreationAt = validDate(dependencies.now())
  if (sessionCreationAt.getTime() < currencyQuoteAt.getTime()) {
    throw checkoutError("checkout-failed")
  }
  const expiresAtUnixSeconds =
    Math.floor(sessionCreationAt.getTime() / 1000) +
    CHECKOUT_SESSION_LIFETIME_SECONDS
  const hostedSession = await dependencies.createHostedSession({
    idempotencyKey: boundary.providerIdempotencyKey,
    customerEmail: contactEmailDigest.normalizedEmail,
    productName: productName(
      subjectKind,
      beneficiary,
      attempt.paymentMode,
      requestedTerms.recurrenceInterval,
      partnershipProject,
    ),
    productImageUrl: beneficiary?.imageUrl ?? null,
    sponsorshipIntentId: attempt.sponsorshipIntentId,
    paymentAttemptId: attempt.paymentAttemptId,
    providerAccountScope: attempt.providerAccountScope,
    paymentMode: attempt.paymentMode,
    recurrenceInterval: requestedTerms.recurrenceInterval,
    chargedAmountMinor: attempt.chargedAmountMinor,
    chargedCurrency: attempt.chargedCurrency,
    checkoutBaseUrl: input.host.checkoutBaseUrl,
    stripeRegion,
    expiresAtUnixSeconds,
  })

  if (
    !STRIPE_CHECKOUT_SESSION_ID_PATTERN.test(hostedSession.id) ||
    !isTrustedStripeCheckoutUrl(hostedSession.url) ||
    !Number.isSafeInteger(hostedSession.expiresAtUnixSeconds) ||
    hostedSession.expiresAtUnixSeconds !== expiresAtUnixSeconds
  ) {
    throw checkoutError("checkout-failed")
  }

  await dependencies.attachProviderObject({
    paymentAttemptId: attempt.paymentAttemptId,
    providerObjectId: hostedSession.id,
    expiresAt: new Date(
      hostedSession.expiresAtUnixSeconds * 1000,
    ).toISOString(),
    requestContext: input.requestContext,
  })

  return {
    url: hostedSession.url,
    checkoutReceipt: boundary.checkoutReceipt.token,
  }
}

function validTimestamp(value: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw checkoutError("checkout-failed")
  }
  return new Date(value).toISOString()
}

export function assertRecoveredSponsorshipCheckoutTerms(
  recovered: RecoveredV2Checkout,
  expected: {
    operationId: string
    provider: SponsorshipPaymentProvider
    providerAccountScope: string
    subjectKind: SponsorshipSubjectKind
    beneficiaryId: string | null
    paymentMode: SponsorshipPaymentMode
    recurrenceInterval: "month" | "year" | null
    baseAmountUsdCents: number
    chargedCurrency: SupportedCurrency
  },
): void {
  assertUuid(recovered.operationId)
  assertUuid(recovered.sponsorshipIntentId)
  assertFinitePositiveInteger(recovered.baseAmountUsdCents)
  assertFinitePositiveInteger(recovered.chargedAmountMinor)
  validTimestamp(recovered.operationCreatedAt)
  validTimestamp(recovered.currencyQuoteAt)
  if (
    recovered.operationId !== expected.operationId ||
    recovered.provider !== expected.provider ||
    recovered.providerAccountScope !== expected.providerAccountScope ||
    recovered.subjectKind !== expected.subjectKind ||
    recovered.beneficiaryId !== expected.beneficiaryId ||
    recovered.paymentMode !== expected.paymentMode ||
    recovered.recurrenceInterval !== expected.recurrenceInterval ||
    recovered.baseAmountUsdCents !== expected.baseAmountUsdCents ||
    recovered.chargedCurrency !== expected.chargedCurrency ||
    !Number.isFinite(recovered.conversionRate) ||
    recovered.conversionRate <= 0 ||
    Math.round(recovered.baseAmountUsdCents * recovered.conversionRate) !==
      recovered.chargedAmountMinor
  ) {
    throw checkoutError("sponsorship-unavailable")
  }
}

const assertRecoveredCheckoutTerms = assertRecoveredSponsorshipCheckoutTerms

export function sponsorshipQuoteFromRecoveredCheckout(
  recovered: RecoveredV2Checkout,
): IssuedQuote | null {
  if (!recovered.paymentQuoteId) return null
  assertUuid(recovered.paymentQuoteId)
  if (!recovered.quoteIssuedAt || !recovered.quoteExpiresAt) {
    throw checkoutError("checkout-failed")
  }
  validTimestamp(recovered.quoteIssuedAt)
  validTimestamp(recovered.quoteExpiresAt)
  return {
    paymentQuoteId: recovered.paymentQuoteId,
    sponsorshipIntentId: recovered.sponsorshipIntentId,
    provider: recovered.provider,
    providerAccountScope: recovered.providerAccountScope,
    baseAmountUsdCents: recovered.baseAmountUsdCents,
    chargedAmountMinor: recovered.chargedAmountMinor,
    chargedCurrency: recovered.chargedCurrency,
    conversionRate: recovered.conversionRate,
    expiresAt: recovered.quoteExpiresAt,
  }
}

const quoteFromRecoveredCheckout = sponsorshipQuoteFromRecoveredCheckout

function sealedRequestFromResume(
  resumed: ResumedV2Checkout,
): SealedStripeProviderRequest {
  if (resumed.providerRequestSchemaVersion !== 1) {
    throw checkoutError("checkout-failed")
  }
  return {
    schemaVersion: resumed.providerRequestSchemaVersion,
    fingerprint: resumed.providerRequestFingerprint,
    expiresAt: validTimestamp(resumed.providerRequestExpiresAt),
    ciphertext: resumed.providerRequestCiphertext,
    encryptionKeyVersion: resumed.providerRequestEncryptionKeyVersion,
    ciphertextSha256: resumed.providerRequestCiphertextSha256,
  }
}

export function assertResumedSponsorshipCheckout(
  resumed: Omit<ResumedV2Checkout, "providerRequestTemplateClaims">,
  expected: {
    operationId: string
    paymentAttemptId: string
    provider: SponsorshipPaymentProvider
    providerAccountScope: string
    providerIdempotencyKey: string
    now: Date
  },
): void {
  const activeAttemptState =
    (resumed.attemptStatus === "created" && !resumed.providerObjectAttached) ||
    (resumed.attemptStatus === "pending" && resumed.providerObjectAttached)
  if (
    resumed.checkoutOperationId !== expected.operationId ||
    resumed.paymentAttemptId !== expected.paymentAttemptId ||
    resumed.provider !== expected.provider ||
    resumed.providerAccountScope !== expected.providerAccountScope ||
    resumed.providerIdempotencyKey !== expected.providerIdempotencyKey ||
    !activeAttemptState ||
    !UUID_PATTERN.test(resumed.foregroundLeaseToken) ||
    Date.parse(resumed.foregroundLeaseExpiresAt) <=
      validDate(expected.now).getTime()
  ) {
    throw checkoutError("checkout-failed")
  }
}

const assertResumedCheckout = assertResumedSponsorshipCheckout

export function sponsorshipProviderRequestExpiresAt(now: Date): string {
  const wholeSecond = Math.floor(validDate(now).getTime() / 1000)
  return new Date(
    (wholeSecond + CHECKOUT_SESSION_LIFETIME_SECONDS) * 1000,
  ).toISOString()
}

const providerRequestExpiresAt = sponsorshipProviderRequestExpiresAt

async function createAndSettleHostedStripeSession(options: {
  request: ReturnType<typeof openSealedStripeProviderRequest>
  sealed: SealedStripeProviderRequest
  recoveryLeaseToken: string | null
  requestContext: SponsorshipCheckoutRequestContext
  dependencies: StripeSponsorshipCheckoutV2Dependencies
}): Promise<CreatedHostedStripeSession> {
  const { request, sealed, recoveryLeaseToken, requestContext, dependencies } =
    options
  if (
    Math.floor(Date.parse(sealed.expiresAt) / 1000) !==
    request.expiresAtUnixSeconds
  ) {
    throw checkoutError("checkout-failed")
  }
  const hostedSession = await dependencies.createHostedSession({
    idempotencyKey: request.idempotencyKey,
    customerEmail: request.customerEmail,
    productName: request.productName,
    productImageUrl: request.productImageUrl,
    sponsorshipIntentId: request.sponsorshipIntentId,
    paymentAttemptId: request.paymentAttemptId,
    providerAccountScope: request.providerAccountScope,
    paymentMode: request.paymentMode,
    recurrenceInterval: request.recurrenceInterval,
    chargedAmountMinor: request.chargedAmountMinor,
    chargedCurrency: request.chargedCurrency,
    checkoutBaseUrl: request.checkoutBaseUrl,
    stripeRegion: request.stripeRegion,
    expiresAtUnixSeconds: request.expiresAtUnixSeconds,
  })

  if (
    !STRIPE_CHECKOUT_SESSION_ID_PATTERN.test(hostedSession.id) ||
    !isTrustedStripeCheckoutUrl(hostedSession.url) ||
    !Number.isSafeInteger(hostedSession.expiresAtUnixSeconds) ||
    hostedSession.expiresAtUnixSeconds !== request.expiresAtUnixSeconds
  ) {
    throw checkoutError("checkout-failed")
  }

  await dependencies.settleProviderObject({
    paymentAttemptId: request.paymentAttemptId,
    providerObjectId: hostedSession.id,
    providerRequestSchemaVersion: sealed.schemaVersion,
    providerRequestFingerprint: sealed.fingerprint,
    providerRequestExpiresAt: sealed.expiresAt,
    recoveryLeaseToken,
    requestContext,
  })
  return hostedSession
}

/**
 * V2 sponsorship checkout persists the exact encrypted provider request before
 * calling Stripe. An opaque operation survives a lost response, while the
 * browser never selects provider scope, money, attribution, or object IDs.
 */
export async function createStripeSponsorshipCheckoutV2(
  input: CreateStripeSponsorshipCheckoutInput,
  dependencies: StripeSponsorshipCheckoutV2Dependencies,
): Promise<StripeSponsorshipCheckoutResult> {
  if (!isRecord(input.body)) throw checkoutError("invalid-request")

  const operationId = requiredUuid(input.body.checkoutRequestId)
  const subjectKind = requestedSubject(input.body)
  const partnershipProject = requestedPartnershipProject(
    subjectKind,
    input.body.project,
  )
  const requestedTerms = requestedPaymentTerms(input.body.paymentType)
  if (
    (subjectKind === "blind" || subjectKind === "partnership") &&
    requestedTerms.paymentMode === "one_time"
  ) {
    throw checkoutError("invalid-request")
  }

  const beneficiaryId =
    subjectKind === "standard" ? requiredUuid(input.body.beneficiaryId) : null
  const currency = selectedCurrency(input.body.currency)
  const stripeRegion = getStripeRegionForPaymentCurrency(currency)
  const provider: SponsorshipPaymentProvider = "STRIPE"
  const providerAccountScope = `stripe_${stripeRegion}`
  const providerIdempotencyKey = `stripe-checkout:${operationId}`
  const receipt = dependencies.crypto.deriveCheckoutReceipt(operationId)
  assertReceipt(receipt)

  await dependencies.authorizeHost(input.host)

  const recoveryScope: RecoverV2CheckoutInput = {
    checkoutReceiptDigest: receipt.digestRpcBytea,
    operationId,
    provider,
    providerAccountScope,
    providerIdempotencyKey,
  }
  const recovered = await dependencies.recoverCheckout(recoveryScope)
  const beneficiary = beneficiaryId
    ? await dependencies.loadBeneficiary(beneficiaryId, recovered !== null)
    : null
  if (beneficiaryId && (!beneficiary || beneficiary.id !== beneficiaryId)) {
    throw checkoutError("sponsorship-unavailable")
  }

  const baseAmountUsdCents = trustedBaseAmount(
    subjectKind,
    beneficiary,
    input.body.amount,
  )
  if (recovered) {
    assertRecoveredCheckoutTerms(recovered, {
      operationId,
      provider,
      providerAccountScope,
      subjectKind,
      beneficiaryId,
      paymentMode: requestedTerms.paymentMode,
      recurrenceInterval: requestedTerms.recurrenceInterval,
      baseAmountUsdCents,
      chargedCurrency: currency,
    })
  }

  const sponsorEmail =
    input.authenticatedUser?.email ??
    (typeof input.body.email === "string" ? input.body.email : "")
  let contactEmailDigest: VersionedEmailDigest
  try {
    contactEmailDigest = dependencies.crypto.digestEmail(sponsorEmail)
  } catch {
    throw checkoutError("invalid-email")
  }

  const freshConversion = recovered
    ? null
    : convertUsdCentsToCurrency(baseAmountUsdCents, currency)
  const chargedAmountMinor =
    recovered?.chargedAmountMinor ?? freshConversion!.chargedAmountMinor
  const chargedCurrency =
    recovered?.chargedCurrency ?? freshConversion!.chargedCurrency
  const conversionRate =
    recovered?.conversionRate ?? freshConversion!.conversionRate
  const currencyQuoteAt =
    recovered?.currencyQuoteAt ?? validDate(dependencies.now()).toISOString()

  const preparedIntent = await dependencies.prepareIntent({
    checkoutOperationId: operationId,
    checkoutReceiptDigest: receipt.digestRpcBytea,
    provider,
    providerAccountScope,
    providerIdempotencyKey,
    idempotencyKey: `checkout-v2:${operationId}`,
    source: input.host.source,
    advocateHostname: input.host.advocateHostname,
    visitorTokenDigest: visitorDigest(input.visitorToken),
    authUserId: input.authenticatedUser?.id ?? null,
    contactEmailDigest,
    subjectKind,
    beneficiaryId,
    partnershipProject,
    paymentMode: requestedTerms.paymentMode,
    recurrenceInterval: requestedTerms.recurrenceInterval,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency,
    conversionRate,
    currencyQuoteAt,
    currencyRateSource: SPONSORSHIP_CURRENCY_RATE_SOURCE,
    requestId: input.requestContext.requestId,
    traceId: input.requestContext.traceId,
  })
  assertUuid(preparedIntent.sponsorshipIntentId)
  if (
    recovered &&
    preparedIntent.sponsorshipIntentId !== recovered.sponsorshipIntentId
  ) {
    throw checkoutError("checkout-failed")
  }

  let quote = recovered ? quoteFromRecoveredCheckout(recovered) : null
  if (!quote) {
    quote = await dependencies.issueQuote({
      checkoutOperationId: operationId,
      sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
      provider,
      providerAccountScope,
      idempotencyKey: `quote:${operationId}`,
      requestId: input.requestContext.requestId,
      traceId: input.requestContext.traceId,
    })
  }

  if (recovered?.paymentAttemptId) {
    if (recovered.attemptStatus === "succeeded") {
      return {
        url: `${input.host.checkoutBaseUrl}/payments/success`,
        checkoutReceipt: receipt.token,
      }
    }
    if (
      ["failed", "cancelled", "expired"].includes(
        String(recovered.attemptStatus),
      )
    ) {
      throw checkoutError("sponsorship-unavailable")
    }

    const requestStillUsable =
      recovered.recoveryStatus === "available" &&
      recovered.recoveryAttemptCount === 0 &&
      recovered.providerRequestExpiresAt !== null &&
      Date.parse(recovered.providerRequestExpiresAt) >
        validDate(dependencies.now()).getTime()
    if (!requestStillUsable) {
      return {
        url: `${input.host.checkoutBaseUrl}/payments/success`,
        checkoutReceipt: receipt.token,
      }
    }

    const resumed = await dependencies.resumeCheckout({
      ...recoveryScope,
      requestId: input.requestContext.requestId,
      traceId: input.requestContext.traceId,
    })
    assertResumedCheckout(resumed, {
      operationId,
      paymentAttemptId: recovered.paymentAttemptId,
      provider,
      providerAccountScope,
      providerIdempotencyKey,
      now: dependencies.now(),
    })

    const sealed = sealedRequestFromResume(resumed)
    const providerRequest = openSealedStripeProviderRequest(
      {
        ciphertext: sealed.ciphertext,
        ciphertextSha256: sealed.ciphertextSha256,
        encryptionKeyVersion: sealed.encryptionKeyVersion,
        fingerprint: sealed.fingerprint,
        schemaVersion: sealed.schemaVersion,
        expectedOperationId: operationId,
        expectedPaymentAttemptId: recovered.paymentAttemptId,
        expectedSponsorshipIntentId: recovered.sponsorshipIntentId,
        expectedPaymentQuoteId: quote.paymentQuoteId,
        expectedProviderAccountScope: providerAccountScope,
        expectedProviderIdempotencyKey: providerIdempotencyKey,
        expectedTemplateClaims: resumed.providerRequestTemplateClaims,
        expectedEmailDigest: contactEmailDigest,
      },
      dependencies.crypto,
    )
    const session = await createAndSettleHostedStripeSession({
      request: providerRequest,
      sealed,
      recoveryLeaseToken: resumed.foregroundLeaseToken,
      requestContext: input.requestContext,
      dependencies,
    })
    return { url: session.url, checkoutReceipt: receipt.token }
  }

  if (Date.parse(quote.expiresAt) <= validDate(dependencies.now()).getTime()) {
    throw checkoutError("sponsorship-unavailable")
  }

  assertQuoteTerms(quote, {
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    provider,
    providerAccountScope,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency,
    conversionRate,
  })

  const requestExpiresAt = providerRequestExpiresAt(dependencies.now())
  const template = createStripeProviderRequestTemplate({
    operationId,
    providerIdempotencyKey,
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    paymentQuoteId: quote.paymentQuoteId,
    providerAccountScope,
    customerEmail: contactEmailDigest.normalizedEmail,
    productName: productName(
      subjectKind,
      beneficiary,
      requestedTerms.paymentMode,
      requestedTerms.recurrenceInterval,
      partnershipProject,
    ),
    productImageUrl: beneficiary?.imageUrl ?? null,
    paymentMode: requestedTerms.paymentMode,
    recurrenceInterval: requestedTerms.recurrenceInterval,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency,
    conversionRate,
    currencyQuoteAt,
    currencyRateSource: SPONSORSHIP_CURRENCY_RATE_SOURCE,
    checkoutBaseUrl: input.host.checkoutBaseUrl,
    stripeRegion,
    providerRequestExpiresAt: requestExpiresAt,
  })
  const sealed = sealStripeProviderRequest(template, dependencies.crypto)
  const claims = buildStripeProviderRequestTemplateClaims(
    template,
    sealed,
    contactEmailDigest,
  )
  const begun = await dependencies.beginPayment({
    checkoutOperationId: operationId,
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    paymentQuoteId: quote.paymentQuoteId,
    provider,
    providerAccountScope,
    providerIdempotencyKey,
    checkoutReceiptDigest: receipt.digestRpcBytea,
    providerRequest: sealed,
    providerRequestClaims: claims,
    requestContext: input.requestContext,
  })
  assertProviderTerms(quote, begun, {
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    provider,
    providerAccountScope,
    paymentMode: requestedTerms.paymentMode,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency,
    conversionRate,
  })

  if (begun.providerRequestExpiresAt !== sealed.expiresAt) {
    throw checkoutError("checkout-failed")
  }

  if (begun.replayed) {
    const resumed = await dependencies.resumeCheckout({
      ...recoveryScope,
      requestId: input.requestContext.requestId,
      traceId: input.requestContext.traceId,
    })
    assertResumedCheckout(resumed, {
      operationId,
      paymentAttemptId: begun.paymentAttemptId,
      provider,
      providerAccountScope,
      providerIdempotencyKey,
      now: dependencies.now(),
    })
    const resumedSealed = sealedRequestFromResume(resumed)
    const providerRequest = openSealedStripeProviderRequest(
      {
        ciphertext: resumedSealed.ciphertext,
        ciphertextSha256: resumedSealed.ciphertextSha256,
        encryptionKeyVersion: resumedSealed.encryptionKeyVersion,
        fingerprint: resumedSealed.fingerprint,
        schemaVersion: resumedSealed.schemaVersion,
        expectedOperationId: operationId,
        expectedPaymentAttemptId: begun.paymentAttemptId,
        expectedSponsorshipIntentId: preparedIntent.sponsorshipIntentId,
        expectedPaymentQuoteId: quote.paymentQuoteId,
        expectedProviderAccountScope: providerAccountScope,
        expectedProviderIdempotencyKey: providerIdempotencyKey,
        expectedTemplateClaims: resumed.providerRequestTemplateClaims,
        expectedEmailDigest: contactEmailDigest,
      },
      dependencies.crypto,
    )
    const session = await createAndSettleHostedStripeSession({
      request: providerRequest,
      sealed: resumedSealed,
      recoveryLeaseToken: resumed.foregroundLeaseToken,
      requestContext: input.requestContext,
      dependencies,
    })
    return { url: session.url, checkoutReceipt: receipt.token }
  }

  const providerRequest = openSealedStripeProviderRequest(
    {
      ciphertext: sealed.ciphertext,
      ciphertextSha256: sealed.ciphertextSha256,
      encryptionKeyVersion: sealed.encryptionKeyVersion,
      fingerprint: sealed.fingerprint,
      schemaVersion: sealed.schemaVersion,
      expectedOperationId: operationId,
      expectedPaymentAttemptId: begun.paymentAttemptId,
      expectedSponsorshipIntentId: preparedIntent.sponsorshipIntentId,
      expectedPaymentQuoteId: quote.paymentQuoteId,
      expectedProviderAccountScope: providerAccountScope,
      expectedProviderIdempotencyKey: providerIdempotencyKey,
      expectedTemplateClaims: claims,
      expectedEmailDigest: contactEmailDigest,
    },
    dependencies.crypto,
  )
  const session = await createAndSettleHostedStripeSession({
    request: providerRequest,
    sealed,
    recoveryLeaseToken: null,
    requestContext: input.requestContext,
    dependencies,
  })
  return { url: session.url, checkoutReceipt: receipt.token }
}
