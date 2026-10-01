import {
  resolveCrossSubdomainCookieScope,
  type CrossSubdomainCookieLocalTestOptions,
  type CrossSubdomainCookieTrustEnvironment,
} from "@/lib/advocates/crossSubdomainAttributionGate"
import { hkdf } from "@noble/hashes/hkdf"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"

/**
 * This cookie is only an attribution exclusion signal. It is not a session,
 * authentication credential, or authorization primitive. Never use it to
 * grant access or to replace a fresh Supabase authentication check.
 */
export const ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME =
  "cs_advocate_attribution_identity_v1"
export const ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS =
  400 * 24 * 60 * 60

const CURRENT_SECRET_ENVIRONMENT_VARIABLE =
  "ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1"
const PREVIOUS_SECRET_ENVIRONMENT_VARIABLE =
  "ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS"
const AUTHENTICATION_TAG_BYTES = 32
const MAXIMUM_COOKIE_HEADER_BYTES = 32_768
const MAXIMUM_COOKIE_CANDIDATES = 8
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TOKEN_PATTERN =
  /^v2\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([1-9][0-9]{0,15})\.([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const CANONICAL_BASE64_URL_TAG_PATTERN = /^[A-Za-z0-9_-]{43}$/
const TEXT_ENCODER = new TextEncoder()
const KEY_DERIVATION_SALT = TEXT_ENCODER.encode(
  "creator-share/advocates/key-derivation/v1",
)
const COOKIE_KEY_INFO_PREFIX =
  "creator-share/advocates/attribution-identity-cookie-hmac-key/v2"
const COOKIE_CONTEXT = TEXT_ENCODER.encode(
  "creator-share/advocates/attribution-identity-cookie/v2\0",
)
const LOCAL_DEVELOPMENT_SECRET = TEXT_ENCODER.encode(
  "creator-share-local-advocate-attribution-identity-cookie-secret-v1",
)
const VERIFIED_ATTRIBUTION_IDENTITY_SIGNAL: unique symbol = Symbol(
  "verified-advocate-attribution-identity-signal",
)

export type AdvocateAttributionIdentityCookieEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface AdvocateAttributionIdentityCookieInput {
  authUserId: string
  issuedAtSeconds?: number
  expiresAtSeconds?: number
}

/**
 * A verified pseudonymous signal for attribution exclusion only.
 */
export interface VerifiedAdvocateAttributionIdentitySignal {
  readonly authUserId: string
  readonly issuedAtSeconds: number
  readonly expiresAtSeconds: number
  readonly [VERIFIED_ATTRIBUTION_IDENTITY_SIGNAL]: true
}

export interface AdvocateAttributionIdentityCookieVerification {
  signal: VerifiedAdvocateAttributionIdentitySignal
  requiresRefresh: boolean
}

export interface AdvocateAttributionIdentityCookieResolution {
  signal: VerifiedAdvocateAttributionIdentitySignal | null
  hadCandidates: boolean
  requiresNormalization: boolean
  requiresRefresh: boolean
}

export interface AdvocateAttributionIdentityCookieOptions {
  domain?: string
  httpOnly: true
  maxAge: number
  path: "/"
  sameSite: "lax"
  secure: boolean
}

export interface AdvocateAttributionIdentityCookieScopePlan {
  options: AdvocateAttributionIdentityCookieOptions
  creatorShareHost: boolean
  deleteHostOnlyBeforeWrite: boolean
  deleteParentDomainBeforeWrite: boolean
}

export interface AdvocateAttributionIdentityCookieRequestContext {
  rawHost: string | null
  cookieTrustPolicy?: unknown
  localTestOptions?: CrossSubdomainCookieLocalTestOptions
}

interface DerivedKeys {
  current: Uint8Array
  previous: Uint8Array | null
}

interface ParsedToken {
  authUserId: string
  issuedAtSeconds: number
  expiresAtSeconds: number
  payload: string
  authenticationTag: Uint8Array
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

function decodeCanonicalAuthenticationTag(value: string): Uint8Array | null {
  if (!CANONICAL_BASE64_URL_TAG_PATTERN.test(value)) return null

  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "="
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    if (
      bytes.length !== AUTHENTICATION_TAG_BYTES ||
      encodeBase64Url(bytes) !== value
    ) {
      return null
    }
    return bytes
  } catch {
    return null
  }
}

/**
 * Both inputs are always fixed length authentication tags. Keeping the loop
 * length independent of their contents prevents a prefix timing oracle in
 * runtimes where Node's timingSafeEqual is unavailable, including Edge.
 */
function constantTimeAuthenticationTagEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  let difference = left.length ^ right.length
  for (let index = 0; index < AUTHENTICATION_TAG_BYTES; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

function decodedSecret(
  environment: AdvocateAttributionIdentityCookieEnvironment,
  name: string,
): Uint8Array | null | undefined {
  const rawSecret = environment[name]
  if (rawSecret === undefined) return undefined
  return decodeCanonicalBase64(rawSecret)
}

function hasReusedSecret(
  secret: Uint8Array,
  environment: AdvocateAttributionIdentityCookieEnvironment,
): boolean {
  for (const name of [
    "SPONSORSHIP_CRYPTO_SECRET_V1",
    "SPONSORSHIP_VISITOR_COOKIE_SECRET_V1",
  ]) {
    const otherSecret = decodedSecret(environment, name)
    if (otherSecret !== undefined && otherSecret !== null) {
      if (bytesEqual(secret, otherSecret)) return true
    }
  }
  return false
}

function derivedKeys(
  environment: AdvocateAttributionIdentityCookieEnvironment,
  cryptographicScope: string,
): DerivedKeys | null {
  const configuredCurrentSecret = decodedSecret(
    environment,
    CURRENT_SECRET_ENVIRONMENT_VARIABLE,
  )
  if (configuredCurrentSecret === null) return null

  const currentSecret =
    configuredCurrentSecret ??
    (environment.NODE_ENV === "production" ? null : LOCAL_DEVELOPMENT_SECRET)
  if (currentSecret === null || hasReusedSecret(currentSecret, environment)) {
    return null
  }

  const previousSecret = decodedSecret(
    environment,
    PREVIOUS_SECRET_ENVIRONMENT_VARIABLE,
  )
  if (previousSecret === null) return null
  if (
    previousSecret !== undefined &&
    (bytesEqual(currentSecret, previousSecret) ||
      hasReusedSecret(previousSecret, environment))
  ) {
    return null
  }

  return {
    current: hkdf(
      sha256,
      currentSecret,
      KEY_DERIVATION_SALT,
      TEXT_ENCODER.encode(`${COOKIE_KEY_INFO_PREFIX}\0${cryptographicScope}`),
      AUTHENTICATION_TAG_BYTES,
    ),
    previous:
      previousSecret === undefined
        ? null
        : hkdf(
            sha256,
            previousSecret,
            KEY_DERIVATION_SALT,
            TEXT_ENCODER.encode(
              `${COOKIE_KEY_INFO_PREFIX}\0${cryptographicScope}`,
            ),
            AUTHENTICATION_TAG_BYTES,
          ),
  }
}

function authenticationMessage(payload: string): Uint8Array {
  const payloadBytes = TEXT_ENCODER.encode(payload)
  const message = new Uint8Array(COOKIE_CONTEXT.length + payloadBytes.length)
  message.set(COOKIE_CONTEXT)
  message.set(payloadBytes, COOKIE_CONTEXT.length)
  return message
}

function authenticationTag(payload: string, key: Uint8Array): Uint8Array {
  return hmac(sha256, key, authenticationMessage(payload))
}

function isValidUnixSecond(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function canonicalUnixSecond(value: string): number | null {
  const parsed = Number(value)
  return isValidUnixSecond(parsed) && String(parsed) === value ? parsed : null
}

function validLifetime(issuedAtSeconds: number, expiresAtSeconds: number) {
  return (
    expiresAtSeconds > issuedAtSeconds &&
    expiresAtSeconds - issuedAtSeconds <=
      ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS
  )
}

function parseToken(value: string): ParsedToken | null {
  const match = TOKEN_PATTERN.exec(value)
  if (!match) return null

  const issuedAtSeconds = canonicalUnixSecond(match[2])
  const expiresAtSeconds = canonicalUnixSecond(match[3])
  const authenticationTag = decodeCanonicalAuthenticationTag(match[4])
  if (
    issuedAtSeconds === null ||
    expiresAtSeconds === null ||
    authenticationTag === null ||
    !validLifetime(issuedAtSeconds, expiresAtSeconds)
  ) {
    return null
  }

  return {
    authUserId: match[1],
    issuedAtSeconds,
    expiresAtSeconds,
    payload: `v2.${match[1]}.${match[2]}.${match[3]}`,
    authenticationTag,
  }
}

function verifiedSignal(
  parsed: ParsedToken,
): VerifiedAdvocateAttributionIdentitySignal {
  return Object.freeze({
    authUserId: parsed.authUserId,
    issuedAtSeconds: parsed.issuedAtSeconds,
    expiresAtSeconds: parsed.expiresAtSeconds,
  }) as VerifiedAdvocateAttributionIdentitySignal
}

export function createAdvocateAttributionIdentityCookieValue(
  input: AdvocateAttributionIdentityCookieInput,
  context: AdvocateAttributionIdentityCookieRequestContext,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
): string | null {
  const issuedAtSeconds =
    input.issuedAtSeconds ?? Math.floor(Date.now() / 1_000)
  const expiresAtSeconds =
    input.expiresAtSeconds ??
    issuedAtSeconds + ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS

  if (
    !UUID_PATTERN.test(input.authUserId) ||
    !isValidUnixSecond(issuedAtSeconds) ||
    !isValidUnixSecond(expiresAtSeconds) ||
    !validLifetime(issuedAtSeconds, expiresAtSeconds)
  ) {
    return null
  }

  const cryptographicScope = resolveCrossSubdomainCookieScope(
    context.rawHost,
    environment,
    context.cookieTrustPolicy,
    context.localTestOptions,
  ).cryptographicScope
  if (cryptographicScope === null) return null
  const keys = derivedKeys(environment, cryptographicScope)
  if (keys === null) return null
  const payload = `v2.${input.authUserId}.${issuedAtSeconds}.${expiresAtSeconds}`
  const tag = encodeBase64Url(authenticationTag(payload, keys.current))
  return `${payload}.${tag}`
}

export function verifyAdvocateAttributionIdentityCookieValue(
  value: string | null | undefined,
  context: AdvocateAttributionIdentityCookieRequestContext,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
): AdvocateAttributionIdentityCookieVerification | null {
  if (typeof value !== "string" || !isValidUnixSecond(nowSeconds)) return null
  const parsed = parseToken(value)
  if (
    parsed === null ||
    parsed.issuedAtSeconds > nowSeconds ||
    parsed.expiresAtSeconds <= nowSeconds
  ) {
    return null
  }

  const cryptographicScope = resolveCrossSubdomainCookieScope(
    context.rawHost,
    environment,
    context.cookieTrustPolicy,
    context.localTestOptions,
  ).cryptographicScope
  if (cryptographicScope === null) return null
  const keys = derivedKeys(environment, cryptographicScope)
  if (keys === null) return null
  const expectedCurrentTag = authenticationTag(parsed.payload, keys.current)
  const currentMatches = constantTimeAuthenticationTagEqual(
    expectedCurrentTag,
    parsed.authenticationTag,
  )
  const previousMatches =
    keys.previous !== null &&
    constantTimeAuthenticationTagEqual(
      authenticationTag(parsed.payload, keys.previous),
      parsed.authenticationTag,
    )

  if (currentMatches === previousMatches) return null
  return {
    signal: verifiedSignal(parsed),
    requiresRefresh: previousMatches,
  }
}

function cookieCandidates(cookieHeader: string | null): string[] {
  if (!cookieHeader) return []
  if (
    cookieHeader.length > MAXIMUM_COOKIE_HEADER_BYTES ||
    TEXT_ENCODER.encode(cookieHeader).length > MAXIMUM_COOKIE_HEADER_BYTES
  ) {
    return cookieHeader.includes(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`,
    )
      ? Array(MAXIMUM_COOKIE_CANDIDATES + 1).fill("")
      : []
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) =>
      part.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
    )
    .map((part) =>
      part.slice(ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME.length + 1),
    )
}

export function resolveAdvocateAttributionIdentityCookie(
  cookieHeader: string | null,
  context: AdvocateAttributionIdentityCookieRequestContext,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
): AdvocateAttributionIdentityCookieResolution {
  const values = cookieCandidates(cookieHeader)
  if (values.length === 0) {
    return {
      signal: null,
      hadCandidates: false,
      requiresNormalization: false,
      requiresRefresh: false,
    }
  }

  if (values.length > MAXIMUM_COOKIE_CANDIDATES) {
    return {
      signal: null,
      hadCandidates: true,
      requiresNormalization: true,
      requiresRefresh: false,
    }
  }

  const verifiedByAuthUserId = new Map<
    string,
    AdvocateAttributionIdentityCookieVerification[]
  >()
  for (const value of new Set(values)) {
    const verification = verifyAdvocateAttributionIdentityCookieValue(
      value,
      context,
      environment,
      nowSeconds,
    )
    if (verification === null) continue
    const matches =
      verifiedByAuthUserId.get(verification.signal.authUserId) ?? []
    matches.push(verification)
    verifiedByAuthUserId.set(verification.signal.authUserId, matches)
  }

  const matchingIdentities = [...verifiedByAuthUserId.values()]
  const verification =
    matchingIdentities.length === 1
      ? matchingIdentities[0].sort((left, right) => {
          if (left.requiresRefresh !== right.requiresRefresh) {
            return left.requiresRefresh ? 1 : -1
          }
          return right.signal.issuedAtSeconds - left.signal.issuedAtSeconds
        })[0]
      : null
  return {
    signal: verification?.signal ?? null,
    hadCandidates: true,
    requiresNormalization:
      values.length !== 1 ||
      new Set(values).size !== 1 ||
      verification === null ||
      verification.requiresRefresh,
    requiresRefresh: verification?.requiresRefresh ?? false,
  }
}

export function readAdvocateAttributionIdentityCookie(
  cookieHeader: string | null,
  context: AdvocateAttributionIdentityCookieRequestContext,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
): VerifiedAdvocateAttributionIdentitySignal | null {
  return resolveAdvocateAttributionIdentityCookie(
    cookieHeader,
    context,
    environment,
    nowSeconds,
  ).signal
}

export function getAdvocateAttributionIdentityCookieScopePlan(
  rawHost: string | null,
  requestIsSecure: boolean,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  cookieTrustPolicy?: unknown,
  localTestOptions?: CrossSubdomainCookieLocalTestOptions,
): AdvocateAttributionIdentityCookieScopePlan {
  const scope = resolveCrossSubdomainCookieScope(
    rawHost,
    environment as CrossSubdomainCookieTrustEnvironment,
    cookieTrustPolicy,
    localTestOptions,
  )
  return Object.freeze({
    options: Object.freeze({
      ...(scope.domain === undefined ? {} : { domain: scope.domain }),
      httpOnly: true as const,
      maxAge: ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS,
      path: "/" as const,
      sameSite: "lax" as const,
      secure: scope.creatorShareHost || requestIsSecure,
    }),
    creatorShareHost: scope.creatorShareHost,
    deleteHostOnlyBeforeWrite: scope.deleteHostOnlyBeforeWrite,
    deleteParentDomainBeforeWrite: scope.deleteParentDomainBeforeWrite,
  })
}

export function getAdvocateAttributionIdentityCookieOptions(
  rawHost: string | null,
  requestIsSecure: boolean,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  cookieTrustPolicy?: unknown,
  localTestOptions?: CrossSubdomainCookieLocalTestOptions,
): AdvocateAttributionIdentityCookieOptions {
  return getAdvocateAttributionIdentityCookieScopePlan(
    rawHost,
    requestIsSecure,
    environment,
    cookieTrustPolicy,
    localTestOptions,
  ).options
}

function serializeAttributionIdentityCookie(
  value: string,
  options: AdvocateAttributionIdentityCookieOptions,
): string {
  return [
    `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${value}`,
    options.domain === undefined ? null : `Domain=${options.domain}`,
    `Max-Age=${options.maxAge}`,
    "Path=/",
    options.secure ? "Secure" : null,
    "HttpOnly",
    "SameSite=lax",
  ]
    .filter((part): part is string => part !== null)
    .join("; ")
}

function serializeAttributionIdentityCookieDeletion(
  domain: ".creatorshare.com" | undefined,
  secure: boolean,
): string {
  return [
    `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`,
    domain === undefined ? null : `Domain=${domain}`,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    secure ? "Secure" : null,
    "HttpOnly",
    "SameSite=lax",
  ]
    .filter((part): part is string => part !== null)
    .join("; ")
}

export function advocateAttributionIdentityCookieSetHeaders(
  value: string,
  rawHost: string | null,
  requestIsSecure: boolean,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  cookieTrustPolicy?: unknown,
  localTestOptions?: CrossSubdomainCookieLocalTestOptions,
): readonly string[] {
  const plan = getAdvocateAttributionIdentityCookieScopePlan(
    rawHost,
    requestIsSecure,
    environment,
    cookieTrustPolicy,
    localTestOptions,
  )
  const headers: string[] = []
  if (plan.deleteParentDomainBeforeWrite) {
    headers.push(
      serializeAttributionIdentityCookieDeletion(".creatorshare.com", true),
    )
  }
  if (plan.deleteHostOnlyBeforeWrite) {
    headers.push(
      serializeAttributionIdentityCookieDeletion(
        undefined,
        plan.options.secure,
      ),
    )
  }
  headers.push(serializeAttributionIdentityCookie(value, plan.options))
  return Object.freeze(headers)
}

/**
 * Deletes an obsolete parent-domain copy during fail-closed rollback. On the
 * apex, host-only and parent-domain cookies share one storage tuple, so a valid
 * host-bound signal is preserved or rewritten after any required deletion.
 */
export function advocateAttributionIdentityCookieRollbackHeaders(
  cookieHeader: string | null,
  rawHost: string | null,
  requestIsSecure: boolean,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  cookieTrustPolicy?: unknown,
  localTestOptions?: CrossSubdomainCookieLocalTestOptions,
): readonly string[] {
  if (cookieCandidates(cookieHeader).length === 0) return Object.freeze([])
  const plan = getAdvocateAttributionIdentityCookieScopePlan(
    rawHost,
    requestIsSecure,
    environment,
    cookieTrustPolicy,
    localTestOptions,
  )
  if (!plan.creatorShareHost || !plan.deleteParentDomainBeforeWrite) {
    return Object.freeze([])
  }

  const parentDeletion = serializeAttributionIdentityCookieDeletion(
    ".creatorshare.com",
    true,
  )
  const scope = resolveCrossSubdomainCookieScope(
    rawHost,
    environment,
    cookieTrustPolicy,
    localTestOptions,
  )
  if (scope.cryptographicScope !== "host:creatorshare.com") {
    return Object.freeze([parentDeletion])
  }

  const context = { rawHost, cookieTrustPolicy, localTestOptions }
  const resolution = resolveAdvocateAttributionIdentityCookie(
    cookieHeader,
    context,
    environment,
  )
  if (resolution.signal !== null && !resolution.requiresNormalization) {
    return Object.freeze([])
  }
  if (resolution.signal === null) return Object.freeze([parentDeletion])

  const validValue = cookieCandidates(cookieHeader).find((candidate) => {
    const verification = verifyAdvocateAttributionIdentityCookieValue(
      candidate,
      context,
      environment,
    )
    return verification?.signal.authUserId === resolution.signal?.authUserId
  })
  if (validValue === undefined) return Object.freeze([parentDeletion])
  return Object.freeze([
    parentDeletion,
    serializeAttributionIdentityCookie(validValue, plan.options),
  ])
}

export function advocateAttributionIdentityCookieClearHeaders(
  rawHost: string | null,
  requestIsSecure: boolean,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
): readonly string[] {
  const plan = getAdvocateAttributionIdentityCookieScopePlan(
    rawHost,
    requestIsSecure,
    environment,
  )
  return Object.freeze(
    plan.creatorShareHost
      ? [
          serializeAttributionIdentityCookieDeletion(".creatorshare.com", true),
          serializeAttributionIdentityCookieDeletion(undefined, true),
        ]
      : [
          serializeAttributionIdentityCookieDeletion(
            undefined,
            plan.options.secure,
          ),
        ],
  )
}
