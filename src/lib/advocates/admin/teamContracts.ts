const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const MAXIMUM_TEAM_MUTATION_BODY_BYTES = 8_192

export const ADVOCATE_DELEGATE_ROLE_KEYS = Object.freeze([
  "administrator",
  "analytics_viewer",
  "audit_viewer",
  "brand_editor",
  "catalog_curator",
] as const)

export type AdvocateDelegateRoleKey =
  (typeof ADVOCATE_DELEGATE_ROLE_KEYS)[number]
export type AdvocateMembershipStatus = "active" | "suspended" | "revoked"

const DELEGATE_ROLE_KEY_SET = new Set<string>(ADVOCATE_DELEGATE_ROLE_KEYS)
const MEMBERSHIP_STATUS_SET = new Set<string>([
  "active",
  "suspended",
  "revoked",
])
const TEAM_ROW_KEYS = Object.freeze([
  "is_owner",
  "member_display_name",
  "membership_created_at",
  "membership_id",
  "membership_status",
  "membership_updated_at",
  "membership_version",
  "role_keys",
] as const)

export interface AdvocateTeamMember {
  membershipId: string
  displayName: string
  status: AdvocateMembershipStatus
  roleKeys: readonly ("owner" | AdvocateDelegateRoleKey)[]
  version: number
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

export type AdvocateTeamMemberMutation =
  | Readonly<{
      action: "replace_roles"
      expectedVersion: number
      roleKeys: readonly AdvocateDelegateRoleKey[]
      reason: string
    }>
  | Readonly<{
      action: "change_status"
      expectedVersion: number
      status: AdvocateMembershipStatus
      reason: string
    }>

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

function parseVersion(value: unknown): number | null {
  const parsed =
    typeof value === "string" && /^[1-9]\d{0,15}$/.test(value)
      ? Number(value)
      : value
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed >= 1
    ? parsed
    : null
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
  isOwner: boolean,
): readonly ("owner" | AdvocateDelegateRoleKey)[] | null {
  if (
    !Array.isArray(value) ||
    value.length > 6 ||
    (isOwner && value.length < 1)
  ) {
    return null
  }

  const roles: ("owner" | AdvocateDelegateRoleKey)[] = []
  let previous: string | null = null
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      (candidate !== "owner" && !DELEGATE_ROLE_KEY_SET.has(candidate)) ||
      (previous !== null && candidate <= previous)
    ) {
      return null
    }
    previous = candidate
    roles.push(candidate as "owner" | AdvocateDelegateRoleKey)
  }

  return roles.includes("owner") === isOwner ? Object.freeze(roles) : null
}

export function parseAdvocateTeamMember(
  value: unknown,
): AdvocateTeamMember | null {
  if (!isRecord(value) || !hasExactKeys(value, TEAM_ROW_KEYS)) return null

  const membershipId = value.membership_id
  const displayName = value.member_display_name
  const status = value.membership_status
  const version = parseVersion(value.membership_version)
  const isOwner = value.is_owner
  const createdAt = parseTimestamp(value.membership_created_at)
  const updatedAt = parseTimestamp(value.membership_updated_at)
  if (
    typeof membershipId !== "string" ||
    !UUID_PATTERN.test(membershipId) ||
    typeof displayName !== "string" ||
    displayName.length < 1 ||
    displayName.length > 200 ||
    displayName !== displayName.trim() ||
    CONTROL_CHARACTER_PATTERN.test(displayName) ||
    typeof status !== "string" ||
    !MEMBERSHIP_STATUS_SET.has(status) ||
    typeof isOwner !== "boolean" ||
    version === null ||
    createdAt === null ||
    updatedAt === null ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    (isOwner && status !== "active")
  ) {
    return null
  }

  const roleKeys = parseRoleKeys(value.role_keys, isOwner)
  if (roleKeys === null) return null

  return Object.freeze({
    membershipId,
    displayName,
    status: status as AdvocateMembershipStatus,
    roleKeys,
    version,
    isOwner,
    createdAt,
    updatedAt,
  })
}

export function parseAdvocateTeam(
  value: unknown,
): readonly AdvocateTeamMember[] | null {
  if (!Array.isArray(value) || value.length > 1_000) return null

  const members: AdvocateTeamMember[] = []
  const membershipIds = new Set<string>()
  for (const row of value) {
    const member = parseAdvocateTeamMember(row)
    if (member === null || membershipIds.has(member.membershipId)) return null
    membershipIds.add(member.membershipId)
    members.push(member)
  }
  return Object.freeze(members)
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

function parseDelegateRoleInput(
  value: unknown,
): readonly AdvocateDelegateRoleKey[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return null

  const roles = value
    .map((candidate) =>
      typeof candidate === "string" && DELEGATE_ROLE_KEY_SET.has(candidate)
        ? (candidate as AdvocateDelegateRoleKey)
        : null,
    )
    .sort()
  if (
    roles.some((role) => role === null) ||
    new Set(roles).size !== roles.length
  ) {
    return null
  }
  return Object.freeze(roles as AdvocateDelegateRoleKey[])
}

export function parseAdvocateTeamMemberMutation(
  rawBody: string,
): AdvocateTeamMemberMutation | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAXIMUM_TEAM_MUTATION_BODY_BYTES
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

  const expectedVersion = parseVersion(value.expectedVersion)
  const reason = parseReason(value.reason)
  if (expectedVersion === null || reason === null) return null

  if (
    value.action === "replace_roles" &&
    hasExactKeys(value, ["action", "expectedVersion", "roleKeys", "reason"])
  ) {
    const roleKeys = parseDelegateRoleInput(value.roleKeys)
    return roleKeys === null
      ? null
      : Object.freeze({
          action: "replace_roles",
          expectedVersion,
          roleKeys,
          reason,
        })
  }

  if (
    value.action === "change_status" &&
    hasExactKeys(value, ["action", "expectedVersion", "status", "reason"]) &&
    typeof value.status === "string" &&
    MEMBERSHIP_STATUS_SET.has(value.status)
  ) {
    return Object.freeze({
      action: "change_status",
      expectedVersion,
      status: value.status as AdvocateMembershipStatus,
      reason,
    })
  }

  return null
}

export function isAdvocateMembershipId(value: string): boolean {
  return UUID_PATTERN.test(value)
}
