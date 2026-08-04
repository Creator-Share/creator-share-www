const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OPERATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UNSAFE_REASON_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const EMAIL_WHITESPACE_PATTERN = /\s/u

export const MAX_CREATOR_SHARE_INITIAL_OWNER_REISSUE_BODY_BYTES = 8_192

export const CREATOR_SHARE_INITIAL_OWNER_REISSUE_FAILURE_CODES = Object.freeze([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "portal_not_found",
  "initial_owner_reissue_conflict",
  "initial_owner_reissue_unavailable",
] as const)

export type CreatorShareInitialOwnerReissueFailureCode =
  (typeof CREATOR_SHARE_INITIAL_OWNER_REISSUE_FAILURE_CODES)[number]

export interface CreatorShareInitialOwnerReissueRequest {
  expectedVersion: number
  ownerEmail: string
  reason: string
  operationId: string
  confirmation: "REISSUE_INITIAL_OWNER"
}

export type CreatorShareInitialOwnerReissueResponse =
  | Readonly<{
      ok: true
      operationId: string
      advocateId: string
      advocateVersion: number
      reissueStatus: "initial_owner_invitation_requeued"
    }>
  | Readonly<{
      ok: false
      operationId: string | null
      code: CreatorShareInitialOwnerReissueFailureCode
    }>

const FAILURE_CODE_SET = new Set<string>(
  CREATOR_SHARE_INITIAL_OWNER_REISSUE_FAILURE_CODES,
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
      MAX_CREATOR_SHARE_INITIAL_OWNER_REISSUE_BODY_BYTES
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

function parseReason(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 2_000 &&
    value === value.trim() &&
    !UNSAFE_REASON_CONTROL_CHARACTER_PATTERN.test(value)
    ? value
    : null
}

function parsePositiveVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null
}

function isPlausibleEmail(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 254 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
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

export async function readBoundedCreatorShareInitialOwnerReissueBody(
  request: Request,
): Promise<string | null> {
  const declaredLength = request.headers.get("content-length")
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) >
        MAX_CREATOR_SHARE_INITIAL_OWNER_REISSUE_BODY_BYTES)
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
      if (totalBytes > MAX_CREATOR_SHARE_INITIAL_OWNER_REISSUE_BODY_BYTES) {
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

export function parseCreatorShareInitialOwnerReissueRequest(
  rawBody: string,
): CreatorShareInitialOwnerReissueRequest | null {
  const value = parseJsonRecord(rawBody)
  if (
    value === null ||
    !hasExactKeys(value, [
      "confirmation",
      "expectedVersion",
      "operationId",
      "ownerEmail",
      "reason",
    ])
  ) {
    return null
  }

  const expectedVersion = parsePositiveVersion(value.expectedVersion)
  const reason = parseReason(value.reason)
  if (
    expectedVersion === null ||
    !isPlausibleEmail(value.ownerEmail) ||
    reason === null ||
    typeof value.operationId !== "string" ||
    !OPERATION_UUID_PATTERN.test(value.operationId) ||
    value.confirmation !== "REISSUE_INITIAL_OWNER"
  ) {
    return null
  }

  return Object.freeze({
    expectedVersion,
    ownerEmail: value.ownerEmail,
    reason,
    operationId: value.operationId,
    confirmation: "REISSUE_INITIAL_OWNER" as const,
  })
}

export function parseCreatorShareInitialOwnerReissueResponse(
  value: unknown,
  expected: Readonly<{
    operationId: string
    advocateId: string
    expectedVersion: number
  }>,
): CreatorShareInitialOwnerReissueResponse | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null

  if (value.ok) {
    if (
      !hasExactKeys(value, [
        "advocateId",
        "advocateVersion",
        "ok",
        "operationId",
        "reissueStatus",
      ]) ||
      value.operationId !== expected.operationId ||
      value.advocateId !== expected.advocateId ||
      !UUID_PATTERN.test(expected.advocateId) ||
      value.advocateVersion !== expected.expectedVersion + 1 ||
      value.reissueStatus !== "initial_owner_invitation_requeued"
    ) {
      return null
    }
    return Object.freeze({
      ok: true,
      operationId: expected.operationId,
      advocateId: expected.advocateId,
      advocateVersion: value.advocateVersion,
      reissueStatus: "initial_owner_invitation_requeued" as const,
    })
  }

  if (
    !hasExactKeys(value, ["code", "ok", "operationId"]) ||
    (value.operationId !== null &&
      value.operationId !== expected.operationId) ||
    typeof value.code !== "string" ||
    !FAILURE_CODE_SET.has(value.code)
  ) {
    return null
  }
  return Object.freeze({
    ok: false,
    operationId: value.operationId,
    code: value.code as CreatorShareInitialOwnerReissueFailureCode,
  })
}
