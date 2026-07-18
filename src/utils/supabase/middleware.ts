import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { AuthSessionMissingError } from "@supabase/supabase-js"
import {
  createSponsorshipVisitorToken,
  getSponsorshipVisitorCookieOptions,
  isValidSponsorshipVisitorToken,
  SPONSORSHIP_VISITOR_COOKIE_NAME,
} from "@/lib/sponsorships/visitorCookie"

type ResponseCookieMutation = {
  name: string
  value: string
  options?: CookieOptions
}

export async function updateSession(request: NextRequest) {
  const responseCookieMutations: ResponseCookieMutation[] = []
  const existingVisitorToken = request.cookies.get(
    SPONSORSHIP_VISITOR_COOKIE_NAME,
  )?.value

  if (!isValidSponsorshipVisitorToken(existingVisitorToken)) {
    const visitorToken = createSponsorshipVisitorToken()
    const visitorCookie = {
      name: SPONSORSHIP_VISITOR_COOKIE_NAME,
      value: visitorToken,
      options: getSponsorshipVisitorCookieOptions(
        request.headers.get("host"),
        request.nextUrl.protocol === "https:",
      ),
    }
    request.cookies.set(visitorCookie.name, visitorCookie.value)
    responseCookieMutations.push(visitorCookie)
  }

  const applyResponseCookies = (response: NextResponse) => {
    responseCookieMutations.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options),
    )
    return response
  }

  let supabaseResponse = applyResponseCookies(
    NextResponse.next({ request }),
  )

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value)
            responseCookieMutations.push(cookie)
          })
          supabaseResponse = applyResponseCookies(
            NextResponse.next({ request }),
          )
        },
      },
    },
  )
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (error: unknown) {
    if (!(error instanceof AuthSessionMissingError)) {
      console.error("Error fetching user session:", error)
    }
    user = null
  }
  if (
    !user &&
    (request.nextUrl.pathname.startsWith("/app") ||
      request.nextUrl.pathname.startsWith("/admin"))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return applyResponseCookies(NextResponse.redirect(url))
  }

  // API admin routes require authentication (defense-in-depth; routes also check SUPER_ADMIN)
  if (!user && request.nextUrl.pathname.startsWith("/api/admin")) {
    return applyResponseCookies(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
  }

  return supabaseResponse
}
