import "server-only"

import { createHash, randomBytes as systemRandomBytes } from "node:crypto"

import type {
  PayPalPublicationPaymentCanaryEvidence,
  PublicationPaymentCanaryInput,
  StripePublicationPaymentCanaryEvidence,
} from "../provisioning/paymentCanaries"
import { resolveAdvocateHost } from "../host"
import {
  ADVOCATE_PUBLICATION_CANARY_PATH,
  type PublicationCanaryClaims,
  type PublicationCanaryResponseBody,
  type PublicationCanaryTokenInput,
} from "./challenge"
import {
  PUBLICATION_CANARY_STEP_ERROR_CODE,
  type PublicationCanaryDnsEvidence,
  type PublicationCanaryDnsRecordType,
  type PublicationCanaryErrorCode,
  type PublicationCanaryGenericNotFoundEvidence,
  type PublicationCanaryPaymentEvidence,
  type PublicationCanaryReport,
  type PublicationCanaryReportStep,
  type PublicationCanarySafetyClaims,
  type PublicationCanarySiblingNotFoundEvidence,
  type PublicationCanaryStepName,
  type PublicationCanarySucceededEvidence,
  type PublicationCanaryTlsEvidence,
  type PublicationCanaryChallengeEvidence,
  serializeCanonicalPublicationCanaryReport,
} from "./report"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const REVISION_PATTERN = /^[0-9a-f]{40}$/
const RFC3339_MILLISECOND_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SAFE_PROVIDER_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/
const STRIPE_SESSION_ID_PATTERN = /^cs_live_[A-Za-z0-9]+$/
const PAYPAL_SUBSCRIPTION_ID_PATTERN = /^I-[A-Z0-9]{10,32}$/
const CANARY_TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SAFE_CONTENT_TYPE_PATTERN = /^[\x20-\x7e]{1,200}$/
const MAX_PROTECTED_CHALLENGE_BODY_BYTES = 4_096
const MAX_GENERIC_NOT_FOUND_BODY_BYTES = 32_768
const MAX_CANARY_TOKEN_BYTES = 2_048
const PUBLICATION_CANARY_NETWORK_TIMEOUT_MS = 10_000
const SIBLING_RANDOM_BYTES = 16

const DNS_RECORD_TYPES = new Set<PublicationCanaryDnsRecordType>([
  "A",
  "AAAA",
  "CNAME",
  "HTTPS",
])

const SAFETY_CLAIMS = Object.freeze({
  financial_charge_attempted: false,
  provider_capture_attempted: false,
  sponsorship_state_created: false,
  webhook_delivery_verified: false,
} satisfies PublicationCanarySafetyClaims)

export interface PublicationCanaryRunnerTarget {
  runId: string
  advocateId: string
  domainId: string
  hostname: string
  expectedAdvocateVersion: number
  deploymentId: string
  revision: string
  paymentAttemptIds: {
    stripeUs: string
    stripeUk: string
    paypal: string
  }
}

export interface PublicationCanaryDnsObservation {
  hostname: string
  resolved: true
  providerTargetMatched: true
  recordTypes: readonly PublicationCanaryDnsRecordType[]
  answerCount: number
  observedAt: string
}

export interface PublicationCanaryTlsObservation {
  hostname: string
  serverName: string
  certificateVerified: true
  hostnameMatched: true
  normalCertificateVerification: true
  protocol: "TLSv1.2" | "TLSv1.3"
  certificateNotBefore: string
  certificateNotAfter: string
  observedAt: string
}

export interface PublicationCanaryHttpRequest {
  kind:
    | "protected_exact_host_challenge"
    | "verifying_tenant_root"
    | "unprovisioned_sibling_root"
  method: "GET" | "POST"
  url: string
  hostname: string
  headers: Readonly<Record<string, string>>
  redirect: "error"
  credentials: "omit"
  cache: "no-store"
  timeoutMs: number
  maxResponseBytes: number
}

export interface PublicationCanaryHttpResponse {
  requestedHostname: string
  finalUrl: string
  status: number
  redirected: boolean
  contentType: string
  body: Uint8Array
}

export interface PublicationCanaryProtectedChallenge {
  token: string
  claims: PublicationCanaryClaims
}

export interface PublicationCanaryRunnerDependencies {
  now?: () => number
  randomBytes?: (size: number) => Uint8Array
  observeDns(input: {
    hostname: string
    timeoutMs: number
  }): Promise<PublicationCanaryDnsObservation>
  inspectTls(input: {
    hostname: string
    serverName: string
    rejectUnauthorized: true
    timeoutMs: number
  }): Promise<PublicationCanaryTlsObservation>
  requestHttp(
    input: PublicationCanaryHttpRequest,
  ): Promise<PublicationCanaryHttpResponse>
  createProtectedChallenge(
    input: PublicationCanaryTokenInput,
  ): PublicationCanaryProtectedChallenge
  verifyProtectedChallengeResponse(
    rawBody: string,
    expectedClaims: PublicationCanaryClaims,
  ): PublicationCanaryResponseBody | null
  isHostnameProvisioned(hostname: string): Promise<boolean>
  runStripeUsPaymentCanary(
    input: PublicationPaymentCanaryInput,
  ): Promise<StripePublicationPaymentCanaryEvidence>
  runStripeUkPaymentCanary(
    input: PublicationPaymentCanaryInput,
  ): Promise<StripePublicationPaymentCanaryEvidence>
  runPayPalPaymentCanary(
    input: PublicationPaymentCanaryInput,
  ): Promise<PayPalPublicationPaymentCanaryEvidence>
}

export interface PublicationCanaryRunnerResult {
  report: PublicationCanaryReport
  canonicalReport: string
  reportSha256: string
}

export class PublicationCanaryRunnerInputError extends Error {
  constructor() {
    super("advocate_publication_canary_runner_input_invalid")
    this.name = "PublicationCanaryRunnerInputError"
  }
}

interface GenericNotFoundFingerprint {
  contentType: string
  bodyBytes: number
  bodySha256: string
  body: Uint8Array
}

interface RunnerClock {
  timestamp(): string
  safeTimestamp(): string
}

function inputError(): never {
  throw new PublicationCanaryRunnerInputError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function assertRunnerTarget(
  target: PublicationCanaryRunnerTarget,
): PublicationCanaryRunnerTarget {
  if (
    !isRecord(target) ||
    !isRecord(target.paymentAttemptIds) ||
    !isUuid(target.runId) ||
    !isUuid(target.advocateId) ||
    !isUuid(target.domainId) ||
    !isExactAdvocateHostname(target.hostname) ||
    typeof target.expectedAdvocateVersion !== "number" ||
    !Number.isSafeInteger(target.expectedAdvocateVersion) ||
    target.expectedAdvocateVersion < 1 ||
    typeof target.deploymentId !== "string" ||
    !DEPLOYMENT_ID_PATTERN.test(target.deploymentId) ||
    typeof target.revision !== "string" ||
    !REVISION_PATTERN.test(target.revision) ||
    !isUuid(target.paymentAttemptIds.stripeUs) ||
    !isUuid(target.paymentAttemptIds.stripeUk) ||
    !isUuid(target.paymentAttemptIds.paypal) ||
    new Set([
      target.paymentAttemptIds.stripeUs,
      target.paymentAttemptIds.stripeUk,
      target.paymentAttemptIds.paypal,
    ]).size !== 3
  ) {
    inputError()
  }
  return target
}

function createRunnerClock(now: () => number): RunnerClock {
  let lastMilliseconds: number
  try {
    lastMilliseconds = now()
  } catch {
    inputError()
  }
  if (
    !Number.isFinite(lastMilliseconds) ||
    !Number.isSafeInteger(lastMilliseconds) ||
    lastMilliseconds < 0
  ) {
    inputError()
  }

  return {
    timestamp() {
      let next: number
      try {
        next = now()
      } catch {
        throw new Error("publication_canary_clock_unavailable")
      }
      if (
        !Number.isFinite(next) ||
        !Number.isSafeInteger(next) ||
        next < lastMilliseconds
      ) {
        throw new Error("publication_canary_clock_unavailable")
      }
      lastMilliseconds = next
      return new Date(next).toISOString()
    },
    safeTimestamp() {
      try {
        return this.timestamp()
      } catch {
        return new Date(lastMilliseconds).toISOString()
      }
    },
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function boundedHttpResponse(options: {
  response: PublicationCanaryHttpResponse
  expectedHostname: string
  expectedUrl: string
  maxBodyBytes: number
}): PublicationCanaryHttpResponse {
  const { response } = options
  if (
    !isRecord(response) ||
    response.requestedHostname !== options.expectedHostname ||
    response.finalUrl !== options.expectedUrl ||
    response.redirected !== false ||
    typeof response.status !== "number" ||
    !Number.isSafeInteger(response.status) ||
    response.status < 100 ||
    response.status > 599 ||
    typeof response.contentType !== "string" ||
    !SAFE_CONTENT_TYPE_PATTERN.test(response.contentType) ||
    !(response.body instanceof Uint8Array) ||
    response.body.byteLength < 1 ||
    response.body.byteLength > options.maxBodyBytes
  ) {
    throw new Error("publication_canary_http_response_invalid")
  }
  return response
}

function validateDnsObservation(
  observation: PublicationCanaryDnsObservation,
  hostname: string,
): PublicationCanaryDnsEvidence {
  if (
    !isRecord(observation) ||
    observation.hostname !== hostname ||
    observation.resolved !== true ||
    observation.providerTargetMatched !== true ||
    !Array.isArray(observation.recordTypes) ||
    observation.recordTypes.length < 1 ||
    observation.recordTypes.length > DNS_RECORD_TYPES.size ||
    !observation.recordTypes.every(
      (item): item is PublicationCanaryDnsRecordType =>
        typeof item === "string" &&
        DNS_RECORD_TYPES.has(item as PublicationCanaryDnsRecordType),
    ) ||
    new Set(observation.recordTypes).size !== observation.recordTypes.length ||
    typeof observation.answerCount !== "number" ||
    !Number.isSafeInteger(observation.answerCount) ||
    observation.answerCount < 1 ||
    observation.answerCount > 1_000 ||
    !isTimestamp(observation.observedAt)
  ) {
    throw new Error("publication_canary_dns_observation_invalid")
  }

  return {
    schema_version: 1,
    hostname,
    resolved: true,
    provider_target_matched: true,
    record_types: [...observation.recordTypes].sort(),
    answer_count: observation.answerCount,
    observed_at: observation.observedAt,
  }
}

function validateTlsObservation(
  observation: PublicationCanaryTlsObservation,
  hostname: string,
): PublicationCanaryTlsEvidence {
  if (
    !isRecord(observation) ||
    observation.hostname !== hostname ||
    observation.serverName !== hostname ||
    observation.certificateVerified !== true ||
    observation.hostnameMatched !== true ||
    observation.normalCertificateVerification !== true ||
    (observation.protocol !== "TLSv1.2" &&
      observation.protocol !== "TLSv1.3") ||
    !isTimestamp(observation.certificateNotBefore) ||
    !isTimestamp(observation.certificateNotAfter) ||
    !isTimestamp(observation.observedAt) ||
    observation.certificateNotBefore > observation.observedAt ||
    observation.observedAt >= observation.certificateNotAfter
  ) {
    throw new Error("publication_canary_tls_observation_invalid")
  }

  return {
    schema_version: 1,
    hostname,
    server_name: hostname,
    certificate_verified: true,
    hostname_match: true,
    normal_certificate_verification: true,
    protocol: observation.protocol,
    certificate_not_before: observation.certificateNotBefore,
    certificate_not_after: observation.certificateNotAfter,
    observed_at: observation.observedAt,
  }
}

function sameChallengeClaims(
  claims: PublicationCanaryClaims,
  target: PublicationCanaryRunnerTarget,
  nowMilliseconds: number,
): boolean {
  const nowSeconds = Math.floor(nowMilliseconds / 1_000)
  return (
    isRecord(claims) &&
    claims.schemaVersion === 1 &&
    claims.purpose === "advocate-publication-canary" &&
    claims.keyId === "v1" &&
    claims.runId === target.runId &&
    typeof claims.nonce === "string" &&
    NONCE_PATTERN.test(claims.nonce) &&
    claims.advocateId === target.advocateId &&
    claims.domainId === target.domainId &&
    claims.hostname === target.hostname &&
    claims.advocateVersion === target.expectedAdvocateVersion &&
    claims.deploymentId === target.deploymentId &&
    claims.revision === target.revision &&
    typeof claims.issuedAt === "number" &&
    Number.isSafeInteger(claims.issuedAt) &&
    claims.issuedAt >= 1 &&
    typeof claims.expiresAt === "number" &&
    Number.isSafeInteger(claims.expiresAt) &&
    claims.expiresAt > claims.issuedAt &&
    claims.expiresAt - claims.issuedAt <= 120 &&
    claims.issuedAt <= nowSeconds + 30 &&
    claims.issuedAt >= nowSeconds - 30 &&
    claims.expiresAt > nowSeconds
  )
}

function sameChallengeResponse(
  response: PublicationCanaryResponseBody,
  claims: PublicationCanaryClaims,
): boolean {
  return (
    isRecord(response) &&
    response.schemaVersion === 1 &&
    response.purpose === "advocate-publication-canary-response" &&
    response.keyId === claims.keyId &&
    response.runId === claims.runId &&
    response.nonce === claims.nonce &&
    response.advocateId === claims.advocateId &&
    response.domainId === claims.domainId &&
    response.hostname === claims.hostname &&
    response.advocateVersion === claims.advocateVersion &&
    response.deploymentId === claims.deploymentId &&
    response.revision === claims.revision &&
    isTimestamp(response.verifiedAt) &&
    Date.parse(response.verifiedAt) >= (claims.issuedAt - 30) * 1_000 &&
    Date.parse(response.verifiedAt) < claims.expiresAt * 1_000 &&
    typeof response.responseMac === "string" &&
    NONCE_PATTERN.test(response.responseMac)
  )
}

function validateGenericNotFound(options: {
  response: PublicationCanaryHttpResponse
  hostname: string
  url: string
}): {
  evidence: PublicationCanaryGenericNotFoundEvidence
  fingerprint: GenericNotFoundFingerprint
} {
  const response = boundedHttpResponse({
    response: options.response,
    expectedHostname: options.hostname,
    expectedUrl: options.url,
    maxBodyBytes: MAX_GENERIC_NOT_FOUND_BODY_BYTES,
  })
  if (response.status !== 404) {
    throw new Error("publication_canary_generic_not_found_invalid")
  }

  const fingerprint = {
    contentType: response.contentType,
    bodyBytes: response.body.byteLength,
    bodySha256: sha256(response.body),
    body: response.body,
  }
  return {
    evidence: {
      schema_version: 1,
      hostname: options.hostname,
      http_status: 404,
      content_type: fingerprint.contentType,
      body_bytes: fingerprint.bodyBytes,
      body_sha256: fingerprint.bodySha256,
      redirected: false,
      generic_not_found: true,
    },
    fingerprint,
  }
}

function optionalProviderIdentifier(value: unknown): string | null {
  if (value === undefined) return null
  if (
    typeof value !== "string" ||
    !SAFE_PROVIDER_IDENTIFIER_PATTERN.test(value)
  ) {
    throw new Error("publication_canary_payment_evidence_invalid")
  }
  return value
}

function validatePaymentTimestamp(value: unknown): string {
  if (!isTimestamp(value)) {
    throw new Error("publication_canary_payment_evidence_invalid")
  }
  return value
}

function normalizePaymentEvidence(
  raw: unknown,
  expectedProvider: "stripe_us" | "stripe_uk" | "paypal",
): PublicationCanaryPaymentEvidence {
  if (
    !isRecord(raw) ||
    raw.schema_version !== 1 ||
    raw.provider !== expectedProvider ||
    typeof raw.provider_resource_id !== "string" ||
    !(expectedProvider === "paypal"
      ? PAYPAL_SUBSCRIPTION_ID_PATTERN.test(raw.provider_resource_id)
      : STRIPE_SESSION_ID_PATTERN.test(raw.provider_resource_id)) ||
    raw.provider_status !==
      (expectedProvider === "paypal"
        ? "subscription_approval_pending"
        : "checkout_session_expired_unpaid") ||
    typeof raw.provider_return_urls_sha256 !== "string" ||
    !SHA256_PATTERN.test(raw.provider_return_urls_sha256) ||
    typeof raw.outbound_request_id_sha256 !== "string" ||
    !SHA256_PATTERN.test(raw.outbound_request_id_sha256) ||
    raw.financial_charge_attempted !== false ||
    raw.provider_capture_attempted !== false ||
    raw.sponsorship_state_created !== false ||
    raw.webhook_delivery_verified !== false ||
    raw.verified !== true
  ) {
    throw new Error("publication_canary_payment_evidence_invalid")
  }

  const providerCreatedAt = validatePaymentTimestamp(raw.provider_created_at)
  const verifiedAt = validatePaymentTimestamp(raw.verified_at)
  const providerCreateRequestId = optionalProviderIdentifier(
    raw.provider_create_request_id,
  )

  if (expectedProvider === "paypal") {
    if (raw.create_http_status !== 200 && raw.create_http_status !== 201) {
      throw new Error("publication_canary_payment_evidence_invalid")
    }
    return {
      schema_version: 1,
      provider: "paypal",
      provider_resource_id: raw.provider_resource_id,
      provider_status: "subscription_approval_pending",
      provider_created_at: providerCreatedAt,
      provider_return_urls_sha256: raw.provider_return_urls_sha256,
      outbound_request_id_sha256: raw.outbound_request_id_sha256,
      create_http_status: raw.create_http_status,
      create_provider_status: null,
      cleanup_request_id_sha256: null,
      cleanup_http_status: null,
      cleanup_performed: null,
      provider_credential_request_id: optionalProviderIdentifier(
        raw.provider_credential_request_id,
      ),
      provider_create_request_id: providerCreateRequestId,
      provider_cleanup_request_id: null,
      ...SAFETY_CLAIMS,
      verified: true,
      verified_at: verifiedAt,
    }
  }

  if (
    raw.create_http_status !== 200 ||
    (raw.create_provider_status !== "open" &&
      raw.create_provider_status !== "expired") ||
    typeof raw.cleanup_request_id_sha256 !== "string" ||
    !SHA256_PATTERN.test(raw.cleanup_request_id_sha256) ||
    typeof raw.cleanup_performed !== "boolean" ||
    (raw.create_provider_status === "open" &&
      (raw.cleanup_performed !== true || raw.cleanup_http_status !== 200)) ||
    (raw.create_provider_status === "expired" &&
      (raw.cleanup_performed !== false || raw.cleanup_http_status !== null))
  ) {
    throw new Error("publication_canary_payment_evidence_invalid")
  }

  return {
    schema_version: 1,
    provider: expectedProvider,
    provider_resource_id: raw.provider_resource_id,
    provider_status: "checkout_session_expired_unpaid",
    provider_created_at: providerCreatedAt,
    provider_return_urls_sha256: raw.provider_return_urls_sha256,
    outbound_request_id_sha256: raw.outbound_request_id_sha256,
    create_http_status: 200,
    create_provider_status: raw.create_provider_status,
    cleanup_request_id_sha256: raw.cleanup_request_id_sha256,
    cleanup_http_status: raw.cleanup_http_status === 200 ? 200 : null,
    cleanup_performed: raw.cleanup_performed,
    provider_credential_request_id: null,
    provider_create_request_id: providerCreateRequestId,
    provider_cleanup_request_id: optionalProviderIdentifier(
      raw.provider_cleanup_request_id,
    ),
    ...SAFETY_CLAIMS,
    verified: true,
    verified_at: verifiedAt,
  }
}

function generateSiblingHostname(
  randomBytes: (size: number) => Uint8Array,
  tenantHostname: string,
): string {
  let bytes: Uint8Array
  try {
    bytes = randomBytes(SIBLING_RANDOM_BYTES)
  } catch {
    throw new Error("publication_canary_sibling_generation_failed")
  }
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== SIBLING_RANDOM_BYTES
  ) {
    throw new Error("publication_canary_sibling_generation_failed")
  }
  const sibling = `canary-${Buffer.from(bytes).toString("hex")}.creatorshare.com`
  if (sibling === tenantHostname || !isExactAdvocateHostname(sibling)) {
    throw new Error("publication_canary_sibling_generation_failed")
  }
  return sibling
}

function targetForReport(
  target: PublicationCanaryRunnerTarget,
): PublicationCanaryReport["target"] {
  return {
    run_id: target.runId,
    advocate_id: target.advocateId,
    domain_id: target.domainId,
    hostname: target.hostname,
    expected_advocate_version: target.expectedAdvocateVersion,
    deployment_id: target.deploymentId,
    revision: target.revision,
    payment_attempt_ids: {
      stripe_us: target.paymentAttemptIds.stripeUs,
      stripe_uk: target.paymentAttemptIds.stripeUk,
      paypal: target.paymentAttemptIds.paypal,
    },
  }
}

function reportResult(
  report: PublicationCanaryReport,
): PublicationCanaryRunnerResult {
  const canonicalReport = serializeCanonicalPublicationCanaryReport(report)
  return {
    report,
    canonicalReport,
    reportSha256: sha256(canonicalReport),
  }
}

/**
 * Executes one fixed, fail-closed publication proof. Runtime and provider
 * failures become a bounded report containing only a static stage code. Invalid
 * server-derived targets throw PublicationCanaryRunnerInputError before any
 * external dependency is called.
 */
export async function runPublicationCanary(
  rawTarget: PublicationCanaryRunnerTarget,
  dependencies: PublicationCanaryRunnerDependencies,
): Promise<PublicationCanaryRunnerResult> {
  const target = assertRunnerTarget(rawTarget)
  const clock = createRunnerClock(dependencies.now ?? Date.now)
  const startedAt = clock.timestamp()
  const steps: PublicationCanaryReportStep[] = []
  let errorCode: PublicationCanaryErrorCode | null = null
  let tenantRootFingerprint: GenericNotFoundFingerprint | null = null

  const executeStep = async (
    name: PublicationCanaryStepName,
    operation: () => Promise<PublicationCanarySucceededEvidence>,
  ): Promise<boolean> => {
    const stepStartedAt = clock.safeTimestamp()
    try {
      const evidence = await operation()
      steps.push(
        Object.freeze({
          name,
          outcome: "succeeded",
          started_at: stepStartedAt,
          completed_at: clock.timestamp(),
          evidence,
        }),
      )
      return true
    } catch {
      errorCode = PUBLICATION_CANARY_STEP_ERROR_CODE[name]
      steps.push(
        Object.freeze({
          name,
          outcome: "failed",
          started_at: stepStartedAt,
          completed_at: clock.safeTimestamp(),
          evidence: {
            schema_version: 1 as const,
            failure_code: errorCode,
          },
        }),
      )
      return false
    }
  }

  const finalize = (): PublicationCanaryRunnerResult => {
    const report: PublicationCanaryReport = Object.freeze({
      schema_version: 1,
      report_type: "advocate_publication_canary",
      canonicalization_version: 1,
      target: targetForReport(target),
      started_at: startedAt,
      completed_at: clock.safeTimestamp(),
      outcome: errorCode === null ? "succeeded" : "failed",
      error_code: errorCode,
      safety_claims: SAFETY_CLAIMS,
      steps: Object.freeze([...steps]),
    })
    return reportResult(report)
  }

  if (
    !(await executeStep("dns_exact_host", async () =>
      validateDnsObservation(
        await dependencies.observeDns({
          hostname: target.hostname,
          timeoutMs: PUBLICATION_CANARY_NETWORK_TIMEOUT_MS,
        }),
        target.hostname,
      ),
    ))
  ) {
    return finalize()
  }

  if (
    !(await executeStep("tls_exact_host", async () =>
      validateTlsObservation(
        await dependencies.inspectTls({
          hostname: target.hostname,
          serverName: target.hostname,
          rejectUnauthorized: true,
          timeoutMs: PUBLICATION_CANARY_NETWORK_TIMEOUT_MS,
        }),
        target.hostname,
      ),
    ))
  ) {
    return finalize()
  }

  if (
    !(await executeStep("protected_exact_host_challenge", async () => {
      const challenge = dependencies.createProtectedChallenge({
        runId: target.runId,
        advocateId: target.advocateId,
        domainId: target.domainId,
        hostname: target.hostname,
        advocateVersion: target.expectedAdvocateVersion,
        deploymentId: target.deploymentId,
        revision: target.revision,
      })
      if (
        !isRecord(challenge) ||
        typeof challenge.token !== "string" ||
        Buffer.byteLength(challenge.token, "utf8") > MAX_CANARY_TOKEN_BYTES ||
        !CANARY_TOKEN_PATTERN.test(challenge.token) ||
        !sameChallengeClaims(
          challenge.claims,
          target,
          Date.parse(clock.safeTimestamp()),
        )
      ) {
        throw new Error("publication_canary_challenge_invalid")
      }

      const url = `https://${target.hostname}${ADVOCATE_PUBLICATION_CANARY_PATH}`
      const response = boundedHttpResponse({
        response: await dependencies.requestHttp({
          kind: "protected_exact_host_challenge",
          method: "POST",
          url,
          hostname: target.hostname,
          headers: Object.freeze({
            Accept: "application/json",
            Authorization: `Bearer ${challenge.token}`,
          }),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          timeoutMs: PUBLICATION_CANARY_NETWORK_TIMEOUT_MS,
          maxResponseBytes: MAX_PROTECTED_CHALLENGE_BODY_BYTES,
        }),
        expectedHostname: target.hostname,
        expectedUrl: url,
        maxBodyBytes: MAX_PROTECTED_CHALLENGE_BODY_BYTES,
      })
      if (
        response.status !== 200 ||
        !/^application\/json(?:\s*;|$)/i.test(response.contentType)
      ) {
        throw new Error("publication_canary_challenge_invalid")
      }

      let rawBody: string
      try {
        rawBody = new TextDecoder("utf-8", { fatal: true }).decode(
          response.body,
        )
      } catch {
        throw new Error("publication_canary_challenge_invalid")
      }
      const verified = dependencies.verifyProtectedChallengeResponse(
        rawBody,
        challenge.claims,
      )
      if (
        verified === null ||
        !sameChallengeResponse(verified, challenge.claims)
      ) {
        throw new Error("publication_canary_challenge_invalid")
      }

      return {
        schema_version: 1,
        hostname: target.hostname,
        http_status: 200,
        response_bytes: response.body.byteLength,
        response_sha256: sha256(response.body),
        response_verified: true,
        verified_at: verified.verifiedAt,
      } satisfies PublicationCanaryChallengeEvidence
    }))
  ) {
    return finalize()
  }

  if (
    !(await executeStep("verifying_tenant_root_hidden", async () => {
      const url = `https://${target.hostname}/`
      const result = validateGenericNotFound({
        response: await dependencies.requestHttp({
          kind: "verifying_tenant_root",
          method: "GET",
          url,
          hostname: target.hostname,
          headers: Object.freeze({ Accept: "text/html, text/plain;q=0.9" }),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          timeoutMs: PUBLICATION_CANARY_NETWORK_TIMEOUT_MS,
          maxResponseBytes: MAX_GENERIC_NOT_FOUND_BODY_BYTES,
        }),
        hostname: target.hostname,
        url,
      })
      tenantRootFingerprint = result.fingerprint
      return result.evidence
    }))
  ) {
    return finalize()
  }

  if (
    !(await executeStep("unprovisioned_sibling_hidden", async () => {
      const sibling = generateSiblingHostname(
        dependencies.randomBytes ?? systemRandomBytes,
        target.hostname,
      )
      if (await dependencies.isHostnameProvisioned(sibling)) {
        throw new Error("publication_canary_sibling_is_provisioned")
      }

      const url = `https://${sibling}/`
      const result = validateGenericNotFound({
        response: await dependencies.requestHttp({
          kind: "unprovisioned_sibling_root",
          method: "GET",
          url,
          hostname: sibling,
          headers: Object.freeze({ Accept: "text/html, text/plain;q=0.9" }),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          timeoutMs: PUBLICATION_CANARY_NETWORK_TIMEOUT_MS,
          maxResponseBytes: MAX_GENERIC_NOT_FOUND_BODY_BYTES,
        }),
        hostname: sibling,
        url,
      })
      if (
        tenantRootFingerprint === null ||
        result.fingerprint.contentType !== tenantRootFingerprint.contentType ||
        result.fingerprint.bodyBytes !== tenantRootFingerprint.bodyBytes ||
        result.fingerprint.bodySha256 !== tenantRootFingerprint.bodySha256 ||
        !bytesEqual(result.fingerprint.body, tenantRootFingerprint.body)
      ) {
        throw new Error("publication_canary_generic_not_found_mismatch")
      }

      return {
        ...result.evidence,
        unprovisioned: true,
        identical_to_tenant_root: true,
      } satisfies PublicationCanarySiblingNotFoundEvidence
    }))
  ) {
    return finalize()
  }

  if (
    !(await executeStep("stripe_us_payment_canary", async () =>
      normalizePaymentEvidence(
        await dependencies.runStripeUsPaymentCanary({
          advocateHostname: target.hostname,
          canaryAttemptId: target.paymentAttemptIds.stripeUs,
        }),
        "stripe_us",
      ),
    ))
  ) {
    return finalize()
  }

  if (
    !(await executeStep("stripe_uk_payment_canary", async () =>
      normalizePaymentEvidence(
        await dependencies.runStripeUkPaymentCanary({
          advocateHostname: target.hostname,
          canaryAttemptId: target.paymentAttemptIds.stripeUk,
        }),
        "stripe_uk",
      ),
    ))
  ) {
    return finalize()
  }

  if (
    !(await executeStep("paypal_payment_canary", async () =>
      normalizePaymentEvidence(
        await dependencies.runPayPalPaymentCanary({
          advocateHostname: target.hostname,
          canaryAttemptId: target.paymentAttemptIds.paypal,
        }),
        "paypal",
      ),
    ))
  ) {
    return finalize()
  }

  return finalize()
}
