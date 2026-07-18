import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import { isAuthorizedPaymentGatewayEventWorkerRequest } from "@/lib/sponsorships/gateways/paymentGatewayEventAuth"
import {
  loadPaymentGatewayEventWorkerConfig,
  loadPaymentGatewayEventWorkerSecret,
} from "@/lib/sponsorships/gateways/paymentGatewayEventConfig"
import { runPaymentGatewayEventBatchFromEnvironment } from "@/lib/sponsorships/gateways/paymentGatewayEventRuntime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
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
  let expectedSecret: string
  try {
    expectedSecret = loadPaymentGatewayEventWorkerSecret()
  } catch {
    return response({ ok: false, code: "worker_unavailable" }, 503)
  }

  if (
    !isAuthorizedPaymentGatewayEventWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ ok: false, code: "unauthorized" }, 401)
  }

  const requestId = randomUUID()
  try {
    const batch = await runPaymentGatewayEventBatchFromEnvironment({
      config: loadPaymentGatewayEventWorkerConfig(),
      workerId: `payment-gateway-event-worker:${randomUUID()}`,
      context: { requestId, traceId: traceId(request) },
    })
    return response(
      {
        ok: true,
        requestId,
        claimed: batch.claimed,
        applied: batch.applied,
        ignored: batch.ignored,
        retried: batch.retried,
        terminalFailed: batch.terminalFailed,
        leaseLost: batch.leaseLost,
        settlementUnknown: batch.settlementUnknown,
        contactEnvelopesErased: batch.contactErasure.erased,
        contactEnvelopeErasure: batch.contactErasure,
      },
      200,
    )
  } catch {
    return response(
      { ok: false, code: "worker_execution_failed", requestId },
      503,
    )
  }
}

export const GET = runWorker
export const POST = runWorker
