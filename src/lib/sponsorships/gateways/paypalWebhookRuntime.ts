import "server-only"

import { getPayPalApiUrl, paypalFetch } from "@/lib/paypal/client"
import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import {
  type AuthoritativePayPalFinancialMovement,
  type AuthoritativePayPalPaymentBoundary,
  PayPalWebhookError,
  type PayPalWebhookDependencies,
  type VerifiedPayPalFinancialAdjustmentInput,
  type VerifiedPayPalFinancialAdjustmentResult,
  type VerifiedPayPalGatewayEventInput,
  type VerifiedPayPalGatewayEventResult,
  type VerifiedPayPalNoEffectInput,
  type VerifiedPayPalNoEffectResult,
  type VerifiedPayPalQuarantineInput,
  type VerifiedPayPalQuarantineResult,
} from "@/lib/sponsorships/gateways/paypalWebhook"
import type { SupportedCurrency } from "@/utils/currency"
import { createServiceRoleClient } from "@/utils/supabase/server"

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

const MAXIMUM_PROVIDER_RESPONSE_BYTES = 256 * 1024

interface DatabaseError {
  code?: string
}

function infrastructure(): PayPalWebhookError {
  return new PayPalWebhookError("infrastructure", { retryable: true })
}

function providerUnavailable(): PayPalWebhookError {
  return new PayPalWebhookError("provider-chain-unavailable", {
    retryable: true,
  })
}

function evidenceConflict(error: DatabaseError | null): never {
  if (
    ["22023", "22P02", "23503", "23505", "23514"].includes(error?.code || "")
  ) {
    throw new PayPalWebhookError("boundary-mismatch", {
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
  const raw = row[key]
  const value =
    typeof raw === "string" && /^-?[0-9]+$/.test(raw) ? Number(raw) : raw
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw infrastructure()
  }
  return value
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

function exactlyOneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw infrastructure()
  }
  return data[0]
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length")
  if (declaredLength && /^[0-9]+$/.test(declaredLength)) {
    const parsed = Number(declaredLength)
    if (
      !Number.isSafeInteger(parsed) ||
      parsed > MAXIMUM_PROVIDER_RESPONSE_BYTES
    ) {
      throw providerUnavailable()
    }
  }
  const body = await response.text()
  if (Buffer.byteLength(body, "utf8") > MAXIMUM_PROVIDER_RESPONSE_BYTES) {
    throw providerUnavailable()
  }
  return body
}

async function retrieveProviderJson(path: string): Promise<unknown> {
  let response: Response
  try {
    response = await paypalFetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
  } catch {
    throw providerUnavailable()
  }
  const body = await readBoundedResponse(response)
  if (!response.ok) throw providerUnavailable()
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw providerUnavailable()
  }
}

async function loadPaymentBoundary(
  supabase: ServiceRoleClient,
  paymentAttemptId: string,
): Promise<AuthoritativePayPalPaymentBoundary> {
  const { data: attemptData, error: attemptError } = await supabase
    .from("sponsorship_payment_attempts")
    .select(
      "id, sponsorship_intent_id, provider, provider_account_scope, status, payment_mode, base_amount_usd_cents, charged_amount_minor, charged_currency, conversion_rate, provider_object_type, provider_object_id, provider_customer_id, provider_subscription_object_type, provider_subscription_object_id",
    )
    .eq("id", paymentAttemptId)
    .maybeSingle()
  if (attemptError) throw infrastructure()
  if (!attemptData || !isRecord(attemptData)) {
    throw new PayPalWebhookError("boundary-mismatch")
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
    throw new PayPalWebhookError("boundary-mismatch")
  }

  const { data: planData, error: planError } = await supabase.rpc(
    "read_paypal_webhook_expected_plan",
    { target_payment_attempt_id: paymentAttemptId },
  )
  if (planError) throw infrastructure()
  const planRow = exactlyOneRow(planData)
  const expectedProviderPlanId = optionalString(planRow, "provider_plan_id")

  const provider = requiredString(attemptData, "provider")
  const scope = requiredString(attemptData, "provider_account_scope")
  const objectType = requiredString(attemptData, "provider_object_type")
  const subscriptionObjectType = optionalString(
    attemptData,
    "provider_subscription_object_type",
  )
  if (
    provider !== "PAYPAL" ||
    scope !== "paypal" ||
    (objectType !== "order" && objectType !== "billing_subscription") ||
    (subscriptionObjectType !== null &&
      subscriptionObjectType !== "billing_subscription")
  ) {
    throw new PayPalWebhookError("boundary-mismatch")
  }

  return {
    attemptId: requiredString(attemptData, "id"),
    intentId: requiredString(intentData, "id"),
    provider: "PAYPAL",
    providerAccountScope: "paypal",
    attemptStatus: requiredString(attemptData, "status"),
    paymentMode: requiredPaymentMode(attemptData, "payment_mode"),
    recurrenceInterval: requiredRecurrence(intentData, "recurrence_interval"),
    baseAmountUsdCents: requiredInteger(attemptData, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(attemptData, "charged_amount_minor"),
    chargedCurrency: requiredCurrency(attemptData, "charged_currency"),
    conversionRate: requiredNumber(attemptData, "conversion_rate"),
    providerObjectType: objectType,
    providerObjectId: requiredString(attemptData, "provider_object_id"),
    providerCustomerId: optionalString(attemptData, "provider_customer_id"),
    providerSubscriptionObjectType: subscriptionObjectType,
    providerSubscriptionId: optionalString(
      attemptData,
      "provider_subscription_object_id",
    ),
    expectedProviderPlanId,
    intentPaymentMode: requiredPaymentMode(intentData, "payment_mode"),
    intentRecurrenceInterval: requiredRecurrence(
      intentData,
      "recurrence_interval",
    ),
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

async function loadOriginalMovement(
  supabase: ServiceRoleClient,
  input: {
    providerMovementType: "capture" | "sale" | null
    providerMovementId: string
  },
): Promise<AuthoritativePayPalFinancialMovement> {
  let query = supabase
    .from("sponsorship_financial_movements")
    .select(
      "id, payment_attempt_id, sponsorship_intent_id, provider, provider_account_scope, provider_movement_type, provider_movement_id, entry_kind, original_financial_movement_id, payment_mode, base_amount_usd_cents, charged_amount_minor, charged_currency, conversion_rate, occurred_at",
    )
    .eq("provider", "PAYPAL")
    .eq("provider_account_scope", "paypal")
    .eq("provider_movement_id", input.providerMovementId)
    .eq("entry_kind", "sponsorship_payment")
    .is("original_financial_movement_id", null)
  if (input.providerMovementType !== null) {
    query = query.eq("provider_movement_type", input.providerMovementType)
  }
  const { data, error } = await query.limit(2)
  if (error) throw infrastructure()
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw new PayPalWebhookError("boundary-mismatch")
  }
  const row = data[0]
  const provider = requiredString(row, "provider")
  const scope = requiredString(row, "provider_account_scope")
  const movementType = requiredString(row, "provider_movement_type")
  const entryKind = requiredString(row, "entry_kind")
  const mode = requiredPaymentMode(row, "payment_mode")
  if (
    provider !== "PAYPAL" ||
    scope !== "paypal" ||
    (movementType !== "capture" && movementType !== "sale") ||
    entryKind !== "sponsorship_payment" ||
    optionalString(row, "original_financial_movement_id") !== null
  ) {
    throw infrastructure()
  }
  return {
    id: requiredString(row, "id"),
    paymentAttemptId: requiredString(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredString(row, "sponsorship_intent_id"),
    provider: "PAYPAL",
    providerAccountScope: "paypal",
    providerMovementType: movementType,
    providerMovementId: requiredString(row, "provider_movement_id"),
    entryKind: "sponsorship_payment",
    originalFinancialMovementId: null,
    paymentMode: mode,
    baseAmountUsdCents: requiredInteger(row, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(row, "charged_amount_minor"),
    chargedCurrency: requiredCurrency(row, "charged_currency"),
    conversionRate: requiredNumber(row, "conversion_rate"),
    occurredAt: requiredString(row, "occurred_at"),
  }
}

async function ingestVerifiedEvent(
  supabase: ServiceRoleClient,
  input: VerifiedPayPalGatewayEventInput,
): Promise<VerifiedPayPalGatewayEventResult> {
  const isPayPalFailureV2 =
    input.eventType === "PAYMENT.CAPTURE.DECLINED" ||
    input.eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED"
  const rpcName = isPayPalFailureV2
    ? "ingest_verified_paypal_payment_failure_v2"
    : "ingest_verified_payment_gateway_event"
  const common = {
    target_payment_attempt_id: input.paymentAttemptId,
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
    context_request_id: input.requestContext.requestId,
    context_trace_id: input.requestContext.traceId,
    context_client_ip: input.requestContext.clientIp,
    context_user_agent: input.requestContext.userAgent,
  }
  const args = isPayPalFailureV2
    ? {
        ...common,
        target_fact_server_payment_attempt_id: input.factServerPaymentAttemptId,
        target_fact_parent_provider_object_type:
          input.factParentProviderObjectType,
        target_fact_parent_provider_object_id: input.factParentProviderObjectId,
        target_fact_provider_customer_id: input.factProviderCustomerId,
        target_fact_provider_subscription_id: input.factProviderSubscriptionId,
        target_fact_failure_code: input.factFailureCode,
      }
    : {
        ...common,
        target_provider: "PAYPAL",
        target_fact_payment_status: input.factPaymentStatus,
        target_fact_server_payment_attempt_id: input.factServerPaymentAttemptId,
        target_fact_parent_provider_object_type:
          input.factParentProviderObjectType,
        target_fact_parent_provider_object_id: input.factParentProviderObjectId,
        target_fact_provider_movement_type: input.factProviderMovementType,
        target_fact_provider_movement_id: input.factProviderMovementId,
        target_fact_provider_customer_id: input.factProviderCustomerId,
        target_fact_provider_subscription_id: input.factProviderSubscriptionId,
        target_fact_base_amount_usd_cents: input.factBaseAmountUsdCents,
        target_fact_charged_amount_minor: input.factChargedAmountMinor,
        target_fact_charged_currency: input.factChargedCurrency,
        target_fact_conversion_rate: input.factConversionRate,
        target_fact_period_start: input.factPeriodStart,
        target_fact_period_end: input.factPeriodEnd,
        target_fact_failure_code: input.factFailureCode,
        target_fact_lifecycle_state: input.factLifecycleState,
      }
  const { data, error } = await supabase.rpc(rpcName, args)
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

async function ingestVerifiedNoEffect(
  supabase: ServiceRoleClient,
  input: VerifiedPayPalNoEffectInput,
): Promise<VerifiedPayPalNoEffectResult> {
  const { data, error } = await supabase.rpc(
    "ingest_verified_paypal_dispute_no_effect",
    {
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
  const isDuplicate = row.is_duplicate
  if (typeof isDuplicate !== "boolean") throw infrastructure()
  return {
    gatewayEventId: requiredString(row, "gateway_event_id"),
    processingStatus: requiredString(row, "processing_status"),
    isDuplicate,
  }
}

async function quarantineVerifiedEvent(
  supabase: ServiceRoleClient,
  input: VerifiedPayPalQuarantineInput,
): Promise<VerifiedPayPalQuarantineResult> {
  const { data, error } = await supabase.rpc(
    "quarantine_verified_payment_gateway_event",
    {
      target_provider: "PAYPAL",
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

async function ingestVerifiedAdjustment(
  supabase: ServiceRoleClient,
  input: VerifiedPayPalFinancialAdjustmentInput,
): Promise<VerifiedPayPalFinancialAdjustmentResult> {
  const { data, error } = await supabase.rpc(
    "ingest_verified_sponsorship_financial_adjustment",
    {
      target_original_financial_movement_id: input.originalFinancialMovementId,
      target_provider: "PAYPAL",
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
  if (typeof isDuplicate !== "boolean") throw infrastructure()
  return {
    gatewayEventId: requiredString(row, "gateway_event_id"),
    originalFinancialMovementId: requiredString(
      row,
      "original_financial_movement_id",
    ),
    paymentAttemptId: requiredString(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredString(row, "sponsorship_intent_id"),
    processingStatus: requiredString(row, "processing_status"),
    adjustmentKind: requiredString(row, "adjustment_kind"),
    isDuplicate,
  }
}

export function createPayPalWebhookDependencies(
  supabase: ServiceRoleClient = createServiceRoleClient(),
): PayPalWebhookDependencies {
  return {
    crypto: createSponsorshipCryptoFromEnvironment(),
    async verifyWebhookSignature(requestBody) {
      let response: Response
      try {
        response = await paypalFetch(
          "/v1/notifications/verify-webhook-signature",
          {
            method: "POST",
            headers: { Accept: "application/json" },
            body: requestBody,
          },
        )
      } catch {
        throw infrastructure()
      }
      return {
        ok: response.ok,
        status: response.status,
        body: await readBoundedResponse(response),
      }
    },
    retrieveOrder: (id) =>
      retrieveProviderJson(`/v2/checkout/orders/${encodeURIComponent(id)}`),
    retrieveSubscription: (id) =>
      retrieveProviderJson(
        `/v1/billing/subscriptions/${encodeURIComponent(id)}`,
      ),
    loadPaymentBoundary: (paymentAttemptId) =>
      loadPaymentBoundary(supabase, paymentAttemptId),
    loadOriginalMovement: (input) => loadOriginalMovement(supabase, input),
    ingestVerifiedEvent: (input) => ingestVerifiedEvent(supabase, input),
    quarantineVerifiedEvent: (input) =>
      quarantineVerifiedEvent(supabase, input),
    ingestVerifiedAdjustment: (input) =>
      ingestVerifiedAdjustment(supabase, input),
    ingestVerifiedNoEffect: (input) => ingestVerifiedNoEffect(supabase, input),
    now: () => new Date(),
  }
}

export function getConfiguredPayPalApiUrl(): string {
  return getPayPalApiUrl()
}
