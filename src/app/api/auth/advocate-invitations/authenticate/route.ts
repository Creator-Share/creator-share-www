import { NextRequest, NextResponse } from "next/server"

import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
  getAdvocateAttributionIdentityCookieOptions,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  ADVOCATE_INVITATION_AUTHENTICATE_PATH,
  parseAdvocateInvitationAuthenticateBody,
} from "@/lib/advocates/invitations/material"
import {
  AdvocateInvitationRedemptionError,
  authenticateAdvocateInvitation,
} from "@/lib/advocates/invitations/redemption"
import { reserveAdvocateInvitationAuthenticationAttempt } from "@/lib/advocates/invitations/rateLimit"
import { createAdvocateInvitationRouteClient } from "@/lib/advocates/invitations/routeClient"
import {
  advocateInvitationJsonResponse,
  isTrustedAdvocateInvitationJsonRequest,
  readBoundedAdvocateInvitationBody,
  resolveTrustedAdvocateInvitationOrigin,
} from "@/lib/advocates/invitations/routeSecurity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest): Promise<NextResponse> {
  const trustedOrigin = resolveTrustedAdvocateInvitationOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    trustedOrigin === null ||
    !isTrustedAdvocateInvitationJsonRequest(
      request,
      ADVOCATE_INVITATION_AUTHENTICATE_PATH,
    )
  ) {
    return advocateInvitationJsonResponse(
      { ok: false, code: "invalid_request" },
      400,
    )
  }

  const rawBody = await readBoundedAdvocateInvitationBody(request)
  const authentication =
    rawBody === null ? null : parseAdvocateInvitationAuthenticateBody(rawBody)
  if (authentication === null) {
    return advocateInvitationJsonResponse(
      { ok: false, code: "invalid_request" },
      400,
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return advocateInvitationJsonResponse(
      { ok: false, code: "authentication_unavailable" },
      503,
    )
  }

  let authenticationAllowed: boolean
  try {
    authenticationAllowed =
      await reserveAdvocateInvitationAuthenticationAttempt({ request })
  } catch {
    console.error("ADVOCATE_INVITATION_AUTHENTICATION_CAPACITY_UNAVAILABLE", {
      code: "authentication_unavailable",
    })
    return advocateInvitationJsonResponse(
      { ok: false, code: "authentication_unavailable" },
      503,
    )
  }
  if (!authenticationAllowed) {
    return advocateInvitationJsonResponse(
      { ok: false, code: "authentication_unavailable" },
      503,
    )
  }

  const secureCookies = trustedOrigin === "https://creatorshare.com"
  const routeClient = createAdvocateInvitationRouteClient(
    request,
    secureCookies,
  )
  if (routeClient === null) {
    return advocateInvitationJsonResponse(
      { ok: false, code: "authentication_unavailable" },
      503,
    )
  }

  try {
    const result = await authenticateAdvocateInvitation({
      client: routeClient.client,
      request: authentication,
    })
    const successResponse = advocateInvitationJsonResponse({ ok: true }, 200)
    const identitySignal = createAdvocateAttributionIdentityCookieValue({
      authUserId: result.authUserId,
    })
    if (identitySignal) {
      successResponse.cookies.set(
        ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
        identitySignal,
        getAdvocateAttributionIdentityCookieOptions(
          request.headers.get("host"),
          secureCookies,
        ),
      )
    }
    return routeClient.applyCookies(successResponse)
  } catch (error) {
    let failureResponse: NextResponse
    if (
      error instanceof AdvocateInvitationRedemptionError &&
      error.stage === "authentication"
    ) {
      failureResponse = advocateInvitationJsonResponse(
        { ok: false, code: "invalid_or_expired" },
        410,
      )
    } else {
      console.error("ADVOCATE_INVITATION_AUTHENTICATION_FAILED", {
        code: "authentication_unavailable",
      })
      failureResponse = advocateInvitationJsonResponse(
        { ok: false, code: "authentication_unavailable" },
        503,
      )
    }
    try {
      return routeClient.applyCookies(failureResponse)
    } catch {
      return advocateInvitationJsonResponse(
        { ok: false, code: "authentication_unavailable" },
        503,
      )
    }
  }
}
