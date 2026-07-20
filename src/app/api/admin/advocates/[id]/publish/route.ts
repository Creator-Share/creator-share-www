import { createHash, randomUUID } from "node:crypto"

import { after, NextResponse } from "next/server"

import {
  createPublicationCanaryDeploymentAuthorizationDatabase,
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
  createPublicationCanarySentinelBootstrapRuntimeDependencies,
  loadPublicationCanaryDeploymentIdentity,
  PublicationCanaryRuntimeConfigurationError,
} from "@/lib/advocates/publicationCanary/runtime"
import {
  PUBLICATION_CANARY_SENTINEL_INVOCATION_BUDGET_MS,
  runAfterPublicationCanarySentinel,
} from "@/lib/advocates/publicationCanary/sentinelBootstrap"
import { createPublicationCanarySentinelEvidenceRepository } from "@/lib/advocates/publicationCanary/sentinelEvidence"
import { runWhenProviderAutomationActive } from "@/lib/advocates/providerAutomation"
import {
  creatorShareAdvocateControlForensicContext,
  creatorShareAdvocateControlTraceId,
  isTrustedCreatorShareAdvocateControlRequest,
} from "@/lib/advocates/creatorShareAdmin/routeSecurity"
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
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isTrustedCreatorShareAdvocateControlRequest(request)) {
    return response(
      { ok: false, code: "invalid_request", operationId: null },
      400,
    )
  }

  const { id: advocateId } = await params
  if (!UUID_PATTERN.test(advocateId)) {
    return response(
      { ok: false, code: "invalid_request", operationId: null },
      400,
    )
  }
  if (
    !isPublicationCanaryJsonContentType(request.headers.get("content-type"))
  ) {
    return response(
      { ok: false, code: "invalid_request", operationId: null },
      400,
    )
  }
  const rawBody = await readBoundedPublicationCanaryBody(request)
  if (rawBody === null) {
    return response(
      { ok: false, code: "invalid_request", operationId: null },
      400,
    )
  }
  const input = parsePublicationCanaryOperationInput(rawBody)
  if (input === null) {
    return response(
      { ok: false, code: "invalid_request", operationId: null },
      400,
    )
  }

  let authenticatedClient: Awaited<ReturnType<typeof createClient>>
  try {
    authenticatedClient = await createClient()
    const auth = await requireSuperAdmin(authenticatedClient)
    if (!auth.ok) {
      const status = auth.response.status === 401 ? 401 : 403
      return response(
        {
          ok: false,
          code: status === 401 ? "unauthorized" : "forbidden",
          operationId: input.operationId,
        },
        status,
      )
    }
  } catch {
    console.error("ADVOCATE_PUBLICATION_AUTH_UNAVAILABLE")
    return response(
      {
        ok: false,
        code: "publication_unavailable",
        operationId: input.operationId,
      },
      503,
    )
  }

  const traceId = creatorShareAdvocateControlTraceId(request, input.operationId)
  const forensicContext = creatorShareAdvocateControlForensicContext(request)
  try {
    const deploymentIdentity = loadPublicationCanaryDeploymentIdentity()
    const result = await handlePublicationCanaryOperation(
      {
        advocateId,
        expectedVersion: input.expectedVersion,
        operationId: input.operationId,
        adminReason: input.adminReason,
        traceId,
        deploymentId: deploymentIdentity.deploymentId,
        revision: deploymentIdentity.revision,
        clientIp: forensicContext.clientIp,
        userAgent: forensicContext.userAgent,
      },
      {
        database: createPublicationCanaryOperationDatabase(
          authenticatedClient,
          () =>
            createPublicationCanaryDeploymentAuthorizationDatabase(
              createServiceRoleClient(),
            ),
        ),
      },
    )

    if (result.outcome === "pending") {
      if (result.workerKickoff) {
        after(async () => {
          try {
            const automation = await runWhenProviderAutomationActive(
              async () => {
                const serviceRoleClient = createServiceRoleClient()
                const workerDatabase =
                  createPublicationCanaryWorkerDatabase(serviceRoleClient)
                const monotonicNow = () => performance.now()
                const deadlineAtMilliseconds =
                  monotonicNow() +
                  PUBLICATION_CANARY_SENTINEL_INVOCATION_BUDGET_MS
                const requestReferenceSha256 = createHash("sha256")
                  .update(randomUUID())
                  .digest("hex")
                const sentinel = await runAfterPublicationCanarySentinel(
                  {
                    runId: randomUUID(),
                    requestReferenceSha256,
                  },
                  {
                    ...createPublicationCanarySentinelBootstrapRuntimeDependencies(
                      {
                        deadlineAtMilliseconds,
                        monotonicNow,
                      },
                    ),
                    evidence: createPublicationCanarySentinelEvidenceRepository(
                      createServiceRoleClient({
                        requestTimeoutMilliseconds: 8_000,
                      }),
                    ),
                  },
                  () =>
                    processNextPublicationCanaryExecution(
                      deploymentIdentity,
                      {
                        database: workerDatabase,
                        runnerDependencies:
                          createPublicationCanaryRuntimeDependencies({
                            serviceRoleClient,
                            deploymentIdentity,
                          }),
                      },
                    ),
                )
                return { sentinel, requestReferenceSha256 }
              },
            )
            if (!automation.active) return

            const { sentinel, requestReferenceSha256 } = automation.value
            if (!sentinel.ready) {
              if (sentinel.outcome === "failed") {
                console.error(
                  "ADVOCATE_PUBLICATION_SENTINEL_REQUIRES_ATTENTION",
                  {
                    requestReferenceSha256,
                    code: "sentinel_reconciliation_failed",
                  },
                )
              }
              return
            }
            if (sentinel.execution.outcome === "failed") {
              console.error("ADVOCATE_PUBLICATION_CANARY_REQUIRES_ATTENTION", {
                operationId: input.operationId,
                runId: sentinel.execution.runId,
                failureCode: sentinel.execution.failureCode,
              })
            }
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
    if (result.outcome === "deployment_changed") {
      return response(
        {
          ok: false,
          code: "publication_deployment_changed",
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
          retryWithNewOperationId: true,
        },
        409,
      )
    }
    return response(
      {
        ok: true,
        code: "publication_committed",
        operationId: input.operationId,
        runId: result.runId,
        advocateVersion: result.advocateVersion,
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
