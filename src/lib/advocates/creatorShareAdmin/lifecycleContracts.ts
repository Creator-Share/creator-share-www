const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OPERATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UNSAFE_REASON_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0009\u000b-\u001f\u007f]/

export const MAX_CREATOR_SHARE_ADVOCATE_CONTROL_BODY_BYTES = 8_192

export const CREATOR_SHARE_ADVOCATE_LIFECYCLE_ACTIONS = Object.freeze([
  "suspend",
  "resume",
  "archive",
  "repair",
] as const)

export type CreatorShareAdvocateLifecycleAction =
  (typeof CREATOR_SHARE_ADVOCATE_LIFECYCLE_ACTIONS)[number]

export type CreatorShareAdvocateRelationshipStatus =
  | "invited"
  | "active"
  | "suspended"
  | "archived"

export type CreatorShareAdvocatePublicationStatus =
  | "draft"
  | "provisioning"
  | "active"
  | "failed"
  | "suspended"

export type CreatorShareAdvocateMembershipStatus =
  | "active"
  | "suspended"
  | "revoked"

export interface CreatorShareAdvocateLifecycleRequest {
  action: CreatorShareAdvocateLifecycleAction
  expectedVersion: number
  reason: string
  operationId: string
  confirmation: "ARCHIVE" | null
}

export interface CreatorShareAdvocateOwnershipTransferRequest {
  expectedOwnerMembershipId: string
  targetOwnerMembershipId: string
  reason: string
  operationId: string
  confirmation: "TRANSFER"
}

export interface CreatorShareAdvocateCleanupRecoveryRequest {
  expectedVersion: number
  reason: string
  operationId: string
  confirmation: "RETRY_CLEANUP"
}

export type CreatorShareAdvocateLifecycleResponse =
  | Readonly<{
      ok: true
      operationId: string
      advocateVersion: number
      relationshipStatus: CreatorShareAdvocateRelationshipStatus
      publicationStatus: CreatorShareAdvocatePublicationStatus
      domainCleanupRequested: boolean
    }>
  | Readonly<{
      ok: false
      operationId: string | null
      code: string
    }>

export type CreatorShareAdvocateOwnershipTransferResponse =
  | Readonly<{ ok: true; operationId: string }>
  | Readonly<{ ok: false; operationId: string | null; code: string }>

export type CreatorShareAdvocateCleanupRecoveryResponse =
  | Readonly<{
      ok: true
      operationId: string
      advocateVersion: number
      cleanupPhase: Exclude<
        CreatorShareAdvocateCleanupPhase,
        "not_requested" | "quiescing" | "complete" | "needs_attention"
      >
      cleanupRetryRequested: true
    }>
  | Readonly<{
      ok: false
      operationId: string | null
      code: string
    }>

export type CreatorShareAdvocateCleanupPhase =
  | "not_requested"
  | "quiescing"
  | "cloudflare_dns_removal"
  | "vercel_removal"
  | "stripe_us_removal"
  | "stripe_uk_removal"
  | "paypal_removal"
  | "complete"
  | "needs_attention"

const LIFECYCLE_ACTION_SET = new Set<string>(
  CREATOR_SHARE_ADVOCATE_LIFECYCLE_ACTIONS,
)
const RELATIONSHIP_STATUS_SET = new Set<string>([
  "invited",
  "active",
  "suspended",
  "archived",
])
const PUBLICATION_STATUS_SET = new Set<string>([
  "draft",
  "provisioning",
  "active",
  "failed",
  "suspended",
])
const ACTIVE_CLEANUP_PHASE_SET = new Set<string>([
  "cloudflare_dns_removal",
  "vercel_removal",
  "stripe_us_removal",
  "stripe_uk_removal",
  "paypal_removal",
])

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

function isOperationUuid(value: unknown): value is string {
  return typeof value === "string" && OPERATION_UUID_PATTERN.test(value)
}

function parsePositiveVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null
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

function parseJsonRecord(rawBody: string): Record<string, unknown> | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAX_CREATOR_SHARE_ADVOCATE_CONTROL_BODY_BYTES
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

export async function readBoundedCreatorShareAdvocateControlBody(
  request: Request,
): Promise<string | null> {
  const declaredLength = request.headers.get("content-length")
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_CREATOR_SHARE_ADVOCATE_CONTROL_BODY_BYTES)
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
      if (totalBytes > MAX_CREATOR_SHARE_ADVOCATE_CONTROL_BODY_BYTES) {
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

export function parseCreatorShareAdvocateLifecycleRequest(
  rawBody: string,
): CreatorShareAdvocateLifecycleRequest | null {
  const value = parseJsonRecord(rawBody)
  if (
    value === null ||
    !hasExactKeys(value, [
      "action",
      "confirmation",
      "expectedVersion",
      "operationId",
      "reason",
    ])
  ) {
    return null
  }

  const action = value.action
  const expectedVersion = parsePositiveVersion(value.expectedVersion)
  const reason = parseReason(value.reason)
  const operationId = value.operationId
  if (
    typeof action !== "string" ||
    !LIFECYCLE_ACTION_SET.has(action) ||
    expectedVersion === null ||
    reason === null ||
    !isOperationUuid(operationId) ||
    (action === "archive"
      ? value.confirmation !== "ARCHIVE"
      : value.confirmation !== null)
  ) {
    return null
  }

  return Object.freeze({
    action: action as CreatorShareAdvocateLifecycleAction,
    expectedVersion,
    reason,
    operationId,
    confirmation: action === "archive" ? "ARCHIVE" : null,
  })
}

export function parseCreatorShareAdvocateOwnershipTransferRequest(
  rawBody: string,
): CreatorShareAdvocateOwnershipTransferRequest | null {
  const value = parseJsonRecord(rawBody)
  if (
    value === null ||
    !hasExactKeys(value, [
      "confirmation",
      "expectedOwnerMembershipId",
      "operationId",
      "reason",
      "targetOwnerMembershipId",
    ])
  ) {
    return null
  }

  const expectedOwnerMembershipId = value.expectedOwnerMembershipId
  const targetOwnerMembershipId = value.targetOwnerMembershipId
  const operationId = value.operationId
  const reason = parseReason(value.reason)
  if (
    typeof expectedOwnerMembershipId !== "string" ||
    !UUID_PATTERN.test(expectedOwnerMembershipId) ||
    typeof targetOwnerMembershipId !== "string" ||
    !UUID_PATTERN.test(targetOwnerMembershipId) ||
    targetOwnerMembershipId === expectedOwnerMembershipId ||
    !isOperationUuid(operationId) ||
    reason === null ||
    value.confirmation !== "TRANSFER"
  ) {
    return null
  }

  return Object.freeze({
    expectedOwnerMembershipId,
    targetOwnerMembershipId,
    reason,
    operationId,
    confirmation: "TRANSFER" as const,
  })
}

export function parseCreatorShareAdvocateCleanupRecoveryRequest(
  rawBody: string,
): CreatorShareAdvocateCleanupRecoveryRequest | null {
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

  const expectedVersion = parsePositiveVersion(value.expectedVersion)
  const reason = parseReason(value.reason)
  const operationId = value.operationId
  if (
    expectedVersion === null ||
    reason === null ||
    !isOperationUuid(operationId) ||
    value.confirmation !== "RETRY_CLEANUP"
  ) {
    return null
  }

  return Object.freeze({
    expectedVersion,
    reason,
    operationId,
    confirmation: "RETRY_CLEANUP" as const,
  })
}

function lifecycleResultMatchesAction(
  action: CreatorShareAdvocateLifecycleAction,
  value: Readonly<{
    relationshipStatus: string
    publicationStatus: string
    domainCleanupRequested: boolean
  }>,
): boolean {
  switch (action) {
    case "suspend":
      return (
        value.relationshipStatus === "suspended" &&
        value.publicationStatus === "suspended" &&
        !value.domainCleanupRequested
      )
    case "resume":
      return (
        value.relationshipStatus === "active" &&
        (value.publicationStatus === "draft" ||
          value.publicationStatus === "provisioning") &&
        !value.domainCleanupRequested
      )
    case "archive":
      return (
        value.relationshipStatus === "archived" &&
        value.publicationStatus === "suspended"
      )
    case "repair":
      return (
        value.relationshipStatus === "active" &&
        value.publicationStatus === "provisioning" &&
        !value.domainCleanupRequested
      )
  }
}

export function parseCreatorShareAdvocateLifecycleResponse(
  value: unknown,
  expected: Readonly<{
    operationId: string
    expectedVersion: number
    action: CreatorShareAdvocateLifecycleAction
  }>,
): CreatorShareAdvocateLifecycleResponse | null {
  if (!isRecord(value)) return null

  if (
    value.ok === true &&
    hasExactKeys(value, [
      "advocateVersion",
      "domainCleanupRequested",
      "ok",
      "operationId",
      "publicationStatus",
      "relationshipStatus",
    ]) &&
    value.operationId === expected.operationId &&
    parsePositiveVersion(value.advocateVersion) ===
      expected.expectedVersion + 1 &&
    typeof value.relationshipStatus === "string" &&
    RELATIONSHIP_STATUS_SET.has(value.relationshipStatus) &&
    typeof value.publicationStatus === "string" &&
    PUBLICATION_STATUS_SET.has(value.publicationStatus) &&
    typeof value.domainCleanupRequested === "boolean" &&
    lifecycleResultMatchesAction(expected.action, {
      relationshipStatus: value.relationshipStatus,
      publicationStatus: value.publicationStatus,
      domainCleanupRequested: value.domainCleanupRequested,
    })
  ) {
    return Object.freeze({
      ok: true,
      operationId: expected.operationId,
      advocateVersion: value.advocateVersion as number,
      relationshipStatus:
        value.relationshipStatus as CreatorShareAdvocateRelationshipStatus,
      publicationStatus:
        value.publicationStatus as CreatorShareAdvocatePublicationStatus,
      domainCleanupRequested: value.domainCleanupRequested,
    })
  }

  if (
    value.ok === false &&
    hasExactKeys(value, ["code", "ok", "operationId"]) &&
    (value.operationId === null ||
      value.operationId === expected.operationId) &&
    typeof value.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(value.code)
  ) {
    return Object.freeze({
      ok: false,
      operationId: value.operationId,
      code: value.code,
    })
  }

  return null
}

export function parseCreatorShareAdvocateOwnershipTransferResponse(
  value: unknown,
  operationId: string,
): CreatorShareAdvocateOwnershipTransferResponse | null {
  if (!isRecord(value)) return null
  if (
    value.ok === true &&
    hasExactKeys(value, ["ok", "operationId"]) &&
    value.operationId === operationId
  ) {
    return Object.freeze({ ok: true, operationId })
  }
  if (
    value.ok === false &&
    hasExactKeys(value, ["code", "ok", "operationId"]) &&
    (value.operationId === null || value.operationId === operationId) &&
    typeof value.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(value.code)
  ) {
    return Object.freeze({
      ok: false,
      operationId: value.operationId,
      code: value.code,
    })
  }
  return null
}

export function parseCreatorShareAdvocateCleanupRecoveryResponse(
  value: unknown,
  expected: Readonly<{ operationId: string; expectedVersion: number }>,
): CreatorShareAdvocateCleanupRecoveryResponse | null {
  if (!isRecord(value)) return null
  if (
    value.ok === true &&
    hasExactKeys(value, [
      "advocateVersion",
      "cleanupPhase",
      "cleanupRetryRequested",
      "ok",
      "operationId",
    ]) &&
    value.operationId === expected.operationId &&
    parsePositiveVersion(value.advocateVersion) ===
      expected.expectedVersion + 1 &&
    typeof value.cleanupPhase === "string" &&
    ACTIVE_CLEANUP_PHASE_SET.has(value.cleanupPhase) &&
    value.cleanupRetryRequested === true
  ) {
    return Object.freeze({
      ok: true,
      operationId: expected.operationId,
      advocateVersion: value.advocateVersion as number,
      cleanupPhase: value.cleanupPhase as Extract<
        CreatorShareAdvocateCleanupPhase,
        | "cloudflare_dns_removal"
        | "vercel_removal"
        | "stripe_us_removal"
        | "stripe_uk_removal"
        | "paypal_removal"
      >,
      cleanupRetryRequested: true,
    })
  }
  if (
    value.ok === false &&
    hasExactKeys(value, ["code", "ok", "operationId"]) &&
    (value.operationId === null ||
      value.operationId === expected.operationId) &&
    typeof value.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(value.code)
  ) {
    return Object.freeze({
      ok: false,
      operationId: value.operationId,
      code: value.code,
    })
  }
  return null
}
