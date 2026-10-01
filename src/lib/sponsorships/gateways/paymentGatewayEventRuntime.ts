import "server-only"

import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import { createSupabasePaymentGatewayEventRepository } from "@/lib/sponsorships/gateways/paymentGatewayEventRepository"
import {
  runPaymentGatewayEventBatch,
  type PaymentGatewayEventBatchResult,
  type PaymentGatewayEventWorkerConfig,
  type PaymentGatewayWorkerContext,
} from "@/lib/sponsorships/gateways/paymentGatewayEventWorker"
import { createServiceRoleClient } from "@/utils/supabase/server"
import { replayDurableLegacyStripeEvent } from "@/app/api/webhooks/stripe/handler"

export async function runPaymentGatewayEventBatchFromEnvironment(options: {
  config: PaymentGatewayEventWorkerConfig
  workerId: string
  context: PaymentGatewayWorkerContext
}): Promise<PaymentGatewayEventBatchResult> {
  const repository = createSupabasePaymentGatewayEventRepository(
    createServiceRoleClient(),
    createSponsorshipCryptoFromEnvironment(),
    {
      async processLegacyStripeEvent(input) {
        const response = await replayDurableLegacyStripeEvent(input)
        return { status: response.status }
      },
    },
  )
  return runPaymentGatewayEventBatch({ repository, ...options })
}

export interface PaymentFailureHealth {
  unresolved: number
  unacknowledged: number
  quarantined: number
  exhausted: number
  expired_final_leases: number
  payloads_expiring_within_seven_days: number
  payloads_unavailable: number
  cash_without_gateway_event: number
  stale_cash_without_gateway_event: number
}

export async function readPaymentFailureHealth(): Promise<PaymentFailureHealth> {
  const { data, error } = await createServiceRoleClient({ requestTimeoutMilliseconds: 15_000 })
    .rpc("get_payment_failure_health")
  const keys = ["unresolved", "unacknowledged", "quarantined", "exhausted",
    "expired_final_leases", "payloads_expiring_within_seven_days", "payloads_unavailable",
    "cash_without_gateway_event", "stale_cash_without_gateway_event"] as const
  if (error || !data || typeof data !== "object" || Array.isArray(data) ||
      keys.some(key => !Number.isSafeInteger(data[key]) || data[key] < 0) ||
      data.unresolved !== data.quarantined + data.exhausted + data.expired_final_leases ||
      data.unacknowledged > data.unresolved ||
      data.stale_cash_without_gateway_event > data.cash_without_gateway_event ||
      data.payloads_expiring_within_seven_days + data.payloads_unavailable > data.unresolved) {
    throw new Error("Payment failure health unavailable")
  }
  // Copy the fixed projection so provider identifiers cannot enter worker responses.
  return Object.fromEntries(keys.map(key => [key, data[key]])) as unknown as PaymentFailureHealth
}
