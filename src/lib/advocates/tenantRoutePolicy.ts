import { isValidBeneficiaryUsername } from "@/config/beneficiaryValidation"

import {
  ADVOCATE_LOCALHOST_ROOT,
  ADVOCATE_TENANT_ROOT,
  resolveAdvocateHost,
} from "./host"
import { resolvePublicAdvocateBrowseRoute } from "./publicBrowsePaths"

export { isQualifyingAdvocateExposurePagePath } from "./publicBrowsePaths"

export const INTERNAL_ROUTE_SHELL_HEADER =
  "x-creator-share-internal-route-shell"
export const TENANT_PAYMENT_SHELL = "tenant-payment-v1"

const MAX_PATHNAME_LENGTH = 2_048
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const READ_METHODS = Object.freeze(["GET", "HEAD"] as const)
const GET_METHOD = Object.freeze(["GET"] as const)
const POST_METHOD = Object.freeze(["POST"] as const)

export type TenantRoutePolicyEnvironment = Readonly<
  Record<string, string | undefined>
>

type RouteAction =
  | "allow"
  | "canonical-auth-callback"
  | "framework-asset"
  | "image-optimizer"
  | "public-asset"
  | "webhook"

type RouteRule = Readonly<{
  id: string
  action: RouteAction
  hideMethodMismatch?: boolean
  methods: readonly string[]
  qualifiesAsExposure?: boolean
  neutralPaymentShell?: boolean
  tenantAllowed: boolean
  visitorSession?: boolean
}>

const BROWSE_PAGE_RULE = Object.freeze({
  id: "browse-page",
  action: "allow",
  methods: READ_METHODS,
  qualifiesAsExposure: true,
  tenantAllowed: true,
  visitorSession: true,
} satisfies RouteRule)

const PROFILE_PAGE_RULE = Object.freeze({
  ...BROWSE_PAGE_RULE,
  id: "beneficiary-profile-page",
} satisfies RouteRule)

const PAYMENT_PAGE_RULE = Object.freeze({
  id: "payment-result-page",
  action: "allow",
  methods: READ_METHODS,
  neutralPaymentShell: true,
  tenantAllowed: true,
  visitorSession: false,
} satisfies RouteRule)

const STATIC_RULES = new Map<string, RouteRule>([
  [
    "/.well-known/creator-share/advocate-publication-canary",
    Object.freeze({
      id: "advocate-publication-canary",
      action: "allow",
      hideMethodMismatch: true,
      methods: POST_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule),
  ],
  ["/payments/success", PAYMENT_PAGE_RULE],
  ["/payments/failed", PAYMENT_PAGE_RULE],
  [
    "/api/beneficiaries/get",
    Object.freeze({
      id: "catalog-api",
      action: "allow",
      methods: GET_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule),
  ],
  [
    "/api/payments/currency",
    Object.freeze({
      id: "currency-api",
      action: "allow",
      methods: GET_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule),
  ],
  [
    "/api/advocates/exposure",
    Object.freeze({
      id: "exposure-api",
      action: "allow",
      methods: POST_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule),
  ],
  [
    "/api/stripe",
    Object.freeze({
      id: "stripe-checkout-api",
      action: "allow",
      methods: POST_METHOD,
      tenantAllowed: true,
      visitorSession: true,
    } satisfies RouteRule),
  ],
  [
    "/api/paypal",
    Object.freeze({
      id: "paypal-checkout-api",
      action: "allow",
      methods: POST_METHOD,
      tenantAllowed: true,
      visitorSession: true,
    } satisfies RouteRule),
  ],
  [
    "/api/sponsorships/checkout-status",
    Object.freeze({
      id: "checkout-status-api",
      action: "allow",
      methods: POST_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule),
  ],
  [
    "/auth/callback",
    Object.freeze({
      id: "canonical-auth-callback",
      action: "canonical-auth-callback",
      methods: GET_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule),
  ],
  [
    "/api/webhooks/stripe",
    Object.freeze({
      id: "stripe-webhook",
      action: "webhook",
      methods: POST_METHOD,
      tenantAllowed: false,
    } satisfies RouteRule),
  ],
  [
    "/api/paypal/webhook",
    Object.freeze({
      id: "paypal-webhook",
      action: "webhook",
      methods: POST_METHOD,
      tenantAllowed: false,
    } satisfies RouteRule),
  ],
  [
    "/_next/image",
    Object.freeze({
      id: "next-image-optimizer",
      action: "image-optimizer",
      methods: READ_METHODS,
      tenantAllowed: true,
    } satisfies RouteRule),
  ],
])

for (const path of [
  "/icon.ico",
  "/favicon.ico",
  "/logo_text.svg",
  "/placeholder-person.svg",
  "/fulfilled.png",
  "/pending.png",
  "/CreatorSharePin.svg",
]) {
  STATIC_RULES.set(
    path,
    Object.freeze({
      id: `public-asset:${path}`,
      action: "public-asset",
      methods: READ_METHODS,
      tenantAllowed: true,
    } satisfies RouteRule),
  )
}

for (const path of [
  "/bg.png",
  "/celebration-preview.html",
  "/creator-text.svg",
  "/creator.svg",
  "/hero-child-tanzania.png",
  "/john.png",
  "/logo_icon.svg",
  "/logo_text.png",
  "/mockServiceWorker.js",
]) {
  STATIC_RULES.set(
    path,
    Object.freeze({
      id: `primary-public-asset:${path}`,
      action: "public-asset",
      methods: READ_METHODS,
      tenantAllowed: false,
    } satisfies RouteRule),
  )
}

function hasCanonicalPathShape(pathname: string): boolean {
  return (
    pathname.length > 0 &&
    pathname.length <= MAX_PATHNAME_LENGTH &&
    pathname.startsWith("/") &&
    !CONTROL_CHARACTER_PATTERN.test(pathname) &&
    !pathname.includes("\\") &&
    !pathname.includes("//") &&
    (pathname === "/" || !pathname.endsWith("/"))
  )
}

function oneSegmentAfter(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null
  const segment = pathname.slice(prefix.length)
  return segment.length > 0 && !segment.includes("/") ? segment : null
}

function dynamicRule(pathname: string): RouteRule | null {
  const browseRoute = resolvePublicAdvocateBrowseRoute(pathname)
  if (browseRoute !== null) {
    if (browseRoute.routeId === "beneficiary-profile-page") {
      return PROFILE_PAGE_RULE
    }
    if (browseRoute.routeId === "catalog-redirect") {
      return Object.freeze({
        id: browseRoute.routeId,
        action: "allow",
        methods: READ_METHODS,
        tenantAllowed: true,
        visitorSession: false,
      } satisfies RouteRule)
    }
    return BROWSE_PAGE_RULE
  }

  const usernameApi = oneSegmentAfter(
    pathname,
    "/api/beneficiaries/get/username/",
  )
  if (usernameApi !== null && isValidBeneficiaryUsername(usernameApi)) {
    return Object.freeze({
      id: "beneficiary-profile-api",
      action: "allow",
      methods: GET_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule)
  }

  const mediaId = oneSegmentAfter(pathname, "/api/beneficiaries/images/")
  if (mediaId !== null && UUID_PATTERN.test(mediaId)) {
    return Object.freeze({
      id: "beneficiary-media-api",
      action: "allow",
      methods: GET_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule)
  }

  const activitiesMatch =
    /^\/api\/beneficiaries\/([0-9a-f-]+)\/activities$/.exec(pathname)
  if (activitiesMatch && UUID_PATTERN.test(activitiesMatch[1])) {
    return Object.freeze({
      id: "beneficiary-activities-api",
      action: "allow",
      methods: GET_METHOD,
      tenantAllowed: true,
      visitorSession: false,
    } satisfies RouteRule)
  }

  if (pathname.startsWith("/_next/static/") && pathname.length > 14) {
    return Object.freeze({
      id: "next-static-asset",
      action: "framework-asset",
      methods: READ_METHODS,
      tenantAllowed: true,
    } satisfies RouteRule)
  }

  if (
    pathname === "/_next/webpack-hmr" ||
    pathname.startsWith("/_next/webpack-hmr/")
  ) {
    return Object.freeze({
      id: "next-development-asset",
      action: "framework-asset",
      methods: READ_METHODS,
      tenantAllowed: true,
    } satisfies RouteRule)
  }

  return null
}

function routeRule(pathname: string): RouteRule | null {
  if (!hasCanonicalPathShape(pathname)) return null
  return STATIC_RULES.get(pathname) ?? dynamicRule(pathname)
}

function configuredHostname(value: string | undefined): string | null {
  if (!value || value.length > 2_048 || value !== value.trim()) return null

  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`)
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null
    }
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

function approvedPrimaryHostnames(
  environment: TenantRoutePolicyEnvironment,
): ReadonlySet<string> {
  const hostnames = new Set<string>([
    ADVOCATE_TENANT_ROOT,
    `www.${ADVOCATE_TENANT_ROOT}`,
    "creator-share-www.vercel.app",
  ])
  if (environment.NODE_ENV !== "production") {
    hostnames.add(ADVOCATE_LOCALHOST_ROOT)
    hostnames.add("127.0.0.1")
    hostnames.add("[::1]")
  }

  for (const configured of [
    environment.NEXT_PUBLIC_BASE_URL,
    environment.NEXT_PUBLIC_SITE_URL,
    environment.VERCEL_URL,
  ]) {
    const hostname = configuredHostname(configured)
    if (hostname === null) continue
    const creatorShareSubdomain = hostname.endsWith(`.${ADVOCATE_TENANT_ROOT}`)
    const localSubdomain = hostname.endsWith(`.${ADVOCATE_LOCALHOST_ROOT}`)
    if (creatorShareSubdomain || localSubdomain) continue
    if (
      environment.NODE_ENV === "production" &&
      (hostname === ADVOCATE_LOCALHOST_ROOT ||
        hostname === "127.0.0.1" ||
        hostname === "[::1]")
    ) {
      continue
    }
    hostnames.add(hostname)
  }
  return hostnames
}

type RequestHostScope = "approved-primary" | "restricted-tenant" | "rejected"

function classifyRequestHost(options: {
  rawHost: string | null | undefined
  environment?: TenantRoutePolicyEnvironment
}): RequestHostScope {
  const environment = options.environment ?? process.env
  const allowLocalhostDevelopment = environment.NODE_ENV !== "production"
  const resolution = resolveAdvocateHost(options.rawHost, {
    allowLocalhostDevelopment,
  })

  if (resolution.kind === "invalid") return "rejected"
  if (resolution.kind === "tenant-candidate") return "restricted-tenant"

  const hostname = resolution.normalizedHostname
  if (approvedPrimaryHostnames(environment).has(hostname)) {
    return "approved-primary"
  }
  return "rejected"
}

export function isRestrictedAdvocateHost(options: {
  rawHost: string | null | undefined
  environment?: TenantRoutePolicyEnvironment
}): boolean {
  return classifyRequestHost(options) === "restricted-tenant"
}

export type TenantRoutePolicyDecision =
  | Readonly<{ kind: "pass-through" }>
  | Readonly<{
      kind: "bypass"
      routeId: string
      reason: "framework-asset" | "public-asset" | "webhook"
    }>
  | Readonly<{
      kind: "allow"
      routeId: string
      neutralPaymentShell: boolean
      visitorSession: boolean
    }>
  | Readonly<{ kind: "allow-image-optimizer"; routeId: string }>
  | Readonly<{ kind: "canonical-auth-callback"; routeId: string }>
  | Readonly<{
      kind: "deny"
      status: 404 | 405
      allow: string | null
    }>

function methodAllowed(rule: RouteRule, method: string): boolean {
  return rule.methods.includes(method)
}

function allowHeader(rule: RouteRule): string {
  return rule.methods.join(", ")
}

export function resolveTenantRoutePolicy(options: {
  rawHost: string | null | undefined
  pathname: string
  method: string
  environment?: TenantRoutePolicyEnvironment
}): TenantRoutePolicyDecision {
  const method = options.method.toUpperCase()
  const rule = routeRule(options.pathname)
  const hostScope = classifyRequestHost(options)

  if (hostScope === "rejected") {
    return { kind: "deny", status: 404, allow: null }
  }

  if (hostScope === "approved-primary") {
    if (!rule || !methodAllowed(rule, method)) return { kind: "pass-through" }
    if (rule.action === "webhook") {
      return { kind: "bypass", routeId: rule.id, reason: "webhook" }
    }
    if (rule.action === "public-asset" || rule.action === "framework-asset") {
      return { kind: "bypass", routeId: rule.id, reason: rule.action }
    }
    if (rule.action === "image-optimizer") {
      return {
        kind: "bypass",
        routeId: rule.id,
        reason: "framework-asset",
      }
    }
    return { kind: "pass-through" }
  }

  if (!rule || !rule.tenantAllowed) {
    return { kind: "deny", status: 404, allow: null }
  }
  if (
    rule.id === "next-development-asset" &&
    (options.environment ?? process.env).NODE_ENV === "production"
  ) {
    return { kind: "deny", status: 404, allow: null }
  }
  if (!methodAllowed(rule, method)) {
    return rule.hideMethodMismatch
      ? { kind: "deny", status: 404, allow: null }
      : { kind: "deny", status: 405, allow: allowHeader(rule) }
  }

  switch (rule.action) {
    case "canonical-auth-callback":
      return { kind: "canonical-auth-callback", routeId: rule.id }
    case "framework-asset":
    case "public-asset":
      return { kind: "bypass", routeId: rule.id, reason: rule.action }
    case "image-optimizer":
      return { kind: "allow-image-optimizer", routeId: rule.id }
    case "allow":
      return {
        kind: "allow",
        routeId: rule.id,
        neutralPaymentShell: rule.neutralPaymentShell === true,
        visitorSession: rule.visitorSession === true,
      }
    case "webhook":
      return { kind: "deny", status: 404, allow: null }
  }
}

function configuredSupabaseOrigin(
  environment: TenantRoutePolicyEnvironment,
): string | null {
  const configured = environment.NEXT_PUBLIC_SUPABASE_URL
  if (
    !configured ||
    configured.length > 2_048 ||
    configured !== configured.trim()
  ) {
    return null
  }

  try {
    const url = new URL(configured)
    const localDevelopment =
      environment.NODE_ENV !== "production" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    if (
      (url.protocol !== "https:" &&
        !(localDevelopment && url.protocol === "http:")) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function validOptimizerSource(
  rawSource: string,
  environment: TenantRoutePolicyEnvironment,
): boolean {
  if (
    rawSource === "/logo_text.svg" ||
    rawSource === "/placeholder-person.svg" ||
    rawSource === "/fulfilled.png" ||
    rawSource === "/pending.png"
  ) {
    return true
  }

  const supabaseOrigin = configuredSupabaseOrigin(environment)
  if (supabaseOrigin === null) return false

  try {
    const url = new URL(rawSource)
    if (
      url.origin !== supabaseOrigin ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return false
    }
    return (
      url.pathname.startsWith("/storage/v1/object/public/media/") ||
      url.pathname.startsWith("/storage/v1/object/public/advocate-assets/")
    )
  } catch {
    return false
  }
}

export function isAllowedTenantImageOptimizerRequest(options: {
  searchParams: Pick<URLSearchParams, "getAll" | "keys">
  environment?: TenantRoutePolicyEnvironment
}): boolean {
  const environment = options.environment ?? process.env
  const allowedKeys = new Set(["url", "w", "q"])
  for (const key of options.searchParams.keys()) {
    if (!allowedKeys.has(key)) return false
  }

  const sources = options.searchParams.getAll("url")
  const widths = options.searchParams.getAll("w")
  const qualities = options.searchParams.getAll("q")
  if (
    sources.length !== 1 ||
    widths.length !== 1 ||
    qualities.length > 1 ||
    !/^[1-9][0-9]{0,4}$/.test(widths[0]) ||
    Number(widths[0]) > 8_192 ||
    (qualities.length === 1 &&
      (!/^[1-9][0-9]{0,2}$/.test(qualities[0]) || Number(qualities[0]) > 100))
  ) {
    return false
  }

  return validOptimizerSource(sources[0], environment)
}

export function resolveCanonicalPrimaryOrigin(
  environment: TenantRoutePolicyEnvironment = process.env,
): string | null {
  const configured =
    environment.NEXT_PUBLIC_BASE_URL ||
    environment.NEXT_PUBLIC_SITE_URL ||
    (environment.NODE_ENV === "production"
      ? `https://${ADVOCATE_TENANT_ROOT}`
      : "http://localhost:3000")

  if (configured.length > 2_048 || configured !== configured.trim()) {
    return null
  }

  try {
    const url = new URL(configured)
    const localDevelopment =
      environment.NODE_ENV !== "production" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    if (
      (url.protocol !== "https:" &&
        !(localDevelopment && url.protocol === "http:")) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null
    }

    const host = resolveAdvocateHost(url.host, {
      allowLocalhostDevelopment: localDevelopment,
    })
    if (host.kind === "invalid" || host.kind === "tenant-candidate") {
      return null
    }
    if (
      url.hostname.endsWith(`.${ADVOCATE_TENANT_ROOT}`) &&
      url.hostname !== `www.${ADVOCATE_TENANT_ROOT}`
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}
