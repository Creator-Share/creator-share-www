import "server-only"

import {
  createHmac,
  randomBytes as systemRandomBytes,
  timingSafeEqual,
} from "node:crypto"

import { resolveAdvocateHost } from "../host"
import type {
  PublicationCanaryTarget,
  PublicationCanaryTargetIdentity,
} from "./repository"

export const ADVOCATE_PUBLICATION_CANARY_PATH =
  "/.well-known/creator-share/advocate-publication-canary" as const
export const ADVOCATE_PUBLICATION_CANARY_SECRET_ENV =
  "ADVOCATE_PUBLICATION_CANARY_SECRET_V1" as const
export const ADVOCATE_PUBLICATION_CANARY_MAX_TTL_SECONDS = 120 as const

const TOKEN_VERSION = "v1"
const KEY_ID = "v1"
const TOKEN_PURPOSE = "advocate-publication-canary"
const RESPONSE_PURPOSE = "advocate-publication-canary-response"
const SECRET_BYTES = 32
const NONCE_BYTES = 32
const SIGNATURE_BYTES = 32
const MAXIMUM_TOKEN_BYTES = 2_048
const MAXIMUM_CLOCK_SKEW_SECONDS = 30
const TOKEN_PAYLOAD_CONTEXT = Buffer.from(
  "creator-share/advocate-publication-canary/token/v1\0",
  "utf8",
)
const RESPONSE_CONTEXT = Buffer.from(
  "creator-share/advocate-publication-canary/response/v1\0",
  "utf8",
)
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/
const RFC3339_MILLISECOND_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const FAILURE_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Content-Type": "text/plain; charset=utf-8",
  "Cross-Origin-Resource-Policy": "same-origin",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: "Authorization, Host",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
})

const SUCCESS_RESPONSE_HEADERS = Object.freeze({
  ...FAILURE_RESPONSE_HEADERS,
  "Content-Type": "application/json; charset=utf-8",
})

const DEDICATED_SECRET_ENVIRONMENTS = Object.freeze([
  "ADVOCATE_PROVISIONING_WORKER_SECRET",
  "CRON_SECRET",
  "DATA_RETENTION_WORKER_SECRET",
  "PAYMENT_GATEWAY_EVENT_WORKER_SECRET",
  "SPONSORSHIP_CRYPTO_SECRET_V1",
  "SPONSORSHIP_VISITOR_COOKIE_SECRET_V1",
  "SPONSOR_WELCOME_EMAIL_WORKER_SECRET",
  "SUBSCRIPTION_CANCELLATION_WORKER_SECRET",
] as const)

export type PublicationCanaryEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface PublicationCanaryClaims
  extends PublicationCanaryTargetIdentity {
  schemaVersion: 1
  purpose: typeof TOKEN_PURPOSE
  keyId: typeof KEY_ID
  runId: string
  nonce: string
  deploymentId: string
  revision: string
  issuedAt: number
  expiresAt: number
}

export interface PublicationCanaryTokenInput
  extends PublicationCanaryTargetIdentity {
  runId: string
  deploymentId: string
  revision: string
  ttlSeconds?: number
}

export interface PublicationCanaryResponseBody
  extends PublicationCanaryTargetIdentity {
  schemaVersion: 1
  purpose: typeof RESPONSE_PURPOSE
  keyId: typeof KEY_ID
  runId: string
  nonce: string
  deploymentId: string
  revision: string
  verifiedAt: string
  responseMac: string
}

export interface PublicationCanaryRequestDependencies {
  environment?: PublicationCanaryEnvironment
  now?: () => number
  loadTarget(
    identity: PublicationCanaryTargetIdentity,
  ): Promise<PublicationCanaryTarget | null>
}

export type PublicationCanaryRandomBytes = (size: number) => Uint8Array

export class PublicationCanaryConfigurationError extends Error {
  constructor() {
    super("Advocate publication canary configuration is unavailable")
    this.name = "PublicationCanaryConfigurationError"
  }
}

function configurationError(): never {
  throw new PublicationCanaryConfigurationError()
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function decodeSecret(environment: PublicationCanaryEnvironment): Buffer {
  const rawSecret = environment[ADVOCATE_PUBLICATION_CANARY_SECRET_ENV]
  if (
    typeof rawSecret !== "string" ||
    rawSecret.length !== 44 ||
    !CANONICAL_BASE64_PATTERN.test(rawSecret)
  ) {
    configurationError()
  }

  const secret = Buffer.from(rawSecret, "base64")
  if (
    secret.length !== SECRET_BYTES ||
    secret.toString("base64") !== rawSecret ||
    DEDICATED_SECRET_ENVIRONMENTS.some(
      (name) =>
        environment[name] !== undefined && environment[name] === rawSecret,
    )
  ) {
    configurationError()
  }
  return secret
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url")
}

function decodeCanonicalBase64Url(
  value: string,
  expectedBytes?: number,
): Buffer | null {
  if (
    value.length === 0 ||
    value.length > MAXIMUM_TOKEN_BYTES ||
    !BASE64URL_PATTERN.test(value)
  ) {
    return null
  }

  try {
    const decoded = Buffer.from(value, "base64url")
    if (
      (expectedBytes !== undefined && decoded.length !== expectedBytes) ||
      encodeBase64Url(decoded) !== value
    ) {
      return null
    }
    return decoded
  } catch {
    return null
  }
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function validNonce(value: unknown): value is string {
  return (
    typeof value === "string" &&
    decodeCanonicalBase64Url(value, NONCE_BYTES) !== null
  )
}

function validHostname(value: unknown): value is string {
  if (typeof value !== "string") return false
  const resolution = resolveAdvocateHost(value)
  return (
    resolution.kind === "tenant-candidate" &&
    resolution.environment === "production" &&
    resolution.requestPort === null &&
    resolution.requestHostname === value &&
    resolution.domainLookup.hostname === value
  )
}

function validAdvocateVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
}

function validDeploymentId(value: unknown): value is string {
  return typeof value === "string" && DEPLOYMENT_ID_PATTERN.test(value)
}

function validRevision(value: unknown): value is string {
  return typeof value === "string" && GIT_REVISION_PATTERN.test(value)
}

function validEpochSecond(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
}

function serializeClaims(claims: PublicationCanaryClaims): string {
  return JSON.stringify({
    schemaVersion: claims.schemaVersion,
    purpose: claims.purpose,
    keyId: claims.keyId,
    runId: claims.runId,
    nonce: claims.nonce,
    advocateId: claims.advocateId,
    domainId: claims.domainId,
    hostname: claims.hostname,
    advocateVersion: claims.advocateVersion,
    deploymentId: claims.deploymentId,
    revision: claims.revision,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  })
}

function parseClaims(
  payload: Buffer,
  nowMilliseconds: number,
): PublicationCanaryClaims | null {
  let value: unknown
  try {
    value = JSON.parse(payload.toString("utf8"))
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "purpose",
      "keyId",
      "runId",
      "nonce",
      "advocateId",
      "domainId",
      "hostname",
      "advocateVersion",
      "deploymentId",
      "revision",
      "issuedAt",
      "expiresAt",
    ]) ||
    value.schemaVersion !== 1 ||
    value.purpose !== TOKEN_PURPOSE ||
    value.keyId !== KEY_ID ||
    !validUuid(value.runId) ||
    !validNonce(value.nonce) ||
    !validUuid(value.advocateId) ||
    !validUuid(value.domainId) ||
    !validHostname(value.hostname) ||
    !validAdvocateVersion(value.advocateVersion) ||
    !validDeploymentId(value.deploymentId) ||
    !validRevision(value.revision) ||
    !validEpochSecond(value.issuedAt) ||
    !validEpochSecond(value.expiresAt) ||
    value.expiresAt <= value.issuedAt ||
    value.expiresAt - value.issuedAt >
      ADVOCATE_PUBLICATION_CANARY_MAX_TTL_SECONDS
  ) {
    return null
  }

  const nowSeconds = Math.floor(nowMilliseconds / 1_000)
  if (
    value.issuedAt > nowSeconds + MAXIMUM_CLOCK_SKEW_SECONDS ||
    value.expiresAt <= nowSeconds
  ) {
    return null
  }

  const claims = value as unknown as PublicationCanaryClaims
  return serializeClaims(claims) === payload.toString("utf8") ? claims : null
}

function tokenMac(payload: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret)
    .update(TOKEN_PAYLOAD_CONTEXT)
    .update(payload, "utf8")
    .digest()
}

function responseUnsignedBody(
  claims: PublicationCanaryClaims,
  verifiedAt: string,
): Omit<PublicationCanaryResponseBody, "responseMac"> {
  return {
    schemaVersion: 1,
    purpose: RESPONSE_PURPOSE,
    keyId: claims.keyId,
    runId: claims.runId,
    nonce: claims.nonce,
    advocateId: claims.advocateId,
    domainId: claims.domainId,
    hostname: claims.hostname,
    advocateVersion: claims.advocateVersion,
    deploymentId: claims.deploymentId,
    revision: claims.revision,
    verifiedAt,
  }
}

function serializeUnsignedResponse(
  value: Omit<PublicationCanaryResponseBody, "responseMac">,
): string {
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    purpose: value.purpose,
    keyId: value.keyId,
    runId: value.runId,
    nonce: value.nonce,
    advocateId: value.advocateId,
    domainId: value.domainId,
    hostname: value.hostname,
    advocateVersion: value.advocateVersion,
    deploymentId: value.deploymentId,
    revision: value.revision,
    verifiedAt: value.verifiedAt,
  })
}

function responseMac(
  value: Omit<PublicationCanaryResponseBody, "responseMac">,
  secret: Buffer,
): string {
  return createHmac("sha256", secret)
    .update(RESPONSE_CONTEXT)
    .update(serializeUnsignedResponse(value), "utf8")
    .digest("base64url")
}

function serializeResponse(
  value: Omit<PublicationCanaryResponseBody, "responseMac">,
  mac: string,
): string {
  return JSON.stringify({ ...value, responseMac: mac })
}

function sameTarget(
  target: PublicationCanaryTarget,
  claims: PublicationCanaryClaims,
): boolean {
  return (
    target.advocateId === claims.advocateId &&
    target.domainId === claims.domainId &&
    target.hostname === claims.hostname &&
    target.advocateVersion === claims.advocateVersion
  )
}

function genericNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: FAILURE_RESPONSE_HEADERS,
  })
}

function bearerToken(value: string | null): string | null {
  if (value === null || value.length > MAXIMUM_TOKEN_BYTES + 7) return null
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(value)
  return match?.[1] ?? null
}

export function createPublicationCanaryToken(
  input: PublicationCanaryTokenInput,
  options: {
    environment?: PublicationCanaryEnvironment
    now?: () => number
    randomBytes?: PublicationCanaryRandomBytes
  } = {},
): string {
  const environment = options.environment ?? process.env
  const nowMilliseconds = (options.now ?? Date.now)()
  const issuedAt = Math.floor(nowMilliseconds / 1_000)
  const ttlSeconds =
    input.ttlSeconds ?? ADVOCATE_PUBLICATION_CANARY_MAX_TTL_SECONDS
  let nonceBytes: Uint8Array
  try {
    nonceBytes = (options.randomBytes ?? systemRandomBytes)(NONCE_BYTES)
  } catch {
    configurationError()
  }

  if (
    !Number.isFinite(nowMilliseconds) ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > ADVOCATE_PUBLICATION_CANARY_MAX_TTL_SECONDS ||
    !(nonceBytes instanceof Uint8Array) ||
    nonceBytes.byteLength !== NONCE_BYTES
  ) {
    configurationError()
  }

  const claims: PublicationCanaryClaims = {
    schemaVersion: 1,
    purpose: TOKEN_PURPOSE,
    keyId: KEY_ID,
    runId: input.runId,
    nonce: encodeBase64Url(nonceBytes),
    advocateId: input.advocateId,
    domainId: input.domainId,
    hostname: input.hostname,
    advocateVersion: input.advocateVersion,
    deploymentId: input.deploymentId,
    revision: input.revision,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
  }
  if (
    !validUuid(claims.runId) ||
    !validUuid(claims.advocateId) ||
    !validUuid(claims.domainId) ||
    !validHostname(claims.hostname) ||
    !validAdvocateVersion(claims.advocateVersion) ||
    !validDeploymentId(claims.deploymentId) ||
    !validRevision(claims.revision)
  ) {
    configurationError()
  }

  const payload = encodeBase64Url(Buffer.from(serializeClaims(claims), "utf8"))
  const mac = encodeBase64Url(tokenMac(payload, decodeSecret(environment)))
  return `${TOKEN_VERSION}.${payload}.${mac}`
}

export function verifyPublicationCanaryToken(
  token: string | null | undefined,
  options: {
    environment?: PublicationCanaryEnvironment
    now?: () => number
  } = {},
): PublicationCanaryClaims | null {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    Buffer.byteLength(token, "utf8") > MAXIMUM_TOKEN_BYTES
  ) {
    return null
  }
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null

  try {
    const payload = decodeCanonicalBase64Url(parts[1])
    const suppliedMac = decodeCanonicalBase64Url(parts[2], SIGNATURE_BYTES)
    if (payload === null || suppliedMac === null) return null

    const expectedMac = tokenMac(
      parts[1],
      decodeSecret(options.environment ?? process.env),
    )
    if (!timingSafeEqual(expectedMac, suppliedMac)) return null

    const nowMilliseconds = (options.now ?? Date.now)()
    if (!Number.isFinite(nowMilliseconds)) return null
    return parseClaims(payload, nowMilliseconds)
  } catch {
    return null
  }
}

export function verifyPublicationCanaryResponse(
  rawBody: string,
  expectedClaims: PublicationCanaryClaims,
  environment: PublicationCanaryEnvironment = process.env,
): PublicationCanaryResponseBody | null {
  if (
    typeof rawBody !== "string" ||
    Buffer.byteLength(rawBody, "utf8") > 4_096
  ) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "purpose",
      "keyId",
      "runId",
      "nonce",
      "advocateId",
      "domainId",
      "hostname",
      "advocateVersion",
      "deploymentId",
      "revision",
      "verifiedAt",
      "responseMac",
    ]) ||
    value.schemaVersion !== 1 ||
    value.purpose !== RESPONSE_PURPOSE ||
    value.keyId !== KEY_ID ||
    value.keyId !== expectedClaims.keyId ||
    value.runId !== expectedClaims.runId ||
    value.nonce !== expectedClaims.nonce ||
    value.advocateId !== expectedClaims.advocateId ||
    value.domainId !== expectedClaims.domainId ||
    value.hostname !== expectedClaims.hostname ||
    value.advocateVersion !== expectedClaims.advocateVersion ||
    value.deploymentId !== expectedClaims.deploymentId ||
    value.revision !== expectedClaims.revision ||
    typeof value.verifiedAt !== "string" ||
    !RFC3339_MILLISECOND_PATTERN.test(value.verifiedAt) ||
    !Number.isFinite(Date.parse(value.verifiedAt)) ||
    typeof value.responseMac !== "string"
  ) {
    return null
  }

  const verifiedAtMilliseconds = Date.parse(value.verifiedAt)
  if (
    verifiedAtMilliseconds <
      (expectedClaims.issuedAt - MAXIMUM_CLOCK_SKEW_SECONDS) * 1_000 ||
    verifiedAtMilliseconds >= expectedClaims.expiresAt * 1_000
  ) {
    return null
  }

  try {
    const unsigned = responseUnsignedBody(expectedClaims, value.verifiedAt)
    const expectedMac = responseMac(unsigned, decodeSecret(environment))
    const suppliedMac = decodeCanonicalBase64Url(
      value.responseMac,
      SIGNATURE_BYTES,
    )
    if (
      suppliedMac === null ||
      !timingSafeEqual(Buffer.from(expectedMac, "base64url"), suppliedMac)
    ) {
      return null
    }
    const canonicalBody = serializeResponse(unsigned, expectedMac)
    return canonicalBody === rawBody
      ? (value as unknown as PublicationCanaryResponseBody)
      : null
  } catch {
    return null
  }
}

export async function handlePublicationCanaryRequest(
  request: Pick<Request, "headers" | "method" | "url">,
  dependencies: PublicationCanaryRequestDependencies,
): Promise<Response> {
  try {
    const url = new URL(request.url)
    if (
      request.method !== "POST" ||
      url.pathname !== ADVOCATE_PUBLICATION_CANARY_PATH ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return genericNotFound()
    }

    const environment = dependencies.environment ?? process.env
    const now = dependencies.now ?? Date.now
    const nowMilliseconds = now()
    const claims = verifyPublicationCanaryToken(
      bearerToken(request.headers.get("authorization")),
      { environment, now: () => nowMilliseconds },
    )
    if (claims === null) return genericNotFound()

    const rawHost = request.headers.get("host")
    if (
      rawHost !== claims.hostname ||
      environment.VERCEL_DEPLOYMENT_ID !== claims.deploymentId ||
      environment.VERCEL_GIT_COMMIT_SHA !== claims.revision
    ) {
      return genericNotFound()
    }

    const target = await dependencies.loadTarget({
      advocateId: claims.advocateId,
      domainId: claims.domainId,
      hostname: claims.hostname,
      advocateVersion: claims.advocateVersion,
    })
    if (target === null || !sameTarget(target, claims)) {
      return genericNotFound()
    }

    const verifiedAt = new Date(nowMilliseconds).toISOString()
    const unsignedBody = responseUnsignedBody(claims, verifiedAt)
    const mac = responseMac(unsignedBody, decodeSecret(environment))
    return new Response(serializeResponse(unsignedBody, mac), {
      status: 200,
      headers: SUCCESS_RESPONSE_HEADERS,
    })
  } catch {
    return genericNotFound()
  }
}
