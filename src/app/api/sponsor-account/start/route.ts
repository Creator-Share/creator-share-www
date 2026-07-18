import { NextRequest, NextResponse } from "next/server"

import {
  decideSponsorClaimStart,
  getSponsorClaimCanonicalOrigin,
  getSponsorClaimCookieOptions,
  isTrustedSponsorClaimRequest,
  parseSponsorClaimStartBody,
  SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
} from "@/lib/sponsorships/accountClaim"
import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import {
  createClient,
  createServiceRoleClient,
} from "@/utils/supabase/server"

export const runtime = "nodejs"

const GENERIC_START_RESPONSE = { status: "check-email" } as const
const MAXIMUM_START_BODY_BYTES = 4096

function genericResponse() {
  return NextResponse.json(GENERIC_START_RESPONSE, {
    status: 202,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    },
  })
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const declaredLength = request.headers.get("content-length")
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_START_BODY_BYTES)
  ) {
    return null
  }

  try {
    const body = await request.text()
    return Buffer.byteLength(body, "utf8") <= MAXIMUM_START_BODY_BYTES
      ? body
      : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }

  if (
    !isTrustedSponsorClaimRequest(request.headers, canonicalOrigin) ||
    !request.headers.get("content-type")?.startsWith("application/json")
  ) {
    return genericResponse()
  }

  const rawBody = await readBoundedBody(request)
  if (rawBody === null) return genericResponse()

  let sponsorshipCrypto
  try {
    sponsorshipCrypto = createSponsorshipCryptoFromEnvironment()
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }

  const prepared = parseSponsorClaimStartBody(rawBody, sponsorshipCrypto)
  if (!prepared) return genericResponse()

  const authClient = await createClient()
  const serviceClient = createServiceRoleClient()
  const disposition = await decideSponsorClaimStart(
    prepared,
    canonicalOrigin,
    sponsorshipCrypto,
    {
      async isPendingClaim(input) {
        const { data, error } = await serviceClient
          .from("sponsorship_account_claims")
          .select("id")
          .eq("token_digest", input.claimTokenDigest)
          .eq("email_hmac", input.emailDigest)
          .eq(
            "email_normalization_version",
            input.emailNormalizationVersion,
          )
          .eq("email_hmac_key_version", input.emailHmacKeyVersion)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .limit(1)
          .maybeSingle()

        return !error && Boolean(data)
      },
      async getAuthenticatedUser() {
        const { data, error } = await authClient.auth.getUser()
        if (error || !data.user) return null
        return {
          id: data.user.id,
          email: data.user.email,
          emailConfirmedAt: data.user.email_confirmed_at,
        }
      },
      async sendMagicLink(input) {
        const { error } = await authClient.auth.signInWithOtp({
          email: input.email,
          options: {
            emailRedirectTo: input.emailRedirectTo,
            shouldCreateUser: true,
          },
        })
        if (error) throw error
      },
    },
  )

  const response = NextResponse.json(
    { status: disposition },
    {
      status: disposition === "ready" ? 200 : 202,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
      },
    },
  )
  response.cookies.set(
    SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
    prepared.claimToken,
    getSponsorClaimCookieOptions(),
  )
  return response
}
