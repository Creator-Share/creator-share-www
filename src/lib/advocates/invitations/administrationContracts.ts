import {
  ADVOCATE_DELEGATE_ROLE_KEYS,
  type AdvocateDelegateRoleKey,
} from "@/lib/advocates/admin/teamContracts"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAXIMUM_INVITATION_MUTATION_BODY_BYTES = 8_192
const ROLE_KEY_SET = new Set<string>(ADVOCATE_DELEGATE_ROLE_KEYS)

const PENDING_INVITATION_ROW_KEYS = Object.freeze([
  "created_at",
  "created_by_current_user",
  "expires_at",
  "invitation_id",
  "invitation_status",
  "invited_email",
  "role_keys",
] as const)
const PENDING_INVITATION_API_KEYS = Object.freeze([
  "createdAt",
  "createdByCurrentUser",
  "expiresAt",
  "invitationId",
  "invitedEmail",
  "roleKeys",
  "status",
] as const)

export type AdvocateInvitationStatus = "pending" | "expired"

export interface AdvocatePendingInvitation {
  invitationId: string
  invitedEmail: string
  roleKeys: readonly AdvocateDelegateRoleKey[]
  status: AdvocateInvitationStatus
  expiresAt: string
  createdAt: string
  createdByCurrentUser: boolean
}

export interface AdvocateInvitationIssueInput {
  email: string
  roleKeys: readonly AdvocateDelegateRoleKey[]
  reason: string
  idempotencyKey: string
}

export interface AdvocateInvitationRevokeInput {
  reason: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  const expectedKeys = [...expected].sort()
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  )
}

function parseTimestamp(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 64 &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : null
}

function parseRoleKeys(
  value: unknown,
): readonly AdvocateDelegateRoleKey[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    return null
  }

  const roles: AdvocateDelegateRoleKey[] = []
  let previous: string | null = null
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      !ROLE_KEY_SET.has(candidate) ||
      (previous !== null && candidate <= previous)
    ) {
      return null
    }
    previous = candidate
    roles.push(candidate as AdvocateDelegateRoleKey)
  }
  return Object.freeze(roles)
}

function parseReason(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 2_000 &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
    ? value
    : null
}

function parseInputEmail(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 320 &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    EMAIL_PATTERN.test(value)
    ? value
    : null
}

function parseProjectedEmail(value: unknown): string | null {
  const email = parseInputEmail(value)
  return email !== null && email === email.toLowerCase() ? email : null
}

export function isAdvocateInvitationId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

export function parseAdvocatePendingInvitation(
  value: unknown,
): AdvocatePendingInvitation | null {
  if (!isRecord(value) || !hasExactKeys(value, PENDING_INVITATION_ROW_KEYS)) {
    return null
  }

  const invitationId = value.invitation_id
  const invitedEmail = parseProjectedEmail(value.invited_email)
  const roleKeys = parseRoleKeys(value.role_keys)
  const status = value.invitation_status
  const expiresAt = parseTimestamp(value.expires_at)
  const createdAt = parseTimestamp(value.created_at)
  const createdByCurrentUser = value.created_by_current_user
  if (
    !isAdvocateInvitationId(invitationId) ||
    invitedEmail === null ||
    roleKeys === null ||
    (status !== "pending" && status !== "expired") ||
    expiresAt === null ||
    createdAt === null ||
    Date.parse(expiresAt) <= Date.parse(createdAt) ||
    typeof createdByCurrentUser !== "boolean"
  ) {
    return null
  }

  return Object.freeze({
    invitationId,
    invitedEmail,
    roleKeys,
    status,
    expiresAt,
    createdAt,
    createdByCurrentUser,
  })
}

export function parseAdvocatePendingInvitationApi(
  value: unknown,
): AdvocatePendingInvitation | null {
  if (!isRecord(value) || !hasExactKeys(value, PENDING_INVITATION_API_KEYS)) {
    return null
  }

  const invitationId = value.invitationId
  const invitedEmail = parseProjectedEmail(value.invitedEmail)
  const roleKeys = parseRoleKeys(value.roleKeys)
  const status = value.status
  const expiresAt = parseTimestamp(value.expiresAt)
  const createdAt = parseTimestamp(value.createdAt)
  const createdByCurrentUser = value.createdByCurrentUser
  if (
    !isAdvocateInvitationId(invitationId) ||
    invitedEmail === null ||
    roleKeys === null ||
    (status !== "pending" && status !== "expired") ||
    expiresAt === null ||
    createdAt === null ||
    Date.parse(expiresAt) <= Date.parse(createdAt) ||
    typeof createdByCurrentUser !== "boolean"
  ) {
    return null
  }

  return Object.freeze({
    invitationId,
    invitedEmail,
    roleKeys,
    status,
    expiresAt,
    createdAt,
    createdByCurrentUser,
  })
}

export function parseAdvocatePendingInvitations(
  value: unknown,
): readonly AdvocatePendingInvitation[] | null {
  if (!Array.isArray(value) || value.length > 1_000) return null

  const invitations: AdvocatePendingInvitation[] = []
  const invitationIds = new Set<string>()
  let previous: AdvocatePendingInvitation | null = null
  for (const row of value) {
    const invitation = parseAdvocatePendingInvitation(row)
    if (
      invitation === null ||
      invitationIds.has(invitation.invitationId) ||
      (previous !== null &&
        (Date.parse(invitation.createdAt) > Date.parse(previous.createdAt) ||
          (invitation.createdAt === previous.createdAt &&
            invitation.invitationId <= previous.invitationId)))
    ) {
      return null
    }
    invitationIds.add(invitation.invitationId)
    invitations.push(invitation)
    previous = invitation
  }
  return Object.freeze(invitations)
}

export function parseAdvocateInvitationIssueInput(
  rawBody: string,
): AdvocateInvitationIssueInput | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAXIMUM_INVITATION_MUTATION_BODY_BYTES
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
    !hasExactKeys(value, ["email", "idempotencyKey", "reason", "roleKeys"])
  ) {
    return null
  }

  const email = parseInputEmail(value.email)
  const rawRoleKeys = value.roleKeys
  const roleKeys = Array.isArray(rawRoleKeys)
    ? parseRoleKeys([...rawRoleKeys].sort())
    : null
  const reason = parseReason(value.reason)
  const idempotencyKey = value.idempotencyKey
  if (
    email === null ||
    roleKeys === null ||
    reason === null ||
    typeof idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey) ||
    !Array.isArray(rawRoleKeys) ||
    new Set(rawRoleKeys).size !== rawRoleKeys.length
  ) {
    return null
  }

  return Object.freeze({ email, roleKeys, reason, idempotencyKey })
}

export function parseAdvocateInvitationRevokeInput(
  rawBody: string,
): AdvocateInvitationRevokeInput | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAXIMUM_INVITATION_MUTATION_BODY_BYTES
  ) {
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (!isRecord(value) || !hasExactKeys(value, ["reason"])) return null

  const reason = parseReason(value.reason)
  return reason === null ? null : Object.freeze({ reason })
}

export async function readBoundedAdvocateInvitationBody(
  request: Request,
): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d{1,10}$/.test(contentLength) ||
      Number(contentLength) > MAXIMUM_INVITATION_MUTATION_BODY_BYTES)
  ) {
    return null
  }
  if (request.body === null) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAXIMUM_INVITATION_MUTATION_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    )
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}
