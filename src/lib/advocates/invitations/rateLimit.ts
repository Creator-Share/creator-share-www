import "server-only"

import { createHmac } from "node:crypto"
import { isIP } from "node:net"

import type { SupabaseClient } from "@supabase/supabase-js"

import { createServiceRoleClient } from "@/utils/supabase/server"

export const ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_ENV =
  "ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1"

const AUTHENTICATION_SOURCE_HMAC_CONTEXT = Buffer.from(
  "creator-share/advocate-invitation/authentication-attempt-source/v1\0",
  "utf8",
)
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const SOURCE_SECRET_MINIMUM_BYTES = 32
const SOURCE_SECRET_MAXIMUM_BYTES = 1024
const SOURCE_SECRET_MAXIMUM_BASE64_CHARACTERS = 1368
const UNAVAILABLE_SOURCE = "source-unavailable"
const RESERVATION_RPC_TIMEOUT_MILLISECONDS = 5_000

export type AdvocateInvitationAuthenticationRateLimitSignals = Readonly<{
  sourceDigest: `\\x${string}`
  sourceHmacKeyVersion: 1
}>

type AuthenticationRateLimitRpcRow = {
  authentication_allowed?: unknown
}

function rateLimitUnavailable(): never {
  throw new Error("advocate_invitation_authentication_rate_limit_unavailable")
}

function decodeSourceSecret(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SOURCE_SECRET_MAXIMUM_BASE64_CHARACTERS ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(value)
  ) {
    rateLimitUnavailable()
  }

  const secret = Buffer.from(value, "base64")
  if (
    secret.byteLength < SOURCE_SECRET_MINIMUM_BYTES ||
    secret.byteLength > SOURCE_SECRET_MAXIMUM_BYTES ||
    secret.toString("base64") !== value
  ) {
    secret.fill(0)
    rateLimitUnavailable()
  }

  return secret
}

function canonicalIpAddress(value: string): string | null {
  const ipVersion = isIP(value)
  if (ipVersion === 4) return value
  if (ipVersion !== 6) return null

  const hostname = new URL(`http://[${value}]/`).hostname
  return hostname.slice(1, -1)
}

function trustedSourceValue(
  headers: Pick<Headers, "get">,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (environment.VERCEL !== "1") return UNAVAILABLE_SOURCE

  const suppliedSource = headers.get("x-vercel-forwarded-for")?.trim()
  if (!suppliedSource || suppliedSource.length > 64) return UNAVAILABLE_SOURCE

  return canonicalIpAddress(suppliedSource) ?? UNAVAILABLE_SOURCE
}

function toRpcBytea(value: Buffer): `\\x${string}` {
  return `\\x${value.toString("hex")}`
}

export function createAdvocateInvitationAuthenticationRateLimitSignals(options: {
  headers: Pick<Headers, "get">
  environment?: Readonly<Record<string, string | undefined>>
}): AdvocateInvitationAuthenticationRateLimitSignals {
  const environment = options.environment ?? process.env
  const secret = decodeSourceSecret(
    environment[ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_ENV],
  )

  let digest: Buffer
  try {
    digest = createHmac("sha256", secret)
      .update(AUTHENTICATION_SOURCE_HMAC_CONTEXT)
      .update(trustedSourceValue(options.headers, environment), "utf8")
      .digest()
  } finally {
    secret.fill(0)
  }

  return Object.freeze({
    sourceDigest: toRpcBytea(digest),
    sourceHmacKeyVersion: 1,
  })
}

export function parseAdvocateInvitationAuthenticationReservation(
  value: unknown,
): boolean {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    rateLimitUnavailable()
  }

  const keys = Object.keys(row)
  if (keys.length !== 1 || keys[0] !== "authentication_allowed") {
    rateLimitUnavailable()
  }

  const allowed = (row as AuthenticationRateLimitRpcRow).authentication_allowed
  if (allowed !== true && allowed !== false) rateLimitUnavailable()
  return allowed
}

export async function reserveAdvocateInvitationAuthenticationAttempt(options: {
  request: Request
  environment?: Readonly<Record<string, string | undefined>>
  serviceClient?: SupabaseClient
}): Promise<boolean> {
  try {
    const signals = createAdvocateInvitationAuthenticationRateLimitSignals({
      headers: options.request.headers,
      environment: options.environment,
    })
    const serviceClient =
      options.serviceClient ??
      createServiceRoleClient({
        requestTimeoutMilliseconds: RESERVATION_RPC_TIMEOUT_MILLISECONDS,
      })
    const { data, error } = await serviceClient.rpc(
      "reserve_advocate_invitation_authentication_attempt",
      {
        target_source_digest: signals.sourceDigest,
        target_source_hmac_key_version: signals.sourceHmacKeyVersion,
      },
    )

    if (error) rateLimitUnavailable()
    return parseAdvocateInvitationAuthenticationReservation(data)
  } catch {
    rateLimitUnavailable()
  }
}
