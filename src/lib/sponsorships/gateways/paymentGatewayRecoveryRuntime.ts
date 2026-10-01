import "server-only"

import { getStripeAccountLivemode, getStripeClient } from "@/lib/stripe/config"
import { createServiceRoleClient } from "@/utils/supabase/server"
import { recoverPaymentGatewayEvent } from "./paymentGatewayRecovery"
import { createStripeFinancialAdjustmentDependencies } from "./stripeFinancialAdjustmentsRuntime"
import { createPayPalWebhookDependencies, getConfiguredPayPalApiUrl } from "./paypalWebhookRuntime"

export function recoverPaymentGatewayEventFromEnvironment(eventId: string, operationId: string, requestId: string) {
  const supabase = createServiceRoleClient({ requestTimeoutMilliseconds: 8_000 })
  return recoverPaymentGatewayEvent(eventId, operationId, requestId, {
    async read(targetEventId, targetOperationId) {
      const { data, error } = await supabase.rpc("read_payment_gateway_event_recovery", {
        target_event_id: targetEventId, target_operation_id: targetOperationId,
      })
      if (error) throw new Error("Recovery state unavailable")
      return data
    },
    stripe(region) {
      const stripe = getStripeClient(region)
      return {
        livemode: getStripeAccountLivemode(region),
        dependencies: {
          ...createStripeFinancialAdjustmentDependencies(stripe, supabase),
          retrieveCharge: id => stripe.charges.retrieve(id, {}, { timeout: 10_000, maxNetworkRetries: 0 }),
          retrievePaymentIntent: id => stripe.paymentIntents.retrieve(id, {}, { timeout: 10_000, maxNetworkRetries: 0 }),
        },
      }
    },
    paypal: () => ({ dependencies: createPayPalWebhookDependencies(supabase), apiUrl: getConfiguredPayPalApiUrl() }),
    now: () => new Date(),
  })
}
