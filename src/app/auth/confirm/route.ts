import { randomUUID } from "node:crypto"

import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

import {
  advocateAttributionIdentityCookieSetHeaders,
  createAdvocateAttributionIdentityCookieValue,
} from "@/lib/advocates/attributionIdentityCookie"
import { getSponsorClaimCanonicalOrigin } from "@/lib/sponsorships/accountClaim"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  createSponsorEmailConfirmationInterstitial,
  isSponsorEmailConfirmationDestination,
  parseSponsorEmailAuthenticationReceipt,
  parseSponsorEmailConfirmationRequest,
  parseSponsorEmailSessionIdentity,
  SPONSOR_EMAIL_CONFIRMATION_BODY_MAXIMUM_BYTES,
  type SponsorEmailConfirmationDestination,
  SPONSOR_EMAIL_CONFIRMATION_HEADERS,
} from "@/lib/sponsorships/management/sponsorEmailConfirmation"
import { readBoundedSponsorManagementBody } from "@/lib/sponsorships/management/passwordlessAccess"
import {
  createSponsorPasswordlessVerificationSignals,
  reserveSponsorPasswordlessVerificationAttempt,
  sponsorPasswordlessDeliveryContext,
} from "@/lib/sponsorships/management/passwordlessRateLimit"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ResponseCookie = {
  name: string
  value: string
  options?: CookieOptions
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: SPONSOR_EMAIL_CONFIRMATION_HEADERS,
  })
}

function exactCanonicalOrigin(request: Request): string | null {
  let canonicalOrigin: string
  let transportOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
    transportOrigin = new URL(request.url).origin
  } catch {
    return null
  }
  const requestOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  return requestOrigin === canonicalOrigin &&
    transportOrigin === canonicalOrigin
    ? canonicalOrigin
    : null
}

function allowedNextFromQuery(
  request: NextRequest,
): SponsorEmailConfirmationDestination | null {
  const values = request.nextUrl.searchParams.getAll("next")
  const keys = Array.from(request.nextUrl.searchParams.keys())
  if (keys.length !== 1 || keys[0] !== "next" || values.length !== 1) {
    return null
  }
  return isSponsorEmailConfirmationDestination(values[0]) ? values[0] : null
}

function traceId(request: Request): string | null {
  const value = request.headers.get("x-vercel-id")?.trim()
  return value && value.length <= 255 && /^[\x21-\x7e]+$/.test(value)
    ? value
    : null
}

function deniedHtmlResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: SPONSOR_EMAIL_CONFIRMATION_HEADERS,
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  if (exactCanonicalOrigin(request) === null) return deniedHtmlResponse(404)
  const next = allowedNextFromQuery(request)
  if (next === null) return deniedHtmlResponse(404)

  const interstitial = createSponsorEmailConfirmationInterstitial({ next })
  return new Response(interstitial.html, {
    status: 200,
    headers: interstitial.headers,
  })
}

export async function HEAD(request: NextRequest): Promise<Response> {
  const response = await GET(request)
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const canonicalOrigin = exactCanonicalOrigin(request)
  if (
    canonicalOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, canonicalOrigin)
  ) {
    return jsonResponse({ ok: false, code: "invalid_request" }, 400)
  }

  const serializedBody = await readBoundedSponsorManagementBody(
    request,
    SPONSOR_EMAIL_CONFIRMATION_BODY_MAXIMUM_BYTES,
  )
  const confirmation =
    serializedBody === null
      ? null
      : parseSponsorEmailConfirmationRequest(serializedBody)
  if (confirmation === null) {
    return jsonResponse({ ok: false, code: "invalid_request" }, 400)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ ok: false, code: "confirmation_unavailable" }, 503)
  }

  const successResponse = jsonResponse(
    { ok: true, redirect: confirmation.next },
    200,
  )
  const secureAuthCookies = new URL(canonicalOrigin).protocol === "https:"
  try {
    const serviceClient = createServiceRoleClient()
    const verificationAllowed =
      await reserveSponsorPasswordlessVerificationAttempt({
        signals: createSponsorPasswordlessVerificationSignals({
          headers: request.headers,
        }),
        context: sponsorPasswordlessDeliveryContext(request),
        serviceClient,
      })
    if (!verificationAllowed) {
      return jsonResponse({ ok: false, code: "invalid_or_expired" }, 410)
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: "implicit",
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: ResponseCookie[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            successResponse.cookies.set(name, value, {
              ...options,
              secure: secureAuthCookies,
            }),
          )
        },
      },
    })
    const verification = await supabase.auth.verifyOtp({
      token_hash: confirmation.tokenHash,
      type: "email",
    })
    const accessToken = verification.data.session?.access_token
    const verifiedUserId = verification.data.user?.id
    if (verification.error || !accessToken || !verifiedUserId) {
      return jsonResponse({ ok: false, code: "invalid_or_expired" }, 410)
    }

    const authenticated = await supabase.auth.getUser(accessToken)
    if (
      authenticated.error ||
      authenticated.data.user?.id !== verifiedUserId ||
      !authenticated.data.user.email_confirmed_at
    ) {
      return jsonResponse({ ok: false, code: "invalid_or_expired" }, 410)
    }

    const identity = parseSponsorEmailSessionIdentity({
      accessToken,
      verifiedAuthUserId: verifiedUserId,
    })
    if (identity === null) {
      return jsonResponse({ ok: false, code: "invalid_or_expired" }, 410)
    }

    const requestId = randomUUID()
    const receipt = await serviceClient.rpc(
      "record_sponsor_email_authentication_receipt",
      {
        target_auth_user_id: identity.authUserId,
        target_auth_session_id: identity.authSessionId,
        context_request_id: requestId,
        context_trace_id: traceId(request),
      },
    )
    if (
      receipt.error ||
      parseSponsorEmailAuthenticationReceipt(receipt.data) === null
    ) {
      return jsonResponse({ ok: false, code: "confirmation_unavailable" }, 503)
    }

    const attributionIdentity = createAdvocateAttributionIdentityCookieValue(
      {
        authUserId: identity.authUserId,
      },
      { rawHost: request.headers.get("host") },
    )
    if (attributionIdentity) {
      for (const header of advocateAttributionIdentityCookieSetHeaders(
        attributionIdentity,
        request.headers.get("host"),
        request.nextUrl.protocol === "https:",
      )) {
        successResponse.headers.append("Set-Cookie", header)
      }
    }
    return successResponse
  } catch {
    return jsonResponse({ ok: false, code: "confirmation_unavailable" }, 503)
  }
}
