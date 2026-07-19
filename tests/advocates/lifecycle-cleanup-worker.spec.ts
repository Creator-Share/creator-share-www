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
  resolve(process.cwd(), "tests/advocates/lifecycle-cleanup-worker.spec.ts"),
)
const auth = testRequire(
  "../../src/lib/advocates/lifecycleCleanup/auth",
) as typeof import("../../src/lib/advocates/lifecycleCleanup/auth")
const config = testRequire(
  "../../src/lib/advocates/lifecycleCleanup/config",
) as typeof import("../../src/lib/advocates/lifecycleCleanup/config")
const repository = testRequire(
  "../../src/lib/advocates/lifecycleCleanup/repository",
) as typeof import("../../src/lib/advocates/lifecycleCleanup/repository")
const route = testRequire(
  "../../src/lib/advocates/lifecycleCleanup/route",
) as typeof import("../../src/lib/advocates/lifecycleCleanup/route")
const worker = testRequire(
  "../../src/lib/advocates/lifecycleCleanup/worker",
) as typeof import("../../src/lib/advocates/lifecycleCleanup/worker")
nodeModule._load = originalModuleLoad

type CleanupExecutor =
  import("../../src/lib/advocates/lifecycleCleanup/worker").ArchivedAdvocateDomainCleanupRpcExecutor

const SECRET = "l".repeat(48)
const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const WORKER_ID = "22222222-2222-4222-8222-222222222222"
const ADVOCATE_ID = "33333333-3333-4333-8333-333333333333"
const OTHER_ADVOCATE_ID = "44444444-4444-4444-8444-444444444444"
const DOMAIN_IDS = [
  "55555555-5555-4555-8555-555555555551",
  "55555555-5555-4555-8555-555555555552",
  "55555555-5555-4555-8555-555555555553",
  "55555555-5555-4555-8555-555555555554",
  "55555555-5555-4555-8555-555555555555",
  "55555555-5555-4555-8555-555555555556",
  "55555555-5555-4555-8555-555555555557",
  "55555555-5555-4555-8555-555555555558",
] as const

const validRows = [
  {
    advocate_id: ADVOCATE_ID,
    domain_id: DOMAIN_IDS[0],
    phase: "quiescing",
    jobs_enqueued: 0,
    cleanup_complete: false,
  },
  {
    advocate_id: ADVOCATE_ID,
    domain_id: DOMAIN_IDS[1],
    phase: "cloudflare_dns_removal",
    jobs_enqueued: 1,
    cleanup_complete: false,
  },
  {
    advocate_id: ADVOCATE_ID,
    domain_id: DOMAIN_IDS[2],
    phase: "vercel_removal",
    jobs_enqueued: 0,
    cleanup_complete: false,
  },
  {
    advocate_id: ADVOCATE_ID,
    domain_id: DOMAIN_IDS[3],
    phase: "stripe_us_removal",
    jobs_enqueued: 1,
    cleanup_complete: false,
  },
  {
    advocate_id: OTHER_ADVOCATE_ID,
    domain_id: DOMAIN_IDS[4],
    phase: "stripe_uk_removal",
    jobs_enqueued: 0,
    cleanup_complete: false,
  },
  {
    advocate_id: OTHER_ADVOCATE_ID,
    domain_id: DOMAIN_IDS[5],
    phase: "paypal_removal",
    jobs_enqueued: 1,
    cleanup_complete: false,
  },
  {
    advocate_id: OTHER_ADVOCATE_ID,
    domain_id: DOMAIN_IDS[6],
    phase: "complete",
    jobs_enqueued: 0,
    cleanup_complete: true,
  },
  {
    advocate_id: OTHER_ADVOCATE_ID,
    domain_id: DOMAIN_IDS[7],
    phase: "needs_attention",
    jobs_enqueued: 0,
    cleanup_complete: false,
  },
]

function executorDouble(
  coordinate: CleanupExecutor["coordinate"] = async () => validRows,
): CleanupExecutor {
  return { coordinate }
}

function authorizedRequest(): Request {
  return new Request(
    "https://creatorshare.com/api/internal/advocates/lifecycle-cleanup",
    { headers: { authorization: `Bearer ${SECRET}` } },
  )
}

test.describe.configure({ mode: "serial" })

test.describe("archived advocate domain cleanup authentication and configuration", () => {
  test("uses an exact constant-time bearer check", () => {
    expect(
      auth.isAuthorizedArchivedAdvocateDomainCleanupWorkerRequest(
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
        auth.isAuthorizedArchivedAdvocateDomainCleanupWorkerRequest(
          supplied,
          SECRET,
        ),
      ).toBe(false)
    }
  })

  test("uses the cron secret and rejects a Vercel-only secret mismatch", () => {
    expect(
      auth.loadArchivedAdvocateDomainCleanupWorkerSecret({
        CRON_SECRET: SECRET,
      }),
    ).toBe(SECRET)
    expect(
      auth.loadArchivedAdvocateDomainCleanupWorkerSecret({
        CRON_SECRET: "c".repeat(48),
        ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_WORKER_SECRET: SECRET,
      }),
    ).toBe(SECRET)

    for (const environment of [
      {},
      { CRON_SECRET: "short" },
      { CRON_SECRET: `${SECRET} ` },
      {
        VERCEL: "1",
        CRON_SECRET: SECRET,
        ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_WORKER_SECRET: "x".repeat(48),
      },
    ]) {
      expect(() =>
        auth.loadArchivedAdvocateDomainCleanupWorkerSecret(environment),
      ).toThrow("Archived advocate domain cleanup worker is unavailable")
    }
  })

  test("loads only bounded batch and RPC deadlines", () => {
    expect(config.loadArchivedAdvocateDomainCleanupWorkerConfig({})).toEqual({
      batchSize: 25,
      rpcTimeoutMilliseconds: 45_000,
    })
    expect(
      config.loadArchivedAdvocateDomainCleanupWorkerConfig({
        ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_BATCH_SIZE: "7",
        ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_RPC_TIMEOUT_MILLISECONDS: "2000",
      }),
    ).toEqual({ batchSize: 7, rpcTimeoutMilliseconds: 2_000 })

    for (const environment of [
      { ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_BATCH_SIZE: "0" },
      { ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_BATCH_SIZE: "51" },
      { ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_BATCH_SIZE: "1.5" },
      {
        ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_RPC_TIMEOUT_MILLISECONDS: "999",
      },
      {
        ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_RPC_TIMEOUT_MILLISECONDS: "50001",
      },
    ]) {
      expect(() =>
        config.loadArchivedAdvocateDomainCleanupWorkerConfig(environment),
      ).toThrow("Archived advocate domain cleanup worker is unavailable")
    }
  })
})

test.describe("archived advocate domain cleanup result boundary", () => {
  test("reduces exact coordinator rows to privacy-safe aggregate counts", () => {
    expect(
      worker.parseArchivedAdvocateDomainCleanupSummary(validRows, 8),
    ).toEqual({
      processedDomains: 8,
      jobsEnqueued: 3,
      quiescingDomains: 1,
      cloudflareDnsRemoval: 1,
      providerCleanup: 4,
      blockedDomains: 1,
    })
    expect(worker.parseArchivedAdvocateDomainCleanupSummary([], 25)).toEqual(
      worker.emptyArchivedAdvocateDomainCleanupSummary(),
    )
  })

  test("rejects identifiers, unknown fields, duplicates, and impossible phase states", () => {
    const base = validRows[0]
    const invalidResults: unknown[] = [
      null,
      {},
      [
        ...validRows,
        {
          ...validRows[0],
          domain_id: "66666666-6666-4666-8666-666666666666",
        },
      ],
      [{ ...base, extra: true }],
      [{ ...base, advocate_id: "not-an-id" }],
      [{ ...base, domain_id: "not-an-id" }],
      [{ ...base, phase: "provider_cleanup" }],
      [{ ...base, jobs_enqueued: -1 }],
      [{ ...validRows[1], jobs_enqueued: 2 }],
      [{ ...base, jobs_enqueued: "1" }],
      [{ ...base, cleanup_complete: true }],
      [{ ...validRows[0], jobs_enqueued: 1 }],
      [{ ...validRows[6], jobs_enqueued: 1 }],
      [{ ...validRows[6], cleanup_complete: false }],
      [{ ...validRows[7], jobs_enqueued: 1 }],
      [base, { ...base }],
    ]
    for (const result of invalidResults) {
      expect(() =>
        worker.parseArchivedAdvocateDomainCleanupSummary(result, 8),
      ).toThrow("Archived advocate domain cleanup result is invalid")
    }
  })

  test("forwards only the bounded batch, server coordinator, and deadline", async () => {
    const calls: unknown[][] = []
    const signal = new AbortController().signal
    const coordinatorId = `advocate-domain-lifecycle-coordinator:${WORKER_ID}`
    const summary = await worker.runArchivedAdvocateDomainCleanupWorker({
      batchSize: 8,
      rpcTimeoutMilliseconds: 4_000,
      coordinatorId,
      executor: executorDouble(async (...args) => {
        calls.push(args)
        return validRows
      }),
      timeoutSignal(milliseconds) {
        expect(milliseconds).toBe(4_000)
        return signal
      },
    })
    expect(summary.processedDomains).toBe(8)
    expect(calls).toEqual([[8, coordinatorId, signal]])
  })

  test("rejects unsafe coordinator identities before database access", async () => {
    let calls = 0
    for (const coordinatorId of [
      "",
      " leading-space",
      "line\nbreak",
      "x".repeat(129),
    ]) {
      await expect(
        worker.runArchivedAdvocateDomainCleanupWorker({
          batchSize: 25,
          rpcTimeoutMilliseconds: 45_000,
          coordinatorId,
          executor: executorDouble(async () => {
            calls += 1
            return []
          }),
        }),
      ).rejects.toThrow(
        "Archived advocate domain cleanup worker is unavailable",
      )
    }
    expect(calls).toBe(0)
  })
})

test.describe("archived advocate domain cleanup repository", () => {
  test("calls only the service coordinator RPC with its abort signal", async () => {
    const calls: unknown[] = []
    const signal = new AbortController().signal
    const coordinatorId = `advocate-domain-lifecycle-coordinator:${WORKER_ID}`
    const client = {
      rpc(name: string, args: unknown) {
        calls.push({ name, args })
        return {
          async abortSignal(receivedSignal: AbortSignal) {
            calls.push({ signal: receivedSignal })
            return { data: validRows, error: null }
          },
        }
      },
    }
    const executor =
      repository.createSupabaseArchivedAdvocateDomainCleanupRpcExecutor(
        client as never,
      )
    await expect(
      executor.coordinate(8, coordinatorId, signal),
    ).resolves.toEqual(validRows)
    expect(calls).toEqual([
      {
        name: "coordinate_archived_advocate_domain_deprovisioning",
        args: { batch_size: 8, coordinator_id: coordinatorId },
      },
      { signal },
    ])
  })

  test("collapses database detail to one fixed failure", async () => {
    const client = {
      rpc() {
        return {
          async abortSignal() {
            return {
              data: null,
              error: {
                message: "tenant, hostname, provider ID, and database detail",
              },
            }
          },
        }
      },
    }
    const executor =
      repository.createSupabaseArchivedAdvocateDomainCleanupRpcExecutor(
        client as never,
      )
    await expect(
      executor.coordinate(
        4,
        `advocate-domain-lifecycle-coordinator:${WORKER_ID}`,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Archived advocate domain cleanup RPC failed")
  })
})

test.describe("archived advocate domain cleanup route and schedule", () => {
  test("authenticates before constructing a service executor", async () => {
    let executorCalls = 0
    const response = await route.handleArchivedAdvocateDomainCleanupRequest(
      new Request(
        "https://creatorshare.com/api/internal/advocates/lifecycle-cleanup",
      ),
      {
        environment: { CRON_SECRET: SECRET },
        requestId: () => REQUEST_ID,
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
      requestId: REQUEST_ID,
      ...worker.emptyArchivedAdvocateDomainCleanupSummary(),
    })
    expect(executorCalls).toBe(0)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })

  test("is safely replayable throughout the server-owned quiescence interval", async () => {
    let calls = 0
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await route.handleArchivedAdvocateDomainCleanupRequest(
        authorizedRequest(),
        {
          environment: { CRON_SECRET: SECRET },
          requestId: () => REQUEST_ID,
          workerId: () => WORKER_ID,
          createExecutor: () =>
            executorDouble(async () => {
              calls += 1
              return [validRows[0]]
            }),
        },
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ok: true,
        requestId: REQUEST_ID,
        processedDomains: 1,
        jobsEnqueued: 0,
        quiescingDomains: 1,
        cloudflareDnsRemoval: 0,
        providerCleanup: 0,
        blockedDomains: 0,
      })
    }
    expect(calls).toBe(2)
  })

  test("returns only aggregate cleanup progress without row identities", async () => {
    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const response = await route.handleArchivedAdvocateDomainCleanupRequest(
        authorizedRequest(),
        {
          environment: {
            CRON_SECRET: SECRET,
            ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_BATCH_SIZE: "8",
          },
          requestId: () => REQUEST_ID,
          workerId: () => WORKER_ID,
          createExecutor: () => executorDouble(),
          timeoutSignal: () => new AbortController().signal,
        },
      )
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body).toEqual({
        ok: false,
        code: "worker_batch_requires_attention",
        requestId: REQUEST_ID,
        processedDomains: 8,
        jobsEnqueued: 3,
        quiescingDomains: 1,
        cloudflareDnsRemoval: 1,
        providerCleanup: 4,
        blockedDomains: 1,
      })
      const publicSurfaces = JSON.stringify({ body, errorCalls })
      expect(publicSurfaces).not.toContain(ADVOCATE_ID)
      for (const domainId of DOMAIN_IDS) {
        expect(publicSurfaces).not.toContain(domainId)
      }
    } finally {
      console.error = originalError
    }
  })

  test("redacts database and tenant detail from failures and logs", async () => {
    const sensitive = "secret-provider-id_for_private.example.com"
    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const response = await route.handleArchivedAdvocateDomainCleanupRequest(
        authorizedRequest(),
        {
          environment: { CRON_SECRET: SECRET },
          requestId: () => REQUEST_ID,
          workerId: () => WORKER_ID,
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
        ...worker.emptyArchivedAdvocateDomainCleanupSummary(),
      })
      expect(JSON.stringify({ body, errorCalls })).not.toContain(sensitive)
      expect(JSON.stringify({ body, errorCalls })).not.toContain(ADVOCATE_ID)
    } finally {
      console.error = originalError
    }
  })

  test("uses the service role, one minute recovery schedule, and no provider adapter", async () => {
    const routePath = resolve(
      process.cwd(),
      "src/app/api/internal/advocates/lifecycle-cleanup/route.ts",
    )
    const [
      routeSource,
      repositorySource,
      provisioningRouteSource,
      vercelSource,
      environmentSample,
    ] = await Promise.all([
      readFile(routePath, "utf8"),
      readFile(
        resolve(
          process.cwd(),
          "src/lib/advocates/lifecycleCleanup/repository.ts",
        ),
        "utf8",
      ),
      readFile(
        resolve(
          process.cwd(),
          "src/app/api/internal/advocates/provisioning/route.ts",
        ),
        "utf8",
      ),
      readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
      readFile(resolve(process.cwd(), "dotenv.sample"), "utf8"),
    ])

    expect(routeSource).toContain('export const runtime = "nodejs"')
    expect(routeSource).toContain("export const maxDuration = 60")
    expect(routeSource).toContain("createServiceRoleClient()")
    expect(repositorySource).toContain(
      '"coordinate_archived_advocate_domain_deprovisioning"',
    )
    expect(provisioningRouteSource).toContain("export const maxDuration = 60")
    const provisioningHandleSource = provisioningRouteSource.slice(
      provisioningRouteSource.indexOf("async function handle"),
    )
    expect(
      provisioningHandleSource.indexOf("performance.now()"),
    ).toBeGreaterThanOrEqual(0)
    expect(provisioningHandleSource.indexOf("performance.now()")).toBeLessThan(
      provisioningHandleSource.indexOf("loadWorkerRouteSecret()"),
    )
    expect(provisioningHandleSource).toContain("deadlineAtMilliseconds")
    expect(`${routeSource}\n${repositorySource}`).not.toMatch(
      /createDomainProviderAdapterFactory|cloudflare\.ts|vercel\.ts|paymentPaths/,
    )

    const vercel = JSON.parse(vercelSource) as {
      functions?: Record<string, unknown>
      crons?: Array<{ path?: unknown; schedule?: unknown }>
    }
    expect(
      vercel.functions?.[
        "src/app/api/internal/advocates/lifecycle-cleanup/route.ts"
      ],
    ).toEqual({ maxDuration: 60 })
    expect(
      vercel.functions?.[
        "src/app/api/internal/advocates/provisioning/route.ts"
      ],
    ).toEqual({ maxDuration: 60 })
    expect(
      vercel.crons?.filter(
        (entry) => entry.path === "/api/internal/advocates/lifecycle-cleanup",
      ),
    ).toEqual([
      {
        path: "/api/internal/advocates/lifecycle-cleanup",
        schedule: "* * * * *",
      },
    ])
    expect(environmentSample).toContain(
      "ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_BATCH_SIZE=25",
    )
    expect(environmentSample).toContain(
      "ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_RPC_TIMEOUT_MILLISECONDS=45000",
    )
  })
})
