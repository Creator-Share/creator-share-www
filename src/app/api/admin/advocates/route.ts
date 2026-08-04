import { NextResponse } from "next/server"

import {
  parseCreatorShareAdvocateOnboardingRequest,
  readBoundedCreatorShareAdvocateOnboardingBody,
} from "@/lib/advocates/creatorShareAdmin/onboardingContracts"
import {
  classifyCreatorShareAdvocateOnboardingFailure,
  createCreatorShareAdvocateOnboardingRepository,
  CreatorShareAdvocateOnboardingRepositoryError,
} from "@/lib/advocates/creatorShareAdmin/onboarding"
import {
  creatorShareAdvocateControlForensicContext,
  creatorShareAdvocateControlTraceId,
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

export async function POST(request: Request): Promise<NextResponse> {
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
    console.error("CREATOR_SHARE_ADVOCATE_ONBOARDING_AUTH_UNAVAILABLE")
    return response(
      { ok: false, operationId: null, code: "onboarding_unavailable" },
      503,
    )
  }

  const rawBody = await readBoundedCreatorShareAdvocateOnboardingBody(request)
  const input =
    rawBody === null
      ? null
      : parseCreatorShareAdvocateOnboardingRequest(rawBody)
  if (input === null) {
    return response(
      { ok: false, operationId: null, code: "invalid_request" },
      400,
    )
  }

  const forensicContext = creatorShareAdvocateControlForensicContext(request)
  try {
    const result = await createCreatorShareAdvocateOnboardingRepository(
      client,
    ).onboard({
      onboarding: input,
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
        onboardingStatus: result.onboardingStatus,
      },
      result.created ? 201 : 200,
    )
  } catch (error) {
    const failure = classifyCreatorShareAdvocateOnboardingFailure(
      error instanceof CreatorShareAdvocateOnboardingRepositoryError
        ? error.postgresCode
        : undefined,
    )
    if (failure.status >= 500) {
      console.error("CREATOR_SHARE_ADVOCATE_ONBOARDING_FAILED", {
        operationId: input.operationId,
        stage:
          error instanceof CreatorShareAdvocateOnboardingRepositoryError
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
