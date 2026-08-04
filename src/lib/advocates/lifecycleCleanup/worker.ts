import "server-only"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const COORDINATOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/

const CLEANUP_PHASES = [
  "quiescing",
  "cloudflare_dns_removal",
  "vercel_removal",
  "stripe_us_removal",
  "stripe_uk_removal",
  "paypal_removal",
  "complete",
  "needs_attention",
] as const

type CleanupPhase = (typeof CLEANUP_PHASES)[number]

export interface ArchivedAdvocateDomainCleanupSummary {
  processedDomains: number
  jobsEnqueued: number
  quiescingDomains: number
  cloudflareDnsRemoval: number
  providerCleanup: number
  blockedDomains: number
}

export interface ArchivedAdvocateDomainCleanupRpcExecutor {
  coordinate(
    batchSize: number,
    coordinatorId: string,
    signal: AbortSignal,
  ): Promise<unknown>
}

export interface RunArchivedAdvocateDomainCleanupWorkerOptions {
  batchSize: number
  rpcTimeoutMilliseconds: number
  coordinatorId: string
  executor: ArchivedAdvocateDomainCleanupRpcExecutor
  timeoutSignal?: (milliseconds: number) => AbortSignal
}

interface CleanupRow {
  domainId: string
  phase: CleanupPhase
  jobsEnqueued: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(
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

function cleanupPhase(value: unknown): CleanupPhase | null {
  return typeof value === "string" &&
    (CLEANUP_PHASES as readonly string[]).includes(value)
    ? (value as CleanupPhase)
    : null
}

function parseCleanupRow(value: unknown): CleanupRow | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "advocate_id",
      "cleanup_complete",
      "domain_id",
      "jobs_enqueued",
      "phase",
    ])
  ) {
    return null
  }

  const phase = cleanupPhase(value.phase)
  if (
    typeof value.advocate_id !== "string" ||
    !UUID_PATTERN.test(value.advocate_id) ||
    typeof value.domain_id !== "string" ||
    !UUID_PATTERN.test(value.domain_id) ||
    phase === null ||
    typeof value.jobs_enqueued !== "number" ||
    !Number.isSafeInteger(value.jobs_enqueued) ||
    value.jobs_enqueued < 0 ||
    value.jobs_enqueued > 1 ||
    typeof value.cleanup_complete !== "boolean"
  ) {
    return null
  }

  const complete = phase === "complete"
  const inactive =
    complete || phase === "quiescing" || phase === "needs_attention"
  const validJobs =
    inactive && value.jobs_enqueued === 0
      ? true
      : !inactive && value.jobs_enqueued <= 1
  if (value.cleanup_complete !== complete || !validJobs) return null

  return {
    domainId: value.domain_id,
    phase,
    jobsEnqueued: value.jobs_enqueued,
  }
}

export function emptyArchivedAdvocateDomainCleanupSummary(): ArchivedAdvocateDomainCleanupSummary {
  return {
    processedDomains: 0,
    jobsEnqueued: 0,
    quiescingDomains: 0,
    cloudflareDnsRemoval: 0,
    providerCleanup: 0,
    blockedDomains: 0,
  }
}

export function parseArchivedAdvocateDomainCleanupSummary(
  value: unknown,
  batchSize: number,
): ArchivedAdvocateDomainCleanupSummary {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 50 ||
    !Array.isArray(value) ||
    value.length > batchSize
  ) {
    throw new Error("Archived advocate domain cleanup result is invalid")
  }

  const rows = value.map(parseCleanupRow)
  if (
    rows.some((row) => row === null) ||
    new Set(rows.map((row) => (row === null ? "invalid" : row.domainId)))
      .size !== rows.length
  ) {
    throw new Error("Archived advocate domain cleanup result is invalid")
  }

  const summary = emptyArchivedAdvocateDomainCleanupSummary()
  for (const row of rows as CleanupRow[]) {
    summary.processedDomains += 1
    summary.jobsEnqueued += row.jobsEnqueued
    summary.quiescingDomains += row.phase === "quiescing" ? 1 : 0
    summary.cloudflareDnsRemoval +=
      row.phase === "cloudflare_dns_removal" ? 1 : 0
    summary.providerCleanup +=
      row.phase === "vercel_removal" ||
      row.phase === "stripe_us_removal" ||
      row.phase === "stripe_uk_removal" ||
      row.phase === "paypal_removal"
        ? 1
        : 0
    summary.blockedDomains += row.phase === "needs_attention" ? 1 : 0
  }

  return Object.freeze(summary)
}

export async function runArchivedAdvocateDomainCleanupWorker(
  options: RunArchivedAdvocateDomainCleanupWorkerOptions,
): Promise<ArchivedAdvocateDomainCleanupSummary> {
  if (
    !Number.isSafeInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 50 ||
    !Number.isSafeInteger(options.rpcTimeoutMilliseconds) ||
    options.rpcTimeoutMilliseconds < 1_000 ||
    options.rpcTimeoutMilliseconds > 50_000 ||
    options.coordinatorId.length < 1 ||
    options.coordinatorId.length > 128 ||
    !COORDINATOR_ID_PATTERN.test(options.coordinatorId)
  ) {
    throw new Error("Archived advocate domain cleanup worker is unavailable")
  }

  const timeoutSignal = options.timeoutSignal ?? AbortSignal.timeout
  const result = await options.executor.coordinate(
    options.batchSize,
    options.coordinatorId,
    timeoutSignal(options.rpcTimeoutMilliseconds),
  )
  return parseArchivedAdvocateDomainCleanupSummary(result, options.batchSize)
}
