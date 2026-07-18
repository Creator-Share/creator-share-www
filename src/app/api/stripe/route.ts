import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  buildHostedStripeSessionParams,
  checkoutError,
  createStripeSponsorshipCheckoutV2,
  readSponsorshipVisitorCookie,
  resolveSponsorshipCheckoutHost,
  SponsorshipCheckoutError,
  type AuthoritativeBeneficiary,
  type BeginV2PaymentInput,
  type BegunV2Payment,
  type CreatedHostedStripeSession,
  type HostedStripeSessionInput,
  type IssueV2QuoteInput,
  type IssuedQuote,
  type PrepareV2IntentInput,
  type PreparedIntent,
  type RecoveredV2Checkout,
  type RecoverV2CheckoutInput,
  type ResumedV2Checkout,
  type ResumeV2CheckoutInput,
  type SettleV2ProviderObjectInput,
  type SponsorshipCheckoutRequestContext,
  type StripeSponsorshipCheckoutV2Dependencies,
} from "@/lib/sponsorships/checkout/stripeCheckout"
import {
  createSponsorshipCryptoFromEnvironment,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedCheckoutRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { getStripeClient } from "@/lib/stripe/config"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import {
  filterExistingMediaRows,
  getExternalCheckoutImageUrl,
  type MediaRow,
} from "@/utils/supabase/media"
import {
  createClient,
  createServiceRoleClient,
} from "@/utils/supabase/server"

export const runtime = "nodejs"

const PUBLIC_BASE_URL = "https://creator-share-www.vercel.app"
const MAXIMUM_REQUEST_BYTES = 16 * 1024
const ELIGIBLE_FIXED_BENEFICIARY_STATUSES = new Set([
  "New",
  "Partially Funded",
])

const CHECKOUT_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

interface RpcFailureShape {
  code?: string
}

class SponsorshipCheckoutDependencyError extends Error {
  readonly databaseCode: string | null

  constructor(databaseCode?: string) {
    super("Sponsorship checkout dependency failed")
    this.name = "SponsorshipCheckoutDependencyError"
    this.databaseCode = databaseCode || null
  }
}

function getPublicSiteBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || PUBLIC_BASE_URL
  if (base.includes("localhost") || base.includes("127.0.0.1")) {
    return PUBLIC_BASE_URL
  }
  return base.replace(/\/$/, "")
}

function boundedHeader(
  request: Request,
  headerName: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(headerName)?.trim()
  return value ? value.slice(0, maximumLength) : null
}

function requestContext(request: Request): SponsorshipCheckoutRequestContext {
  return {
    requestId: randomUUID(),
    traceId:
      boundedHeader(request, "x-vercel-id", 255) ??
      boundedHeader(request, "cf-ray", 255) ??
      boundedHeader(request, "traceparent", 255) ??
      boundedHeader(request, "x-trace-id", 255),
    clientIp:
      boundedHeader(request, "cf-connecting-ip", 256) ??
      boundedHeader(request, "x-vercel-forwarded-for", 256) ??
      boundedHeader(request, "x-forwarded-for", 256) ??
      boundedHeader(request, "x-real-ip", 256),
    userAgent: boundedHeader(request, "user-agent", 1024),
  }
}

function hostnameFromConfiguredUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`)
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

function allowedPrimaryHostnames(): Set<string> {
  return new Set(
    [
      "creator-share-www.vercel.app",
      hostnameFromConfiguredUrl(process.env.NEXT_PUBLIC_BASE_URL),
      hostnameFromConfiguredUrl(process.env.NEXT_PUBLIC_SITE_URL),
      hostnameFromConfiguredUrl(process.env.VERCEL_URL),
    ].filter((value): value is string => Boolean(value)),
  )
}

function rpcFailure(error: RpcFailureShape | null): never {
  throw new SponsorshipCheckoutDependencyError(error?.code)
}

function oneRpcRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new SponsorshipCheckoutDependencyError()
  }
  const row = data[0]
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return row as Record<string, unknown>
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return value
}

function requiredInteger(row: Record<string, unknown>, key: string): number {
  const rawValue = row[key]
  const value =
    typeof rawValue === "string" && /^-?[0-9]+$/.test(rawValue)
      ? Number(rawValue)
      : rawValue
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return value
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const rawValue = row[key]
  const value = typeof rawValue === "string" ? Number(rawValue) : rawValue
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return value
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key]
  if (typeof value !== "boolean") {
    throw new SponsorshipCheckoutDependencyError()
  }
  return value
}

function nullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return requiredString(row, key)
}

function nullableInteger(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return requiredInteger(row, key)
}

function requiredTimestamp(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = requiredString(row, key)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return new Date(milliseconds).toISOString()
}

function nullableTimestamp(
  row: Record<string, unknown>,
  key: string,
): string | null {
  return row[key] === null || row[key] === undefined
    ? null
    : requiredTimestamp(row, key)
}

function requiredRpcBytea(
  row: Record<string, unknown>,
  key: string,
): SupabaseRpcBytea {
  const value = requiredString(row, key)
  if (!/^\\x[0-9a-f]{64}$/.test(value)) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return value as SupabaseRpcBytea
}

function nullableRpcBytea(
  row: Record<string, unknown>,
  key: string,
): SupabaseRpcBytea | null {
  return row[key] === null || row[key] === undefined
    ? null
    : requiredRpcBytea(row, key)
}

function requiredEncryptedRpcBytea(
  row: Record<string, unknown>,
  key: string,
): SupabaseRpcBytea {
  const value = requiredString(row, key)
  const encoded = value.slice(2)
  if (
    !/^\\x[0-9a-f]+$/.test(value) ||
    encoded.length % 2 !== 0 ||
    encoded.length / 2 < 32 ||
    encoded.length / 2 > 65536
  ) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return value as SupabaseRpcBytea
}

function requiredJsonObject(
  row: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = row[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return value as Record<string, unknown>
}

async function getStripeProductImageUrl(
  supabase: ServiceRoleClient,
  beneficiaryId: string,
): Promise<string> {
  const fallbackImage = `${getPublicSiteBaseUrl()}${PERSON_PLACEHOLDER_PATH}`
  try {
    const { data, error } = await supabase
      .from("media")
      .select("*")
      .eq("parent_id", beneficiaryId)
      .eq("type", "IMAGE")
      .order("weight", { ascending: true })
      .limit(10)

    if (error || !data || data.length === 0) return fallbackImage
    const existingMedia = await filterExistingMediaRows(
      supabase,
      data as unknown as MediaRow[],
    )
    return existingMedia.length > 0
      ? getExternalCheckoutImageUrl(existingMedia[0])
      : fallbackImage
  } catch {
    return fallbackImage
  }
}

async function loadAuthoritativeBeneficiary(
  supabase: ServiceRoleClient,
  beneficiaryId: string,
  allowCurrentlyIneligible = false,
): Promise<AuthoritativeBeneficiary | null> {
  const { data, error } = await supabase
    .from("beneficiaries")
    .select("id, name, budget_goal, status, goal_fulfilled_at")
    .eq("id", beneficiaryId)
    .maybeSingle()

  if (error) rpcFailure(error)
  if (!data) return null

  const budgetGoal = Number(data.budget_goal)
  const isOpen = budgetGoal === -1
  const isEligible = isOpen
    ? data.status !== "Draft" && data.status !== "Archived"
    : ELIGIBLE_FIXED_BENEFICIARY_STATUSES.has(String(data.status)) &&
      data.goal_fulfilled_at === null

  if (
    !Number.isSafeInteger(budgetGoal) ||
    (!isEligible && !allowCurrentlyIneligible)
  ) {
    return null
  }
  return {
    id: String(data.id),
    name: typeof data.name === "string" ? data.name : null,
    budgetGoalUsdCents: budgetGoal,
    imageUrl: await getStripeProductImageUrl(supabase, beneficiaryId),
  }
}

async function authorizeCheckoutHost(
  supabase: ServiceRoleClient,
  host: Parameters<
    StripeSponsorshipCheckoutV2Dependencies["authorizeHost"]
  >[0],
): Promise<void> {
  if (host.source === "primary_site") {
    if (host.advocateHostname !== null) {
      throw new SponsorshipCheckoutDependencyError("23514")
    }
    return
  }

  if (!host.advocateHostname) {
    throw new SponsorshipCheckoutDependencyError("23514")
  }

  const { data: domain, error: domainError } = await supabase
    .from("advocate_domains")
    .select("advocate_id")
    .eq("hostname", host.advocateHostname)
    .eq("status", "active")
    .maybeSingle()
  if (domainError) rpcFailure(domainError)
  if (!domain) throw new SponsorshipCheckoutDependencyError("23514")

  const { data: advocate, error: advocateError } = await supabase
    .from("advocates")
    .select("id")
    .eq("id", domain.advocate_id)
    .eq("relationship_status", "active")
    .eq("publication_status", "active")
    .maybeSingle()
  if (advocateError) rpcFailure(advocateError)
  if (!advocate) throw new SponsorshipCheckoutDependencyError("23514")
}

async function recoverCheckoutV2(
  supabase: ServiceRoleClient,
  input: RecoverV2CheckoutInput,
): Promise<RecoveredV2Checkout | null> {
  const { data, error } = await supabase.rpc(
    "recover_sponsorship_checkout_v2",
    {
      target_checkout_receipt_digest: input.checkoutReceiptDigest,
      target_expected_operation_id: input.operationId,
      target_expected_provider: input.provider,
      target_expected_provider_account_scope: input.providerAccountScope,
      target_expected_provider_idempotency_key: input.providerIdempotencyKey,
    },
  )
  if (error) rpcFailure(error)
  if (!Array.isArray(data) || data.length === 0) return null

  const row = oneRpcRow(data)
  return {
    operationId: requiredString(row, "operation_id"),
    operationCreatedAt: requiredTimestamp(row, "operation_created_at"),
    paymentAttemptId: nullableString(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredString(row, "sponsorship_intent_id"),
    paymentQuoteId: nullableString(row, "payment_quote_id"),
    provider: requiredString(row, "provider") as RecoveredV2Checkout["provider"],
    providerAccountScope: requiredString(row, "provider_account_scope"),
    intentStatus: requiredString(row, "intent_status"),
    attemptStatus: nullableString(row, "attempt_status"),
    subjectKind: requiredString(row, "subject_kind") as RecoveredV2Checkout["subjectKind"],
    beneficiaryId: nullableString(row, "beneficiary_id"),
    paymentMode: requiredString(row, "payment_mode") as RecoveredV2Checkout["paymentMode"],
    recurrenceInterval: nullableString(
      row,
      "recurrence_interval",
    ) as RecoveredV2Checkout["recurrenceInterval"],
    baseAmountUsdCents: requiredInteger(row, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(row, "charged_amount_minor"),
    chargedCurrency: requiredString(row, "charged_currency") as RecoveredV2Checkout["chargedCurrency"],
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
    recoveryStatus: requiredString(row, "recovery_status"),
    recoveryAttemptCount: nullableInteger(row, "recovery_attempt_count"),
    recoveryMaxAttempts: nullableInteger(row, "recovery_max_attempts"),
    nextReconciliationAt: nullableTimestamp(row, "next_reconciliation_at"),
  }
}

async function prepareIntentV2(
  supabase: ServiceRoleClient,
  input: PrepareV2IntentInput,
): Promise<PreparedIntent> {
  const { data, error } = await supabase.rpc(
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
      target_partnership_project: input.partnershipProject,
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
  if (error) rpcFailure(error)

  const row = oneRpcRow(data)
  return {
    sponsorshipIntentId: requiredString(
      row,
      "resolved_sponsorship_intent_id",
    ),
    intentStatus: requiredString(row, "resolved_intent_status"),
    isReplay: requiredBoolean(row, "replayed"),
  }
}

async function issueQuoteV2(
  supabase: ServiceRoleClient,
  input: IssueV2QuoteInput,
): Promise<IssuedQuote> {
  const { data, error } = await supabase.rpc(
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
  if (error) rpcFailure(error)

  const row = oneRpcRow(data)
  if (
    requiredString(row, "checkout_operation_id") !==
    input.checkoutOperationId
  ) {
    throw new SponsorshipCheckoutDependencyError()
  }
  return {
    paymentQuoteId: requiredString(row, "payment_quote_id"),
    sponsorshipIntentId: requiredString(row, "sponsorship_intent_id"),
    provider: requiredString(row, "provider") as IssuedQuote["provider"],
    providerAccountScope: requiredString(row, "provider_account_scope"),
    baseAmountUsdCents: requiredInteger(row, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(row, "charged_amount_minor"),
    chargedCurrency: requiredString(row, "charged_currency") as IssuedQuote["chargedCurrency"],
    conversionRate: requiredNumber(row, "conversion_rate"),
    expiresAt: requiredTimestamp(row, "expires_at"),
  }
}

async function beginPaymentV2(
  supabase: ServiceRoleClient,
  input: BeginV2PaymentInput,
): Promise<BegunV2Payment> {
  const { data, error } = await supabase.rpc(
    "begin_sponsorship_payment_v2",
    {
      target_checkout_operation_id: input.checkoutOperationId,
      target_sponsorship_intent_id: input.sponsorshipIntentId,
      target_payment_quote_id: input.paymentQuoteId,
      target_provider: input.provider,
      target_provider_account_scope: input.providerAccountScope,
      target_provider_idempotency_key: input.providerIdempotencyKey,
      target_checkout_receipt_digest: input.checkoutReceiptDigest,
      target_provider_request_schema_version:
        input.providerRequest.schemaVersion,
      target_provider_request_template_claims: input.providerRequestClaims,
      target_provider_request_fingerprint: input.providerRequest.fingerprint,
      target_provider_request_expires_at: input.providerRequest.expiresAt,
      target_provider_request_ciphertext: input.providerRequest.ciphertext,
      target_provider_request_encryption_key_version:
        input.providerRequest.encryptionKeyVersion,
      target_provider_request_ciphertext_sha256:
        input.providerRequest.ciphertextSha256,
      target_checkout_receipt_valid_for: "24 hours",
      target_metadata: { checkout_surface: "hosted" },
      context_request_id: input.requestContext.requestId,
      context_trace_id: input.requestContext.traceId,
      context_client_ip: input.requestContext.clientIp,
      context_user_agent: input.requestContext.userAgent,
    },
  )
  if (error) rpcFailure(error)

  const row = oneRpcRow(data)
  return {
    checkoutOperationId: requiredString(row, "checkout_operation_id"),
    paymentAttemptId: requiredString(row, "payment_attempt_id"),
    sponsorshipIntentId: requiredString(row, "sponsorship_intent_id"),
    provider: requiredString(row, "provider") as BegunV2Payment["provider"],
    providerAccountScope: requiredString(row, "provider_account_scope"),
    paymentMode: requiredString(row, "payment_mode") as BegunV2Payment["paymentMode"],
    baseAmountUsdCents: requiredInteger(row, "base_amount_usd_cents"),
    chargedAmountMinor: requiredInteger(row, "charged_amount_minor"),
    chargedCurrency: requiredString(row, "charged_currency") as BegunV2Payment["chargedCurrency"],
    conversionRate: requiredNumber(row, "conversion_rate"),
    providerRequestExpiresAt: requiredTimestamp(
      row,
      "provider_request_expires_at",
    ),
    replayed: requiredBoolean(row, "replayed"),
  }
}

async function resumeCheckoutV2(
  supabase: ServiceRoleClient,
  input: ResumeV2CheckoutInput,
): Promise<ResumedV2Checkout> {
  const { data, error } = await supabase.rpc(
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
  if (error) rpcFailure(error)

  const row = oneRpcRow(data)
  return {
    checkoutOperationId: requiredString(row, "checkout_operation_id"),
    paymentAttemptId: requiredString(row, "payment_attempt_id"),
    provider: requiredString(row, "provider") as ResumedV2Checkout["provider"],
    providerAccountScope: requiredString(row, "provider_account_scope"),
    providerIdempotencyKey: requiredString(
      row,
      "provider_idempotency_key",
    ),
    attemptStatus: requiredString(row, "attempt_status"),
    providerObjectAttached: requiredBoolean(
      row,
      "provider_object_attached",
    ),
    providerRequestSchemaVersion: requiredInteger(
      row,
      "provider_request_schema_version",
    ),
    providerRequestTemplateClaims: requiredJsonObject(
      row,
      "provider_request_template_claims",
    ) as unknown as ResumedV2Checkout["providerRequestTemplateClaims"],
    providerRequestFingerprint: requiredRpcBytea(
      row,
      "provider_request_fingerprint",
    ),
    providerRequestExpiresAt: requiredTimestamp(
      row,
      "provider_request_expires_at",
    ),
    providerRequestCiphertext: requiredEncryptedRpcBytea(
      row,
      "provider_request_ciphertext",
    ),
    providerRequestEncryptionKeyVersion: requiredInteger(
      row,
      "provider_request_encryption_key_version",
    ),
    providerRequestCiphertextSha256: requiredRpcBytea(
      row,
      "provider_request_ciphertext_sha256",
    ),
    foregroundLeaseToken: requiredString(row, "foreground_lease_token"),
    foregroundLeaseExpiresAt: requiredTimestamp(
      row,
      "foreground_lease_expires_at",
    ),
  }
}

async function settleProviderObjectV2(
  supabase: ServiceRoleClient,
  input: SettleV2ProviderObjectInput,
): Promise<void> {
  if (input.recoveryLeaseToken === null) {
    const { data, error } = await supabase.rpc(
      "attach_sponsorship_payment_provider_object_v2",
      {
        target_payment_attempt_id: input.paymentAttemptId,
        target_provider_object_type: "checkout_session",
        target_provider_object_id: input.providerObjectId,
        target_provider_request_schema_version:
          input.providerRequestSchemaVersion,
        target_provider_request_fingerprint:
          input.providerRequestFingerprint,
        target_provider_request_expires_at: input.providerRequestExpiresAt,
        target_recovery_lease_token: null,
        context_request_id: input.requestContext.requestId,
        context_trace_id: input.requestContext.traceId,
        context_client_ip: input.requestContext.clientIp,
        context_user_agent: input.requestContext.userAgent,
      },
    )
    if (error) rpcFailure(error)
    const row = oneRpcRow(data)
    if (
      requiredString(row, "payment_attempt_id") !== input.paymentAttemptId ||
      requiredString(row, "status") !== "pending" ||
      !requiredBoolean(row, "provider_object_attached")
    ) {
      throw new SponsorshipCheckoutDependencyError()
    }
    return
  }

  const { data, error } = await supabase.rpc(
    "finalize_sponsorship_checkout_recovery_v2",
    {
      target_payment_attempt_id: input.paymentAttemptId,
      target_recovery_lease_token: input.recoveryLeaseToken,
      target_resolution: "provider_attached",
      target_provider_request_schema_version:
        input.providerRequestSchemaVersion,
      target_provider_request_fingerprint: input.providerRequestFingerprint,
      target_provider_request_expires_at: input.providerRequestExpiresAt,
      target_provider_object_type: "checkout_session",
      target_provider_object_id: input.providerObjectId,
      target_provider_terminal_status: null,
      target_provider_reconciled_at: null,
      target_reconciliation_evidence_sha256: null,
      target_reconciliation_evidence_ciphertext: null,
      target_reconciliation_evidence_encryption_key_version: null,
      target_release_reason: null,
      context_request_id: input.requestContext.requestId,
      context_trace_id: input.requestContext.traceId,
    },
  )
  if (error) rpcFailure(error)
  const row = oneRpcRow(data)
  if (
    requiredString(row, "payment_attempt_id") !== input.paymentAttemptId ||
    requiredString(row, "attempt_status") !== "pending" ||
    requiredString(row, "resolution") !== "provider_attached" ||
    !requiredBoolean(row, "provider_object_attached")
  ) {
    throw new SponsorshipCheckoutDependencyError()
  }
}

function createCheckoutV2Dependencies(
  supabase: ServiceRoleClient,
): StripeSponsorshipCheckoutV2Dependencies {
  const sponsorshipCrypto = createSponsorshipCryptoFromEnvironment()
  return {
    crypto: sponsorshipCrypto,
    authorizeHost: (host) => authorizeCheckoutHost(supabase, host),
    loadBeneficiary: (id, allowCurrentlyIneligible) =>
      loadAuthoritativeBeneficiary(
        supabase,
        id,
        allowCurrentlyIneligible,
      ),
    recoverCheckout: (input) => recoverCheckoutV2(supabase, input),
    prepareIntent: (input) => prepareIntentV2(supabase, input),
    issueQuote: (input) => issueQuoteV2(supabase, input),
    beginPayment: (input) => beginPaymentV2(supabase, input),
    resumeCheckout: (input) => resumeCheckoutV2(supabase, input),
    createHostedSession: async (
      input: HostedStripeSessionInput,
    ): Promise<CreatedHostedStripeSession> => {
      const stripe = getStripeClient(input.stripeRegion)
      const session = await stripe.checkout.sessions.create(
        buildHostedStripeSessionParams(input),
        { idempotencyKey: input.idempotencyKey },
      )
      if (!session.url) throw new SponsorshipCheckoutDependencyError()
      return {
        id: session.id,
        url: session.url,
        expiresAtUnixSeconds: session.expires_at,
      }
    },
    settleProviderObject: (input) =>
      settleProviderObjectV2(supabase, input),
    now: () => new Date(),
  }
}

function mapDependencyError(
  error: SponsorshipCheckoutDependencyError,
): SponsorshipCheckoutError {
  switch (error.databaseCode) {
    case "22023":
    case "22P02":
      return checkoutError("invalid-request")
    case "23503":
    case "23505":
    case "23514":
      return checkoutError("sponsorship-unavailable")
    default:
      return checkoutError("checkout-failed")
  }
}

async function authenticatedCheckoutUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (
    error ||
    !user ||
    !user.email ||
    !user.email_confirmed_at
  ) {
    return null
  }
  return { id: user.id, email: user.email }
}

export async function POST(request: Request) {
  const context = requestContext(request)
  const expectedOrigin = resolveTrustedCheckoutRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    !expectedOrigin ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return NextResponse.json(
      { error: "Invalid checkout request" },
      { status: 400 },
    )
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Checkout request is too large" },
      { status: 413 },
    )
  }

  let serializedBody: string
  try {
    serializedBody = await request.text()
  } catch {
    return NextResponse.json(
      { error: "Invalid checkout request" },
      { status: 400 },
    )
  }
  if (Buffer.byteLength(serializedBody, "utf8") > MAXIMUM_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Checkout request is too large" },
      { status: 413 },
    )
  }

  let body: unknown
  try {
    body = JSON.parse(serializedBody)
  } catch {
    return NextResponse.json(
      { error: "Invalid checkout request" },
      { status: 400 },
    )
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid checkout request" },
      { status: 400 },
    )
  }

  try {
    const host = resolveSponsorshipCheckoutHost(
      request.headers.get("host"),
      {
        allowLocalhostDevelopment: process.env.NODE_ENV !== "production",
        allowedPrimaryHostnames: allowedPrimaryHostnames(),
      },
    )
    const supabase = createServiceRoleClient()
    const result = await createStripeSponsorshipCheckoutV2(
      {
        body,
        host,
        authenticatedUser: await authenticatedCheckoutUser(),
        visitorToken: readSponsorshipVisitorCookie(
          request.headers.get("cookie"),
        ),
        requestContext: context,
      },
      createCheckoutV2Dependencies(supabase),
    )
    return NextResponse.json(result, {
      headers: CHECKOUT_RESPONSE_HEADERS,
    })
  } catch (error) {
    const safeError =
      error instanceof SponsorshipCheckoutDependencyError
        ? mapDependencyError(error)
        : error instanceof SponsorshipCheckoutError
          ? error
          : checkoutError("checkout-failed")
    console.error("Stripe sponsorship checkout failed", {
      code: safeError.code,
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: safeError.message },
      { status: safeError.httpStatus },
    )
  }
}
