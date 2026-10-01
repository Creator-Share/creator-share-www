import "server-only"

import {
  DATA_RETENTION_CONTROL_RPC_TIMEOUT_MILLISECONDS,
  DATA_RETENTION_STEPS,
  type DataRetentionWorkerConfig,
} from "@/lib/retention/dataRetentionWorker"

export type DataRetentionEnvironment = Readonly<
  Record<string, string | undefined>
>

function configurationError(): never {
  throw new Error("Data retention worker configuration is unavailable")
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

export function loadDataRetentionWorkerConfig(
  environment: DataRetentionEnvironment = process.env,
): DataRetentionWorkerConfig {
  const config = {
    batchSize: boundedInteger(
      environment.DATA_RETENTION_BATCH_SIZE,
      5000,
      1,
      5000,
    ),
    rpcTimeoutMilliseconds: boundedInteger(
      environment.DATA_RETENTION_RPC_TIMEOUT_MILLISECONDS,
      7_500,
      1_000,
      10_000,
    ),
    invocationSafetyMarginMilliseconds: boundedInteger(
      environment.DATA_RETENTION_INVOCATION_SAFETY_MARGIN_MILLISECONDS,
      5_000,
      1_000,
      5_000,
    ),
  }

  if (
    config.rpcTimeoutMilliseconds * DATA_RETENTION_STEPS.length +
      DATA_RETENTION_CONTROL_RPC_TIMEOUT_MILLISECONDS * 2 +
      config.invocationSafetyMarginMilliseconds >
    55_000
  ) {
    configurationError()
  }
  return config
}

export function loadDataRetentionWorkerSecret(
  environment: DataRetentionEnvironment = process.env,
): string {
  const dedicated = environment.DATA_RETENTION_WORKER_SECRET
  if (environment.VERCEL === "1" && dedicated) configurationError()
  const secret =
    dedicated === undefined || dedicated === ""
      ? environment.CRON_SECRET
      : dedicated
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret.length > 1024 ||
    secret !== secret.trim() ||
    /[\u0000-\u001f\u007f\s]/.test(secret)
  ) {
    configurationError()
  }
  return secret
}
