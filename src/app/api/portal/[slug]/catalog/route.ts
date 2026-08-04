import { NextResponse } from "next/server"

import {
  createAdvocatePortalAccessRepository,
  findAdvocatePortalAccessBySlug,
} from "@/lib/advocates/admin/access"
import {
  AdvocateCatalogDatabaseError,
  classifyAdvocateCatalogUpdateFailure,
  parseAdvocateCatalogUpdateInput,
  readBoundedAdvocateCatalogBody,
  replaceAdvocateCatalogConfiguration,
} from "@/lib/advocates/admin/catalog"
import { advocatePortalMutationRequestContext } from "@/lib/advocates/admin/requestContext"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const context = advocatePortalMutationRequestContext(request)
  const { requestId } = context
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
    console.error("ADVOCATE_PORTAL_CATALOG_FAILED", {
      requestId,
      code: "access_unavailable",
    })
    return response(
      { ok: false, code: "catalog_update_failed", requestId },
      500,
    )
  }
  if (portal === null) {
    return response({ ok: false, code: "portal_not_found", requestId }, 404)
  }
  if (!portal.permissions.includes("portal.beneficiaries.manage")) {
    return response({ ok: false, code: "forbidden", requestId }, 403)
  }

  const rawBody = await readBoundedAdvocateCatalogBody(request)
  const input =
    rawBody === null ? null : parseAdvocateCatalogUpdateInput(rawBody)
  if (input === null) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }

  try {
    const advocateVersion = await replaceAdvocateCatalogConfiguration(
      createServiceRoleClient(),
      {
        advocateId: portal.advocateId,
        actorUserId: user.id,
        input,
        ...context,
      },
    )
    return response({ ok: true, requestId, advocateVersion }, 200)
  } catch (error) {
    const postgresCode =
      error instanceof AdvocateCatalogDatabaseError
        ? error.postgresCode
        : undefined
    const postgresMessage =
      error instanceof AdvocateCatalogDatabaseError
        ? error.postgresMessage
        : undefined
    const failure = classifyAdvocateCatalogUpdateFailure(
      postgresCode,
      postgresMessage,
    )
    if (failure.status === 500) {
      console.error("ADVOCATE_PORTAL_CATALOG_FAILED", {
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
