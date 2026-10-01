import { isIP } from "node:net"

import { NextRequest, NextResponse } from "next/server"

import {
  completeSponsorAccountClaim,
  getSponsorClaimCanonicalOrigin,
  isTrustedSponsorClaimRequest,
  parseSponsorClaimCookieHeader,
  parseSponsorAccountClaimRpcResult,
  sponsorClaimCookieClearHeaders,
  sponsorClaimLegacyCookieTombstoneHeaders,
  SponsorAccountClaimError,
} from "@/lib/sponsorships/accountClaim"
import { resolveTrustedPrimaryRequestOrigin } from "@/lib/sponsorships/checkout/requestSecurity"
import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import { sponsorPasswordlessDeliveryContext } from "@/lib/sponsorships/management/passwordlessRateLimit"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const SERVICE_REQUEST_TIMEOUT_MILLISECONDS = 8_000
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/

function requestContext(request: NextRequest) {
  const deliveryContext = sponsorPasswordlessDeliveryContext(request)
  const candidateClientIp =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.trim()
      : null
  const candidateUserAgent = request.headers.get("user-agent")?.trim()
  const userAgent =
    candidateUserAgent && !CONTROL_CHARACTER_PATTERN.test(candidateUserAgent)
      ? candidateUserAgent.slice(0, 1024)
      : null
  return {
    requestId: deliveryContext.requestId,
    traceId: deliveryContext.traceId,
    clientIp:
      candidateClientIp &&
      candidateClientIp.length <= 64 &&
      isIP(candidateClientIp) !== 0
        ? candidateClientIp.toLowerCase()
        : null,
    userAgent,
  }
}

function appendSetCookieHeaders(
  response: NextResponse,
  headers: readonly string[],
): NextResponse {
  for (const header of headers) response.headers.append("Set-Cookie", header)
  return response
}

function clearClaimCookies(
  response: NextResponse,
  request: NextRequest,
  canonicalOrigin: string,
): NextResponse {
  return appendSetCookieHeaders(
    response,
    sponsorClaimCookieClearHeaders({
      canonicalOrigin,
      rawHost: request.headers.get("host"),
      requestPathname: "/api/sponsor-account/complete",
    }),
  )
}

function clearLegacyClaimCookies(
  response: NextResponse,
  request: NextRequest,
  canonicalOrigin: string,
): NextResponse {
  return appendSetCookieHeaders(
    response,
    sponsorClaimLegacyCookieTombstoneHeaders({
      canonicalOrigin,
      rawHost: request.headers.get("host"),
      requestPathname: "/api/sponsor-account/complete",
    }),
  )
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, max-age=0")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Referrer-Policy", "no-referrer")
  response.headers.set("X-Content-Type-Options", "nosniff")
  return response
}

export async function POST(request: NextRequest) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return noStore(NextResponse.json({ error: "unavailable" }, { status: 503 }))
  }

  const requestOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    requestOrigin !== canonicalOrigin ||
    request.nextUrl.origin !== canonicalOrigin ||
    !isTrustedSponsorClaimRequest(request.headers, canonicalOrigin)
  ) {
    return noStore(NextResponse.json({ error: "unavailable" }, { status: 403 }))
  }

  let claimCookie
  try {
    claimCookie = parseSponsorClaimCookieHeader({
      rawCookieHeader: request.headers.get("cookie"),
      canonicalOrigin,
    })
  } catch {
    return noStore(NextResponse.json({ error: "unavailable" }, { status: 503 }))
  }
  if (claimCookie.status !== "accepted") {
    return clearClaimCookies(
      noStore(
        NextResponse.json({ error: "invalid-or-expired" }, { status: 410 }),
      ),
      request,
      canonicalOrigin,
    )
  }

  try {
    const authClient = await createClient()
    const serviceClient = createServiceRoleClient({
      requestTimeoutMilliseconds: SERVICE_REQUEST_TIMEOUT_MILLISECONDS,
    })
    const result = await completeSponsorAccountClaim(
      claimCookie.claimToken,
      requestContext(request),
      {
        crypto: createSponsorshipCryptoFromEnvironment(),
        async getAuthenticatedUser() {
          const { data, error } = await authClient.auth.getUser()
          if (error || !data.user) return null
          return {
            id: data.user.id,
            email: data.user.email,
            emailConfirmedAt: data.user.email_confirmed_at,
          }
        },
        async issueEmailVerification(input) {
          const { error } = await serviceClient.rpc(
            "issue_sponsor_account_email_verification",
            {
              target_auth_user_id: input.authUserId,
              target_email_hmac: input.emailDigest,
              target_email_normalization_version:
                input.emailNormalizationVersion,
              target_email_hmac_key_version: input.emailHmacKeyVersion,
              target_valid_for: input.validFor,
              context_request_id: input.requestId,
              context_trace_id: input.traceId,
            },
          )
          if (error) throw error
        },
        async consumeClaim(input) {
          const { data, error } = await authClient.rpc(
            "consume_sponsorship_account_claim",
            {
              target_claim_token_digest: input.claimTokenDigest,
              context_request_id: input.requestId,
              context_trace_id: input.traceId,
              context_client_ip: input.clientIp,
              context_user_agent: input.userAgent,
            },
          )
          if (error) throw error

          return parseSponsorAccountClaimRpcResult(data)
        },
      },
    )

    return clearClaimCookies(
      noStore(NextResponse.json(result, { status: 200 })),
      request,
      canonicalOrigin,
    )
  } catch (error) {
    const claimError =
      error instanceof SponsorAccountClaimError
        ? error
        : new SponsorAccountClaimError(
            "unavailable",
            "Sponsor account linking is temporarily unavailable",
            503,
          )
    const response = noStore(
      NextResponse.json(
        { error: claimError.code },
        { status: claimError.httpStatus },
      ),
    )
    return claimError.code === "invalid-or-expired" ||
      claimError.code === "email-mismatch" ||
      claimError.code === "account-conflict"
      ? clearClaimCookies(response, request, canonicalOrigin)
      : clearLegacyClaimCookies(response, request, canonicalOrigin)
  }
}
