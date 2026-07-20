import { NextRequest, NextResponse } from "next/server"

import { issuePasswordResetEmailProof } from "@/lib/auth/supabaseEmailProofIssuer"
import { getSponsorClaimCanonicalOrigin } from "@/lib/sponsorships/accountClaim"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  MAXIMUM_PASSWORDLESS_ACCESS_BODY_BYTES,
  parsePasswordlessAccessRequest,
  readBoundedSponsorManagementBody,
} from "@/lib/sponsorships/management/passwordlessAccess"
import {
  createSponsorPasswordlessDeliverySignals,
  reserveSponsorPasswordlessDelivery,
  sponsorPasswordlessDeliveryContext,
} from "@/lib/sponsorships/management/passwordlessRateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

function response(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  })
}

function checkEmailResponse() {
  return response({ status: "check-email" }, 202)
}

export async function POST(request: NextRequest) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return response({ error: "unavailable" }, 503)
  }

  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    expectedOrigin !== canonicalOrigin ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ error: "invalid-request" }, 400)
  }

  const serializedBody = await readBoundedSponsorManagementBody(
    request,
    MAXIMUM_PASSWORDLESS_ACCESS_BODY_BYTES,
  )
  const resetRequest =
    serializedBody === null
      ? null
      : parsePasswordlessAccessRequest(serializedBody)
  if (resetRequest === null) {
    return response({ error: "invalid-request" }, 400)
  }

  try {
    const context = sponsorPasswordlessDeliveryContext(request)
    const signals = createSponsorPasswordlessDeliverySignals({
      email: resetRequest.email,
      headers: request.headers,
    })
    const allowed = await reserveSponsorPasswordlessDelivery({
      flow: "password-reset",
      signals,
      context,
    })
    if (!allowed) return checkEmailResponse()

    await issuePasswordResetEmailProof({
      recipientEmail: resetRequest.email,
      context,
    })
  } catch {
    // Quota, gate, and provider failures share one public disposition.
  }

  return checkEmailResponse()
}
