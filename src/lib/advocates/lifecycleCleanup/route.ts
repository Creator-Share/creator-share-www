import "server-only"

import { randomUUID } from "node:crypto"

import {
  isAuthorizedArchivedAdvocateDomainCleanupWorkerRequest,
  loadArchivedAdvocateDomainCleanupWorkerSecret,
  type ArchivedAdvocateDomainCleanupEnvironment,
} from "./auth"
import { loadArchivedAdvocateDomainCleanupWorkerConfig } from "./config"
import {
  emptyArchivedAdvocateDomainCleanupSummary,
  runArchivedAdvocateDomainCleanupWorker,
  type ArchivedAdvocateDomainCleanupRpcExecutor,
  type ArchivedAdvocateDomainCleanupSummary,
} from "./worker"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface ArchivedAdvocateDomainCleanupRouteDependencies {
  createExecutor: () => ArchivedAdvocateDomainCleanupRpcExecutor
  environment?: ArchivedAdvocateDomainCleanupEnvironment
  requestId?: () => string
  workerId?: () => string
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

function safeResponse(options: {
  ok: boolean
  requestId: string
  code?: string
  summary?: ArchivedAdvocateDomainCleanupSummary
}): Response {
  const summary = options.summary ?? emptyArchivedAdvocateDomainCleanupSummary()
  return response(
    {
      ok: options.ok,
      ...(options.code === undefined ? {} : { code: options.code }),
      requestId: options.requestId,
      processedDomains: summary.processedDomains,
      jobsEnqueued: summary.jobsEnqueued,
      quiescingDomains: summary.quiescingDomains,
      cloudflareDnsRemoval: summary.cloudflareDnsRemoval,
      providerCleanup: summary.providerCleanup,
      blockedDomains: summary.blockedDomains,
    },
    options.ok ? 200 : options.code === "unauthorized" ? 401 : 503,
  )
}

export async function handleArchivedAdvocateDomainCleanupRequest(
  request: Request,
  dependencies: ArchivedAdvocateDomainCleanupRouteDependencies,
): Promise<Response> {
  const requestId = (dependencies.requestId ?? randomUUID)()
  if (!UUID_PATTERN.test(requestId)) {
    return safeResponse({
      ok: false,
      requestId: "unavailable",
      code: "worker_unavailable",
    })
  }

  const environment = dependencies.environment ?? process.env
  let expectedSecret: string
  try {
    expectedSecret = loadArchivedAdvocateDomainCleanupWorkerSecret(environment)
  } catch {
    return safeResponse({
      ok: false,
      requestId,
      code: "worker_unavailable",
    })
  }
  if (
    !isAuthorizedArchivedAdvocateDomainCleanupWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return safeResponse({ ok: false, requestId, code: "unauthorized" })
  }

  const workerId = (dependencies.workerId ?? randomUUID)()
  if (!UUID_PATTERN.test(workerId)) {
    return safeResponse({
      ok: false,
      requestId,
      code: "worker_unavailable",
    })
  }

  try {
    const config = loadArchivedAdvocateDomainCleanupWorkerConfig(environment)
    const summary = await runArchivedAdvocateDomainCleanupWorker({
      ...config,
      coordinatorId: `advocate-domain-lifecycle-coordinator:${workerId}`,
      executor: dependencies.createExecutor(),
      timeoutSignal: dependencies.timeoutSignal,
    })
    const requiresAttention = summary.blockedDomains > 0
    if (requiresAttention) {
      console.error("ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_REQUIRES_ATTENTION", {
        requestId,
        code: "worker_batch_requires_attention",
        processedDomains: summary.processedDomains,
        jobsEnqueued: summary.jobsEnqueued,
        quiescingDomains: summary.quiescingDomains,
        blockedDomains: summary.blockedDomains,
      })
    }
    return safeResponse({
      ok: !requiresAttention,
      requestId,
      ...(requiresAttention ? { code: "worker_batch_requires_attention" } : {}),
      summary,
    })
  } catch {
    console.error("ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_REQUIRES_ATTENTION", {
      requestId,
      code: "worker_execution_failed",
      processedDomains: 0,
      jobsEnqueued: 0,
      quiescingDomains: 0,
      blockedDomains: 0,
    })
    return safeResponse({
      ok: false,
      requestId,
      code: "worker_execution_failed",
    })
  }
}
