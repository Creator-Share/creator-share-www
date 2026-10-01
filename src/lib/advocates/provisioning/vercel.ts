import type { VercelProvisioningConfig } from "./config"
import {
  fetchProviderJson,
  isRecord,
  retryAfterSeconds,
  type FetchImplementation,
  type ProviderHttpResponse,
} from "./providerHttp"
import {
  DomainProvisioningError,
  type ClaimedDomainProvisioningJob,
  type DomainProviderAdapter,
  type DomainProvisioningContext,
  type ProviderReconciliation,
  type SafeProviderEvidence,
} from "./types"
import { sanitizeEvidenceString } from "./validation"

interface VercelProjectDomain {
  name: string
  projectId: string
  verified: boolean
  redirect: string | null
  redirectStatusCode: number | null
  gitBranch: string | null
  customEnvironmentId: string | null
}

const VERCEL_API_ORIGIN = "https://api.vercel.com"

function vercelErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined
  const code = payload.error.code
  if (typeof code !== "string") return undefined
  const normalized = code.toLowerCase().replace(/[^a-z0-9._:-]/g, "_")
  return sanitizeEvidenceString(`vercel_${normalized}`)
}

function parseProjectDomain(value: unknown): VercelProjectDomain | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.verified !== "boolean" ||
    (value.redirect !== undefined &&
      value.redirect !== null &&
      typeof value.redirect !== "string") ||
    (value.gitBranch !== undefined &&
      value.gitBranch !== null &&
      typeof value.gitBranch !== "string") ||
    (value.customEnvironmentId !== undefined &&
      value.customEnvironmentId !== null &&
      typeof value.customEnvironmentId !== "string") ||
    !(
      value.redirectStatusCode === undefined ||
      value.redirectStatusCode === null ||
      (typeof value.redirectStatusCode === "number" &&
        Number.isSafeInteger(value.redirectStatusCode))
    )
  ) {
    return null
  }

  return {
    name: value.name.toLowerCase().replace(/\.$/, ""),
    projectId: value.projectId,
    verified: value.verified,
    redirect: typeof value.redirect === "string" ? value.redirect : null,
    redirectStatusCode:
      typeof value.redirectStatusCode === "number"
        ? value.redirectStatusCode
        : null,
    gitBranch: typeof value.gitBranch === "string" ? value.gitBranch : null,
    customEnvironmentId:
      typeof value.customEnvironmentId === "string"
        ? value.customEnvironmentId
        : null,
  }
}

export class VercelDomainAdapter implements DomainProviderAdapter {
  readonly provider = "vercel" as const

  constructor(
    private readonly config: VercelProvisioningConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  private teamQuery(): string {
    if (!this.config.teamId) return ""
    return `?${new URLSearchParams({ teamId: this.config.teamId }).toString()}`
  }

  private projectDomainPath(hostname: string): string {
    return `/v9/projects/${encodeURIComponent(this.config.projectId)}/domains/${encodeURIComponent(hostname)}${this.teamQuery()}`
  }

  private projectDomainVerificationPath(hostname: string): string {
    return `/v9/projects/${encodeURIComponent(this.config.projectId)}/domains/${encodeURIComponent(hostname)}/verify${this.teamQuery()}`
  }

  private async rawRequest(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<ProviderHttpResponse> {
    return fetchProviderJson({
      provider: this.provider,
      fetchImplementation: this.fetchImplementation,
      url: `${VERCEL_API_ORIGIN}${path}`,
      init: {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      timeoutMs: this.config.requestTimeoutMs,
    })
  }

  private throwForResponse(response: ProviderHttpResponse): never {
    const status = response.response.status
    const retryable = status === 429 || status >= 500
    throw new DomainProvisioningError({
      code:
        status === 401 || status === 403
          ? "vercel_authorization_failed"
          : status === 409
            ? "vercel_domain_conflict"
            : retryable
              ? "vercel_transient_error"
              : "vercel_request_rejected",
      retryable,
      retryAfterSeconds: retryAfterSeconds(response.response),
      evidence: {
        ...response.evidence,
        ...(vercelErrorCode(response.payload)
          ? { message_code: vercelErrorCode(response.payload) }
          : {}),
      },
    })
  }

  private async lookup(hostname: string): Promise<{
    domain: VercelProjectDomain | null
    evidence: SafeProviderEvidence
  }> {
    const response = await this.rawRequest(
      "GET",
      this.projectDomainPath(hostname),
    )

    if (response.response.status === 404) {
      return { domain: null, evidence: response.evidence }
    }
    if (!response.response.ok) this.throwForResponse(response)

    const domain = parseProjectDomain(response.payload)
    if (!domain) {
      throw new DomainProvisioningError({
        code: "vercel_invalid_response",
        retryable: true,
        evidence: response.evidence,
      })
    }

    return { domain, evidence: response.evidence }
  }

  private isExactProjectDomain(
    domain: VercelProjectDomain,
    hostname: string,
  ): boolean {
    return (
      domain.name === hostname && domain.projectId === this.config.projectId
    )
  }

  private hasNeutralProductionRouting(domain: VercelProjectDomain): boolean {
    return (
      domain.redirect === null &&
      domain.redirectStatusCode === null &&
      domain.gitBranch === null &&
      domain.customEnvironmentId === null
    )
  }

  private verificationIdentityMismatch(
    evidence: SafeProviderEvidence,
  ): DomainProvisioningError {
    return new DomainProvisioningError({
      code: "vercel_verification_identity_mismatch",
      retryable: true,
      evidence: {
        ...evidence,
        message_code: "vercel_project_domain_conflict",
      },
    })
  }

  private async verifyAttachedDomain(
    context: DomainProvisioningContext,
    reconciliation: ProviderReconciliation,
  ): Promise<SafeProviderEvidence> {
    const exactOwnedAttachment =
      reconciliation.outcome === "needs_apply" &&
      reconciliation.desiredStateVerified === false &&
      reconciliation.resourceId === context.hostname &&
      reconciliation.ownedResource === true &&
      reconciliation.evidence.provider_resource_id === context.hostname &&
      reconciliation.evidence.deployment_id === this.config.projectId &&
      reconciliation.evidence.provider_status ===
        "attached_pending_verification" &&
      reconciliation.evidence.verified === false

    if (!exactOwnedAttachment) {
      throw new DomainProvisioningError({
        code: "vercel_verification_attachment_not_owned",
        retryable: false,
      })
    }

    const response = await this.rawRequest(
      "POST",
      this.projectDomainVerificationPath(context.hostname),
    )
    const verificationMayBePendingOrRaced = [400, 404, 409].includes(
      response.response.status,
    )

    if (!response.response.ok && !verificationMayBePendingOrRaced) {
      this.throwForResponse(response)
    }

    if (response.response.ok) {
      const verifiedDomain = parseProjectDomain(response.payload)
      if (!verifiedDomain) {
        throw new DomainProvisioningError({
          code: "vercel_invalid_response",
          retryable: true,
          evidence: response.evidence,
        })
      }
      if (
        !this.isExactProjectDomain(verifiedDomain, context.hostname) ||
        !this.hasNeutralProductionRouting(verifiedDomain)
      ) {
        throw this.verificationIdentityMismatch(response.evidence)
      }
    }

    // The verification mutation response is never readiness authority. A
    // second exact project-domain lookup closes success and provider races.
    const authoritative = await this.lookup(context.hostname)
    if (!authoritative.domain) {
      throw new DomainProvisioningError({
        code: "vercel_verification_attachment_missing",
        retryable: true,
        evidence: {
          ...authoritative.evidence,
          ...(vercelErrorCode(response.payload)
            ? { message_code: vercelErrorCode(response.payload) }
            : {}),
        },
      })
    }
    if (
      !this.isExactProjectDomain(authoritative.domain, context.hostname) ||
      !this.hasNeutralProductionRouting(authoritative.domain)
    ) {
      throw this.verificationIdentityMismatch(authoritative.evidence)
    }

    const verified = authoritative.domain.verified
    return {
      ...authoritative.evidence,
      provider_operation_id: context.hostname,
      provider_resource_id: authoritative.domain.name,
      deployment_id: authoritative.domain.projectId,
      provider_status: verified
        ? "verification_completed"
        : "verification_pending",
      already_applied: verified,
      verified,
      ...(!verified && vercelErrorCode(response.payload)
        ? { message_code: vercelErrorCode(response.payload) }
        : {}),
    }
  }

  async reconcile(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
  ): Promise<ProviderReconciliation> {
    const lookup = await this.lookup(context.hostname)
    const desiredAbsent = job.kind === "deprovision"

    if (!lookup.domain) {
      if (desiredAbsent) {
        return {
          outcome: "matches_intent",
          desiredStateVerified: true,
          evidence: {
            ...lookup.evidence,
            provider_status: "absent",
            verified: true,
            already_applied: true,
          },
        }
      }

      return {
        outcome: "not_found",
        desiredStateVerified: false,
        evidence: {
          ...lookup.evidence,
          provider_status: "not_found",
          verified: false,
        },
      }
    }

    if (!this.isExactProjectDomain(lookup.domain, context.hostname)) {
      return {
        outcome: "conflict",
        desiredStateVerified: false,
        evidence: {
          ...lookup.evidence,
          provider_status: "conflict",
          verified: false,
          message_code: "vercel_project_domain_conflict",
        },
      }
    }

    if (!this.hasNeutralProductionRouting(lookup.domain)) {
      return {
        outcome: "conflict",
        desiredStateVerified: false,
        evidence: {
          ...lookup.evidence,
          provider_status: "routing_conflict",
          verified: false,
          message_code: "vercel_project_domain_routing_conflict",
        },
      }
    }

    const status = lookup.domain.verified
      ? "attached_verified"
      : "attached_pending_verification"
    const evidence: SafeProviderEvidence = {
      ...lookup.evidence,
      provider_resource_id: lookup.domain.name,
      deployment_id: lookup.domain.projectId,
      provider_status: status,
      verified: !desiredAbsent && lookup.domain.verified,
      already_applied: !desiredAbsent,
    }

    if (!desiredAbsent) {
      return {
        outcome: lookup.domain.verified ? "matches_intent" : "needs_apply",
        desiredStateVerified: lookup.domain.verified,
        evidence: {
          ...evidence,
          already_applied: lookup.domain.verified,
        },
        resourceId: lookup.domain.name,
        ownedResource: true,
      }
    }

    return {
      outcome: "needs_apply",
      desiredStateVerified: false,
      evidence: {
        ...evidence,
        provider_status: "attached",
        verified: false,
        already_applied: false,
      },
      resourceId: lookup.domain.name,
      ownedResource: true,
    }
  }

  async apply(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
    reconciliation: ProviderReconciliation,
  ): Promise<SafeProviderEvidence> {
    if (job.kind === "deprovision") {
      if (!reconciliation.resourceId || !reconciliation.ownedResource) {
        throw new DomainProvisioningError({
          code: "vercel_delete_not_owned",
          retryable: false,
        })
      }

      const response = await this.rawRequest(
        "DELETE",
        this.projectDomainPath(context.hostname),
      )
      if (response.response.status !== 404 && !response.response.ok) {
        this.throwForResponse(response)
      }

      return {
        ...response.evidence,
        provider_operation_id: context.hostname,
        provider_resource_id: context.hostname,
        deployment_id: this.config.projectId,
        provider_status:
          response.response.status === 404
            ? "already_absent"
            : "delete_accepted",
        already_applied: response.response.status === 404,
        verified: false,
      }
    }

    if (reconciliation.outcome === "needs_apply") {
      return this.verifyAttachedDomain(context, reconciliation)
    }

    if (
      reconciliation.outcome !== "not_found" ||
      reconciliation.desiredStateVerified !== false ||
      reconciliation.resourceId !== undefined ||
      reconciliation.ownedResource !== undefined
    ) {
      throw new DomainProvisioningError({
        code: "vercel_attach_state_not_absent",
        retryable: false,
      })
    }

    const query = this.teamQuery()
    const response = await this.rawRequest(
      "POST",
      `/v10/projects/${encodeURIComponent(this.config.projectId)}/domains${query}`,
      { name: context.hostname },
    )

    if (!response.response.ok) {
      if (response.response.status === 400) {
        const racedLookup = await this.lookup(context.hostname)
        if (
          racedLookup.domain?.name === context.hostname &&
          racedLookup.domain.projectId === this.config.projectId &&
          this.hasNeutralProductionRouting(racedLookup.domain)
        ) {
          return {
            ...response.evidence,
            provider_operation_id: context.hostname,
            provider_resource_id: context.hostname,
            deployment_id: this.config.projectId,
            provider_status: "already_attached",
            already_applied: true,
            verified: false,
          }
        }
      }
      this.throwForResponse(response)
    }

    const domain = parseProjectDomain(response.payload)
    if (
      !domain ||
      domain.name !== context.hostname ||
      domain.projectId !== this.config.projectId ||
      !this.hasNeutralProductionRouting(domain)
    ) {
      throw new DomainProvisioningError({
        code: "vercel_invalid_response",
        retryable: true,
        evidence: response.evidence,
      })
    }

    return {
      ...response.evidence,
      provider_operation_id: domain.name,
      provider_resource_id: domain.name,
      deployment_id: domain.projectId,
      provider_status: "attach_accepted",
      verified: false,
    }
  }
}
