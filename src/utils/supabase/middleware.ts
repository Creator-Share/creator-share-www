import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { AuthSessionMissingError } from "@supabase/supabase-js"
import { ADVOCATE_TENANT_ROOT, resolveAdvocateHost } from "@/lib/advocates/host"
import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
  getAdvocateAttributionIdentityCookieOptions,
  resolveAdvocateAttributionIdentityCookie,
} from "@/lib/advocates/attributionIdentityCookie"
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
  hostOnlyDeletions: Array<{
    name: string
    secure: boolean
  }>
}

export interface MiddlewareRequestForwardingOptions {
  requestHeaderOverrides?: Readonly<Record<string, string | null>>
}

const AUTHENTICATED_PAGE_PREFIXES = Object.freeze(["/app", "/admin", "/portal"])
const AUTHENTICATED_API_PREFIXES = Object.freeze(["/api/admin", "/api/portal"])

function shouldDeleteHostOnlyCookie(
  request: NextRequest,
  sharedDomain: string | undefined,
): boolean {
  if (sharedDomain === undefined) return false

  const host = resolveAdvocateHost(request.headers.get("host"), {
    allowLocalhostDevelopment: true,
  })
  if (host.kind === "invalid") return false
  const hostname =
    host.kind === "tenant-candidate"
      ? host.requestHostname
      : host.normalizedHostname

  // On the apex, host-only and Domain cookies have the same name, domain,
  // and path tuple. The new shared cookie replaces the host-only cookie by
  // itself. A later deletion header would delete the new cookie as well.
  return hostname !== ADVOCATE_TENANT_ROOT
}

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function requiresAuthenticatedPagePath(pathname: string): boolean {
  return AUTHENTICATED_PAGE_PREFIXES.some((prefix) =>
    matchesPathPrefix(pathname, prefix),
  )
}

export function requiresAuthenticatedApiPath(pathname: string): boolean {
  return AUTHENTICATED_API_PREFIXES.some((prefix) =>
    matchesPathPrefix(pathname, prefix),
  )
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
    hostOnlyDeletions: [],
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
    if (
      resolution.requiresNormalization &&
      shouldDeleteHostOnlyCookie(request, options.domain)
    ) {
      plan.hostOnlyDeletions.push({
        name: SPONSORSHIP_VISITOR_COOKIE_NAME,
        secure: options.secure,
      })
    }
  }

  return plan
}

function hostOnlyDeletionCookie(name: string, secure: boolean): string {
  return [
    `${name}=`,
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
  for (const deletion of plan.hostOnlyDeletions) {
    response.headers.append(
      "Set-Cookie",
      hostOnlyDeletionCookie(deletion.name, deletion.secure),
    )
  }
  return response
}

function ensureAdvocateAttributionIdentity(
  request: NextRequest,
  plan: ResponseCookiePlan,
  authUserId: string,
): void {
  const resolution = resolveAdvocateAttributionIdentityCookie(
    request.headers.get("cookie"),
  )
  if (
    resolution.signal?.authUserId === authUserId &&
    !resolution.requiresNormalization &&
    !resolution.requiresRefresh
  ) {
    return
  }

  const value = createAdvocateAttributionIdentityCookieValue({ authUserId })
  if (value === null) return

  const options = getAdvocateAttributionIdentityCookieOptions(
    request.headers.get("host"),
    request.nextUrl.protocol === "https:",
  )
  const mutation = {
    name: ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
    value,
    options,
  }
  request.cookies.set(mutation.name, mutation.value)
  plan.mutations.push(mutation)

  if (
    resolution.hadCandidates &&
    shouldDeleteHostOnlyCookie(request, options.domain)
  ) {
    plan.hostOnlyDeletions.push({
      name: ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
      secure: options.secure,
    })
  }
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
  if (user) {
    ensureAdvocateAttributionIdentity(request, cookiePlan, user.id)
    supabaseResponse = applyCookies(nextResponse(request, options))
  }
  if (!user && requiresAuthenticatedPagePath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return applyCookies(NextResponse.redirect(url))
  }

  // Protected APIs also enforce their exact authorization inside each route.
  if (!user && requiresAuthenticatedApiPath(request.nextUrl.pathname)) {
    return applyCookies(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
  }

  return supabaseResponse
}
