import { execFile as execFileCallback } from "node:child_process"
import { spawn as spawnCallback } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises"
import { userInfo } from "node:os"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"

import {
  createHostedSupabaseEmailProofAdapter,
  FF029_HOSTED_APPLICATION_ORIGIN,
  FF029_HOSTED_PROJECT_REF,
  FF029_HOSTED_SUPABASE_ORIGIN,
  validHostedSourceRevision,
  validateHostedPacingAttestation,
  validateHostedSupabaseKey,
} from "./support/hosted-supabase-email-proof-adapter.mjs"
import {
  requiresFf029ExclusiveOwnershipRetention,
  runFf029CleanupWithAbortAndJoin,
  runSupabaseEmailProofSupersessionCanary,
  serializeSupabaseEmailProofSupersessionEvidence,
} from "./support/supabase-email-proof-supersession.mjs"
import {
  createEtherealImapMailbox,
  FF029_HOSTED_ETHEREAL_CLEANUP_QUIET_PERIOD_MILLISECONDS,
  readEtherealImapMailboxEnvironment,
} from "./support/ethereal-imap-mailbox.mjs"

const execFile = promisify(execFileCallback)
const EVIDENCE_RELATIVE_PATH =
  "test-results/provider/ff029-supabase-email-proof-supersession-hosted.json"
const DEFAULT_MACHINE_STATE_ROOT = resolve(
  userInfo().homedir,
  ".creator-share",
  "ff029",
  FF029_HOSTED_PROJECT_REF,
)
const CLEANUP_JOURNAL_FILENAME = "cleanup-journal.json"
const MAXIMUM_ENVIRONMENT_VALUE_BYTES = 16 * 1024
const MAXIMUM_PRIVATE_FILE_BYTES = 2 * 1024 * 1024
const MAXIMUM_LOCK_FILE_BYTES = 4 * 1024
const MAXIMUM_PROCESS_ID = 2_147_483_647
const LOCK_NONCE_PATTERN = /^[0-9a-f]{64}$/
const RUN_LOCK_KIND = "ff029_hosted_run_lock"
const RUN_LOCK_RECOVERY_KIND = "ff029_hosted_run_lock_recovery"
const RUN_LOCK_QUARANTINE_KIND = "ff029_hosted_run_lock_quarantine"
const RUN_LOCK_QUARANTINE_RECOVERY_KIND =
  "ff029_hosted_run_lock_quarantine_recovery"
export const FF029_HOSTED_QUARANTINE_RECOVERY_ATTESTATION =
  "I attest that all prior FF029 remote operations have settled and authorize bounded reconciliation."
const RUN_LOCK_KEYS = Object.freeze([
  "acquired_at",
  "kind",
  "nonce",
  "process_id",
  "project_ref",
  "schema_version",
])
const RUN_LOCK_QUARANTINE_KEYS = Object.freeze(
  [...RUN_LOCK_KEYS, "process_group_ids", "remote_operations_unsettled"].sort(),
)
const QUARANTINE_RECOVERY_AUTHORIZATION_KEYS = Object.freeze([
  "operatorAttestation",
  "quarantineNonce",
  "quietPeriodMilliseconds",
])
const QUARANTINE_RECOVERY_NONCE_ENVIRONMENT = "FF029_QUARANTINE_RECOVERY_NONCE"
const QUARANTINE_RECOVERY_ATTESTATION_ENVIRONMENT =
  "FF029_QUARANTINE_RECOVERY_ATTESTATION"
const QUARANTINE_RECOVERY_QUIET_PERIOD_ENVIRONMENT =
  "FF029_QUARANTINE_RECOVERY_QUIET_PERIOD_MILLISECONDS"
const MINIMUM_QUARANTINE_RECOVERY_QUIET_PERIOD_MILLISECONDS = 1_000
const MAXIMUM_QUARANTINE_RECOVERY_QUIET_PERIOD_MILLISECONDS = 60_000
const MANAGEMENT_ATTESTOR_COMMAND_ENVIRONMENT =
  "FF029_MANAGEMENT_ATTESTOR_COMMAND"
const MANAGEMENT_ATTESTOR_SHA256_ENVIRONMENT =
  "FF029_MANAGEMENT_ATTESTOR_SHA256"
const MANAGEMENT_ATTESTOR_MAXIMUM_OUTPUT_BYTES = 16 * 1024
const MANAGEMENT_ATTESTOR_MAXIMUM_FILE_BYTES = 2 * 1024 * 1024
const MANAGEMENT_ATTESTOR_TERMINATION_GRACE_MILLISECONDS = 1_000
const MANAGEMENT_ATTESTOR_PROCESS_GROUP_JOIN_MILLISECONDS = 5_000
const MANAGEMENT_ATTESTOR_PROCESS_GROUP_POLL_MILLISECONDS = 25
const FF029_SUPABASE_MANAGEMENT_ORIGIN = "https://api.supabase.com"
const MANAGEMENT_CONFIG_KEYS = Object.freeze([
  "mailer_otp_exp",
  "rate_limit_email_sent",
  "rate_limit_otp",
  "rate_limit_verify",
  "smtp_max_frequency",
])
const MANAGEMENT_OBSERVATION_KEYS = Object.freeze([
  "authentication",
  "config",
  "config_digest",
  "credential_source",
  "harness_digest",
  "http_status",
  "issued_at",
  "kind",
  "management_api_origin",
  "not_after",
  "observed_at",
  "operator_attestation_digest",
  "phase",
  "project_ref",
  "request_digest",
  "request_nonce",
  "run_nonce",
  "schema_version",
  "source_revision",
  "supabase_origin",
])
const MANAGEMENT_OBSERVATION_MAXIMUM_AGE_MILLISECONDS = 2 * 60 * 1_000
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CANARY_EMAIL_PATTERN = /^creator-share-ff029-[0-9a-f]{32}@example\.com$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,47})?$/
const RUNNER_PATH = fileURLToPath(import.meta.url)
const HARNESS_PATHS = Object.freeze([
  RUNNER_PATH,
  resolve(
    dirname(RUNNER_PATH),
    "support/hosted-supabase-email-proof-adapter.mjs",
  ),
  resolve(
    dirname(RUNNER_PATH),
    "support/supabase-email-proof-supersession.mjs",
  ),
  resolve(dirname(RUNNER_PATH), "support/ethereal-imap-mailbox.mjs"),
])

function fixedError(code, cause) {
  return new Error(code, cause === undefined ? undefined : { cause })
}

function exclusiveOwnershipError(code, cause, processGroupIds = []) {
  const error = fixedError(code, cause)
  Object.defineProperty(error, "ff029RetainExclusiveOwnership", {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  Object.defineProperty(error, "ff029ProcessGroupIds", {
    configurable: false,
    enumerable: false,
    value: Object.freeze([...new Set(processGroupIds)].sort((a, b) => a - b)),
    writable: false,
  })
  return error
}

function retainedProcessGroupIds(error, seen = new Set()) {
  if (
    error == null ||
    (typeof error !== "object" && typeof error !== "function") ||
    seen.has(error)
  ) {
    return []
  }
  seen.add(error)
  const processGroupIds = Array.isArray(error.ff029ProcessGroupIds)
    ? error.ff029ProcessGroupIds
    : []
  const nested = [
    error.cause,
    ...(Array.isArray(error.errors) ? error.errors : []),
  ]
  return [
    ...new Set([
      ...processGroupIds,
      ...nested.flatMap((candidate) =>
        retainedProcessGroupIds(candidate, seen),
      ),
    ]),
  ].sort((a, b) => a - b)
}

function canonicalJson(value) {
  function normalize(candidate) {
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return candidate
    }
    if (typeof candidate === "number") {
      if (!Number.isSafeInteger(candidate)) {
        throw fixedError("ff029_canonical_json_invalid")
      }
      return candidate
    }
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
      throw fixedError("ff029_canonical_json_invalid")
    }
    return Object.fromEntries(
      Object.keys(candidate)
        .sort()
        .map((key) => {
          if (candidate[key] === undefined) {
            throw fixedError("ff029_canonical_json_invalid")
          }
          return [key, normalize(candidate[key])]
        }),
    )
  }
  return JSON.stringify(normalize(value))
}

function sha256Json(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function requiredEnvironmentValue(environment, name, minimum, maximum) {
  const value = environment[name]
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < minimum ||
    Buffer.byteLength(value, "utf8") > maximum ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    throw fixedError(`ff029_environment_${name.toLowerCase()}_invalid`)
  }
  return value
}

function boundedDuration(environment, name, fallback, minimum, maximum) {
  const raw = environment[name]
  if (raw === undefined) return fallback
  if (!/^[0-9]{1,9}$/.test(raw)) {
    throw fixedError(`ff029_environment_${name.toLowerCase()}_invalid`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw fixedError(`ff029_environment_${name.toLowerCase()}_invalid`)
  }
  return value
}

function quarantineRecoveryAuthorizationFromEnvironment(environment) {
  const names = [
    QUARANTINE_RECOVERY_NONCE_ENVIRONMENT,
    QUARANTINE_RECOVERY_ATTESTATION_ENVIRONMENT,
    QUARANTINE_RECOVERY_QUIET_PERIOD_ENVIRONMENT,
  ]
  const present = names.filter((name) => environment[name] !== undefined)
  if (present.length === 0) return null
  if (present.length !== names.length) {
    throw fixedError("ff029_hosted_quarantine_recovery_authorization_invalid")
  }
  const quietPeriodSource = requiredEnvironmentValue(
    environment,
    QUARANTINE_RECOVERY_QUIET_PERIOD_ENVIRONMENT,
    1,
    9,
  )
  if (!/^[0-9]{1,9}$/.test(quietPeriodSource)) {
    throw fixedError("ff029_hosted_quarantine_recovery_authorization_invalid")
  }
  return Object.freeze({
    quarantineNonce: requiredEnvironmentValue(
      environment,
      QUARANTINE_RECOVERY_NONCE_ENVIRONMENT,
      64,
      64,
    ),
    operatorAttestation: requiredEnvironmentValue(
      environment,
      QUARANTINE_RECOVERY_ATTESTATION_ENVIRONMENT,
      FF029_HOSTED_QUARANTINE_RECOVERY_ATTESTATION.length,
      FF029_HOSTED_QUARANTINE_RECOVERY_ATTESTATION.length,
    ),
    quietPeriodMilliseconds: Number(quietPeriodSource),
  })
}

function parseAttestation(raw, nowMilliseconds) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw fixedError("ff029_environment_pacing_attestation_invalid", error)
  }
  validateHostedPacingAttestation(parsed, { nowMilliseconds })
  return Object.freeze(parsed)
}

export function readHostedSupabaseEmailProofEnvironment(
  environment = process.env,
  options = {},
) {
  const nowMilliseconds = options.nowMilliseconds ?? Date.now()
  const anonKey = requiredEnvironmentValue(
    environment,
    "FF029_HOSTED_SUPABASE_ANON_KEY",
    64,
    4_096,
  )
  const serviceRoleKey = requiredEnvironmentValue(
    environment,
    "FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY",
    64,
    4_096,
  )
  const sourceRevision = requiredEnvironmentValue(
    environment,
    "FF029_SOURCE_REVISION",
    40,
    40,
  )
  if (!validHostedSourceRevision(sourceRevision)) {
    throw fixedError("ff029_environment_source_revision_invalid")
  }
  const pacingAttestation = parseAttestation(
    requiredEnvironmentValue(
      environment,
      "FF029_HOSTED_PACING_ATTESTATION",
      2,
      MAXIMUM_ENVIRONMENT_VALUE_BYTES,
    ),
    nowMilliseconds,
  )
  const totalBudgetMilliseconds = boundedDuration(
    environment,
    "FF029_TOTAL_BUDGET_MILLISECONDS",
    180 * 60 * 1000,
    10 * 60 * 1000,
    3 * 60 * 60 * 1000,
  )
  const cleanupBudgetMilliseconds = boundedDuration(
    environment,
    "FF029_CLEANUP_BUDGET_MILLISECONDS",
    10 * 60 * 1000,
    60_000,
    30 * 60 * 1000,
  )
  const finalizationBudgetMilliseconds = boundedDuration(
    environment,
    "FF029_FINALIZATION_BUDGET_MILLISECONDS",
    2 * 60 * 1000,
    10_000,
    10 * 60 * 1000,
  )
  if (
    cleanupBudgetMilliseconds + finalizationBudgetMilliseconds >=
    totalBudgetMilliseconds
  ) {
    throw fixedError("ff029_environment_cleanup_reserve_invalid")
  }
  const absoluteTotalDeadline = nowMilliseconds + totalBudgetMilliseconds
  if (!Number.isSafeInteger(absoluteTotalDeadline)) {
    throw fixedError("ff029_environment_total_deadline_invalid")
  }
  validateHostedSupabaseKey(
    anonKey,
    "anon",
    nowMilliseconds,
    totalBudgetMilliseconds - cleanupBudgetMilliseconds,
  )
  validateHostedSupabaseKey(
    serviceRoleKey,
    "service_role",
    nowMilliseconds,
    totalBudgetMilliseconds,
  )
  if (anonKey === serviceRoleKey) {
    throw fixedError("ff029_environment_hosted_keys_not_distinct")
  }
  const normalizedAttestation = validateHostedPacingAttestation(
    pacingAttestation,
    { nowMilliseconds },
  )
  if (normalizedAttestation.validUntil <= absoluteTotalDeadline) {
    throw fixedError("ff029_environment_attestation_coverage_invalid")
  }
  const minimumExpiryOperationMilliseconds =
    pacingAttestation.email_otp_expiry_seconds * 1_000 + 60_000
  const operationTimeoutMilliseconds = boundedDuration(
    environment,
    "FF029_OPERATION_TIMEOUT_MILLISECONDS",
    minimumExpiryOperationMilliseconds,
    1_000,
    75 * 60 * 1_000,
  )
  if (
    operationTimeoutMilliseconds < minimumExpiryOperationMilliseconds ||
    operationTimeoutMilliseconds +
      cleanupBudgetMilliseconds +
      finalizationBudgetMilliseconds >=
      totalBudgetMilliseconds
  ) {
    throw fixedError("ff029_environment_expiry_budget_invalid")
  }
  return Object.freeze({
    projectRef: FF029_HOSTED_PROJECT_REF,
    supabaseUrl: FF029_HOSTED_SUPABASE_ORIGIN,
    applicationOrigin: FF029_HOSTED_APPLICATION_ORIGIN,
    anonKey,
    serviceRoleKey,
    sourceRevision,
    pacingAttestation,
    ethereal: readEtherealImapMailboxEnvironment(environment),
    requestTimeoutMilliseconds: boundedDuration(
      environment,
      "FF029_REQUEST_TIMEOUT_MILLISECONDS",
      10_000,
      1_000,
      60_000,
    ),
    operationTimeoutMilliseconds,
    totalBudgetMilliseconds,
    cleanupBudgetMilliseconds,
    finalizationBudgetMilliseconds,
    cleanupAbortJoinMilliseconds: boundedDuration(
      environment,
      "FF029_CLEANUP_ABORT_JOIN_MILLISECONDS",
      5_000,
      100,
      60_000,
    ),
    absoluteTotalDeadline,
  })
}

export function readHostedSupabaseRecoveryEnvironment(
  environment = process.env,
  options = {},
) {
  const nowMilliseconds = options.nowMilliseconds ?? Date.now()
  const serviceRoleKey = requiredEnvironmentValue(
    environment,
    "FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY",
    64,
    4_096,
  )
  const cleanupBudgetMilliseconds = boundedDuration(
    environment,
    "FF029_CLEANUP_BUDGET_MILLISECONDS",
    10 * 60 * 1_000,
    60_000,
    30 * 60 * 1_000,
  )
  validateHostedSupabaseKey(
    serviceRoleKey,
    "service_role",
    nowMilliseconds,
    cleanupBudgetMilliseconds,
  )
  const absoluteTotalDeadline = nowMilliseconds + cleanupBudgetMilliseconds
  if (!Number.isSafeInteger(absoluteTotalDeadline)) {
    throw fixedError("ff029_environment_total_deadline_invalid")
  }
  return Object.freeze({
    recoveryOnly: true,
    projectRef: FF029_HOSTED_PROJECT_REF,
    supabaseUrl: FF029_HOSTED_SUPABASE_ORIGIN,
    serviceRoleKey,
    ethereal: readEtherealImapMailboxEnvironment(environment),
    requestTimeoutMilliseconds: boundedDuration(
      environment,
      "FF029_REQUEST_TIMEOUT_MILLISECONDS",
      10_000,
      1_000,
      60_000,
    ),
    cleanupBudgetMilliseconds,
    cleanupAbortJoinMilliseconds: boundedDuration(
      environment,
      "FF029_CLEANUP_ABORT_JOIN_MILLISECONDS",
      5_000,
      100,
      60_000,
    ),
    absoluteTotalDeadline,
  })
}

export function remainingHostedExecutionBudgets(
  configuration,
  nowMilliseconds = Date.now(),
) {
  const remainingTotalMilliseconds =
    configuration?.absoluteTotalDeadline - nowMilliseconds
  const cleanupBudgetMilliseconds = configuration?.cleanupBudgetMilliseconds
  const finalizationBudgetMilliseconds =
    configuration?.finalizationBudgetMilliseconds
  if (
    !Number.isSafeInteger(remainingTotalMilliseconds) ||
    !Number.isSafeInteger(cleanupBudgetMilliseconds) ||
    !Number.isSafeInteger(finalizationBudgetMilliseconds) ||
    remainingTotalMilliseconds <=
      cleanupBudgetMilliseconds + finalizationBudgetMilliseconds
  ) {
    throw fixedError("ff029_hosted_execution_window_exhausted")
  }
  validateHostedSupabaseKey(
    configuration.anonKey,
    "anon",
    nowMilliseconds,
    remainingTotalMilliseconds - cleanupBudgetMilliseconds,
  )
  validateHostedSupabaseKey(
    configuration.serviceRoleKey,
    "service_role",
    nowMilliseconds,
    remainingTotalMilliseconds,
  )
  const attestation = validateHostedPacingAttestation(
    configuration.pacingAttestation,
    { nowMilliseconds },
  )
  if (attestation.validUntil <= configuration.absoluteTotalDeadline) {
    throw fixedError("ff029_environment_attestation_coverage_invalid")
  }
  return Object.freeze({
    cleanupBudgetMilliseconds,
    totalBudgetMilliseconds: remainingTotalMilliseconds,
  })
}

function requireHostedFinalizationTime(
  configuration,
  nowMilliseconds = Date.now(),
) {
  if (
    !Number.isSafeInteger(configuration?.absoluteTotalDeadline) ||
    !Number.isSafeInteger(nowMilliseconds) ||
    nowMilliseconds >= configuration.absoluteTotalDeadline
  ) {
    throw fixedError("ff029_hosted_finalization_deadline_exhausted")
  }
  return nowMilliseconds
}

function managementConfig(pacingAttestation) {
  return Object.freeze({
    mailer_otp_exp: pacingAttestation.email_otp_expiry_seconds,
    rate_limit_email_sent: pacingAttestation.rate_limit_email_sent_per_hour,
    rate_limit_otp: pacingAttestation.rate_limit_otp_per_hour,
    rate_limit_verify: pacingAttestation.verify_burst_capacity,
    smtp_max_frequency: pacingAttestation.smtp_max_frequency_seconds,
  })
}

export function validateHostedManagementLimitsObservation(
  value,
  configuration,
  phase,
  request,
  nowMilliseconds = Date.now(),
) {
  const observedAt = Date.parse(value?.observed_at)
  const issuedAt = Date.parse(request?.issued_at)
  const notAfter = Date.parse(request?.not_after)
  const expectedConfig = managementConfig(
    configuration?.pacingAttestation ?? {},
  )
  if (
    !exactKeys(value, MANAGEMENT_OBSERVATION_KEYS) ||
    !exactKeys(value?.config, MANAGEMENT_CONFIG_KEYS) ||
    value.schema_version !== 1 ||
    value.kind !== "ff029_authenticated_management_auth_limits_observation" ||
    value.authentication !== "supabase_management_api_personal_access_token" ||
    value.credential_source !== "supabase_cli_native_keychain" ||
    value.http_status !== 200 ||
    (phase !== "preflight" && phase !== "postflight") ||
    value.phase !== phase ||
    value.project_ref !== FF029_HOSTED_PROJECT_REF ||
    value.management_api_origin !== FF029_SUPABASE_MANAGEMENT_ORIGIN ||
    value.supabase_origin !== FF029_HOSTED_SUPABASE_ORIGIN ||
    value.operator_attestation_digest !==
      configuration?.pacingAttestation?.attestation_digest ||
    value.source_revision !== configuration?.sourceRevision ||
    value.harness_digest !== request?.harness_digest ||
    value.issued_at !== request?.issued_at ||
    value.not_after !== request?.not_after ||
    !LOCK_NONCE_PATTERN.test(value.run_nonce ?? "") ||
    value.run_nonce !== request?.run_nonce ||
    !LOCK_NONCE_PATTERN.test(value.request_nonce ?? "") ||
    value.request_nonce !== request?.request_nonce ||
    value.request_nonce === value.run_nonce ||
    value.request_digest !== request?.request_digest ||
    value.config_digest !== sha256Json(expectedConfig) ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(notAfter) ||
    new Date(issuedAt).toISOString() !== request?.issued_at ||
    new Date(notAfter).toISOString() !== request?.not_after ||
    notAfter <= issuedAt ||
    notAfter - issuedAt > 120_000 ||
    !Number.isSafeInteger(observedAt) ||
    new Date(observedAt).toISOString() !== value?.observed_at ||
    observedAt < issuedAt ||
    observedAt > notAfter ||
    observedAt > nowMilliseconds + 30_000 ||
    nowMilliseconds - observedAt >
      MANAGEMENT_OBSERVATION_MAXIMUM_AGE_MILLISECONDS ||
    MANAGEMENT_CONFIG_KEYS.some(
      (key) =>
        !Number.isSafeInteger(value.config[key]) ||
        value.config[key] !== expectedConfig[key],
    )
  ) {
    throw fixedError("ff029_hosted_management_observation_invalid")
  }
  return Object.freeze({
    ...value,
    config: Object.freeze({ ...value.config }),
  })
}

async function runManagementLimitsObservationHook(
  hook,
  phase,
  configuration,
  provenance,
  runNonce,
  nowImplementation = Date.now,
) {
  if (hook === undefined) return null
  if (typeof hook !== "function") {
    throw fixedError("ff029_hosted_management_observation_hook_invalid")
  }
  if (
    !validHostedSourceRevision(configuration?.sourceRevision) ||
    !/^[0-9a-f]{64}$/.test(provenance?.harness_digest ?? "")
  ) {
    throw fixedError("ff029_hosted_management_observation_binding_invalid")
  }
  if (typeof nowImplementation !== "function") {
    throw fixedError("ff029_hosted_management_observation_hook_invalid")
  }
  const issuedAt = requireHostedFinalizationTime(
    configuration,
    nowImplementation(),
  )
  const notAfter = Math.min(
    issuedAt + configuration.requestTimeoutMilliseconds,
    configuration.absoluteTotalDeadline,
  )
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(notAfter) ||
    notAfter <= issuedAt ||
    notAfter - issuedAt > 120_000
  ) {
    throw fixedError("ff029_hosted_management_observation_window_invalid")
  }
  let requestNonce = randomBytes(32).toString("hex")
  while (requestNonce === runNonce) {
    requestNonce = randomBytes(32).toString("hex")
  }
  const requestPayload = {
    expected_config: managementConfig(configuration.pacingAttestation),
    harness_digest: provenance.harness_digest,
    issued_at: new Date(issuedAt).toISOString(),
    kind: "ff029_management_auth_limits_observation_request",
    management_api_origin: FF029_SUPABASE_MANAGEMENT_ORIGIN,
    not_after: new Date(notAfter).toISOString(),
    operator_attestation_digest:
      configuration.pacingAttestation.attestation_digest,
    phase,
    project_ref: FF029_HOSTED_PROJECT_REF,
    request_nonce: requestNonce,
    run_nonce: runNonce,
    schema_version: 1,
    source_revision: configuration.sourceRevision,
    supabase_origin: FF029_HOSTED_SUPABASE_ORIGIN,
  }
  const request = Object.freeze({
    ...requestPayload,
    request_digest: sha256Json(requestPayload),
  })
  const observationWindowMilliseconds = notAfter - issuedAt
  if (observationWindowMilliseconds <= 2) {
    throw fixedError("ff029_hosted_finalization_deadline_exhausted")
  }
  const completionReserveMilliseconds = Math.max(
    1,
    Math.min(25, Math.floor(observationWindowMilliseconds / 10)),
  )
  const boundedObservationWindowMilliseconds =
    observationWindowMilliseconds - completionReserveMilliseconds
  const abortJoinMilliseconds = Math.max(
    1,
    Math.min(
      configuration.requestTimeoutMilliseconds,
      Math.floor(boundedObservationWindowMilliseconds / 2),
    ),
  )
  const hookBudgetMilliseconds =
    boundedObservationWindowMilliseconds - abortJoinMilliseconds
  const controller = new AbortController()
  let timer
  const timeout = new Promise((resolvePromise) => {
    timer = setTimeout(() => {
      resolvePromise(Object.freeze({ status: "timed_out" }))
    }, hookBudgetMilliseconds)
  })
  const hookPromise = Promise.resolve().then(() =>
    hook(request, Object.freeze({ signal: controller.signal })),
  )
  const settledHook = hookPromise.then(
    (value) => Object.freeze({ status: "completed", value }),
    (error) => Object.freeze({ status: "failed", error }),
  )
  const first = await Promise.race([settledHook, timeout])
  clearTimeout(timer)
  if (first.status === "failed") throw first.error
  if (first.status === "timed_out") {
    controller.abort(fixedError("ff029_hosted_management_observation_timeout"))
    let joinTimer
    const joinTimeout = new Promise((resolvePromise) => {
      joinTimer = setTimeout(
        () => resolvePromise(Object.freeze({ status: "join_timed_out" })),
        abortJoinMilliseconds,
      )
    })
    const joined = await Promise.race([settledHook, joinTimeout])
    clearTimeout(joinTimer)
    if (joined.status === "join_timed_out") {
      void hookPromise.catch(() => {})
      throw exclusiveOwnershipError(
        "ff029_hosted_management_observation_unsettled",
      )
    }
    if (
      joined.status === "failed" &&
      requiresFf029ExclusiveOwnershipRetention(joined.error)
    ) {
      throw joined.error
    }
    requireHostedFinalizationTime(configuration, nowImplementation())
    throw fixedError("ff029_hosted_management_observation_hook_timeout")
  }
  const completedAt = requireHostedFinalizationTime(
    configuration,
    nowImplementation(),
  )
  if (completedAt >= notAfter) {
    throw fixedError("ff029_hosted_finalization_deadline_exhausted")
  }
  return validateHostedManagementLimitsObservation(
    first.value,
    configuration,
    phase,
    request,
    completedAt,
  )
}

export async function createCommandManagementAttestationHook(
  environment = process.env,
  options = {},
) {
  const command = requiredEnvironmentValue(
    environment,
    MANAGEMENT_ATTESTOR_COMMAND_ENVIRONMENT,
    2,
    4_096,
  )
  const expectedDigest = requiredEnvironmentValue(
    environment,
    MANAGEMENT_ATTESTOR_SHA256_ENVIRONMENT,
    64,
    64,
  )
  if (!isAbsolute(command) || !/^[0-9a-f]{64}$/.test(expectedDigest)) {
    throw fixedError("ff029_management_attestor_command_invalid")
  }
  const spawnImplementation = options.spawnImplementation ?? spawnCallback
  const killProcessGroupImplementation =
    options.killProcessGroupImplementation ??
    ((processId, signal) => process.kill(-processId, signal))
  const processGroupAliveImplementation =
    options.processGroupAliveImplementation ??
    ((processId) => {
      try {
        process.kill(-processId, 0)
        return true
      } catch (error) {
        if (error?.code === "ESRCH") return false
        if (error?.code === "EPERM") return true
        throw error
      }
    })
  const processGroupJoinMilliseconds =
    options.processGroupJoinMilliseconds ??
    MANAGEMENT_ATTESTOR_PROCESS_GROUP_JOIN_MILLISECONDS
  if (
    typeof spawnImplementation !== "function" ||
    typeof killProcessGroupImplementation !== "function" ||
    typeof processGroupAliveImplementation !== "function" ||
    !Number.isSafeInteger(processGroupJoinMilliseconds) ||
    processGroupJoinMilliseconds < 25 ||
    processGroupJoinMilliseconds >
      MANAGEMENT_ATTESTOR_PROCESS_GROUP_JOIN_MILLISECONDS
  ) {
    throw fixedError("ff029_management_attestor_command_invalid")
  }

  const currentUserId =
    typeof process.getuid === "function" ? process.getuid() : undefined
  if (!Number.isSafeInteger(currentUserId) || currentUserId < 0) {
    throw fixedError("ff029_management_attestor_command_invalid")
  }
  const activeProcessGroupIds = new Set()

  async function verifiedDescriptor() {
    const parent = dirname(command)
    let parentMetadata
    let pathMetadata
    let handle
    try {
      parentMetadata = await lstat(parent)
      pathMetadata = await lstat(command)
      handle = await open(command, "r")
      const descriptorMetadata = await handle.stat()
      if (
        !parentMetadata.isDirectory() ||
        parentMetadata.uid !== currentUserId ||
        (parentMetadata.mode & 0o777) !== 0o700 ||
        !pathMetadata.isFile() ||
        pathMetadata.uid !== currentUserId ||
        pathMetadata.nlink !== 1 ||
        (pathMetadata.mode & 0o777) !== 0o500 ||
        pathMetadata.size < 1 ||
        pathMetadata.size > MANAGEMENT_ATTESTOR_MAXIMUM_FILE_BYTES ||
        descriptorMetadata.dev !== pathMetadata.dev ||
        descriptorMetadata.ino !== pathMetadata.ino ||
        descriptorMetadata.size !== pathMetadata.size ||
        descriptorMetadata.mtimeMs !== pathMetadata.mtimeMs
      ) {
        throw fixedError("ff029_management_attestor_command_invalid")
      }
      const source = await handle.readFile()
      const digest = createHash("sha256").update(source).digest("hex")
      if (
        source.byteLength !== pathMetadata.size ||
        digest !== expectedDigest
      ) {
        throw fixedError("ff029_management_attestor_command_invalid")
      }
      return Object.freeze({
        dev: pathMetadata.dev,
        ino: pathMetadata.ino,
        mtimeMs: pathMetadata.mtimeMs,
        size: pathMetadata.size,
        digest,
      })
    } catch (error) {
      if (error?.message === "ff029_management_attestor_command_invalid") {
        throw error
      }
      throw fixedError("ff029_management_attestor_command_invalid", error)
    } finally {
      await handle?.close()
    }
  }

  function sameDescriptor(first, second) {
    return (
      first.dev === second.dev &&
      first.ino === second.ino &&
      first.mtimeMs === second.mtimeMs &&
      first.size === second.size &&
      first.digest === second.digest
    )
  }

  async function invoke(request, lifecycle) {
    if (lifecycle?.signal?.aborted) {
      throw fixedError("ff029_management_attestor_command_cancelled")
    }
    const requestLine = `${canonicalJson(request)}\n`
    const before = await verifiedDescriptor()
    if (lifecycle?.signal?.aborted) {
      throw fixedError("ff029_management_attestor_command_cancelled")
    }
    let responseSource
    let invocationError
    try {
      responseSource = await new Promise((resolvePromise, rejectPromise) => {
        let child
        try {
          child = spawnImplementation(command, [], {
            cwd: "/",
            detached: true,
            env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          })
        } catch (error) {
          rejectPromise(
            fixedError("ff029_management_attestor_command_failed", error),
          )
          return
        }
        if (
          !child ||
          !Number.isSafeInteger(child.pid) ||
          child.pid < 1 ||
          typeof child.once !== "function" ||
          typeof child.stdin?.end !== "function" ||
          typeof child.stdout?.on !== "function" ||
          typeof child.stderr?.on !== "function"
        ) {
          rejectPromise(fixedError("ff029_management_attestor_command_failed"))
          return
        }
        activeProcessGroupIds.add(child.pid)
        const stdout = []
        const stderr = []
        let stdoutBytes = 0
        let stderrBytes = 0
        let terminalError = null
        let terminationTimer
        let terminating = false
        let finalizing = false

        const terminate = () => {
          if (terminating) return
          terminating = true
          try {
            killProcessGroupImplementation(child.pid, "SIGTERM")
          } catch {}
          terminationTimer = setTimeout(() => {
            try {
              killProcessGroupImplementation(child.pid, "SIGKILL")
            } catch {}
          }, MANAGEMENT_ATTESTOR_TERMINATION_GRACE_MILLISECONDS)
        }
        const joinTerminatedProcessGroup = async () => {
          clearTimeout(terminationTimer)
          try {
            killProcessGroupImplementation(child.pid, "SIGKILL")
          } catch {}
          const joinDeadline = Date.now() + processGroupJoinMilliseconds
          while (true) {
            let alive
            try {
              alive = await processGroupAliveImplementation(child.pid)
            } catch (error) {
              throw exclusiveOwnershipError(
                "ff029_management_attestor_process_group_unsettled",
                error,
                [child.pid],
              )
            }
            if (alive === false) {
              activeProcessGroupIds.delete(child.pid)
              return
            }
            if (alive !== true || Date.now() >= joinDeadline) {
              throw exclusiveOwnershipError(
                "ff029_management_attestor_process_group_unsettled",
                undefined,
                [child.pid],
              )
            }
            await new Promise((resolvePromise) => {
              setTimeout(
                resolvePromise,
                MANAGEMENT_ATTESTOR_PROCESS_GROUP_POLL_MILLISECONDS,
              )
            })
          }
        }
        const containUnexpectedProcessGroup = async () => {
          let alive
          try {
            alive = await processGroupAliveImplementation(child.pid)
          } catch (error) {
            throw exclusiveOwnershipError(
              "ff029_management_attestor_process_group_unsettled",
              error,
              [child.pid],
            )
          }
          if (alive === false) {
            activeProcessGroupIds.delete(child.pid)
            return
          }
          if (alive !== true) {
            throw exclusiveOwnershipError(
              "ff029_management_attestor_process_group_unsettled",
              undefined,
              [child.pid],
            )
          }
          terminalError ??= fixedError(
            "ff029_management_attestor_descendant_process_detected",
          )
          terminate()
          await joinTerminatedProcessGroup()
        }
        const onAbort = () => {
          terminalError = fixedError(
            "ff029_management_attestor_command_cancelled",
          )
          terminate()
        }
        const collect = (chunks, chunk, stream) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          if (stream === "stdout") stdoutBytes += buffer.byteLength
          else stderrBytes += buffer.byteLength
          if (
            stdoutBytes > MANAGEMENT_ATTESTOR_MAXIMUM_OUTPUT_BYTES ||
            stderrBytes > MANAGEMENT_ATTESTOR_MAXIMUM_OUTPUT_BYTES
          ) {
            terminalError = fixedError(
              "ff029_management_attestor_command_output_invalid",
            )
            terminate()
            return
          }
          chunks.push(buffer)
        }
        lifecycle.signal.addEventListener("abort", onAbort, { once: true })
        child.stdout.on("data", (chunk) => collect(stdout, chunk, "stdout"))
        child.stderr.on("data", (chunk) => collect(stderr, chunk, "stderr"))
        child.stdin.on?.("error", (error) => {
          terminalError ??= fixedError(
            "ff029_management_attestor_command_failed",
            error,
          )
          terminate()
        })
        child.once("error", (error) => {
          terminalError ??= fixedError(
            "ff029_management_attestor_command_failed",
            error,
          )
        })
        child.once("close", (code, signal) => {
          if (finalizing) return
          finalizing = true
          void (async () => {
            if (terminating) await joinTerminatedProcessGroup()
            else await containUnexpectedProcessGroup()
            lifecycle.signal.removeEventListener("abort", onAbort)
            if (terminalError !== null) throw terminalError
            const stderrSource = Buffer.concat(stderr).toString("utf8")
            const stdoutSource = Buffer.concat(stdout).toString("utf8")
            if (
              code !== 0 ||
              signal !== null ||
              stderrSource !== "" ||
              !stdoutSource.endsWith("\n") ||
              stdoutSource.slice(0, -1).includes("\n") ||
              stdoutSource.includes("\r")
            ) {
              throw fixedError(
                "ff029_management_attestor_command_output_invalid",
              )
            }
            return stdoutSource
          })().then(resolvePromise, rejectPromise)
        })
        if (lifecycle.signal.aborted) onAbort()
        try {
          child.stdin.end(requestLine, "utf8")
        } catch (error) {
          terminalError = fixedError(
            "ff029_management_attestor_command_failed",
            error,
          )
          terminate()
        }
      })
    } catch (error) {
      invocationError = error
    }
    const after = await verifiedDescriptor()
    if (!sameDescriptor(before, after)) {
      throw fixedError("ff029_management_attestor_command_changed")
    }
    if (invocationError !== undefined) throw invocationError
    let result
    try {
      result = JSON.parse(responseSource)
    } catch (error) {
      throw fixedError(
        "ff029_management_attestor_command_output_invalid",
        error,
      )
    }
    if (
      `${canonicalJson(result)}\n` !== responseSource ||
      !result ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      throw fixedError("ff029_management_attestor_command_output_invalid")
    }
    return result
  }
  const initialDescriptor = await verifiedDescriptor()
  Object.defineProperty(invoke, "observerDigest", {
    configurable: false,
    enumerable: false,
    value: initialDescriptor.digest,
    writable: false,
  })
  Object.defineProperty(invoke, "activeProcessGroupIds", {
    configurable: false,
    enumerable: false,
    value: () =>
      Object.freeze(
        [...activeProcessGroupIds].sort((first, second) => first - second),
      ),
    writable: false,
  })
  return invoke
}

async function runGit(
  repositoryRoot,
  args,
  execFileImplementation = execFile,
  options = {},
) {
  const absoluteDeadline = options.absoluteDeadline
  const nowImplementation = options.nowImplementation ?? Date.now
  const remainingMilliseconds =
    absoluteDeadline === undefined
      ? undefined
      : absoluteDeadline - nowImplementation()
  if (
    absoluteDeadline !== undefined &&
    (!Number.isSafeInteger(absoluteDeadline) ||
      !Number.isSafeInteger(remainingMilliseconds) ||
      remainingMilliseconds <= 0)
  ) {
    throw fixedError("ff029_hosted_finalization_deadline_exhausted")
  }
  let result
  try {
    result = await execFileImplementation("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      ...(remainingMilliseconds === undefined
        ? {}
        : { timeout: remainingMilliseconds }),
    })
  } catch (error) {
    if (
      absoluteDeadline !== undefined &&
      nowImplementation() >= absoluteDeadline
    ) {
      throw fixedError("ff029_hosted_finalization_deadline_exhausted")
    }
    throw fixedError("ff029_hosted_git_gate_unavailable", error)
  }
  if (
    absoluteDeadline !== undefined &&
    nowImplementation() >= absoluteDeadline
  ) {
    throw fixedError("ff029_hosted_finalization_deadline_exhausted")
  }
  const stdout =
    typeof result === "string"
      ? result
      : typeof result?.stdout === "string"
        ? result.stdout
        : ""
  const stderr = typeof result?.stderr === "string" ? result.stderr.trim() : ""
  if (stderr !== "") throw fixedError("ff029_hosted_git_gate_invalid")
  return stdout.trim()
}

export async function assertHostedSourceRevisionGate(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd())
  const sourceRevision = options.sourceRevision
  if (!validHostedSourceRevision(sourceRevision)) {
    throw fixedError("ff029_source_revision_invalid")
  }
  const execFileImplementation = options.execFileImplementation ?? execFile
  const deadlineOptions = {
    absoluteDeadline: options.absoluteDeadline,
    nowImplementation: options.nowImplementation,
  }
  const [topLevel, head, status] = await Promise.all([
    runGit(
      repositoryRoot,
      ["rev-parse", "--show-toplevel"],
      execFileImplementation,
      deadlineOptions,
    ),
    runGit(
      repositoryRoot,
      ["rev-parse", "--verify", "HEAD"],
      execFileImplementation,
      deadlineOptions,
    ),
    runGit(
      repositoryRoot,
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ],
      execFileImplementation,
      deadlineOptions,
    ),
  ])
  if (
    resolve(topLevel) !== repositoryRoot ||
    head !== sourceRevision ||
    status !== ""
  ) {
    throw fixedError("ff029_hosted_source_revision_gate_failed")
  }
  return Object.freeze({ repositoryRoot, sourceRevision: head })
}

async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) {
    throw fixedError("ff029_private_directory_invalid")
  }
}

async function requirePrivateRegularFile(path) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw fixedError("ff029_private_file_mode_invalid")
  }
  if (metadata.size <= 0 || metadata.size > MAXIMUM_PRIVATE_FILE_BYTES) {
    throw fixedError("ff029_private_file_size_invalid")
  }
  return metadata
}

function ensureRepositoryPath(repositoryRoot, targetPath, code) {
  const relativePath = relative(repositoryRoot, targetPath)
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    relativePath.startsWith("/")
  ) {
    throw fixedError(code)
  }
  return targetPath
}

export function hostedEvidencePath(repositoryRoot = process.cwd()) {
  const root = resolve(repositoryRoot)
  return ensureRepositoryPath(
    root,
    resolve(root, EVIDENCE_RELATIVE_PATH),
    "ff029_hosted_evidence_path_invalid",
  )
}

export function hostedMachineStateRoot(stateRoot = DEFAULT_MACHINE_STATE_ROOT) {
  return resolve(stateRoot)
}

export function hostedCleanupJournalPath(
  stateRoot = DEFAULT_MACHINE_STATE_ROOT,
) {
  return resolve(hostedMachineStateRoot(stateRoot), CLEANUP_JOURNAL_FILENAME)
}

export function hostedRunLockPath(stateRoot = DEFAULT_MACHINE_STATE_ROOT) {
  return resolve(hostedMachineStateRoot(stateRoot), "run.lock")
}

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  )
}

export async function assertHostedEvidenceTargetAvailable(
  repositoryRoot = process.cwd(),
) {
  const paths = [hostedEvidencePath(repositoryRoot)]
  for (const path of paths) {
    try {
      await lstat(path)
    } catch (error) {
      if (error?.code === "ENOENT") continue
      throw error
    }
    throw fixedError("ff029_hosted_evidence_already_exists")
  }
  return Object.freeze(paths)
}

function createRunLockState(kind, options = {}) {
  const processId = options.processId ?? process.pid
  if (
    !Number.isSafeInteger(processId) ||
    processId < 1 ||
    processId > MAXIMUM_PROCESS_ID
  ) {
    throw fixedError("ff029_hosted_run_lock_process_invalid")
  }
  const state = {
    schema_version: 1,
    kind,
    project_ref: FF029_HOSTED_PROJECT_REF,
    process_id: processId,
    acquired_at: new Date(options.nowMilliseconds ?? Date.now()).toISOString(),
    nonce: randomBytes(32).toString("hex"),
  }
  if (kind === RUN_LOCK_QUARANTINE_KIND) {
    const processGroupIds = [...new Set(options.processGroupIds ?? [])].sort(
      (a, b) => a - b,
    )
    if (
      processGroupIds.some(
        (groupId) =>
          !Number.isSafeInteger(groupId) ||
          groupId < 1 ||
          groupId > MAXIMUM_PROCESS_ID,
      )
    ) {
      throw fixedError("ff029_hosted_run_lock_process_group_invalid")
    }
    return Object.freeze({
      ...state,
      process_group_ids: Object.freeze(processGroupIds),
      remote_operations_unsettled: true,
    })
  }
  return Object.freeze(state)
}

function validateRunLockState(value, expectedKind) {
  const acquiredAt = Date.parse(value?.acquired_at)
  const expectedKeys =
    expectedKind === RUN_LOCK_QUARANTINE_KIND
      ? RUN_LOCK_QUARANTINE_KEYS
      : RUN_LOCK_KEYS
  if (
    !exactKeys(value, expectedKeys) ||
    value.schema_version !== 1 ||
    value.kind !== expectedKind ||
    value.project_ref !== FF029_HOSTED_PROJECT_REF ||
    !Number.isSafeInteger(value.process_id) ||
    value.process_id < 1 ||
    value.process_id > MAXIMUM_PROCESS_ID ||
    !Number.isSafeInteger(acquiredAt) ||
    new Date(acquiredAt).toISOString() !== value.acquired_at ||
    acquiredAt > Date.now() + 30_000 ||
    !LOCK_NONCE_PATTERN.test(value.nonce ?? "") ||
    (expectedKind === RUN_LOCK_QUARANTINE_KIND &&
      (value.remote_operations_unsettled !== true ||
        !Array.isArray(value.process_group_ids) ||
        value.process_group_ids.some(
          (groupId, index) =>
            !Number.isSafeInteger(groupId) ||
            groupId < 1 ||
            groupId > MAXIMUM_PROCESS_ID ||
            (index > 0 && value.process_group_ids[index - 1] >= groupId),
        )))
  ) {
    throw fixedError("ff029_hosted_run_lock_invalid")
  }
  return Object.freeze(value)
}

async function readRunLockState(path, expectedKind) {
  let handle
  try {
    const pathMetadata = await lstat(path)
    if (
      !pathMetadata.isFile() ||
      (pathMetadata.mode & 0o777) !== 0o600 ||
      pathMetadata.size < 2 ||
      pathMetadata.size > MAXIMUM_LOCK_FILE_BYTES
    ) {
      throw fixedError("ff029_hosted_run_lock_invalid")
    }
    handle = await open(path, "r")
    const metadata = await handle.stat()
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size < 2 ||
      metadata.size > MAXIMUM_LOCK_FILE_BYTES ||
      metadata.dev !== pathMetadata.dev ||
      metadata.ino !== pathMetadata.ino
    ) {
      throw fixedError("ff029_hosted_run_lock_invalid")
    }
    const source = await handle.readFile("utf8")
    if (Buffer.byteLength(source, "utf8") !== metadata.size) {
      throw fixedError("ff029_hosted_run_lock_invalid")
    }
    return validateRunLockState(JSON.parse(source), expectedKind)
  } catch (error) {
    if (
      error?.code === "ENOENT" ||
      error?.message === "ff029_hosted_run_lock_invalid"
    ) {
      throw error
    }
    throw fixedError("ff029_hosted_run_lock_invalid", error)
  } finally {
    await handle?.close()
  }
}

async function writeRunLockStateExclusive(path, state) {
  let handle
  try {
    handle = await open(path, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8")
    await handle.sync()
  } catch (error) {
    try {
      await handle?.close()
    } catch {}
    throw error
  }
  await handle.close()
  await chmod(path, 0o600)
  const written = await readRunLockState(path, state.kind)
  if (written.nonce !== state.nonce) {
    throw fixedError("ff029_hosted_run_lock_ownership_lost")
  }
}

async function processIsAlive(processId, implementation) {
  if (processId === process.pid) return true
  if (typeof implementation === "function") {
    const result = await implementation(processId)
    if (typeof result !== "boolean") {
      throw fixedError("ff029_hosted_run_lock_liveness_invalid")
    }
    return result
  }
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") return false
    if (error?.code === "EPERM") return true
    throw fixedError("ff029_hosted_run_lock_liveness_unavailable", error)
  }
}

async function processGroupIsAlive(processId, implementation) {
  if (typeof implementation === "function") {
    const result = await implementation(processId)
    if (typeof result !== "boolean") {
      throw fixedError("ff029_hosted_run_lock_group_liveness_invalid")
    }
    return result
  }
  try {
    process.kill(-processId, 0)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") return false
    if (error?.code === "EPERM") return true
    throw fixedError("ff029_hosted_run_lock_group_liveness_unavailable", error)
  }
}

function validateQuarantineRecoveryAuthorization(authorization, quarantine) {
  if (
    !exactKeys(authorization, QUARANTINE_RECOVERY_AUTHORIZATION_KEYS) ||
    authorization.quarantineNonce !== quarantine.nonce ||
    authorization.operatorAttestation !==
      FF029_HOSTED_QUARANTINE_RECOVERY_ATTESTATION ||
    !Number.isSafeInteger(authorization.quietPeriodMilliseconds) ||
    authorization.quietPeriodMilliseconds <
      MINIMUM_QUARANTINE_RECOVERY_QUIET_PERIOD_MILLISECONDS ||
    authorization.quietPeriodMilliseconds >
      MAXIMUM_QUARANTINE_RECOVERY_QUIET_PERIOD_MILLISECONDS
  ) {
    throw fixedError("ff029_hosted_quarantine_recovery_authorization_invalid")
  }
  return Object.freeze({ ...authorization })
}

async function assertQuarantineOwnerAndGroupsExited(quarantine, options) {
  if (
    await processIsAlive(
      quarantine.process_id,
      options.processAliveImplementation,
    )
  ) {
    throw fixedError("ff029_hosted_run_locked_quarantined")
  }
  for (const processGroupId of quarantine.process_group_ids) {
    if (
      await processGroupIsAlive(
        processGroupId,
        options.processGroupAliveImplementation,
      )
    ) {
      throw fixedError("ff029_hosted_run_locked_quarantined")
    }
  }
}

async function releaseOwnedRunLock(path, state) {
  const current = await readRunLockState(path, state.kind)
  if (current.nonce !== state.nonce) {
    throw fixedError("ff029_hosted_run_lock_ownership_lost")
  }
  await rm(path)
}

async function replaceOwnedRunLock(path, currentState, replacementState) {
  const temporaryPath = `${path}.transition.${replacementState.nonce}`
  try {
    await writeRunLockStateExclusive(temporaryPath, replacementState)
    const current = await readRunLockState(path, currentState.kind)
    if (current.nonce !== currentState.nonce) {
      throw fixedError("ff029_hosted_run_lock_ownership_lost")
    }
    await rename(temporaryPath, path)
    const replacement = await readRunLockState(path, replacementState.kind)
    if (replacement.nonce !== replacementState.nonce) {
      throw fixedError("ff029_hosted_run_lock_ownership_lost")
    }
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function acquireRecoveryGuard(
  path,
  options,
  kind = RUN_LOCK_RECOVERY_KIND,
) {
  const state = createRunLockState(kind, options)
  try {
    await writeRunLockStateExclusive(path, state)
  } catch (error) {
    if (error?.code !== "EEXIST") throw error
    const existing = await readRunLockState(path, kind)
    if (
      await processIsAlive(
        existing.process_id,
        options.processAliveImplementation,
      )
    ) {
      throw fixedError("ff029_hosted_run_lock_recovery_busy")
    }
    const latest = await readRunLockState(path, kind)
    if (
      latest.nonce !== existing.nonce ||
      (await processIsAlive(
        latest.process_id,
        options.processAliveImplementation,
      ))
    ) {
      throw fixedError("ff029_hosted_run_lock_recovery_busy")
    }
    const quarantinePath = `${path}.stale.${state.nonce}`
    await rename(path, quarantinePath)
    try {
      const quarantined = await readRunLockState(quarantinePath, kind)
      if (quarantined.nonce !== latest.nonce) {
        throw fixedError("ff029_hosted_run_lock_recovery_race")
      }
      await writeRunLockStateExclusive(path, state)
    } finally {
      await rm(quarantinePath, { force: true })
    }
  }
  return Object.freeze({
    async release() {
      await releaseOwnedRunLock(path, state)
    },
  })
}

async function reclaimDeadRunLock(path, options) {
  const recoveryPath = `${path}.recovery`
  const recovery = await acquireRecoveryGuard(recoveryPath, options)
  try {
    let existing
    try {
      existing = await readRunLockState(path, RUN_LOCK_KIND)
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      await writeRunLockStateExclusive(path, options.replacementState)
      return options.replacementState
    }
    if (
      await processIsAlive(
        existing.process_id,
        options.processAliveImplementation,
      )
    ) {
      throw fixedError("ff029_hosted_run_locked")
    }
    const latest = await readRunLockState(path, RUN_LOCK_KIND)
    if (
      latest.nonce !== existing.nonce ||
      (await processIsAlive(
        latest.process_id,
        options.processAliveImplementation,
      ))
    ) {
      throw fixedError("ff029_hosted_run_locked")
    }
    const quarantinePath = `${path}.stale.${options.replacementState.nonce}`
    await rename(path, quarantinePath)
    try {
      const quarantined = await readRunLockState(quarantinePath, RUN_LOCK_KIND)
      if (quarantined.nonce !== latest.nonce) {
        throw fixedError("ff029_hosted_run_lock_recovery_race")
      }
      await writeRunLockStateExclusive(path, options.replacementState)
    } finally {
      await rm(quarantinePath, { force: true })
    }
    return options.replacementState
  } finally {
    await recovery.release()
  }
}

export async function acquireHostedRunLock(options = {}) {
  const path = resolve(options.path ?? hostedRunLockPath(options.stateRoot))
  let state = createRunLockState(RUN_LOCK_KIND, options)
  try {
    await writeRunLockStateExclusive(path, state)
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw fixedError("ff029_hosted_run_lock_unavailable", error)
    }
    let existing
    try {
      existing = await readRunLockState(path, RUN_LOCK_KIND)
    } catch (ordinaryLockError) {
      let quarantine
      try {
        quarantine = await readRunLockState(path, RUN_LOCK_QUARANTINE_KIND)
      } catch {
        throw ordinaryLockError
      }
      if (options.quarantineRecoveryAuthorization == null) {
        throw fixedError("ff029_hosted_run_locked_quarantined")
      }
      const recoveryAuthorization = validateQuarantineRecoveryAuthorization(
        options.quarantineRecoveryAuthorization,
        quarantine,
      )
      await assertQuarantineOwnerAndGroupsExited(quarantine, options)
      const guard = await acquireRecoveryGuard(
        `${path}.quarantine-recovery`,
        options,
        RUN_LOCK_QUARANTINE_RECOVERY_KIND,
      )
      try {
        const latest = await readRunLockState(path, RUN_LOCK_QUARANTINE_KIND)
        if (latest.nonce !== quarantine.nonce) {
          throw fixedError("ff029_hosted_run_lock_ownership_lost")
        }
        await assertQuarantineOwnerAndGroupsExited(latest, options)
      } catch (recoveryError) {
        await guard.release()
        throw recoveryError
      }
      let clearedState = null
      let released = false
      return Object.freeze({
        path,
        quarantineRecovery: true,
        recoveryAuthorization,
        async assertRecoveryIsolation() {
          const latest = await readRunLockState(path, RUN_LOCK_QUARANTINE_KIND)
          if (latest.nonce !== quarantine.nonce) {
            throw fixedError("ff029_hosted_run_lock_ownership_lost")
          }
          await assertQuarantineOwnerAndGroupsExited(latest, options)
        },
        async clearStickyQuarantine() {
          if (clearedState !== null) return
          const replacement = createRunLockState(RUN_LOCK_KIND, options)
          await replaceOwnedRunLock(path, quarantine, replacement)
          clearedState = replacement
        },
        async retain() {},
        async release() {
          if (released) return
          try {
            if (clearedState !== null) {
              await releaseOwnedRunLock(path, clearedState)
            }
          } finally {
            await guard.release()
          }
          released = true
        },
      })
    }
    if (
      await processIsAlive(
        existing.process_id,
        options.processAliveImplementation,
      )
    ) {
      throw fixedError("ff029_hosted_run_locked")
    }
    try {
      state = await reclaimDeadRunLock(path, {
        ...options,
        replacementState: state,
      })
    } catch (recoveryError) {
      if (
        recoveryError?.message === "ff029_hosted_run_locked" ||
        recoveryError?.message === "ff029_hosted_run_lock_recovery_busy"
      ) {
        throw recoveryError
      }
      throw fixedError("ff029_hosted_run_lock_recovery_failed", recoveryError)
    }
  }
  let released = false
  let retained = false
  return Object.freeze({
    path,
    quarantineRecovery: false,
    recoveryAuthorization: null,
    async assertRecoveryIsolation() {},
    async clearStickyQuarantine() {},
    async retain(retainOptions = {}) {
      if (retained) return
      retained = true
      const quarantineState = createRunLockState(RUN_LOCK_QUARANTINE_KIND, {
        ...options,
        processGroupIds: retainOptions.processGroupIds,
      })
      await replaceOwnedRunLock(path, state, quarantineState)
      state = quarantineState
    },
    async release() {
      if (released || retained) return
      await releaseOwnedRunLock(path, state)
      released = true
    },
  })
}

function validateCleanupState(value) {
  if (
    !value ||
    value.schema_version !== 1 ||
    value.project_ref !== FF029_HOSTED_PROJECT_REF ||
    value.supabase_origin !== FF029_HOSTED_SUPABASE_ORIGIN ||
    !validHostedSourceRevision(value.source_revision) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    !Array.isArray(value.tracked_emails) ||
    !Array.isArray(value.tracked_user_ids) ||
    value.tracked_emails.some((email) => !CANARY_EMAIL_PATTERN.test(email)) ||
    value.tracked_user_ids.some((id) => !UUID_PATTERN.test(id))
  ) {
    throw fixedError("ff029_hosted_cleanup_journal_invalid")
  }
  return value
}

async function readHostedCleanupStateIfPresent(path) {
  try {
    await requirePrivateRegularFile(path)
    const source = await readFile(path, "utf8")
    if (Buffer.byteLength(source, "utf8") > MAXIMUM_PRIVATE_FILE_BYTES) {
      throw fixedError("ff029_hosted_cleanup_journal_invalid")
    }
    return validateCleanupState(JSON.parse(source))
  } catch (error) {
    if (error?.code === "ENOENT") return null
    if (error?.message === "ff029_hosted_cleanup_journal_invalid") throw error
    throw fixedError("ff029_hosted_cleanup_journal_invalid", error)
  }
}

async function writePrivateFileExclusive(path, contents, options = {}) {
  await ensurePrivateDirectory(dirname(path))
  const openImplementation = options.openImplementation ?? open
  const handle = await openImplementation(path, "wx", 0o600)
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(path, 0o600)
  await requirePrivateRegularFile(path)
}

async function syncPrivateDirectory(path) {
  let handle
  try {
    handle = await open(path, "r")
    await handle.sync()
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) {
      throw error
    }
  } finally {
    await handle?.close()
  }
}

async function replacePrivateFile(path, contents) {
  await requirePrivateRegularFile(path)
  const temporaryPath = `${path}.${randomBytes(16).toString("hex")}.tmp`
  try {
    await writePrivateFileExclusive(temporaryPath, contents)
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
    await requirePrivateRegularFile(path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export async function createHostedCleanupJournal(options = {}) {
  const sourceRevision = options.sourceRevision
  const path = hostedCleanupJournalPath(options.stateRoot)
  await ensurePrivateDirectory(dirname(path))
  let state = await readHostedCleanupStateIfPresent(path)
  const resumed = state !== null
  if (state === null) {
    if (!validHostedSourceRevision(sourceRevision)) {
      throw fixedError("ff029_source_revision_invalid")
    }
    const timestamp = new Date(
      options.nowMilliseconds ?? Date.now(),
    ).toISOString()
    state = {
      schema_version: 1,
      project_ref: FF029_HOSTED_PROJECT_REF,
      supabase_origin: FF029_HOSTED_SUPABASE_ORIGIN,
      source_revision: sourceRevision,
      created_at: timestamp,
      updated_at: timestamp,
      tracked_emails: [],
      tracked_user_ids: [],
    }
    await writePrivateFileExclusive(path, `${JSON.stringify(state)}\n`)
  }
  let mutationTail = Promise.resolve()
  let completed = false

  async function mutate(mutator) {
    const operation = mutationTail.then(async () => {
      if (completed) throw fixedError("ff029_hosted_cleanup_journal_closed")
      const next = structuredClone(state)
      mutator(next)
      next.tracked_emails = [...new Set(next.tracked_emails)].sort()
      next.tracked_user_ids = [...new Set(next.tracked_user_ids)].sort()
      next.updated_at = new Date(
        options.nowImplementation?.() ?? Date.now(),
      ).toISOString()
      validateCleanupState(next)
      await replacePrivateFile(path, `${JSON.stringify(next)}\n`)
      state = next
    })
    mutationTail = operation.catch(() => {})
    return operation
  }

  return Object.freeze({
    path,
    resumed,
    async snapshot() {
      await mutationTail
      validateCleanupState(state)
      return Object.freeze({
        trackedEmails: Object.freeze([...state.tracked_emails]),
        trackedUserIds: Object.freeze([...state.tracked_user_ids]),
        sourceRevision: state.source_revision,
      })
    },
    async trackEmail(email) {
      if (!CANARY_EMAIL_PATTERN.test(email ?? "")) {
        throw fixedError("ff029_hosted_canary_email_invalid")
      }
      await mutate((next) => next.tracked_emails.push(email))
    },
    async trackUserId(userId) {
      if (!UUID_PATTERN.test(userId ?? "")) {
        throw fixedError("ff029_hosted_user_id_invalid")
      }
      await mutate((next) => next.tracked_user_ids.push(userId))
    },
    async complete() {
      await mutationTail
      if (completed) return
      await requirePrivateRegularFile(path)
      await rm(path)
      completed = true
    },
  })
}

export async function writeHostedEvidence(serializedEvidence, options = {}) {
  if (
    typeof serializedEvidence !== "string" ||
    serializedEvidence.length < 3 ||
    Buffer.byteLength(serializedEvidence, "utf8") >
      MAXIMUM_PRIVATE_FILE_BYTES ||
    !serializedEvidence.endsWith("\n")
  ) {
    throw fixedError("ff029_hosted_evidence_invalid")
  }
  try {
    JSON.parse(serializedEvidence)
  } catch (error) {
    throw fixedError("ff029_hosted_evidence_invalid", error)
  }
  for (const forbidden of options.forbiddenValues ?? []) {
    if (
      typeof forbidden === "string" &&
      forbidden.length > 0 &&
      serializedEvidence.includes(forbidden)
    ) {
      throw fixedError("ff029_hosted_evidence_contains_private_value")
    }
  }
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd())
  const path = hostedEvidencePath(repositoryRoot)
  const directory = dirname(path)
  const nowImplementation = options.nowImplementation ?? Date.now
  const openImplementation = options.openImplementation ?? open
  const renameImplementation = options.renameImplementation ?? rename
  const syncDirectoryImplementation =
    options.syncDirectoryImplementation ?? syncPrivateDirectory
  if (
    (options.absoluteDeadline !== undefined &&
      !Number.isSafeInteger(options.absoluteDeadline)) ||
    typeof nowImplementation !== "function" ||
    typeof openImplementation !== "function" ||
    typeof renameImplementation !== "function" ||
    typeof syncDirectoryImplementation !== "function"
  ) {
    throw fixedError("ff029_hosted_evidence_invalid")
  }
  const requirePublicationTime = () => {
    if (
      options.absoluteDeadline !== undefined &&
      nowImplementation() >= options.absoluteDeadline
    ) {
      throw fixedError("ff029_hosted_finalization_deadline_exhausted")
    }
  }
  const requireTargetAbsent = async () => {
    try {
      await lstat(path)
    } catch (error) {
      if (error?.code === "ENOENT") return
      throw error
    }
    throw fixedError("ff029_hosted_evidence_already_exists")
  }
  requirePublicationTime()
  await ensurePrivateDirectory(directory)
  await requireTargetAbsent()
  const temporaryPath = `${path}.${randomBytes(16).toString("hex")}.tmp`
  let published = false
  try {
    await writePrivateFileExclusive(temporaryPath, serializedEvidence, {
      openImplementation,
    })
    requirePublicationTime()
    await requireTargetAbsent()
    await renameImplementation(temporaryPath, path)
    published = true
    await requirePrivateRegularFile(path)
    await syncDirectoryImplementation(directory)
    requirePublicationTime()
    return path
  } catch (error) {
    if (published) {
      await rm(path, { force: true })
      try {
        await syncDirectoryImplementation(directory)
      } catch {}
    }
    throw error
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export function serializeHostedManagementEvidence(
  serializedPrimaryEvidence,
  observations,
  configuration,
  runNonce,
  observerDigest,
) {
  if (
    !Array.isArray(observations) ||
    observations.length !== 2 ||
    observations[0]?.phase !== "preflight" ||
    observations[1]?.phase !== "postflight" ||
    observations.some((observation) => observation.run_nonce !== runNonce) ||
    observations.some(
      (observation) =>
        observation.source_revision !== configuration.sourceRevision ||
        observation.harness_digest !== observations[0]?.harness_digest,
    ) ||
    observations[0]?.config_digest !== observations[1]?.config_digest ||
    !LOCK_NONCE_PATTERN.test(runNonce ?? "") ||
    !/^[0-9a-f]{64}$/.test(observerDigest ?? "")
  ) {
    throw fixedError("ff029_hosted_management_observation_incomplete")
  }
  let coreReport
  try {
    coreReport = JSON.parse(serializedPrimaryEvidence)
  } catch (error) {
    throw fixedError("ff029_hosted_evidence_invalid", error)
  }
  const payload = {
    schema_version: 1,
    kind: "ff029_hosted_supabase_email_proof_evidence",
    project_ref: FF029_HOSTED_PROJECT_REF,
    supabase_origin: FF029_HOSTED_SUPABASE_ORIGIN,
    management_api_origin: FF029_SUPABASE_MANAGEMENT_ORIGIN,
    source_revision: configuration.sourceRevision,
    harness_digest: observations[0].harness_digest,
    operator_attestation_digest:
      configuration.pacingAttestation.attestation_digest,
    run_nonce: runNonce,
    observer_digest: observerDigest,
    normalized_config_digest: observations[0].config_digest,
    preflight_request_digest: observations[0].request_digest,
    postflight_request_digest: observations[1].request_digest,
    core_report: coreReport,
    management_observations: observations,
  }
  return `${canonicalJson({
    ...payload,
    binding_digest: sha256Json(payload),
  })}\n`
}

function assertSerializedEvidenceMatchesCleanup(serializedEvidence, report) {
  let parsed
  try {
    parsed = JSON.parse(serializedEvidence)
  } catch (error) {
    throw fixedError("ff029_hosted_evidence_invalid", error)
  }
  if (
    parsed?.scope !== "hosted_staging" ||
    parsed?.project_ref !== FF029_HOSTED_PROJECT_REF ||
    parsed?.cleanup !== report?.cleanup ||
    (report?.cleanup !== "completed" &&
      parsed?.hosted_observation === "observed")
  ) {
    throw fixedError("ff029_hosted_evidence_cleanup_incoherent")
  }
}

async function boundedSourceFile(path, code, options = {}) {
  const checkDeadline = () => {
    if (
      options.absoluteDeadline !== undefined &&
      (options.nowImplementation ?? Date.now)() >= options.absoluteDeadline
    ) {
      throw fixedError("ff029_hosted_finalization_deadline_exhausted")
    }
  }
  checkDeadline()
  const source = await readFile(path, "utf8")
  checkDeadline()
  if (
    source.length === 0 ||
    Buffer.byteLength(source, "utf8") > MAXIMUM_PRIVATE_FILE_BYTES
  ) {
    throw fixedError(code)
  }
  return source
}

export async function buildHostedProvenance(
  configuration,
  repositoryRoot = process.cwd(),
  options = {},
) {
  if (
    configuration?.projectRef !== FF029_HOSTED_PROJECT_REF ||
    configuration?.supabaseUrl !== FF029_HOSTED_SUPABASE_ORIGIN ||
    !validHostedSourceRevision(configuration?.sourceRevision) ||
    !/^[0-9a-f]{64}$/.test(
      configuration?.pacingAttestation?.attestation_digest ?? "",
    )
  ) {
    throw fixedError("ff029_hosted_provenance_input_invalid")
  }
  const root = resolve(repositoryRoot)
  const packageMetadata = JSON.parse(
    await boundedSourceFile(
      resolve(root, "node_modules/supabase/package.json"),
      "ff029_hosted_cli_metadata_invalid",
      options,
    ),
  )
  if (
    packageMetadata?.name !== "supabase" ||
    !VERSION_PATTERN.test(packageMetadata.version ?? "")
  ) {
    throw fixedError("ff029_hosted_cli_metadata_invalid")
  }
  const harnessHash = createHash("sha256")
  for (const path of HARNESS_PATHS) {
    const source = await boundedSourceFile(
      path,
      "ff029_hosted_harness_source_invalid",
      options,
    )
    harnessHash.update(relative(root, path))
    harnessHash.update("\0")
    harnessHash.update(source)
    harnessHash.update("\0")
  }
  if (
    options.absoluteDeadline !== undefined &&
    (options.nowImplementation ?? Date.now)() >= options.absoluteDeadline
  ) {
    throw fixedError("ff029_hosted_finalization_deadline_exhausted")
  }
  return Object.freeze({
    cli_version: packageMetadata.version,
    config_digest: configuration.pacingAttestation.attestation_digest,
    repo_revision: configuration.sourceRevision,
    harness_digest: harnessHash.digest("hex"),
  })
}

async function revalidateHostedProvenance(
  configuration,
  repositoryRoot,
  initialProvenance,
  options,
) {
  const nowImplementation = options.nowImplementation ?? Date.now
  const checkDeadline = () =>
    requireHostedFinalizationTime(configuration, nowImplementation())
  const gate = () =>
    assertHostedSourceRevisionGate({
      repositoryRoot,
      sourceRevision: configuration.sourceRevision,
      execFileImplementation: options.execFileImplementation,
      absoluteDeadline: configuration.absoluteTotalDeadline,
      nowImplementation,
    })
  checkDeadline()
  await gate()
  checkDeadline()
  const implementation =
    options.postflightProvenanceImplementation ?? buildHostedProvenance
  if (typeof implementation !== "function") {
    throw fixedError("ff029_hosted_postflight_provenance_invalid")
  }
  const postflightProvenance = await implementation(
    configuration,
    repositoryRoot,
    {
      absoluteDeadline: configuration.absoluteTotalDeadline,
      nowImplementation,
    },
  )
  checkDeadline()
  await gate()
  checkDeadline()
  for (const key of [
    "cli_version",
    "config_digest",
    "repo_revision",
    "harness_digest",
  ]) {
    if (
      typeof postflightProvenance?.[key] !== "string" ||
      postflightProvenance[key] !== initialProvenance?.[key]
    ) {
      throw fixedError("ff029_hosted_postflight_provenance_changed")
    }
  }
  if (postflightProvenance.repo_revision !== configuration.sourceRevision) {
    throw fixedError("ff029_hosted_postflight_provenance_changed")
  }
  checkDeadline()
  return Object.freeze({ ...postflightProvenance })
}

export async function createHostedRunnerFoundation(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd())
  const stateRoot = hostedMachineStateRoot(options.stateRoot)
  const nowMilliseconds = options.nowMilliseconds ?? Date.now()
  const environment = options.environment ?? process.env
  await ensurePrivateDirectory(stateRoot)
  const quarantineRecoveryAuthorization =
    options.quarantineRecoveryAuthorization ??
    quarantineRecoveryAuthorizationFromEnvironment(environment)
  const lock = await acquireHostedRunLock({
    quarantineRecoveryAuthorization,
    path: options.lockPath,
    stateRoot,
    nowMilliseconds,
    processAliveImplementation: options.processAliveImplementation,
    processGroupAliveImplementation: options.processGroupAliveImplementation,
  })
  try {
    const retainedCleanupState = await readHostedCleanupStateIfPresent(
      hostedCleanupJournalPath(stateRoot),
    )
    if (lock.quarantineRecovery === true && retainedCleanupState === null) {
      throw fixedError("ff029_hosted_quarantine_recovery_proof_missing")
    }
    const recoveryOnly = retainedCleanupState !== null
    const configuration = recoveryOnly
      ? readHostedSupabaseRecoveryEnvironment(environment, { nowMilliseconds })
      : readHostedSupabaseEmailProofEnvironment(environment, {
          nowMilliseconds,
        })
    if (!recoveryOnly) {
      await assertHostedSourceRevisionGate({
        absoluteDeadline: configuration.absoluteTotalDeadline,
        repositoryRoot,
        sourceRevision: configuration.sourceRevision,
        execFileImplementation: options.execFileImplementation,
        nowImplementation: options.nowImplementation,
      })
    }
    if (!recoveryOnly && options.requireEvidenceTargetAvailable === true) {
      await assertHostedEvidenceTargetAvailable(repositoryRoot)
    }
    let managementAttestationHookImplementation =
      options.managementAttestationHookImplementation
    if (
      !recoveryOnly &&
      options.requireManagementObservation === true &&
      managementAttestationHookImplementation === undefined
    ) {
      managementAttestationHookImplementation =
        await createCommandManagementAttestationHook(environment, {
          killProcessGroupImplementation:
            options.killProcessGroupImplementation,
          processGroupAliveImplementation:
            options.processGroupAliveImplementation,
          processGroupJoinMilliseconds: options.processGroupJoinMilliseconds,
          spawnImplementation: options.spawnImplementation,
        })
    }
    if (
      !recoveryOnly &&
      options.requireManagementObservation === true &&
      typeof managementAttestationHookImplementation !== "function"
    ) {
      throw fixedError("ff029_hosted_management_observation_required")
    }
    const managementObserverDigest =
      options.managementObserverDigest ??
      managementAttestationHookImplementation?.observerDigest
    if (
      !recoveryOnly &&
      options.requireManagementObservation === true &&
      !/^[0-9a-f]{64}$/.test(managementObserverDigest ?? "")
    ) {
      throw fixedError("ff029_hosted_management_observer_digest_invalid")
    }
    const cleanupJournal = await createHostedCleanupJournal({
      stateRoot,
      sourceRevision: configuration.sourceRevision,
      nowMilliseconds,
      nowImplementation: options.nowImplementation,
    })
    const mailbox =
      options.mailboxImplementation ??
      (await createEtherealImapMailbox({
        ...configuration.ethereal,
        cleanupQuietPeriodMilliseconds:
          FF029_HOSTED_ETHEREAL_CLEANUP_QUIET_PERIOD_MILLISECONDS,
      }))
    const adapter = await createHostedSupabaseEmailProofAdapter({
      cleanupOnly: recoveryOnly,
      anonKey: configuration.anonKey,
      serviceRoleKey: configuration.serviceRoleKey,
      pacingAttestation: configuration.pacingAttestation,
      cleanupJournal,
      mailboxImplementation: mailbox,
      fetchImplementation: options.fetchImplementation,
      createClientImplementation: options.createClientImplementation,
      requestTimeoutMilliseconds: configuration.requestTimeoutMilliseconds,
      requestAbortJoinMilliseconds: configuration.cleanupAbortJoinMilliseconds,
      nowImplementation: options.nowImplementation,
      sleepImplementation: options.sleepImplementation,
      expirySleepImplementation: options.expirySleepImplementation,
      verificationPacerImplementation: options.verificationPacerImplementation,
    })
    return Object.freeze({
      adapter,
      cleanupJournal,
      configuration,
      lock,
      managementAttestationHookImplementation,
      managementObserverDigest,
      recoveryOnly,
      repositoryRoot,
      stateRoot,
    })
  } catch (error) {
    await lock.release()
    throw error
  }
}

async function waitForQuarantineRecoveryQuietPeriod(foundation, options) {
  const authorization = foundation.lock.recoveryAuthorization
  if (
    foundation.lock.quarantineRecovery !== true ||
    authorization == null ||
    authorization.quietPeriodMilliseconds <
      foundation.configuration.requestTimeoutMilliseconds
  ) {
    throw fixedError("ff029_hosted_quarantine_recovery_authorization_invalid")
  }
  const sleepImplementation =
    options.quarantineRecoverySleepImplementation ??
    ((milliseconds) =>
      new Promise((resolvePromise) => {
        setTimeout(resolvePromise, milliseconds)
      }))
  const nowImplementation = options.nowImplementation ?? Date.now
  if (
    typeof sleepImplementation !== "function" ||
    typeof nowImplementation !== "function"
  ) {
    throw fixedError("ff029_hosted_quarantine_recovery_fence_invalid")
  }
  await foundation.lock.assertRecoveryIsolation()
  const quietPeriodDeadline =
    nowImplementation() + authorization.quietPeriodMilliseconds
  if (
    !Number.isSafeInteger(quietPeriodDeadline) ||
    quietPeriodDeadline >= foundation.configuration.absoluteTotalDeadline
  ) {
    throw fixedError("ff029_hosted_quarantine_recovery_window_exhausted")
  }
  await sleepImplementation(authorization.quietPeriodMilliseconds)
  if (nowImplementation() > quietPeriodDeadline) {
    throw fixedError("ff029_hosted_quarantine_recovery_window_exhausted")
  }
  await foundation.lock.assertRecoveryIsolation()
}

export async function runHostedSupabaseEmailProofSupersessionCanary(
  options = {},
) {
  const foundation = await createHostedRunnerFoundation({
    ...options,
    requireEvidenceTargetAvailable:
      options.serializeEvidenceImplementation !== undefined,
    requireManagementObservation:
      options.serializeEvidenceImplementation !== undefined,
  })
  try {
    if (foundation.recoveryOnly) {
      if (foundation.lock.quarantineRecovery === true) {
        const firstReconciliation = await runFf029CleanupWithAbortAndJoin(
          foundation.adapter,
          false,
          foundation.configuration.cleanupBudgetMilliseconds,
          foundation.configuration.cleanupAbortJoinMilliseconds,
          foundation.configuration.absoluteTotalDeadline,
          { retainRecoveryState: true },
        )
        if (firstReconciliation.status !== "completed") {
          throw fixedError("ff029_hosted_cleanup_failed")
        }
        foundation.adapter.assertNoUnsettledOperations?.()
        await waitForQuarantineRecoveryQuietPeriod(foundation, options)
      }
      const finalReconciliation = await runFf029CleanupWithAbortAndJoin(
        foundation.adapter,
        false,
        foundation.configuration.cleanupBudgetMilliseconds,
        foundation.configuration.cleanupAbortJoinMilliseconds,
        foundation.configuration.absoluteTotalDeadline,
      )
      if (finalReconciliation.status !== "completed") {
        throw fixedError("ff029_hosted_cleanup_failed")
      }
      foundation.adapter.assertNoUnsettledOperations?.()
      await foundation.lock.assertRecoveryIsolation()
      const retainedCleanupState = await readHostedCleanupStateIfPresent(
        hostedCleanupJournalPath(foundation.stateRoot),
      )
      if (retainedCleanupState !== null) {
        throw fixedError("ff029_hosted_quarantine_recovery_incomplete")
      }
      await foundation.lock.clearStickyQuarantine()
      return Object.freeze({
        status: "resumed_cleanup_completed",
        report: null,
        managementObservations: Object.freeze([]),
      })
    }
    const managementAttestationHookImplementation =
      foundation.managementAttestationHookImplementation
    const observerDigest = foundation.managementObserverDigest
    const managementObservations = []
    const runNonce = randomBytes(32).toString("hex")
    const nowImplementation = options.nowImplementation ?? Date.now
    const runCanaryImplementation =
      options.runCanaryImplementation ?? runSupabaseEmailProofSupersessionCanary
    if (typeof runCanaryImplementation !== "function") {
      throw fixedError("ff029_hosted_runner_invalid")
    }
    const initialProvenanceImplementation =
      options.initialProvenanceImplementation ?? buildHostedProvenance
    if (typeof initialProvenanceImplementation !== "function") {
      throw fixedError("ff029_hosted_provenance_implementation_invalid")
    }
    requireHostedFinalizationTime(foundation.configuration, nowImplementation())
    const provenance =
      options.provenance ??
      (await initialProvenanceImplementation(
        foundation.configuration,
        foundation.repositoryRoot,
        {
          absoluteDeadline: foundation.configuration.absoluteTotalDeadline,
          nowImplementation,
        },
      ))
    requireHostedFinalizationTime(foundation.configuration, nowImplementation())
    const preflightObservation = await runManagementLimitsObservationHook(
      managementAttestationHookImplementation,
      "preflight",
      foundation.configuration,
      provenance,
      runNonce,
      nowImplementation,
    )
    if (preflightObservation !== null) {
      managementObservations.push(preflightObservation)
    }
    const remainingBudgets = remainingHostedExecutionBudgets(
      foundation.configuration,
      nowImplementation(),
    )
    const executionBudgetMilliseconds =
      remainingBudgets.totalBudgetMilliseconds -
      foundation.configuration.finalizationBudgetMilliseconds
    const absoluteExecutionDeadline =
      foundation.configuration.absoluteTotalDeadline -
      foundation.configuration.finalizationBudgetMilliseconds
    if (
      executionBudgetMilliseconds <=
        remainingBudgets.cleanupBudgetMilliseconds ||
      absoluteExecutionDeadline <= nowImplementation()
    ) {
      throw fixedError("ff029_hosted_execution_window_exhausted")
    }
    const report = await runCanaryImplementation(foundation.adapter, {
      evidenceProfile: "hosted_v4",
      operationTimeoutMilliseconds:
        foundation.configuration.operationTimeoutMilliseconds,
      totalBudgetMilliseconds: executionBudgetMilliseconds,
      cleanupBudgetMilliseconds: remainingBudgets.cleanupBudgetMilliseconds,
      cleanupAbortJoinMilliseconds:
        foundation.configuration.cleanupAbortJoinMilliseconds,
      absoluteTotalDeadline: foundation.configuration.absoluteTotalDeadline,
      absoluteExecutionDeadline,
      provenance,
    })
    requireHostedFinalizationTime(foundation.configuration, nowImplementation())
    const postflightObservation = await runManagementLimitsObservationHook(
      managementAttestationHookImplementation,
      "postflight",
      foundation.configuration,
      provenance,
      runNonce,
      nowImplementation,
    )
    if (postflightObservation !== null) {
      managementObservations.push(postflightObservation)
    }
    requireHostedFinalizationTime(foundation.configuration, nowImplementation())
    if (options.serializeEvidenceImplementation !== undefined) {
      if (typeof options.serializeEvidenceImplementation !== "function") {
        throw fixedError("ff029_hosted_serializer_invalid")
      }
      await revalidateHostedProvenance(
        foundation.configuration,
        foundation.repositoryRoot,
        provenance,
        options,
      )
      requireHostedFinalizationTime(
        foundation.configuration,
        nowImplementation(),
      )
      const serialized = options.serializeEvidenceImplementation(report)
      requireHostedFinalizationTime(
        foundation.configuration,
        nowImplementation(),
      )
      assertSerializedEvidenceMatchesCleanup(serialized, report)
      const forbiddenValues = [
        foundation.configuration.anonKey,
        foundation.configuration.serviceRoleKey,
        foundation.configuration.ethereal.user,
        foundation.configuration.ethereal.password,
      ]
      const hostedEvidence = serializeHostedManagementEvidence(
        serialized,
        managementObservations,
        foundation.configuration,
        runNonce,
        observerDigest,
      )
      requireHostedFinalizationTime(
        foundation.configuration,
        nowImplementation(),
      )
      const evidencePath = await writeHostedEvidence(hostedEvidence, {
        repositoryRoot: foundation.repositoryRoot,
        forbiddenValues,
        absoluteDeadline: foundation.configuration.absoluteTotalDeadline,
        nowImplementation,
      })
      try {
        requireHostedFinalizationTime(
          foundation.configuration,
          nowImplementation(),
        )
      } catch (error) {
        await rm(evidencePath, { force: true })
        throw error
      }
      return Object.freeze({
        status: "completed",
        report,
        managementObservations: Object.freeze(managementObservations),
        evidence: Object.freeze({
          path: evidencePath,
        }),
      })
    }
    return Object.freeze({
      status: "completed",
      report,
      managementObservations: Object.freeze(managementObservations),
      evidence: null,
    })
  } catch (error) {
    if (
      requiresFf029ExclusiveOwnershipRetention(error) ||
      error?.ff029RetainExclusiveOwnership === true
    ) {
      const activeObserverProcessGroupIds =
        foundation.managementAttestationHookImplementation?.activeProcessGroupIds?.() ??
        []
      await foundation.lock.retain({
        processGroupIds: [
          ...retainedProcessGroupIds(error),
          ...activeObserverProcessGroupIds,
        ],
      })
    }
    throw error
  } finally {
    await foundation.lock.release()
  }
}

export async function assertHostedPrivateArtifactModes(
  repositoryRoot = process.cwd(),
  options = {},
) {
  const root = await realpath(resolve(repositoryRoot))
  const evidence = hostedEvidencePath(root)
  const stateRoot = hostedMachineStateRoot(options.stateRoot)
  const journal = hostedCleanupJournalPath(stateRoot)
  const result = {}
  for (const [name, path] of [
    ["evidence", evidence],
    ["journal", journal],
  ]) {
    try {
      const metadata = await stat(path)
      result[name] = metadata.mode & 0o777
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      result[name] = null
    }
  }
  return Object.freeze(result)
}

async function main() {
  try {
    const result = await runHostedSupabaseEmailProofSupersessionCanary({
      serializeEvidenceImplementation:
        serializeSupabaseEmailProofSupersessionEvidence,
    })
    if (result.status === "resumed_cleanup_completed") {
      process.stderr.write("ff029_hosted_cleanup_resumed\n")
      process.exitCode = 1
      return
    }
    process.exitCode =
      result.report?.scope === "hosted_staging" &&
      result.report?.project_ref === FF029_HOSTED_PROJECT_REF &&
      result.report?.hosted_observation === "observed" &&
      result.report?.cleanup === "completed" &&
      result.managementObservations?.length === 2 &&
      typeof result.evidence?.path === "string"
        ? 0
        : 1
  } catch (error) {
    const code =
      error instanceof Error && /^ff029_[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "ff029_hosted_runner_failed"
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void main()
}
