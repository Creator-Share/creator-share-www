import { NextRequest, NextResponse } from "next/server"

import {
  issueAccountClaimEmailProof,
  issueInitialClaimEmailProof,
} from "@/lib/auth/supabaseEmailProofIssuer"
import {
  decideSponsorClaimStart,
  getSponsorClaimCanonicalOrigin,
  parseSponsorClaimStartModeRpcResult,
  parseSponsorClaimStartBody,
  sponsorClaimCookieSetHeaders,
  SPONSOR_ACCOUNT_CLAIM_START_BODY_MAXIMUM_BYTES,
} from "@/lib/sponsorships/accountClaim"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import { readBoundedSponsorManagementBody } from "@/lib/sponsorships/management/passwordlessAccess"
import {
  createSponsorPasswordlessDeliverySignals,
  reserveSponsorPasswordlessDelivery,
  sponsorPasswordlessDeliveryContext,
} from "@/lib/sponsorships/management/passwordlessRateLimit"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const GENERIC_START_RESPONSE = { status: "check-email" } as const
const SERVICE_REQUEST_TIMEOUT_MILLISECONDS = 8_000
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

function genericResponse() {
  return NextResponse.json(GENERIC_START_RESPONSE, {
    status: 202,
    headers: RESPONSE_HEADERS,
  })
}

function unavailableResponse() {
  return NextResponse.json(
    { status: "unavailable" },
    { status: 503, headers: RESPONSE_HEADERS },
  )
}

function claimStartResponse(
  disposition: "ready" | "check-email",
  claimToken: string,
  canonicalOrigin: string,
  request: NextRequest,
) {
  const response = NextResponse.json(
    { status: disposition },
    {
      status: disposition === "ready" ? 200 : 202,
      headers: RESPONSE_HEADERS,
    },
  )
  for (const header of sponsorClaimCookieSetHeaders({
    canonicalOrigin,
    rawHost: request.headers.get("host"),
    requestPathname: "/api/sponsor-account/start",
    claimToken,
  })) {
    response.headers.append("Set-Cookie", header)
  }
  return response
}

export async function POST(request: NextRequest) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return unavailableResponse()
  }

  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    expectedOrigin !== canonicalOrigin ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return genericResponse()
  }

  const rawBody = await readBoundedSponsorManagementBody(
    request,
    SPONSOR_ACCOUNT_CLAIM_START_BODY_MAXIMUM_BYTES,
  )
  if (rawBody === null) return genericResponse()

  let sponsorshipCrypto
  try {
    sponsorshipCrypto = createSponsorshipCryptoFromEnvironment()
  } catch {
    return unavailableResponse()
  }

  const prepared = parseSponsorClaimStartBody(rawBody, sponsorshipCrypto)
  if (!prepared) return genericResponse()

  let disposition: "ready" | "check-email" = "check-email"
  try {
    const context = sponsorPasswordlessDeliveryContext(request)
    let authClientPromise: ReturnType<typeof createClient> | null = null
    let serviceClient: ReturnType<typeof createServiceRoleClient> | null = null
    const getAuthClient = () => {
      authClientPromise ??= createClient()
      return authClientPromise
    }
    const getServiceClient = () => {
      serviceClient ??= createServiceRoleClient({
        requestTimeoutMilliseconds: SERVICE_REQUEST_TIMEOUT_MILLISECONDS,
      })
      return serviceClient
    }
    disposition = await decideSponsorClaimStart(
      prepared,
      canonicalOrigin,
      sponsorshipCrypto,
      {
        async getClaimStartMode(input) {
          const { data, error } = await getServiceClient().rpc(
            "resolve_sponsor_account_claim_start",
            {
              target_claim_token_digest: input.claimTokenDigest,
              target_email_hmac: input.emailDigest,
              target_email_normalization_version:
                input.emailNormalizationVersion,
              target_email_hmac_key_version: input.emailHmacKeyVersion,
              context_request_id: context.requestId,
              context_trace_id: context.traceId,
            },
          )
          if (error) throw error

          return parseSponsorClaimStartModeRpcResult(data)
        },
        async getAuthenticatedUser() {
          const authClient = await getAuthClient()
          const { data, error } = await authClient.auth.getUser()
          if (error || !data.user) return null
          return {
            id: data.user.id,
            email: data.user.email,
            emailConfirmedAt: data.user.email_confirmed_at,
          }
        },
        async sendMagicLink(input) {
          const signals = createSponsorPasswordlessDeliverySignals({
            email: input.email,
            headers: request.headers,
          })
          const allowed = await reserveSponsorPasswordlessDelivery({
            flow:
              input.mode === "initial-claim"
                ? "initial-claim"
                : "account-claim",
            signals,
            context,
            serviceClient: getServiceClient(),
          })
          if (!allowed) return

          const issueEmailProof =
            input.mode === "initial-claim"
              ? issueInitialClaimEmailProof
              : issueAccountClaimEmailProof
          await issueEmailProof({
            recipientEmail: input.email,
            redirectTo: input.emailRedirectTo,
            context,
          })
        },
      },
    )
  } catch {
    // Valid claims retain only a generic disposition during infrastructure loss.
  }

  return claimStartResponse(
    disposition,
    prepared.claimToken,
    canonicalOrigin,
    request,
  )
}
