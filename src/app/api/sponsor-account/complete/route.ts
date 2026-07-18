import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import {
  completeSponsorAccountClaim,
  getSponsorClaimCanonicalOrigin,
  getSponsorClaimCookieOptions,
  isTrustedSponsorClaimRequest,
  parseSponsorAccountClaimRpcResult,
  SponsorAccountClaimError,
  SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
} from "@/lib/sponsorships/accountClaim"
import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import {
  createClient,
  createServiceRoleClient,
} from "@/utils/supabase/server"

export const runtime = "nodejs"

function boundedHeader(
  request: NextRequest,
  name: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(name)?.trim()
  return value ? value.slice(0, maximumLength) : null
}

function requestContext(request: NextRequest) {
  return {
    requestId: randomUUID(),
    traceId:
      boundedHeader(request, "x-vercel-id", 255) ??
      boundedHeader(request, "cf-ray", 255) ??
      boundedHeader(request, "traceparent", 255) ??
      boundedHeader(request, "x-trace-id", 255),
    clientIp:
      boundedHeader(request, "cf-connecting-ip", 256) ??
      boundedHeader(request, "x-vercel-forwarded-for", 256) ??
      boundedHeader(request, "x-forwarded-for", 256) ??
      boundedHeader(request, "x-real-ip", 256),
    userAgent: boundedHeader(request, "user-agent", 1024),
  }
}

function readSingleClaimCookie(request: NextRequest): string | null {
  const values = request.cookies.getAll(SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME)
  return values.length === 1 ? values[0].value : null
}

function clearClaimCookie(response: NextResponse): NextResponse {
  response.cookies.set(SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME, "", {
    ...getSponsorClaimCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  })
  return response
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}

export async function POST(request: NextRequest) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return noStore(
      NextResponse.json({ error: "unavailable" }, { status: 503 }),
    )
  }

  if (!isTrustedSponsorClaimRequest(request.headers, canonicalOrigin)) {
    return noStore(
      NextResponse.json({ error: "unavailable" }, { status: 403 }),
    )
  }

  const authClient = await createClient()
  const serviceClient = createServiceRoleClient()

  try {
    const result = await completeSponsorAccountClaim(
      readSingleClaimCookie(request),
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

    return clearClaimCookie(
      noStore(NextResponse.json(result, { status: 200 })),
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
      ? clearClaimCookie(response)
      : response
  }
}
