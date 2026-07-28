import { randomBytes } from "node:crypto"

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9._~-]{32,384}$/
const MAILPIT_POLL_INTERVAL_MILLISECONDS = 100
const MAILPIT_POLL_TIMEOUT_MILLISECONDS = 5_000
const LOCAL_EMAIL_RATE_LIMIT_MARGIN_MILLISECONDS = 1_100
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 5_000
const DEFAULT_OPERATION_TIMEOUT_MILLISECONDS = 15_000
const DEFAULT_TOTAL_BUDGET_MILLISECONDS = 240_000
const DEFAULT_CLEANUP_BUDGET_MILLISECONDS = 60_000
const DEFAULT_CLEANUP_ABORT_JOIN_MILLISECONDS = 5_000
const AUTH_VERSION_PATTERN =
  /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9][A-Za-z0-9.-]{0,47})?$/
const CLI_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,47})?$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const REVISION_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const HOSTED_STAGING_PROJECT_REF = "destjwstohzmufshfnuy"

const FLOW_REDIRECT_PATHS = Object.freeze({
  advocate_proof_a: "/advocate-invitation",
  advocate_proof_b: "/advocate-invitation",
  existing_account_claim: "/auth/confirm?next=%2Fsponsor%2Fclaim",
  generic_sign_in: "/auth/confirm?next=%2Fapp",
  initial_sponsor_claim: "/auth/confirm?next=%2Fsponsor%2Fclaim",
  recent_action_reauthentication: "/auth/confirm?next=%2Fapp",
})

function scenario(options) {
  return Object.freeze({
    id: options.id,
    pairId: options.pairId ?? options.id,
    accountState: options.accountState,
    issuanceMode: options.issuanceMode ?? "sequential",
    flows: Object.freeze([...options.flows]),
    consumptionOrder: Object.freeze([...(options.consumptionOrder ?? [])]),
    expiryOutcome: options.expiryOutcome ?? null,
    trial: options.trial ?? null,
  })
}

const SUPERSESSION_PAIRS = Object.freeze([
  {
    pairId: "new_initial_claim_then_advocate_a",
    accountState: "new",
    flows: ["initial_sponsor_claim", "advocate_proof_a"],
  },
  {
    pairId: "new_advocate_a_then_initial_claim",
    accountState: "new",
    flows: ["advocate_proof_a", "initial_sponsor_claim"],
  },
  {
    pairId: "existing_claim_then_advocate_a",
    accountState: "existing",
    flows: ["existing_account_claim", "advocate_proof_a"],
  },
  {
    pairId: "existing_advocate_a_then_claim",
    accountState: "existing",
    flows: ["advocate_proof_a", "existing_account_claim"],
  },
  {
    pairId: "existing_generic_sign_in_then_advocate_a",
    accountState: "existing",
    flows: ["generic_sign_in", "advocate_proof_a"],
  },
  {
    pairId: "existing_advocate_a_then_generic_sign_in",
    accountState: "existing",
    flows: ["advocate_proof_a", "generic_sign_in"],
  },
  {
    pairId: "existing_reauthentication_then_advocate_a",
    accountState: "existing",
    flows: ["recent_action_reauthentication", "advocate_proof_a"],
  },
  {
    pairId: "existing_advocate_a_then_reauthentication",
    accountState: "existing",
    flows: ["advocate_proof_a", "recent_action_reauthentication"],
  },
  {
    pairId: "existing_advocate_a_then_advocate_b",
    accountState: "existing",
    flows: ["advocate_proof_a", "advocate_proof_b"],
  },
  {
    pairId: "existing_advocate_b_then_advocate_a",
    accountState: "existing",
    flows: ["advocate_proof_b", "advocate_proof_a"],
  },
  {
    pairId: "new_advocate_a_then_advocate_b",
    accountState: "new",
    flows: ["advocate_proof_a", "advocate_proof_b"],
  },
  {
    pairId: "new_advocate_b_then_advocate_a",
    accountState: "new",
    flows: ["advocate_proof_b", "advocate_proof_a"],
  },
  {
    pairId: "existing_advocate_a_and_b_concurrent",
    accountState: "existing",
    issuanceMode: "concurrent",
    flows: ["advocate_proof_a", "advocate_proof_b"],
  },
  {
    pairId: "new_advocate_a_and_b_concurrent",
    accountState: "new",
    issuanceMode: "concurrent",
    flows: ["advocate_proof_a", "advocate_proof_b"],
  },
  {
    pairId: "new_advocate_a_and_initial_claim_concurrent",
    accountState: "new",
    issuanceMode: "concurrent",
    flows: ["advocate_proof_a", "initial_sponsor_claim"],
  },
  {
    pairId: "new_initial_claim_and_advocate_a_concurrent",
    accountState: "new",
    issuanceMode: "concurrent",
    flows: ["initial_sponsor_claim", "advocate_proof_a"],
  },
  {
    pairId: "existing_advocate_a_and_claim_concurrent",
    accountState: "existing",
    issuanceMode: "concurrent",
    flows: ["advocate_proof_a", "existing_account_claim"],
  },
  {
    pairId: "existing_claim_and_advocate_a_concurrent",
    accountState: "existing",
    issuanceMode: "concurrent",
    flows: ["existing_account_claim", "advocate_proof_a"],
  },
  {
    pairId: "existing_advocate_a_and_reauthentication_concurrent",
    accountState: "existing",
    issuanceMode: "concurrent",
    flows: ["advocate_proof_a", "recent_action_reauthentication"],
  },
  {
    pairId: "existing_reauthentication_and_advocate_a_concurrent",
    accountState: "existing",
    issuanceMode: "concurrent",
    flows: ["recent_action_reauthentication", "advocate_proof_a"],
  },
  {
    pairId: "existing_advocate_a_resend",
    accountState: "existing",
    flows: ["advocate_proof_a", "advocate_proof_a"],
  },
  {
    pairId: "new_advocate_a_resend",
    accountState: "new",
    flows: ["advocate_proof_a", "advocate_proof_a"],
  },
  {
    pairId: "existing_generic_sign_in_resend",
    accountState: "existing",
    flows: ["generic_sign_in", "generic_sign_in"],
  },
  {
    pairId: "new_initial_sponsor_claim_resend",
    accountState: "new",
    flows: ["initial_sponsor_claim", "initial_sponsor_claim"],
  },
  {
    pairId: "existing_account_claim_resend",
    accountState: "existing",
    flows: ["existing_account_claim", "existing_account_claim"],
  },
  {
    pairId: "existing_recent_action_reauthentication_resend",
    accountState: "existing",
    flows: ["recent_action_reauthentication", "recent_action_reauthentication"],
  },
])

const CONSUMPTION_ORDERS = Object.freeze([
  Object.freeze({ label: "first_then_second", indexes: Object.freeze([0, 1]) }),
  Object.freeze({ label: "second_then_first", indexes: Object.freeze([1, 0]) }),
])
const CONCURRENT_TRIALS = Object.freeze([1, 2, 3])

export const FF029_EMAIL_PROOF_SUPERSESSION_MATRIX = Object.freeze([
  ...SUPERSESSION_PAIRS.flatMap((pair) =>
    (pair.issuanceMode === "concurrent" ? CONCURRENT_TRIALS : [null]).flatMap(
      (trial) =>
        CONSUMPTION_ORDERS.map((consumptionOrder) =>
          scenario({
            ...pair,
            id: `${pair.pairId}${trial === null ? "" : `_trial_${trial}`}_consume_${consumptionOrder.label}`,
            consumptionOrder: consumptionOrder.indexes,
            trial,
          }),
        ),
    ),
  ),
  scenario({
    id: "new_advocate_signup_proof_standalone",
    accountState: "new",
    flows: ["advocate_proof_a"],
    consumptionOrder: [0],
  }),
  scenario({
    id: "local_expiry_observation",
    accountState: "existing",
    issuanceMode: "not_exercised",
    flows: [],
    consumptionOrder: [],
    expiryOutcome: "not_exercised",
  }),
])

const CONSUMPTION_OUTCOMES = new Set(["accepted", "provider_error", "rejected"])
const ISSUANCE_OUTCOMES = new Set([
  "issued",
  "issued_email",
  "issued_magiclink",
  "issued_signup",
  "provider_error",
])
const SUCCESSFUL_ISSUANCE_OUTCOMES = new Set([
  "issued",
  "issued_email",
  "issued_magiclink",
  "issued_signup",
])
const FAILURE_CATEGORIES = new Set([
  "email_rate_limited",
  "harness_failure",
  "none",
  "not_exercised",
  "rate_limited",
  "timeout",
  "unexpected_failure",
  "unknown_provider_failure",
])
const PROVIDER_FAILURE_CATEGORIES = new Set([
  "email_rate_limited",
  "rate_limited",
  "timeout",
  "unexpected_failure",
  "unknown_provider_failure",
])
const ERROR_FAILURE_CATEGORIES = new Set([
  ...PROVIDER_FAILURE_CATEGORIES,
  "harness_failure",
])

function fixedError(code, cause) {
  return new Error(code, cause === undefined ? undefined : { cause })
}

function exclusiveOwnershipError(code, cause) {
  const error = fixedError(code, cause)
  Object.defineProperty(error, "ff029RetainExclusiveOwnership", {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  return error
}

function cleanupUnsettledError() {
  return exclusiveOwnershipError("ff029_cleanup_unsettled_after_abort")
}

export function requiresFf029ExclusiveOwnershipRetention(error) {
  const visited = new Set()
  function inspect(candidate, depth) {
    if (!isObject(candidate) || depth > 8 || visited.has(candidate)) {
      return false
    }
    visited.add(candidate)
    if (candidate.ff029RetainExclusiveOwnership === true) return true
    if (inspect(candidate.cause, depth + 1)) return true
    const nestedErrors = Array.isArray(candidate.errors)
      ? candidate.errors
      : candidate instanceof AggregateError
        ? [...candidate.errors]
        : []
    return nestedErrors.some((nested) => inspect(nested, depth + 1))
  }
  return inspect(error, 0)
}

function categorizedError(code, failureCategory, cause) {
  if (!ERROR_FAILURE_CATEGORIES.has(failureCategory)) {
    throw fixedError("ff029_failure_category_invalid")
  }
  const error = fixedError(code, cause)
  Object.defineProperty(error, "ff029FailureCategory", {
    configurable: false,
    enumerable: false,
    value: failureCategory,
    writable: false,
  })
  return error
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function providerFailureCategory(error, visited, depth) {
  if (!isObject(error) || depth > 4 || visited.has(error)) return null
  visited.add(error)
  if (PROVIDER_FAILURE_CATEGORIES.has(error.ff029FailureCategory)) {
    return error.ff029FailureCategory
  }
  if (error.code === "unexpected_failure") return "unexpected_failure"
  if (error.code === "over_email_send_rate_limit") {
    return "email_rate_limited"
  }
  if (error.code === "over_request_rate_limit" && error.status === 429) {
    return "rate_limited"
  }
  if (
    error.code === "request_timeout" ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    (error instanceof Error &&
      [
        "ff029_cleanup_timeout",
        "ff029_execution_budget_exhausted",
        "ff029_operation_timeout",
        "ff029_request_deadline_exhausted",
        "ff029_request_timeout",
      ].includes(error.message))
  ) {
    return "timeout"
  }
  return providerFailureCategory(error.cause, visited, depth + 1)
}

export function classifySupabaseProviderFailure(error) {
  return (
    providerFailureCategory(error, new Set(), 0) ?? "unknown_provider_failure"
  )
}

function harnessFailureCategory(error) {
  if (requiresFf029ExclusiveOwnershipRetention(error)) throw error
  if (
    isObject(error) &&
    ERROR_FAILURE_CATEGORIES.has(error.ff029FailureCategory)
  ) {
    return error.ff029FailureCategory
  }
  if (
    error instanceof Error &&
    [
      "ff029_execution_budget_exhausted",
      "ff029_operation_timeout",
      "ff029_request_deadline_exhausted",
      "ff029_request_timeout",
    ].includes(error.message)
  ) {
    return "timeout"
  }
  return "harness_failure"
}

function requireNonemptyString(value, code) {
  if (typeof value !== "string" || value.length === 0) {
    throw fixedError(code)
  }
  return value
}

function positiveDuration(value, fallback, code) {
  const duration = value ?? fallback
  if (!Number.isInteger(duration) || duration <= 0) {
    throw fixedError(code)
  }
  return duration
}

function combinedAbortSignal(first, second) {
  if (!(first instanceof AbortSignal) || !(second instanceof AbortSignal)) {
    throw fixedError("ff029_operation_signal_invalid")
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([first, second])
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  first.addEventListener("abort", abort, { once: true })
  second.addEventListener("abort", abort, { once: true })
  if (first.aborted || second.aborted) controller.abort()
  return controller.signal
}

async function withTimeout(
  operation,
  milliseconds,
  code,
  onTimeout,
  abortJoinMilliseconds = DEFAULT_CLEANUP_ABORT_JOIN_MILLISECONDS,
  cancellationSignal,
  recordJoin,
) {
  if (
    cancellationSignal !== undefined &&
    !(cancellationSignal instanceof AbortSignal)
  ) {
    throw fixedError("ff029_operation_signal_invalid")
  }
  const operationPromise = Promise.resolve().then(operation)
  const settledOperation = operationPromise.then(
    (value) => Object.freeze({ status: "completed", value }),
    (error) => Object.freeze({ status: "failed", error }),
  )
  let timeoutTimer
  let cancellationListener
  const interruption = new Promise((resolvePromise) => {
    let resolved = false
    const resolveOnce = (status) => {
      if (resolved) return
      resolved = true
      resolvePromise(Object.freeze({ status }))
    }
    timeoutTimer = setTimeout(() => resolveOnce("timed_out"), milliseconds)
    if (cancellationSignal) {
      cancellationListener = () => resolveOnce("cancelled")
      cancellationSignal.addEventListener("abort", cancellationListener, {
        once: true,
      })
      if (cancellationSignal.aborted) resolveOnce("cancelled")
    }
  })
  const first = await Promise.race([settledOperation, interruption])
  const interruptedAt = Date.now()
  clearTimeout(timeoutTimer)
  if (cancellationListener) {
    cancellationSignal.removeEventListener("abort", cancellationListener)
  }
  if (first.status === "completed") return first.value
  if (first.status === "failed") throw first.error

  if (first.status === "timed_out") {
    try {
      onTimeout?.()
    } catch {}
  }
  let joinTimer
  const joinTimeout = new Promise((resolvePromise) => {
    joinTimer = setTimeout(
      () => resolvePromise(Object.freeze({ status: "join_timed_out" })),
      Math.min(abortJoinMilliseconds, milliseconds),
    )
  })
  const joined = await Promise.race([settledOperation, joinTimeout])
  const joinResolvedAt = Date.now()
  clearTimeout(joinTimer)
  /**
   * Whether an interrupted operation was joined or abandoned is the one fact
   * that separates a correct ordering from an inverted one, and until now both
   * outcomes were erased before any test could see them. A joined operation
   * was flattened into a generic failure category, and an abandoned one was
   * out-ranked by an earlier sibling's rejection. This records the distinction
   * so a rare failure explains itself on infrastructure no debugger can reach.
   *
   * A recorder that throws must never change what the harness does, so its
   * failure is contained here.
   */
  try {
    recordJoin?.(
      Object.freeze({
        interruption: first.status,
        join: joined.status,
        joinedWithinBudget: joined.status !== "join_timed_out",
        // The effective budget, not the configured one. It is clamped against
        // the operation budget here and shrinks again as the execution budget
        // depletes, which the configured value alone would hide.
        effectiveJoinBudgetMilliseconds: Math.min(
          abortJoinMilliseconds,
          milliseconds,
        ),
        operationBudgetMilliseconds: milliseconds,
        interruptedAt,
        joinResolvedAt,
        joinWaitMilliseconds: joinResolvedAt - interruptedAt,
      }),
    )
  } catch {}
  if (joined.status === "join_timed_out") {
    void operationPromise.catch(() => {})
    throw exclusiveOwnershipError("ff029_operation_unsettled_after_abort")
  }
  throw fixedError(
    first.status === "cancelled" ? "ff029_operation_cancelled" : code,
  )
}

export function createSupabaseProofDispatchBarrier(participantCount) {
  if (
    !Number.isInteger(participantCount) ||
    participantCount < 1 ||
    participantCount > 8
  ) {
    throw fixedError("ff029_dispatch_barrier_invalid")
  }
  let arrivals = 0
  let failure = null
  let released = false
  const waiters = []
  return Object.freeze({
    async wait() {
      if (failure) throw failure
      if (released) return
      arrivals += 1
      if (arrivals > participantCount) {
        throw fixedError("ff029_dispatch_barrier_overflow")
      }
      if (arrivals === participantCount) {
        released = true
        for (const waiter of waiters) waiter.resolve()
        waiters.length = 0
        return
      }
      await new Promise((resolvePromise, rejectPromise) => {
        waiters.push({ resolve: resolvePromise, reject: rejectPromise })
      })
    },
    fail() {
      if (released || failure) return
      failure = categorizedError(
        "ff029_dispatch_barrier_failed",
        "harness_failure",
      )
      for (const waiter of waiters) waiter.reject(failure)
      waiters.length = 0
    },
  })
}

function parseLoopbackHttpUrl(value, label) {
  let url
  try {
    url = new URL(value)
  } catch (error) {
    throw fixedError(`${label}_invalid`, error)
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw fixedError(`${label}_not_loopback`)
  }
  return url
}

export function requireLoopbackHttpOrigin(value, label = "endpoint") {
  const url = parseLoopbackHttpUrl(value, label)
  if (url.pathname !== "/" || url.search !== "") {
    throw fixedError(`${label}_not_loopback`)
  }
  return url.origin
}

function requestUrl(input, label) {
  if (
    typeof input !== "string" &&
    !(input instanceof URL) &&
    typeof input?.url !== "string"
  ) {
    throw fixedError(`${label}_invalid`)
  }
  return parseLoopbackHttpUrl(
    typeof input === "string" || input instanceof URL ? input : input.url,
    label,
  )
}

export function createRedirectRefusingLoopbackFetch(
  fetchImplementation,
  allowedOrigins,
  options = {},
) {
  if (typeof fetchImplementation !== "function") {
    throw fixedError("ff029_fetch_unavailable")
  }
  const normalizedAllowedOrigins = new Set(
    allowedOrigins.map((origin) =>
      requireLoopbackHttpOrigin(origin, "ff029_allowed_origin"),
    ),
  )
  if (normalizedAllowedOrigins.size === 0) {
    throw fixedError("ff029_allowed_origin_missing")
  }
  const requestTimeoutMilliseconds = positiveDuration(
    options.requestTimeoutMilliseconds,
    DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
    "ff029_request_timeout_invalid",
  )
  return async (input, init) => {
    const url = requestUrl(input, "ff029_request_url")
    if (!normalizedAllowedOrigins.has(url.origin)) {
      throw fixedError("ff029_request_origin_not_allowed")
    }
    const timeoutController = new AbortController()
    const absoluteDeadline = options.absoluteDeadline?.()
    const remainingMilliseconds =
      absoluteDeadline === undefined
        ? requestTimeoutMilliseconds
        : absoluteDeadline - Date.now()
    if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0) {
      throw fixedError("ff029_request_deadline_exhausted")
    }
    const activeSignal = options.activeSignal?.()
    if (activeSignal?.aborted) {
      throw fixedError("ff029_request_cancelled")
    }
    const requestSignal =
      typeof AbortSignal.any === "function"
        ? AbortSignal.any(
            [init?.signal, activeSignal, timeoutController.signal].filter(
              Boolean,
            ),
          )
        : timeoutController.signal
    const response = await withTimeout(
      () =>
        fetchImplementation(input, {
          ...init,
          redirect: "error",
          signal: requestSignal,
        }),
      Math.min(requestTimeoutMilliseconds, remainingMilliseconds),
      "ff029_request_timeout",
      () => timeoutController.abort(),
    )
    if (
      !response ||
      response.redirected === true ||
      (Number.isInteger(response.status) &&
        response.status >= 300 &&
        response.status < 400)
    ) {
      throw fixedError("ff029_redirect_refused")
    }
    if (typeof response.url === "string" && response.url.length > 0) {
      const responseUrl = requestUrl(response.url, "ff029_response_url")
      if (!normalizedAllowedOrigins.has(responseUrl.origin)) {
        throw fixedError("ff029_response_origin_not_allowed")
      }
    }
    return response
  }
}

const AUTHENTICATION_METHOD_OUTCOMES = new Set([
  "email",
  "magiclink",
  "not_available",
  "not_exercised",
  "other",
  "otp",
  "provider_error",
  "signup",
])
const SCENARIO_EVIDENCE_KEYS = Object.freeze([
  "account_state",
  "consumption_order",
  "execution",
  "expiry_outcome",
  "first_authentication_method",
  "first_consumption",
  "first_failure_category",
  "first_flow",
  "first_issuance",
  "id",
  "issuance_mode",
  "pair_id",
  "second_authentication_method",
  "second_consumption",
  "second_failure_category",
  "second_flow",
  "second_issuance",
  "trial",
])
const PROVENANCE_KEYS = Object.freeze([
  "auth_version",
  "cli_version",
  "completed_at",
  "config_digest",
  "execution_time_milliseconds",
  "harness_digest",
  "repo_revision",
  "started_at",
])
const RAW_REPORT_KEYS = Object.freeze(["cleanup", "provenance", "scenarios"])
const SANITIZED_REPORT_KEYS = Object.freeze([
  "cleanup",
  "ff029_status",
  "hosted_evidence_required",
  "local_observation",
  "provenance",
  "scenario_count",
  "scenarios",
  "schema_version",
  "scope",
])
const SANITIZED_HOSTED_REPORT_KEYS = Object.freeze([
  "cleanup",
  "ff029_status",
  "hosted_observation",
  "project_ref",
  "provenance",
  "scenario_count",
  "scenarios",
  "schema_version",
  "scope",
])
const HOSTED_EXPIRY_RESULT_KEYS = Object.freeze([
  "authenticationMethod",
  "failureCategory",
  "outcome",
])
const HOSTED_EXPIRY_EVIDENCE_OUTCOMES = new Set(["provider_error", "rejected"])

const LOCAL_V3_EVIDENCE_PROFILE = Object.freeze({
  name: "local_v3",
  schemaVersion: 3,
})
const HOSTED_V4_EVIDENCE_PROFILE = Object.freeze({
  name: "hosted_v4",
  schemaVersion: 4,
  projectRef: HOSTED_STAGING_PROJECT_REF,
})

function resolveEvidenceProfile(value) {
  if (value === undefined || value === LOCAL_V3_EVIDENCE_PROFILE.name) {
    return LOCAL_V3_EVIDENCE_PROFILE
  }
  if (value === HOSTED_V4_EVIDENCE_PROFILE.name) {
    return HOSTED_V4_EVIDENCE_PROFILE
  }
  throw fixedError("ff029_evidence_profile_invalid")
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) return false
  const actualKeys = Object.keys(value).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  )
}

function consumptionOrderLabel(definition) {
  if (definition.consumptionOrder.length === 0) return "not_exercised"
  if (definition.consumptionOrder.length === 1) return "first_only"
  return definition.consumptionOrder[0] === 0
    ? "first_then_second"
    : "second_then_first"
}

function safeScenarioEvidence(
  definition,
  issuanceOutcomes,
  consumptionOutcomes,
  authenticationMethods,
  failureCategories,
  execution,
  expiryOutcome = definition.expiryOutcome,
) {
  return Object.freeze({
    id: definition.id,
    pair_id: definition.pairId,
    account_state: definition.accountState,
    issuance_mode: definition.issuanceMode,
    consumption_order: consumptionOrderLabel(definition),
    first_flow: definition.flows[0] ?? null,
    second_flow: definition.flows[1] ?? null,
    first_issuance: issuanceOutcomes[0] ?? "not_exercised",
    second_issuance: issuanceOutcomes[1] ?? "not_exercised",
    first_consumption: consumptionOutcomes[0] ?? "not_exercised",
    second_consumption: consumptionOutcomes[1] ?? "not_exercised",
    first_failure_category: failureCategories[0] ?? "not_exercised",
    second_failure_category: failureCategories[1] ?? "not_exercised",
    first_authentication_method: authenticationMethods[0] ?? "not_exercised",
    second_authentication_method: authenticationMethods[1] ?? "not_exercised",
    expiry_outcome: expiryOutcome,
    trial: definition.trial,
    execution,
  })
}

function assertCoherentScenarioEvidence(
  candidate,
  definition,
  evidenceProfile,
) {
  if (!hasExactKeys(candidate, SCENARIO_EVIDENCE_KEYS)) {
    throw fixedError("ff029_evidence_shape_invalid")
  }
  const isHostedExpiryObservation =
    evidenceProfile === HOSTED_V4_EVIDENCE_PROFILE &&
    definition.id === "local_expiry_observation"
  if (
    candidate.id !== definition.id ||
    candidate.pair_id !== definition.pairId ||
    candidate.account_state !== definition.accountState ||
    candidate.issuance_mode !== definition.issuanceMode ||
    candidate.consumption_order !== consumptionOrderLabel(definition) ||
    candidate.first_flow !== (definition.flows[0] ?? null) ||
    candidate.second_flow !== (definition.flows[1] ?? null) ||
    (!isHostedExpiryObservation &&
      candidate.expiry_outcome !== definition.expiryOutcome) ||
    candidate.trial !== definition.trial
  ) {
    throw fixedError("ff029_evidence_definition_mismatch")
  }

  const proofOutcomes = [
    {
      present: definition.flows.length >= 1,
      issuance: candidate.first_issuance,
      consumption: candidate.first_consumption,
      authenticationMethod: candidate.first_authentication_method,
      failureCategory: candidate.first_failure_category,
    },
    {
      present: definition.flows.length >= 2,
      issuance: candidate.second_issuance,
      consumption: candidate.second_consumption,
      authenticationMethod: candidate.second_authentication_method,
      failureCategory: candidate.second_failure_category,
    },
  ]

  if (isHostedExpiryObservation) {
    const hasOnlyUnexercisedProofOutcomes = proofOutcomes.every(
      ({ issuance, consumption, authenticationMethod, failureCategory }) =>
        issuance === "not_exercised" &&
        consumption === "not_exercised" &&
        authenticationMethod === "not_exercised" &&
        failureCategory === "not_exercised",
    )
    if (
      !hasOnlyUnexercisedProofOutcomes ||
      !HOSTED_EXPIRY_EVIDENCE_OUTCOMES.has(candidate.expiry_outcome)
    ) {
      throw fixedError("ff029_evidence_outcome_invalid")
    }
    const expectedExecution =
      candidate.expiry_outcome === "rejected" ? "observed" : "provider_error"
    if (candidate.execution !== expectedExecution) {
      throw fixedError("ff029_evidence_outcome_incoherent")
    }
    return
  }

  if (definition.expiryOutcome === "not_exercised") {
    const hasOnlyUnexercisedOutcomes = proofOutcomes.every(
      ({ issuance, consumption, authenticationMethod, failureCategory }) =>
        issuance === "not_exercised" &&
        consumption === "not_exercised" &&
        authenticationMethod === "not_exercised" &&
        failureCategory === "not_exercised",
    )
    if (
      !hasOnlyUnexercisedOutcomes ||
      candidate.execution !== "not_exercised"
    ) {
      throw fixedError("ff029_evidence_outcome_incoherent")
    }
    return
  }

  let hasProviderError = false
  for (const outcome of proofOutcomes) {
    if (!outcome.present) {
      if (
        outcome.issuance !== "not_exercised" ||
        outcome.consumption !== "not_exercised" ||
        outcome.authenticationMethod !== "not_exercised" ||
        outcome.failureCategory !== "not_exercised"
      ) {
        throw fixedError("ff029_evidence_outcome_incoherent")
      }
      continue
    }
    if (
      !ISSUANCE_OUTCOMES.has(outcome.issuance) ||
      !CONSUMPTION_OUTCOMES.has(outcome.consumption) ||
      !AUTHENTICATION_METHOD_OUTCOMES.has(outcome.authenticationMethod) ||
      !FAILURE_CATEGORIES.has(outcome.failureCategory) ||
      outcome.authenticationMethod === "not_exercised"
    ) {
      throw fixedError("ff029_evidence_outcome_invalid")
    }
    if (
      (outcome.consumption === "provider_error") !==
        (outcome.authenticationMethod === "provider_error") ||
      (outcome.consumption === "rejected" &&
        outcome.authenticationMethod !== "not_available")
    ) {
      throw fixedError("ff029_evidence_outcome_incoherent")
    }
    const hasProofProviderError =
      outcome.issuance === "provider_error" ||
      outcome.consumption === "provider_error"
    if (
      (hasProofProviderError &&
        (outcome.failureCategory === "none" ||
          outcome.failureCategory === "not_exercised")) ||
      (!hasProofProviderError && outcome.failureCategory !== "none")
    ) {
      throw fixedError("ff029_evidence_outcome_incoherent")
    }
    hasProviderError ||=
      outcome.issuance === "provider_error" ||
      outcome.consumption === "provider_error" ||
      outcome.authenticationMethod === "provider_error"
  }
  if (
    (candidate.execution === "provider_error") !== hasProviderError ||
    (candidate.execution !== "observed" &&
      candidate.execution !== "provider_error")
  ) {
    throw fixedError("ff029_evidence_outcome_incoherent")
  }
}

function safeVersion(value, pattern) {
  return typeof value === "string" && pattern.test(value)
    ? value
    : "not_available"
}

function safeDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value)
    ? value
    : "not_available"
}

function safeRevision(value) {
  return typeof value === "string" &&
    REVISION_PATTERN.test(value) &&
    !/^0+$/.test(value)
    ? value
    : "not_available"
}

function safeExecutionTime(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 86_400_000
    ? value
    : 0
}

function safeRfc3339Timestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return "not_available"
  }
  try {
    return new Date(value).toISOString() === value ? value : "not_available"
  } catch {
    return "not_available"
  }
}

function safeProvenance(value) {
  return Object.freeze({
    execution_time_milliseconds: safeExecutionTime(
      value?.execution_time_milliseconds,
    ),
    started_at: safeRfc3339Timestamp(value?.started_at),
    completed_at: safeRfc3339Timestamp(value?.completed_at),
    auth_version: safeVersion(value?.auth_version, AUTH_VERSION_PATTERN),
    cli_version: safeVersion(value?.cli_version, CLI_VERSION_PATTERN),
    config_digest: safeDigest(value?.config_digest),
    repo_revision: safeRevision(value?.repo_revision),
    harness_digest: safeDigest(value?.harness_digest),
  })
}

function assertCoherentProvenance(candidate, expected) {
  if (!hasExactKeys(candidate, PROVENANCE_KEYS)) {
    throw fixedError("ff029_evidence_provenance_invalid")
  }
  for (const key of PROVENANCE_KEYS) {
    if (candidate[key] !== expected[key]) {
      throw fixedError("ff029_evidence_report_incoherent")
    }
  }
  if (
    expected.started_at !== "not_available" &&
    expected.completed_at !== "not_available" &&
    Date.parse(expected.completed_at) - Date.parse(expected.started_at) !==
      expected.execution_time_milliseconds
  ) {
    throw fixedError("ff029_evidence_provenance_invalid")
  }
}

function hasCompleteCoherentProvenance(provenance) {
  return Boolean(
    provenance.auth_version !== "not_available" &&
    provenance.cli_version !== "not_available" &&
    provenance.config_digest !== "not_available" &&
    provenance.harness_digest !== "not_available" &&
    provenance.repo_revision !== "not_available" &&
    provenance.started_at !== "not_available" &&
    provenance.completed_at !== "not_available" &&
    Date.parse(provenance.completed_at) - Date.parse(provenance.started_at) ===
      provenance.execution_time_milliseconds,
  )
}

/**
 * @typedef {object} SanitizedEvidenceReport
 * @property {3 | 4} schema_version
 * @property {"local_mechanics_only" | "hosted_staging"} scope
 * @property {"destjwstohzmufshfnuy"} [project_ref]
 * @property {"open"} ff029_status
 * @property {true} [hosted_evidence_required]
 * @property {"observed" | "incomplete"} [local_observation]
 * @property {"observed" | "incomplete"} [hosted_observation]
 * @property {"completed" | "failed"} cleanup
 * @property {Readonly<ReturnType<typeof safeProvenance>>} provenance
 * @property {number} scenario_count
 * @property {ReadonlyArray<ReturnType<typeof safeScenarioEvidence>>} scenarios
 */

/**
 * @param {any} report
 * @param {"local_v3" | "hosted_v4"} [requestedProfile]
 * @returns {SanitizedEvidenceReport}
 */
function sanitizeReport(report, requestedProfile) {
  const evidenceProfile =
    requestedProfile === undefined &&
    hasExactKeys(report, SANITIZED_HOSTED_REPORT_KEYS)
      ? HOSTED_V4_EVIDENCE_PROFILE
      : resolveEvidenceProfile(requestedProfile)
  const rawShape = hasExactKeys(report, RAW_REPORT_KEYS)
  const sanitizedShape = hasExactKeys(report, SANITIZED_REPORT_KEYS)
  const sanitizedHostedShape = hasExactKeys(
    report,
    SANITIZED_HOSTED_REPORT_KEYS,
  )
  const expectedSanitizedShape =
    evidenceProfile === HOSTED_V4_EVIDENCE_PROFILE
      ? sanitizedHostedShape
      : sanitizedShape
  if (!rawShape && !expectedSanitizedShape) {
    throw fixedError("ff029_evidence_shape_invalid")
  }
  if (!Array.isArray(report.scenarios)) {
    throw fixedError("ff029_evidence_matrix_incomplete")
  }
  if (
    report.scenarios.length !== FF029_EMAIL_PROOF_SUPERSESSION_MATRIX.length
  ) {
    throw fixedError("ff029_evidence_matrix_incomplete")
  }
  const scenariosById = new Map()
  for (const candidate of report.scenarios) {
    const definition = FF029_EMAIL_PROOF_SUPERSESSION_MATRIX.find(
      (entry) => entry.id === candidate?.id,
    )
    if (!definition || scenariosById.has(definition.id)) {
      throw fixedError("ff029_evidence_scenario_invalid")
    }
    assertCoherentScenarioEvidence(candidate, definition, evidenceProfile)
    scenariosById.set(definition.id, candidate)
  }
  const scenarios = FF029_EMAIL_PROOF_SUPERSESSION_MATRIX.map((definition) => {
    const candidate = scenariosById.get(definition.id)
    if (!candidate) throw fixedError("ff029_evidence_matrix_incomplete")
    return safeScenarioEvidence(
      definition,
      [candidate.first_issuance, candidate.second_issuance],
      [candidate.first_consumption, candidate.second_consumption],
      [
        candidate.first_authentication_method,
        candidate.second_authentication_method,
      ],
      [candidate.first_failure_category, candidate.second_failure_category],
      candidate.execution,
      evidenceProfile === HOSTED_V4_EVIDENCE_PROFILE &&
        definition.id === "local_expiry_observation"
        ? candidate.expiry_outcome
        : definition.expiryOutcome,
    )
  })
  const cleanup = report.cleanup === "completed" ? "completed" : "failed"
  const provenance = safeProvenance(report.provenance)
  const allObserved =
    evidenceProfile === HOSTED_V4_EVIDENCE_PROFILE
      ? scenarios.every((candidate) => candidate.execution === "observed")
      : scenarios.every(
          (candidate) =>
            candidate.execution === "observed" ||
            (candidate.id === "local_expiry_observation" &&
              candidate.execution === "not_exercised"),
        )
  const provenanceComplete = hasCompleteCoherentProvenance(provenance)
  if (evidenceProfile === HOSTED_V4_EVIDENCE_PROFILE) {
    const sanitized = Object.freeze({
      schema_version: evidenceProfile.schemaVersion,
      scope: "hosted_staging",
      project_ref: evidenceProfile.projectRef,
      ff029_status: "open",
      hosted_observation:
        allObserved && cleanup === "completed" && provenanceComplete
          ? "observed"
          : "incomplete",
      cleanup,
      provenance,
      scenario_count: scenarios.length,
      scenarios: Object.freeze(scenarios),
    })
    if (
      sanitizedHostedShape &&
      (report.schema_version !== sanitized.schema_version ||
        report.scope !== sanitized.scope ||
        report.project_ref !== sanitized.project_ref ||
        report.ff029_status !== sanitized.ff029_status ||
        report.hosted_observation !== sanitized.hosted_observation ||
        report.cleanup !== sanitized.cleanup ||
        report.scenario_count !== sanitized.scenario_count)
    ) {
      throw fixedError("ff029_evidence_report_incoherent")
    }
    if (sanitizedHostedShape) {
      assertCoherentProvenance(report.provenance, provenance)
    }
    return sanitized
  }
  const sanitized = Object.freeze({
    schema_version: 3,
    scope: "local_mechanics_only",
    ff029_status: "open",
    hosted_evidence_required: true,
    local_observation:
      allObserved && cleanup === "completed" && provenanceComplete
        ? "observed"
        : "incomplete",
    cleanup,
    provenance,
    scenario_count: scenarios.length,
    scenarios: Object.freeze(scenarios),
  })
  if (
    sanitizedShape &&
    (report.schema_version !== sanitized.schema_version ||
      report.scope !== sanitized.scope ||
      report.ff029_status !== sanitized.ff029_status ||
      report.hosted_evidence_required !== sanitized.hosted_evidence_required ||
      report.local_observation !== sanitized.local_observation ||
      report.cleanup !== sanitized.cleanup ||
      report.scenario_count !== sanitized.scenario_count)
  ) {
    throw fixedError("ff029_evidence_report_incoherent")
  }
  if (sanitizedShape) {
    assertCoherentProvenance(report.provenance, provenance)
  }
  return sanitized
}

export function serializeSupabaseEmailProofSupersessionEvidence(report) {
  return `${JSON.stringify(sanitizeReport(report))}\n`
}

async function consumeProof(
  adapter,
  context,
  proof,
  callWithinExecutionBudget,
) {
  try {
    const result = await callWithinExecutionBudget((lifecycle) =>
      adapter.consumeProof(context, proof, lifecycle),
    )
    const outcome = typeof result === "string" ? result : result?.outcome
    const authenticationMethod =
      typeof result === "string"
        ? outcome === "provider_error"
          ? "provider_error"
          : "not_available"
        : result?.authenticationMethod
    const failureCategory =
      typeof result === "string"
        ? outcome === "provider_error"
          ? "unknown_provider_failure"
          : "none"
        : result?.failureCategory
    if (
      !CONSUMPTION_OUTCOMES.has(outcome) ||
      !AUTHENTICATION_METHOD_OUTCOMES.has(authenticationMethod) ||
      !FAILURE_CATEGORIES.has(failureCategory) ||
      (outcome === "provider_error" &&
        (failureCategory === "none" || failureCategory === "not_exercised")) ||
      (outcome !== "provider_error" && failureCategory !== "none")
    ) {
      return {
        outcome: "provider_error",
        authenticationMethod: "provider_error",
        failureCategory: "harness_failure",
      }
    }
    return { outcome, authenticationMethod, failureCategory }
  } catch (error) {
    return {
      outcome: "provider_error",
      authenticationMethod: "provider_error",
      failureCategory: harnessFailureCategory(error),
    }
  }
}

async function issueProof(
  adapter,
  context,
  flow,
  callWithinExecutionBudget,
  dispatchBarrier,
) {
  try {
    const proof = await callWithinExecutionBudget((lifecycle) =>
      adapter.issueProof(context, flow, lifecycle, dispatchBarrier),
    )
    if (!isObject(proof)) {
      dispatchBarrier.fail()
      return {
        proof: null,
        issuanceOutcome: "provider_error",
        failureCategory: "harness_failure",
      }
    }
    const issuanceOutcome = proof.issuanceOutcome ?? "issued"
    if (!SUCCESSFUL_ISSUANCE_OUTCOMES.has(issuanceOutcome)) {
      dispatchBarrier.fail()
      return {
        proof: null,
        issuanceOutcome: "provider_error",
        failureCategory: "harness_failure",
      }
    }
    return {
      proof,
      issuanceOutcome,
      failureCategory: "none",
    }
  } catch (error) {
    dispatchBarrier.fail()
    return {
      proof: null,
      issuanceOutcome: "provider_error",
      failureCategory: harnessFailureCategory(error),
    }
  }
}

async function issueConcurrentProofGroup(
  adapter,
  context,
  definition,
  callWithinExecutionBudget,
) {
  const groupController = new AbortController()
  const groupCallWithinExecutionBudget = (operation) =>
    callWithinExecutionBudget(operation, groupController.signal)
  const dispatchBarrier = createSupabaseProofDispatchBarrier(
    definition.flows.length,
  )
  const siblings = definition.flows.map((flow) =>
    issueProof(
      adapter,
      context,
      flow,
      groupCallWithinExecutionBudget,
      dispatchBarrier,
    ).catch((error) => {
      groupController.abort(error)
      throw error
    }),
  )
  const settledSiblings = await Promise.allSettled(siblings)
  const rejectedSiblings = settledSiblings.filter(
    (candidate) => candidate.status === "rejected",
  )
  const rejectedSibling =
    rejectedSiblings.find(
      (candidate) =>
        candidate.status === "rejected" &&
        requiresFf029ExclusiveOwnershipRetention(candidate.reason),
    ) ?? rejectedSiblings[0]
  if (rejectedSibling?.status === "rejected") {
    throw rejectedSibling.reason
  }
  return settledSiblings.map((candidate) => candidate.value)
}

async function exerciseScenario(
  adapter,
  definition,
  callWithinExecutionBudget,
  evidenceProfile,
) {
  if (definition.expiryOutcome === "not_exercised") {
    if (evidenceProfile === HOSTED_V4_EVIDENCE_PROFILE) {
      try {
        const context = await callWithinExecutionBudget((lifecycle) =>
          adapter.prepareScenario(definition, lifecycle),
        )
        const issuance = await issueProof(
          adapter,
          context,
          "generic_sign_in",
          callWithinExecutionBudget,
          createSupabaseProofDispatchBarrier(1),
        )
        if (issuance.proof === null) {
          throw fixedError("ff029_expiry_issuance_failed")
        }
        const result = await callWithinExecutionBudget((lifecycle) =>
          adapter.observeExpiry(context, issuance.proof, lifecycle),
        )
        if (
          !hasExactKeys(result, HOSTED_EXPIRY_RESULT_KEYS) ||
          result.outcome !== "rejected" ||
          result.authenticationMethod !== "not_available" ||
          result.failureCategory !== "none"
        ) {
          throw fixedError("ff029_expiry_observation_invalid")
        }
        return safeScenarioEvidence(
          definition,
          ["not_exercised", "not_exercised"],
          ["not_exercised", "not_exercised"],
          ["not_exercised", "not_exercised"],
          ["not_exercised", "not_exercised"],
          "observed",
          result.outcome,
        )
      } catch (error) {
        if (requiresFf029ExclusiveOwnershipRetention(error)) throw error
        return safeScenarioEvidence(
          definition,
          ["not_exercised", "not_exercised"],
          ["not_exercised", "not_exercised"],
          ["not_exercised", "not_exercised"],
          ["not_exercised", "not_exercised"],
          "provider_error",
          "provider_error",
        )
      }
    }
    return safeScenarioEvidence(
      definition,
      ["not_exercised", "not_exercised"],
      ["not_exercised", "not_exercised"],
      ["not_exercised", "not_exercised"],
      ["not_exercised", "not_exercised"],
      "not_exercised",
    )
  }

  try {
    const context = await callWithinExecutionBudget((lifecycle) =>
      adapter.prepareScenario(definition, lifecycle),
    )
    const issuanceResults =
      definition.issuanceMode === "concurrent"
        ? await issueConcurrentProofGroup(
            adapter,
            context,
            definition,
            callWithinExecutionBudget,
          )
        : await definition.flows.reduce(async (resultsPromise, flow) => {
            const resultsSoFar = await resultsPromise
            return [
              ...resultsSoFar,
              await issueProof(
                adapter,
                context,
                flow,
                callWithinExecutionBudget,
                createSupabaseProofDispatchBarrier(1),
              ),
            ]
          }, Promise.resolve([]))
    const issuanceOutcomes = issuanceResults.map(
      (result) => result.issuanceOutcome,
    )
    const consumptionResults = Array(definition.flows.length).fill(null)
    for (const proofIndex of definition.consumptionOrder) {
      const proof = issuanceResults[proofIndex]?.proof
      consumptionResults[proofIndex] =
        proof === null || proof === undefined
          ? {
              outcome: "provider_error",
              authenticationMethod: "provider_error",
              failureCategory:
                issuanceResults[proofIndex]?.failureCategory ??
                "harness_failure",
            }
          : await consumeProof(
              adapter,
              context,
              proof,
              callWithinExecutionBudget,
            )
    }
    const consumptionOutcomes = consumptionResults.map(
      (result) => result?.outcome ?? "provider_error",
    )
    const authenticationMethods = consumptionResults.map(
      (result) => result?.authenticationMethod ?? "provider_error",
    )
    const failureCategories = consumptionResults.map((result, proofIndex) =>
      issuanceOutcomes[proofIndex] === "provider_error"
        ? (issuanceResults[proofIndex]?.failureCategory ?? "harness_failure")
        : (result?.failureCategory ?? "harness_failure"),
    )
    const execution =
      issuanceOutcomes.includes("provider_error") ||
      consumptionOutcomes.includes("provider_error") ||
      authenticationMethods.includes("provider_error")
        ? "provider_error"
        : "observed"
    return safeScenarioEvidence(
      definition,
      issuanceOutcomes,
      consumptionOutcomes,
      authenticationMethods,
      failureCategories,
      execution,
    )
  } catch (error) {
    return providerErrorScenarioEvidence(
      definition,
      harnessFailureCategory(error),
    )
  }
}

function providerErrorScenarioEvidence(
  definition,
  failureCategory = "harness_failure",
) {
  const providerErrorByProofPosition = [0, 1].map((proofIndex) =>
    proofIndex < definition.flows.length ? "provider_error" : "not_exercised",
  )
  return safeScenarioEvidence(
    definition,
    providerErrorByProofPosition,
    providerErrorByProofPosition,
    providerErrorByProofPosition,
    [0, 1].map((proofIndex) =>
      proofIndex < definition.flows.length ? failureCategory : "not_exercised",
    ),
    "provider_error",
  )
}

export async function runFf029CleanupWithAbortAndJoin(
  adapter,
  initialized,
  cleanupBudgetMilliseconds,
  cleanupAbortJoinMilliseconds,
  absoluteTotalDeadline,
  options = {},
) {
  const cleanupController = new AbortController()
  const cleanupStartedAt = Date.now()
  const requestedCleanupDeadline = cleanupStartedAt + cleanupBudgetMilliseconds
  const cleanupDeadline = Number.isSafeInteger(absoluteTotalDeadline)
    ? Math.min(requestedCleanupDeadline, absoluteTotalDeadline)
    : requestedCleanupDeadline
  const remainingCleanupMilliseconds = cleanupDeadline - cleanupStartedAt
  if (remainingCleanupMilliseconds <= 0) {
    return Object.freeze({
      status: "failed",
      error: fixedError("ff029_cleanup_timeout"),
    })
  }
  const cleanupPromise = Promise.resolve().then(() =>
    adapter.cleanup({
      initialized,
      cleanupDeadline,
      retainRecoveryState: options.retainRecoveryState === true,
      signal: cleanupController.signal,
    }),
  )
  const settledCleanup = cleanupPromise.then(
    () => Object.freeze({ status: "completed" }),
    (error) => Object.freeze({ status: "failed", error }),
  )
  let cleanupTimer
  const timedOut = new Promise((resolvePromise) => {
    cleanupTimer = setTimeout(
      () => resolvePromise(Object.freeze({ status: "timed_out" })),
      remainingCleanupMilliseconds,
    )
  })
  const first = await Promise.race([settledCleanup, timedOut])
  clearTimeout(cleanupTimer)
  if (first.status !== "timed_out") {
    if (
      first.status === "failed" &&
      requiresFf029ExclusiveOwnershipRetention(first.error)
    ) {
      throw first.error
    }
    return first
  }

  cleanupController.abort(fixedError("ff029_cleanup_timeout"))
  let joinTimer
  const joinTimedOut = new Promise((resolvePromise) => {
    joinTimer = setTimeout(
      () => resolvePromise(Object.freeze({ status: "join_timed_out" })),
      cleanupAbortJoinMilliseconds,
    )
  })
  const joined = await Promise.race([settledCleanup, joinTimedOut])
  clearTimeout(joinTimer)
  if (joined.status === "join_timed_out") {
    void cleanupPromise.catch(() => {})
    throw cleanupUnsettledError()
  }
  if (
    joined.status === "failed" &&
    requiresFf029ExclusiveOwnershipRetention(joined.error)
  ) {
    throw joined.error
  }
  return Object.freeze({
    status: "failed",
    error: fixedError("ff029_cleanup_timeout"),
  })
}

export async function runSupabaseEmailProofSupersessionCanary(
  adapter,
  options = {},
) {
  const startedAt = Date.now()
  const evidenceProfile = resolveEvidenceProfile(options.evidenceProfile)
  const operationTimeoutMilliseconds = positiveDuration(
    options.operationTimeoutMilliseconds,
    DEFAULT_OPERATION_TIMEOUT_MILLISECONDS,
    "ff029_operation_timeout_invalid",
  )
  const totalBudgetMilliseconds = positiveDuration(
    options.totalBudgetMilliseconds,
    DEFAULT_TOTAL_BUDGET_MILLISECONDS,
    "ff029_total_budget_invalid",
  )
  const cleanupBudgetMilliseconds = positiveDuration(
    options.cleanupBudgetMilliseconds,
    DEFAULT_CLEANUP_BUDGET_MILLISECONDS,
    "ff029_cleanup_budget_invalid",
  )
  const cleanupAbortJoinMilliseconds = positiveDuration(
    options.cleanupAbortJoinMilliseconds,
    DEFAULT_CLEANUP_ABORT_JOIN_MILLISECONDS,
    "ff029_cleanup_abort_join_invalid",
  )
  if (cleanupBudgetMilliseconds >= totalBudgetMilliseconds) {
    throw fixedError("ff029_cleanup_reserve_invalid")
  }
  const requestedTotalDeadline = startedAt + totalBudgetMilliseconds
  const absoluteTotalDeadline =
    options.absoluteExecutionDeadline ?? options.absoluteTotalDeadline
  if (
    absoluteTotalDeadline !== undefined &&
    (!Number.isSafeInteger(absoluteTotalDeadline) ||
      absoluteTotalDeadline <= startedAt)
  ) {
    throw fixedError("ff029_absolute_total_deadline_invalid")
  }
  const totalDeadline =
    absoluteTotalDeadline === undefined
      ? requestedTotalDeadline
      : Math.min(requestedTotalDeadline, absoluteTotalDeadline)
  if (totalDeadline - startedAt <= cleanupBudgetMilliseconds) {
    throw fixedError("ff029_cleanup_reserve_invalid")
  }
  const executionDeadline = totalDeadline - cleanupBudgetMilliseconds
  const executionController = new AbortController()
  const callWithinExecutionBudget = (operation, cancellationSignal) => {
    if (
      cancellationSignal !== undefined &&
      !(cancellationSignal instanceof AbortSignal)
    ) {
      throw fixedError("ff029_operation_signal_invalid")
    }
    const remainingMilliseconds = executionDeadline - Date.now()
    if (remainingMilliseconds <= 2) {
      throw fixedError("ff029_execution_budget_exhausted")
    }
    const abortJoinMilliseconds = Math.max(
      1,
      Math.min(
        cleanupAbortJoinMilliseconds,
        Math.floor(remainingMilliseconds / 2),
      ),
    )
    const operationBudgetMilliseconds = Math.max(
      1,
      Math.min(
        operationTimeoutMilliseconds,
        remainingMilliseconds - abortJoinMilliseconds,
      ),
    )
    const operationSignal =
      cancellationSignal === undefined
        ? executionController.signal
        : combinedAbortSignal(executionController.signal, cancellationSignal)
    return withTimeout(
      () =>
        operation({
          executionDeadline,
          signal: operationSignal,
        }),
      operationBudgetMilliseconds,
      "ff029_operation_timeout",
      () => executionController.abort(),
      abortJoinMilliseconds,
      operationSignal,
      options.recordOperationJoin,
    )
  }
  const scenarios = []
  let initialized = false
  let cleanup = "completed"
  let authVersion = options.provenance?.auth_version
  let terminalFailureCategory = "harness_failure"
  let retainedOwnershipError = null
  try {
    const initialization = await callWithinExecutionBudget((lifecycle) =>
      adapter.initialize(lifecycle),
    )
    initialized = true
    if (AUTH_VERSION_PATTERN.test(initialization?.authVersion ?? "")) {
      authVersion = initialization.authVersion
    }
    if (
      evidenceProfile === HOSTED_V4_EVIDENCE_PROFILE &&
      initialization?.projectRef !== evidenceProfile.projectRef
    ) {
      throw fixedError("ff029_hosted_project_ref_invalid")
    }
    for (const definition of FF029_EMAIL_PROOF_SUPERSESSION_MATRIX) {
      if (Date.now() >= executionDeadline) break
      scenarios.push(
        await exerciseScenario(
          adapter,
          definition,
          callWithinExecutionBudget,
          evidenceProfile,
        ),
      )
    }
  } catch (error) {
    if (requiresFf029ExclusiveOwnershipRetention(error)) {
      retainedOwnershipError = error
    } else {
      terminalFailureCategory = harnessFailureCategory(error)
    }
  } finally {
    executionController.abort()
    try {
      adapter.assertNoUnsettledOperations?.()
    } catch (error) {
      if (requiresFf029ExclusiveOwnershipRetention(error)) {
        retainedOwnershipError = error
      } else {
        throw error
      }
    }
    const cleanupResult = await runFf029CleanupWithAbortAndJoin(
      adapter,
      initialized,
      cleanupBudgetMilliseconds,
      cleanupAbortJoinMilliseconds,
      totalDeadline,
      { retainRecoveryState: retainedOwnershipError !== null },
    )
    if (cleanupResult.status !== "completed") {
      cleanup = "failed"
    }
    try {
      adapter.assertNoUnsettledOperations?.()
    } catch (error) {
      if (requiresFf029ExclusiveOwnershipRetention(error)) {
        retainedOwnershipError ??= error
      } else {
        throw error
      }
    }
    if (retainedOwnershipError !== null) throw retainedOwnershipError
  }
  for (
    let scenarioIndex = scenarios.length;
    scenarioIndex < FF029_EMAIL_PROOF_SUPERSESSION_MATRIX.length;
    scenarioIndex += 1
  ) {
    const definition = FF029_EMAIL_PROOF_SUPERSESSION_MATRIX[scenarioIndex]
    scenarios.push(
      definition.expiryOutcome === "not_exercised" &&
        evidenceProfile !== HOSTED_V4_EVIDENCE_PROFILE
        ? safeScenarioEvidence(
            definition,
            ["not_exercised", "not_exercised"],
            ["not_exercised", "not_exercised"],
            ["not_exercised", "not_exercised"],
            ["not_exercised", "not_exercised"],
            "not_exercised",
          )
        : definition.expiryOutcome === "not_exercised"
          ? safeScenarioEvidence(
              definition,
              ["not_exercised", "not_exercised"],
              ["not_exercised", "not_exercised"],
              ["not_exercised", "not_exercised"],
              ["not_exercised", "not_exercised"],
              "provider_error",
              "provider_error",
            )
          : providerErrorScenarioEvidence(
              definition,
              Date.now() >= executionDeadline
                ? "timeout"
                : terminalFailureCategory,
            ),
    )
  }
  const completedAt = Date.now()
  return sanitizeReport(
    {
      cleanup,
      scenarios,
      provenance: {
        ...options.provenance,
        auth_version: authVersion,
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date(completedAt).toISOString(),
        execution_time_milliseconds: completedAt - startedAt,
      },
    },
    evidenceProfile.name,
  )
}

function recipientAddresses(message) {
  if (!Array.isArray(message?.To)) return []
  return message.To.flatMap((recipient) =>
    typeof recipient?.Address === "string"
      ? [recipient.Address.toLowerCase()]
      : [],
  )
}

function sleep(milliseconds, signal) {
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
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      resolvePromise()
    }, milliseconds)
    signal?.addEventListener("abort", abort, { once: true })
  })
}

function createCanaryEmail() {
  return `creator-share-ff029-${randomBytes(16).toString("hex")}@example.com`
}

function redirectForFlow(flow, applicationOrigin) {
  const path = FLOW_REDIRECT_PATHS[flow]
  if (typeof path !== "string") throw fixedError("ff029_flow_invalid")
  return `${applicationOrigin}${path}`
}

async function requireOk(response, code) {
  if (!response?.ok) throw fixedError(code)
  return response
}

async function mailpitMessages(
  fetchImplementation,
  mailpitOrigin,
  beforeRequest = () => {},
) {
  const messages = []
  let expectedTotal = null
  for (let start = 0, page = 0; page < 100; page += 1) {
    beforeRequest()
    const response = await requireOk(
      await fetchImplementation(
        `${mailpitOrigin}/api/v1/messages?start=${start}&limit=1000`,
        { cache: "no-store" },
      ),
      "ff029_mailpit_list_unavailable",
    )
    let body
    try {
      body = await response.json()
    } catch (error) {
      throw fixedError("ff029_mailpit_list_invalid", error)
    }
    if (
      !Array.isArray(body?.messages) ||
      !Number.isInteger(body?.total) ||
      body.total < 0 ||
      body.total > 100_000 ||
      body.start !== start ||
      body.count !== body.messages.length ||
      (expectedTotal !== null && body.total !== expectedTotal)
    ) {
      throw fixedError("ff029_mailpit_list_invalid")
    }
    expectedTotal ??= body.total
    messages.push(...body.messages)
    if (messages.length === expectedTotal) return messages
    if (
      messages.length > expectedTotal ||
      body.messages.length === 0 ||
      body.messages.length > 1000
    ) {
      throw fixedError("ff029_mailpit_list_invalid")
    }
    start = messages.length
  }
  throw fixedError("ff029_mailpit_list_incomplete")
}

async function deleteMailpitMessages(
  fetchImplementation,
  mailpitOrigin,
  messageIds,
) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    throw fixedError("ff029_mailpit_message_ids_invalid")
  }
  for (const messageId of messageIds) {
    if (
      typeof messageId !== "string" ||
      messageId.length === 0 ||
      messageId.length > 512
    ) {
      throw fixedError("ff029_mailpit_message_id_invalid")
    }
  }
  await requireOk(
    await fetchImplementation(`${mailpitOrigin}/api/v1/messages`, {
      method: "DELETE",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: messageIds }),
    }),
    "ff029_mailpit_cleanup_failed",
  )
}

function trackedMailpitMessageIds(messages, trackedEmails) {
  const messageIds = new Set()
  for (const message of messages) {
    if (
      !recipientAddresses(message).some((address) => trackedEmails.has(address))
    ) {
      continue
    }
    if (
      typeof message?.ID !== "string" ||
      message.ID.length === 0 ||
      message.ID.length > 512
    ) {
      throw fixedError("ff029_mailpit_message_id_invalid")
    }
    messageIds.add(message.ID)
  }
  return messageIds
}

async function countTrackedMailpitMessages(
  fetchImplementation,
  mailpitOrigin,
  trackedEmails,
  beforeRequest = () => {},
) {
  const messages = await mailpitMessages(
    fetchImplementation,
    mailpitOrigin,
    beforeRequest,
  )
  return trackedMailpitMessageIds(messages, trackedEmails).size
}

async function latestNewMessage(
  fetchImplementation,
  mailpitOrigin,
  email,
  priorIds,
  lifecycle,
  requireExecutionTime,
) {
  const deadline = Date.now() + MAILPIT_POLL_TIMEOUT_MILLISECONDS
  while (Date.now() < deadline) {
    requireExecutionTime(lifecycle)
    const messages = await mailpitMessages(
      fetchImplementation,
      mailpitOrigin,
      () => requireExecutionTime(lifecycle),
    )
    const candidate = messages.find(
      (message) =>
        typeof message?.ID === "string" &&
        !priorIds.has(message.ID) &&
        recipientAddresses(message).includes(email.toLowerCase()),
    )
    if (candidate) return candidate.ID
    await sleep(MAILPIT_POLL_INTERVAL_MILLISECONDS, lifecycle.signal)
  }
  throw fixedError("ff029_mailpit_delivery_unavailable")
}

async function proofFromMailpitMessage(
  fetchImplementation,
  mailpitOrigin,
  messageId,
) {
  const response = await requireOk(
    await fetchImplementation(
      `${mailpitOrigin}/api/v1/message/${encodeURIComponent(messageId)}`,
      { cache: "no-store" },
    ),
    "ff029_mailpit_message_unavailable",
  )
  let body
  try {
    body = await response.json()
  } catch (error) {
    throw fixedError("ff029_mailpit_message_invalid", error)
  }
  if (typeof body?.HTML !== "string") {
    throw fixedError("ff029_mailpit_message_invalid")
  }
  const href = body.HTML.match(/href="([^"]+)"/)?.[1]
  if (!href) throw fixedError("ff029_mailpit_link_missing")
  let link
  try {
    link = new URL(href.replaceAll("&amp;", "&"))
  } catch (error) {
    throw fixedError("ff029_mailpit_link_invalid", error)
  }
  const tokenHash = new URLSearchParams(link.hash.slice(1)).get("token_hash")
  if (!tokenHash || !TOKEN_HASH_PATTERN.test(tokenHash)) {
    throw fixedError("ff029_mailpit_proof_invalid")
  }
  return tokenHash
}

async function listTrackedUserIds(
  adminClient,
  trackedEmails,
  beforeRequest = () => {},
) {
  const userIds = new Set()
  let complete = false
  for (let page = 1; page <= 100; page += 1) {
    beforeRequest()
    const response = await adminClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (response.error || !Array.isArray(response.data?.users)) {
      throw fixedError("ff029_user_cleanup_discovery_failed")
    }
    for (const user of response.data.users) {
      if (
        typeof user?.email === "string" &&
        trackedEmails.has(user.email.toLowerCase()) &&
        typeof user.id === "string" &&
        UUID_PATTERN.test(user.id)
      ) {
        userIds.add(user.id)
      }
    }
    if (response.data.users.length < 1000) {
      complete = true
      break
    }
  }
  if (!complete) throw fixedError("ff029_user_cleanup_discovery_incomplete")
  return userIds
}

function accessTokenClaims(accessToken) {
  if (typeof accessToken !== "string") return "provider_error"
  const segments = accessToken.split(".")
  if (segments.length !== 3) return "provider_error"
  try {
    const claims = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    )
    return isObject(claims) ? claims : "provider_error"
  } catch {
    return "provider_error"
  }
}

function authenticationMethodFromAccessToken(accessToken) {
  const claims = accessTokenClaims(accessToken)
  if (claims === "provider_error") return "provider_error"
  if (!Array.isArray(claims?.amr) || claims.amr.length === 0) {
    return "not_available"
  }
  const methods = claims.amr.flatMap((candidate) =>
    typeof candidate?.method === "string" ? [candidate.method] : [],
  )
  for (const method of ["magiclink", "otp", "signup", "email"]) {
    if (methods.includes(method)) return method
  }
  return methods.length > 0 ? "other" : "not_available"
}

export function classifySupabaseProofVerificationError(error) {
  return isObject(error) && error.code === "otp_expired" && error.status === 403
    ? "rejected"
    : "provider_error"
}

function confirmedEmailTimestamp(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  )
}

/**
 * @param {unknown} data
 * @param {string} scenarioEmail
 * @param {string | null} proofUserId
 */
export function verifiedIdentityMatchesScenario(
  data,
  scenarioEmail,
  proofUserId = null,
) {
  if (
    typeof scenarioEmail !== "string" ||
    scenarioEmail !== scenarioEmail.toLowerCase() ||
    scenarioEmail.length === 0
  ) {
    return false
  }
  const user = data?.user
  const sessionUser = data?.session?.user
  const claims = accessTokenClaims(data?.session?.access_token)
  const userId = user?.id
  const confirmedAt = user?.email_confirmed_at
  return Boolean(
    UUID_PATTERN.test(userId ?? "") &&
    sessionUser?.id === userId &&
    (proofUserId === null || proofUserId === userId) &&
    user?.email === scenarioEmail &&
    sessionUser?.email === scenarioEmail &&
    confirmedEmailTimestamp(confirmedAt) &&
    sessionUser?.email_confirmed_at === confirmedAt &&
    claims !== "provider_error" &&
    claims?.sub === userId &&
    claims?.email === scenarioEmail,
  )
}

export async function createLocalSupabaseEmailProofAdapter(options) {
  const supabaseOrigin = requireLoopbackHttpOrigin(
    options.supabaseUrl,
    "ff029_supabase_url",
  )
  const mailpitOrigin = requireLoopbackHttpOrigin(
    options.mailpitUrl,
    "ff029_mailpit_url",
  )
  const applicationOrigin = requireLoopbackHttpOrigin(
    options.applicationOrigin ?? "http://localhost:3000",
    "ff029_application_origin",
  )
  const anonKey = requireNonemptyString(
    options.anonKey,
    "ff029_anon_key_missing",
  )
  const serviceRoleKey = requireNonemptyString(
    options.serviceRoleKey,
    "ff029_service_role_key_missing",
  )
  if (anonKey === serviceRoleKey) {
    throw fixedError("ff029_local_keys_not_distinct")
  }
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch
  if (typeof fetchImplementation !== "function") {
    throw fixedError("ff029_fetch_unavailable")
  }
  const requestTimeoutMilliseconds = positiveDuration(
    options.requestTimeoutMilliseconds,
    DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
    "ff029_request_timeout_invalid",
  )
  let cleanupDeadline
  let cleanupSignal
  let executionDeadline
  let executionSignal
  const activeDeadline = () => cleanupDeadline ?? executionDeadline
  const activeSignal = () =>
    cleanupDeadline === undefined ? executionSignal : cleanupSignal
  const supabaseFetch = createRedirectRefusingLoopbackFetch(
    fetchImplementation,
    [supabaseOrigin],
    {
      requestTimeoutMilliseconds,
      absoluteDeadline: activeDeadline,
      activeSignal,
    },
  )
  const mailpitFetch = createRedirectRefusingLoopbackFetch(
    fetchImplementation,
    [mailpitOrigin],
    {
      requestTimeoutMilliseconds,
      absoluteDeadline: activeDeadline,
      activeSignal,
    },
  )
  const createClientImplementation =
    options.createClientImplementation ??
    (await import("@supabase/supabase-js")).createClient
  const clientOptions = {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: supabaseFetch },
  }
  const adminClient = createClientImplementation(
    supabaseOrigin,
    serviceRoleKey,
    clientOptions,
  )
  const trackedEmails = new Set()
  const trackedUserIds = new Set()
  const contexts = new Set()

  function requireExecutionTime(lifecycle) {
    if (
      !Number.isSafeInteger(lifecycle?.executionDeadline) ||
      lifecycle.executionDeadline <= Date.now() ||
      !(lifecycle.signal instanceof AbortSignal) ||
      lifecycle.signal.aborted
    ) {
      throw fixedError("ff029_execution_lifecycle_invalid")
    }
    executionDeadline = lifecycle.executionDeadline
    executionSignal = lifecycle.signal
  }

  async function waitForLocalEmailWindow(context, lifecycle) {
    const elapsed = Date.now() - context.lastIssuedAt
    if (elapsed < LOCAL_EMAIL_RATE_LIMIT_MARGIN_MILLISECONDS) {
      await sleep(
        LOCAL_EMAIL_RATE_LIMIT_MARGIN_MILLISECONDS - elapsed,
        lifecycle.signal,
      )
    }
    requireExecutionTime(lifecycle)
  }

  return Object.freeze({
    async initialize(lifecycle) {
      requireExecutionTime(lifecycle)
      const response = await requireOk(
        await supabaseFetch(`${supabaseOrigin}/auth/v1/health`, {
          cache: "no-store",
        }),
        "ff029_auth_health_unavailable",
      )
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
      return { authVersion: health.version }
    },
    async prepareScenario(definition, lifecycle) {
      requireExecutionTime(lifecycle)
      const email = createCanaryEmail()
      trackedEmails.add(email)
      const context = { email, lastIssuedAt: 0 }
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
            classifySupabaseProviderFailure(error),
            error,
          )
        }
        if (response.error) {
          throw categorizedError(
            "ff029_existing_user_creation_failed",
            classifySupabaseProviderFailure(response.error),
            response.error,
          )
        }
        if (
          !response.data?.user ||
          !UUID_PATTERN.test(response.data.user.id) ||
          response.data.user.email !== email ||
          !confirmedEmailTimestamp(response.data.user.email_confirmed_at)
        ) {
          throw fixedError("ff029_existing_user_creation_failed")
        }
        requireExecutionTime(lifecycle)
        trackedUserIds.add(response.data.user.id)
      }
      return context
    },
    async issueProof(context, flow, lifecycle, dispatchBarrier) {
      requireExecutionTime(lifecycle)
      if (!contexts.has(context)) throw fixedError("ff029_context_invalid")
      if (typeof dispatchBarrier?.wait !== "function") {
        throw fixedError("ff029_dispatch_barrier_missing")
      }
      await waitForLocalEmailWindow(context, lifecycle)
      const redirectTo = redirectForFlow(flow, applicationOrigin)
      let proof
      if (flow === "advocate_proof_a" || flow === "advocate_proof_b") {
        await dispatchBarrier.wait()
        requireExecutionTime(lifecycle)
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
            classifySupabaseProviderFailure(error),
            error,
          )
        }
        if (response.error) {
          throw categorizedError(
            "ff029_advocate_proof_issuance_failed",
            classifySupabaseProviderFailure(response.error),
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
          (verificationType !== "magiclink" && verificationType !== "signup")
        ) {
          throw fixedError("ff029_advocate_proof_issuance_failed")
        }
        requireExecutionTime(lifecycle)
        trackedUserIds.add(userId)
        proof = {
          tokenHash,
          authType: verificationType,
          userId,
          expectedEmail: context.email,
          issuanceOutcome:
            verificationType === "magiclink"
              ? "issued_magiclink"
              : "issued_signup",
        }
      } else {
        const priorMessages = await mailpitMessages(
          mailpitFetch,
          mailpitOrigin,
          () => requireExecutionTime(lifecycle),
        )
        const priorIds = new Set(
          priorMessages.flatMap((message) =>
            typeof message?.ID === "string" ? [message.ID] : [],
          ),
        )
        const authClient = createClientImplementation(
          supabaseOrigin,
          anonKey,
          clientOptions,
        )
        await dispatchBarrier.wait()
        requireExecutionTime(lifecycle)
        let response
        try {
          response = await authClient.auth.signInWithOtp({
            email: context.email,
            options: {
              emailRedirectTo: redirectTo,
              shouldCreateUser: flow === "initial_sponsor_claim",
            },
          })
        } catch (error) {
          throw categorizedError(
            "ff029_sponsor_proof_issuance_unavailable",
            classifySupabaseProviderFailure(error),
            error,
          )
        }
        if (response.error) {
          throw categorizedError(
            "ff029_sponsor_proof_issuance_failed",
            classifySupabaseProviderFailure(response.error),
            response.error,
          )
        }
        requireExecutionTime(lifecycle)
        const messageId = await latestNewMessage(
          mailpitFetch,
          mailpitOrigin,
          context.email,
          priorIds,
          lifecycle,
          requireExecutionTime,
        )
        requireExecutionTime(lifecycle)
        const tokenHash = await proofFromMailpitMessage(
          mailpitFetch,
          mailpitOrigin,
          messageId,
        )
        requireExecutionTime(lifecycle)
        proof = {
          tokenHash,
          authType: "email",
          userId: null,
          expectedEmail: context.email,
          issuanceOutcome: "issued_email",
        }
      }
      context.lastIssuedAt = Date.now()
      return proof
    },
    async consumeProof(context, proof, lifecycle) {
      requireExecutionTime(lifecycle)
      if (
        !contexts.has(context) ||
        !isObject(proof) ||
        proof.expectedEmail !== context.email ||
        !TOKEN_HASH_PATTERN.test(proof.tokenHash ?? "") ||
        (proof.authType !== "email" &&
          proof.authType !== "magiclink" &&
          proof.authType !== "signup")
      ) {
        throw fixedError("ff029_proof_invalid")
      }
      const client = createClientImplementation(
        supabaseOrigin,
        anonKey,
        clientOptions,
      )
      let response
      try {
        response = await client.auth.verifyOtp({
          token_hash: proof.tokenHash,
          type: proof.authType,
        })
      } catch (error) {
        throw categorizedError(
          "ff029_proof_verification_unavailable",
          classifySupabaseProviderFailure(error),
          error,
        )
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
      trackedUserIds.add(userId)
      const authenticationMethod = authenticationMethodFromAccessToken(
        response.data.session?.access_token,
      )
      return {
        outcome:
          authenticationMethod === "provider_error"
            ? "provider_error"
            : "accepted",
        authenticationMethod,
        failureCategory:
          authenticationMethod === "provider_error"
            ? "unknown_provider_failure"
            : "none",
      }
    },
    async cleanup(options = {}) {
      if (
        !Number.isSafeInteger(options.cleanupDeadline) ||
        options.cleanupDeadline <= Date.now() ||
        (options.signal !== undefined &&
          !(options.signal instanceof AbortSignal))
      ) {
        throw fixedError("ff029_cleanup_deadline_invalid")
      }
      cleanupDeadline = options.cleanupDeadline
      cleanupSignal = options.signal
      const requireCleanupTime = () => {
        if (cleanupSignal?.aborted) {
          throw fixedError("ff029_operation_cancelled")
        }
        if (Date.now() >= cleanupDeadline) {
          throw fixedError("ff029_cleanup_deadline_exhausted")
        }
      }
      const cleanupFailures = []
      const recordCleanupFailure = (error) => {
        if (requiresFf029ExclusiveOwnershipRetention(error)) throw error
        requireCleanupTime()
        cleanupFailures.push(error)
      }
      try {
        const discoveredUserIds = await listTrackedUserIds(
          adminClient,
          trackedEmails,
          requireCleanupTime,
        )
        for (const userId of discoveredUserIds) trackedUserIds.add(userId)
      } catch (error) {
        recordCleanupFailure(error)
      }
      for (const userId of trackedUserIds) {
        try {
          requireCleanupTime()
          const response = await adminClient.auth.admin.deleteUser(userId)
          if (response.error) {
            recordCleanupFailure(fixedError("ff029_user_cleanup_failed"))
          }
        } catch (error) {
          recordCleanupFailure(fixedError("ff029_user_cleanup_failed", error))
        }
      }
      try {
        const messages = await mailpitMessages(
          mailpitFetch,
          mailpitOrigin,
          requireCleanupTime,
        )
        const messageIds = trackedMailpitMessageIds(messages, trackedEmails)
        if (messageIds.size > 0) {
          requireCleanupTime()
          await deleteMailpitMessages(mailpitFetch, mailpitOrigin, [
            ...messageIds,
          ])
        }
      } catch (error) {
        recordCleanupFailure(error)
      }
      try {
        const remainingUserIds = await listTrackedUserIds(
          adminClient,
          trackedEmails,
          requireCleanupTime,
        )
        if (remainingUserIds.size > 0) {
          recordCleanupFailure(fixedError("ff029_user_cleanup_incomplete"))
        }
      } catch (error) {
        recordCleanupFailure(error)
      }
      try {
        const remainingMessageCount = await countTrackedMailpitMessages(
          mailpitFetch,
          mailpitOrigin,
          trackedEmails,
          requireCleanupTime,
        )
        if (remainingMessageCount > 0) {
          recordCleanupFailure(fixedError("ff029_mailpit_cleanup_incomplete"))
        }
      } catch (error) {
        recordCleanupFailure(error)
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(cleanupFailures, "ff029_cleanup_failed")
      }
    },
  })
}

export function localSupabaseEmailProofCanaryExitCode(report) {
  const sanitized = sanitizeReport(report, LOCAL_V3_EVIDENCE_PROFILE.name)
  return sanitized.local_observation === "observed" ? 0 : 1
}
