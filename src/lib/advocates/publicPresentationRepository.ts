import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { PublicAdvocatePresentationRepository } from "./publicPresentation"

interface SupabaseErrorLike {
  code?: string
}

export class PublicAdvocatePresentationRepositoryError extends Error {
  readonly stage: string

  constructor(stage: string, cause: SupabaseErrorLike | null) {
    super("public_advocate_presentation_repository_failure", { cause })
    this.name = "PublicAdvocatePresentationRepositoryError"
    this.stage = stage
  }
}

function repositoryError(
  stage: string,
  cause: SupabaseErrorLike | null = null,
): never {
  throw new PublicAdvocatePresentationRepositoryError(stage, cause)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The supplied client must be a server-held service-role client. The RPC is
 * executable only by service_role and returns one allowlisted JSON snapshot.
 * No browser client receives access to the private advocate base tables.
 */
export function createServiceRolePublicAdvocatePresentationRepository(
  client: SupabaseClient,
): PublicAdvocatePresentationRepository {
  return {
    async loadByCanonicalHostname(hostname) {
      const { data, error } = await client.rpc(
        "read_public_advocate_presentation_snapshot",
        { target_hostname: hostname },
      )

      if (error) repositoryError("snapshot", error)
      if (data === null) return null
      if (!isRecord(data)) repositoryError("snapshot_shape")

      return data
    },
  }
}
