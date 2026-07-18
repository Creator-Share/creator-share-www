import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

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
  resolve(process.cwd(), "tests/advocates/data-retention-worker.spec.ts"),
)
const auth = testRequire(
  "../../src/lib/retention/dataRetentionAuth",
) as typeof import("../../src/lib/retention/dataRetentionAuth")
const config = testRequire(
  "../../src/lib/retention/dataRetentionConfig",
) as typeof import("../../src/lib/retention/dataRetentionConfig")
const repository = testRequire(
  "../../src/lib/retention/dataRetentionRepository",
) as typeof import("../../src/lib/retention/dataRetentionRepository")
const route = testRequire(
  "../../src/lib/retention/dataRetentionRoute",
) as typeof import("../../src/lib/retention/dataRetentionRoute")
const worker = testRequire(
  "../../src/lib/retention/dataRetentionWorker",
) as typeof import("../../src/lib/retention/dataRetentionWorker")
nodeModule._load = originalModuleLoad

type DataRetentionRpcExecutor =
  import("../../src/lib/retention/dataRetentionWorker").DataRetentionRpcExecutor
type DataRetentionStepKey =
  import("../../src/lib/retention/dataRetentionWorker").DataRetentionStepKey

const SECRET = "r".repeat(48)
const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const RUN_ID = "22222222-2222-4222-8222-222222222222"
const NOW = Date.parse("2026-07-18T12:00:00.000Z")
const OLDEST_EXPIRED_AT = "2026-07-17T12:00:00.000Z"
const workerConfig = {
  batchSize: 5000,
  rpcTimeoutMilliseconds: 9_000,
  invocationSafetyMarginMilliseconds: 5_000,
}
const retentionContext = {
  runId: RUN_ID,
  requestId: REQUEST_ID,
  traceId: "trace-safe",
}

function timeoutSignal() {
  return new AbortController().signal
}

function authorizedRequest() {
  return new Request("https://creatorshare.com/api/internal/retention", {
    headers: {
      authorization: `Bearer ${SECRET}`,
      "x-trace-id": "trace-safe",
    },
  })
}

function stepCounts(stepKey: DataRetentionStepKey) {
  if (stepKey === "checkout_contact_envelopes") {
    return {
      erased_count: 6,
      succeeded_count: 2,
      failed_count: 1,
      cancelled_count: 1,
      expired_count: 2,
    }
  }
  if (stepKey === "email_outbox_contact") return { redacted_count: 4 }
  if (stepKey === "gateway_event_payloads") return { redacted_count: 5 }
  if (stepKey === "audit_forensics") return { deleted_count: 2 }
  return { exposures_deleted: 7, visitors_deleted: 3 }
}

function stepResult(stepKey: DataRetentionStepKey, hasMore = false) {
  return {
    step_key: stepKey,
    counts: stepCounts(stepKey),
    has_more: hasMore,
    oldest_expired_at: hasMore ? OLDEST_EXPIRED_AT : null,
  }
}

function finishResult(
  failedSteps: DataRetentionStepKey[] = [],
  backlogSteps: DataRetentionStepKey[] = [],
) {
  const failed = new Set(failedSteps)
  return {
    status: failedSteps.length === 0 ? "completed" : "completed_with_failures",
    completed_steps: worker.DATA_RETENTION_STEPS.map(
      (step: { key: DataRetentionStepKey }) => step.key,
    ).filter((step: DataRetentionStepKey) => !failed.has(step)),
    failed_steps: failedSteps,
    backlog_steps: backlogSteps,
  }
}

test.describe.configure({ mode: "serial" })

test.describe("data retention worker authentication and configuration", () => {
  test("accepts only the exact bearer secret and uses the cron fallback", () => {
    expect(
      auth.isAuthorizedDataRetentionWorkerRequest(`Bearer ${SECRET}`, SECRET),
    ).toBe(true)
    for (const header of [
      null,
      SECRET,
      `Basic ${SECRET}`,
      `Bearer ${SECRET} `,
      `Bearer ${"x".repeat(48)}`,
    ]) {
      expect(auth.isAuthorizedDataRetentionWorkerRequest(header, SECRET)).toBe(
        false,
      )
    }

    expect(config.loadDataRetentionWorkerSecret({ CRON_SECRET: SECRET })).toBe(
      SECRET,
    )
    expect(
      config.loadDataRetentionWorkerSecret({
        CRON_SECRET: SECRET,
        DATA_RETENTION_WORKER_SECRET: "d".repeat(48),
      }),
    ).toBe("d".repeat(48))
    expect(() =>
      config.loadDataRetentionWorkerSecret({
        CRON_SECRET: SECRET,
        DATA_RETENTION_WORKER_SECRET: " ".repeat(48),
      }),
    ).toThrow("Data retention worker configuration is unavailable")
    expect(() =>
      config.loadDataRetentionWorkerSecret({
        DATA_RETENTION_WORKER_SECRET: `${"a".repeat(24)}\t${"b".repeat(24)}`,
      }),
    ).toThrow("Data retention worker configuration is unavailable")
    expect(() =>
      config.loadDataRetentionWorkerSecret({
        VERCEL: "1",
        CRON_SECRET: SECRET,
        DATA_RETENTION_WORKER_SECRET: "d".repeat(48),
      }),
    ).toThrow("Data retention worker configuration is unavailable")
  })

  test("enforces the database batch and full invocation time bounds", () => {
    expect(config.loadDataRetentionWorkerConfig({})).toEqual(workerConfig)
    expect(
      config.loadDataRetentionWorkerConfig({
        DATA_RETENTION_BATCH_SIZE: "1",
      }).batchSize,
    ).toBe(1)

    for (const environment of [
      { DATA_RETENTION_BATCH_SIZE: "0" },
      { DATA_RETENTION_BATCH_SIZE: "5001" },
      { DATA_RETENTION_BATCH_SIZE: "1.5" },
      { DATA_RETENTION_RPC_TIMEOUT_MILLISECONDS: "9201" },
      { DATA_RETENTION_RPC_TIMEOUT_MILLISECONDS: "10001" },
      { DATA_RETENTION_INVOCATION_SAFETY_MARGIN_MILLISECONDS: "999" },
    ]) {
      expect(() => config.loadDataRetentionWorkerConfig(environment)).toThrow(
        "Data retention worker configuration is unavailable",
      )
    }
  })
})

test.describe("data retention worker execution", () => {
  test("uses two control calls around five privacy ordered cleanup calls", async () => {
    const calls: Array<Record<string, unknown>> = []
    const timeouts: number[] = []
    const result = await worker.runDataRetentionWorker({
      config: workerConfig,
      context: retentionContext,
      invocationDeadlineAt: NOW + 60_000,
      now: () => NOW,
      timeoutSignal(milliseconds) {
        timeouts.push(milliseconds)
        return timeoutSignal()
      },
      executor: {
        async startRun(batchSize, _signal, context) {
          calls.push({ operation: "start", batchSize, context })
          return RUN_ID
        },
        async executeStep(stepKey, batchSize, _signal, context) {
          calls.push({ operation: "step", stepKey, batchSize, context })
          return stepResult(stepKey)
        },
        async finishRun(reportedFailedSteps, _signal, context) {
          calls.push({
            operation: "finish",
            reportedFailedSteps,
            context,
          })
          return finishResult()
        },
      },
    })

    expect(calls).toEqual([
      {
        operation: "start",
        batchSize: 5000,
        context: retentionContext,
      },
      {
        operation: "step",
        stepKey: "checkout_contact_envelopes",
        batchSize: 500,
        context: retentionContext,
      },
      {
        operation: "step",
        stepKey: "email_outbox_contact",
        batchSize: 5000,
        context: retentionContext,
      },
      {
        operation: "step",
        stepKey: "gateway_event_payloads",
        batchSize: 5000,
        context: retentionContext,
      },
      {
        operation: "step",
        stepKey: "audit_forensics",
        batchSize: 5000,
        context: retentionContext,
      },
      {
        operation: "step",
        stepKey: "advocate_tracking",
        batchSize: 5000,
        context: retentionContext,
      },
      {
        operation: "finish",
        reportedFailedSteps: [],
        context: retentionContext,
      },
    ])
    expect(timeouts).toEqual([2_000, 9_000, 9_000, 9_000, 9_000, 9_000, 2_000])
    expect(result).toEqual({
      ok: true,
      status: "completed",
      completedSteps: [
        "checkout_contact_envelopes",
        "email_outbox_contact",
        "gateway_event_payloads",
        "audit_forensics",
        "advocate_tracking",
      ],
      failedSteps: [],
      backlogSteps: [],
      counts: {
        advocateExposuresDeleted: 7,
        browserVisitorsDeleted: 3,
        gatewayEventPayloadsRedacted: 5,
        emailOutboxContactsRedacted: 4,
        checkoutContactEnvelopesErased: 6,
        checkoutContactEnvelopesSucceeded: 2,
        checkoutContactEnvelopesFailed: 1,
        checkoutContactEnvelopesCancelled: 1,
        checkoutContactEnvelopesExpired: 2,
        auditForensicsDeleted: 2,
      },
      startFailed: false,
      finalizeFailed: false,
    })
  })

  test("continues after failure, reports backlog, and logs no raw error", async () => {
    const calls: string[] = []
    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const result = await worker.runDataRetentionWorker({
        config: workerConfig,
        context: retentionContext,
        invocationDeadlineAt: NOW + 60_000,
        now: () => NOW,
        timeoutSignal,
        executor: {
          async startRun() {
            calls.push("start")
            return { run_id: RUN_ID }
          },
          async executeStep(stepKey) {
            calls.push(stepKey)
            if (stepKey === "gateway_event_payloads") {
              throw new Error(`private database failure ${SECRET}`)
            }
            return stepResult(stepKey, stepKey === "advocate_tracking")
          },
          async finishRun(reportedFailedSteps) {
            calls.push("finish")
            expect(reportedFailedSteps).toEqual(["gateway_event_payloads"])
            return finishResult(
              ["gateway_event_payloads"],
              ["advocate_tracking"],
            )
          },
        },
      })

      expect(calls).toEqual([
        "start",
        "checkout_contact_envelopes",
        "email_outbox_contact",
        "gateway_event_payloads",
        "audit_forensics",
        "advocate_tracking",
        "finish",
      ])
      expect(result).toMatchObject({
        ok: false,
        status: "completed_with_failures",
        completedSteps: [
          "checkout_contact_envelopes",
          "email_outbox_contact",
          "audit_forensics",
          "advocate_tracking",
        ],
        failedSteps: ["gateway_event_payloads"],
        backlogSteps: ["advocate_tracking"],
        startFailed: false,
        finalizeFailed: false,
      })
      expect(errorCalls).toEqual([
        [
          "DATA_RETENTION_RUN_REQUIRES_ATTENTION",
          {
            runId: RUN_ID,
            requestId: REQUEST_ID,
            startFailed: false,
            finalizeFailed: false,
            failedSteps: ["gateway_event_payloads"],
            backlogSteps: ["advocate_tracking"],
          },
        ],
      ])
      expect(JSON.stringify({ result, errorCalls })).not.toContain(SECRET)
      expect(JSON.stringify({ result, errorCalls })).not.toContain(
        "private database failure",
      )
    } finally {
      console.error = originalError
    }
  })

  test("treats durable backlog as incomplete without inventing a failure", async () => {
    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const result = await worker.runDataRetentionWorker({
        config: workerConfig,
        context: retentionContext,
        invocationDeadlineAt: NOW + 60_000,
        now: () => NOW,
        timeoutSignal,
        executor: {
          async startRun() {
            return RUN_ID
          },
          async executeStep(stepKey) {
            return stepResult(stepKey, stepKey === "email_outbox_contact")
          },
          async finishRun() {
            return finishResult([], ["email_outbox_contact"])
          },
        },
      })

      expect(result).toMatchObject({
        ok: false,
        status: "completed",
        failedSteps: [],
        backlogSteps: ["email_outbox_contact"],
        startFailed: false,
        finalizeFailed: false,
      })
      expect(errorCalls).toEqual([
        [
          "DATA_RETENTION_RUN_REQUIRES_ATTENTION",
          {
            runId: RUN_ID,
            requestId: REQUEST_ID,
            startFailed: false,
            finalizeFailed: false,
            failedSteps: [],
            backlogSteps: ["email_outbox_contact"],
          },
        ],
      ])
    } finally {
      console.error = originalError
    }
  })

  test("rejects a backlog timestamp when the step reports no backlog", async () => {
    const originalError = console.error
    console.error = () => undefined
    try {
      const result = await worker.runDataRetentionWorker({
        config: workerConfig,
        context: retentionContext,
        invocationDeadlineAt: NOW + 60_000,
        now: () => NOW,
        timeoutSignal,
        executor: {
          async startRun() {
            return RUN_ID
          },
          async executeStep(stepKey) {
            if (stepKey === "checkout_contact_envelopes") {
              return {
                ...stepResult(stepKey),
                oldest_expired_at: OLDEST_EXPIRED_AT,
              }
            }
            return stepResult(stepKey)
          },
          async finishRun(reportedFailedSteps) {
            expect(reportedFailedSteps).toEqual(["checkout_contact_envelopes"])
            return finishResult(["checkout_contact_envelopes"])
          },
        },
      })

      expect(result).toMatchObject({
        ok: false,
        status: "completed_with_failures",
        failedSteps: ["checkout_contact_envelopes"],
        counts: { checkoutContactEnvelopesErased: 0 },
      })
    } finally {
      console.error = originalError
    }
  })

  test("reports a start failure without executing or finalizing steps", async () => {
    let stepCalls = 0
    let finishCalls = 0
    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const result = await worker.runDataRetentionWorker({
        config: workerConfig,
        context: retentionContext,
        invocationDeadlineAt: NOW + 60_000,
        now: () => NOW,
        timeoutSignal,
        executor: {
          async startRun() {
            throw new Error(`unsafe start ${SECRET}`)
          },
          async executeStep() {
            stepCalls += 1
            return null
          },
          async finishRun() {
            finishCalls += 1
            return null
          },
        },
      })
      expect(stepCalls).toBe(0)
      expect(finishCalls).toBe(0)
      expect(result).toMatchObject({
        ok: false,
        status: "start_failed",
        completedSteps: [],
        failedSteps: [
          "checkout_contact_envelopes",
          "email_outbox_contact",
          "gateway_event_payloads",
          "audit_forensics",
          "advocate_tracking",
        ],
        startFailed: true,
        finalizeFailed: false,
      })
      expect(errorCalls).toEqual([
        [
          "DATA_RETENTION_RUN_REQUIRES_ATTENTION",
          {
            runId: RUN_ID,
            requestId: REQUEST_ID,
            startFailed: true,
            finalizeFailed: false,
            failedSteps: [
              "checkout_contact_envelopes",
              "email_outbox_contact",
              "gateway_event_payloads",
              "audit_forensics",
              "advocate_tracking",
            ],
            backlogSteps: [],
          },
        ],
      ])
      expect(JSON.stringify(errorCalls)).not.toContain(SECRET)
    } finally {
      console.error = originalError
    }
  })

  test("fails closed on an absent or mismatched start acknowledgement", async () => {
    const originalError = console.error
    console.error = () => undefined
    try {
      for (const acknowledgement of [
        null,
        undefined,
        "33333333-3333-4333-8333-333333333333",
        { run_id: "33333333-3333-4333-8333-333333333333" },
      ]) {
        let stepCalls = 0
        const result = await worker.runDataRetentionWorker({
          config: workerConfig,
          context: retentionContext,
          invocationDeadlineAt: NOW + 60_000,
          now: () => NOW,
          timeoutSignal,
          executor: {
            async startRun() {
              return acknowledgement
            },
            async executeStep() {
              stepCalls += 1
              return null
            },
            async finishRun() {
              return null
            },
          },
        })
        expect(stepCalls).toBe(0)
        expect(result).toMatchObject({
          ok: false,
          status: "start_failed",
          completedSteps: [],
          startFailed: true,
          finalizeFailed: false,
        })
      }
    } finally {
      console.error = originalError
    }
  })

  test("reports a finalize failure after preserving completed aggregates", async () => {
    const errorCalls: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => errorCalls.push(args)
    try {
      const result = await worker.runDataRetentionWorker({
        config: workerConfig,
        context: retentionContext,
        invocationDeadlineAt: NOW + 60_000,
        now: () => NOW,
        timeoutSignal,
        executor: {
          async startRun() {
            return RUN_ID
          },
          async executeStep(stepKey) {
            return stepResult(stepKey)
          },
          async finishRun() {
            throw new Error(`unsafe finish ${SECRET}`)
          },
        },
      })
      expect(result).toMatchObject({
        ok: false,
        status: "finalize_failed",
        failedSteps: [],
        counts: { gatewayEventPayloadsRedacted: 5 },
        startFailed: false,
        finalizeFailed: true,
      })
      expect(errorCalls).toEqual([
        [
          "DATA_RETENTION_RUN_REQUIRES_ATTENTION",
          {
            runId: RUN_ID,
            requestId: REQUEST_ID,
            startFailed: false,
            finalizeFailed: true,
            failedSteps: [],
            backlogSteps: [],
          },
        ],
      ])
      expect(JSON.stringify(errorCalls)).not.toContain(SECRET)
    } finally {
      console.error = originalError
    }
  })

  test("rejects terminal backlog attached to a failed step", async () => {
    const originalError = console.error
    console.error = () => undefined
    try {
      const result = await worker.runDataRetentionWorker({
        config: workerConfig,
        context: retentionContext,
        invocationDeadlineAt: NOW + 60_000,
        now: () => NOW,
        timeoutSignal,
        executor: {
          async startRun() {
            return RUN_ID
          },
          async executeStep(stepKey) {
            if (stepKey === "gateway_event_payloads") {
              throw new Error("static failure")
            }
            return stepResult(stepKey)
          },
          async finishRun() {
            return finishResult(
              ["gateway_event_payloads"],
              ["gateway_event_payloads"],
            )
          },
        },
      })

      expect(result).toMatchObject({
        ok: false,
        status: "finalize_failed",
        completedSteps: [
          "checkout_contact_envelopes",
          "email_outbox_contact",
          "audit_forensics",
          "advocate_tracking",
        ],
        failedSteps: ["gateway_event_payloads"],
        finalizeFailed: true,
      })
    } finally {
      console.error = originalError
    }
  })

  test("reserves the final control call when step deadlines are exhausted", async () => {
    const calls: string[] = []
    const timeouts: number[] = []
    const originalError = console.error
    console.error = () => undefined
    try {
      const result = await worker.runDataRetentionWorker({
        config: workerConfig,
        context: retentionContext,
        invocationDeadlineAt: NOW + 7_000,
        now: () => NOW,
        timeoutSignal(milliseconds) {
          timeouts.push(milliseconds)
          return timeoutSignal()
        },
        executor: {
          async startRun() {
            calls.push("start")
            return RUN_ID
          },
          async executeStep() {
            calls.push("step")
            return null
          },
          async finishRun(reportedFailedSteps) {
            calls.push("finish")
            return finishResult(reportedFailedSteps)
          },
        },
      })
      expect(calls).toEqual(["start", "finish"])
      expect(timeouts).toEqual([2_000, 2_000])
      expect(result).toMatchObject({
        ok: false,
        status: "completed_with_failures",
        completedSteps: [],
        failedSteps: [
          "checkout_contact_envelopes",
          "email_outbox_contact",
          "gateway_event_payloads",
          "audit_forensics",
          "advocate_tracking",
        ],
      })
    } finally {
      console.error = originalError
    }
  })

  test("binds all durable run context to the Supabase RPC contract", async () => {
    const calls: Array<Record<string, unknown>> = []
    const signal = timeoutSignal()
    const client = {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return {
          abortSignal(receivedSignal: AbortSignal) {
            calls.push({ receivedSignal })
            return Promise.resolve({ data: RUN_ID, error: null })
          },
        }
      },
    } as unknown as SupabaseClient
    const executor = repository.createSupabaseDataRetentionRpcExecutor(client)

    await executor.startRun(5000, signal, retentionContext)
    await executor.executeStep(
      "checkout_contact_envelopes",
      500,
      signal,
      retentionContext,
    )
    await executor.finishRun(
      ["gateway_event_payloads"],
      signal,
      retentionContext,
    )
    expect(calls).toEqual([
      {
        name: "start_data_retention_run",
        args: {
          run_id: RUN_ID,
          request_id: REQUEST_ID,
          trace_id: "trace-safe",
          batch_size: 5000,
        },
      },
      { receivedSignal: signal },
      {
        name: "run_data_retention_step",
        args: {
          run_id: RUN_ID,
          request_id: REQUEST_ID,
          trace_id: "trace-safe",
          step_key: "checkout_contact_envelopes",
          batch_size: 500,
        },
      },
      { receivedSignal: signal },
      {
        name: "finish_data_retention_run",
        args: {
          run_id: RUN_ID,
          request_id: REQUEST_ID,
          trace_id: "trace-safe",
          reported_failed_steps: ["gateway_event_payloads"],
        },
      },
      { receivedSignal: signal },
    ])
  })
})

test.describe("data retention route and scheduler", () => {
  test("rejects unauthorized requests before creating a database executor", async () => {
    let executorCreations = 0
    const response = await route.handleDataRetentionRequest(
      new Request("https://creatorshare.com/api/internal/retention"),
      {
        environment: { DATA_RETENTION_WORKER_SECRET: SECRET },
        createExecutor() {
          executorCreations += 1
          throw new Error("must not run")
        },
      },
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      ok: false,
      code: "unauthorized",
    })
    expect(executorCreations).toBe(0)
  })

  test("returns safe identifiers, aggregates, failures, and backlog", async () => {
    const originalError = console.error
    console.error = () => undefined
    try {
      const response = await route.handleDataRetentionRequest(
        authorizedRequest(),
        {
          environment: { DATA_RETENTION_WORKER_SECRET: SECRET },
          requestId: () => REQUEST_ID,
          runId: () => RUN_ID,
          now: () => NOW,
          timeoutSignal,
          createExecutor: () => ({
            async startRun(_batchSize, _signal, context) {
              expect(context).toEqual(retentionContext)
              return RUN_ID
            },
            async executeStep(stepKey, _batchSize, _signal, context) {
              expect(context).toEqual(retentionContext)
              if (stepKey === "gateway_event_payloads") {
                throw new Error(`upstream included ${SECRET}`)
              }
              return stepResult(stepKey, stepKey === "advocate_tracking")
            },
            async finishRun(reportedFailedSteps, _signal, context) {
              expect(context).toEqual(retentionContext)
              expect(reportedFailedSteps).toEqual(["gateway_event_payloads"])
              return finishResult(
                ["gateway_event_payloads"],
                ["advocate_tracking"],
              )
            },
          }),
        },
      )
      const bodyText = await response.text()
      const body = JSON.parse(bodyText)

      expect(response.status).toBe(503)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(body).toEqual({
        ok: false,
        code: "retention_batch_incomplete",
        runId: RUN_ID,
        requestId: REQUEST_ID,
        status: "completed_with_failures",
        completedSteps: [
          "checkout_contact_envelopes",
          "email_outbox_contact",
          "audit_forensics",
          "advocate_tracking",
        ],
        failedSteps: ["gateway_event_payloads"],
        backlogSteps: ["advocate_tracking"],
        advocateExposuresDeleted: 7,
        browserVisitorsDeleted: 3,
        gatewayEventPayloadsRedacted: 0,
        emailOutboxContactsRedacted: 4,
        checkoutContactEnvelopesErased: 6,
        checkoutContactEnvelopesSucceeded: 2,
        checkoutContactEnvelopesFailed: 1,
        checkoutContactEnvelopesCancelled: 1,
        checkoutContactEnvelopesExpired: 2,
        auditForensicsDeleted: 2,
      })
      expect(bodyText).not.toContain(SECRET)
      expect(bodyText).not.toContain("upstream included")
    } finally {
      console.error = originalError
    }
  })

  test("schedules hourly retention and preserves all four minute workers", async () => {
    const vercelConfig = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    )
    expect(vercelConfig.crons).toEqual(
      expect.arrayContaining([
        {
          path: "/api/internal/retention",
          schedule: "17 * * * *",
        },
        {
          path: "/api/internal/advocates/provisioning",
          schedule: "* * * * *",
        },
        {
          path: "/api/internal/payments/gateway-events",
          schedule: "* * * * *",
        },
        {
          path: "/api/internal/sponsorships/welcome-emails",
          schedule: "* * * * *",
        },
        {
          path: "/api/internal/sponsorships/subscription-cancellations",
          schedule: "* * * * *",
        },
      ]),
    )
    expect(
      vercelConfig.functions["src/app/api/internal/retention/route.ts"],
    ).toEqual({ maxDuration: 60 })
  })
})
