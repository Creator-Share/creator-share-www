import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
  getAdvocateAttributionIdentityCookieOptions,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  buildSponsorClaimPageRedirect,
  getSponsorClaimCanonicalOrigin,
  isValidSupabaseAuthCode,
} from "@/lib/sponsorships/accountClaim"

export const runtime = "nodejs"

type ResponseCookie = {
  name: string
  value: string
  options?: CookieOptions
}

function redirectResponse(url: URL): NextResponse {
  return NextResponse.redirect(url, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    },
  })
}

export async function GET(request: NextRequest) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    canonicalOrigin = "https://creatorshare.com"
  }

  const requestedPath = request.nextUrl.searchParams.get("next")
  const failureRedirect = buildSponsorClaimPageRedirect(
    canonicalOrigin,
    requestedPath,
    "auth-error",
  )
  const codes = request.nextUrl.searchParams.getAll("code")
  if (codes.length !== 1 || !isValidSupabaseAuthCode(codes[0])) {
    return redirectResponse(failureRedirect)
  }

  const successRedirect = buildSponsorClaimPageRedirect(
    canonicalOrigin,
    requestedPath,
    "ready",
  )
  const successResponse = redirectResponse(successRedirect)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return redirectResponse(failureRedirect)
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: ResponseCookie[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            successResponse.cookies.set(name, value, options),
          )
        },
      },
    })

    const { data, error } = await supabase.auth.exchangeCodeForSession(codes[0])
    if (error) return redirectResponse(failureRedirect)

    const authUserId = data.user?.id
    if (authUserId) {
      const attributionIdentity = createAdvocateAttributionIdentityCookieValue({
        authUserId,
      })
      if (attributionIdentity) {
        successResponse.cookies.set(
          ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
          attributionIdentity,
          getAdvocateAttributionIdentityCookieOptions(
            request.headers.get("host"),
            request.nextUrl.protocol === "https:",
          ),
        )
      }
    }

    return successResponse
  } catch {
    return redirectResponse(failureRedirect)
  }
}
