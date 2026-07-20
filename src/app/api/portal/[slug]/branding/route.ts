import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  createAdvocatePortalAccessRepository,
  findAdvocatePortalAccessBySlug,
} from "@/lib/advocates/admin/access"
import {
  AdvocateBrandingDatabaseError,
  classifyAdvocateBrandingUpdateFailure,
  deriveAdvocateBrandingRequestId,
  parseAdvocateBrandingUpdateInput,
  readBoundedAdvocateBrandingBody,
  updateAdvocateBranding,
} from "@/lib/advocates/admin/branding"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BRANDING_REQUEST_TIMEOUT_MILLISECONDS = 15_000

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function boundedTraceId(request: Request): string | null {
  for (const name of ["traceparent", "x-trace-id", "x-vercel-id"]) {
    const value = request.headers.get(name)?.trim()
    if (value && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value)) {
      return value
    }
  }
  return null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  let requestId: string = randomUUID()
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) {
    return response({ ok: false, code: "unauthorized", requestId }, 401)
  }

  const { slug } = await params
  let portal
  try {
    const portals =
      await createAdvocatePortalAccessRepository(client).listForCurrentUser()
    portal = findAdvocatePortalAccessBySlug(portals, slug)
  } catch {
    console.error("ADVOCATE_PORTAL_BRANDING_FAILED", {
      requestId,
      code: "access_unavailable",
    })
    return response(
      { ok: false, code: "branding_update_failed", requestId },
      500,
    )
  }
  if (portal === null) {
    return response({ ok: false, code: "portal_not_found", requestId }, 404)
  }
  if (!portal.permissions.includes("portal.branding.update")) {
    return response({ ok: false, code: "forbidden", requestId }, 403)
  }

  const rawBody = await readBoundedAdvocateBrandingBody(request)
  if (rawBody === null) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }
  const input = parseAdvocateBrandingUpdateInput(rawBody, portal.slug)
  if (input === null) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }

  const deterministicRequestId = deriveAdvocateBrandingRequestId({
    actorUserId: user.id,
    advocateId: portal.advocateId,
    update: input,
  })
  if (deterministicRequestId === null) {
    console.error("ADVOCATE_PORTAL_BRANDING_FAILED", {
      requestId,
      code: "invalid_identity",
    })
    return response(
      { ok: false, code: "branding_update_failed", requestId },
      500,
    )
  }
  requestId = deterministicRequestId

  try {
    const serviceClient = createServiceRoleClient({
      requestTimeoutMilliseconds: BRANDING_REQUEST_TIMEOUT_MILLISECONDS,
    })
    const advocateVersion = await updateAdvocateBranding(
      serviceClient,
      {
        advocateId: portal.advocateId,
        actorUserId: user.id,
        input,
        logoUploadReservationId: null,
        requestId,
        traceId: boundedTraceId(request),
        sessionId: null,
      },
    )
    return response({ ok: true, requestId, advocateVersion }, 200)
  } catch (error) {
    const postgresCode =
      error instanceof AdvocateBrandingDatabaseError
        ? error.postgresCode
        : undefined
    const failure = classifyAdvocateBrandingUpdateFailure(postgresCode)
    if (failure.status === 500) {
      console.error("ADVOCATE_PORTAL_BRANDING_FAILED", {
        requestId,
        code: failure.code,
      })
    }
    return response(
      { ok: false, code: failure.code, requestId },
      failure.status,
    )
  }
}
