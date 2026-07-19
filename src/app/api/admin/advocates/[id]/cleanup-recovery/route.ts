import { NextResponse } from "next/server"

import {
  parseCreatorShareAdvocateCleanupRecoveryRequest,
  readBoundedCreatorShareAdvocateControlBody,
} from "@/lib/advocates/creatorShareAdmin/lifecycleContracts"
import {
  classifyCreatorShareAdvocateCleanupRecoveryFailure,
  createCreatorShareAdvocateControlRepository,
  CreatorShareAdvocateControlRepositoryError,
} from "@/lib/advocates/creatorShareAdmin/lifecycle"
import {
  creatorShareAdvocateControlForensicContext,
  creatorShareAdvocateControlTraceId,
  isCreatorShareAdvocateControlPathId,
  isTrustedCreatorShareAdvocateControlRequest,
} from "@/lib/advocates/creatorShareAdmin/routeSecurity"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isTrustedCreatorShareAdvocateControlRequest(request)) {
    return response(
      { ok: false, operationId: null, code: "invalid_request" },
      400,
    )
  }

  const client = await createClient()
  const auth = await requireSuperAdmin(client)
  if (!auth.ok) {
    const status = auth.response.status === 401 ? 401 : 403
    return response(
      {
        ok: false,
        operationId: null,
        code: status === 401 ? "unauthorized" : "forbidden",
      },
      status,
    )
  }

  const { id: advocateId } = await params
  if (!isCreatorShareAdvocateControlPathId(advocateId)) {
    return response(
      { ok: false, operationId: null, code: "invalid_request" },
      400,
    )
  }

  const rawBody = await readBoundedCreatorShareAdvocateControlBody(request)
  const input =
    rawBody === null
      ? null
      : parseCreatorShareAdvocateCleanupRecoveryRequest(rawBody)
  if (input === null) {
    return response(
      { ok: false, operationId: null, code: "invalid_request" },
      400,
    )
  }

  const forensicContext = creatorShareAdvocateControlForensicContext(request)
  try {
    const result = await createCreatorShareAdvocateControlRepository(
      client,
    ).retryCleanup({
      advocateId,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
      operationId: input.operationId,
      traceId: creatorShareAdvocateControlTraceId(request, input.operationId),
      clientIp: forensicContext.clientIp,
      userAgent: forensicContext.userAgent,
    })
    return response(
      {
        ok: true,
        operationId: input.operationId,
        advocateVersion: result.advocateVersion,
        cleanupPhase: result.cleanupPhase,
        cleanupRetryRequested: result.cleanupRetryRequested,
      },
      200,
    )
  } catch (error) {
    const failure = classifyCreatorShareAdvocateCleanupRecoveryFailure(
      error instanceof CreatorShareAdvocateControlRepositoryError
        ? error.postgresCode
        : undefined,
    )
    if (failure.status === 500) {
      console.error("CREATOR_SHARE_ADVOCATE_CLEANUP_RECOVERY_FAILED", {
        operationId: input.operationId,
        stage:
          error instanceof CreatorShareAdvocateControlRepositoryError
            ? error.stage
            : "unexpected",
      })
    }
    return response(
      {
        ok: false,
        operationId: input.operationId,
        code: failure.code,
      },
      failure.status,
    )
  }
}
