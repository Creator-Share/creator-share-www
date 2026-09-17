import "server-only"

import {
  createSubscriptionCancellationDependencies,
  type SubscriptionCancellationRpcClient,
} from "@/lib/sponsorships/cancellation/subscriptionCancellationRuntime"
import {
  runSubscriptionCancellationWorkerBatch,
  type SubscriptionCancellationWorkerBatchResult,
  type SubscriptionCancellationWorkerConfig,
} from "@/lib/sponsorships/cancellation/subscriptionCancellationWorker"
import type { SubscriptionCancellationRequestContext } from "@/lib/sponsorships/cancellation/subscriptionCancellation"
import { createServiceRoleClient } from "@/utils/supabase/server"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseCandidateOperationIds(data: unknown): string[] {
  if (!Array.isArray(data)) {
    throw new Error("Cancellation candidate lookup failed")
  }
  return data.map((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1
    ) {
      throw new Error("Cancellation candidate shape is invalid")
    }
    const operationId = (value as Record<string, unknown>)[
      "cancellation_operation_id"
    ]
    if (typeof operationId !== "string" || !UUID_PATTERN.test(operationId)) {
      throw new Error("Cancellation candidate shape is invalid")
    }
    return operationId.toLowerCase()
  })
}

export async function runSubscriptionCancellationWorkerBatchFromEnvironment(options: {
  config: SubscriptionCancellationWorkerConfig
  workerId: string
  context: SubscriptionCancellationRequestContext
  invocationDeadlineAt: number
  serviceClient?: SubscriptionCancellationRpcClient
}): Promise<SubscriptionCancellationWorkerBatchResult> {
  const serviceClient = options.serviceClient ?? createServiceRoleClient()
  const execution = createSubscriptionCancellationDependencies(
    serviceClient,
    serviceClient,
    options.config.providerTimeoutMilliseconds,
    options.workerId,
  )

  return runSubscriptionCancellationWorkerBatch({
    config: options.config,
    context: options.context,
    invocationDeadlineAt: options.invocationDeadlineAt,
    dependencies: {
      repository: {
        async listCandidates(batchSize) {
          const { data, error } = await serviceClient.rpc(
            "list_sponsorship_subscription_cancellation_candidates",
            { target_batch_size: batchSize },
          )
          if (error) throw new Error("Cancellation candidate lookup failed")
          return parseCandidateOperationIds(data)
        },
        claim: execution.claim,
        settle: execution.settle,
      },
      cancelProvider: execution.cancelProvider,
    },
  })
}
