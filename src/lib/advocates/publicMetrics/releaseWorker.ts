import "server-only"

export const ADVOCATE_PUBLIC_METRIC_RELEASE_POLICY_VERSION = "public-v1"

const RFC3339_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

export interface AdvocatePublicMetricReleaseWorkerContext {
  requestId: string
  traceId: string | null
}

export interface AdvocatePublicMetricReleaseSummary {
  processedAdvocates: number
  insertedReleases: number
  pendingMetrics: number
  sourceCutoff: string
  policyVersion: typeof ADVOCATE_PUBLIC_METRIC_RELEASE_POLICY_VERSION
}

export interface AdvocatePublicMetricReleaseRpcExecutor {
  refresh(
    batchSize: number,
    context: AdvocatePublicMetricReleaseWorkerContext,
    signal: AbortSignal,
  ): Promise<unknown>
}

export interface RunAdvocatePublicMetricReleaseWorkerOptions {
  batchSize: number
  rpcTimeoutMilliseconds: number
  executor: AdvocatePublicMetricReleaseRpcExecutor
  context: AdvocatePublicMetricReleaseWorkerContext
  timeoutSignal?: (milliseconds: number) => AbortSignal
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

function boundedCount(value: unknown, maximum: number): number | null {
  return Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= maximum
    ? value
    : null
}

function sourceCutoff(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !RFC3339_UTC_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null
  }
  const date = new Date(value)
  return date.getUTCDay() === 1 &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
    ? value
    : null
}

export function parseAdvocatePublicMetricReleaseSummary(
  value: unknown,
  batchSize: number,
): AdvocatePublicMetricReleaseSummary {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100 ||
    !isRecord(value) ||
    !exactKeys(value, [
      "inserted_releases",
      "pending_metrics",
      "policy_version",
      "processed_advocates",
      "source_cutoff",
    ])
  ) {
    throw new Error("Advocate public metric release result is invalid")
  }

  const processedAdvocates = boundedCount(value.processed_advocates, batchSize)
  const maximumMetrics = batchSize * 4
  const insertedReleases = boundedCount(value.inserted_releases, maximumMetrics)
  const pendingMetrics = boundedCount(value.pending_metrics, maximumMetrics)
  const cutoff = sourceCutoff(value.source_cutoff)
  if (
    processedAdvocates === null ||
    insertedReleases === null ||
    pendingMetrics === null ||
    cutoff === null ||
    value.policy_version !== ADVOCATE_PUBLIC_METRIC_RELEASE_POLICY_VERSION ||
    insertedReleases + pendingMetrics !== processedAdvocates * 4
  ) {
    throw new Error("Advocate public metric release result is invalid")
  }

  return Object.freeze({
    processedAdvocates,
    insertedReleases,
    pendingMetrics,
    sourceCutoff: cutoff,
    policyVersion: ADVOCATE_PUBLIC_METRIC_RELEASE_POLICY_VERSION,
  })
}

export async function runAdvocatePublicMetricReleaseWorker(
  options: RunAdvocatePublicMetricReleaseWorkerOptions,
): Promise<AdvocatePublicMetricReleaseSummary> {
  if (
    !Number.isSafeInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 100 ||
    !Number.isSafeInteger(options.rpcTimeoutMilliseconds) ||
    options.rpcTimeoutMilliseconds < 1_000 ||
    options.rpcTimeoutMilliseconds > 50_000
  ) {
    throw new Error("Advocate public metric release worker is unavailable")
  }

  const timeoutSignal = options.timeoutSignal ?? AbortSignal.timeout
  const result = await options.executor.refresh(
    options.batchSize,
    options.context,
    timeoutSignal(options.rpcTimeoutMilliseconds),
  )
  return parseAdvocatePublicMetricReleaseSummary(result, options.batchSize)
}
