import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

import { advocateAttributionIdentityCookieClearHeaders } from "@/lib/advocates/attributionIdentityCookie"
import { assertAdvocateStagingSupabaseBoundary } from "@/lib/advocates/stagingDeploymentBoundary"
import { getSponsorClaimCanonicalOrigin } from "@/lib/sponsorships/accountClaim"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  normalizeAuthenticatedSponsorEmail,
  readBoundedSponsorManagementBody,
} from "@/lib/sponsorships/management/passwordlessAccess"
import {
  appendDefaultSupabaseAuthCookieClearHeaders,
  createPendingSupabaseCookieAdapter,
  parseIsolatedSupabaseAuthCookies,
  passwordRecoverySupabaseCookieConfiguration,
} from "@/lib/sponsorships/management/responseBoundSupabaseCookies"
import { validatePassword } from "@/utils/passwordValidation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAXIMUM_CHANGE_PASSWORD_BODY_BYTES = 2_048
const MAXIMUM_PASSWORD_CHARACTERS = 256
const MAXIMUM_PASSWORD_BYTES = 1_024
const AUTH_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAXIMUM_PROVIDER_TIMESTAMP_CHARACTERS = 64
const MAXIMUM_PROVIDER_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1_000
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

interface ChangePasswordRequest {
  password: string
}

type AuthenticatedUserDisposition =
  | Readonly<{ status: "authenticated"; userId: string }>
  | Readonly<{ status: "unauthorized" }>
  | Readonly<{ status: "malformed" }>

type PasswordRecoveryAuthorizationDisposition =
  | Readonly<{ status: "authorized"; sessionId: string }>
  | Readonly<{ status: "unauthorized" }>
  | Readonly<{ status: "malformed" }>

function response(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  )
}

function providerTimestamp(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAXIMUM_PROVIDER_TIMESTAMP_CHARACTERS
  ) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function parseChangePasswordRequest(
  serializedBody: string,
): ChangePasswordRequest | null {
  if (
    Buffer.byteLength(serializedBody, "utf8") >
    MAXIMUM_CHANGE_PASSWORD_BODY_BYTES
  ) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serializedBody)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  const keys = Object.keys(parsed)
  const password = parsed.password
  if (
    keys.length !== 1 ||
    keys[0] !== "password" ||
    typeof password !== "string" ||
    password.length > MAXIMUM_PASSWORD_CHARACTERS ||
    Buffer.byteLength(password, "utf8") > MAXIMUM_PASSWORD_BYTES ||
    !validatePassword(password).isValid
  ) {
    return null
  }

  return { password }
}

function authenticatedUserDisposition(
  value: unknown,
): AuthenticatedUserDisposition {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["data", "error"]) ||
    !isRecord(value.data) ||
    !hasExactKeys(value.data, ["user"])
  ) {
    return { status: "malformed" }
  }

  if (value.error !== null) {
    if (!isRecord(value.error) || value.data.user !== null) {
      return { status: "malformed" }
    }
    return { status: "unauthorized" }
  }

  const user = value.data.user
  if (user === null) return { status: "unauthorized" }
  if (
    !isRecord(user) ||
    typeof user.id !== "string" ||
    !AUTH_USER_ID_PATTERN.test(user.id)
  ) {
    return { status: "malformed" }
  }

  if (!Object.hasOwn(user, "email") || user.email === "") {
    return { status: "unauthorized" }
  }
  if (
    typeof user.email !== "string" ||
    normalizeAuthenticatedSponsorEmail(user.email) === null
  ) {
    return { status: "malformed" }
  }

  if (!Object.hasOwn(user, "email_confirmed_at")) {
    return { status: "unauthorized" }
  }
  const emailConfirmedAt = providerTimestamp(user.email_confirmed_at)
  if (emailConfirmedAt === null) return { status: "malformed" }
  if (
    emailConfirmedAt >
    Date.now() + MAXIMUM_PROVIDER_CLOCK_SKEW_MILLISECONDS
  ) {
    return { status: "malformed" }
  }

  if (Object.hasOwn(user, "is_anonymous")) {
    if (typeof user.is_anonymous !== "boolean") {
      return { status: "malformed" }
    }
    if (user.is_anonymous) return { status: "unauthorized" }
  }

  if (Object.hasOwn(user, "deleted_at")) {
    if (providerTimestamp(user.deleted_at) === null) {
      return { status: "malformed" }
    }
    return { status: "unauthorized" }
  }

  if (Object.hasOwn(user, "banned_until")) {
    const bannedUntil = providerTimestamp(user.banned_until)
    if (bannedUntil === null) return { status: "malformed" }
    if (bannedUntil > Date.now()) return { status: "unauthorized" }
  }

  return { status: "authenticated", userId: user.id.toLowerCase() }
}

function isAcknowledgedPasswordUpdate(
  value: unknown,
  authenticatedUserId: string,
): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["data", "error"]) ||
    value.error !== null ||
    !isRecord(value.data) ||
    !hasExactKeys(value.data, ["user"]) ||
    !isRecord(value.data.user) ||
    typeof value.data.user.id !== "string" ||
    !AUTH_USER_ID_PATTERN.test(value.data.user.id)
  ) {
    return false
  }

  return value.data.user.id.toLowerCase() === authenticatedUserId
}

function isAcknowledgedSignOut(value: unknown): boolean {
  return (
    isRecord(value) && hasExactKeys(value, ["error"]) && value.error === null
  )
}

function passwordRecoveryAuthorizationDisposition(
  value: unknown,
  authenticatedUserId: string,
): PasswordRecoveryAuthorizationDisposition {
  if (!isRecord(value) || !("data" in value) || !("error" in value)) {
    return { status: "malformed" }
  }

  if (value.error !== null) {
    return isRecord(value.error) && value.error.code === "42501"
      ? { status: "unauthorized" }
      : { status: "malformed" }
  }

  if (!Array.isArray(value.data) || value.data.length !== 1) {
    return { status: "malformed" }
  }
  const row = value.data[0]
  if (
    !isRecord(row) ||
    !hasExactKeys(row, [
      "authorized_auth_session_id",
      "authorized_auth_user_id",
    ]) ||
    typeof row.authorized_auth_user_id !== "string" ||
    row.authorized_auth_user_id.toLowerCase() !== authenticatedUserId ||
    typeof row.authorized_auth_session_id !== "string" ||
    !AUTH_USER_ID_PATTERN.test(row.authorized_auth_session_id)
  ) {
    return { status: "malformed" }
  }

  return {
    status: "authorized",
    sessionId: row.authorized_auth_session_id.toLowerCase(),
  }
}

export async function POST(request: NextRequest) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return response({ error: "unavailable" }, 503)
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

  const serializedBody = await readBoundedSponsorManagementBody(
    request,
    MAXIMUM_CHANGE_PASSWORD_BODY_BYTES,
  )
  const passwordRequest =
    serializedBody === null ? null : parseChangePasswordRequest(serializedBody)
  if (passwordRequest === null) {
    return response({ error: "invalid-request" }, 400)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return response({ error: "unavailable" }, 503)
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
    return response({ error: "unavailable" }, 503)
  }
  if (initialRecoveryCookies === null) {
    return response({ error: "invalid-request" }, 400)
  }

  let supabase: ReturnType<typeof createServerClient>
  let cookieAdapter: ReturnType<typeof createPendingSupabaseCookieAdapter>
  let authentication: unknown
  try {
    assertAdvocateStagingSupabaseBoundary(process.env, {
      requireServiceRole: false,
    })
    cookieAdapter = createPendingSupabaseCookieAdapter({
      initialCookies: initialRecoveryCookies,
      authCookieName: recoveryCookie.name,
      sessionMaxAgeSeconds: recoveryCookie.cookieOptions.maxAge,
      secure: recoveryCookie.secure,
    })
    if (!cookieAdapter.hasCurrentAuthSession()) {
      return response({ error: "unauthorized" }, 401)
    }
    supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookieOptions: recoveryCookie.cookieOptions,
      cookies: cookieAdapter.cookies,
    })
    authentication = await supabase.auth.getUser()
  } catch {
    return response({ error: "unavailable" }, 503)
  }

  const authenticatedUser = authenticatedUserDisposition(authentication)
  if (authenticatedUser.status === "unauthorized") {
    return response({ error: "unauthorized" }, 401)
  }
  if (authenticatedUser.status === "malformed") {
    return response({ error: "unavailable" }, 503)
  }

  let passwordRecoveryAuthorization: unknown
  try {
    passwordRecoveryAuthorization = await supabase.rpc(
      "consume_password_recovery_authorization",
    )
  } catch {
    return response({ error: "unavailable" }, 503)
  }
  const authorizationDisposition = passwordRecoveryAuthorizationDisposition(
    passwordRecoveryAuthorization,
    authenticatedUser.userId,
  )
  if (authorizationDisposition.status === "unauthorized") {
    return response({ error: "unauthorized" }, 401)
  }
  if (authorizationDisposition.status === "malformed") {
    return response({ error: "unavailable" }, 503)
  }

  let passwordUpdate: unknown
  try {
    passwordUpdate = await supabase.auth.updateUser({
      password: passwordRequest.password,
    })
  } catch {
    return response({ error: "unavailable" }, 503)
  }
  if (!isAcknowledgedPasswordUpdate(passwordUpdate, authenticatedUser.userId)) {
    return response({ error: "unavailable" }, 503)
  }

  const signOutCookieCheckpoint = cookieAdapter.checkpoint()
  let signOut: unknown
  try {
    signOut = await supabase.auth.signOut({ scope: "global" })
  } catch {
    return response({ error: "unavailable" }, 503)
  }
  if (!isAcknowledgedSignOut(signOut)) {
    return response({ error: "unavailable" }, 503)
  }
  if (
    !cookieAdapter.hasCompleteAuthSessionClearSince(signOutCookieCheckpoint)
  ) {
    return response({ error: "unavailable" }, 503)
  }

  const successfulResponse = response(
    { message: "Password reset successful! User has been logged out." },
    200,
  )
  try {
    cookieAdapter.applyTo(successfulResponse)
    appendDefaultSupabaseAuthCookieClearHeaders({
      response: successfulResponse,
      rawCookieHeader: request.headers.get("cookie"),
      supabaseUrl,
      canonicalOrigin,
    })
  } catch {
    return response({ error: "unavailable" }, 503)
  }
  if (!cookieAdapter.responseHasAuthClear(successfulResponse)) {
    return response({ error: "unavailable" }, 503)
  }
  for (const header of advocateAttributionIdentityCookieClearHeaders(
    request.headers.get("host"),
    request.nextUrl.protocol === "https:",
  )) {
    successfulResponse.headers.append("Set-Cookie", header)
  }
  return successfulResponse
}
