import "server-only"

import type { AdvocateLogoReconciliationEnvironment } from "./auth"

export interface AdvocateLogoReconciliationWorkerConfig {
  batchSize: number
  concurrency: number
  storageTimeoutMilliseconds: number
  invocationSafetyMarginMilliseconds: number
}

function configurationError(): never {
  throw new Error("Advocate logo reconciliation worker is unavailable")
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

export function loadAdvocateLogoReconciliationWorkerConfig(
  environment: AdvocateLogoReconciliationEnvironment = process.env,
): AdvocateLogoReconciliationWorkerConfig {
  const config = {
    batchSize: boundedInteger(
      environment.ADVOCATE_LOGO_RECONCILIATION_BATCH_SIZE,
      4,
      1,
      20,
    ),
    concurrency: boundedInteger(
      environment.ADVOCATE_LOGO_RECONCILIATION_CONCURRENCY,
      2,
      1,
      4,
    ),
    storageTimeoutMilliseconds: boundedInteger(
      environment.ADVOCATE_LOGO_RECONCILIATION_STORAGE_TIMEOUT_MILLISECONDS,
      15_000,
      1_000,
      30_000,
    ),
    invocationSafetyMarginMilliseconds: boundedInteger(
      environment.ADVOCATE_LOGO_RECONCILIATION_INVOCATION_SAFETY_MARGIN_MILLISECONDS,
      5_000,
      1_000,
      15_000,
    ),
  }

  if (
    config.concurrency > config.batchSize ||
    config.storageTimeoutMilliseconds +
      config.invocationSafetyMarginMilliseconds >
      55_000
  ) {
    configurationError()
  }
  return config
}
