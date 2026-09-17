import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type Stripe from "stripe"

import { openSealedPayPalProviderRequest } from "@/lib/sponsorships/checkout/paypalProviderRequest"
import { openSealedStripeProviderRequest } from "@/lib/sponsorships/checkout/stripeProviderRequest"
import {
  fromSupabaseRpcBytea,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
  toSupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import {
  PAYMENT_GATEWAY_EVENT_MAX_ATTEMPTS,
  PaymentGatewayEventRepositoryError,
  type CheckoutContactErasureCounts,
  type ClaimedPaymentGatewayEvent,
  type PaymentGatewayApplicationEffect,
  type PaymentGatewayApplicationResult,
  type PaymentGatewayEventRepository,
  type PaymentGatewayRetryState,
  type PaymentGatewayWelcomeBundle,
  type PaymentGatewayWorkerContext,
} from "@/lib/sponsorships/gateways/paymentGatewayEventWorker"
import { stripeEventImmutableDigest } from "@/lib/sponsorships/gateways/stripeWebhook"
import type { StripeRegion } from "@/lib/stripe/config"

export interface PaymentGatewayEventRepositoryDependencies {
  processLegacyStripeEvent(input: {
    event: Stripe.Event
    region: StripeRegion
    rawPayload: string
    requestId: string
    traceId: string | null
  }): Promise<{ status: number }>
}

interface SupabaseErrorLike {
  code?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RPC_BYTEA_PATTERN = /^\\x(?:[0-9a-f]{2})+$/
const APPLICATION_EFFECTS = new Set<PaymentGatewayApplicationEffect>([
  "payment_succeeded",
  "payment_failed",
  "checkout_expired",
  "subscription_lifecycle",
  "duplicate_movement",
  "refund_required",
  "ignored",
  "refund_applied",
  "reversal_applied",
  "dispute_debit_applied",
  "dispute_credit_applied",
  "legacy_applied",
])

function repositoryError(
  stage: string,
  error: SupabaseErrorLike | null = null,
): never {
  throw new PaymentGatewayEventRepositoryError(stage, {
    leaseLost: error?.code === "55P03",
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function oneRow(data: unknown, stage: string): Record<string, unknown> {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data
  if (!isRecord(row)) repositoryError(`${stage}_shape`)
  return row
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
  stage: string,
): string {
  const value = row[key]
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim()
  ) {
    repositoryError(`${stage}_shape`)
  }
  return value
}

function optionalString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
  stage: string,
): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim()
  ) {
    repositoryError(`${stage}_shape`)
  }
  return value
}

function requiredUuid(
  row: Record<string, unknown>,
  key: string,
  stage: string,
): string {
  const value = requiredString(row, key, 36, stage)
  if (!UUID_PATTERN.test(value)) repositoryError(`${stage}_shape`)
  return value
}

function optionalUuid(
  row: Record<string, unknown>,
  key: string,
  stage: string,
): string | null {
  const value = optionalString(row, key, 36, stage)
  if (value !== null && !UUID_PATTERN.test(value)) {
    repositoryError(`${stage}_shape`)
  }
  return value
}

function requiredInteger(
  row: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  stage: string,
): number {
  const raw = row[key]
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    repositoryError(`${stage}_shape`)
  }
  return value
}

function requiredBoolean(
  row: Record<string, unknown>,
  key: string,
  stage: string,
): boolean {
  const value = row[key]
  if (typeof value !== "boolean") repositoryError(`${stage}_shape`)
  return value
}

function requiredRpcBytea(
  row: Record<string, unknown>,
  key: string,
  stage: string,
): SupabaseRpcBytea {
  const value = row[key]
  if (typeof value !== "string" || !RPC_BYTEA_PATTERN.test(value)) {
    repositoryError(`${stage}_shape`)
  }
  return value as SupabaseRpcBytea
}

function parseClaimedEvent(value: unknown): ClaimedPaymentGatewayEvent {
  if (!isRecord(value)) repositoryError("claim_shape")

  const provider = requiredString(value, "provider", 20, "claim")
  if (provider !== "STRIPE" && provider !== "PAYPAL") {
    repositoryError("claim_shape")
  }

  /*
   * The claim RPC also returns redacted_payload and payload_ciphertext. They
   * are deliberately not read or copied here. Application dispatch relies
   * only on immutable typed columns populated by verified ingestion RPCs.
   * Quarantine and no-effect ingestion settle events as ignored before this
   * claim query can ever return them.
   */
  return {
    gatewayEventId: requiredUuid(value, "gateway_event_id", "claim"),
    processingLeaseToken: requiredUuid(
      value,
      "processing_lease_token",
      "claim",
    ),
    provider,
    providerAccountScope: requiredString(
      value,
      "provider_account_scope",
      120,
      "claim",
    ),
    providerEventId: requiredString(value, "provider_event_id", 255, "claim"),
    eventType: requiredString(value, "event_type", 200, "claim"),
    providerObjectType: optionalString(
      value,
      "provider_object_type",
      80,
      "claim",
    ),
    paymentAttemptId: optionalUuid(value, "payment_attempt_id", "claim"),
    verificationMethod: requiredString(
      value,
      "verification_method",
      120,
      "claim",
    ),
    processingAttemptCount: requiredInteger(
      value,
      "processing_attempt_count",
      1,
      32_767,
      "claim",
    ),
  }
}

function parseEffect(
  data: unknown,
  stage: string,
  allowed: ReadonlySet<PaymentGatewayApplicationEffect>,
  allowDeferred = false,
): PaymentGatewayApplicationEffect | null {
  const row = oneRow(data, stage)
  const raw = row.application_effect
  if (allowDeferred && (raw === null || raw === undefined)) return null
  if (
    typeof raw !== "string" ||
    !APPLICATION_EFFECTS.has(raw as PaymentGatewayApplicationEffect) ||
    !allowed.has(raw as PaymentGatewayApplicationEffect)
  ) {
    repositoryError(`${stage}_shape`)
  }
  return raw as PaymentGatewayApplicationEffect
}

function parseRetryState(
  data: unknown,
  expectedEventId: string,
  stage: string,
): PaymentGatewayRetryState {
  const row = oneRow(data, stage)
  const returnedId = requiredUuid(row, "id", stage)
  const status = requiredString(row, "processing_status", 40, stage)
  const processingAttemptCount = requiredInteger(
    row,
    "processing_attempt_count",
    1,
    32_767,
    stage,
  )
  const maxProcessingAttempts = requiredInteger(
    row,
    "max_processing_attempts",
    1,
    32_767,
    stage,
  )
  if (
    returnedId !== expectedEventId ||
    status !== "failed" ||
    processingAttemptCount > maxProcessingAttempts
  ) {
    repositoryError(`${stage}_shape`)
  }
  return {
    processingAttemptCount,
    maxProcessingAttempts,
    terminal: processingAttemptCount >= maxProcessingAttempts,
  }
}

function parseContactErasureCounts(
  data: unknown,
): CheckoutContactErasureCounts {
  const row = oneRow(data, "purge_contact")
  const counts = {
    erased: requiredInteger(
      row,
      "erased_count",
      0,
      Number.MAX_SAFE_INTEGER,
      "purge_contact",
    ),
    succeeded: requiredInteger(
      row,
      "succeeded_count",
      0,
      Number.MAX_SAFE_INTEGER,
      "purge_contact",
    ),
    failed: requiredInteger(
      row,
      "failed_count",
      0,
      Number.MAX_SAFE_INTEGER,
      "purge_contact",
    ),
    cancelled: requiredInteger(
      row,
      "cancelled_count",
      0,
      Number.MAX_SAFE_INTEGER,
      "purge_contact",
    ),
    expired: requiredInteger(
      row,
      "expired_count",
      0,
      Number.MAX_SAFE_INTEGER,
      "purge_contact",
    ),
  }
  if (
    counts.succeeded + counts.failed + counts.cancelled + counts.expired !==
    counts.erased
  ) {
    repositoryError("purge_contact_shape")
  }
  return counts
}

function applicationContext(context: PaymentGatewayWorkerContext) {
  return {
    context_request_id: context.requestId,
    context_trace_id: context.traceId,
    context_client_ip: null,
    context_user_agent: null,
  }
}

async function prepareWelcomeBundle(
  client: SupabaseClient,
  crypto: SponsorshipCrypto,
  event: ClaimedPaymentGatewayEvent,
  context: PaymentGatewayWorkerContext,
): Promise<PaymentGatewayWelcomeBundle | null> {
  if (
    (event.provider !== "STRIPE" && event.provider !== "PAYPAL") ||
    !event.paymentAttemptId
  ) {
    repositoryError("welcome_bundle_provider")
  }

  const { data, error } = await client.rpc(
    "read_payment_gateway_event_success_material",
    {
      target_gateway_event_id: event.gatewayEventId,
      target_processing_lease_token: event.processingLeaseToken,
      context_request_id: context.requestId,
      context_trace_id: context.traceId,
    },
  )
  if (error) repositoryError("welcome_material", error)
  const material = oneRow(data, "welcome_material")

  if (
    requiredUuid(material, "gateway_event_id", "welcome_material") !==
    event.gatewayEventId
  ) {
    repositoryError("welcome_material_shape")
  }

  const paymentAttemptId = requiredUuid(
    material,
    "payment_attempt_id",
    "welcome_material",
  )
  if (paymentAttemptId !== event.paymentAttemptId) {
    repositoryError("welcome_material_shape")
  }
  if (!requiredBoolean(material, "welcome_required", "welcome_material")) {
    return null
  }

  const operationId = requiredUuid(
    material,
    "checkout_operation_id",
    "welcome_material",
  )
  const sponsorshipIntentId = requiredUuid(
    material,
    "sponsorship_intent_id",
    "welcome_material",
  )
  const paymentQuoteId = requiredUuid(
    material,
    "payment_quote_id",
    "welcome_material",
  )
  const provider = requiredString(material, "provider", 20, "welcome_material")
  const providerAccountScope = requiredString(
    material,
    "provider_account_scope",
    120,
    "welcome_material",
  )
  if (provider !== event.provider) {
    repositoryError("welcome_material_shape")
  }

  let materialized: {
    customerEmail: string
    expiresAtUnixSeconds: number
  }
  try {
    const sealedInput = {
      ciphertext: requiredRpcBytea(
        material,
        "provider_request_ciphertext",
        "welcome_material",
      ),
      ciphertextSha256: requiredRpcBytea(
        material,
        "provider_request_ciphertext_sha256",
        "welcome_material",
      ),
      encryptionKeyVersion: requiredInteger(
        material,
        "provider_request_encryption_key_version",
        1,
        32_767,
        "welcome_material",
      ),
      fingerprint: requiredRpcBytea(
        material,
        "provider_request_fingerprint",
        "welcome_material",
      ),
      schemaVersion: requiredInteger(
        material,
        "provider_request_schema_version",
        1,
        32_767,
        "welcome_material",
      ),
      expectedOperationId: operationId,
      expectedPaymentAttemptId: paymentAttemptId,
      expectedSponsorshipIntentId: sponsorshipIntentId,
      expectedPaymentQuoteId: paymentQuoteId,
      expectedProviderAccountScope: providerAccountScope,
      expectedProviderIdempotencyKey: requiredString(
        material,
        "provider_idempotency_key",
        255,
        "welcome_material",
      ),
    }
    materialized =
      provider === "STRIPE"
        ? openSealedStripeProviderRequest(sealedInput, crypto)
        : openSealedPayPalProviderRequest(sealedInput, crypto)
  } catch {
    repositoryError("welcome_provider_request")
  }

  const providerRequestExpiresAt = requiredString(
    material,
    "provider_request_expires_at",
    64,
    "welcome_material",
  )
  if (
    !Number.isFinite(Date.parse(providerRequestExpiresAt)) ||
    materialized.expiresAtUnixSeconds !==
      Math.floor(Date.parse(providerRequestExpiresAt) / 1000)
  ) {
    repositoryError("welcome_expiry_binding")
  }

  const authoritativeEmail = crypto.digestEmail(materialized.customerEmail)
  const expectedEmailHmac = requiredRpcBytea(
    material,
    "contact_email_hmac",
    "welcome_material",
  )
  const expectedNormalizationVersion = requiredInteger(
    material,
    "contact_email_normalization_version",
    1,
    32_767,
    "welcome_material",
  )
  const expectedHmacKeyVersion = requiredInteger(
    material,
    "contact_email_hmac_key_version",
    1,
    32_767,
    "welcome_material",
  )
  if (
    authoritativeEmail.digestRpcBytea !== expectedEmailHmac ||
    authoritativeEmail.normalizationVersion !== expectedNormalizationVersion ||
    authoritativeEmail.hmacKeyVersion !== expectedHmacKeyVersion
  ) {
    repositoryError("welcome_email_binding")
  }

  const claim = crypto.generateOpaqueToken()
  const recipient = crypto.encryptRecipientEmail(materialized.customerEmail)
  const secretPayload = Buffer.from(
    JSON.stringify({
      version: 1,
      claimToken: claim.token,
    }),
    "utf8",
  )
  try {
    const secret = crypto.encryptSecretPayload(secretPayload)
    return {
      claimTokenDigest: claim.digestRpcBytea,
      recipientEmailCiphertext: recipient.ciphertextRpcBytea,
      emailEncryptionKeyVersion: recipient.encryptionKeyVersion,
      secretPayloadCiphertext: secret.ciphertextRpcBytea,
      welcomeTemplateKey: "sponsor-welcome-v1",
      welcomeTemplateData: {},
    }
  } finally {
    secretPayload.fill(0)
  }
}

async function applyLegacyStripeEvent(
  client: SupabaseClient,
  crypto: SponsorshipCrypto,
  dependencies: PaymentGatewayEventRepositoryDependencies | undefined,
  event: ClaimedPaymentGatewayEvent,
  context: PaymentGatewayWorkerContext,
): Promise<PaymentGatewayApplicationResult> {
  if (
    !dependencies ||
    event.provider !== "STRIPE" ||
    event.paymentAttemptId !== null ||
    event.verificationMethod !== "stripe_webhook_signature_legacy"
  ) {
    repositoryError("legacy_replay_boundary")
  }

  const { data, error } = await client.rpc(
    "read_legacy_stripe_gateway_event_payload",
    {
      target_gateway_event_id: event.gatewayEventId,
      target_processing_lease_token: event.processingLeaseToken,
      context_request_id: context.requestId,
      context_trace_id: context.traceId,
    },
  )
  if (error) repositoryError("legacy_payload", error)
  const material = oneRow(data, "legacy_payload")

  if (
    requiredUuid(material, "gateway_event_id", "legacy_payload") !==
      event.gatewayEventId ||
    requiredString(
      material,
      "provider_account_scope",
      120,
      "legacy_payload",
    ) !== event.providerAccountScope ||
    requiredString(material, "provider_event_id", 255, "legacy_payload") !==
      event.providerEventId ||
    requiredString(material, "event_type", 200, "legacy_payload") !==
      event.eventType
  ) {
    repositoryError("legacy_payload_shape")
  }

  const ciphertext = requiredRpcBytea(
    material,
    "payload_ciphertext",
    "legacy_payload",
  )
  const expectedDigest = requiredRpcBytea(
    material,
    "payload_sha256",
    "legacy_payload",
  )
  let plaintext: Buffer
  try {
    plaintext = crypto.decryptSecretPayload(fromSupabaseRpcBytea(ciphertext))
  } catch {
    repositoryError("legacy_payload_decryption")
  }

  let rawPayload: string
  let parsed: unknown
  try {
    rawPayload = new TextDecoder("utf-8", { fatal: true }).decode(plaintext)
    parsed = JSON.parse(rawPayload) as unknown
  } catch {
    repositoryError("legacy_payload_json")
  } finally {
    plaintext.fill(0)
  }

  if (!isRecord(parsed)) repositoryError("legacy_payload_event_shape")
  const stripeEvent = parsed as unknown as Stripe.Event
  let actualDigest: SupabaseRpcBytea
  try {
    actualDigest = toSupabaseRpcBytea(stripeEventImmutableDigest(stripeEvent))
  } catch {
    repositoryError("legacy_payload_digest")
  }
  if (
    stripeEvent.object !== "event" ||
    stripeEvent.id !== event.providerEventId ||
    stripeEvent.type !== event.eventType ||
    actualDigest !== expectedDigest
  ) {
    repositoryError("legacy_payload_binding")
  }

  const region: StripeRegion =
    event.providerAccountScope === "stripe_us"
      ? "us"
      : event.providerAccountScope === "stripe_uk"
        ? "uk"
        : repositoryError("legacy_provider_scope")

  let replayResult: { status: number }
  try {
    replayResult = await dependencies.processLegacyStripeEvent({
      event: stripeEvent,
      region,
      rawPayload,
      requestId: context.requestId,
      traceId: context.traceId,
    })
  } catch {
    repositoryError("legacy_application")
  }
  if (
    !Number.isInteger(replayResult.status) ||
    replayResult.status < 200 ||
    replayResult.status >= 300
  ) {
    repositoryError("legacy_application_status")
  }

  const completion = await client.rpc("complete_legacy_stripe_gateway_event", {
    target_gateway_event_id: event.gatewayEventId,
    target_processing_lease_token: event.processingLeaseToken,
    context_request_id: context.requestId,
    context_trace_id: context.traceId,
  })
  if (completion.error) repositoryError("legacy_completion", completion.error)
  return {
    effect: parseEffect(
      completion.data,
      "legacy_completion",
      new Set(["legacy_applied"]),
    ),
  }
}

export function createSupabasePaymentGatewayEventRepository(
  client: SupabaseClient,
  crypto: SponsorshipCrypto,
  dependencies?: PaymentGatewayEventRepositoryDependencies,
): PaymentGatewayEventRepository {
  return {
    async claimEvents({ workerId, batchSize, context }) {
      const { data, error } = await client.rpc("claim_payment_gateway_events", {
        target_worker_id: workerId,
        target_batch_size: batchSize,
        context_request_id: context.requestId,
        context_trace_id: context.traceId,
      })
      if (error) repositoryError("claim", error)
      if (!Array.isArray(data)) repositoryError("claim_shape")
      return data.map(parseClaimedEvent)
    },

    prepareWelcomeBundle(event, context) {
      return prepareWelcomeBundle(client, crypto, event, context)
    },

    async applySuccess(event, bundle, context) {
      const { data, error } = await client.rpc(
        "apply_sponsorship_payment_success",
        {
          target_gateway_event_id: event.gatewayEventId,
          target_processing_lease_token: event.processingLeaseToken,
          target_claim_token_digest: bundle?.claimTokenDigest ?? null,
          target_recipient_email_ciphertext:
            bundle?.recipientEmailCiphertext ?? null,
          target_email_encryption_key_version:
            bundle?.emailEncryptionKeyVersion ?? null,
          target_secret_payload_ciphertext:
            bundle?.secretPayloadCiphertext ?? null,
          target_welcome_template_key:
            bundle?.welcomeTemplateKey ?? "sponsor-welcome-v1",
          target_welcome_template_data: bundle?.welcomeTemplateData ?? {},
          ...applicationContext(context),
        },
      )
      if (error) repositoryError("apply_success", error)
      return {
        effect: parseEffect(
          data,
          "apply_success",
          new Set([
            "payment_succeeded",
            "duplicate_movement",
            "refund_required",
          ]),
        ),
      }
    },

    async applyFailure(event, context) {
      const rpcName =
        event.provider === "PAYPAL" &&
        (event.eventType === "PAYMENT.CAPTURE.DECLINED" ||
          event.eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED")
          ? "apply_paypal_payment_failure_v2"
          : "apply_sponsorship_payment_failure"
      const { data, error } = await client.rpc(rpcName, {
        target_gateway_event_id: event.gatewayEventId,
        target_processing_lease_token: event.processingLeaseToken,
        ...applicationContext(context),
      })
      if (error) repositoryError("apply_failure", error)
      return {
        effect: parseEffect(data, "apply_failure", new Set(["payment_failed"])),
      }
    },

    async applyCheckoutExpiration(event, context) {
      const { data, error } = await client.rpc(
        "apply_sponsorship_checkout_expiration",
        {
          target_gateway_event_id: event.gatewayEventId,
          target_processing_lease_token: event.processingLeaseToken,
          ...applicationContext(context),
        },
      )
      if (error) repositoryError("apply_expiration", error)
      return {
        effect: parseEffect(
          data,
          "apply_expiration",
          new Set(["checkout_expired"]),
        ),
      }
    },

    async applySubscriptionLifecycle(event, context) {
      const { data, error } = await client.rpc(
        "apply_sponsorship_subscription_lifecycle",
        {
          target_gateway_event_id: event.gatewayEventId,
          target_processing_lease_token: event.processingLeaseToken,
          ...applicationContext(context),
        },
      )
      if (error) repositoryError("apply_lifecycle", error)
      const effect = parseEffect(
        data,
        "apply_lifecycle",
        new Set(["subscription_lifecycle", "ignored"]),
        true,
      )
      if (effect !== null) return { effect }
      return {
        effect: null,
        retryState: {
          processingAttemptCount: event.processingAttemptCount,
          maxProcessingAttempts: PAYMENT_GATEWAY_EVENT_MAX_ATTEMPTS,
          terminal:
            event.processingAttemptCount >= PAYMENT_GATEWAY_EVENT_MAX_ATTEMPTS,
        },
      }
    },

    async applyFinancialAdjustment(event, context) {
      const { data, error } = await client.rpc(
        "apply_sponsorship_financial_adjustment",
        {
          target_gateway_event_id: event.gatewayEventId,
          target_processing_lease_token: event.processingLeaseToken,
          ...applicationContext(context),
        },
      )
      if (error) repositoryError("apply_adjustment", error)
      return {
        effect: parseEffect(
          data,
          "apply_adjustment",
          new Set([
            "refund_applied",
            "reversal_applied",
            "dispute_debit_applied",
            "dispute_credit_applied",
            "duplicate_movement",
          ]),
        ),
      }
    },

    applyLegacyStripe(event, context) {
      return applyLegacyStripeEvent(
        client,
        crypto,
        dependencies,
        event,
        context,
      )
    },

    async ignore(event, reason, context) {
      const { data, error } = await client.rpc(
        "ignore_sponsorship_payment_gateway_event",
        {
          target_gateway_event_id: event.gatewayEventId,
          target_processing_lease_token: event.processingLeaseToken,
          target_ignored_reason: reason,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
        },
      )
      if (error) repositoryError("ignore", error)
      const row = oneRow(data, "ignore")
      if (
        requiredUuid(row, "id", "ignore") !== event.gatewayEventId ||
        requiredString(row, "processing_status", 40, "ignore") !== "ignored"
      ) {
        repositoryError("ignore_shape")
      }
    },

    async retry(event, errorSummary, retryDelaySeconds, context) {
      const { data, error } = await client.rpc(
        "retry_sponsorship_payment_gateway_event",
        {
          target_gateway_event_id: event.gatewayEventId,
          target_processing_lease_token: event.processingLeaseToken,
          target_error_summary: errorSummary,
          target_retry_delay: `${retryDelaySeconds} seconds`,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
        },
      )
      if (error) repositoryError("retry", error)
      return parseRetryState(data, event.gatewayEventId, "retry")
    },

    async purgeCheckoutContactEnvelopes(context) {
      const { data, error } = await client.rpc(
        "purge_sponsorship_checkout_contact_envelopes",
        {
          target_batch_size: 100,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
        },
      )
      if (error) repositoryError("purge_contact", error)
      return parseContactErasureCounts(data)
    },
  }
}
