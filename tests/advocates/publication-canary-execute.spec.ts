import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  PublicationCanaryOperationDatabase,
  PublicationCanaryWorkerDatabase,
} from "../../src/lib/advocates/publicationCanary/database"
import type {
  PublicationCanaryExecution,
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
  resolve(
    process.cwd(),
    "src/lib/advocates/publicationCanary/execute.ts",
  ),
) as ExecuteModule

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
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
  actorUserId: ACTOR_ID,
  advocateId: ADVOCATE_ID,
  expectedVersion: 17,
  operationId: OPERATION_ID,
  adminReason: "Initial advocate publication after release review.",
  traceId: "publication-trace-1",
  deploymentId: DEPLOYMENT_ID,
  revision: REVISION,
})

function execution(
  outcome: PublicationCanaryExecution["outcome"] = null,
): PublicationCanaryExecution {
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
    outcome,
    failureCode:
      outcome === "failed" ? "stripe_us_payment_canary_failed" : null,
    reportSha256: outcome === null ? null : REPORT_SHA256,
    completedAt: outcome === null ? null : COMPLETED_AT,
  }
}

function operationDatabase(
  loaded: PublicationCanaryExecution | undefined,
): PublicationCanaryOperationDatabase & {
  beginInputs: unknown[]
  publishInputs: unknown[]
} {
  const beginInputs: unknown[] = []
  const publishInputs: unknown[] = []
  return {
    beginInputs,
    publishInputs,
    async loadExecution() {
      return loaded
    },
    async begin(input) {
      beginInputs.push(input)
      const value = execution()
      return {
        runId: value.runId,
        advocateId: value.advocateId,
        domainId: value.domainId,
        hostname: value.hostname,
        expectedAdvocateVersion: value.expectedAdvocateVersion,
        deploymentId: value.deploymentId,
        revision: value.revision,
        paymentAttemptIds: value.paymentAttemptIds,
        startedAt: value.startedAt,
      }
    },
    async publish(input) {
      publishInputs.push(input)
      return 18
    },
  }
}

function workerClaim(): PublicationCanaryWorkerClaim {
  const value = execution()
  return {
    runId: value.runId,
    advocateId: value.advocateId,
    domainId: value.domainId,
    hostname: value.hostname,
    expectedAdvocateVersion: value.expectedAdvocateVersion,
    deploymentId: value.deploymentId,
    revision: value.revision,
    paymentAttemptIds: value.paymentAttemptIds,
    startedAt: value.startedAt,
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
  test("starts once and returns before any network runner executes", async () => {
    const database = operationDatabase(undefined)
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
    expect(database.beginInputs).toHaveLength(1)
    expect(database.publishInputs).toHaveLength(0)
  })

  test("polls existing work without scheduling another immediate worker", async () => {
    const database = operationDatabase(execution())
    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T18:10:00.000Z"),
      }),
    ).resolves.toMatchObject({
      outcome: "pending",
      workerKickoff: false,
    })
    expect(database.beginInputs).toHaveLength(0)
  })

  test("keeps a final lease pollable and expires only at 30 minutes", async () => {
    const database = operationDatabase(execution())
    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T18:25:00.000Z"),
      }),
    ).resolves.toMatchObject({
      outcome: "pending",
      runId: RUN_ID,
      workerKickoff: false,
    })
    await expect(
      handlePublicationCanaryOperation(request, {
        database,
        now: () => Date.parse("2026-07-18T18:30:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "expired",
      runId: RUN_ID,
    })
  })

  test("publishes only from an immutable successful report", async () => {
    const database = operationDatabase(execution("succeeded"))
    await expect(
      handlePublicationCanaryOperation(request, { database }),
    ).resolves.toEqual({
      outcome: "published",
      runId: RUN_ID,
      reportSha256: REPORT_SHA256,
      advocateVersion: 18,
    })
    expect(database.publishInputs).toHaveLength(1)
    expect(database.publishInputs[0]).toMatchObject({
      advocateId: ADVOCATE_ID,
      runId: RUN_ID,
      reportSha256: REPORT_SHA256,
      adminReason: request.adminReason,
    })
  })

  test("keeps a failed report terminal and never publishes it", async () => {
    const database = operationDatabase(execution("failed"))
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
