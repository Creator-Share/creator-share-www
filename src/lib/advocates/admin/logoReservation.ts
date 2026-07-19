import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export type AdvocateLogoReservationTerminalStatus =
  "cancelled" | "cleanup_required"
export type AdvocateLogoReservationStatus =
  "pending" | "attached" | AdvocateLogoReservationTerminalStatus | "expired"

export interface AdvocateLogoUploadReservation {
  reservationId: string
  objectPath: string
  expiresAt: string
}

export interface AdvocateLogoUploadReservationResult {
  status: AdvocateLogoReservationStatus
  objectPath: string
  expectedVersion: number
  resultingVersion: number | null
}

export interface AdvocateLogoReservationFailure {
  status: 400 | 403 | 409 | 429 | 500
  code:
    | "invalid_request"
    | "forbidden"
    | "version_conflict"
    | "upload_in_progress"
    | "rate_limited"
    | "logo_update_failed"
}

export class AdvocateLogoReservationDatabaseError extends Error {
  readonly postgresCode: string | undefined

  constructor(cause: Readonly<{ code?: string }> | null) {
    super("advocate_logo_reservation_database_failure", { cause })
    this.name = "AdvocateLogoReservationDatabaseError"
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

function exactReservationPath(
  value: unknown,
  slug: string,
  reservationId: string,
): value is string {
  return (
    typeof value === "string" &&
    SLUG_PATTERN.test(slug) &&
    value === `logos/${slug}/${reservationId}.webp`
  )
}

export function parseAdvocateLogoUploadReservation(
  value: unknown,
  slug: string,
): AdvocateLogoUploadReservation | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null
  }
  const row = value[0]
  if (
    !hasExactKeys(row, ["reservation_id", "object_path", "expires_at"]) ||
    typeof row.reservation_id !== "string" ||
    !UUID_PATTERN.test(row.reservation_id) ||
    !exactReservationPath(row.object_path, slug, row.reservation_id) ||
    typeof row.expires_at !== "string"
  ) {
    return null
  }
  const expiresAt = Date.parse(row.expires_at)
  if (!Number.isFinite(expiresAt)) return null

  return Object.freeze({
    reservationId: row.reservation_id,
    objectPath: row.object_path,
    expiresAt: new Date(expiresAt).toISOString(),
  })
}

export function parseAdvocateLogoUploadReservationResult(
  value: unknown,
  expected: {
    reservationId: string
    slug: string
  },
): AdvocateLogoUploadReservationResult | null {
  if (
    !UUID_PATTERN.test(expected.reservationId) ||
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0])
  ) {
    return null
  }
  const row = value[0]
  const statuses = new Set<AdvocateLogoReservationStatus>([
    "pending",
    "attached",
    "cancelled",
    "cleanup_required",
    "expired",
  ])
  if (
    !hasExactKeys(row, [
      "status",
      "object_path",
      "expected_version",
      "resulting_version",
    ]) ||
    typeof row.status !== "string" ||
    !statuses.has(row.status as AdvocateLogoReservationStatus) ||
    !exactReservationPath(
      row.object_path,
      expected.slug,
      expected.reservationId,
    ) ||
    typeof row.expected_version !== "number" ||
    !Number.isSafeInteger(row.expected_version) ||
    row.expected_version < 1 ||
    !(
      row.resulting_version === null ||
      (typeof row.resulting_version === "number" &&
        Number.isSafeInteger(row.resulting_version))
    ) ||
    (row.status === "attached"
      ? row.resulting_version !== row.expected_version + 1
      : row.resulting_version !== null)
  ) {
    return null
  }

  return Object.freeze({
    status: row.status as AdvocateLogoReservationStatus,
    objectPath: row.object_path,
    expectedVersion: row.expected_version,
    resultingVersion: row.resulting_version,
  })
}

export function classifyAdvocateLogoReservationFailure(
  postgresCode: string | undefined,
): AdvocateLogoReservationFailure {
  switch (postgresCode) {
    case "22023":
    case "23514":
      return { status: 400, code: "invalid_request" }
    case "28000":
    case "42501":
      return { status: 403, code: "forbidden" }
    case "40001":
      return { status: 409, code: "version_conflict" }
    case "55000":
      return { status: 409, code: "upload_in_progress" }
    case "54000":
      return { status: 429, code: "rate_limited" }
    default:
      return { status: 500, code: "logo_update_failed" }
  }
}

export async function reserveAdvocateLogoUpload(
  client: SupabaseClient,
  input: {
    advocateId: string
    actorUserId: string
    expectedVersion: number
    slug: string
    requestId: string
    traceId: string | null
  },
): Promise<AdvocateLogoUploadReservation> {
  const { data, error } = await client.rpc("reserve_advocate_logo_upload", {
    target_advocate_id: input.advocateId,
    target_actor_user_id: input.actorUserId,
    expected_advocate_version: input.expectedVersion,
    request_id: input.requestId,
    trace_id: input.traceId,
  })
  if (error) throw new AdvocateLogoReservationDatabaseError(error)
  const reservation = parseAdvocateLogoUploadReservation(data, input.slug)
  if (reservation === null) {
    throw new AdvocateLogoReservationDatabaseError(null)
  }
  return reservation
}

export async function settleAdvocateLogoUploadReservation(
  client: SupabaseClient,
  input: {
    reservationId: string
    actorUserId: string
    requestId: string
    status: AdvocateLogoReservationTerminalStatus
    failureCode: string
  },
): Promise<AdvocateLogoReservationTerminalStatus> {
  const { data, error } = await client.rpc(
    "settle_advocate_logo_upload_reservation",
    {
      target_reservation_id: input.reservationId,
      target_actor_user_id: input.actorUserId,
      request_id: input.requestId,
      target_status: input.status,
      failure_code: input.failureCode,
    },
  )
  if (error || data !== input.status) {
    throw new AdvocateLogoReservationDatabaseError(error)
  }
  return input.status
}

export async function getAdvocateLogoUploadReservationResult(
  client: SupabaseClient,
  input: {
    reservationId: string
    actorUserId: string
    requestId: string
    slug: string
  },
): Promise<AdvocateLogoUploadReservationResult> {
  const { data, error } = await client.rpc(
    "get_advocate_logo_upload_reservation_result",
    {
      target_reservation_id: input.reservationId,
      target_actor_user_id: input.actorUserId,
      request_id: input.requestId,
    },
  )
  if (error) throw new AdvocateLogoReservationDatabaseError(error)
  const result = parseAdvocateLogoUploadReservationResult(data, {
    reservationId: input.reservationId,
    slug: input.slug,
  })
  if (result === null) throw new AdvocateLogoReservationDatabaseError(null)
  return result
}
