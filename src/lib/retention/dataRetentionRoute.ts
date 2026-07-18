import "server-only"

import { randomUUID } from "node:crypto"

import { isAuthorizedDataRetentionWorkerRequest } from "@/lib/retention/dataRetentionAuth"
import {
  loadDataRetentionWorkerConfig,
  loadDataRetentionWorkerSecret,
  type DataRetentionEnvironment,
} from "@/lib/retention/dataRetentionConfig"
import {
  createEmptyDataRetentionCounts,
  DATA_RETENTION_STEPS,
  runDataRetentionWorker,
  type DataRetentionRpcExecutor,
} from "@/lib/retention/dataRetentionWorker"

export interface DataRetentionRouteDependencies {
  createExecutor: () => DataRetentionRpcExecutor
  environment?: DataRetentionEnvironment
  now?: () => number
  runId?: () => string
  requestId?: () => string
  timeoutSignal?: (milliseconds: number) => AbortSignal
}

function response(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function traceId(request: Request): string | null {
  for (const header of ["x-vercel-id", "cf-ray", "traceparent", "x-trace-id"]) {
    const value = request.headers.get(header)?.trim()
    if (value && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)) {
      return value
    }
  }
  return null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function reportRouteFailure(runId: string, requestId: string): void {
  console.error("DATA_RETENTION_RUN_REQUIRES_ATTENTION", {
    runId,
    requestId,
    startFailed: true,
    finalizeFailed: false,
    failedSteps: DATA_RETENTION_STEPS.map((step) => step.key),
    backlogSteps: [],
  })
}

export async function handleDataRetentionRequest(
  request: Request,
  dependencies: DataRetentionRouteDependencies,
): Promise<Response> {
  const environment = dependencies.environment ?? process.env
  let expectedSecret: string
  try {
    expectedSecret = loadDataRetentionWorkerSecret(environment)
  } catch {
    return response({ ok: false, code: "worker_unavailable" }, 503)
  }

  if (
    !isAuthorizedDataRetentionWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ ok: false, code: "unauthorized" }, 401)
  }

  const now = dependencies.now ?? Date.now
  const requestId = (dependencies.requestId ?? randomUUID)()
  const runId = (dependencies.runId ?? randomUUID)()
  if (!isUuid(requestId) || !isUuid(runId) || requestId === runId) {
    return response({ ok: false, code: "worker_unavailable" }, 503)
  }
  try {
    const result = await runDataRetentionWorker({
      config: loadDataRetentionWorkerConfig(environment),
      executor: dependencies.createExecutor(),
      context: { runId, requestId, traceId: traceId(request) },
      invocationDeadlineAt: now() + 60_000,
      now,
      timeoutSignal: dependencies.timeoutSignal,
    })
    return response(
      {
        ok: result.ok,
        ...(!result.ok ? { code: "retention_batch_incomplete" } : {}),
        runId,
        requestId,
        status: result.status,
        completedSteps: result.completedSteps,
        failedSteps: result.failedSteps,
        backlogSteps: result.backlogSteps,
        ...result.counts,
      },
      result.ok ? 200 : 503,
    )
  } catch {
    reportRouteFailure(runId, requestId)
    return response(
      {
        ok: false,
        code: "worker_execution_failed",
        runId,
        requestId,
        status: "start_failed",
        completedSteps: [],
        failedSteps: DATA_RETENTION_STEPS.map((step) => step.key),
        backlogSteps: [],
        ...createEmptyDataRetentionCounts(),
      },
      503,
    )
  }
}
