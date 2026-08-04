import "server-only"

import type Stripe from "stripe"

import type {
  SponsorshipCrypto,
  SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import { sha256Digest, toSupabaseRpcBytea } from "@/lib/sponsorships/crypto"
import {
  stripeEventImmutableDigest,
  type StripeWebhookRequestContext,
} from "@/lib/sponsorships/gateways/stripeWebhook"
import type { StripeRegion } from "@/lib/stripe/config"
import type { SupportedCurrency } from "@/utils/currency"

const MAXIMUM_ADJUSTMENT_PAYLOAD_BYTES = 64 * 1024
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_]+$/
const SUPPORTED_CURRENCIES = new Set<SupportedCurrency>([
  "USD",
  "AUD",
  "GBP",
  "EUR",
])
const REFUND_EVENT_TYPES = new Set(["refund.created", "refund.updated"])
const DISPUTE_EVENT_TYPES = new Set([
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
])
export const STRIPE_NO_EFFECT_REFUND_STATUSES = [
  "pending",
  "requires_action",
  "failed",
  "canceled",
] as const
export type StripeNoEffectRefundStatus =
  (typeof STRIPE_NO_EFFECT_REFUND_STATUSES)[number]
const NO_EFFECT_REFUND_STATUSES = new Set<string>(
  STRIPE_NO_EFFECT_REFUND_STATUSES,
)

export type StripeFinancialAdjustmentErrorCode =
  | "provider-fact-mismatch"
  | "boundary-mismatch"
  | "payload-too-large"
  | "provider-chain-unavailable"
  | "infrastructure"

export class StripeFinancialAdjustmentError extends Error {
  readonly code: StripeFinancialAdjustmentErrorCode
  readonly httpStatus: number
  readonly retryable: boolean

  constructor(
    code: StripeFinancialAdjustmentErrorCode,
    options: { retryable?: boolean; httpStatus?: number } = {},
  ) {
    super(
      options.retryable
        ? "Stripe financial adjustment ingestion is temporarily unavailable"
        : "Stripe financial adjustment evidence was rejected",
    )
    this.name = "StripeFinancialAdjustmentError"
    this.code = code
    this.retryable = options.retryable === true
    this.httpStatus = options.httpStatus ?? (this.retryable ? 503 : 400)
  }
}

export type StripeFinancialAdjustmentRequestContext =
  StripeWebhookRequestContext

export interface AuthoritativeStripeFinancialMovement {
  id: string
  paymentAttemptId: string
  sponsorshipIntentId: string
  provider: "STRIPE"
  providerAccountScope: string
  providerMovementType: "payment_intent" | "invoice"
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

export interface StripeFinancialMovementLookup {
  providerAccountScope: string
  providerMovementType: "payment_intent" | "invoice"
  providerMovementId: string
}

export interface VerifiedStripeFinancialAdjustmentInput {
  originalFinancialMovementId: string
  providerAccountScope: string
  providerEventId: string
  eventType:
    | "refund.created"
    | "refund.updated"
    | "charge.dispute.funds_withdrawn"
    | "charge.dispute.funds_reinstated"
  providerObjectType: "refund" | "dispute"
  providerObjectId: string
  adjustmentProviderMovementType: "refund" | "dispute"
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
  verificationMethod: "stripe_webhook_signature"
  requestContext: StripeFinancialAdjustmentRequestContext
}

export interface VerifiedStripeFinancialAdjustmentResult {
  gatewayEventId: string
  originalFinancialMovementId: string
  paymentAttemptId: string
  sponsorshipIntentId: string
  processingStatus: string
  adjustmentKind:
    | "sponsorship_refund"
    | "sponsorship_dispute_debit"
    | "sponsorship_dispute_credit"
  isDuplicate: boolean
}

export interface VerifiedStripeNoEffectRefundInput {
  providerAccountScope: string
  providerEventId: string
  eventType: "refund.created" | "refund.updated"
  providerObjectType: "refund"
  providerObjectId: string
  providerState: StripeNoEffectRefundStatus
  redactedPayload: Record<string, unknown>
  payloadCiphertext: SupabaseRpcBytea
  payloadSha256: SupabaseRpcBytea
  signatureVerifiedAt: string
  occurredAt: string
  verificationMethod: "stripe_webhook_signature"
  requestContext: StripeFinancialAdjustmentRequestContext
}

export interface VerifiedStripeNoEffectRefundResult {
  gatewayEventId: string
  processingStatus: "ignored"
  isDuplicate: boolean
}

export interface StripeFinancialAdjustmentDependencies {
  crypto: SponsorshipCrypto
  retrieveCharge(id: string): Promise<Stripe.Charge>
  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent>
  loadOriginalMovement(
    lookup: StripeFinancialMovementLookup,
  ): Promise<AuthoritativeStripeFinancialMovement>
  ingestVerifiedAdjustment(
    input: VerifiedStripeFinancialAdjustmentInput,
  ): Promise<VerifiedStripeFinancialAdjustmentResult>
  ingestVerifiedNoEffectRefund(
    input: VerifiedStripeNoEffectRefundInput,
  ): Promise<VerifiedStripeNoEffectRefundResult>
  now(): Date
}

export type StripeFinancialAdjustmentResult =
  | { handled: false }
  | {
      handled: true
      ingested: false
      reason: "refund-not-succeeded"
      refundStatus: StripeNoEffectRefundStatus
      gatewayEventId: string
      processingStatus: "ignored"
      isDuplicate: boolean
    }
  | ({
      handled: true
      ingested: true
    } & VerifiedStripeFinancialAdjustmentResult)

export function isStripeFinancialAdjustmentEvent(event: Stripe.Event): boolean {
  return (
    REFUND_EVENT_TYPES.has(event.type) || DISPUTE_EVENT_TYPES.has(event.type)
  )
}

interface AdjustmentFacts {
  providerObjectType: "refund" | "dispute"
  providerObjectId: string
  adjustmentProviderMovementType: "refund" | "dispute"
  adjustmentProviderMovementId: string
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  evidenceBalanceTransactionId: string | null
}

interface ProviderPaymentChain {
  providerMovementType: "payment_intent" | "invoice"
  providerMovementId: string
  grossAmountMinor: number
  chargedCurrency: SupportedCurrency
}

function reject(
  code: Exclude<
    StripeFinancialAdjustmentErrorCode,
    "provider-chain-unavailable" | "infrastructure"
  >,
): never {
  throw new StripeFinancialAdjustmentError(code)
}

function infrastructure(
  code: "provider-chain-unavailable" | "infrastructure" = "infrastructure",
): StripeFinancialAdjustmentError {
  return new StripeFinancialAdjustmentError(code, { retryable: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    reject("boundary-mismatch")
  }
  return value.toLowerCase()
}

function matchesCanonicalUuid(value: unknown, expected: string): boolean {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value) &&
    value === value.toLowerCase() &&
    value === expected
  )
}

function requiredProviderId(
  value: unknown,
  prefix: string,
  code:
    "provider-fact-mismatch" | "boundary-mismatch" = "provider-fact-mismatch",
): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    value.length > 255 ||
    !PROVIDER_ID_PATTERN.test(value)
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

function requiredPositiveAmount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    reject("provider-fact-mismatch")
  }
  return value as number
}

function requiredDisputeId(value: unknown): string {
  if (
    typeof value !== "string" ||
    (!value.startsWith("dp_") && !value.startsWith("du_")) ||
    value.length > 255 ||
    !PROVIDER_ID_PATTERN.test(value)
  ) {
    reject("provider-fact-mismatch")
  }
  return value
}

function requiredCurrency(value: unknown): SupportedCurrency {
  if (typeof value !== "string") reject("provider-fact-mismatch")
  const currency = value.toUpperCase() as SupportedCurrency
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    reject("provider-fact-mismatch")
  }
  return currency
}

function requiredTimestamp(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    reject("provider-fact-mismatch")
  }
  const date = new Date((value as number) * 1000)
  if (!Number.isFinite(date.getTime())) reject("provider-fact-mismatch")
  return date.toISOString()
}

function signatureVerifiedAt(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw infrastructure()
  }
  return now.toISOString()
}

function objectReference<T extends { id: string }>(
  value: string | T | null,
  prefix: string,
): { id: string; object: T | null } | null {
  if (value === null) return null
  if (typeof value === "string") {
    return { id: requiredProviderId(value, prefix), object: null }
  }
  return {
    id: requiredProviderId(value.id, prefix),
    object: value,
  }
}

function isPermanentProviderLookupFailure(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.statusCode === 404 || error.code === "resource_missing"
}

async function withProviderLookup<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback()
  } catch (error) {
    if (error instanceof StripeFinancialAdjustmentError) throw error
    if (isPermanentProviderLookupFailure(error)) {
      reject("provider-fact-mismatch")
    }
    throw infrastructure("provider-chain-unavailable")
  }
}

function paymentIntentChain(
  paymentIntent: Stripe.PaymentIntent,
  expectedPaymentIntentId: string,
  amount: number,
  currency: SupportedCurrency,
): ProviderPaymentChain {
  if (
    paymentIntent.object !== "payment_intent" ||
    requiredProviderId(paymentIntent.id, "pi_") !== expectedPaymentIntentId ||
    paymentIntent.status !== "succeeded" ||
    requiredCurrency(paymentIntent.currency) !== currency ||
    !Number.isSafeInteger(paymentIntent.amount_received) ||
    paymentIntent.amount_received < amount
  ) {
    reject("provider-fact-mismatch")
  }

  const invoiceId = expandableId(paymentIntent.invoice, "in_")
  return {
    providerMovementType: invoiceId ? "invoice" : "payment_intent",
    providerMovementId: invoiceId ?? expectedPaymentIntentId,
    grossAmountMinor: paymentIntent.amount_received,
    chargedCurrency: currency,
  }
}

function chargeChain(
  charge: Stripe.Charge,
  expectedChargeId: string,
  signedPaymentIntentId: string | null,
  amount: number,
  currency: SupportedCurrency,
): ProviderPaymentChain {
  const paymentIntentId = expandableId(charge.payment_intent, "pi_")
  if (
    charge.object !== "charge" ||
    requiredProviderId(charge.id, "ch_") !== expectedChargeId ||
    !paymentIntentId ||
    (signedPaymentIntentId !== null &&
      paymentIntentId !== signedPaymentIntentId) ||
    charge.status !== "succeeded" ||
    charge.paid !== true ||
    charge.captured !== true ||
    !Number.isSafeInteger(charge.amount_captured) ||
    charge.amount_captured < amount ||
    requiredCurrency(charge.currency) !== currency
  ) {
    reject("provider-fact-mismatch")
  }

  const invoiceId = expandableId(charge.invoice, "in_")
  return {
    providerMovementType: invoiceId ? "invoice" : "payment_intent",
    providerMovementId: invoiceId ?? paymentIntentId,
    grossAmountMinor: charge.amount_captured,
    chargedCurrency: currency,
  }
}

async function refundChain(
  refund: Stripe.Refund,
  amount: number,
  currency: SupportedCurrency,
  dependencies: StripeFinancialAdjustmentDependencies,
): Promise<ProviderPaymentChain> {
  const chargeReference = objectReference(refund.charge, "ch_")
  const paymentIntentReference = objectReference(refund.payment_intent, "pi_")

  if (chargeReference) {
    const charge =
      chargeReference.object ??
      (await withProviderLookup(() =>
        dependencies.retrieveCharge(chargeReference.id),
      ))
    const chain = chargeChain(
      charge,
      chargeReference.id,
      paymentIntentReference?.id ?? null,
      amount,
      currency,
    )

    if (paymentIntentReference?.object) {
      const signedPaymentIntentChain = paymentIntentChain(
        paymentIntentReference.object,
        paymentIntentReference.id,
        amount,
        currency,
      )
      if (
        signedPaymentIntentChain.providerMovementType !==
          chain.providerMovementType ||
        signedPaymentIntentChain.providerMovementId !==
          chain.providerMovementId ||
        signedPaymentIntentChain.grossAmountMinor !== chain.grossAmountMinor
      ) {
        reject("provider-fact-mismatch")
      }
    }
    return chain
  }

  if (!paymentIntentReference) reject("provider-fact-mismatch")
  const paymentIntent =
    paymentIntentReference.object ??
    (await withProviderLookup(() =>
      dependencies.retrievePaymentIntent(paymentIntentReference.id),
    ))
  return paymentIntentChain(
    paymentIntent,
    paymentIntentReference.id,
    amount,
    currency,
  )
}

async function disputeChain(
  dispute: Stripe.Dispute,
  amount: number,
  currency: SupportedCurrency,
  dependencies: StripeFinancialAdjustmentDependencies,
): Promise<ProviderPaymentChain> {
  const chargeReference = objectReference(dispute.charge, "ch_")
  const paymentIntentReference = objectReference(dispute.payment_intent, "pi_")
  if (!chargeReference || !paymentIntentReference) {
    reject("provider-fact-mismatch")
  }

  const charge =
    chargeReference.object ??
    (await withProviderLookup(() =>
      dependencies.retrieveCharge(chargeReference.id),
    ))
  const chain = chargeChain(
    charge,
    chargeReference.id,
    paymentIntentReference.id,
    amount,
    currency,
  )

  if (paymentIntentReference.object) {
    const signedPaymentIntentChain = paymentIntentChain(
      paymentIntentReference.object,
      paymentIntentReference.id,
      amount,
      currency,
    )
    if (
      signedPaymentIntentChain.providerMovementType !==
        chain.providerMovementType ||
      signedPaymentIntentChain.providerMovementId !==
        chain.providerMovementId ||
      signedPaymentIntentChain.grossAmountMinor !== chain.grossAmountMinor
    ) {
      reject("provider-fact-mismatch")
    }
  }
  return chain
}

function rateFraction(rate: number): {
  numerator: bigint
  denominator: bigint
} {
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 10_000_000_000) {
    reject("boundary-mismatch")
  }
  const fixed = rate.toFixed(8)
  const [whole, fraction = ""] = fixed.split(".")
  const numerator = BigInt(`${whole}${fraction}`)
  const denominator = 100_000_000n
  if (numerator <= 0n) reject("boundary-mismatch")
  return { numerator, denominator }
}

function roundPositiveRational(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator)
}

function ceilPositiveRational(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

/**
 * Converts a partial charged-currency adjustment back to normalized USD cents.
 * The selected value is the nearest proportional value that still reproduces
 * the exact charged amount under the original immutable conversion rate.
 */
export function deriveProportionalBaseUsdCents(
  chargedAmountMinor: number,
  original: Pick<
    AuthoritativeStripeFinancialMovement,
    "baseAmountUsdCents" | "chargedAmountMinor" | "conversionRate"
  >,
): number {
  if (
    !Number.isSafeInteger(chargedAmountMinor) ||
    chargedAmountMinor < 1 ||
    !Number.isSafeInteger(original.baseAmountUsdCents) ||
    original.baseAmountUsdCents < 1 ||
    !Number.isSafeInteger(original.chargedAmountMinor) ||
    original.chargedAmountMinor < chargedAmountMinor
  ) {
    reject("boundary-mismatch")
  }

  const { numerator: rateNumerator, denominator: rateDenominator } =
    rateFraction(original.conversionRate)
  const originalBase = BigInt(original.baseAmountUsdCents)
  const originalCharged = BigInt(original.chargedAmountMinor)
  if (
    roundPositiveRational(originalBase * rateNumerator, rateDenominator) !==
    originalCharged
  ) {
    reject("boundary-mismatch")
  }

  if (chargedAmountMinor === original.chargedAmountMinor) {
    return original.baseAmountUsdCents
  }

  const adjustedCharged = BigInt(chargedAmountMinor)
  const proportional = roundPositiveRational(
    adjustedCharged * originalBase,
    originalCharged,
  )
  const lowerNumerator = (2n * adjustedCharged - 1n) * rateDenominator
  const upperNumerator = (2n * adjustedCharged + 1n) * rateDenominator - 1n
  let lower = ceilPositiveRational(lowerNumerator, 2n * rateNumerator)
  let upper = upperNumerator / (2n * rateNumerator)
  if (lower < 1n) lower = 1n
  if (upper > originalBase) upper = originalBase
  if (lower > upper) reject("boundary-mismatch")

  const selected =
    proportional < lower ? lower : proportional > upper ? upper : proportional
  if (
    selected < 1n ||
    selected > originalBase ||
    roundPositiveRational(selected * rateNumerator, rateDenominator) !==
      adjustedCharged ||
    selected > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    reject("boundary-mismatch")
  }
  return Number(selected)
}

function validateOriginalMovement(
  movement: AuthoritativeStripeFinancialMovement,
  lookup: StripeFinancialMovementLookup,
  chain: ProviderPaymentChain,
  occurredAt: string,
): void {
  const originalOccurredAt = new Date(movement.occurredAt)
  if (
    requiredUuid(movement.id) !== movement.id ||
    requiredUuid(movement.paymentAttemptId) !== movement.paymentAttemptId ||
    requiredUuid(movement.sponsorshipIntentId) !==
      movement.sponsorshipIntentId ||
    movement.provider !== "STRIPE" ||
    movement.providerAccountScope !== lookup.providerAccountScope ||
    movement.providerMovementType !== lookup.providerMovementType ||
    movement.providerMovementId !== lookup.providerMovementId ||
    movement.entryKind !== "sponsorship_payment" ||
    movement.originalFinancialMovementId !== null ||
    (movement.providerMovementType === "payment_intent" &&
      movement.paymentMode !== "one_time") ||
    (movement.providerMovementType === "invoice" &&
      movement.paymentMode !== "recurring") ||
    movement.chargedAmountMinor !== chain.grossAmountMinor ||
    movement.chargedCurrency !== chain.chargedCurrency ||
    !SUPPORTED_CURRENCIES.has(movement.chargedCurrency) ||
    !Number.isSafeInteger(movement.baseAmountUsdCents) ||
    movement.baseAmountUsdCents < 1 ||
    !Number.isSafeInteger(movement.chargedAmountMinor) ||
    movement.chargedAmountMinor < 1 ||
    !Number.isFinite(originalOccurredAt.getTime()) ||
    originalOccurredAt.getTime() > new Date(occurredAt).getTime()
  ) {
    reject("boundary-mismatch")
  }
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
  if (payload.length < 1 || payload.length > MAXIMUM_ADJUSTMENT_PAYLOAD_BYTES) {
    reject("payload-too-large")
  }
  try {
    const envelope = crypto.encryptSecretPayload(payload)
    const deliveryDigest = sha256Digest(payload)
    return {
      ciphertext: envelope.ciphertextRpcBytea,
      immutableSha256: toSupabaseRpcBytea(stripeEventImmutableDigest(event)),
      deliverySha256Hex: deliveryDigest.toString("hex"),
    }
  } catch {
    throw infrastructure()
  } finally {
    payload.fill(0)
  }
}

function refundFacts(event: Stripe.Event):
  | {
      status: "not-succeeded"
      refundStatus: StripeNoEffectRefundStatus
      providerObjectId: string
    }
  | { status: "succeeded"; refund: Stripe.Refund; facts: AdjustmentFacts } {
  const refund = event.data.object as Stripe.Refund
  if (refund.object !== "refund") reject("provider-fact-mismatch")
  const refundId = requiredProviderId(refund.id, "re_")
  if (refund.status !== "succeeded") {
    if (
      typeof refund.status !== "string" ||
      !NO_EFFECT_REFUND_STATUSES.has(refund.status)
    ) {
      reject("provider-fact-mismatch")
    }
    return {
      status: "not-succeeded",
      refundStatus: refund.status as StripeNoEffectRefundStatus,
      providerObjectId: refundId,
    }
  }

  const chargedAmountMinor = requiredPositiveAmount(refund.amount)
  const chargedCurrency = requiredCurrency(refund.currency)
  return {
    status: "succeeded",
    refund,
    facts: {
      providerObjectType: "refund",
      providerObjectId: refundId,
      adjustmentProviderMovementType: "refund",
      adjustmentProviderMovementId: refundId,
      chargedAmountMinor,
      chargedCurrency,
      evidenceBalanceTransactionId: null,
    },
  }
}

function disputeBalanceTransaction(
  eventType: string,
  dispute: Stripe.Dispute,
  disputeAmount: number,
  disputeCurrency: SupportedCurrency,
): { id: string; amount: number } {
  if (
    !Array.isArray(dispute.balance_transactions) ||
    dispute.balance_transactions.length < 1 ||
    dispute.balance_transactions.length > 2
  ) {
    reject("provider-fact-mismatch")
  }

  const expectedSign = eventType === "charge.dispute.funds_withdrawn" ? -1 : 1
  const seenIds = new Set<string>()
  const matching: Array<{ id: string; amount: number }> = []

  for (const transaction of dispute.balance_transactions) {
    const id = requiredProviderId(transaction.id, "txn_")
    const balanceCurrency = requiredCurrency(transaction.currency)
    if (
      transaction.object !== "balance_transaction" ||
      seenIds.has(id) ||
      !Number.isSafeInteger(transaction.amount) ||
      transaction.amount === 0
    ) {
      reject("provider-fact-mismatch")
    }
    seenIds.add(id)

    if (Math.sign(transaction.amount) === expectedSign) {
      const balanceAmount = Math.abs(transaction.amount)
      matching.push({
        id,
        amount:
          balanceCurrency === disputeCurrency
            ? balanceAmount
            : exactSourceAmountFromBalanceTransaction(
                balanceAmount,
                transaction.exchange_rate,
                disputeAmount,
              ),
      })
    }
  }

  if (
    matching.length !== 1 ||
    matching[0].amount < 1 ||
    matching[0].amount > disputeAmount
  ) {
    reject("provider-fact-mismatch")
  }
  return matching[0]
}

function exactSourceAmountFromBalanceTransaction(
  balanceAmount: number,
  exchangeRate: number | null,
  maximumSourceAmount: number,
): number {
  if (
    !Number.isSafeInteger(balanceAmount) ||
    balanceAmount < 1 ||
    !Number.isSafeInteger(maximumSourceAmount) ||
    maximumSourceAmount < 1 ||
    typeof exchangeRate !== "number" ||
    !Number.isFinite(exchangeRate) ||
    exchangeRate <= 0 ||
    exchangeRate >= 10_000_000_000
  ) {
    reject("provider-fact-mismatch")
  }

  const fixed = exchangeRate.toFixed(8)
  const [whole, fraction = ""] = fixed.split(".")
  const rateNumerator = BigInt(`${whole}${fraction}`)
  const rateDenominator = 100_000_000n
  if (rateNumerator <= 0n) reject("provider-fact-mismatch")

  const target = BigInt(balanceAmount)
  let lower = ceilPositiveRational(
    (2n * target - 1n) * rateDenominator,
    2n * rateNumerator,
  )
  let upper = ((2n * target + 1n) * rateDenominator - 1n) / (2n * rateNumerator)
  if (lower < 1n) lower = 1n
  const maximum = BigInt(maximumSourceAmount)
  if (upper > maximum) upper = maximum
  if (
    lower !== upper ||
    lower > BigInt(Number.MAX_SAFE_INTEGER) ||
    roundPositiveRational(lower * rateNumerator, rateDenominator) !== target
  ) {
    reject("provider-fact-mismatch")
  }
  return Number(lower)
}

function disputeFacts(event: Stripe.Event): {
  dispute: Stripe.Dispute
  facts: AdjustmentFacts
} {
  const dispute = event.data.object as Stripe.Dispute
  if (dispute.object !== "dispute") reject("provider-fact-mismatch")
  const disputeId = requiredDisputeId(dispute.id)
  const disputeAmount = requiredPositiveAmount(dispute.amount)
  const chargedCurrency = requiredCurrency(dispute.currency)
  const balanceTransaction = disputeBalanceTransaction(
    event.type,
    dispute,
    disputeAmount,
    chargedCurrency,
  )
  return {
    dispute,
    facts: {
      providerObjectType: "dispute",
      providerObjectId: disputeId,
      adjustmentProviderMovementType: "dispute",
      adjustmentProviderMovementId: disputeId,
      chargedAmountMinor: balanceTransaction.amount,
      chargedCurrency,
      evidenceBalanceTransactionId: balanceTransaction.id,
    },
  }
}

function adjustmentKindFor(
  eventType: string,
): VerifiedStripeFinancialAdjustmentResult["adjustmentKind"] {
  if (REFUND_EVENT_TYPES.has(eventType)) return "sponsorship_refund"
  return eventType === "charge.dispute.funds_withdrawn"
    ? "sponsorship_dispute_debit"
    : "sponsorship_dispute_credit"
}

export async function ingestStripeFinancialAdjustment(
  input: {
    event: Stripe.Event
    region: StripeRegion
    rawPayload: string
    requestContext: StripeFinancialAdjustmentRequestContext
  },
  dependencies: StripeFinancialAdjustmentDependencies,
): Promise<StripeFinancialAdjustmentResult> {
  if (!isStripeFinancialAdjustmentEvent(input.event)) {
    return { handled: false }
  }

  const rawPayloadBytes = Buffer.byteLength(input.rawPayload, "utf8")
  if (
    rawPayloadBytes < 1 ||
    rawPayloadBytes > MAXIMUM_ADJUSTMENT_PAYLOAD_BYTES
  ) {
    reject("payload-too-large")
  }

  const providerEventId = requiredProviderId(input.event.id, "evt_")
  const occurredAt = requiredTimestamp(input.event.created)
  const verifiedAt = signatureVerifiedAt(dependencies.now())
  const expectedScope = `stripe_${input.region}`

  let facts: AdjustmentFacts
  let chain: ProviderPaymentChain
  if (REFUND_EVENT_TYPES.has(input.event.type)) {
    const refund = refundFacts(input.event)
    if (refund.status === "not-succeeded") {
      const payload = encryptedPayload(
        input.rawPayload,
        input.event,
        dependencies.crypto,
      )
      const noEffectInput: VerifiedStripeNoEffectRefundInput = {
        providerAccountScope: expectedScope,
        providerEventId,
        eventType: input.event.type as "refund.created" | "refund.updated",
        providerObjectType: "refund",
        providerObjectId: refund.providerObjectId,
        providerState: refund.refundStatus,
        redactedPayload: {
          redaction_version: "stripe_refund_no_effect_v1",
          delivery_payload_sha256: payload.deliverySha256Hex,
          stripe_signature: input.requestContext.signatureHeader,
          webhook_secret_version: input.requestContext.webhookSecretVersion,
        },
        payloadCiphertext: payload.ciphertext,
        payloadSha256: payload.immutableSha256,
        signatureVerifiedAt: verifiedAt,
        occurredAt,
        verificationMethod: "stripe_webhook_signature",
        requestContext: input.requestContext,
      }
      let result: VerifiedStripeNoEffectRefundResult
      try {
        result = await dependencies.ingestVerifiedNoEffectRefund(noEffectInput)
      } catch (error) {
        if (error instanceof StripeFinancialAdjustmentError) throw error
        throw infrastructure()
      }
      if (
        !matchesCanonicalUuid(result.gatewayEventId, result.gatewayEventId) ||
        result.processingStatus !== "ignored" ||
        typeof result.isDuplicate !== "boolean"
      ) {
        throw infrastructure()
      }
      return {
        handled: true,
        ingested: false,
        reason: "refund-not-succeeded",
        refundStatus: refund.refundStatus,
        ...result,
      }
    }
    facts = refund.facts
    chain = await refundChain(
      refund.refund,
      facts.chargedAmountMinor,
      facts.chargedCurrency,
      dependencies,
    )
  } else {
    const dispute = disputeFacts(input.event)
    facts = dispute.facts
    chain = await disputeChain(
      dispute.dispute,
      facts.chargedAmountMinor,
      facts.chargedCurrency,
      dependencies,
    )
  }

  const lookup: StripeFinancialMovementLookup = {
    providerAccountScope: expectedScope,
    providerMovementType: chain.providerMovementType,
    providerMovementId: chain.providerMovementId,
  }
  let original: AuthoritativeStripeFinancialMovement
  try {
    original = await dependencies.loadOriginalMovement(lookup)
  } catch (error) {
    if (error instanceof StripeFinancialAdjustmentError) throw error
    throw infrastructure()
  }
  validateOriginalMovement(original, lookup, chain, occurredAt)
  if (
    facts.chargedCurrency !== original.chargedCurrency ||
    facts.chargedAmountMinor > original.chargedAmountMinor
  ) {
    reject("boundary-mismatch")
  }

  const baseAmountUsdCents = deriveProportionalBaseUsdCents(
    facts.chargedAmountMinor,
    original,
  )
  const payload = encryptedPayload(
    input.rawPayload,
    input.event,
    dependencies.crypto,
  )
  const eventType = input.event
    .type as VerifiedStripeFinancialAdjustmentInput["eventType"]
  const { evidenceBalanceTransactionId, ...databaseFacts } = facts
  const inputForDatabase: VerifiedStripeFinancialAdjustmentInput = {
    originalFinancialMovementId: original.id,
    providerAccountScope: expectedScope,
    providerEventId,
    eventType,
    ...databaseFacts,
    baseAmountUsdCents,
    conversionRate: original.conversionRate,
    redactedPayload: {
      redaction_version: "stripe_financial_adjustment_v1",
      provider: "STRIPE",
      source: "verified_webhook",
      event_type: eventType,
      provider_object_type: facts.providerObjectType,
      delivery_payload_sha256: payload.deliverySha256Hex,
      stripe_signature: input.requestContext.signatureHeader,
      webhook_secret_version: input.requestContext.webhookSecretVersion,
      balance_transaction_id: evidenceBalanceTransactionId,
    },
    payloadCiphertext: payload.ciphertext,
    payloadSha256: payload.immutableSha256,
    signatureVerifiedAt: verifiedAt,
    occurredAt,
    verificationMethod: "stripe_webhook_signature",
    requestContext: input.requestContext,
  }

  let result: VerifiedStripeFinancialAdjustmentResult
  try {
    result = await dependencies.ingestVerifiedAdjustment(inputForDatabase)
  } catch (error) {
    if (error instanceof StripeFinancialAdjustmentError) throw error
    throw infrastructure()
  }
  if (
    !matchesCanonicalUuid(result.gatewayEventId, result.gatewayEventId) ||
    !matchesCanonicalUuid(result.originalFinancialMovementId, original.id) ||
    !matchesCanonicalUuid(result.paymentAttemptId, original.paymentAttemptId) ||
    !matchesCanonicalUuid(
      result.sponsorshipIntentId,
      original.sponsorshipIntentId,
    ) ||
    !["received", "processing", "processed", "failed", "ignored"].includes(
      result.processingStatus,
    ) ||
    result.adjustmentKind !== adjustmentKindFor(eventType) ||
    typeof result.isDuplicate !== "boolean"
  ) {
    throw infrastructure()
  }

  return { handled: true, ingested: true, ...result }
}

export function asStripeFinancialAdjustmentError(
  error: unknown,
): StripeFinancialAdjustmentError {
  return error instanceof StripeFinancialAdjustmentError
    ? error
    : infrastructure()
}
