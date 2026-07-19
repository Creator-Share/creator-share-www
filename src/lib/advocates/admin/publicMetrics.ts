import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  normalizeAdvocatePublicMetricKeys,
  type AdvocatePublicMetricKey,
} from "@/lib/advocates/admin/publicMetricsForm"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export const MAX_ADVOCATE_PUBLIC_METRICS_BODY_BYTES = 4_096

export interface AdvocatePublicMetricsUpdateInput {
  expectedVersion: number
  metricKeys: readonly AdvocatePublicMetricKey[]
  changeReason: string
}

export interface AdvocatePublicMetricsUpdateFailure {
  status: 400 | 403 | 404 | 409 | 500
  code:
    | "invalid_request"
    | "forbidden"
    | "portal_not_found"
    | "no_change"
    | "version_conflict"
    | "public_metrics_update_failed"
}

export class AdvocatePublicMetricsDatabaseError extends Error {
  readonly postgresCode: string | undefined
  readonly postgresMessage: string | undefined

  constructor(cause: Readonly<{ code?: string; message?: string }> | null) {
    super("advocate_public_metrics_database_failure", { cause })
    this.name = "AdvocatePublicMetricsDatabaseError"
    this.postgresCode = cause?.code
    this.postgresMessage = cause?.message
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

export function parseAdvocatePublicMetricsUpdateInput(
  rawBody: string,
): AdvocatePublicMetricsUpdateInput | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAX_ADVOCATE_PUBLIC_METRICS_BODY_BYTES
  ) {
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["expectedVersion", "metricKeys", "changeReason"]) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1 ||
    !Array.isArray(value.metricKeys) ||
    typeof value.changeReason !== "string"
  ) {
    return null
  }

  const metricKeys = normalizeAdvocatePublicMetricKeys(value.metricKeys)
  const changeReason = value.changeReason.trim()
  if (
    metricKeys === null ||
    changeReason.length < 1 ||
    changeReason.length > 500 ||
    CONTROL_CHARACTER_PATTERN.test(changeReason)
  ) {
    return null
  }

  return Object.freeze({
    expectedVersion: value.expectedVersion,
    metricKeys,
    changeReason,
  })
}

export async function readBoundedAdvocatePublicMetricsBody(
  request: Pick<Request, "body" | "headers">,
): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^[0-9]+$/.test(contentLength) ||
      Number(contentLength) > MAX_ADVOCATE_PUBLIC_METRICS_BODY_BYTES)
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
      if (totalBytes > MAX_ADVOCATE_PUBLIC_METRICS_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
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

export function parseAdvocatePublicMetricsUpdateResult(
  value: unknown,
  expectedVersion: number,
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value === expectedVersion + 1
    ? value
    : null
}

export function classifyAdvocatePublicMetricsUpdateFailure(
  postgresCode: string | undefined,
  postgresMessage: string | undefined,
): AdvocatePublicMetricsUpdateFailure {
  if (
    postgresCode === "22023" &&
    postgresMessage === "Public metric selection is unchanged"
  ) {
    return { status: 409, code: "no_change" }
  }
  switch (postgresCode) {
    case "22023":
    case "23514":
      return { status: 400, code: "invalid_request" }
    case "28000":
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
      return { status: 404, code: "portal_not_found" }
    case "40001":
    case "55000":
      return { status: 409, code: "version_conflict" }
    default:
      return { status: 500, code: "public_metrics_update_failed" }
  }
}

export async function replaceAdvocatePublicMetrics(
  client: SupabaseClient,
  mutation: {
    advocateId: string
    actorUserId: string
    input: AdvocatePublicMetricsUpdateInput
    requestId: string
    traceId: string
    sessionId: null
  },
): Promise<number> {
  if (
    !UUID_PATTERN.test(mutation.advocateId) ||
    !UUID_PATTERN.test(mutation.actorUserId) ||
    !UUID_PATTERN.test(mutation.requestId) ||
    !UUID_PATTERN.test(mutation.traceId)
  ) {
    throw new AdvocatePublicMetricsDatabaseError(null)
  }

  const { data, error } = await client.rpc("replace_advocate_public_metrics", {
    target_advocate_id: mutation.advocateId,
    acting_user_id: mutation.actorUserId,
    expected_advocate_version: mutation.input.expectedVersion,
    target_metric_keys: mutation.input.metricKeys,
    change_reason: mutation.input.changeReason,
    request_id: mutation.requestId,
    trace_id: mutation.traceId,
    session_id: mutation.sessionId,
  })
  if (error) throw new AdvocatePublicMetricsDatabaseError(error)

  const version = parseAdvocatePublicMetricsUpdateResult(
    data,
    mutation.input.expectedVersion,
  )
  if (version === null) throw new AdvocatePublicMetricsDatabaseError(null)
  return version
}
