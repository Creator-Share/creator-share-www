import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LEASE_TOKEN_PATTERN = /^[0-9a-f]{64}$/
const LOGO_OBJECT_PATH_PATTERN =
  /^logos\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/

export interface AdvocateLogoReconciliationContext {
  requestId: string
  traceId: string | null
}

export interface ClaimedAdvocateLogoReconciliationJob {
  jobId: string
  reservationId: string
  advocateId: string
  objectPath: string
  leaseToken: string
  leaseExpiresAt: string
  attemptCount: number
  maximumAttempts: number
}

export type AdvocateLogoReconciliationAuthorization =
  | { outcome: "delete"; objectPath: string }
  | { outcome: "already_absent"; objectPath: null }
  | { outcome: "quarantined"; objectPath: null }
  | { outcome: "lease_lost"; objectPath: null }

export type AdvocateLogoReconciliationCompletion = "completed" | "quarantined"

export type AdvocateLogoReconciliationFailureResult =
  | { status: "retry_scheduled"; nextAttemptAt: string }
  | { status: "exhausted"; nextAttemptAt: null }

export type AdvocateLogoReconciliationFailureCode =
  | "storage_delete_failed"
  | "storage_rate_limited"
  | "storage_timeout"
  | "storage_unavailable"
  | "unexpected_storage_response"
  | "worker_interrupted"

export interface AdvocateLogoReconciliationRepository {
  claimJobs(input: {
    workerId: string
    batchSize: number
    context: AdvocateLogoReconciliationContext
  }): Promise<ClaimedAdvocateLogoReconciliationJob[]>
  authorizeDeletion(
    job: ClaimedAdvocateLogoReconciliationJob,
    context: AdvocateLogoReconciliationContext,
  ): Promise<AdvocateLogoReconciliationAuthorization>
  complete(
    job: ClaimedAdvocateLogoReconciliationJob,
    outcome: "deleted" | "already_absent",
    context: AdvocateLogoReconciliationContext,
  ): Promise<AdvocateLogoReconciliationCompletion>
  fail(
    job: ClaimedAdvocateLogoReconciliationJob,
    failureCode: AdvocateLogoReconciliationFailureCode,
    context: AdvocateLogoReconciliationContext,
  ): Promise<AdvocateLogoReconciliationFailureResult>
}

export class AdvocateLogoReconciliationRepositoryError extends Error {
  readonly stage: "claim" | "authorize" | "complete" | "fail"

  constructor(stage: AdvocateLogoReconciliationRepositoryError["stage"]) {
    super(`advocate_logo_reconciliation_${stage}_failed`)
    this.name = "AdvocateLogoReconciliationRepositoryError"
    this.stage = stage
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

function exactSingleRow(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null
  }
  return hasExactKeys(value[0], keys) ? value[0] : null
}

function parsedTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 20 || value.length > 64) {
    return null
  }
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null
}

function parseClaimedJob(
  value: unknown,
): ClaimedAdvocateLogoReconciliationJob | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "job_id",
      "reservation_id",
      "advocate_id",
      "object_path",
      "lease_token",
      "lease_expires_at",
      "attempt_count",
      "maximum_attempts",
    ])
  ) {
    return null
  }
  const objectPathMatch =
    typeof value.object_path === "string"
      ? LOGO_OBJECT_PATH_PATTERN.exec(value.object_path)
      : null
  const objectPath =
    typeof value.object_path === "string" ? value.object_path : null
  const leaseExpiresAt = parsedTimestamp(value.lease_expires_at)
  if (
    typeof value.job_id !== "string" ||
    !UUID_PATTERN.test(value.job_id) ||
    typeof value.reservation_id !== "string" ||
    !UUID_PATTERN.test(value.reservation_id) ||
    typeof value.advocate_id !== "string" ||
    !UUID_PATTERN.test(value.advocate_id) ||
    objectPath === null ||
    objectPathMatch === null ||
    objectPathMatch[1] !== value.reservation_id ||
    typeof value.lease_token !== "string" ||
    !LEASE_TOKEN_PATTERN.test(value.lease_token) ||
    leaseExpiresAt === null ||
    typeof value.attempt_count !== "number" ||
    !Number.isSafeInteger(value.attempt_count) ||
    value.attempt_count < 1 ||
    typeof value.maximum_attempts !== "number" ||
    !Number.isSafeInteger(value.maximum_attempts) ||
    value.maximum_attempts !== 8 ||
    value.attempt_count > value.maximum_attempts
  ) {
    return null
  }

  return Object.freeze({
    jobId: value.job_id,
    reservationId: value.reservation_id,
    advocateId: value.advocate_id,
    objectPath,
    leaseToken: value.lease_token,
    leaseExpiresAt,
    attemptCount: value.attempt_count,
    maximumAttempts: value.maximum_attempts,
  })
}

export function parseClaimedAdvocateLogoReconciliationJobs(
  value: unknown,
  batchSize: number,
): ClaimedAdvocateLogoReconciliationJob[] | null {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 20 ||
    !Array.isArray(value) ||
    value.length > batchSize
  ) {
    return null
  }
  const jobs = value.map(parseClaimedJob)
  if (jobs.some((job) => job === null)) return null
  const parsed = jobs as ClaimedAdvocateLogoReconciliationJob[]
  for (const key of [
    "jobId",
    "reservationId",
    "objectPath",
    "leaseToken",
  ] as const) {
    if (new Set(parsed.map((job) => job[key])).size !== parsed.length) {
      return null
    }
  }
  return parsed
}

export function parseAdvocateLogoReconciliationAuthorization(
  value: unknown,
  expectedObjectPath: string,
): AdvocateLogoReconciliationAuthorization | null {
  const row = exactSingleRow(value, ["outcome", "object_path"])
  if (row === null) return null
  if (row.outcome === "delete") {
    return row.object_path === expectedObjectPath &&
      LOGO_OBJECT_PATH_PATTERN.test(expectedObjectPath)
      ? { outcome: "delete", objectPath: expectedObjectPath }
      : null
  }
  if (
    (row.outcome === "already_absent" ||
      row.outcome === "quarantined" ||
      row.outcome === "lease_lost") &&
    row.object_path === null
  ) {
    return { outcome: row.outcome, objectPath: null }
  }
  return null
}

export function parseAdvocateLogoReconciliationCompletion(
  value: unknown,
): AdvocateLogoReconciliationCompletion | null {
  return value === "completed" || value === "quarantined" ? value : null
}

export function parseAdvocateLogoReconciliationFailureResult(
  value: unknown,
): AdvocateLogoReconciliationFailureResult | null {
  const row = exactSingleRow(value, ["status", "next_attempt_at"])
  if (row === null) return null
  if (row.status === "retry_scheduled") {
    const nextAttemptAt = parsedTimestamp(row.next_attempt_at)
    return nextAttemptAt === null
      ? null
      : { status: "retry_scheduled", nextAttemptAt }
  }
  return row.status === "exhausted" && row.next_attempt_at === null
    ? { status: "exhausted", nextAttemptAt: null }
    : null
}

function rpcFailure(
  stage: AdvocateLogoReconciliationRepositoryError["stage"],
): never {
  throw new AdvocateLogoReconciliationRepositoryError(stage)
}

export function createSupabaseAdvocateLogoReconciliationRepository(
  client: SupabaseClient,
): AdvocateLogoReconciliationRepository {
  return {
    async claimJobs({ workerId, batchSize, context }) {
      const { data, error } = await client.rpc(
        "claim_advocate_logo_reconciliation_jobs",
        {
          worker_id: workerId,
          batch_size: batchSize,
          request_id: context.requestId,
          trace_id: context.traceId,
        },
      )
      if (error) rpcFailure("claim")
      const jobs = parseClaimedAdvocateLogoReconciliationJobs(data, batchSize)
      if (jobs === null) rpcFailure("claim")
      return jobs
    },

    async authorizeDeletion(job, context) {
      const { data, error } = await client.rpc(
        "authorize_advocate_logo_reconciliation_deletion",
        {
          target_job_id: job.jobId,
          lease_token: job.leaseToken,
          request_id: context.requestId,
          trace_id: context.traceId,
        },
      )
      if (error) rpcFailure("authorize")
      const authorization = parseAdvocateLogoReconciliationAuthorization(
        data,
        job.objectPath,
      )
      if (authorization === null) rpcFailure("authorize")
      return authorization
    },

    async complete(job, outcome, context) {
      const { data, error } = await client.rpc(
        "complete_advocate_logo_reconciliation_job",
        {
          target_job_id: job.jobId,
          lease_token: job.leaseToken,
          target_outcome: outcome,
          request_id: context.requestId,
          trace_id: context.traceId,
        },
      )
      if (error) rpcFailure("complete")
      const completion = parseAdvocateLogoReconciliationCompletion(data)
      if (completion === null) rpcFailure("complete")
      return completion
    },

    async fail(job, failureCode, context) {
      const { data, error } = await client.rpc(
        "fail_advocate_logo_reconciliation_job",
        {
          target_job_id: job.jobId,
          lease_token: job.leaseToken,
          failure_code: failureCode,
          request_id: context.requestId,
          trace_id: context.traceId,
        },
      )
      if (error) rpcFailure("fail")
      const result = parseAdvocateLogoReconciliationFailureResult(data)
      if (result === null) rpcFailure("fail")
      return result
    },
  }
}
