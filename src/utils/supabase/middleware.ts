import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { AuthSessionMissingError } from "@supabase/supabase-js"
import type { CrossSubdomainCookieLocalTestOptions } from "@/lib/advocates/crossSubdomainAttributionGate"
import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  advocateAttributionIdentityCookieRollbackHeaders,
  advocateAttributionIdentityCookieSetHeaders,
  type AdvocateAttributionIdentityCookieEnvironment,
  createAdvocateAttributionIdentityCookieValue,
  resolveAdvocateAttributionIdentityCookie,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  createSponsorshipVisitorToken,
  resolveSponsorshipVisitorCookie,
  SPONSORSHIP_VISITOR_COOKIE_NAME,
  sponsorshipVisitorCookieRollbackHeaders,
  sponsorshipVisitorCookieSetHeaders,
  type SponsorshipVisitorCookieEnvironment,
} from "@/lib/sponsorships/visitorCookieToken"

type ResponseCookieMutation = {
  name: string
  value: string
  options?: CookieOptions
}

type ResponseCookiePlan = {
  mutations: ResponseCookieMutation[]
  orderedHeaders: string[]
}

export interface MiddlewareRequestForwardingOptions {
  cookieEnvironment?: AdvocateAttributionIdentityCookieEnvironment &
    SponsorshipVisitorCookieEnvironment
  cookieTrustPolicy?: unknown
  localTestCookieOptions?: CrossSubdomainCookieLocalTestOptions
  requestHeaderOverrides?: Readonly<Record<string, string | null>>
}

const AUTHENTICATED_PAGE_PREFIXES = Object.freeze(["/app", "/admin", "/portal"])
const AUTHENTICATED_API_PREFIXES = Object.freeze(["/api/admin", "/api/portal"])

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
  environment: SponsorshipVisitorCookieEnvironment = process.env,
  cookieTrustPolicy?: unknown,
  localTestOptions?: CrossSubdomainCookieLocalTestOptions,
): Promise<ResponseCookiePlan> {
  const plan: ResponseCookiePlan = {
    mutations: [],
    orderedHeaders: [],
  }
  const requestContext = {
    rawHost: request.headers.get("host"),
    cookieTrustPolicy,
    localTestOptions,
  }
  const resolution = await resolveSponsorshipVisitorCookie(
    request.headers.get("cookie"),
    requestContext,
    environment,
  )
  const visitorToken =
    resolution.token ??
    (await createSponsorshipVisitorToken(requestContext, environment))
  if (visitorToken === null) return plan

  if (resolution.token === null || resolution.requiresNormalization) {
    const rawHost = request.headers.get("host")
    const requestIsSecure = request.nextUrl.protocol === "https:"
    plan.orderedHeaders.push(
      ...sponsorshipVisitorCookieSetHeaders(
        visitorToken,
        rawHost,
        requestIsSecure,
        environment,
        cookieTrustPolicy,
        localTestOptions,
      ),
    )
    request.cookies.set(SPONSORSHIP_VISITOR_COOKIE_NAME, visitorToken)
  }

  return plan
}

function applyResponseCookies(
  response: NextResponse,
  plan: ResponseCookiePlan,
): NextResponse {
  plan.mutations.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  )
  for (const header of plan.orderedHeaders) {
    response.headers.append("Set-Cookie", header)
  }
  return response
}

function ensureAdvocateAttributionIdentity(
  request: NextRequest,
  plan: ResponseCookiePlan,
  authUserId: string,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  cookieTrustPolicy?: unknown,
  localTestOptions?: CrossSubdomainCookieLocalTestOptions,
): void {
  const requestContext = {
    rawHost: request.headers.get("host"),
    cookieTrustPolicy,
    localTestOptions,
  }
  const resolution = resolveAdvocateAttributionIdentityCookie(
    request.headers.get("cookie"),
    requestContext,
    environment,
  )
  if (
    resolution.signal?.authUserId === authUserId &&
    !resolution.requiresNormalization &&
    !resolution.requiresRefresh
  ) {
    return
  }
  const value = createAdvocateAttributionIdentityCookieValue(
    { authUserId },
    requestContext,
    environment,
  )
  if (value === null) return
  request.cookies.set(ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME, value)
  plan.orderedHeaders.push(
    ...advocateAttributionIdentityCookieSetHeaders(
      value,
      request.headers.get("host"),
      request.nextUrl.protocol === "https:",
      environment,
      cookieTrustPolicy,
      localTestOptions,
    ),
  )
}

async function appendRolledBackParentCookieDeletions(
  request: NextRequest,
  plan: ResponseCookiePlan,
  environment: AdvocateAttributionIdentityCookieEnvironment = process.env,
  cookieTrustPolicy?: unknown,
  localTestOptions?: CrossSubdomainCookieLocalTestOptions,
): Promise<void> {
  const rollbackHeaders = [
    ...advocateAttributionIdentityCookieRollbackHeaders(
      request.headers.get("cookie"),
      request.headers.get("host"),
      request.nextUrl.protocol === "https:",
      environment,
      cookieTrustPolicy,
      localTestOptions,
    ),
    ...(await sponsorshipVisitorCookieRollbackHeaders(
      request.headers.get("cookie"),
      request.headers.get("host"),
      request.nextUrl.protocol === "https:",
      environment,
      cookieTrustPolicy,
      localTestOptions,
    )),
  ]
  for (const header of rollbackHeaders) {
    if (!plan.orderedHeaders.includes(header)) {
      plan.orderedHeaders.push(header)
    }
  }
}

export async function applyRolledBackParentCookieDeletions(
  request: NextRequest,
  response: NextResponse,
  options: MiddlewareRequestForwardingOptions = {},
): Promise<NextResponse> {
  const plan: ResponseCookiePlan = { mutations: [], orderedHeaders: [] }
  await appendRolledBackParentCookieDeletions(
    request,
    plan,
    options.cookieEnvironment,
    options.cookieTrustPolicy,
    options.localTestCookieOptions,
  )
  return applyResponseCookies(response, plan)
}

export async function updateSponsorshipVisitor(
  request: NextRequest,
  options: MiddlewareRequestForwardingOptions = {},
): Promise<NextResponse> {
  const cookiePlan = await ensureSponsorshipVisitor(
    request,
    options.cookieEnvironment,
    options.cookieTrustPolicy,
    options.localTestCookieOptions,
  )
  await appendRolledBackParentCookieDeletions(
    request,
    cookiePlan,
    options.cookieEnvironment,
    options.cookieTrustPolicy,
    options.localTestCookieOptions,
  )
  return applyResponseCookies(nextResponse(request, options), cookiePlan)
}

export async function updateSession(
  request: NextRequest,
  options: MiddlewareRequestForwardingOptions = {},
) {
  const cookiePlan = await ensureSponsorshipVisitor(
    request,
    options.cookieEnvironment,
    options.cookieTrustPolicy,
    options.localTestCookieOptions,
  )

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
    ensureAdvocateAttributionIdentity(
      request,
      cookiePlan,
      user.id,
      options.cookieEnvironment,
      options.cookieTrustPolicy,
      options.localTestCookieOptions,
    )
    supabaseResponse = applyCookies(nextResponse(request, options))
  } else {
    await appendRolledBackParentCookieDeletions(
      request,
      cookiePlan,
      options.cookieEnvironment,
      options.cookieTrustPolicy,
      options.localTestCookieOptions,
    )
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
