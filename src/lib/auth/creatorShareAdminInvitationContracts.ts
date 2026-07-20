import { normalizeSponsorEmailV1 } from "@/lib/sponsorships/crypto"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ZERO_UUID = "00000000-0000-0000-0000-000000000000"
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const MAXIMUM_ROLE_COUNT = 32

export const MAXIMUM_CREATOR_SHARE_ADMIN_INVITATION_BODY_BYTES = 8_192

export interface CreatorShareAdminInvitationRequest {
  email: string
  roleIds: readonly string[]
  reason: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  return (
    actual.length === canonical.length &&
    actual.every((key, index) => key === canonical[index])
  )
}

function isCanonicalUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== ZERO_UUID &&
    UUID_PATTERN.test(value)
  )
}

function parseReason(value: unknown): string | null | undefined {
  if (value === undefined) return null
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2_000 ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return undefined
  }
  return value
}

export async function readBoundedCreatorShareAdminInvitationBody(
  request: Request,
): Promise<string | null> {
  const declaredLength = request.headers.get("content-length")
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength) ||
      Number(declaredLength) >
        MAXIMUM_CREATOR_SHARE_ADMIN_INVITATION_BODY_BYTES)
  ) {
    return null
  }

  if (request.body === null) return ""
  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = request.body.getReader()
  } catch {
    return null
  }
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAXIMUM_CREATOR_SHARE_ADMIN_INVITATION_BODY_BYTES) {
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

export function parseCreatorShareAdminInvitationRequest(
  rawBody: string,
): CreatorShareAdminInvitationRequest | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAXIMUM_CREATOR_SHARE_ADMIN_INVITATION_BODY_BYTES
  ) {
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  const expectedKeys =
    "reason" in value
      ? ["email", "reason", "role_ids"]
      : ["email", "role_ids"]
  if (!hasExactKeys(value, expectedKeys)) return null

  let email: string
  try {
    email = normalizeSponsorEmailV1(value.email as string)
  } catch {
    return null
  }

  if (
    !Array.isArray(value.role_ids) ||
    value.role_ids.length < 1 ||
    value.role_ids.length > MAXIMUM_ROLE_COUNT ||
    !value.role_ids.every(isCanonicalUuid) ||
    new Set(value.role_ids).size !== value.role_ids.length
  ) {
    return null
  }
  const reason = parseReason(value.reason)
  if (reason === undefined) return null

  return Object.freeze({
    email,
    roleIds: Object.freeze([...value.role_ids]),
    reason,
  })
}
