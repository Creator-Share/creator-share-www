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
  resolve(process.cwd(), "tests/advocates/logo-reconciliation-worker.spec.ts"),
)
const auth = testRequire(
  "../../src/lib/advocates/logoReconciliation/auth",
) as typeof import("../../src/lib/advocates/logoReconciliation/auth")
const boundedFetch = testRequire(
  "../../src/lib/advocates/logoReconciliation/boundedFetch",
) as typeof import("../../src/lib/advocates/logoReconciliation/boundedFetch")
const config = testRequire(
  "../../src/lib/advocates/logoReconciliation/config",
) as typeof import("../../src/lib/advocates/logoReconciliation/config")
const repository = testRequire(
  "../../src/lib/advocates/logoReconciliation/repository",
) as typeof import("../../src/lib/advocates/logoReconciliation/repository")
const route = testRequire(
  "../../src/lib/advocates/logoReconciliation/route",
) as typeof import("../../src/lib/advocates/logoReconciliation/route")
const serviceClient = testRequire(
  "../../src/lib/advocates/logoReconciliation/serviceClient",
) as typeof import("../../src/lib/advocates/logoReconciliation/serviceClient")
const storage = testRequire(
  "../../src/lib/advocates/logoReconciliation/storage",
) as typeof import("../../src/lib/advocates/logoReconciliation/storage")
const worker = testRequire(
  "../../src/lib/advocates/logoReconciliation/worker",
) as typeof import("../../src/lib/advocates/logoReconciliation/worker")
nodeModule._load = originalModuleLoad

type AdvocateLogoReconciliationRepository =
  import("../../src/lib/advocates/logoReconciliation/repository").AdvocateLogoReconciliationRepository
type AdvocateLogoReconciliationStorage =
  import("../../src/lib/advocates/logoReconciliation/storage").AdvocateLogoReconciliationStorage
const SECRET = "r".repeat(48)
const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const WORKER_ID = "22222222-2222-4222-8222-222222222222"
const JOB_ID = "33333333-3333-4333-8333-333333333333"
const RESERVATION_ID = "44444444-4444-4444-8444-444444444444"
const ADVOCATE_ID = "55555555-5555-4555-8555-555555555555"
const LEASE_TOKEN = "a".repeat(64)
const OBJECT_PATH = `logos/hope/${RESERVATION_ID}.webp`
const NOW = Date.parse("2026-07-18T12:00:00.000Z")
const workerConfig = {
  batchSize: 4,
  concurrency: 2,
  storageTimeoutMilliseconds: 15_000,
  invocationSafetyMarginMilliseconds: 5_000,
}
const context = { requestId: REQUEST_ID, traceId: "trace-safe" }

function claimedJob(overrides: Record<string, unknown> = {}) {
  return {
    job_id: JOB_ID,
    reservation_id: RESERVATION_ID,
    advocate_id: ADVOCATE_ID,
    object_path: OBJECT_PATH,
    lease_token: LEASE_TOKEN,
    lease_expires_at: "2026-07-18T12:05:00.000Z",
    attempt_count: 1,
    maximum_attempts: 8,
    ...overrides,
  }
}

const parsedJob = {
  jobId: JOB_ID,
  reservationId: RESERVATION_ID,
  advocateId: ADVOCATE_ID,
  objectPath: OBJECT_PATH,
  leaseToken: LEASE_TOKEN,
  leaseExpiresAt: "2026-07-18T12:05:00.000Z",
  attemptCount: 1,
  maximumAttempts: 8,
}

function repositoryDouble(
  overrides: Partial<AdvocateLogoReconciliationRepository> = {},
): AdvocateLogoReconciliationRepository {
  return {
    async claimJobs() {
      return [parsedJob]
    },
    async authorizeDeletion() {
      return { outcome: "delete", objectPath: OBJECT_PATH }
    },
    async complete() {
      return "completed"
    },
    async fail() {
      return {
        status: "retry_scheduled",
        nextAttemptAt: "2026-07-18T12:05:00.000Z",
      }
    },
    ...overrides,
  }
}

function storageDouble(
  outcome: "deleted" | "already_absent" = "deleted",
): AdvocateLogoReconciliationStorage {
  return {
    async deleteObject() {
      return outcome
    },
  }
}

async function runBatch(options: {
  repository?: AdvocateLogoReconciliationRepository
  storage?: AdvocateLogoReconciliationStorage
  now?: () => number
  invocationDeadlineAt?: number
}) {
  return worker.runAdvocateLogoReconciliationBatch({
    config: workerConfig,
    workerId: `advocate-logo-reconciliation:${WORKER_ID}`,
    context,
    invocationDeadlineAt: options.invocationDeadlineAt ?? NOW + 60_000,
    dependencies: {
      repository: options.repository ?? repositoryDouble(),
      storage: options.storage ?? storageDouble(),
      now: options.now ?? (() => NOW),
    },
  })
}

function authorizedRequest() {
  return new Request(
    "https://creatorshare.com/api/internal/advocates/logo-reconciliation",
    {
      headers: {
        authorization: `Bearer ${SECRET}`,
        "x-trace-id": "trace-safe",
      },
    },
  )
}

test.describe.configure({ mode: "serial" })

test.describe("advocate logo reconciliation authentication and configuration", () => {
  test("uses constant-time bearer validation and the dedicated secret with cron fallback", () => {
    expect(
      auth.isAuthorizedAdvocateLogoReconciliationWorkerRequest(
        `Bearer ${SECRET}`,
        SECRET,
      ),
    ).toBe(true)
    for (const header of [
      null,
      SECRET,
      `Basic ${SECRET}`,
      `Bearer ${SECRET} `,
      `Bearer ${"x".repeat(48)}`,
    ]) {
      expect(
        auth.isAuthorizedAdvocateLogoReconciliationWorkerRequest(
          header,
          SECRET,
        ),
      ).toBe(false)
    }

    expect(
      auth.loadAdvocateLogoReconciliationWorkerSecret({
        CRON_SECRET: SECRET,
      }),
    ).toBe(SECRET)
    expect(
      auth.loadAdvocateLogoReconciliationWorkerSecret({
        CRON_SECRET: SECRET,
        ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET: "d".repeat(48),
      }),
    ).toBe("d".repeat(48))
    expect(() =>
      auth.loadAdvocateLogoReconciliationWorkerSecret({
        CRON_SECRET: SECRET,
        ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET: " ".repeat(48),
      }),
    ).toThrow("Advocate logo reconciliation worker is unavailable")
  })

  test("enforces batch, concurrency, timeout, margin, and full invocation bounds", () => {
    expect(config.loadAdvocateLogoReconciliationWorkerConfig({})).toEqual(
      workerConfig,
    )
    expect(
      config.loadAdvocateLogoReconciliationWorkerConfig({
        ADVOCATE_LOGO_RECONCILIATION_BATCH_SIZE: "1",
        ADVOCATE_LOGO_RECONCILIATION_CONCURRENCY: "1",
        ADVOCATE_LOGO_RECONCILIATION_STORAGE_TIMEOUT_MILLISECONDS: "30000",
        ADVOCATE_LOGO_RECONCILIATION_INVOCATION_SAFETY_MARGIN_MILLISECONDS:
          "15000",
      }),
    ).toEqual({
      batchSize: 1,
      concurrency: 1,
      storageTimeoutMilliseconds: 30_000,
      invocationSafetyMarginMilliseconds: 15_000,
    })

    for (const environment of [
      { ADVOCATE_LOGO_RECONCILIATION_BATCH_SIZE: "0" },
      { ADVOCATE_LOGO_RECONCILIATION_BATCH_SIZE: "21" },
      {
        ADVOCATE_LOGO_RECONCILIATION_BATCH_SIZE: "2",
        ADVOCATE_LOGO_RECONCILIATION_CONCURRENCY: "3",
      },
      { ADVOCATE_LOGO_RECONCILIATION_CONCURRENCY: "5" },
      {
        ADVOCATE_LOGO_RECONCILIATION_STORAGE_TIMEOUT_MILLISECONDS: "999",
      },
      {
        ADVOCATE_LOGO_RECONCILIATION_STORAGE_TIMEOUT_MILLISECONDS: "30000",
        ADVOCATE_LOGO_RECONCILIATION_INVOCATION_SAFETY_MARGIN_MILLISECONDS:
          "15001",
      },
      {
        ADVOCATE_LOGO_RECONCILIATION_STORAGE_TIMEOUT_MILLISECONDS: "30000",
        ADVOCATE_LOGO_RECONCILIATION_INVOCATION_SAFETY_MARGIN_MILLISECONDS:
          "30000",
      },
    ]) {
      expect(() =>
        config.loadAdvocateLogoReconciliationWorkerConfig(environment),
      ).toThrow("Advocate logo reconciliation worker is unavailable")
    }
  })

  test("fails closed on malformed service client environment", () => {
    for (const environment of [
      {
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_SERVICE_ROLE_KEY: "k".repeat(48),
      },
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@example.test",
        NEXT_SERVICE_ROLE_KEY: "k".repeat(48),
      },
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test",
        NEXT_SERVICE_ROLE_KEY: ` ${"k".repeat(48)}`,
      },
    ]) {
      expect(() =>
        serviceClient.createAdvocateLogoReconciliationServiceClient({
          requestTimeoutMilliseconds: 15_000,
          invocationDeadlineAt: NOW + 55_000,
          environment,
        }),
      ).toThrow("Advocate logo reconciliation worker is unavailable")
    }

    expect(
      serviceClient.createAdvocateLogoReconciliationServiceClient({
        requestTimeoutMilliseconds: 15_000,
        invocationDeadlineAt: NOW + 55_000,
        now: () => NOW,
        environment: {
          NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test",
          NEXT_SERVICE_ROLE_KEY: "k".repeat(48),
        },
        fetchImplementation: async () => new Response(null, { status: 204 }),
      }),
    ).toBeTruthy()
  })
})

test.describe("advocate logo reconciliation database contracts", () => {
  test("accepts only exact claim rows and rejects smuggled or inconsistent values", () => {
    expect(
      repository.parseClaimedAdvocateLogoReconciliationJobs([claimedJob()], 4),
    ).toEqual([parsedJob])

    for (const value of [
      [claimedJob({ smuggled: "value" })],
      [claimedJob({ lease_token: JOB_ID })],
      [claimedJob({ maximum_attempts: 7 })],
      [claimedJob({ attempt_count: 9 })],
      [claimedJob({ object_path: `logos/hope/${JOB_ID}.webp` })],
      [claimedJob(), claimedJob()],
      Array.from({ length: 5 }, () => claimedJob()),
    ]) {
      expect(
        repository.parseClaimedAdvocateLogoReconciliationJobs(value, 4),
      ).toBeNull()
    }
  })

  test("parses authorization, completion, and failure rows exactly", () => {
    expect(
      repository.parseAdvocateLogoReconciliationAuthorization(
        [{ outcome: "delete", object_path: OBJECT_PATH }],
        OBJECT_PATH,
      ),
    ).toEqual({ outcome: "delete", objectPath: OBJECT_PATH })
    for (const outcome of [
      "already_absent",
      "quarantined",
      "lease_lost",
    ] as const) {
      expect(
        repository.parseAdvocateLogoReconciliationAuthorization(
          [{ outcome, object_path: null }],
          OBJECT_PATH,
        ),
      ).toEqual({ outcome, objectPath: null })
    }
    expect(
      repository.parseAdvocateLogoReconciliationAuthorization(
        [{ outcome: "delete", object_path: `logos/hope/${JOB_ID}.webp` }],
        OBJECT_PATH,
      ),
    ).toBeNull()
    expect(
      repository.parseAdvocateLogoReconciliationAuthorization(
        [{ outcome: "delete", object_path: OBJECT_PATH, smuggled: true }],
        OBJECT_PATH,
      ),
    ).toBeNull()

    expect(
      repository.parseAdvocateLogoReconciliationCompletion("completed"),
    ).toBe("completed")
    expect(
      repository.parseAdvocateLogoReconciliationCompletion("quarantined"),
    ).toBe("quarantined")
    expect(
      repository.parseAdvocateLogoReconciliationCompletion(["completed"]),
    ).toBeNull()

    expect(
      repository.parseAdvocateLogoReconciliationFailureResult([
        {
          status: "retry_scheduled",
          next_attempt_at: "2026-07-18T12:05:00.000Z",
        },
      ]),
    ).toEqual({
      status: "retry_scheduled",
      nextAttemptAt: "2026-07-18T12:05:00.000Z",
    })
    expect(
      repository.parseAdvocateLogoReconciliationFailureResult([
        { status: "exhausted", next_attempt_at: null },
      ]),
    ).toEqual({ status: "exhausted", nextAttemptAt: null })
    expect(
      repository.parseAdvocateLogoReconciliationFailureResult([
        { status: "exhausted", next_attempt_at: null, path: OBJECT_PATH },
      ]),
    ).toBeNull()
  })

  test("calls only the fixed service RPC names and argument shapes", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const data = [
      [claimedJob()],
      [{ outcome: "delete", object_path: OBJECT_PATH }],
      "completed",
      [
        {
          status: "retry_scheduled",
          next_attempt_at: "2026-07-18T12:05:00.000Z",
        },
      ],
    ]
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return { data: data.shift(), error: null }
      },
    }
    const rpcRepository =
      repository.createSupabaseAdvocateLogoReconciliationRepository(
        client as never,
      )
    const jobs = await rpcRepository.claimJobs({
      workerId: `advocate-logo-reconciliation:${WORKER_ID}`,
      batchSize: 4,
      context,
    })
    await rpcRepository.authorizeDeletion(jobs[0], context)
    await rpcRepository.complete(jobs[0], "deleted", context)
    await rpcRepository.fail(jobs[0], "storage_delete_failed", context)

    expect(calls).toEqual([
      {
        name: "claim_advocate_logo_reconciliation_jobs",
        args: {
          worker_id: `advocate-logo-reconciliation:${WORKER_ID}`,
          batch_size: 4,
          request_id: REQUEST_ID,
          trace_id: "trace-safe",
        },
      },
      {
        name: "authorize_advocate_logo_reconciliation_deletion",
        args: {
          target_job_id: JOB_ID,
          lease_token: LEASE_TOKEN,
          request_id: REQUEST_ID,
          trace_id: "trace-safe",
        },
      },
      {
        name: "complete_advocate_logo_reconciliation_job",
        args: {
          target_job_id: JOB_ID,
          lease_token: LEASE_TOKEN,
          target_outcome: "deleted",
          request_id: REQUEST_ID,
          trace_id: "trace-safe",
        },
      },
      {
        name: "fail_advocate_logo_reconciliation_job",
        args: {
          target_job_id: JOB_ID,
          lease_token: LEASE_TOKEN,
          failure_code: "storage_delete_failed",
          request_id: REQUEST_ID,
          trace_id: "trace-safe",
        },
      },
    ])
  })
})

test.describe("advocate logo reconciliation provider boundary", () => {
  test("deletes only the exact authorized path from the fixed bucket", async () => {
    const calls: unknown[][] = []
    const storageBoundary =
      storage.createSupabaseAdvocateLogoReconciliationStorage({
        storage: {
          from(bucket) {
            calls.push(["bucket", bucket])
            return {
              async remove(paths) {
                calls.push(["remove", paths])
                return {
                  data: [{ name: OBJECT_PATH }],
                  error: null,
                }
              },
            }
          },
        },
      })

    await expect(storageBoundary.deleteObject(OBJECT_PATH)).resolves.toBe(
      "deleted",
    )
    expect(calls).toEqual([
      ["bucket", "advocate-assets"],
      ["remove", [OBJECT_PATH]],
    ])
    await expect(
      storageBoundary.deleteObject(`logos/hope/${JOB_ID}.png`),
    ).rejects.toMatchObject({
      message: "advocate_logo_reconciliation_storage_failed",
      failureCode: "unexpected_storage_response",
    })
  })

  test("treats missing Storage objects as idempotent absence", async () => {
    const storageBoundary =
      storage.createSupabaseAdvocateLogoReconciliationStorage({
        storage: {
          from() {
            return {
              async remove() {
                return {
                  data: null,
                  error: {
                    status: 404,
                    statusCode: "404",
                    message: `provider-body:${OBJECT_PATH}`,
                  },
                }
              },
            }
          },
        },
      })
    await expect(storageBoundary.deleteObject(OBJECT_PATH)).resolves.toBe(
      "already_absent",
    )
  })

  test("accepts the documented empty successful remove response as deleted", async () => {
    const storageBoundary =
      storage.createSupabaseAdvocateLogoReconciliationStorage({
        storage: {
          from() {
            return {
              async remove() {
                return { data: [], error: null }
              },
            }
          },
        },
      })
    await expect(storageBoundary.deleteObject(OBJECT_PATH)).resolves.toBe(
      "deleted",
    )
  })

  test("maps provider failures to the fixed database allowlist", async () => {
    for (const [providerError, expectedCode] of [
      [new DOMException("timeout body", "AbortError"), "storage_timeout"],
      [{ status: 408, message: "timeout body" }, "storage_timeout"],
      [
        { originalError: new DOMException("nested timeout", "AbortError") },
        "storage_timeout",
      ],
      [{ status: 429, message: "rate body" }, "storage_rate_limited"],
      [{ statusCode: "503", message: "outage body" }, "storage_unavailable"],
      [
        { originalError: new TypeError("nested network body") },
        "storage_unavailable",
      ],
      [{ status: 403, message: "denied body" }, "storage_delete_failed"],
    ] as const) {
      const storageBoundary =
        storage.createSupabaseAdvocateLogoReconciliationStorage({
          storage: {
            from() {
              return {
                async remove() {
                  return { data: null, error: providerError }
                },
              }
            },
          },
        })
      await expect(
        storageBoundary.deleteObject(OBJECT_PATH),
      ).rejects.toMatchObject({
        message: "advocate_logo_reconciliation_storage_failed",
        failureCode: expectedCode,
      })
    }

    const malformed = storage.createSupabaseAdvocateLogoReconciliationStorage({
      storage: {
        from() {
          return {
            async remove() {
              return { data: { message: "not an array" }, error: null }
            },
          }
        },
      },
    })
    await expect(malformed.deleteObject(OBJECT_PATH)).rejects.toMatchObject({
      failureCode: "unexpected_storage_response",
    })

    const smuggled = storage.createSupabaseAdvocateLogoReconciliationStorage({
      storage: {
        from() {
          return {
            async remove() {
              return { data: [], error: null, objectPath: OBJECT_PATH }
            },
          }
        },
      },
    })
    await expect(smuggled.deleteObject(OBJECT_PATH)).rejects.toMatchObject({
      failureCode: "unexpected_storage_response",
    })
  })

  test("aborts the real provider fetch at the lesser remaining deadline", async () => {
    let observedSignal: AbortSignal | undefined
    const fetcher = boundedFetch.createBoundedAdvocateLogoReconciliationFetch({
      requestTimeoutMilliseconds: 1_000,
      invocationDeadlineAt: NOW + 10,
      now: () => NOW + 5,
      fetchImplementation: async (_input, init) => {
        observedSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          )
        })
      },
    })

    await expect(
      fetcher("https://storage.example.test/delete"),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(observedSignal?.aborted).toBe(true)
  })
})

test.describe("advocate logo reconciliation worker execution", () => {
  test("authorizes immediately before deleting and completes only afterward", async () => {
    const events: string[] = []
    const counts = await runBatch({
      repository: repositoryDouble({
        async authorizeDeletion() {
          events.push("authorize")
          return { outcome: "delete", objectPath: OBJECT_PATH }
        },
        async complete(_job, outcome) {
          events.push(`complete:${outcome}`)
          return "completed"
        },
      }),
      storage: {
        async deleteObject(path) {
          events.push(`delete:${path}`)
          return "deleted"
        },
      },
    })

    expect(events).toEqual([
      "authorize",
      `delete:${OBJECT_PATH}`,
      "complete:deleted",
    ])
    expect(counts).toEqual({
      claimed: 1,
      deleted: 1,
      alreadyAbsent: 0,
      retried: 0,
      exhausted: 0,
      quarantined: 0,
      leaseLost: 0,
      settlementUnknown: 0,
    })
  })

  test("completes provider absence idempotently", async () => {
    const outcomes: string[] = []
    const counts = await runBatch({
      repository: repositoryDouble({
        async complete(_job, outcome) {
          outcomes.push(outcome)
          return "completed"
        },
      }),
      storage: storageDouble("already_absent"),
    })
    expect(outcomes).toEqual(["already_absent"])
    expect(counts.alreadyAbsent).toBe(1)
  })

  test("completes database-observed absence without calling Storage", async () => {
    let storageCalls = 0
    const outcomes: string[] = []
    const counts = await runBatch({
      repository: repositoryDouble({
        async authorizeDeletion() {
          return { outcome: "already_absent", objectPath: null }
        },
        async complete(_job, outcome) {
          outcomes.push(outcome)
          return "completed"
        },
      }),
      storage: {
        async deleteObject() {
          storageCalls += 1
          return "deleted"
        },
      },
    })
    expect(storageCalls).toBe(0)
    expect(outcomes).toEqual(["already_absent"])
    expect(counts.alreadyAbsent).toBe(1)
  })

  test("retries provider failures with their allowlisted static failure code", async () => {
    for (const [providerError, expectedCode] of [
      [
        new storage.AdvocateLogoReconciliationStorageError(
          "storage_delete_failed",
        ),
        "storage_delete_failed",
      ],
      [
        new storage.AdvocateLogoReconciliationStorageError("storage_timeout"),
        "storage_timeout",
      ],
    ] as const) {
      const failureCodes: string[] = []
      const counts = await runBatch({
        repository: repositoryDouble({
          async fail(_job, failureCode) {
            failureCodes.push(failureCode)
            return {
              status: "retry_scheduled",
              nextAttemptAt: "2026-07-18T12:05:00.000Z",
            }
          },
        }),
        storage: {
          async deleteObject() {
            throw providerError
          },
        },
      })
      expect(failureCodes).toEqual([expectedCode])
      expect(counts.retried).toBe(1)
      expect(counts.settlementUnknown).toBe(0)
    }
  })

  test("maps stale leases and quarantine outcomes without touching Storage", async () => {
    for (const outcome of ["lease_lost", "quarantined"] as const) {
      let storageCalls = 0
      const counts = await runBatch({
        repository: repositoryDouble({
          async authorizeDeletion() {
            return { outcome, objectPath: null }
          },
        }),
        storage: {
          async deleteObject() {
            storageCalls += 1
            return "deleted"
          },
        },
      })
      expect(storageCalls).toBe(0)
      expect(
        counts[outcome === "lease_lost" ? "leaseLost" : "quarantined"],
      ).toBe(1)
    }
  })

  test("counts a completion quarantine and unknown finalization separately", async () => {
    const quarantined = await runBatch({
      repository: repositoryDouble({
        async complete() {
          return "quarantined"
        },
      }),
    })
    expect(quarantined.quarantined).toBe(1)
    expect(quarantined.deleted).toBe(0)

    const unknown = await runBatch({
      repository: repositoryDouble({
        async complete() {
          throw new Error(`database-body:${LEASE_TOKEN}`)
        },
      }),
    })
    expect(unknown.settlementUnknown).toBe(1)
    expect(unknown.deleted).toBe(0)
  })

  test("settles an invocation deadline as a durable interruption", async () => {
    const failureCodes: string[] = []
    let authorizationCalls = 0
    const counts = await runBatch({
      invocationDeadlineAt: NOW + 14_999,
      repository: repositoryDouble({
        async authorizeDeletion() {
          authorizationCalls += 1
          return { outcome: "delete", objectPath: OBJECT_PATH }
        },
        async fail(_job, failureCode) {
          failureCodes.push(failureCode)
          return { status: "exhausted", nextAttemptAt: null }
        },
      }),
    })
    expect(authorizationCalls).toBe(0)
    expect(failureCodes).toEqual(["worker_interrupted"])
    expect(counts.exhausted).toBe(1)
  })

  test("bounds parallel Storage work to configured concurrency", async () => {
    const jobs = Array.from({ length: 4 }, (_, index) => ({
      ...parsedJob,
      jobId: `${index + 6}6666666-6666-4666-8666-666666666666`,
      reservationId: `${index + 6}7777777-7777-4777-8777-777777777777`,
      objectPath: `logos/hope/${index + 6}7777777-7777-4777-8777-777777777777.webp`,
      leaseToken: String(index + 1).repeat(64),
    }))
    let active = 0
    let maximumActive = 0
    const counts = await runBatch({
      repository: repositoryDouble({
        async claimJobs() {
          return jobs
        },
        async authorizeDeletion(job) {
          return { outcome: "delete", objectPath: job.objectPath }
        },
      }),
      storage: {
        async deleteObject() {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 2))
          active -= 1
          return "deleted"
        },
      },
    })
    expect(counts.deleted).toBe(4)
    expect(maximumActive).toBe(2)
  })
})

test.describe("advocate logo reconciliation route", () => {
  test("returns only safe fields and keeps retries healthy", async () => {
    let observedWorkDeadline = 0
    const response = await route.handleAdvocateLogoReconciliationRequest(
      authorizedRequest(),
      {
        environment: {
          ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET: SECRET,
        },
        now: () => NOW,
        requestId: () => REQUEST_ID,
        workerId: () => WORKER_ID,
        createWorkerDependencies({ invocationDeadlineAt }) {
          observedWorkDeadline = invocationDeadlineAt
          return {
            repository: repositoryDouble({
              async authorizeDeletion() {
                return { outcome: "delete", objectPath: OBJECT_PATH }
              },
              async fail() {
                return {
                  status: "retry_scheduled",
                  nextAttemptAt: "2026-07-18T12:05:00.000Z",
                }
              },
            }),
            storage: {
              async deleteObject() {
                throw new Error(`provider-secret:${OBJECT_PATH}:${LEASE_TOKEN}`)
              },
            },
            now: () => NOW,
          }
        },
      },
    )
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(
      [
        "ok",
        "requestId",
        "claimed",
        "deleted",
        "alreadyAbsent",
        "retried",
        "exhausted",
        "quarantined",
        "leaseLost",
        "settlementUnknown",
      ].sort(),
    )
    expect(body).toMatchObject({ ok: true, retried: 1 })
    expect(observedWorkDeadline).toBe(NOW + 55_000)
    expect(JSON.stringify(body)).not.toContain(OBJECT_PATH)
    expect(JSON.stringify(body)).not.toContain(LEASE_TOKEN)
    expect(JSON.stringify(body)).not.toContain(JOB_ID)
  })

  test("returns 503 for quarantine without leaking sensitive values", async () => {
    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const response = await route.handleAdvocateLogoReconciliationRequest(
        authorizedRequest(),
        {
          environment: {
            ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET: SECRET,
          },
          now: () => NOW,
          requestId: () => REQUEST_ID,
          workerId: () => WORKER_ID,
          createWorkerDependencies() {
            return {
              repository: repositoryDouble({
                async authorizeDeletion() {
                  return { outcome: "quarantined", objectPath: null }
                },
              }),
              storage: storageDouble(),
              now: () => NOW,
            }
          },
        },
      )
      const body = await response.json()
      expect(response.status).toBe(503)
      expect(body).toMatchObject({
        ok: false,
        code: "worker_batch_requires_attention",
        quarantined: 1,
      })
      const rendered = JSON.stringify({ body, errorCalls })
      expect(rendered).not.toContain(OBJECT_PATH)
      expect(rendered).not.toContain(LEASE_TOKEN)
      expect(rendered).not.toContain(JOB_ID)
      expect(rendered).not.toContain("provider-body")
    } finally {
      console.error = originalError
    }
  })

  test("keeps execution failures and unauthorized responses aggregate only", async () => {
    const sharedDependencies = {
      environment: {
        ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET: SECRET,
      },
      now: () => NOW,
      requestId: () => REQUEST_ID,
      workerId: () => WORKER_ID,
      createWorkerDependencies() {
        throw new Error(`provider-body:${OBJECT_PATH}:${LEASE_TOKEN}:${JOB_ID}`)
      },
    }
    const unauthorized = await route.handleAdvocateLogoReconciliationRequest(
      new Request(
        "https://creatorshare.com/api/internal/advocates/logo-reconciliation",
      ),
      sharedDependencies,
    )
    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).toMatchObject({
      ok: false,
      code: "unauthorized",
      requestId: REQUEST_ID,
      claimed: 0,
    })

    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const failed = await route.handleAdvocateLogoReconciliationRequest(
        authorizedRequest(),
        sharedDependencies,
      )
      expect(failed.status).toBe(503)
      const body = await failed.json()
      expect(body).toMatchObject({
        ok: false,
        code: "worker_execution_failed",
        requestId: REQUEST_ID,
        claimed: 0,
      })
      const rendered = JSON.stringify({ body, errorCalls })
      for (const sensitive of [
        OBJECT_PATH,
        LEASE_TOKEN,
        JOB_ID,
        "provider-body",
      ]) {
        expect(rendered).not.toContain(sensitive)
      }
    } finally {
      console.error = originalError
    }
  })

  test("declares and schedules the sixty second Node route exactly", async () => {
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/logo-reconciliation/route.ts",
      ),
      "utf8",
    )
    expect(source).toContain('export const runtime = "nodejs"')
    expect(source).toContain("export const maxDuration = 60")

    const vercelConfiguration = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      functions?: Record<string, unknown>
      crons?: Array<{ path?: unknown; schedule?: unknown }>
    }
    expect(
      vercelConfiguration.functions?.[
        "src/app/api/internal/advocates/logo-reconciliation/route.ts"
      ],
    ).toEqual({ maxDuration: 60 })
    expect(
      vercelConfiguration.crons?.filter(
        (entry) => entry.path === "/api/internal/advocates/logo-reconciliation",
      ),
    ).toEqual([
      {
        path: "/api/internal/advocates/logo-reconciliation",
        schedule: "* * * * *",
      },
    ])
  })
})
