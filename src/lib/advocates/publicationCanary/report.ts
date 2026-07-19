import "server-only"

import { createHash } from "node:crypto"

import { resolveAdvocateHost } from "../host"
import { PUBLICATION_CANARY_SENTINEL_HOSTNAME } from "./topology"

export const PUBLICATION_CANARY_REPORT_SCHEMA_VERSION = 1 as const
export const PUBLICATION_CANARY_REPORT_CANONICALIZATION_VERSION = 1 as const
export const MAX_PUBLICATION_CANARY_REPORT_BYTES = 65_536 as const

export const PUBLICATION_CANARY_STEP_ORDER = Object.freeze([
  "dns_exact_host",
  "tls_exact_host",
  "protected_exact_host_challenge",
  "verifying_tenant_root_hidden",
  "unprovisioned_sibling_dns_absent",
  "negative_sentinel_hidden",
  "stripe_us_payment_canary",
  "stripe_uk_payment_canary",
  "paypal_payment_canary",
] as const)

export type PublicationCanaryStepName =
  (typeof PUBLICATION_CANARY_STEP_ORDER)[number]

export const PUBLICATION_CANARY_ERROR_CODES = Object.freeze([
  "dns_exact_host_failed",
  "tls_exact_host_failed",
  "protected_exact_host_challenge_failed",
  "verifying_tenant_root_not_hidden",
  "unprovisioned_sibling_not_hidden",
  "stripe_us_payment_canary_failed",
  "stripe_uk_payment_canary_failed",
  "paypal_payment_canary_failed",
] as const)

export type PublicationCanaryErrorCode =
  (typeof PUBLICATION_CANARY_ERROR_CODES)[number]

export const PUBLICATION_CANARY_STEP_ERROR_CODE = Object.freeze({
  dns_exact_host: "dns_exact_host_failed",
  tls_exact_host: "tls_exact_host_failed",
  protected_exact_host_challenge: "protected_exact_host_challenge_failed",
  verifying_tenant_root_hidden: "verifying_tenant_root_not_hidden",
  unprovisioned_sibling_dns_absent: "unprovisioned_sibling_not_hidden",
  negative_sentinel_hidden: "unprovisioned_sibling_not_hidden",
  stripe_us_payment_canary: "stripe_us_payment_canary_failed",
  stripe_uk_payment_canary: "stripe_uk_payment_canary_failed",
  paypal_payment_canary: "paypal_payment_canary_failed",
} satisfies Record<PublicationCanaryStepName, PublicationCanaryErrorCode>)

export interface PublicationCanaryReportTarget {
  run_id: string
  advocate_id: string
  domain_id: string
  hostname: string
  expected_advocate_version: number
  deployment_id: string
  revision: string
  payment_attempt_ids: {
    stripe_us: string
    stripe_uk: string
    paypal: string
  }
}

export interface PublicationCanarySafetyClaims {
  financial_charge_attempted: false
  provider_capture_attempted: false
  sponsorship_state_created: false
  webhook_delivery_verified: false
}

export interface PublicationCanaryDnsEvidence {
  schema_version: 1
  hostname: string
  resolved: true
  provider_target_matched: true
  record_types: readonly PublicationCanaryDnsRecordType[]
  answer_count: number
  observed_at: string
}

export type PublicationCanaryDnsRecordType = "A" | "AAAA" | "CNAME" | "HTTPS"

export interface PublicationCanaryTlsEvidence {
  schema_version: 1
  hostname: string
  server_name: string
  certificate_verified: true
  hostname_match: true
  normal_certificate_verification: true
  protocol: "TLSv1.2" | "TLSv1.3"
  certificate_not_before: string
  certificate_not_after: string
  observed_at: string
}

export interface PublicationCanaryChallengeEvidence {
  schema_version: 1
  hostname: string
  http_status: 200
  response_bytes: number
  response_sha256: string
  response_verified: true
  verified_at: string
}

export interface PublicationCanaryGenericNotFoundEvidence {
  schema_version: 1
  hostname: string
  http_status: 404
  content_type: string
  body_bytes: number
  body_sha256: string
  redirected: false
  generic_not_found: true
}

export interface PublicationCanarySiblingDnsAbsenceEvidence {
  hostname: string
  unprovisioned: true
  resolved: false
  record_types: readonly []
  answer_count: 0
  observed_at: string
}

export interface PublicationCanaryNegativeSentinelEvidence {
  schema_version: 1
  hostname: typeof PUBLICATION_CANARY_SENTINEL_HOSTNAME
  cloudflare_ready: true
  vercel_ready: true
  dns_target_matched: true
  tls_certificate_verified: true
  tls_hostname_match: true
  tls_normal_certificate_verification: true
  tls_protocol: "TLSv1.2" | "TLSv1.3"
  http_status: 404
  content_type: string
  body_bytes: number
  body_sha256: string
  redirected: false
  generic_not_found: true
  identical_to_tenant_root: true
  observed_at: string
}

export type PublicationPaymentCanaryProvider =
  "stripe_us" | "stripe_uk" | "paypal"

export interface PublicationCanaryPaymentEvidence extends PublicationCanarySafetyClaims {
  schema_version: 1
  provider: PublicationPaymentCanaryProvider
  provider_resource_id: string
  provider_status:
    "checkout_session_expired_unpaid" | "subscription_approval_pending"
  provider_created_at: string
  provider_return_urls_sha256: string
  outbound_request_id_sha256: string
  create_http_status: 200 | 201
  create_provider_status: "open" | "expired" | null
  cleanup_request_id_sha256: string | null
  cleanup_http_status: 200 | null
  cleanup_performed: boolean | null
  provider_credential_request_id: string | null
  provider_create_request_id: string | null
  provider_cleanup_request_id: string | null
  verified: true
  verified_at: string
}

export interface PublicationCanaryFailedStepEvidence {
  schema_version: 1
  failure_code: PublicationCanaryErrorCode
}

export type PublicationCanarySucceededEvidence =
  | PublicationCanaryDnsEvidence
  | PublicationCanaryTlsEvidence
  | PublicationCanaryChallengeEvidence
  | PublicationCanaryGenericNotFoundEvidence
  | PublicationCanarySiblingDnsAbsenceEvidence
  | PublicationCanaryNegativeSentinelEvidence
  | PublicationCanaryPaymentEvidence

export type PublicationCanaryReportStep = Readonly<{
  name: PublicationCanaryStepName
  outcome: "succeeded" | "failed"
  started_at: string
  completed_at: string
  evidence:
    PublicationCanarySucceededEvidence | PublicationCanaryFailedStepEvidence
}>

export interface PublicationCanaryReport {
  schema_version: 1
  report_type: "advocate_publication_canary"
  canonicalization_version: 1
  target: PublicationCanaryReportTarget
  started_at: string
  completed_at: string
  outcome: "succeeded" | "failed"
  error_code: PublicationCanaryErrorCode | null
  safety_claims: PublicationCanarySafetyClaims
  steps: readonly PublicationCanaryReportStep[]
}

export class PublicationCanaryReportContractError extends Error {
  constructor() {
    super("advocate_publication_canary_report_contract_invalid")
    this.name = "PublicationCanaryReportContractError"
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const REVISION_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SAFE_PROVIDER_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/
const STRIPE_SESSION_ID_PATTERN = /^cs_live_[A-Za-z0-9]+$/
const PAYPAL_SUBSCRIPTION_ID_PATTERN = /^I-[A-Z0-9]{10,32}$/
const RFC3339_MILLISECOND_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SAFE_CONTENT_TYPE_PATTERN = /^[\x20-\x7e]{1,200}$/
const DNS_RECORD_TYPES = new Set<PublicationCanaryDnsRecordType>([
  "A",
  "AAAA",
  "CNAME",
  "HTTPS",
])
const PAYMENT_PROVIDERS = new Set<PublicationPaymentCanaryProvider>([
  "stripe_us",
  "stripe_uk",
  "paypal",
])
const ERROR_CODES = new Set<PublicationCanaryErrorCode>(
  PUBLICATION_CANARY_ERROR_CODES,
)
const MAX_CANONICAL_DEPTH = 12
const MAX_CANONICAL_ARRAY_LENGTH = 16
const MAX_CANONICAL_OBJECT_KEYS = 32
const MAX_CANONICAL_STRING_LENGTH = 4_096

const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "report_type",
  "canonicalization_version",
  "target",
  "started_at",
  "completed_at",
  "outcome",
  "error_code",
  "safety_claims",
  "steps",
])
const TARGET_KEYS = Object.freeze([
  "run_id",
  "advocate_id",
  "domain_id",
  "hostname",
  "expected_advocate_version",
  "deployment_id",
  "revision",
  "payment_attempt_ids",
])
const PAYMENT_ATTEMPT_KEYS = Object.freeze(["stripe_us", "stripe_uk", "paypal"])
const SAFETY_KEYS = Object.freeze([
  "financial_charge_attempted",
  "provider_capture_attempted",
  "sponsorship_state_created",
  "webhook_delivery_verified",
])
const STEP_KEYS = Object.freeze([
  "name",
  "outcome",
  "started_at",
  "completed_at",
  "evidence",
])
const FAILURE_EVIDENCE_KEYS = Object.freeze(["schema_version", "failure_code"])
const DNS_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "hostname",
  "resolved",
  "provider_target_matched",
  "record_types",
  "answer_count",
  "observed_at",
])
const TLS_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "hostname",
  "server_name",
  "certificate_verified",
  "hostname_match",
  "normal_certificate_verification",
  "protocol",
  "certificate_not_before",
  "certificate_not_after",
  "observed_at",
])
const CHALLENGE_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "hostname",
  "http_status",
  "response_bytes",
  "response_sha256",
  "response_verified",
  "verified_at",
])
const NOT_FOUND_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "hostname",
  "http_status",
  "content_type",
  "body_bytes",
  "body_sha256",
  "redirected",
  "generic_not_found",
])
const SIBLING_DNS_ABSENCE_EVIDENCE_KEYS = Object.freeze([
  "hostname",
  "unprovisioned",
  "resolved",
  "record_types",
  "answer_count",
  "observed_at",
])
const NEGATIVE_SENTINEL_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "hostname",
  "cloudflare_ready",
  "vercel_ready",
  "dns_target_matched",
  "tls_certificate_verified",
  "tls_hostname_match",
  "tls_normal_certificate_verification",
  "tls_protocol",
  "http_status",
  "content_type",
  "body_bytes",
  "body_sha256",
  "redirected",
  "generic_not_found",
  "identical_to_tenant_root",
  "observed_at",
])
const PAYMENT_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "provider",
  "provider_resource_id",
  "provider_status",
  "provider_created_at",
  "provider_return_urls_sha256",
  "outbound_request_id_sha256",
  "create_http_status",
  "create_provider_status",
  "cleanup_request_id_sha256",
  "cleanup_http_status",
  "cleanup_performed",
  "provider_credential_request_id",
  "provider_create_request_id",
  "provider_cleanup_request_id",
  ...SAFETY_KEYS,
  "verified",
  "verified_at",
])

function contractError(): never {
  throw new PublicationCanaryReportContractError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    RFC3339_MILLISECOND_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function isExactAdvocateHostname(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 253) return false
  const resolution = resolveAdvocateHost(value)
  return (
    resolution.kind === "tenant-candidate" &&
    resolution.environment === "production" &&
    resolution.requestPort === null &&
    resolution.requestHostname === value &&
    resolution.domainLookup.hostname === value
  )
}

function validSafetyClaims(
  value: unknown,
): value is PublicationCanarySafetyClaims {
  return (
    isRecord(value) &&
    exactKeys(value, SAFETY_KEYS) &&
    value.financial_charge_attempted === false &&
    value.provider_capture_attempted === false &&
    value.sponsorship_state_created === false &&
    value.webhook_delivery_verified === false
  )
}

function validTarget(value: unknown): value is PublicationCanaryReportTarget {
  if (
    !isRecord(value) ||
    !exactKeys(value, TARGET_KEYS) ||
    !isRecord(value.payment_attempt_ids) ||
    !exactKeys(value.payment_attempt_ids, PAYMENT_ATTEMPT_KEYS) ||
    !isUuid(value.run_id) ||
    !isUuid(value.advocate_id) ||
    !isUuid(value.domain_id) ||
    !isExactAdvocateHostname(value.hostname) ||
    typeof value.expected_advocate_version !== "number" ||
    !Number.isSafeInteger(value.expected_advocate_version) ||
    value.expected_advocate_version < 1 ||
    typeof value.deployment_id !== "string" ||
    !DEPLOYMENT_ID_PATTERN.test(value.deployment_id) ||
    typeof value.revision !== "string" ||
    !REVISION_PATTERN.test(value.revision) ||
    !isUuid(value.payment_attempt_ids.stripe_us) ||
    !isUuid(value.payment_attempt_ids.stripe_uk) ||
    !isUuid(value.payment_attempt_ids.paypal)
  ) {
    return false
  }

  return (
    new Set([
      value.payment_attempt_ids.stripe_us,
      value.payment_attempt_ids.stripe_uk,
      value.payment_attempt_ids.paypal,
    ]).size === 3
  )
}

function validEvidenceString(value: unknown): value is string {
  return (
    typeof value === "string" && SAFE_PROVIDER_IDENTIFIER_PATTERN.test(value)
  )
}

function validDnsEvidence(
  value: Record<string, unknown>,
  hostname: string,
): boolean {
  if (
    !exactKeys(value, DNS_EVIDENCE_KEYS) ||
    value.schema_version !== 1 ||
    value.hostname !== hostname ||
    value.resolved !== true ||
    value.provider_target_matched !== true ||
    !Array.isArray(value.record_types) ||
    value.record_types.length < 1 ||
    value.record_types.length > DNS_RECORD_TYPES.size ||
    !value.record_types.every(
      (item): item is PublicationCanaryDnsRecordType =>
        typeof item === "string" &&
        DNS_RECORD_TYPES.has(item as PublicationCanaryDnsRecordType),
    ) ||
    new Set(value.record_types).size !== value.record_types.length ||
    value.record_types.join(",") !== [...value.record_types].sort().join(",") ||
    typeof value.answer_count !== "number" ||
    !Number.isSafeInteger(value.answer_count) ||
    value.answer_count < 1 ||
    value.answer_count > 1_000 ||
    !isTimestamp(value.observed_at)
  ) {
    return false
  }
  return true
}

function validTlsEvidence(
  value: Record<string, unknown>,
  hostname: string,
): boolean {
  return (
    exactKeys(value, TLS_EVIDENCE_KEYS) &&
    value.schema_version === 1 &&
    value.hostname === hostname &&
    value.server_name === hostname &&
    value.certificate_verified === true &&
    value.hostname_match === true &&
    value.normal_certificate_verification === true &&
    (value.protocol === "TLSv1.2" || value.protocol === "TLSv1.3") &&
    isTimestamp(value.certificate_not_before) &&
    isTimestamp(value.certificate_not_after) &&
    isTimestamp(value.observed_at) &&
    value.certificate_not_before <= value.observed_at &&
    value.observed_at < value.certificate_not_after
  )
}

function validChallengeEvidence(
  value: Record<string, unknown>,
  hostname: string,
): boolean {
  return (
    exactKeys(value, CHALLENGE_EVIDENCE_KEYS) &&
    value.schema_version === 1 &&
    value.hostname === hostname &&
    value.http_status === 200 &&
    typeof value.response_bytes === "number" &&
    Number.isSafeInteger(value.response_bytes) &&
    value.response_bytes >= 1 &&
    value.response_bytes <= 4_096 &&
    typeof value.response_sha256 === "string" &&
    SHA256_PATTERN.test(value.response_sha256) &&
    value.response_verified === true &&
    isTimestamp(value.verified_at)
  )
}

function validNotFoundEvidence(
  value: Record<string, unknown>,
  hostname: string,
): boolean {
  return (
    exactKeys(value, NOT_FOUND_EVIDENCE_KEYS) &&
    value.schema_version === 1 &&
    value.hostname === hostname &&
    value.http_status === 404 &&
    typeof value.content_type === "string" &&
    SAFE_CONTENT_TYPE_PATTERN.test(value.content_type) &&
    typeof value.body_bytes === "number" &&
    Number.isSafeInteger(value.body_bytes) &&
    value.body_bytes >= 1 &&
    value.body_bytes <= 32_768 &&
    typeof value.body_sha256 === "string" &&
    SHA256_PATTERN.test(value.body_sha256) &&
    value.redirected === false &&
    value.generic_not_found === true
  )
}

function validSiblingDnsAbsenceEvidence(
  value: Record<string, unknown>,
  tenantHostname: string,
): boolean {
  return (
    exactKeys(value, SIBLING_DNS_ABSENCE_EVIDENCE_KEYS) &&
    isExactAdvocateHostname(value.hostname) &&
    value.hostname !== tenantHostname &&
    value.hostname !== PUBLICATION_CANARY_SENTINEL_HOSTNAME &&
    value.unprovisioned === true &&
    value.resolved === false &&
    Array.isArray(value.record_types) &&
    value.record_types.length === 0 &&
    value.answer_count === 0 &&
    isTimestamp(value.observed_at)
  )
}

function validNegativeSentinelEvidence(
  value: Record<string, unknown>,
): boolean {
  return (
    exactKeys(value, NEGATIVE_SENTINEL_EVIDENCE_KEYS) &&
    value.schema_version === 1 &&
    value.hostname === PUBLICATION_CANARY_SENTINEL_HOSTNAME &&
    value.cloudflare_ready === true &&
    value.vercel_ready === true &&
    value.dns_target_matched === true &&
    value.tls_certificate_verified === true &&
    value.tls_hostname_match === true &&
    value.tls_normal_certificate_verification === true &&
    (value.tls_protocol === "TLSv1.2" || value.tls_protocol === "TLSv1.3") &&
    value.http_status === 404 &&
    typeof value.content_type === "string" &&
    SAFE_CONTENT_TYPE_PATTERN.test(value.content_type) &&
    typeof value.body_bytes === "number" &&
    Number.isSafeInteger(value.body_bytes) &&
    value.body_bytes >= 1 &&
    value.body_bytes <= 32_768 &&
    typeof value.body_sha256 === "string" &&
    SHA256_PATTERN.test(value.body_sha256) &&
    value.redirected === false &&
    value.generic_not_found === true &&
    value.identical_to_tenant_root === true &&
    isTimestamp(value.observed_at)
  )
}

function validNullableEvidenceString(value: unknown): boolean {
  return value === null || validEvidenceString(value)
}

function validPaymentEvidence(
  value: Record<string, unknown>,
  expectedProvider: PublicationPaymentCanaryProvider,
): boolean {
  const stripe = expectedProvider !== "paypal"
  return (
    exactKeys(value, PAYMENT_EVIDENCE_KEYS) &&
    value.schema_version === 1 &&
    value.provider === expectedProvider &&
    PAYMENT_PROVIDERS.has(expectedProvider) &&
    typeof value.provider_resource_id === "string" &&
    (stripe
      ? STRIPE_SESSION_ID_PATTERN.test(value.provider_resource_id)
      : PAYPAL_SUBSCRIPTION_ID_PATTERN.test(value.provider_resource_id)) &&
    value.provider_status ===
      (stripe
        ? "checkout_session_expired_unpaid"
        : "subscription_approval_pending") &&
    isTimestamp(value.provider_created_at) &&
    typeof value.provider_return_urls_sha256 === "string" &&
    SHA256_PATTERN.test(value.provider_return_urls_sha256) &&
    typeof value.outbound_request_id_sha256 === "string" &&
    SHA256_PATTERN.test(value.outbound_request_id_sha256) &&
    (value.create_http_status === 200 ||
      (!stripe && value.create_http_status === 201)) &&
    (stripe
      ? value.create_provider_status === "open" ||
        value.create_provider_status === "expired"
      : value.create_provider_status === null) &&
    (stripe
      ? typeof value.cleanup_request_id_sha256 === "string" &&
        SHA256_PATTERN.test(value.cleanup_request_id_sha256)
      : value.cleanup_request_id_sha256 === null) &&
    (stripe
      ? value.cleanup_http_status === 200 || value.cleanup_http_status === null
      : value.cleanup_http_status === null) &&
    (stripe
      ? typeof value.cleanup_performed === "boolean"
      : value.cleanup_performed === null) &&
    (stripe
      ? value.provider_credential_request_id === null
      : validNullableEvidenceString(value.provider_credential_request_id)) &&
    validNullableEvidenceString(value.provider_create_request_id) &&
    (stripe
      ? validNullableEvidenceString(value.provider_cleanup_request_id)
      : value.provider_cleanup_request_id === null) &&
    validSafetyClaims({
      financial_charge_attempted: value.financial_charge_attempted,
      provider_capture_attempted: value.provider_capture_attempted,
      sponsorship_state_created: value.sponsorship_state_created,
      webhook_delivery_verified: value.webhook_delivery_verified,
    }) &&
    value.verified === true &&
    isTimestamp(value.verified_at)
  )
}

function validSucceededEvidence(
  stepName: PublicationCanaryStepName,
  value: unknown,
  report: PublicationCanaryReport,
): boolean {
  if (!isRecord(value)) return false
  switch (stepName) {
    case "dns_exact_host":
      return validDnsEvidence(value, report.target.hostname)
    case "tls_exact_host":
      return validTlsEvidence(value, report.target.hostname)
    case "protected_exact_host_challenge":
      return validChallengeEvidence(value, report.target.hostname)
    case "verifying_tenant_root_hidden":
      return validNotFoundEvidence(value, report.target.hostname)
    case "unprovisioned_sibling_dns_absent":
      return validSiblingDnsAbsenceEvidence(value, report.target.hostname)
    case "negative_sentinel_hidden":
      return validNegativeSentinelEvidence(value)
    case "stripe_us_payment_canary":
      return validPaymentEvidence(value, "stripe_us")
    case "stripe_uk_payment_canary":
      return validPaymentEvidence(value, "stripe_uk")
    case "paypal_payment_canary":
      return validPaymentEvidence(value, "paypal")
  }
}

function validFailedEvidence(
  stepName: PublicationCanaryStepName,
  value: unknown,
): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, FAILURE_EVIDENCE_KEYS) &&
    value.schema_version === 1 &&
    value.failure_code === PUBLICATION_CANARY_STEP_ERROR_CODE[stepName]
  )
}

/**
 * Rejects unknown fields and noncanonical step order before report bytes can be
 * persisted. This validator is intentionally local to publication evidence and
 * does not share the payment request fingerprint contract.
 */
export function assertPublicationCanaryReport(
  value: unknown,
): asserts value is PublicationCanaryReport {
  if (
    !isRecord(value) ||
    !exactKeys(value, TOP_LEVEL_KEYS) ||
    value.schema_version !== PUBLICATION_CANARY_REPORT_SCHEMA_VERSION ||
    value.report_type !== "advocate_publication_canary" ||
    value.canonicalization_version !==
      PUBLICATION_CANARY_REPORT_CANONICALIZATION_VERSION ||
    !validTarget(value.target) ||
    !isTimestamp(value.started_at) ||
    !isTimestamp(value.completed_at) ||
    value.started_at > value.completed_at ||
    (value.outcome !== "succeeded" && value.outcome !== "failed") ||
    (value.error_code !== null &&
      !ERROR_CODES.has(value.error_code as PublicationCanaryErrorCode)) ||
    !validSafetyClaims(value.safety_claims) ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > PUBLICATION_CANARY_STEP_ORDER.length
  ) {
    contractError()
  }

  const report = value as unknown as PublicationCanaryReport
  for (let index = 0; index < report.steps.length; index += 1) {
    const step = report.steps[index]
    if (
      !isRecord(step) ||
      !exactKeys(step, STEP_KEYS) ||
      step.name !== PUBLICATION_CANARY_STEP_ORDER[index] ||
      (step.outcome !== "succeeded" && step.outcome !== "failed") ||
      !isTimestamp(step.started_at) ||
      !isTimestamp(step.completed_at) ||
      report.started_at > step.started_at ||
      step.started_at > step.completed_at ||
      step.completed_at > report.completed_at ||
      (index > 0 && report.steps[index - 1].completed_at > step.started_at) ||
      (step.outcome === "succeeded"
        ? !validSucceededEvidence(step.name, step.evidence, report)
        : !validFailedEvidence(step.name, step.evidence))
    ) {
      contractError()
    }
  }

  const finalStep = report.steps.at(-1)
  if (
    (report.outcome === "succeeded" &&
      (report.error_code !== null ||
        report.steps.length !== PUBLICATION_CANARY_STEP_ORDER.length ||
        report.steps.some((step) => step.outcome !== "succeeded"))) ||
    (report.outcome === "failed" &&
      (report.error_code === null ||
        finalStep?.outcome !== "failed" ||
        !isRecord(finalStep.evidence) ||
        finalStep.evidence.failure_code !== report.error_code ||
        report.steps.slice(0, -1).some((step) => step.outcome !== "succeeded")))
  ) {
    contractError()
  }
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_CANONICAL_DEPTH) contractError()
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      contractError()
    }
    return String(value)
  }
  if (typeof value === "string") {
    if (value.length > MAX_CANONICAL_STRING_LENGTH) contractError()
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CANONICAL_ARRAY_LENGTH) contractError()
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    if (keys.length > MAX_CANONICAL_OBJECT_KEYS) contractError()
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`,
      )
      .join(",")}}`
  }
  contractError()
}

export function serializeCanonicalPublicationCanaryReport(
  report: PublicationCanaryReport,
): string {
  assertPublicationCanaryReport(report)
  const canonical = canonicalJson(report)
  if (
    Buffer.byteLength(canonical, "utf8") > MAX_PUBLICATION_CANARY_REPORT_BYTES
  ) {
    contractError()
  }
  return canonical
}

export function publicationCanaryReportSha256(
  report: PublicationCanaryReport,
): string {
  return createHash("sha256")
    .update(serializeCanonicalPublicationCanaryReport(report), "utf8")
    .digest("hex")
}
