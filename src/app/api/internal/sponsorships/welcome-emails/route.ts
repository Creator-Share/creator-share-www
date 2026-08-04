import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import { isAuthorizedSponsorWelcomeEmailWorkerRequest } from "@/lib/sponsorships/email/sponsorWelcomeEmailAuth"
import {
  loadSponsorWelcomeEmailWorkerConfig,
  loadSponsorWelcomeEmailWorkerSecret,
} from "@/lib/sponsorships/email/sponsorWelcomeEmailConfig"
import { runSponsorWelcomeEmailBatchFromEnvironment } from "@/lib/sponsorships/email/sponsorWelcomeEmailRuntime"

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
  const requestId = randomUUID()
  let expectedSecret: string
  try {
    expectedSecret = loadSponsorWelcomeEmailWorkerSecret()
  } catch {
    return response({ ok: false, code: "worker_unavailable" }, 503)
  }

  if (
    !isAuthorizedSponsorWelcomeEmailWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ ok: false, code: "unauthorized" }, 401)
  }

  try {
    const batch = await runSponsorWelcomeEmailBatchFromEnvironment({
      config: loadSponsorWelcomeEmailWorkerConfig(),
      workerId: `sponsor-welcome-email-worker:${randomUUID()}`,
      context: { requestId, traceId: traceId(request) },
      invocationDeadlineAt,
    })
    const requiresAttention =
      batch.terminalFailed > 0 ||
      batch.manualReview > 0 ||
      batch.settlementUnknown > 0
    if (requiresAttention) {
      console.error("SPONSOR_WELCOME_EMAIL_WORKER_REQUIRES_ATTENTION", {
        requestId,
        code: "worker_batch_incomplete",
        terminalFailed: batch.terminalFailed,
        manualReview: batch.manualReview,
        settlementUnknown: batch.settlementUnknown,
      })
    }
    return response(
      {
        ok: !requiresAttention,
        ...(requiresAttention ? { code: "worker_batch_incomplete" } : {}),
        requestId,
        claimed: batch.claimed,
        sent: batch.sent,
        retried: batch.retried,
        terminalFailed: batch.terminalFailed,
        leaseLost: batch.leaseLost,
        manualReview: batch.manualReview,
        settlementUnknown: batch.settlementUnknown,
      },
      requiresAttention ? 503 : 200,
    )
  } catch {
    console.error("SPONSOR_WELCOME_EMAIL_WORKER_REQUIRES_ATTENTION", {
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
