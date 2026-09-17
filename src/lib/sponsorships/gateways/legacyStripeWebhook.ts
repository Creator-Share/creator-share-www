import "server-only"

import type Stripe from "stripe"

import type {
  SponsorshipCrypto,
  SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import { sha256Digest, toSupabaseRpcBytea } from "@/lib/sponsorships/crypto"
import {
  classifyServerIntentStripeEvent,
  MAXIMUM_SIGNED_PAYLOAD_BYTES,
  stripeEventImmutableDigest,
  type StripeWebhookRequestContext,
} from "@/lib/sponsorships/gateways/stripeWebhook"
import type { StripeRegion } from "@/lib/stripe/config"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RETAINED_LEGACY_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
])
const OBJECT_TYPE_BY_EVENT_PREFIX = {
  "checkout.session.": "checkout_session",
  "invoice.": "invoice",
  "customer.subscription.": "subscription",
} as const

export type LegacyStripeWebhookErrorCode =
  | "unsupported-event"
  | "invalid-evidence"
  | "evidence-conflict"
  | "infrastructure"

export class LegacyStripeWebhookError extends Error {
  readonly code: LegacyStripeWebhookErrorCode
  readonly retryable: boolean
  readonly httpStatus: number

  constructor(
    code: LegacyStripeWebhookErrorCode,
    options: { retryable?: boolean; httpStatus?: number } = {},
  ) {
    super(
      options.retryable
        ? "Legacy Stripe webhook capture is temporarily unavailable"
        : "Legacy Stripe webhook evidence was rejected",
    )
    this.name = "LegacyStripeWebhookError"
    this.code = code
    this.retryable = options.retryable === true
    this.httpStatus = options.httpStatus ?? (this.retryable ? 503 : 400)
  }
}

export class LegacyStripeReplayDatabaseError extends Error {
  readonly stage: string

  constructor(stage: string) {
    super(`legacy_stripe_database_${stage}`)
    this.name = "LegacyStripeReplayDatabaseError"
    this.stage = stage
  }
}

export function requireLegacyStripeDatabaseSuccess(
  trustedReplay: boolean,
  error: unknown,
  stage: string,
): void {
  if (trustedReplay && error) {
    throw new LegacyStripeReplayDatabaseError(stage)
  }
}

export interface VerifiedLegacyStripeEventInput {
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
  requestContext: StripeWebhookRequestContext
}

export interface VerifiedLegacyStripeEventResult {
  gatewayEventId: string
  processingStatus: string
  isDuplicate: boolean
}

export interface LegacyStripeWebhookDependencies {
  crypto: SponsorshipCrypto
  ingestVerifiedLegacyEvent(
    input: VerifiedLegacyStripeEventInput,
  ): Promise<VerifiedLegacyStripeEventResult>
  now(): Date
}

function reject(
  code: Exclude<LegacyStripeWebhookErrorCode, "infrastructure">,
): never {
  throw new LegacyStripeWebhookError(code, {
    httpStatus: code === "evidence-conflict" ? 409 : 400,
  })
}

function infrastructure(): LegacyStripeWebhookError {
  return new LegacyStripeWebhookError("infrastructure", { retryable: true })
}

function requiredProviderId(value: unknown, prefix: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    value.length > 255 ||
    !/^[A-Za-z0-9_]+$/.test(value)
  ) {
    reject("invalid-evidence")
  }
  return value
}

function expectedObjectType(
  eventType: string,
): "checkout_session" | "invoice" | "subscription" {
  for (const [prefix, objectType] of Object.entries(
    OBJECT_TYPE_BY_EVENT_PREFIX,
  )) {
    if (eventType.startsWith(prefix)) return objectType
  }
  reject("unsupported-event")
}

function objectIdentity(event: Stripe.Event): {
  providerObjectType: "checkout_session" | "invoice" | "subscription"
  providerObjectId: string
} {
  const object = event.data?.object as unknown
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    reject("invalid-evidence")
  }
  const candidate = object as Record<string, unknown>
  const providerObjectType = expectedObjectType(event.type)
  const actualObjectType = candidate.object
  const normalizedObjectType =
    typeof actualObjectType === "string"
      ? actualObjectType.replaceAll(".", "_")
      : null
  if (normalizedObjectType !== providerObjectType) {
    reject("invalid-evidence")
  }
  return {
    providerObjectType,
    providerObjectId: requiredProviderId(candidate.id, ""),
  }
}

function occurredAt(event: Stripe.Event, now: Date): string {
  if (
    !Number.isSafeInteger(event.created) ||
    event.created < 1 ||
    event.created * 1000 > now.getTime() + 5 * 60 * 1000
  ) {
    reject("invalid-evidence")
  }
  return new Date(event.created * 1000).toISOString()
}

function verifiedAt(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw infrastructure()
  }
  return now.toISOString()
}

export function isRetainedLegacyStripeEvent(event: Stripe.Event): boolean {
  if (!RETAINED_LEGACY_EVENT_TYPES.has(event.type)) return false
  try {
    return classifyServerIntentStripeEvent(event).kind === "not-server-intent"
  } catch {
    return false
  }
}

export async function captureVerifiedLegacyStripeEvent(
  input: {
    event: Stripe.Event
    region: StripeRegion
    rawPayload: string
    requestContext: StripeWebhookRequestContext
  },
  dependencies: LegacyStripeWebhookDependencies,
): Promise<VerifiedLegacyStripeEventResult> {
  if (!isRetainedLegacyStripeEvent(input.event)) reject("unsupported-event")

  const payload = Buffer.from(input.rawPayload, "utf8")
  if (payload.length < 1 || payload.length > MAXIMUM_SIGNED_PAYLOAD_BYTES) {
    payload.fill(0)
    reject("invalid-evidence")
  }

  const now = dependencies.now()
  const identity = objectIdentity(input.event)
  let encrypted
  try {
    encrypted = dependencies.crypto.encryptSecretPayload(payload)
  } catch {
    throw infrastructure()
  } finally {
    payload.fill(0)
  }

  const immutableDigest = toSupabaseRpcBytea(
    stripeEventImmutableDigest(input.event),
  )
  const deliveryDigest = sha256Digest(
    Buffer.from(input.rawPayload, "utf8"),
  ).toString("hex")

  let result: VerifiedLegacyStripeEventResult
  try {
    result = await dependencies.ingestVerifiedLegacyEvent({
      providerAccountScope: `stripe_${input.region}`,
      providerEventId: requiredProviderId(input.event.id, "evt_"),
      eventType: input.event.type,
      ...identity,
      redactedPayload: {
        redaction_version: "stripe_legacy_durable_v1",
        provider: "STRIPE",
        source: "verified_webhook",
        processing_lane: "legacy",
        event_type: input.event.type,
        provider_object_type: identity.providerObjectType,
        delivery_payload_sha256: deliveryDigest,
        webhook_secret_version: input.requestContext.webhookSecretVersion,
      },
      payloadCiphertext: encrypted.ciphertextRpcBytea,
      payloadSha256: immutableDigest,
      signatureVerifiedAt: verifiedAt(now),
      occurredAt: occurredAt(input.event, now),
      requestContext: input.requestContext,
    })
  } catch (error) {
    if (error instanceof LegacyStripeWebhookError) throw error
    throw infrastructure()
  }

  if (
    !UUID_PATTERN.test(result.gatewayEventId) ||
    !["received", "processing", "processed", "failed", "ignored"].includes(
      result.processingStatus,
    ) ||
    typeof result.isDuplicate !== "boolean"
  ) {
    throw infrastructure()
  }
  return result
}

export function asLegacyStripeWebhookError(
  error: unknown,
): LegacyStripeWebhookError {
  return error instanceof LegacyStripeWebhookError ? error : infrastructure()
}
