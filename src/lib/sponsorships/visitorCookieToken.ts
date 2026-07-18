import { ADVOCATE_TENANT_ROOT, resolveAdvocateHost } from "@/lib/advocates/host"
import { hkdf } from "@noble/hashes/hkdf"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"

export const SPONSORSHIP_VISITOR_COOKIE_NAME = "cs_sponsorship_visitor_v1"
export const SPONSORSHIP_VISITOR_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

const VISITOR_TOKEN_BYTES = 32
const VISITOR_AUTH_TAG_BYTES = 16
const MAXIMUM_COOKIE_HEADER_BYTES = 32_768
const MAXIMUM_VISITOR_COOKIE_CANDIDATES = 8
const CRYPTO_ALERT_INTERVAL_MILLISECONDS = 60_000
const VISITOR_TOKEN_PATTERN = /^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{22})$/
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const TEXT_ENCODER = new TextEncoder()
const KEY_DERIVATION_SALT = TEXT_ENCODER.encode(
  "creator-share/sponsorship/key-derivation/v1",
)
const VISITOR_COOKIE_KEY_INFO = TEXT_ENCODER.encode(
  "creator-share/sponsorship/visitor-cookie-hmac-key/v1",
)
const VISITOR_COOKIE_CONTEXT = TEXT_ENCODER.encode(
  "creator-share/sponsorship/visitor-cookie/v1\0",
)
const LOCAL_DEVELOPMENT_SECRET = TEXT_ENCODER.encode(
  "creator-share-local-visitor-cookie-secret-v1",
)
const VERIFIED_SPONSORSHIP_VISITOR_TOKEN: unique symbol = Symbol(
  "verified-sponsorship-visitor-token",
)

let lastCryptoAlertAt = 0

export type VerifiedSponsorshipVisitorToken = string & {
  readonly [VERIFIED_SPONSORSHIP_VISITOR_TOKEN]: true
}

export type SponsorshipVisitorCookieEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface SponsorshipVisitorCookieOptions {
  domain?: string
  httpOnly: true
  maxAge: number
  path: "/"
  sameSite: "lax"
  secure: boolean
}

export interface SponsorshipVisitorCookieResolution {
  token: VerifiedSponsorshipVisitorToken | null
  hadCandidates: boolean
  requiresNormalization: boolean
}

function reportVisitorCryptoFailure(
  operation: "create" | "verify",
  error: unknown,
): void {
  const now = Date.now()
  if (now - lastCryptoAlertAt < CRYPTO_ALERT_INTERVAL_MILLISECONDS) return
  lastCryptoAlertAt = now
  console.error("Sponsorship visitor cryptography is unavailable", {
    event: "sponsorship_visitor_crypto_unavailable",
    operation,
    errorName: error instanceof Error ? error.name : "ConfigurationError",
    errorMessage:
      error instanceof Error ? error.message.slice(0, 160) : "invalid-secret",
  })
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function decodeCanonicalBase64(value: unknown): Uint8Array | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_368 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(value)
  ) {
    return null
  }

  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    if (
      bytes.length < 32 ||
      bytes.length > 1_024 ||
      encodeBase64(bytes) !== value
    ) {
      return null
    }
    return bytes
  } catch {
    return null
  }
}

function appSecret(
  environment: SponsorshipVisitorCookieEnvironment,
): Uint8Array | null {
  const rawSecret = environment.SPONSORSHIP_VISITOR_COOKIE_SECRET_V1
  if (rawSecret === undefined) {
    return environment.NODE_ENV === "production"
      ? null
      : LOCAL_DEVELOPMENT_SECRET
  }
  if (rawSecret === environment.SPONSORSHIP_CRYPTO_SECRET_V1) return null
  return decodeCanonicalBase64(rawSecret)
}

function visitorCookieHmacKey(
  environment: SponsorshipVisitorCookieEnvironment,
): Uint8Array | null {
  const secret = appSecret(environment)
  if (secret === null) return null
  return hkdf(sha256, secret, KEY_DERIVATION_SALT, VISITOR_COOKIE_KEY_INFO, 32)
}

function visitorAuthenticationMessage(visitorId: string): Uint8Array {
  const visitorIdBytes = TEXT_ENCODER.encode(visitorId)
  const message = new Uint8Array(
    VISITOR_COOKIE_CONTEXT.length + visitorIdBytes.length,
  )
  message.set(VISITOR_COOKIE_CONTEXT)
  message.set(visitorIdBytes, VISITOR_COOKIE_CONTEXT.length)
  return message
}

function visitorAuthenticationTag(
  visitorId: string,
  environment: SponsorshipVisitorCookieEnvironment,
): string | null {
  const key = visitorCookieHmacKey(environment)
  if (key === null) return null
  const signature = hmac(sha256, key, visitorAuthenticationMessage(visitorId))
  return encodeBase64Url(signature.slice(0, VISITOR_AUTH_TAG_BYTES))
}

function constantTimeTextEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export async function createSponsorshipVisitorToken(
  environment: SponsorshipVisitorCookieEnvironment = process.env,
): Promise<VerifiedSponsorshipVisitorToken | null> {
  try {
    const visitorIdBytes = new Uint8Array(VISITOR_TOKEN_BYTES)
    crypto.getRandomValues(visitorIdBytes)
    const visitorId = encodeBase64Url(visitorIdBytes)
    const authenticationTag = await visitorAuthenticationTag(
      visitorId,
      environment,
    )
    if (authenticationTag === null) {
      reportVisitorCryptoFailure("create", null)
      return null
    }
    return `v1.${visitorId}.${authenticationTag}` as VerifiedSponsorshipVisitorToken
  } catch (error) {
    reportVisitorCryptoFailure("create", error)
    return null
  }
}

export function isStructurallyValidSponsorshipVisitorToken(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && VISITOR_TOKEN_PATTERN.test(value)
}

async function authenticateSponsorshipVisitorToken(
  value: string | null | undefined,
  environment: SponsorshipVisitorCookieEnvironment = process.env,
): Promise<VerifiedSponsorshipVisitorToken | null> {
  if (typeof value !== "string") return null
  const match = VISITOR_TOKEN_PATTERN.exec(value)
  if (!match) return null
  try {
    const expectedTag = await visitorAuthenticationTag(match[1], environment)
    if (expectedTag === null) {
      reportVisitorCryptoFailure("verify", null)
      return null
    }
    return constantTimeTextEqual(expectedTag, match[2])
      ? (value as VerifiedSponsorshipVisitorToken)
      : null
  } catch (error) {
    reportVisitorCryptoFailure("verify", error)
    return null
  }
}

export async function verifySponsorshipVisitorToken(
  value: string | null | undefined,
  environment: SponsorshipVisitorCookieEnvironment = process.env,
): Promise<boolean> {
  return (
    (await authenticateSponsorshipVisitorToken(value, environment)) !== null
  )
}

function visitorCookieCandidates(cookieHeader: string | null): string[] {
  if (!cookieHeader) return []
  if (
    cookieHeader.length > MAXIMUM_COOKIE_HEADER_BYTES ||
    TEXT_ENCODER.encode(cookieHeader).length > MAXIMUM_COOKIE_HEADER_BYTES
  ) {
    return cookieHeader.includes(`${SPONSORSHIP_VISITOR_COOKIE_NAME}=`)
      ? Array(MAXIMUM_VISITOR_COOKIE_CANDIDATES + 1).fill("")
      : []
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SPONSORSHIP_VISITOR_COOKIE_NAME}=`))
    .map((part) => part.slice(SPONSORSHIP_VISITOR_COOKIE_NAME.length + 1))
}

export async function resolveSponsorshipVisitorCookie(
  cookieHeader: string | null,
  environment: SponsorshipVisitorCookieEnvironment = process.env,
): Promise<SponsorshipVisitorCookieResolution> {
  const values = visitorCookieCandidates(cookieHeader)
  if (values.length === 0) {
    return { token: null, hadCandidates: false, requiresNormalization: false }
  }
  if (values.length > MAXIMUM_VISITOR_COOKIE_CANDIDATES) {
    return { token: null, hadCandidates: true, requiresNormalization: true }
  }

  const authenticatedTokens = new Map<string, VerifiedSponsorshipVisitorToken>()
  for (const value of new Set(values)) {
    const token = await authenticateSponsorshipVisitorToken(value, environment)
    if (token !== null) authenticatedTokens.set(token, token)
  }

  const uniqueTokens = [...authenticatedTokens.values()]
  const token = uniqueTokens.length === 1 ? uniqueTokens[0] : null
  return {
    token,
    hadCandidates: true,
    requiresNormalization:
      values.length !== 1 || token === null || values[0] !== token,
  }
}

export async function readSponsorshipVisitorCookie(
  cookieHeader: string | null,
  environment: SponsorshipVisitorCookieEnvironment = process.env,
): Promise<VerifiedSponsorshipVisitorToken | null> {
  return (await resolveSponsorshipVisitorCookie(cookieHeader, environment))
    .token
}

function getNormalizedHostname(rawHost: string | null): string | null {
  const resolution = resolveAdvocateHost(rawHost, {
    allowLocalhostDevelopment: true,
  })

  if (resolution.kind === "invalid") return null
  if (resolution.kind === "tenant-candidate") {
    return resolution.requestHostname
  }
  return resolution.normalizedHostname
}

export function getSponsorshipVisitorCookieOptions(
  rawHost: string | null,
  requestIsSecure: boolean,
): SponsorshipVisitorCookieOptions {
  const hostname = getNormalizedHostname(rawHost)
  const isCreatorShareDomain =
    hostname === ADVOCATE_TENANT_ROOT ||
    hostname?.endsWith(`.${ADVOCATE_TENANT_ROOT}`) === true

  return {
    ...(isCreatorShareDomain ? { domain: `.${ADVOCATE_TENANT_ROOT}` } : {}),
    httpOnly: true,
    maxAge: SPONSORSHIP_VISITOR_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: isCreatorShareDomain || requestIsSecure,
  }
}
