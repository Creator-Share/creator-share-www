import { NextRequest, NextResponse } from "next/server"

import { getSponsorClaimCanonicalOrigin } from "@/lib/sponsorships/accountClaim"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  buildSponsorManagementMagicLinkCallback,
  isValidSponsorReauthenticationBody,
  MAXIMUM_SPONSOR_REAUTHENTICATION_BODY_BYTES,
  normalizeAuthenticatedSponsorEmail,
  readBoundedSponsorManagementBody,
} from "@/lib/sponsorships/management/passwordlessAccess"
import {
  createSponsorPasswordlessDeliverySignals,
  reserveSponsorPasswordlessDelivery,
  sponsorPasswordlessDeliveryContext,
} from "@/lib/sponsorships/management/passwordlessRateLimit"
import { createStatelessSponsorEmailAuthClient } from "@/lib/sponsorships/management/statelessAuth"
import { createClient } from "@/utils/supabase/server"

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
    MAXIMUM_SPONSOR_REAUTHENTICATION_BODY_BYTES,
  )
  if (
    serializedBody === null ||
    !isValidSponsorReauthenticationBody(serializedBody)
  ) {
    return response({ error: "invalid-request" }, 400)
  }

  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch {
    return response({ error: "unavailable" }, 503)
  }

  let authenticatedEmail: string | null = null
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (
      !error &&
      user?.id &&
      user.email_confirmed_at &&
      typeof user.email_confirmed_at === "string"
    ) {
      authenticatedEmail = normalizeAuthenticatedSponsorEmail(user.email)
    }
  } catch {
    authenticatedEmail = null
  }

  if (authenticatedEmail === null) {
    return response({ error: "unauthorized" }, 401)
  }

  try {
    const signals = createSponsorPasswordlessDeliverySignals({
      email: authenticatedEmail,
      headers: request.headers,
    })
    const allowed = await reserveSponsorPasswordlessDelivery({
      flow: "reauthentication",
      signals,
      context: sponsorPasswordlessDeliveryContext(request),
    })
    if (!allowed) return response({ status: "check-email" }, 202)

    await createStatelessSponsorEmailAuthClient().auth.signInWithOtp({
      email: authenticatedEmail,
      options: {
        emailRedirectTo:
          buildSponsorManagementMagicLinkCallback(canonicalOrigin),
        shouldCreateUser: false,
      },
    })
  } catch {
    // Delivery state remains private, even to an authenticated browser.
  }

  return response({ status: "check-email" }, 202)
}
