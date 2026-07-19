import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SECOND_PRECISION_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const UNSAFE_TEXT_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/
const PORTAL_MEMBER_LABEL_PATTERN =
  /^([A-Za-z]+(?:['-][A-Za-z]+)*(?: [A-Za-z]+(?:['-][A-Za-z]+)*)*)(?: [A-Z]\.)?$/
const EMAIL_LIKE_PATTERN = /@/
const URL_LIKE_PATTERN =
  /(?:\b(?:https?|ftp):\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/|\b))/i
const MARKUP_LIKE_PATTERN =
  /[<>\[\]`*_~]|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i

export const ADVOCATE_AUDIT_HISTORY_PAGE_SIZE = 50

export const ADVOCATE_AUDIT_EVENT_KEYS = Object.freeze([
  "portal.created",
  "portal.settings.updated",
  "portal.lifecycle.updated",
  "portal.ownership.transferred",
  "branding.updated",
  "catalog.updated",
  "public_metrics.updated",
  "team.invitation.issued",
  "team.invitation.revoked",
  "team.invitation.accepted",
  "team.member.roles_updated",
  "team.member.access_updated",
  "domain.provisioning.requested",
  "domain.publication.completed",
  "domain.publication.needs_attention",
  "domain.deactivated",
] as const)

export const ADVOCATE_AUDIT_AREA_KEYS = Object.freeze([
  "portal_profile",
  "portal_lifecycle",
  "ownership",
  "colors",
  "logo",
  "opening_header",
  "about",
  "catalog_mode",
  "catalog_selection",
  "catalog_order",
  "public_metric_selection",
  "member_roles",
  "member_access",
  "invitation",
  "dns",
  "tls",
  "payment_readiness",
  "provider_readiness",
  "publication",
] as const)

export const ADVOCATE_AUDIT_ACTOR_KINDS = Object.freeze([
  "portal_member",
  "creator_share_staff",
  "automation",
] as const)

export type AdvocateAuditEventKey = (typeof ADVOCATE_AUDIT_EVENT_KEYS)[number]
export type AdvocateAuditAreaKey = (typeof ADVOCATE_AUDIT_AREA_KEYS)[number]
export type AdvocateAuditActorKind = (typeof ADVOCATE_AUDIT_ACTOR_KINDS)[number]

export interface AdvocateAuditHistoryEntry {
  cursor: string
  occurredAt: string
  eventKey: AdvocateAuditEventKey
  actorKind: AdvocateAuditActorKind
  actorDisplayName: string
  areas: readonly AdvocateAuditAreaKey[]
}

export interface AdvocateAuditHistoryPage {
  schemaVersion: 1
  nextCursor: string | null
  entries: readonly AdvocateAuditHistoryEntry[]
}

export interface AdvocateAuditHistoryRepository {
  load(
    advocateId: string,
    beforeCursor: string | null,
  ): Promise<AdvocateAuditHistoryPage>
}

export class AdvocateAuditHistoryRepositoryError extends Error {
  readonly stage: "query" | "shape"

  constructor(stage: "query" | "shape") {
    super("advocate_audit_history_unavailable")
    this.name = "AdvocateAuditHistoryRepositoryError"
    this.stage = stage
  }
}

const ROOT_KEYS = Object.freeze([
  "entries",
  "next_cursor",
  "schema_version",
] as const)
const ENTRY_KEYS = Object.freeze([
  "actor_display_name",
  "actor_kind",
  "areas",
  "cursor",
  "event_key",
  "occurred_at",
] as const)
const EVENT_KEY_SET = new Set<string>(ADVOCATE_AUDIT_EVENT_KEYS)
const AREA_KEY_SET = new Set<string>(ADVOCATE_AUDIT_AREA_KEYS)
const ACTOR_KIND_SET = new Set<string>(ADVOCATE_AUDIT_ACTOR_KINDS)
const EVENT_AREA_KEYS = Object.freeze({
  "portal.created": Object.freeze([
    "ownership",
    "portal_lifecycle",
    "portal_profile",
  ]),
  "portal.settings.updated": Object.freeze(["portal_profile"]),
  "portal.lifecycle.updated": Object.freeze(["portal_lifecycle"]),
  "portal.ownership.transferred": Object.freeze(["ownership"]),
  "branding.updated": Object.freeze([
    "about",
    "colors",
    "logo",
    "opening_header",
  ]),
  "catalog.updated": Object.freeze([
    "catalog_mode",
    "catalog_order",
    "catalog_selection",
  ]),
  "public_metrics.updated": Object.freeze(["public_metric_selection"]),
  "team.invitation.issued": Object.freeze(["invitation"]),
  "team.invitation.revoked": Object.freeze(["invitation"]),
  "team.invitation.accepted": Object.freeze(["invitation"]),
  "team.member.roles_updated": Object.freeze(["member_roles"]),
  "team.member.access_updated": Object.freeze(["member_access"]),
  "domain.provisioning.requested": Object.freeze([
    "dns",
    "payment_readiness",
    "provider_readiness",
    "tls",
  ]),
  "domain.publication.completed": Object.freeze([
    "dns",
    "payment_readiness",
    "provider_readiness",
    "publication",
    "tls",
  ]),
  "domain.publication.needs_attention": Object.freeze([
    "dns",
    "payment_readiness",
    "provider_readiness",
    "publication",
    "tls",
  ]),
  "domain.deactivated": Object.freeze([
    "dns",
    "payment_readiness",
    "provider_readiness",
    "publication",
    "tls",
  ]),
} satisfies Readonly<
  Record<AdvocateAuditEventKey, readonly AdvocateAuditAreaKey[]>
>)

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

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function isSecondPrecisionUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !SECOND_PRECISION_UTC_PATTERN.test(value)) {
    return false
  }

  const timestamp = Date.parse(value)
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 19) + "Z" === value
  )
}

function isHighEntropyPortalLabel(value: string): boolean {
  const compact = value.toLowerCase().replace(/[^a-z]/g, "")
  if (compact.length < 24) return false

  const counts = new Map<string, number>()
  for (const character of compact) {
    counts.set(character, (counts.get(character) ?? 0) + 1)
  }
  let entropy = 0
  for (const count of counts.values()) {
    const probability = count / compact.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy >= 4
}

function isSafeDisplayLabel(
  value: unknown,
  actorKind: AdvocateAuditActorKind,
): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 96 ||
    value !== value.trim() ||
    /\s{2,}/.test(value) ||
    UNSAFE_TEXT_CHARACTER_PATTERN.test(value) ||
    EMAIL_LIKE_PATTERN.test(value) ||
    URL_LIKE_PATTERN.test(value) ||
    MARKUP_LIKE_PATTERN.test(value)
  ) {
    return false
  }

  if (actorKind === "creator_share_staff") {
    return value === "Creator Share staff"
  }
  if (actorKind === "automation") {
    return value === "Creator Share automation"
  }
  if (value === "Portal team member") return true

  const nameMatch = PORTAL_MEMBER_LABEL_PATTERN.exec(value)
  const nameCore = nameMatch?.[1]
  const normalizedNameCore = nameCore?.toLowerCase()
  return (
    value !== "Creator Share staff" &&
    value !== "Creator Share automation" &&
    nameMatch !== null &&
    nameCore !== undefined &&
    normalizedNameCore !== "creator share staff" &&
    normalizedNameCore !== "creator share automation" &&
    nameCore.length <= 22 &&
    value.length <= 25 &&
    !UUID_PATTERN.test(value) &&
    !isHighEntropyPortalLabel(value)
  )
}

function hasExactEventAreas(
  eventKey: AdvocateAuditEventKey,
  areas: readonly AdvocateAuditAreaKey[],
): boolean {
  const expected = EVENT_AREA_KEYS[eventKey]
  return (
    areas.length === expected.length &&
    areas.every((area, index) => area === expected[index])
  )
}

function parseAreas(value: unknown): readonly AdvocateAuditAreaKey[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > ADVOCATE_AUDIT_AREA_KEYS.length
  ) {
    return null
  }

  const areas: AdvocateAuditAreaKey[] = []
  let previous: string | null = null
  for (const area of value) {
    if (
      typeof area !== "string" ||
      !AREA_KEY_SET.has(area) ||
      (previous !== null && area <= previous)
    ) {
      return null
    }
    previous = area
    areas.push(area as AdvocateAuditAreaKey)
  }
  return Object.freeze(areas)
}

function parseEntry(value: unknown): AdvocateAuditHistoryEntry | null {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return null

  const cursor = value.cursor
  const occurredAt = value.occurred_at
  const eventKey = value.event_key
  const actorKind = value.actor_kind
  const actorDisplayName = value.actor_display_name
  const areas = parseAreas(value.areas)

  if (
    !isCanonicalUuid(cursor) ||
    !isSecondPrecisionUtcTimestamp(occurredAt) ||
    typeof eventKey !== "string" ||
    !EVENT_KEY_SET.has(eventKey) ||
    typeof actorKind !== "string" ||
    !ACTOR_KIND_SET.has(actorKind) ||
    !isSafeDisplayLabel(
      actorDisplayName,
      actorKind as AdvocateAuditActorKind,
    ) ||
    areas === null
  ) {
    return null
  }

  const typedEventKey = eventKey as AdvocateAuditEventKey
  if (!hasExactEventAreas(typedEventKey, areas)) return null

  return Object.freeze({
    cursor,
    occurredAt,
    eventKey: typedEventKey,
    actorKind: actorKind as AdvocateAuditActorKind,
    actorDisplayName,
    areas,
  })
}

export function parseAdvocateAuditHistoryPage(
  value: unknown,
): AdvocateAuditHistoryPage | null {
  if (!isRecord(value) || !hasExactKeys(value, ROOT_KEYS)) return null

  const nextCursor = value.next_cursor
  if (
    value.schema_version !== 1 ||
    (nextCursor !== null && !isCanonicalUuid(nextCursor)) ||
    !Array.isArray(value.entries) ||
    value.entries.length > ADVOCATE_AUDIT_HISTORY_PAGE_SIZE
  ) {
    return null
  }

  const entries: AdvocateAuditHistoryEntry[] = []
  const cursors = new Set<string>()
  for (const valueEntry of value.entries) {
    const entry = parseEntry(valueEntry)
    if (entry === null || cursors.has(entry.cursor)) {
      return null
    }
    cursors.add(entry.cursor)
    entries.push(entry)
  }

  if (
    nextCursor !== null &&
    (entries.length !== ADVOCATE_AUDIT_HISTORY_PAGE_SIZE ||
      nextCursor !== entries.at(-1)?.cursor)
  ) {
    return null
  }

  return Object.freeze({
    schemaVersion: 1,
    nextCursor: nextCursor as string | null,
    entries: Object.freeze(entries),
  })
}

export interface AdvocateAuditHistoryPageQuery {
  beforeCursor: string | null
}

export function parseAdvocateAuditHistoryPageQuery(
  value: unknown,
): AdvocateAuditHistoryPageQuery | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length === 0) return Object.freeze({ beforeCursor: null })
  if (
    keys.length !== 1 ||
    keys[0] !== "before" ||
    !isCanonicalUuid(value.before)
  ) {
    return null
  }
  return Object.freeze({ beforeCursor: value.before })
}

export function createAdvocateAuditHistoryRepository(
  client: SupabaseClient,
): AdvocateAuditHistoryRepository {
  return {
    async load(advocateId, beforeCursor) {
      if (
        !isCanonicalUuid(advocateId) ||
        (beforeCursor !== null && !isCanonicalUuid(beforeCursor))
      ) {
        throw new AdvocateAuditHistoryRepositoryError("shape")
      }

      let data: unknown
      try {
        const response = await client.rpc("get_advocate_audit_history_page", {
          target_advocate_id: advocateId,
          before_cursor: beforeCursor,
          page_size: ADVOCATE_AUDIT_HISTORY_PAGE_SIZE,
        })
        if (response.error) {
          throw new AdvocateAuditHistoryRepositoryError("query")
        }
        data = response.data
      } catch (error) {
        if (error instanceof AdvocateAuditHistoryRepositoryError) throw error
        throw new AdvocateAuditHistoryRepositoryError("query")
      }

      const page = parseAdvocateAuditHistoryPage(data)
      if (page === null) {
        throw new AdvocateAuditHistoryRepositoryError("shape")
      }
      return page
    },
  }
}
