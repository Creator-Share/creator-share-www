import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

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
    "tests/advocates/public-metric-release-worker.spec.ts",
  ),
)
const auth = testRequire(
  "../../src/lib/advocates/publicMetrics/releaseAuth",
) as typeof import("../../src/lib/advocates/publicMetrics/releaseAuth")
const config = testRequire(
  "../../src/lib/advocates/publicMetrics/releaseConfig",
) as typeof import("../../src/lib/advocates/publicMetrics/releaseConfig")
const repository = testRequire(
  "../../src/lib/advocates/publicMetrics/releaseRepository",
) as typeof import("../../src/lib/advocates/publicMetrics/releaseRepository")
const route = testRequire(
  "../../src/lib/advocates/publicMetrics/releaseRoute",
) as typeof import("../../src/lib/advocates/publicMetrics/releaseRoute")
const worker = testRequire(
  "../../src/lib/advocates/publicMetrics/releaseWorker",
) as typeof import("../../src/lib/advocates/publicMetrics/releaseWorker")
nodeModule._load = originalModuleLoad

type ReleaseExecutor =
  import("../../src/lib/advocates/publicMetrics/releaseWorker").AdvocatePublicMetricReleaseRpcExecutor

const SECRET = "p".repeat(48)
const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const SOURCE_CUTOFF = "2026-07-06T00:00:00Z"

const validResult = {
  processed_advocates: 2,
  inserted_releases: 3,
  pending_metrics: 5,
  source_cutoff: SOURCE_CUTOFF,
  policy_version: "public-v1",
}

function executorDouble(
  refresh: ReleaseExecutor["refresh"] = async () => validResult,
): ReleaseExecutor {
  return { refresh }
}

function authorizedRequest(headers: Record<string, string> = {}): Request {
  return new Request(
    "https://creatorshare.com/api/internal/advocates/public-metrics",
    {
      headers: { authorization: `Bearer ${SECRET}`, ...headers },
    },
  )
}

test.describe.configure({ mode: "serial" })

test.describe("advocate public metric release authentication and configuration", () => {
  test("uses a strict constant-time bearer check", () => {
    expect(
      auth.isAuthorizedAdvocatePublicMetricReleaseWorkerRequest(
        `Bearer ${SECRET}`,
        SECRET,
      ),
    ).toBe(true)

    for (const supplied of [
      null,
      SECRET,
      `Basic ${SECRET}`,
      `Bearer ${SECRET} `,
      `Bearer ${"x".repeat(48)}`,
      "Bearer short",
    ]) {
      expect(
        auth.isAuthorizedAdvocatePublicMetricReleaseWorkerRequest(
          supplied,
          SECRET,
        ),
      ).toBe(false)
    }
  })

  test("uses cron fallback and prohibits a Vercel-specific override", () => {
    expect(
      auth.loadAdvocatePublicMetricReleaseWorkerSecret({
        CRON_SECRET: SECRET,
      }),
    ).toBe(SECRET)
    expect(
      auth.loadAdvocatePublicMetricReleaseWorkerSecret({
        CRON_SECRET: "c".repeat(48),
        ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET: SECRET,
      }),
    ).toBe(SECRET)

    for (const environment of [
      {},
      { CRON_SECRET: "short" },
      { CRON_SECRET: `${SECRET} ` },
      {
        VERCEL: "1",
        CRON_SECRET: SECRET,
        ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET: "x".repeat(48),
      },
    ]) {
      expect(() =>
        auth.loadAdvocatePublicMetricReleaseWorkerSecret(environment),
      ).toThrow("Advocate public metric release worker is unavailable")
    }
  })

  test("loads bounded worker settings", () => {
    expect(config.loadAdvocatePublicMetricReleaseWorkerConfig({})).toEqual({
      batchSize: 100,
      rpcTimeoutMilliseconds: 45_000,
    })
    expect(
      config.loadAdvocatePublicMetricReleaseWorkerConfig({
        ADVOCATE_PUBLIC_METRIC_RELEASE_BATCH_SIZE: "7",
        ADVOCATE_PUBLIC_METRIC_RELEASE_RPC_TIMEOUT_MILLISECONDS: "2000",
      }),
    ).toEqual({ batchSize: 7, rpcTimeoutMilliseconds: 2_000 })

    for (const environment of [
      { ADVOCATE_PUBLIC_METRIC_RELEASE_BATCH_SIZE: "0" },
      { ADVOCATE_PUBLIC_METRIC_RELEASE_BATCH_SIZE: "101" },
      { ADVOCATE_PUBLIC_METRIC_RELEASE_BATCH_SIZE: "1.5" },
      { ADVOCATE_PUBLIC_METRIC_RELEASE_RPC_TIMEOUT_MILLISECONDS: "999" },
      { ADVOCATE_PUBLIC_METRIC_RELEASE_RPC_TIMEOUT_MILLISECONDS: "50001" },
    ]) {
      expect(() =>
        config.loadAdvocatePublicMetricReleaseWorkerConfig(environment),
      ).toThrow("Advocate public metric release worker is unavailable")
    }
  })
})

test.describe("advocate public metric release result boundary", () => {
  test("accepts only the exact bounded aggregate", () => {
    expect(
      worker.parseAdvocatePublicMetricReleaseSummary(validResult, 2),
    ).toEqual({
      processedAdvocates: 2,
      insertedReleases: 3,
      pendingMetrics: 5,
      sourceCutoff: SOURCE_CUTOFF,
      policyVersion: "public-v1",
    })
  })

  test("rejects malformed, off-cadence, and internally inconsistent results", () => {
    const invalidResults: unknown[] = [
      null,
      [],
      { ...validResult, extra: true },
      { ...validResult, processed_advocates: -1 },
      { ...validResult, processed_advocates: 3 },
      { ...validResult, inserted_releases: 9 },
      { ...validResult, pending_metrics: 9 },
      { ...validResult, inserted_releases: 4, pending_metrics: 5 },
      { ...validResult, inserted_releases: 2, pending_metrics: 5 },
      { ...validResult, source_cutoff: "2026-07-07T00:00:00Z" },
      { ...validResult, source_cutoff: "2026-07-06T00:00:01Z" },
      { ...validResult, source_cutoff: "not-a-date" },
      { ...validResult, policy_version: "public-v2" },
      { ...validResult, inserted_releases: "3" },
    ]
    for (const result of invalidResults) {
      expect(() =>
        worker.parseAdvocatePublicMetricReleaseSummary(result, 2),
      ).toThrow("Advocate public metric release result is invalid")
    }
  })

  test("forwards only the bounded batch and trusted context", async () => {
    const calls: unknown[][] = []
    const signal = new AbortController().signal
    const result = await worker.runAdvocatePublicMetricReleaseWorker({
      batchSize: 2,
      rpcTimeoutMilliseconds: 4_000,
      executor: executorDouble(async (...args) => {
        calls.push(args)
        return validResult
      }),
      context: { requestId: REQUEST_ID, traceId: "trace-safe" },
      timeoutSignal(milliseconds) {
        expect(milliseconds).toBe(4_000)
        return signal
      },
    })
    expect(result.insertedReleases).toBe(3)
    expect(calls).toEqual([
      [2, { requestId: REQUEST_ID, traceId: "trace-safe" }, signal],
    ])
  })
})

test.describe("advocate public metric release repository", () => {
  test("calls the one service RPC with server-owned context and deadline", async () => {
    const calls: unknown[] = []
    const signal = new AbortController().signal
    const client = {
      rpc(name: string, args: unknown) {
        calls.push({ name, args })
        return {
          async abortSignal(receivedSignal: AbortSignal) {
            calls.push({ signal: receivedSignal })
            return { data: validResult, error: null }
          },
        }
      },
    }
    const executor =
      repository.createSupabaseAdvocatePublicMetricReleaseRpcExecutor(
        client as never,
      )
    await expect(
      executor.refresh(
        2,
        { requestId: REQUEST_ID, traceId: "trace-safe" },
        signal,
      ),
    ).resolves.toEqual(validResult)
    expect(calls).toEqual([
      {
        name: "refresh_advocate_public_metric_releases",
        args: {
          batch_limit: 2,
          request_id: REQUEST_ID,
          trace_id: "trace-safe",
        },
      },
      { signal },
    ])
  })

  test("normalizes provider detail to one fixed failure", async () => {
    const client = {
      rpc() {
        return {
          async abortSignal() {
            return {
              data: null,
              error: { message: "raw database and sponsor detail" },
            }
          },
        }
      },
    }
    const executor =
      repository.createSupabaseAdvocatePublicMetricReleaseRpcExecutor(
        client as never,
      )
    await expect(
      executor.refresh(
        2,
        { requestId: REQUEST_ID, traceId: null },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Advocate public metric release RPC failed")
  })
})

test.describe("advocate public metric release route and schedule", () => {
  test("authorizes before constructing the executor", async () => {
    let executorCalls = 0
    const response = await route.handleAdvocatePublicMetricReleaseRequest(
      new Request(
        "https://creatorshare.com/api/internal/advocates/public-metrics",
      ),
      {
        environment: { CRON_SECRET: SECRET },
        createExecutor() {
          executorCalls += 1
          return executorDouble()
        },
      },
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      ok: false,
      code: "unauthorized",
    })
    expect(executorCalls).toBe(0)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  test("returns one sanitized aggregate and accepts only trusted trace headers", async () => {
    const contexts: unknown[] = []
    const response = await route.handleAdvocatePublicMetricReleaseRequest(
      authorizedRequest({
        "x-vercel-id": "sfo1::trace-safe",
        "x-trace-id": "browser-fiction",
      }),
      {
        environment: {
          CRON_SECRET: SECRET,
          ADVOCATE_PUBLIC_METRIC_RELEASE_BATCH_SIZE: "2",
        },
        requestId: () => REQUEST_ID,
        timeoutSignal: () => new AbortController().signal,
        createExecutor: () =>
          executorDouble(async (_batchSize, context) => {
            contexts.push(context)
            return validResult
          }),
      },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      requestId: REQUEST_ID,
      processedAdvocates: 2,
      insertedReleases: 3,
      pendingMetrics: 5,
      sourceCutoff: SOURCE_CUTOFF,
      policyVersion: "public-v1",
    })
    expect(contexts).toEqual([
      { requestId: REQUEST_ID, traceId: "sfo1::trace-safe" },
    ])
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })

  test("redacts failures from both responses and logs", async () => {
    const sensitive = "sponsor@example.com"
    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const response = await route.handleAdvocatePublicMetricReleaseRequest(
        authorizedRequest(),
        {
          environment: { CRON_SECRET: SECRET },
          requestId: () => REQUEST_ID,
          createExecutor: () =>
            executorDouble(async () => {
              throw new Error(sensitive)
            }),
        },
      )
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body).toEqual({
        ok: false,
        code: "worker_execution_failed",
        requestId: REQUEST_ID,
      })
      expect(JSON.stringify({ body, errorCalls })).not.toContain(sensitive)
    } finally {
      console.error = originalError
    }
  })

  test("declares the exact daily recovery route for weekly releases", async () => {
    const routeSource = await readFile(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/public-metrics/route.ts",
      ),
      "utf8",
    )
    expect(routeSource).toContain('export const runtime = "nodejs"')
    expect(routeSource).toContain("export const maxDuration = 60")

    const vercel = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      functions?: Record<string, unknown>
      crons?: Array<{ path?: unknown; schedule?: unknown }>
    }
    expect(
      vercel.functions?.[
        "src/app/api/internal/advocates/public-metrics/route.ts"
      ],
    ).toEqual({ maxDuration: 60 })
    expect(
      vercel.crons?.filter(
        (entry) => entry.path === "/api/internal/advocates/public-metrics",
      ),
    ).toEqual([
      {
        path: "/api/internal/advocates/public-metrics",
        schedule: "13 1 * * *",
      },
    ])

    const environmentSample = await readFile(
      resolve(process.cwd(), "dotenv.sample"),
      "utf8",
    )
    expect(environmentSample).toContain(
      "ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET",
    )
    expect(environmentSample).toContain(
      "ADVOCATE_PUBLIC_METRIC_RELEASE_BATCH_SIZE=100",
    )
  })
})
