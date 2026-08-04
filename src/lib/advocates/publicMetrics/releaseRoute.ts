import "server-only"

import { randomUUID } from "node:crypto"

import {
  isAuthorizedAdvocatePublicMetricReleaseWorkerRequest,
  loadAdvocatePublicMetricReleaseWorkerSecret,
  type AdvocatePublicMetricReleaseEnvironment,
} from "./releaseAuth"
import { loadAdvocatePublicMetricReleaseWorkerConfig } from "./releaseConfig"
import {
  runAdvocatePublicMetricReleaseWorker,
  type AdvocatePublicMetricReleaseRpcExecutor,
} from "./releaseWorker"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface AdvocatePublicMetricReleaseRouteDependencies {
  createExecutor: () => AdvocatePublicMetricReleaseRpcExecutor
  environment?: AdvocatePublicMetricReleaseEnvironment
  requestId?: () => string
  timeoutSignal?: (milliseconds: number) => AbortSignal
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
  for (const header of ["x-vercel-id", "cf-ray", "traceparent"]) {
    const value = request.headers.get(header)?.trim()
    if (value && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)) {
      return value
    }
  }
  return null
}

export async function handleAdvocatePublicMetricReleaseRequest(
  request: Request,
  dependencies: AdvocatePublicMetricReleaseRouteDependencies,
): Promise<Response> {
  const environment = dependencies.environment ?? process.env
  let expectedSecret: string
  try {
    expectedSecret = loadAdvocatePublicMetricReleaseWorkerSecret(environment)
  } catch {
    return response({ ok: false, code: "worker_unavailable" }, 503)
  }

  if (
    !isAuthorizedAdvocatePublicMetricReleaseWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ ok: false, code: "unauthorized" }, 401)
  }

  const requestId = (dependencies.requestId ?? randomUUID)()
  if (!UUID_PATTERN.test(requestId)) {
    return response({ ok: false, code: "worker_unavailable" }, 503)
  }

  try {
    const config = loadAdvocatePublicMetricReleaseWorkerConfig(environment)
    const summary = await runAdvocatePublicMetricReleaseWorker({
      ...config,
      executor: dependencies.createExecutor(),
      context: { requestId, traceId: safeTraceId(request) },
      timeoutSignal: dependencies.timeoutSignal,
    })
    return response(
      {
        ok: true,
        requestId,
        processedAdvocates: summary.processedAdvocates,
        insertedReleases: summary.insertedReleases,
        pendingMetrics: summary.pendingMetrics,
        sourceCutoff: summary.sourceCutoff,
        policyVersion: summary.policyVersion,
      },
      200,
    )
  } catch {
    console.error("ADVOCATE_PUBLIC_METRIC_RELEASE_REQUIRES_ATTENTION", {
      requestId,
      code: "worker_execution_failed",
    })
    return response(
      { ok: false, code: "worker_execution_failed", requestId },
      503,
    )
  }
}
