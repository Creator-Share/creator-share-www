import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type ConfirmationRouteModule = typeof import("../../src/app/auth/confirm/route")
type ConfirmationModule =
  typeof import("../../src/lib/sponsorships/management/sponsorEmailConfirmation")

interface CookieAdapter {
  getAll(): Array<{ name: string; value: string }>
  setAll(
    cookies: Array<{
      name: string
      value: string
      options?: Record<string, unknown>
    }>,
  ): void
}

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const AUTH_SESSION_ID = "22222222-2222-4222-8222-222222222222"
const OTHER_AUTH_USER_ID = "33333333-3333-4333-8333-333333333333"
const TOKEN_HASH = "t".repeat(48)
const ORIGIN = "https://creatorshare.com"

function accessTokenFor(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".")
}

const ACCESS_TOKEN = accessTokenFor({
  sub: AUTH_USER_ID,
  session_id: AUTH_SESSION_ID,
})
const CURRENT_IDENTITY_SECRET = Buffer.alloc(32, 21).toString("base64")

const previousEnvironment = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  attributionSecret: process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1,
  passwordlessRateLimitSecret:
    process.env.SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1,
}

const verifyOtpCalls: Array<Record<string, unknown>> = []
const getUserCalls: unknown[] = []
const verificationReservationCalls: Array<{
  name: string
  input: Record<string, unknown>
}> = []
const receiptCalls: Array<{
  name: string
  input: Record<string, unknown>
}> = []
let authCookieWrites = true
let verifyOtpError: { message: string } | null = null
let verifyOtpUserId: string | null = AUTH_USER_ID
let accessToken: string | null = ACCESS_TOKEN
let authenticatedUserId: string | null = AUTH_USER_ID
let authenticatedEmailConfirmedAt: string | null = "2026-07-19T18:00:00.000Z"
let getUserError: { message: string } | null = null
let verificationReservationError: { message: string } | null = null
let verificationReservationData: unknown = [{ verification_allowed: true }]
let receiptError: { message: string } | null = null
let receiptData: unknown = [{ receipt_expires_at: "2099-07-19T18:15:00.000Z" }]

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@supabase/ssr") {
    return {
      createServerClient(
        _url: string,
        _key: string,
        options: { cookies: CookieAdapter },
      ) {
        return {
          auth: {
            async verifyOtp(input: Record<string, unknown>) {
              verifyOtpCalls.push(input)
              if (authCookieWrites) {
                options.cookies.setAll([
                  {
                    name: "sb-confirmation-session",
                    value: "verified-session-cookie",
                    options: {
                      httpOnly: true,
                      path: "/",
                      sameSite: "lax",
                    },
                  },
                ])
              }
              return {
                data: {
                  session: accessToken ? { access_token: accessToken } : null,
                  user: verifyOtpUserId ? { id: verifyOtpUserId } : null,
                },
                error: verifyOtpError,
              }
            },
            async getUser(token: unknown) {
              getUserCalls.push(token)
              return {
                data: {
                  user: authenticatedUserId
                    ? {
                        id: authenticatedUserId,
                        email_confirmed_at: authenticatedEmailConfirmedAt,
                      }
                    : null,
                },
                error: getUserError,
              }
            },
          },
        }
      },
    }
  }
  if (request === "@/utils/supabase/server") {
    return {
      createServiceRoleClient() {
        return {
          async rpc(name: string, input: Record<string, unknown>) {
            if (
              name === "reserve_sponsor_passwordless_email_verification_attempt"
            ) {
              verificationReservationCalls.push({ name, input })
              return {
                data: verificationReservationData,
                error: verificationReservationError,
              }
            }
            receiptCalls.push({ name, input })
            return { data: receiptData, error: receiptError }
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/sponsor-email-confirmation.spec.ts",
  ),
)
const confirmation = testRequire(
  "../../src/lib/sponsorships/management/sponsorEmailConfirmation",
) as ConfirmationModule
const { GET, HEAD, POST } = testRequire(
  "../../src/app/auth/confirm/route",
) as ConfirmationRouteModule
nodeModule._load = originalModuleLoad

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function confirmationPageRequest(
  next: string,
  options: {
    host?: string
    extraQuery?: string
    method?: "GET" | "HEAD"
    transportOrigin?: string
  } = {},
): NextRequest {
  const host = options.host ?? "creatorshare.com"
  const query = new URLSearchParams({ next }).toString()
  const suffix = options.extraQuery ? `&${options.extraQuery}` : ""
  const transportOrigin = options.transportOrigin ?? `https://${host}`
  return new NextRequest(`${transportOrigin}/auth/confirm?${query}${suffix}`, {
    method: options.method ?? "GET",
    headers: { host },
  })
}

function confirmationPostRequest(
  body: Record<string, unknown>,
  options: {
    host?: string
    origin?: string
    transportOrigin?: string
  } = {},
): NextRequest {
  const host = options.host ?? "creatorshare.com"
  const transportOrigin = options.transportOrigin ?? `https://${host}`
  return new NextRequest(`${transportOrigin}/auth/confirm`, {
    method: "POST",
    headers: {
      host,
      origin: options.origin ?? `https://${host}`,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  })
}

function setCookieHeaders(response: Response): string[] {
  return (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie()
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 =
    CURRENT_IDENTITY_SECRET
  process.env.SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1 = Buffer.alloc(
    32,
    47,
  ).toString("base64")
  verifyOtpCalls.length = 0
  getUserCalls.length = 0
  verificationReservationCalls.length = 0
  receiptCalls.length = 0
  authCookieWrites = true
  verifyOtpError = null
  verifyOtpUserId = AUTH_USER_ID
  accessToken = ACCESS_TOKEN
  authenticatedUserId = AUTH_USER_ID
  authenticatedEmailConfirmedAt = "2026-07-19T18:00:00.000Z"
  getUserError = null
  verificationReservationError = null
  verificationReservationData = [{ verification_allowed: true }]
  receiptError = null
  receiptData = [{ receipt_expires_at: "2099-07-19T18:15:00.000Z" }]
})

test.afterAll(() => {
  restoreEnvironment("NEXT_PUBLIC_BASE_URL", previousEnvironment.baseUrl)
  restoreEnvironment(
    "NEXT_PUBLIC_SUPABASE_URL",
    previousEnvironment.supabaseUrl,
  )
  restoreEnvironment(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    previousEnvironment.supabaseAnonKey,
  )
  restoreEnvironment(
    "ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1",
    previousEnvironment.attributionSecret,
  )
  restoreEnvironment(
    "SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1",
    previousEnvironment.passwordlessRateLimitSecret,
  )
})

test("accepts only an exact token hash and fixed confirmation destination", () => {
  for (const next of [
    "/app",
    "/sponsor/claim",
    "/app/main/onboarding",
  ] as const) {
    expect(
      confirmation.parseSponsorEmailConfirmationRequest(
        JSON.stringify({ tokenHash: TOKEN_HASH, next }),
      ),
    ).toEqual({ tokenHash: TOKEN_HASH, next })
  }

  for (const value of [
    "not-json",
    JSON.stringify({ tokenHash: TOKEN_HASH }),
    JSON.stringify({ tokenHash: TOKEN_HASH, next: "/admin" }),
    JSON.stringify({
      tokenHash: TOKEN_HASH,
      next: "/app",
      redirect: "https://attacker.example",
    }),
    JSON.stringify({ tokenHash: "too-short", next: "/app" }),
  ]) {
    expect(confirmation.parseSponsorEmailConfirmationRequest(value)).toBeNull()
  }
})

test("serves one raw no-store interstitial for every fixed destination", async () => {
  for (const next of ["/app", "/sponsor/claim", "/app/main/onboarding"]) {
    const response = await GET(confirmationPageRequest(next))
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    )
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(html).toContain("Continue securely")
    expect(html).not.toContain("/_next/")
  }

  const headResponse = await HEAD(
    confirmationPageRequest("/app", { method: "HEAD" }),
  )
  expect(headResponse.status).toBe(200)
  expect(await headResponse.text()).toBe("")
})

test("rejects aliases, duplicate query keys, and arbitrary destinations", async () => {
  const responses = await Promise.all([
    GET(confirmationPageRequest("/app", { host: "www.creatorshare.com" })),
    GET(
      confirmationPageRequest("/app", {
        host: "creator-share-www.vercel.app",
      }),
    ),
    GET(confirmationPageRequest("/admin")),
    GET(confirmationPageRequest("/app", { extraQuery: "next=%2Fadmin" })),
    GET(confirmationPageRequest("/app", { extraQuery: "utm_source=mail" })),
    GET(
      confirmationPageRequest("/app", {
        transportOrigin: "http://creatorshare.com",
      }),
    ),
  ])

  for (const response of responses) expect(response.status).toBe(404)
  expect(verifyOtpCalls).toHaveLength(0)
})

test("clears fragment candidates before invalid-envelope handling", () => {
  const { html } = confirmation.createSponsorEmailConfirmationInterstitial({
    next: "/app",
    nonce: "abcdefghijklmnopqrstuvwx",
  })
  const replaceIndex = html.indexOf("window.history.replaceState")
  const clearCandidateIndex = html.indexOf('candidateTokenHash = ""')
  const deleteCandidateIndex = html.indexOf('parameters.delete("token_hash")')
  const invalidBranchIndex = html.indexOf("if (!valid)")
  const listenerIndex = html.indexOf('form.addEventListener("submit"')
  const fetchIndex = html.indexOf("const confirmationRequest = fetch")
  const clearMaterialIndex = html.indexOf("material = null", fetchIndex)
  const awaitIndex = html.indexOf(
    "await confirmationRequest",
    clearMaterialIndex,
  )

  expect(replaceIndex).toBeGreaterThan(0)
  expect(clearCandidateIndex).toBeGreaterThan(replaceIndex)
  expect(deleteCandidateIndex).toBeGreaterThan(clearCandidateIndex)
  expect(invalidBranchIndex).toBeGreaterThan(deleteCandidateIndex)
  expect(fetchIndex).toBeGreaterThan(listenerIndex)
  expect(clearMaterialIndex).toBeGreaterThan(fetchIndex)
  expect(awaitIndex).toBeGreaterThan(clearMaterialIndex)
  for (const prohibited of [
    "localStorage",
    "sessionStorage",
    "console.",
    "analytics",
    "sendBeacon",
  ]) {
    expect(html).not.toContain(prohibited)
  }
  expect(html).toContain('cache: "no-store"')
  expect(html).toContain('credentials: "same-origin"')
  expect(html).toContain('redirect: "error"')
})

test("verifies one token hash without a prior browser cookie and records a live receipt", async () => {
  const response = await POST(
    confirmationPostRequest({
      tokenHash: TOKEN_HASH,
      next: "/app/main/onboarding",
    }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    ok: true,
    redirect: "/app/main/onboarding",
  })
  expect(verifyOtpCalls).toEqual([{ token_hash: TOKEN_HASH, type: "email" }])
  expect(verificationReservationCalls).toEqual([
    {
      name: "reserve_sponsor_passwordless_email_verification_attempt",
      input: {
        target_source_digest: expect.stringMatching(/^\\x[0-9a-f]{64}$/),
        target_source_hmac_key_version: 1,
        context_request_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
        ),
        context_trace_id: null,
      },
    },
  ])
  expect(getUserCalls).toEqual([ACCESS_TOKEN])
  expect(receiptCalls).toEqual([
    {
      name: "record_sponsor_email_authentication_receipt",
      input: {
        target_auth_user_id: AUTH_USER_ID,
        target_auth_session_id: AUTH_SESSION_ID,
        context_request_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
        ),
        context_trace_id: null,
      },
    },
  ])
  const cookies = setCookieHeaders(response)
  const sessionCookie = cookies.find((value) =>
    value.startsWith("sb-confirmation-session="),
  )
  expect(sessionCookie).toBeDefined()
  expect(sessionCookie).toContain("Secure")
  expect(sessionCookie).toContain("SameSite=lax")
  expect(
    cookies.some((value) =>
      value.startsWith("cs_advocate_attribution_identity_v1="),
    ),
  ).toBe(true)
})

test("reserves verification before the provider and hides a denied attempt as an invalid link", async () => {
  verificationReservationData = [{ verification_allowed: false }]

  const response = await POST(
    confirmationPostRequest({ tokenHash: TOKEN_HASH, next: "/app" }),
  )

  expect(response.status).toBe(410)
  expect(await response.json()).toEqual({
    ok: false,
    code: "invalid_or_expired",
  })
  expect(verificationReservationCalls).toHaveLength(1)
  expect(verifyOtpCalls).toHaveLength(0)
  expect(getUserCalls).toHaveLength(0)
  expect(receiptCalls).toHaveLength(0)
  expect(setCookieHeaders(response)).toEqual([])
})

test("fails closed before provider verification when reservation infrastructure is unavailable", async () => {
  verificationReservationError = { message: "database unavailable" }
  verificationReservationData = null

  const response = await POST(
    confirmationPostRequest({ tokenHash: TOKEN_HASH, next: "/app" }),
  )

  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    ok: false,
    code: "confirmation_unavailable",
  })
  expect(verificationReservationCalls).toHaveLength(1)
  expect(verifyOtpCalls).toHaveLength(0)
  expect(receiptCalls).toHaveLength(0)
  expect(setCookieHeaders(response)).toEqual([])
})

test("never releases staged auth cookies when receipt recording fails", async () => {
  receiptError = { message: "database unavailable" }
  receiptData = null

  const response = await POST(
    confirmationPostRequest({ tokenHash: TOKEN_HASH, next: "/app" }),
  )

  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    ok: false,
    code: "confirmation_unavailable",
  })
  expect(verifyOtpCalls).toHaveLength(1)
  expect(setCookieHeaders(response)).toEqual([])
})

test("requires one confirmed user and the exact verified auth session", async () => {
  const assertDenied = async () => {
    const response = await POST(
      confirmationPostRequest({ tokenHash: TOKEN_HASH, next: "/app" }),
    )
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      ok: false,
      code: "invalid_or_expired",
    })
    expect(setCookieHeaders(response)).toEqual([])
    expect(receiptCalls).toHaveLength(0)
    verifyOtpCalls.length = 0
    getUserCalls.length = 0
  }

  authenticatedUserId = OTHER_AUTH_USER_ID
  await assertDenied()

  authenticatedUserId = AUTH_USER_ID
  authenticatedEmailConfirmedAt = null
  await assertDenied()

  authenticatedEmailConfirmedAt = "2026-07-19T18:00:00.000Z"
  accessToken = accessTokenFor({
    sub: OTHER_AUTH_USER_ID,
    session_id: AUTH_SESSION_ID,
  })
  await assertDenied()

  accessToken = accessTokenFor({
    sub: AUTH_USER_ID,
    session_id: "not-a-session-id",
  })
  await assertDenied()
})

test("rejects expired or expanded receipt responses without releasing cookies", async () => {
  for (const invalidReceipt of [
    [{ receipt_expires_at: "2000-01-01T00:00:00.000Z" }],
    [
      {
        receipt_expires_at: "2099-07-19T18:15:00.000Z",
        auth_user_id: AUTH_USER_ID,
      },
    ],
  ]) {
    receiptData = invalidReceipt
    const response = await POST(
      confirmationPostRequest({ tokenHash: TOKEN_HASH, next: "/app" }),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      code: "confirmation_unavailable",
    })
    expect(setCookieHeaders(response)).toEqual([])
    receiptCalls.length = 0
  }
})

test("keeps invalid tokens and untrusted requests outside receipt issuance", async () => {
  verifyOtpError = { message: "expired" }
  accessToken = null
  verifyOtpUserId = null
  const invalidToken = await POST(
    confirmationPostRequest({ tokenHash: TOKEN_HASH, next: "/app" }),
  )
  expect(invalidToken.status).toBe(410)
  expect(setCookieHeaders(invalidToken)).toEqual([])
  expect(receiptCalls).toHaveLength(0)

  verifyOtpError = null
  accessToken = ACCESS_TOKEN
  verifyOtpUserId = AUTH_USER_ID
  verifyOtpCalls.length = 0
  const untrusted = await Promise.all([
    POST(
      confirmationPostRequest(
        { tokenHash: TOKEN_HASH, next: "/app" },
        { host: "www.creatorshare.com" },
      ),
    ),
    POST(
      confirmationPostRequest(
        { tokenHash: TOKEN_HASH, next: "/app" },
        { origin: "https://attacker.example" },
      ),
    ),
    POST(
      confirmationPostRequest(
        { tokenHash: TOKEN_HASH, next: "/app" },
        {
          origin: ORIGIN,
          transportOrigin: "http://creatorshare.com",
        },
      ),
    ),
  ])
  for (const response of untrusted) expect(response.status).toBe(400)
  expect(verificationReservationCalls).toHaveLength(1)
  expect(verifyOtpCalls).toHaveLength(0)
})

test("configures both project-wide email link templates for fragment delivery", () => {
  const config = readFileSync(
    resolve(process.cwd(), "supabase/config.toml"),
    "utf8",
  )
  const template = readFileSync(
    resolve(
      process.cwd(),
      "supabase/templates/sponsor_email_confirmation.html",
    ),
    "utf8",
  )

  expect(config).toContain("[auth.email.template.confirmation]")
  expect(config).toContain("[auth.email.template.magic_link]")
  expect(config.match(/sponsor_email_confirmation\.html/g)).toHaveLength(2)
  expect(template).toContain(
    "{{ .RedirectTo }}#token_hash={{ .TokenHash }}&amp;v=1",
  )
  expect(template).not.toContain("token_hash={{ .TokenHash }}?")
})
