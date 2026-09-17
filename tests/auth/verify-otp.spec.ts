import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

import type { SponsorPasswordlessVerificationSignals } from "../../src/lib/sponsorships/management/passwordlessRateLimit"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type VerifyOtpRouteModule =
  typeof import("../../src/app/api/auth/verify-otp/route")

const ORIGIN = "https://creatorshare.com"
const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_AUTH_USER_ID = "22222222-2222-4222-8222-222222222222"
const AUTH_SESSION_ID = "33333333-3333-4333-8333-333333333333"
const SUPABASE_URL = "https://recovery-project.supabase.co"
const RECOVERY_AUTH_COOKIE = "__Host-cs-password-recovery-v1"
const LOCAL_RECOVERY_AUTH_COOKIE = "cs_password_recovery_v1"
const MAXIMUM_VERIFY_OTP_BODY_BYTES = 1024
const PREVIOUS_ENVIRONMENT = {
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_SERVICE_ROLE_KEY: process.env.NEXT_SERVICE_ROLE_KEY,
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1:
    process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1,
}
const IDENTITY_SECRET = Buffer.alloc(32, 61).toString("base64")
const VALID_BODY = JSON.stringify({
  email: " Sponsor+Family@Example.com ",
  token: "123456",
  type: "recovery",
})
const VERIFICATION_CONTEXT = Object.freeze({
  requestId: "71000000-0000-4000-8000-000000000003",
  traceId: null,
})
const VERIFICATION_SIGNALS = Object.freeze({
  sourceDigest: ("\\x" + "3f".repeat(32)) as `\\x${string}`,
  sourceHmacKeyVersion: 1 as const,
}) satisfies SponsorPasswordlessVerificationSignals

function accessToken(
  authUserId: string = AUTH_USER_ID,
  authSessionId: string = AUTH_SESSION_ID,
): string {
  const encode = (value: Record<string, string>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: authUserId,
    session_id: authSessionId,
  })}.provider-signature`
}

function usableSession(
  authUserId: string = AUTH_USER_ID,
  authSessionId: string = AUTH_SESSION_ID,
) {
  return {
    access_token: accessToken(authUserId, authSessionId),
    refresh_token: "opaque-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 2_000_000_000,
    user: { id: authUserId },
  }
}

function verifiedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: AUTH_USER_ID,
    email: "sponsor+family@example.com",
    email_confirmed_at: "2026-07-20T00:00:00.000Z",
    is_anonymous: false,
    ...overrides,
  }
}

const events: string[] = []
const contextCalls: Request[] = []
const signalCalls: Array<Record<string, unknown>> = []
const reservationCalls: Array<Record<string, unknown>> = []
const verifyOtpCalls: Array<Record<string, unknown>> = []
const getUserCalls: string[] = []
const receiptCalls: Array<{
  name: string
  input: Record<string, unknown>
}> = []
const serviceClientOptions: Array<Record<string, unknown>> = []
const serverClientCookieOptions: Array<Record<string, unknown>> = []
let createServerClientCalls = 0
let contextFailure: Error | null = null
let signalFailure: Error | null = null
let reservationFailure: Error | null = null
let reservationAllowed = true
let createServerClientFailure: Error | null = null
let providerFailure: Error | null = null
let getUserFailure: Error | null = null
let receiptFailure: Error | null = null
let serviceClientFailure: Error | null = null
let emitAuthCookie = true
let emittedAuthCookieName = RECOVERY_AUTH_COOKIE
let emittedAuthCookieOptions: Record<string, unknown> = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: true,
  maxAge: 400 * 24 * 60 * 60,
}
let additionalAuthCookieWrites: Array<{
  name: string
  value: string
  options: Record<string, unknown>
}> = []
let authenticatedResult: unknown = {
  data: { user: verifiedUser() },
  error: null,
}
let receiptResult: unknown = [
  { receipt_expires_at: "2099-07-20T00:15:00.000Z" },
]
let receiptError: unknown = null
let providerResult: unknown = {
  data: {
    user: { id: AUTH_USER_ID },
    session: usableSession(),
  },
  error: null,
}

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
    const actual = originalModuleLoad.call(
      this,
      request,
      parent,
      isMain,
    ) as Record<string, unknown>
    return {
      ...actual,
      createServerClient(
        _url: string,
        _key: string,
        options: {
          cookieOptions: Record<string, unknown>
          cookies: {
            getAll(): Array<{ name: string; value: string }>
            setAll(
              cookies: Array<{
                name: string
                value: string
                options?: Record<string, unknown>
              }>,
            ): void
          }
        },
      ) {
        events.push("client")
        createServerClientCalls += 1
        serverClientCookieOptions.push(options.cookieOptions)
        if (createServerClientFailure) throw createServerClientFailure
        return {
          auth: {
            async verifyOtp(input: Record<string, unknown>) {
              events.push("provider")
              verifyOtpCalls.push(input)
              if (providerFailure) throw providerFailure
              if (emitAuthCookie) {
                options.cookies.setAll([
                  {
                    name: emittedAuthCookieName,
                    value: "base64-provider-session",
                    options: emittedAuthCookieOptions,
                  },
                  ...additionalAuthCookieWrites,
                ])
              }
              return providerResult
            },
            async getUser(token: string) {
              events.push("get-user")
              getUserCalls.push(token)
              if (getUserFailure) throw getUserFailure
              return authenticatedResult
            },
          },
        }
      },
    }
  }
  if (request === "@/lib/sponsorships/management/passwordlessRateLimit") {
    return {
      sponsorPasswordlessDeliveryContext(input: Request) {
        events.push("context")
        contextCalls.push(input)
        if (contextFailure) throw contextFailure
        return VERIFICATION_CONTEXT
      },
      createSponsorPasswordlessVerificationSignals(
        input: Record<string, unknown>,
      ) {
        events.push("signals")
        signalCalls.push(input)
        if (signalFailure) throw signalFailure
        return VERIFICATION_SIGNALS
      },
      async reserveSponsorPasswordlessVerificationAttempt(
        input: Record<string, unknown>,
      ) {
        events.push("reserve")
        reservationCalls.push(input)
        if (reservationFailure) throw reservationFailure
        return reservationAllowed
      },
    }
  }
  if (request === "@/utils/supabase/server") {
    return {
      createServiceRoleClient(options: Record<string, unknown>) {
        events.push("service-client")
        serviceClientOptions.push(options)
        if (serviceClientFailure) throw serviceClientFailure
        return {
          async rpc(name: string, input: Record<string, unknown>) {
            events.push("record-receipt")
            receiptCalls.push({ name, input })
            if (receiptFailure) throw receiptFailure
            return { data: receiptResult, error: receiptError }
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/auth/verify-otp.spec.ts"),
)
const verifyOtpRoutePath = testRequire.resolve(
  "../../src/app/api/auth/verify-otp/route",
)
delete testRequire.cache[verifyOtpRoutePath]
const { POST, dynamic, runtime } = testRequire(
  verifyOtpRoutePath,
) as VerifyOtpRouteModule
delete testRequire.cache[verifyOtpRoutePath]
nodeModule._load = originalModuleLoad

function requestFor(
  body: string,
  options: {
    host?: string
    transportOrigin?: string
    origin?: string | null
    fetchSite?: string | null
    contentType?: string | null
    contentLength?: string | null
    cookie?: string | null
  } = {},
): NextRequest {
  const host = options.host ?? "creatorshare.com"
  const transportOrigin = options.transportOrigin ?? `https://${host}`
  const origin = options.origin === undefined ? transportOrigin : options.origin
  const headers = new Headers({ host })
  if (origin !== null) headers.set("origin", origin)
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin")
  }
  if (options.contentType !== null) {
    headers.set(
      "content-type",
      options.contentType ?? "application/json; charset=utf-8",
    )
  }
  if (options.contentLength !== undefined) {
    if (options.contentLength === null) headers.delete("content-length")
    else headers.set("content-length", options.contentLength)
  }
  if (options.cookie !== undefined) {
    if (options.cookie === null) headers.delete("cookie")
    else headers.set("cookie", options.cookie)
  }

  return new NextRequest(`${transportOrigin}/api/auth/verify-otp`, {
    method: "POST",
    headers,
    body,
  })
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function expectPrivacyHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(response.headers.get("pragma")).toBe("no-cache")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
}

function setCookieHeaders(response: Response): string[] {
  return (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie()
}

async function expectPrivateError(
  response: Response,
  status: number,
  code: string,
  forbiddenText: readonly string[] = [],
): Promise<void> {
  expect(response.status).toBe(status)
  const body = await bodyOf(response)
  expect(body).toEqual({ error: code })
  const serialized = JSON.stringify(body)
  for (const value of forbiddenText) expect(serialized).not.toContain(value)
  expectPrivacyHeaders(response)
  expect(setCookieHeaders(response)).toEqual([])
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
  process.env.NEXT_SERVICE_ROLE_KEY = "test-service-role-key"
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = IDENTITY_SECRET
  events.length = 0
  contextCalls.length = 0
  signalCalls.length = 0
  reservationCalls.length = 0
  verifyOtpCalls.length = 0
  getUserCalls.length = 0
  receiptCalls.length = 0
  serviceClientOptions.length = 0
  serverClientCookieOptions.length = 0
  createServerClientCalls = 0
  contextFailure = null
  signalFailure = null
  reservationFailure = null
  reservationAllowed = true
  createServerClientFailure = null
  providerFailure = null
  getUserFailure = null
  receiptFailure = null
  serviceClientFailure = null
  emitAuthCookie = true
  emittedAuthCookieName = RECOVERY_AUTH_COOKIE
  emittedAuthCookieOptions = {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: true,
    maxAge: 400 * 24 * 60 * 60,
  }
  additionalAuthCookieWrites = []
  authenticatedResult = {
    data: { user: verifiedUser() },
    error: null,
  }
  receiptResult = [{ receipt_expires_at: "2099-07-20T00:15:00.000Z" }]
  receiptError = null
  providerResult = {
    data: {
      user: { id: AUTH_USER_ID },
      session: usableSession(),
    },
    error: null,
  }
})

test.afterAll(() => {
  for (const [name, value] of Object.entries(PREVIOUS_ENVIRONMENT)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test("pins recovery verification to the dynamic Node runtime", () => {
  expect(runtime).toBe("nodejs")
  expect(dynamic).toBe("force-dynamic")
})

test("rejects tenant and noncanonical origins before quota or authentication", async () => {
  const requests = [
    requestFor(VALID_BODY, { host: "hope.creatorshare.com" }),
    requestFor(VALID_BODY, { host: "www.creatorshare.com" }),
    requestFor(VALID_BODY, { host: "creator-share-www.vercel.app" }),
    requestFor(VALID_BODY, {
      transportOrigin: "https://preview.example",
      origin: ORIGIN,
    }),
    requestFor(VALID_BODY, {
      origin: "https://attacker.example",
      fetchSite: "cross-site",
    }),
    requestFor(VALID_BODY, { origin: null }),
    requestFor(VALID_BODY, { fetchSite: "cross-site" }),
    requestFor(VALID_BODY, { contentType: "text/plain" }),
    requestFor(VALID_BODY, { contentType: null }),
  ]

  for (const request of requests) {
    await expectPrivateError(await POST(request), 400, "invalid-request")
  }

  expect(events).toEqual([])
  expect(createServerClientCalls).toBe(0)
  expect(verifyOtpCalls).toEqual([])
})

test("rejects raw duplicate, mixed, gapped, and shadowed recovery cookies before quota work", async () => {
  const ambiguousCookieHeaders = [
    `${RECOVERY_AUTH_COOKIE}=host-session; ${RECOVERY_AUTH_COOKIE}=parent-domain-shadow`,
    `${RECOVERY_AUTH_COOKIE}=base-session; ${RECOVERY_AUTH_COOKIE}.0=chunk-session`,
    `${RECOVERY_AUTH_COOKIE}.0=first; ${RECOVERY_AUTH_COOKIE}.0=shadow`,
    `${RECOVERY_AUTH_COOKIE}.1=orphaned-chunk`,
  ]

  for (const cookie of ambiguousCookieHeaders) {
    await expectPrivateError(
      await POST(requestFor(VALID_BODY, { cookie })),
      400,
      "invalid-request",
    )
  }

  expect(events).toEqual([])
  expect(createServerClientCalls).toBe(0)
  expect(verifyOtpCalls).toEqual([])
})

test("fails closed when the configured canonical origin is unavailable", async () => {
  process.env.NEXT_PUBLIC_BASE_URL = "not a canonical origin"

  await expectPrivateError(
    await POST(requestFor(VALID_BODY)),
    503,
    "verification-unavailable",
  )
  expect(events).toEqual([])
})

test("rejects oversized, malformed, and expanded bodies before quota work", async () => {
  const malformedBodies = [
    "not-json",
    "[]",
    JSON.stringify({
      email: "not-an-email",
      token: "123456",
      type: "recovery",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: "12345",
      type: "recovery",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: "12345a",
      type: "recovery",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: 123456,
      type: "recovery",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: "123456",
      type: "signup",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: "123456",
      type: "recovery",
      redirectTo: "https://attacker.example",
    }),
    JSON.stringify({
      email: `${"a".repeat(65)}@example.com`,
      token: "123456",
      type: "recovery",
    }),
  ]

  for (const body of malformedBodies) {
    await expectPrivateError(
      await POST(requestFor(body)),
      400,
      "invalid-request",
    )
  }

  for (const request of [
    requestFor(VALID_BODY, {
      contentLength: String(MAXIMUM_VERIFY_OTP_BODY_BYTES + 1),
    }),
    requestFor(VALID_BODY, { contentLength: "unknown" }),
    requestFor("x".repeat(MAXIMUM_VERIFY_OTP_BODY_BYTES + 1)),
  ]) {
    await expectPrivateError(await POST(request), 400, "invalid-request")
  }

  expect(events).toEqual([])
  expect(createServerClientCalls).toBe(0)
})

test("reserves one verification attempt before provider access", async () => {
  const request = requestFor(VALID_BODY)
  const response = await POST(request)

  expect(response.status).toBe(200)
  expect(await bodyOf(response)).toEqual({
    message: "OTP verified successfully.",
  })
  expectPrivacyHeaders(response)
  expect(events).toEqual([
    "context",
    "signals",
    "reserve",
    "client",
    "provider",
    "get-user",
    "service-client",
    "record-receipt",
  ])
  expect(contextCalls).toEqual([request])
  expect(signalCalls).toHaveLength(1)
  expect(signalCalls[0]).toEqual({ headers: request.headers })
  expect(reservationCalls).toEqual([
    {
      signals: VERIFICATION_SIGNALS,
      context: VERIFICATION_CONTEXT,
    },
  ])
  expect(verifyOtpCalls).toEqual([
    {
      email: "sponsor+family@example.com",
      token: "123456",
      type: "recovery",
    },
  ])
  expect(getUserCalls).toEqual([accessToken()])
  expect(serverClientCookieOptions).toEqual([
    {
      name: RECOVERY_AUTH_COOKIE,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: true,
      maxAge: 15 * 60,
    },
  ])
  expect(serviceClientOptions).toEqual([{ requestTimeoutMilliseconds: 8_000 }])
  expect(receiptCalls).toHaveLength(1)
  expect(receiptCalls[0].name).toBe(
    "record_sponsor_email_authentication_receipt",
  )
  expect(receiptCalls[0].input).toMatchObject({
    target_auth_user_id: AUTH_USER_ID,
    target_auth_session_id: AUTH_SESSION_ID,
    context_trace_id: null,
  })
  expect(receiptCalls[0].input.context_request_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )

  const cookies = setCookieHeaders(response)
  const activeAuthCookies = cookies.filter((cookie) =>
    cookie.startsWith(`${RECOVERY_AUTH_COOKIE}=`),
  )
  expect(activeAuthCookies).toHaveLength(1)
  expect(activeAuthCookies[0]).toContain("base64-provider-session")
  expect(activeAuthCookies[0]).toContain("Secure")
  expect(activeAuthCookies[0]).toContain("HttpOnly")
  expect(activeAuthCookies[0]).toContain("SameSite=lax")
  expect(activeAuthCookies[0]).toContain("Max-Age=900")
  expect(activeAuthCookies[0]).not.toContain("Domain=")
  const activeIdentityCookies = cookies.filter(
    (cookie) =>
      cookie.startsWith("cs_advocate_attribution_identity_v1=") &&
      !cookie.includes("Max-Age=0"),
  )
  expect(activeIdentityCookies).toHaveLength(1)
  expect(activeIdentityCookies[0]).not.toContain("Domain=")
  expect(activeIdentityCookies[0]).toContain("HttpOnly")
  expect(activeIdentityCookies[0]).toContain("Secure")
  expect(activeIdentityCookies[0]).toContain("SameSite=lax")
})

test("uses an isolated nonsecure recovery cookie only on HTTP loopback development", async () => {
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000"
  emittedAuthCookieName = LOCAL_RECOVERY_AUTH_COOKIE
  emittedAuthCookieOptions = {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: false,
    maxAge: 400 * 24 * 60 * 60,
  }

  const response = await POST(
    requestFor(VALID_BODY, {
      host: "localhost:3000",
      transportOrigin: "http://localhost:3000",
      origin: "http://localhost:3000",
    }),
  )

  expect(response.status).toBe(200)
  expect(serverClientCookieOptions).toEqual([
    {
      name: LOCAL_RECOVERY_AUTH_COOKIE,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: false,
      maxAge: 15 * 60,
    },
  ])
  const recoveryCookie = setCookieHeaders(response).find((cookie) =>
    cookie.startsWith(`${LOCAL_RECOVERY_AUTH_COOKIE}=`),
  )
  expect(recoveryCookie).toBeDefined()
  expect(recoveryCookie).toContain("HttpOnly")
  expect(recoveryCookie).toContain("Max-Age=900")
  expect(recoveryCookie).not.toContain("Secure")
  expect(recoveryCookie).not.toContain("Domain=")
})

test("never acknowledges verification without a host-only Supabase session cookie", async () => {
  for (const scenario of ["missing", "wrong-name", "domain"] as const) {
    events.length = 0
    receiptCalls.length = 0
    emitAuthCookie = scenario !== "missing"
    emittedAuthCookieName =
      scenario === "wrong-name" ? "unrelated-cookie" : RECOVERY_AUTH_COOKIE
    emittedAuthCookieOptions = {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: true,
      maxAge: 400 * 24 * 60 * 60,
      ...(scenario === "domain" ? { domain: ".creatorshare.com" } : {}),
    }

    await expectPrivateError(
      await POST(requestFor(VALID_BODY)),
      503,
      "verification-unavailable",
    )
    expect(receiptCalls).toEqual([])
  }
})

test("rejects provider recovery writes that omit any required __Host attribute", async () => {
  for (const omitted of ["path", "sameSite", "httpOnly", "secure"] as const) {
    events.length = 0
    receiptCalls.length = 0
    emittedAuthCookieOptions = {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: true,
      maxAge: 400 * 24 * 60 * 60,
    }
    delete emittedAuthCookieOptions[omitted]

    await expectPrivateError(
      await POST(requestFor(VALID_BODY)),
      503,
      "verification-unavailable",
    )
    expect(receiptCalls).toEqual([])
  }
})

test("rejects incomplete, mixed, and stale outgoing recovery cookie topologies", async () => {
  const providerOptions = {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: true,
    maxAge: 400 * 24 * 60 * 60,
  }
  const scenarios = [
    {
      name: "orphaned outgoing chunk",
      emittedName: `${RECOVERY_AUTH_COOKIE}.1`,
      additional: [],
      cookie: null,
    },
    {
      name: "mixed outgoing base and chunks",
      emittedName: RECOVERY_AUTH_COOKIE,
      additional: [
        {
          name: `${RECOVERY_AUTH_COOKIE}.0`,
          value: "second-provider-chunk",
          options: providerOptions,
        },
      ],
      cookie: null,
    },
    {
      name: "unreplaced stale chunk",
      emittedName: `${RECOVERY_AUTH_COOKIE}.0`,
      additional: [],
      cookie: `${RECOVERY_AUTH_COOKIE}.0=old-first; ${RECOVERY_AUTH_COOKIE}.1=old-second`,
    },
  ]

  for (const scenario of scenarios) {
    await test.step(scenario.name, async () => {
      events.length = 0
      receiptCalls.length = 0
      emittedAuthCookieName = scenario.emittedName
      emittedAuthCookieOptions = providerOptions
      additionalAuthCookieWrites = scenario.additional

      await expectPrivateError(
        await POST(requestFor(VALID_BODY, { cookie: scenario.cookie })),
        503,
        "verification-unavailable",
      )
      expect(receiptCalls).toEqual([])
    })
  }
})

test("validates the provider user and exact JWT session before recording proof", async () => {
  const invalidUsers: unknown[] = [
    { data: { user: null }, error: null },
    { data: { user: verifiedUser({ id: OTHER_AUTH_USER_ID }) }, error: null },
    {
      data: { user: verifiedUser({ email: "other@example.com" }) },
      error: null,
    },
    {
      data: { user: verifiedUser({ email_confirmed_at: "not-a-date" }) },
      error: null,
    },
    {
      data: { user: verifiedUser({ is_anonymous: "false" }) },
      error: null,
    },
    {
      data: { user: verifiedUser({ banned_until: "not-a-date" }) },
      error: null,
    },
    // An actively banned account. The unparseable case above is rejected by
    // the timestamp parse alone, so it cannot tell whether the ban itself is
    // honoured. Without this, a suspended sponsor completes recovery
    // verification and is issued a password-recovery receipt.
    {
      data: {
        user: verifiedUser({
          banned_until: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      },
      error: null,
    },
    {
      data: { user: verifiedUser({ deleted_at: "2026-07-20T00:00:00Z" }) },
      error: null,
    },
  ]

  for (const invalidUser of invalidUsers) {
    receiptCalls.length = 0
    authenticatedResult = invalidUser
    await expectPrivateError(
      await POST(requestFor(VALID_BODY)),
      503,
      "verification-unavailable",
    )
    expect(receiptCalls).toEqual([])
  }

  // A lapsed ban must not block recovery, so the assertion above turns on the
  // ban still being in force rather than on the field being present.
  receiptCalls.length = 0
  authenticatedResult = {
    data: {
      user: verifiedUser({
        banned_until: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    },
    error: null,
  }
  providerResult = {
    data: {
      user: { id: AUTH_USER_ID },
      session: usableSession(
        AUTH_USER_ID,
        "55555555-5555-4555-8555-555555555555",
      ),
    },
    error: null,
  }
  expect((await POST(requestFor(VALID_BODY))).status).toBe(200)
  // Leave the recorder clean so the original assertion below still reads its
  // own receipt rather than this one.
  receiptCalls.length = 0

  authenticatedResult = { data: { user: verifiedUser() }, error: null }
  providerResult = {
    data: {
      user: { id: AUTH_USER_ID },
      session: usableSession(
        AUTH_USER_ID,
        "44444444-4444-4444-8444-444444444444",
      ),
    },
    error: null,
  }
  const response = await POST(requestFor(VALID_BODY))
  expect(response.status).toBe(200)
  expect(receiptCalls[0].input.target_auth_session_id).toBe(
    "44444444-4444-4444-8444-444444444444",
  )
})

test("discards staged auth cookies when receipt persistence is ambiguous", async () => {
  for (const failure of ["error", "malformed", "throw"] as const) {
    receiptCalls.length = 0
    receiptError =
      failure === "error" ? { message: "private database detail" } : null
    receiptResult = failure === "malformed" ? [] : receiptResult
    receiptFailure =
      failure === "throw" ? new Error("private transport detail") : null

    await expectPrivateError(
      await POST(requestFor(VALID_BODY)),
      503,
      "verification-unavailable",
      ["private database detail", "private transport detail"],
    )

    receiptError = null
    receiptResult = [{ receipt_expires_at: "2099-07-20T00:15:00.000Z" }]
    receiptFailure = null
  }
})

test("suppresses provider access when the verification quota denies", async () => {
  reservationAllowed = false

  await expectPrivateError(
    await POST(requestFor(VALID_BODY)),
    400,
    "verification-failed",
  )
  expect(events).toEqual(["context", "signals", "reserve"])
  expect(contextCalls).toHaveLength(1)
  expect(reservationCalls).toHaveLength(1)
  expect(createServerClientCalls).toBe(0)
  expect(verifyOtpCalls).toEqual([])
})

test("treats quota and quota configuration failures as ambiguous", async () => {
  contextFailure = new Error("sensitive context detail")
  await expectPrivateError(
    await POST(requestFor(VALID_BODY)),
    503,
    "verification-unavailable",
    ["sensitive context detail"],
  )

  contextFailure = null
  signalFailure = new Error("sensitive signal detail")
  await expectPrivateError(
    await POST(requestFor(VALID_BODY)),
    503,
    "verification-unavailable",
    ["sensitive signal detail"],
  )

  signalFailure = null
  reservationFailure = new Error("sensitive database detail")
  await expectPrivateError(
    await POST(requestFor(VALID_BODY)),
    503,
    "verification-unavailable",
    ["sensitive database detail"],
  )

  expect(createServerClientCalls).toBe(0)
  expect(verifyOtpCalls).toEqual([])
})

test("maps provider rejection to one private verification failure", async () => {
  providerResult = {
    data: { user: null, session: null },
    error: { message: "sensitive provider account detail" },
  }

  await expectPrivateError(
    await POST(requestFor(VALID_BODY)),
    400,
    "verification-failed",
    ["sensitive provider account detail", "sponsor+family@example.com"],
  )
  expect(events).toEqual([
    "context",
    "signals",
    "reserve",
    "client",
    "provider",
  ])
})

test("treats provider exceptions as ambiguous without exposing details", async () => {
  createServerClientFailure = new Error("sensitive client configuration")
  await expectPrivateError(
    await POST(requestFor(VALID_BODY)),
    503,
    "verification-unavailable",
    ["sensitive client configuration"],
  )

  createServerClientFailure = null
  providerFailure = new Error("sensitive provider infrastructure detail")
  await expectPrivateError(
    await POST(requestFor(VALID_BODY)),
    503,
    "verification-unavailable",
    ["sensitive provider infrastructure detail"],
  )
})

test("rejects malformed provider success responses as ambiguous", async () => {
  const malformedResponses: Array<{ name: string; response: unknown }> = [
    { name: "null response", response: null },
    { name: "array response", response: [] },
    { name: "empty response", response: {} },
    { name: "null data", response: { data: null, error: null } },
    {
      name: "null user and session",
      response: { data: { user: null, session: null }, error: null },
    },
    {
      name: "null session",
      response: {
        data: { user: { id: AUTH_USER_ID }, session: null },
        error: null,
      },
    },
    {
      name: "user-only response",
      response: {
        data: { user: { id: AUTH_USER_ID } },
        error: null,
      },
    },
    {
      name: "session-only response",
      response: {
        data: { session: usableSession() },
        error: null,
      },
    },
    {
      name: "malformed session",
      response: {
        data: {
          user: { id: AUTH_USER_ID },
          session: {
            ...usableSession(),
            refresh_token: null,
          },
        },
        error: null,
      },
    },
    {
      name: "mismatched session user",
      response: {
        data: {
          user: { id: AUTH_USER_ID },
          session: usableSession(OTHER_AUTH_USER_ID),
        },
        error: null,
      },
    },
    {
      name: "invalid user identifier",
      response: {
        data: { user: { id: "not-a-uuid" }, session: usableSession() },
        error: null,
      },
    },
    {
      name: "nonobject provider error",
      response: {
        data: { user: { id: AUTH_USER_ID } },
        error: "not-a-provider-error-object",
      },
    },
  ]

  for (const malformed of malformedResponses) {
    await test.step(malformed.name, async () => {
      providerResult = malformed.response
      await expectPrivateError(
        await POST(requestFor(VALID_BODY)),
        503,
        "verification-unavailable",
      )
    })
  }
})
