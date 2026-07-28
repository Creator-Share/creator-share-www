import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { expect, test } from "@playwright/test"

/**
 * What the harness records when an interrupted operation stops being waited
 * for. `joinedWithinBudget` false means the join budget expired, which is the
 * only mechanism that can invert the ordering this file asserts.
 */
interface Ff029JoinRecord {
  interruption: string
  join: string
  joinedWithinBudget: boolean
  effectiveJoinBudgetMilliseconds: number
  operationBudgetMilliseconds: number
  interruptedAt: number
  joinResolvedAt: number
  joinWaitMilliseconds: number
}

const ADAPTER_PATH = resolve(
  process.cwd(),
  "tests/provider/support/hosted-supabase-email-proof-adapter.mjs",
)
const RUNNER_PATH = resolve(
  process.cwd(),
  "tests/provider/supabase-email-proof-supersession-hosted.mjs",
)
const CORE_PATH = resolve(
  process.cwd(),
  "tests/provider/support/supabase-email-proof-supersession.mjs",
)
const MAILBOX_PATH = resolve(
  process.cwd(),
  "tests/provider/support/ethereal-imap-mailbox.mjs",
)

type HostedAdapterModule =
  typeof import("./support/hosted-supabase-email-proof-adapter.mjs")
type HostedRunnerModule =
  typeof import("./supabase-email-proof-supersession-hosted.mjs")
type CoreModule =
  typeof import("./support/supabase-email-proof-supersession.mjs")

const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<HostedAdapterModule>
const nativeRunnerImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<HostedRunnerModule>
const nativeCoreImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<CoreModule>

let hosted: HostedAdapterModule
let runner: HostedRunnerModule
let core: CoreModule
let isolatedModuleRoot: string | undefined

test.beforeAll(async () => {
  isolatedModuleRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-module-graph-"),
  )
  const isolatedSupportRoot = resolve(isolatedModuleRoot, "support")
  await mkdir(isolatedSupportRoot, { mode: 0o700 })
  await Promise.all([
    copyFile(
      ADAPTER_PATH,
      resolve(isolatedSupportRoot, "hosted-supabase-email-proof-adapter.mjs"),
    ),
    copyFile(
      CORE_PATH,
      resolve(isolatedSupportRoot, "supabase-email-proof-supersession.mjs"),
    ),
    copyFile(
      MAILBOX_PATH,
      resolve(isolatedSupportRoot, "ethereal-imap-mailbox.mjs"),
    ),
    copyFile(
      RUNNER_PATH,
      resolve(
        isolatedModuleRoot,
        "supabase-email-proof-supersession-hosted.mjs",
      ),
    ),
  ])
  ;[hosted, runner, core] = await Promise.all([
    nativeImport(
      pathToFileURL(
        resolve(isolatedSupportRoot, "hosted-supabase-email-proof-adapter.mjs"),
      ).href,
    ),
    nativeRunnerImport(
      pathToFileURL(
        resolve(
          isolatedModuleRoot,
          "supabase-email-proof-supersession-hosted.mjs",
        ),
      ).href,
    ),
    nativeCoreImport(
      pathToFileURL(
        resolve(isolatedSupportRoot, "supabase-email-proof-supersession.mjs"),
      ).href,
    ),
  ])
})

test.afterAll(async () => {
  if (isolatedModuleRoot !== undefined) {
    await rm(isolatedModuleRoot, { recursive: true, force: true })
  }
})

function hostedKey(
  role: "anon" | "service_role",
  options: {
    expiresInMilliseconds?: number
    now?: number
    projectRef?: string
  } = {},
) {
  const now = options.now ?? Date.now()
  const expiresInMilliseconds =
    options.expiresInMilliseconds ?? 5 * 60 * 60 * 1_000
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      iss: "supabase",
      ref: options.projectRef ?? "destjwstohzmufshfnuy",
      role,
      iat: Math.floor(now / 1_000) - 60,
      exp: Math.floor((now + expiresInMilliseconds) / 1_000),
    }),
  ).toString("base64url")
  return `${header}.${payload}.${"s".repeat(43)}`
}

function pacingAttestation(
  now = Date.now(),
  overrides: Record<string, unknown> = {},
) {
  const value = {
    schema_version: 1,
    kind: "ff029_operator_supplied_auth_limits",
    attestation_source: "operator_supplied",
    project_ref: "destjwstohzmufshfnuy",
    supabase_origin: "https://destjwstohzmufshfnuy.supabase.co",
    application_origin: "https://advocate-staging.creatorshare.com",
    captured_at: new Date(now - 1_000).toISOString(),
    valid_until: new Date(now + 4 * 60 * 60 * 1_000 - 1_000).toISOString(),
    admin_generate_link_minimum_interval_milliseconds: 1_000,
    email_quota_minimum_interval_milliseconds: 30_000,
    recipient_minimum_interval_milliseconds: 1_000,
    email_otp_expiry_seconds: 60,
    maximum_concurrent_burst: 2,
    rate_limit_email_sent_per_hour: 120,
    rate_limit_otp_per_hour: 120,
    smtp_max_frequency_seconds: 1,
    verify_refill_per_hour: 360,
    verify_burst_capacity: 30,
    verify_minimum_interval_milliseconds: 10_000,
    ...overrides,
  }
  return {
    ...value,
    attestation_digest:
      typeof overrides.attestation_digest === "string"
        ? overrides.attestation_digest
        : hosted.hostedPacingAttestationDigest(value),
  }
}

function hostedEnvironment(
  now = Date.now(),
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    FF029_HOSTED_SUPABASE_ANON_KEY: hostedKey("anon", { now }),
    FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY: hostedKey("service_role", {
      now,
    }),
    FF029_HOSTED_PACING_ATTESTATION: JSON.stringify(pacingAttestation(now)),
    FF029_SOURCE_REVISION: "b".repeat(40),
    FF029_ETHEREAL_IMAP_USER: "ff029-runner@ethereal.email",
    FF029_ETHEREAL_IMAP_PASSWORD: "fixture-password-material",
    NODE_ENV: "test",
    ...overrides,
  }
}

type ManagementObservationRequest = {
  expected_config: Record<string, number>
  harness_digest: string
  issued_at: string
  management_api_origin: string
  not_after: string
  operator_attestation_digest: string
  phase: "postflight" | "preflight"
  project_ref: string
  request_digest: string
  request_nonce: string
  run_nonce: string
  source_revision: string
  supabase_origin: string
}

function canonicalJson(value: unknown) {
  function normalize(candidate: unknown): unknown {
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return candidate
    }
    if (typeof candidate === "number") {
      if (!Number.isSafeInteger(candidate)) {
        throw new Error("test_canonical_json_invalid")
      }
      return candidate
    }
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
      throw new Error("test_canonical_json_invalid")
    }
    const record = candidate as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalize(record[key])]),
    )
  }
  return JSON.stringify(normalize(value))
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function managementObservation(request: ManagementObservationRequest) {
  return {
    schema_version: 1,
    kind: "ff029_authenticated_management_auth_limits_observation",
    authentication: "supabase_management_api_personal_access_token",
    credential_source: "supabase_cli_native_keychain",
    http_status: 200,
    phase: request.phase,
    project_ref: request.project_ref,
    management_api_origin: request.management_api_origin,
    supabase_origin: request.supabase_origin,
    source_revision: request.source_revision,
    harness_digest: request.harness_digest,
    issued_at: request.issued_at,
    not_after: request.not_after,
    observed_at: request.issued_at,
    operator_attestation_digest: request.operator_attestation_digest,
    run_nonce: request.run_nonce,
    request_nonce: request.request_nonce,
    request_digest: request.request_digest,
    config_digest: sha256Json(request.expected_config),
    config: request.expected_config,
  }
}

function hostedProvenance(sourceRevision: string) {
  return {
    cli_version: "2.90.0",
    config_digest: "d".repeat(64),
    repo_revision: sourceRevision,
    harness_digest: "e".repeat(64),
  }
}

function lifecycle(milliseconds = 180_000) {
  return {
    executionDeadline: Date.now() + milliseconds,
    signal: new AbortController().signal,
  }
}

function retainedOwnershipError(code: string) {
  const error = new Error(code)
  Object.defineProperty(error, "ff029RetainExclusiveOwnership", {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  return error
}

function cleanupJournal() {
  const emails = new Set<string>()
  const userIds = new Set<string>()
  return {
    async complete() {},
    async snapshot() {
      return {
        trackedEmails: [...emails],
        trackedUserIds: [...userIds],
      }
    },
    async trackEmail(email: string) {
      emails.add(email)
    },
    async trackUserId(userId: string) {
      userIds.add(userId)
    },
  }
}

function mailbox() {
  return {
    async close() {},
    async countTrackedMessages() {
      return 0
    },
    async deleteTrackedMessages() {},
    async initialize() {},
    async proofFromMessage() {
      return "p".repeat(40)
    },
    async snapshot() {
      return new Set()
    },
    async waitForNewMessage() {
      return "1:1"
    },
  }
}

function twoParticipantBarrier() {
  let arrivals = 0
  let release: (() => void) | undefined
  const waiting = new Promise<void>((resolvePromise) => {
    release = resolvePromise
  })
  return {
    async wait() {
      arrivals += 1
      if (arrivals === 2) {
        release?.()
        return
      }
      if (arrivals > 2) throw new Error("barrier_overflow")
      await waiting
    },
  }
}

function cleanGitFixture(repositoryRoot: string, sourceRevision: string) {
  return async (
    _file: string,
    args: string[],
  ): Promise<{ stderr: string; stdout: string }> => {
    const command = args.join(" ")
    if (command === "rev-parse --show-toplevel") {
      return { stdout: `${repositoryRoot}\n`, stderr: "" }
    }
    if (command === "rev-parse --verify HEAD") {
      return { stdout: `${sourceRevision}\n`, stderr: "" }
    }
    if (args[0] === "status") return { stdout: "", stderr: "" }
    throw new Error(`unexpected_git_command:${command}`)
  }
}

function cleanupServiceClient(
  user: { email: string; id: string } | null = null,
  options: { deleteError?: unknown } = {},
) {
  let retainedUser = user
  return {
    auth: {
      admin: {
        async deleteUser(userId: string) {
          if (options.deleteError !== undefined) {
            return { data: {}, error: options.deleteError }
          }
          if (retainedUser?.id === userId) {
            retainedUser = null
            return { data: {}, error: null }
          }
          return {
            data: {},
            error: { code: "user_not_found", status: 404 },
          }
        },
        async getUserById(userId: string) {
          if (retainedUser?.id === userId) {
            return { data: { user: retainedUser }, error: null }
          }
          return {
            data: { user: null },
            error: { code: "user_not_found", status: 404 },
          }
        },
        async listUsers() {
          return {
            data: {
              users: retainedUser === null ? [] : [retainedUser],
              lastPage: 1,
            },
            error: null,
          }
        },
      },
    },
  }
}

test("pins the hosted project and rejects role or project-confused keys", () => {
  const now = Date.now()
  expect(hosted.FF029_HOSTED_PROJECT_REF).toBe("destjwstohzmufshfnuy")
  expect(hosted.FF029_HOSTED_SUPABASE_ORIGIN).toBe(
    "https://destjwstohzmufshfnuy.supabase.co",
  )
  expect(hosted.FF029_HOSTED_APPLICATION_ORIGIN).toBe(
    "https://advocate-staging.creatorshare.com",
  )
  expect(
    hosted.validateHostedSupabaseKey(hostedKey("anon", { now }), "anon", now),
  ).toMatchObject({
    projectRef: "destjwstohzmufshfnuy",
    role: "anon",
  })
  expect(() =>
    hosted.validateHostedSupabaseKey(
      hostedKey("service_role", { now }),
      "anon",
      now,
    ),
  ).toThrow(/key_binding/)
  expect(() =>
    hosted.validateHostedSupabaseKey(
      hostedKey("anon", {
        now,
        projectRef: "aaaaaaaaaaaaaaaaaaaa",
      }),
      "anon",
      now,
    ),
  ).toThrow(/key_binding/)
})

test("requires a fresh exact-project pacing attestation with safe floors", () => {
  const now = Date.now()
  const generated = hosted.createHostedPacingAttestation({
    capturedAt: new Date(now - 1_000).toISOString(),
    validUntil: new Date(now + 4 * 60 * 60 * 1_000 - 1_000).toISOString(),
    smtpMaxFrequencySeconds: 1,
    emailOtpExpirySeconds: 60,
    rateLimitEmailSentPerHour: 120,
    rateLimitOtpPerHour: 120,
    verifyBurstCapacity: 30,
  })
  expect(generated).toMatchObject({
    attestation_source: "operator_supplied",
    smtp_max_frequency_seconds: 1,
    recipient_minimum_interval_milliseconds: 1_000,
    maximum_concurrent_burst: 2,
    email_quota_minimum_interval_milliseconds: 30_000,
    rate_limit_email_sent_per_hour: 120,
    rate_limit_otp_per_hour: 120,
    verify_refill_per_hour: 360,
    verify_burst_capacity: 30,
    verify_minimum_interval_milliseconds: 10_000,
  })
  expect(
    hosted.validateHostedPacingAttestation(generated, {
      nowMilliseconds: now,
    }),
  ).toMatchObject({
    attestationSource: "operator_supplied",
    adminGenerateLinkMinimumIntervalMilliseconds: 1_000,
    emailQuotaMinimumIntervalMilliseconds: 30_000,
    recipientMinimumIntervalMilliseconds: 1_000,
    emailOtpExpirySeconds: 60,
  })
  for (const mutation of [
    {
      captured_at: new Date(now - 6 * 60 * 1_000).toISOString(),
    },
    { attestation_source: "provider_live_capture" },
    { project_ref: "aaaaaaaaaaaaaaaaaaaa" },
    { supabase_origin: "https://attacker.example" },
    { admin_generate_link_minimum_interval_milliseconds: 999 },
    { email_quota_minimum_interval_milliseconds: 29_999 },
    { rate_limit_email_sent_per_hour: 121 },
    { rate_limit_otp_per_hour: 121 },
    {
      recipient_minimum_interval_milliseconds: 2_000,
      smtp_max_frequency_seconds: 1,
    },
    { smtp_max_frequency_seconds: 0 },
    { email_otp_expiry_seconds: 3_601 },
    { maximum_concurrent_burst: 3 },
    { verify_refill_per_hour: 359 },
    { verify_burst_capacity: 29 },
    { verify_minimum_interval_milliseconds: 9_999 },
    { attestation_digest: "a".repeat(64) },
  ]) {
    expect(() =>
      hosted.validateHostedPacingAttestation(pacingAttestation(now, mutation), {
        nowMilliseconds: now,
      }),
    ).toThrow(/ff029_hosted/)
  }
})

test("allows only exact hosted HTTPS Auth traffic and refuses redirects", async () => {
  const calls: Array<{ url: string; redirect?: RequestRedirect }> = []
  const exactFetch = hosted.createExactHostedAuthFetch(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      calls.push({ url, redirect: init?.redirect })
      return {
        ok: true,
        redirected: false,
        status: 200,
        url,
        async json() {
          return {}
        },
      }
    },
  )
  await exactFetch("https://destjwstohzmufshfnuy.supabase.co/auth/v1/health")
  expect(calls).toEqual([
    {
      url: "https://destjwstohzmufshfnuy.supabase.co/auth/v1/health",
      redirect: "error",
    },
  ])
  for (const url of [
    "http://destjwstohzmufshfnuy.supabase.co/auth/v1/health",
    "https://attacker.example/auth/v1/health",
    "https://destjwstohzmufshfnuy.supabase.co/rest/v1/users",
    "https://destjwstohzmufshfnuy.supabase.co/auth/v2/health",
  ]) {
    await expect(exactFetch(url)).rejects.toThrow(
      /hosted_auth_request_not_allowed/,
    )
  }

  const redirectedFetch = hosted.createExactHostedAuthFetch(
    async (input: RequestInfo | URL) => ({
      ok: false,
      redirected: true,
      status: 302,
      url: String(input),
    }),
  )
  await expect(
    redirectedFetch("https://destjwstohzmufshfnuy.supabase.co/auth/v1/health"),
  ).rejects.toThrow(/redirect_refused/)
})

test("paces admin and email quotas separately and reserves group slots", async () => {
  let now = Date.now()
  const sleeps: number[] = []
  const pacer = hosted.createHostedIssuancePacer(pacingAttestation(now), {
    nowImplementation: () => now,
    sleepImplementation: async (milliseconds: number) => {
      sleeps.push(milliseconds)
      now += milliseconds
    },
  })
  const deadline = Date.now() + 5 * 60 * 1_000
  const signal = new AbortController().signal
  const first =
    "creator-share-ff029-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@example.com"
  const second =
    "creator-share-ff029-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@example.com"
  const firstAdmin = await pacer.paceAdmin(first, { deadline, signal })
  const secondAdmin = await pacer.paceAdmin(second, { deadline, signal })
  const firstEmail = await pacer.paceEmail(first, { deadline, signal })
  const secondEmail = await pacer.paceEmail(first, { deadline, signal })
  const mixedGroup = await pacer.paceGroup(
    second,
    { adminSlots: 1, emailSlots: 1 },
    { deadline, signal },
  )
  const twoEmailReservation = await pacer.paceGroup(
    second,
    { adminSlots: 0, emailSlots: 2 },
    { deadline, signal },
  )
  const afterTwoEmailReservation = await pacer.paceEmail(first, {
    deadline,
    signal,
  })
  expect(sleeps).toEqual([1_000, 30_000, 30_000, 30_000, 60_000])
  expect(secondAdmin.dispatchedAt - firstAdmin.dispatchedAt).toBe(1_000)
  expect(firstEmail.dispatchedAt).toBe(secondAdmin.dispatchedAt)
  expect(secondEmail.dispatchedAt - firstEmail.dispatchedAt).toBe(30_000)
  expect(mixedGroup).toMatchObject({ adminSlots: 1, emailSlots: 1 })
  expect(twoEmailReservation).toMatchObject({
    adminSlots: 0,
    emailSlots: 2,
  })
  expect(
    afterTwoEmailReservation.dispatchedAt - twoEmailReservation.dispatchedAt,
  ).toBe(60_000)
  await expect(
    pacer.paceGroup(
      second,
      { adminSlots: 2, emailSlots: 1 },
      { deadline, signal },
    ),
  ).rejects.toThrow(/concurrent_burst_invalid/)
})

test("paces every hosted verification at the documented refill rate", async () => {
  let now = Date.now()
  const sleeps: number[] = []
  const pacer = hosted.createHostedVerificationPacer(pacingAttestation(now), {
    nowImplementation: () => now,
    sleepImplementation: async (milliseconds: number) => {
      sleeps.push(milliseconds)
      now += milliseconds
    },
  })
  const deadline = Date.now() + 60_000
  const signal = new AbortController().signal
  const first = await pacer.pace({ deadline, signal })
  const second = await pacer.pace({ deadline, signal })
  const third = await pacer.pace({ deadline, signal })
  expect(sleeps).toEqual([10_000, 10_000])
  expect(second.dispatchedAt - first.dispatchedAt).toBe(10_000)
  expect(third.dispatchedAt - second.dispatchedAt).toBe(10_000)
})

test("reads only the fixed hosted endpoints from a bound environment", () => {
  const now = Date.now()
  const configuration = runner.readHostedSupabaseEmailProofEnvironment(
    hostedEnvironment(now, {
      FF029_HOSTED_SUPABASE_URL: "https://attacker.example",
      FF029_HOSTED_APPLICATION_ORIGIN: "https://attacker.example",
      SUPABASE_URL: "https://attacker.example",
    }),
    { nowMilliseconds: now },
  )
  expect(configuration).toMatchObject({
    projectRef: "destjwstohzmufshfnuy",
    supabaseUrl: "https://destjwstohzmufshfnuy.supabase.co",
    applicationOrigin: "https://advocate-staging.creatorshare.com",
    sourceRevision: "b".repeat(40),
    totalBudgetMilliseconds: 180 * 60 * 1_000,
    cleanupBudgetMilliseconds: 10 * 60 * 1_000,
  })
  const pacedEmailIssuanceMilliseconds =
    69 *
    configuration.pacingAttestation.email_quota_minimum_interval_milliseconds
  const pacedAdminIssuanceMilliseconds =
    101 *
    configuration.pacingAttestation
      .admin_generate_link_minimum_interval_milliseconds
  const pacedVerificationMilliseconds =
    170 * configuration.pacingAttestation.verify_minimum_interval_milliseconds
  const maximumExpiryObservationMilliseconds = 61 * 60 * 1_000
  expect(configuration.totalBudgetMilliseconds).toBeGreaterThan(
    pacedEmailIssuanceMilliseconds +
      pacedAdminIssuanceMilliseconds +
      pacedVerificationMilliseconds +
      maximumExpiryObservationMilliseconds +
      configuration.cleanupBudgetMilliseconds,
  )
  expect(() =>
    runner.readHostedSupabaseEmailProofEnvironment(
      hostedEnvironment(now, {
        FF029_HOSTED_SUPABASE_ANON_KEY: hostedKey("service_role", {
          now,
        }),
      }),
      { nowMilliseconds: now },
    ),
  ).toThrow(/key_binding/)
  expect(() =>
    runner.readHostedSupabaseEmailProofEnvironment(
      hostedEnvironment(now, {
        FF029_HOSTED_PACING_ATTESTATION: JSON.stringify(
          pacingAttestation(now, {
            valid_until: new Date(now + 2 * 60 * 60 * 1_000).toISOString(),
          }),
        ),
      }),
      { nowMilliseconds: now },
    ),
  ).toThrow(/attestation_coverage/)
})

test("requires hosted JWTs to remain valid through their complete use windows", () => {
  const now = Date.now()
  expect(() =>
    runner.readHostedSupabaseEmailProofEnvironment(
      hostedEnvironment(now, {
        FF029_HOSTED_SUPABASE_ANON_KEY: hostedKey("anon", {
          now,
          expiresInMilliseconds: 169 * 60 * 1_000,
        }),
      }),
      { nowMilliseconds: now },
    ),
  ).toThrow(/key_binding/)
  expect(() =>
    runner.readHostedSupabaseEmailProofEnvironment(
      hostedEnvironment(now, {
        FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY: hostedKey("service_role", {
          now,
          expiresInMilliseconds: 179 * 60 * 1_000,
        }),
      }),
      { nowMilliseconds: now },
    ),
  ).toThrow(/key_binding/)
  expect(
    runner.readHostedSupabaseEmailProofEnvironment(
      hostedEnvironment(now, {
        FF029_HOSTED_SUPABASE_ANON_KEY: hostedKey("anon", {
          now,
          expiresInMilliseconds: 171 * 60 * 1_000,
        }),
        FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY: hostedKey("service_role", {
          now,
          expiresInMilliseconds: 181 * 60 * 1_000,
        }),
      }),
      { nowMilliseconds: now },
    ),
  ).toMatchObject({
    totalBudgetMilliseconds: 180 * 60 * 1_000,
    cleanupBudgetMilliseconds: 10 * 60 * 1_000,
  })
})

test("preserves the absolute setup deadline and revalidates every expiring authority", () => {
  const now = Math.floor(Date.now() / 1_000) * 1_000
  const configuration = runner.readHostedSupabaseEmailProofEnvironment(
    hostedEnvironment(now),
    { nowMilliseconds: now },
  )
  const setupDelayMilliseconds = 5_000
  const delayedNow = now + setupDelayMilliseconds
  expect(
    runner.remainingHostedExecutionBudgets(configuration, delayedNow),
  ).toEqual({
    totalBudgetMilliseconds:
      configuration.totalBudgetMilliseconds - setupDelayMilliseconds,
    cleanupBudgetMilliseconds: configuration.cleanupBudgetMilliseconds,
  })

  const remainingTotalMilliseconds =
    configuration.absoluteTotalDeadline - delayedNow
  const executionWindowMilliseconds =
    remainingTotalMilliseconds - configuration.cleanupBudgetMilliseconds
  expect(() =>
    runner.remainingHostedExecutionBudgets(
      {
        ...configuration,
        anonKey: hostedKey("anon", {
          now: delayedNow,
          expiresInMilliseconds: executionWindowMilliseconds,
        }),
      },
      delayedNow,
    ),
  ).toThrow(/key_binding/)
  expect(() =>
    runner.remainingHostedExecutionBudgets(
      {
        ...configuration,
        serviceRoleKey: hostedKey("service_role", {
          now: delayedNow,
          expiresInMilliseconds: remainingTotalMilliseconds,
        }),
      },
      delayedNow,
    ),
  ).toThrow(/key_binding/)
  expect(() =>
    runner.remainingHostedExecutionBudgets(
      {
        ...configuration,
        pacingAttestation: pacingAttestation(delayedNow, {
          valid_until: new Date(
            configuration.absoluteTotalDeadline - 1,
          ).toISOString(),
        }),
      },
      delayedNow,
    ),
  ).toThrow(/attestation_coverage/)
  expect(() =>
    runner.remainingHostedExecutionBudgets(
      {
        ...configuration,
        pacingAttestation: pacingAttestation(delayedNow, {
          valid_until: new Date(
            configuration.absoluteTotalDeadline,
          ).toISOString(),
        }),
      },
      delayedNow,
    ),
  ).toThrow(/attestation_coverage/)
  expect(() =>
    runner.remainingHostedExecutionBudgets(
      configuration,
      configuration.absoluteTotalDeadline -
        configuration.cleanupBudgetMilliseconds,
    ),
  ).toThrow(/execution_window_exhausted/)
})

test("exposes the bounded hosted runner through the repository script", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(process.cwd(), "package.json"), "utf8"),
  )
  expect(
    packageJson.scripts?.["test:provider:supabase-email-proof-contract"],
  ).toBe(
    "PW_NO_WEBSERVER=1 playwright test tests/provider/supabase-email-proof-supersession.spec.ts tests/provider/supabase-email-proof-supersession-hosted.spec.ts tests/provider/ethereal-imap-mailbox.spec.ts --workers=1 --retries=0",
  )
  expect(
    packageJson.scripts?.["canary:supabase-email-proof-supersession:hosted"],
  ).toBe("node tests/provider/supabase-email-proof-supersession-hosted.mjs")
})

test("requires an exact clean HEAD before hosted execution", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-git-gate-"),
  )
  const revision = "c".repeat(40)
  const fakeGit = async (
    _file: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    const command = args.join(" ")
    if (command === "rev-parse --show-toplevel") {
      return { stdout: `${repositoryRoot}\n`, stderr: "" }
    }
    if (command === "rev-parse --verify HEAD") {
      return { stdout: `${revision}\n`, stderr: "" }
    }
    return { stdout: "", stderr: "" }
  }
  await expect(
    runner.assertHostedSourceRevisionGate({
      repositoryRoot,
      sourceRevision: revision,
      execFileImplementation: fakeGit,
    }),
  ).resolves.toEqual({ repositoryRoot, sourceRevision: revision })
  await expect(
    runner.assertHostedSourceRevisionGate({
      repositoryRoot,
      sourceRevision: revision,
      execFileImplementation: async (file: string, args: string[]) => {
        const result = await fakeGit(file, args)
        return args[0] === "status"
          ? { stdout: "?? unexpected.txt\n", stderr: "" }
          : result
      },
    }),
  ).rejects.toThrow(/source_revision_gate_failed/)
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("bounds the initial source gate by the original absolute deadline", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-initial-source-deadline-"),
  )
  const now = Math.floor(Date.now() / 1_000) * 1_000
  let clock = now
  const sourceRevision = "d".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
    FF029_TOTAL_BUDGET_MILLISECONDS: "600000",
    FF029_CLEANUP_BUDGET_MILLISECONDS: "60000",
    FF029_FINALIZATION_BUDGET_MILLISECONDS: "10000",
    FF029_OPERATION_TIMEOUT_MILLISECONDS: "120000",
  })
  const absoluteDeadline = now + 600_000
  let gitCalls = 0
  const outcome = await runner
    .createHostedRunnerFoundation({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      nowImplementation: () => clock,
      execFileImplementation: async (_file: string, args: string[]) => {
        gitCalls += 1
        clock = absoluteDeadline
        const command = args.join(" ")
        if (command === "rev-parse --show-toplevel") {
          return { stdout: `${repositoryRoot}\n`, stderr: "" }
        }
        if (command === "rev-parse --verify HEAD") {
          return { stdout: `${sourceRevision}\n`, stderr: "" }
        }
        return { stdout: "", stderr: "" }
      },
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
    })
    .then(
      (foundation) => ({
        status: "resolved" as const,
        error: null,
        foundation,
      }),
      (error: unknown) => ({
        status: "rejected" as const,
        error,
        foundation: null,
      }),
    )
  try {
    expect(gitCalls).toBeGreaterThanOrEqual(1)
    expect(outcome.status).toBe("rejected")
    expect((outcome.error as Error).message).toBe(
      "ff029_hosted_finalization_deadline_exhausted",
    )
  } finally {
    await outcome.foundation?.lock.release()
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("uses an exclusive 0600 machine run lock", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ff029-hosted-lock-"))
  const path = resolve(directory, "run.lock")
  const first = await runner.acquireHostedRunLock({ path })
  expect((await lstat(path)).mode & 0o777).toBe(0o600)
  const liveContents = await readFile(path, "utf8")
  await expect(runner.acquireHostedRunLock({ path })).rejects.toThrow(
    /hosted_run_locked/,
  )
  expect(await readFile(path, "utf8")).toBe(liveContents)
  await first.release()
  const second = await runner.acquireHostedRunLock({ path })
  await second.release()
  await rm(directory, { recursive: true, force: true })
})

test("uses one shared-state lock across different TMPDIR values", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-cross-tmp-lock-"),
  )
  const stateRoot = resolve(directory, "shared-state")
  const firstTemporaryRoot = resolve(directory, "tmp-a")
  const secondTemporaryRoot = resolve(directory, "tmp-b")
  await Promise.all([
    mkdir(stateRoot, { mode: 0o700 }),
    mkdir(firstTemporaryRoot, { mode: 0o700 }),
    mkdir(secondTemporaryRoot, { mode: 0o700 }),
  ])
  const originalTemporaryRoot = process.env.TMPDIR
  const originalHome = process.env.HOME
  const lockPathForState = runner.hostedRunLockPath as unknown as (
    stateRoot: string,
  ) => string
  let lock: Awaited<ReturnType<typeof runner.acquireHostedRunLock>> | undefined
  try {
    process.env.TMPDIR = firstTemporaryRoot
    process.env.HOME = firstTemporaryRoot
    const firstPath = lockPathForState(stateRoot)
    lock = await runner.acquireHostedRunLock({ path: firstPath })

    process.env.TMPDIR = secondTemporaryRoot
    process.env.HOME = secondTemporaryRoot
    const secondPath = lockPathForState(stateRoot)
    expect(secondPath).toBe(firstPath)
    await expect(
      runner.acquireHostedRunLock({ path: secondPath }),
    ).rejects.toThrow(/hosted_run_locked/)
  } finally {
    if (originalTemporaryRoot === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = originalTemporaryRoot
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await lock?.release()
    await rm(directory, { recursive: true, force: true })
  }
})

test("atomically reclaims a strictly valid dead run lock", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ff029-hosted-stale-lock-"))
  const path = resolve(directory, "run.lock")
  await runner.acquireHostedRunLock({
    path,
    processId: 2_000_000_001,
  })
  const replacement = await runner.acquireHostedRunLock({
    path,
    processAliveImplementation: async (processId: number) =>
      processId === process.pid,
  })
  const current = JSON.parse(await readFile(path, "utf8"))
  expect(current).toMatchObject({
    kind: "ff029_hosted_run_lock",
    process_id: process.pid,
    project_ref: "destjwstohzmufshfnuy",
    schema_version: 1,
  })
  expect((await lstat(path)).mode & 0o777).toBe(0o600)
  await replacement.release()
  await expect(access(`${path}.recovery`)).rejects.toMatchObject({
    code: "ENOENT",
  })
  await rm(directory, { recursive: true, force: true })
})

test("never reclaims retained quarantine as an ordinary dead process lock", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-sticky-quarantine-"),
  )
  const stateRoot = resolve(repositoryRoot, "state")
  const lockPath = runner.hostedRunLockPath(stateRoot)
  const now = Date.now()
  const sourceRevision = "9".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  const retainedOutcome = await runner
    .runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot,
      environment,
      lockPath,
      nowMilliseconds: now,
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      runCanaryImplementation: async () => {
        throw retainedOwnershipError("ff029_retained_run_fixture")
      },
    })
    .then(
      () => ({ status: "resolved" as const, error: null }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )
  expect(retainedOutcome.status).toBe("rejected")
  expect(
    (retainedOutcome.error as { ff029RetainExclusiveOwnership?: boolean })
      .ff029RetainExclusiveOwnership,
  ).toBe(true)

  const retainedState = JSON.parse(await readFile(lockPath, "utf8"))
  expect.soft(retainedState.kind).toBe("ff029_hosted_run_lock_quarantine")
  const simulatedDeadOwnerState = {
    ...retainedState,
    process_id: 2_000_000_009,
  }
  await writeFile(
    lockPath,
    `${JSON.stringify(simulatedDeadOwnerState)}\n`,
    "utf8",
  )
  await chmod(lockPath, 0o600)
  const quarantinedContents = await readFile(lockPath, "utf8")
  const acquisition = await runner
    .acquireHostedRunLock({
      path: lockPath,
      processAliveImplementation: async () => false,
    })
    .then(
      (lock) => ({ status: "resolved" as const, error: null, lock }),
      (error: unknown) => ({
        status: "rejected" as const,
        error,
        lock: null,
      }),
    )
  try {
    expect.soft(acquisition.status).toBe("rejected")
    if (acquisition.status === "rejected") {
      expect
        .soft((acquisition.error as Error).message)
        .toBe("ff029_hosted_run_locked_quarantined")
    }
    expect(await readFile(lockPath, "utf8")).toBe(quarantinedContents)
  } finally {
    await acquisition.lock?.release()
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("blocks authorized quarantine recovery while a retained observer process group is alive", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-quarantine-process-group-"),
  )
  const path = resolve(directory, "run.lock")
  const ownerProcessId = 2_000_000_011
  const retainedProcessGroupIds = [2_000_000_013, 2_000_000_012]
  const lock = await runner.acquireHostedRunLock({
    path,
    processId: ownerProcessId,
  })
  await lock.retain({
    processGroupIds: [
      retainedProcessGroupIds[0],
      retainedProcessGroupIds[1],
      retainedProcessGroupIds[0],
    ],
  })
  const quarantine = JSON.parse(await readFile(path, "utf8"))
  expect.soft(quarantine).toMatchObject({
    kind: "ff029_hosted_run_lock_quarantine",
    process_group_ids: retainedProcessGroupIds.toSorted((a, b) => a - b),
    process_id: ownerProcessId,
    remote_operations_unsettled: true,
  })
  const quarantinedContents = await readFile(path, "utf8")
  const probedProcessGroupIds: number[] = []
  const recovery = await runner
    .acquireHostedRunLock({
      path,
      quarantineRecoveryAuthorization: {
        quarantineNonce: quarantine.nonce,
        operatorAttestation:
          runner.FF029_HOSTED_QUARANTINE_RECOVERY_ATTESTATION,
        quietPeriodMilliseconds: 10_000,
      },
      processAliveImplementation: async () => false,
      processGroupAliveImplementation: async (processGroupId: number) => {
        probedProcessGroupIds.push(processGroupId)
        return processGroupId === retainedProcessGroupIds[1]
      },
    })
    .then(
      (acquisition) => ({
        status: "resolved" as const,
        error: null,
        acquisition,
      }),
      (error: unknown) => ({
        status: "rejected" as const,
        error,
        acquisition: null,
      }),
    )
  try {
    expect.soft(recovery.status).toBe("rejected")
    expect
      .soft((recovery.error as Error).message)
      .toBe("ff029_hosted_run_locked_quarantined")
    expect.soft(probedProcessGroupIds).toContain(retainedProcessGroupIds[1])
    expect.soft(await readFile(path, "utf8")).toBe(quarantinedContents)
  } finally {
    await recovery.acquisition?.release()
    await rm(directory, { recursive: true, force: true })
  }
})

test("clears retained quarantine only after recovery cleanup fully settles", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-quarantine-recovery-"),
  )
  const stateRoot = resolve(repositoryRoot, "state")
  const lockPath = runner.hostedRunLockPath(stateRoot)
  const journalPath = runner.hostedCleanupJournalPath(stateRoot)
  const now = Date.now()
  const sourceRevision = "a".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  const commonOptions = {
    repositoryRoot,
    stateRoot,
    environment,
    lockPath,
    nowMilliseconds: now,
    execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
    processAliveImplementation: async () => false,
    processGroupAliveImplementation: async () => false,
    createClientImplementation: (_url: string, key: string) =>
      key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
        ? cleanupServiceClient()
        : { auth: {} },
  }
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      ...commonOptions,
      mailboxImplementation: mailbox(),
      provenance: hostedProvenance(sourceRevision),
      runCanaryImplementation: async () => {
        throw retainedOwnershipError("ff029_retained_run_fixture")
      },
    }),
  ).rejects.toMatchObject({ ff029RetainExclusiveOwnership: true })
  const quarantineState = JSON.parse(await readFile(lockPath, "utf8"))
  await writeFile(
    lockPath,
    `${JSON.stringify({
      ...quarantineState,
      process_id: 2_000_000_010,
    })}\n`,
    "utf8",
  )
  await chmod(lockPath, 0o600)
  const deadQuarantineContents = await readFile(lockPath, "utf8")
  const unauthorizedRecovery = await runner
    .runHostedSupabaseEmailProofSupersessionCanary({
      ...commonOptions,
      mailboxImplementation: mailbox(),
    })
    .then(
      (result) => ({ status: "resolved" as const, error: null, result }),
      (error: unknown) => ({
        status: "rejected" as const,
        error,
        result: null,
      }),
    )
  expect.soft(unauthorizedRecovery.status).toBe("rejected")
  expect
    .soft((unauthorizedRecovery.error as Error).message)
    .toBe("ff029_hosted_run_locked_quarantined")
  expect.soft(await readFile(lockPath, "utf8")).toBe(deadQuarantineContents)

  let releaseClose!: () => void
  const closeCanFinish = new Promise<void>((resolvePromise) => {
    releaseClose = resolvePromise
  })
  let markCloseStarted!: () => void
  const closeStarted = new Promise<void>((resolvePromise) => {
    markCloseStarted = resolvePromise
  })
  const recoveryOutcomePromise = runner
    .runHostedSupabaseEmailProofSupersessionCanary({
      ...commonOptions,
      quarantineRecoveryAuthorization: {
        quarantineNonce: quarantineState.nonce,
        operatorAttestation:
          runner.FF029_HOSTED_QUARANTINE_RECOVERY_ATTESTATION,
        quietPeriodMilliseconds: 10_000,
      },
      quarantineRecoverySleepImplementation: async (milliseconds: number) => {
        expect(milliseconds).toBe(10_000)
      },
      mailboxImplementation: {
        ...mailbox(),
        async close() {
          markCloseStarted()
          await closeCanFinish
        },
      },
    })
    .then(
      (result) => ({ status: "resolved" as const, error: null, result }),
      (error: unknown) => ({
        status: "rejected" as const,
        error,
        result: null,
      }),
    )
  const cleanupReachedClose = await Promise.race([
    closeStarted.then(() => true),
    new Promise<boolean>((resolvePromise) =>
      setTimeout(() => resolvePromise(false), 250),
    ),
  ])
  const lockPresentDuringCleanup = await access(lockPath).then(
    () => true,
    () => false,
  )
  const journalPresentDuringCleanup = await access(journalPath).then(
    () => true,
    () => false,
  )
  releaseClose()
  const recoveryOutcome = await recoveryOutcomePromise

  try {
    expect.soft(cleanupReachedClose).toBe(true)
    expect.soft(lockPresentDuringCleanup).toBe(true)
    expect.soft(journalPresentDuringCleanup).toBe(true)
    expect.soft(recoveryOutcome.status).toBe("resolved")
    expect
      .soft(recoveryOutcome.result?.status)
      .toBe("resumed_cleanup_completed")
    await expect
      .soft(access(lockPath))
      .rejects.toMatchObject({ code: "ENOENT" })
    await expect
      .soft(access(journalPath))
      .rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    releaseClose()
    await recoveryOutcomePromise
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("permits exactly one winner when dead-lock recovery races", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ff029-hosted-lock-race-"))
  const path = resolve(directory, "run.lock")
  await runner.acquireHostedRunLock({
    path,
    processId: 2_000_000_002,
  })
  const attempts = await Promise.allSettled([
    runner.acquireHostedRunLock({
      path,
      processAliveImplementation: async (processId: number) =>
        processId === process.pid,
    }),
    runner.acquireHostedRunLock({
      path,
      processAliveImplementation: async (processId: number) =>
        processId === process.pid,
    }),
  ])
  const winners = attempts.filter(
    (
      attempt,
    ): attempt is PromiseFulfilledResult<
      Awaited<ReturnType<typeof runner.acquireHostedRunLock>>
    > => attempt.status === "fulfilled",
  )
  expect(winners).toHaveLength(1)
  expect(
    attempts.filter((attempt) => attempt.status === "rejected"),
  ).toHaveLength(1)
  await winners[0].value.release()
  await rm(directory, { recursive: true, force: true })
})

test("fails closed on malformed or incorrectly permissioned stale locks", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-invalid-lock-"),
  )
  const path = resolve(directory, "run.lock")
  await writeFile(path, `${JSON.stringify({ process_id: 999_999 })}\n`, {
    flag: "wx",
    mode: 0o644,
  })
  await chmod(path, 0o644)
  await expect(
    runner.acquireHostedRunLock({
      path,
      processAliveImplementation: async () => false,
    }),
  ).rejects.toThrow(/run_lock_invalid/)
  expect((await lstat(path)).mode & 0o777).toBe(0o644)
  await chmod(path, 0o600)
  await expect(
    runner.acquireHostedRunLock({
      path,
      processAliveImplementation: async () => false,
    }),
  ).rejects.toThrow(/run_lock_invalid/)
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    process_id: 999_999,
  })
  await rm(directory, { recursive: true, force: true })
})

test("retains machine ownership when cleanup ignores abort and blocks another worktree", async () => {
  const fixtureRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-unsettled-cleanup-lock-"),
  )
  const firstWorktree = resolve(fixtureRoot, "worktree-a")
  const secondWorktree = resolve(fixtureRoot, "worktree-b")
  const stateRoot = resolve(fixtureRoot, "machine-state")
  const lockPath = resolve(fixtureRoot, "run.lock")
  await Promise.all([
    mkdir(firstWorktree, { mode: 0o700 }),
    mkdir(secondWorktree, { mode: 0o700 }),
  ])
  const now = Date.now()
  const sourceRevision = "6".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  let lateMutations = 0
  let lockProtectedLateMutation = false

  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot: firstWorktree,
      stateRoot,
      environment,
      lockPath,
      nowMilliseconds: now,
      execFileImplementation: cleanGitFixture(firstWorktree, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      runCanaryImplementation: async () =>
        core.runFf029CleanupWithAbortAndJoin(
          {
            async cleanup() {
              setTimeout(async () => {
                lateMutations += 1
                lockProtectedLateMutation = await access(lockPath).then(
                  () => true,
                  () => false,
                )
              }, 80)
              return new Promise(() => {})
            },
          },
          false,
          25,
          25,
          Date.now() + 100,
        ),
    }),
  ).rejects.toThrow(/ff029_cleanup_unsettled_after_abort/)
  expect((await lstat(lockPath)).mode & 0o777).toBe(0o600)

  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot: secondWorktree,
      stateRoot,
      environment,
      lockPath,
      nowMilliseconds: now,
      execFileImplementation: cleanGitFixture(secondWorktree, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: () => {
        throw new Error("second_worktree_must_not_construct_a_client")
      },
    }),
  ).rejects.toThrow(/hosted_run_locked/)

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 120))
  expect(lateMutations).toBe(1)
  expect(lockProtectedLateMutation).toBe(true)
  await rm(lockPath, { force: true })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 80))
  expect(lateMutations).toBe(1)
  await rm(fixtureRoot, { recursive: true, force: true })
})

test("persists resumable cleanup privately and removes it only on completion", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-journal-"),
  )
  const sourceRevision = "d".repeat(40)
  const email =
    "creator-share-ff029-cccccccccccccccccccccccccccccccc@example.com"
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const first = await runner.createHostedCleanupJournal({
    stateRoot: repositoryRoot,
    sourceRevision,
  })
  await first.trackEmail(email)
  await first.trackUserId(userId)
  expect((await lstat(first.path)).mode & 0o777).toBe(0o600)
  expect((await lstat(resolve(first.path, ".."))).mode & 0o777).toBe(0o700)

  const resumed = await runner.createHostedCleanupJournal({
    stateRoot: repositoryRoot,
    sourceRevision: "e".repeat(40),
  })
  expect(resumed.resumed).toBe(true)
  expect(await resumed.snapshot()).toEqual({
    trackedEmails: [email],
    trackedUserIds: [userId],
    sourceRevision,
  })
  expect(await readFile(resumed.path, "utf8")).toContain(email)
  await resumed.complete()
  await expect(access(resumed.path)).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("treats every retained valid journal as recovery, even before tracking", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-empty-journal-"),
  )
  const sourceRevision = "f".repeat(40)
  const first = await runner.createHostedCleanupJournal({
    stateRoot: repositoryRoot,
    sourceRevision,
  })
  expect(first.resumed).toBe(false)
  const resumed = await runner.createHostedCleanupJournal({
    stateRoot: repositoryRoot,
    sourceRevision,
  })
  expect(resumed.resumed).toBe(true)
  expect(await resumed.snapshot()).toEqual({
    trackedEmails: [],
    trackedUserIds: [],
    sourceRevision,
  })
  await resumed.complete()
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("recovers a machine-global journal from a dirty alternate worktree with expired fresh-run inputs", async () => {
  const fixtureRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-cross-worktree-recovery-"),
  )
  const stateRoot = resolve(fixtureRoot, "machine-state")
  const firstWorktree = resolve(fixtureRoot, "worktree-a")
  const secondWorktree = resolve(fixtureRoot, "worktree-b")
  await Promise.all([
    mkdir(firstWorktree, { mode: 0o700 }),
    mkdir(secondWorktree, { mode: 0o700 }),
  ])
  const now = Date.now()
  const sourceRevision = "7".repeat(40)
  const journal = await runner.createHostedCleanupJournal({
    stateRoot,
    sourceRevision,
  })
  expect(journal.resumed).toBe(false)
  expect((await lstat(stateRoot)).mode & 0o777).toBe(0o700)
  expect((await lstat(journal.path)).mode & 0o777).toBe(0o600)

  let gitCalls = 0
  let canaryCalls = 0
  const environment = hostedEnvironment(now, {
    FF029_HOSTED_SUPABASE_ANON_KEY: hostedKey("anon", {
      now: now - 2 * 60 * 60 * 1_000,
      expiresInMilliseconds: 60 * 60 * 1_000,
    }),
    FF029_HOSTED_PACING_ATTESTATION: JSON.stringify(
      pacingAttestation(now - 5 * 60 * 60 * 1_000),
    ),
    FF029_SOURCE_REVISION: "not-a-clean-revision",
  })
  const result = await runner.runHostedSupabaseEmailProofSupersessionCanary({
    repositoryRoot: secondWorktree,
    stateRoot,
    environment,
    lockPath: resolve(fixtureRoot, "run.lock"),
    nowMilliseconds: now,
    execFileImplementation: async () => {
      gitCalls += 1
      return { stdout: "dirty alternate worktree\n", stderr: "" }
    },
    mailboxImplementation: mailbox(),
    createClientImplementation: (_url: string, key: string) =>
      key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
        ? cleanupServiceClient()
        : { auth: {} },
    runCanaryImplementation: async () => {
      canaryCalls += 1
      throw new Error("fresh_canary_must_not_run")
    },
  })
  expect(result).toMatchObject({
    status: "resumed_cleanup_completed",
    report: null,
  })
  expect(gitCalls).toBe(0)
  expect(canaryCalls).toBe(0)
  await expect(access(journal.path)).rejects.toMatchObject({ code: "ENOENT" })
  await rm(fixtureRoot, { recursive: true, force: true })
})

test("writes evidence exclusively with 0600 mode and rejects private values", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-evidence-"),
  )
  const serialized = `${JSON.stringify({
    schema_version: 4,
    scope: "hosted_staging",
  })}\n`
  const path = await runner.writeHostedEvidence(serialized, {
    repositoryRoot,
    forbiddenValues: ["secret-material"],
  })
  expect((await lstat(path)).mode & 0o777).toBe(0o600)
  await expect(
    runner.writeHostedEvidence(serialized, { repositoryRoot }),
  ).rejects.toThrow()
  await expect(
    runner.writeHostedEvidence(
      `${JSON.stringify({ value: "secret-material" })}\n`,
      {
        repositoryRoot: await mkdtemp(
          resolve(tmpdir(), "ff029-hosted-evidence-secret-"),
        ),
        forbiddenValues: ["secret-material"],
      },
    ),
  ).rejects.toThrow(/contains_private_value/)
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("publishes evidence atomically and never exposes interrupted temp bytes", async () => {
  const interruptedRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-evidence-interrupted-"),
  )
  const serialized = `${JSON.stringify({
    schema_version: 4,
    scope: "hosted_staging",
  })}\n`
  const interruptedPath = runner.hostedEvidencePath(interruptedRoot)
  let releaseInterruptedWrite!: () => void
  const interruptedWriteCanFinish = new Promise<void>((resolvePromise) => {
    releaseInterruptedWrite = resolvePromise
  })
  let markPartialWritten!: () => void
  const partialWritten = new Promise<void>((resolvePromise) => {
    markPartialWritten = resolvePromise
  })
  const publication = runner.writeHostedEvidence(serialized, {
    repositoryRoot: interruptedRoot,
    openImplementation: async (path: string, flags: string, mode?: number) => {
      const handle = await open(path, flags, mode)
      if (flags !== "wx" || resolve(path) === interruptedPath) return handle
      return {
        async close() {
          await handle.close()
        },
        async stat() {
          return handle.stat()
        },
        async sync() {
          await handle.sync()
        },
        async writeFile(contents: string, encoding: BufferEncoding) {
          await handle.writeFile(
            contents.slice(0, Math.max(1, Math.floor(contents.length / 2))),
            encoding,
          )
          markPartialWritten()
          await interruptedWriteCanFinish
          throw new Error("simulated_evidence_publication_interruption")
        },
      }
    },
    renameImplementation: rename,
    async syncDirectoryImplementation() {},
  })
  const observedPartialTemp = await Promise.race([
    partialWritten.then(() => true),
    publication.then(
      () => false,
      () => false,
    ),
    new Promise<boolean>((resolvePromise) =>
      setTimeout(() => resolvePromise(false), 250),
    ),
  ])
  const finalVisibleDuringPartialWrite = await access(interruptedPath).then(
    () => true,
    () => false,
  )
  releaseInterruptedWrite()
  const interruptedOutcome = await publication.then(
    () => ({ status: "resolved" as const, error: null }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  )
  try {
    expect.soft(observedPartialTemp).toBe(true)
    expect.soft(finalVisibleDuringPartialWrite).toBe(false)
    expect.soft(interruptedOutcome.status).toBe("rejected")
    expect
      .soft((interruptedOutcome.error as Error).message)
      .toBe("simulated_evidence_publication_interruption")
    await expect
      .soft(access(interruptedPath))
      .rejects.toMatchObject({ code: "ENOENT" })
    const interruptedDirectory = dirname(interruptedPath)
    const interruptedFiles = await readdir(interruptedDirectory)
    expect
      .soft(interruptedFiles.filter((name) => name.endsWith(".tmp")))
      .toEqual([])
  } finally {
    releaseInterruptedWrite()
    await publication.catch(() => {})
    await rm(interruptedRoot, { recursive: true, force: true })
  }

  const successfulRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-evidence-atomic-success-"),
  )
  const successfulPath = runner.hostedEvidencePath(successfulRoot)
  const openedPaths: string[] = []
  const renames: Array<{ destination: string; source: string }> = []
  let directorySyncs = 0
  try {
    const publishedPath = await runner.writeHostedEvidence(serialized, {
      repositoryRoot: successfulRoot,
      openImplementation: async (
        path: string,
        flags: string,
        mode?: number,
      ) => {
        openedPaths.push(resolve(path))
        return open(path, flags, mode)
      },
      async renameImplementation(source: string, destination: string) {
        renames.push({
          destination: resolve(destination),
          source: resolve(source),
        })
        await rename(source, destination)
      },
      async syncDirectoryImplementation(path: string) {
        expect(resolve(path)).toBe(dirname(successfulPath))
        directorySyncs += 1
      },
    })
    expect(publishedPath).toBe(successfulPath)
    expect(await readFile(successfulPath, "utf8")).toBe(serialized)
    expect((await lstat(successfulPath)).mode & 0o777).toBe(0o600)
    expect(openedPaths).toHaveLength(1)
    expect(openedPaths[0]).not.toBe(successfulPath)
    expect(renames).toEqual([
      {
        destination: successfulPath,
        source: openedPaths[0],
      },
    ])
    expect(directorySyncs).toBe(1)
    expect(
      (await readdir(dirname(successfulPath))).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([])
  } finally {
    await rm(successfulRoot, { recursive: true, force: true })
  }
})

test("prioritizes retained cleanup over an existing evidence artifact", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-recovery-order-"),
  )
  const now = Date.now()
  const sourceRevision = "1".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  const journal = await runner.createHostedCleanupJournal({
    stateRoot: repositoryRoot,
    sourceRevision,
  })
  expect(journal.resumed).toBe(false)
  const evidenceContents = `${JSON.stringify({ retained: true })}\n`
  const evidencePath = await runner.writeHostedEvidence(evidenceContents, {
    repositoryRoot,
  })
  let serializerCalls = 0
  const result = await runner.runHostedSupabaseEmailProofSupersessionCanary({
    repositoryRoot,
    stateRoot: repositoryRoot,
    environment,
    lockPath: resolve(repositoryRoot, "run.lock"),
    nowMilliseconds: now,
    execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
    mailboxImplementation: mailbox(),
    createClientImplementation: (_url: string, key: string) =>
      key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
        ? cleanupServiceClient()
        : { auth: {} },
    serializeEvidenceImplementation: () => {
      serializerCalls += 1
      throw new Error("serializer_must_not_run_during_recovery")
    },
  })
  expect(result).toMatchObject({
    status: "resumed_cleanup_completed",
    report: null,
  })
  expect(serializerCalls).toBe(0)
  expect(await readFile(evidencePath, "utf8")).toBe(evidenceContents)
  await expect(
    access(runner.hostedCleanupJournalPath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("retains failed cleanup for resumable idempotent user deletion", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-recovery-retry-"),
  )
  const now = Date.now()
  const sourceRevision = "2".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  const email =
    "creator-share-ff029-dddddddddddddddddddddddddddddddd@example.com"
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const journal = await runner.createHostedCleanupJournal({
    stateRoot: repositoryRoot,
    sourceRevision,
  })
  await journal.trackEmail(email)
  await journal.trackUserId(userId)
  const evidenceContents = `${JSON.stringify({ retained: true })}\n`
  const evidencePath = await runner.writeHostedEvidence(evidenceContents, {
    repositoryRoot,
  })
  const commonOptions = {
    repositoryRoot,
    stateRoot: repositoryRoot,
    environment,
    lockPath: resolve(repositoryRoot, "run.lock"),
    nowMilliseconds: now,
    execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
    mailboxImplementation: mailbox(),
    serializeEvidenceImplementation: () => {
      throw new Error("serializer_must_not_run_during_recovery")
    },
  }
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      ...commonOptions,
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient(
              { email, id: userId },
              {
                deleteError: {
                  code: "unexpected_failure",
                  status: 500,
                },
              },
            )
          : { auth: {} },
    }),
  ).rejects.toThrow(/hosted_cleanup_failed/)
  expect(await readFile(evidencePath, "utf8")).toBe(evidenceContents)
  expect(
    await access(runner.hostedCleanupJournalPath(repositoryRoot)).then(
      () => true,
      () => false,
    ),
  ).toBe(true)

  const resumed = await runner.runHostedSupabaseEmailProofSupersessionCanary({
    ...commonOptions,
    createClientImplementation: (_url: string, key: string) =>
      key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
        ? cleanupServiceClient(null)
        : { auth: {} },
  })
  expect(resumed.status).toBe("resumed_cleanup_completed")
  await expect(
    access(runner.hostedCleanupJournalPath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  expect(await readFile(evidencePath, "utf8")).toBe(evidenceContents)
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("fails closed and retains recovery state when user inventory is uncertain", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-inventory-uncertain-"),
  )
  const now = Date.now()
  const sourceRevision = "5".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  const email =
    "creator-share-ff029-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee@example.com"
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const journal = await runner.createHostedCleanupJournal({
    stateRoot: repositoryRoot,
    sourceRevision,
  })
  await journal.trackEmail(email)
  await journal.trackUserId(userId)
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? {
              auth: {
                admin: {
                  async deleteUser() {
                    return {
                      data: {},
                      error: { code: "user_not_found", status: 404 },
                    }
                  },
                  async getUserById() {
                    return {
                      data: { user: null },
                      error: { code: "user_not_found", status: 404 },
                    }
                  },
                  async listUsers() {
                    return {
                      data: null,
                      error: {
                        code: "unexpected_failure",
                        status: 503,
                      },
                    }
                  },
                },
              },
            }
          : { auth: {} },
    }),
  ).rejects.toThrow(/hosted_cleanup_failed/)
  expect(
    await access(runner.hostedCleanupJournalPath(repositoryRoot)).then(
      () => true,
      () => false,
    ),
  ).toBe(true)
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("never deletes a journal UUID whose current user email is not tracked", async () => {
  const stateRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-malicious-journal-"),
  )
  const trackedEmail =
    "creator-share-ff029-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@example.com"
  const untrackedEmail =
    "creator-share-ff029-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@example.com"
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const journal = await runner.createHostedCleanupJournal({
    stateRoot,
    sourceRevision: "8".repeat(40),
  })
  await journal.trackEmail(trackedEmail)
  await journal.trackUserId(userId)
  let deleteCalls = 0
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    cleanupOnly: true,
    serviceRoleKey: hostedKey("service_role"),
    cleanupJournal: journal,
    mailboxImplementation: mailbox(),
    createClientImplementation: () => ({
      auth: {
        admin: {
          async deleteUser() {
            deleteCalls += 1
            return { data: {}, error: null }
          },
          async getUserById() {
            return {
              data: { user: { id: userId, email: untrackedEmail } },
              error: null,
            }
          },
          async listUsers() {
            return { data: { users: [], lastPage: 1 }, error: null }
          },
        },
      },
    }),
  })
  await expect(
    adapter.cleanup({ cleanupDeadline: Date.now() + 5_000 }),
  ).rejects.toThrow(/ff029_hosted_cleanup_failed/)
  expect(deleteCalls).toBe(0)
  expect(await access(journal.path).then(() => true)).toBe(true)
  await rm(stateRoot, { recursive: true, force: true })
})

test("accepts only an exact thrown Supabase 404 as proof a tracked UUID is absent", async () => {
  const stateRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-thrown-not-found-"),
  )
  const trackedEmail =
    "creator-share-ff029-cccccccccccccccccccccccccccccccc@example.com"
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const journal = await runner.createHostedCleanupJournal({
    stateRoot,
    sourceRevision: "9".repeat(40),
  })
  await journal.trackEmail(trackedEmail)
  await journal.trackUserId(userId)
  let deleteCalls = 0
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    cleanupOnly: true,
    serviceRoleKey: hostedKey("service_role"),
    cleanupJournal: journal,
    mailboxImplementation: mailbox(),
    createClientImplementation: () => ({
      auth: {
        admin: {
          async deleteUser() {
            deleteCalls += 1
            return { data: {}, error: null }
          },
          async getUserById() {
            throw Object.assign(new Error("provider omitted the user"), {
              code: "user_not_found",
              status: 404,
            })
          },
          async listUsers() {
            return { data: { users: [], lastPage: 1 }, error: null }
          },
        },
      },
    }),
  })
  await adapter.cleanup({ cleanupDeadline: Date.now() + 5_000 })
  expect(deleteCalls).toBe(0)
  await expect(access(journal.path)).rejects.toMatchObject({ code: "ENOENT" })
  await rm(stateRoot, { recursive: true, force: true })
})

test("retains the cleanup journal until mailbox close succeeds", async () => {
  const stateRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-mailbox-close-"),
  )
  const serviceRoleKey = hostedKey("service_role")
  const firstJournal = await runner.createHostedCleanupJournal({
    stateRoot,
    sourceRevision: "a".repeat(40),
  })
  const firstAdapter = await hosted.createHostedSupabaseEmailProofAdapter({
    cleanupOnly: true,
    serviceRoleKey,
    cleanupJournal: firstJournal,
    mailboxImplementation: {
      ...mailbox(),
      async close() {
        throw new Error("mailbox_close_failed")
      },
    },
    createClientImplementation: () => cleanupServiceClient(),
  })
  await expect(
    firstAdapter.cleanup({ cleanupDeadline: Date.now() + 5_000 }),
  ).rejects.toThrow(/ff029_hosted_cleanup_failed/)
  expect(await access(firstJournal.path).then(() => true)).toBe(true)

  const resumedJournal = await runner.createHostedCleanupJournal({
    stateRoot,
  })
  expect(resumedJournal.resumed).toBe(true)
  const recoveryAdapter = await hosted.createHostedSupabaseEmailProofAdapter({
    cleanupOnly: true,
    serviceRoleKey,
    cleanupJournal: resumedJournal,
    mailboxImplementation: mailbox(),
    createClientImplementation: () => cleanupServiceClient(),
  })
  await recoveryAdapter.cleanup({ cleanupDeadline: Date.now() + 5_000 })
  await expect(access(firstJournal.path)).rejects.toMatchObject({
    code: "ENOENT",
  })
  await rm(stateRoot, { recursive: true, force: true })
})

test("returns the exact project identity and exposes a real expiry observer", async () => {
  const now = Date.now()
  let clock = now
  let verificationCalls = 0
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const serviceClient = {
    auth: {
      admin: {
        async createUser() {
          throw new Error("not exercised")
        },
        async deleteUser() {
          return { error: null }
        },
        async generateLink({ email }: { email: string }) {
          return {
            data: {
              properties: {
                hashed_token: "t".repeat(40),
                verification_type: "magiclink",
              },
              user: { id: userId, email },
            },
            error: null,
          }
        },
        async listUsers() {
          return { data: { users: [], lastPage: 1 }, error: null }
        },
      },
    },
  }
  const anonClient = {
    auth: {
      async signInWithOtp() {
        throw new Error("not exercised")
      },
      async verifyOtp() {
        verificationCalls += 1
        return {
          data: {},
          error: { code: "otp_expired", status: 403 },
        }
      },
    },
  }
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    anonKey: hostedKey("anon", { now }),
    serviceRoleKey: hostedKey("service_role", { now }),
    pacingAttestation: pacingAttestation(now),
    cleanupJournal: cleanupJournal(),
    mailboxImplementation: mailbox(),
    fetchImplementation: async (input: RequestInfo | URL) => ({
      ok: true,
      redirected: false,
      status: 200,
      url: String(input),
      async json() {
        return { version: "v2.188.1" }
      },
    }),
    createClientImplementation: (_url: string, key: string) =>
      key === hostedKey("service_role", { now }) ? serviceClient : anonClient,
    pacerImplementation: {
      async paceAdmin() {},
      async paceEmail() {},
      async paceGroup() {},
    },
    nowImplementation: () => clock,
    expirySleepImplementation: async (milliseconds: number) => {
      clock += milliseconds
    },
  })
  await expect(adapter.initialize(lifecycle())).resolves.toEqual({
    authVersion: "v2.188.1",
    projectRef: "destjwstohzmufshfnuy",
  })
  const context = await adapter.prepareScenario(
    { accountState: "new" },
    lifecycle(),
  )
  const proof = await adapter.issueProof(
    context,
    "advocate_proof_a",
    lifecycle(),
    { async wait() {} },
  )
  await expect(
    adapter.observeExpiry(context, proof, lifecycle()),
  ).resolves.toMatchObject({
    outcome: "rejected",
    failureCategory: "none",
  })
  expect(verificationCalls).toBe(1)
})

test("timestamps proofs only after issuance and mailbox recovery complete", async () => {
  const startedAt = Date.now()
  let clock = startedAt
  const serviceKey = hostedKey("service_role", { now: startedAt })
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const timedMailbox = {
    ...mailbox(),
    async waitForNewMessage() {
      clock += 3_000
      return "1:1"
    },
    async proofFromMessage() {
      clock += 4_000
      return "p".repeat(40)
    },
  }
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    anonKey: hostedKey("anon", { now: startedAt }),
    serviceRoleKey: serviceKey,
    pacingAttestation: pacingAttestation(startedAt),
    cleanupJournal: cleanupJournal(),
    mailboxImplementation: timedMailbox,
    fetchImplementation: async () => {
      throw new Error("not exercised")
    },
    createClientImplementation: (_url: string, key: string) =>
      key === serviceKey
        ? {
            auth: {
              admin: {
                async generateLink({ email }: { email: string }) {
                  clock += 5_000
                  return {
                    data: {
                      properties: {
                        hashed_token: "t".repeat(40),
                        verification_type: "magiclink",
                      },
                      user: { id: userId, email },
                    },
                    error: null,
                  }
                },
              },
            },
          }
        : {
            auth: {
              async signInWithOtp() {
                clock += 2_000
                return { data: {}, error: null }
              },
            },
          },
    pacerImplementation: {
      async paceAdmin() {},
      async paceEmail() {},
      async paceGroup() {},
    },
    nowImplementation: () => clock,
  })
  const advocateContext = await adapter.prepareScenario(
    { accountState: "new" },
    lifecycle(),
  )
  const advocateProof = await adapter.issueProof(
    advocateContext,
    "advocate_proof_a",
    lifecycle(),
    { async wait() {} },
  )
  expect(advocateProof.issuedAt).toBe(startedAt + 5_000)

  const sponsorContext = await adapter.prepareScenario(
    { accountState: "new" },
    lifecycle(),
  )
  const sponsorProof = await adapter.issueProof(
    sponsorContext,
    "generic_sign_in",
    lifecycle(),
    { async wait() {} },
  )
  expect(sponsorProof.issuedAt).toBe(startedAt + 14_000)
})

test("binds hosted mailbox proof parsing to the exact per-flow link", async () => {
  const now = Date.now()
  const anonKey = hostedKey("anon", { now })
  let expectedTemplate: string | undefined
  const strictMailbox = {
    ...mailbox(),
    async proofFromMessage(
      _messageId: string,
      _lifecycle: unknown,
      template: string,
    ) {
      expectedTemplate = template
      return "p".repeat(40)
    },
  }
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    anonKey,
    serviceRoleKey: hostedKey("service_role", { now }),
    pacingAttestation: pacingAttestation(now),
    cleanupJournal: cleanupJournal(),
    mailboxImplementation: strictMailbox,
    fetchImplementation: async () => {
      throw new Error("not exercised")
    },
    createClientImplementation: (_url: string, key: string) =>
      key === anonKey
        ? {
            auth: {
              async signInWithOtp() {
                return { data: {}, error: null }
              },
            },
          }
        : { auth: { admin: {} } },
    pacerImplementation: {
      async paceAdmin() {},
      async paceEmail() {},
      async paceGroup() {},
    },
  })
  const context = await adapter.prepareScenario(
    { accountState: "new" },
    lifecycle(),
  )
  await adapter.issueProof(context, "generic_sign_in", lifecycle(), {
    async wait() {},
  })
  expect(expectedTemplate).toBe(
    "https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp#token_hash={token_hash}&v=1",
  )
})

test("paces one explicit two-request measurement group at actual dispatch", async () => {
  const now = Date.now()
  const serviceKey = hostedKey("service_role", { now })
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const providerDispatches: number[] = []
  const groupedReservations: Array<{
    adminSlots: number
    emailSlots: number
  }> = []
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    anonKey: hostedKey("anon", { now }),
    serviceRoleKey: serviceKey,
    pacingAttestation: pacingAttestation(now),
    cleanupJournal: cleanupJournal(),
    mailboxImplementation: mailbox(),
    fetchImplementation: async () => {
      throw new Error("not exercised")
    },
    createClientImplementation: (_url: string, key: string) =>
      key === serviceKey
        ? {
            auth: {
              admin: {
                async generateLink({ email }: { email: string }) {
                  providerDispatches.push(Date.now())
                  return {
                    data: {
                      properties: {
                        hashed_token: "t".repeat(40),
                        verification_type: "magiclink",
                      },
                      user: { id: userId, email },
                    },
                    error: null,
                  }
                },
              },
            },
          }
        : {
            auth: {
              async signInWithOtp() {
                providerDispatches.push(Date.now())
                return { data: {}, error: null }
              },
            },
          },
    pacerImplementation: {
      async paceAdmin() {
        throw new Error("sequential_pacer_not_expected")
      },
      async paceEmail() {
        throw new Error("sequential_pacer_not_expected")
      },
      async paceGroup(
        _email: string,
        reservation: { adminSlots: number; emailSlots: number },
      ) {
        groupedReservations.push(reservation)
        return { ...reservation, burstSize: 2, dispatchedAt: Date.now() }
      },
    },
  })
  const context = await adapter.prepareScenario(
    {
      accountState: "new",
      issuanceMode: "concurrent",
      flows: ["advocate_proof_a", "advocate_proof_b"],
    },
    lifecycle(),
  )
  const barrier = twoParticipantBarrier()
  await Promise.all([
    adapter.issueProof(context, "advocate_proof_a", lifecycle(), barrier),
    adapter.issueProof(context, "advocate_proof_b", lifecycle(), barrier),
  ])
  expect(groupedReservations).toEqual([{ adminSlots: 2, emailSlots: 0 }])
  expect(providerDispatches).toHaveLength(2)
  // Both requests must leave as one burst rather than being paced apart. An
  // exact same-millisecond assertion is a coin flip on a loaded runner, where
  // two genuinely concurrent dispatches can straddle a clock tick. The
  // documented sequential refill is 360 per hour, one dispatch every 10
  // seconds, so this bound still separates a burst from serialized pacing by
  // roughly two orders of magnitude. Serialization is caught outright anyway:
  // the sequential pacer stubs above throw whenever they are used at all.
  expect(
    Math.max(...providerDispatches) - Math.min(...providerDispatches),
  ).toBeLessThanOrEqual(250)
  const mixedContext = await adapter.prepareScenario(
    {
      accountState: "new",
      issuanceMode: "concurrent",
      flows: ["advocate_proof_a", "generic_sign_in"],
    },
    lifecycle(),
  )
  const mixedBarrier = twoParticipantBarrier()
  await Promise.all([
    adapter.issueProof(
      mixedContext,
      "advocate_proof_a",
      lifecycle(),
      mixedBarrier,
    ),
    adapter.issueProof(
      mixedContext,
      "generic_sign_in",
      lifecycle(),
      mixedBarrier,
    ),
  ])
  expect(groupedReservations).toEqual([
    { adminSlots: 2, emailSlots: 0 },
    { adminSlots: 1, emailSlots: 1 },
  ])
  await expect(
    adapter.issueProof(context, "advocate_proof_a", lifecycle(), {
      async wait() {},
    }),
  ).rejects.toThrow(/concurrent_burst_invalid/)
})

test("rejects any future two-SMTP concurrent pair before mailbox use", async () => {
  const now = Date.now()
  const journal = cleanupJournal()
  let mailboxSnapshots = 0
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    anonKey: hostedKey("anon", { now }),
    serviceRoleKey: hostedKey("service_role", { now }),
    pacingAttestation: pacingAttestation(now),
    cleanupJournal: journal,
    mailboxImplementation: {
      ...mailbox(),
      async snapshot() {
        mailboxSnapshots += 1
        return new Set()
      },
    },
    fetchImplementation: async () => {
      throw new Error("not exercised")
    },
    createClientImplementation: () => ({ auth: { admin: {} } }),
    pacerImplementation: {
      async paceAdmin() {},
      async paceEmail() {},
      async paceGroup() {},
    },
  })
  await expect(
    adapter.prepareScenario(
      {
        accountState: "new",
        issuanceMode: "concurrent",
        flows: ["generic_sign_in", "existing_account_claim"],
      },
      lifecycle(),
    ),
  ).rejects.toThrow(/concurrent_smtp_pair_unsupported/)
  expect(mailboxSnapshots).toBe(0)
  expect(await journal.snapshot()).toEqual({
    trackedEmails: [],
    trackedUserIds: [],
  })
})

test("never retries an ambiguous hosted issuance", async () => {
  const now = Date.now()
  let issuanceCalls = 0
  const serviceKey = hostedKey("service_role", { now })
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    anonKey: hostedKey("anon", { now }),
    serviceRoleKey: serviceKey,
    pacingAttestation: pacingAttestation(now),
    cleanupJournal: cleanupJournal(),
    mailboxImplementation: mailbox(),
    fetchImplementation: async () => {
      throw new Error("not exercised")
    },
    createClientImplementation: (_url: string, key: string) =>
      key === serviceKey
        ? {
            auth: {
              admin: {
                async generateLink() {
                  issuanceCalls += 1
                  throw new Error("ambiguous_provider_failure")
                },
              },
            },
          }
        : { auth: {} },
    pacerImplementation: {
      async paceAdmin() {},
      async paceEmail() {},
      async paceGroup() {},
    },
  })
  const context = await adapter.prepareScenario(
    { accountState: "new" },
    lifecycle(),
  )
  await expect(
    adapter.issueProof(context, "advocate_proof_a", lifecycle(), {
      async wait() {},
    }),
  ).rejects.toThrow(/advocate_proof_issuance_unavailable/)
  expect(issuanceCalls).toBe(1)
})

test("never retries a hosted verification after provider rate limiting", async () => {
  const now = Date.now()
  const serviceKey = hostedKey("service_role", { now })
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  let verificationCalls = 0
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    anonKey: hostedKey("anon", { now }),
    serviceRoleKey: serviceKey,
    pacingAttestation: pacingAttestation(now),
    cleanupJournal: cleanupJournal(),
    mailboxImplementation: mailbox(),
    fetchImplementation: async () => {
      throw new Error("not exercised")
    },
    createClientImplementation: (_url: string, key: string) =>
      key === serviceKey
        ? {
            auth: {
              admin: {
                async generateLink({ email }: { email: string }) {
                  return {
                    data: {
                      properties: {
                        hashed_token: "t".repeat(40),
                        verification_type: "magiclink",
                      },
                      user: { id: userId, email },
                    },
                    error: null,
                  }
                },
              },
            },
          }
        : {
            auth: {
              async verifyOtp() {
                verificationCalls += 1
                return {
                  data: {},
                  error: {
                    code: "over_request_rate_limit",
                    message: "Rate limit exceeded",
                    status: 429,
                  },
                }
              },
            },
          },
    pacerImplementation: {
      async paceAdmin() {},
      async paceEmail() {},
      async paceGroup() {},
    },
    verificationPacerImplementation: {
      async pace() {},
    },
  })
  const context = await adapter.prepareScenario(
    { accountState: "new" },
    lifecycle(),
  )
  const proof = await adapter.issueProof(
    context,
    "advocate_proof_a",
    lifecycle(),
    { async wait() {} },
  )
  await expect(
    adapter.consumeProof(context, proof, lifecycle()),
  ).resolves.toEqual({
    outcome: "provider_error",
    authenticationMethod: "provider_error",
    failureCategory: "rate_limited",
  })
  expect(verificationCalls).toBe(1)
})

test("joins a late hosted Auth mutation or retains machine ownership", async () => {
  const now = Date.now()
  const serviceRoleKey = hostedKey("service_role", { now })
  let authCalls = 0
  let mutationAt = 0
  const adapter = await hosted.createHostedSupabaseEmailProofAdapter({
    anonKey: hostedKey("anon", { now }),
    serviceRoleKey,
    pacingAttestation: pacingAttestation(now),
    cleanupJournal: cleanupJournal(),
    mailboxImplementation: mailbox(),
    fetchImplementation: async (input: RequestInfo | URL) => ({
      ok: true,
      redirected: false,
      status: 200,
      url: String(input),
      async json() {
        return { version: "v2.188.1" }
      },
    }),
    createClientImplementation: (_url: string, key: string) =>
      key === serviceRoleKey
        ? {
            auth: {
              admin: {
                async generateLink() {
                  return {
                    data: {},
                    error: {
                      code: "unexpected_failure",
                      status: 503,
                    },
                  }
                },
                async listUsers() {
                  return {
                    data: { users: [], lastPage: 1 },
                    error: null,
                  }
                },
              },
            },
          }
        : {
            auth: {
              async signInWithOtp() {
                authCalls += 1
                if (authCalls > 1) {
                  throw new Error("subsequent_auth_call_rejected")
                }
                await new Promise((resolvePromise) =>
                  setTimeout(resolvePromise, 120),
                )
                mutationAt = Date.now()
                return { data: {}, error: null }
              },
            },
          },
    pacerImplementation: {
      async paceAdmin() {},
      async paceEmail() {},
      async paceGroup() {},
    },
    verificationPacerImplementation: {
      async pace() {},
    },
  })
  let settledAt = 0
  const outcome = await core
    .runSupabaseEmailProofSupersessionCanary(adapter, {
      evidenceProfile: "hosted_v4",
      operationTimeoutMilliseconds: 25,
      totalBudgetMilliseconds: 120,
      cleanupBudgetMilliseconds: 30,
      cleanupAbortJoinMilliseconds: 30,
      absoluteTotalDeadline: now + 120,
      provenance: hostedProvenance("f".repeat(40)),
    })
    .then(
      (report: unknown) => ({
        status: "resolved" as const,
        error: null,
        report,
      }),
      (error: unknown) => ({
        status: "rejected" as const,
        error,
        report: null,
      }),
    )
    .finally(() => {
      settledAt = Date.now()
    })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 160))
  expect(authCalls).toBeGreaterThanOrEqual(1)
  expect(mutationAt).toBeGreaterThan(0)
  if (settledAt < mutationAt) {
    expect(outcome.status).toBe("rejected")
    expect(
      (outcome.error as { ff029RetainExclusiveOwnership?: boolean })
        .ff029RetainExclusiveOwnership,
    ).toBe(true)
  } else {
    expect(settledAt).toBeGreaterThanOrEqual(mutationAt)
  }
})

test("joins every concurrent issuance sibling before cleanup can close recovery state", async () => {
  const stateRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-concurrent-sibling-"),
  )
  const sourceRevision = "7".repeat(40)
  const email =
    "creator-share-ff029-77777777777777777777777777777777@example.com"
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const journal = await runner.createHostedCleanupJournal({
    stateRoot,
    sourceRevision,
  })
  await journal.trackEmail(email)

  let targetPrepared = false
  let providerCreatedAt = 0
  let siblingRecordedAt = 0
  let siblingTrackError: unknown = null
  let cleanupStartedAt = 0
  let cleanupCompletedAt = 0
  /**
   * Why an interrupted sibling stopped being waited for. This assertion fails
   * roughly once per hundred runs and only on CI, which no local campaign has
   * reproduced, so the failure has to carry its own explanation.
   */
  const joinRecords: Ff029JoinRecord[] = []
  let cleanupSnapshot: { trackedUserIds: readonly string[] } | null = null
  let settledAt = 0
  let markSiblingStarted!: () => void
  const siblingStarted = new Promise<void>((resolvePromise) => {
    markSiblingStarted = resolvePromise
  })
  let markSiblingDone!: () => void
  const siblingDone = new Promise<void>((resolvePromise) => {
    markSiblingDone = resolvePromise
  })
  const run = core
    .runSupabaseEmailProofSupersessionCanary(
      {
        async initialize() {
          return { authVersion: "v2.188.1" }
        },
        async prepareScenario(definition: {
          flows: string[]
          issuanceMode: string
        }) {
          if (definition.issuanceMode !== "concurrent" || targetPrepared) {
            throw new Error("skip_non_target_scenario")
          }
          targetPrepared = true
          return { flows: definition.flows }
        },
        async issueProof(
          context: { flows: string[] },
          flow: string,
          _lifecycle: { signal: AbortSignal },
          dispatchBarrier: { wait(): Promise<void> },
        ) {
          await dispatchBarrier.wait()
          if (flow === context.flows[0]) {
            throw retainedOwnershipError(
              "ff029_concurrent_issuance_retained_fixture",
            )
          }
          markSiblingStarted()
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
          providerCreatedAt = Date.now()
          try {
            await journal.trackUserId(userId)
            siblingRecordedAt = Date.now()
          } catch (error) {
            siblingTrackError = error
            throw error
          } finally {
            markSiblingDone()
          }
          return { opaque: flow }
        },
        async consumeProof() {
          return "accepted"
        },
        async cleanup(options: { retainRecoveryState?: boolean }) {
          cleanupStartedAt = Date.now()
          cleanupSnapshot = await journal.snapshot()
          if (options.retainRecoveryState !== true) {
            await journal.complete()
            cleanupCompletedAt = Date.now()
          }
        },
      },
      {
        operationTimeoutMilliseconds: 500,
        totalBudgetMilliseconds: 1_500,
        cleanupBudgetMilliseconds: 300,
        cleanupAbortJoinMilliseconds: 250,
        recordOperationJoin: (record: Ff029JoinRecord) => {
          joinRecords.push(record)
        },
        provenance: hostedProvenance(sourceRevision),
      },
    )
    .then(
      () => ({ status: "resolved" as const, error: null }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )
    .finally(() => {
      settledAt = Date.now()
    })

  try {
    await siblingStarted
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 75))
    const journalPresentBeforeSibling = await access(journal.path).then(
      () => true,
      () => false,
    )
    const cleanupCompletedBeforeSibling = cleanupCompletedAt !== 0
    await Promise.race([
      siblingDone,
      new Promise((_, rejectPromise) =>
        setTimeout(
          () => rejectPromise(new Error("late_sibling_did_not_settle")),
          1_000,
        ),
      ),
    ])
    const outcome = await run
    const finalJournalPresent = await access(journal.path).then(
      () => true,
      () => false,
    )
    const finalTrackedUserIds = finalJournalPresent
      ? (await journal.snapshot()).trackedUserIds
      : ((
          cleanupSnapshot as {
            trackedUserIds: readonly string[]
          } | null
        )?.trackedUserIds ?? [])

    expect.soft(journalPresentBeforeSibling).toBe(true)
    expect.soft(cleanupCompletedBeforeSibling).toBe(false)
    expect.soft(siblingTrackError).toBeNull()
    expect.soft(siblingRecordedAt).toBeGreaterThanOrEqual(providerCreatedAt)
    expect.soft(settledAt).toBeGreaterThanOrEqual(providerCreatedAt)
    // An empty diagnostic would mean the recorder was never wired, which would
    // leave a rare failure just as unexplained as before. Fail loudly instead.
    expect(
      joinRecords.length,
      "the join recorder must be wired or the diagnostic below is empty",
    ).toBeGreaterThan(0)
    expect
      .soft(
        cleanupStartedAt === 0 || cleanupStartedAt >= siblingRecordedAt,
        `cleanup must not close recovery state before the sibling was recorded. ${JSON.stringify(
          {
            cleanupStartedAt,
            siblingRecordedAt,
            inversionMilliseconds: siblingRecordedAt - cleanupStartedAt,
            joinRecords,
          },
        )}`,
      )
      .toBe(true)
    expect.soft(finalTrackedUserIds).toContain(userId)
    expect(outcome.status).toBe("rejected")
    expect(
      (outcome.error as { ff029RetainExclusiveOwnership?: boolean })
        .ff029RetainExclusiveOwnership,
    ).toBe(true)
  } finally {
    await run
    await siblingDone
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("keeps recovery state durable when a concurrent sibling cannot join", async () => {
  const stateRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-unjoinable-sibling-"),
  )
  const sourceRevision = "8".repeat(40)
  const email =
    "creator-share-ff029-88888888888888888888888888888888@example.com"
  const journal = await runner.createHostedCleanupJournal({
    stateRoot,
    sourceRevision,
  })
  await journal.trackEmail(email)

  let targetPrepared = false
  let siblingObservedAbort = false
  /**
   * This scenario forces a sibling that can never settle, so it is the
   * deterministic anchor for the abandoned branch. Recording it here proves the
   * diagnostic distinguishes a join from an abandonment rather than merely
   * reporting the happy path.
   */
  const abandonedJoinRecords: Ff029JoinRecord[] = []
  let cleanupCompleted = false
  const startedAt = Date.now()
  const outcome = await core
    .runSupabaseEmailProofSupersessionCanary(
      {
        async initialize() {
          return { authVersion: "v2.188.1" }
        },
        async prepareScenario(definition: {
          flows: string[]
          issuanceMode: string
        }) {
          if (definition.issuanceMode !== "concurrent" || targetPrepared) {
            throw new Error("skip_non_target_scenario")
          }
          targetPrepared = true
          return { flows: definition.flows }
        },
        async issueProof(
          context: { flows: string[] },
          flow: string,
          operationLifecycle: { signal: AbortSignal },
          dispatchBarrier: { wait(): Promise<void> },
        ) {
          await dispatchBarrier.wait()
          if (flow === context.flows[0]) {
            throw retainedOwnershipError(
              "ff029_concurrent_issuance_retained_fixture",
            )
          }
          operationLifecycle.signal.addEventListener(
            "abort",
            () => {
              siblingObservedAbort = true
            },
            { once: true },
          )
          return new Promise(() => {})
        },
        async consumeProof() {
          return "accepted"
        },
        async cleanup(options: { retainRecoveryState?: boolean }) {
          if (options.retainRecoveryState !== true) {
            await journal.complete()
            cleanupCompleted = true
          }
        },
      },
      {
        operationTimeoutMilliseconds: 60,
        totalBudgetMilliseconds: 180,
        cleanupBudgetMilliseconds: 60,
        cleanupAbortJoinMilliseconds: 25,
        recordOperationJoin: (record: Ff029JoinRecord) => {
          abandonedJoinRecords.push(record)
        },
        provenance: hostedProvenance(sourceRevision),
      },
    )
    .then(
      () => ({ status: "resolved" as const, error: null }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )

  try {
    expect(Date.now() - startedAt).toBeLessThan(500)
    // The decisive half of the diagnostic contract: a sibling that never
    // settles must be recorded as abandoned, not as joined.
    expect(
      abandonedJoinRecords.length,
      "the join recorder must be wired",
    ).toBeGreaterThan(0)
    expect(
      abandonedJoinRecords.some(
        (record) => record.joinedWithinBudget === false,
      ),
      `a never settling sibling must record an expired join budget. ${JSON.stringify(abandonedJoinRecords)}`,
    ).toBe(true)
    expect(outcome.status).toBe("rejected")
    expect(
      (outcome.error as { ff029RetainExclusiveOwnership?: boolean })
        .ff029RetainExclusiveOwnership,
    ).toBe(true)
    expect(siblingObservedAbort).toBe(true)
    expect(cleanupCompleted).toBe(false)
    expect(await access(journal.path).then(() => true)).toBe(true)
    expect((await journal.snapshot()).trackedEmails).toContain(email)
  } finally {
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("executes only a pinned private management observer with a canonical request", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-management-command-"),
  )
  await chmod(directory, 0o700)
  const command = resolve(directory, "observer.cjs")
  const capturePath = resolve(directory, "captured-request.json")
  const executableSource = [
    `#!${process.execPath}`,
    '"use strict"',
    'const { createHash } = require("node:crypto")',
    'const { writeFileSync } = require("node:fs")',
    "function normalize(value) {",
    '  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value',
    "  if (Array.isArray(value)) return value.map(normalize)",
    "  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))",
    "}",
    "const canonical = (value) => JSON.stringify(normalize(value))",
    'let source = ""',
    'process.stdin.setEncoding("utf8")',
    'process.stdin.on("data", (chunk) => { source += chunk })',
    'process.stdin.on("end", () => {',
    "  if (process.argv.slice(2).length !== 0) process.exit(11)",
    '  if (process.cwd() !== "/" || process.env.LANG !== "C" || process.env.LC_ALL !== "C" || process.env.PATH !== "/usr/bin:/bin" || process.env.HOME !== undefined || process.env.SUPABASE_ACCESS_TOKEN !== undefined) process.exit(12)',
    "  const request = JSON.parse(source)",
    "  if (source !== `${canonical(request)}\\n`) process.exit(13)",
    `  writeFileSync(${JSON.stringify(capturePath)}, source, { flag: "wx", mode: 0o600 })`,
    "  const response = {",
    '    authentication: "supabase_management_api_personal_access_token",',
    "    config: request.expected_config,",
    '    config_digest: createHash("sha256").update(canonical(request.expected_config)).digest("hex"),',
    '    credential_source: "supabase_cli_native_keychain",',
    "    harness_digest: request.harness_digest,",
    "    http_status: 200,",
    "    issued_at: request.issued_at,",
    '    kind: "ff029_authenticated_management_auth_limits_observation",',
    "    management_api_origin: request.management_api_origin,",
    "    not_after: request.not_after,",
    "    observed_at: request.issued_at,",
    "    operator_attestation_digest: request.operator_attestation_digest,",
    "    phase: request.phase,",
    "    project_ref: request.project_ref,",
    "    request_digest: request.request_digest,",
    "    request_nonce: request.request_nonce,",
    "    run_nonce: request.run_nonce,",
    "    schema_version: 1,",
    "    source_revision: request.source_revision,",
    "    supabase_origin: request.supabase_origin,",
    "  }",
    "  process.stdout.write(`${canonical(response)}\\n`)",
    "})",
    "",
  ].join("\n")
  await writeFile(command, executableSource, { flag: "wx", mode: 0o500 })
  await chmod(command, 0o500)
  const commandDigest = createHash("sha256")
    .update(executableSource)
    .digest("hex")
  const hook = await runner.createCommandManagementAttestationHook({
    FF029_MANAGEMENT_ATTESTOR_COMMAND: command,
    FF029_MANAGEMENT_ATTESTOR_SHA256: commandDigest,
    NODE_ENV: "test",
  })
  expect((hook as unknown as { observerDigest: string }).observerDigest).toBe(
    commandDigest,
  )

  const now = Math.floor(Date.now() / 1_000) * 1_000
  const environment = hostedEnvironment(now)
  const configuration = runner.readHostedSupabaseEmailProofEnvironment(
    environment,
    { nowMilliseconds: now },
  )
  const requestPayload = {
    expected_config: {
      mailer_otp_exp: 60,
      rate_limit_email_sent: 120,
      rate_limit_otp: 120,
      rate_limit_verify: 30,
      smtp_max_frequency: 1,
    },
    harness_digest: "e".repeat(64),
    issued_at: new Date(now).toISOString(),
    kind: "ff029_management_auth_limits_observation_request",
    management_api_origin: "https://api.supabase.com",
    not_after: new Date(now + 10_000).toISOString(),
    operator_attestation_digest:
      configuration.pacingAttestation.attestation_digest,
    phase: "preflight" as const,
    project_ref: "destjwstohzmufshfnuy",
    request_nonce: "1".repeat(64),
    run_nonce: "2".repeat(64),
    schema_version: 1,
    source_revision: configuration.sourceRevision,
    supabase_origin: "https://destjwstohzmufshfnuy.supabase.co",
  }
  const request: ManagementObservationRequest & {
    kind: string
    schema_version: number
  } = {
    ...requestPayload,
    request_digest: sha256Json(requestPayload),
  }
  const observation = await hook(request, {
    signal: new AbortController().signal,
  })
  expect(await readFile(capturePath, "utf8")).toBe(
    `${canonicalJson(request)}\n`,
  )
  expect(
    runner.validateHostedManagementLimitsObservation(
      observation,
      configuration,
      "preflight",
      request,
      now,
    ),
  ).toEqual(observation)

  let cancelledSpawnCalls = 0
  const cancelledHook = await runner.createCommandManagementAttestationHook(
    {
      FF029_MANAGEMENT_ATTESTOR_COMMAND: command,
      FF029_MANAGEMENT_ATTESTOR_SHA256: commandDigest,
      NODE_ENV: "test",
    },
    {
      spawnImplementation: () => {
        cancelledSpawnCalls += 1
        throw new Error("cancelled_hook_must_not_spawn")
      },
    },
  )
  const cancellation = new AbortController()
  const cancelledInvocation = cancelledHook(request, {
    signal: cancellation.signal,
  })
  cancellation.abort()
  await expect(cancelledInvocation).rejects.toThrow(
    /management_attestor_command_cancelled/,
  )
  expect(cancelledSpawnCalls).toBe(0)

  let spawnCalls = 0
  const spawnImplementation = () => {
    spawnCalls += 1
    throw new Error("spawn_must_not_run")
  }
  await chmod(command, 0o700)
  await expect(
    runner.createCommandManagementAttestationHook(
      {
        FF029_MANAGEMENT_ATTESTOR_COMMAND: command,
        FF029_MANAGEMENT_ATTESTOR_SHA256: commandDigest,
        NODE_ENV: "test",
      },
      { spawnImplementation },
    ),
  ).rejects.toThrow(/management_attestor_command_invalid/)
  await chmod(command, 0o500)
  await expect(
    runner.createCommandManagementAttestationHook(
      {
        FF029_MANAGEMENT_ATTESTOR_COMMAND: command,
        FF029_MANAGEMENT_ATTESTOR_SHA256: "0".repeat(64),
        NODE_ENV: "test",
      },
      { spawnImplementation },
    ),
  ).rejects.toThrow(/management_attestor_command_invalid/)
  expect(spawnCalls).toBe(0)
  await rm(directory, { recursive: true, force: true })
})

test("cancels the management observer's complete descendant process group", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-management-descendant-"),
  )
  await chmod(directory, 0o700)
  const command = resolve(directory, "observer.cjs")
  const readyPath = resolve(directory, "descendant-ready")
  const mutationPath = resolve(directory, "descendant-mutation")
  const descendantSource = [
    '"use strict"',
    'const { writeFileSync } = require("node:fs")',
    `setTimeout(() => writeFileSync(${JSON.stringify(mutationPath)}, "late"), 200)`,
    "setInterval(() => {}, 1000)",
  ].join(";")
  const executableSource = [
    `#!${process.execPath}`,
    '"use strict"',
    'const { spawn } = require("node:child_process")',
    'const { writeFileSync } = require("node:fs")',
    "process.stdin.resume()",
    'process.stdin.on("end", () => {',
    `  spawn(${JSON.stringify(process.execPath)}, ["-e", ${JSON.stringify(descendantSource)}], { stdio: "ignore" })`,
    `  writeFileSync(${JSON.stringify(readyPath)}, "ready", { flag: "wx", mode: 0o600 })`,
    "  setInterval(() => {}, 1000)",
    "})",
    "",
  ].join("\n")
  await writeFile(command, executableSource, { flag: "wx", mode: 0o500 })
  await chmod(command, 0o500)
  const hook = await runner.createCommandManagementAttestationHook({
    FF029_MANAGEMENT_ATTESTOR_COMMAND: command,
    FF029_MANAGEMENT_ATTESTOR_SHA256: createHash("sha256")
      .update(executableSource)
      .digest("hex"),
    NODE_ENV: "test",
  })
  const controller = new AbortController()
  const invocation = hook(
    { kind: "ff029_descendant_cancellation_fixture", schema_version: 1 },
    { signal: controller.signal },
  )
  let descendantReady = false
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      descendantReady = await access(readyPath).then(
        () => true,
        () => false,
      )
      if (descendantReady) break
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
    }
    expect(descendantReady).toBe(true)
    controller.abort()
    await expect(invocation).rejects.toThrow(
      /management_attestor_command_cancelled/,
    )
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350))
    await expect(access(mutationPath)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    controller.abort()
    await invocation.catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})

test("retains ownership when a terminated observer process group stays alive", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-management-unsettled-group-"),
  )
  await chmod(directory, 0o700)
  const command = resolve(directory, "observer.cjs")
  const executableSource = `#!${process.execPath}\n"use strict"\n`
  await writeFile(command, executableSource, { flag: "wx", mode: 0o500 })
  await chmod(command, 0o500)

  const child = Object.assign(new EventEmitter(), {
    pid: 42_424,
    stdin: Object.assign(new EventEmitter(), {
      end() {},
    }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
  let markSpawned!: () => void
  const spawned = new Promise<void>((resolvePromise) => {
    markSpawned = resolvePromise
  })
  let leaderClosed = false
  const terminationSignals: string[] = []
  let processGroupChecks = 0
  const hook = await runner.createCommandManagementAttestationHook(
    {
      FF029_MANAGEMENT_ATTESTOR_COMMAND: command,
      FF029_MANAGEMENT_ATTESTOR_SHA256: createHash("sha256")
        .update(executableSource)
        .digest("hex"),
      NODE_ENV: "test",
    },
    {
      spawnImplementation() {
        markSpawned()
        return child
      },
      killProcessGroupImplementation(_processId: number, signal: string) {
        terminationSignals.push(signal)
        if (!leaderClosed && signal === "SIGTERM") {
          leaderClosed = true
          queueMicrotask(() => child.emit("close", null, "SIGTERM"))
        }
      },
      async processGroupAliveImplementation() {
        processGroupChecks += 1
        return true
      },
      processGroupJoinMilliseconds: 25,
    },
  )
  const controller = new AbortController()
  const startedAt = Date.now()
  const invocation = hook(
    { kind: "ff029_unsettled_process_group_fixture", schema_version: 1 },
    { signal: controller.signal },
  )
  try {
    await spawned
    controller.abort()
    const outcome = await invocation.then(
      () => ({ status: "resolved" as const, error: null }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )
    expect(outcome.status).toBe("rejected")
    expect((outcome.error as Error).message).toBe(
      "ff029_management_attestor_process_group_unsettled",
    )
    expect(
      (outcome.error as { ff029RetainExclusiveOwnership?: boolean })
        .ff029RetainExclusiveOwnership,
    ).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(terminationSignals).toContain("SIGTERM")
    expect(terminationSignals).toContain("SIGKILL")
    expect(processGroupChecks).toBeGreaterThanOrEqual(1)
  } finally {
    controller.abort()
    await invocation.catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects a successful observer leader that leaves a descendant alive", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-management-success-descendant-"),
  )
  await chmod(directory, 0o700)
  const command = resolve(directory, "observer.cjs")
  const executableSource = `#!${process.execPath}\n"use strict"\n`
  await writeFile(command, executableSource, { flag: "wx", mode: 0o500 })
  await chmod(command, 0o500)

  const stdout = new EventEmitter()
  const child = Object.assign(new EventEmitter(), {
    pid: 42_425,
    stdin: Object.assign(new EventEmitter(), {
      end() {
        queueMicrotask(() => {
          stdout.emit("data", `${canonicalJson({ accepted: true })}\n`)
          child.emit("close", 0, null)
        })
      },
    }),
    stdout,
    stderr: new EventEmitter(),
  })
  const terminationSignals: string[] = []
  let processGroupChecks = 0
  const hook = await runner.createCommandManagementAttestationHook(
    {
      FF029_MANAGEMENT_ATTESTOR_COMMAND: command,
      FF029_MANAGEMENT_ATTESTOR_SHA256: createHash("sha256")
        .update(executableSource)
        .digest("hex"),
      NODE_ENV: "test",
    },
    {
      spawnImplementation: () => child,
      killProcessGroupImplementation(_processId: number, signal: string) {
        terminationSignals.push(signal)
      },
      async processGroupAliveImplementation() {
        processGroupChecks += 1
        return true
      },
      processGroupJoinMilliseconds: 25,
    },
  )
  const outcome = await hook(
    { kind: "ff029_success_descendant_fixture", schema_version: 1 },
    { signal: new AbortController().signal },
  ).then(
    (result) => ({ status: "resolved" as const, error: null, result }),
    (error: unknown) => ({
      status: "rejected" as const,
      error,
      result: null,
    }),
  )
  try {
    expect(outcome.status).toBe("rejected")
    expect((outcome.error as Error).message).toBe(
      "ff029_management_attestor_process_group_unsettled",
    )
    expect(
      (outcome.error as { ff029RetainExclusiveOwnership?: boolean })
        .ff029RetainExclusiveOwnership,
    ).toBe(true)
    expect(processGroupChecks).toBeGreaterThanOrEqual(1)
    expect(terminationSignals).toContain("SIGTERM")
    expect(terminationSignals).toContain("SIGKILL")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("supports exact-project sanitized management observations without secrets", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-management-hook-"),
  )
  const now = Date.now()
  const sourceRevision = "3".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  const observerDigest = "a".repeat(64)
  const requests: ManagementObservationRequest[] = []
  const result = await runner.runHostedSupabaseEmailProofSupersessionCanary({
    repositoryRoot,
    stateRoot: repositoryRoot,
    environment,
    lockPath: resolve(repositoryRoot, "run.lock"),
    nowMilliseconds: now,
    execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
    mailboxImplementation: mailbox(),
    createClientImplementation: (_url: string, key: string) =>
      key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
        ? cleanupServiceClient()
        : { auth: {} },
    provenance: hostedProvenance(sourceRevision),
    postflightProvenanceImplementation: async () =>
      hostedProvenance(sourceRevision),
    managementObserverDigest: observerDigest,
    managementAttestationHookImplementation: async (
      request: ManagementObservationRequest,
    ) => {
      requests.push(request)
      return managementObservation(request)
    },
    runCanaryImplementation: async (adapter: {
      cleanup(options: { cleanupDeadline: number }): Promise<void>
    }) => {
      await adapter.cleanup({ cleanupDeadline: Date.now() + 60_000 })
      return {
        cleanup: "completed",
        scope: "hosted_staging",
        project_ref: "destjwstohzmufshfnuy",
      }
    },
    serializeEvidenceImplementation: (report: unknown) =>
      `${JSON.stringify(report)}\n`,
  })
  expect(result.status).toBe("completed")
  expect(result.managementObservations).toHaveLength(2)
  expect(
    result.managementObservations.map(
      (observation: { phase: string }) => observation.phase,
    ),
  ).toEqual(["preflight", "postflight"])
  const serializedRequests = JSON.stringify(requests)
  expect(serializedRequests).not.toContain(
    environment.FF029_HOSTED_SUPABASE_ANON_KEY,
  )
  expect(serializedRequests).not.toContain(
    environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY,
  )
  expect(serializedRequests).not.toContain(
    environment.FF029_ETHEREAL_IMAP_PASSWORD,
  )
  expect(requests).toHaveLength(2)
  expect(requests.map((request) => request.expected_config)).toEqual([
    {
      mailer_otp_exp: 60,
      rate_limit_email_sent: 120,
      rate_limit_otp: 120,
      rate_limit_verify: 30,
      smtp_max_frequency: 1,
    },
    {
      mailer_otp_exp: 60,
      rate_limit_email_sent: 120,
      rate_limit_otp: 120,
      rate_limit_verify: 30,
      smtp_max_frequency: 1,
    },
  ])
  await expect(
    access(runner.hostedCleanupJournalPath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })

  const evidencePath = runner.hostedEvidencePath(repositoryRoot)
  if (result.status !== "completed" || !("evidence" in result)) {
    throw new Error("expected_completed_hosted_evidence")
  }
  expect(result.evidence).toEqual({ path: evidencePath })
  expect((await lstat(evidencePath)).mode & 0o777).toBe(0o600)
  const serializedEvidence = await readFile(evidencePath, "utf8")
  const evidence = JSON.parse(serializedEvidence)
  const { binding_digest: bindingDigest, ...boundPayload } = evidence
  expect(Object.keys(evidence).sort()).toEqual(
    [
      "binding_digest",
      "core_report",
      "harness_digest",
      "kind",
      "management_api_origin",
      "management_observations",
      "normalized_config_digest",
      "observer_digest",
      "operator_attestation_digest",
      "postflight_request_digest",
      "preflight_request_digest",
      "project_ref",
      "run_nonce",
      "schema_version",
      "source_revision",
      "supabase_origin",
    ].sort(),
  )
  expect(evidence).toMatchObject({
    schema_version: 1,
    kind: "ff029_hosted_supabase_email_proof_evidence",
    project_ref: "destjwstohzmufshfnuy",
    supabase_origin: "https://destjwstohzmufshfnuy.supabase.co",
    management_api_origin: "https://api.supabase.com",
    source_revision: sourceRevision,
    harness_digest: hostedProvenance(sourceRevision).harness_digest,
    observer_digest: observerDigest,
    core_report: {
      cleanup: "completed",
      scope: "hosted_staging",
      project_ref: "destjwstohzmufshfnuy",
    },
  })
  expect(evidence.management_observations).toEqual(
    result.managementObservations,
  )
  expect(evidence.preflight_request_digest).toBe(requests[0].request_digest)
  expect(evidence.postflight_request_digest).toBe(requests[1].request_digest)
  expect(evidence.normalized_config_digest).toBe(
    sha256Json(requests[0].expected_config),
  )
  expect(bindingDigest).toBe(sha256Json(boundPayload))
  expect(serializedEvidence).not.toContain(
    environment.FF029_HOSTED_SUPABASE_ANON_KEY,
  )
  expect(serializedEvidence).not.toContain(
    environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY,
  )
  expect(serializedEvidence).not.toContain(
    environment.FF029_ETHEREAL_IMAP_PASSWORD,
  )

  const validObservation = result.managementObservations[0]
  expect(() =>
    runner.validateHostedManagementLimitsObservation(
      { ...validObservation, project_ref: "attacker-project" },
      runner.readHostedSupabaseEmailProofEnvironment(environment, {
        nowMilliseconds: now,
      }),
      "preflight",
      requests[0],
      now,
    ),
  ).toThrow(/management_observation_invalid/)
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("requires a bound management observer before any evidence canary executes", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-management-gate-"),
  )
  const now = Date.now()
  const sourceRevision = "c".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  let canaryCalls = 0
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      postflightProvenanceImplementation: async () =>
        hostedProvenance(sourceRevision),
      managementAttestationHookImplementation: async (
        request: ManagementObservationRequest,
      ) => managementObservation(request),
      runCanaryImplementation: async () => {
        canaryCalls += 1
        throw new Error("evidence_canary_must_not_run")
      },
      serializeEvidenceImplementation: () =>
        `${JSON.stringify({
          scope: "hosted_staging",
          project_ref: "destjwstohzmufshfnuy",
          cleanup: "completed",
        })}\n`,
    }),
  ).rejects.toThrow(/management_observer_digest_invalid/)
  expect(canaryCalls).toBe(0)
  await expect(
    access(runner.hostedEvidencePath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("rechecks clean source and refuses evidence after harness provenance changes", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-postflight-provenance-"),
  )
  const now = Date.now()
  const sourceRevision = "6".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  const cleanGit = cleanGitFixture(repositoryRoot, sourceRevision)
  let statusCalls = 0
  let serializerCalls = 0
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      execFileImplementation: async (file: string, args: string[]) => {
        if (args[0] === "status") statusCalls += 1
        return cleanGit(file, args)
      },
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      postflightProvenanceImplementation: async () => ({
        ...hostedProvenance(sourceRevision),
        harness_digest: "f".repeat(64),
      }),
      managementObserverDigest: "c".repeat(64),
      managementAttestationHookImplementation: async (
        request: ManagementObservationRequest,
      ) => managementObservation(request),
      runCanaryImplementation: async (adapter: {
        cleanup(options: { cleanupDeadline: number }): Promise<void>
      }) => {
        await adapter.cleanup({ cleanupDeadline: Date.now() + 60_000 })
        return {
          cleanup: "completed",
          scope: "hosted_staging",
          project_ref: "destjwstohzmufshfnuy",
        }
      },
      serializeEvidenceImplementation: () => {
        serializerCalls += 1
        return "{}\n"
      },
    }),
  ).rejects.toThrow(/postflight_provenance_changed/)
  expect(statusCalls).toBe(3)
  expect(serializerCalls).toBe(0)
  await expect(
    access(runner.hostedEvidencePath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("refuses evidence when the worktree becomes dirty during the canary", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-postflight-dirty-"),
  )
  const now = Date.now()
  const sourceRevision = "7".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  let statusCalls = 0
  let provenanceCalls = 0
  const cleanGit = cleanGitFixture(repositoryRoot, sourceRevision)
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      execFileImplementation: async (file: string, args: string[]) => {
        if (args[0] === "status") {
          statusCalls += 1
          if (statusCalls > 1) {
            return { stdout: " M tests/provider/fixture.ts\n", stderr: "" }
          }
        }
        return cleanGit(file, args)
      },
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      postflightProvenanceImplementation: async () => {
        provenanceCalls += 1
        return hostedProvenance(sourceRevision)
      },
      managementObserverDigest: "c".repeat(64),
      managementAttestationHookImplementation: async (
        request: ManagementObservationRequest,
      ) => managementObservation(request),
      runCanaryImplementation: async (adapter: {
        cleanup(options: { cleanupDeadline: number }): Promise<void>
      }) => {
        await adapter.cleanup({ cleanupDeadline: Date.now() + 60_000 })
        return {
          cleanup: "completed",
          scope: "hosted_staging",
          project_ref: "destjwstohzmufshfnuy",
        }
      },
      serializeEvidenceImplementation: () => "{}\n",
    }),
  ).rejects.toThrow(/source_revision_gate_failed/)
  expect(statusCalls).toBe(2)
  expect(provenanceCalls).toBe(0)
  await expect(
    access(runner.hostedEvidencePath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("bounds initial provenance by the original absolute deadline", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-initial-provenance-deadline-"),
  )
  const now = Math.floor(Date.now() / 1_000) * 1_000
  let clock = now
  const sourceRevision = "b".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
    FF029_TOTAL_BUDGET_MILLISECONDS: "600000",
    FF029_CLEANUP_BUDGET_MILLISECONDS: "60000",
    FF029_FINALIZATION_BUDGET_MILLISECONDS: "10000",
    FF029_OPERATION_TIMEOUT_MILLISECONDS: "120000",
  })
  const absoluteDeadline = now + 600_000
  let receivedBounds:
    | {
        absoluteDeadline: number
        nowImplementation: () => number
      }
    | undefined
  let canaryCalls = 0
  const outcome = await runner
    .runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      nowImplementation: () => clock,
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      initialProvenanceImplementation: async (
        _configuration: unknown,
        _root: string,
        bounds: {
          absoluteDeadline: number
          nowImplementation: () => number
        },
      ) => {
        receivedBounds = bounds
        clock = absoluteDeadline
        return hostedProvenance(sourceRevision)
      },
      runCanaryImplementation: async () => {
        canaryCalls += 1
        throw new Error("canary_must_not_run_after_provenance_deadline")
      },
    })
    .then(
      () => ({ status: "resolved" as const, error: null }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )
  try {
    expect(receivedBounds?.absoluteDeadline).toBe(absoluteDeadline)
    expect(receivedBounds?.nowImplementation()).toBe(absoluteDeadline)
    expect(canaryCalls).toBe(0)
    expect(outcome.status).toBe("rejected")
    expect((outcome.error as Error).message).toBe(
      "ff029_hosted_finalization_deadline_exhausted",
    )
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("bounds management abort join by the original absolute deadline", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-management-join-deadline-"),
  )
  const now = Math.floor(Date.now() / 1_000) * 1_000
  let clock = now
  const absoluteDeadline = now + 600_000
  const sourceRevision = "c".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
    FF029_TOTAL_BUDGET_MILLISECONDS: "600000",
    FF029_CLEANUP_BUDGET_MILLISECONDS: "60000",
    FF029_FINALIZATION_BUDGET_MILLISECONDS: "10000",
    FF029_OPERATION_TIMEOUT_MILLISECONDS: "120000",
    FF029_REQUEST_TIMEOUT_MILLISECONDS: "1000",
  })
  let hookObservedAbort = false
  let canaryCalls = 0
  const startedAt = Date.now()
  const outcome = await runner
    .runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      nowImplementation: () => clock,
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      initialProvenanceImplementation: async () => {
        clock = absoluteDeadline - 100
        return hostedProvenance(sourceRevision)
      },
      managementObserverDigest: "f".repeat(64),
      managementAttestationHookImplementation: async (
        _request: ManagementObservationRequest,
        hookLifecycle: { signal: AbortSignal },
      ) => {
        hookLifecycle.signal.addEventListener(
          "abort",
          () => {
            hookObservedAbort = true
          },
          { once: true },
        )
        return new Promise(() => {})
      },
      runCanaryImplementation: async () => {
        canaryCalls += 1
        throw new Error("canary_must_not_run_after_management_deadline")
      },
      serializeEvidenceImplementation: () => "{}\n",
    })
    .then(
      () => ({ status: "resolved" as const, error: null }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )
  try {
    expect.soft(Date.now() - startedAt).toBeLessThan(500)
    expect.soft(canaryCalls).toBe(0)
    expect.soft(outcome.status).toBe("rejected")
    expect
      .soft((outcome.error as Error).message)
      .toBe("ff029_hosted_management_observation_unsettled")
    expect.soft(hookObservedAbort).toBe(true)
    expect
      .soft(
        (outcome.error as { ff029RetainExclusiveOwnership?: boolean })
          .ff029RetainExclusiveOwnership,
      )
      .toBe(true)
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("stops finalization when the postflight observer finishes after not_after", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-postflight-deadline-"),
  )
  const now = Math.floor(Date.now() / 1_000) * 1_000
  let clock = now
  const sourceRevision = "8".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
    FF029_TOTAL_BUDGET_MILLISECONDS: "600000",
    FF029_CLEANUP_BUDGET_MILLISECONDS: "60000",
    FF029_REQUEST_TIMEOUT_MILLISECONDS: "1000",
  })
  let provenanceCalls = 0
  let serializerCalls = 0
  const phases: string[] = []
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      nowImplementation: () => clock,
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      postflightProvenanceImplementation: async () => {
        provenanceCalls += 1
        return hostedProvenance(sourceRevision)
      },
      managementObserverDigest: "8".repeat(64),
      managementAttestationHookImplementation: async (
        request: ManagementObservationRequest,
      ) => {
        phases.push(request.phase)
        if (request.phase === "postflight") {
          clock = Date.parse(request.not_after) + 1
        }
        return managementObservation(request)
      },
      runCanaryImplementation: async (
        adapter: {
          cleanup(options: { cleanupDeadline: number }): Promise<void>
        },
        options: { absoluteTotalDeadline: number },
      ) => {
        await adapter.cleanup({ cleanupDeadline: Date.now() + 60_000 })
        clock = options.absoluteTotalDeadline - 500
        return {
          cleanup: "completed",
          scope: "hosted_staging",
          project_ref: "destjwstohzmufshfnuy",
        }
      },
      serializeEvidenceImplementation: (report: unknown) => {
        serializerCalls += 1
        return `${JSON.stringify(report)}\n`
      },
    }),
  ).rejects.toThrow(/ff029_hosted_finalization_deadline_exhausted/)
  expect(phases).toEqual(["preflight", "postflight"])
  expect(provenanceCalls).toBe(0)
  expect(serializerCalls).toBe(0)
  await expect(
    access(runner.hostedEvidencePath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("stops finalization when provenance crosses the original absolute deadline", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-provenance-deadline-"),
  )
  const now = Math.floor(Date.now() / 1_000) * 1_000
  let clock = now
  const sourceRevision = "9".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
    FF029_TOTAL_BUDGET_MILLISECONDS: "600000",
    FF029_CLEANUP_BUDGET_MILLISECONDS: "60000",
    FF029_REQUEST_TIMEOUT_MILLISECONDS: "1000",
  })
  let provenanceCalls = 0
  let serializerCalls = 0
  let absoluteTotalDeadline = 0
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      nowImplementation: () => clock,
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      postflightProvenanceImplementation: async () => {
        provenanceCalls += 1
        clock = absoluteTotalDeadline + 1
        return hostedProvenance(sourceRevision)
      },
      managementObserverDigest: "9".repeat(64),
      managementAttestationHookImplementation: async (
        request: ManagementObservationRequest,
      ) => managementObservation(request),
      runCanaryImplementation: async (
        adapter: {
          cleanup(options: { cleanupDeadline: number }): Promise<void>
        },
        options: { absoluteTotalDeadline: number },
      ) => {
        await adapter.cleanup({ cleanupDeadline: Date.now() + 60_000 })
        absoluteTotalDeadline = options.absoluteTotalDeadline
        clock = absoluteTotalDeadline - 500
        return {
          cleanup: "completed",
          scope: "hosted_staging",
          project_ref: "destjwstohzmufshfnuy",
        }
      },
      serializeEvidenceImplementation: (report: unknown) => {
        serializerCalls += 1
        return `${JSON.stringify(report)}\n`
      },
    }),
  ).rejects.toThrow(/ff029_hosted_finalization_deadline_exhausted/)
  expect(provenanceCalls).toBe(1)
  expect(serializerCalls).toBe(0)
  await expect(
    access(runner.hostedEvidencePath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("removes evidence when its write crosses the original absolute deadline", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-evidence-deadline-"),
  )
  const now = Math.floor(Date.now() / 1_000) * 1_000
  let clock = now
  let absoluteTotalDeadline = 0
  let evidencePhase = false
  let evidenceClockReads = 0
  const sourceRevision = "a".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
    FF029_TOTAL_BUDGET_MILLISECONDS: "600000",
    FF029_CLEANUP_BUDGET_MILLISECONDS: "60000",
    FF029_REQUEST_TIMEOUT_MILLISECONDS: "1000",
  })
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      nowImplementation: () => {
        if (!evidencePhase) return clock
        evidenceClockReads += 1
        return evidenceClockReads < 3
          ? absoluteTotalDeadline - 1
          : absoluteTotalDeadline + 1
      },
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      postflightProvenanceImplementation: async () =>
        hostedProvenance(sourceRevision),
      managementObserverDigest: "a".repeat(64),
      managementAttestationHookImplementation: async (
        request: ManagementObservationRequest,
      ) => managementObservation(request),
      runCanaryImplementation: async (
        adapter: {
          cleanup(options: { cleanupDeadline: number }): Promise<void>
        },
        options: { absoluteTotalDeadline: number },
      ) => {
        await adapter.cleanup({ cleanupDeadline: Date.now() + 60_000 })
        absoluteTotalDeadline = options.absoluteTotalDeadline
        clock = absoluteTotalDeadline - 500
        return {
          cleanup: "completed",
          scope: "hosted_staging",
          project_ref: "destjwstohzmufshfnuy",
        }
      },
      serializeEvidenceImplementation: (report: unknown) => {
        evidencePhase = true
        return `${JSON.stringify(report)}\n`
      },
    }),
  ).rejects.toThrow(/ff029_hosted_finalization_deadline_exhausted/)
  expect(evidenceClockReads).toBeGreaterThanOrEqual(3)
  await expect(
    access(runner.hostedEvidencePath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})

test("refuses to persist success evidence for a failed cleanup report", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-hosted-cleanup-evidence-"),
  )
  const now = Date.now()
  const sourceRevision = "4".repeat(40)
  const environment = hostedEnvironment(now, {
    FF029_SOURCE_REVISION: sourceRevision,
  })
  await expect(
    runner.runHostedSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
      stateRoot: repositoryRoot,
      environment,
      lockPath: resolve(repositoryRoot, "run.lock"),
      nowMilliseconds: now,
      execFileImplementation: cleanGitFixture(repositoryRoot, sourceRevision),
      mailboxImplementation: mailbox(),
      createClientImplementation: (_url: string, key: string) =>
        key === environment.FF029_HOSTED_SUPABASE_SERVICE_ROLE_KEY
          ? cleanupServiceClient()
          : { auth: {} },
      provenance: hostedProvenance(sourceRevision),
      postflightProvenanceImplementation: async () =>
        hostedProvenance(sourceRevision),
      managementObserverDigest: "b".repeat(64),
      managementAttestationHookImplementation: async (
        request: ManagementObservationRequest,
      ) => managementObservation(request),
      runCanaryImplementation: async (adapter: {
        cleanup(options: { cleanupDeadline: number }): Promise<void>
      }) => {
        await adapter.cleanup({ cleanupDeadline: Date.now() + 60_000 })
        return { cleanup: "failed" }
      },
      serializeEvidenceImplementation: () =>
        `${JSON.stringify({
          scope: "hosted_staging",
          project_ref: "destjwstohzmufshfnuy",
          cleanup: "failed",
          hosted_observation: "observed",
        })}\n`,
    }),
  ).rejects.toThrow(/evidence_cleanup_incoherent/)
  await expect(
    access(runner.hostedEvidencePath(repositoryRoot)),
  ).rejects.toMatchObject({ code: "ENOENT" })
  await rm(repositoryRoot, { recursive: true, force: true })
})
