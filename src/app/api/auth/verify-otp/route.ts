import { randomUUID } from "node:crypto"

import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

import {
  advocateAttributionIdentityCookieSetHeaders,
  createAdvocateAttributionIdentityCookieValue,
} from "@/lib/advocates/attributionIdentityCookie"
import { assertAdvocateStagingSupabaseBoundary } from "@/lib/advocates/stagingDeploymentBoundary"
import { getSponsorClaimCanonicalOrigin } from "@/lib/sponsorships/accountClaim"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { normalizeSponsorEmailV1 } from "@/lib/sponsorships/crypto"
import {
  createSponsorPasswordlessVerificationSignals,
  reserveSponsorPasswordlessVerificationAttempt,
  sponsorPasswordlessDeliveryContext,
} from "@/lib/sponsorships/management/passwordlessRateLimit"
import {
  parseSponsorEmailAuthenticationReceipt,
  parseSponsorEmailSessionIdentity,
} from "@/lib/sponsorships/management/sponsorEmailConfirmation"
import {
  createPendingSupabaseCookieAdapter,
  parseIsolatedSupabaseAuthCookies,
  passwordRecoverySupabaseCookieConfiguration,
} from "@/lib/sponsorships/management/responseBoundSupabaseCookies"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAXIMUM_VERIFY_OTP_BODY_BYTES = 1024

const RECOVERY_OTP_TYPE = "recovery" as const
const RECOVERY_OTP_PATTERN = /^\d{6}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAXIMUM_PROVIDER_TOKEN_CHARACTERS = 32_768
const MAXIMUM_SESSION_LIFETIME_SECONDS = 366 * 24 * 60 * 60
const MAXIMUM_PROVIDER_TIMESTAMP_CHARACTERS = 64
const MAXIMUM_PROVIDER_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1_000
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

interface RecoveryOtpRequest {
  email: string
  token: string
  type: typeof RECOVERY_OTP_TYPE
}

function response(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  })
}

function parseRecoveryOtpRequest(
  serializedBody: string,
): RecoveryOtpRequest | null {
  if (
    Buffer.byteLength(serializedBody, "utf8") > MAXIMUM_VERIFY_OTP_BODY_BYTES
  ) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serializedBody)
  } catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null
  }

  const value = parsed as Record<string, unknown>
  const keys = Object.keys(value)
  if (
    keys.length !== 3 ||
    !keys.includes("email") ||
    !keys.includes("token") ||
    !keys.includes("type") ||
    typeof value.email !== "string" ||
    typeof value.token !== "string" ||
    value.type !== RECOVERY_OTP_TYPE ||
    !RECOVERY_OTP_PATTERN.test(value.token)
  ) {
    return null
  }

  try {
    return {
      email: normalizeSponsorEmailV1(value.email),
      token: value.token,
      type: RECOVERY_OTP_TYPE,
    }
  } catch {
    return null
  }
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d{1,10}$/.test(contentLength) ||
      Number(contentLength) > MAXIMUM_VERIFY_OTP_BODY_BYTES)
  ) {
    return null
  }

  if (request.body === null) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > MAXIMUM_VERIFY_OTP_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedProviderToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAXIMUM_PROVIDER_TOKEN_CHARACTERS &&
    /^[\x21-\x7e]+$/.test(value)
  )
}

function isUsableRecoverySession(value: unknown, authUserId: string): boolean {
  if (!isRecord(value) || !isRecord(value.user)) return false
  if (
    value.user.id !== authUserId ||
    !isBoundedProviderToken(value.access_token) ||
    !isBoundedProviderToken(value.refresh_token) ||
    value.token_type !== "bearer" ||
    typeof value.expires_in !== "number" ||
    !Number.isSafeInteger(value.expires_in) ||
    value.expires_in <= 0 ||
    value.expires_in > MAXIMUM_SESSION_LIFETIME_SECONDS
  ) {
    return false
  }

  return (
    value.expires_at === undefined ||
    (typeof value.expires_at === "number" &&
      Number.isSafeInteger(value.expires_at) &&
      value.expires_at > Math.floor(Date.now() / 1_000))
  )
}

function parseVerificationOutcome(value: unknown):
  | { kind: "failed" }
  | {
      kind: "verified"
      authUserId: string
      accessToken: string
    }
  | null {
  if (!isRecord(value) || !("data" in value) || !("error" in value)) {
    return null
  }

  if (value.error !== null) {
    return isRecord(value.error) ? { kind: "failed" } : null
  }
  if (!isRecord(value.data) || !isRecord(value.data.user)) return null

  const authUserId = value.data.user.id
  if (
    typeof authUserId !== "string" ||
    !UUID_PATTERN.test(authUserId) ||
    !isUsableRecoverySession(value.data.session, authUserId)
  ) {
    return null
  }
  return {
    kind: "verified",
    authUserId,
    accessToken: (value.data.session as Record<string, unknown>)
      .access_token as string,
  }
}

function isVerifiedRecoveryUser(
  value: unknown,
  expectedAuthUserId: string,
  expectedEmail: string,
): boolean {
  if (
    !isRecord(value) ||
    value.error !== null ||
    !isRecord(value.data) ||
    !isRecord(value.data.user)
  ) {
    return false
  }

  const user = value.data.user
  const emailConfirmedAt = providerTimestamp(user.email_confirmed_at)
  if (
    user.id !== expectedAuthUserId ||
    typeof user.email !== "string" ||
    emailConfirmedAt === null ||
    emailConfirmedAt > Date.now() + MAXIMUM_PROVIDER_CLOCK_SKEW_MILLISECONDS
  ) {
    return false
  }

  if (Object.hasOwn(user, "is_anonymous")) {
    if (typeof user.is_anonymous !== "boolean" || user.is_anonymous) {
      return false
    }
  }
  if (Object.hasOwn(user, "deleted_at")) {
    if (providerTimestamp(user.deleted_at) === null) return false
    return false
  }
  if (Object.hasOwn(user, "banned_until")) {
    const bannedUntil = providerTimestamp(user.banned_until)
    if (bannedUntil === null || bannedUntil > Date.now()) return false
  }

  try {
    return normalizeSponsorEmailV1(user.email) === expectedEmail
  } catch {
    return false
  }
}

function providerTimestamp(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAXIMUM_PROVIDER_TIMESTAMP_CHARACTERS
  ) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function traceId(request: Request): string | null {
  const value = request.headers.get("x-vercel-id")?.trim()
  return value && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)
    ? value
    : null
}

export async function POST(request: NextRequest) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return response({ error: "verification-unavailable" }, 503)
  }

  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  let transportOrigin: string
  try {
    transportOrigin = new URL(request.url).origin
  } catch {
    return response({ error: "invalid-request" }, 400)
  }
  if (
    expectedOrigin === null ||
    expectedOrigin !== canonicalOrigin ||
    transportOrigin !== canonicalOrigin ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ error: "invalid-request" }, 400)
  }

  const serializedBody = await readBoundedBody(request)
  const verificationRequest =
    serializedBody === null ? null : parseRecoveryOtpRequest(serializedBody)
  if (verificationRequest === null) {
    return response({ error: "invalid-request" }, 400)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.NEXT_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return response({ error: "verification-unavailable" }, 503)
  }

  let recoveryCookie: ReturnType<
    typeof passwordRecoverySupabaseCookieConfiguration
  >
  let initialRecoveryCookies: ReturnType<
    typeof parseIsolatedSupabaseAuthCookies
  >
  try {
    recoveryCookie =
      passwordRecoverySupabaseCookieConfiguration(canonicalOrigin)
    initialRecoveryCookies = parseIsolatedSupabaseAuthCookies({
      rawCookieHeader: request.headers.get("cookie"),
      authCookieName: recoveryCookie.name,
    })
  } catch {
    return response({ error: "verification-unavailable" }, 503)
  }
  if (initialRecoveryCookies === null) {
    return response({ error: "invalid-request" }, 400)
  }

  try {
    const context = sponsorPasswordlessDeliveryContext(request)
    const signals = createSponsorPasswordlessVerificationSignals({
      headers: request.headers,
    })
    const verificationAllowed =
      await reserveSponsorPasswordlessVerificationAttempt({
        signals,
        context,
      })
    if (!verificationAllowed) {
      return response({ error: "verification-failed" }, 400)
    }
  } catch {
    return response({ error: "verification-unavailable" }, 503)
  }

  try {
    assertAdvocateStagingSupabaseBoundary(process.env, {
      requireServiceRole: false,
    })
    const verificationResponse = response(
      { message: "OTP verified successfully." },
      200,
    )
    const cookieAdapter = createPendingSupabaseCookieAdapter({
      initialCookies: initialRecoveryCookies,
      authCookieName: recoveryCookie.name,
      sessionMaxAgeSeconds: recoveryCookie.cookieOptions.maxAge,
      secure: recoveryCookie.secure,
    })
    const verificationCookieCheckpoint = cookieAdapter.checkpoint()
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: "implicit",
      },
      cookieOptions: recoveryCookie.cookieOptions,
      cookies: cookieAdapter.cookies,
    })
    const verification = await supabase.auth.verifyOtp(verificationRequest)
    const outcome = parseVerificationOutcome(verification)
    if (outcome?.kind === "failed") {
      return response({ error: "verification-failed" }, 400)
    }
    if (outcome === null) {
      return response({ error: "verification-unavailable" }, 503)
    }

    const authenticated = await supabase.auth.getUser(outcome.accessToken)
    if (
      !isVerifiedRecoveryUser(
        authenticated,
        outcome.authUserId,
        verificationRequest.email,
      )
    ) {
      return response({ error: "verification-unavailable" }, 503)
    }

    const identity = parseSponsorEmailSessionIdentity({
      accessToken: outcome.accessToken,
      verifiedAuthUserId: outcome.authUserId,
    })
    if (
      identity === null ||
      !cookieAdapter.hasCompleteAuthSessionWriteSince(
        verificationCookieCheckpoint,
      )
    ) {
      return response({ error: "verification-unavailable" }, 503)
    }

    cookieAdapter.applyTo(verificationResponse)
    if (!cookieAdapter.responseHasAuthSession(verificationResponse)) {
      return response({ error: "verification-unavailable" }, 503)
    }

    const serviceClient = createServiceRoleClient({
      requestTimeoutMilliseconds: 8_000,
    })
    const receipt = await serviceClient.rpc(
      "record_sponsor_email_authentication_receipt",
      {
        target_auth_user_id: identity.authUserId,
        target_auth_session_id: identity.authSessionId,
        context_request_id: randomUUID(),
        context_trace_id: traceId(request),
      },
    )
    if (
      receipt.error ||
      parseSponsorEmailAuthenticationReceipt(receipt.data) === null
    ) {
      return response({ error: "verification-unavailable" }, 503)
    }

    const identitySignal = createAdvocateAttributionIdentityCookieValue(
      {
        authUserId: identity.authUserId,
      },
      { rawHost: request.headers.get("host") },
    )
    if (identitySignal) {
      for (const header of advocateAttributionIdentityCookieSetHeaders(
        identitySignal,
        request.headers.get("host"),
        request.nextUrl.protocol === "https:",
      )) {
        verificationResponse.headers.append("Set-Cookie", header)
      }
    }
    return verificationResponse
  } catch {
    return response({ error: "verification-unavailable" }, 503)
  }
}
