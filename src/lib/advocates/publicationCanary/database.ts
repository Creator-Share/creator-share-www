import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  parsePublicationCanaryCompletionResult,
  parsePublicationCanaryExecutionResult,
  parsePublicationCanaryPublishResult,
  parsePublicationCanaryStartResult,
  parsePublicationCanaryWorkerClaimResult,
  type PublicationCanaryCompletionResult,
  type PublicationCanaryExecution,
  type PublicationCanaryStartResult,
  type PublicationCanaryWorkerClaim,
} from "./operation"
import type { PublicationCanaryErrorCode } from "./report"

interface SupabaseErrorLike {
  code?: string
}

export class PublicationCanaryDatabaseError extends Error {
  readonly stage: "lookup" | "begin" | "claim" | "complete" | "publish"
  readonly postgresCode?: string

  constructor(
    stage: PublicationCanaryDatabaseError["stage"],
    cause?: SupabaseErrorLike | null,
  ) {
    super("advocate_publication_canary_database_failure", { cause })
    this.name = "PublicationCanaryDatabaseError"
    this.stage = stage
    this.postgresCode = cause?.code
  }
}

export interface PublicationCanaryExpectedTarget {
  advocateId: string
  expectedVersion: number
  deploymentId: string
  revision: string
}

export interface PublicationCanaryOperationDatabase {
  loadExecution(
    requestId: string,
    expected: PublicationCanaryExpectedTarget,
  ): Promise<PublicationCanaryExecution | undefined>
  begin(input: {
    requestId: string
    traceId: string
    adminReason: string
    target: PublicationCanaryExpectedTarget
  }): Promise<PublicationCanaryStartResult>
  publish(input: {
    advocateId: string
    expectedVersion: number
    runId: string
    deploymentId: string
    reportSha256: string
    adminReason: string
    requestId: string
    traceId: string
  }): Promise<number>
}

export interface PublicationCanaryWorkerDatabase {
  claimNext(input: {
    deploymentId: string
    revision: string
    leaseSeconds: number
  }): Promise<PublicationCanaryWorkerClaim | undefined>
  completeClaimed(input: {
    runId: string
    canonicalReport: string
    reportSha256: string
    outcome: "succeeded" | "failed"
    failureCode: PublicationCanaryErrorCode | null
    completedAt: string
    requestId: string
    traceId: string
    adminReason: string
    leaseToken: string
  }): Promise<PublicationCanaryCompletionResult>
}

function databaseError(
  stage: PublicationCanaryDatabaseError["stage"],
  cause?: SupabaseErrorLike | null,
): never {
  throw new PublicationCanaryDatabaseError(stage, cause)
}

export function createPublicationCanaryOperationDatabase(
  authenticatedClient: SupabaseClient,
  serviceRoleClient: SupabaseClient,
): PublicationCanaryOperationDatabase {
  return {
    async loadExecution(requestId, expected) {
      const { data, error } = await serviceRoleClient.rpc(
        "get_advocate_publication_canary_execution",
        { target_request_id: requestId },
      )
      if (error) databaseError("lookup", error)
      const parsed = parsePublicationCanaryExecutionResult(data, expected)
      if (parsed === null) databaseError("lookup")
      return parsed
    },

    async begin(input) {
      const { data, error } = await authenticatedClient.rpc(
        "begin_advocate_publication_canary",
        {
          target_advocate_id: input.target.advocateId,
          target_expected_advocate_version: input.target.expectedVersion,
          target_request_id: input.requestId,
          target_deployment_id: input.target.deploymentId,
          target_git_revision: input.target.revision,
          target_trace_id: input.traceId,
          target_admin_reason: input.adminReason,
        },
      )
      if (error) databaseError("begin", error)
      const parsed = parsePublicationCanaryStartResult(data, input.target)
      if (parsed === null) databaseError("begin")
      return parsed
    },

    async publish(input) {
      const { data, error } = await authenticatedClient.rpc(
        "publish_advocate_portal_from_canary",
        {
          target_advocate_id: input.advocateId,
          target_expected_advocate_version: input.expectedVersion,
          target_canary_run_id: input.runId,
          target_deployment_id: input.deploymentId,
          target_report_sha256: `\\x${input.reportSha256}`,
          target_admin_reason: input.adminReason,
          target_request_id: input.requestId,
          target_trace_id: input.traceId,
        },
      )
      if (error) databaseError("publish", error)
      const parsed = parsePublicationCanaryPublishResult(
        data,
        input.expectedVersion,
      )
      if (parsed === null) databaseError("publish")
      return parsed
    },
  }
}

export function createPublicationCanaryWorkerDatabase(
  serviceRoleClient: SupabaseClient,
): PublicationCanaryWorkerDatabase {
  return {
    async claimNext(input) {
      const { data, error } = await serviceRoleClient.rpc(
        "claim_next_advocate_publication_canary_execution",
        {
          target_deployment_id: input.deploymentId,
          target_git_revision: input.revision,
          target_lease_seconds: input.leaseSeconds,
        },
      )
      if (error) databaseError("claim", error)
      const parsed = parsePublicationCanaryWorkerClaimResult(data, {
        deploymentId: input.deploymentId,
        revision: input.revision,
      })
      if (parsed === null) databaseError("claim")
      return parsed
    },

    async completeClaimed(input) {
      const { data, error } = await serviceRoleClient.rpc(
        "complete_claimed_advocate_publication_canary",
        {
          target_run_id: input.runId,
          canonical_report_text: input.canonicalReport,
          target_report_sha256: `\\x${input.reportSha256}`,
          target_outcome: input.outcome,
          target_failure_code: input.failureCode,
          target_completed_at: input.completedAt,
          target_request_id: input.requestId,
          target_trace_id: input.traceId,
          target_admin_reason: input.adminReason,
          target_lease_token: input.leaseToken,
        },
      )
      if (error) databaseError("complete", error)
      const parsed = parsePublicationCanaryCompletionResult(data, {
        runId: input.runId,
        reportSha256: input.reportSha256,
      })
      if (parsed === null || parsed.outcome !== input.outcome) {
        databaseError("complete")
      }
      return parsed
    },
  }
}
