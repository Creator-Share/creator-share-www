import { resolveAdvocateHost } from "@/lib/advocates/host"

import {
  DomainProvisioningError,
  type ClaimedDomainProvisioningJob,
  type DomainProvisioningContext,
  type SafeProviderEvidence,
} from "./types"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROVIDER_KEY_PATTERN = /^[0-9a-f]{64}$/
const SAFE_EVIDENCE_STRING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/

const SAFE_EVIDENCE_KEYS = new Set<keyof SafeProviderEvidence>([
  "provider_operation_id",
  "provider_resource_id",
  "provider_request_id",
  "provider_status",
  "dns_record_id",
  "deployment_id",
  "http_status",
  "verified",
  "already_applied",
  "message_code",
])

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

export function sanitizeEvidenceString(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 500 ||
    !SAFE_EVIDENCE_STRING_PATTERN.test(value)
  ) {
    return undefined
  }

  return value
}

export function assertSafeProviderEvidence(
  value: SafeProviderEvidence,
): SafeProviderEvidence {
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_EVIDENCE_KEYS.has(key as keyof SafeProviderEvidence)) {
      throw new DomainProvisioningError({
        code: "worker_unsafe_provider_evidence",
        retryable: false,
      })
    }

    if (item === undefined) continue

    if (key === "http_status") {
      if (!Number.isInteger(item) || item < 100 || item > 599) {
        throw new DomainProvisioningError({
          code: "worker_unsafe_provider_evidence",
          retryable: false,
        })
      }
      continue
    }

    if (key === "verified" || key === "already_applied") {
      if (typeof item !== "boolean") {
        throw new DomainProvisioningError({
          code: "worker_unsafe_provider_evidence",
          retryable: false,
        })
      }
      continue
    }

    if (!sanitizeEvidenceString(item)) {
      throw new DomainProvisioningError({
        code: "worker_unsafe_provider_evidence",
        retryable: false,
      })
    }
  }

  return value
}

export function assertClaimedJob(job: ClaimedDomainProvisioningJob): void {
  if (
    !isUuid(job.jobId) ||
    !isUuid(job.advocateId) ||
    !isUuid(job.domainId) ||
    !isUuid(job.integrationId) ||
    !isUuid(job.leaseToken) ||
    !PROVIDER_KEY_PATTERN.test(job.providerIdempotencyKey) ||
    !Number.isInteger(job.attemptCount) ||
    !Number.isInteger(job.maxAttempts) ||
    job.attemptCount < 1 ||
    job.maxAttempts < 1 ||
    job.attemptCount > job.maxAttempts ||
    !job.reconciliationRequired ||
    job.requestPayload?.schema_version !== 1 ||
    job.requestPayload?.reconciliation_policy !== "lookup_before_mutation" ||
    Object.keys(job.requestPayload ?? {}).length !== 2 ||
    Number.isNaN(Date.parse(job.leaseExpiresAt))
  ) {
    throw new DomainProvisioningError({
      code: "worker_invalid_claimed_job",
      retryable: false,
    })
  }
}

export function assertContextMatchesJob(
  job: ClaimedDomainProvisioningJob,
  context: DomainProvisioningContext,
): void {
  const resolved = resolveAdvocateHost(context.hostname)
  const exactProductionHost =
    resolved.kind === "tenant-candidate" &&
    resolved.environment === "production" &&
    resolved.domainLookup.hostname === context.hostname

  if (
    context.advocateId !== job.advocateId ||
    context.domainId !== job.domainId ||
    context.integrationId !== job.integrationId ||
    context.integrationProvider !== job.provider ||
    !exactProductionHost
  ) {
    throw new DomainProvisioningError({
      code: "worker_job_context_mismatch",
      retryable: false,
    })
  }

  const advocateCanPublish =
    context.advocateRelationshipStatus === "active" &&
    context.advocatePublicationStatus !== "suspended"
  const eligible =
    job.kind === "provision"
      ? advocateCanPublish &&
        ["pending", "provisioning", "failed", "disabled"].includes(
          context.domainStatus,
        ) &&
        ["pending", "provisioning", "failed", "disabled"].includes(
          context.integrationStatus,
        )
      : job.kind === "reconcile"
        ? advocateCanPublish &&
          ["provisioning", "verifying", "active", "failed"].includes(
            context.domainStatus,
          ) &&
          context.integrationStatus !== "disabled"
        : ["redirecting", "disabled"].includes(context.domainStatus)

  if (!eligible) {
    throw new DomainProvisioningError({
      code: "worker_job_no_longer_eligible",
      retryable: false,
    })
  }
}
