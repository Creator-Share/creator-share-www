import type { DomainProviderAdapterFactory } from "./adapters"
import type { DomainWorkerConfig } from "./config"
import {
  DomainProvisioningRepositoryError,
  type DomainProvisioningRepository,
} from "./repository"
import {
  asDomainProvisioningError,
  DomainProvisioningError,
  mergeProviderEvidence,
  type ClaimedDomainProvisioningJob,
  type SafeProviderEvidence,
} from "./types"
import {
  assertClaimedJob,
  assertContextMatchesJob,
  assertSafeProviderEvidence,
} from "./validation"

export type DomainJobProcessStatus =
  | "succeeded"
  | "retried"
  | "failed"
  | "lease_lost"
  | "settlement_unknown"

export interface DomainJobProcessResult {
  jobId: string
  status: DomainJobProcessStatus
  code?: string
}

export interface DomainWorkerBatchResult {
  claimed: number
  succeeded: number
  retried: number
  failed: number
  leaseLost: number
  settlementUnknown: number
  results: DomainJobProcessResult[]
}

function repositoryFailure(
  error: DomainProvisioningRepositoryError,
): DomainProvisioningError {
  const persistentContextFailure =
    error.stage === "advocate_missing" ||
    error.stage === "domain_missing" ||
    error.stage === "integration_missing" ||
    error.stage.endsWith("_shape")

  return new DomainProvisioningError({
    code: persistentContextFailure
      ? "worker_repository_contract_invalid"
      : "worker_repository_error",
    retryable: !persistentContextFailure,
    cause: error,
  })
}

function calculateRetryDelaySeconds(
  job: ClaimedDomainProvisioningJob,
  requestedDelay?: number,
): number {
  if (requestedDelay !== undefined) {
    return Math.max(1, Math.min(86_400, Math.ceil(requestedDelay)))
  }

  const exponential = 15 * 2 ** Math.max(0, job.attemptCount - 1)
  return Math.min(3_600, exponential)
}

async function settleFailure(options: {
  repository: DomainProvisioningRepository
  job: ClaimedDomainProvisioningJob
  error: DomainProvisioningError
}): Promise<DomainJobProcessResult> {
  const { repository, job, error } = options
  const evidence = assertSafeProviderEvidence(error.evidence)

  try {
    if (error.retryable) {
      const status = await repository.retry(
        job,
        calculateRetryDelaySeconds(job, error.retryAfterSeconds),
        error.code,
        evidence,
      )
      return {
        jobId: job.jobId,
        status: status === "queued" ? "retried" : "failed",
        code: error.code,
      }
    }

    await repository.complete(job, "failed", error.code, evidence)
    return { jobId: job.jobId, status: "failed", code: error.code }
  } catch (settlementError) {
    if (
      settlementError instanceof DomainProvisioningRepositoryError &&
      settlementError.leaseLost
    ) {
      return { jobId: job.jobId, status: "lease_lost", code: error.code }
    }

    return {
      jobId: job.jobId,
      status: "settlement_unknown",
      code: error.code,
    }
  }
}

export async function processDomainProvisioningJob(options: {
  repository: DomainProvisioningRepository
  adapterFactory: DomainProviderAdapterFactory
  config: DomainWorkerConfig
  job: ClaimedDomainProvisioningJob
}): Promise<DomainJobProcessResult> {
  const { repository, adapterFactory, config, job } = options

  try {
    assertClaimedJob(job)
    const context = await repository.loadContext(job)
    assertContextMatchesJob(job, context)
    const adapter = adapterFactory(job.provider)

    const initial = await adapter.reconcile(job, context)
    const initialEvidence = assertSafeProviderEvidence(initial.evidence)
    await repository.recordReconciliation(
      job,
      initial.outcome,
      initialEvidence,
    )

    if (initial.outcome === "conflict") {
      throw new DomainProvisioningError({
        code: "provider_state_conflict",
        retryable: true,
        evidence: initialEvidence,
      })
    }
    if (initial.outcome === "inconclusive") {
      throw new DomainProvisioningError({
        code: "provider_state_inconclusive",
        retryable: true,
        evidence: initialEvidence,
      })
    }

    if (
      initial.outcome === "matches_intent" &&
      initial.desiredStateVerified &&
      initialEvidence.verified === true
    ) {
      await repository.complete(job, "succeeded", null, initialEvidence)
      return { jobId: job.jobId, status: "succeeded" }
    }

    if (initial.outcome === "matches_intent") {
      throw new DomainProvisioningError({
        code: "provider_state_not_verified",
        retryable: true,
        evidence: initialEvidence,
      })
    }

    await repository.renewLease(job, config.leaseSeconds)
    const applyEvidence = assertSafeProviderEvidence(
      await adapter.apply(job, context, initial),
    )

    await repository.renewLease(job, config.leaseSeconds)
    const finalState = await adapter.reconcile(job, context)
    const finalEvidence = assertSafeProviderEvidence(finalState.evidence)
    const combinedEvidence: SafeProviderEvidence = mergeProviderEvidence(
      applyEvidence,
      finalEvidence,
    )

    if (
      finalState.outcome !== "matches_intent" ||
      !finalState.desiredStateVerified ||
      finalEvidence.verified !== true
    ) {
      throw new DomainProvisioningError({
        code:
          finalState.outcome === "conflict"
            ? "provider_state_conflict"
            : "provider_apply_not_verified",
        retryable: true,
        evidence: combinedEvidence,
      })
    }

    await repository.complete(job, "succeeded", null, combinedEvidence)
    return { jobId: job.jobId, status: "succeeded" }
  } catch (error) {
    if (
      error instanceof DomainProvisioningRepositoryError &&
      error.leaseLost
    ) {
      return { jobId: job.jobId, status: "lease_lost" }
    }

    const normalized =
      error instanceof DomainProvisioningRepositoryError
        ? repositoryFailure(error)
        : asDomainProvisioningError(error)

    return settleFailure({ repository, job, error: normalized })
  }
}

export async function runDomainProvisioningBatch(options: {
  repository: DomainProvisioningRepository
  adapterFactory: DomainProviderAdapterFactory
  config: DomainWorkerConfig
  workerId: string
}): Promise<DomainWorkerBatchResult> {
  const jobs = await options.repository.claimJobs({
    workerId: options.workerId,
    batchSize: options.config.batchSize,
    leaseSeconds: options.config.leaseSeconds,
  })

  const results = await Promise.all(
    jobs.map((job) =>
      processDomainProvisioningJob({
        repository: options.repository,
        adapterFactory: options.adapterFactory,
        config: options.config,
        job,
      }),
    ),
  )

  return {
    claimed: results.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    retried: results.filter((result) => result.status === "retried").length,
    failed: results.filter((result) => result.status === "failed").length,
    leaseLost: results.filter((result) => result.status === "lease_lost").length,
    settlementUnknown: results.filter(
      (result) => result.status === "settlement_unknown",
    ).length,
    results,
  }
}
