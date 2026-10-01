import "server-only"

import type Stripe from "stripe"

import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import {
  ServerIntentStripeWebhookError,
  type AuthoritativeStripePaymentBoundary,
  type ServerIntentStripeWebhookDependencies,
  type VerifiedStripeGatewayEventInput,
  type VerifiedStripeGatewayEventResult,
  type VerifiedStripeQuarantineInput,
  type VerifiedStripeQuarantineResult,
} from "@/lib/sponsorships/gateways/stripeWebhook"
import type { SupportedCurrency } from "@/utils/currency"
import { createServiceRoleClient } from "@/utils/supabase/server"

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

interface DatabaseError {
  code?: string
}

function infrastructure(): ServerIntentStripeWebhookError {
  return new ServerIntentStripeWebhookError("infrastructure", {
    retryable: true,
  })
}

function evidenceConflict(error: DatabaseError | null): never {
  if (
    ["22023", "22P02", "23503", "23505", "23514"].includes(error?.code || "")
  ) {
    throw new ServerIntentStripeWebhookError("boundary-mismatch", {
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

function requiredPaymentMode(
  row: Record<string, unknown>,
  key: string,
): "one_time" | "recurring" {
  const value = requiredString(row, key)
  if (value !== "one_time" && value !== "recurring") throw infrastructure()
  return value
}

function requiredRecurrence(
  row: Record<string, unknown>,
  key: string,
): "month" | "year" | null {
  const value = optionalString(row, key)
  if (value !== null && value !== "month" && value !== "year") {
    throw infrastructure()
  }
  return value
}

function requiredCurrency(
  row: Record<string, unknown>,
  key: string,
): SupportedCurrency {
  const value = requiredString(row, key)
  if (!(["USD", "AUD", "GBP", "EUR"] as string[]).includes(value)) {
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

async function loadPaymentBoundary(
  supabase: ServiceRoleClient,
  paymentAttemptId: string,
): Promise<AuthoritativeStripePaymentBoundary> {
  const { data: attemptData, error: attemptError } = await supabase
    .from("sponsorship_payment_attempts")
    .select(
      "id, sponsorship_intent_id, provider, provider_account_scope, status, payment_mode, base_amount_usd_cents, charged_amount_minor, charged_currency, conversion_rate, provider_object_type, provider_object_id, provider_customer_id, provider_subscription_object_type, provider_subscription_object_id",
    )
    .eq("id", paymentAttemptId)
    .maybeSingle()

  if (attemptError) throw infrastructure()
  if (!attemptData || !isRecord(attemptData)) {
    throw new ServerIntentStripeWebhookError("boundary-mismatch")
  }

  const intentId = requiredString(attemptData, "sponsorship_intent_id")
  const { data: intentData, error: intentError } = await supabase
    .from("sponsorship_intents")
    .select(
      "id, payment_mode, recurrence_interval, base_amount_usd_cents, charged_amount_minor, charged_currency, conversion_rate",
    )
    .eq("id", intentId)
    .maybeSingle()

  if (intentError) throw infrastructure()
  if (!intentData || !isRecord(intentData)) {
    throw new ServerIntentStripeWebhookError("boundary-mismatch")
  }

  const provider = requiredString(attemptData, "provider")
  const providerObjectType = requiredString(attemptData, "provider_object_type")
  const providerSubscriptionObjectType = optionalString(
    attemptData,
    "provider_subscription_object_type",
  )
  if (
    provider !== "STRIPE" ||
    providerObjectType !== "checkout_session" ||
    (providerSubscriptionObjectType !== null &&
      providerSubscriptionObjectType !== "subscription")
  ) {
    throw new ServerIntentStripeWebhookError("boundary-mismatch")
  }

  const recurrenceInterval = requiredRecurrence(
    intentData,
    "recurrence_interval",
  )
  return {
    attemptId: requiredString(attemptData, "id"),
    intentId: requiredString(intentData, "id"),
    provider: "STRIPE",
    providerAccountScope: requiredString(attemptData, "provider_account_scope"),
    attemptStatus: requiredString(attemptData, "status"),
    paymentMode: requiredPaymentMode(attemptData, "payment_mode"),
    recurrenceInterval,
    baseAmountUsdCents: requiredInteger(attemptData, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(attemptData, "charged_amount_minor"),
    chargedCurrency: requiredCurrency(attemptData, "charged_currency"),
    conversionRate: requiredNumber(attemptData, "conversion_rate"),
    providerObjectType: "checkout_session",
    providerObjectId: requiredString(attemptData, "provider_object_id"),
    providerCustomerId: optionalString(attemptData, "provider_customer_id"),
    providerSubscriptionObjectType: providerSubscriptionObjectType as
      "subscription" | null,
    providerSubscriptionId: optionalString(
      attemptData,
      "provider_subscription_object_id",
    ),
    intentPaymentMode: requiredPaymentMode(intentData, "payment_mode"),
    intentRecurrenceInterval: recurrenceInterval,
    intentBaseAmountUsdCents: requiredInteger(
      intentData,
      "base_amount_usd_cents",
    ),
    intentChargedAmountMinor: requiredInteger(
      intentData,
      "charged_amount_minor",
    ),
    intentChargedCurrency: requiredCurrency(intentData, "charged_currency"),
    intentConversionRate: requiredNumber(intentData, "conversion_rate"),
  }
}

async function ingestVerifiedEvent(
  supabase: ServiceRoleClient,
  input: VerifiedStripeGatewayEventInput,
): Promise<VerifiedStripeGatewayEventResult> {
  const rpcResult =
    input.eventType === "checkout.session.expired"
      ? await supabase.rpc("ingest_verified_stripe_checkout_expiration", {
          target_payment_attempt_id: input.paymentAttemptId,
          target_provider_account_scope: input.providerAccountScope,
          target_provider_event_id: input.providerEventId,
          target_provider_object_id: input.providerObjectId,
          target_redacted_payload: input.redactedPayload,
          target_payload_ciphertext: input.payloadCiphertext,
          target_payload_sha256: input.payloadSha256,
          target_signature_verified_at: input.signatureVerifiedAt,
          target_occurred_at: input.occurredAt,
          target_verification_method: input.verificationMethod,
          target_checkout_status: input.factLifecycleState,
          target_payment_status: input.factPaymentStatus,
          target_fact_server_payment_attempt_id:
            input.factServerPaymentAttemptId,
          context_request_id: input.requestContext.requestId,
          context_trace_id: input.requestContext.traceId,
          context_client_ip: input.requestContext.clientIp,
          context_user_agent: input.requestContext.userAgent,
        })
      : await supabase.rpc("ingest_verified_payment_gateway_event", {
          target_payment_attempt_id: input.paymentAttemptId,
          target_provider: "STRIPE",
          target_provider_account_scope: input.providerAccountScope,
          target_provider_event_id: input.providerEventId,
          target_event_type: input.eventType,
          target_provider_object_type: input.providerObjectType,
          target_provider_object_id: input.providerObjectId,
          target_redacted_payload: input.redactedPayload,
          target_payload_ciphertext: input.payloadCiphertext,
          target_payload_sha256: input.payloadSha256,
          target_signature_verified_at: input.signatureVerifiedAt,
          target_occurred_at: input.occurredAt,
          target_verification_method: input.verificationMethod,
          target_fact_payment_status: input.factPaymentStatus,
          target_fact_server_payment_attempt_id:
            input.factServerPaymentAttemptId,
          target_fact_parent_provider_object_type:
            input.factParentProviderObjectType,
          target_fact_parent_provider_object_id:
            input.factParentProviderObjectId,
          target_fact_provider_movement_type: input.factProviderMovementType,
          target_fact_provider_movement_id: input.factProviderMovementId,
          target_fact_provider_customer_id: input.factProviderCustomerId,
          target_fact_provider_subscription_id:
            input.factProviderSubscriptionId,
          target_fact_base_amount_usd_cents: input.factBaseAmountUsdCents,
          target_fact_charged_amount_minor: input.factChargedAmountMinor,
          target_fact_charged_currency: input.factChargedCurrency,
          target_fact_conversion_rate: input.factConversionRate,
          target_fact_period_start: input.factPeriodStart,
          target_fact_period_end: input.factPeriodEnd,
          target_fact_failure_code: input.factFailureCode,
          target_fact_lifecycle_state: input.factLifecycleState,
          context_request_id: input.requestContext.requestId,
          context_trace_id: input.requestContext.traceId,
          context_client_ip: input.requestContext.clientIp,
          context_user_agent: input.requestContext.userAgent,
        })
  const { data, error } = rpcResult
  if (error) evidenceConflict(error)

  const row = exactlyOneRow(data)
  const isDuplicate = row.is_duplicate
  if (typeof isDuplicate !== "boolean") throw infrastructure()
  return {
    gatewayEventId: requiredString(row, "gateway_event_id"),
    sponsorshipIntentId: requiredString(row, "sponsorship_intent_id"),
    paymentAttemptId: requiredString(row, "payment_attempt_id"),
    processingStatus: requiredString(row, "processing_status"),
    isDuplicate,
  }
}

async function quarantineVerifiedEvent(
  supabase: ServiceRoleClient,
  input: VerifiedStripeQuarantineInput,
): Promise<VerifiedStripeQuarantineResult> {
  const { data, error } = await supabase.rpc(
    "quarantine_verified_payment_gateway_event",
    {
      target_provider: "STRIPE",
      target_provider_account_scope: input.providerAccountScope,
      target_provider_event_id: input.providerEventId,
      target_event_type: input.eventType,
      target_provider_object_type: input.providerObjectType,
      target_provider_object_id: input.providerObjectId,
      target_redacted_payload: input.redactedPayload,
      target_payload_ciphertext: input.payloadCiphertext,
      target_payload_sha256: input.payloadSha256,
      target_signature_verified_at: input.signatureVerifiedAt,
      target_occurred_at: input.occurredAt,
      target_verification_method: input.verificationMethod,
      target_error_code: input.errorCode,
      target_reason: input.reason,
      context_request_id: input.requestContext.requestId,
      context_trace_id: input.requestContext.traceId,
      context_client_ip: input.requestContext.clientIp,
      context_user_agent: input.requestContext.userAgent,
    },
  )
  if (error) throw infrastructure()

  const row = exactlyOneRow(data)
  const isDuplicate = row.is_duplicate
  if (typeof isDuplicate !== "boolean") throw infrastructure()
  return {
    gatewayEventId: requiredString(row, "gateway_event_id"),
    processingStatus: requiredString(row, "processing_status"),
    isDuplicate,
  }
}

export function createServerIntentStripeWebhookDependencies(
  stripe: Stripe,
  supabase: ServiceRoleClient,
): ServerIntentStripeWebhookDependencies {
  return {
    crypto: createSponsorshipCryptoFromEnvironment(),
    loadPaymentBoundary: (paymentAttemptId) =>
      loadPaymentBoundary(supabase, paymentAttemptId),
    retrieveCheckoutSession: (id) => stripe.checkout.sessions.retrieve(id),
    retrieveInvoice: (id) => stripe.invoices.retrieve(id),
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    ingestVerifiedEvent: (input) => ingestVerifiedEvent(supabase, input),
    quarantineVerifiedEvent: (input) =>
      quarantineVerifiedEvent(supabase, input),
    now: () => new Date(),
  }
}
