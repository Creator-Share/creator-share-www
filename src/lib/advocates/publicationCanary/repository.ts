import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

export interface PublicationCanaryTargetIdentity {
  advocateId: string
  domainId: string
  hostname: string
  advocateVersion: number
}

export type PublicationCanaryTarget = Readonly<PublicationCanaryTargetIdentity>

export interface PublicationCanaryRepository {
  loadVerifyingTarget(
    identity: PublicationCanaryTargetIdentity,
  ): Promise<PublicationCanaryTarget | null>
}

interface SupabaseErrorLike {
  code?: string
}

export class PublicationCanaryRepositoryError extends Error {
  readonly stage: string

  constructor(stage: string, cause: SupabaseErrorLike | null = null) {
    super("advocate_publication_canary_repository_failure", { cause })
    this.name = "PublicationCanaryRepositoryError"
    this.stage = stage
  }
}

const ELIGIBLE_PUBLICATION_STATUSES = Object.freeze([
  "draft",
  "provisioning",
  "failed",
  "active",
] as const)

function repositoryError(
  stage: string,
  cause: SupabaseErrorLike | null = null,
): never {
  throw new PublicationCanaryRepositoryError(stage, cause)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseTarget(
  value: unknown,
  expected: PublicationCanaryTargetIdentity,
): PublicationCanaryTarget {
  if (!isRecord(value) || !isRecord(value.advocate)) {
    repositoryError("target_shape")
  }
  const advocate = value.advocate
  if (
    value.id !== expected.domainId ||
    value.advocate_id !== expected.advocateId ||
    value.hostname !== expected.hostname ||
    value.is_primary !== true ||
    value.status !== "verifying" ||
    advocate.id !== expected.advocateId ||
    advocate.version !== expected.advocateVersion ||
    advocate.relationship_status !== "active" ||
    !ELIGIBLE_PUBLICATION_STATUSES.includes(
      advocate.publication_status as (typeof ELIGIBLE_PUBLICATION_STATUSES)[number],
    )
  ) {
    repositoryError("target_shape")
  }

  return Object.freeze({ ...expected })
}

/**
 * The supplied client must be a server-held service-role client. One joined
 * statement binds the exact primary hostname, verifying lifecycle, advocate
 * version, and publication eligibility. No ordinary public snapshot can expose
 * a verifying tenant.
 */
export function createServiceRolePublicationCanaryRepository(
  client: SupabaseClient,
): PublicationCanaryRepository {
  return {
    async loadVerifyingTarget(identity) {
      const { data, error } = await client
        .from("advocate_domains")
        .select(
          "id, advocate_id, hostname, is_primary, status, advocate:advocates!inner(id, version, relationship_status, publication_status)",
        )
        .eq("id", identity.domainId)
        .eq("advocate_id", identity.advocateId)
        .eq("hostname", identity.hostname)
        .eq("is_primary", true)
        .eq("status", "verifying")
        .eq("advocate.id", identity.advocateId)
        .eq("advocate.version", identity.advocateVersion)
        .eq("advocate.relationship_status", "active")
        .in("advocate.publication_status", [...ELIGIBLE_PUBLICATION_STATUSES])
        .maybeSingle()

      if (error) repositoryError("target", error)
      if (data === null) return null
      return parseTarget(data, identity)
    },
  }
}
