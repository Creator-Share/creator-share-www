import { NextRequest, NextResponse } from "next/server"

import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
  getAdvocateAttributionIdentityCookieOptions,
  resolveAdvocateAttributionIdentityCookie,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

function response(status: number) {
  return NextResponse.json(
    { ok: status === 200 },
    { status, headers: RESPONSE_HEADERS },
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  const contentLength = request.headers.get("content-length")
  if (
    expectedOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin) ||
    (contentLength !== null &&
      (!/^[0-9]+$/.test(contentLength) || Number(contentLength) > 128))
  ) {
    return response(400)
  }

  try {
    const client = await createClient()
    const {
      data: { user },
    } = await client.auth.getUser()
    if (!user) return response(401)

    const existingSignal = resolveAdvocateAttributionIdentityCookie(
      request.headers.get("cookie"),
    )
    if (
      existingSignal.signal?.authUserId === user.id &&
      !existingSignal.requiresNormalization &&
      !existingSignal.requiresRefresh
    ) {
      return response(200)
    }

    const identitySignal = createAdvocateAttributionIdentityCookieValue({
      authUserId: user.id,
    })
    if (identitySignal === null) return response(503)

    const completionResponse = response(200)
    completionResponse.cookies.set(
      ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
      identitySignal,
      getAdvocateAttributionIdentityCookieOptions(
        request.headers.get("host"),
        request.nextUrl.protocol === "https:",
      ),
    )
    return completionResponse
  } catch {
    return response(503)
  }
}
