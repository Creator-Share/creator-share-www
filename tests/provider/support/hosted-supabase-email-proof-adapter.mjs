import { createHash, randomBytes } from "node:crypto"

import {
  classifySupabaseProofVerificationError,
  classifySupabaseProviderFailure,
  verifiedIdentityMatchesScenario,
} from "./supabase-email-proof-supersession.mjs"
import {
  createEtherealImapMailbox,
  isFf029CanaryEmail,
} from "./ethereal-imap-mailbox.mjs"

export const FF029_HOSTED_PROJECT_REF = "destjwstohzmufshfnuy"
export const FF029_HOSTED_SUPABASE_ORIGIN =
  "https://destjwstohzmufshfnuy.supabase.co"
export const FF029_HOSTED_APPLICATION_ORIGIN =
  "https://advocate-staging.creatorshare.com"

const AUTH_VERSION_PATTERN =
  /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9][A-Za-z0-9.-]{0,47})?$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9._~-]{32,384}$/
const REVISION_PATTERN = /^[0-9a-f]{40}$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const ATTESTATION_MAXIMUM_AGE_MILLISECONDS = 5 * 60 * 1000
const ATTESTATION_MAXIMUM_LIFETIME_MILLISECONDS = 4 * 60 * 60 * 1000
const MINIMUM_RECIPIENT_PACING_MILLISECONDS = 1_000
const MAXIMUM_PACING_MILLISECONDS = 10 * 60 * 1000
const MINIMUM_OTP_EXPIRY_SECONDS = 60
const MAXIMUM_OTP_EXPIRY_SECONDS = 3_600
const HOSTED_EMAIL_SENT_LIMIT_PER_HOUR = 120
const HOSTED_OTP_LIMIT_PER_HOUR = 120
const HOSTED_EMAIL_QUOTA_INTERVAL_MILLISECONDS = 30_000
const ADMIN_GENERATE_LINK_INTERVAL_MILLISECONDS = 1_000
const HOSTED_VERIFY_REFILL_PER_HOUR = 360
const HOSTED_VERIFY_BURST_CAPACITY = 30
const MINIMUM_VERIFY_PACING_MILLISECONDS = 10_000
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 10_000
const DEFAULT_REQUEST_ABORT_JOIN_MILLISECONDS = 5_000
const MAXIMUM_ADMIN_USER_PAGES = 100
const ADMIN_USERS_PER_PAGE = 1_000
const PACING_ATTESTATION_KEYS = Object.freeze([
  "admin_generate_link_minimum_interval_milliseconds",
  "application_origin",
  "attestation_digest",
  "attestation_source",
  "captured_at",
  "email_otp_expiry_seconds",
  "email_quota_minimum_interval_milliseconds",
  "kind",
  "maximum_concurrent_burst",
  "project_ref",
  "rate_limit_email_sent_per_hour",
  "rate_limit_otp_per_hour",
  "recipient_minimum_interval_milliseconds",
  "schema_version",
  "smtp_max_frequency_seconds",
  "supabase_origin",
  "valid_until",
  "verify_burst_capacity",
  "verify_minimum_interval_milliseconds",
  "verify_refill_per_hour",
])

const FLOW_REDIRECT_PATHS = Object.freeze({
  advocate_proof_a: "/advocate-invitation",
  advocate_proof_b: "/advocate-invitation",
  existing_account_claim: "/auth/confirm?next=%2Fsponsor%2Fclaim",
  generic_sign_in: "/auth/confirm?next=%2Fapp",
  initial_sponsor_claim: "/auth/confirm?next=%2Fsponsor%2Fclaim",
  recent_action_reauthentication: "/auth/confirm?next=%2Fapp",
})

function fixedError(code, cause) {
  return new Error(code, cause === undefined ? undefined : { cause })
}

function exclusiveOwnershipError(code) {
  const error = fixedError(code)
  Object.defineProperty(error, "ff029RetainExclusiveOwnership", {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  return error
}

function categorizedError(code, error) {
  const wrapped = fixedError(code, error)
  Object.defineProperty(wrapped, "ff029FailureCategory", {
    configurable: false,
    enumerable: false,
    value: classifySupabaseProviderFailure(error),
    writable: false,
  })
  return wrapped
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactIsoTimestamp(value, code) {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 32 ||
    !value.endsWith("Z")
  ) {
    throw fixedError(code)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isSafeInteger(milliseconds)) throw fixedError(code)
  return milliseconds
}

function boundedInteger(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw fixedError(code)
  }
  return value
}

function decodeJwtSection(value, code) {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (!isObject(decoded)) throw fixedError(code)
    return decoded
  } catch (error) {
    throw fixedError(code, error)
  }
}

export function validateHostedSupabaseKey(
  key,
  expectedRole,
  nowMilliseconds = Date.now(),
  minimumValidityMilliseconds = 0,
) {
  if (
    (expectedRole !== "anon" && expectedRole !== "service_role") ||
    !Number.isSafeInteger(nowMilliseconds) ||
    !Number.isSafeInteger(minimumValidityMilliseconds) ||
    minimumValidityMilliseconds < 0 ||
    typeof key !== "string" ||
    key.length < 64 ||
    key.length > 4_096 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)
  ) {
    throw fixedError("ff029_hosted_key_invalid")
  }
  const [encodedHeader, encodedPayload] = key.split(".")
  const header = decodeJwtSection(
    encodedHeader,
    "ff029_hosted_key_header_invalid",
  )
  const claims = decodeJwtSection(
    encodedPayload,
    "ff029_hosted_key_claims_invalid",
  )
  if (
    header.alg !== "HS256" ||
    header.typ !== "JWT" ||
    claims.iss !== "supabase" ||
    claims.ref !== FF029_HOSTED_PROJECT_REF ||
    claims.role !== expectedRole ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    !Number.isSafeInteger(claims.exp * 1_000) ||
    !Number.isSafeInteger(nowMilliseconds + minimumValidityMilliseconds) ||
    claims.iat > Math.floor(nowMilliseconds / 1000) + 60 ||
    claims.exp * 1_000 <= nowMilliseconds + minimumValidityMilliseconds
  ) {
    throw fixedError("ff029_hosted_key_binding_invalid")
  }
  return Object.freeze({
    projectRef: claims.ref,
    role: claims.role,
    issuedAt: claims.iat,
    expiresAt: claims.exp,
  })
}

export function hostedPacingAttestationDigest(value) {
  if (!isObject(value)) {
    throw fixedError("ff029_hosted_pacing_attestation_invalid")
  }
  const payload = {
    admin_generate_link_minimum_interval_milliseconds:
      value.admin_generate_link_minimum_interval_milliseconds,
    application_origin: value.application_origin,
    attestation_source: value.attestation_source,
    captured_at: value.captured_at,
    email_quota_minimum_interval_milliseconds:
      value.email_quota_minimum_interval_milliseconds,
    email_otp_expiry_seconds: value.email_otp_expiry_seconds,
    kind: value.kind,
    maximum_concurrent_burst: value.maximum_concurrent_burst,
    project_ref: value.project_ref,
    rate_limit_email_sent_per_hour: value.rate_limit_email_sent_per_hour,
    rate_limit_otp_per_hour: value.rate_limit_otp_per_hour,
    recipient_minimum_interval_milliseconds:
      value.recipient_minimum_interval_milliseconds,
    schema_version: value.schema_version,
    smtp_max_frequency_seconds: value.smtp_max_frequency_seconds,
    supabase_origin: value.supabase_origin,
    valid_until: value.valid_until,
    verify_burst_capacity: value.verify_burst_capacity,
    verify_minimum_interval_milliseconds:
      value.verify_minimum_interval_milliseconds,
    verify_refill_per_hour: value.verify_refill_per_hour,
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export function createHostedPacingAttestation(value) {
  if (
    !isObject(value) ||
    !Number.isSafeInteger(value.smtpMaxFrequencySeconds)
  ) {
    throw fixedError("ff029_hosted_pacing_attestation_invalid")
  }
  const attestation = {
    schema_version: 1,
    kind: "ff029_operator_supplied_auth_limits",
    attestation_source: "operator_supplied",
    project_ref: FF029_HOSTED_PROJECT_REF,
    supabase_origin: FF029_HOSTED_SUPABASE_ORIGIN,
    application_origin: FF029_HOSTED_APPLICATION_ORIGIN,
    captured_at: value.capturedAt,
    valid_until: value.validUntil,
    admin_generate_link_minimum_interval_milliseconds:
      ADMIN_GENERATE_LINK_INTERVAL_MILLISECONDS,
    email_quota_minimum_interval_milliseconds:
      HOSTED_EMAIL_QUOTA_INTERVAL_MILLISECONDS,
    recipient_minimum_interval_milliseconds:
      value.smtpMaxFrequencySeconds * 1_000,
    email_otp_expiry_seconds: value.emailOtpExpirySeconds,
    maximum_concurrent_burst: 2,
    rate_limit_email_sent_per_hour: value.rateLimitEmailSentPerHour,
    rate_limit_otp_per_hour: value.rateLimitOtpPerHour,
    smtp_max_frequency_seconds: value.smtpMaxFrequencySeconds,
    verify_refill_per_hour: HOSTED_VERIFY_REFILL_PER_HOUR,
    verify_burst_capacity: value.verifyBurstCapacity,
    verify_minimum_interval_milliseconds: MINIMUM_VERIFY_PACING_MILLISECONDS,
  }
  return Object.freeze({
    ...attestation,
    attestation_digest: hostedPacingAttestationDigest(attestation),
  })
}

export function validateHostedPacingAttestation(value, options = {}) {
  const nowMilliseconds = options.nowMilliseconds ?? Date.now()
  if (!Number.isSafeInteger(nowMilliseconds) || !isObject(value)) {
    throw fixedError("ff029_hosted_pacing_attestation_invalid")
  }
  const capturedAt = exactIsoTimestamp(
    value.captured_at,
    "ff029_hosted_pacing_attestation_time_invalid",
  )
  const validUntil = exactIsoTimestamp(
    value.valid_until,
    "ff029_hosted_pacing_attestation_time_invalid",
  )
  const keys = Object.keys(value).sort()
  if (
    keys.length !== PACING_ATTESTATION_KEYS.length ||
    keys.some((key, index) => key !== PACING_ATTESTATION_KEYS[index]) ||
    value.schema_version !== 1 ||
    value.kind !== "ff029_operator_supplied_auth_limits" ||
    value.attestation_source !== "operator_supplied" ||
    value.maximum_concurrent_burst !== 2 ||
    !Number.isSafeInteger(value.smtp_max_frequency_seconds) ||
    value.smtp_max_frequency_seconds < 1 ||
    value.smtp_max_frequency_seconds > 600 ||
    value.recipient_minimum_interval_milliseconds !==
      value.smtp_max_frequency_seconds * 1_000 ||
    value.rate_limit_email_sent_per_hour !== HOSTED_EMAIL_SENT_LIMIT_PER_HOUR ||
    value.rate_limit_otp_per_hour !== HOSTED_OTP_LIMIT_PER_HOUR ||
    value.email_quota_minimum_interval_milliseconds !==
      Math.ceil(
        3_600_000 /
          Math.min(
            value.rate_limit_email_sent_per_hour,
            value.rate_limit_otp_per_hour,
          ),
      ) ||
    value.admin_generate_link_minimum_interval_milliseconds !==
      ADMIN_GENERATE_LINK_INTERVAL_MILLISECONDS ||
    value.verify_refill_per_hour !== HOSTED_VERIFY_REFILL_PER_HOUR ||
    value.verify_burst_capacity !== HOSTED_VERIFY_BURST_CAPACITY ||
    value.verify_minimum_interval_milliseconds <
      MINIMUM_VERIFY_PACING_MILLISECONDS ||
    value.verify_minimum_interval_milliseconds !==
      Math.ceil(3_600_000 / value.verify_refill_per_hour) ||
    value.project_ref !== FF029_HOSTED_PROJECT_REF ||
    value.supabase_origin !== FF029_HOSTED_SUPABASE_ORIGIN ||
    value.application_origin !== FF029_HOSTED_APPLICATION_ORIGIN ||
    !DIGEST_PATTERN.test(value.attestation_digest ?? "") ||
    value.attestation_digest !== hostedPacingAttestationDigest(value) ||
    capturedAt > nowMilliseconds + 30_000 ||
    nowMilliseconds - capturedAt > ATTESTATION_MAXIMUM_AGE_MILLISECONDS ||
    validUntil <= nowMilliseconds ||
    validUntil - capturedAt > ATTESTATION_MAXIMUM_LIFETIME_MILLISECONDS
  ) {
    throw fixedError("ff029_hosted_pacing_attestation_invalid")
  }
  const adminGenerateLinkMinimumIntervalMilliseconds = boundedInteger(
    value.admin_generate_link_minimum_interval_milliseconds,
    ADMIN_GENERATE_LINK_INTERVAL_MILLISECONDS,
    60_000,
    "ff029_hosted_admin_pacing_invalid",
  )
  const emailQuotaMinimumIntervalMilliseconds = boundedInteger(
    value.email_quota_minimum_interval_milliseconds,
    HOSTED_EMAIL_QUOTA_INTERVAL_MILLISECONDS,
    MAXIMUM_PACING_MILLISECONDS,
    "ff029_hosted_email_quota_pacing_invalid",
  )
  const recipientMinimumIntervalMilliseconds = boundedInteger(
    value.recipient_minimum_interval_milliseconds,
    MINIMUM_RECIPIENT_PACING_MILLISECONDS,
    MAXIMUM_PACING_MILLISECONDS,
    "ff029_hosted_recipient_pacing_invalid",
  )
  const emailOtpExpirySeconds = boundedInteger(
    value.email_otp_expiry_seconds,
    MINIMUM_OTP_EXPIRY_SECONDS,
    MAXIMUM_OTP_EXPIRY_SECONDS,
    "ff029_hosted_otp_expiry_invalid",
  )
  const verifyMinimumIntervalMilliseconds = boundedInteger(
    value.verify_minimum_interval_milliseconds,
    MINIMUM_VERIFY_PACING_MILLISECONDS,
    60_000,
    "ff029_hosted_verify_pacing_invalid",
  )
  return Object.freeze({
    schemaVersion: 1,
    attestationSource: "operator_supplied",
    capturedAt,
    validUntil,
    adminGenerateLinkMinimumIntervalMilliseconds,
    emailQuotaMinimumIntervalMilliseconds,
    recipientMinimumIntervalMilliseconds,
    emailOtpExpirySeconds,
    maximumConcurrentBurst: 2,
    rateLimitEmailSentPerHour: value.rate_limit_email_sent_per_hour,
    rateLimitOtpPerHour: value.rate_limit_otp_per_hour,
    smtpMaxFrequencySeconds: value.smtp_max_frequency_seconds,
    verifyBurstCapacity: value.verify_burst_capacity,
    verifyMinimumIntervalMilliseconds,
    verifyRefillPerHour: value.verify_refill_per_hour,
    attestationDigest: value.attestation_digest,
  })
}

function requireCanaryEmail(value) {
  if (!isFf029CanaryEmail(value)) {
    throw fixedError("ff029_hosted_canary_email_invalid")
  }
  return value
}

function requireExecutionLifecycle(lifecycle) {
  if (
    !Number.isSafeInteger(lifecycle?.executionDeadline) ||
    lifecycle.executionDeadline <= Date.now() ||
    !(lifecycle.signal instanceof AbortSignal) ||
    lifecycle.signal.aborted
  ) {
    throw fixedError("ff029_execution_lifecycle_invalid")
  }
  return lifecycle
}

function requireDeadlineLifecycle(lifecycle, code) {
  const deadline =
    lifecycle?.deadline ??
    lifecycle?.executionDeadline ??
    lifecycle?.cleanupDeadline
  if (
    !Number.isSafeInteger(deadline) ||
    deadline <= Date.now() ||
    (lifecycle.signal !== undefined &&
      (!(lifecycle.signal instanceof AbortSignal) || lifecycle.signal.aborted))
  ) {
    throw fixedError(code)
  }
  return { deadline, signal: lifecycle.signal }
}

function sleep(milliseconds, signal, sleepImplementation = setTimeout) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(fixedError("ff029_operation_cancelled"))
      return
    }
    let timer
    const abort = () => {
      clearTimeout(timer)
      rejectPromise(fixedError("ff029_operation_cancelled"))
    }
    timer = sleepImplementation(() => {
      signal?.removeEventListener("abort", abort)
      resolvePromise()
    }, milliseconds)
    signal?.addEventListener("abort", abort, { once: true })
  })
}

export function createHostedIssuancePacer(attestationValue, options = {}) {
  const now = options.nowImplementation ?? Date.now
  const sleepFor =
    options.sleepImplementation ??
    ((milliseconds, signal) => sleep(milliseconds, signal))
  const attestation = validateHostedPacingAttestation(attestationValue, {
    nowMilliseconds: now(),
  })
  let nextAdminDispatchAt = 0
  let nextEmailDispatchAt = 0
  const lastEmailRecipientDispatchAt = new Map()
  let tail = Promise.resolve()

  async function paceDispatch(email, reservation, lifecycle) {
    requireCanaryEmail(email)
    const adminSlots = reservation?.adminSlots
    const emailSlots = reservation?.emailSlots
    const burstSize = adminSlots + emailSlots
    if (
      !Number.isSafeInteger(adminSlots) ||
      !Number.isSafeInteger(emailSlots) ||
      adminSlots < 0 ||
      emailSlots < 0 ||
      adminSlots > attestation.maximumConcurrentBurst ||
      emailSlots > attestation.maximumConcurrentBurst ||
      (burstSize !== 1 && burstSize !== attestation.maximumConcurrentBurst)
    ) {
      throw fixedError("ff029_hosted_concurrent_burst_invalid")
    }
    const predecessor = tail
    let release
    tail = new Promise((resolvePromise) => {
      release = resolvePromise
    })
    await predecessor
    try {
      const { deadline, signal } = requireDeadlineLifecycle(
        lifecycle,
        "ff029_hosted_pacing_lifecycle_invalid",
      )
      const current = now()
      const recipientReadyAt =
        emailSlots === 0
          ? 0
          : (lastEmailRecipientDispatchAt.get(email) ?? 0) +
            attestation.recipientMinimumIntervalMilliseconds
      const readyAt = Math.max(
        current,
        adminSlots > 0 ? nextAdminDispatchAt : 0,
        emailSlots > 0 ? nextEmailDispatchAt : 0,
        recipientReadyAt,
      )
      if (readyAt >= deadline) {
        throw fixedError("ff029_hosted_pacing_budget_exhausted")
      }
      if (readyAt > current) {
        await sleepFor(readyAt - current, signal)
      }
      const dispatchedAt = now()
      if (dispatchedAt < readyAt || dispatchedAt >= deadline) {
        throw fixedError("ff029_hosted_pacing_clock_invalid")
      }
      if (adminSlots > 0) {
        nextAdminDispatchAt =
          dispatchedAt +
          adminSlots * attestation.adminGenerateLinkMinimumIntervalMilliseconds
      }
      if (emailSlots > 0) {
        nextEmailDispatchAt =
          dispatchedAt +
          emailSlots * attestation.emailQuotaMinimumIntervalMilliseconds
        lastEmailRecipientDispatchAt.set(email, dispatchedAt)
      }
      return Object.freeze({
        adminSlots,
        burstSize,
        dispatchedAt,
        emailSlots,
      })
    } finally {
      release()
    }
  }

  return Object.freeze({
    attestation,
    paceAdmin: (email, lifecycle) =>
      paceDispatch(email, { adminSlots: 1, emailSlots: 0 }, lifecycle),
    paceEmail: (email, lifecycle) =>
      paceDispatch(email, { adminSlots: 0, emailSlots: 1 }, lifecycle),
    paceGroup: (email, reservation, lifecycle) =>
      paceDispatch(email, reservation, lifecycle),
  })
}

export function createHostedVerificationPacer(attestationValue, options = {}) {
  const now = options.nowImplementation ?? Date.now
  const sleepFor =
    options.sleepImplementation ??
    ((milliseconds, signal) => sleep(milliseconds, signal))
  const attestation = validateHostedPacingAttestation(attestationValue, {
    nowMilliseconds: now(),
  })
  let nextVerificationAt = 0
  let tail = Promise.resolve()

  return Object.freeze({
    attestation,
    async pace(lifecycle) {
      const predecessor = tail
      let release
      tail = new Promise((resolvePromise) => {
        release = resolvePromise
      })
      await predecessor
      try {
        const { deadline, signal } = requireDeadlineLifecycle(
          lifecycle,
          "ff029_hosted_verify_pacing_lifecycle_invalid",
        )
        const current = now()
        const readyAt = Math.max(current, nextVerificationAt)
        if (readyAt >= deadline) {
          throw fixedError("ff029_hosted_verify_pacing_budget_exhausted")
        }
        if (readyAt > current) {
          await sleepFor(readyAt - current, signal)
        }
        const dispatchedAt = now()
        if (dispatchedAt < readyAt || dispatchedAt >= deadline) {
          throw fixedError("ff029_hosted_verify_pacing_clock_invalid")
        }
        nextVerificationAt =
          dispatchedAt + attestation.verifyMinimumIntervalMilliseconds
        return Object.freeze({ dispatchedAt })
      } finally {
        release()
      }
    },
  })
}

function authRequestUrl(input) {
  let url
  try {
    const raw =
      typeof input === "string" || input instanceof URL ? input : input?.url
    url = new URL(raw)
  } catch (error) {
    throw fixedError("ff029_hosted_auth_request_url_invalid", error)
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== FF029_HOSTED_SUPABASE_ORIGIN ||
    !url.pathname.startsWith("/auth/v1/") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw fixedError("ff029_hosted_auth_request_not_allowed")
  }
  return url
}

export function createExactHostedAuthFetch(fetchImplementation, options = {}) {
  if (typeof fetchImplementation !== "function") {
    throw fixedError("ff029_fetch_unavailable")
  }
  const requestTimeoutMilliseconds = boundedInteger(
    options.requestTimeoutMilliseconds ?? DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
    250,
    60_000,
    "ff029_request_timeout_invalid",
  )
  const requestAbortJoinMilliseconds = boundedInteger(
    options.requestAbortJoinMilliseconds ??
      DEFAULT_REQUEST_ABORT_JOIN_MILLISECONDS,
    100,
    60_000,
    "ff029_request_abort_join_invalid",
  )
  const activeDeadline = options.activeDeadline ?? (() => undefined)
  const activeSignal = options.activeSignal ?? (() => undefined)
  let unsettledRequestError = null
  const exactFetch = async (input, init = {}) => {
    authRequestUrl(input)
    if (init.redirect !== undefined && init.redirect !== "error") {
      throw fixedError("ff029_redirect_policy_invalid")
    }
    const deadline = activeDeadline()
    const remaining =
      deadline === undefined
        ? requestTimeoutMilliseconds
        : deadline - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) {
      throw fixedError("ff029_request_deadline_exhausted")
    }
    const timeoutController = new AbortController()
    const upstreamSignal = activeSignal()
    if (upstreamSignal?.aborted || init.signal?.aborted) {
      throw fixedError("ff029_request_cancelled")
    }
    const signals = [
      init.signal,
      upstreamSignal,
      timeoutController.signal,
    ].filter(Boolean)
    const signal =
      typeof AbortSignal.any === "function"
        ? AbortSignal.any(signals)
        : timeoutController.signal
    const requestWindowMilliseconds = Math.min(
      requestTimeoutMilliseconds,
      remaining,
    )
    const requestPromise = Promise.resolve().then(() =>
      fetchImplementation(input, {
        ...init,
        redirect: "error",
        signal,
      }),
    )
    const settledRequest = requestPromise.then(
      (value) => Object.freeze({ status: "completed", value }),
      (error) => Object.freeze({ status: "failed", error }),
    )
    let timer
    const abortListeners = []
    const interrupted = new Promise((resolvePromise) => {
      let resolved = false
      const resolveOnce = (status) => {
        if (resolved) return
        resolved = true
        resolvePromise(Object.freeze({ status }))
      }
      timer = setTimeout(
        () => resolveOnce("timed_out"),
        requestWindowMilliseconds,
      )
      for (const candidate of [init.signal, upstreamSignal].filter(Boolean)) {
        const onAbort = () => resolveOnce("cancelled")
        candidate.addEventListener("abort", onAbort, { once: true })
        abortListeners.push([candidate, onAbort])
        if (candidate.aborted) resolveOnce("cancelled")
      }
    })
    const first = await Promise.race([settledRequest, interrupted])
    clearTimeout(timer)
    for (const [candidate, listener] of abortListeners) {
      candidate.removeEventListener("abort", listener)
    }
    if (first.status === "failed") throw first.error
    if (first.status !== "completed") {
      timeoutController.abort()
      let joinTimer
      const joinTimeout = new Promise((resolvePromise) => {
        joinTimer = setTimeout(
          () => resolvePromise(Object.freeze({ status: "join_timed_out" })),
          Math.min(requestAbortJoinMilliseconds, requestWindowMilliseconds),
        )
      })
      const joined = await Promise.race([settledRequest, joinTimeout])
      clearTimeout(joinTimer)
      if (joined.status === "join_timed_out") {
        void requestPromise.catch(() => {})
        unsettledRequestError ??= exclusiveOwnershipError(
          "ff029_request_unsettled_after_abort",
        )
        throw unsettledRequestError
      }
      throw fixedError(
        first.status === "timed_out"
          ? "ff029_request_timeout"
          : "ff029_request_cancelled",
      )
    }
    const response = first.value
    if (
      !response ||
      response.redirected === true ||
      (Number.isInteger(response.status) &&
        response.status >= 300 &&
        response.status < 400)
    ) {
      throw fixedError("ff029_redirect_refused")
    }
    authRequestUrl(response.url)
    return response
  }
  Object.defineProperty(exactFetch, "assertNoUnsettledOperations", {
    configurable: false,
    enumerable: false,
    value: () => {
      if (unsettledRequestError !== null) throw unsettledRequestError
    },
    writable: false,
  })
  return exactFetch
}

function redirectForFlow(flow) {
  const path = FLOW_REDIRECT_PATHS[flow]
  if (!path) throw fixedError("ff029_flow_invalid")
  const redirect = new URL(path, FF029_HOSTED_APPLICATION_ORIGIN)
  if (redirect.origin !== FF029_HOSTED_APPLICATION_ORIGIN) {
    throw fixedError("ff029_redirect_invalid")
  }
  return redirect.href
}

function isSponsorEmailFlow(flow) {
  if (!FLOW_REDIRECT_PATHS[flow]) throw fixedError("ff029_flow_invalid")
  return flow !== "advocate_proof_a" && flow !== "advocate_proof_b"
}

function createCanaryEmail() {
  return `creator-share-ff029-${randomBytes(16).toString("hex")}@example.com`
}

function confirmedEmailTimestamp(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  )
}

function accessTokenClaims(accessToken) {
  if (
    typeof accessToken !== "string" ||
    accessToken.length > 16_384 ||
    accessToken.split(".").length !== 3
  ) {
    return null
  }
  try {
    const claims = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
    )
    return isObject(claims) ? claims : null
  } catch {
    return null
  }
}

function authenticationMethod(accessToken) {
  const claims = accessTokenClaims(accessToken)
  if (!Array.isArray(claims?.amr) || claims.amr.length === 0) {
    return "not_available"
  }
  const methods = claims.amr.flatMap((entry) =>
    typeof entry?.method === "string" ? [entry.method] : [],
  )
  for (const method of ["magiclink", "otp", "signup", "email"]) {
    if (methods.includes(method)) return method
  }
  return methods.length > 0 ? "other" : "not_available"
}

function requireJournal(journal) {
  for (const method of ["complete", "snapshot", "trackEmail", "trackUserId"]) {
    if (typeof journal?.[method] !== "function") {
      throw fixedError("ff029_hosted_cleanup_journal_invalid")
    }
  }
  return journal
}

async function listTrackedUserIds(adminClient, trackedEmails, requireTime) {
  const userIds = new Set()
  for (let page = 1; page <= MAXIMUM_ADMIN_USER_PAGES; page += 1) {
    requireTime()
    let response
    try {
      response = await adminClient.auth.admin.listUsers({
        page,
        perPage: ADMIN_USERS_PER_PAGE,
      })
    } catch (error) {
      throw categorizedError("ff029_hosted_user_inventory_unavailable", error)
    }
    if (response.error || !Array.isArray(response.data?.users)) {
      throw categorizedError(
        "ff029_hosted_user_inventory_failed",
        response.error ?? fixedError("ff029_hosted_user_inventory_invalid"),
      )
    }
    for (const user of response.data.users) {
      if (trackedEmails.has(user?.email) && UUID_PATTERN.test(user?.id ?? "")) {
        userIds.add(user.id)
      }
    }
    if (
      response.data.users.length < ADMIN_USERS_PER_PAGE ||
      (Number.isSafeInteger(response.data.lastPage) &&
        page >= response.data.lastPage)
    ) {
      return userIds
    }
  }
  throw fixedError("ff029_hosted_user_inventory_unbounded")
}

function isExactSupabaseUserNotFound(error) {
  return (
    isObject(error) && error.code === "user_not_found" && error.status === 404
  )
}

async function proveTrackedUserIdAbsent(adminClient, userId, requireTime) {
  if (typeof adminClient?.auth?.admin?.getUserById !== "function") {
    throw fixedError("ff029_hosted_user_identity_inventory_unavailable")
  }
  requireTime()
  let response
  try {
    response = await adminClient.auth.admin.getUserById(userId)
  } catch (error) {
    if (isExactSupabaseUserNotFound(error)) return
    throw categorizedError(
      "ff029_hosted_user_identity_inventory_unavailable",
      error,
    )
  }
  if (isExactSupabaseUserNotFound(response?.error)) return
  if (response?.error) {
    throw categorizedError(
      "ff029_hosted_user_identity_inventory_failed",
      response.error,
    )
  }
  if (response?.data?.user?.id === userId) {
    throw fixedError("ff029_hosted_user_cleanup_incomplete")
  }
  throw fixedError("ff029_hosted_user_identity_inventory_invalid")
}

async function trackedUserForDeletion(
  adminClient,
  userId,
  trackedEmails,
  requireTime,
) {
  if (typeof adminClient?.auth?.admin?.getUserById !== "function") {
    throw fixedError("ff029_hosted_user_identity_inventory_unavailable")
  }
  requireTime()
  let response
  try {
    response = await adminClient.auth.admin.getUserById(userId)
  } catch (error) {
    if (isExactSupabaseUserNotFound(error)) return null
    throw categorizedError(
      "ff029_hosted_user_identity_inventory_unavailable",
      error,
    )
  }
  if (isExactSupabaseUserNotFound(response?.error)) return null
  if (response?.error) {
    throw categorizedError(
      "ff029_hosted_user_identity_inventory_failed",
      response.error,
    )
  }
  const user = response?.data?.user
  if (
    user?.id !== userId ||
    !isFf029CanaryEmail(user?.email) ||
    !trackedEmails.has(user.email)
  ) {
    throw fixedError("ff029_hosted_user_cleanup_ownership_invalid")
  }
  return user
}

export async function createHostedSupabaseEmailProofAdapter(options) {
  const now = options?.nowImplementation ?? Date.now
  const cleanupOnly = options?.cleanupOnly === true
  const anonKey = options?.anonKey
  const serviceRoleKey = options?.serviceRoleKey
  validateHostedSupabaseKey(serviceRoleKey, "service_role", now())
  if (!cleanupOnly) {
    validateHostedSupabaseKey(anonKey, "anon", now())
    if (anonKey === serviceRoleKey) {
      throw fixedError("ff029_hosted_keys_not_distinct")
    }
  }
  const attestation = cleanupOnly
    ? null
    : validateHostedPacingAttestation(options?.pacingAttestation, {
        nowMilliseconds: now(),
      })
  const journal = requireJournal(options?.cleanupJournal)
  const pacer = cleanupOnly
    ? null
    : (options?.pacerImplementation ??
      createHostedIssuancePacer(options.pacingAttestation, {
        nowImplementation: now,
        sleepImplementation: options?.sleepImplementation,
      }))
  if (!cleanupOnly) {
    if (
      typeof pacer?.paceAdmin !== "function" ||
      typeof pacer?.paceEmail !== "function" ||
      typeof pacer?.paceGroup !== "function"
    ) {
      throw fixedError("ff029_hosted_pacer_invalid")
    }
  }
  const verificationPacer = cleanupOnly
    ? null
    : (options?.verificationPacerImplementation ??
      createHostedVerificationPacer(options.pacingAttestation, {
        nowImplementation: now,
        sleepImplementation: options?.sleepImplementation,
      }))
  if (!cleanupOnly && typeof verificationPacer?.pace !== "function") {
    throw fixedError("ff029_hosted_verify_pacer_invalid")
  }
  const fetchImplementation = options?.fetchImplementation ?? globalThis.fetch
  let executionDeadline
  let executionSignal
  let cleanupDeadline
  let cleanupSignal
  const authFetch = createExactHostedAuthFetch(fetchImplementation, {
    requestTimeoutMilliseconds: options?.requestTimeoutMilliseconds,
    requestAbortJoinMilliseconds: options?.requestAbortJoinMilliseconds,
    activeDeadline: () => cleanupDeadline ?? executionDeadline,
    activeSignal: () =>
      cleanupDeadline === undefined ? executionSignal : cleanupSignal,
  })
  const createClientImplementation =
    options?.createClientImplementation ??
    (await import("@supabase/supabase-js")).createClient
  if (typeof createClientImplementation !== "function") {
    throw fixedError("ff029_supabase_client_invalid")
  }
  const clientOptions = {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: authFetch },
  }
  const adminClient = createClientImplementation(
    FF029_HOSTED_SUPABASE_ORIGIN,
    serviceRoleKey,
    clientOptions,
  )
  const mailbox =
    options?.mailboxImplementation ??
    (await createEtherealImapMailbox(options?.ethereal))
  for (const method of [
    "close",
    "countTrackedMessages",
    "deleteTrackedMessages",
    "initialize",
    "proofFromMessage",
    "snapshot",
    "waitForNewMessage",
  ]) {
    if (typeof mailbox?.[method] !== "function") {
      throw fixedError("ff029_ethereal_mailbox_invalid")
    }
  }
  const contexts = new Set()

  function assertNoUnsettledOperations() {
    authFetch.assertNoUnsettledOperations()
    mailbox.assertNoUnsettledOperations?.()
  }

  function requireExecutionTime(lifecycle) {
    requireExecutionLifecycle(lifecycle)
    executionDeadline = lifecycle.executionDeadline
    executionSignal = lifecycle.signal
  }

  async function newAnonClient() {
    return createClientImplementation(
      FF029_HOSTED_SUPABASE_ORIGIN,
      anonKey,
      clientOptions,
    )
  }

  async function consume(context, proof, lifecycle) {
    if (cleanupOnly) throw fixedError("ff029_cleanup_only_adapter")
    requireExecutionTime(lifecycle)
    if (
      !contexts.has(context) ||
      !isObject(proof) ||
      proof.expectedEmail !== context.email ||
      !TOKEN_HASH_PATTERN.test(proof.tokenHash ?? "") ||
      !["email", "magiclink", "signup"].includes(proof.authType)
    ) {
      throw fixedError("ff029_proof_invalid")
    }
    await verificationPacer.pace(lifecycle)
    requireExecutionTime(lifecycle)
    const client = await newAnonClient()
    let response
    try {
      response = await client.auth.verifyOtp({
        token_hash: proof.tokenHash,
        type: proof.authType,
      })
    } catch (error) {
      throw categorizedError("ff029_proof_verification_unavailable", error)
    }
    requireExecutionTime(lifecycle)
    if (response.error) {
      const outcome = classifySupabaseProofVerificationError(response.error)
      return {
        outcome,
        authenticationMethod:
          outcome === "rejected" ? "not_available" : "provider_error",
        failureCategory:
          outcome === "rejected"
            ? "none"
            : classifySupabaseProviderFailure(response.error),
      }
    }
    const userId = response.data?.user?.id
    if (
      !verifiedIdentityMatchesScenario(
        response.data,
        proof.expectedEmail,
        proof.userId,
      )
    ) {
      return {
        outcome: "provider_error",
        authenticationMethod: "provider_error",
        failureCategory: "unknown_provider_failure",
      }
    }
    await journal.trackUserId(userId)
    const method = authenticationMethod(response.data.session?.access_token)
    return {
      outcome: method === "not_available" ? "provider_error" : "accepted",
      authenticationMethod:
        method === "not_available" ? "provider_error" : method,
      failureCategory:
        method === "not_available" ? "unknown_provider_failure" : "none",
    }
  }

  return Object.freeze({
    assertNoUnsettledOperations,
    async initialize(lifecycle) {
      if (cleanupOnly) throw fixedError("ff029_cleanup_only_adapter")
      requireExecutionTime(lifecycle)
      await mailbox.initialize(lifecycle)
      const response = await authFetch(
        `${FF029_HOSTED_SUPABASE_ORIGIN}/auth/v1/health`,
        { cache: "no-store" },
      )
      if (!response.ok) throw fixedError("ff029_auth_health_unavailable")
      let health
      try {
        health = await response.json()
      } catch (error) {
        throw fixedError("ff029_auth_health_invalid", error)
      }
      if (!AUTH_VERSION_PATTERN.test(health?.version ?? "")) {
        throw fixedError("ff029_auth_health_invalid")
      }
      requireExecutionTime(lifecycle)
      return {
        authVersion: health.version,
        projectRef: FF029_HOSTED_PROJECT_REF,
      }
    },

    async prepareScenario(definition, lifecycle) {
      if (cleanupOnly) throw fixedError("ff029_cleanup_only_adapter")
      requireExecutionTime(lifecycle)
      if (
        definition?.accountState !== "new" &&
        definition?.accountState !== "existing"
      ) {
        throw fixedError("ff029_scenario_definition_invalid")
      }
      const issuanceMode =
        definition.issuanceMode === "concurrent" ? "concurrent" : "sequential"
      if (
        issuanceMode === "concurrent" &&
        (!Array.isArray(definition.flows) || definition.flows.length !== 2)
      ) {
        throw fixedError("ff029_concurrent_scenario_invalid")
      }
      const concurrentReservation =
        issuanceMode === "concurrent"
          ? Object.freeze({
              adminSlots: definition.flows.filter(
                (flow) => !isSponsorEmailFlow(flow),
              ).length,
              emailSlots: definition.flows.filter(isSponsorEmailFlow).length,
            })
          : null
      if (concurrentReservation?.emailSlots > 1) {
        throw fixedError("ff029_concurrent_smtp_pair_unsupported")
      }
      const email = createCanaryEmail()
      await journal.trackEmail(email)
      const context = {
        email,
        issuanceMode,
        concurrentReservation,
        concurrentParticipants: 0,
        concurrentPace: null,
      }
      contexts.add(context)
      if (definition.accountState === "existing") {
        let response
        try {
          response = await adminClient.auth.admin.createUser({
            email,
            email_confirm: true,
          })
        } catch (error) {
          throw categorizedError(
            "ff029_existing_user_creation_unavailable",
            error,
          )
        }
        if (
          response.error ||
          !UUID_PATTERN.test(response.data?.user?.id ?? "") ||
          response.data?.user?.email !== email ||
          !confirmedEmailTimestamp(response.data?.user?.email_confirmed_at)
        ) {
          throw categorizedError(
            "ff029_existing_user_creation_failed",
            response.error ??
              fixedError("ff029_existing_user_creation_invalid"),
          )
        }
        await journal.trackUserId(response.data.user.id)
      }
      requireExecutionTime(lifecycle)
      return context
    },

    async issueProof(context, flow, lifecycle, dispatchBarrier) {
      if (cleanupOnly) throw fixedError("ff029_cleanup_only_adapter")
      requireExecutionTime(lifecycle)
      if (!contexts.has(context)) throw fixedError("ff029_context_invalid")
      if (typeof dispatchBarrier?.wait !== "function") {
        throw fixedError("ff029_dispatch_barrier_missing")
      }
      const redirectTo = redirectForFlow(flow)
      const sponsorFlow = isSponsorEmailFlow(flow)
      const priorMessages = sponsorFlow
        ? await mailbox.snapshot(context.email, lifecycle)
        : null
      await dispatchBarrier.wait()
      if (context.issuanceMode === "concurrent") {
        context.concurrentParticipants += 1
        if (
          context.concurrentParticipants > attestation.maximumConcurrentBurst
        ) {
          throw fixedError("ff029_hosted_concurrent_burst_invalid")
        }
        context.concurrentPace ??= pacer.paceGroup(
          context.email,
          context.concurrentReservation,
          lifecycle,
        )
        await context.concurrentPace
      } else if (sponsorFlow) {
        await pacer.paceEmail(context.email, lifecycle)
      } else {
        await pacer.paceAdmin(context.email, lifecycle)
      }
      requireExecutionTime(lifecycle)
      if (!sponsorFlow) {
        let response
        try {
          response = await adminClient.auth.admin.generateLink({
            type: "magiclink",
            email: context.email,
            options: { redirectTo },
          })
        } catch (error) {
          throw categorizedError(
            "ff029_advocate_proof_issuance_unavailable",
            error,
          )
        }
        if (response.error) {
          throw categorizedError(
            "ff029_advocate_proof_issuance_failed",
            response.error,
          )
        }
        const tokenHash = response.data?.properties?.hashed_token
        const userId = response.data?.user?.id
        const verificationType = response.data?.properties?.verification_type
        if (
          !TOKEN_HASH_PATTERN.test(tokenHash ?? "") ||
          !UUID_PATTERN.test(userId ?? "") ||
          response.data?.user?.email !== context.email ||
          !["magiclink", "signup"].includes(verificationType)
        ) {
          throw fixedError("ff029_advocate_proof_issuance_failed")
        }
        await journal.trackUserId(userId)
        requireExecutionTime(lifecycle)
        const issuedAt = now()
        return {
          tokenHash,
          authType: verificationType,
          userId,
          expectedEmail: context.email,
          issuanceOutcome:
            verificationType === "magiclink"
              ? "issued_magiclink"
              : "issued_signup",
          issuedAt,
        }
      }

      const client = await newAnonClient()
      let response
      try {
        response = await client.auth.signInWithOtp({
          email: context.email,
          options: {
            emailRedirectTo: redirectTo,
            shouldCreateUser: flow === "initial_sponsor_claim",
          },
        })
      } catch (error) {
        throw categorizedError(
          "ff029_sponsor_proof_issuance_unavailable",
          error,
        )
      }
      if (response.error) {
        throw categorizedError(
          "ff029_sponsor_proof_issuance_failed",
          response.error,
        )
      }
      requireExecutionTime(lifecycle)
      const messageId = await mailbox.waitForNewMessage(
        context.email,
        priorMessages,
        lifecycle,
      )
      const expectedLinkTemplate = `${redirectTo}#token_hash={token_hash}&v=1`
      const tokenHash = await mailbox.proofFromMessage(
        messageId,
        lifecycle,
        expectedLinkTemplate,
      )
      if (!TOKEN_HASH_PATTERN.test(tokenHash ?? "")) {
        throw fixedError("ff029_sponsor_proof_issuance_failed")
      }
      requireExecutionTime(lifecycle)
      const issuedAt = now()
      return {
        tokenHash,
        authType: "email",
        userId: null,
        expectedEmail: context.email,
        issuanceOutcome: "issued_email",
        issuedAt,
      }
    },

    consumeProof: consume,

    async observeExpiry(context, proof, lifecycle) {
      if (cleanupOnly) throw fixedError("ff029_cleanup_only_adapter")
      requireExecutionTime(lifecycle)
      if (!Number.isSafeInteger(proof?.issuedAt)) {
        throw fixedError("ff029_expiry_proof_invalid")
      }
      const expiryAt =
        proof.issuedAt + attestation.emailOtpExpirySeconds * 1_000 + 1_000
      if (expiryAt >= lifecycle.executionDeadline) {
        throw fixedError("ff029_expiry_budget_insufficient")
      }
      const remaining = expiryAt - now()
      if (remaining > 0) {
        const wait =
          options?.expirySleepImplementation ??
          ((milliseconds, signal) => sleep(milliseconds, signal))
        await wait(remaining, lifecycle.signal)
      }
      requireExecutionTime(lifecycle)
      const result = await consume(context, proof, lifecycle)
      return result.outcome === "rejected"
        ? result
        : {
            outcome: "provider_error",
            authenticationMethod: "provider_error",
            failureCategory: "unexpected_failure",
          }
    },

    async cleanup(cleanupOptions = {}) {
      if (
        !Number.isSafeInteger(cleanupOptions.cleanupDeadline) ||
        cleanupOptions.cleanupDeadline <= Date.now() ||
        (cleanupOptions.retainRecoveryState !== undefined &&
          typeof cleanupOptions.retainRecoveryState !== "boolean") ||
        (cleanupOptions.signal !== undefined &&
          !(cleanupOptions.signal instanceof AbortSignal))
      ) {
        throw fixedError("ff029_cleanup_deadline_invalid")
      }
      cleanupDeadline = cleanupOptions.cleanupDeadline
      cleanupSignal = cleanupOptions.signal
      const retainRecoveryState = cleanupOptions.retainRecoveryState === true
      const requireCleanupTime = () => {
        if (cleanupSignal?.aborted) {
          throw fixedError("ff029_operation_cancelled")
        }
        if (Date.now() >= cleanupDeadline) {
          throw fixedError("ff029_cleanup_deadline_exhausted")
        }
      }
      const failures = []
      try {
        const state = await journal.snapshot()
        const trackedEmails = new Set(
          state.trackedEmails.map(requireCanaryEmail),
        )
        const trackedUserIds = new Set(
          state.trackedUserIds.filter((id) => UUID_PATTERN.test(id)),
        )
        try {
          const discovered = await listTrackedUserIds(
            adminClient,
            trackedEmails,
            requireCleanupTime,
          )
          for (const id of discovered) trackedUserIds.add(id)
        } catch (error) {
          failures.push(error)
        }
        for (const userId of trackedUserIds) {
          try {
            const trackedUser = await trackedUserForDeletion(
              adminClient,
              userId,
              trackedEmails,
              requireCleanupTime,
            )
            if (trackedUser === null) continue
            requireCleanupTime()
            const response = await adminClient.auth.admin.deleteUser(userId)
            if (
              response.error &&
              !isExactSupabaseUserNotFound(response.error)
            ) {
              throw categorizedError(
                "ff029_user_cleanup_failed",
                response.error,
              )
            }
          } catch (error) {
            if (!isExactSupabaseUserNotFound(error)) {
              failures.push(error)
            }
          }
        }
        if (trackedEmails.size > 0) {
          try {
            requireCleanupTime()
            await mailbox.deleteTrackedMessages(trackedEmails, {
              cleanupDeadline,
              signal: cleanupSignal,
            })
          } catch (error) {
            failures.push(error)
          }
        }
        try {
          const remainingUsers = await listTrackedUserIds(
            adminClient,
            trackedEmails,
            requireCleanupTime,
          )
          if (remainingUsers.size > 0) {
            failures.push(fixedError("ff029_hosted_user_cleanup_incomplete"))
          }
        } catch (error) {
          failures.push(error)
        }
        for (const userId of trackedUserIds) {
          try {
            await proveTrackedUserIdAbsent(
              adminClient,
              userId,
              requireCleanupTime,
            )
          } catch (error) {
            failures.push(error)
          }
        }
        if (trackedEmails.size > 0) {
          try {
            const remainingMessages = await mailbox.countTrackedMessages(
              trackedEmails,
              { cleanupDeadline, signal: cleanupSignal },
            )
            if (remainingMessages > 0) {
              failures.push(fixedError("ff029_ethereal_cleanup_incomplete"))
            }
          } catch (error) {
            failures.push(error)
          }
        }
      } finally {
        try {
          await mailbox.close({
            cleanupDeadline,
            signal: cleanupSignal,
          })
        } catch (error) {
          failures.push(error)
        }
      }
      try {
        assertNoUnsettledOperations()
      } catch (error) {
        failures.push(error)
      }
      if (failures.length === 0 && !retainRecoveryState) {
        try {
          await journal.complete()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "ff029_hosted_cleanup_failed")
      }
    },
  })
}

export function validHostedSourceRevision(value) {
  return typeof value === "string" && REVISION_PATTERN.test(value)
}
