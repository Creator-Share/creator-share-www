import { NextRequest, NextResponse } from "next/server"

import {
  advocateAttributionIdentityCookieSetHeaders,
  createAdvocateAttributionIdentityCookieValue,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  ADVOCATE_INVITATION_RECOVER_PATH,
  parseAdvocateInvitationRecoveryBody,
} from "@/lib/advocates/invitations/material"
import {
  AdvocateInvitationRedemptionError,
  recoverAdvocateInvitationRedemption,
} from "@/lib/advocates/invitations/redemption"
import { advocateInvitationRequestContext } from "@/lib/advocates/invitations/requestContext"
import {
  advocateInvitationJsonResponse,
  isTrustedAdvocateInvitationJsonRequest,
  readBoundedAdvocateInvitationBody,
  resolveTrustedAdvocateInvitationOrigin,
} from "@/lib/advocates/invitations/routeSecurity"
import { createAdvocateInvitationRouteClient } from "@/lib/advocates/invitations/routeClient"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function failure(error: unknown): { status: number; code: string } {
  if (!(error instanceof AdvocateInvitationRedemptionError)) {
    return { status: 503, code: "recovery_unavailable" }
  }
  if (error.stage === "authentication") {
    return { status: 401, code: "authentication_required" }
  }
  switch (error.postgresCode) {
    case "42501":
      return { status: 410, code: "invalid_or_expired" }
    case "28000":
      return { status: 401, code: "authentication_required" }
    case "22023":
      return { status: 400, code: "invalid_request" }
    default:
      return { status: 503, code: "recovery_unavailable" }
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = advocateInvitationRequestContext(request)
  const trustedOrigin = resolveTrustedAdvocateInvitationOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    trustedOrigin === null ||
    !isTrustedAdvocateInvitationJsonRequest(
      request,
      ADVOCATE_INVITATION_RECOVER_PATH,
    )
  ) {
    return advocateInvitationJsonResponse(
      { ok: false, code: "invalid_request" },
      400,
    )
  }

  const rawBody = await readBoundedAdvocateInvitationBody(request)
  const recoveryRequest =
    rawBody === null ? null : parseAdvocateInvitationRecoveryBody(rawBody)
  if (recoveryRequest === null) {
    return advocateInvitationJsonResponse(
      { ok: false, code: "invalid_request" },
      400,
    )
  }

  const secureCookies = trustedOrigin === "https://creatorshare.com"
  const routeClient = createAdvocateInvitationRouteClient(
    request,
    secureCookies,
  )
  if (routeClient === null) {
    return advocateInvitationJsonResponse(
      { ok: false, code: "recovery_unavailable" },
      503,
    )
  }

  try {
    const result = await recoverAdvocateInvitationRedemption({
      client: routeClient.client,
      request: recoveryRequest,
    })
    const resultResponse = advocateInvitationJsonResponse(
      {
        ok: true,
        operationId: recoveryRequest.operationId,
        redirect: "/portal",
      },
      200,
    )
    routeClient.applyCookies(resultResponse)
    const identitySignal = createAdvocateAttributionIdentityCookieValue(
      {
        authUserId: result.authUserId,
      },
      { rawHost: request.headers.get("host") },
    )
    if (identitySignal) {
      for (const header of advocateAttributionIdentityCookieSetHeaders(
        identitySignal,
        request.headers.get("host"),
        secureCookies,
      )) {
        resultResponse.headers.append("Set-Cookie", header)
      }
    }
    return resultResponse
  } catch (error) {
    const classified = failure(error)
    if (classified.status === 503) {
      console.error("ADVOCATE_INVITATION_REDEMPTION_RECOVERY_FAILED", {
        requestId: context.requestId,
        code: classified.code,
      })
    }
    const failureResponse = advocateInvitationJsonResponse(
      { ok: false, code: classified.code },
      classified.status,
    )
    try {
      return routeClient.applyCookies(failureResponse)
    } catch {
      return advocateInvitationJsonResponse(
        { ok: false, code: "recovery_unavailable" },
        503,
      )
    }
  }
}
