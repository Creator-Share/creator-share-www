import { NextResponse } from "next/server"

import {
  classifyCreatorShareInitialOwnerRevocationFailure,
  createCreatorShareInitialOwnerRevocationRepository,
  CreatorShareInitialOwnerRevocationRepositoryError,
} from "@/lib/advocates/creatorShareAdmin/initialOwnerRevocation"
import {
  parseCreatorShareInitialOwnerRevocationRequest,
  readBoundedCreatorShareInitialOwnerRevocationBody,
} from "@/lib/advocates/creatorShareAdmin/initialOwnerRevocationContracts"
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

  let client: Awaited<ReturnType<typeof createClient>>
  try {
    client = await createClient()
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
  } catch {
    console.error("CREATOR_SHARE_INITIAL_OWNER_REVOCATION_AUTH_UNAVAILABLE")
    return response(
      {
        ok: false,
        operationId: null,
        code: "initial_owner_revocation_unavailable",
      },
      503,
    )
  }

  const { id: advocateId } = await params
  if (!isCreatorShareAdvocateControlPathId(advocateId)) {
    return response(
      { ok: false, operationId: null, code: "invalid_request" },
      400,
    )
  }
  const rawBody =
    await readBoundedCreatorShareInitialOwnerRevocationBody(request)
  const input =
    rawBody === null
      ? null
      : parseCreatorShareInitialOwnerRevocationRequest(rawBody)
  if (input === null) {
    return response(
      { ok: false, operationId: null, code: "invalid_request" },
      400,
    )
  }

  const forensicContext = creatorShareAdvocateControlForensicContext(request)
  try {
    const result = await createCreatorShareInitialOwnerRevocationRepository(
      client,
    ).revoke({
      advocateId,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
      operationId: input.operationId,
      context: {
        traceId: creatorShareAdvocateControlTraceId(request, input.operationId),
        sessionId: null,
        clientIp: forensicContext.clientIp,
        userAgent: forensicContext.userAgent,
      },
    })
    return response(
      {
        ok: true,
        operationId: result.operationId,
        advocateId: result.advocateId,
        advocateVersion: result.advocateVersion,
        revocationStatus: result.revocationStatus,
      },
      result.created ? 201 : 200,
    )
  } catch (error) {
    const failure = classifyCreatorShareInitialOwnerRevocationFailure(
      error instanceof CreatorShareInitialOwnerRevocationRepositoryError
        ? error.postgresCode
        : undefined,
    )
    if (failure.status >= 500) {
      console.error("CREATOR_SHARE_INITIAL_OWNER_REVOCATION_FAILED", {
        operationId: input.operationId,
        stage:
          error instanceof CreatorShareInitialOwnerRevocationRepositoryError
            ? error.stage
            : "unexpected",
      })
    }
    return response(
      { ok: false, operationId: input.operationId, code: failure.code },
      failure.status,
    )
  }
}
