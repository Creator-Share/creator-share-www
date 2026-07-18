import type { CloudflareProvisioningConfig } from "./config"
import {
  fetchProviderJson,
  isRecord,
  retryAfterSeconds,
  type FetchImplementation,
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

interface CloudflareDnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  comment?: string
}

interface CloudflareLookup {
  records: CloudflareDnsRecord[]
  requestEvidence: SafeProviderEvidence
}

const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com"

function normalizeDnsValue(value: string): string {
  return value.toLowerCase().replace(/\.$/, "")
}

function ownerComment(integrationId: string): string {
  return `creator-share:advocate-domain-integration:${integrationId}`
}

function cloudflareErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) return undefined
  const first = payload.errors[0]
  if (!isRecord(first)) return undefined
  const code = first.code
  if (typeof code !== "number" && typeof code !== "string") return undefined
  return sanitizeEvidenceString(`cloudflare_error_${String(code)}`)
}

function parseRecord(value: unknown): CloudflareDnsRecord | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[0-9a-f]{32}$/i.test(value.id) ||
    typeof value.type !== "string" ||
    typeof value.name !== "string" ||
    typeof value.content !== "string" ||
    typeof value.proxied !== "boolean" ||
    (value.comment !== undefined && value.comment !== null && typeof value.comment !== "string")
  ) {
    return null
  }

  return {
    id: value.id,
    type: value.type,
    name: normalizeDnsValue(value.name),
    content: normalizeDnsValue(value.content),
    proxied: value.proxied,
    ...(typeof value.comment === "string" ? { comment: value.comment } : {}),
  }
}

export class CloudflareDomainAdapter implements DomainProviderAdapter {
  readonly provider = "cloudflare" as const

  constructor(
    private readonly config: CloudflareProvisioningConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  private async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ) {
    const result = await fetchProviderJson({
      provider: this.provider,
      fetchImplementation: this.fetchImplementation,
      url: `${CLOUDFLARE_API_ORIGIN}${path}`,
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

    const success = isRecord(result.payload) && result.payload.success === true
    if (!result.response.ok || !success) {
      const status = result.response.status
      const retryable = status === 429 || status >= 500
      throw new DomainProvisioningError({
        code:
          status === 401 || status === 403
            ? "cloudflare_authorization_failed"
            : retryable
              ? "cloudflare_transient_error"
              : "cloudflare_request_rejected",
        retryable,
        retryAfterSeconds: retryAfterSeconds(result.response),
        evidence: {
          ...result.evidence,
          ...(cloudflareErrorCode(result.payload)
            ? { message_code: cloudflareErrorCode(result.payload) }
            : {}),
        },
      })
    }

    return result
  }

  private async lookup(hostname: string): Promise<CloudflareLookup> {
    const query = new URLSearchParams({
      name: hostname,
      match: "all",
      per_page: "100",
    })
    const response = await this.request(
      "GET",
      `/client/v4/zones/${encodeURIComponent(this.config.zoneId)}/dns_records?${query.toString()}`,
    )

    if (!isRecord(response.payload) || !Array.isArray(response.payload.result)) {
      throw new DomainProvisioningError({
        code: "cloudflare_invalid_response",
        retryable: true,
        evidence: response.evidence,
      })
    }

    const parsed = response.payload.result.map(parseRecord)
    if (parsed.some((record) => record === null)) {
      throw new DomainProvisioningError({
        code: "cloudflare_invalid_response",
        retryable: true,
        evidence: response.evidence,
      })
    }

    return {
      records: (parsed as CloudflareDnsRecord[]).filter(
        (record) => record.name === hostname,
      ),
      requestEvidence: response.evidence,
    }
  }

  private isOwned(
    record: CloudflareDnsRecord,
    context: DomainProvisioningContext,
  ): boolean {
    return (
      record.comment === ownerComment(context.integrationId) ||
      context.integrationExternalIdentifier === record.id
    )
  }

  async reconcile(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
  ): Promise<ProviderReconciliation> {
    const lookup = await this.lookup(context.hostname)
    const desiredAbsent = job.kind === "deprovision"

    if (lookup.records.length === 0) {
      if (desiredAbsent) {
        return {
          outcome: "matches_intent",
          desiredStateVerified: true,
          evidence: {
            ...lookup.requestEvidence,
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
          ...lookup.requestEvidence,
          provider_status: "not_found",
          verified: false,
        },
      }
    }

    if (lookup.records.length !== 1) {
      return {
        outcome: "conflict",
        desiredStateVerified: false,
        evidence: {
          ...lookup.requestEvidence,
          provider_status: "conflict",
          verified: false,
          message_code: "cloudflare_multiple_exact_records",
        },
      }
    }

    const record = lookup.records[0]
    const owned = this.isOwned(record, context)
    const desiredRecord =
      record.type === "CNAME" &&
      record.content === this.config.cnameTarget &&
      record.proxied === false

    const recordEvidence: SafeProviderEvidence = {
      ...lookup.requestEvidence,
      provider_resource_id: record.id,
      dns_record_id: record.id,
      provider_status: desiredRecord ? "dns_only_cname_ready" : "drifted",
      verified: !desiredAbsent && desiredRecord,
      already_applied: !desiredAbsent && desiredRecord,
    }

    if (!desiredAbsent && desiredRecord) {
      return {
        outcome: "matches_intent",
        desiredStateVerified: true,
        evidence: recordEvidence,
        resourceId: record.id,
        ownedResource: owned,
      }
    }

    if (!owned) {
      return {
        outcome: "conflict",
        desiredStateVerified: false,
        evidence: {
          ...recordEvidence,
          provider_status: "conflict",
          verified: false,
          already_applied: false,
          message_code: "cloudflare_unowned_record_conflict",
        },
        resourceId: record.id,
        ownedResource: false,
      }
    }

    return {
      outcome: "needs_apply",
      desiredStateVerified: false,
      evidence: recordEvidence,
      resourceId: record.id,
      ownedResource: true,
    }
  }

  async apply(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
    reconciliation: ProviderReconciliation,
  ): Promise<SafeProviderEvidence> {
    const basePath = `/client/v4/zones/${encodeURIComponent(this.config.zoneId)}/dns_records`

    if (job.kind === "deprovision") {
      if (!reconciliation.resourceId || !reconciliation.ownedResource) {
        throw new DomainProvisioningError({
          code: "cloudflare_delete_not_owned",
          retryable: false,
        })
      }

      const response = await this.request(
        "DELETE",
        `${basePath}/${encodeURIComponent(reconciliation.resourceId)}`,
      )
      return {
        ...response.evidence,
        provider_operation_id: reconciliation.resourceId,
        dns_record_id: reconciliation.resourceId,
        provider_status: "delete_accepted",
        verified: false,
      }
    }

    const body = {
      type: "CNAME",
      name: context.hostname,
      content: this.config.cnameTarget,
      ttl: this.config.ttl,
      proxied: false,
      comment: ownerComment(context.integrationId),
    }

    const method = reconciliation.resourceId ? "PATCH" : "POST"
    const path = reconciliation.resourceId
      ? `${basePath}/${encodeURIComponent(reconciliation.resourceId)}`
      : basePath
    const response = await this.request(method, path, body)
    const record = isRecord(response.payload)
      ? parseRecord(response.payload.result)
      : null

    if (!record) {
      throw new DomainProvisioningError({
        code: "cloudflare_invalid_response",
        retryable: true,
        evidence: response.evidence,
      })
    }

    return {
      ...response.evidence,
      provider_operation_id: record.id,
      provider_resource_id: record.id,
      dns_record_id: record.id,
      provider_status: method === "POST" ? "create_accepted" : "update_accepted",
      verified: false,
    }
  }
}
