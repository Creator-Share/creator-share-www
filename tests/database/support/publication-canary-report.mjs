import { createHash } from "node:crypto"

const SENTINEL_HOSTNAME = "publication-sentinel.creatorshare.com"
const SAFETY_CLAIMS = Object.freeze({
  financial_charge_attempted: false,
  provider_capture_attempted: false,
  sponsorship_state_created: false,
  webhook_delivery_verified: false,
})

function timestamp(value, label) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`${label}_invalid`)
  return date.toISOString()
}

function sha256Marker(marker) {
  return createHash("sha256").update(marker, "utf8").digest("hex")
}

function paymentEvidence(provider, observedAt) {
  const stripe = provider !== "paypal"
  return {
    schema_version: 1,
    provider,
    provider_resource_id: stripe
      ? `cs_live_ff040${provider === "stripe_us" ? "us" : "uk"}`
      : "I-FF040ABCDEF",
    provider_status: stripe
      ? "checkout_session_expired_unpaid"
      : "subscription_approval_pending",
    provider_created_at: observedAt,
    provider_return_urls_sha256: sha256Marker(`${provider}:return-urls`),
    outbound_request_id_sha256: sha256Marker(`${provider}:outbound-request`),
    create_http_status: provider === "paypal" ? 201 : 200,
    create_provider_status: stripe ? "open" : null,
    cleanup_request_id_sha256: stripe
      ? sha256Marker(`${provider}:cleanup-request`)
      : null,
    cleanup_http_status: stripe ? 200 : null,
    cleanup_performed: stripe ? true : null,
    provider_credential_request_id:
      provider === "paypal" ? "ff040_paypal_credential_request" : null,
    provider_create_request_id: `ff040_${provider}_create_request`,
    provider_cleanup_request_id: stripe
      ? `ff040_${provider}_cleanup_request`
      : null,
    ...SAFETY_CLAIMS,
    verified: true,
    verified_at: observedAt,
  }
}

function canonicalJson(value, depth = 0) {
  if (depth > 12) throw new Error("publication_report_depth_invalid")
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new Error("publication_report_number_invalid")
    }
    return String(value)
  }
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort()
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`,
      )
      .join(",")}}`
  }
  throw new Error("publication_report_value_invalid")
}

export function buildSuccessfulPublicationCanaryReport(start, lease) {
  const leasedAt = new Date(lease.leased_at)
  const leasedUntil = new Date(lease.leased_until)
  if (
    !Number.isFinite(leasedAt.getTime()) ||
    !Number.isFinite(leasedUntil.getTime()) ||
    leasedAt >= leasedUntil
  ) {
    throw new Error("publication_report_lease_invalid")
  }

  const reportStartedAt = timestamp(leasedAt, "publication_report_start")
  const completionMilliseconds = Math.max(leasedAt.getTime(), Date.now())
  if (completionMilliseconds >= leasedUntil.getTime()) {
    throw new Error("publication_report_lease_expired")
  }
  const reportCompletedAt = timestamp(
    new Date(completionMilliseconds),
    "publication_report_completion",
  )
  const tenantHostname = start.hostname
  const siblingHostname = "ff040-sibling.creatorshare.com"
  const hiddenBodySha256 = sha256Marker("FF-040 generic not found")

  const report = {
    schema_version: 1,
    report_type: "advocate_publication_canary",
    canonicalization_version: 1,
    target: {
      run_id: start.run_id,
      advocate_id: start.advocate_id,
      domain_id: start.domain_id,
      hostname: tenantHostname,
      expected_advocate_version: Number(start.expected_advocate_version),
      deployment_id: start.deployment_id,
      revision: start.revision,
      payment_attempt_ids: {
        stripe_us: start.stripe_us_attempt_id,
        stripe_uk: start.stripe_uk_attempt_id,
        paypal: start.paypal_attempt_id,
      },
    },
    started_at: reportStartedAt,
    completed_at: reportCompletedAt,
    outcome: "succeeded",
    error_code: null,
    safety_claims: { ...SAFETY_CLAIMS },
    steps: [
      {
        name: "dns_exact_host",
        outcome: "succeeded",
        started_at: reportCompletedAt,
        completed_at: reportCompletedAt,
        evidence: {
          schema_version: 1,
          hostname: tenantHostname,
          resolved: true,
          provider_target_matched: true,
          record_types: ["A", "CNAME"],
          answer_count: 2,
          observed_at: reportCompletedAt,
        },
      },
      {
        name: "tls_exact_host",
        outcome: "succeeded",
        started_at: reportCompletedAt,
        completed_at: reportCompletedAt,
        evidence: {
          schema_version: 1,
          hostname: tenantHostname,
          server_name: tenantHostname,
          certificate_verified: true,
          hostname_match: true,
          normal_certificate_verification: true,
          protocol: "TLSv1.3",
          certificate_not_before: timestamp(
            new Date(leasedAt.getTime() - 60_000),
            "publication_report_certificate_start",
          ),
          certificate_not_after: timestamp(
            new Date(leasedAt.getTime() + 3_600_000),
            "publication_report_certificate_end",
          ),
          observed_at: reportCompletedAt,
        },
      },
      {
        name: "protected_exact_host_challenge",
        outcome: "succeeded",
        started_at: reportCompletedAt,
        completed_at: reportCompletedAt,
        evidence: {
          schema_version: 1,
          hostname: tenantHostname,
          http_status: 200,
          response_bytes: 128,
          response_sha256: sha256Marker("FF-040 challenge response"),
          response_verified: true,
          verified_at: reportCompletedAt,
        },
      },
      {
        name: "verifying_tenant_root_hidden",
        outcome: "succeeded",
        started_at: reportCompletedAt,
        completed_at: reportCompletedAt,
        evidence: {
          schema_version: 1,
          hostname: tenantHostname,
          http_status: 404,
          content_type: "text/plain; charset=utf-8",
          body_bytes: 24,
          body_sha256: hiddenBodySha256,
          redirected: false,
          generic_not_found: true,
        },
      },
      {
        name: "unprovisioned_sibling_dns_absent",
        outcome: "succeeded",
        started_at: reportCompletedAt,
        completed_at: reportCompletedAt,
        evidence: {
          hostname: siblingHostname,
          unprovisioned: true,
          resolved: false,
          record_types: [],
          answer_count: 0,
          observed_at: reportCompletedAt,
        },
      },
      {
        name: "negative_sentinel_hidden",
        outcome: "succeeded",
        started_at: reportCompletedAt,
        completed_at: reportCompletedAt,
        evidence: {
          schema_version: 1,
          hostname: SENTINEL_HOSTNAME,
          cloudflare_ready: true,
          vercel_ready: true,
          dns_target_matched: true,
          tls_certificate_verified: true,
          tls_hostname_match: true,
          tls_normal_certificate_verification: true,
          tls_protocol: "TLSv1.3",
          http_status: 404,
          content_type: "text/plain; charset=utf-8",
          body_bytes: 24,
          body_sha256: hiddenBodySha256,
          redirected: false,
          generic_not_found: true,
          identical_to_tenant_root: true,
          observed_at: reportCompletedAt,
        },
      },
      ...["stripe_us", "stripe_uk", "paypal"].map((provider) => ({
        name: `${provider}_payment_canary`,
        outcome: "succeeded",
        started_at: reportCompletedAt,
        completed_at: reportCompletedAt,
        evidence: paymentEvidence(provider, reportCompletedAt),
      })),
    ],
  }
  const canonicalReport = canonicalJson(report)
  return Object.freeze({
    report: Object.freeze(report),
    canonicalReport,
    reportSha256: createHash("sha256").update(canonicalReport, "utf8").digest(),
    completedAt: reportCompletedAt,
  })
}
