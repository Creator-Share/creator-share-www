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
      context: { requestId: randomUUID(), traceId: traceId(request) },
      invocationDeadlineAt,
    })
    return response(
      {
        ok: true,
        claimed: batch.claimed,
        sent: batch.sent,
        retried: batch.retried,
        terminalFailed: batch.terminalFailed,
        leaseLost: batch.leaseLost,
        manualReview: batch.manualReview,
        settlementUnknown: batch.settlementUnknown,
      },
      200,
    )
  } catch {
    return response({ ok: false, code: "worker_execution_failed" }, 503)
  }
}

export const GET = runWorker
export const POST = runWorker
