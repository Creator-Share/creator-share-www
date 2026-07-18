import "server-only"

import type { SubscriptionCancellationWorkerConfig } from "@/lib/sponsorships/cancellation/subscriptionCancellationWorker"

export type SubscriptionCancellationWorkerEnvironment = Readonly<
  Record<string, string | undefined>
>

function configurationError(): never {
  throw new Error(
    "Subscription cancellation worker configuration is unavailable",
  )
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

export function loadSubscriptionCancellationWorkerConfig(
  environment: SubscriptionCancellationWorkerEnvironment = process.env,
): SubscriptionCancellationWorkerConfig {
  const config = {
    batchSize: boundedInteger(
      environment.SUBSCRIPTION_CANCELLATION_BATCH_SIZE,
      4,
      1,
      20,
    ),
    concurrency: boundedInteger(
      environment.SUBSCRIPTION_CANCELLATION_CONCURRENCY,
      2,
      1,
      4,
    ),
    providerTimeoutMilliseconds: boundedInteger(
      environment.SUBSCRIPTION_CANCELLATION_PROVIDER_TIMEOUT_MILLISECONDS,
      15_000,
      1_000,
      45_000,
    ),
    invocationSafetyMarginMilliseconds: boundedInteger(
      environment.SUBSCRIPTION_CANCELLATION_INVOCATION_SAFETY_MARGIN_MILLISECONDS,
      5_000,
      1_000,
      15_000,
    ),
  }
  if (
    config.concurrency > config.batchSize ||
    config.providerTimeoutMilliseconds +
      config.invocationSafetyMarginMilliseconds >
      55_000
  ) {
    configurationError()
  }
  return config
}

export function loadSubscriptionCancellationWorkerSecret(
  environment: SubscriptionCancellationWorkerEnvironment = process.env,
): string {
  const dedicated = environment.SUBSCRIPTION_CANCELLATION_WORKER_SECRET
  const secret =
    dedicated === undefined || dedicated === ""
      ? environment.CRON_SECRET
      : dedicated
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret.length > 1024 ||
    secret !== secret.trim()
  ) {
    configurationError()
  }
  return secret
}
