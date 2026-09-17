import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  ClaimedDomainProvisioningJob,
  DomainProvisioningContext,
  ReconciliationOutcome,
  SafeProviderEvidence,
} from "./types"

export interface DomainProvisioningRepository {
  enqueueDueReconciliations(options: {
    batchSize: number
    correlationId: string
    signal: AbortSignal
  }): Promise<DomainReconciliationEnqueueResult[]>
  claimJobs(options: {
    workerId: string
    batchSize: number
    leaseSeconds: number
    signal: AbortSignal
  }): Promise<ClaimedDomainProvisioningJob[]>
  loadContext(
    job: ClaimedDomainProvisioningJob,
    signal: AbortSignal,
  ): Promise<DomainProvisioningContext>
  renewLease(
    job: ClaimedDomainProvisioningJob,
    leaseSeconds: number,
    signal: AbortSignal,
  ): Promise<void>
  recordReconciliation(
    job: ClaimedDomainProvisioningJob,
    outcome: ReconciliationOutcome,
    evidence: SafeProviderEvidence,
    signal: AbortSignal,
  ): Promise<boolean>
  complete(
    job: ClaimedDomainProvisioningJob,
    status: "succeeded" | "failed",
    code: string | null,
    evidence: SafeProviderEvidence,
    signal: AbortSignal,
  ): Promise<"succeeded" | "failed">
  retry(
    job: ClaimedDomainProvisioningJob,
    delaySeconds: number,
    code: string,
    evidence: SafeProviderEvidence,
    signal: AbortSignal,
  ): Promise<"queued" | "failed">
}

export interface DomainReconciliationEnqueueResult {
  domainId: string
  enqueuedJobCount: number
  quarantined: boolean
}

interface SupabaseErrorLike {
  code?: string
  message?: string
}

async function executeRpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ data: unknown; error: SupabaseErrorLike | null }> {
  const { data, error } = await client.rpc(name, args).abortSignal(signal)
  return { data, error }
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function parseReconciliationEnqueueResult(
  value: unknown,
): DomainReconciliationEnqueueResult | null {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !==
      "domain_id,enqueued_job_count,quarantined"
  ) {
    return null
  }

  const domainId = value.domain_id
  const enqueuedJobCount = value.enqueued_job_count
  const quarantined = value.quarantined
  if (
    typeof domainId !== "string" ||
    !UUID_PATTERN.test(domainId) ||
    typeof enqueuedJobCount !== "number" ||
    !Number.isSafeInteger(enqueuedJobCount) ||
    enqueuedJobCount < 0 ||
    enqueuedJobCount > 5 ||
    typeof quarantined !== "boolean" ||
    (quarantined && enqueuedJobCount !== 0) ||
    (!quarantined && enqueuedJobCount < 1)
  ) {
    return null
  }

  return { domainId, enqueuedJobCount, quarantined }
}

function parseClaimedJob(value: unknown): ClaimedDomainProvisioningJob | null {
  if (!isRecord(value)) return null

  const kind = value.kind
  const provider = value.provider
  if (kind !== "provision" && kind !== "reconcile" && kind !== "deprovision") {
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
    requestPayload:
      value.request_payload as ClaimedDomainProvisioningJob["requestPayload"],
    leaseToken: String(value.lease_token ?? ""),
    leaseExpiresAt: String(value.lease_expires_at ?? ""),
    reconciliationRequired: value.reconciliation_required === true,
  }
}

export function createSupabaseDomainProvisioningRepository(
  client: SupabaseClient,
): DomainProvisioningRepository {
  return {
    async enqueueDueReconciliations({ batchSize, correlationId, signal }) {
      const { data, error } = await executeRpc(
        client,
        "enqueue_due_advocate_domain_reconciliations",
        {
          batch_size: batchSize,
          correlation_id: correlationId,
        },
        signal,
      )
      if (error) throwRepositoryError("enqueue_reconciliations", error)
      if (!Array.isArray(data) || data.length > batchSize) {
        throwRepositoryError("enqueue_reconciliations_shape", null)
      }

      const results = data.map(parseReconciliationEnqueueResult)
      if (
        results.some((result) => result === null) ||
        new Set(
          results.map((result) =>
            result === null ? "invalid" : result.domainId,
          ),
        ).size !== results.length
      ) {
        throwRepositoryError("enqueue_reconciliations_shape", null)
      }
      return results as DomainReconciliationEnqueueResult[]
    },

    async claimJobs({ workerId, batchSize, leaseSeconds, signal }) {
      const { data, error } = await executeRpc(
        client,
        "claim_domain_provisioning_jobs",
        {
          worker_id: workerId,
          batch_size: batchSize,
          lease_duration: `${leaseSeconds} seconds`,
        },
        signal,
      )
      if (error) throwRepositoryError("claim", error)
      if (!Array.isArray(data)) throwRepositoryError("claim_shape", null)

      const jobs = data.map(parseClaimedJob)
      if (jobs.some((job) => job === null)) {
        throwRepositoryError("claim_shape", null)
      }
      return jobs as ClaimedDomainProvisioningJob[]
    },

    async loadContext(job, signal) {
      const { data: advocate, error: advocateError } = await client
        .from("advocates")
        .select("id, relationship_status, publication_status")
        .eq("id", job.advocateId)
        .abortSignal(signal)
        .maybeSingle()
      if (advocateError) throwRepositoryError("load_advocate", advocateError)
      if (!advocate) throwRepositoryError("advocate_missing", null)

      const { data: domain, error: domainError } = await client
        .from("advocate_domains")
        .select("id, advocate_id, hostname, status")
        .eq("id", job.domainId)
        .eq("advocate_id", job.advocateId)
        .abortSignal(signal)
        .maybeSingle()
      if (domainError) throwRepositoryError("load_domain", domainError)
      if (!domain) throwRepositoryError("domain_missing", null)

      const { data: integration, error: integrationError } = await client
        .from("advocate_domain_integrations")
        .select(
          "id, advocate_id, domain_id, provider, is_required, status, external_identifier",
        )
        .eq("id", job.integrationId)
        .eq("domain_id", job.domainId)
        .eq("advocate_id", job.advocateId)
        .abortSignal(signal)
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
        integrationIsRequired: integration.is_required === true,
        integrationStatus: String(integration.status),
        integrationExternalIdentifier:
          typeof integration.external_identifier === "string"
            ? integration.external_identifier
            : null,
      }
    },

    async renewLease(job, leaseSeconds, signal) {
      const { error } = await executeRpc(
        client,
        "renew_domain_provisioning_job_lease",
        {
          target_job_id: job.jobId,
          target_lease_token: job.leaseToken,
          lease_duration: `${leaseSeconds} seconds`,
        },
        signal,
      )
      if (error) throwRepositoryError("renew", error)
    },

    async recordReconciliation(job, outcome, evidence, signal) {
      const { data, error } = await executeRpc(
        client,
        "record_domain_provisioning_reconciliation",
        {
          target_job_id: job.jobId,
          target_lease_token: job.leaseToken,
          reconciliation_result: outcome,
          evidence_payload: evidence,
        },
        signal,
      )
      if (error) throwRepositoryError("reconcile", error)
      if (typeof data !== "boolean") {
        throwRepositoryError("reconcile_shape", null)
      }
      return data
    },

    async complete(job, status, code, evidence, signal) {
      const { data, error } = await executeRpc(
        client,
        "complete_domain_provisioning_job",
        {
          target_job_id: job.jobId,
          target_lease_token: job.leaseToken,
          completion_status: status,
          completion_code: code,
          provider_result: evidence,
        },
        signal,
      )
      if (error) throwRepositoryError("complete", error)
      if (data !== "succeeded" && data !== "failed") {
        throwRepositoryError("complete_shape", null)
      }
      return data
    },

    async retry(job, delaySeconds, code, evidence, signal) {
      const { data, error } = await executeRpc(
        client,
        "retry_domain_provisioning_job",
        {
          target_job_id: job.jobId,
          target_lease_token: job.leaseToken,
          retry_delay: `${delaySeconds} seconds`,
          retry_code: code,
          provider_result: evidence,
        },
        signal,
      )
      if (error) throwRepositoryError("retry", error)
      if (data !== "queued" && data !== "failed") {
        throwRepositoryError("retry_shape", null)
      }
      return data
    },
  }
}
