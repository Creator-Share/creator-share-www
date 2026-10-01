import "server-only"

import {
  cancelClaimedSubscriptionWithProvider,
  DEFAULT_SUBSCRIPTION_CANCELLATION_PROVIDER_TIMEOUT_MILLISECONDS,
  executeSubscriptionCancellation,
  parseBegunSubscriptionCancellation,
  parseClaimedSubscriptionCancellation,
  parseSettledSubscriptionCancellation,
  subscriptionCancellationRpcFailure,
  SubscriptionCancellationBoundaryError,
  type SafeSubscriptionCancellationResponse,
  type SubscriptionCancellationDependencies,
  type SubscriptionCancellationRequestContext,
  type StripeSubscriptionCancellationClient,
} from "@/lib/sponsorships/cancellation/subscriptionCancellation"
import { paypalFetch } from "@/lib/paypal/client"
import { getStripeClient } from "@/lib/stripe/config"

interface RpcError {
  code?: string
  message?: string
}

interface RpcResult {
  data: unknown
  error: RpcError | null
}

export interface SubscriptionCancellationRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>
}

function stripeClientForScope(
  providerAccountScope: string,
): StripeSubscriptionCancellationClient {
  if (providerAccountScope === "stripe_us") return getStripeClient("us")
  if (providerAccountScope === "stripe_uk") return getStripeClient("uk")
  throw new SubscriptionCancellationBoundaryError("unavailable", 503)
}

export function createSubscriptionCancellationDependencies(
  authenticatedClient: SubscriptionCancellationRpcClient,
  serviceClient: SubscriptionCancellationRpcClient,
  providerTimeoutMilliseconds = DEFAULT_SUBSCRIPTION_CANCELLATION_PROVIDER_TIMEOUT_MILLISECONDS,
  leaseOwner: string | null = null,
): SubscriptionCancellationDependencies {
  return {
    async begin(subscriptionId, reason, context) {
      const { data, error } = await authenticatedClient.rpc(
        "begin_sponsorship_subscription_cancellation",
        {
          target_subscription_id: subscriptionId,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
          context_client_ip: context.clientIp,
          context_user_agent: context.userAgent,
          request_reason: reason,
        },
      )
      if (error) subscriptionCancellationRpcFailure(error)
      return parseBegunSubscriptionCancellation(data)
    },

    async claim(operationId, context) {
      const { data, error } = await serviceClient.rpc(
        "claim_sponsorship_subscription_cancellation",
        {
          target_cancellation_operation_id: operationId,
          target_lease_owner:
            leaseOwner ?? `subscription-cancel/${context.requestId}`,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
          context_client_ip: context.clientIp,
          context_user_agent: context.userAgent,
        },
      )
      if (error) subscriptionCancellationRpcFailure(error)
      return parseClaimedSubscriptionCancellation(data)
    },

    async cancelProvider(claim) {
      return cancelClaimedSubscriptionWithProvider(claim, {
        stripeClientForScope,
        paypal: {
          request(path, init) {
            return paypalFetch(path, init)
          },
        },
        timeoutMilliseconds: providerTimeoutMilliseconds,
      })
    },

    async settle(operationId, leaseToken, outcome, evidenceSha256, context) {
      const { data, error } = await serviceClient.rpc(
        "settle_sponsorship_subscription_cancellation",
        {
          target_cancellation_operation_id: operationId,
          target_processing_lease_token: leaseToken,
          target_provider_result: outcome.result,
          target_provider_evidence_sha256: evidenceSha256,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
          context_client_ip: context.clientIp,
          context_user_agent: context.userAgent,
        },
      )
      if (error) subscriptionCancellationRpcFailure(error)
      return parseSettledSubscriptionCancellation(data)
    },
  }
}

export async function cancelSponsorSubscription(options: {
  subscriptionId: string
  reason: string | null
  context: SubscriptionCancellationRequestContext
  authenticatedClient: SubscriptionCancellationRpcClient
  serviceClient: SubscriptionCancellationRpcClient
}): Promise<SafeSubscriptionCancellationResponse> {
  return executeSubscriptionCancellation(
    options.subscriptionId,
    options.reason,
    options.context,
    createSubscriptionCancellationDependencies(
      options.authenticatedClient,
      options.serviceClient,
    ),
  )
}
