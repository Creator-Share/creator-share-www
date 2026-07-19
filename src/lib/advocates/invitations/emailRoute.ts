import "server-only"

import { randomUUID } from "node:crypto"

import {
  loadAdvocateInvitationEmailWorkerConfig,
  loadAdvocateInvitationEmailWorkerSecret,
  type AdvocateInvitationEmailEnvironment,
} from "./emailConfig"
import {
  emptyAdvocateInvitationEmailBatchResult,
  runAdvocateInvitationEmailBatch,
  type AdvocateInvitationEmailWorkerDependencies,
} from "./emailWorker"
import { isAuthorizedAdvocateInvitationEmailWorkerRequest } from "./emailWorkerAuthorization"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface AdvocateInvitationEmailRouteDependencies {
  createWorkerDependencies(input: {
    config: ReturnType<typeof loadAdvocateInvitationEmailWorkerConfig>
  }): AdvocateInvitationEmailWorkerDependencies
  environment?: AdvocateInvitationEmailEnvironment
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

function traceId(request: Request): string | null {
  for (const header of ["x-vercel-id", "cf-ray", "traceparent", "x-trace-id"]) {
    const value = request.headers.get(header)?.trim()
    if (value && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)) {
      return value
    }
  }
  return null
}

function safeResponse(options: {
  ok: boolean
  requestId: string
  code?: string
  batch?: ReturnType<typeof emptyAdvocateInvitationEmailBatchResult>
}): Response {
  const batch = options.batch ?? emptyAdvocateInvitationEmailBatchResult()
  return response(
    {
      ok: options.ok,
      ...(options.code === undefined ? {} : { code: options.code }),
      requestId: options.requestId,
      claimed: batch.claimed,
      sent: batch.sent,
      retried: batch.retried,
      terminalFailed: batch.terminalFailed,
      leaseLost: batch.leaseLost,
      manualReview: batch.manualReview,
      settlementUnknown: batch.settlementUnknown,
    },
    options.ok ? 200 : options.code === "unauthorized" ? 401 : 503,
  )
}

export async function handleAdvocateInvitationEmailRequest(
  request: Request,
  dependencies: AdvocateInvitationEmailRouteDependencies,
): Promise<Response> {
  const now = dependencies.now ?? Date.now
  const requestId = (dependencies.requestId ?? randomUUID)()
  if (!UUID_PATTERN.test(requestId)) {
    return safeResponse({
      ok: false,
      requestId: "unavailable",
      code: "worker_unavailable",
    })
  }

  let startedAt: number
  try {
    startedAt = now()
  } catch {
    return safeResponse({
      ok: false,
      requestId,
      code: "worker_unavailable",
    })
  }
  if (!Number.isSafeInteger(startedAt) || startedAt < 1) {
    return safeResponse({
      ok: false,
      requestId,
      code: "worker_unavailable",
    })
  }

  const environment = dependencies.environment ?? process.env
  let expectedSecret: string
  try {
    expectedSecret = loadAdvocateInvitationEmailWorkerSecret(environment)
  } catch {
    return safeResponse({
      ok: false,
      requestId,
      code: "worker_unavailable",
    })
  }
  if (
    !isAuthorizedAdvocateInvitationEmailWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return safeResponse({ ok: false, requestId, code: "unauthorized" })
  }

  const workerToken = (dependencies.workerId ?? randomUUID)()
  if (!UUID_PATTERN.test(workerToken)) {
    return safeResponse({
      ok: false,
      requestId,
      code: "worker_unavailable",
    })
  }

  try {
    const config = loadAdvocateInvitationEmailWorkerConfig(environment)
    const batch = await runAdvocateInvitationEmailBatch({
      config,
      workerId: `advocate-invitation-email:${workerToken}`,
      context: { requestId, traceId: traceId(request) },
      invocationDeadlineAt: startedAt + 60_000,
      dependencies: dependencies.createWorkerDependencies({ config }),
    })
    const requiresAttention =
      batch.terminalFailed > 0 ||
      batch.manualReview > 0 ||
      batch.settlementUnknown > 0
    if (requiresAttention) {
      console.error("ADVOCATE_INVITATION_EMAIL_REQUIRES_ATTENTION", {
        requestId,
        code: "worker_batch_requires_attention",
        claimed: batch.claimed,
        terminalFailed: batch.terminalFailed,
        manualReview: batch.manualReview,
        settlementUnknown: batch.settlementUnknown,
      })
    }
    return safeResponse({
      ok: !requiresAttention,
      requestId,
      ...(requiresAttention ? { code: "worker_batch_requires_attention" } : {}),
      batch,
    })
  } catch {
    console.error("ADVOCATE_INVITATION_EMAIL_REQUIRES_ATTENTION", {
      requestId,
      code: "worker_execution_failed",
      claimed: 0,
      terminalFailed: 0,
      manualReview: 0,
      settlementUnknown: 0,
    })
    return safeResponse({
      ok: false,
      requestId,
      code: "worker_execution_failed",
    })
  }
}
