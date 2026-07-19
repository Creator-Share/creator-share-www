import "server-only"

import type {
  PublicationCanaryOperationDatabase,
  PublicationCanaryWorkerDatabase,
} from "./database"
import {
  derivePublicationCanaryCompletionRequestId,
  derivePublicationCanaryPublishRequestId,
  derivePublicationCanaryStartRequestId,
  type PublicationCanaryOperationSnapshot,
  type PublicationCanaryWorkerClaim,
} from "./operation"
import type { PublicationCanaryErrorCode } from "./report"
import {
  runPublicationCanary,
  type PublicationCanaryRunnerDependencies,
  type PublicationCanaryRunnerResult,
  type PublicationCanaryRunnerTarget,
} from "./runner"

export const PUBLICATION_CANARY_WORKER_LEASE_SECONDS = 300
export const PUBLICATION_CANARY_EVIDENCE_WINDOW_MS = 30 * 60 * 1_000
export const PUBLICATION_CANARY_POLL_RETRY_SECONDS = 2

export interface PublicationCanaryOperationRequest {
  advocateId: string
  expectedVersion: number
  operationId: string
  adminReason: string
  traceId: string
  deploymentId: string
  revision: string
  clientIp: string | null
  userAgent: string | null
}

export type PublicationCanaryOperationResult =
  | {
      outcome: "pending"
      runId: string
      retryAfterSeconds: number
      workerKickoff: boolean
    }
  | {
      outcome: "expired"
      runId: string
    }
  | {
      outcome: "deployment_changed"
      runId: string
    }
  | {
      outcome: "published"
      runId: string
      reportSha256: string
      advocateVersion: number
    }
  | {
      outcome: "failed"
      runId: string
      reportSha256: string
      failureCode: PublicationCanaryErrorCode
    }

export interface HandlePublicationCanaryOperationDependencies {
  database: PublicationCanaryOperationDatabase
  now?: () => number
}

export type ProcessPublicationCanaryWorkerResult =
  | { outcome: "idle" }
  | {
      outcome: "succeeded"
      runId: string
      reportSha256: string
    }
  | {
      outcome: "failed"
      runId: string
      reportSha256: string
      failureCode: PublicationCanaryErrorCode
    }

export interface ProcessPublicationCanaryWorkerDependencies {
  database: PublicationCanaryWorkerDatabase
  runnerDependencies: PublicationCanaryRunnerDependencies
  runCanary?: (
    target: PublicationCanaryRunnerTarget,
    dependencies: PublicationCanaryRunnerDependencies,
  ) => Promise<PublicationCanaryRunnerResult>
}

export class ExecutePublicationCanaryInputError extends Error {
  constructor() {
    super("advocate_publication_canary_execution_input_invalid")
    this.name = "ExecutePublicationCanaryInputError"
  }
}

function inputError(): never {
  throw new ExecutePublicationCanaryInputError()
}

function runnerTarget(
  execution: PublicationCanaryWorkerClaim,
): PublicationCanaryRunnerTarget {
  return {
    runId: execution.runId,
    advocateId: execution.advocateId,
    domainId: execution.domainId,
    hostname: execution.hostname,
    expectedAdvocateVersion: execution.expectedAdvocateVersion,
    deploymentId: execution.deploymentId,
    revision: execution.revision,
    paymentAttemptIds: execution.paymentAttemptIds,
  }
}

async function publishSuccessfulExecution(
  input: PublicationCanaryOperationRequest,
  startRequestId: string,
  execution: PublicationCanaryOperationSnapshot & {
    outcome: "succeeded"
    reportSha256: string
  },
  database: PublicationCanaryOperationDatabase,
): Promise<PublicationCanaryOperationResult> {
  const publishRequestId = derivePublicationCanaryPublishRequestId({
    startRequestId,
    runId: execution.runId,
    reportSha256: execution.reportSha256,
  })
  if (publishRequestId === null) inputError()

  const advocateVersion = await database.publish({
    operationId: input.operationId,
    advocateId: input.advocateId,
    expectedVersion: input.expectedVersion,
    runId: execution.runId,
    deploymentId: input.deploymentId,
    revision: input.revision,
    reportSha256: execution.reportSha256,
    adminReason: input.adminReason,
    requestId: publishRequestId,
    traceId: input.traceId,
    clientIp: input.clientIp,
    userAgent: input.userAgent,
  })
  return {
    outcome: "published",
    runId: execution.runId,
    reportSha256: execution.reportSha256,
    advocateVersion,
  }
}

function readNow(now: () => number): number {
  const value = now()
  if (!Number.isSafeInteger(value) || value < 0) inputError()
  return value
}

function evidenceWindowExpired(startedAt: string, now: number): boolean {
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) inputError()
  return started + PUBLICATION_CANARY_EVIDENCE_WINDOW_MS <= now
}

export async function handlePublicationCanaryOperation(
  input: PublicationCanaryOperationRequest,
  dependencies: HandlePublicationCanaryOperationDependencies,
): Promise<PublicationCanaryOperationResult> {
  const startRequestId = derivePublicationCanaryStartRequestId(input)
  if (startRequestId === null) inputError()

  const expected = {
    advocateId: input.advocateId,
    expectedVersion: input.expectedVersion,
    deploymentId: input.deploymentId,
    revision: input.revision,
  }
  const execution = await dependencies.database.beginOrResume({
    operationId: startRequestId,
    traceId: input.traceId,
    adminReason: input.adminReason,
    clientIp: input.clientIp,
    userAgent: input.userAgent,
    target: expected,
  })

  if (execution.publishedAdvocateVersion !== null) {
    if (execution.reportSha256 === null || execution.outcome !== "succeeded") {
      inputError()
    }
    return {
      outcome: "published",
      runId: execution.runId,
      reportSha256: execution.reportSha256,
      advocateVersion: execution.publishedAdvocateVersion,
    }
  }

  if (execution.outcome === "failed") {
    if (execution.reportSha256 === null || execution.failureCode === null) {
      inputError()
    }
    return {
      outcome: "failed",
      runId: execution.runId,
      reportSha256: execution.reportSha256,
      failureCode: execution.failureCode,
    }
  }

  const now = readNow(dependencies.now ?? Date.now)
  if (evidenceWindowExpired(execution.startedAt, now)) {
    return { outcome: "expired", runId: execution.runId }
  }

  if (execution.outcome === "succeeded") {
    if (execution.reportSha256 === null) inputError()
    if (
      execution.deploymentId !== input.deploymentId ||
      execution.revision !== input.revision
    ) {
      return { outcome: "deployment_changed", runId: execution.runId }
    }
    return publishSuccessfulExecution(
      input,
      startRequestId,
      {
        ...execution,
        outcome: "succeeded",
        reportSha256: execution.reportSha256,
      },
      dependencies.database,
    )
  }

  return {
    outcome: "pending",
    runId: execution.runId,
    retryAfterSeconds: PUBLICATION_CANARY_POLL_RETRY_SECONDS,
    workerKickoff:
      execution.deploymentId === input.deploymentId &&
      execution.revision === input.revision,
  }
}

export async function processNextPublicationCanaryExecution(
  deploymentIdentity: { deploymentId: string; revision: string },
  dependencies: ProcessPublicationCanaryWorkerDependencies,
): Promise<ProcessPublicationCanaryWorkerResult> {
  const claim = await dependencies.database.claimNext({
    deploymentId: deploymentIdentity.deploymentId,
    revision: deploymentIdentity.revision,
    leaseSeconds: PUBLICATION_CANARY_WORKER_LEASE_SECONDS,
  })
  if (claim === undefined) return { outcome: "idle" }

  const result = await (dependencies.runCanary ?? runPublicationCanary)(
    runnerTarget(claim),
    dependencies.runnerDependencies,
  )
  const completionRequestId = derivePublicationCanaryCompletionRequestId({
    startRequestId: claim.startRequestId,
    runId: claim.runId,
  })
  if (completionRequestId === null) inputError()

  const completed = await dependencies.database.completeClaimed({
    runId: claim.runId,
    canonicalReport: result.canonicalReport,
    reportSha256: result.reportSha256,
    outcome: result.report.outcome,
    failureCode: result.report.error_code,
    completedAt: result.report.completed_at,
    requestId: completionRequestId,
    traceId: claim.traceId,
    adminReason: claim.adminReason,
    leaseToken: claim.leaseToken,
  })
  if (completed.outcome === "failed") {
    if (result.report.error_code === null) inputError()
    return {
      outcome: "failed",
      runId: claim.runId,
      reportSha256: completed.reportSha256,
      failureCode: result.report.error_code,
    }
  }
  return {
    outcome: "succeeded",
    runId: claim.runId,
    reportSha256: completed.reportSha256,
  }
}
