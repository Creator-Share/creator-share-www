const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OPERATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const ADVOCATE_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const EMAIL_WHITESPACE_PATTERN = /\s/u

export const MAX_CREATOR_SHARE_ADVOCATE_ONBOARDING_BODY_BYTES = 8_192

export const CREATOR_SHARE_ADVOCATE_ONBOARDING_STATUSES = Object.freeze([
  "initial_owner_invitation_queued",
] as const)

export type CreatorShareAdvocateOnboardingStatus =
  (typeof CREATOR_SHARE_ADVOCATE_ONBOARDING_STATUSES)[number]

export const CREATOR_SHARE_ADVOCATE_ONBOARDING_FAILURE_CODES = Object.freeze([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "onboarding_conflict",
  "onboarding_unavailable",
] as const)

export type CreatorShareAdvocateOnboardingFailureCode =
  (typeof CREATOR_SHARE_ADVOCATE_ONBOARDING_FAILURE_CODES)[number]

export interface CreatorShareAdvocateOnboardingRequest {
  slug: string
  displayName: string
  advocateType: string
  ownerEmail: string
  reason: string
  operationId: string
}

export type CreatorShareAdvocateOnboardingResponse =
  | Readonly<{
      ok: true
      operationId: string
      advocateId: string
      advocateVersion: number
      onboardingStatus: CreatorShareAdvocateOnboardingStatus
    }>
  | Readonly<{
      ok: false
      operationId: string | null
      code: CreatorShareAdvocateOnboardingFailureCode
    }>

const ONBOARDING_STATUS_SET = new Set<string>(
  CREATOR_SHARE_ADVOCATE_ONBOARDING_STATUSES,
)
const ONBOARDING_FAILURE_CODE_SET = new Set<string>(
  CREATOR_SHARE_ADVOCATE_ONBOARDING_FAILURE_CODES,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function parseJsonRecord(rawBody: string): Record<string, unknown> | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAX_CREATOR_SHARE_ADVOCATE_ONBOARDING_BODY_BYTES
  ) {
    return null
  }
  try {
    const value: unknown = JSON.parse(rawBody)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function isBoundedTrimmedText(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  )
}

function isPlausibleEmail(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 254 ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    EMAIL_WHITESPACE_PATTERN.test(value)
  ) {
    return false
  }
  const separator = value.indexOf("@")
  if (
    separator <= 0 ||
    separator !== value.lastIndexOf("@") ||
    separator >= value.length - 1
  ) {
    return false
  }
  const domain = value.slice(separator + 1)
  return (
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !domain.includes("..")
  )
}

export async function readBoundedCreatorShareAdvocateOnboardingBody(
  request: Request,
): Promise<string | null> {
  const declaredLength = request.headers.get("content-length")
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_CREATOR_SHARE_ADVOCATE_ONBOARDING_BODY_BYTES)
  ) {
    return null
  }

  if (request.body === null) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_CREATOR_SHARE_ADVOCATE_ONBOARDING_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    return null
  }
}

export function parseCreatorShareAdvocateOnboardingRequest(
  rawBody: string,
): CreatorShareAdvocateOnboardingRequest | null {
  const value = parseJsonRecord(rawBody)
  if (
    value === null ||
    !hasExactKeys(value, [
      "advocateType",
      "displayName",
      "operationId",
      "ownerEmail",
      "reason",
      "slug",
    ])
  ) {
    return null
  }

  if (
    typeof value.slug !== "string" ||
    !SLUG_PATTERN.test(value.slug) ||
    !isBoundedTrimmedText(value.displayName, 160) ||
    typeof value.advocateType !== "string" ||
    !ADVOCATE_TYPE_PATTERN.test(value.advocateType) ||
    !isPlausibleEmail(value.ownerEmail) ||
    !isBoundedTrimmedText(value.reason, 2_000) ||
    typeof value.operationId !== "string" ||
    !OPERATION_UUID_PATTERN.test(value.operationId)
  ) {
    return null
  }

  return Object.freeze({
    slug: value.slug,
    displayName: value.displayName,
    advocateType: value.advocateType,
    ownerEmail: value.ownerEmail,
    reason: value.reason,
    operationId: value.operationId,
  })
}

export function parseCreatorShareAdvocateOnboardingResponse(
  value: unknown,
  expectedOperationId: string,
): CreatorShareAdvocateOnboardingResponse | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null

  if (value.ok) {
    if (
      !hasExactKeys(value, [
        "advocateId",
        "advocateVersion",
        "ok",
        "onboardingStatus",
        "operationId",
      ]) ||
      value.operationId !== expectedOperationId ||
      typeof value.advocateId !== "string" ||
      !UUID_PATTERN.test(value.advocateId) ||
      typeof value.advocateVersion !== "number" ||
      !Number.isSafeInteger(value.advocateVersion) ||
      value.advocateVersion < 1 ||
      typeof value.onboardingStatus !== "string" ||
      !ONBOARDING_STATUS_SET.has(value.onboardingStatus)
    ) {
      return null
    }
    return Object.freeze({
      ok: true,
      operationId: value.operationId,
      advocateId: value.advocateId,
      advocateVersion: value.advocateVersion,
      onboardingStatus:
        value.onboardingStatus as CreatorShareAdvocateOnboardingStatus,
    })
  }

  if (
    !hasExactKeys(value, ["code", "ok", "operationId"]) ||
    (value.operationId !== null && value.operationId !== expectedOperationId) ||
    typeof value.code !== "string" ||
    !ONBOARDING_FAILURE_CODE_SET.has(value.code)
  ) {
    return null
  }
  return Object.freeze({
    ok: false,
    operationId: value.operationId,
    code: value.code as CreatorShareAdvocateOnboardingFailureCode,
  })
}
