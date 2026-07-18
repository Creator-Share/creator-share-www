import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import {
  createDomainProviderAdapterFactory,
  createSupabaseDomainProvisioningRepository,
  isAuthorizedDomainWorkerRequest,
  loadDomainWorkerConfig,
  loadWorkerRouteSecret,
  runDomainProvisioningBatch,
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

export async function POST(request: NextRequest) {
  let expectedSecret: string
  try {
    expectedSecret = loadWorkerRouteSecret()
  } catch {
    return response({ ok: false, code: "worker_unavailable" }, 503)
  }

  if (
    !isAuthorizedDomainWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ ok: false, code: "unauthorized" }, 401)
  }

  try {
    const config = loadDomainWorkerConfig()
    const repository = createSupabaseDomainProvisioningRepository(
      createServiceRoleClient(),
    )
    const batch = await runDomainProvisioningBatch({
      repository,
      adapterFactory: createDomainProviderAdapterFactory(),
      config,
      workerId: `advocate-domain-worker:${randomUUID()}`,
    })

    return response(
      {
        ok: true,
        claimed: batch.claimed,
        succeeded: batch.succeeded,
        retried: batch.retried,
        failed: batch.failed,
        leaseLost: batch.leaseLost,
        settlementUnknown: batch.settlementUnknown,
      },
      200,
    )
  } catch {
    return response({ ok: false, code: "worker_execution_failed" }, 503)
  }
}
