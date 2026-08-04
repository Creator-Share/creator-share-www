import { randomBytes } from "node:crypto"
import {
  chmod,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { createClient } from "@supabase/supabase-js"

import {
  createBoundedLocalSupabaseFetch,
  discoverLocalSupabaseHttp,
  loadLocalSupabaseHttpProvenance,
} from "./support/local-supabase-http.mjs"

const GATE = "postgrest_role_claim_compatibility"
const SCOPE = "local_mechanics_only"
const EXPECTED_CASE_COUNT = 90
const EXECUTION_TIMEOUT_MILLISECONDS = 120_000
const CLEANUP_TIMEOUT_MILLISECONDS = 20_000
const TERMINATION_PROBE_TIMEOUT_MILLISECONDS = 15_000
const FIXTURE_CLEANUP_POLL_INTERVAL_MILLISECONDS = 150
const FIXTURE_CLEANUP_SETTLED_QUIET_MILLISECONDS = 1_000
const FIXTURE_CLEANUP_UNCERTAIN_QUIET_MILLISECONDS = 15_000
const MAXIMUM_EVIDENCE_DIRECTORY_ENTRIES = 10_000
const AUTH_USER_PAGE_SIZE = 25
const AUTH_USER_MAXIMUM_PAGES = 400
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const FIXTURE_NAMESPACE_PATTERN = /^[0-9a-f]{24}$/
const TERMINATION_PROBE_PHASES = new Set([
  "auth_fixture_ready",
  "evidence_write_started",
])
const SHA_REVISION_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const MIGRATION_BOUNDARY_PATTERN = /^[0-9]{14}_[a-z0-9_-]+$/
const CASE_ID_PATTERN = /^[a-z0-9_]{1,120}$/
const FIXED_ERROR_PATTERN = /^[a-z0-9_]{1,180}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,63})?$/
const COMPONENT_IMAGE_PATTERN =
  /^public\.ecr\.aws\/supabase\/(?:kong|gotrue|postgrest):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const EVIDENCE_PATH = resolveOptionalPath(
  process.env.ADVOCATE_POSTGREST_ROLE_HTTP_EVIDENCE_PATH ??
    "test-results/database/advocate-postgrest-role-http-evidence.json",
  "postgrest_role_evidence_path_invalid",
)
if (EVIDENCE_PATH === null || basename(EVIDENCE_PATH).length === 0) {
  throw fixedError("postgrest_role_evidence_path_invalid")
}
const EVIDENCE_DIRECTORY = dirname(EVIDENCE_PATH)
const EVIDENCE_BASENAME = basename(EVIDENCE_PATH)
const TEMPORARY_EVIDENCE_PATH = `${EVIDENCE_PATH}.tmp-${process.pid}`
const HARNESS_PATHS = Object.freeze([
  "tests/database/postgrest-role-claim-http.mjs",
  "tests/database/postgrest-role-claim-http-termination.mjs",
  "tests/database/support/local-supabase-http.mjs",
])
const COMPATIBILITY_TEST_PATH =
  "supabase/tests/postgrest_role_claim_compatibility.test.sql"

const SERVICE_RPCS = Object.freeze([
  Object.freeze({
    id: "issue_payment_quote",
    name: "issue_sponsorship_payment_quote_v2",
    body: Object.freeze({
      target_checkout_operation_id: null,
      target_sponsorship_intent_id: null,
      target_quote_idempotency_key: null,
    }),
    expectedMessage: "V2 payment quote issuance scope is invalid",
  }),
  Object.freeze({
    id: "record_exposure",
    name: "record_qualified_advocate_exposure",
    body: Object.freeze({
      target_event_key: null,
      target_visitor_token_digest: null,
      target_advocate_hostname: null,
      target_consent_state: null,
    }),
    expectedMessage: "Qualified advocate exposure identity is malformed",
  }),
  Object.freeze({
    id: "read_paypal_capture",
    name: "read_paypal_checkout_capture_material_v2",
    body: Object.freeze({
      target_checkout_receipt_digest: null,
      target_checkout_operation_id: null,
    }),
    expectedMessage: "PayPal checkout capture scope is malformed",
  }),
  Object.freeze({
    id: "claim_subscription_cancellation",
    name: "claim_sponsorship_subscription_cancellation",
    body: Object.freeze({
      target_cancellation_operation_id: null,
      target_lease_owner: null,
    }),
    expectedMessage: "Subscription cancellation claim is malformed",
  }),
  Object.freeze({
    id: "start_retention",
    name: "start_data_retention_run",
    body: Object.freeze({
      run_id: null,
      batch_size: null,
      request_id: null,
      trace_id: null,
    }),
    expectedMessage: "Data retention run id must be a nonzero UUID",
  }),
  Object.freeze({
    id: "claim_logo_reconciliation",
    name: "claim_advocate_logo_reconciliation_jobs",
    body: Object.freeze({
      worker_id: null,
      batch_size: null,
      request_id: null,
    }),
    expectedMessage: "Logo reconciliation claim input is malformed",
  }),
  Object.freeze({
    id: "claim_invitation_email",
    name: "claim_advocate_invitation_email_jobs",
    body: Object.freeze({
      worker_id: "postgrest-role-canary",
      shared_email_proof_issuer_version: null,
    }),
    expectedMessage:
      "Shared advocate invitation email proof issuer version is invalid",
  }),
  Object.freeze({
    id: "refresh_public_metrics",
    name: "refresh_advocate_public_metric_releases",
    body: Object.freeze({
      batch_limit: 0,
      request_id: "postgrest-role-canary",
    }),
    expectedMessage:
      "Public metric refresh batch limit must be between 1 and 100",
  }),
])

const SPONSOR_RPCS = Object.freeze([
  Object.freeze({
    id: "list_one_time_history",
    name: "list_my_one_time_sponsorship_history",
    body: Object.freeze({ target_limit: 0 }),
    expectedStatus: 400,
    expectedCode: "22023",
    expectedMessage: "Sponsorship history limit must be between 1 and 100",
    validationBoundary: "downstream_input_validation",
  }),
  Object.freeze({
    id: "begin_subscription_cancellation",
    name: "begin_sponsorship_subscription_cancellation",
    body: Object.freeze({ target_subscription_id: null }),
    expectedStatus: 403,
    expectedCode: "42501",
    expectedMessage:
      "recent-verification-required: verify your email again to continue",
    validationBoundary: "recent_authentication",
  }),
])

function fixedError(code, cause) {
  return cause === undefined ? new Error(code) : new Error(code, { cause })
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false
  const observed = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    observed.length === expected.length &&
    observed.every((key, index) => key === expected[index])
  )
}

function resolveOptionalPath(value, code) {
  if (value === null || value === undefined) return null
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw fixedError(code)
  }
  return resolve(value)
}

function parseJson(value, code) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw fixedError(code, error)
  }
}

function decodeAccessToken(value) {
  if (typeof value !== "string") {
    throw fixedError("postgrest_role_auth_token_invalid")
  }
  const segments = value.split(".")
  if (
    segments.length !== 3 ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw fixedError("postgrest_role_auth_token_invalid")
  }
  const claims = parseJson(
    Buffer.from(segments[1], "base64url").toString("utf8"),
    "postgrest_role_auth_token_invalid",
  )
  if (!isRecord(claims)) {
    throw fixedError("postgrest_role_auth_token_invalid")
  }
  return claims
}

async function readJsonResponse(response, code) {
  let text
  try {
    text = await response.text()
  } catch (error) {
    throw fixedError(`${code}_read_failed`, error)
  }
  const value = parseJson(text, `${code}_invalid_json`)
  if (!isRecord(value)) throw fixedError(`${code}_shape_invalid`)
  return value
}

function requireExecutionTime(state) {
  if (
    state.terminationExitCode !== null ||
    state.executionController.signal.aborted ||
    Date.now() >= state.executionDeadline
  ) {
    throw fixedError("postgrest_role_execution_deadline_exhausted")
  }
}

function currentDeadline(state) {
  return state.phase === "cleanup"
    ? state.cleanupDeadline
    : state.executionDeadline
}

function currentSignal(state) {
  return state.phase === "cleanup"
    ? undefined
    : state.executionController.signal
}

async function sleepDuringCleanup(state, milliseconds) {
  if (Date.now() + milliseconds >= state.cleanupDeadline) {
    throw fixedError("postgrest_role_fixture_cleanup_deadline_exhausted")
  }
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

async function adminRequest(state, path, init) {
  if (!state.stack || !state.httpFetch) {
    throw fixedError("postgrest_role_admin_transport_unavailable")
  }
  return state.httpFetch(`${state.stack.apiOrigin}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: state.stack.legacyServiceRoleKey,
      Authorization: `Bearer ${state.stack.legacyServiceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
}

async function createAuthFixture(state) {
  requireExecutionTime(state)
  const identity = randomBytes(12).toString("hex")
  const fixtureIdentity = state.fixtureNamespace
    ? `${state.fixtureNamespace}-${identity}`
    : identity
  const email = `postgrest-role-claim-${fixtureIdentity}@example.test`
  const password = `PostgrestRole!${randomBytes(24).toString("base64url")}`
  state.trackedEmail = email
  state.createUserOutcome = "pending"
  state.createUserPromise = (async () => {
    try {
      const response = await adminRequest(state, "/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
        }),
      })
      if (response.status !== 200) {
        throw fixedError("postgrest_role_auth_user_create_failed")
      }
      const body = await readJsonResponse(
        response,
        "postgrest_role_auth_user_create",
      )
      if (
        typeof body.id !== "string" ||
        !UUID_PATTERN.test(body.id) ||
        body.email !== email ||
        typeof body.email_confirmed_at !== "string" ||
        !Number.isFinite(Date.parse(body.email_confirmed_at))
      ) {
        throw fixedError("postgrest_role_auth_user_create_shape_invalid")
      }
      state.trackedUserId = body.id
      state.createUserOutcome = "succeeded"
      return Object.freeze({ id: body.id, email, password })
    } catch (error) {
      state.createUserOutcome = "uncertain"
      throw error
    }
  })()
  return state.createUserPromise
}

async function signInFixture(state, fixture) {
  requireExecutionTime(state)
  const response = await state.httpFetch(
    `${state.stack.apiOrigin}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: state.stack.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: fixture.email,
        password: fixture.password,
      }),
    },
  )
  if (response.status !== 200) {
    throw fixedError("postgrest_role_auth_sign_in_failed")
  }
  const body = await readJsonResponse(response, "postgrest_role_auth_sign_in")
  const claims = decodeAccessToken(body.access_token)
  if (
    claims.sub !== fixture.id ||
    claims.email !== fixture.email ||
    claims.role !== "authenticated" ||
    typeof claims.session_id !== "string" ||
    !UUID_PATTERN.test(claims.session_id)
  ) {
    throw fixedError("postgrest_role_auth_sign_in_identity_mismatch")
  }
  return body.access_token
}

async function listTrackedUserIds(state) {
  if (state.trackedEmail === null) return new Set()
  const ids = new Set()
  let complete = false
  for (let page = 1; page <= AUTH_USER_MAXIMUM_PAGES; page += 1) {
    const response = await adminRequest(
      state,
      `/admin/users?page=${page}&per_page=${AUTH_USER_PAGE_SIZE}`,
      { method: "GET" },
    )
    if (response.status !== 200) {
      throw fixedError("postgrest_role_fixture_cleanup_discovery_failed")
    }
    const body = await readJsonResponse(
      response,
      "postgrest_role_fixture_cleanup_discovery",
    )
    if (!Array.isArray(body.users)) {
      throw fixedError("postgrest_role_fixture_cleanup_discovery_shape_invalid")
    }
    for (const candidate of body.users) {
      if (
        isRecord(candidate) &&
        typeof candidate.email === "string" &&
        candidate.email.toLowerCase() === state.trackedEmail &&
        typeof candidate.id === "string" &&
        UUID_PATTERN.test(candidate.id)
      ) {
        ids.add(candidate.id)
      } else if (
        isRecord(candidate) &&
        typeof candidate.email === "string" &&
        candidate.email.toLowerCase() === state.trackedEmail
      ) {
        throw fixedError("postgrest_role_fixture_cleanup_identity_invalid")
      }
    }
    if (body.users.length < AUTH_USER_PAGE_SIZE) {
      complete = true
      break
    }
  }
  if (!complete) {
    throw fixedError("postgrest_role_fixture_cleanup_discovery_incomplete")
  }
  return ids
}

async function deleteTrackedUser(state, userId) {
  if (!UUID_PATTERN.test(userId)) {
    throw fixedError("postgrest_role_fixture_cleanup_identity_invalid")
  }
  const response = await adminRequest(state, `/admin/users/${userId}`, {
    method: "DELETE",
  })
  if (![200, 204, 404].includes(response.status)) {
    throw fixedError("postgrest_role_fixture_cleanup_delete_failed")
  }
}

function cleanupFixture(state) {
  if (state.cleanupPromise) return state.cleanupPromise
  state.cleanupPromise = (async () => {
    state.phase = "cleanup"
    state.cleanupDeadline = Date.now() + CLEANUP_TIMEOUT_MILLISECONDS
    await state.createUserPromise?.catch(() => undefined)
    if (!state.stack || !state.httpFetch || state.trackedEmail === null) {
      state.cleanupVerified = true
      return
    }
    if (state.trackedUserId !== null) {
      await deleteTrackedUser(state, state.trackedUserId)
    }
    const quietInterval =
      state.createUserOutcome === "uncertain"
        ? FIXTURE_CLEANUP_UNCERTAIN_QUIET_MILLISECONDS
        : FIXTURE_CLEANUP_SETTLED_QUIET_MILLISECONDS
    let quietStartedAt = null
    let converged = false
    while (Date.now() < state.cleanupDeadline) {
      if (Date.now() >= state.cleanupDeadline) {
        throw fixedError("postgrest_role_fixture_cleanup_deadline_exhausted")
      }
      const ids = await listTrackedUserIds(state)
      if (ids.size > 0) {
        quietStartedAt = null
        for (const userId of ids) await deleteTrackedUser(state, userId)
      } else if (quietStartedAt === null) {
        quietStartedAt = Date.now()
      } else if (Date.now() - quietStartedAt >= quietInterval) {
        converged = true
        break
      }
      await sleepDuringCleanup(
        state,
        FIXTURE_CLEANUP_POLL_INTERVAL_MILLISECONDS,
      )
    }
    if (!converged) {
      throw fixedError("postgrest_role_fixture_cleanup_deadline_exhausted")
    }
    const remaining = await listTrackedUserIds(state)
    if (remaining.size !== 0) {
      throw fixedError("postgrest_role_fixture_cleanup_incomplete")
    }
    state.cleanupVerified = true
  })()
  return state.cleanupPromise
}

async function clearTerminationProbe(state) {
  if (state.terminationProbePath !== null) {
    await Promise.all([
      rm(state.terminationProbePath, { force: true }),
      rm(`${state.terminationProbePath}.tmp-${process.pid}`, { force: true }),
    ])
  }
}

async function waitForTerminationProbe(state, phase) {
  if (
    state.terminationProbePath === null ||
    state.terminationProbePhase !== phase
  ) {
    return
  }
  const signal = state.executionController.signal
  const temporaryPath = `${state.terminationProbePath}.tmp-${process.pid}`
  let resolveAbort
  const abortPromise = new Promise((resolveProbe) => {
    resolveAbort = resolveProbe
  })
  const handleAbort = () => resolveAbort()
  signal.addEventListener("abort", handleAbort, { once: true })
  if (signal.aborted) handleAbort()
  let timeout
  try {
    await mkdir(dirname(state.terminationProbePath), { recursive: true })
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ schemaVersion: 1, state: phase })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    )
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, state.terminationProbePath)
    await chmod(state.terminationProbePath, 0o600)
    const timeoutPromise = new Promise((_, rejectProbe) => {
      timeout = setTimeout(() => {
        rejectProbe(fixedError("postgrest_role_termination_probe_timed_out"))
      }, TERMINATION_PROBE_TIMEOUT_MILLISECONDS)
    })
    await Promise.race([abortPromise, timeoutPromise])
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener("abort", handleAbort)
  }
  throw fixedError("postgrest_role_termination_probe_not_terminated")
}

function createSdkClient(stack, key, httpFetch) {
  return createClient(stack.apiOrigin, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: httpFetch },
  })
}

async function invokeSdkRpc(client, definition) {
  const result = await client.rpc(definition.name, definition.body)
  if (
    !result.error ||
    typeof result.error.code !== "string" ||
    typeof result.error.message !== "string"
  ) {
    throw fixedError("postgrest_role_sdk_response_invalid")
  }
  return Object.freeze({
    status: result.status,
    code: result.error.code,
    message: result.error.message,
  })
}

async function invokeRawRpc(state, definition, credentials) {
  const headers = { "Content-Type": "application/json" }
  if (credentials.apiKey !== null) headers.apikey = credentials.apiKey
  if (credentials.bearerToken !== null) {
    headers.Authorization = `Bearer ${credentials.bearerToken}`
  }
  const response = await state.httpFetch(
    `${state.stack.restRoot}/rpc/${definition.name}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(definition.body),
    },
  )
  const body = await readJsonResponse(response, "postgrest_role_rpc_response")
  if (typeof body.code !== "string" || typeof body.message !== "string") {
    throw fixedError("postgrest_role_rpc_response_shape_invalid")
  }
  return Object.freeze({
    status: response.status,
    code: body.code,
    message: body.message,
  })
}

async function invokeProfile(state, profile, definition) {
  requireExecutionTime(state)
  return profile.sdkClient
    ? invokeSdkRpc(profile.sdkClient, definition)
    : invokeRawRpc(state, definition, profile.credentials)
}

async function runCase(state, evidenceCases, definition, profile, expected) {
  const caseId = `${definition.id}_${profile.id}`
  const observed = await invokeProfile(state, profile, definition)
  if (
    observed.status !== expected.status ||
    observed.code !== expected.code ||
    observed.message !== expected.message
  ) {
    throw fixedError(`postgrest_role_case_${caseId}_failed`)
  }
  evidenceCases.push(
    Object.freeze({
      caseId,
      persona: profile.persona,
      credentialProfile: profile.id,
      expectedHttpStatus: expected.status,
      observedHttpStatus: observed.status,
      sqlstate: observed.code,
      validationBoundary: expected.validationBoundary,
    }),
  )
}

async function runCompatibilityMatrix(state, authenticatedToken) {
  const legacyServiceClient = createSdkClient(
    state.stack,
    state.stack.legacyServiceRoleKey,
    state.httpFetch,
  )
  const currentSecretClient = createSdkClient(
    state.stack,
    state.stack.secretKey,
    state.httpFetch,
  )
  const currentPublishableClient = createSdkClient(
    state.stack,
    state.stack.publishableKey,
    state.httpFetch,
  )
  const serviceProfiles = [
    {
      id: "legacy_service_sdk",
      persona: "service",
      sdkClient: legacyServiceClient,
    },
    {
      id: "current_secret_sdk",
      persona: "service",
      sdkClient: currentSecretClient,
    },
    {
      id: "current_secret_canonical",
      persona: "service",
      credentials: {
        apiKey: state.stack.secretKey,
        bearerToken: null,
      },
    },
  ]
  const authenticatedProfiles = [
    {
      id: "authenticated_legacy",
      persona: "authenticated_sponsor",
      credentials: {
        apiKey: state.stack.legacyAnonKey,
        bearerToken: authenticatedToken,
      },
    },
    {
      id: "authenticated_publishable",
      persona: "authenticated_sponsor",
      credentials: {
        apiKey: state.stack.publishableKey,
        bearerToken: authenticatedToken,
      },
    },
  ]
  const anonymousProfiles = [
    {
      id: "anonymous_legacy",
      persona: "anonymous",
      credentials: {
        apiKey: state.stack.legacyAnonKey,
        bearerToken: state.stack.legacyAnonKey,
      },
    },
    {
      id: "anonymous_publishable",
      persona: "anonymous",
      credentials: {
        apiKey: state.stack.publishableKey,
        bearerToken: null,
      },
    },
    {
      id: "anonymous_publishable_sdk",
      persona: "anonymous",
      sdkClient: currentPublishableClient,
    },
    {
      id: "missing_credentials",
      persona: "missing_credentials",
      credentials: { apiKey: null, bearerToken: null },
    },
  ]
  const evidenceCases = []

  for (const definition of SERVICE_RPCS) {
    for (const profile of serviceProfiles) {
      await runCase(state, evidenceCases, definition, profile, {
        status: 400,
        code: "22023",
        message: definition.expectedMessage,
        validationBoundary: "downstream_input_validation",
      })
    }
    for (const profile of [...authenticatedProfiles, ...anonymousProfiles]) {
      await runCase(state, evidenceCases, definition, profile, {
        status: profile.persona === "authenticated_sponsor" ? 403 : 401,
        code: "42501",
        message: `permission denied for function ${definition.name}`,
        validationBoundary: "execute_grant",
      })
    }
  }

  for (const definition of SPONSOR_RPCS) {
    for (const profile of authenticatedProfiles) {
      await runCase(state, evidenceCases, definition, profile, {
        status: definition.expectedStatus,
        code: definition.expectedCode,
        message: definition.expectedMessage,
        validationBoundary: definition.validationBoundary,
      })
    }
    for (const profile of [...anonymousProfiles, ...serviceProfiles]) {
      await runCase(state, evidenceCases, definition, profile, {
        status:
          profile.persona === "anonymous" ||
          profile.persona === "missing_credentials"
            ? 401
            : 403,
        code: "42501",
        message: `permission denied for function ${definition.name}`,
        validationBoundary: "execute_grant",
      })
    }
  }

  if (
    evidenceCases.length !== EXPECTED_CASE_COUNT ||
    new Set(evidenceCases.map((entry) => entry.caseId)).size !==
      EXPECTED_CASE_COUNT
  ) {
    throw fixedError("postgrest_role_case_matrix_incomplete")
  }
  return Object.freeze(evidenceCases)
}

function validateEvidence(evidence) {
  const topLevelKeys = [
    "schemaVersion",
    "gate",
    "scope",
    "outcome",
    "hostedEvidenceRequired",
    "sourceRevision",
    "migrationBoundary",
    "migrationSetSha256",
    "appliedMigrationLedgerSha256",
    "harnessSha256",
    "compatibilityTestSha256",
    "versions",
    "caseCount",
    "cases",
    "fixtureCleanup",
    "completedAt",
  ]
  if (
    !exactKeys(evidence, topLevelKeys) ||
    evidence.schemaVersion !== 1 ||
    evidence.gate !== GATE ||
    evidence.scope !== SCOPE ||
    evidence.outcome !== "passed" ||
    evidence.hostedEvidenceRequired !== true ||
    !SHA_REVISION_PATTERN.test(evidence.sourceRevision ?? "") ||
    !MIGRATION_BOUNDARY_PATTERN.test(evidence.migrationBoundary ?? "") ||
    !SHA256_PATTERN.test(evidence.migrationSetSha256 ?? "") ||
    !SHA256_PATTERN.test(evidence.appliedMigrationLedgerSha256 ?? "") ||
    !SHA256_PATTERN.test(evidence.harnessSha256 ?? "") ||
    !SHA256_PATTERN.test(evidence.compatibilityTestSha256 ?? "") ||
    evidence.caseCount !== EXPECTED_CASE_COUNT ||
    !Array.isArray(evidence.cases) ||
    evidence.cases.length !== EXPECTED_CASE_COUNT ||
    evidence.fixtureCleanup !== "verified" ||
    typeof evidence.completedAt !== "string" ||
    !Number.isFinite(Date.parse(evidence.completedAt))
  ) {
    throw fixedError("postgrest_role_evidence_invalid")
  }
  if (
    !exactKeys(evidence.versions, [
      "supabaseCli",
      "supabaseJs",
      "gatewayImage",
      "authImage",
      "postgrestImage",
      "databaseImage",
      "postgresqlMajor",
    ]) ||
    !VERSION_PATTERN.test(evidence.versions.supabaseCli ?? "") ||
    !VERSION_PATTERN.test(evidence.versions.supabaseJs ?? "") ||
    !COMPONENT_IMAGE_PATTERN.test(evidence.versions.gatewayImage ?? "") ||
    !COMPONENT_IMAGE_PATTERN.test(evidence.versions.authImage ?? "") ||
    !COMPONENT_IMAGE_PATTERN.test(evidence.versions.postgrestImage ?? "") ||
    !/^public\.ecr\.aws\/supabase\/postgres:[0-9][A-Za-z0-9._-]{0,127}$/.test(
      evidence.versions.databaseImage ?? "",
    ) ||
    !Number.isSafeInteger(evidence.versions.postgresqlMajor) ||
    evidence.versions.postgresqlMajor < 1
  ) {
    throw fixedError("postgrest_role_evidence_versions_invalid")
  }
  const personas = new Set([
    "service",
    "authenticated_sponsor",
    "anonymous",
    "missing_credentials",
  ])
  const credentialProfiles = new Set([
    "legacy_service_sdk",
    "current_secret_sdk",
    "current_secret_canonical",
    "authenticated_legacy",
    "authenticated_publishable",
    "anonymous_legacy",
    "anonymous_publishable",
    "anonymous_publishable_sdk",
    "missing_credentials",
  ])
  const validationBoundaries = new Set([
    "downstream_input_validation",
    "execute_grant",
    "recent_authentication",
  ])
  for (const entry of evidence.cases) {
    if (
      !exactKeys(entry, [
        "caseId",
        "persona",
        "credentialProfile",
        "expectedHttpStatus",
        "observedHttpStatus",
        "sqlstate",
        "validationBoundary",
      ]) ||
      !CASE_ID_PATTERN.test(entry.caseId ?? "") ||
      !personas.has(entry.persona) ||
      !credentialProfiles.has(entry.credentialProfile) ||
      ![400, 401, 403].includes(entry.expectedHttpStatus) ||
      entry.observedHttpStatus !== entry.expectedHttpStatus ||
      !new Set(["22023", "42501"]).has(entry.sqlstate) ||
      !validationBoundaries.has(entry.validationBoundary)
    ) {
      throw fixedError("postgrest_role_evidence_case_invalid")
    }
  }
  if (
    new Set(evidence.cases.map((entry) => entry.caseId)).size !==
    EXPECTED_CASE_COUNT
  ) {
    throw fixedError("postgrest_role_evidence_case_duplicate")
  }
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  const forbidden = [
    /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/i,
    /\bBearer\b/i,
    /\bAuthorization\b/i,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    /https?:\/\//i,
    /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  ]
  if (forbidden.some((pattern) => pattern.test(serialized))) {
    throw fixedError("postgrest_role_evidence_contains_sensitive_material")
  }
  return serialized
}

async function clearEvidence() {
  await Promise.all([
    rm(EVIDENCE_PATH, { force: true }),
    rm(TEMPORARY_EVIDENCE_PATH, { force: true }),
  ])
  let entries
  try {
    entries = await readdir(EVIDENCE_DIRECTORY)
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw fixedError("postgrest_role_evidence_directory_read_failed", error)
  }
  if (entries.length > MAXIMUM_EVIDENCE_DIRECTORY_ENTRIES) {
    throw fixedError("postgrest_role_evidence_directory_too_large")
  }
  const temporaryPrefix = `${EVIDENCE_BASENAME}.tmp-`
  const temporaryEvidencePaths = entries
    .filter(
      (entry) =>
        entry.startsWith(temporaryPrefix) &&
        /^[1-9][0-9]*$/.test(entry.slice(temporaryPrefix.length)),
    )
    .map((entry) => resolve(EVIDENCE_DIRECTORY, entry))
  await Promise.all(
    temporaryEvidencePaths.map((path) => rm(path, { force: true })),
  )
}

async function writeEvidence(evidence, state) {
  const serialized = validateEvidence(evidence)
  await mkdir(dirname(EVIDENCE_PATH), { recursive: true })
  await rm(TEMPORARY_EVIDENCE_PATH, { force: true })
  const handle = await open(TEMPORARY_EVIDENCE_PATH, "wx", 0o600)
  try {
    await handle.writeFile(serialized, "utf8")
    await waitForTerminationProbe(state, "evidence_write_started")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(TEMPORARY_EVIDENCE_PATH, 0o600)
  await rename(TEMPORARY_EVIDENCE_PATH, EVIDENCE_PATH)
  await chmod(EVIDENCE_PATH, 0o600)
}

function safeFailureCode(error) {
  return typeof error?.message === "string" &&
    FIXED_ERROR_PATTERN.test(error.message)
    ? error.message
    : "postgrest_role_gate_failed"
}

function installTerminationCleanup(state) {
  const listeners = new Map()
  for (const [signal, exitCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const listener = () => {
      if (state.terminationExitCode !== null) return
      state.terminationExitCode = exitCode
      process.exitCode = exitCode
      const createUserSettlement = state.createUserPromise
        ? Promise.resolve(state.createUserPromise).catch(() => undefined)
        : Promise.resolve()
      if (state.createUserPromise === null) state.executionController.abort()
      const hardStop = setTimeout(() => process.exit(exitCode), 30_000)
      createUserSettlement
        .then(() => state.executionController.abort())
        .then(() => Promise.resolve(state.evidenceWritePromise))
        .catch(() => undefined)
        .then(() => cleanupFixture(state))
        .then(clearEvidence)
        .then(() => clearTerminationProbe(state))
        .catch(() => {
          process.stderr.write(
            "PostgREST role claim fixture cleanup failed during termination\n",
          )
        })
        .finally(() => {
          clearTimeout(hardStop)
          process.exit(exitCode)
        })
    }
    listeners.set(signal, listener)
    process.on(signal, listener)
  }
  return () => {
    for (const [signal, listener] of listeners) {
      process.removeListener(signal, listener)
    }
  }
}

export async function runPostgrestRoleClaimHttpGate(options = {}) {
  const workspace = resolve(options.workspace ?? process.cwd())
  if (
    options.fixtureNamespace !== undefined &&
    !FIXTURE_NAMESPACE_PATTERN.test(options.fixtureNamespace)
  ) {
    throw fixedError("postgrest_role_fixture_namespace_invalid")
  }
  if (
    options.terminationProbePhase !== undefined &&
    !TERMINATION_PROBE_PHASES.has(options.terminationProbePhase)
  ) {
    throw fixedError("postgrest_role_termination_probe_phase_invalid")
  }
  if (
    options.terminationProbePhase !== undefined &&
    options.terminationProbePath === undefined
  ) {
    throw fixedError("postgrest_role_termination_probe_scope_invalid")
  }
  const state = {
    stack: null,
    httpFetch: null,
    phase: "execution",
    executionDeadline: Date.now() + EXECUTION_TIMEOUT_MILLISECONDS,
    cleanupDeadline: 0,
    executionController: new AbortController(),
    createUserPromise: null,
    createUserOutcome: "not_started",
    cleanupPromise: null,
    cleanupVerified: false,
    fixtureNamespace: options.fixtureNamespace ?? null,
    trackedEmail: null,
    trackedUserId: null,
    terminationExitCode: null,
    evidenceWritePromise: null,
    terminationProbePath: resolveOptionalPath(
      options.terminationProbePath,
      "postgrest_role_termination_probe_path_invalid",
    ),
    terminationProbePhase:
      options.terminationProbePath === undefined
        ? null
        : (options.terminationProbePhase ?? "auth_fixture_ready"),
  }
  const executionTimer = setTimeout(
    () => state.executionController.abort(),
    EXECUTION_TIMEOUT_MILLISECONDS,
  )
  const uninstallTerminationCleanup = installTerminationCleanup(state)
  let provenance
  let cases
  try {
    await clearEvidence()
    await clearTerminationProbe(state)
    state.stack = await discoverLocalSupabaseHttp({ workspace })
    state.httpFetch = createBoundedLocalSupabaseFetch({
      allowedOrigin: state.stack.apiOrigin,
      allowedPathPrefixes: ["/auth/v1/", "/rest/v1/"],
      requestTimeoutMilliseconds: 5_000,
      getAbsoluteDeadline: () => currentDeadline(state),
      getSignal: () => currentSignal(state),
    })
    provenance = await loadLocalSupabaseHttpProvenance(state.stack, {
      harnessPaths: HARNESS_PATHS,
      compatibilityTestPath: COMPATIBILITY_TEST_PATH,
      expectedSourceRevision: options.expectedSourceRevision,
      requireCleanCheckout: options.expectedSourceRevision !== undefined,
    })
    const fixture = await createAuthFixture(state)
    const authenticatedToken = await signInFixture(state, fixture)
    await waitForTerminationProbe(state, "auth_fixture_ready")
    cases = await runCompatibilityMatrix(state, authenticatedToken)
    await cleanupFixture(state)
    if (!state.cleanupVerified) {
      throw fixedError("postgrest_role_fixture_cleanup_unverified")
    }
  } catch (error) {
    let cleanupError
    try {
      await cleanupFixture(state)
    } catch (candidate) {
      cleanupError = candidate
    }
    await clearEvidence().catch(() => undefined)
    await clearTerminationProbe(state).catch(() => undefined)
    if (state.terminationExitCode === null) uninstallTerminationCleanup()
    if (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "postgrest_role_gate_and_cleanup_failed",
      )
    }
    throw error
  } finally {
    clearTimeout(executionTimer)
  }

  const evidence = {
    schemaVersion: 1,
    gate: GATE,
    scope: SCOPE,
    outcome: "passed",
    hostedEvidenceRequired: true,
    sourceRevision: provenance.sourceRevision,
    migrationBoundary: provenance.migrationBoundary,
    migrationSetSha256: provenance.migrationSetSha256,
    appliedMigrationLedgerSha256: provenance.appliedMigrationLedgerSha256,
    harnessSha256: provenance.harnessSha256,
    compatibilityTestSha256: provenance.compatibilityTestSha256,
    versions: provenance.versions,
    caseCount: cases.length,
    cases,
    fixtureCleanup: "verified",
    completedAt: new Date().toISOString(),
  }
  if (state.terminationExitCode !== null) {
    throw fixedError("postgrest_role_termination_requested")
  }
  try {
    state.evidenceWritePromise = writeEvidence(evidence, state)
    await state.evidenceWritePromise
    if (state.terminationExitCode !== null) {
      throw fixedError("postgrest_role_termination_requested")
    }
    return evidence
  } catch (error) {
    await clearEvidence().catch(() => undefined)
    throw error
  } finally {
    uninstallTerminationCleanup()
  }
}

async function main() {
  const expectedSourceRevision =
    process.env.ADVOCATE_POSTGREST_ROLE_HTTP_SOURCE_REVISION
  const terminationProbePath =
    process.env.ADVOCATE_POSTGREST_ROLE_HTTP_TERMINATION_PROBE_PATH
  const terminationProbePhase =
    process.env.ADVOCATE_POSTGREST_ROLE_HTTP_TERMINATION_PROBE_PHASE
  const fixtureNamespace =
    process.env.ADVOCATE_POSTGREST_ROLE_HTTP_FIXTURE_NAMESPACE
  if (
    expectedSourceRevision !== undefined &&
    !SHA_REVISION_PATTERN.test(expectedSourceRevision)
  ) {
    process.stderr.write(
      "PostgREST role claim compatibility gate failed: postgrest_role_source_revision_invalid\n",
    )
    process.exitCode = 1
    return
  }
  if (
    fixtureNamespace !== undefined &&
    !FIXTURE_NAMESPACE_PATTERN.test(fixtureNamespace)
  ) {
    process.stderr.write(
      "PostgREST role claim compatibility gate failed: postgrest_role_fixture_namespace_invalid\n",
    )
    process.exitCode = 1
    return
  }
  if (
    terminationProbePhase !== undefined &&
    !TERMINATION_PROBE_PHASES.has(terminationProbePhase)
  ) {
    process.stderr.write(
      "PostgREST role claim compatibility gate failed: postgrest_role_termination_probe_phase_invalid\n",
    )
    process.exitCode = 1
    return
  }
  try {
    const evidence = await runPostgrestRoleClaimHttpGate({
      expectedSourceRevision,
      terminationProbePath,
      terminationProbePhase,
      fixtureNamespace,
    })
    process.stdout.write(
      `PostgREST role claim compatibility gate passed: ${evidence.caseCount} cases\n`,
    )
  } catch (error) {
    if (process.exitCode === 130 || process.exitCode === 143) return
    process.stderr.write(
      `PostgREST role claim compatibility gate failed: ${safeFailureCode(error)}\n`,
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
