import { NextRequest, NextResponse } from "next/server"

import {
  advocateAttributionIdentityCookieSetHeaders,
  createAdvocateAttributionIdentityCookieValue,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  parseAdvocateInvitationRedeemBody,
  ADVOCATE_INVITATION_REDEEM_PATH,
} from "@/lib/advocates/invitations/material"
import {
  AdvocateInvitationRedemptionError,
  redeemAdvocateInvitation,
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

function response(body: Record<string, unknown>, status: number): NextResponse {
  return advocateInvitationJsonResponse(body, status)
}

function classifyFailure(error: unknown): { status: number; code: string } {
  if (!(error instanceof AdvocateInvitationRedemptionError)) {
    return { status: 503, code: "redemption_unavailable" }
  }
  if (error.stage === "authentication") {
    return { status: 401, code: "authentication_required" }
  }
  switch (error.postgresCode) {
    case "42501":
      return { status: 410, code: "invalid_or_expired" }
    case "28000":
      return { status: 401, code: "authentication_required" }
    case "23505":
    case "55000":
      return { status: 409, code: "membership_conflict" }
    case "40001":
      return { status: 409, code: "redemption_conflict" }
    case "22023":
      return { status: 400, code: "invalid_request" }
    default:
      return { status: 503, code: "redemption_unavailable" }
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
      ADVOCATE_INVITATION_REDEEM_PATH,
    )
  ) {
    return response({ ok: false, code: "invalid_request" }, 400)
  }

  const rawBody = await readBoundedAdvocateInvitationBody(request)
  const redemptionRequest =
    rawBody === null ? null : parseAdvocateInvitationRedeemBody(rawBody)
  if (redemptionRequest === null) {
    return response({ ok: false, code: "invalid_request" }, 400)
  }

  const secureCookies = trustedOrigin === "https://creatorshare.com"
  const routeClient = createAdvocateInvitationRouteClient(
    request,
    secureCookies,
  )
  if (routeClient === null) {
    return response({ ok: false, code: "redemption_unavailable" }, 503)
  }

  try {
    const result = await redeemAdvocateInvitation({
      client: routeClient.client,
      request: redemptionRequest,
      context,
    })
    const resultResponse = response(
      {
        ok: true,
        operationId: redemptionRequest.operationId,
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
    const failure = classifyFailure(error)
    if (failure.status === 503) {
      console.error("ADVOCATE_INVITATION_REDEMPTION_FAILED", {
        requestId: context.requestId,
        code: failure.code,
      })
    }
    const failureResponse = response(
      { ok: false, code: failure.code },
      failure.status,
    )
    try {
      return routeClient.applyCookies(failureResponse)
    } catch {
      return response({ ok: false, code: "redemption_unavailable" }, 503)
    }
  }
}
