import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import {
  createDomainProviderAdapterFactory,
  createSupabaseDomainProvisioningRepository,
  isAuthorizedDomainWorkerRequest,
  loadDomainWorkerConfig,
  loadWorkerRouteSecret,
  runScheduledDomainProvisioningBatch,
} from "@/lib/advocates/provisioning"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

async function handle(request: NextRequest) {
  const requestId = randomUUID()
  let expectedSecret: string
  try {
    expectedSecret = loadWorkerRouteSecret()
  } catch {
    return response(
      { ok: false, code: "worker_unavailable", requestId },
      503,
    )
  }

  if (
    !isAuthorizedDomainWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ ok: false, code: "unauthorized", requestId }, 401)
  }

  try {
    const config = loadDomainWorkerConfig()
    const repository = createSupabaseDomainProvisioningRepository(
      createServiceRoleClient(),
    )
    const batch = await runScheduledDomainProvisioningBatch({
      repository,
      adapterFactory: createDomainProviderAdapterFactory(),
      config,
      workerId: `advocate-domain-worker:${requestId}`,
      correlationId: `advocate-domain-reconciliation:${requestId}`,
    })

    const requiresAttention =
      batch.schedulingFailed ||
      batch.quarantinedDomains > 0 ||
      batch.failed > 0 ||
      batch.settlementUnknown > 0 ||
      batch.withdrawnPublications > 0
    if (requiresAttention) {
      console.error("ADVOCATE_DOMAIN_PROVISIONING_REQUIRES_ATTENTION", {
        requestId,
        code: "worker_partial_failure",
        schedulingFailed: batch.schedulingFailed,
        quarantinedDomains: batch.quarantinedDomains,
        failed: batch.failed,
        settlementUnknown: batch.settlementUnknown,
        withdrawnPublications: batch.withdrawnPublications,
      })
    }

    return response(
      {
        ok: !requiresAttention,
        ...(requiresAttention ? { code: "worker_partial_failure" } : {}),
        requestId,
        scheduledDomains: batch.scheduledDomains,
        enqueuedReconciliations: batch.enqueuedReconciliations,
        quarantinedDomains: batch.quarantinedDomains,
        schedulingFailed: batch.schedulingFailed,
        ...(batch.schedulingFailureCode
          ? { schedulingFailureCode: batch.schedulingFailureCode }
          : {}),
        claimed: batch.claimed,
        succeeded: batch.succeeded,
        retried: batch.retried,
        failed: batch.failed,
        leaseLost: batch.leaseLost,
        settlementUnknown: batch.settlementUnknown,
        withdrawnPublications: batch.withdrawnPublications,
      },
      requiresAttention ? 503 : 200,
    )
  } catch {
    console.error("ADVOCATE_DOMAIN_PROVISIONING_REQUIRES_ATTENTION", {
      requestId,
      code: "worker_execution_failed",
    })
    return response(
      { ok: false, code: "worker_execution_failed", requestId },
      503,
    )
  }
}

export const GET = handle
export const POST = handle
