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
    "tests/sponsorships/subscription-cancellation-worker.spec.ts",
  ),
)
const worker = testRequire(
  "../../src/lib/sponsorships/cancellation/subscriptionCancellationWorker",
) as typeof import("../../src/lib/sponsorships/cancellation/subscriptionCancellationWorker")
const auth = testRequire(
  "../../src/lib/sponsorships/cancellation/subscriptionCancellationWorkerAuth",
) as typeof import("../../src/lib/sponsorships/cancellation/subscriptionCancellationWorkerAuth")
const config = testRequire(
  "../../src/lib/sponsorships/cancellation/subscriptionCancellationWorkerConfig",
) as typeof import("../../src/lib/sponsorships/cancellation/subscriptionCancellationWorkerConfig")
nodeModule._load = originalModuleLoad

import {
  parseSubscriptionCancellationClientResult,
  subscriptionCancellationNotice,
} from "../../src/lib/sponsorships/cancellation/subscriptionCancellationClient"

const OPERATION_ID = "22222222-2222-4222-8222-222222222222"
const LEASE_TOKEN = "33333333-3333-4333-8333-333333333333"
const NOW = Date.parse("2026-07-18T12:00:00.000Z")
const context = {
  requestId: "44444444-4444-4444-8444-444444444444",
  traceId: "trace-safe",
  clientIp: null,
  userAgent: null,
}
const workerConfig = {
  batchSize: 4,
  concurrency: 2,
  providerTimeoutMilliseconds: 15_000,
  invocationSafetyMarginMilliseconds: 5_000,
}

function claim() {
  return {
    operationId: OPERATION_ID,
    status: "processing" as const,
    leaseToken: LEASE_TOKEN,
    leaseExpiresAt: "2026-07-18T12:05:00.000Z",
    provider: "STRIPE" as const,
    providerAccountScope: "stripe_us",
    providerObjectType: "subscription",
    providerObjectId: "sub_private_reference",
    claimAttemptCount: 2,
  }
}

function providerOutcome(
  result: "provider_cancelled" | "provider_retryable_error",
) {
  return {
    result,
    effectMayHaveOccurred: true,
    evidence: {
      provider: "STRIPE" as const,
      result,
      httpStatus: result === "provider_cancelled" ? 200 : 503,
      providerCode: null,
      requestSemantics: "stripe-delete" as const,
    },
  }
}

test.describe("subscription cancellation worker authentication and config", () => {
  test("accepts only the exact bearer secret", () => {
    const secret = "s".repeat(32)
    expect(
      auth.isAuthorizedSubscriptionCancellationWorkerRequest(
        `Bearer ${secret}`,
        secret,
      ),
    ).toBe(true)
    for (const header of [
      null,
      secret,
      `Basic ${secret}`,
      `Bearer ${secret} `,
      `Bearer ${"x".repeat(32)}`,
    ]) {
      expect(
        auth.isAuthorizedSubscriptionCancellationWorkerRequest(header, secret),
      ).toBe(false)
    }
  })

  test("loads a bounded batch and dedicated or cron secret", () => {
    expect(config.loadSubscriptionCancellationWorkerConfig({})).toEqual(
      workerConfig,
    )
    expect(
      config.loadSubscriptionCancellationWorkerSecret({
        CRON_SECRET: "c".repeat(32),
      }),
    ).toBe("c".repeat(32))
    expect(
      config.loadSubscriptionCancellationWorkerSecret({
        CRON_SECRET: "c".repeat(32),
        SUBSCRIPTION_CANCELLATION_WORKER_SECRET: "d".repeat(32),
      }),
    ).toBe("d".repeat(32))
    expect(() =>
      config.loadSubscriptionCancellationWorkerConfig({
        SUBSCRIPTION_CANCELLATION_BATCH_SIZE: "21",
      }),
    ).toThrow()
  })
})

test.describe("subscription cancellation worker execution", () => {
  test("claims, calls the provider once, and lease settles cancellation", async () => {
    let providerCalls = 0
    let settlementDigest = ""
    const result = await worker.runSubscriptionCancellationWorkerBatch({
      config: workerConfig,
      context,
      invocationDeadlineAt: NOW + 60_000,
      dependencies: {
        now: () => NOW,
        repository: {
          async listCandidates() {
            return [OPERATION_ID]
          },
          async claim() {
            return claim()
          },
          async settle(operationId, leaseToken, outcome, digest) {
            expect(operationId).toBe(OPERATION_ID)
            expect(leaseToken).toBe(LEASE_TOKEN)
            expect(outcome.result).toBe("provider_cancelled")
            settlementDigest = digest
            return {
              operationId,
              status: "cancelled",
              terminal: true,
              providerEffectRecorded: true,
              replayed: false,
            }
          },
        },
        async cancelProvider() {
          providerCalls += 1
          return providerOutcome("provider_cancelled")
        },
      },
    })

    expect(providerCalls).toBe(1)
    expect(settlementDigest).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(result).toMatchObject({
      candidates: 1,
      cancelled: 1,
      retryScheduled: 0,
      settlementUnknown: 0,
    })
    expect(JSON.stringify(result)).not.toContain("sub_private_reference")
  })

  test("settles retryable provider uncertainty for the next durable schedule", async () => {
    const result = await worker.runSubscriptionCancellationWorkerBatch({
      config: workerConfig,
      context,
      invocationDeadlineAt: NOW + 60_000,
      dependencies: {
        now: () => NOW,
        repository: {
          async listCandidates() {
            return [OPERATION_ID]
          },
          async claim() {
            return claim()
          },
          async settle(operationId) {
            return {
              operationId,
              status: "pending",
              terminal: false,
              providerEffectRecorded: false,
              replayed: false,
            }
          },
        },
        async cancelProvider() {
          return providerOutcome("provider_retryable_error")
        },
      },
    })

    expect(result.retryScheduled).toBe(1)
    expect(result.cancelled).toBe(0)
  })

  test("defers before claiming when the provider deadline cannot fit", async () => {
    let claimCalls = 0
    let providerCalls = 0
    const result = await worker.runSubscriptionCancellationWorkerBatch({
      config: workerConfig,
      context,
      invocationDeadlineAt: NOW + 19_999,
      dependencies: {
        now: () => NOW,
        repository: {
          async listCandidates() {
            return [OPERATION_ID]
          },
          async claim() {
            claimCalls += 1
            return claim()
          },
          async settle() {
            throw new Error("unreachable")
          },
        },
        async cancelProvider() {
          providerCalls += 1
          return providerOutcome("provider_cancelled")
        },
      },
    })

    expect(result.deferred).toBe(1)
    expect(claimCalls).toBe(0)
    expect(providerCalls).toBe(0)
  })
})

test("client notices never describe pending or manual review as cancelled", () => {
  const pending = parseSubscriptionCancellationClientResult({
    operationId: OPERATION_ID,
    status: "processing",
    terminal: false,
  })
  const manual = parseSubscriptionCancellationClientResult({
    operationId: OPERATION_ID,
    status: "manual_review",
    terminal: true,
  })
  expect(pending).not.toBeNull()
  expect(manual).not.toBeNull()
  expect(subscriptionCancellationNotice(pending!.status).description).toContain(
    "retry automatically",
  )
  expect(subscriptionCancellationNotice(manual!.status).description).toContain(
    "not yet been confirmed stopped",
  )
})

test("the internal route is authenticated, bounded, and returns no provider identifiers", async () => {
  const source = await readFile(
    resolve(
      process.cwd(),
      "src/app/api/internal/sponsorships/subscription-cancellations/route.ts",
    ),
    "utf8",
  )
  expect(source).toContain("isAuthorizedSubscriptionCancellationWorkerRequest")
  expect(source).toContain("invocationDeadlineAt")
  expect(source).toContain("worker_batch_incomplete")
  expect(source).toContain("healthy ? 200 : 503")
  expect(source).not.toContain("providerObjectId")
  expect(source).not.toContain("providerAccountScope")
})
