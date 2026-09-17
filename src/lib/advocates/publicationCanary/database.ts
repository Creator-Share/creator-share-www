import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  parsePublicationCanaryDeploymentCapability,
  parsePublicationCanaryCompletionResult,
  parsePublicationCanaryOperationSnapshot,
  parsePublicationCanaryPublishResult,
  parsePublicationCanaryWorkerClaimResult,
  type PublicationCanaryCompletionResult,
  type PublicationCanaryOperationSnapshot,
  type PublicationCanaryWorkerClaim,
} from "./operation"
import type { PublicationCanaryErrorCode } from "./report"

interface SupabaseErrorLike {
  code?: string
}

export class PublicationCanaryDatabaseError extends Error {
  readonly stage:
    | "begin_or_resume"
    | "authorize_deployment"
    | "claim"
    | "complete"
    | "publish"
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
  beginOrResume(input: {
    operationId: string
    traceId: string
    adminReason: string
    clientIp: string | null
    userAgent: string | null
    target: PublicationCanaryExpectedTarget
  }): Promise<PublicationCanaryOperationSnapshot>
  publish(input: {
    operationId: string
    advocateId: string
    expectedVersion: number
    runId: string
    deploymentId: string
    revision: string
    reportSha256: string
    adminReason: string
    requestId: string
    traceId: string
    clientIp: string | null
    userAgent: string | null
  }): Promise<number>
}

export interface PublicationCanaryDeploymentAuthorizationDatabase {
  mint(input: {
    operationId: string
    runId: string
    deploymentId: string
    revision: string
  }): Promise<string>
}

export type PublicationCanaryDeploymentAuthorizationDatabaseFactory =
  () => PublicationCanaryDeploymentAuthorizationDatabase

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
  createDeploymentAuthorizationDatabase: PublicationCanaryDeploymentAuthorizationDatabaseFactory,
): PublicationCanaryOperationDatabase {
  return {
    async beginOrResume(input) {
      const { data, error } = await authenticatedClient.rpc(
        "begin_or_resume_advocate_publication_canary",
        {
          target_advocate_id: input.target.advocateId,
          target_expected_advocate_version: input.target.expectedVersion,
          target_operation_id: input.operationId,
          target_deployment_id: input.target.deploymentId,
          target_git_revision: input.target.revision,
          target_trace_id: input.traceId,
          target_admin_reason: input.adminReason,
          target_client_ip: input.clientIp,
          target_user_agent: input.userAgent,
        },
      )
      if (error) databaseError("begin_or_resume", error)
      const parsed = parsePublicationCanaryOperationSnapshot(data, {
        operationId: input.operationId,
        advocateId: input.target.advocateId,
        expectedVersion: input.target.expectedVersion,
      })
      if (parsed === null) databaseError("begin_or_resume")
      return parsed
    },

    async publish(input) {
      let authorizationDatabase: PublicationCanaryDeploymentAuthorizationDatabase
      try {
        authorizationDatabase = createDeploymentAuthorizationDatabase()
      } catch (error) {
        databaseError("authorize_deployment", error as SupabaseErrorLike)
      }
      const deploymentCapabilityId = await authorizationDatabase.mint({
        operationId: input.operationId,
        runId: input.runId,
        deploymentId: input.deploymentId,
        revision: input.revision,
      })
      const { data, error } = await authenticatedClient.rpc(
        "publish_advocate_portal_from_canary_v2",
        {
          target_advocate_id: input.advocateId,
          target_expected_advocate_version: input.expectedVersion,
          target_operation_id: input.operationId,
          target_canary_run_id: input.runId,
          target_deployment_id: input.deploymentId,
          target_report_sha256: `\\x${input.reportSha256}`,
          target_admin_reason: input.adminReason,
          target_request_id: input.requestId,
          target_trace_id: input.traceId,
          target_deployment_capability_id: deploymentCapabilityId,
          target_client_ip: input.clientIp,
          target_user_agent: input.userAgent,
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

export function createPublicationCanaryDeploymentAuthorizationDatabase(
  serviceRoleClient: SupabaseClient,
): PublicationCanaryDeploymentAuthorizationDatabase {
  return {
    async mint(input) {
      const { data, error } = await serviceRoleClient.rpc(
        "mint_advocate_publication_deployment_capability",
        {
          target_operation_id: input.operationId,
          target_canary_run_id: input.runId,
          target_deployment_id: input.deploymentId,
          target_git_revision: input.revision,
        },
      )
      if (error) databaseError("authorize_deployment", error)
      const parsed = parsePublicationCanaryDeploymentCapability(data)
      if (parsed === null) databaseError("authorize_deployment")
      return parsed.capabilityId
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
