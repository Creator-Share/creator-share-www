import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RESULT_KEYS = Object.freeze([
  "advocate_id",
  "advocate_version",
  "created",
  "operation_id",
  "revocation_status",
] as const)

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export interface CreatorShareInitialOwnerRevocationResult {
  operationId: string
  advocateId: string
  advocateVersion: number
  revocationStatus: "initial_owner_invitation_revoked"
  created: boolean
}

export interface CreatorShareInitialOwnerRevocationAuditContext {
  traceId: string
  sessionId: string | null
  clientIp: string | null
  userAgent: string | null
}

export class CreatorShareInitialOwnerRevocationRepositoryError extends Error {
  readonly stage: "revoke" | "shape"
  readonly postgresCode: string | undefined

  constructor(
    stage: CreatorShareInitialOwnerRevocationRepositoryError["stage"],
    cause: SupabaseErrorLike = null,
  ) {
    super("creator_share_initial_owner_revocation_unavailable", { cause })
    this.name = "CreatorShareInitialOwnerRevocationRepositoryError"
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

export function parseCreatorShareInitialOwnerRevocationResult(
  value: unknown,
  expected: Readonly<{
    operationId: string
    advocateId: string
    expectedVersion: number
  }>,
): CreatorShareInitialOwnerRevocationResult | null {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  if (!isRecord(row) || !hasExactKeys(row, RESULT_KEYS)) return null
  const version = parseVersion(row.advocate_version)
  if (
    row.operation_id !== expected.operationId ||
    row.advocate_id !== expected.advocateId ||
    !UUID_PATTERN.test(expected.advocateId) ||
    version !== expected.expectedVersion + 1 ||
    row.revocation_status !== "initial_owner_invitation_revoked" ||
    typeof row.created !== "boolean"
  ) {
    return null
  }
  return Object.freeze({
    operationId: expected.operationId,
    advocateId: expected.advocateId,
    advocateVersion: version,
    revocationStatus: "initial_owner_invitation_revoked" as const,
    created: row.created,
  })
}

export function createCreatorShareInitialOwnerRevocationRepository(
  client: SupabaseClient,
) {
  return {
    async revoke(input: {
      advocateId: string
      expectedVersion: number
      reason: string
      operationId: string
      context: CreatorShareInitialOwnerRevocationAuditContext
    }): Promise<CreatorShareInitialOwnerRevocationResult> {
      const { data, error } = await client.rpc(
        "revoke_advocate_initial_owner_invitation",
        {
          revocation_operation_id: input.operationId,
          target_advocate_id: input.advocateId,
          expected_advocate_version: input.expectedVersion,
          change_reason: input.reason,
          request_id: input.operationId,
          trace_id: input.context.traceId,
          session_id: input.context.sessionId,
          client_ip: input.context.clientIp,
          user_agent: input.context.userAgent,
        },
      )
      if (error) {
        throw new CreatorShareInitialOwnerRevocationRepositoryError(
          "revoke",
          error,
        )
      }
      const result = parseCreatorShareInitialOwnerRevocationResult(data, input)
      if (result === null) {
        throw new CreatorShareInitialOwnerRevocationRepositoryError("shape")
      }
      return result
    },
  }
}

export function classifyCreatorShareInitialOwnerRevocationFailure(
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
    case "23505":
    case "23514":
    case "40001":
    case "55000":
    case "55P03":
      return { status: 409, code: "initial_owner_revocation_conflict" }
    default:
      return { status: 503, code: "initial_owner_revocation_unavailable" }
  }
}
