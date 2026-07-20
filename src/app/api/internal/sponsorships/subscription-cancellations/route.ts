import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import { isAuthorizedSubscriptionCancellationWorkerRequest } from "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerAuth"
import {
  loadSubscriptionCancellationWorkerConfig,
  loadSubscriptionCancellationWorkerSecret,
} from "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerConfig"
import { runSubscriptionCancellationWorkerBatchFromEnvironment } from "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerRuntime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function traceId(request: NextRequest): string | null {
  for (const header of ["x-vercel-id", "cf-ray", "traceparent", "x-trace-id"]) {
    const value = request.headers.get(header)?.trim()
    if (value && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)) {
      return value
    }
  }
  return null
}

async function runWorker(request: NextRequest) {
  const invocationDeadlineAt = Date.now() + 60_000
  let expectedSecret: string
  try {
    expectedSecret = loadSubscriptionCancellationWorkerSecret()
  } catch {
    return response({ ok: false, code: "worker_unavailable" }, 503)
  }

  if (
    !isAuthorizedSubscriptionCancellationWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ ok: false, code: "unauthorized" }, 401)
  }

  const requestId = randomUUID()
  try {
    const batch = await runSubscriptionCancellationWorkerBatchFromEnvironment({
      config: loadSubscriptionCancellationWorkerConfig(),
      workerId: `subscription-cancellation-worker:${randomUUID()}`,
      context: {
        requestId,
        traceId: traceId(request),
        clientIp: null,
        userAgent: null,
      },
      invocationDeadlineAt,
    })
    const healthy =
      batch.manualReview === 0 &&
      batch.claimFailed === 0 &&
      batch.settlementUnknown === 0
    if (!healthy) {
      console.error("SUBSCRIPTION_CANCELLATION_WORKER_REQUIRES_ATTENTION", {
        requestId,
        code: "worker_batch_incomplete",
        manualReview: batch.manualReview,
        claimFailed: batch.claimFailed,
        settlementUnknown: batch.settlementUnknown,
      })
    }
    return response(
      {
        ok: healthy,
        ...(healthy ? {} : { code: "worker_batch_incomplete" }),
        requestId,
        candidates: batch.candidates,
        cancelled: batch.cancelled,
        retryScheduled: batch.retryScheduled,
        manualReview: batch.manualReview,
        alreadyProcessing: batch.alreadyProcessing,
        deferred: batch.deferred,
        claimFailed: batch.claimFailed,
        settlementUnknown: batch.settlementUnknown,
      },
      healthy ? 200 : 503,
    )
  } catch {
    console.error("SUBSCRIPTION_CANCELLATION_WORKER_REQUIRES_ATTENTION", {
      requestId,
      code: "worker_execution_failed",
    })
    return response(
      { ok: false, code: "worker_execution_failed", requestId },
      503,
    )
  }
}

export const GET = runWorker
export const POST = runWorker
