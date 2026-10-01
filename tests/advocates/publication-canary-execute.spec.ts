import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  PublicationCanaryOperationDatabase,
  PublicationCanaryWorkerDatabase,
} from "../../src/lib/advocates/publicationCanary/database"
import type {
  PublicationCanaryOperationSnapshot,
  PublicationCanaryWorkerClaim,
} from "../../src/lib/advocates/publicationCanary/operation"
import type {
  PublicationCanaryRunnerDependencies,
  PublicationCanaryRunnerResult,
} from "../../src/lib/advocates/publicationCanary/runner"

type ExecuteModule =
  typeof import("../../src/lib/advocates/publicationCanary/execute")
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
  resolve(process.cwd(), "tests/advocates/publication-canary-execute.spec.ts"),
)
const {
  handlePublicationCanaryOperation,
  processNextPublicationCanaryExecution,
  PUBLICATION_CANARY_WORKER_LEASE_SECONDS,
} = testRequire(
  resolve(process.cwd(), "src/lib/advocates/publicationCanary/execute.ts"),
) as ExecuteModule

const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const DOMAIN_ID = "33333333-3333-4333-8333-333333333333"
const OPERATION_ID = "44444444-4444-4444-8444-444444444444"
const RUN_ID = "55555555-5555-4555-8555-555555555555"
const START_REQUEST_ID = "66666666-6666-4666-8666-666666666666"
const LEASE_TOKEN = "77777777-7777-4777-8777-777777777777"
const DEPLOYMENT_ID = "dpl_1234567890abcdef"
const REVISION = "a".repeat(40)
const REPORT_SHA256 = "b".repeat(64)
const STARTED_AT = "2026-07-18T18:00:00.000Z"
const COMPLETED_AT = "2026-07-18T18:02:00.000Z"

const request = Object.freeze({
  advocateId: ADVOCATE_ID,
  expectedVersion: 17,
  operationId: OPERATION_ID,
  adminReason: "Initial advocate publication after release review.",
  traceId: "publication-trace-1",
  deploymentId: DEPLOYMENT_ID,
  revision: REVISION,
  clientIp: "203.0.113.9",
  userAgent: "Publication test agent/1.0",
})

function operationSnapshot(
  overrides: Partial<PublicationCanaryOperationSnapshot> = {},
): PublicationCanaryOperationSnapshot {
  const outcome = overrides.outcome ?? null
  return {
    operationId: OPERATION_ID,
    runId: RUN_ID,
    advocateId: ADVOCATE_ID,
    expectedAdvocateVersion: 17,
    deploymentId: DEPLOYMENT_ID,
    revision: REVISION,
    startedAt: STARTED_AT,
    outcome,
    failureCode:
      outcome === "failed" ? "stripe_us_payment_canary_failed" : null,
    reportSha256: outcome === null ? null : REPORT_SHA256,
    completedAt: outcome === null ? null : COMPLETED_AT,
    publishedAdvocateVersion: null,
    created: false,
    ...overrides,
  }
}

function operationDatabase(
  snapshots:
    PublicationCanaryOperationSnapshot | PublicationCanaryOperationSnapshot[],
): PublicationCanaryOperationDatabase & {
  beginOrResumeInputs: unknown[]
  publishInputs: unknown[]
} {
  const beginOrResumeInputs: unknown[] = []
  const publishInputs: unknown[] = []
  const values = Array.isArray(snapshots) ? snapshots : [snapshots]
  let index = 0
  return {
    beginOrResumeInputs,
    publishInputs,
    async beginOrResume(input) {
      beginOrResumeInputs.push(input)
      const value = values[Math.min(index, values.length - 1)]
      index += 1
      if (value === undefined) throw new Error("Missing operation snapshot")
      return value
    },
    async publish(input) {
      publishInputs.push(input)
      return 18
    },
  }
}

function workerClaim(): PublicationCanaryWorkerClaim {
  return {
    runId: RUN_ID,
    advocateId: ADVOCATE_ID,
    domainId: DOMAIN_ID,
    hostname: "hope.creatorshare.com",
    expectedAdvocateVersion: 17,
    deploymentId: DEPLOYMENT_ID,
    revision: REVISION,
    paymentAttemptIds: {
      stripeUs: "80000000-0000-4000-8000-000000000001",
      stripeUk: "80000000-0000-4000-8000-000000000002",
      paypal: "80000000-0000-4000-8000-000000000003",
    },
    startedAt: STARTED_AT,
    startRequestId: START_REQUEST_ID,
    traceId: request.traceId,
    adminReason: request.adminReason,
    leaseToken: LEASE_TOKEN,
    leasedUntil: "2026-07-18T18:05:00.000Z",
  }
}

function runnerResult(
  outcome: "succeeded" | "failed",
): PublicationCanaryRunnerResult {
  return {
    canonicalReport: JSON.stringify({ outcome }),
    reportSha256: REPORT_SHA256,
    report: {
      outcome,
      error_code:
        outcome === "failed" ? "stripe_us_payment_canary_failed" : null,
      completed_at: COMPLETED_AT,
    },
  } as PublicationCanaryRunnerResult
}

test.describe("publication canary asynchronous execution", () => {
  test("returns a bounded pending retry and schedules same-deployment work", async () => {
    const database = operationDatabase(operationSnapshot({ created: true }))
    const result = await handlePublicationCanaryOperation(request, {
      database,
      now: () => Date.parse("2026-07-18T18:00:01.000Z"),
    })

    expect(result).toMatchObject({
      outcome: "pending",
      runId: RUN_ID,
      retryAfterSeconds: 2,
      workerKickoff: true,
    })
    expect(database.beginOrResumeInputs).toEqual([
      {
        operationId: OPERATION_ID,
        traceId: request.traceId,
        adminReason: request.adminReason,
        clientIp: request.clientIp,
        userAgent: request.userAgent,
        target: {
          advocateId: ADVOCATE_ID,
          expectedVersion: 17,
          deploymentId: DEPLOYMENT_ID,
          revision: REVISION,
        },
      },
    ])
    expect(database.publishInputs).toHaveLength(0)
  })

  test("retries pending same-deployment work without creating another identity", async () => {
    const database = operationDatabase(operationSnapshot())
    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T18:10:00.000Z"),
      }),
    ).resolves.toMatchObject({
      outcome: "pending",
      runId: RUN_ID,
      retryAfterSeconds: 2,
      workerKickoff: true,
    })
    expect(database.beginOrResumeInputs).toHaveLength(1)
    expect(database.beginOrResumeInputs[0]).toMatchObject({
      operationId: OPERATION_ID,
    })
    expect(database.publishInputs).toHaveLength(0)
  })

  test("keeps old-deployment work pending and reports a deployment change only after success", async () => {
    const oldDeploymentId = "dpl_old1234567890"
    const oldRevision = "c".repeat(40)
    const database = operationDatabase([
      operationSnapshot({
        deploymentId: oldDeploymentId,
        revision: oldRevision,
      }),
      operationSnapshot({
        deploymentId: oldDeploymentId,
        revision: oldRevision,
        outcome: "succeeded",
      }),
    ])

    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T18:05:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "pending",
      runId: RUN_ID,
      retryAfterSeconds: 2,
      workerKickoff: false,
    })

    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T18:06:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "deployment_changed",
      runId: RUN_ID,
    })
    expect(database.publishInputs).toHaveLength(0)
  })

  test("expires successful evidence at the same 30 minute boundary", async () => {
    const database = operationDatabase(
      operationSnapshot({ outcome: "succeeded" }),
    )
    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T18:30:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "expired",
      runId: RUN_ID,
    })
    expect(database.publishInputs).toHaveLength(0)
  })

  test("publishes only current-deployment immutable success and forwards forensic context", async () => {
    const database = operationDatabase(
      operationSnapshot({ outcome: "succeeded" }),
    )
    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T18:03:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "published",
      runId: RUN_ID,
      reportSha256: REPORT_SHA256,
      advocateVersion: 18,
    })
    expect(database.publishInputs).toHaveLength(1)
    expect(database.publishInputs[0]).toMatchObject({
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      expectedVersion: 17,
      runId: RUN_ID,
      deploymentId: DEPLOYMENT_ID,
      revision: REVISION,
      reportSha256: REPORT_SHA256,
      adminReason: request.adminReason,
      traceId: request.traceId,
      clientIp: request.clientIp,
      userAgent: request.userAgent,
    })
  })

  test("keeps a failed report terminal and never publishes it", async () => {
    const database = operationDatabase(operationSnapshot({ outcome: "failed" }))
    await expect(
      handlePublicationCanaryOperation(request, { database }),
    ).resolves.toEqual({
      outcome: "failed",
      runId: RUN_ID,
      reportSha256: REPORT_SHA256,
      failureCode: "stripe_us_payment_canary_failed",
    })
    expect(database.publishInputs).toHaveLength(0)
  })

  test("replays an immutable published result without publishing twice", async () => {
    const database = operationDatabase(
      operationSnapshot({
        outcome: "succeeded",
        publishedAdvocateVersion: 18,
        created: false,
      }),
    )

    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T19:30:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "published",
      runId: RUN_ID,
      reportSha256: REPORT_SHA256,
      advocateVersion: 18,
    })
    expect(database.beginOrResumeInputs).toHaveLength(1)
    expect(database.publishInputs).toHaveLength(0)
  })

  test("claims before running and completes with the exact fencing token", async () => {
    const calls: string[] = []
    const completionInputs: unknown[] = []
    const database: PublicationCanaryWorkerDatabase = {
      async claimNext(input) {
        calls.push("claim")
        expect(input).toEqual({
          deploymentId: DEPLOYMENT_ID,
          revision: REVISION,
          leaseSeconds: PUBLICATION_CANARY_WORKER_LEASE_SECONDS,
        })
        return workerClaim()
      },
      async completeClaimed(input) {
        calls.push("complete")
        completionInputs.push(input)
        return {
          runId: RUN_ID,
          outcome: "succeeded",
          reportSha256: REPORT_SHA256,
          completedAt: COMPLETED_AT,
        }
      },
    }
    const result = await processNextPublicationCanaryExecution(
      { deploymentId: DEPLOYMENT_ID, revision: REVISION },
      {
        database,
        runnerDependencies: {} as PublicationCanaryRunnerDependencies,
        async runCanary() {
          calls.push("runner")
          return runnerResult("succeeded")
        },
      },
    )

    expect(calls).toEqual(["claim", "runner", "complete"])
    expect(completionInputs[0]).toMatchObject({
      runId: RUN_ID,
      leaseToken: LEASE_TOKEN,
      traceId: request.traceId,
      adminReason: request.adminReason,
      outcome: "succeeded",
    })
    expect(result).toEqual({
      outcome: "succeeded",
      runId: RUN_ID,
      reportSha256: REPORT_SHA256,
    })
  })

  test("does no network work when the durable queue is idle", async () => {
    let runnerCalled = false
    await expect(
      processNextPublicationCanaryExecution(
        { deploymentId: DEPLOYMENT_ID, revision: REVISION },
        {
          database: {
            async claimNext() {
              return undefined
            },
            async completeClaimed() {
              throw new Error("unexpected completion")
            },
          },
          runnerDependencies: {} as PublicationCanaryRunnerDependencies,
          async runCanary() {
            runnerCalled = true
            return runnerResult("succeeded")
          },
        },
      ),
    ).resolves.toEqual({ outcome: "idle" })
    expect(runnerCalled).toBe(false)
  })

  test("records a terminal runner failure but retries thrown infrastructure work", async () => {
    const claim = workerClaim()
    let completions = 0
    const database: PublicationCanaryWorkerDatabase = {
      async claimNext() {
        return claim
      },
      async completeClaimed(input) {
        completions += 1
        return {
          runId: RUN_ID,
          outcome: input.outcome,
          reportSha256: input.reportSha256,
          completedAt: input.completedAt,
        }
      },
    }
    await expect(
      processNextPublicationCanaryExecution(
        { deploymentId: DEPLOYMENT_ID, revision: REVISION },
        {
          database,
          runnerDependencies: {} as PublicationCanaryRunnerDependencies,
          async runCanary() {
            return runnerResult("failed")
          },
        },
      ),
    ).resolves.toMatchObject({
      outcome: "failed",
      failureCode: "stripe_us_payment_canary_failed",
    })
    expect(completions).toBe(1)

    await expect(
      processNextPublicationCanaryExecution(
        { deploymentId: DEPLOYMENT_ID, revision: REVISION },
        {
          database,
          runnerDependencies: {} as PublicationCanaryRunnerDependencies,
          async runCanary() {
            throw new Error("provider transport unavailable")
          },
        },
      ),
    ).rejects.toThrow("provider transport unavailable")
    expect(completions).toBe(1)
  })
})
