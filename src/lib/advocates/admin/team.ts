import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AdvocatePortalAccess } from "@/lib/advocates/admin/access"
import {
  type AdvocateDelegateRoleKey,
  type AdvocateMembershipStatus,
  parseAdvocateTeam,
} from "@/lib/advocates/admin/teamContracts"

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export interface AdvocateTeamAuditContext {
  requestId: string
  traceId: string | null
  sessionId: string | null
}

export class AdvocateTeamRepositoryError extends Error {
  readonly stage: "load" | "mutation" | "shape"
  readonly postgresCode: string | undefined

  constructor(
    stage: "load" | "mutation" | "shape",
    cause: SupabaseErrorLike = null,
  ) {
    super("advocate_team_unavailable", { cause })
    this.name = "AdvocateTeamRepositoryError"
    this.stage = stage
    this.postgresCode = cause?.code
  }
}

function parseResultingVersion(value: unknown): number | null {
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

export function createAdvocateTeamRepository(client: SupabaseClient) {
  return {
    async load(portal: Pick<AdvocatePortalAccess, "advocateId">) {
      const { data, error } = await client.rpc("get_advocate_team", {
        target_advocate_id: portal.advocateId,
      })
      if (error) throw new AdvocateTeamRepositoryError("load", error)

      const team = parseAdvocateTeam(data)
      if (team === null) throw new AdvocateTeamRepositoryError("shape")
      return team
    },

    async replaceRoles(options: {
      advocateId: string
      membershipId: string
      expectedVersion: number
      roleKeys: readonly AdvocateDelegateRoleKey[]
      reason: string
      context: AdvocateTeamAuditContext
    }) {
      const { data, error } = await client.rpc(
        "replace_advocate_member_roles",
        {
          target_advocate_id: options.advocateId,
          target_membership_id: options.membershipId,
          expected_membership_version: options.expectedVersion,
          target_role_keys: options.roleKeys,
          change_reason: options.reason,
          request_id: options.context.requestId,
          trace_id: options.context.traceId,
          session_id: options.context.sessionId,
        },
      )
      if (error) throw new AdvocateTeamRepositoryError("mutation", error)

      const version = parseResultingVersion(data)
      if (version === null) throw new AdvocateTeamRepositoryError("shape")
      return version
    },

    async changeStatus(options: {
      advocateId: string
      membershipId: string
      expectedVersion: number
      status: AdvocateMembershipStatus
      reason: string
      context: AdvocateTeamAuditContext
    }) {
      const { data, error } = await client.rpc(
        "change_advocate_member_status",
        {
          target_advocate_id: options.advocateId,
          target_membership_id: options.membershipId,
          expected_membership_version: options.expectedVersion,
          target_status: options.status,
          change_reason: options.reason,
          request_id: options.context.requestId,
          trace_id: options.context.traceId,
          session_id: options.context.sessionId,
        },
      )
      if (error) throw new AdvocateTeamRepositoryError("mutation", error)

      const version = parseResultingVersion(data)
      if (version === null) throw new AdvocateTeamRepositoryError("shape")
      return version
    },
  }
}
