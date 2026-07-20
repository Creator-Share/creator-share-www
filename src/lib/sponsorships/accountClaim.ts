import "server-only"

import {
  constantTimeDigestEqual,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
  type VersionedEmailDigest,
} from "@/lib/sponsorships/crypto"

export const SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME = "__Host-cs-sponsor-claim-v1"
export const LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME = "cs_sponsor_claim_v1"
export const LEGACY_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME =
  "creator_share_sponsor_claim_v1"
export const SPONSOR_ACCOUNT_CLAIM_COOKIE_MAX_AGE_SECONDS = 30 * 60
export const SPONSOR_ACCOUNT_CLAIM_CALLBACK_PATH = "/auth/callback"
export const SPONSOR_ACCOUNT_EMAIL_CONFIRMATION_PATH = "/auth/confirm"
export const SPONSOR_ACCOUNT_CLAIM_PAGE_PATH = "/sponsor/claim"
export const SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH = "/app"
export const SPONSOR_ACCOUNT_EMAIL_PROOF_VALID_FOR = "10 minutes"

const PRODUCTION_SITE_ORIGIN = "https://creatorshare.com"
const DEVELOPMENT_SITE_ORIGIN = "http://localhost:3000"
export const SPONSOR_ACCOUNT_CLAIM_START_BODY_MAXIMUM_BYTES = 4096
const MAXIMUM_AUTH_CODE_LENGTH = 2048
const MAXIMUM_COOKIE_HEADER_BYTES = 128 * 1024
const MAXIMUM_COOKIE_VALUE_BYTES = 65_536
const SUPABASE_AUTH_CODE_PATTERN = /^[A-Za-z0-9._~-]+$/
const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const COOKIE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])
const COOKIE_EXPIRATION = "Thu, 01 Jan 1970 00:00:00 GMT"

export type SponsorClaimPageState =
  "ready" | "auth-error" | "check-email" | "complete"

export type SponsorAccountClaimErrorCode =
  | "unauthenticated"
  | "invalid-or-expired"
  | "email-mismatch"
  | "account-conflict"
  | "unavailable"

export class SponsorAccountClaimError extends Error {
  readonly code: SponsorAccountClaimErrorCode
  readonly httpStatus: number

  constructor(
    code: SponsorAccountClaimErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(message)
    this.name = "SponsorAccountClaimError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface SponsorClaimCookieOptions {
  httpOnly: true
  secure: boolean
  sameSite: "lax"
  path: "/"
  maxAge: number
  priority: "high"
}

export interface SponsorClaimCookieConfiguration {
  name:
    | typeof SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME
    | typeof LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME
  secure: boolean
  options: SponsorClaimCookieOptions
}

export type SponsorClaimCookieReadResult =
  | Readonly<{ status: "accepted"; claimToken: string }>
  | Readonly<{ status: "missing" | "rejected" }>

export interface PreparedSponsorClaimStart {
  claimToken: string
  claimTokenDigest: SupabaseRpcBytea
  email: VersionedEmailDigest
}

export interface SponsorClaimAuthenticatedUser {
  id: string
  email: string | null | undefined
  emailConfirmedAt: string | null | undefined
}

export type SponsorClaimStartMode = "initial-claim" | "account-reauth"

export interface SponsorClaimStartDependencies {
  getClaimStartMode(input: {
    claimTokenDigest: SupabaseRpcBytea
    emailDigest: SupabaseRpcBytea
    emailNormalizationVersion: number
    emailHmacKeyVersion: number
  }): Promise<SponsorClaimStartMode | null>
  getAuthenticatedUser(): Promise<SponsorClaimAuthenticatedUser | null>
  sendMagicLink(input: {
    email: string
    emailRedirectTo: string
    mode: SponsorClaimStartMode
  }): Promise<void>
}

export interface SponsorClaimRequestContext {
  requestId: string
  traceId: string | null
  clientIp: string | null
  userAgent: string | null
}

export interface CompleteSponsorClaimDependencies {
  crypto: SponsorshipCrypto
  getAuthenticatedUser(): Promise<SponsorClaimAuthenticatedUser | null>
  issueEmailVerification(input: {
    authUserId: string
    emailDigest: SupabaseRpcBytea
    emailNormalizationVersion: number
    emailHmacKeyVersion: number
    validFor: string
    requestId: string
    traceId: string | null
  }): Promise<void>
  consumeClaim(input: {
    claimTokenDigest: SupabaseRpcBytea
    requestId: string
    traceId: string | null
    clientIp: string | null
    userAgent: string | null
  }): Promise<{ linkedSubscriptionCount: number }>
}

type DatabaseFailure = {
  code?: unknown
  message?: unknown
}

function claimError(
  code: SponsorAccountClaimErrorCode,
): SponsorAccountClaimError {
  switch (code) {
    case "unauthenticated":
      return new SponsorAccountClaimError(
        code,
        "A confirmed sign-in is required",
        401,
      )
    case "invalid-or-expired":
      return new SponsorAccountClaimError(
        code,
        "This account claim is invalid or expired",
        410,
      )
    case "email-mismatch":
      return new SponsorAccountClaimError(
        code,
        "The confirmed account email does not match this claim",
        409,
      )
    case "account-conflict":
      return new SponsorAccountClaimError(
        code,
        "This sponsorship history is already linked to another account",
        409,
      )
    default:
      return new SponsorAccountClaimError(
        code,
        "Sponsor account linking is temporarily unavailable",
        503,
      )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function configuredOriginValue(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return (
    environment.NEXT_PUBLIC_BASE_URL ||
    (environment.NODE_ENV === "production"
      ? PRODUCTION_SITE_ORIGIN
      : DEVELOPMENT_SITE_ORIGIN)
  )
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname)
}

/**
 * Resolves one configured canonical origin. Request Host and forwarded host
 * headers never influence authentication links or post-authentication redirects.
 */
export function getSponsorClaimCanonicalOrigin(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  let url: URL
  try {
    url = new URL(configuredOriginValue(environment))
  } catch {
    throw claimError("unavailable")
  }

  const developmentLoopback =
    environment.NODE_ENV !== "production" && isLoopbackHostname(url.hostname)
  if (
    (url.protocol !== "https:" &&
      !(developmentLoopback && url.protocol === "http:")) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw claimError("unavailable")
  }

  return url.origin
}

export function sponsorClaimCookieConfiguration(
  canonicalOrigin: string = PRODUCTION_SITE_ORIGIN,
): SponsorClaimCookieConfiguration {
  let parsed: URL
  try {
    parsed = new URL(canonicalOrigin)
  } catch {
    throw claimError("unavailable")
  }
  if (
    parsed.origin !== canonicalOrigin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)))
  ) {
    throw claimError("unavailable")
  }

  const secure = parsed.protocol === "https:"
  const name = secure
    ? SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME
    : LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME
  return Object.freeze({
    name,
    secure,
    options: Object.freeze({
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: SPONSOR_ACCOUNT_CLAIM_COOKIE_MAX_AGE_SECONDS,
      priority: "high",
    }),
  })
}

export function getSponsorClaimCookieOptions(
  canonicalOrigin: string = PRODUCTION_SITE_ORIGIN,
): SponsorClaimCookieOptions {
  return sponsorClaimCookieConfiguration(canonicalOrigin).options
}

function parseRawCookieHeader(
  rawCookieHeader: string | null,
): readonly Readonly<{ name: string; value: string }>[] | null {
  if (rawCookieHeader === null || rawCookieHeader === "") return []
  if (
    Buffer.byteLength(rawCookieHeader, "utf8") > MAXIMUM_COOKIE_HEADER_BYTES
  ) {
    return null
  }

  const cookies: Array<Readonly<{ name: string; value: string }>> = []
  for (const rawSegment of rawCookieHeader.split(";")) {
    const segment = rawSegment.trim()
    if (segment === "") continue
    const separator = segment.indexOf("=")
    if (separator <= 0) return null
    const name = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    if (
      !COOKIE_NAME_PATTERN.test(name) ||
      Buffer.byteLength(name, "utf8") > 256 ||
      Buffer.byteLength(value, "utf8") > MAXIMUM_COOKIE_VALUE_BYTES ||
      COOKIE_CONTROL_CHARACTER_PATTERN.test(value)
    ) {
      return null
    }
    cookies.push(Object.freeze({ name, value }))
  }
  return Object.freeze(cookies)
}

/**
 * Reads the capability from the raw Cookie header so same-name host and
 * parent-domain cookies cannot be collapsed before duplicate detection.
 */
export function parseSponsorClaimCookieHeader(options: {
  rawCookieHeader: string | null
  canonicalOrigin: string
}): SponsorClaimCookieReadResult {
  const configuration = sponsorClaimCookieConfiguration(options.canonicalOrigin)
  const cookies = parseRawCookieHeader(options.rawCookieHeader)
  if (cookies === null) return Object.freeze({ status: "rejected" })

  const configuredCookies = cookies.filter(
    (cookie) => cookie.name === configuration.name,
  )
  const hasNoncanonicalClaimCookie = cookies.some(
    (cookie) =>
      cookie.name === LEGACY_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME ||
      cookie.name ===
        (configuration.name === SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME
          ? LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME
          : SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME),
  )
  if (configuredCookies.length === 0) {
    return Object.freeze({
      status: hasNoncanonicalClaimCookie ? "rejected" : "missing",
    })
  }
  if (
    configuredCookies.length !== 1 ||
    !CLAIM_TOKEN_PATTERN.test(configuredCookies[0].value) ||
    (!configuration.secure && hasNoncanonicalClaimCookie)
  ) {
    return Object.freeze({ status: "rejected" })
  }
  return Object.freeze({
    status: "accepted",
    claimToken: configuredCookies[0].value,
  })
}

function serializedClaimCookie(options: {
  name: string
  value: string
  secure: boolean
  maxAge: number
  path?: string
  expires?: string
  domain?: string
}): string {
  const attributes = [
    `${options.name}=${options.value}`,
    `Path=${options.path ?? "/"}`,
    ...(options.domain === undefined ? [] : [`Domain=${options.domain}`]),
    `Max-Age=${options.maxAge}`,
    ...(options.expires === undefined ? [] : [`Expires=${options.expires}`]),
    "HttpOnly",
    ...(options.secure ? ["Secure"] : []),
    "SameSite=Lax",
    "Priority=High",
  ]
  return attributes.join("; ")
}

function claimCookieTombstone(options: {
  name: string
  secure: boolean
  path?: string
  domain?: string
}): string {
  return serializedClaimCookie({
    name: options.name,
    value: "",
    secure: options.secure,
    path: options.path,
    domain: options.domain,
    maxAge: 0,
    expires: COOKIE_EXPIRATION,
  })
}

function claimCookieTombstonePaths(
  requestPathname:
    "/api/sponsor-account/start" | "/api/sponsor-account/complete",
): readonly string[] {
  const finalSegment = requestPathname.endsWith("/start") ? "start" : "complete"
  return Object.freeze([
    "/",
    "/api",
    "/api/",
    "/api/sponsor-account",
    "/api/sponsor-account/",
    `/api/sponsor-account/${finalSegment}`,
  ])
}

function isExactCreatorShareApex(options: {
  canonicalOrigin: string
  rawHost: string | null
}): boolean {
  return (
    options.canonicalOrigin === PRODUCTION_SITE_ORIGIN &&
    options.rawHost?.trim().toLowerCase() === "creatorshare.com"
  )
}

export function sponsorClaimLegacyCookieTombstoneHeaders(options: {
  canonicalOrigin: string
  rawHost: string | null
  requestPathname:
    "/api/sponsor-account/start" | "/api/sponsor-account/complete"
}): readonly string[] {
  const configuration = sponsorClaimCookieConfiguration(options.canonicalOrigin)
  const headers: string[] = []
  for (const path of claimCookieTombstonePaths(options.requestPathname)) {
    headers.push(
      claimCookieTombstone({
        name: LEGACY_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
        secure: configuration.secure,
        path,
      }),
    )
    if (isExactCreatorShareApex(options)) {
      headers.push(
        claimCookieTombstone({
          name: LEGACY_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
          secure: true,
          path,
          domain: ".creatorshare.com",
        }),
      )
    }
  }
  if (configuration.secure) {
    headers.push(
      claimCookieTombstone({
        name: LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
        secure: true,
      }),
    )
    if (isExactCreatorShareApex(options)) {
      headers.push(
        claimCookieTombstone({
          name: LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
          secure: true,
          domain: ".creatorshare.com",
        }),
      )
    }
  }
  return Object.freeze(headers)
}

export function sponsorClaimCookieSetHeaders(options: {
  canonicalOrigin: string
  rawHost: string | null
  requestPathname: "/api/sponsor-account/start"
  claimToken: string
}): readonly string[] {
  if (!CLAIM_TOKEN_PATTERN.test(options.claimToken)) {
    throw claimError("invalid-or-expired")
  }
  const configuration = sponsorClaimCookieConfiguration(options.canonicalOrigin)
  return Object.freeze([
    serializedClaimCookie({
      name: configuration.name,
      value: options.claimToken,
      secure: configuration.secure,
      maxAge: configuration.options.maxAge,
    }),
    ...sponsorClaimLegacyCookieTombstoneHeaders(options),
  ])
}

export function sponsorClaimCookieClearHeaders(options: {
  canonicalOrigin: string
  rawHost: string | null
  requestPathname: "/api/sponsor-account/complete"
}): readonly string[] {
  const configuration = sponsorClaimCookieConfiguration(options.canonicalOrigin)
  return Object.freeze([
    claimCookieTombstone({
      name: configuration.name,
      secure: configuration.secure,
    }),
    ...sponsorClaimLegacyCookieTombstoneHeaders(options),
  ])
}

export function parseSponsorClaimStartModeRpcResult(
  data: unknown,
): "initial-claim" | "account-reauth" | null {
  if (!Array.isArray(data) || data.length > 1) return null
  if (data.length === 0) return null
  const row = data[0]
  if (
    !isRecord(row) ||
    Object.keys(row).length !== 1 ||
    !Object.hasOwn(row, "claim_start_mode")
  ) {
    return null
  }
  const mode = row.claim_start_mode
  return mode === "initial-claim" || mode === "account-reauth" ? mode : null
}

export function isTrustedSponsorClaimRequest(
  headers: Pick<Headers, "get">,
  canonicalOrigin: string,
): boolean {
  const origin = headers.get("origin")
  const fetchSite = headers.get("sec-fetch-site")

  return (
    origin === canonicalOrigin &&
    (fetchSite === null || fetchSite === "same-origin")
  )
}

export function parseSponsorClaimStartBody(
  rawBody: string,
  crypto: SponsorshipCrypto,
): PreparedSponsorClaimStart | null {
  if (
    typeof rawBody !== "string" ||
    Buffer.byteLength(rawBody, "utf8") >
      SPONSOR_ACCOUNT_CLAIM_START_BODY_MAXIMUM_BYTES
  ) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const keys = Object.keys(parsed).sort()
  if (keys.length !== 2 || keys[0] !== "email" || keys[1] !== "token") {
    return null
  }

  const claimToken = parsed.token
  const email = parsed.email
  if (typeof claimToken !== "string" || typeof email !== "string") {
    return null
  }

  try {
    const emailDigest = crypto.digestEmail(email)
    const tokenDigest = crypto.digestOpaqueToken(claimToken)
    return {
      claimToken,
      claimTokenDigest: `\\x${tokenDigest.toString("hex")}`,
      email: emailDigest,
    }
  } catch {
    return null
  }
}

export function buildSponsorClaimMagicLinkCallback(
  canonicalOrigin: string,
): string {
  const callback = new URL(
    SPONSOR_ACCOUNT_EMAIL_CONFIRMATION_PATH,
    canonicalOrigin,
  )
  callback.searchParams.set("next", SPONSOR_ACCOUNT_CLAIM_PAGE_PATH)
  return callback.toString()
}

/**
 * Welcome links keep private values in the URL fragment. Fragments are not sent
 * in HTTP requests and the claim page removes them before its first API call.
 */
export function buildSponsorClaimWelcomeUrl(
  canonicalOrigin: string,
  claimToken: string,
  email: string,
  crypto: SponsorshipCrypto,
): string {
  const prepared = parseSponsorClaimStartBody(
    JSON.stringify({ token: claimToken, email }),
    crypto,
  )
  if (!prepared) throw claimError("invalid-or-expired")

  const url = new URL(SPONSOR_ACCOUNT_CLAIM_PAGE_PATH, canonicalOrigin)
  url.hash = new URLSearchParams({
    token: prepared.claimToken,
    email: prepared.email.normalizedEmail,
  }).toString()
  return url.toString()
}

function isConfirmedUser(
  user: SponsorClaimAuthenticatedUser | null,
): user is SponsorClaimAuthenticatedUser & { email: string } {
  return Boolean(user?.id && user.email && user.emailConfirmedAt)
}

async function currentUserMatchesClaim(
  user: SponsorClaimAuthenticatedUser | null,
  claimEmail: VersionedEmailDigest,
  crypto: SponsorshipCrypto,
): Promise<boolean> {
  if (!isConfirmedUser(user)) return false

  try {
    const userEmail = crypto.digestEmail(user.email)
    return (
      userEmail.normalizationVersion === claimEmail.normalizationVersion &&
      userEmail.hmacKeyVersion === claimEmail.hmacKeyVersion &&
      constantTimeDigestEqual(userEmail.digest, claimEmail.digest)
    )
  } catch {
    return false
  }
}

/**
 * Returns only a UI disposition. The caller retains the raw token solely long
 * enough to place it in the protected cookie and never serializes it.
 */
export async function decideSponsorClaimStart(
  prepared: PreparedSponsorClaimStart,
  canonicalOrigin: string,
  crypto: SponsorshipCrypto,
  dependencies: SponsorClaimStartDependencies,
): Promise<"ready" | "check-email"> {
  let mode: SponsorClaimStartMode | null = null
  try {
    mode = await dependencies.getClaimStartMode({
      claimTokenDigest: prepared.claimTokenDigest,
      emailDigest: prepared.email.digestRpcBytea,
      emailNormalizationVersion: prepared.email.normalizationVersion,
      emailHmacKeyVersion: prepared.email.hmacKeyVersion,
    })
  } catch {
    return "check-email"
  }
  if (mode === null) return "check-email"

  let currentUser: SponsorClaimAuthenticatedUser | null = null
  try {
    currentUser = await dependencies.getAuthenticatedUser()
  } catch {
    currentUser = null
  }

  if (await currentUserMatchesClaim(currentUser, prepared.email, crypto)) {
    return "ready"
  }

  try {
    await dependencies.sendMagicLink({
      email: prepared.email.normalizedEmail,
      emailRedirectTo: buildSponsorClaimMagicLinkCallback(canonicalOrigin),
      mode,
    })
  } catch {
    // The public response remains generic for unknown and known accounts.
  }

  return "check-email"
}

export function isValidSupabaseAuthCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= MAXIMUM_AUTH_CODE_LENGTH &&
    SUPABASE_AUTH_CODE_PATTERN.test(value)
  )
}

export function getAllowedSponsorClaimCallbackTarget(
  requestedPath: string | null | undefined,
):
  | typeof SPONSOR_ACCOUNT_CLAIM_PAGE_PATH
  | typeof SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH {
  if (
    requestedPath === SPONSOR_ACCOUNT_CLAIM_PAGE_PATH ||
    requestedPath === SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH
  ) {
    return requestedPath
  }
  return SPONSOR_ACCOUNT_CLAIM_PAGE_PATH
}

export function buildSponsorClaimPageRedirect(
  canonicalOrigin: string,
  requestedPath: string | null | undefined,
  state: SponsorClaimPageState,
): URL {
  const target = new URL(
    getAllowedSponsorClaimCallbackTarget(requestedPath),
    canonicalOrigin,
  )
  target.searchParams.set("state", state)
  return target
}

export function classifySponsorClaimDatabaseFailure(
  failure: unknown,
): SponsorAccountClaimError {
  const candidate = isRecord(failure) ? (failure as DatabaseFailure) : {}
  const code = typeof candidate.code === "string" ? candidate.code : ""
  const message = typeof candidate.message === "string" ? candidate.message : ""

  if (code === "42501") return claimError("unauthenticated")
  if (
    code === "22023" ||
    message.includes("token is invalid") ||
    message.includes("no longer available")
  ) {
    return claimError("invalid-or-expired")
  }
  if (
    message.includes("email does not match") ||
    message.includes("Changing an account email") ||
    message.includes("another email digest")
  ) {
    return claimError("email-mismatch")
  }
  if (
    code === "23505" ||
    message.includes("already owns another") ||
    message.includes("already belongs to another") ||
    message.includes("cannot attach to this account")
  ) {
    return claimError("account-conflict")
  }
  return claimError("unavailable")
}

/**
 * Supabase may expose PostgreSQL integer values as numbers or decimal strings.
 * Keep that transport detail at the server boundary and reject every other
 * response shape before it reaches the account claim workflow.
 */
export function parseSponsorAccountClaimRpcResult(data: unknown): {
  linkedSubscriptionCount: number
} {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data
  if (!isRecord(row)) throw claimError("unavailable")

  const rawCount = row.linked_subscription_count
  const linkedSubscriptionCount =
    typeof rawCount === "string" && /^\d+$/.test(rawCount)
      ? Number(rawCount)
      : rawCount

  if (
    typeof linkedSubscriptionCount !== "number" ||
    !Number.isSafeInteger(linkedSubscriptionCount) ||
    linkedSubscriptionCount < 0
  ) {
    throw claimError("unavailable")
  }

  return { linkedSubscriptionCount }
}

export async function completeSponsorAccountClaim(
  claimToken: string | null,
  context: SponsorClaimRequestContext,
  dependencies: CompleteSponsorClaimDependencies,
): Promise<{ linkedSubscriptionCount: number }> {
  if (!claimToken) throw claimError("invalid-or-expired")

  let claimTokenDigest: SupabaseRpcBytea
  try {
    claimTokenDigest = `\\x${dependencies.crypto
      .digestOpaqueToken(claimToken)
      .toString("hex")}`
  } catch {
    throw claimError("invalid-or-expired")
  }

  let user: SponsorClaimAuthenticatedUser | null
  try {
    user = await dependencies.getAuthenticatedUser()
  } catch {
    throw claimError("unauthenticated")
  }
  if (!isConfirmedUser(user)) throw claimError("unauthenticated")

  let email: VersionedEmailDigest
  try {
    email = dependencies.crypto.digestEmail(user.email)
  } catch {
    throw claimError("unauthenticated")
  }

  try {
    await dependencies.issueEmailVerification({
      authUserId: user.id,
      emailDigest: email.digestRpcBytea,
      emailNormalizationVersion: email.normalizationVersion,
      emailHmacKeyVersion: email.hmacKeyVersion,
      validFor: SPONSOR_ACCOUNT_EMAIL_PROOF_VALID_FOR,
      requestId: context.requestId,
      traceId: context.traceId,
    })

    const result = await dependencies.consumeClaim({
      claimTokenDigest,
      requestId: context.requestId,
      traceId: context.traceId,
      clientIp: context.clientIp,
      userAgent: context.userAgent,
    })

    if (
      !Number.isSafeInteger(result.linkedSubscriptionCount) ||
      result.linkedSubscriptionCount < 0
    ) {
      throw claimError("unavailable")
    }

    return { linkedSubscriptionCount: result.linkedSubscriptionCount }
  } catch (error) {
    if (error instanceof SponsorAccountClaimError) throw error
    throw classifySponsorClaimDatabaseFailure(error)
  }
}
