import "server-only"

import type Stripe from "stripe"

import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import {
  type AuthoritativeStripeFinancialMovement,
  StripeFinancialAdjustmentError,
  type StripeFinancialAdjustmentDependencies,
  type StripeFinancialMovementLookup,
  type VerifiedStripeFinancialAdjustmentInput,
  type VerifiedStripeFinancialAdjustmentResult,
  type VerifiedStripeNoEffectRefundInput,
  type VerifiedStripeNoEffectRefundResult,
} from "@/lib/sponsorships/gateways/stripeFinancialAdjustments"
import type { SupportedCurrency } from "@/utils/currency"
import { createServiceRoleClient } from "@/utils/supabase/server"

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

interface DatabaseError {
  code?: string
}

function infrastructure(): StripeFinancialAdjustmentError {
  return new StripeFinancialAdjustmentError("infrastructure", {
    retryable: true,
  })
}

function evidenceConflict(error: DatabaseError | null): never {
  if (
    ["22023", "22P02", "23503", "23505", "23514"].includes(error?.code || "")
  ) {
    throw new StripeFinancialAdjustmentError("boundary-mismatch", {
      httpStatus: error?.code === "23505" ? 409 : 400,
    })
  }
  throw infrastructure()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== "string" || value.length === 0) throw infrastructure()
  return value
}

function optionalString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string" || value.length === 0) throw infrastructure()
  return value
}

function requiredInteger(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  const parsed =
    typeof value === "string" && /^-?[0-9]+$/.test(value)
      ? Number(value)
      : value
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed)) {
    throw infrastructure()
  }
  return parsed
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const raw = row[key]
  const value = typeof raw === "string" ? Number(raw) : raw
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw infrastructure()
  }
  return value
}

function requiredCurrency(
  row: Record<string, unknown>,
  key: string,
): SupportedCurrency {
  const value = requiredString(row, key)
  if (!new Set(["USD", "AUD", "GBP", "EUR"]).has(value)) {
    throw infrastructure()
  }
  return value as SupportedCurrency
}

function exactlyOneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw infrastructure()
  }
  return data[0]
}

async function loadOriginalMovement(
  supabase: ServiceRoleClient,
  lookup: StripeFinancialMovementLookup,
): Promise<AuthoritativeStripeFinancialMovement> {
  const { data, error } = await supabase
    .from("sponsorship_financial_movements")
    .select(
      "id, payment_attempt_id, sponsorship_intent_id, provider, provider_account_scope, provider_movement_type, provider_movement_id, entry_kind, original_financial_movement_id, payment_mode, base_amount_usd_cents, charged_amount_minor, charged_currency, conversion_rate, occurred_at",
    )
    .eq("provider", "STRIPE")
    .eq("provider_account_scope", lookup.providerAccountScope)
    .eq("provider_movement_type", lookup.providerMovementType)
    .eq("provider_movement_id", lookup.providerMovementId)
    .eq("entry_kind", "sponsorship_payment")
    .is("original_financial_movement_id", null)
    .limit(2)

  if (error) throw infrastructure()
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw new StripeFinancialAdjustmentError("boundary-mismatch")
  }
  const row = data[0]
  const provider = requiredString(row, "provider")
  const providerMovementType = requiredString(row, "provider_movement_type")
  const entryKind = requiredString(row, "entry_kind")
  const paymentMode = requiredString(row, "payment_mode")
  const originalFinancialMovementId = optionalString(
    row,
    "original_financial_movement_id",
  )
  if (
    provider !== "STRIPE" ||
    (providerMovementType !== "payment_intent" &&
      providerMovementType !== "invoice") ||
    entryKind !== "sponsorship_payment" ||
    originalFinancialMovementId !== null ||
    (paymentMode !== "one_time" && paymentMode !== "recurring")
  ) {
    throw infrastructure()
  }

  return {
    id: requiredString(row, "id"),
    paymentAttemptId: requiredString(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredString(row, "sponsorship_intent_id"),
    provider: "STRIPE",
    providerAccountScope: requiredString(row, "provider_account_scope"),
    providerMovementType,
    providerMovementId: requiredString(row, "provider_movement_id"),
    entryKind: "sponsorship_payment",
    originalFinancialMovementId: null,
    paymentMode,
    baseAmountUsdCents: requiredInteger(row, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(row, "charged_amount_minor"),
    chargedCurrency: requiredCurrency(row, "charged_currency"),
    conversionRate: requiredNumber(row, "conversion_rate"),
    occurredAt: requiredString(row, "occurred_at"),
  }
}

async function ingestVerifiedAdjustment(
  supabase: ServiceRoleClient,
  input: VerifiedStripeFinancialAdjustmentInput,
): Promise<VerifiedStripeFinancialAdjustmentResult> {
  const { data, error } = await supabase.rpc(
    "ingest_verified_sponsorship_financial_adjustment",
    {
      target_original_financial_movement_id: input.originalFinancialMovementId,
      target_provider: "STRIPE",
      target_provider_account_scope: input.providerAccountScope,
      target_provider_event_id: input.providerEventId,
      target_event_type: input.eventType,
      target_provider_object_type: input.providerObjectType,
      target_provider_object_id: input.providerObjectId,
      target_adjustment_provider_movement_type:
        input.adjustmentProviderMovementType,
      target_adjustment_provider_movement_id:
        input.adjustmentProviderMovementId,
      target_base_amount_usd_cents: input.baseAmountUsdCents,
      target_charged_amount_minor: input.chargedAmountMinor,
      target_charged_currency: input.chargedCurrency,
      target_conversion_rate: input.conversionRate,
      target_redacted_payload: input.redactedPayload,
      target_payload_ciphertext: input.payloadCiphertext,
      target_payload_sha256: input.payloadSha256,
      target_signature_verified_at: input.signatureVerifiedAt,
      target_occurred_at: input.occurredAt,
      target_verification_method: input.verificationMethod,
      context_request_id: input.requestContext.requestId,
      context_trace_id: input.requestContext.traceId,
      context_client_ip: input.requestContext.clientIp,
      context_user_agent: input.requestContext.userAgent,
    },
  )
  if (error) evidenceConflict(error)

  const row = exactlyOneRow(data)
  const isDuplicate = row.is_duplicate
  const adjustmentKind = requiredString(row, "adjustment_kind")
  if (
    typeof isDuplicate !== "boolean" ||
    ![
      "sponsorship_refund",
      "sponsorship_dispute_debit",
      "sponsorship_dispute_credit",
    ].includes(adjustmentKind)
  ) {
    throw infrastructure()
  }
  return {
    gatewayEventId: requiredString(row, "gateway_event_id"),
    originalFinancialMovementId: requiredString(
      row,
      "original_financial_movement_id",
    ),
    paymentAttemptId: requiredString(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredString(row, "sponsorship_intent_id"),
    processingStatus: requiredString(row, "processing_status"),
    adjustmentKind:
      adjustmentKind as VerifiedStripeFinancialAdjustmentResult["adjustmentKind"],
    isDuplicate,
  }
}

export async function ingestVerifiedNoEffectRefund(
  supabase: ServiceRoleClient,
  input: VerifiedStripeNoEffectRefundInput,
): Promise<VerifiedStripeNoEffectRefundResult> {
  const { data, error } = await supabase.rpc(
    "ingest_verified_payment_gateway_event_no_effect",
    {
      target_provider: "STRIPE",
      target_provider_account_scope: input.providerAccountScope,
      target_provider_event_id: input.providerEventId,
      target_event_type: input.eventType,
      target_provider_object_type: input.providerObjectType,
      target_provider_object_id: input.providerObjectId,
      target_provider_state: input.providerState,
      target_redacted_payload: input.redactedPayload,
      target_payload_ciphertext: input.payloadCiphertext,
      target_payload_sha256: input.payloadSha256,
      target_signature_verified_at: input.signatureVerifiedAt,
      target_occurred_at: input.occurredAt,
      target_verification_method: input.verificationMethod,
      context_request_id: input.requestContext.requestId,
      context_trace_id: input.requestContext.traceId,
      context_client_ip: input.requestContext.clientIp,
      context_user_agent: input.requestContext.userAgent,
    },
  )
  if (error) evidenceConflict(error)

  const row = exactlyOneRow(data)
  const processingStatus = requiredString(row, "processing_status")
  const isDuplicate = row.is_duplicate
  if (processingStatus !== "ignored" || typeof isDuplicate !== "boolean") {
    throw infrastructure()
  }
  return {
    gatewayEventId: requiredString(row, "gateway_event_id"),
    processingStatus: "ignored",
    isDuplicate,
  }
}

export function createStripeFinancialAdjustmentDependencies(
  stripe: Stripe,
  supabase: ServiceRoleClient,
): StripeFinancialAdjustmentDependencies {
  return {
    crypto: createSponsorshipCryptoFromEnvironment(),
    retrieveCharge: (id) => stripe.charges.retrieve(id),
    retrievePaymentIntent: (id) => stripe.paymentIntents.retrieve(id),
    loadOriginalMovement: (lookup) => loadOriginalMovement(supabase, lookup),
    ingestVerifiedAdjustment: (input) =>
      ingestVerifiedAdjustment(supabase, input),
    ingestVerifiedNoEffectRefund: (input) =>
      ingestVerifiedNoEffectRefund(supabase, input),
    now: () => new Date(),
  }
}
