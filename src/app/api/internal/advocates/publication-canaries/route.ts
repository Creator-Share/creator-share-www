import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  createPublicationCanaryWorkerDatabase,
  PublicationCanaryDatabaseError,
} from "@/lib/advocates/publicationCanary/database"
import { processNextPublicationCanaryExecution } from "@/lib/advocates/publicationCanary/execute"
import {
  createPublicationCanaryRuntimeDependencies,
  loadPublicationCanaryDeploymentIdentity,
  PublicationCanaryRuntimeConfigurationError,
} from "@/lib/advocates/publicationCanary/runtime"
import {
  isAuthorizedPublicationCanaryWorkerRequest,
  loadPublicationCanaryWorkerSecret,
} from "@/lib/advocates/publicationCanary/workerAuth"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

async function handle(request: Request): Promise<NextResponse> {
  const requestId = randomUUID()
  let expectedSecret: string
  try {
    expectedSecret = loadPublicationCanaryWorkerSecret()
  } catch {
    return response({ ok: false, code: "worker_unavailable", requestId }, 503)
  }
  if (
    !isAuthorizedPublicationCanaryWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ ok: false, code: "unauthorized", requestId }, 401)
  }

  try {
    const deploymentIdentity = loadPublicationCanaryDeploymentIdentity()
    const serviceRoleClient = createServiceRoleClient()
    const result = await processNextPublicationCanaryExecution(
      deploymentIdentity,
      {
        database: createPublicationCanaryWorkerDatabase(serviceRoleClient),
        runnerDependencies: createPublicationCanaryRuntimeDependencies({
          serviceRoleClient,
          deploymentIdentity,
        }),
      },
    )
    if (result.outcome === "failed") {
      console.error("ADVOCATE_PUBLICATION_CANARY_REQUIRES_ATTENTION", {
        requestId,
        runId: result.runId,
        failureCode: result.failureCode,
      })
    }
    return response(
      {
        ok: result.outcome !== "failed",
        requestId,
        ...result,
      },
      200,
    )
  } catch (error) {
    console.error("ADVOCATE_PUBLICATION_WORKER_FAILED", {
      requestId,
      stage:
        error instanceof PublicationCanaryDatabaseError
          ? error.stage
          : error instanceof PublicationCanaryRuntimeConfigurationError
            ? "configuration"
            : "execution",
    })
    return response(
      { ok: false, code: "worker_execution_failed", requestId },
      503,
    )
  }
}

export const GET = handle
export const POST = handle
