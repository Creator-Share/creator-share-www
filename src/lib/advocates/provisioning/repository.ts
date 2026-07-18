import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  ClaimedDomainProvisioningJob,
  DomainProvisioningContext,
  ReconciliationOutcome,
  SafeProviderEvidence,
} from "./types"

export interface DomainProvisioningRepository {
  claimJobs(options: {
    workerId: string
    batchSize: number
    leaseSeconds: number
  }): Promise<ClaimedDomainProvisioningJob[]>
  loadContext(
    job: ClaimedDomainProvisioningJob,
  ): Promise<DomainProvisioningContext>
  renewLease(
    job: ClaimedDomainProvisioningJob,
    leaseSeconds: number,
  ): Promise<void>
  recordReconciliation(
    job: ClaimedDomainProvisioningJob,
    outcome: ReconciliationOutcome,
    evidence: SafeProviderEvidence,
  ): Promise<void>
  complete(
    job: ClaimedDomainProvisioningJob,
    status: "succeeded" | "failed",
    code: string | null,
    evidence: SafeProviderEvidence,
  ): Promise<"succeeded" | "failed">
  retry(
    job: ClaimedDomainProvisioningJob,
    delaySeconds: number,
    code: string,
    evidence: SafeProviderEvidence,
  ): Promise<"queued" | "failed">
}

interface SupabaseErrorLike {
  code?: string
  message?: string
}

export class DomainProvisioningRepositoryError extends Error {
  readonly stage: string
  readonly leaseLost: boolean

  constructor(stage: string, error: SupabaseErrorLike | null) {
    super(`domain_provisioning_repository_${stage}`, { cause: error })
    this.name = "DomainProvisioningRepositoryError"
    this.stage = stage
    this.leaseLost = error?.code === "42501"
  }
}

function throwRepositoryError(
  stage: string,
  error: SupabaseErrorLike | null,
): never {
  throw new DomainProvisioningRepositoryError(stage, error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseClaimedJob(value: unknown): ClaimedDomainProvisioningJob | null {
  if (!isRecord(value)) return null

  const kind = value.kind
  const provider = value.provider
  if (
    kind !== "provision" &&
    kind !== "reconcile" &&
    kind !== "deprovision"
  ) {
    return null
  }
  if (
    provider !== "cloudflare" &&
    provider !== "vercel" &&
    provider !== "stripe_us" &&
    provider !== "stripe_uk" &&
    provider !== "paypal"
  ) {
    return null
  }
  if (!isRecord(value.request_payload)) return null

  return {
    jobId: String(value.job_id ?? ""),
    advocateId: String(value.advocate_id ?? ""),
    domainId: String(value.domain_id ?? ""),
    integrationId: String(value.integration_id ?? ""),
    kind,
    provider,
    attemptCount: Number(value.attempt_count),
    maxAttempts: Number(value.max_attempts),
    providerIdempotencyKey: String(value.provider_idempotency_key ?? ""),
    requestPayload: value.request_payload as ClaimedDomainProvisioningJob["requestPayload"],
    leaseToken: String(value.lease_token ?? ""),
    leaseExpiresAt: String(value.lease_expires_at ?? ""),
    reconciliationRequired: value.reconciliation_required === true,
  }
}

export function createSupabaseDomainProvisioningRepository(
  client: SupabaseClient,
): DomainProvisioningRepository {
  return {
    async claimJobs({ workerId, batchSize, leaseSeconds }) {
      const { data, error } = await client.rpc(
        "claim_domain_provisioning_jobs",
        {
          worker_id: workerId,
          batch_size: batchSize,
          lease_duration: `${leaseSeconds} seconds`,
        },
      )
      if (error) throwRepositoryError("claim", error)
      if (!Array.isArray(data)) throwRepositoryError("claim_shape", null)

      const jobs = data.map(parseClaimedJob)
      if (jobs.some((job) => job === null)) {
        throwRepositoryError("claim_shape", null)
      }
      return jobs as ClaimedDomainProvisioningJob[]
    },

    async loadContext(job) {
      const { data: advocate, error: advocateError } = await client
        .from("advocates")
        .select("id, relationship_status, publication_status")
        .eq("id", job.advocateId)
        .maybeSingle()
      if (advocateError) throwRepositoryError("load_advocate", advocateError)
      if (!advocate) throwRepositoryError("advocate_missing", null)

      const { data: domain, error: domainError } = await client
        .from("advocate_domains")
        .select("id, advocate_id, hostname, status")
        .eq("id", job.domainId)
        .eq("advocate_id", job.advocateId)
        .maybeSingle()
      if (domainError) throwRepositoryError("load_domain", domainError)
      if (!domain) throwRepositoryError("domain_missing", null)

      const { data: integration, error: integrationError } = await client
        .from("advocate_domain_integrations")
        .select("id, advocate_id, domain_id, provider, status, external_identifier")
        .eq("id", job.integrationId)
        .eq("domain_id", job.domainId)
        .eq("advocate_id", job.advocateId)
        .maybeSingle()
      if (integrationError) {
        throwRepositoryError("load_integration", integrationError)
      }
      if (!integration) throwRepositoryError("integration_missing", null)

      return {
        advocateId: String(advocate.id),
        advocateRelationshipStatus: String(advocate.relationship_status),
        advocatePublicationStatus: String(advocate.publication_status),
        domainId: String(domain.id),
        hostname: String(domain.hostname),
        domainStatus: String(domain.status),
        integrationId: String(integration.id),
        integrationProvider:
          integration.provider as DomainProvisioningContext["integrationProvider"],
        integrationStatus: String(integration.status),
        integrationExternalIdentifier:
          typeof integration.external_identifier === "string"
            ? integration.external_identifier
            : null,
      }
    },

    async renewLease(job, leaseSeconds) {
      const { error } = await client.rpc(
        "renew_domain_provisioning_job_lease",
        {
          target_job_id: job.jobId,
          target_lease_token: job.leaseToken,
          lease_duration: `${leaseSeconds} seconds`,
        },
      )
      if (error) throwRepositoryError("renew", error)
    },

    async recordReconciliation(job, outcome, evidence) {
      const { error } = await client.rpc(
        "record_domain_provisioning_reconciliation",
        {
          target_job_id: job.jobId,
          target_lease_token: job.leaseToken,
          reconciliation_result: outcome,
          evidence_payload: evidence,
        },
      )
      if (error) throwRepositoryError("reconcile", error)
    },

    async complete(job, status, code, evidence) {
      const { data, error } = await client.rpc(
        "complete_domain_provisioning_job",
        {
          target_job_id: job.jobId,
          target_lease_token: job.leaseToken,
          completion_status: status,
          completion_code: code,
          provider_result: evidence,
        },
      )
      if (error) throwRepositoryError("complete", error)
      if (data !== "succeeded" && data !== "failed") {
        throwRepositoryError("complete_shape", null)
      }
      return data
    },

    async retry(job, delaySeconds, code, evidence) {
      const { data, error } = await client.rpc(
        "retry_domain_provisioning_job",
        {
          target_job_id: job.jobId,
          target_lease_token: job.leaseToken,
          retry_delay: `${delaySeconds} seconds`,
          retry_code: code,
          provider_result: evidence,
        },
      )
      if (error) throwRepositoryError("retry", error)
      if (data !== "queued" && data !== "failed") {
        throwRepositoryError("retry_shape", null)
      }
      return data
    },
  }
}
