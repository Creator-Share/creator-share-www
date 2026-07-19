import "server-only"

import type { ArchivedAdvocateDomainCleanupEnvironment } from "./auth"

export interface ArchivedAdvocateDomainCleanupWorkerConfig {
  batchSize: number
  rpcTimeoutMilliseconds: number
}

function configurationError(): never {
  throw new Error("Archived advocate domain cleanup worker is unavailable")
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

export function loadArchivedAdvocateDomainCleanupWorkerConfig(
  environment: ArchivedAdvocateDomainCleanupEnvironment = process.env,
): ArchivedAdvocateDomainCleanupWorkerConfig {
  return {
    batchSize: boundedInteger(
      environment.ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_BATCH_SIZE,
      25,
      1,
      50,
    ),
    rpcTimeoutMilliseconds: boundedInteger(
      environment.ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_RPC_TIMEOUT_MILLISECONDS,
      45_000,
      1_000,
      50_000,
    ),
  }
}
