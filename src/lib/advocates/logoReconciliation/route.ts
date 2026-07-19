import "server-only"

import { randomUUID } from "node:crypto"

import {
  isAuthorizedAdvocateLogoReconciliationWorkerRequest,
  loadAdvocateLogoReconciliationWorkerSecret,
  type AdvocateLogoReconciliationEnvironment,
} from "./auth"
import {
  loadAdvocateLogoReconciliationWorkerConfig,
  type AdvocateLogoReconciliationWorkerConfig,
} from "./config"
import type { AdvocateLogoReconciliationWorkerDependencies } from "./worker"
import {
  emptyAdvocateLogoReconciliationCounts,
  runAdvocateLogoReconciliationBatch,
} from "./worker"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface AdvocateLogoReconciliationRouteDependencies {
  createWorkerDependencies(input: {
    config: AdvocateLogoReconciliationWorkerConfig
    invocationDeadlineAt: number
    now: () => number
  }): AdvocateLogoReconciliationWorkerDependencies
  environment?: AdvocateLogoReconciliationEnvironment
  now?: () => number
  requestId?: () => string
  workerId?: () => string
}

function response(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function safeTraceId(request: Request): string | null {
  for (const header of ["x-vercel-id", "cf-ray", "traceparent", "x-trace-id"]) {
    const value = request.headers.get(header)?.trim()
    if (value && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)) {
      return value
    }
  }
  return null
}

function safeResponse(
  ok: boolean,
  requestId: string,
  counts: ReturnType<typeof emptyAdvocateLogoReconciliationCounts>,
  code?: string,
): Response {
  return response(
    {
      ok,
      ...(code === undefined ? {} : { code }),
      requestId,
      claimed: counts.claimed,
      deleted: counts.deleted,
      alreadyAbsent: counts.alreadyAbsent,
      retried: counts.retried,
      exhausted: counts.exhausted,
      quarantined: counts.quarantined,
      leaseLost: counts.leaseLost,
      settlementUnknown: counts.settlementUnknown,
    },
    ok ? 200 : code === "unauthorized" ? 401 : 503,
  )
}

export async function handleAdvocateLogoReconciliationRequest(
  request: Request,
  dependencies: AdvocateLogoReconciliationRouteDependencies,
): Promise<Response> {
  const now = dependencies.now ?? Date.now
  const requestId = (dependencies.requestId ?? randomUUID)()
  const emptyCounts = emptyAdvocateLogoReconciliationCounts()
  if (!UUID_PATTERN.test(requestId)) {
    return safeResponse(false, "unavailable", emptyCounts, "worker_unavailable")
  }
  let invocationStartedAt: number
  try {
    invocationStartedAt = now()
  } catch {
    return safeResponse(false, requestId, emptyCounts, "worker_unavailable")
  }
  const environment = dependencies.environment ?? process.env
  let expectedSecret: string
  try {
    expectedSecret = loadAdvocateLogoReconciliationWorkerSecret(environment)
  } catch {
    return safeResponse(false, requestId, emptyCounts, "worker_unavailable")
  }
  if (
    !isAuthorizedAdvocateLogoReconciliationWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return safeResponse(false, requestId, emptyCounts, "unauthorized")
  }

  if (!Number.isSafeInteger(invocationStartedAt) || invocationStartedAt < 1) {
    return safeResponse(false, requestId, emptyCounts, "worker_unavailable")
  }
  const workerToken = (dependencies.workerId ?? randomUUID)()
  if (!UUID_PATTERN.test(workerToken)) {
    return safeResponse(false, requestId, emptyCounts, "worker_unavailable")
  }

  try {
    const config = loadAdvocateLogoReconciliationWorkerConfig(environment)
    const invocationDeadlineAt =
      invocationStartedAt + 60_000 - config.invocationSafetyMarginMilliseconds
    const counts = await runAdvocateLogoReconciliationBatch({
      config,
      workerId: `advocate-logo-reconciliation:${workerToken}`,
      context: { requestId, traceId: safeTraceId(request) },
      invocationDeadlineAt,
      dependencies: dependencies.createWorkerDependencies({
        config,
        invocationDeadlineAt,
        now,
      }),
    })
    const requiresAttention =
      counts.exhausted > 0 ||
      counts.quarantined > 0 ||
      counts.settlementUnknown > 0
    if (requiresAttention) {
      console.error("ADVOCATE_LOGO_RECONCILIATION_REQUIRES_ATTENTION", {
        requestId,
        code: "worker_batch_requires_attention",
        claimed: counts.claimed,
        exhausted: counts.exhausted,
        quarantined: counts.quarantined,
        settlementUnknown: counts.settlementUnknown,
      })
    }
    return safeResponse(
      !requiresAttention,
      requestId,
      counts,
      requiresAttention ? "worker_batch_requires_attention" : undefined,
    )
  } catch {
    console.error("ADVOCATE_LOGO_RECONCILIATION_REQUIRES_ATTENTION", {
      requestId,
      code: "worker_execution_failed",
      claimed: 0,
      exhausted: 0,
      quarantined: 0,
      settlementUnknown: 0,
    })
    return safeResponse(
      false,
      requestId,
      emptyCounts,
      "worker_execution_failed",
    )
  }
}
