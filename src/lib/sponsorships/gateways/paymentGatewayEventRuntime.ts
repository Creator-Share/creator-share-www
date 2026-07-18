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
