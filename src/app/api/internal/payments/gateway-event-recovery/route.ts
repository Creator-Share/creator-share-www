import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { isAuthorizedPaymentGatewayEventWorkerRequest } from "@/lib/sponsorships/gateways/paymentGatewayEventAuth"
import { loadPaymentGatewayEventWorkerSecret } from "@/lib/sponsorships/gateways/paymentGatewayEventConfig"
import { GatewayRecoveryError, isGatewayRecoveryIdentity } from "@/lib/sponsorships/gateways/paymentGatewayRecovery"
import { recoverPaymentGatewayEventFromEnvironment } from "@/lib/sponsorships/gateways/paymentGatewayRecoveryRuntime"
import { readBoundedSponsorManagementBody } from "@/lib/sponsorships/management/passwordlessAccess"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120
const response = (body: object, status: number) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
})

// Explicit operator POST only. This route is deliberately absent from cron.
export async function POST(request: Request) {
  let secret: string
  try { secret = loadPaymentGatewayEventWorkerSecret() }
  catch { return response({ ok: false, code: "worker_unavailable" }, 503) }
  if (!isAuthorizedPaymentGatewayEventWorkerRequest(request.headers.get("authorization"), secret)) {
    return response({ ok: false, code: "unauthorized" }, 401)
  }
  const requestId = randomUUID()
  let body: unknown
  try {
    const raw = await readBoundedSponsorManagementBody(request, 1024, AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]))
    body = raw === null ? null : JSON.parse(raw)
  } catch { body = null }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 2 || !Object.hasOwn(body, "eventId") || !Object.hasOwn(body, "operationId") ||
      !isGatewayRecoveryIdentity(Reflect.get(body, "eventId")) || !isGatewayRecoveryIdentity(Reflect.get(body, "operationId"))) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }
  try {
    const result = await recoverPaymentGatewayEventFromEnvironment(Reflect.get(body, "eventId"), Reflect.get(body, "operationId"), requestId)
    return response({ ok: true, admitted: result.admitted, processingStatus: result.processingStatus, replay: result.replay, requestId }, result.replay ? 200 : 202)
  } catch (error) {
    const code = error instanceof GatewayRecoveryError ? error.code : "outcome_unknown"
    const status = code === "invalid_request" ? 400 : code === "not_found" ? 404 :
      code === "conflict" || code === "not_quarantined" ? 409 : code === "outcome_unknown" ? 503 : 422
    return response({ ok: false, code, requestId }, status)
  }
}
