import "server-only"

import type { PaymentGatewayEventWorkerConfig } from "@/lib/sponsorships/gateways/paymentGatewayEventWorker"

export type PaymentGatewayEventWorkerEnvironment = Readonly<
  Record<string, string | undefined>
>

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === "") return fallback
  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid payment gateway event worker configuration")
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("Invalid payment gateway event worker configuration")
  }
  return parsed
}

export function loadPaymentGatewayEventWorkerConfig(
  environment: PaymentGatewayEventWorkerEnvironment = process.env,
): PaymentGatewayEventWorkerConfig {
  return {
    batchSize: boundedInteger(
      environment.PAYMENT_GATEWAY_EVENT_BATCH_SIZE,
      20,
      1,
      100,
    ),
    concurrency: boundedInteger(
      environment.PAYMENT_GATEWAY_EVENT_CONCURRENCY,
      4,
      1,
      10,
    ),
  }
}

export function loadPaymentGatewayEventWorkerSecret(
  environment: PaymentGatewayEventWorkerEnvironment = process.env,
): string {
  const configuredSecret = environment.PAYMENT_GATEWAY_EVENT_WORKER_SECRET
  const secret =
    configuredSecret === undefined || configuredSecret === ""
      ? environment.CRON_SECRET
      : configuredSecret
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret.length > 1024 ||
    secret !== secret.trim()
  ) {
    throw new Error("Payment gateway event worker secret is unavailable")
  }
  return secret
}
