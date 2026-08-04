import { createHash } from "node:crypto"

import { resolveAdvocateHost } from "../host"
import type { PublicationCanaryErrorCode } from "./report"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]{8,128}$/
const REVISION_PATTERN = /^[0-9a-f]{40}$/
const BYTEA_SHA256_PATTERN = /^\\x[0-9a-f]{64}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SAFE_REASON_PATTERN = /^[^\u0000-\u001f\u007f]+$/u
const PUBLICATION_CANARY_FAILURE_CODES = new Set<PublicationCanaryErrorCode>([
  "dns_exact_host_failed",
  "tls_exact_host_failed",
  "protected_exact_host_challenge_failed",
  "verifying_tenant_root_not_hidden",
  "unprovisioned_sibling_not_hidden",
  "stripe_us_payment_canary_failed",
  "stripe_uk_payment_canary_failed",
  "paypal_payment_canary_failed",
])
const PUBLICATION_CANARY_COMPLETE_NAMESPACE =
  "c5277791-8b06-526d-8f0d-d687078d7646"
const PUBLICATION_CANARY_PUBLISH_NAMESPACE =
  "34687f2c-4a46-5db4-9c82-50701e2d8a4e"

export const MAX_PUBLICATION_CANARY_REQUEST_BODY_BYTES = 8_192

export interface PublicationCanaryOperationInput {
  expectedVersion: number
  operationId: string
  adminReason: string
}

export interface PublicationCanaryStartResult {
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
  startedAt: string
}

export interface PublicationCanaryExecution extends PublicationCanaryStartResult {
  outcome: "succeeded" | "failed" | null
  failureCode: PublicationCanaryErrorCode | null
  reportSha256: string | null
  completedAt: string | null
}

export interface PublicationCanaryOperationSnapshot {
  operationId: string
  runId: string
  advocateId: string
  expectedAdvocateVersion: number
  deploymentId: string
  revision: string
  startedAt: string
  outcome: "succeeded" | "failed" | null
  failureCode: PublicationCanaryErrorCode | null
  reportSha256: string | null
  completedAt: string | null
  publishedAdvocateVersion: number | null
  created: boolean
}

export interface PublicationCanaryDeploymentCapability {
  capabilityId: string
  expiresAt: string
}

export interface PublicationCanaryWorkerClaim extends PublicationCanaryStartResult {
  startRequestId: string
  traceId: string
  adminReason: string
  leaseToken: string
  leasedUntil: string
}

export interface PublicationCanaryCompletionResult {
  runId: string
  outcome: "succeeded" | "failed"
  reportSha256: string
  completedAt: string
}

export type PublicationCanaryPublicFailureCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "portal_not_found"
  | "publication_conflict"
  | "publication_failed"

export interface PublicationCanaryPublicFailure {
  status: 400 | 401 | 403 | 404 | 409 | 500
  code: PublicationCanaryPublicFailureCode
}

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll("-", ""), "hex")
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

function uuidV5(namespace: string, name: string): string {
  const digest = createHash("sha1")
    .update(uuidBytes(namespace))
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  return formatUuid(digest)
}

function validPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
}

function validReason(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    Array.from(value).length <= 2_000 &&
    SAFE_REASON_PATTERN.test(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  )
}

function validTraceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    value.length <= 255 &&
    SAFE_REASON_PATTERN.test(value)
  )
}

function validProductionHostname(value: unknown): value is string {
  if (typeof value !== "string") return false
  const resolution = resolveAdvocateHost(value)
  return (
    resolution.kind === "tenant-candidate" &&
    resolution.environment === "production" &&
    resolution.requestHostname === value &&
    resolution.requestPort === null &&
    resolution.domainLookup.hostname === value
  )
}

function validFailureCode(value: unknown): value is PublicationCanaryErrorCode {
  return PUBLICATION_CANARY_FAILURE_CODES.has(
    value as PublicationCanaryErrorCode,
  )
}

function oneRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null
  }
  return value[0]
}

function parseStartRow(
  row: Record<string, unknown>,
  expected?: {
    advocateId: string
    expectedVersion: number
    deploymentId: string
    revision: string
  },
): PublicationCanaryStartResult | null {
  if (
    !UUID_PATTERN.test(String(row.run_id)) ||
    !UUID_PATTERN.test(String(row.advocate_id)) ||
    !UUID_PATTERN.test(String(row.domain_id)) ||
    !validProductionHostname(row.hostname) ||
    !validPositiveVersion(row.expected_advocate_version) ||
    typeof row.deployment_id !== "string" ||
    !DEPLOYMENT_ID_PATTERN.test(row.deployment_id) ||
    typeof row.revision !== "string" ||
    !REVISION_PATTERN.test(row.revision) ||
    !UUID_PATTERN.test(String(row.stripe_us_attempt_id)) ||
    !UUID_PATTERN.test(String(row.stripe_uk_attempt_id)) ||
    !UUID_PATTERN.test(String(row.paypal_attempt_id)) ||
    new Set([
      row.stripe_us_attempt_id,
      row.stripe_uk_attempt_id,
      row.paypal_attempt_id,
    ]).size !== 3 ||
    !validTimestamp(row.started_at) ||
    (expected !== undefined &&
      (row.advocate_id !== expected.advocateId ||
        row.expected_advocate_version !== expected.expectedVersion ||
        row.deployment_id !== expected.deploymentId ||
        row.revision !== expected.revision))
  ) {
    return null
  }

  return {
    runId: row.run_id as string,
    advocateId: row.advocate_id as string,
    domainId: row.domain_id as string,
    hostname: row.hostname,
    expectedAdvocateVersion: row.expected_advocate_version,
    deploymentId: row.deployment_id,
    revision: row.revision,
    paymentAttemptIds: {
      stripeUs: row.stripe_us_attempt_id as string,
      stripeUk: row.stripe_uk_attempt_id as string,
      paypal: row.paypal_attempt_id as string,
    },
    startedAt: row.started_at,
  }
}

export function isPublicationCanaryJsonContentType(
  value: string | null,
): boolean {
  if (value === null) return false
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
}

export async function readBoundedPublicationCanaryBody(
  request: Pick<Request, "body" | "headers">,
): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) ||
      Number(contentLength) > MAX_PUBLICATION_CANARY_REQUEST_BODY_BYTES)
  ) {
    return null
  }
  if (request.body === null) return ""

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_PUBLICATION_CANARY_REQUEST_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    return null
  }
}

export function parsePublicationCanaryOperationInput(
  rawBody: string,
): PublicationCanaryOperationInput | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAX_PUBLICATION_CANARY_REQUEST_BODY_BYTES
  ) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    !exactKeys(value, ["expectedVersion", "operationId", "adminReason"]) ||
    !validPositiveVersion(value.expectedVersion) ||
    typeof value.operationId !== "string" ||
    !UUID_V4_PATTERN.test(value.operationId) ||
    !validReason(value.adminReason)
  ) {
    return null
  }
  return {
    expectedVersion: value.expectedVersion,
    operationId: value.operationId,
    adminReason: value.adminReason,
  }
}

export function derivePublicationCanaryStartRequestId(input: {
  advocateId: string
  expectedVersion: number
  operationId: string
  adminReason: string
}): string | null {
  if (
    !UUID_PATTERN.test(input.advocateId) ||
    !validPositiveVersion(input.expectedVersion) ||
    !UUID_V4_PATTERN.test(input.operationId) ||
    !validReason(input.adminReason)
  ) {
    return null
  }
  return input.operationId
}

export function parsePublicationCanaryOperationSnapshot(
  value: unknown,
  expected: {
    operationId: string
    advocateId: string
    expectedVersion: number
  },
): PublicationCanaryOperationSnapshot | null {
  const row = oneRow(value)
  if (
    row === null ||
    !exactKeys(row, [
      "operation_id",
      "run_id",
      "advocate_id",
      "expected_advocate_version",
      "deployment_id",
      "revision",
      "started_at",
      "outcome",
      "failure_code",
      "report_sha256",
      "completed_at",
      "published_advocate_version",
      "created",
    ]) ||
    row.operation_id !== expected.operationId ||
    !UUID_V4_PATTERN.test(String(row.operation_id)) ||
    row.run_id === null ||
    !UUID_PATTERN.test(String(row.run_id)) ||
    row.advocate_id !== expected.advocateId ||
    !UUID_PATTERN.test(String(row.advocate_id)) ||
    row.expected_advocate_version !== expected.expectedVersion ||
    !validPositiveVersion(row.expected_advocate_version) ||
    typeof row.deployment_id !== "string" ||
    !DEPLOYMENT_ID_PATTERN.test(row.deployment_id) ||
    typeof row.revision !== "string" ||
    !REVISION_PATTERN.test(row.revision) ||
    !validTimestamp(row.started_at) ||
    typeof row.created !== "boolean"
  ) {
    return null
  }

  const publishedAdvocateVersion = row.published_advocate_version
  if (
    publishedAdvocateVersion !== null &&
    (!validPositiveVersion(publishedAdvocateVersion) ||
      (publishedAdvocateVersion !== expected.expectedVersion + 1 &&
        publishedAdvocateVersion !== expected.expectedVersion + 2))
  ) {
    return null
  }

  if (
    row.outcome === null &&
    row.failure_code === null &&
    row.report_sha256 === null &&
    row.completed_at === null &&
    publishedAdvocateVersion === null
  ) {
    return {
      operationId: row.operation_id as string,
      runId: row.run_id as string,
      advocateId: row.advocate_id as string,
      expectedAdvocateVersion: row.expected_advocate_version,
      deploymentId: row.deployment_id,
      revision: row.revision,
      startedAt: row.started_at,
      outcome: null,
      failureCode: null,
      reportSha256: null,
      completedAt: null,
      publishedAdvocateVersion: null,
      created: row.created,
    }
  }

  if (
    (row.outcome !== "succeeded" && row.outcome !== "failed") ||
    (row.outcome === "succeeded" && row.failure_code !== null) ||
    (row.outcome === "failed" && !validFailureCode(row.failure_code)) ||
    typeof row.report_sha256 !== "string" ||
    !BYTEA_SHA256_PATTERN.test(row.report_sha256) ||
    !validTimestamp(row.completed_at) ||
    (publishedAdvocateVersion !== null && row.outcome !== "succeeded")
  ) {
    return null
  }

  return {
    operationId: row.operation_id as string,
    runId: row.run_id as string,
    advocateId: row.advocate_id as string,
    expectedAdvocateVersion: row.expected_advocate_version,
    deploymentId: row.deployment_id,
    revision: row.revision,
    startedAt: row.started_at,
    outcome: row.outcome,
    failureCode:
      row.outcome === "failed"
        ? (row.failure_code as PublicationCanaryErrorCode)
        : null,
    reportSha256: row.report_sha256.slice(2),
    completedAt: row.completed_at,
    publishedAdvocateVersion,
    created: row.created,
  }
}

export function parsePublicationCanaryDeploymentCapability(
  value: unknown,
): PublicationCanaryDeploymentCapability | null {
  const row = oneRow(value)
  if (
    row === null ||
    !exactKeys(row, ["deployment_capability_id", "expires_at"]) ||
    typeof row.deployment_capability_id !== "string" ||
    !UUID_V4_PATTERN.test(row.deployment_capability_id) ||
    !validTimestamp(row.expires_at)
  ) {
    return null
  }
  return Object.freeze({
    capabilityId: row.deployment_capability_id,
    expiresAt: row.expires_at,
  })
}

export function derivePublicationCanaryCompletionRequestId(input: {
  startRequestId: string
  runId: string
}): string | null {
  if (
    !UUID_PATTERN.test(input.startRequestId) ||
    !UUID_PATTERN.test(input.runId)
  ) {
    return null
  }
  return uuidV5(
    PUBLICATION_CANARY_COMPLETE_NAMESPACE,
    [
      "creator-share-advocate-publication-canary-complete-v1",
      input.startRequestId,
      input.runId,
    ].join("\n"),
  )
}

export function derivePublicationCanaryPublishRequestId(input: {
  startRequestId: string
  runId: string
  reportSha256: string
}): string | null {
  if (
    !UUID_PATTERN.test(input.startRequestId) ||
    !UUID_PATTERN.test(input.runId) ||
    !SHA256_PATTERN.test(input.reportSha256)
  ) {
    return null
  }
  return uuidV5(
    PUBLICATION_CANARY_PUBLISH_NAMESPACE,
    [
      "creator-share-advocate-publication-canary-publish-v1",
      input.startRequestId,
      input.runId,
      input.reportSha256,
    ].join("\n"),
  )
}

export function parsePublicationCanaryStartResult(
  value: unknown,
  expected: {
    advocateId: string
    expectedVersion: number
    deploymentId: string
    revision: string
  },
): PublicationCanaryStartResult | null {
  const row = oneRow(value)
  if (
    row === null ||
    !exactKeys(row, [
      "run_id",
      "advocate_id",
      "domain_id",
      "hostname",
      "expected_advocate_version",
      "deployment_id",
      "revision",
      "stripe_us_attempt_id",
      "stripe_uk_attempt_id",
      "paypal_attempt_id",
      "started_at",
    ])
  ) {
    return null
  }
  return parseStartRow(row, expected)
}

export function parsePublicationCanaryExecutionResult(
  value: unknown,
  expected: {
    advocateId: string
    expectedVersion: number
    deploymentId: string
    revision: string
  },
): PublicationCanaryExecution | null | undefined {
  if (Array.isArray(value) && value.length === 0) return undefined
  const row = oneRow(value)
  if (
    row === null ||
    !exactKeys(row, [
      "run_id",
      "advocate_id",
      "domain_id",
      "hostname",
      "expected_advocate_version",
      "deployment_id",
      "revision",
      "stripe_us_attempt_id",
      "stripe_uk_attempt_id",
      "paypal_attempt_id",
      "started_at",
      "outcome",
      "failure_code",
      "report_sha256",
      "completed_at",
    ])
  ) {
    return null
  }
  const start = parseStartRow(row, expected)
  if (start === null) return null

  if (
    row.outcome === null &&
    row.failure_code === null &&
    row.report_sha256 === null &&
    row.completed_at === null
  ) {
    return {
      ...start,
      outcome: null,
      failureCode: null,
      reportSha256: null,
      completedAt: null,
    }
  }
  if (
    (row.outcome !== "succeeded" && row.outcome !== "failed") ||
    (row.outcome === "succeeded" && row.failure_code !== null) ||
    (row.outcome === "failed" && !validFailureCode(row.failure_code)) ||
    typeof row.report_sha256 !== "string" ||
    !BYTEA_SHA256_PATTERN.test(row.report_sha256) ||
    !validTimestamp(row.completed_at)
  ) {
    return null
  }
  return {
    ...start,
    outcome: row.outcome,
    failureCode:
      row.outcome === "failed"
        ? (row.failure_code as PublicationCanaryErrorCode)
        : null,
    reportSha256: row.report_sha256.slice(2),
    completedAt: row.completed_at,
  }
}

export function parsePublicationCanaryWorkerClaimResult(
  value: unknown,
  expected: { deploymentId: string; revision: string },
): PublicationCanaryWorkerClaim | null | undefined {
  if (Array.isArray(value) && value.length === 0) return undefined
  const row = oneRow(value)
  if (
    row === null ||
    !exactKeys(row, [
      "run_id",
      "advocate_id",
      "domain_id",
      "hostname",
      "expected_advocate_version",
      "deployment_id",
      "revision",
      "stripe_us_attempt_id",
      "stripe_uk_attempt_id",
      "paypal_attempt_id",
      "started_at",
      "start_request_id",
      "trace_id",
      "admin_reason",
      "lease_token",
      "leased_until",
    ])
  ) {
    return null
  }
  const start = parseStartRow(row)
  if (
    start === null ||
    start.deploymentId !== expected.deploymentId ||
    start.revision !== expected.revision ||
    !UUID_PATTERN.test(String(row.start_request_id)) ||
    !validTraceId(row.trace_id) ||
    !validReason(row.admin_reason) ||
    !UUID_PATTERN.test(String(row.lease_token)) ||
    !validTimestamp(row.leased_until) ||
    Date.parse(row.leased_until) <= Date.parse(start.startedAt)
  ) {
    return null
  }
  return {
    ...start,
    startRequestId: row.start_request_id as string,
    traceId: row.trace_id,
    adminReason: row.admin_reason,
    leaseToken: row.lease_token as string,
    leasedUntil: row.leased_until,
  }
}

export function parsePublicationCanaryCompletionResult(
  value: unknown,
  expected: { runId: string; reportSha256: string },
): PublicationCanaryCompletionResult | null {
  const row = oneRow(value)
  if (
    row === null ||
    !exactKeys(row, ["run_id", "outcome", "report_sha256", "completed_at"]) ||
    row.run_id !== expected.runId ||
    (row.outcome !== "succeeded" && row.outcome !== "failed") ||
    typeof row.report_sha256 !== "string" ||
    row.report_sha256 !== `\\x${expected.reportSha256}` ||
    !validTimestamp(row.completed_at)
  ) {
    return null
  }
  return {
    runId: row.run_id,
    outcome: row.outcome,
    reportSha256: row.report_sha256.slice(2),
    completedAt: row.completed_at,
  }
}

export function parsePublicationCanaryPublishResult(
  value: unknown,
  expectedVersion: number,
): number | null {
  return validPositiveVersion(expectedVersion) &&
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (value === expectedVersion + 1 || value === expectedVersion + 2)
    ? value
    : null
}

export function classifyPublicationCanaryDatabaseFailure(
  postgresCode: string | undefined,
): PublicationCanaryPublicFailure {
  switch (postgresCode) {
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "28000":
      return { status: 401, code: "unauthorized" }
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
      return { status: 404, code: "portal_not_found" }
    case "23514":
    case "23505":
    case "40001":
    case "55000":
    case "55P03":
      return { status: 409, code: "publication_conflict" }
    default:
      return { status: 500, code: "publication_failed" }
  }
}
