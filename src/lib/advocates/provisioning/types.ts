export const SUPPORTED_DOMAIN_PROVIDERS = ["cloudflare", "vercel"] as const

export type SupportedDomainProvider =
  (typeof SUPPORTED_DOMAIN_PROVIDERS)[number]

export type DomainProvisioningProvider =
  SupportedDomainProvider | "stripe_us" | "stripe_uk" | "paypal"

export type DomainProvisioningJobKind =
  "provision" | "reconcile" | "deprovision"

export type ReconciliationOutcome =
  "not_found" | "matches_intent" | "needs_apply" | "conflict" | "inconclusive"

export interface ClaimedDomainProvisioningJob {
  jobId: string
  advocateId: string
  domainId: string
  integrationId: string
  kind: DomainProvisioningJobKind
  provider: DomainProvisioningProvider
  attemptCount: number
  maxAttempts: number
  providerIdempotencyKey: string
  requestPayload: {
    schema_version: 1
    reconciliation_policy: "lookup_before_mutation"
  }
  leaseToken: string
  leaseExpiresAt: string
  reconciliationRequired: boolean
}

export interface DomainProvisioningContext {
  advocateId: string
  advocateRelationshipStatus: string
  advocatePublicationStatus: string
  domainId: string
  hostname: string
  domainStatus: string
  integrationId: string
  integrationProvider: DomainProvisioningProvider
  integrationIsRequired: boolean
  integrationStatus: string
  integrationExternalIdentifier: string | null
}

export interface SafeProviderEvidence {
  provider_operation_id?: string
  provider_resource_id?: string
  provider_request_id?: string
  provider_status?: string
  dns_record_id?: string
  deployment_id?: string
  http_status?: number
  verified?: boolean
  already_applied?: boolean
  message_code?: string
}

export interface ProviderReconciliation {
  outcome: ReconciliationOutcome
  desiredStateVerified: boolean
  evidence: SafeProviderEvidence
  resourceId?: string
  ownedResource?: boolean
}

export interface DomainProviderAdapter {
  readonly provider: DomainProvisioningProvider
  reconcile(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
  ): Promise<ProviderReconciliation>
  apply(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
    reconciliation: ProviderReconciliation,
  ): Promise<SafeProviderEvidence>
}

const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,119}$/

export class DomainProvisioningError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly evidence: SafeProviderEvidence
  readonly retryAfterSeconds?: number

  constructor(options: {
    code: string
    retryable: boolean
    evidence?: SafeProviderEvidence
    retryAfterSeconds?: number
    cause?: unknown
  }) {
    if (!ERROR_CODE_PATTERN.test(options.code)) {
      throw new Error("Invalid domain provisioning error code")
    }

    super(options.code, { cause: options.cause })
    this.name = "DomainProvisioningError"
    this.code = options.code
    this.retryable = options.retryable
    this.evidence = options.evidence ?? {}
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export function asDomainProvisioningError(
  error: unknown,
): DomainProvisioningError {
  if (error instanceof DomainProvisioningError) return error

  return new DomainProvisioningError({
    code: "worker_unexpected_error",
    retryable: true,
    cause: error,
  })
}

export function isSupportedDomainProvider(
  provider: DomainProvisioningProvider,
): provider is SupportedDomainProvider {
  return SUPPORTED_DOMAIN_PROVIDERS.some((candidate) => candidate === provider)
}

export function mergeProviderEvidence(
  ...evidence: SafeProviderEvidence[]
): SafeProviderEvidence {
  return Object.assign({}, ...evidence)
}
