import { NextResponse } from "next/server"

import {
  createAdvocatePortalAccessRepository,
  findAdvocatePortalAccessBySlug,
} from "@/lib/advocates/admin/access"
import {
  AdvocateInvitationRepositoryError,
  createAdvocateInvitationRepository,
} from "@/lib/advocates/invitations/administration"
import {
  isAdvocateInvitationId,
  parseAdvocateInvitationRevokeInput,
  readBoundedAdvocateInvitationBody,
} from "@/lib/advocates/invitations/administrationContracts"
import { advocateInvitationRequestContext } from "@/lib/advocates/invitations/requestContext"
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
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function classifyFailure(error: unknown): { status: number; code: string } {
  const postgresCode =
    error instanceof AdvocateInvitationRepositoryError
      ? error.postgresCode
      : undefined
  switch (postgresCode) {
    case "42501":
    case "28000":
      return { status: 403, code: "permission_changed" }
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "55000":
    case "23514":
      return { status: 409, code: "lifecycle_conflict" }
    default:
      return { status: 500, code: "invitation_revoke_failed" }
  }
}

async function loadAuthentication() {
  const authenticatedClient = await createClient()
  const {
    data: { user },
  } = await authenticatedClient.auth.getUser()
  return { authenticatedClient, user }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; invitationId: string }> },
): Promise<NextResponse> {
  const context = advocateInvitationRequestContext(request)
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response(
      { ok: false, code: "invalid_request", requestId: context.requestId },
      400,
    )
  }

  let authentication: Awaited<ReturnType<typeof loadAuthentication>>
  try {
    authentication = await loadAuthentication()
  } catch {
    console.error("ADVOCATE_PORTAL_INVITATION_FAILED", {
      requestId: context.requestId,
      code: "authentication_unavailable",
    })
    return response(
      {
        ok: false,
        code: "invitation_revoke_failed",
        requestId: context.requestId,
      },
      500,
    )
  }
  const { authenticatedClient, user } = authentication
  if (!user) {
    return response(
      { ok: false, code: "unauthorized", requestId: context.requestId },
      401,
    )
  }

  const { slug, invitationId } = await params
  if (!isAdvocateInvitationId(invitationId)) {
    return response(
      { ok: false, code: "invitation_not_found", requestId: context.requestId },
      404,
    )
  }

  let portal
  try {
    const portals =
      await createAdvocatePortalAccessRepository(
        authenticatedClient,
      ).listForCurrentUser()
    portal = findAdvocatePortalAccessBySlug(portals, slug)
  } catch {
    console.error("ADVOCATE_PORTAL_INVITATION_FAILED", {
      requestId: context.requestId,
      code: "access_unavailable",
    })
    return response(
      {
        ok: false,
        code: "invitation_revoke_failed",
        requestId: context.requestId,
      },
      500,
    )
  }
  if (portal === null) {
    return response(
      { ok: false, code: "portal_not_found", requestId: context.requestId },
      404,
    )
  }
  if (!portal.permissions.includes("portal.members.invite")) {
    return response(
      { ok: false, code: "forbidden", requestId: context.requestId },
      403,
    )
  }

  const rawBody = await readBoundedAdvocateInvitationBody(request)
  const input =
    rawBody === null ? null : parseAdvocateInvitationRevokeInput(rawBody)
  if (input === null) {
    return response(
      { ok: false, code: "invalid_request", requestId: context.requestId },
      400,
    )
  }

  try {
    const revoked = await createAdvocateInvitationRepository({
      authenticatedClient,
      serviceClient: createServiceRoleClient(),
    }).revoke({
      advocateId: portal.advocateId,
      invitationId,
      actingUserId: user.id,
      reason: input.reason,
      context,
    })
    return response({ ok: true, requestId: context.requestId, revoked }, 200)
  } catch (error) {
    const failure = classifyFailure(error)
    if (failure.status === 500) {
      console.error("ADVOCATE_PORTAL_INVITATION_FAILED", {
        requestId: context.requestId,
        code: failure.code,
      })
    }
    return response(
      { ok: false, code: failure.code, requestId: context.requestId },
      failure.status,
    )
  }
}
