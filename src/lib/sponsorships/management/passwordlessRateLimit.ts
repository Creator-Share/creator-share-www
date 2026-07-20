import "server-only"

import { createHmac, randomUUID } from "node:crypto"
import { isIP } from "node:net"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createSponsorshipCryptoFromEnvironment,
  toSupabaseRpcBytea,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_ENV =
  "SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1"

const DELIVERY_SOURCE_HMAC_CONTEXT = Buffer.from(
  "creator-share/sponsor-passwordless/delivery-source/v1\0",
  "utf8",
)
const VERIFICATION_SOURCE_HMAC_CONTEXT = Buffer.from(
  "creator-share/sponsor-passwordless/verification-source/v1\0",
  "utf8",
)
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const SOURCE_SECRET_MINIMUM_BYTES = 32
const SOURCE_SECRET_MAXIMUM_BYTES = 1024
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/

export type SponsorPasswordlessFlow =
  | "generic-sign-in"
  | "registration"
  | "password-reset"
  | "reauthentication"
  | "initial-claim"
  | "account-claim"

export interface SponsorPasswordlessDeliverySignals {
  recipientDigest: SupabaseRpcBytea
  recipientNormalizationVersion: number
  recipientHmacKeyVersion: number
  sourceDigest: SupabaseRpcBytea
  sourceHmacKeyVersion: 1
}

export interface SponsorPasswordlessDeliveryContext {
  requestId: string
  traceId: string | null
}

export interface SponsorPasswordlessVerificationSignals {
  sourceDigest: SupabaseRpcBytea
  sourceHmacKeyVersion: 1
}

type RateLimitRpcRow = {
  delivery_allowed?: unknown
}

type VerificationRateLimitRpcRow = {
  verification_allowed?: unknown
}

function decodeSourceSecret(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1368 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(value)
  ) {
    throw new Error("sponsor_passwordless_rate_limit_unavailable")
  }

  const secret = Buffer.from(value, "base64")
  if (
    secret.byteLength < SOURCE_SECRET_MINIMUM_BYTES ||
    secret.byteLength > SOURCE_SECRET_MAXIMUM_BYTES ||
    secret.toString("base64") !== value
  ) {
    secret.fill(0)
    throw new Error("sponsor_passwordless_rate_limit_unavailable")
  }
  return secret
}

function trustedSourceValue(
  headers: Pick<Headers, "get">,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  // Vercel overwrites this header at the final ingress. Cloudflare is DNS only
  // for the MVP, so other forwarding headers remain browser spoofable.
  if (environment.VERCEL !== "1") return "source-unavailable"
  const value = headers.get("x-vercel-forwarded-for")?.trim()
  return value && value.length <= 64 && isIP(value) !== 0
    ? value.toLowerCase()
    : "source-unavailable"
}

function createSourceDigest(options: {
  headers: Pick<Headers, "get">
  context: Buffer
  environment: Readonly<Record<string, string | undefined>>
}): SupabaseRpcBytea {
  const sourceSecret = decodeSourceSecret(
    options.environment[SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_ENV],
  )
  let sourceDigest: Buffer
  try {
    sourceDigest = createHmac("sha256", sourceSecret)
      .update(options.context)
      .update(trustedSourceValue(options.headers, options.environment), "utf8")
      .digest()
  } finally {
    sourceSecret.fill(0)
  }
  return toSupabaseRpcBytea(sourceDigest)
}

export function createSponsorPasswordlessDeliverySignals(options: {
  email: string
  headers: Pick<Headers, "get">
  environment?: Readonly<Record<string, string | undefined>>
}): SponsorPasswordlessDeliverySignals {
  const environment = options.environment ?? process.env
  const recipient = createSponsorshipCryptoFromEnvironment(
    environment,
  ).digestEmail(options.email)

  return Object.freeze({
    recipientDigest: recipient.digestRpcBytea,
    recipientNormalizationVersion: recipient.normalizationVersion,
    recipientHmacKeyVersion: recipient.hmacKeyVersion,
    sourceDigest: createSourceDigest({
      headers: options.headers,
      context: DELIVERY_SOURCE_HMAC_CONTEXT,
      environment,
    }),
    sourceHmacKeyVersion: 1,
  })
}

export function createSponsorPasswordlessVerificationSignals(options: {
  headers: Pick<Headers, "get">
  environment?: Readonly<Record<string, string | undefined>>
}): SponsorPasswordlessVerificationSignals {
  return Object.freeze({
    sourceDigest: createSourceDigest({
      headers: options.headers,
      context: VERIFICATION_SOURCE_HMAC_CONTEXT,
      environment: options.environment ?? process.env,
    }),
    sourceHmacKeyVersion: 1,
  })
}

export function sponsorPasswordlessDeliveryContext(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SponsorPasswordlessDeliveryContext {
  const candidateTraceId =
    environment.VERCEL === "1"
      ? request.headers.get("x-vercel-id")?.trim()
      : null
  const traceId =
    candidateTraceId &&
    candidateTraceId.length <= 255 &&
    !CONTROL_CHARACTER_PATTERN.test(candidateTraceId)
      ? candidateTraceId
      : null
  return Object.freeze({ requestId: randomUUID(), traceId })
}

export function parseSponsorPasswordlessDeliveryReservation(
  value: unknown,
): boolean {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  if (!row || typeof row !== "object" || Array.isArray(row)) return false
  const keys = Object.keys(row)
  return (
    keys.length === 1 &&
    keys[0] === "delivery_allowed" &&
    (row as RateLimitRpcRow).delivery_allowed === true
  )
}

export function parseSponsorPasswordlessVerificationReservation(
  value: unknown,
): boolean {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  if (!row || typeof row !== "object" || Array.isArray(row)) return false
  const keys = Object.keys(row)
  return (
    keys.length === 1 &&
    keys[0] === "verification_allowed" &&
    (row as VerificationRateLimitRpcRow).verification_allowed === true
  )
}

export async function reserveSponsorPasswordlessDelivery(options: {
  flow: SponsorPasswordlessFlow
  signals: SponsorPasswordlessDeliverySignals
  context: SponsorPasswordlessDeliveryContext
  serviceClient?: SupabaseClient
}): Promise<boolean> {
  const serviceClient = options.serviceClient ?? createServiceRoleClient()
  const { data, error } = await serviceClient.rpc(
    "reserve_sponsor_passwordless_email_delivery",
    {
      target_recipient_digest: options.signals.recipientDigest,
      target_recipient_normalization_version:
        options.signals.recipientNormalizationVersion,
      target_recipient_hmac_key_version:
        options.signals.recipientHmacKeyVersion,
      target_source_digest: options.signals.sourceDigest,
      target_source_hmac_key_version: options.signals.sourceHmacKeyVersion,
      delivery_flow: options.flow,
      context_request_id: options.context.requestId,
      context_trace_id: options.context.traceId,
    },
  )
  if (error) throw error
  return parseSponsorPasswordlessDeliveryReservation(data)
}

export async function reserveSponsorPasswordlessDeliveryForRequest(options: {
  flow: SponsorPasswordlessFlow
  email: string
  request: Request
  environment?: Readonly<Record<string, string | undefined>>
  serviceClient?: SupabaseClient
}): Promise<boolean> {
  return reserveSponsorPasswordlessDelivery({
    flow: options.flow,
    signals: createSponsorPasswordlessDeliverySignals({
      email: options.email,
      headers: options.request.headers,
      environment: options.environment,
    }),
    context: sponsorPasswordlessDeliveryContext(
      options.request,
      options.environment,
    ),
    serviceClient: options.serviceClient,
  })
}

export async function reserveSponsorPasswordlessVerificationAttempt(options: {
  signals: SponsorPasswordlessVerificationSignals
  context: SponsorPasswordlessDeliveryContext
  serviceClient?: SupabaseClient
}): Promise<boolean> {
  const serviceClient = options.serviceClient ?? createServiceRoleClient()
  const { data, error } = await serviceClient.rpc(
    "reserve_sponsor_passwordless_email_verification_attempt",
    {
      target_source_digest: options.signals.sourceDigest,
      target_source_hmac_key_version: options.signals.sourceHmacKeyVersion,
      context_request_id: options.context.requestId,
      context_trace_id: options.context.traceId,
    },
  )
  if (error) throw error
  return parseSponsorPasswordlessVerificationReservation(data)
}
