import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { AuthSessionMissingError } from "@supabase/supabase-js"
import {
  createSponsorshipVisitorToken,
  getSponsorshipVisitorCookieOptions,
  resolveSponsorshipVisitorCookie,
  SPONSORSHIP_VISITOR_COOKIE_NAME,
} from "@/lib/sponsorships/visitorCookieToken"

type ResponseCookieMutation = {
  name: string
  value: string
  options?: CookieOptions
}

type ResponseCookiePlan = {
  mutations: ResponseCookieMutation[]
  deleteHostOnlyVisitorCookie: boolean
  visitorCookieIsSecure: boolean
}

export interface MiddlewareRequestForwardingOptions {
  requestHeaderOverrides?: Readonly<Record<string, string | null>>
}

function forwardedRequestHeaders(
  request: NextRequest,
  options: MiddlewareRequestForwardingOptions,
): Headers {
  const headers = new Headers(request.headers)
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-middleware-")) headers.delete(name)
  }
  for (const [name, value] of Object.entries(
    options.requestHeaderOverrides ?? {},
  )) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return headers
}

function nextResponse(
  request: NextRequest,
  options: MiddlewareRequestForwardingOptions,
): NextResponse {
  return NextResponse.next({
    request: { headers: forwardedRequestHeaders(request, options) },
  })
}

async function ensureSponsorshipVisitor(
  request: NextRequest,
): Promise<ResponseCookiePlan> {
  const plan: ResponseCookiePlan = {
    mutations: [],
    deleteHostOnlyVisitorCookie: false,
    visitorCookieIsSecure: false,
  }
  const resolution = await resolveSponsorshipVisitorCookie(
    request.headers.get("cookie"),
  )
  const visitorToken =
    resolution.token ?? (await createSponsorshipVisitorToken())
  if (visitorToken === null) return plan

  if (resolution.token === null || resolution.requiresNormalization) {
    const options = getSponsorshipVisitorCookieOptions(
      request.headers.get("host"),
      request.nextUrl.protocol === "https:",
    )
    const visitorCookie = {
      name: SPONSORSHIP_VISITOR_COOKIE_NAME,
      value: visitorToken,
      options,
    }
    request.cookies.set(visitorCookie.name, visitorCookie.value)
    plan.mutations.push(visitorCookie)
    plan.deleteHostOnlyVisitorCookie =
      resolution.requiresNormalization && options.domain !== undefined
    plan.visitorCookieIsSecure = options.secure
  }

  return plan
}

function hostOnlyVisitorDeletionCookie(secure: boolean): string {
  return [
    `${SPONSORSHIP_VISITOR_COOKIE_NAME}=`,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    secure ? "Secure" : null,
    "HttpOnly",
    "SameSite=Lax",
  ]
    .filter(Boolean)
    .join("; ")
}

function applyResponseCookies(
  response: NextResponse,
  plan: ResponseCookiePlan,
): NextResponse {
  plan.mutations.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  )
  if (plan.deleteHostOnlyVisitorCookie) {
    response.headers.append(
      "Set-Cookie",
      hostOnlyVisitorDeletionCookie(plan.visitorCookieIsSecure),
    )
  }
  return response
}

export async function updateSponsorshipVisitor(
  request: NextRequest,
  options: MiddlewareRequestForwardingOptions = {},
): Promise<NextResponse> {
  const cookiePlan = await ensureSponsorshipVisitor(request)
  return applyResponseCookies(nextResponse(request, options), cookiePlan)
}

export async function updateSession(
  request: NextRequest,
  options: MiddlewareRequestForwardingOptions = {},
) {
  const cookiePlan = await ensureSponsorshipVisitor(request)

  const applyCookies = (response: NextResponse) =>
    applyResponseCookies(response, cookiePlan)

  let supabaseResponse = applyCookies(nextResponse(request, options))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(
          cookiesToSet: {
            name: string
            value: string
            options?: CookieOptions
          }[],
        ) {
          cookiesToSet.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value)
            cookiePlan.mutations.push(cookie)
          })
          supabaseResponse = applyCookies(nextResponse(request, options))
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
    return applyCookies(NextResponse.redirect(url))
  }

  // API admin routes require authentication (defense-in-depth; routes also check SUPER_ADMIN)
  if (!user && request.nextUrl.pathname.startsWith("/api/admin")) {
    return applyCookies(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
  }

  return supabaseResponse
}
