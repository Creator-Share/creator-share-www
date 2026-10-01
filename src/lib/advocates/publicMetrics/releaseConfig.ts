import "server-only"

import type { AdvocatePublicMetricReleaseEnvironment } from "./releaseAuth"

export interface AdvocatePublicMetricReleaseWorkerConfig {
  batchSize: number
  rpcTimeoutMilliseconds: number
}

function configurationError(): never {
  throw new Error("Advocate public metric release worker is unavailable")
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === "") return fallback
  if (!/^\d+$/.test(value)) configurationError()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    configurationError()
  }
  return parsed
}

export function loadAdvocatePublicMetricReleaseWorkerConfig(
  environment: AdvocatePublicMetricReleaseEnvironment = process.env,
): AdvocatePublicMetricReleaseWorkerConfig {
  return {
    batchSize: boundedInteger(
      environment.ADVOCATE_PUBLIC_METRIC_RELEASE_BATCH_SIZE,
      100,
      1,
      100,
    ),
    rpcTimeoutMilliseconds: boundedInteger(
      environment.ADVOCATE_PUBLIC_METRIC_RELEASE_RPC_TIMEOUT_MILLISECONDS,
      45_000,
      1_000,
      50_000,
    ),
  }
}
