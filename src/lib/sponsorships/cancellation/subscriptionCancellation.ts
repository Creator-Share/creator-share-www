import "server-only"

import { createHash } from "node:crypto"
import { isIP } from "node:net"

export const MAXIMUM_SUBSCRIPTION_CANCELLATION_BODY_BYTES = 1024
export const MAXIMUM_SUBSCRIPTION_CANCELLATION_REASON_CHARACTERS = 500
export const MINIMUM_ADMIN_SUBSCRIPTION_CANCELLATION_REASON_CHARACTERS = 10
export const DEFAULT_SUBSCRIPTION_CANCELLATION_PROVIDER_TIMEOUT_MILLISECONDS = 15_000

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_PROVIDER_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/

export type SubscriptionCancellationSafeStatus =
  "pending" | "processing" | "cancelled" | "manual_review"

export type SubscriptionCancellationProviderResult =
  | "provider_cancelled"
  | "provider_already_cancelled"
  | "provider_not_found"
  | "provider_retryable_error"
  | "provider_terminal_error"

export interface SubscriptionCancellationRequestContext {
  requestId: string
  traceId: string | null
  clientIp: string | null
  userAgent: string | null
}

export type SubscriptionCancellationRequestEnvironment = Readonly<
  Record<string, string | undefined>
>

function boundedRequestHeader(
  headers: Pick<Headers, "get">,
  name: string,
  maximumLength: number,
): string | null {
  const value = headers.get(name)?.trim()
  return value &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    ? value
    : null
}

/**
 * Vercel overwrites these two infrastructure headers at final ingress. Other
 * proxy headers and every non-Vercel value are browser assertions, not
 * forensic evidence, so they are deliberately recorded as unavailable.
 */
export function createSubscriptionCancellationRequestContext(options: {
  requestId: string
  headers: Pick<Headers, "get">
  environment?: SubscriptionCancellationRequestEnvironment
}): SubscriptionCancellationRequestContext {
  const environment = options.environment ?? process.env
  const onVercel = environment.VERCEL === "1"
  const source = onVercel
    ? boundedRequestHeader(options.headers, "x-vercel-forwarded-for", 64)
    : null
  return Object.freeze({
    requestId: options.requestId,
    traceId: onVercel
      ? boundedRequestHeader(options.headers, "x-vercel-id", 255)
      : null,
    clientIp: source !== null && isIP(source) !== 0 ? source : null,
    userAgent: boundedRequestHeader(options.headers, "user-agent", 1024),
  })
}

export interface SubscriptionCancellationRequest {
  subscriptionId: string
  reason: string | null
}

export interface BegunSubscriptionCancellation {
  operationId: string
  status: SubscriptionCancellationSafeStatus
  terminal: boolean
  replayed: boolean
}

export interface ClaimedSubscriptionCancellation {
  operationId: string
  status: SubscriptionCancellationSafeStatus
  leaseToken: string | null
  leaseExpiresAt: string | null
  provider: "STRIPE" | "PAYPAL" | null
  providerAccountScope: string | null
  providerObjectType: string | null
  providerObjectId: string | null
  claimAttemptCount: number
}

export interface SettledSubscriptionCancellation {
  operationId: string
  status: SubscriptionCancellationSafeStatus
  terminal: boolean
  providerEffectRecorded: boolean
  replayed: boolean
}

export interface SubscriptionCancellationProviderEvidence {
  provider: "STRIPE" | "PAYPAL"
  result: SubscriptionCancellationProviderResult
  httpStatus: number | null
  providerCode: string | null
  requestSemantics: "stripe-delete" | "paypal-terminal-transition"
}

export interface SubscriptionCancellationProviderOutcome {
  result: SubscriptionCancellationProviderResult
  effectMayHaveOccurred: boolean
  evidence: SubscriptionCancellationProviderEvidence
}

export interface SafeSubscriptionCancellationResponse {
  operationId: string
  status: SubscriptionCancellationSafeStatus
  terminal: boolean
  httpStatus: 200 | 202 | 503
}

export interface SubscriptionCancellationDependencies {
  begin(
    subscriptionId: string,
    reason: string | null,
    context: SubscriptionCancellationRequestContext,
  ): Promise<BegunSubscriptionCancellation>
  claim(
    operationId: string,
    context: SubscriptionCancellationRequestContext,
  ): Promise<ClaimedSubscriptionCancellation>
  cancelProvider(
    claim: ClaimedSubscriptionCancellation,
  ): Promise<SubscriptionCancellationProviderOutcome>
  settle(
    operationId: string,
    leaseToken: string,
    outcome: SubscriptionCancellationProviderOutcome,
    evidenceSha256: string,
    context: SubscriptionCancellationRequestContext,
  ): Promise<SettledSubscriptionCancellation>
}

export interface StripeSubscriptionCancellationClient {
  subscriptions: {
    cancel(
      providerObjectId: string,
      options: {
        maxNetworkRetries: number
        timeout: number
      },
    ): Promise<{ status?: unknown }>
  }
}

export interface PayPalSubscriptionCancellationTransport {
  request(path: string, init: RequestInit): Promise<Response>
}

export interface SubscriptionCancellationProviderDependencies {
  stripeClientForScope(
    providerAccountScope: string,
  ): StripeSubscriptionCancellationClient
  paypal: PayPalSubscriptionCancellationTransport
  timeoutMilliseconds: number
}

export class SubscriptionCancellationBoundaryError extends Error {
  readonly code:
    | "invalid-request"
    | "unauthorized"
    | "forbidden"
    | "recent-verification-required"
    | "unavailable"
  readonly httpStatus: 400 | 401 | 403 | 428 | 503

  constructor(
    code: SubscriptionCancellationBoundaryError["code"],
    httpStatus: SubscriptionCancellationBoundaryError["httpStatus"],
  ) {
    super("Subscription cancellation request could not be completed")
    this.name = "SubscriptionCancellationBoundaryError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export function subscriptionCancellationRpcFailure(
  error: {
    code?: string
    message?: string
  } | null,
): never {
  if (error?.code === "28000") {
    throw new SubscriptionCancellationBoundaryError("unauthorized", 401)
  }
  if (
    error?.code === "42501" &&
    error.message?.startsWith("recent-verification-required")
  ) {
    throw new SubscriptionCancellationBoundaryError(
      "recent-verification-required",
      428,
    )
  }
  if (error?.code === "42501") {
    throw new SubscriptionCancellationBoundaryError("forbidden", 403)
  }
  if (error?.code === "22023" || error?.code === "22P02") {
    throw new SubscriptionCancellationBoundaryError("invalid-request", 400)
  }
  throw new SubscriptionCancellationBoundaryError("unavailable", 503)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function oneRpcRow(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) {
    if (data.length !== 1 || !isRecord(data[0])) {
      throw new SubscriptionCancellationBoundaryError("unavailable", 503)
    }
    return data[0]
  }
  if (!isRecord(data)) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return data
}

function requiredUuid(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return value.toLowerCase()
}

function nullableUuid(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return value.toLowerCase()
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key]
  if (typeof value !== "boolean") {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return value
}

function requiredInteger(row: Record<string, unknown>, key: string): number {
  const raw = row[key]
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return value
}

function nullableBoundedString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return value
}

function nullableTimestamp(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = nullableBoundedString(row, key, 80)
  if (value === null) return null
  if (!Number.isFinite(Date.parse(value))) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return value
}

function requiredSafeStatus(
  row: Record<string, unknown>,
  key: string,
): SubscriptionCancellationSafeStatus {
  const value = row[key]
  if (
    value !== "pending" &&
    value !== "processing" &&
    value !== "cancelled" &&
    value !== "manual_review"
  ) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return value
}

function nullableProvider(
  row: Record<string, unknown>,
  key: string,
): "STRIPE" | "PAYPAL" | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (value !== "STRIPE" && value !== "PAYPAL") {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return value
}

function safeProviderCode(value: unknown): string | null {
  return typeof value === "string" && SAFE_PROVIDER_CODE_PATTERN.test(value)
    ? value
    : null
}

export function parseSubscriptionCancellationBody(
  serializedBody: string,
): SubscriptionCancellationRequest | null {
  if (
    Buffer.byteLength(serializedBody, "utf8") >
    MAXIMUM_SUBSCRIPTION_CANCELLATION_BODY_BYTES
  ) {
    return null
  }

  let body: unknown
  try {
    body = JSON.parse(serializedBody)
  } catch {
    return null
  }
  if (!isRecord(body)) return null
  const keys = Object.keys(body)
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    !Object.prototype.hasOwnProperty.call(body, "subscriptionId") ||
    keys.some((key) => key !== "subscriptionId" && key !== "reason")
  ) {
    return null
  }

  const subscriptionId = body.subscriptionId
  if (
    typeof subscriptionId !== "string" ||
    !UUID_PATTERN.test(subscriptionId)
  ) {
    return null
  }

  const rawReason = body.reason
  if (rawReason === undefined || rawReason === null) {
    return { subscriptionId: subscriptionId.toLowerCase(), reason: null }
  }
  if (typeof rawReason !== "string") return null

  const reason = rawReason
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (
    reason.length === 0 ||
    reason.length > MAXIMUM_SUBSCRIPTION_CANCELLATION_REASON_CHARACTERS
  ) {
    return null
  }
  return { subscriptionId: subscriptionId.toLowerCase(), reason }
}

export function parseBegunSubscriptionCancellation(
  data: unknown,
): BegunSubscriptionCancellation {
  const row = oneRpcRow(data)
  const result = {
    operationId: requiredUuid(row, "cancellation_operation_id"),
    status: requiredSafeStatus(row, "cancellation_status"),
    terminal: requiredBoolean(row, "is_terminal"),
    replayed: requiredBoolean(row, "replayed"),
  }
  if (
    result.terminal !==
    (result.status === "cancelled" || result.status === "manual_review")
  ) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return result
}

export function parseClaimedSubscriptionCancellation(
  data: unknown,
): ClaimedSubscriptionCancellation {
  const row = oneRpcRow(data)
  const result: ClaimedSubscriptionCancellation = {
    operationId: requiredUuid(row, "cancellation_operation_id"),
    status: requiredSafeStatus(row, "cancellation_status"),
    leaseToken: nullableUuid(row, "processing_lease_token"),
    leaseExpiresAt: nullableTimestamp(row, "processing_lease_expires_at"),
    provider: nullableProvider(row, "provider"),
    providerAccountScope: nullableBoundedString(
      row,
      "provider_account_scope",
      120,
    ),
    providerObjectType: nullableBoundedString(row, "provider_object_type", 80),
    providerObjectId: nullableBoundedString(row, "provider_object_id", 255),
    claimAttemptCount: requiredInteger(row, "claim_attempt_count"),
  }

  const hasExecutionClaim = result.leaseToken !== null
  const executionValues = [
    result.leaseExpiresAt,
    result.provider,
    result.providerAccountScope,
    result.providerObjectType,
    result.providerObjectId,
  ]
  if (
    (hasExecutionClaim &&
      (result.status !== "processing" ||
        executionValues.some((value) => value === null))) ||
    (!hasExecutionClaim && executionValues.some((value) => value !== null))
  ) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return result
}

export function parseSettledSubscriptionCancellation(
  data: unknown,
): SettledSubscriptionCancellation {
  const row = oneRpcRow(data)
  const result = {
    operationId: requiredUuid(row, "cancellation_operation_id"),
    status: requiredSafeStatus(row, "cancellation_status"),
    terminal: requiredBoolean(row, "is_terminal"),
    providerEffectRecorded: requiredBoolean(row, "provider_effect_recorded"),
    replayed: requiredBoolean(row, "replayed"),
  }
  if (
    result.terminal !==
      (result.status === "cancelled" || result.status === "manual_review") ||
    (result.providerEffectRecorded && result.status !== "cancelled")
  ) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  return result
}

function responseForStatus(
  operationId: string,
  status: SubscriptionCancellationSafeStatus,
): SafeSubscriptionCancellationResponse {
  if (status === "cancelled") {
    return { operationId, status, terminal: true, httpStatus: 200 }
  }
  if (status === "manual_review") {
    return { operationId, status, terminal: true, httpStatus: 202 }
  }
  return { operationId, status, terminal: false, httpStatus: 202 }
}

export function digestSubscriptionCancellationProviderEvidence(
  operationId: string,
  evidence: SubscriptionCancellationProviderEvidence,
): `\\x${string}` {
  if (!UUID_PATTERN.test(operationId)) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  const canonicalEvidence = JSON.stringify({
    version: 1,
    operationId: operationId.toLowerCase(),
    provider: evidence.provider,
    result: evidence.result,
    httpStatus: evidence.httpStatus,
    providerCode: evidence.providerCode,
    requestSemantics: evidence.requestSemantics,
  })
  return `\\x${createHash("sha256").update(canonicalEvidence).digest("hex")}`
}

export async function executeSubscriptionCancellation(
  subscriptionId: string,
  reason: string | null,
  context: SubscriptionCancellationRequestContext,
  dependencies: SubscriptionCancellationDependencies,
): Promise<SafeSubscriptionCancellationResponse> {
  const begun = await dependencies.begin(subscriptionId, reason, context)
  if (begun.status === "cancelled" || begun.status === "manual_review") {
    return responseForStatus(begun.operationId, begun.status)
  }

  const claimed = await dependencies.claim(begun.operationId, context)
  if (claimed.operationId !== begun.operationId) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  if (claimed.leaseToken === null) {
    return responseForStatus(claimed.operationId, claimed.status)
  }

  const outcome = await dependencies.cancelProvider(claimed)
  const evidenceSha256 = digestSubscriptionCancellationProviderEvidence(
    claimed.operationId,
    outcome.evidence,
  )

  let settled: SettledSubscriptionCancellation
  try {
    settled = await dependencies.settle(
      claimed.operationId,
      claimed.leaseToken,
      outcome,
      evidenceSha256,
      context,
    )
  } catch {
    if (
      outcome.effectMayHaveOccurred ||
      outcome.result === "provider_cancelled" ||
      outcome.result === "provider_already_cancelled" ||
      outcome.result === "provider_not_found"
    ) {
      return {
        operationId: claimed.operationId,
        status: "processing",
        terminal: false,
        httpStatus: 202,
      }
    }
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }

  if (settled.operationId !== claimed.operationId) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }
  if (
    settled.status === "pending" &&
    outcome.result === "provider_retryable_error" &&
    !outcome.effectMayHaveOccurred
  ) {
    return {
      operationId: settled.operationId,
      status: "pending",
      terminal: false,
      httpStatus: 503,
    }
  }
  if (settled.status === "pending" && outcome.effectMayHaveOccurred) {
    return {
      operationId: settled.operationId,
      status: "processing",
      terminal: false,
      httpStatus: 202,
    }
  }
  return responseForStatus(settled.operationId, settled.status)
}

function stripeEvidence(
  result: SubscriptionCancellationProviderResult,
  httpStatus: number | null,
  providerCode: string | null,
): SubscriptionCancellationProviderOutcome {
  return {
    result,
    effectMayHaveOccurred:
      result === "provider_cancelled" ||
      result === "provider_already_cancelled" ||
      result === "provider_not_found" ||
      (result === "provider_retryable_error" &&
        (httpStatus === null || httpStatus >= 500)),
    evidence: {
      provider: "STRIPE",
      result,
      httpStatus,
      providerCode,
      requestSemantics: "stripe-delete",
    },
  }
}

export async function cancelStripeSubscription(
  providerObjectId: string,
  timeoutMilliseconds: number,
  client: StripeSubscriptionCancellationClient,
): Promise<SubscriptionCancellationProviderOutcome> {
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1_000 ||
    timeoutMilliseconds > 45_000
  ) {
    return stripeEvidence(
      "provider_terminal_error",
      null,
      "INVALID_PROVIDER_TIMEOUT",
    )
  }
  try {
    const subscription = await client.subscriptions.cancel(providerObjectId, {
      maxNetworkRetries: 0,
      timeout: timeoutMilliseconds,
    })
    if (subscription.status === "canceled") {
      return stripeEvidence("provider_cancelled", 200, null)
    }
    return stripeEvidence(
      "provider_retryable_error",
      200,
      "UNEXPECTED_SUBSCRIPTION_STATE",
    )
  } catch (error) {
    const value = isRecord(error) ? error : {}
    const statusCode =
      typeof value.statusCode === "number" &&
      Number.isInteger(value.statusCode) &&
      value.statusCode >= 400 &&
      value.statusCode <= 599
        ? value.statusCode
        : null
    const providerCode = safeProviderCode(value.code)
    const errorType = safeProviderCode(value.type)
    if (statusCode === 404 || providerCode === "resource_missing") {
      return stripeEvidence(
        "provider_not_found",
        statusCode ?? 404,
        providerCode,
      )
    }
    if (
      statusCode === null ||
      statusCode === 409 ||
      statusCode === 429 ||
      statusCode >= 500 ||
      errorType === "StripeConnectionError" ||
      errorType === "StripeAPIError"
    ) {
      return stripeEvidence(
        "provider_retryable_error",
        statusCode,
        providerCode ?? errorType,
      )
    }
    return stripeEvidence("provider_terminal_error", statusCode, providerCode)
  }
}

interface SafePayPalError {
  providerCode: string | null
  terminalState: boolean
}

async function readSafePayPalError(
  response: Response,
): Promise<SafePayPalError> {
  let value: unknown
  try {
    const body = await response.text()
    value = body.length <= 16 * 1024 ? JSON.parse(body) : null
  } catch {
    value = null
  }
  if (!isRecord(value)) {
    return { providerCode: null, terminalState: false }
  }

  const codes: string[] = []
  let terminalState = false
  for (const candidate of [value.name, value.issue]) {
    const code = safeProviderCode(candidate)
    if (code) codes.push(code)
  }
  if (Array.isArray(value.details)) {
    for (const detail of value.details) {
      if (!isRecord(detail)) continue
      const code = safeProviderCode(detail.issue)
      if (code) codes.push(code)
      if (
        code === "SUBSCRIPTION_STATUS_INVALID" &&
        typeof detail.description === "string" &&
        detail.description.length > 0 &&
        detail.description.length <= 500 &&
        /\b(?:CANCELLED|CANCELED|EXPIRED)\b/i.test(detail.description)
      ) {
        terminalState = true
      }
    }
  }

  const providerCode = codes[0] ?? null
  return {
    providerCode,
    terminalState,
  }
}

function paypalEvidence(
  result: SubscriptionCancellationProviderResult,
  httpStatus: number | null,
  providerCode: string | null,
): SubscriptionCancellationProviderOutcome {
  return {
    result,
    effectMayHaveOccurred:
      result === "provider_cancelled" ||
      result === "provider_already_cancelled" ||
      result === "provider_not_found" ||
      (result === "provider_retryable_error" &&
        (httpStatus === null || httpStatus >= 500)),
    evidence: {
      provider: "PAYPAL",
      result,
      httpStatus,
      providerCode,
      requestSemantics: "paypal-terminal-transition",
    },
  }
}

export async function cancelPayPalSubscription(
  providerObjectId: string,
  timeoutMilliseconds: number,
  transport: PayPalSubscriptionCancellationTransport,
): Promise<SubscriptionCancellationProviderOutcome> {
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1_000 ||
    timeoutMilliseconds > 45_000
  ) {
    return paypalEvidence(
      "provider_terminal_error",
      null,
      "INVALID_PROVIDER_TIMEOUT",
    )
  }

  let response: Response
  try {
    response = await transport.request(
      `/v1/billing/subscriptions/${encodeURIComponent(providerObjectId)}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "Cancelled by subscriber" }),
        signal: AbortSignal.timeout(timeoutMilliseconds),
      },
    )
  } catch {
    return paypalEvidence("provider_retryable_error", null, "NETWORK_ERROR")
  }

  if (response.status === 204) {
    return paypalEvidence("provider_cancelled", 204, null)
  }
  const error = await readSafePayPalError(response)
  if (response.status === 404 || error.providerCode === "RESOURCE_NOT_FOUND") {
    return paypalEvidence(
      "provider_not_found",
      response.status,
      error.providerCode,
    )
  }
  if (response.status === 422 && error.terminalState) {
    return paypalEvidence(
      "provider_already_cancelled",
      response.status,
      error.providerCode,
    )
  }
  if (
    response.status === 409 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    return paypalEvidence(
      "provider_retryable_error",
      response.status,
      error.providerCode,
    )
  }
  return paypalEvidence(
    "provider_terminal_error",
    response.status,
    error.providerCode,
  )
}

export async function cancelClaimedSubscriptionWithProvider(
  claim: ClaimedSubscriptionCancellation,
  dependencies: SubscriptionCancellationProviderDependencies,
): Promise<SubscriptionCancellationProviderOutcome> {
  if (
    claim.leaseToken === null ||
    claim.provider === null ||
    claim.providerAccountScope === null ||
    claim.providerObjectType === null ||
    claim.providerObjectId === null
  ) {
    throw new SubscriptionCancellationBoundaryError("unavailable", 503)
  }

  if (claim.provider === "STRIPE") {
    if (
      claim.providerObjectType !== "subscription" ||
      (claim.providerAccountScope !== "stripe_us" &&
        claim.providerAccountScope !== "stripe_uk")
    ) {
      return stripeEvidence(
        "provider_terminal_error",
        null,
        "PROVIDER_SCOPE_MISMATCH",
      )
    }
    return cancelStripeSubscription(
      claim.providerObjectId,
      dependencies.timeoutMilliseconds,
      dependencies.stripeClientForScope(claim.providerAccountScope),
    )
  }

  if (
    claim.providerAccountScope !== "paypal" ||
    claim.providerObjectType !== "billing_subscription"
  ) {
    return paypalEvidence(
      "provider_terminal_error",
      null,
      "PROVIDER_SCOPE_MISMATCH",
    )
  }
  return cancelPayPalSubscription(
    claim.providerObjectId,
    dependencies.timeoutMilliseconds,
    dependencies.paypal,
  )
}
