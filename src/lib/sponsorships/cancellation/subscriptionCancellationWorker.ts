import "server-only"

import {
  digestSubscriptionCancellationProviderEvidence,
  type ClaimedSubscriptionCancellation,
  type SettledSubscriptionCancellation,
  type SubscriptionCancellationProviderOutcome,
  type SubscriptionCancellationRequestContext,
} from "@/lib/sponsorships/cancellation/subscriptionCancellation"

export interface SubscriptionCancellationWorkerConfig {
  batchSize: number
  concurrency: number
  providerTimeoutMilliseconds: number
  invocationSafetyMarginMilliseconds: number
}

export interface SubscriptionCancellationWorkerRepository {
  listCandidates(batchSize: number): Promise<string[]>
  claim(
    operationId: string,
    context: SubscriptionCancellationRequestContext,
  ): Promise<ClaimedSubscriptionCancellation>
  settle(
    operationId: string,
    leaseToken: string,
    outcome: SubscriptionCancellationProviderOutcome,
    evidenceSha256: string,
    context: SubscriptionCancellationRequestContext,
  ): Promise<SettledSubscriptionCancellation>
}

export interface SubscriptionCancellationWorkerDependencies {
  repository: SubscriptionCancellationWorkerRepository
  cancelProvider(
    claim: ClaimedSubscriptionCancellation,
  ): Promise<SubscriptionCancellationProviderOutcome>
  now?: () => number
}

export type SubscriptionCancellationWorkerItemStatus =
  | "cancelled"
  | "retry_scheduled"
  | "manual_review"
  | "already_processing"
  | "deferred"
  | "claim_failed"
  | "settlement_unknown"

export interface SubscriptionCancellationWorkerItemResult {
  operationId: string
  status: SubscriptionCancellationWorkerItemStatus
}

export interface SubscriptionCancellationWorkerBatchResult {
  candidates: number
  cancelled: number
  retryScheduled: number
  manualReview: number
  alreadyProcessing: number
  deferred: number
  claimFailed: number
  settlementUnknown: number
  results: SubscriptionCancellationWorkerItemResult[]
}

function canStartProviderCall(options: {
  now: () => number
  invocationDeadlineAt: number
  config: SubscriptionCancellationWorkerConfig
}): boolean {
  return (
    options.now() +
      options.config.providerTimeoutMilliseconds +
      options.config.invocationSafetyMarginMilliseconds <=
    options.invocationDeadlineAt
  )
}

async function processCandidate(options: {
  operationId: string
  context: SubscriptionCancellationRequestContext
  invocationDeadlineAt: number
  config: SubscriptionCancellationWorkerConfig
  dependencies: SubscriptionCancellationWorkerDependencies
  now: () => number
}): Promise<SubscriptionCancellationWorkerItemResult> {
  if (!canStartProviderCall(options)) {
    return { operationId: options.operationId, status: "deferred" }
  }

  let claim: ClaimedSubscriptionCancellation
  try {
    claim = await options.dependencies.repository.claim(
      options.operationId,
      options.context,
    )
  } catch {
    return { operationId: options.operationId, status: "claim_failed" }
  }

  if (claim.leaseToken === null) {
    if (claim.status === "cancelled") {
      return { operationId: options.operationId, status: "cancelled" }
    }
    if (claim.status === "manual_review") {
      return { operationId: options.operationId, status: "manual_review" }
    }
    return { operationId: options.operationId, status: "already_processing" }
  }

  let outcome: SubscriptionCancellationProviderOutcome
  try {
    outcome = await options.dependencies.cancelProvider(claim)
  } catch {
    return { operationId: options.operationId, status: "settlement_unknown" }
  }

  const evidenceSha256 = digestSubscriptionCancellationProviderEvidence(
    claim.operationId,
    outcome.evidence,
  )
  let settled: SettledSubscriptionCancellation
  try {
    settled = await options.dependencies.repository.settle(
      claim.operationId,
      claim.leaseToken,
      outcome,
      evidenceSha256,
      options.context,
    )
  } catch {
    return { operationId: options.operationId, status: "settlement_unknown" }
  }

  if (settled.status === "cancelled") {
    return { operationId: options.operationId, status: "cancelled" }
  }
  if (settled.status === "manual_review") {
    return { operationId: options.operationId, status: "manual_review" }
  }
  return { operationId: options.operationId, status: "retry_scheduled" }
}

export async function runSubscriptionCancellationWorkerBatch(options: {
  config: SubscriptionCancellationWorkerConfig
  context: SubscriptionCancellationRequestContext
  invocationDeadlineAt: number
  dependencies: SubscriptionCancellationWorkerDependencies
}): Promise<SubscriptionCancellationWorkerBatchResult> {
  const now = options.dependencies.now ?? Date.now
  const operationIds = await options.dependencies.repository.listCandidates(
    options.config.batchSize,
  )
  if (operationIds.length > options.config.batchSize) {
    throw new Error("Cancellation candidate boundary exceeded its batch size")
  }

  const results: SubscriptionCancellationWorkerItemResult[] = []
  let cursor = 0
  const consume = async () => {
    while (cursor < operationIds.length) {
      const index = cursor
      cursor += 1
      results[index] = await processCandidate({
        operationId: operationIds[index],
        context: options.context,
        invocationDeadlineAt: options.invocationDeadlineAt,
        config: options.config,
        dependencies: options.dependencies,
        now,
      })
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(options.config.concurrency, operationIds.length) },
      consume,
    ),
  )

  return {
    candidates: operationIds.length,
    cancelled: results.filter((result) => result.status === "cancelled").length,
    retryScheduled: results.filter(
      (result) => result.status === "retry_scheduled",
    ).length,
    manualReview: results.filter((result) => result.status === "manual_review")
      .length,
    alreadyProcessing: results.filter(
      (result) => result.status === "already_processing",
    ).length,
    deferred: results.filter((result) => result.status === "deferred").length,
    claimFailed: results.filter((result) => result.status === "claim_failed")
      .length,
    settlementUnknown: results.filter(
      (result) => result.status === "settlement_unknown",
    ).length,
    results,
  }
}
