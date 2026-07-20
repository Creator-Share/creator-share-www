import { type NextRequest, NextResponse } from "next/server"

import {
  INTERNAL_ROUTE_SHELL_HEADER,
  isProductionPrimaryAliasHost,
  isAllowedTenantImageOptimizerRequest,
  resolveCanonicalPrimaryOrigin,
  resolveTenantRoutePolicy,
  TENANT_PAYMENT_SHELL,
  type TenantRoutePolicyDecision,
} from "@/lib/advocates/tenantRoutePolicy"
import {
  applyRolledBackParentCookieDeletions,
  updateSession,
  updateSponsorshipVisitor,
} from "@/utils/supabase/middleware"

const TENANT_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const

const ORIGIN_VARYING_ROUTE_IDS = new Set([
  "checkout-status-api",
  "exposure-api",
  "paypal-checkout-api",
  "stripe-checkout-api",
])

const TENANT_DOCUMENT_ROUTE_IDS = new Set([
  "beneficiary-profile-page",
  "browse-page",
  "catalog-redirect",
  "payment-result-page",
  "publication-negative-sentinel",
])

function forwardedHeaders(
  request: NextRequest,
  shell: string | null = null,
): Headers {
  const headers = new Headers(request.headers)
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-middleware-")) headers.delete(name)
  }
  headers.delete(INTERNAL_ROUTE_SHELL_HEADER)
  if (shell !== null) headers.set(INTERNAL_ROUTE_SHELL_HEADER, shell)
  return headers
}

async function bypassSession(
  request: NextRequest,
  shell: string | null = null,
): Promise<NextResponse> {
  return applyRolledBackParentCookieDeletions(
    request,
    NextResponse.next({
      request: { headers: forwardedHeaders(request, shell) },
    }),
  )
}

function appendVary(headers: Headers, values: readonly string[]): void {
  const current = (headers.get("Vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const seen = new Set(current.map((value) => value.toLowerCase()))
  for (const value of values) {
    if (!seen.has(value.toLowerCase())) {
      current.push(value)
      seen.add(value.toLowerCase())
    }
  }
  headers.set("Vary", current.join(", "))
}

function hardenTenantResponse(
  response: NextResponse,
  options: {
    denyFraming?: boolean
    noReferrer?: boolean
    vary?: readonly string[]
  } = {},
): NextResponse {
  for (const [name, value] of Object.entries(TENANT_NO_STORE_HEADERS)) {
    response.headers.set(name, value)
  }
  if (options.noReferrer) {
    response.headers.set("Referrer-Policy", "no-referrer")
  }
  if (options.denyFraming) {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'")
    response.headers.set("X-Frame-Options", "DENY")
  }
  appendVary(response.headers, options.vary ?? ["Host"])
  return response
}

async function deniedTenantResponse(
  request: NextRequest,
  decision: Extract<TenantRoutePolicyDecision, { kind: "deny" }>,
): Promise<NextResponse> {
  const apiRequest = request.nextUrl.pathname.startsWith("/api/")
  const message = decision.status === 405 ? "Method Not Allowed" : "Not Found"
  const response = apiRequest
    ? NextResponse.json(
        { error: decision.status === 405 ? "method-not-allowed" : "not-found" },
        { status: decision.status },
      )
    : new NextResponse(message, {
        status: decision.status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
  if (decision.allow !== null) response.headers.set("Allow", decision.allow)
  response.headers.set("X-Robots-Tag", "noindex, nofollow")
  return applyRolledBackParentCookieDeletions(
    request,
    hardenTenantResponse(response, {
      denyFraming: !apiRequest,
      noReferrer: true,
    }),
  )
}

async function canonicalAuthRedirect(
  request: NextRequest,
): Promise<NextResponse> {
  const origin = resolveCanonicalPrimaryOrigin()
  if (origin === null) {
    return deniedTenantResponse(request, {
      kind: "deny",
      status: 404,
      allow: null,
    })
  }

  const destination = new URL("/auth/callback", origin)
  destination.search = request.nextUrl.search
  const response = NextResponse.redirect(destination, 307)
  return applyRolledBackParentCookieDeletions(
    request,
    hardenTenantResponse(response, {
      denyFraming: true,
      noReferrer: true,
    }),
  )
}

function tenantVaryValues(
  decision: Extract<TenantRoutePolicyDecision, { kind: "allow" }>,
): readonly string[] {
  const values = ["Host"]
  if (decision.visitorSession) values.push("Cookie")
  if (ORIGIN_VARYING_ROUTE_IDS.has(decision.routeId)) values.push("Origin")
  return values
}

export async function middleware(request: NextRequest) {
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    isProductionPrimaryAliasHost(request.headers.get("host"))
  ) {
    const destination = request.nextUrl.clone()
    destination.protocol = "https:"
    destination.hostname = "creatorshare.com"
    destination.port = ""
    const response = NextResponse.redirect(destination, 308)
    return applyRolledBackParentCookieDeletions(
      request,
      hardenTenantResponse(response, {
        denyFraming: true,
        noReferrer: true,
        vary: ["Host"],
      }),
    )
  }

  const decision = resolveTenantRoutePolicy({
    rawHost: request.headers.get("host"),
    pathname: request.nextUrl.pathname,
    method: request.method,
  })

  switch (decision.kind) {
    case "pass-through":
      return updateSession(request, {
        requestHeaderOverrides: { [INTERNAL_ROUTE_SHELL_HEADER]: null },
      })
    case "bypass":
      return bypassSession(request)
    case "deny":
      return deniedTenantResponse(request, decision)
    case "canonical-auth-callback":
      return canonicalAuthRedirect(request)
    case "allow-image-optimizer":
      return isAllowedTenantImageOptimizerRequest({
        searchParams: request.nextUrl.searchParams,
      })
        ? bypassSession(request)
        : deniedTenantResponse(request, {
            kind: "deny",
            status: 404,
            allow: null,
          })
    case "allow": {
      if (decision.routeId === "catalog-redirect") {
        const destination = request.nextUrl.clone()
        destination.pathname = "/"
        destination.hash = ""
        return applyRolledBackParentCookieDeletions(
          request,
          hardenTenantResponse(NextResponse.redirect(destination, 308), {
            denyFraming: true,
            noReferrer: true,
            vary: ["Host"],
          }),
        )
      }
      const response = decision.neutralPaymentShell
        ? await bypassSession(request, TENANT_PAYMENT_SHELL)
        : decision.visitorSession
          ? await updateSponsorshipVisitor(request, {
              requestHeaderOverrides: {
                [INTERNAL_ROUTE_SHELL_HEADER]: null,
              },
            })
          : await bypassSession(request)

      return hardenTenantResponse(response, {
        denyFraming: TENANT_DOCUMENT_ROUTE_IDS.has(decision.routeId),
        noReferrer: decision.neutralPaymentShell,
        vary: tenantVaryValues(decision),
      })
    }
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    {
      source: "/:path*",
      has: [
        {
          type: "host",
          value:
            "(?:(?:[a-z0-9-]+\\.)+creatorshare\\.com\\.?|(?:[a-z0-9-]+\\.)+localhost)(?::[0-9]+)?",
        },
      ],
    },
  ],
}
