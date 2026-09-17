import "server-only"

import {
  createPayPalBillingCatalogRepository,
  type PayPalBillingCatalogRpcClient,
} from "@/lib/paypal/billingCatalogRepository"
import { ensurePayPalBillingPlan } from "@/lib/paypal/billingCatalogProvisioner"
import {
  capturePayPalSponsorshipOrder,
  createPayPalSponsorshipProviderObject,
} from "@/lib/paypal/sponsorshipCheckout"
import {
  type BeginPayPalV2PaymentInput,
  type CapturePayPalSponsorshipDependencies,
  type PayPalCaptureMaterial,
  type PayPalSponsorshipCheckoutV2Dependencies,
  type ResumedPayPalV2Checkout,
  type SettlePayPalProviderObjectInput,
  type VerifiedPayPalCaptureInput,
} from "@/lib/sponsorships/checkout/paypalCheckout"
import type { PayPalProviderRequestTemplateClaims } from "@/lib/sponsorships/checkout/paypalProviderRequest"
import {
  type AuthoritativeBeneficiary,
  type BegunV2Payment,
  type IssueV2QuoteInput,
  type IssuedQuote,
  type PrepareV2IntentInput,
  type PreparedIntent,
  type RecoverV2CheckoutInput,
  type RecoveredV2Checkout,
  type ResumeV2CheckoutInput,
} from "@/lib/sponsorships/checkout/stripeCheckout"
import {
  createSponsorshipCryptoFromEnvironment,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import type { SupportedCurrency } from "@/utils/currency"
import { createServiceRoleClient } from "@/utils/supabase/server"

export type PayPalCheckoutServiceClient = ReturnType<
  typeof createServiceRoleClient
>

interface RpcFailureShape {
  code?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RPC_BYTEA_PATTERN = /^\\x(?:[0-9a-f]{2})+$/
const SUPPORTED_CURRENCIES = new Set(["USD", "AUD", "GBP", "EUR"])
const ELIGIBLE_FIXED_BENEFICIARY_STATUSES = new Set(["New", "Partially Funded"])

export class PayPalCheckoutRuntimeError extends Error {
  readonly databaseCode: string | null

  constructor(databaseCode: string | null = null) {
    super("PayPal checkout runtime failed")
    this.name = "PayPalCheckoutRuntimeError"
    this.databaseCode = databaseCode
  }
}

function fail(error: RpcFailureShape | null = null): never {
  throw new PayPalCheckoutRuntimeError(error?.code ?? null)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function oneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) fail()
  return data[0]
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
  maximumLength = 4096,
): string {
  const value = row[key]
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim()
  ) {
    fail()
  }
  return value
}

function nullableString(
  row: Record<string, unknown>,
  key: string,
  maximumLength = 4096,
): string | null {
  if (row[key] === null || row[key] === undefined) return null
  return requiredString(row, key, maximumLength)
}

function requiredUuid(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key, 36)
  if (!UUID_PATTERN.test(value)) fail()
  return value
}

function nullableUuid(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = nullableString(row, key, 36)
  if (value !== null && !UUID_PATTERN.test(value)) fail()
  return value
}

function integerValue(value: unknown): number {
  const parsed =
    typeof value === "string" && /^-?[0-9]+$/.test(value)
      ? Number(value)
      : value
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed)) fail()
  return parsed
}

function requiredInteger(row: Record<string, unknown>, key: string): number {
  return integerValue(row[key])
}

function nullableInteger(
  row: Record<string, unknown>,
  key: string,
): number | null {
  if (row[key] === null || row[key] === undefined) return null
  return integerValue(row[key])
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const raw = row[key]
  const value = typeof raw === "string" ? Number(raw) : raw
  if (typeof value !== "number" || !Number.isFinite(value)) fail()
  return value
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  if (typeof row[key] !== "boolean") fail()
  return row[key]
}

function requiredTimestamp(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key, 64)
  if (!Number.isFinite(Date.parse(value))) fail()
  return new Date(value).toISOString()
}

function nullableTimestamp(
  row: Record<string, unknown>,
  key: string,
): string | null {
  if (row[key] === null || row[key] === undefined) return null
  return requiredTimestamp(row, key)
}

function requiredRpcBytea(
  row: Record<string, unknown>,
  key: string,
): SupabaseRpcBytea {
  const value = requiredString(row, key, 131_074)
  if (!RPC_BYTEA_PATTERN.test(value)) fail()
  return value as SupabaseRpcBytea
}

function nullableRpcBytea(
  row: Record<string, unknown>,
  key: string,
): SupabaseRpcBytea | null {
  if (row[key] === null || row[key] === undefined) return null
  return requiredRpcBytea(row, key)
}

function requiredDigest(
  row: Record<string, unknown>,
  key: string,
): SupabaseRpcBytea {
  const value = requiredRpcBytea(row, key)
  if (!/^\\x[0-9a-f]{64}$/.test(value)) fail()
  return value
}

function requiredJson(
  row: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = row[key]
  if (!isRecord(value)) fail()
  return value
}

function requiredCurrency(
  row: Record<string, unknown>,
  key: string,
): SupportedCurrency {
  const value = requiredString(row, key, 3)
  if (!SUPPORTED_CURRENCIES.has(value)) fail()
  return value as SupportedCurrency
}

async function recoverCheckout(
  client: PayPalCheckoutServiceClient,
  input: RecoverV2CheckoutInput,
): Promise<RecoveredV2Checkout | null> {
  const { data, error } = await client.rpc("recover_sponsorship_checkout_v2", {
    target_checkout_receipt_digest: input.checkoutReceiptDigest,
    target_expected_operation_id: input.operationId,
    target_expected_provider: input.provider,
    target_expected_provider_account_scope: input.providerAccountScope,
    target_expected_provider_idempotency_key: input.providerIdempotencyKey,
  })
  if (error) fail(error)
  if (!Array.isArray(data) || data.length === 0) return null
  const row = oneRow(data)
  return {
    operationId: requiredUuid(row, "operation_id"),
    operationCreatedAt: requiredTimestamp(row, "operation_created_at"),
    paymentAttemptId: nullableUuid(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredUuid(row, "sponsorship_intent_id"),
    paymentQuoteId: nullableUuid(row, "payment_quote_id"),
    provider: requiredString(
      row,
      "provider",
      20,
    ) as RecoveredV2Checkout["provider"],
    providerAccountScope: requiredString(row, "provider_account_scope", 120),
    intentStatus: requiredString(row, "intent_status", 40),
    attemptStatus: nullableString(row, "attempt_status", 40),
    subjectKind: requiredString(
      row,
      "subject_kind",
      40,
    ) as RecoveredV2Checkout["subjectKind"],
    beneficiaryId: nullableUuid(row, "beneficiary_id"),
    paymentMode: requiredString(
      row,
      "payment_mode",
      40,
    ) as RecoveredV2Checkout["paymentMode"],
    recurrenceInterval: nullableString(
      row,
      "recurrence_interval",
      20,
    ) as RecoveredV2Checkout["recurrenceInterval"],
    baseAmountUsdCents: requiredInteger(row, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(row, "charged_amount_minor"),
    chargedCurrency: requiredCurrency(row, "charged_currency"),
    conversionRate: requiredNumber(row, "conversion_rate"),
    currencyQuoteAt: requiredTimestamp(row, "currency_quote_at"),
    quoteIssuedAt: nullableTimestamp(row, "quote_issued_at"),
    quoteExpiresAt: nullableTimestamp(row, "quote_expires_at"),
    checkoutReceiptExpiresAt: nullableTimestamp(
      row,
      "checkout_receipt_expires_at",
    ),
    providerRequestSchemaVersion: nullableInteger(
      row,
      "provider_request_schema_version",
    ),
    providerRequestFingerprint: nullableRpcBytea(
      row,
      "provider_request_fingerprint",
    ),
    providerRequestExpiresAt: nullableTimestamp(
      row,
      "provider_request_expires_at",
    ),
    providerRequestEncryptionKeyVersion: nullableInteger(
      row,
      "provider_request_encryption_key_version",
    ),
    providerObjectAttached: requiredBoolean(row, "provider_object_attached"),
    recoveryStatus: requiredString(row, "recovery_status", 40),
    recoveryAttemptCount: nullableInteger(row, "recovery_attempt_count"),
    recoveryMaxAttempts: nullableInteger(row, "recovery_max_attempts"),
    nextReconciliationAt: nullableTimestamp(row, "next_reconciliation_at"),
  }
}

async function prepareIntent(
  client: PayPalCheckoutServiceClient,
  input: PrepareV2IntentInput,
): Promise<PreparedIntent> {
  const { data, error } = await client.rpc(
    "prepare_sponsorship_checkout_intent_v2",
    {
      target_checkout_operation_id: input.checkoutOperationId,
      target_checkout_receipt_digest: input.checkoutReceiptDigest,
      target_provider: input.provider,
      target_provider_account_scope: input.providerAccountScope,
      target_provider_idempotency_key: input.providerIdempotencyKey,
      target_idempotency_key: input.idempotencyKey,
      target_source: input.source,
      target_advocate_hostname: input.advocateHostname,
      target_visitor_token_digest: input.visitorTokenDigest,
      target_auth_user_id: input.authUserId,
      target_contact_email_hmac: input.contactEmailDigest.digestRpcBytea,
      target_contact_email_normalization_version:
        input.contactEmailDigest.normalizationVersion,
      target_contact_email_hmac_key_version:
        input.contactEmailDigest.hmacKeyVersion,
      target_subject_kind: input.subjectKind,
      target_beneficiary_id: input.beneficiaryId,
      target_partnership_project: null,
      target_payment_mode: input.paymentMode,
      target_recurrence_interval: input.recurrenceInterval,
      target_base_amount_usd_cents: input.baseAmountUsdCents,
      target_charged_amount_minor: input.chargedAmountMinor,
      target_charged_currency: input.chargedCurrency,
      target_conversion_rate: input.conversionRate,
      target_currency_quote_at: input.currencyQuoteAt,
      target_currency_rate_source: input.currencyRateSource,
      context_request_id: input.requestId,
      context_trace_id: input.traceId,
    },
  )
  if (error) fail(error)
  const row = oneRow(data)
  return {
    sponsorshipIntentId: requiredUuid(row, "resolved_sponsorship_intent_id"),
    intentStatus: requiredString(row, "resolved_intent_status", 40),
    isReplay: requiredBoolean(row, "replayed"),
  }
}

async function issueQuote(
  client: PayPalCheckoutServiceClient,
  input: IssueV2QuoteInput,
): Promise<IssuedQuote> {
  const { data, error } = await client.rpc(
    "issue_sponsorship_payment_quote_v2",
    {
      target_checkout_operation_id: input.checkoutOperationId,
      target_sponsorship_intent_id: input.sponsorshipIntentId,
      target_quote_idempotency_key: input.idempotencyKey,
      target_valid_for: "15 minutes",
      context_request_id: input.requestId,
      context_trace_id: input.traceId,
    },
  )
  if (error) fail(error)
  const row = oneRow(data)
  if (
    requiredUuid(row, "checkout_operation_id") !== input.checkoutOperationId
  ) {
    fail()
  }
  return {
    paymentQuoteId: requiredUuid(row, "payment_quote_id"),
    sponsorshipIntentId: requiredUuid(row, "sponsorship_intent_id"),
    provider: requiredString(row, "provider", 20) as IssuedQuote["provider"],
    providerAccountScope: requiredString(row, "provider_account_scope", 120),
    baseAmountUsdCents: requiredInteger(row, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(row, "charged_amount_minor"),
    chargedCurrency: requiredCurrency(row, "charged_currency"),
    conversionRate: requiredNumber(row, "conversion_rate"),
    expiresAt: requiredTimestamp(row, "expires_at"),
  }
}

async function beginPayment(
  client: PayPalCheckoutServiceClient,
  input: BeginPayPalV2PaymentInput,
): Promise<BegunV2Payment> {
  const { data, error } = await client.rpc("begin_sponsorship_payment_v2", {
    target_checkout_operation_id: input.checkoutOperationId,
    target_sponsorship_intent_id: input.sponsorshipIntentId,
    target_payment_quote_id: input.paymentQuoteId,
    target_provider: input.provider,
    target_provider_account_scope: input.providerAccountScope,
    target_provider_idempotency_key: input.providerIdempotencyKey,
    target_checkout_receipt_digest: input.checkoutReceiptDigest,
    target_provider_request_schema_version: input.providerRequest.schemaVersion,
    target_provider_request_template_claims: input.providerRequestClaims,
    target_provider_request_fingerprint: input.providerRequest.fingerprint,
    target_provider_request_expires_at: input.providerRequest.expiresAt,
    target_provider_request_ciphertext: input.providerRequest.ciphertext,
    target_provider_request_encryption_key_version:
      input.providerRequest.encryptionKeyVersion,
    target_provider_request_ciphertext_sha256:
      input.providerRequest.ciphertextSha256,
    target_checkout_receipt_valid_for: "24 hours",
    target_metadata: { checkout_surface: "paypal" },
    context_request_id: input.requestContext.requestId,
    context_trace_id: input.requestContext.traceId,
    context_client_ip: input.requestContext.clientIp,
    context_user_agent: input.requestContext.userAgent,
  })
  if (error) fail(error)
  const row = oneRow(data)
  return {
    checkoutOperationId: requiredUuid(row, "checkout_operation_id"),
    paymentAttemptId: requiredUuid(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredUuid(row, "sponsorship_intent_id"),
    provider: requiredString(row, "provider", 20) as BegunV2Payment["provider"],
    providerAccountScope: requiredString(row, "provider_account_scope", 120),
    paymentMode: requiredString(
      row,
      "payment_mode",
      40,
    ) as BegunV2Payment["paymentMode"],
    baseAmountUsdCents: requiredInteger(row, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(row, "charged_amount_minor"),
    chargedCurrency: requiredCurrency(row, "charged_currency"),
    conversionRate: requiredNumber(row, "conversion_rate"),
    providerRequestExpiresAt: requiredTimestamp(
      row,
      "provider_request_expires_at",
    ),
    replayed: requiredBoolean(row, "replayed"),
  }
}

async function resumeCheckout(
  client: PayPalCheckoutServiceClient,
  input: ResumeV2CheckoutInput,
): Promise<ResumedPayPalV2Checkout> {
  const { data, error } = await client.rpc(
    "resume_sponsorship_checkout_operation_v2",
    {
      target_checkout_receipt_digest: input.checkoutReceiptDigest,
      target_checkout_operation_id: input.operationId,
      target_provider: input.provider,
      target_provider_account_scope: input.providerAccountScope,
      target_provider_idempotency_key: input.providerIdempotencyKey,
      context_request_id: input.requestId,
      context_trace_id: input.traceId,
    },
  )
  if (error) fail(error)
  const row = oneRow(data)
  return {
    checkoutOperationId: requiredUuid(row, "checkout_operation_id"),
    paymentAttemptId: requiredUuid(row, "payment_attempt_id"),
    provider: requiredString(
      row,
      "provider",
      20,
    ) as ResumedPayPalV2Checkout["provider"],
    providerAccountScope: requiredString(row, "provider_account_scope", 120),
    providerIdempotencyKey: requiredString(
      row,
      "provider_idempotency_key",
      255,
    ),
    attemptStatus: requiredString(row, "attempt_status", 40),
    providerObjectAttached: requiredBoolean(row, "provider_object_attached"),
    providerRequestSchemaVersion: requiredInteger(
      row,
      "provider_request_schema_version",
    ),
    providerRequestTemplateClaims: requiredJson(
      row,
      "provider_request_template_claims",
    ) as unknown as PayPalProviderRequestTemplateClaims,
    providerRequestFingerprint: requiredDigest(
      row,
      "provider_request_fingerprint",
    ),
    providerRequestExpiresAt: requiredTimestamp(
      row,
      "provider_request_expires_at",
    ),
    providerRequestCiphertext: requiredRpcBytea(
      row,
      "provider_request_ciphertext",
    ),
    providerRequestEncryptionKeyVersion: requiredInteger(
      row,
      "provider_request_encryption_key_version",
    ),
    providerRequestCiphertextSha256: requiredDigest(
      row,
      "provider_request_ciphertext_sha256",
    ),
    foregroundLeaseToken: requiredUuid(row, "foreground_lease_token"),
    foregroundLeaseExpiresAt: requiredTimestamp(
      row,
      "foreground_lease_expires_at",
    ),
  }
}

async function settleProviderObject(
  client: PayPalCheckoutServiceClient,
  input: SettlePayPalProviderObjectInput,
): Promise<void> {
  const rpcName =
    input.recoveryLeaseToken === null
      ? "attach_sponsorship_payment_provider_object_v2"
      : "finalize_sponsorship_checkout_recovery_v2"
  const args =
    input.recoveryLeaseToken === null
      ? {
          target_payment_attempt_id: input.paymentAttemptId,
          target_provider_object_type: input.providerObjectType,
          target_provider_object_id: input.providerObjectId,
          target_provider_request_schema_version:
            input.providerRequestSchemaVersion,
          target_provider_request_fingerprint: input.providerRequestFingerprint,
          target_provider_request_expires_at: input.providerRequestExpiresAt,
          target_recovery_lease_token: null,
          context_request_id: input.requestContext.requestId,
          context_trace_id: input.requestContext.traceId,
          context_client_ip: input.requestContext.clientIp,
          context_user_agent: input.requestContext.userAgent,
        }
      : {
          target_payment_attempt_id: input.paymentAttemptId,
          target_recovery_lease_token: input.recoveryLeaseToken,
          target_resolution: "provider_attached",
          target_provider_request_schema_version:
            input.providerRequestSchemaVersion,
          target_provider_request_fingerprint: input.providerRequestFingerprint,
          target_provider_request_expires_at: input.providerRequestExpiresAt,
          target_provider_object_type: input.providerObjectType,
          target_provider_object_id: input.providerObjectId,
          target_provider_terminal_status: null,
          target_provider_reconciled_at: null,
          target_reconciliation_evidence_sha256: null,
          target_reconciliation_evidence_ciphertext: null,
          target_reconciliation_evidence_encryption_key_version: null,
          target_release_reason: null,
          context_request_id: input.requestContext.requestId,
          context_trace_id: input.requestContext.traceId,
        }
  const { data, error } = await client.rpc(rpcName, args)
  if (error) fail(error)
  const row = oneRow(data)
  if (
    requiredUuid(row, "payment_attempt_id") !== input.paymentAttemptId ||
    !requiredBoolean(row, "provider_object_attached")
  ) {
    fail()
  }
}

async function loadBeneficiary(
  client: PayPalCheckoutServiceClient,
  id: string,
  allowCurrentlyIneligible: boolean,
): Promise<AuthoritativeBeneficiary | null> {
  const { data, error } = await client
    .from("beneficiaries")
    .select("id, name, budget_goal, status, goal_fulfilled_at")
    .eq("id", id)
    .maybeSingle()
  if (error) fail(error)
  if (!data || !isRecord(data)) return null
  const budgetGoal = integerValue(data.budget_goal)
  const eligible =
    budgetGoal === -1
      ? data.status !== "Draft" && data.status !== "Archived"
      : ELIGIBLE_FIXED_BENEFICIARY_STATUSES.has(String(data.status)) &&
        data.goal_fulfilled_at === null
  if (!eligible && !allowCurrentlyIneligible) return null
  return {
    id: requiredUuid(data, "id"),
    name: nullableString(data, "name", 500),
    budgetGoalUsdCents: budgetGoal,
    imageUrl: null,
  }
}

async function readCaptureMaterial(
  client: PayPalCheckoutServiceClient,
  input: {
    checkoutReceiptDigest: SupabaseRpcBytea
    operationId: string
  },
): Promise<PayPalCaptureMaterial> {
  const { data, error } = await client.rpc(
    "read_paypal_checkout_capture_material_v2",
    {
      target_checkout_receipt_digest: input.checkoutReceiptDigest,
      target_checkout_operation_id: input.operationId,
    },
  )
  if (error) fail(error)
  const row = oneRow(data)
  const scope = requiredString(row, "provider_account_scope", 120)
  const objectType = requiredString(row, "provider_object_type", 80)
  if (scope !== "paypal" || objectType !== "order") fail()
  return {
    checkoutOperationId: requiredUuid(row, "checkout_operation_id"),
    paymentAttemptId: requiredUuid(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredUuid(row, "sponsorship_intent_id"),
    paymentQuoteId: requiredUuid(row, "payment_quote_id"),
    providerAccountScope: "paypal",
    providerObjectType: "order",
    providerObjectId: requiredString(row, "provider_object_id", 32),
    providerRequestSchemaVersion: requiredInteger(
      row,
      "provider_request_schema_version",
    ),
    providerRequestTemplateClaims: requiredJson(
      row,
      "provider_request_template_claims",
    ) as unknown as PayPalProviderRequestTemplateClaims,
    providerRequestFingerprint: requiredDigest(
      row,
      "provider_request_fingerprint",
    ),
    providerRequestExpiresAt: requiredTimestamp(
      row,
      "provider_request_expires_at",
    ),
    providerRequestCiphertext: requiredRpcBytea(
      row,
      "provider_request_ciphertext",
    ),
    providerRequestEncryptionKeyVersion: requiredInteger(
      row,
      "provider_request_encryption_key_version",
    ),
    providerRequestCiphertextSha256: requiredDigest(
      row,
      "provider_request_ciphertext_sha256",
    ),
  }
}

async function readTerminalOrigin(
  client: PayPalCheckoutServiceClient,
  input: {
    checkoutReceiptDigest: SupabaseRpcBytea
    operationId: string
  },
): Promise<{
  source: "primary_site" | "advocate_domain"
  sourceHost: string
}> {
  const { data, error } = await client.rpc(
    "read_paypal_terminal_checkout_origin_v2",
    {
      target_checkout_receipt_digest: input.checkoutReceiptDigest,
      target_checkout_operation_id: input.operationId,
    },
  )
  if (error) fail(error)
  const row = oneRow(data)
  const source = requiredString(row, "source", 40)
  if (source !== "primary_site" && source !== "advocate_domain") fail()
  return {
    source,
    sourceHost: requiredString(row, "source_host", 253),
  }
}

async function ingestCapture(
  client: PayPalCheckoutServiceClient,
  input: VerifiedPayPalCaptureInput,
): Promise<void> {
  const { data, error } = await client.rpc(
    "ingest_verified_payment_gateway_event",
    {
      target_payment_attempt_id: input.paymentAttemptId,
      target_provider: "PAYPAL",
      target_provider_account_scope: input.providerAccountScope,
      target_provider_event_id: input.providerEventId,
      target_event_type: "PAYMENT.CAPTURE.COMPLETED",
      target_provider_object_type: "capture",
      target_provider_object_id: input.providerObjectId,
      target_redacted_payload: input.redactedPayload,
      target_payload_ciphertext: input.payloadCiphertext,
      target_payload_sha256: input.payloadSha256,
      target_signature_verified_at: input.signatureVerifiedAt,
      target_occurred_at: input.occurredAt,
      target_verification_method: "provider_api_response",
      target_fact_payment_status: "paid",
      target_fact_server_payment_attempt_id: input.paymentAttemptId,
      target_fact_parent_provider_object_type: "order",
      target_fact_parent_provider_object_id: input.parentOrderId,
      target_fact_provider_movement_type: "capture",
      target_fact_provider_movement_id: input.providerObjectId,
      target_fact_provider_customer_id: null,
      target_fact_provider_subscription_id: null,
      target_fact_base_amount_usd_cents: input.baseAmountUsdCents,
      target_fact_charged_amount_minor: input.chargedAmountMinor,
      target_fact_charged_currency: input.chargedCurrency,
      target_fact_conversion_rate: input.conversionRate,
      target_fact_period_start: null,
      target_fact_period_end: null,
      target_fact_failure_code: null,
      target_fact_lifecycle_state: null,
      context_request_id: input.requestContext.requestId,
      context_trace_id: input.requestContext.traceId,
      context_client_ip: input.requestContext.clientIp,
      context_user_agent: input.requestContext.userAgent,
    },
  )
  if (error) fail(error)
  const row = oneRow(data)
  if (
    requiredUuid(row, "payment_attempt_id") !== input.paymentAttemptId ||
    !["received", "processing", "processed"].includes(
      requiredString(row, "processing_status", 40),
    )
  ) {
    fail()
  }
}

export function createPayPalSponsorshipCheckoutV2Dependencies(
  client: PayPalCheckoutServiceClient,
): PayPalSponsorshipCheckoutV2Dependencies {
  const repository = createPayPalBillingCatalogRepository(
    client as unknown as PayPalBillingCatalogRpcClient,
  )
  return {
    crypto: createSponsorshipCryptoFromEnvironment(),
    loadBeneficiary: (id, allow) => loadBeneficiary(client, id, allow),
    recoverCheckout: (input) => recoverCheckout(client, input),
    prepareIntent: (input) => prepareIntent(client, input),
    issueQuote: (input) => issueQuote(client, input),
    beginPayment: (input) => beginPayment(client, input),
    resumeCheckout: (input) => resumeCheckout(client, input),
    readAttachedOneTimeOrder: (input) => readCaptureMaterial(client, input),
    ensureBillingPlan: (options) =>
      ensurePayPalBillingPlan({
        dependencies: { repository },
        terms: options.terms,
        context: options.context,
      }),
    createProviderObject: (request) =>
      createPayPalSponsorshipProviderObject(request),
    settleProviderObject: (input) => settleProviderObject(client, input),
    now: () => new Date(),
  }
}

export function createCapturePayPalSponsorshipDependencies(
  client: PayPalCheckoutServiceClient,
): CapturePayPalSponsorshipDependencies {
  return {
    crypto: createSponsorshipCryptoFromEnvironment(),
    recoverCheckout: (input) => recoverCheckout(client, input),
    readCaptureMaterial: (input) => readCaptureMaterial(client, input),
    readTerminalOrigin: (input) => readTerminalOrigin(client, input),
    captureOrder: (orderId, request) =>
      capturePayPalSponsorshipOrder(orderId, request),
    ingestCapture: (input) => ingestCapture(client, input),
    now: () => new Date(),
  }
}
