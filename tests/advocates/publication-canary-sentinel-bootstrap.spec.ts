import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

type BootstrapModule =
  typeof import("../../src/lib/advocates/publicationCanary/sentinelBootstrap")
type EvidenceModule =
  typeof import("../../src/lib/advocates/publicationCanary/sentinelEvidence")
type SentinelEvidenceInput =
  import("../../src/lib/advocates/publicationCanary/sentinelEvidence").PublicationCanarySentinelEvidenceInput
type WorkerModule =
  typeof import("../../src/lib/advocates/publicationCanary/sentinelWorker")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/advocates/publication-canary-sentinel-bootstrap.spec.ts",
  ),
)
const bootstrap = testRequire(
  "../../src/lib/advocates/publicationCanary/sentinelBootstrap",
) as BootstrapModule
const evidenceModule = testRequire(
  "../../src/lib/advocates/publicationCanary/sentinelEvidence",
) as EvidenceModule
const worker = testRequire(
  "../../src/lib/advocates/publicationCanary/sentinelWorker",
) as WorkerModule
nodeModule._load = originalModuleLoad

const RUN_ID = "11111111-1111-4111-8111-111111111111"
const REQUEST_REFERENCE = "a".repeat(64)
const REQUEST_ID = "22222222-2222-4222-8222-222222222222"
const WORKER_RUN_ID = "33333333-3333-4333-8333-333333333333"
const SECRET = "s".repeat(48)
const SENTINEL_HOSTNAME = "publication-sentinel.creatorshare.com"

function requireRecordedEvidence(
  evidence: SentinelEvidenceInput | null,
): SentinelEvidenceInput {
  if (evidence === null) throw new Error("expected sentinel evidence")
  return evidence
}

function providerResult(outcome: "ready" | "converging" | "failed") {
  const ready = outcome === "ready"
  return {
    readiness: {
      hostname: SENTINEL_HOSTNAME as typeof SENTINEL_HOSTNAME,
      cloudflareReady: ready,
      vercelReady: ready,
    },
    outcome,
    events: [
      {
        sequence: 0,
        stage: "cloudflare_lookup" as const,
        outcome_code: ready
          ? ("ready" as const)
          : outcome === "converging"
            ? ("not_ready" as const)
            : ("provider_unavailable" as const),
      },
      {
        sequence: 1,
        stage: "vercel_lookup" as const,
        outcome_code: ready
          ? ("ready" as const)
          : outcome === "converging"
            ? ("blocked" as const)
            : ("blocked" as const),
      },
    ],
  }
}

function httpsResponse(overrides: Record<string, unknown> = {}) {
  return {
    requestedHostname: SENTINEL_HOSTNAME,
    finalUrl: `https://${SENTINEL_HOSTNAME}/`,
    status: 404,
    redirected: false,
    contentType: "text/plain; charset=utf-8",
    body: new TextEncoder().encode("Not Found"),
    ...overrides,
  }
}

test.describe("publication sentinel scheduled bootstrap", () => {
  test("records provider, DNS, TLS, and HTTPS readiness before becoming ready", async () => {
    const calls: string[] = []
    const recorded: SentinelEvidenceInput[] = []
    const result = await bootstrap.runPublicationCanarySentinelBootstrap(
      { runId: RUN_ID, requestReferenceSha256: REQUEST_REFERENCE },
      {
        evidence: {
          async record(input) {
            calls.push("evidence")
            recorded.push(structuredClone(input))
          },
        },
        async reconcileProviders() {
          calls.push("providers")
          return providerResult("ready")
        },
        async observeDns() {
          calls.push("dns")
        },
        async inspectTls() {
          calls.push("tls")
        },
        async requestHttps() {
          calls.push("https")
          return httpsResponse()
        },
      },
    )

    expect(result).toEqual({ ready: true, outcome: "ready" })
    expect(calls).toEqual(["providers", "dns", "tls", "https", "evidence"])
    expect(recorded).toEqual([
      {
        runId: RUN_ID,
        requestReferenceSha256: REQUEST_REFERENCE,
        outcome: "ready",
        events: [
          {
            sequence: 0,
            stage: "cloudflare_lookup",
            outcome_code: "ready",
          },
          {
            sequence: 1,
            stage: "vercel_lookup",
            outcome_code: "ready",
          },
          { sequence: 2, stage: "dns", outcome_code: "ready" },
          { sequence: 3, stage: "tls", outcome_code: "ready" },
          { sequence: 4, stage: "https", outcome_code: "ready" },
          { sequence: 5, stage: "complete", outcome_code: "ready" },
        ],
      },
    ])
  })

  test("keeps ordinary provider and certificate propagation pending", async () => {
    for (const failureStage of ["providers", "dns", "tls", "https"] as const) {
      const calls: string[] = []
      let recorded: SentinelEvidenceInput | null = null
      const result = await bootstrap.runPublicationCanarySentinelBootstrap(
        { runId: RUN_ID, requestReferenceSha256: REQUEST_REFERENCE },
        {
          evidence: {
            async record(input) {
              calls.push("evidence")
              recorded = structuredClone(input)
            },
          },
          async reconcileProviders() {
            calls.push("providers")
            return providerResult(
              failureStage === "providers" ? "converging" : "ready",
            )
          },
          async observeDns() {
            calls.push("dns")
            if (failureStage === "dns") throw new Error("raw DNS detail")
          },
          async inspectTls() {
            calls.push("tls")
            if (failureStage === "tls") throw new Error("raw TLS detail")
          },
          async requestHttps() {
            calls.push("https")
            if (failureStage === "https") {
              throw new Error("raw transport detail")
            }
            return httpsResponse()
          },
        },
      )

      expect(result).toEqual({ ready: false, outcome: "converging" })
      const persistedEvidence = requireRecordedEvidence(recorded)
      expect(JSON.stringify(persistedEvidence)).not.toContain("raw")
      expect(persistedEvidence.events.at(-1)).toEqual({
        sequence: persistedEvidence.events.length - 1,
        stage: "complete",
        outcome_code: "converging",
      })
      expect(calls.at(-1)).toBe("evidence")
    }
  })

  test("treats a reachable but nonneutral sentinel response as failed", async () => {
    let recorded: SentinelEvidenceInput | null = null
    const result = await bootstrap.runPublicationCanarySentinelBootstrap(
      { runId: RUN_ID, requestReferenceSha256: REQUEST_REFERENCE },
      {
        evidence: {
          async record(input) {
            recorded = structuredClone(input)
          },
        },
        async reconcileProviders() {
          return providerResult("ready")
        },
        async observeDns() {},
        async inspectTls() {},
        async requestHttps() {
          return httpsResponse({ status: 200, body: new Uint8Array(32_769) })
        },
      },
    )

    expect(result).toEqual({ ready: false, outcome: "failed" })
    expect(requireRecordedEvidence(recorded).events.slice(-2)).toEqual([
      { sequence: 4, stage: "https", outcome_code: "unexpected_response" },
      { sequence: 5, stage: "complete", outcome_code: "failed" },
    ])
  })

  test("distinguishes malformed reachable HTTP from transient transport failure", async () => {
    for (const [error, expectedOutcome, expectedCode] of [
      [
        new bootstrap.PublicationCanaryReachableHttpResponseError(),
        "failed",
        "unexpected_response",
      ],
      [new Error("temporary transport failure"), "converging", "not_ready"],
    ] as const) {
      let recorded: SentinelEvidenceInput | null = null
      const result = await bootstrap.runPublicationCanarySentinelBootstrap(
        { runId: RUN_ID, requestReferenceSha256: REQUEST_REFERENCE },
        {
          evidence: {
            async record(input) {
              recorded = structuredClone(input)
            },
          },
          async reconcileProviders() {
            return providerResult("ready")
          },
          async observeDns() {},
          async inspectTls() {},
          async requestHttps() {
            throw error
          },
        },
      )

      expect(result).toEqual({ ready: false, outcome: expectedOutcome })
      expect(requireRecordedEvidence(recorded).events.slice(-2)).toEqual([
        { sequence: 4, stage: "https", outcome_code: expectedCode },
        { sequence: 5, stage: "complete", outcome_code: expectedOutcome },
      ])
    }
  })

  test("executes tenant work only after ready sentinel evidence settles", async () => {
    const calls: string[] = []
    const dependencies = {
      evidence: {
        async record() {
          calls.push("evidence")
        },
      },
      async reconcileProviders() {
        calls.push("providers")
        return providerResult("ready")
      },
      async observeDns() {
        calls.push("dns")
      },
      async inspectTls() {
        calls.push("tls")
      },
      async requestHttps() {
        calls.push("https")
        return httpsResponse()
      },
    }
    const result = await bootstrap.runAfterPublicationCanarySentinel(
      { runId: RUN_ID, requestReferenceSha256: REQUEST_REFERENCE },
      dependencies,
      async () => {
        calls.push("tenant-execution")
        return { outcome: "idle" as const }
      },
    )

    expect(result).toEqual({
      ready: true,
      outcome: "ready",
      execution: { outcome: "idle" },
    })
    expect(calls).toEqual([
      "providers",
      "dns",
      "tls",
      "https",
      "evidence",
      "tenant-execution",
    ])

    for (const outcome of ["converging", "failed"] as const) {
      let executions = 0
      const gated = await bootstrap.runAfterPublicationCanarySentinel(
        { runId: RUN_ID, requestReferenceSha256: REQUEST_REFERENCE },
        {
          ...dependencies,
          async reconcileProviders() {
            return providerResult(outcome)
          },
        },
        async () => {
          executions += 1
          return { outcome: "must-not-run" as const }
        },
      )
      expect(gated).toEqual({ ready: false, outcome })
      expect(executions).toBe(0)
    }
  })
})

test.describe("publication sentinel protected evidence adapter", () => {
  test("writes one strict atomic RPC payload and exposes no raw reference", async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, input: Record<string, unknown>) {
        calls.push({ name, input })
        return { data: null, error: null }
      },
    } as unknown as SupabaseClient
    const repository =
      evidenceModule.createPublicationCanarySentinelEvidenceRepository(client)
    await repository.record({
      runId: RUN_ID,
      requestReferenceSha256: REQUEST_REFERENCE,
      outcome: "ready",
      events: [
        {
          sequence: 0,
          stage: "cloudflare_lookup",
          outcome_code: "ready",
        },
        { sequence: 1, stage: "vercel_lookup", outcome_code: "ready" },
        { sequence: 2, stage: "complete", outcome_code: "ready" },
      ],
    })
    expect(calls).toEqual([
      {
        name: "record_advocate_publication_sentinel_reconciliation",
        input: {
          target_run_id: RUN_ID,
          target_request_reference_sha256: REQUEST_REFERENCE,
          target_outcome_code: "ready",
          target_events: [
            {
              sequence: 0,
              stage: "cloudflare_lookup",
              outcome_code: "ready",
            },
            { sequence: 1, stage: "vercel_lookup", outcome_code: "ready" },
            { sequence: 2, stage: "complete", outcome_code: "ready" },
          ],
        },
      },
    ])
  })

  test("accepts terminal provider verification evidence before the RPC", async () => {
    let calls = 0
    const repository =
      evidenceModule.createPublicationCanarySentinelEvidenceRepository({
        async rpc() {
          calls += 1
          return { data: null, error: null }
        },
      } as unknown as SupabaseClient)

    await repository.record({
      runId: RUN_ID,
      requestReferenceSha256: REQUEST_REFERENCE,
      outcome: "failed",
      events: [
        {
          sequence: 0,
          stage: "cloudflare_lookup",
          outcome_code: "not_found",
        },
        {
          sequence: 1,
          stage: "cloudflare_apply",
          outcome_code: "provider_unavailable",
        },
        {
          sequence: 2,
          stage: "cloudflare_verify",
          outcome_code: "failed",
        },
        { sequence: 3, stage: "vercel_lookup", outcome_code: "blocked" },
        { sequence: 4, stage: "complete", outcome_code: "failed" },
      ],
    })

    expect(calls).toBe(1)
  })

  test("rejects malformed or secret-bearing evidence before the RPC", async () => {
    let calls = 0
    const repository =
      evidenceModule.createPublicationCanarySentinelEvidenceRepository({
        async rpc() {
          calls += 1
          return { data: null, error: null }
        },
      } as unknown as SupabaseClient)

    await expect(
      repository.record({
        runId: RUN_ID,
        requestReferenceSha256: REQUEST_REFERENCE,
        outcome: "ready",
        events: [
          {
            sequence: 0,
            stage: "cloudflare_lookup",
            outcome_code: "ready",
            providerToken: "secret",
          } as never,
          { sequence: 1, stage: "vercel_lookup", outcome_code: "ready" },
          { sequence: 2, stage: "complete", outcome_code: "ready" },
        ],
      }),
    ).rejects.toThrow(evidenceModule.PublicationCanarySentinelEvidenceError)
    expect(calls).toBe(0)
  })

  test("rejects stage and outcome vocabulary mismatches before the RPC", async () => {
    let calls = 0
    const repository =
      evidenceModule.createPublicationCanarySentinelEvidenceRepository({
        async rpc() {
          calls += 1
          return { data: null, error: null }
        },
      } as unknown as SupabaseClient)

    await expect(
      repository.record({
        runId: RUN_ID,
        requestReferenceSha256: REQUEST_REFERENCE,
        outcome: "failed",
        events: [
          {
            sequence: 0,
            stage: "cloudflare_lookup",
            outcome_code: "apply_accepted",
          },
          { sequence: 1, stage: "vercel_lookup", outcome_code: "blocked" },
          { sequence: 2, stage: "complete", outcome_code: "failed" },
        ],
      }),
    ).rejects.toThrow(evidenceModule.PublicationCanarySentinelEvidenceError)
    expect(calls).toBe(0)
  })
})

test.describe("publication sentinel worker response boundary", () => {
  function request(secret = SECRET) {
    return new Request("https://creatorshare.com/internal", {
      headers: { Authorization: `Bearer ${secret}` },
    })
  }

  test("returns only readiness while logging a hashed failure reference", async () => {
    const logs: unknown[] = []
    const response = await worker.handlePublicationCanarySentinelWorkerRequest(
      request(),
      {
        environment: { CRON_SECRET: SECRET },
        randomUUID: (() => {
          const values = [REQUEST_ID, WORKER_RUN_ID]
          return () => values.shift() ?? RUN_ID
        })(),
        async runBootstrap(input) {
          expect(input.runId).toBe(WORKER_RUN_ID)
          expect(input.requestReferenceSha256).toMatch(/^[0-9a-f]{64}$/)
          expect(input.requestReferenceSha256).not.toContain(REQUEST_ID)
          return { ready: false, outcome: "failed" }
        },
        logFailure(input) {
          logs.push(input)
        },
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "sentinel_reconciliation_failed",
      requestId: REQUEST_ID,
    })
    expect(JSON.stringify(logs)).not.toContain(REQUEST_ID)
    expect(JSON.stringify(logs)).not.toContain("cloudflare")
    expect(logs).toEqual([
      {
        code: "sentinel_reconciliation_failed",
        requestReferenceSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ])
  })

  test("keeps convergence nonterminal and denies unauthenticated execution", async () => {
    let runs = 0
    const dependencies = {
      environment: { CRON_SECRET: SECRET },
      randomUUID: (() => {
        const values = [REQUEST_ID, WORKER_RUN_ID]
        return () => values.shift() ?? RUN_ID
      })(),
      async runBootstrap() {
        runs += 1
        return { ready: false as const, outcome: "converging" as const }
      },
    }
    const unauthorized =
      await worker.handlePublicationCanarySentinelWorkerRequest(
        request("wrong".repeat(12)),
        dependencies,
      )
    expect(unauthorized.status).toBe(401)
    expect(runs).toBe(0)

    const converging =
      await worker.handlePublicationCanarySentinelWorkerRequest(
        request(),
        dependencies,
      )
    expect(converging.status).toBe(202)
    await expect(converging.json()).resolves.toMatchObject({
      ok: true,
      ready: false,
      code: "sentinel_converging",
    })
    expect(runs).toBe(1)
  })
})
