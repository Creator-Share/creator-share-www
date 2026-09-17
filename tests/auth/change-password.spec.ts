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
type ChangePasswordRouteModule =
  typeof import("../../src/app/api/auth/change-password/route")

const ORIGIN = "https://creatorshare.com"
const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"
const AUTH_SESSION_ID = "33333333-3333-4333-8333-333333333333"
const OTHER_SESSION_ID = "44444444-4444-4444-8444-444444444444"
const SUPABASE_URL = "https://recovery-project.supabase.co"
const DEFAULT_SUPABASE_AUTH_COOKIE = "sb-recovery-project-auth-token"
const RECOVERY_AUTH_COOKIE = "__Host-cs-password-recovery-v1"
const VALID_PASSWORD = "Correct horse 7!"
const CONFIRMED_AT = "2025-01-01T00:00:00.000Z"
const PREVIOUS_ENVIRONMENT = {
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
}

const events: string[] = []
const updateInputs: Array<Record<string, unknown>> = []
const rpcCalls: string[] = []
const cookieSnapshots: Array<Array<{ name: string; value: string }>> = []
const serverClientCookieOptions: Array<Record<string, unknown>> = []
const signOutInputs: Array<Record<string, unknown>> = []
let createClientFailure: Error | null = null
let authenticationFailure: Error | null = null
let authorizationFailure: Error | null = null
let updateFailure: Error | null = null
let signOutFailure: Error | null = null
let authenticationResult: unknown
let authorizationResult: unknown
let authorizationError: unknown
let updateResult: unknown
let signOutResult: unknown
let emitSignOutClear = true
let signOutCookieName = RECOVERY_AUTH_COOKIE
let signOutCookieOptions: Record<string, unknown> = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: true,
  maxAge: 0,
}
let additionalSignOutCookieWrites: Array<{
  name: string
  value: string
  options: Record<string, unknown>
}> = []

function authenticatedUser(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: AUTH_USER_ID,
    email: "sponsor@example.com",
    email_confirmed_at: CONFIRMED_AT,
    is_anonymous: false,
    ...overrides,
  }
}

function resetProviderState(): void {
  events.length = 0
  updateInputs.length = 0
  rpcCalls.length = 0
  cookieSnapshots.length = 0
  serverClientCookieOptions.length = 0
  signOutInputs.length = 0
  createClientFailure = null
  authenticationFailure = null
  authorizationFailure = null
  updateFailure = null
  signOutFailure = null
  authenticationResult = {
    data: { user: authenticatedUser() },
    error: null,
  }
  authorizationResult = [
    {
      authorized_auth_user_id: AUTH_USER_ID,
      authorized_auth_session_id: AUTH_SESSION_ID,
    },
  ]
  authorizationError = null
  updateResult = {
    data: { user: { id: AUTH_USER_ID } },
    error: null,
  }
  signOutResult = { error: null }
  emitSignOutClear = true
  signOutCookieName = RECOVERY_AUTH_COOKIE
  signOutCookieOptions = {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: true,
    maxAge: 0,
  }
  additionalSignOutCookieWrites = []
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
    return {
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
        events.push("create-client")
        serverClientCookieOptions.push(options.cookieOptions)
        if (createClientFailure) throw createClientFailure
        return {
          auth: {
            async getUser() {
              events.push("get-user")
              cookieSnapshots.push(options.cookies.getAll())
              if (authenticationFailure) throw authenticationFailure
              return authenticationResult
            },
            async updateUser(input: Record<string, unknown>) {
              events.push("update-user")
              updateInputs.push(input)
              if (updateFailure) throw updateFailure
              return updateResult
            },
            async signOut(input: Record<string, unknown>) {
              events.push("sign-out")
              signOutInputs.push(input)
              if (signOutFailure) throw signOutFailure
              if (emitSignOutClear) {
                options.cookies.setAll([
                  {
                    name: signOutCookieName,
                    value: "",
                    options: signOutCookieOptions,
                  },
                  ...additionalSignOutCookieWrites,
                ])
              }
              return signOutResult
            },
          },
          async rpc(name: string) {
            events.push("consume-receipt")
            rpcCalls.push(name)
            cookieSnapshots.push(options.cookies.getAll())
            if (authorizationFailure) throw authorizationFailure
            return { data: authorizationResult, error: authorizationError }
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/auth/change-password.spec.ts"),
)
const routePath = testRequire.resolve(
  "../../src/app/api/auth/change-password/route",
)
delete testRequire.cache[routePath]
const { POST, dynamic, runtime } = testRequire(
  routePath,
) as ChangePasswordRouteModule
delete testRequire.cache[routePath]
nodeModule._load = originalModuleLoad

function requestFor(
  serializedBody: string,
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
  if (options.cookie !== null) {
    headers.set(
      "cookie",
      options.cookie ??
        `${RECOVERY_AUTH_COOKIE}=base64-recovery-session; ${DEFAULT_SUPABASE_AUTH_COOKIE}=base64-ambient-session`,
    )
  }

  return new NextRequest(`${transportOrigin}/api/auth/change-password`, {
    method: "POST",
    headers,
    body: serializedBody,
  })
}

function validRequest(): NextRequest {
  return requestFor(JSON.stringify({ password: VALID_PASSWORD }))
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

async function expectError(
  response: Response,
  status: number,
  error: string,
): Promise<void> {
  expect(response.status).toBe(status)
  expect(await bodyOf(response)).toEqual({ error })
  expectPrivacyHeaders(response)
  expect(setCookieHeaders(response)).toHaveLength(0)
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
  resetProviderState()
})

test.afterAll(() => {
  for (const [name, value] of Object.entries(PREVIOUS_ENVIRONMENT)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test("pins password changes to a dynamic Node route", () => {
  expect(runtime).toBe("nodejs")
  expect(dynamic).toBe("force-dynamic")
})

test("rejects noncanonical requests before reading the body or authenticating", async () => {
  const scenarios = [
    { origin: "https://attacker.example", fetchSite: "cross-site" },
    { transportOrigin: "https://preview.example", origin: ORIGIN },
    { origin: "https://hope.creatorshare.com" },
    { origin: null },
    { fetchSite: "cross-site" },
    { contentType: "text/plain" },
    {
      host: "hope.creatorshare.com",
      origin: "https://hope.creatorshare.com",
    },
    { host: "www.creatorshare.com", origin: "https://www.creatorshare.com" },
  ] as const

  for (const options of scenarios) {
    resetProviderState()
    const request = requestFor(
      JSON.stringify({ password: VALID_PASSWORD }),
      options,
    )
    const response = await POST(request)

    await expectError(response, 400, "invalid-request")
    expect(request.bodyUsed).toBe(false)
    expect(events).toEqual([])
  }
})

test("rejects raw duplicate, mixed, gapped, and shadowed recovery cookies before authentication", async () => {
  const ambiguousCookieHeaders = [
    `${RECOVERY_AUTH_COOKIE}=host-session; ${RECOVERY_AUTH_COOKIE}=parent-domain-shadow`,
    `${RECOVERY_AUTH_COOKIE}=base-session; ${RECOVERY_AUTH_COOKIE}.0=chunk-session`,
    `${RECOVERY_AUTH_COOKIE}.0=first; ${RECOVERY_AUTH_COOKIE}.0=shadow`,
    `${RECOVERY_AUTH_COOKIE}.1=orphaned-chunk`,
  ]

  for (const cookie of ambiguousCookieHeaders) {
    resetProviderState()
    await expectError(
      await POST(
        requestFor(JSON.stringify({ password: VALID_PASSWORD }), { cookie }),
      ),
      400,
      "invalid-request",
    )
    expect(events).toEqual([])
  }
})

test("accepts an exact-origin JSON client without Fetch Metadata", async () => {
  const response = await POST(
    requestFor(JSON.stringify({ password: VALID_PASSWORD }), {
      fetchSite: null,
    }),
  )

  expect(response.status).toBe(200)
  expect(events).toEqual([
    "create-client",
    "get-user",
    "consume-receipt",
    "update-user",
    "sign-out",
  ])
  expect(updateInputs).toEqual([{ password: VALID_PASSWORD }])
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
  expect(signOutInputs).toEqual([{ scope: "global" }])
})

test("accepts exactly one bounded policy-compliant password field", async () => {
  const invalidBodies = [
    "not-json",
    "null",
    "[]",
    JSON.stringify({}),
    JSON.stringify({ password: 123 }),
    JSON.stringify({ password: "lowercase7!" }),
    JSON.stringify({ password: "UPPERCASE7!" }),
    JSON.stringify({ password: "NoNumber!" }),
    JSON.stringify({ password: "NoSpecial7" }),
    JSON.stringify({ password: VALID_PASSWORD, role: "administrator" }),
    JSON.stringify({ password: `Aa7!${"x".repeat(253)}` }),
    JSON.stringify({ password: `Aa7!${"x".repeat(2_100)}` }),
  ]

  for (const serializedBody of invalidBodies) {
    resetProviderState()
    const response = await POST(requestFor(serializedBody))

    await expectError(response, 400, "invalid-request")
    expect(events).toEqual([])
  }

  const oversizedContentLength = await POST(
    requestFor(JSON.stringify({ password: VALID_PASSWORD }), {
      contentLength: "2049",
    }),
  )
  await expectError(oversizedContentLength, 400, "invalid-request")
  expect(events).toEqual([])
})

test("returns one unauthorized response for a missing authenticated user", async () => {
  for (const result of [
    { data: { user: null }, error: null },
    { data: { user: null }, error: { message: "session missing" } },
  ]) {
    resetProviderState()
    authenticationResult = result
    const response = await POST(validRequest())

    await expectError(response, 401, "unauthorized")
    expect(events).toEqual(["create-client", "get-user"])
    expect(updateInputs).toHaveLength(0)
  }
})

test("rejects anonymous, email-less, unconfirmed, deleted, and banned users", async () => {
  const unauthorizedUsers = [
    authenticatedUser({ is_anonymous: true }),
    {
      id: AUTH_USER_ID,
      email_confirmed_at: CONFIRMED_AT,
      is_anonymous: false,
    },
    authenticatedUser({ email: "" }),
    {
      id: AUTH_USER_ID,
      email: "sponsor@example.com",
      is_anonymous: false,
    },
    authenticatedUser({ deleted_at: "2025-01-02T00:00:00.000Z" }),
    authenticatedUser({ banned_until: "2999-01-01T00:00:00.000Z" }),
  ]

  for (const user of unauthorizedUsers) {
    resetProviderState()
    authenticationResult = { data: { user }, error: null }
    const response = await POST(validRequest())

    await expectError(response, 401, "unauthorized")
    expect(events).toEqual(["create-client", "get-user"])
    expect(updateInputs).toHaveLength(0)
  }
})

test("fails closed on malformed user eligibility and response envelopes", async () => {
  const malformedResults: unknown[] = [
    {
      data: { user: authenticatedUser({ email: null }) },
      error: null,
    },
    {
      data: {
        user: authenticatedUser({ email_confirmed_at: "not-a-timestamp" }),
      },
      error: null,
    },
    {
      data: { user: authenticatedUser({ is_anonymous: "false" }) },
      error: null,
    },
    {
      data: { user: authenticatedUser({ deleted_at: null }) },
      error: null,
    },
    {
      data: { user: authenticatedUser({ banned_until: "later" }) },
      error: null,
    },
    {
      data: { user: authenticatedUser() },
      error: null,
      providerMetadata: "unexpected",
    },
    {
      data: { user: authenticatedUser(), session: null },
      error: null,
    },
  ]

  for (const result of malformedResults) {
    resetProviderState()
    authenticationResult = result
    const response = await POST(validRequest())

    await expectError(response, 503, "unavailable")
    expect(events).toEqual(["create-client", "get-user"])
    expect(updateInputs).toHaveLength(0)
  }
})

test("allows a valid confirmed user after a provider ban has expired", async () => {
  authenticationResult = {
    data: {
      user: authenticatedUser({
        banned_until: "2025-01-02T00:00:00.000Z",
      }),
    },
    error: null,
  }

  const response = await POST(validRequest())
  expect(response.status).toBe(200)
  expect(events).toEqual([
    "create-client",
    "get-user",
    "consume-receipt",
    "update-user",
    "sign-out",
  ])
})

test("fails closed when authentication throws or returns malformed identity", async () => {
  const malformedResults: unknown[] = [
    null,
    {},
    { data: { user: { id: "not-a-user-id" } }, error: null },
    { data: {}, error: null },
    { data: { user: { id: AUTH_USER_ID } } },
  ]

  for (const result of malformedResults) {
    resetProviderState()
    authenticationResult = result
    const response = await POST(validRequest())

    await expectError(response, 503, "unavailable")
    expect(events).toEqual(["create-client", "get-user"])
    expect(updateInputs).toHaveLength(0)
  }

  resetProviderState()
  authenticationFailure = new Error("private authentication failure")
  const authFailure = await POST(validRequest())
  await expectError(authFailure, 503, "unavailable")
  expect(events).toEqual(["create-client", "get-user"])

  resetProviderState()
  createClientFailure = new Error("private client failure")
  const clientFailure = await POST(validRequest())
  await expectError(clientFailure, 503, "unavailable")
  expect(events).toEqual(["create-client"])
})

test("requires the Supabase session cookie issued by recovery verification", async () => {
  const missingCookie = await POST(
    requestFor(JSON.stringify({ password: VALID_PASSWORD }), { cookie: null }),
  )

  await expectError(missingCookie, 401, "unauthorized")
  expect(events).toEqual([])
  expect(updateInputs).toEqual([])

  resetProviderState()
  const ambientDefaultOnly = await POST(
    requestFor(JSON.stringify({ password: VALID_PASSWORD }), {
      cookie: `${DEFAULT_SUPABASE_AUTH_COOKIE}=base64-ambient-session`,
    }),
  )
  await expectError(ambientDefaultOnly, 401, "unauthorized")
  expect(events).toEqual([])

  resetProviderState()
  const response = await POST(validRequest())
  expect(response.status).toBe(200)
  expect(cookieSnapshots).toHaveLength(2)
  for (const snapshot of cookieSnapshots) {
    expect(snapshot).toContainEqual({
      name: RECOVERY_AUTH_COOKIE,
      value: "base64-recovery-session",
    })
    expect(
      snapshot.some((cookie) => cookie.name === DEFAULT_SUPABASE_AUTH_COOKIE),
    ).toBe(false)
  }
})

test("maps missing, expired, wrong-user, and wrong-session proof to unauthorized", async () => {
  for (const scenario of [
    "ordinary-password-session",
    "expired-receipt",
    "wrong-user",
    "wrong-session",
    "replay",
  ]) {
    resetProviderState()
    authorizationResult = null
    authorizationError = {
      code: "42501",
      message: `private ${scenario} detail`,
    }

    const response = await POST(validRequest())
    await expectError(response, 401, "unauthorized")
    expect(events).toEqual(["create-client", "get-user", "consume-receipt"])
    expect(rpcCalls).toEqual(["consume_password_recovery_authorization"])
    expect(updateInputs).toEqual([])
  }
})

test("fails closed on ambiguous or malformed authorization storage outcomes", async () => {
  const malformedOutcomes: Array<{
    result?: unknown
    error?: unknown
    failure?: Error
  }> = [
    { result: null },
    { result: [] },
    {
      result: [
        {
          authorized_auth_user_id: OTHER_USER_ID,
          authorized_auth_session_id: AUTH_SESSION_ID,
        },
      ],
    },
    {
      result: [
        {
          authorized_auth_user_id: AUTH_USER_ID,
          authorized_auth_session_id: OTHER_SESSION_ID,
          expanded: true,
        },
      ],
    },
    { result: null, error: { code: "57014", message: "timeout" } },
    { failure: new Error("private database transport detail") },
  ]

  for (const outcome of malformedOutcomes) {
    resetProviderState()
    authorizationResult = outcome.result
    authorizationError = outcome.error ?? null
    authorizationFailure = outcome.failure ?? null

    const response = await POST(validRequest())
    await expectError(response, 503, "unavailable")
    expect(updateInputs).toEqual([])
  }
})

test("consumes authorization before the one password-only provider mutation", async () => {
  const response = await POST(validRequest())

  expect(response.status).toBe(200)
  expect(rpcCalls).toEqual(["consume_password_recovery_authorization"])
  expect(events.indexOf("consume-receipt")).toBeLessThan(
    events.indexOf("update-user"),
  )
  expect(updateInputs).toEqual([{ password: VALID_PASSWORD }])
})

test("updates once with password only and requires the same provider user", async () => {
  const rejectedUpdates: Array<{
    result?: unknown
    failure?: Error
  }> = [
    { result: null },
    { result: {} },
    { result: { data: { user: null }, error: null } },
    { result: { data: { user: { id: "not-a-user-id" } }, error: null } },
    { result: { data: { user: { id: OTHER_USER_ID } }, error: null } },
    {
      result: {
        data: { user: { id: AUTH_USER_ID } },
        error: null,
        providerMetadata: "unexpected",
      },
    },
    {
      result: {
        data: { user: { id: AUTH_USER_ID }, session: null },
        error: null,
      },
    },
    {
      result: {
        data: { user: { id: AUTH_USER_ID } },
        error: { message: "private update failure" },
      },
    },
    { failure: new Error("private update throw") },
  ]

  for (const rejected of rejectedUpdates) {
    resetProviderState()
    if (rejected.failure) updateFailure = rejected.failure
    else updateResult = rejected.result

    const response = await POST(validRequest())
    await expectError(response, 503, "unavailable")
    expect(events).toEqual([
      "create-client",
      "get-user",
      "consume-receipt",
      "update-user",
    ])
    expect(updateInputs).toEqual([{ password: VALID_PASSWORD }])
  }
})

test("signs out once after an acknowledged update and fails closed on uncertainty", async () => {
  const rejectedSignOuts: Array<{
    result?: unknown
    failure?: Error
  }> = [
    { result: null },
    { result: {} },
    { result: { error: null, providerMetadata: "unexpected" } },
    { result: { error: { message: "private signout failure" } } },
    { failure: new Error("private signout throw") },
  ]

  for (const rejected of rejectedSignOuts) {
    resetProviderState()
    if (rejected.failure) signOutFailure = rejected.failure
    else signOutResult = rejected.result

    const response = await POST(validRequest())
    await expectError(response, 503, "unavailable")
    expect(events).toEqual([
      "create-client",
      "get-user",
      "consume-receipt",
      "update-user",
      "sign-out",
    ])
    expect(updateInputs).toEqual([{ password: VALID_PASSWORD }])
  }
})

test("never claims signout without a host-only Supabase auth-cookie clear", async () => {
  for (const scenario of ["missing", "wrong-name", "domain"] as const) {
    resetProviderState()
    emitSignOutClear = scenario !== "missing"
    signOutCookieName =
      scenario === "wrong-name" ? "unrelated-cookie" : RECOVERY_AUTH_COOKIE
    signOutCookieOptions = {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: true,
      maxAge: 0,
      ...(scenario === "domain" ? { domain: ".creatorshare.com" } : {}),
    }

    const response = await POST(validRequest())
    await expectError(response, 503, "unavailable")
    expect(updateInputs).toEqual([{ password: VALID_PASSWORD }])
  }
})

test("rejects provider recovery clears that omit any required __Host attribute", async () => {
  for (const omitted of ["path", "sameSite", "httpOnly", "secure"] as const) {
    resetProviderState()
    signOutCookieOptions = {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: true,
      maxAge: 0,
    }
    delete signOutCookieOptions[omitted]

    await expectError(await POST(validRequest()), 503, "unavailable")
    expect(updateInputs).toEqual([{ password: VALID_PASSWORD }])
  }
})

test("rejects signout when any current recovery chunk remains active", async () => {
  signOutCookieName = `${RECOVERY_AUTH_COOKIE}.0`
  const response = await POST(
    requestFor(JSON.stringify({ password: VALID_PASSWORD }), {
      cookie: `${RECOVERY_AUTH_COOKIE}.0=first-chunk; ${RECOVERY_AUTH_COOKIE}.1=second-chunk; ${DEFAULT_SUPABASE_AUTH_COOKIE}=ambient-session`,
    }),
  )

  await expectError(response, 503, "unavailable")
  expect(signOutInputs).toEqual([{ scope: "global" }])
  expect(updateInputs).toEqual([{ password: VALID_PASSWORD }])
})

test("acknowledges signout only after every current recovery chunk is cleared", async () => {
  signOutCookieName = `${RECOVERY_AUTH_COOKIE}.0`
  additionalSignOutCookieWrites = [
    {
      name: `${RECOVERY_AUTH_COOKIE}.1`,
      value: "",
      options: {
        path: "/",
        sameSite: "lax",
        httpOnly: true,
        secure: true,
        maxAge: 0,
      },
    },
  ]
  const response = await POST(
    requestFor(JSON.stringify({ password: VALID_PASSWORD }), {
      cookie: `${RECOVERY_AUTH_COOKIE}.0=first-chunk; ${RECOVERY_AUTH_COOKIE}.1=second-chunk; ${DEFAULT_SUPABASE_AUTH_COOKIE}=ambient-session`,
    }),
  )

  expect(response.status).toBe(200)
  const recoveryClears = setCookieHeaders(response).filter((header) =>
    header.startsWith(`${RECOVERY_AUTH_COOKIE}.`),
  )
  expect(recoveryClears).toHaveLength(2)
  for (const index of [0, 1]) {
    expect(
      recoveryClears.some(
        (header) =>
          header.startsWith(`${RECOVERY_AUTH_COOKIE}.${index}=`) &&
          header.includes("Max-Age=0"),
      ),
    ).toBe(true)
  }
})

test("acknowledges success only after update and signout, then clears identity", async () => {
  const response = await POST(validRequest())

  expect(response.status).toBe(200)
  expect(await bodyOf(response)).toEqual({
    message: "Password reset successful! User has been logged out.",
  })
  expectPrivacyHeaders(response)
  expect(events).toEqual([
    "create-client",
    "get-user",
    "consume-receipt",
    "update-user",
    "sign-out",
  ])
  expect(updateInputs).toEqual([{ password: VALID_PASSWORD }])

  const responseCookies = setCookieHeaders(response)
  const authCookies = responseCookies.filter((header) =>
    header.startsWith(`${RECOVERY_AUTH_COOKIE}=`),
  )
  expect(authCookies).toHaveLength(1)
  expect(authCookies[0]).toContain("Path=/")
  expect(authCookies[0]).toContain("Max-Age=0")
  expect(authCookies[0]).toContain("Secure")
  expect(authCookies[0]).toContain("SameSite=lax")
  expect(authCookies[0]).not.toContain("Domain=")

  const defaultAuthCookies = responseCookies.filter((header) =>
    header.startsWith(`${DEFAULT_SUPABASE_AUTH_COOKIE}=`),
  )
  expect(defaultAuthCookies).toHaveLength(2)
  expect(
    defaultAuthCookies.some((header) =>
      header.includes("Domain=.creatorshare.com"),
    ),
  ).toBe(true)
  expect(defaultAuthCookies.some((header) => !header.includes("Domain="))).toBe(
    true,
  )
  for (const header of defaultAuthCookies) {
    expect(header).toContain("Path=/")
    expect(header).toContain("Max-Age=0")
    expect(header).toContain("HttpOnly")
    expect(header).toContain("Secure")
    expect(header).toContain("SameSite=lax")
    expect(header).not.toMatch(
      new RegExp(`${DEFAULT_SUPABASE_AUTH_COOKIE}=[^;]+`),
    )
  }

  const identityCookies = responseCookies.filter((header) =>
    header.startsWith("cs_advocate_attribution_identity_v1="),
  )
  expect(identityCookies).toHaveLength(2)
  expect(
    identityCookies.some((header) =>
      header.includes("Domain=.creatorshare.com"),
    ),
  ).toBe(true)
  for (const header of identityCookies) {
    expect(header).toContain("Path=/")
    expect(header).toContain("Max-Age=0")
    expect(header).toContain("HttpOnly")
    expect(header).toContain("Secure")
    expect(header).toContain("SameSite=lax")
  }
})

test("clears ambient default host, parent-domain, and chunk shadows without trusting them", async () => {
  const response = await POST(
    requestFor(JSON.stringify({ password: VALID_PASSWORD }), {
      cookie: [
        `${RECOVERY_AUTH_COOKIE}=base64-recovery-session`,
        `${DEFAULT_SUPABASE_AUTH_COOKIE}=host-session`,
        `${DEFAULT_SUPABASE_AUTH_COOKIE}=parent-shadow`,
        `${DEFAULT_SUPABASE_AUTH_COOKIE}.0=host-chunk`,
        `${DEFAULT_SUPABASE_AUTH_COOKIE}.0=parent-chunk-shadow`,
        `${DEFAULT_SUPABASE_AUTH_COOKIE}.1=second-chunk`,
      ].join("; "),
    }),
  )

  expect(response.status).toBe(200)
  expect(cookieSnapshots).toHaveLength(2)
  for (const snapshot of cookieSnapshots) {
    expect(snapshot).toEqual([
      {
        name: RECOVERY_AUTH_COOKIE,
        value: "base64-recovery-session",
      },
    ])
  }

  const defaultClears = setCookieHeaders(response).filter((header) =>
    header.startsWith(DEFAULT_SUPABASE_AUTH_COOKIE),
  )
  expect(defaultClears).toHaveLength(6)
  for (const name of [
    DEFAULT_SUPABASE_AUTH_COOKIE,
    `${DEFAULT_SUPABASE_AUTH_COOKIE}.0`,
    `${DEFAULT_SUPABASE_AUTH_COOKIE}.1`,
  ]) {
    const clears = defaultClears.filter((header) =>
      header.startsWith(`${name}=`),
    )
    expect(clears).toHaveLength(2)
    expect(clears.some((header) => header.includes("Domain="))).toBe(true)
    expect(clears.some((header) => !header.includes("Domain="))).toBe(true)
    for (const header of clears) {
      expect(header).toContain(`${name}=;`)
      expect(header).toContain("Max-Age=0")
    }
  }
})

test("returns a private outage when the configured canonical origin is invalid", async () => {
  process.env.NEXT_PUBLIC_BASE_URL = "not a canonical origin"
  const request = validRequest()
  const response = await POST(request)

  await expectError(response, 503, "unavailable")
  expect(request.bodyUsed).toBe(false)
  expect(events).toEqual([])
})
