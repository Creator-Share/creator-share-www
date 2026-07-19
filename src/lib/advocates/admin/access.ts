import "server-only"

import { cache } from "react"
import type { SupabaseClient, User } from "@supabase/supabase-js"

import { createClient } from "@/utils/supabase/server"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const ACCESS_ROW_KEYS = Object.freeze([
  "advocate_id",
  "advocate_version",
  "beneficiary_mode",
  "canonical_hostname",
  "display_name",
  "domain_status",
  "permissions",
  "publication_status",
  "relationship_status",
  "slug",
] as const)

export const ADVOCATE_PORTAL_PERMISSION_KEYS = Object.freeze([
  "portal.analytics.view",
  "portal.archive",
  "portal.beneficiaries.manage",
  "portal.branding.update",
  "portal.domains.manage",
  "portal.domains.view",
  "portal.members.invite",
  "portal.members.manage",
  "portal.members.view",
  "portal.ownership.transfer",
  "portal.public_metrics.update",
  "portal.settings.update",
  "portal.audit.view",
  "portal.view",
] as const)

export type AdvocatePortalPermission =
  (typeof ADVOCATE_PORTAL_PERMISSION_KEYS)[number]
export type AdvocateRelationshipStatus =
  "invited" | "active" | "suspended" | "archived"
export type AdvocatePublicationStatus =
  "draft" | "provisioning" | "active" | "failed" | "suspended"
export type AdvocateBeneficiaryMode = "all" | "all_featured" | "selected"
export type AdvocateDomainStatus =
  | "pending"
  | "provisioning"
  | "verifying"
  | "active"
  | "failed"
  | "redirecting"
  | "disabled"

export interface AdvocatePortalAccess {
  advocateId: string
  slug: string
  displayName: string
  relationshipStatus: AdvocateRelationshipStatus
  publicationStatus: AdvocatePublicationStatus
  beneficiaryMode: AdvocateBeneficiaryMode
  advocateVersion: number
  canonicalHostname: string | null
  domainStatus: AdvocateDomainStatus | null
  permissions: readonly AdvocatePortalPermission[]
}

export interface AuthenticatedAdvocatePortalSession {
  user: User
  portals: readonly AdvocatePortalAccess[]
}

export interface AdvocatePortalAccessRepository {
  listForCurrentUser(): Promise<readonly AdvocatePortalAccess[]>
}

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export class AdvocatePortalAccessRepositoryError extends Error {
  readonly stage: "access_query" | "access_shape"

  constructor(
    stage: "access_query" | "access_shape",
    cause: SupabaseErrorLike = null,
  ) {
    super("advocate_portal_access_unavailable", { cause })
    this.name = "AdvocatePortalAccessRepositoryError"
    this.stage = stage
  }
}

const PERMISSION_KEY_SET = new Set<string>(ADVOCATE_PORTAL_PERMISSION_KEYS)
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
const BENEFICIARY_MODE_SET = new Set<string>([
  "all",
  "all_featured",
  "selected",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort()
  return (
    keys.length === ACCESS_ROW_KEYS.length &&
    keys.every((key, index) => key === ACCESS_ROW_KEYS[index])
  )
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

function parsePermissions(
  value: unknown,
): readonly AdvocatePortalPermission[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > ADVOCATE_PORTAL_PERMISSION_KEYS.length
  ) {
    return null
  }

  const permissions: AdvocatePortalPermission[] = []
  let previous: string | null = null
  for (const permission of value) {
    if (
      typeof permission !== "string" ||
      !PERMISSION_KEY_SET.has(permission) ||
      (previous !== null && permission <= previous)
    ) {
      return null
    }
    previous = permission
    permissions.push(permission as AdvocatePortalPermission)
  }

  return permissions.includes("portal.view") ? Object.freeze(permissions) : null
}

export function parseAdvocatePortalAccessRow(
  value: unknown,
): AdvocatePortalAccess | null {
  if (!isRecord(value) || !hasExactKeys(value)) return null

  const advocateId = value.advocate_id
  const slug = value.slug
  const displayName = value.display_name
  const relationshipStatus = value.relationship_status
  const publicationStatus = value.publication_status
  const beneficiaryMode = value.beneficiary_mode
  const advocateVersion = value.advocate_version
  const canonicalHostname = value.canonical_hostname
  const domainStatus = value.domain_status
  const permissions = parsePermissions(value.permissions)

  if (
    typeof advocateId !== "string" ||
    !UUID_PATTERN.test(advocateId) ||
    typeof slug !== "string" ||
    !SLUG_PATTERN.test(slug) ||
    !isBoundedTrimmedText(displayName, 160) ||
    typeof relationshipStatus !== "string" ||
    !RELATIONSHIP_STATUS_SET.has(relationshipStatus) ||
    typeof publicationStatus !== "string" ||
    !PUBLICATION_STATUS_SET.has(publicationStatus) ||
    typeof beneficiaryMode !== "string" ||
    !BENEFICIARY_MODE_SET.has(beneficiaryMode) ||
    typeof advocateVersion !== "number" ||
    !Number.isSafeInteger(advocateVersion) ||
    advocateVersion < 1 ||
    (canonicalHostname !== null &&
      canonicalHostname !== `${slug}.creatorshare.com`) ||
    (domainStatus !== null &&
      (typeof domainStatus !== "string" ||
        !DOMAIN_STATUS_SET.has(domainStatus))) ||
    (canonicalHostname === null) !== (domainStatus === null) ||
    permissions === null
  ) {
    return null
  }

  return Object.freeze({
    advocateId,
    slug,
    displayName,
    relationshipStatus: relationshipStatus as AdvocateRelationshipStatus,
    publicationStatus: publicationStatus as AdvocatePublicationStatus,
    beneficiaryMode: beneficiaryMode as AdvocateBeneficiaryMode,
    advocateVersion,
    canonicalHostname,
    domainStatus: domainStatus as AdvocateDomainStatus | null,
    permissions,
  })
}

export function parseAdvocatePortalAccessRows(
  value: unknown,
): readonly AdvocatePortalAccess[] | null {
  if (!Array.isArray(value) || value.length > 1_000) return null

  const portals: AdvocatePortalAccess[] = []
  const advocateIds = new Set<string>()
  const slugs = new Set<string>()
  for (const row of value) {
    const portal = parseAdvocatePortalAccessRow(row)
    if (
      portal === null ||
      advocateIds.has(portal.advocateId) ||
      slugs.has(portal.slug)
    ) {
      return null
    }
    advocateIds.add(portal.advocateId)
    slugs.add(portal.slug)
    portals.push(portal)
  }

  portals.sort((left, right) => left.slug.localeCompare(right.slug, "en"))
  return Object.freeze(portals)
}

export function createAdvocatePortalAccessRepository(
  client: SupabaseClient,
): AdvocatePortalAccessRepository {
  return {
    async listForCurrentUser() {
      const { data, error } = await client.rpc("get_my_advocate_portal_access")
      if (error) {
        throw new AdvocatePortalAccessRepositoryError("access_query", error)
      }

      const portals = parseAdvocatePortalAccessRows(data)
      if (portals === null) {
        throw new AdvocatePortalAccessRepositoryError("access_shape")
      }
      return portals
    },
  }
}

export function findAdvocatePortalAccessBySlug(
  portals: readonly AdvocatePortalAccess[],
  slug: string,
): AdvocatePortalAccess | null {
  if (!SLUG_PATTERN.test(slug)) return null
  return portals.find((portal) => portal.slug === slug) ?? null
}

export const loadAuthenticatedAdvocatePortalSession = cache(
  async (): Promise<AuthenticatedAdvocatePortalSession | null> => {
    const client = await createClient()
    const {
      data: { user },
    } = await client.auth.getUser()
    if (!user) return null

    const portals =
      await createAdvocatePortalAccessRepository(client).listForCurrentUser()
    return Object.freeze({ user, portals })
  },
)
