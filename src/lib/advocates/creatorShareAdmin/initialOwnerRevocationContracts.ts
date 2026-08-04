const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OPERATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export const MAX_CREATOR_SHARE_INITIAL_OWNER_REVOCATION_BODY_BYTES = 8_192

export const CREATOR_SHARE_INITIAL_OWNER_REVOCATION_FAILURE_CODES =
  Object.freeze([
    "invalid_request",
    "unauthorized",
    "forbidden",
    "portal_not_found",
    "initial_owner_revocation_conflict",
    "initial_owner_revocation_unavailable",
  ] as const)

export type CreatorShareInitialOwnerRevocationFailureCode =
  (typeof CREATOR_SHARE_INITIAL_OWNER_REVOCATION_FAILURE_CODES)[number]

export interface CreatorShareInitialOwnerRevocationRequest {
  expectedVersion: number
  reason: string
  operationId: string
  confirmation: "REVOKE_INITIAL_OWNER"
}

export type CreatorShareInitialOwnerRevocationResponse =
  | Readonly<{
      ok: true
      operationId: string
      advocateId: string
      advocateVersion: number
      revocationStatus: "initial_owner_invitation_revoked"
    }>
  | Readonly<{
      ok: false
      operationId: string | null
      code: CreatorShareInitialOwnerRevocationFailureCode
    }>

const FAILURE_CODE_SET = new Set<string>(
  CREATOR_SHARE_INITIAL_OWNER_REVOCATION_FAILURE_CODES,
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
      MAX_CREATOR_SHARE_INITIAL_OWNER_REVOCATION_BODY_BYTES
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

export async function readBoundedCreatorShareInitialOwnerRevocationBody(
  request: Request,
): Promise<string | null> {
  const declaredLength = request.headers.get("content-length")
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) >
        MAX_CREATOR_SHARE_INITIAL_OWNER_REVOCATION_BODY_BYTES)
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
      if (totalBytes > MAX_CREATOR_SHARE_INITIAL_OWNER_REVOCATION_BODY_BYTES) {
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

export function parseCreatorShareInitialOwnerRevocationRequest(
  rawBody: string,
): CreatorShareInitialOwnerRevocationRequest | null {
  const value = parseJsonRecord(rawBody)
  if (
    value === null ||
    !hasExactKeys(value, [
      "confirmation",
      "expectedVersion",
      "operationId",
      "reason",
    ])
  ) {
    return null
  }

  if (
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1 ||
    typeof value.reason !== "string" ||
    value.reason.length < 1 ||
    value.reason.length > 2_000 ||
    value.reason !== value.reason.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value.reason) ||
    typeof value.operationId !== "string" ||
    !OPERATION_UUID_PATTERN.test(value.operationId) ||
    value.confirmation !== "REVOKE_INITIAL_OWNER"
  ) {
    return null
  }

  return Object.freeze({
    expectedVersion: value.expectedVersion,
    reason: value.reason,
    operationId: value.operationId,
    confirmation: "REVOKE_INITIAL_OWNER" as const,
  })
}

export function parseCreatorShareInitialOwnerRevocationResponse(
  value: unknown,
  expected: Readonly<{
    operationId: string
    advocateId: string
    expectedVersion: number
  }>,
): CreatorShareInitialOwnerRevocationResponse | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null
  if (value.ok) {
    if (
      !hasExactKeys(value, [
        "advocateId",
        "advocateVersion",
        "ok",
        "operationId",
        "revocationStatus",
      ]) ||
      value.operationId !== expected.operationId ||
      value.advocateId !== expected.advocateId ||
      !UUID_PATTERN.test(expected.advocateId) ||
      value.advocateVersion !== expected.expectedVersion + 1 ||
      value.revocationStatus !== "initial_owner_invitation_revoked"
    ) {
      return null
    }
    return Object.freeze({
      ok: true,
      operationId: expected.operationId,
      advocateId: expected.advocateId,
      advocateVersion: value.advocateVersion,
      revocationStatus: "initial_owner_invitation_revoked" as const,
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
    code: value.code as CreatorShareInitialOwnerRevocationFailureCode,
  })
}
