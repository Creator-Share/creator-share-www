import { randomUUID } from "node:crypto"

import { after, NextResponse } from "next/server"

import {
  createPublicationCanaryOperationDatabase,
  createPublicationCanaryWorkerDatabase,
  PublicationCanaryDatabaseError,
} from "@/lib/advocates/publicationCanary/database"
import {
  ExecutePublicationCanaryInputError,
  handlePublicationCanaryOperation,
  processNextPublicationCanaryExecution,
} from "@/lib/advocates/publicationCanary/execute"
import {
  classifyPublicationCanaryDatabaseFailure,
  isPublicationCanaryJsonContentType,
  parsePublicationCanaryOperationInput,
  readBoundedPublicationCanaryBody,
} from "@/lib/advocates/publicationCanary/operation"
import {
  createPublicationCanaryRuntimeDependencies,
  loadPublicationCanaryDeploymentIdentity,
  PublicationCanaryRuntimeConfigurationError,
} from "@/lib/advocates/publicationCanary/runtime"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function response(
  body: Record<string, unknown>,
  status: number,
  additionalHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
  })
}

function boundedTraceId(request: Request): string {
  for (const name of ["traceparent", "x-trace-id", "x-vercel-id"]) {
    const value = request.headers.get(name)?.trim()
    if (value && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value)) {
      return value
    }
  }
  return `advocate-publication:${randomUUID()}`
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const authenticatedClient = await createClient()
  const auth = await requireSuperAdmin(authenticatedClient)
  if (!auth.ok) return auth.response

  const { id: advocateId } = await params
  if (!UUID_PATTERN.test(advocateId)) {
    return response({ ok: false, code: "invalid_request" }, 400)
  }
  if (
    !isPublicationCanaryJsonContentType(request.headers.get("content-type"))
  ) {
    return response({ ok: false, code: "invalid_request" }, 400)
  }
  const rawBody = await readBoundedPublicationCanaryBody(request)
  if (rawBody === null) {
    return response({ ok: false, code: "invalid_request" }, 400)
  }
  const input = parsePublicationCanaryOperationInput(rawBody)
  if (input === null) {
    return response({ ok: false, code: "invalid_request" }, 400)
  }

  const traceId = boundedTraceId(request)
  try {
    const deploymentIdentity = loadPublicationCanaryDeploymentIdentity()
    const serviceRoleClient = createServiceRoleClient()
    const result = await handlePublicationCanaryOperation(
      {
        actorUserId: auth.user.id,
        advocateId,
        expectedVersion: input.expectedVersion,
        operationId: input.operationId,
        adminReason: input.adminReason,
        traceId,
        deploymentId: deploymentIdentity.deploymentId,
        revision: deploymentIdentity.revision,
      },
      {
        database: createPublicationCanaryOperationDatabase(
          authenticatedClient,
          serviceRoleClient,
        ),
      },
    )

    if (result.outcome === "pending") {
      const runnerDependencies = createPublicationCanaryRuntimeDependencies({
        serviceRoleClient,
        deploymentIdentity,
      })
      if (result.workerKickoff) {
        const workerDatabase = createPublicationCanaryWorkerDatabase(
          serviceRoleClient,
        )
        after(async () => {
          try {
            await processNextPublicationCanaryExecution(deploymentIdentity, {
              database: workerDatabase,
              runnerDependencies,
            })
          } catch (error) {
            console.error("ADVOCATE_PUBLICATION_WORKER_FAILED", {
              operationId: input.operationId,
              stage:
                error instanceof PublicationCanaryDatabaseError
                  ? error.stage
                  : "execution",
            })
          }
        })
      }
      return response(
        {
          ok: true,
          code: "publication_canary_pending",
          operationId: input.operationId,
          runId: result.runId,
          publicationStatus: "verifying",
          retryAfterSeconds: result.retryAfterSeconds,
        },
        202,
        { "Retry-After": String(result.retryAfterSeconds) },
      )
    }
    if (result.outcome === "expired") {
      return response(
        {
          ok: false,
          code: "publication_canary_expired",
          operationId: input.operationId,
          runId: result.runId,
          retryWithNewOperationId: true,
        },
        409,
      )
    }
    if (result.outcome === "failed") {
      return response(
        {
          ok: false,
          code: "publication_canary_failed",
          operationId: input.operationId,
          runId: result.runId,
          reportSha256: result.reportSha256,
          failureCode: result.failureCode,
        },
        409,
      )
    }
    return response(
      {
        ok: true,
        operationId: input.operationId,
        runId: result.runId,
        reportSha256: result.reportSha256,
        advocateVersion: result.advocateVersion,
        publicationStatus: "active",
      },
      200,
    )
  } catch (error) {
    if (error instanceof PublicationCanaryDatabaseError) {
      const failure = classifyPublicationCanaryDatabaseFailure(
        error.postgresCode,
      )
      if (failure.status === 500) {
        console.error("ADVOCATE_PUBLICATION_FAILED", {
          operationId: input.operationId,
          stage: error.stage,
          code: failure.code,
        })
      }
      return response(
        {
          ok: false,
          code: failure.code,
          operationId: input.operationId,
        },
        failure.status,
      )
    }
    if (error instanceof ExecutePublicationCanaryInputError) {
      return response(
        {
          ok: false,
          code: "invalid_request",
          operationId: input.operationId,
        },
        400,
      )
    }
    const configurationUnavailable =
      error instanceof PublicationCanaryRuntimeConfigurationError
    console.error("ADVOCATE_PUBLICATION_FAILED", {
      operationId: input.operationId,
      stage: configurationUnavailable ? "configuration" : "execution",
      code: configurationUnavailable
        ? "publication_configuration_unavailable"
        : "publication_failed",
    })
    return response(
      {
        ok: false,
        code: configurationUnavailable
          ? "publication_configuration_unavailable"
          : "publication_failed",
        operationId: input.operationId,
      },
      configurationUnavailable ? 503 : 500,
    )
  }
}
