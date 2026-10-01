import "server-only"

import type { AdvocateLogoReconciliationWorkerConfig } from "./config"
import type {
  AdvocateLogoReconciliationContext,
  AdvocateLogoReconciliationFailureCode,
  AdvocateLogoReconciliationRepository,
  ClaimedAdvocateLogoReconciliationJob,
} from "./repository"
import {
  AdvocateLogoReconciliationStorageError,
  type AdvocateLogoReconciliationStorage,
} from "./storage"

export type AdvocateLogoReconciliationItemStatus =
  | "deleted"
  | "already_absent"
  | "retried"
  | "exhausted"
  | "quarantined"
  | "lease_lost"
  | "settlement_unknown"

export interface AdvocateLogoReconciliationCounts {
  claimed: number
  deleted: number
  alreadyAbsent: number
  retried: number
  exhausted: number
  quarantined: number
  leaseLost: number
  settlementUnknown: number
}

export interface AdvocateLogoReconciliationWorkerDependencies {
  repository: AdvocateLogoReconciliationRepository
  storage: AdvocateLogoReconciliationStorage
  now?: () => number
}

function assertWorkerConfig(
  config: AdvocateLogoReconciliationWorkerConfig,
): void {
  if (
    !Number.isSafeInteger(config.batchSize) ||
    config.batchSize < 1 ||
    config.batchSize > 20 ||
    !Number.isSafeInteger(config.concurrency) ||
    config.concurrency < 1 ||
    config.concurrency > 4 ||
    config.concurrency > config.batchSize ||
    !Number.isSafeInteger(config.storageTimeoutMilliseconds) ||
    config.storageTimeoutMilliseconds < 1_000 ||
    config.storageTimeoutMilliseconds > 30_000 ||
    !Number.isSafeInteger(config.invocationSafetyMarginMilliseconds) ||
    config.invocationSafetyMarginMilliseconds < 1_000 ||
    config.invocationSafetyMarginMilliseconds > 15_000 ||
    config.storageTimeoutMilliseconds +
      config.invocationSafetyMarginMilliseconds >
      55_000
  ) {
    throw new Error(
      "Advocate logo reconciliation worker configuration is invalid",
    )
  }
}

function canStartStorageCall(options: {
  now: () => number
  invocationDeadlineAt: number
  config: AdvocateLogoReconciliationWorkerConfig
}): boolean {
  return (
    options.now() + options.config.storageTimeoutMilliseconds <=
    options.invocationDeadlineAt
  )
}

async function settleFailure(options: {
  repository: AdvocateLogoReconciliationRepository
  job: ClaimedAdvocateLogoReconciliationJob
  failureCode: AdvocateLogoReconciliationFailureCode
  context: AdvocateLogoReconciliationContext
}): Promise<AdvocateLogoReconciliationItemStatus> {
  try {
    const result = await options.repository.fail(
      options.job,
      options.failureCode,
      options.context,
    )
    return result.status === "retry_scheduled" ? "retried" : "exhausted"
  } catch {
    return "settlement_unknown"
  }
}

async function settleCompletion(options: {
  repository: AdvocateLogoReconciliationRepository
  job: ClaimedAdvocateLogoReconciliationJob
  outcome: "deleted" | "already_absent"
  context: AdvocateLogoReconciliationContext
}): Promise<AdvocateLogoReconciliationItemStatus> {
  try {
    const completion = await options.repository.complete(
      options.job,
      options.outcome,
      options.context,
    )
    return completion === "quarantined" ? "quarantined" : options.outcome
  } catch {
    return "settlement_unknown"
  }
}

async function processJob(options: {
  job: ClaimedAdvocateLogoReconciliationJob
  config: AdvocateLogoReconciliationWorkerConfig
  context: AdvocateLogoReconciliationContext
  invocationDeadlineAt: number
  dependencies: AdvocateLogoReconciliationWorkerDependencies
  now: () => number
}): Promise<AdvocateLogoReconciliationItemStatus> {
  if (!canStartStorageCall(options)) {
    return settleFailure({
      repository: options.dependencies.repository,
      job: options.job,
      failureCode: "worker_interrupted",
      context: options.context,
    })
  }

  let authorization
  try {
    authorization = await options.dependencies.repository.authorizeDeletion(
      options.job,
      options.context,
    )
  } catch {
    return "settlement_unknown"
  }

  if (authorization.outcome === "quarantined") return "quarantined"
  if (authorization.outcome === "lease_lost") return "lease_lost"
  if (authorization.outcome === "already_absent") {
    return settleCompletion({
      repository: options.dependencies.repository,
      job: options.job,
      outcome: "already_absent",
      context: options.context,
    })
  }

  if (!canStartStorageCall(options)) {
    return settleFailure({
      repository: options.dependencies.repository,
      job: options.job,
      failureCode: "worker_interrupted",
      context: options.context,
    })
  }

  let providerOutcome: "deleted" | "already_absent"
  try {
    providerOutcome = await options.dependencies.storage.deleteObject(
      authorization.objectPath,
    )
  } catch (error) {
    return settleFailure({
      repository: options.dependencies.repository,
      job: options.job,
      failureCode:
        error instanceof AdvocateLogoReconciliationStorageError
          ? error.failureCode
          : "storage_delete_failed",
      context: options.context,
    })
  }

  return settleCompletion({
    repository: options.dependencies.repository,
    job: options.job,
    outcome: providerOutcome,
    context: options.context,
  })
}

export function emptyAdvocateLogoReconciliationCounts(): AdvocateLogoReconciliationCounts {
  return {
    claimed: 0,
    deleted: 0,
    alreadyAbsent: 0,
    retried: 0,
    exhausted: 0,
    quarantined: 0,
    leaseLost: 0,
    settlementUnknown: 0,
  }
}

export async function runAdvocateLogoReconciliationBatch(options: {
  config: AdvocateLogoReconciliationWorkerConfig
  workerId: string
  context: AdvocateLogoReconciliationContext
  invocationDeadlineAt: number
  dependencies: AdvocateLogoReconciliationWorkerDependencies
}): Promise<AdvocateLogoReconciliationCounts> {
  assertWorkerConfig(options.config)
  const now = options.dependencies.now ?? Date.now
  const jobs = await options.dependencies.repository.claimJobs({
    workerId: options.workerId,
    batchSize: options.config.batchSize,
    context: options.context,
  })
  if (jobs.length > options.config.batchSize) {
    throw new Error("Advocate logo reconciliation claim exceeded its boundary")
  }

  const statuses: AdvocateLogoReconciliationItemStatus[] = []
  let cursor = 0
  const consume = async () => {
    while (cursor < jobs.length) {
      const index = cursor
      cursor += 1
      statuses[index] = await processJob({
        job: jobs[index],
        config: options.config,
        context: options.context,
        invocationDeadlineAt: options.invocationDeadlineAt,
        dependencies: options.dependencies,
        now,
      })
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(options.config.concurrency, jobs.length) },
      consume,
    ),
  )

  return {
    claimed: jobs.length,
    deleted: statuses.filter((status) => status === "deleted").length,
    alreadyAbsent: statuses.filter((status) => status === "already_absent")
      .length,
    retried: statuses.filter((status) => status === "retried").length,
    exhausted: statuses.filter((status) => status === "exhausted").length,
    quarantined: statuses.filter((status) => status === "quarantined").length,
    leaseLost: statuses.filter((status) => status === "lease_lost").length,
    settlementUnknown: statuses.filter(
      (status) => status === "settlement_unknown",
    ).length,
  }
}
