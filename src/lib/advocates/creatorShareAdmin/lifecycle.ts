import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  CreatorShareAdvocateCleanupPhase,
  CreatorShareAdvocateLifecycleAction,
  CreatorShareAdvocateMembershipStatus,
  CreatorShareAdvocatePublicationStatus,
  CreatorShareAdvocateRelationshipStatus,
} from "@/lib/advocates/creatorShareAdmin/lifecycleContracts"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SAFE_PERSON_LABEL_PATTERN =
  /^(?:Portal team member|[A-Za-z]+(?:[ '-][A-Za-z]+)*(?: [A-Z]\.)?)$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const PAGE_SIZE = 50
const OWNERSHIP_CANDIDATE_PAGE_SIZE = 200

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
const DOMAIN_STATUS_SET = new Set<string>([
  "pending",
  "provisioning",
  "verifying",
  "active",
  "failed",
  "redirecting",
  "disabled",
])
const MEMBERSHIP_STATUS_SET = new Set<string>([
  "active",
  "suspended",
  "revoked",
])
const CLEANUP_PHASE_SET = new Set<string>([
  "not_requested",
  "quiescing",
  "cloudflare_dns_removal",
  "vercel_removal",
  "stripe_us_removal",
  "stripe_uk_removal",
  "paypal_removal",
  "complete",
  "needs_attention",
])
const OWNERSHIP_STATUS_SET = new Set<string>([
  "awaiting_owner_acceptance",
  "owner_active",
  "owner_unassigned",
])

const LIST_ROW_KEYS = Object.freeze([
  "advocate_id",
  "advocate_version",
  "archived_at",
  "created_at",
  "display_name",
  "open_provider_jobs",
  "owner_display_name",
  "ownership_status",
  "can_reissue_initial_owner",
  "can_revoke_initial_owner",
  "pending_invitations",
  "primary_domain_status",
  "primary_hostname",
  "publication_status",
  "ready_required_integrations",
  "relationship_status",
  "required_integrations",
  "slug",
  "suspended_at",
  "updated_at",
] as const)

const SNAPSHOT_ROW_KEYS = Object.freeze([
  "advocate_id",
  "advocate_version",
  "archived_at",
  "can_archive",
  "can_begin_publication_canary",
  "can_repair",
  "can_resume",
  "can_retry_cleanup",
  "can_suspend",
  "cleanup_phase",
  "display_name",
  "open_deprovision_jobs",
  "open_provider_jobs",
  "owner_display_name",
  "ownership_status",
  "can_reissue_initial_owner",
  "can_revoke_initial_owner",
  "pending_invitations",
  "primary_domain_id",
  "primary_domain_status",
  "primary_hostname",
  "publication_status",
  "ready_required_integrations",
  "relationship_status",
  "required_integrations",
  "slug",
  "suspended_at",
  "updated_at",
] as const)

const OWNERSHIP_CANDIDATE_ROW_KEYS = Object.freeze([
  "display_name",
  "is_current_owner",
  "is_eligible",
  "membership_id",
  "membership_status",
] as const)

const LIFECYCLE_RESULT_ROW_KEYS = Object.freeze([
  "advocate_id",
  "advocate_version",
  "domain_cleanup_requested",
  "publication_status",
  "relationship_status",
] as const)

const CLEANUP_RECOVERY_RESULT_ROW_KEYS = Object.freeze([
  "advocate_id",
  "advocate_version",
  "cleanup_phase",
  "cleanup_retry_requested",
] as const)

export interface CreatorShareAdvocateControlSummary {
  advocateId: string
  slug: string
  displayName: string
  relationshipStatus: CreatorShareAdvocateRelationshipStatus
  publicationStatus: CreatorShareAdvocatePublicationStatus
  advocateVersion: number
  ownerDisplayName: string | null
  ownershipStatus:
    "awaiting_owner_acceptance" | "owner_active" | "owner_unassigned"
  canReissueInitialOwner: boolean
  canRevokeInitialOwner: boolean
  primaryHostname: string | null
  primaryDomainStatus: string | null
  readyRequiredIntegrations: number
  requiredIntegrations: number
  openProviderJobs: number
  pendingInvitations: number
  suspendedAt: string | null
  archivedAt: string | null
  updatedAt: string
  createdAt: string
}

export interface CreatorShareAdvocateControlSnapshot extends Omit<
  CreatorShareAdvocateControlSummary,
  "createdAt"
> {
  openDeprovisionJobs: number
  cleanupPhase: CreatorShareAdvocateCleanupPhase
  canRetryCleanup: boolean
  canBeginPublicationCanary: boolean
  canSuspend: boolean
  canResume: boolean
  canArchive: boolean
  canRepair: boolean
}

export interface CreatorShareAdvocateOwnershipCandidate {
  membershipId: string
  displayName: string
  status: CreatorShareAdvocateMembershipStatus
  isCurrentOwner: boolean
  isEligible: boolean
}

export interface CreatorShareAdvocateControlFilters {
  relationshipStatus: CreatorShareAdvocateRelationshipStatus | null
  publicationStatus: CreatorShareAdvocatePublicationStatus | null
  cursor: string | null
}

export interface CreatorShareAdvocateControlPage {
  advocates: readonly CreatorShareAdvocateControlSummary[]
  nextCursor: string | null
}

export interface CreatorShareAdvocateOwnershipCandidatePage {
  candidates: readonly CreatorShareAdvocateOwnershipCandidate[]
  hasMore: boolean
}

export interface CreatorShareAdvocateOwnershipTransferOptions {
  currentOwnerMembershipId: string | null
  candidates: readonly Readonly<{
    membershipId: string
    displayName: string
  }>[]
  candidateListMayBeIncomplete: boolean
}

/**
 * Keeps the page from reinterpreting server-owned eligibility. Inactive,
 * revoked, and otherwise ineligible memberships must never reach the transfer
 * control merely because they are not the current owner.
 */
export function selectCreatorShareAdvocateOwnershipTransferOptions(
  page: CreatorShareAdvocateOwnershipCandidatePage,
): CreatorShareAdvocateOwnershipTransferOptions {
  return {
    currentOwnerMembershipId:
      page.candidates.find((candidate) => candidate.isCurrentOwner)
        ?.membershipId ?? null,
    candidates: page.candidates
      .filter((candidate) => candidate.isEligible)
      .map((candidate) => ({
        membershipId: candidate.membershipId,
        displayName: candidate.displayName,
      })),
    candidateListMayBeIncomplete: page.hasMore,
  }
}

export interface CreatorShareAdvocateLifecycleResult {
  advocateId: string
  advocateVersion: number
  relationshipStatus: CreatorShareAdvocateRelationshipStatus
  publicationStatus: CreatorShareAdvocatePublicationStatus
  domainCleanupRequested: boolean
}

export interface CreatorShareAdvocateCleanupRecoveryResult {
  advocateId: string
  advocateVersion: number
  cleanupPhase: Exclude<
    CreatorShareAdvocateCleanupPhase,
    "not_requested" | "quiescing" | "complete" | "needs_attention"
  >
  cleanupRetryRequested: true
}

export interface CreatorShareAdvocateControlRepository {
  list(
    filters: CreatorShareAdvocateControlFilters,
  ): Promise<CreatorShareAdvocateControlPage>
  loadSnapshot(advocateId: string): Promise<CreatorShareAdvocateControlSnapshot>
  listOwnershipCandidates(
    advocateId: string,
  ): Promise<CreatorShareAdvocateOwnershipCandidatePage>
  applyLifecycleAction(input: {
    advocateId: string
    expectedVersion: number
    action: CreatorShareAdvocateLifecycleAction
    reason: string
    operationId: string
    traceId: string
    clientIp: string | null
    userAgent: string | null
  }): Promise<CreatorShareAdvocateLifecycleResult>
  retryCleanup(input: {
    advocateId: string
    expectedVersion: number
    reason: string
    operationId: string
    traceId: string
    clientIp: string | null
    userAgent: string | null
  }): Promise<CreatorShareAdvocateCleanupRecoveryResult>
  transferOwnership(input: {
    advocateId: string
    expectedOwnerMembershipId: string
    targetOwnerMembershipId: string
    reason: string
    operationId: string
    traceId: string
    clientIp: string | null
    userAgent: string | null
  }): Promise<void>
}

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export class CreatorShareAdvocateControlRepositoryError extends Error {
  readonly stage:
    | "list"
    | "snapshot"
    | "ownership_candidates"
    | "lifecycle_action"
    | "cleanup_recovery"
    | "ownership_transfer"
    | "shape"
  readonly postgresCode: string | undefined

  constructor(
    stage: CreatorShareAdvocateControlRepositoryError["stage"],
    cause: SupabaseErrorLike = null,
  ) {
    super("creator_share_advocate_control_unavailable", { cause })
    this.name = "CreatorShareAdvocateControlRepositoryError"
    this.stage = stage
    this.postgresCode = cause?.code
  }
}

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

function parseCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100_000
    ? value
    : null
}

function parseTimestamp(value: unknown): string | null {
  return typeof value === "string" && timestampMicroseconds(value) !== null
    ? value
    : null
}

function timestampMicroseconds(value: unknown): bigint | null {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 64 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null
  }
  const match = value.match(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  const milliseconds = Date.parse(value)
  if (!match || !Number.isFinite(milliseconds)) return null
  const fractionalMicroseconds = (match[1] ?? "").padEnd(6, "0")
  const submillisecond = fractionalMicroseconds.slice(3)
  return BigInt(milliseconds) * 1_000n + BigInt(submillisecond || "0")
}

function parseNullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : (parseTimestamp(value) ?? undefined)
}

function parseDisplayText(
  value: unknown,
  maximumLength: number,
): string | null {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
    ? value
    : null
}

function parseSafePersonLabel(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 25 &&
    SAFE_PERSON_LABEL_PATTERN.test(value)
    ? value
    : null
}

function parseRelationshipStatus(
  value: unknown,
): CreatorShareAdvocateRelationshipStatus | null {
  return typeof value === "string" && RELATIONSHIP_STATUS_SET.has(value)
    ? (value as CreatorShareAdvocateRelationshipStatus)
    : null
}

function parsePublicationStatus(
  value: unknown,
): CreatorShareAdvocatePublicationStatus | null {
  return typeof value === "string" && PUBLICATION_STATUS_SET.has(value)
    ? (value as CreatorShareAdvocatePublicationStatus)
    : null
}

function parseDomainProjection(
  slug: string,
  hostname: unknown,
  status: unknown,
): Readonly<{ hostname: string | null; status: string | null }> | null {
  if (hostname === null && status === null) {
    return Object.freeze({ hostname: null, status: null })
  }
  if (
    hostname !== `${slug}.creatorshare.com` ||
    typeof status !== "string" ||
    !DOMAIN_STATUS_SET.has(status)
  ) {
    return null
  }
  return Object.freeze({ hostname, status })
}

function parseCommonRow(value: Record<string, unknown>): Readonly<{
  advocateId: string
  slug: string
  displayName: string
  relationshipStatus: CreatorShareAdvocateRelationshipStatus
  publicationStatus: CreatorShareAdvocatePublicationStatus
  advocateVersion: number
  ownerDisplayName: string | null
  ownershipStatus:
    "awaiting_owner_acceptance" | "owner_active" | "owner_unassigned"
  canReissueInitialOwner: boolean
  canRevokeInitialOwner: boolean
  primaryHostname: string | null
  primaryDomainStatus: string | null
  readyRequiredIntegrations: number
  requiredIntegrations: number
  openProviderJobs: number
  pendingInvitations: number
  suspendedAt: string | null
  archivedAt: string | null
  updatedAt: string
}> | null {
  const advocateId = value.advocate_id
  const slug = value.slug
  const displayName = parseDisplayText(value.display_name, 160)
  const relationshipStatus = parseRelationshipStatus(value.relationship_status)
  const publicationStatus = parsePublicationStatus(value.publication_status)
  const advocateVersion = parseVersion(value.advocate_version)
  const ownerDisplayName =
    value.owner_display_name === null
      ? null
      : parseSafePersonLabel(value.owner_display_name)
  const ownershipStatus = value.ownership_status
  const canReissueInitialOwner = value.can_reissue_initial_owner
  const canRevokeInitialOwner = value.can_revoke_initial_owner
  const readyRequiredIntegrations = parseCount(
    value.ready_required_integrations,
  )
  const requiredIntegrations = parseCount(value.required_integrations)
  const openProviderJobs = parseCount(value.open_provider_jobs)
  const pendingInvitations = parseCount(value.pending_invitations)
  const suspendedAt = parseNullableTimestamp(value.suspended_at)
  const archivedAt = parseNullableTimestamp(value.archived_at)
  const updatedAt = parseTimestamp(value.updated_at)
  if (
    typeof advocateId !== "string" ||
    !UUID_PATTERN.test(advocateId) ||
    typeof slug !== "string" ||
    !SLUG_PATTERN.test(slug) ||
    displayName === null ||
    relationshipStatus === null ||
    publicationStatus === null ||
    advocateVersion === null ||
    typeof ownershipStatus !== "string" ||
    !OWNERSHIP_STATUS_SET.has(ownershipStatus) ||
    (ownershipStatus === "owner_active" && ownerDisplayName === null) ||
    (ownershipStatus !== "owner_active" && ownerDisplayName !== null) ||
    typeof canReissueInitialOwner !== "boolean" ||
    typeof canRevokeInitialOwner !== "boolean" ||
    (canReissueInitialOwner &&
      ownershipStatus !== "awaiting_owner_acceptance") ||
    (canRevokeInitialOwner &&
      ownershipStatus !== "awaiting_owner_acceptance") ||
    (ownershipStatus === "awaiting_owner_acceptance" &&
      (relationshipStatus !== "invited" ||
        publicationStatus !== "draft" ||
        value.primary_hostname !== null ||
        value.primary_domain_status !== null)) ||
    (ownershipStatus === "owner_unassigned" &&
      (relationshipStatus !== "archived" ||
        publicationStatus !== "suspended")) ||
    readyRequiredIntegrations === null ||
    requiredIntegrations === null ||
    readyRequiredIntegrations > requiredIntegrations ||
    openProviderJobs === null ||
    pendingInvitations === null ||
    suspendedAt === undefined ||
    archivedAt === undefined ||
    updatedAt === null ||
    (relationshipStatus === "archived") !== (archivedAt !== null)
  ) {
    return null
  }
  const domain = parseDomainProjection(
    slug,
    value.primary_hostname,
    value.primary_domain_status,
  )
  if (domain === null) return null

  return Object.freeze({
    advocateId,
    slug,
    displayName,
    relationshipStatus,
    publicationStatus,
    advocateVersion,
    ownerDisplayName,
    ownershipStatus: ownershipStatus as
      "awaiting_owner_acceptance" | "owner_active" | "owner_unassigned",
    canReissueInitialOwner,
    canRevokeInitialOwner,
    primaryHostname: domain.hostname,
    primaryDomainStatus: domain.status,
    readyRequiredIntegrations,
    requiredIntegrations,
    openProviderJobs,
    pendingInvitations,
    suspendedAt,
    archivedAt,
    updatedAt,
  })
}

export function parseCreatorShareAdvocateControlSummary(
  value: unknown,
): CreatorShareAdvocateControlSummary | null {
  if (!isRecord(value) || !hasExactKeys(value, LIST_ROW_KEYS)) return null
  const common = parseCommonRow(value)
  const createdAt = parseTimestamp(value.created_at)
  if (common === null || createdAt === null) return null
  return Object.freeze({ ...common, createdAt })
}

export function parseCreatorShareAdvocateControlSummaries(
  value: unknown,
): readonly CreatorShareAdvocateControlSummary[] | null {
  if (!Array.isArray(value) || value.length > PAGE_SIZE + 1) return null
  const rows: CreatorShareAdvocateControlSummary[] = []
  const ids = new Set<string>()
  for (const candidate of value) {
    const row = parseCreatorShareAdvocateControlSummary(candidate)
    if (row === null || ids.has(row.advocateId)) return null
    const previous = rows.at(-1)
    const rowCreatedAt = timestampMicroseconds(row.createdAt)
    const previousCreatedAt = previous
      ? timestampMicroseconds(previous.createdAt)
      : null
    if (
      previous &&
      previousCreatedAt !== null &&
      rowCreatedAt !== null &&
      (rowCreatedAt > previousCreatedAt ||
        (rowCreatedAt === previousCreatedAt &&
          row.advocateId >= previous.advocateId))
    ) {
      return null
    }
    ids.add(row.advocateId)
    rows.push(row)
  }
  return Object.freeze(rows)
}

export function parseCreatorShareAdvocateControlSnapshot(
  value: unknown,
): CreatorShareAdvocateControlSnapshot | null {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !hasExactKeys(value[0], SNAPSHOT_ROW_KEYS)
  ) {
    return null
  }
  const row = value[0]
  const common = parseCommonRow(row)
  const primaryDomainId = row.primary_domain_id
  const openDeprovisionJobs = parseCount(row.open_deprovision_jobs)
  const cleanupPhase = row.cleanup_phase
  if (
    common === null ||
    (primaryDomainId === null) !== (common.primaryHostname === null) ||
    (primaryDomainId !== null &&
      (typeof primaryDomainId !== "string" ||
        !UUID_PATTERN.test(primaryDomainId))) ||
    openDeprovisionJobs === null ||
    typeof cleanupPhase !== "string" ||
    !CLEANUP_PHASE_SET.has(cleanupPhase) ||
    (common.relationshipStatus === "archived") ===
      (cleanupPhase === "not_requested") ||
    typeof row.can_suspend !== "boolean" ||
    typeof row.can_begin_publication_canary !== "boolean" ||
    typeof row.can_resume !== "boolean" ||
    typeof row.can_archive !== "boolean" ||
    typeof row.can_repair !== "boolean" ||
    typeof row.can_retry_cleanup !== "boolean" ||
    (row.can_retry_cleanup &&
      (common.relationshipStatus !== "archived" ||
        cleanupPhase !== "needs_attention" ||
        openDeprovisionJobs !== 0)) ||
    (row.can_begin_publication_canary &&
      (common.relationshipStatus !== "active" ||
        common.ownershipStatus !== "owner_active" ||
        common.primaryDomainStatus !== "verifying" ||
        common.publicationStatus === "suspended" ||
        common.readyRequiredIntegrations !== 5 ||
        common.requiredIntegrations !== 5 ||
        common.openProviderJobs !== 0)) ||
    (common.ownershipStatus === "awaiting_owner_acceptance" &&
      (row.can_suspend ||
        row.can_resume ||
        row.can_repair ||
        row.can_retry_cleanup ||
        cleanupPhase !== "not_requested" ||
        openDeprovisionJobs !== 0)) ||
    (common.relationshipStatus === "archived" &&
      (row.can_suspend || row.can_resume || row.can_archive || row.can_repair))
  ) {
    return null
  }
  return Object.freeze({
    ...common,
    openDeprovisionJobs,
    cleanupPhase:
      cleanupPhase as CreatorShareAdvocateControlSnapshot["cleanupPhase"],
    canRetryCleanup: row.can_retry_cleanup,
    canBeginPublicationCanary: row.can_begin_publication_canary,
    canSuspend: row.can_suspend,
    canResume: row.can_resume,
    canArchive: row.can_archive,
    canRepair: row.can_repair,
  })
}

export function parseCreatorShareAdvocateOwnershipCandidates(
  value: unknown,
): readonly CreatorShareAdvocateOwnershipCandidate[] | null {
  if (!Array.isArray(value) || value.length > OWNERSHIP_CANDIDATE_PAGE_SIZE) {
    return null
  }
  const candidates: CreatorShareAdvocateOwnershipCandidate[] = []
  let previousMembershipId: string | null = null
  let currentOwnerCount = 0
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, OWNERSHIP_CANDIDATE_ROW_KEYS)
    ) {
      return null
    }
    const membershipId = candidate.membership_id
    const displayName = parseSafePersonLabel(candidate.display_name)
    const status = candidate.membership_status
    const isCurrentOwner = candidate.is_current_owner
    const isEligible = candidate.is_eligible
    if (
      typeof membershipId !== "string" ||
      !UUID_PATTERN.test(membershipId) ||
      (previousMembershipId !== null && membershipId <= previousMembershipId) ||
      displayName === null ||
      typeof status !== "string" ||
      !MEMBERSHIP_STATUS_SET.has(status) ||
      typeof isCurrentOwner !== "boolean" ||
      typeof isEligible !== "boolean" ||
      (isCurrentOwner && (status !== "active" || isEligible)) ||
      (isEligible && (status !== "active" || isCurrentOwner))
    ) {
      return null
    }
    previousMembershipId = membershipId
    if (isCurrentOwner) currentOwnerCount += 1
    if (currentOwnerCount > 1) return null
    candidates.push(
      Object.freeze({
        membershipId,
        displayName,
        status: status as CreatorShareAdvocateMembershipStatus,
        isCurrentOwner,
        isEligible,
      }),
    )
  }
  return Object.freeze(candidates)
}

export function encodeCreatorShareAdvocateControlCursor(input: {
  createdAt: string
  advocateId: string
}): string | null {
  if (
    parseTimestamp(input.createdAt) === null ||
    !UUID_PATTERN.test(input.advocateId)
  ) {
    return null
  }
  return Buffer.from(
    `${input.createdAt}\n${input.advocateId}`,
    "utf8",
  ).toString("base64url")
}

export function parseCreatorShareAdvocateControlCursor(
  value: unknown,
): Readonly<{ createdAt: string; advocateId: string }> | null {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 160 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8")
    const separator = decoded.indexOf("\n")
    if (separator < 1 || decoded.indexOf("\n", separator + 1) !== -1) {
      return null
    }
    const createdAt = decoded.slice(0, separator)
    const advocateId = decoded.slice(separator + 1)
    if (
      parseTimestamp(createdAt) === null ||
      !UUID_PATTERN.test(advocateId) ||
      encodeCreatorShareAdvocateControlCursor({ createdAt, advocateId }) !==
        value
    ) {
      return null
    }
    return Object.freeze({ createdAt, advocateId })
  } catch {
    return null
  }
}

export function parseCreatorShareAdvocateRelationshipFilter(
  value: unknown,
): CreatorShareAdvocateRelationshipStatus | null {
  return value === undefined || value === ""
    ? null
    : parseRelationshipStatus(value)
}

export function parseCreatorShareAdvocatePublicationFilter(
  value: unknown,
): CreatorShareAdvocatePublicationStatus | null {
  return value === undefined || value === ""
    ? null
    : parsePublicationStatus(value)
}

function parseLifecycleResult(
  value: unknown,
  expected: Readonly<{
    advocateId: string
    expectedVersion: number
    action: CreatorShareAdvocateLifecycleAction
  }>,
): CreatorShareAdvocateLifecycleResult | null {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !hasExactKeys(value[0], LIFECYCLE_RESULT_ROW_KEYS)
  ) {
    return null
  }
  const row = value[0]
  const version = parseVersion(row.advocate_version)
  const relationshipStatus = parseRelationshipStatus(row.relationship_status)
  const publicationStatus = parsePublicationStatus(row.publication_status)
  const cleanup = row.domain_cleanup_requested
  if (
    row.advocate_id !== expected.advocateId ||
    version !== expected.expectedVersion + 1 ||
    relationshipStatus === null ||
    publicationStatus === null ||
    typeof cleanup !== "boolean"
  ) {
    return null
  }
  const validActionResult =
    (expected.action === "suspend" &&
      relationshipStatus === "suspended" &&
      publicationStatus === "suspended" &&
      !cleanup) ||
    (expected.action === "resume" &&
      relationshipStatus === "active" &&
      (publicationStatus === "draft" || publicationStatus === "provisioning") &&
      !cleanup) ||
    (expected.action === "archive" &&
      relationshipStatus === "archived" &&
      publicationStatus === "suspended") ||
    (expected.action === "repair" &&
      relationshipStatus === "active" &&
      publicationStatus === "provisioning" &&
      !cleanup)
  if (!validActionResult) return null

  return Object.freeze({
    advocateId: expected.advocateId,
    advocateVersion: version,
    relationshipStatus,
    publicationStatus,
    domainCleanupRequested: cleanup,
  })
}

function parseCleanupRecoveryResult(
  value: unknown,
  expected: Readonly<{ advocateId: string; expectedVersion: number }>,
): CreatorShareAdvocateCleanupRecoveryResult | null {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !hasExactKeys(value[0], CLEANUP_RECOVERY_RESULT_ROW_KEYS)
  ) {
    return null
  }
  const row = value[0]
  const version = parseVersion(row.advocate_version)
  const cleanupPhase = row.cleanup_phase
  if (
    row.advocate_id !== expected.advocateId ||
    version !== expected.expectedVersion + 1 ||
    typeof cleanupPhase !== "string" ||
    !CLEANUP_PHASE_SET.has(cleanupPhase) ||
    cleanupPhase === "not_requested" ||
    cleanupPhase === "quiescing" ||
    cleanupPhase === "complete" ||
    cleanupPhase === "needs_attention" ||
    row.cleanup_retry_requested !== true
  ) {
    return null
  }
  return Object.freeze({
    advocateId: expected.advocateId,
    advocateVersion: version,
    cleanupPhase:
      cleanupPhase as CreatorShareAdvocateCleanupRecoveryResult["cleanupPhase"],
    cleanupRetryRequested: true,
  })
}

export function createCreatorShareAdvocateControlRepository(
  client: SupabaseClient,
): CreatorShareAdvocateControlRepository {
  return {
    async list(filters) {
      const cursor =
        filters.cursor === null
          ? null
          : parseCreatorShareAdvocateControlCursor(filters.cursor)
      if (filters.cursor !== null && cursor === null) {
        throw new CreatorShareAdvocateControlRepositoryError("shape")
      }
      const { data, error } = await client.rpc(
        "list_creator_share_advocate_controls",
        {
          page_size: PAGE_SIZE + 1,
          before_created_at: cursor?.createdAt ?? null,
          before_advocate_id: cursor?.advocateId ?? null,
          relationship_filter: filters.relationshipStatus,
          publication_filter: filters.publicationStatus,
        },
      )
      if (error) {
        throw new CreatorShareAdvocateControlRepositoryError("list", error)
      }
      const rows = parseCreatorShareAdvocateControlSummaries(data)
      if (rows === null) {
        throw new CreatorShareAdvocateControlRepositoryError("shape")
      }
      const advocates = Object.freeze(rows.slice(0, PAGE_SIZE))
      const last = advocates.at(-1)
      const nextCursor =
        rows.length > PAGE_SIZE && last
          ? encodeCreatorShareAdvocateControlCursor({
              createdAt: last.createdAt,
              advocateId: last.advocateId,
            })
          : null
      if (rows.length > PAGE_SIZE && nextCursor === null) {
        throw new CreatorShareAdvocateControlRepositoryError("shape")
      }
      return Object.freeze({ advocates, nextCursor })
    },

    async loadSnapshot(advocateId) {
      const { data, error } = await client.rpc(
        "get_creator_share_advocate_control_snapshot",
        { target_advocate_id: advocateId },
      )
      if (error) {
        throw new CreatorShareAdvocateControlRepositoryError("snapshot", error)
      }
      const snapshot = parseCreatorShareAdvocateControlSnapshot(data)
      if (snapshot === null || snapshot.advocateId !== advocateId) {
        throw new CreatorShareAdvocateControlRepositoryError("shape")
      }
      return snapshot
    },

    async listOwnershipCandidates(advocateId) {
      const { data, error } = await client.rpc(
        "list_creator_share_advocate_ownership_candidates",
        {
          target_advocate_id: advocateId,
          page_size: OWNERSHIP_CANDIDATE_PAGE_SIZE,
          after_membership_id: null,
        },
      )
      if (error) {
        throw new CreatorShareAdvocateControlRepositoryError(
          "ownership_candidates",
          error,
        )
      }
      const candidates = parseCreatorShareAdvocateOwnershipCandidates(data)
      if (candidates === null) {
        throw new CreatorShareAdvocateControlRepositoryError("shape")
      }
      return Object.freeze({
        candidates,
        hasMore: candidates.length === OWNERSHIP_CANDIDATE_PAGE_SIZE,
      })
    },

    async applyLifecycleAction(input) {
      const { data, error } = await client.rpc(
        "apply_creator_share_advocate_lifecycle_action",
        {
          target_advocate_id: input.advocateId,
          expected_advocate_version: input.expectedVersion,
          target_action: input.action,
          change_reason: input.reason,
          request_id: input.operationId,
          trace_id: input.traceId,
          client_ip: input.clientIp,
          user_agent: input.userAgent,
        },
      )
      if (error) {
        throw new CreatorShareAdvocateControlRepositoryError(
          "lifecycle_action",
          error,
        )
      }
      const result = parseLifecycleResult(data, input)
      if (result === null) {
        throw new CreatorShareAdvocateControlRepositoryError("shape")
      }
      return result
    },

    async retryCleanup(input) {
      const { data, error } = await client.rpc(
        "retry_creator_share_advocate_cleanup",
        {
          target_advocate_id: input.advocateId,
          expected_advocate_version: input.expectedVersion,
          change_reason: input.reason,
          request_id: input.operationId,
          trace_id: input.traceId,
          client_ip: input.clientIp,
          user_agent: input.userAgent,
        },
      )
      if (error) {
        throw new CreatorShareAdvocateControlRepositoryError(
          "cleanup_recovery",
          error,
        )
      }
      const result = parseCleanupRecoveryResult(data, input)
      if (result === null) {
        throw new CreatorShareAdvocateControlRepositoryError("shape")
      }
      return result
    },

    async transferOwnership(input) {
      const { data, error } = await client.rpc(
        "transfer_creator_share_advocate_ownership",
        {
          target_advocate_id: input.advocateId,
          expected_owner_membership_id: input.expectedOwnerMembershipId,
          target_owner_membership_id: input.targetOwnerMembershipId,
          change_reason: input.reason,
          request_id: input.operationId,
          trace_id: input.traceId,
          client_ip: input.clientIp,
          user_agent: input.userAgent,
        },
      )
      if (error) {
        throw new CreatorShareAdvocateControlRepositoryError(
          "ownership_transfer",
          error,
        )
      }
      if (data !== input.advocateId) {
        throw new CreatorShareAdvocateControlRepositoryError("shape")
      }
    },
  }
}

export function classifyCreatorShareAdvocateLifecycleFailure(
  postgresCode: string | undefined,
): Readonly<{ status: number; code: string }> {
  switch (postgresCode) {
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "28000":
      return { status: 401, code: "unauthorized" }
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
      return { status: 404, code: "portal_not_found" }
    case "40001":
    case "55000":
    case "55P03":
    case "23514":
    case "23505":
      return { status: 409, code: "lifecycle_conflict" }
    default:
      return { status: 500, code: "lifecycle_update_failed" }
  }
}

export function classifyCreatorShareAdvocateOwnershipFailure(
  postgresCode: string | undefined,
): Readonly<{ status: number; code: string }> {
  switch (postgresCode) {
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "28000":
      return { status: 401, code: "unauthorized" }
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
    case "40001":
    case "55000":
    case "23514":
    case "23505":
    case "55P03":
      return { status: 409, code: "ownership_conflict" }
    default:
      return { status: 500, code: "ownership_transfer_failed" }
  }
}

export function classifyCreatorShareAdvocateCleanupRecoveryFailure(
  postgresCode: string | undefined,
): Readonly<{ status: number; code: string }> {
  switch (postgresCode) {
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "28000":
      return { status: 401, code: "unauthorized" }
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
      return { status: 404, code: "portal_not_found" }
    case "40001":
    case "55000":
    case "55P03":
    case "23514":
    case "23505":
      return { status: 409, code: "cleanup_recovery_conflict" }
    default:
      return { status: 500, code: "cleanup_recovery_failed" }
  }
}
