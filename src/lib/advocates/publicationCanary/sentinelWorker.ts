import "server-only"

import { createHash, randomUUID as systemRandomUUID } from "node:crypto"

import {
  PROVIDER_AUTOMATION_DISABLED_RESULT,
  runWhenProviderAutomationActive,
} from "../providerAutomation"
import {
  isAuthorizedPublicationCanaryWorkerRequest,
  loadPublicationCanaryWorkerSecret,
} from "./workerAuth"
import type { PublicationCanarySentinelBootstrapResult } from "./sentinelBootstrap"

export interface PublicationCanarySentinelWorkerDependencies {
  randomUUID?: () => string
  runBootstrap(input: {
    runId: string
    requestReferenceSha256: string
  }): Promise<PublicationCanarySentinelBootstrapResult>
  logFailure?: (input: {
    code: "sentinel_reconciliation_failed" | "worker_execution_failed"
    requestReferenceSha256: string
  }) => void
  environment?: Readonly<Record<string, string | undefined>>
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

function requestReference(requestId: string): string {
  return createHash("sha256").update(requestId).digest("hex")
}

export async function handlePublicationCanarySentinelWorkerRequest(
  request: Request,
  dependencies: PublicationCanarySentinelWorkerDependencies,
): Promise<Response> {
  const requestId = (dependencies.randomUUID ?? systemRandomUUID)()
  let expectedSecret: string
  try {
    expectedSecret = loadPublicationCanaryWorkerSecret(
      dependencies.environment ?? process.env,
    )
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

  const requestReferenceSha256 = requestReference(requestId)
  try {
    const execution = await runWhenProviderAutomationActive(async () => {
      const result = await dependencies.runBootstrap({
        runId: (dependencies.randomUUID ?? systemRandomUUID)(),
        requestReferenceSha256,
      })
      return result
    }, dependencies.environment ?? process.env)
    if (!execution.active) {
      return response(PROVIDER_AUTOMATION_DISABLED_RESULT, 200)
    }
    const result = execution.value
    if (result.outcome === "ready") {
      return response({ ok: true, ready: true, requestId }, 200)
    }
    if (result.outcome === "converging") {
      return response(
        {
          ok: true,
          ready: false,
          code: "sentinel_converging",
          requestId,
        },
        202,
      )
    }
    dependencies.logFailure?.({
      code: "sentinel_reconciliation_failed",
      requestReferenceSha256,
    })
    return response(
      {
        ok: false,
        code: "sentinel_reconciliation_failed",
        requestId,
      },
      503,
    )
  } catch {
    dependencies.logFailure?.({
      code: "worker_execution_failed",
      requestReferenceSha256,
    })
    return response(
      { ok: false, code: "worker_execution_failed", requestId },
      503,
    )
  }
}
