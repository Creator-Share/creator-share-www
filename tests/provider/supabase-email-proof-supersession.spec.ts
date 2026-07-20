import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { expect, test } from "@playwright/test"

const SUPPORT_PATH = resolve(
  process.cwd(),
  "tests/provider/support/supabase-email-proof-supersession.mjs",
)
const LOCAL_RUNNER_PATH = resolve(
  process.cwd(),
  "tests/provider/supabase-email-proof-supersession-local.mjs",
)
const WORKFLOW_PATH = resolve(
  process.cwd(),
  ".github/workflows/advocate-publication-db-gate.yml",
)

type CanaryModule =
  typeof import("./support/supabase-email-proof-supersession.mjs")
type LocalRunnerModule =
  typeof import("./supabase-email-proof-supersession-local.mjs")
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<CanaryModule>
const nativeImportLocal = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<LocalRunnerModule>
let canary: CanaryModule
let localRunner: LocalRunnerModule

test.beforeAll(async () => {
  ;[canary, localRunner] = await Promise.all([
    nativeImport(pathToFileURL(SUPPORT_PATH).href),
    nativeImportLocal(pathToFileURL(LOCAL_RUNNER_PATH).href),
  ])
})

function successfulAdapter(overrides: Record<string, unknown> = {}) {
  return {
    async initialize() {
      return { authVersion: "v2.188.1" }
    },
    async prepareScenario(definition: { id: string }) {
      return { opaque: definition.id }
    },
    async issueProof(_context: unknown, flow: string) {
      return { opaque: flow }
    },
    async consumeProof() {
      return "accepted"
    },
    async cleanup() {},
    ...overrides,
  }
}

function completeRunOptions(overrides: Record<string, unknown> = {}) {
  return {
    provenance: {
      cli_version: "2.90.0",
      config_digest: "a".repeat(64),
      repo_revision: "b".repeat(40),
      harness_digest: "c".repeat(64),
    },
    ...overrides,
  }
}

function validLocalEnvironment(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    FF029_LOCAL_SUPABASE_ANON_KEY: "anon-key-material-value",
    FF029_LOCAL_SUPABASE_SERVICE_ROLE_KEY: "service-role-key-material-value",
    FF029_SOURCE_REVISION: "d".repeat(40),
    ...overrides,
    NODE_ENV: "test",
  }
}

function localExecutionLifecycle() {
  return {
    executionDeadline: Date.now() + 10_000,
    signal: new AbortController().signal,
  }
}

function unsignedAccessToken(claims: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "signature",
  ].join(".")
}

test("classifies only the exact deterministic expired proof response as rejected", () => {
  expect(
    canary.classifySupabaseProofVerificationError({
      code: "otp_expired",
      status: 403,
    }),
  ).toBe("rejected")
  for (const error of [
    { code: "otp_expired", status: 400 },
    { code: "over_request_rate_limit", status: 429 },
    { code: "request_timeout", status: 504 },
    { code: "unexpected_failure", status: 500 },
    { status: 403 },
    new Error("otp_expired"),
    null,
  ]) {
    expect(canary.classifySupabaseProofVerificationError(error)).toBe(
      "provider_error",
    )
  }
})

test("classifies only bounded provider failure categories", () => {
  expect(
    canary.classifySupabaseProviderFailure({ code: "unexpected_failure" }),
  ).toBe("unexpected_failure")
  expect(
    canary.classifySupabaseProviderFailure({
      code: "over_email_send_rate_limit",
    }),
  ).toBe("email_rate_limited")
  expect(
    canary.classifySupabaseProviderFailure({ code: "request_timeout" }),
  ).toBe("timeout")
  expect(
    canary.classifySupabaseProviderFailure(
      new Error("provider wrapper", {
        cause: new Error("ff029_request_timeout"),
      }),
    ),
  ).toBe("timeout")
  expect(
    canary.classifySupabaseProviderFailure({
      code: "over_request_rate_limit",
      message: "raw provider detail",
    }),
  ).toBe("unknown_provider_failure")
  expect(
    canary.classifySupabaseProviderFailure({
      ff029FailureCategory: "none",
    }),
  ).toBe("unknown_provider_failure")
})

test("binds every verified identity surface to the scenario recipient", () => {
  const email = "canary@example.com"
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const confirmedAt = "2026-07-19T12:00:00.000Z"
  const valid = {
    user: { id: userId, email, email_confirmed_at: confirmedAt },
    session: {
      user: { id: userId, email, email_confirmed_at: confirmedAt },
      access_token: unsignedAccessToken({
        sub: userId,
        email,
        amr: [{ method: "otp", timestamp: 1 }],
      }),
    },
  }
  expect(canary.verifiedIdentityMatchesScenario(valid, email, userId)).toBe(
    true,
  )

  const mutations = [
    { ...valid, user: { ...valid.user, id: crypto.randomUUID() } },
    { ...valid, user: { ...valid.user, email: "other@example.com" } },
    {
      ...valid,
      user: { ...valid.user, email_confirmed_at: null },
    },
    {
      ...valid,
      session: {
        ...valid.session,
        user: { ...valid.session.user, id: crypto.randomUUID() },
      },
    },
    {
      ...valid,
      session: {
        ...valid.session,
        user: { ...valid.session.user, email: "other@example.com" },
      },
    },
    {
      ...valid,
      session: {
        ...valid.session,
        user: {
          ...valid.session.user,
          email_confirmed_at: "2026-07-19T12:00:01.000Z",
        },
      },
    },
    {
      ...valid,
      session: {
        ...valid.session,
        access_token: unsignedAccessToken({
          sub: crypto.randomUUID(),
          email,
          amr: [{ method: "otp", timestamp: 1 }],
        }),
      },
    },
    {
      ...valid,
      session: {
        ...valid.session,
        access_token: unsignedAccessToken({
          sub: userId,
          email: "other@example.com",
          amr: [{ method: "otp", timestamp: 1 }],
        }),
      },
    },
  ]
  for (const mutation of mutations) {
    expect(
      canary.verifiedIdentityMatchesScenario(mutation, email, userId),
    ).toBe(false)
  }
  expect(
    canary.verifiedIdentityMatchesScenario(valid, email, crypto.randomUUID()),
  ).toBe(false)
})

test("defines the complete local supersession matrix without claiming completion", async () => {
  const matrix = canary.FF029_EMAIL_PROOF_SUPERSESSION_MATRIX
  expect(matrix).toHaveLength(86)
  expect(new Set(matrix.map((scenario) => scenario.accountState))).toEqual(
    new Set(["new", "existing"]),
  )

  const orderedPairs = new Set(
    matrix.map((scenario) => scenario.flows.join("->")),
  )
  for (const flow of [
    "initial_sponsor_claim",
    "existing_account_claim",
    "generic_sign_in",
    "recent_action_reauthentication",
  ]) {
    expect(orderedPairs.has(`${flow}->advocate_proof_a`)).toBe(true)
    expect(orderedPairs.has(`advocate_proof_a->${flow}`)).toBe(true)
  }
  for (const accountState of ["new", "existing"]) {
    const accountScenarios = matrix.filter(
      (scenario) => scenario.accountState === accountState,
    )
    expect(
      accountScenarios.some(
        (scenario) =>
          scenario.flows[0] === "advocate_proof_a" &&
          scenario.flows[1] === "advocate_proof_b",
      ),
    ).toBe(true)
    expect(
      accountScenarios.some(
        (scenario) =>
          scenario.flows[0] === "advocate_proof_b" &&
          scenario.flows[1] === "advocate_proof_a",
      ),
    ).toBe(true)
    expect(
      accountScenarios.some(
        (scenario) =>
          scenario.issuanceMode === "concurrent" &&
          scenario.flows.includes("advocate_proof_a") &&
          scenario.flows.includes("advocate_proof_b"),
      ),
    ).toBe(true)
    expect(
      accountScenarios.some(
        (scenario) =>
          scenario.flows[0] === "advocate_proof_a" &&
          scenario.flows[1] === "advocate_proof_a",
      ),
    ).toBe(true)
  }
  expect(
    matrix.some(
      (scenario) =>
        scenario.flows[0] === "generic_sign_in" &&
        scenario.flows[1] === "generic_sign_in",
    ),
  ).toBe(true)
  for (const [accountState, sponsorFlow] of [
    ["new", "initial_sponsor_claim"],
    ["existing", "existing_account_claim"],
    ["existing", "recent_action_reauthentication"],
  ]) {
    for (const flows of [
      ["advocate_proof_a", sponsorFlow],
      [sponsorFlow, "advocate_proof_a"],
    ]) {
      expect(
        matrix.some(
          (scenario) =>
            scenario.accountState === accountState &&
            scenario.issuanceMode === "concurrent" &&
            scenario.flows.join("|") === flows.join("|"),
        ),
      ).toBe(true)
    }
    expect(
      matrix.some(
        (scenario) =>
          scenario.accountState === accountState &&
          scenario.flows[0] === sponsorFlow &&
          scenario.flows[1] === sponsorFlow,
      ),
    ).toBe(true)
  }
  const scenarioGroups = new Map<string, Set<string>>()
  for (const definition of matrix.filter(
    (scenario) => scenario.consumptionOrder.length === 2,
  )) {
    const groupId = `${definition.pairId}:${definition.trial ?? "single"}`
    const orders = scenarioGroups.get(groupId) ?? new Set<string>()
    orders.add(definition.consumptionOrder.join(","))
    scenarioGroups.set(groupId, orders)
  }
  expect(scenarioGroups.size).toBe(42)
  for (const orders of scenarioGroups.values()) {
    expect(orders).toEqual(new Set(["0,1", "1,0"]))
  }
  const concurrentPairs = new Map<string, Map<number, number>>()
  for (const definition of matrix.filter(
    (scenario) => scenario.issuanceMode === "concurrent",
  )) {
    expect([1, 2, 3]).toContain(definition.trial)
    expect(definition.id).toContain(`_trial_${definition.trial}_`)
    const trials = concurrentPairs.get(definition.pairId) ?? new Map()
    trials.set(definition.trial, (trials.get(definition.trial) ?? 0) + 1)
    concurrentPairs.set(definition.pairId, trials)
  }
  expect(concurrentPairs.size).toBe(8)
  for (const trials of concurrentPairs.values()) {
    expect(trials).toEqual(
      new Map([
        [1, 2],
        [2, 2],
        [3, 2],
      ]),
    )
  }
  expect(
    matrix
      .filter((scenario) => scenario.issuanceMode !== "concurrent")
      .every((scenario) => scenario.trial === null),
  ).toBe(true)
  expect(
    matrix.find(
      (scenario) => scenario.id === "new_advocate_signup_proof_standalone",
    ),
  ).toMatchObject({
    accountState: "new",
    flows: ["advocate_proof_a"],
    consumptionOrder: [0],
  })
  expect(matrix.at(-1)).toMatchObject({
    id: "local_expiry_observation",
    expiryOutcome: "not_exercised",
  })

  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter(),
    completeRunOptions(),
  )
  expect(report.ff029_status).toBe("open")
  expect(report.scope).toBe("local_mechanics_only")
  expect(report.hosted_evidence_required).toBe(true)
  expect(report.local_observation).toBe("observed")
  expect(report.schema_version).toBe(3)
  expect(report.scenario_count).toBe(86)
  expect(new Date(report.provenance.started_at).toISOString()).toBe(
    report.provenance.started_at,
  )
  expect(new Date(report.provenance.completed_at).toISOString()).toBe(
    report.provenance.completed_at,
  )
  expect(
    Date.parse(report.provenance.completed_at) -
      Date.parse(report.provenance.started_at),
  ).toBe(report.provenance.execution_time_milliseconds)
  expect(
    report.scenarios
      .slice(0, -1)
      .every(
        (scenario: {
          first_consumption: unknown
          second_consumption: unknown
          second_flow: unknown
        }) =>
          scenario.first_consumption === "accepted" &&
          (scenario.second_flow === null
            ? scenario.second_consumption === "not_exercised"
            : scenario.second_consumption === "accepted"),
      ),
  ).toBe(true)
  expect(report.scenarios[0]).toMatchObject({
    first_failure_category: "none",
    second_failure_category: "none",
  })
  expect(report.scenarios.at(-2)).toMatchObject({
    first_failure_category: "none",
    second_failure_category: "not_exercised",
  })
  expect(report.scenarios.at(-1)).toMatchObject({
    expiry_outcome: "not_exercised",
    execution: "not_exercised",
    first_failure_category: "not_exercised",
    second_failure_category: "not_exercised",
  })
})

test("consumes every proof pair in the declared order", async () => {
  const observedOrders = new Map<string, number[]>()
  const preparedRecipients = new Set<string>()
  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    {
      async initialize() {
        return { authVersion: "v2.188.1" }
      },
      async prepareScenario(definition: { id: string }) {
        const recipient = `${definition.id}@example.com`
        expect(preparedRecipients.has(recipient)).toBe(false)
        preparedRecipients.add(recipient)
        return { id: definition.id, nextProofIndex: 0, recipient }
      },
      async issueProof(context: { id: string; nextProofIndex: number }) {
        const proofIndex = context.nextProofIndex
        context.nextProofIndex += 1
        return { scenarioId: context.id, proofIndex }
      },
      async consumeProof(
        _context: unknown,
        proof: { scenarioId: string; proofIndex: number },
      ) {
        const order = observedOrders.get(proof.scenarioId) ?? []
        order.push(proof.proofIndex)
        observedOrders.set(proof.scenarioId, order)
        return "accepted"
      },
      async cleanup() {},
    },
    completeRunOptions(),
  )

  expect(report.local_observation).toBe("observed")
  expect(preparedRecipients.size).toBe(
    canary.FF029_EMAIL_PROOF_SUPERSESSION_MATRIX.length - 1,
  )
  for (const definition of canary.FF029_EMAIL_PROOF_SUPERSESSION_MATRIX.slice(
    0,
    -1,
  )) {
    expect(observedOrders.get(definition.id)).toEqual(
      definition.consumptionOrder,
    )
  }
})

test("refuses every nonloopback endpoint before constructing a provider client", async () => {
  for (const value of [
    "https://example.supabase.co",
    "http://127.0.0.1.example.com:54321",
    "http://user:secret@127.0.0.1:54321",
    "file:///tmp/supabase",
    "http://localhost:54321/path",
    "http://localhost:54321?target=remote",
  ]) {
    expect(() =>
      canary.requireLoopbackHttpOrigin(value, "test_endpoint"),
    ).toThrow(/test_endpoint_(?:invalid|not_loopback)/)
  }
  expect(canary.requireLoopbackHttpOrigin("http://127.0.0.1:54321")).toBe(
    "http://127.0.0.1:54321",
  )
  expect(canary.requireLoopbackHttpOrigin("http://localhost:54324")).toBe(
    "http://localhost:54324",
  )
  expect(canary.requireLoopbackHttpOrigin("http://[::1]:54321")).toBe(
    "http://[::1]:54321",
  )

  let clientConstructionCalls = 0
  for (const endpoints of [
    {
      supabaseUrl: "https://example.supabase.co",
      mailpitUrl: "http://127.0.0.1:54324",
      applicationOrigin: "http://localhost:3000",
    },
    {
      supabaseUrl: "http://127.0.0.1:54321",
      mailpitUrl: "https://mail.example.com",
      applicationOrigin: "http://localhost:3000",
    },
    {
      supabaseUrl: "http://127.0.0.1:54321",
      mailpitUrl: "http://127.0.0.1:54324",
      applicationOrigin: "https://creatorshare.com",
    },
  ]) {
    await expect(
      canary.createLocalSupabaseEmailProofAdapter({
        ...endpoints,
        anonKey: "local-anon-key",
        serviceRoleKey: "local-service-role-key",
        createClientImplementation() {
          clientConstructionCalls += 1
          return {}
        },
      }),
    ).rejects.toThrow(/not_loopback/)
  }
  expect(clientConstructionCalls).toBe(0)

  await expect(
    canary.createLocalSupabaseEmailProofAdapter({
      supabaseUrl: "http://127.0.0.1:54321",
      mailpitUrl: "http://127.0.0.1:54324",
      applicationOrigin: "http://127.0.0.1:3000",
      anonKey: "same-local-key-material",
      serviceRoleKey: "same-local-key-material",
      createClientImplementation() {
        clientConstructionCalls += 1
        return {}
      },
    }),
  ).rejects.toThrow(/ff029_local_keys_not_distinct/)
  expect(clientConstructionCalls).toBe(0)
})

test("refuses direct and redirected nonloopback fetches", async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = []
  const guardedFetch = canary.createRedirectRefusingLoopbackFetch(
    async (input: unknown, init: RequestInit | undefined) => {
      calls.push({ input, init })
      return {
        ok: true,
        redirected: false,
        status: 200,
        url: "http://127.0.0.1:54321/auth/v1/verify",
      }
    },
    ["http://127.0.0.1:54321"],
  )

  await expect(
    guardedFetch("https://example.supabase.co/auth/v1"),
  ).rejects.toThrow(/ff029_request_url_not_loopback/)
  await expect(guardedFetch("http://localhost:54321/auth/v1")).rejects.toThrow(
    /ff029_request_origin_not_allowed/,
  )
  expect(calls).toHaveLength(0)

  await expect(
    guardedFetch("http://127.0.0.1:54321/auth/v1/verify"),
  ).resolves.toMatchObject({ ok: true })
  expect(calls).toHaveLength(1)
  expect(calls[0].init?.redirect).toBe("error")

  const redirectingFetch = canary.createRedirectRefusingLoopbackFetch(
    async (_input: unknown, init: RequestInit | undefined) => {
      expect(init?.redirect).toBe("error")
      return {
        ok: false,
        redirected: false,
        status: 302,
        url: "http://127.0.0.1:54321/auth/v1/verify",
      }
    },
    ["http://127.0.0.1:54321"],
  )
  await expect(
    redirectingFetch("http://127.0.0.1:54321/auth/v1/verify"),
  ).rejects.toThrow(/ff029_redirect_refused/)

  const followedRedirectFetch = canary.createRedirectRefusingLoopbackFetch(
    async () => ({
      ok: true,
      redirected: true,
      status: 200,
      url: "https://example.supabase.co/auth/v1/verify",
    }),
    ["http://127.0.0.1:54321"],
  )
  await expect(
    followedRedirectFetch("http://127.0.0.1:54321/auth/v1/verify"),
  ).rejects.toThrow(/ff029_redirect_refused/)
})

test("bounds every request and aborts an unresponsive loopback fetch", async () => {
  let observedSignal: AbortSignal | undefined
  const guardedFetch = canary.createRedirectRefusingLoopbackFetch(
    async (_input: unknown, init: RequestInit | undefined) => {
      observedSignal = init?.signal ?? undefined
      return new Promise(() => {})
    },
    ["http://127.0.0.1:54321"],
    { requestTimeoutMilliseconds: 20 },
  )
  const startedAt = Date.now()
  await expect(
    guardedFetch("http://127.0.0.1:54321/auth/v1/health"),
  ).rejects.toThrow(/ff029_request_timeout/)
  expect(Date.now() - startedAt).toBeLessThan(500)
  expect(observedSignal?.aborted).toBe(true)
})

test("records the Auth version only from the fixed loopback health response", async () => {
  const requestedUrls: string[] = []
  const adapter = await canary.createLocalSupabaseEmailProofAdapter({
    supabaseUrl: "http://127.0.0.1:54321",
    mailpitUrl: "http://127.0.0.1:54324",
    applicationOrigin: "http://127.0.0.1:3000",
    anonKey: "local-anon-key-value",
    serviceRoleKey: "local-service-role-key-value",
    fetchImplementation: async (input: string | URL | Request) => {
      requestedUrls.push(
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url,
      )
      return localAdapterResponse({ version: "v2.188.1" })
    },
    createClientImplementation() {
      return {}
    },
  })
  await expect(adapter.initialize(localExecutionLifecycle())).resolves.toEqual({
    authVersion: "v2.188.1",
  })
  expect(requestedUrls).toEqual(["http://127.0.0.1:54321/auth/v1/health"])
})

test("waits for every preflight before dispatching concurrent Auth requests", async () => {
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const confirmedAt = "2026-07-19T12:00:00.000Z"
  const events: string[] = []
  let email = ""
  let announcePreflightStarted: () => void = () => {}
  let releasePreflight: () => void = () => {}
  const preflightStarted = new Promise<void>((resolvePromise) => {
    announcePreflightStarted = resolvePromise
  })
  const preflightRelease = new Promise<void>((resolvePromise) => {
    releasePreflight = resolvePromise
  })
  const adminClient = {
    auth: {
      admin: {
        async createUser(input: { email: string }) {
          email = input.email
          return {
            data: {
              user: { id: userId, email, email_confirmed_at: confirmedAt },
            },
            error: null,
          }
        },
        async generateLink() {
          events.push("advocate_auth_dispatched")
          return {
            data: {
              user: { id: userId, email },
              properties: {
                hashed_token: "a".repeat(48),
                verification_type: "magiclink",
              },
            },
            error: null,
          }
        },
      },
    },
  }
  const adapter = await canary.createLocalSupabaseEmailProofAdapter({
    supabaseUrl: "http://127.0.0.1:54321",
    mailpitUrl: "http://127.0.0.1:54324",
    applicationOrigin: "http://127.0.0.1:3000",
    anonKey: "local-anon-key-value",
    serviceRoleKey: "local-service-role-key-value",
    fetchImplementation: async () => {
      events.push("mailpit_preflight_started")
      announcePreflightStarted()
      await preflightRelease
      events.push("mailpit_preflight_completed")
      return localAdapterResponse({
        total: 0,
        count: 0,
        start: 0,
        messages: [],
      })
    },
    createClientImplementation(_origin: string, key: string) {
      if (key === "local-service-role-key-value") return adminClient
      return {
        auth: {
          async signInWithOtp() {
            events.push("sponsor_auth_dispatched")
            return {
              data: {},
              error: {
                code: "unexpected_failure",
                message: "raw provider detail",
              },
            }
          },
        },
      }
    },
  })
  const lifecycle = localExecutionLifecycle()
  const context = await adapter.prepareScenario(
    { accountState: "existing" },
    lifecycle,
  )
  const dispatchBarrier = canary.createSupabaseProofDispatchBarrier(2)
  const advocateProof = adapter.issueProof(
    context,
    "advocate_proof_a",
    lifecycle,
    dispatchBarrier,
  )
  const sponsorProof = adapter.issueProof(
    context,
    "recent_action_reauthentication",
    lifecycle,
    dispatchBarrier,
  )

  await preflightStarted
  await Promise.resolve()
  expect(events).toEqual(["mailpit_preflight_started"])
  releasePreflight()
  const results = await Promise.allSettled([advocateProof, sponsorProof])
  expect(results.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ])
  const preflightCompletion = events.indexOf("mailpit_preflight_completed")
  expect(preflightCompletion).toBeGreaterThanOrEqual(0)
  expect(events.indexOf("advocate_auth_dispatched")).toBeGreaterThan(
    preflightCompletion,
  )
  expect(events.indexOf("sponsor_auth_dispatched")).toBeGreaterThan(
    preflightCompletion,
  )
})

test("fails closed when a concurrent preflight cannot reach the dispatch barrier", async () => {
  const targetId =
    "new_advocate_a_and_b_concurrent_trial_1_consume_first_then_second"
  let targetDispatches = 0
  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter({
      async issueProof(
        context: { opaque: string },
        flow: string,
        _lifecycle: unknown,
        dispatchBarrier: { wait(): Promise<void> },
      ) {
        if (context.opaque === targetId && flow === "advocate_proof_a") {
          await Promise.resolve()
          throw new Error("preflight failed")
        }
        await dispatchBarrier.wait()
        if (context.opaque === targetId) targetDispatches += 1
        return { opaque: flow }
      },
    }),
    completeRunOptions(),
  )

  expect(targetDispatches).toBe(0)
  expect(
    report.scenarios.find(
      (scenario: { id: string }) => scenario.id === targetId,
    ),
  ).toMatchObject({
    execution: "provider_error",
    first_issuance: "provider_error",
    second_issuance: "provider_error",
    first_failure_category: "harness_failure",
    second_failure_category: "harness_failure",
  })
})

test("reserves bounded cleanup after the execution budget is exhausted", async () => {
  let cleanupCalls = 0
  let cleanupDeadline = 0
  const startedAt = Date.now()
  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter({
      async prepareScenario() {
        return new Promise(() => {})
      },
      async cleanup(options: { cleanupDeadline: number }) {
        cleanupCalls += 1
        cleanupDeadline = options.cleanupDeadline
      },
    }),
    completeRunOptions({
      operationTimeoutMilliseconds: 200,
      totalBudgetMilliseconds: 80,
      cleanupBudgetMilliseconds: 30,
    }),
  )
  expect(cleanupCalls).toBe(1)
  expect(cleanupDeadline).toBeGreaterThanOrEqual(Date.now())
  expect(Date.now() - startedAt).toBeLessThan(500)
  expect(report.local_observation).toBe("incomplete")
  expect(report.scenarios[0].execution).toBe("provider_error")
})

test("bounds a cleanup operation that never settles", async () => {
  const startedAt = Date.now()
  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter({
      async cleanup() {
        return new Promise(() => {})
      },
    }),
    completeRunOptions({
      totalBudgetMilliseconds: 100,
      cleanupBudgetMilliseconds: 25,
    }),
  )
  expect(Date.now() - startedAt).toBeLessThan(500)
  expect(report.cleanup).toBe("failed")
  expect(report.local_observation).toBe("incomplete")
})

test("always cleans up when initialization or a scenario fails", async () => {
  let cleanupAfterInitializationFailure = 0
  const initializationReport =
    await canary.runSupabaseEmailProofSupersessionCanary(
      successfulAdapter({
        async initialize() {
          throw new Error("raw-initialization-secret")
        },
        async cleanup() {
          cleanupAfterInitializationFailure += 1
        },
      }),
    )
  expect(cleanupAfterInitializationFailure).toBe(1)
  expect(initializationReport.local_observation).toBe("incomplete")

  let cleanupAfterScenarioFailure = 0
  let issuanceCalls = 0
  const scenarioReport = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter({
      async issueProof() {
        issuanceCalls += 1
        if (issuanceCalls === 1) throw new Error("raw-proof-secret")
        return { opaque: "proof" }
      },
      async cleanup() {
        cleanupAfterScenarioFailure += 1
      },
    }),
  )
  expect(cleanupAfterScenarioFailure).toBe(1)
  expect(scenarioReport.scenarios[0]).toMatchObject({
    execution: "provider_error",
    first_consumption: "provider_error",
    first_failure_category: "harness_failure",
    second_consumption: "accepted",
    second_failure_category: "none",
  })
})

test("preserves per-proof evidence when one concurrent issuance fails", async () => {
  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter({
      async issueProof(
        context: { opaque: string },
        flow: "advocate_proof_a" | "advocate_proof_b",
      ) {
        if (
          context.opaque.startsWith("new_advocate_a_and_b_concurrent_trial_") &&
          flow === "advocate_proof_a"
        ) {
          throw new Error("fixed-provider-failure")
        }
        return { opaque: flow }
      },
    }),
  )

  const affectedScenarios = report.scenarios.filter(
    (candidate: { pair_id: string }) =>
      candidate.pair_id === "new_advocate_a_and_b_concurrent",
  )
  expect(affectedScenarios).toHaveLength(6)
  for (const scenario of affectedScenarios) {
    expect(scenario).toMatchObject({
      execution: "provider_error",
      first_issuance: "provider_error",
      second_issuance: "issued",
      first_consumption: "provider_error",
      second_consumption: "accepted",
      first_failure_category: "harness_failure",
      second_failure_category: "none",
    })
  }
})

test("reports cleanup failure as a fixed category", async () => {
  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter({
      async cleanup() {
        throw new Error("raw-cleanup-secret")
      },
    }),
  )
  expect(report.cleanup).toBe("failed")
  expect(report.local_observation).toBe("incomplete")
  expect(canary.localSupabaseEmailProofCanaryExitCode(report)).toBe(1)
})

test("never reports success without complete coherent provenance", async () => {
  const report =
    await canary.runSupabaseEmailProofSupersessionCanary(successfulAdapter())
  expect(report.scenarios[0].execution).toBe("observed")
  expect(report.provenance.cli_version).toBe("not_available")
  expect(report.local_observation).toBe("incomplete")
  expect(canary.localSupabaseEmailProofCanaryExitCode(report)).toBe(1)

  const contradictoryTiming = {
    ...report,
    provenance: {
      ...report.provenance,
      completed_at: new Date(
        Date.parse(report.provenance.completed_at) + 1,
      ).toISOString(),
    },
  }
  expect(() =>
    canary.localSupabaseEmailProofCanaryExitCode(contradictoryTiming),
  ).toThrow(/ff029_evidence_provenance_invalid/)
})

test("treats any inconclusive consumption as a provider error", async () => {
  let consumptionCalls = 0
  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter({
      async consumeProof() {
        consumptionCalls += 1
        return consumptionCalls === 1 ? "provider_error" : "accepted"
      },
    }),
  )
  expect(report.scenarios[0].execution).toBe("provider_error")
  expect(report.local_observation).toBe("incomplete")
  expect(canary.localSupabaseEmailProofCanaryExitCode(report)).toBe(1)
})

test("rejects incomplete, duplicate, misshapen, and incoherent evidence", async () => {
  const report =
    await canary.runSupabaseEmailProofSupersessionCanary(successfulAdapter())
  const scenarios = report.scenarios.map(
    (scenario: Record<string, unknown>) => ({
      ...scenario,
    }),
  )

  const duplicateMatrix = {
    ...report,
    scenarios: [...scenarios.slice(0, -1), { ...scenarios[0] }],
  }
  expect(() =>
    canary.localSupabaseEmailProofCanaryExitCode(duplicateMatrix),
  ).toThrow(/ff029_evidence_scenario_invalid/)

  const extraScenarioField = {
    ...report,
    scenarios: scenarios.map(
      (scenario: Record<string, unknown>, index: number) =>
        index === 0
          ? { ...scenario, email: "must-not-be-accepted@example.com" }
          : scenario,
    ),
  }
  expect(() =>
    canary.serializeSupabaseEmailProofSupersessionEvidence(extraScenarioField),
  ).toThrow(/ff029_evidence_shape_invalid/)

  const contradictoryOutcome = {
    ...report,
    scenarios: scenarios.map(
      (scenario: Record<string, unknown>, index: number) =>
        index === 0
          ? {
              ...scenario,
              execution: "observed",
              first_consumption: "provider_error",
              first_authentication_method: "provider_error",
              first_failure_category: "none",
            }
          : scenario,
    ),
  }
  expect(() =>
    canary.localSupabaseEmailProofCanaryExitCode(contradictoryOutcome),
  ).toThrow(/ff029_evidence_outcome_incoherent/)

  const invalidFailureCategory = {
    ...report,
    scenarios: scenarios.map(
      (scenario: Record<string, unknown>, index: number) =>
        index === 0
          ? { ...scenario, first_failure_category: "raw-provider-secret" }
          : scenario,
    ),
  }
  expect(() =>
    canary.serializeSupabaseEmailProofSupersessionEvidence(
      invalidFailureCategory,
    ),
  ).toThrow(/ff029_evidence_outcome_invalid/)

  const unexplainedFailureCategory = {
    ...report,
    scenarios: scenarios.map(
      (scenario: Record<string, unknown>, index: number) =>
        index === 0
          ? { ...scenario, first_failure_category: "harness_failure" }
          : scenario,
    ),
  }
  expect(() =>
    canary.serializeSupabaseEmailProofSupersessionEvidence(
      unexplainedFailureCategory,
    ),
  ).toThrow(/ff029_evidence_outcome_incoherent/)

  expect(() =>
    canary.serializeSupabaseEmailProofSupersessionEvidence({
      ...report,
      unexpected: "field",
    }),
  ).toThrow(/ff029_evidence_shape_invalid/)
  expect(() =>
    canary.localSupabaseEmailProofCanaryExitCode({
      ...report,
      scenario_count: report.scenario_count + 1,
    }),
  ).toThrow(/ff029_evidence_report_incoherent/)
})

test("carries the expected recipient through proof issuance and consumption", async () => {
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const confirmedAt = "2026-07-19T12:00:00.000Z"
  let email = ""
  let verificationResponse: Record<string, unknown> = {}
  const adminClient = {
    auth: {
      admin: {
        async createUser(input: { email: string }) {
          email = input.email
          return {
            data: {
              user: { id: userId, email, email_confirmed_at: confirmedAt },
            },
            error: null,
          }
        },
        async generateLink() {
          return {
            data: {
              user: { id: userId, email },
              properties: {
                hashed_token: "t".repeat(48),
                verification_type: "magiclink",
              },
            },
            error: null,
          }
        },
      },
    },
  }
  const adapter = await canary.createLocalSupabaseEmailProofAdapter({
    supabaseUrl: "http://127.0.0.1:54321",
    mailpitUrl: "http://127.0.0.1:54324",
    applicationOrigin: "http://127.0.0.1:3000",
    anonKey: "local-anon-key-value",
    serviceRoleKey: "local-service-role-key-value",
    fetchImplementation: async () => localAdapterResponse({}),
    createClientImplementation(_origin: string, key: string) {
      if (key === "local-service-role-key-value") return adminClient
      return {
        auth: {
          async verifyOtp() {
            return verificationResponse
          },
        },
      }
    },
  })
  const lifecycle = localExecutionLifecycle()
  const context = await adapter.prepareScenario(
    { accountState: "existing" },
    lifecycle,
  )
  const proof = await adapter.issueProof(
    context,
    "advocate_proof_a",
    lifecycle,
    canary.createSupabaseProofDispatchBarrier(1),
  )
  expect(proof.expectedEmail).toBe(email)

  const session = {
    user: { id: userId, email, email_confirmed_at: confirmedAt },
    access_token: unsignedAccessToken({
      sub: userId,
      email,
      amr: [{ method: "otp", timestamp: 1 }],
    }),
  }
  verificationResponse = {
    data: {
      user: { id: userId, email, email_confirmed_at: confirmedAt },
      session,
    },
    error: null,
  }
  await expect(
    adapter.consumeProof(context, proof, lifecycle),
  ).resolves.toEqual({
    outcome: "accepted",
    authenticationMethod: "otp",
    failureCategory: "none",
  })
  await expect(
    adapter.consumeProof(
      context,
      {
        ...proof,
        expectedEmail: "other@example.com",
      },
      lifecycle,
    ),
  ).rejects.toThrow(/ff029_proof_invalid/)

  verificationResponse = {
    data: {},
    error: { code: "over_email_send_rate_limit", status: 429 },
  }
  await expect(
    adapter.consumeProof(context, proof, lifecycle),
  ).resolves.toEqual({
    outcome: "provider_error",
    authenticationMethod: "provider_error",
    failureCategory: "email_rate_limited",
  })
  verificationResponse = {
    data: {},
    error: { code: "otp_expired", status: 403 },
  }
  await expect(
    adapter.consumeProof(context, proof, lifecycle),
  ).resolves.toEqual({
    outcome: "rejected",
    authenticationMethod: "not_available",
    failureCategory: "none",
  })
})

function localAdapterResponse(
  body: unknown,
  overrides: Partial<{
    ok: boolean
    redirected: boolean
    status: number
    url: string
  }> = {},
) {
  return {
    ok: true,
    redirected: false,
    status: 200,
    url: "",
    async json() {
      return body
    },
    ...overrides,
  }
}

async function createCleanupPostconditionFixture(options: {
  retainMessage?: boolean
  retainUser?: boolean
}) {
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  let email = ""
  let deleted = false
  let listUserCalls = 0
  let deleteUserCalls = 0
  let mailpitDeleteCalls = 0
  let mailpitListCalls = 0
  let trackedMessagePresent = true
  const deletedMessageIds: string[] = []
  const confirmedAt = "2026-07-19T12:00:00.000Z"
  const adminClient = {
    auth: {
      admin: {
        async createUser(input: { email: string }) {
          email = input.email
          return {
            data: {
              user: {
                id: userId,
                email,
                email_confirmed_at: confirmedAt,
              },
            },
            error: null,
          }
        },
        async listUsers() {
          listUserCalls += 1
          const userPresent = options.retainUser || !deleted
          return {
            data: { users: userPresent ? [{ id: userId, email }] : [] },
            error: null,
          }
        },
        async deleteUser() {
          deleteUserCalls += 1
          deleted = true
          return { data: {}, error: null }
        },
      },
    },
  }
  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    )
    expect(url.origin).toBe("http://127.0.0.1:54324")
    expect(init?.redirect).toBe("error")
    if (init?.method === "DELETE") {
      mailpitDeleteCalls += 1
      expect(url.pathname).toBe("/api/v1/messages")
      expect(init.headers).toEqual({ "content-type": "application/json" })
      const body = JSON.parse(String(init.body))
      expect(body).toEqual({ IDs: ["fixed-message"] })
      deletedMessageIds.push(...body.IDs)
      if (!options.retainMessage) trackedMessagePresent = false
      return localAdapterResponse({})
    }
    mailpitListCalls += 1
    const messages = [
      {
        ID: "unrelated-message",
        To: [{ Address: "unrelated@example.com" }],
      },
      ...(trackedMessagePresent
        ? [{ ID: "fixed-message", To: [{ Address: email }] }]
        : []),
    ]
    return localAdapterResponse({
      total: messages.length,
      count: messages.length,
      start: Number(url.searchParams.get("start")),
      messages,
    })
  }
  const adapter = await canary.createLocalSupabaseEmailProofAdapter({
    supabaseUrl: "http://127.0.0.1:54321",
    mailpitUrl: "http://127.0.0.1:54324",
    applicationOrigin: "http://localhost:3000",
    anonKey: "local-anon-key",
    serviceRoleKey: "local-service-role-key",
    fetchImplementation,
    createClientImplementation(
      _origin: string,
      _key: string,
      clientOptions: { global?: { fetch?: unknown } },
    ) {
      expect(typeof clientOptions.global?.fetch).toBe("function")
      return adminClient
    },
  })
  await adapter.prepareScenario(
    { accountState: "existing" },
    localExecutionLifecycle(),
  )
  return {
    adapter,
    counts() {
      return {
        deleteUserCalls,
        deletedMessageIds,
        listUserCalls,
        mailpitDeleteCalls,
        mailpitListCalls,
      }
    },
  }
}

test("verifies user and Mailpit cleanup postconditions", async () => {
  const successful = await createCleanupPostconditionFixture({})
  await expect(
    successful.adapter.cleanup({ cleanupDeadline: Date.now() + 1_000 }),
  ).resolves.toBeUndefined()
  expect(successful.counts()).toEqual({
    deleteUserCalls: 1,
    deletedMessageIds: ["fixed-message"],
    listUserCalls: 2,
    mailpitDeleteCalls: 1,
    mailpitListCalls: 2,
  })

  const retainedUser = await createCleanupPostconditionFixture({
    retainUser: true,
  })
  await expect(
    retainedUser.adapter.cleanup({ cleanupDeadline: Date.now() + 1_000 }),
  ).rejects.toThrow(/ff029_cleanup_failed/)

  const retainedMessage = await createCleanupPostconditionFixture({
    retainMessage: true,
  })
  await expect(
    retainedMessage.adapter.cleanup({ cleanupDeadline: Date.now() + 1_000 }),
  ).rejects.toThrow(/ff029_cleanup_failed/)
})

test("paginates the complete Mailpit inventory and deletes only tracked recipients", async () => {
  const userId = "bb93cfec-7673-42cf-98e6-080b77cf035d"
  const confirmedAt = "2026-07-19T12:00:00.000Z"
  let email = ""
  let userPresent = true
  let trackedMessagePresent = true
  const requestedStarts: number[] = []
  const deletedBatches: string[][] = []
  const unrelatedMessages = Array.from({ length: 1000 }, (_, index) => ({
    ID: `unrelated-${index}`,
    To: [{ Address: `unrelated-${index}@example.com` }],
  }))
  const adminClient = {
    auth: {
      admin: {
        async createUser(input: { email: string }) {
          email = input.email
          return {
            data: {
              user: { id: userId, email, email_confirmed_at: confirmedAt },
            },
            error: null,
          }
        },
        async listUsers() {
          return {
            data: { users: userPresent ? [{ id: userId, email }] : [] },
            error: null,
          }
        },
        async deleteUser() {
          userPresent = false
          return { data: {}, error: null }
        },
      },
    },
  }
  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    )
    if (init?.method === "DELETE") {
      const body = JSON.parse(String(init.body))
      deletedBatches.push(body.IDs)
      expect(body.IDs).toEqual(["tracked-message"])
      trackedMessagePresent = false
      return localAdapterResponse({})
    }
    const start = Number(url.searchParams.get("start"))
    requestedStarts.push(start)
    const allMessages = [
      ...unrelatedMessages,
      ...(trackedMessagePresent
        ? [{ ID: "tracked-message", To: [{ Address: email }] }]
        : []),
    ]
    const messages = allMessages.slice(start, start + 1000)
    return localAdapterResponse({
      total: allMessages.length,
      count: messages.length,
      start,
      messages,
    })
  }
  const adapter = await canary.createLocalSupabaseEmailProofAdapter({
    supabaseUrl: "http://127.0.0.1:54321",
    mailpitUrl: "http://127.0.0.1:54324",
    applicationOrigin: "http://127.0.0.1:3000",
    anonKey: "local-anon-key-value",
    serviceRoleKey: "local-service-role-key-value",
    fetchImplementation,
    createClientImplementation() {
      return adminClient
    },
  })
  await adapter.prepareScenario(
    { accountState: "existing" },
    localExecutionLifecycle(),
  )
  await expect(
    adapter.cleanup({ cleanupDeadline: Date.now() + 2_000 }),
  ).resolves.toBeUndefined()
  expect(requestedStarts).toEqual([0, 1000, 0])
  expect(deletedBatches).toEqual([["tracked-message"]])
  expect(trackedMessagePresent).toBe(false)
})

test("caps cleanup requests at the independent cleanup deadline", async () => {
  let observedSignal: AbortSignal | undefined
  const adapter = await canary.createLocalSupabaseEmailProofAdapter({
    supabaseUrl: "http://127.0.0.1:54321",
    mailpitUrl: "http://127.0.0.1:54324",
    applicationOrigin: "http://127.0.0.1:3000",
    anonKey: "local-anon-key-value",
    serviceRoleKey: "local-service-role-key-value",
    requestTimeoutMilliseconds: 5_000,
    fetchImplementation: async (
      _input: unknown,
      init: RequestInit | undefined,
    ) => {
      observedSignal = init?.signal ?? undefined
      return new Promise(() => {})
    },
    createClientImplementation(
      _origin: string,
      _key: string,
      clientOptions: {
        global: {
          fetch: (input: string, init?: RequestInit) => Promise<unknown>
        }
      },
    ) {
      return {
        auth: {
          admin: {
            async listUsers() {
              await clientOptions.global.fetch(
                "http://127.0.0.1:54321/auth/v1/admin/users",
              )
              return { data: { users: [] }, error: null }
            },
          },
        },
      }
    },
  })
  await adapter.prepareScenario(
    { accountState: "new" },
    localExecutionLifecycle(),
  )
  const startedAt = Date.now()
  await expect(
    adapter.cleanup({ cleanupDeadline: Date.now() + 30 }),
  ).rejects.toThrow(/ff029_cleanup_deadline_exhausted/)
  expect(Date.now() - startedAt).toBeLessThan(500)
  expect(observedSignal?.aborted).toBe(true)
})

test("preserves only categorical signup proof and authentication method evidence", async () => {
  const report = await canary.runSupabaseEmailProofSupersessionCanary({
    ...successfulAdapter(),
    async prepareScenario(definition: { id: string }) {
      return { scenarioId: definition.id }
    },
    async issueProof(context: { scenarioId: string }) {
      return {
        issuanceOutcome:
          context.scenarioId === "new_advocate_signup_proof_standalone"
            ? "issued_signup"
            : "issued_magiclink",
      }
    },
    async consumeProof(_context: unknown, proof: { issuanceOutcome: string }) {
      return {
        outcome: "accepted",
        authenticationMethod:
          proof.issuanceOutcome === "issued_signup" ? "otp" : "magiclink",
        failureCategory: "none",
      }
    },
  })
  expect(
    report.scenarios.find(
      (scenario: { id: unknown }) =>
        scenario.id === "new_advocate_signup_proof_standalone",
    ),
  ).toMatchObject({
    first_issuance: "issued_signup",
    first_consumption: "accepted",
    first_authentication_method: "otp",
    execution: "observed",
  })
})

test("serializes categorical evidence without proof, contact, user, or provider secrets", async () => {
  const secrets = [
    "raw-proof-secret-abcdefghijklmnopqrstuvwxyz0123456789",
    "canary-person@example.com",
    "bb93cfec-7673-42cf-98e6-080b77cf035d",
    "service-role-secret-material",
  ]
  let proofSequence = 0
  const report = await canary.runSupabaseEmailProofSupersessionCanary(
    successfulAdapter({
      async prepareScenario() {
        return {
          email: secrets[1],
          userId: secrets[2],
          serviceRoleKey: secrets[3],
        }
      },
      async issueProof() {
        proofSequence += 1
        return { tokenHash: `${secrets[0]}-${proofSequence}` }
      },
      async consumeProof() {
        throw new Error(secrets.join(" "))
      },
    }),
  )
  const serialized =
    canary.serializeSupabaseEmailProofSupersessionEvidence(report)
  for (const secret of secrets) expect(serialized).not.toContain(secret)
  expect(serialized).toContain('"first_failure_category":"harness_failure"')
  expect(JSON.parse(serialized)).toEqual(report)
})

test("uses fixed local origins and validates bounded environment inputs", () => {
  const configuration = localRunner.readLocalSupabaseEmailProofEnvironment(
    validLocalEnvironment({
      FF029_LOCAL_SUPABASE_URL: "https://attacker.example",
      FF029_LOCAL_MAILPIT_URL: "https://attacker.example",
      FF029_LOCAL_APPLICATION_ORIGIN: "https://attacker.example",
      SUPABASE_URL: "https://attacker.example",
    }),
  )
  expect(configuration).toMatchObject({
    supabaseUrl: "http://127.0.0.1:54321",
    mailpitUrl: "http://127.0.0.1:54324",
    applicationOrigin: "http://127.0.0.1:3000",
    requestTimeoutMilliseconds: 5_000,
    totalBudgetMilliseconds: 240_000,
    cleanupBudgetMilliseconds: 60_000,
  })

  expect(() =>
    localRunner.readLocalSupabaseEmailProofEnvironment(
      validLocalEnvironment({
        FF029_LOCAL_SUPABASE_SERVICE_ROLE_KEY: "anon-key-material-value",
      }),
    ),
  ).toThrow(/local_keys_not_distinct/)
  expect(() =>
    localRunner.readLocalSupabaseEmailProofEnvironment(
      validLocalEnvironment({ FF029_SOURCE_REVISION: "not-a-revision" }),
    ),
  ).toThrow(/source_revision/)
  expect(() =>
    localRunner.readLocalSupabaseEmailProofEnvironment(
      validLocalEnvironment({ FF029_SOURCE_REVISION: "0".repeat(40) }),
    ),
  ).toThrow(/source_revision/)
  expect(() =>
    localRunner.readLocalSupabaseEmailProofEnvironment(
      validLocalEnvironment({ FF029_REQUEST_TIMEOUT_MILLISECONDS: "30001" }),
    ),
  ).toThrow(/request_timeout/)
  expect(() =>
    localRunner.readLocalSupabaseEmailProofEnvironment(
      validLocalEnvironment({
        FF029_TOTAL_BUDGET_MILLISECONDS: "60000",
        FF029_CLEANUP_BUDGET_MILLISECONDS: "60000",
      }),
    ),
  ).toThrow(/cleanup_reserve/)
})

test("keeps the FF-029 workflow loopback only, ephemeral, and observational", async () => {
  const source = await readFile(WORKFLOW_PATH, "utf8")
  const step = (name: string) => {
    const startMarker = `      - name: ${name}\n`
    const start = source.indexOf(startMarker)
    expect(start).toBeGreaterThanOrEqual(0)
    const next = source.indexOf("\n      - name: ", start + startMarker.length)
    return source.slice(start, next === -1 ? source.length : next)
  }

  const networkCreation = step("Create loopback-only Docker network")
  expect(networkCreation).toContain(
    "--opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
  )
  const bindingVerification = step("Verify Supabase ports are loopback only")
  expect(bindingVerification).toContain("published_bindings")
  expect(bindingVerification).toContain('"127.0.0.1"')
  expect(bindingVerification).toContain('"::1"')
  expect(bindingVerification).toContain("exit 1")

  const credentialLoad = step("Load local Supabase canary credentials")
  expect(credentialLoad).toContain(
    'node_modules/.bin/supabase status -o env > "$status_file"',
  )
  expect(credentialLoad).not.toContain("yarn supabase status")
  expect(
    [...credentialLoad.matchAll(/printf '([A-Z0-9_]+)=%q/g)].map(
      (match) => match[1],
    ),
  ).toEqual([
    "FF029_LOCAL_SUPABASE_ANON_KEY",
    "FF029_LOCAL_SUPABASE_SERVICE_ROLE_KEY",
  ])
  expect(source).not.toContain("GITHUB_ENV")
  expect(source).not.toMatch(
    /\b(?:NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)\b/,
  )

  const observation = step("Observe local email proof supersession behavior")
  expect(observation).toContain("continue-on-error: true")
  expect(observation).toContain(`trap 'rm -f "$credentials_file"' EXIT`)
  expect(observation).toContain(
    "yarn canary:supabase-email-proof-supersession:local",
  )
  const artifactUpload = step(
    "Upload sanitized email proof supersession evidence",
  )
  expect(source.indexOf(observation)).toBeLessThan(
    source.indexOf(artifactUpload),
  )
  expect(artifactUpload).toContain("uses: actions/upload-artifact@v6")
  const artifactPaths = [...artifactUpload.matchAll(/^\s+path:\s*(.+)$/gm)].map(
    (match) => match[1].trim(),
  )
  expect(artifactPaths).toEqual([
    "test-results/provider/ff029-supabase-email-proof-supersession.json",
  ])
  expect(artifactPaths[0]).not.toMatch(/[?*{\[]/)
  expect(artifactUpload).not.toContain("ff029-supabase-credentials.env")
})

test("records source, CLI, harness, config, and active template provenance", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-provenance-fixture-"),
  )
  try {
    await mkdir(resolve(repositoryRoot, "supabase/templates"), {
      recursive: true,
    })
    await mkdir(resolve(repositoryRoot, "node_modules/supabase"), {
      recursive: true,
    })
    const configSource = [
      "[auth.email.template.confirmation]",
      'subject = "Confirmation"',
      'content_path = "./supabase/templates/email.html"',
      "",
      "[auth.email.template.magic_link]",
      'subject = "Magic link"',
      'content_path = "./supabase/templates/email.html"',
      "",
    ].join("\n")
    await writeFile(
      resolve(repositoryRoot, "supabase/config.toml"),
      configSource,
    )
    await writeFile(
      resolve(repositoryRoot, "supabase/templates/email.html"),
      "first-template",
    )
    await writeFile(
      resolve(repositoryRoot, "node_modules/supabase/package.json"),
      JSON.stringify({ name: "supabase", version: "2.90.0" }),
    )
    const configuration = localRunner.readLocalSupabaseEmailProofEnvironment(
      validLocalEnvironment(),
    )
    const first = await localRunner.buildLocalProvenance(
      configuration,
      repositoryRoot,
    )
    expect(first).toMatchObject({
      cli_version: "2.90.0",
      repo_revision: "d".repeat(40),
    })
    expect(first.config_digest).toMatch(/^[0-9a-f]{64}$/)
    expect(first.harness_digest).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(first)).not.toContain(configuration.anonKey)
    expect(JSON.stringify(first)).not.toContain(configuration.serviceRoleKey)

    await writeFile(
      resolve(repositoryRoot, "supabase/templates/email.html"),
      "second-template",
    )
    const second = await localRunner.buildLocalProvenance(
      configuration,
      repositoryRoot,
    )
    expect(second.config_digest).not.toBe(first.config_digest)
    expect(second.harness_digest).toBe(first.harness_digest)
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("removes stale evidence and writes incomplete sanitized JSON with mode 0600", async () => {
  const repositoryRoot = await mkdtemp(
    resolve(tmpdir(), "ff029-evidence-fixture-"),
  )
  try {
    const targetPath =
      await localRunner.prepareLocalEvidenceTarget(repositoryRoot)
    await writeFile(targetPath, "stale-secret")
    await localRunner.prepareLocalEvidenceTarget(repositoryRoot)
    await expect(readFile(targetPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })

    const report = await canary.runSupabaseEmailProofSupersessionCanary(
      successfulAdapter({
        async initialize() {
          throw new Error("provider unavailable")
        },
      }),
      completeRunOptions(),
    )
    expect(report.local_observation).toBe("incomplete")
    const serialized =
      canary.serializeSupabaseEmailProofSupersessionEvidence(report)
    await localRunner.writeSanitizedLocalEvidence(targetPath, serialized)
    expect(await readFile(targetPath, "utf8")).toBe(serialized)
    expect((await stat(targetPath)).mode & 0o777).toBe(0o600)

    await localRunner.prepareLocalEvidenceTarget(repositoryRoot)
    await expect(
      localRunner.writeSanitizedLocalEvidence(
        targetPath,
        `${JSON.stringify({ ...report, leaked_secret: "must-not-write" })}\n`,
      ),
    ).rejects.toThrow(/ff029_evidence_shape_invalid/)
    await expect(readFile(targetPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("source never sends diagnostics or persists raw canary material", async () => {
  const [supportSource, localRunnerSource] = await Promise.all([
    readFile(SUPPORT_PATH, "utf8"),
    readFile(LOCAL_RUNNER_PATH, "utf8"),
  ])
  const combined = `${supportSource}\n${localRunnerSource}`
  expect(combined).not.toMatch(/console\.(?:debug|error|info|log|trace|warn)/)
  expect(supportSource).not.toMatch(
    /(?:appendFile|createWriteStream|writeFile)/,
  )
  expect(combined).not.toMatch(/(?:localStorage|sessionStorage)/)
  expect(localRunnerSource).not.toContain("result.stderr")
  expect(localRunnerSource).not.toContain("result.stdout.trim")
  expect(localRunnerSource).not.toContain("process.stderr")
  expect(localRunnerSource).not.toContain("node:child_process")
  expect(localRunnerSource).not.toMatch(/\b(?:exec|spawn)(?:File|Sync)?\s*\(/)
  expect(localRunnerSource).not.toContain("FF029_LOCAL_SUPABASE_URL")
  expect(localRunnerSource).not.toContain("FF029_LOCAL_MAILPIT_URL")
  expect(localRunnerSource).not.toContain("FF029_LOCAL_APPLICATION_ORIGIN")
  expect(localRunnerSource).toContain("process.stdout.write")
})
