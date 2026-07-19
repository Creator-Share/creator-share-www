import "server-only"

export const DATA_RETENTION_CONTROL_RPC_TIMEOUT_MILLISECONDS = 2_000

export const DATA_RETENTION_STEPS = [
  { key: "checkout_contact_envelopes" },
  { key: "email_outbox_contact" },
  { key: "gateway_event_payloads" },
  { key: "audit_forensics" },
  { key: "sponsor_authentication" },
  { key: "advocate_tracking" },
] as const

export type DataRetentionStep = (typeof DATA_RETENTION_STEPS)[number]
export type DataRetentionStepKey = DataRetentionStep["key"]
export type DataRetentionRunStatus =
  "completed" | "completed_with_failures" | "start_failed" | "finalize_failed"

export interface DataRetentionWorkerConfig {
  batchSize: number
  rpcTimeoutMilliseconds: number
  invocationSafetyMarginMilliseconds: number
}

export interface DataRetentionWorkerContext {
  runId: string
  requestId: string
  traceId: string | null
}

export interface DataRetentionRpcExecutor {
  startRun(
    batchSize: number,
    signal: AbortSignal,
    context: DataRetentionWorkerContext,
  ): Promise<unknown>
  executeStep(
    stepKey: DataRetentionStepKey,
    batchSize: number,
    signal: AbortSignal,
    context: DataRetentionWorkerContext,
  ): Promise<unknown>
  finishRun(
    reportedFailedSteps: DataRetentionStepKey[],
    signal: AbortSignal,
    context: DataRetentionWorkerContext,
  ): Promise<unknown>
}

export interface DataRetentionCounts {
  advocateExposuresDeleted: number
  browserVisitorsDeleted: number
  gatewayEventPayloadsRedacted: number
  emailOutboxContactsRedacted: number
  checkoutContactEnvelopesErased: number
  checkoutContactEnvelopesSucceeded: number
  checkoutContactEnvelopesFailed: number
  checkoutContactEnvelopesCancelled: number
  checkoutContactEnvelopesExpired: number
  auditForensicsDeleted: number
  sponsorRecentAuthenticationReceiptsDeleted: number
  sponsorPasswordlessReservationsDeleted: number
  sponsorPasswordlessVerificationAttemptsDeleted: number
}

export interface DataRetentionWorkerResult {
  ok: boolean
  status: DataRetentionRunStatus
  completedSteps: DataRetentionStepKey[]
  failedSteps: DataRetentionStepKey[]
  backlogSteps: DataRetentionStepKey[]
  counts: DataRetentionCounts
  startFailed: boolean
  finalizeFailed: boolean
}

export interface RunDataRetentionWorkerOptions {
  config: DataRetentionWorkerConfig
  executor: DataRetentionRpcExecutor
  context: DataRetentionWorkerContext
  invocationDeadlineAt: number
  now?: () => number
  timeoutSignal?: (milliseconds: number) => AbortSignal
}

interface ParsedStepResult {
  hasMore: boolean
  oldestExpiredAt: string | null
}

interface ParsedFinishResult {
  status: "completed" | "completed_with_failures"
  completedSteps: DataRetentionStepKey[]
  failedSteps: DataRetentionStepKey[]
  backlogSteps: DataRetentionStepKey[]
}

function resultShapeError(): never {
  throw new Error("Data retention RPC returned an invalid aggregate")
}

function boundedCount(value: unknown, maximum: number): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > maximum
  ) {
    resultShapeError()
  }
  return parsed
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    resultShapeError()
  }
  return value as Record<string, unknown>
}

function singleRow(value: unknown): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value
  if (Array.isArray(value) && value.length !== 1) resultShapeError()
  return recordValue(candidate)
}

function validateStartResult(value: unknown, runId: string): void {
  if (typeof value === "string") {
    if (value !== runId) resultShapeError()
    return
  }
  const row = singleRow(value)
  if (row.run_id !== runId) resultShapeError()
}

function parseOldestExpiredAt(value: unknown, hasMore: boolean): string | null {
  if (value === null) {
    if (hasMore) resultShapeError()
    return null
  }
  if (!hasMore) resultShapeError()
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  ) {
    resultShapeError()
  }
  return value
}

function applyStepCounts(
  stepKey: DataRetentionStepKey,
  rawCounts: unknown,
  counts: DataRetentionCounts,
  batchSize: number,
): void {
  const row = recordValue(rawCounts)
  if (stepKey === "checkout_contact_envelopes") {
    const maximum = Math.min(batchSize, 500)
    const erased = boundedCount(row.erased_count, maximum)
    const succeeded = boundedCount(row.succeeded_count, maximum)
    const failed = boundedCount(row.failed_count, maximum)
    const cancelled = boundedCount(row.cancelled_count, maximum)
    const expired = boundedCount(row.expired_count, maximum)
    if (succeeded + failed + cancelled + expired !== erased) {
      resultShapeError()
    }
    counts.checkoutContactEnvelopesErased = erased
    counts.checkoutContactEnvelopesSucceeded = succeeded
    counts.checkoutContactEnvelopesFailed = failed
    counts.checkoutContactEnvelopesCancelled = cancelled
    counts.checkoutContactEnvelopesExpired = expired
    return
  }

  if (stepKey === "email_outbox_contact") {
    counts.emailOutboxContactsRedacted = boundedCount(
      row.redacted_count,
      batchSize,
    )
    return
  }
  if (stepKey === "gateway_event_payloads") {
    counts.gatewayEventPayloadsRedacted = boundedCount(
      row.redacted_count,
      batchSize,
    )
    return
  }
  if (stepKey === "audit_forensics") {
    counts.auditForensicsDeleted = boundedCount(row.deleted_count, batchSize)
    return
  }
  if (stepKey === "sponsor_authentication") {
    counts.sponsorRecentAuthenticationReceiptsDeleted = boundedCount(
      row.recent_auth_receipts_deleted,
      batchSize,
    )
    counts.sponsorPasswordlessReservationsDeleted = boundedCount(
      row.passwordless_reservations_deleted,
      batchSize,
    )
    counts.sponsorPasswordlessVerificationAttemptsDeleted = boundedCount(
      row.passwordless_verification_attempts_deleted,
      batchSize,
    )
    return
  }
  const exposuresDeleted = boundedCount(row.exposures_deleted, batchSize)
  const visitorsDeleted = boundedCount(row.visitors_deleted, batchSize)
  counts.advocateExposuresDeleted = exposuresDeleted
  counts.browserVisitorsDeleted = visitorsDeleted
}

function parseStepResult(
  stepKey: DataRetentionStepKey,
  value: unknown,
  counts: DataRetentionCounts,
  batchSize: number,
): ParsedStepResult {
  const row = singleRow(value)
  if (row.step_key !== stepKey || typeof row.has_more !== "boolean") {
    resultShapeError()
  }
  const oldestExpiredAt = parseOldestExpiredAt(
    row.oldest_expired_at,
    row.has_more,
  )
  applyStepCounts(stepKey, row.counts, counts, batchSize)
  return {
    hasMore: row.has_more,
    oldestExpiredAt,
  }
}

function parseStepArray(value: unknown): DataRetentionStepKey[] {
  if (!Array.isArray(value)) resultShapeError()
  const allowed = new Set<string>(DATA_RETENTION_STEPS.map((step) => step.key))
  const seen = new Set<string>()
  const result: DataRetentionStepKey[] = []
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item) || seen.has(item)) {
      resultShapeError()
    }
    seen.add(item)
    result.push(item as DataRetentionStepKey)
  }
  return result
}

function parseFinishResult(value: unknown): ParsedFinishResult {
  const row = singleRow(value)
  if (
    typeof row.status !== "string" ||
    !["completed", "completed_with_failures"].includes(row.status)
  ) {
    resultShapeError()
  }
  const completedSteps = parseStepArray(row.completed_steps)
  const failedSteps = parseStepArray(row.failed_steps)
  const backlogSteps = parseStepArray(row.backlog_steps)
  const completed = new Set(completedSteps)
  const failed = new Set(failedSteps)
  if (
    completedSteps.length + failedSteps.length !==
      DATA_RETENTION_STEPS.length ||
    completedSteps.some((step) => failed.has(step)) ||
    backlogSteps.some((step) => !completed.has(step) || failed.has(step))
  ) {
    resultShapeError()
  }

  const hasFailures = failedSteps.length > 0
  const expectedStatus = hasFailures ? "completed_with_failures" : "completed"
  if (row.status !== expectedStatus) resultShapeError()

  return {
    status: row.status as "completed" | "completed_with_failures",
    completedSteps,
    failedSteps,
    backlogSteps,
  }
}

function assertConfig(config: DataRetentionWorkerConfig): void {
  if (
    !Number.isSafeInteger(config.batchSize) ||
    config.batchSize < 1 ||
    config.batchSize > 5000 ||
    !Number.isSafeInteger(config.rpcTimeoutMilliseconds) ||
    config.rpcTimeoutMilliseconds < 1_000 ||
    config.rpcTimeoutMilliseconds > 10_000 ||
    !Number.isSafeInteger(config.invocationSafetyMarginMilliseconds) ||
    config.invocationSafetyMarginMilliseconds < 1_000 ||
    config.invocationSafetyMarginMilliseconds > 5_000 ||
    config.rpcTimeoutMilliseconds * DATA_RETENTION_STEPS.length +
      DATA_RETENTION_CONTROL_RPC_TIMEOUT_MILLISECONDS * 2 +
      config.invocationSafetyMarginMilliseconds >
      55_000
  ) {
    throw new Error("Data retention worker configuration is invalid")
  }
}

export function createEmptyDataRetentionCounts(): DataRetentionCounts {
  return {
    advocateExposuresDeleted: 0,
    browserVisitorsDeleted: 0,
    gatewayEventPayloadsRedacted: 0,
    emailOutboxContactsRedacted: 0,
    checkoutContactEnvelopesErased: 0,
    checkoutContactEnvelopesSucceeded: 0,
    checkoutContactEnvelopesFailed: 0,
    checkoutContactEnvelopesCancelled: 0,
    checkoutContactEnvelopesExpired: 0,
    auditForensicsDeleted: 0,
    sponsorRecentAuthenticationReceiptsDeleted: 0,
    sponsorPasswordlessReservationsDeleted: 0,
    sponsorPasswordlessVerificationAttemptsDeleted: 0,
  }
}

function reportIncompleteRun(
  context: DataRetentionWorkerContext,
  result: DataRetentionWorkerResult,
): void {
  console.error("DATA_RETENTION_RUN_REQUIRES_ATTENTION", {
    runId: context.runId,
    requestId: context.requestId,
    startFailed: result.startFailed,
    finalizeFailed: result.finalizeFailed,
    failedSteps: result.failedSteps,
    backlogSteps: result.backlogSteps,
  })
}

function controlTimeout(
  options: RunDataRetentionWorkerOptions,
  now: () => number,
): number {
  return Math.min(
    DATA_RETENTION_CONTROL_RPC_TIMEOUT_MILLISECONDS,
    options.invocationDeadlineAt -
      now() -
      options.config.invocationSafetyMarginMilliseconds,
  )
}

export async function runDataRetentionWorker(
  options: RunDataRetentionWorkerOptions,
): Promise<DataRetentionWorkerResult> {
  assertConfig(options.config)
  const now = options.now ?? Date.now
  const timeoutSignal = options.timeoutSignal ?? AbortSignal.timeout
  const completedSteps: DataRetentionStepKey[] = []
  const failedSteps: DataRetentionStepKey[] = []
  const backlogSteps: DataRetentionStepKey[] = []
  const counts = createEmptyDataRetentionCounts()

  try {
    const timeoutMilliseconds = controlTimeout(options, now)
    if (timeoutMilliseconds < 1) throw new Error("Control deadline elapsed")
    const value = await options.executor.startRun(
      options.config.batchSize,
      timeoutSignal(timeoutMilliseconds),
      options.context,
    )
    validateStartResult(value, options.context.runId)
  } catch {
    const result: DataRetentionWorkerResult = {
      ok: false,
      status: "start_failed",
      completedSteps,
      failedSteps: DATA_RETENTION_STEPS.map((step) => step.key),
      backlogSteps,
      counts,
      startFailed: true,
      finalizeFailed: false,
    }
    reportIncompleteRun(options.context, result)
    return result
  }

  for (const step of DATA_RETENTION_STEPS) {
    const remainingMilliseconds = options.invocationDeadlineAt - now()
    const requiredReserve =
      options.config.invocationSafetyMarginMilliseconds +
      DATA_RETENTION_CONTROL_RPC_TIMEOUT_MILLISECONDS
    if (remainingMilliseconds <= requiredReserve) {
      failedSteps.push(step.key)
      continue
    }

    const timeoutMilliseconds = Math.min(
      options.config.rpcTimeoutMilliseconds,
      remainingMilliseconds - requiredReserve,
    )
    const stepBatchSize =
      step.key === "checkout_contact_envelopes"
        ? Math.min(options.config.batchSize, 500)
        : options.config.batchSize
    try {
      const value = await options.executor.executeStep(
        step.key,
        stepBatchSize,
        timeoutSignal(timeoutMilliseconds),
        options.context,
      )
      const parsed = parseStepResult(step.key, value, counts, stepBatchSize)
      completedSteps.push(step.key)
      if (parsed.hasMore) backlogSteps.push(step.key)
      void parsed.oldestExpiredAt
    } catch {
      failedSteps.push(step.key)
    }
  }

  let finishResult: ParsedFinishResult
  try {
    const timeoutMilliseconds = controlTimeout(options, now)
    if (timeoutMilliseconds < 1) throw new Error("Control deadline elapsed")
    const value = await options.executor.finishRun(
      failedSteps,
      timeoutSignal(timeoutMilliseconds),
      options.context,
    )
    finishResult = parseFinishResult(value)
  } catch {
    const result: DataRetentionWorkerResult = {
      ok: false,
      status: "finalize_failed",
      completedSteps,
      failedSteps,
      backlogSteps,
      counts,
      startFailed: false,
      finalizeFailed: true,
    }
    reportIncompleteRun(options.context, result)
    return result
  }

  const result: DataRetentionWorkerResult = {
    ok:
      finishResult.status === "completed" &&
      finishResult.failedSteps.length === 0 &&
      finishResult.backlogSteps.length === 0,
    ...finishResult,
    counts,
    startFailed: false,
    finalizeFailed: false,
  }
  if (!result.ok) reportIncompleteRun(options.context, result)
  return result
}
