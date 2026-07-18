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
    typeof value.verified !== "boolean"
  ) {
    return null
  }

  return {
    name: value.name.toLowerCase().replace(/\.$/, ""),
    projectId: value.projectId,
    verified: value.verified,
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

  private async lookup(
    hostname: string,
  ): Promise<{
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

    if (
      lookup.domain.name !== context.hostname ||
      lookup.domain.projectId !== this.config.projectId
    ) {
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
        outcome: "matches_intent",
        desiredStateVerified: lookup.domain.verified,
        evidence,
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
          racedLookup.domain.projectId === this.config.projectId
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
      domain.projectId !== this.config.projectId
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
