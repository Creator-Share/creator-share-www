import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"
import { AuthSessionMissingError } from "@supabase/supabase-js"

type RouteModule =
  typeof import("../../src/app/api/auth/advocate-invitations/authenticate/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const ACCESS_TOKEN = "verified-access-token"
const ORIGIN = "https://creatorshare.com"
const STAGING_ORIGIN = "https://advocate-staging.creatorshare.com"
const AUTHENTICATION_REQUEST = Object.freeze({
  authTokenHash: "Auth_hash.value~with-safe-characters_".repeat(2),
  authType: "magiclink" as const,
  version: 1 as const,
})

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
process.env.VERCEL_URL = "preview.example.test"
process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = Buffer.alloc(
  32,
  0x31,
).toString("base64")

let verificationResult: {
  data: {
    session: {
      access_token: string
      user?: { id: string }
    } | null
    user: { id: string } | null
  }
  error: { code?: string } | null
} = {
  data: {
    session: { access_token: ACCESS_TOKEN, user: { id: AUTH_USER_ID } },
    user: { id: AUTH_USER_ID },
  },
  error: null,
}
let tokenUserResult: {
  data: { user: { id: string } | null }
  error: { code?: string } | null
} = { data: { user: { id: AUTH_USER_ID } }, error: null }
let currentUserResult = tokenUserResult
let currentClaimsResult: {
  data: { claims: Record<string, unknown> } | null
  error: { code?: string } | null
}
let writeAuthCookie = true
let cookieWriteFails = false
let currentSessionCookie: {
  name: string
  value: string
  options?: Record<string, unknown>
} | null = null
let createClientCalls = 0
let authenticationCapacityAllowed = true
let authenticationCapacityUnavailable = false
const verifyCalls: unknown[] = []
const getUserCalls: unknown[] = []
const authenticationReservationCalls: Request[] = []

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/lib/advocates/invitations/rateLimit") {
    return {
      async reserveAdvocateInvitationAuthenticationAttempt(options: {
        request: Request
      }) {
        authenticationReservationCalls.push(options.request)
        if (authenticationCapacityUnavailable) {
          throw new Error("sanitized-rate-limit-unavailable")
        }
        return authenticationCapacityAllowed
      },
    }
  }
  if (request === "@supabase/ssr") {
    return {
      createServerClient(
        _url: string,
        _key: string,
        options: {
          cookies: {
            setAll: (
              values: Array<{
                name: string
                value: string
                options?: Record<string, unknown>
              }>,
            ) => void
          }
        },
      ) {
        createClientCalls += 1
        return {
          auth: {
            async verifyOtp(input: unknown) {
              verifyCalls.push(input)
              if (writeAuthCookie && !verificationResult.error) {
                if (cookieWriteFails) throw new Error("cookie-write-failed")
                options.cookies.setAll([
                  {
                    name: "sb-test-auth-token",
                    value: "session-cookie-value",
                    options: {
                      httpOnly: true,
                      sameSite: "lax",
                      path: "/",
                    },
                  },
                ])
              }
              return verificationResult
            },
            async getUser(accessToken?: string) {
              getUserCalls.push(accessToken ?? null)
              if (!accessToken && currentSessionCookie) {
                options.cookies.setAll([currentSessionCookie])
              }
              return accessToken ? tokenUserResult : currentUserResult
            },
            async getClaims() {
              return currentClaimsResult
            },
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
    "tests/advocates/invitation-authentication-route.spec.ts",
  ),
)
const { POST } = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/auth/advocate-invitations/authenticate/route.ts",
  ),
) as RouteModule
nodeModule._load = originalModuleLoad
delete testRequire.cache[
  testRequire.resolve(
    resolve(process.cwd(), "src/lib/advocates/invitations/routeClient.ts"),
  )
]

function request(
  body = JSON.stringify(AUTHENTICATION_REQUEST),
  headerOverrides: Record<string, string | null> = {},
  path = "/api/auth/advocate-invitations/authenticate",
  transportOrigin = ORIGIN,
): NextRequest {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
  })
  for (const [name, value] of Object.entries(headerOverrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return new NextRequest(`${transportOrigin}${path}`, {
    method: "POST",
    headers,
    body,
  })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

test.beforeEach(() => {
  verificationResult = {
    data: {
      session: { access_token: ACCESS_TOKEN, user: { id: AUTH_USER_ID } },
      user: { id: AUTH_USER_ID },
    },
    error: null,
  }
  tokenUserResult = { data: { user: { id: AUTH_USER_ID } }, error: null }
  currentUserResult = tokenUserResult
  const nowEpochSeconds = Math.floor(Date.now() / 1_000)
  currentClaimsResult = {
    data: {
      claims: {
        sub: AUTH_USER_ID,
        session_id: "22222222-2222-4222-8222-222222222222",
        aal: "aal1",
        iat: nowEpochSeconds,
        amr: [{ method: "otp", timestamp: nowEpochSeconds }],
      },
    },
    error: null,
  }
  writeAuthCookie = true
  cookieWriteFails = false
  currentSessionCookie = null
  createClientCalls = 0
  authenticationCapacityAllowed = true
  authenticationCapacityUnavailable = false
  verifyCalls.length = 0
  getUserCalls.length = 0
  authenticationReservationCalls.length = 0
})

test("establishes and returns the session before any tenant mutation request", async () => {
  const response = await POST(
    request(
      JSON.stringify(AUTHENTICATION_REQUEST),
      {},
      "/api/auth/advocate-invitations/authenticate",
      "http://internal-proxy.example",
    ),
  )
  expect(response.status).toBe(200)
  expect(await json(response)).toEqual({ ok: true })
  expect(response.headers.get("cache-control")).toContain("no-store")
  const cookies = response.headers.get("set-cookie") ?? ""
  expect(cookies).toContain("sb-test-auth-token=session-cookie-value")
  expect(cookies).toContain("cs_advocate_attribution_identity_v1=")
  expect(cookies).toMatch(/Secure/i)
  expect(verifyCalls).toEqual([
    {
      token_hash: AUTHENTICATION_REQUEST.authTokenHash,
      type: "magiclink",
    },
  ])
  expect(getUserCalls).toEqual([])
  expect(authenticationReservationCalls).toHaveLength(1)
})

test("marks staging Supabase authentication cookies Secure", async () => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
  const previousCanonicalOrigin =
    process.env.ADVOCATE_INVITATION_CANONICAL_ORIGIN
  const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  process.env.NEXT_PUBLIC_BASE_URL = STAGING_ORIGIN
  process.env.ADVOCATE_INVITATION_CANONICAL_ORIGIN = STAGING_ORIGIN
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://destjwstohzmufshfnuy.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_" + "a".repeat(32)
  try {
    const response = await POST(
      request(
        JSON.stringify(AUTHENTICATION_REQUEST),
        {
          host: "advocate-staging.creatorshare.com",
          origin: STAGING_ORIGIN,
        },
        "/api/auth/advocate-invitations/authenticate",
        STAGING_ORIGIN,
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie") ?? "").toMatch(
      /sb-test-auth-token=session-cookie-value;[^,]*Secure/i,
    )
  } finally {
    if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL
    else process.env.NEXT_PUBLIC_BASE_URL = previousBaseUrl
    if (previousCanonicalOrigin === undefined) {
      delete process.env.ADVOCATE_INVITATION_CANONICAL_ORIGIN
    } else {
      process.env.ADVOCATE_INVITATION_CANONICAL_ORIGIN = previousCanonicalOrigin
    }
    if (previousSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl
    }
    if (previousSupabaseAnonKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousSupabaseAnonKey
    }
  }
})

test("passes a new-account signup proof to provider verification unchanged", async () => {
  const signupRequest = Object.freeze({
    ...AUTHENTICATION_REQUEST,
    authType: "signup" as const,
  })

  const response = await POST(request(JSON.stringify(signupRequest)))

  expect(response.status).toBe(200)
  expect(await json(response)).toEqual({ ok: true })
  expect(verifyCalls).toEqual([
    {
      token_hash: signupRequest.authTokenHash,
      type: "signup",
    },
  ])
})

test("reserves capacity before provider verification and makes quota denial retryable", async () => {
  authenticationCapacityAllowed = false

  const response = await POST(request())

  expect(response.status).toBe(503)
  expect(await json(response)).toEqual({
    ok: false,
    code: "authentication_unavailable",
  })
  expect(authenticationReservationCalls).toHaveLength(1)
  expect(createClientCalls).toBe(0)
  expect(verifyCalls).toEqual([])
  expect(getUserCalls).toEqual([])
})

test("fails closed before provider verification when capacity is unavailable", async () => {
  authenticationCapacityUnavailable = true

  const response = await POST(request())

  expect(response.status).toBe(503)
  expect(await json(response)).toEqual({
    ok: false,
    code: "authentication_unavailable",
  })
  expect(authenticationReservationCalls).toHaveLength(1)
  expect(createClientCalls).toBe(0)
  expect(verifyCalls).toEqual([])
  expect(getUserCalls).toEqual([])
})

test("accepts an already delivered session when an exact retry sees a consumed proof", async () => {
  verificationResult = {
    data: { session: null, user: null },
    error: { code: "otp_expired" },
  }
  writeAuthCookie = false

  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(await json(response)).toEqual({ ok: true })
  expect(getUserCalls).toEqual([null])
})

test("returns retryable provider failures without clearing invitation authority", async () => {
  verificationResult = {
    data: { session: null, user: null },
    error: { code: "over_request_rate_limit" },
  }
  writeAuthCookie = false
  currentUserResult = { data: { user: null }, error: null }

  const response = await POST(request())

  expect(response.status).toBe(503)
  expect(await json(response)).toEqual({
    ok: false,
    code: "authentication_unavailable",
  })
  expect(verifyCalls).toHaveLength(1)
  expect(getUserCalls).toEqual([null])
})

test("returns retryable fallback session and claims failures", async () => {
  verificationResult = {
    data: { session: null, user: null },
    error: { code: "otp_expired" },
  }
  writeAuthCookie = false
  currentUserResult = {
    data: { user: null },
    error: { code: "request_timeout" },
  }

  const userFailure = await POST(request())
  expect(userFailure.status).toBe(503)
  expect(await json(userFailure)).toEqual({
    ok: false,
    code: "authentication_unavailable",
  })

  currentUserResult = tokenUserResult
  currentClaimsResult = {
    data: null,
    error: { code: "request_timeout" },
  }
  const claimsFailure = await POST(request())
  expect(claimsFailure.status).toBe(503)
  expect(await json(claimsFailure)).toEqual({
    ok: false,
    code: "authentication_unavailable",
  })
})

test("carries a queued session on retryable malformed success and recovers the consumed proof", async () => {
  verificationResult = {
    data: {
      session: {
        access_token: ACCESS_TOKEN,
        user: { id: "33333333-3333-4333-8333-333333333333" },
      },
      user: { id: AUTH_USER_ID },
    },
    error: null,
  }

  const malformedSuccess = await POST(request())
  expect(malformedSuccess.status).toBe(503)
  expect(await json(malformedSuccess)).toEqual({
    ok: false,
    code: "authentication_unavailable",
  })
  expect(malformedSuccess.headers.get("set-cookie") ?? "").toContain(
    "sb-test-auth-token=session-cookie-value",
  )
  expect(getUserCalls).toEqual([])

  verificationResult = {
    data: { session: null, user: null },
    error: { code: "otp_expired" },
  }
  writeAuthCookie = false
  const recovered = await POST(request())

  expect(recovered.status).toBe(200)
  expect(await json(recovered)).toEqual({ ok: true })
  expect(getUserCalls).toEqual([null])
})

test("rejects a consumed proof backed only by an unrelated current session", async () => {
  verificationResult = {
    data: { session: null, user: null },
    error: { code: "otp_expired" },
  }
  writeAuthCookie = false
  currentClaimsResult = {
    data: {
      claims: {
        sub: AUTH_USER_ID,
        session_id: "22222222-2222-4222-8222-222222222222",
        aal: "aal1",
        iat: Math.floor(Date.now() / 1_000),
        amr: [
          { method: "password", timestamp: Math.floor(Date.now() / 1_000) },
        ],
      },
    },
    error: null,
  }

  const response = await POST(request())

  expect(response.status).toBe(410)
  expect(await json(response)).toEqual({
    ok: false,
    code: "invalid_or_expired",
  })
})

test("requires matching fresh otp claims for a consumed-proof retry", async () => {
  verificationResult = {
    data: { session: null, user: null },
    error: { code: "otp_expired" },
  }
  writeAuthCookie = false
  const nowEpochSeconds = Math.floor(Date.now() / 1_000)
  const invalidClaims = [
    {
      sub: "33333333-3333-4333-8333-333333333333",
      session_id: "22222222-2222-4222-8222-222222222222",
      aal: "aal1",
      iat: nowEpochSeconds,
      amr: [{ method: "otp", timestamp: nowEpochSeconds }],
    },
    {
      sub: AUTH_USER_ID,
      session_id: "not-a-session-id",
      aal: "aal1",
      iat: nowEpochSeconds,
      amr: [{ method: "otp", timestamp: nowEpochSeconds }],
    },
    {
      sub: AUTH_USER_ID,
      session_id: "22222222-2222-4222-8222-222222222222",
      aal: "aal1",
      iat: nowEpochSeconds,
      amr: [{ method: "otp", timestamp: nowEpochSeconds - 901 }],
    },
    {
      sub: AUTH_USER_ID,
      session_id: "22222222-2222-4222-8222-222222222222",
      aal: "aal1",
      iat: nowEpochSeconds,
      amr: [{ method: "otp", timestamp: nowEpochSeconds + 61 }],
    },
    {
      sub: AUTH_USER_ID,
      session_id: "22222222-2222-4222-8222-222222222222",
      aal: "aal1",
      iat: nowEpochSeconds,
      amr: [{ method: "magiclink", timestamp: nowEpochSeconds }],
    },
  ]

  for (const claims of invalidClaims) {
    currentClaimsResult = { data: { claims }, error: null }
    const response = await POST(request())
    expect(response.status).toBe(410)
    expect(await json(response)).toEqual({
      ok: false,
      code: "invalid_or_expired",
    })
  }
})

test("a lost or failed authentication response cannot have mutated a tenant", async () => {
  cookieWriteFails = true
  const response = await POST(request())
  expect(response.status).toBe(503)
  expect(await json(response)).toEqual({
    ok: false,
    code: "authentication_unavailable",
  })
  expect(createClientCalls).toBe(1)
})

test("rejects invalid proofs and request envelopes without exposing auth state", async () => {
  for (const invalid of [
    request("{}"),
    request(JSON.stringify({ ...AUTHENTICATION_REQUEST, authType: "email" })),
    request(JSON.stringify({ ...AUTHENTICATION_REQUEST, extra: true })),
    request(
      JSON.stringify({
        version: 1,
        authType: "magiclink",
        authTokenHash: AUTHENTICATION_REQUEST.authTokenHash,
      }),
    ),
    request(JSON.stringify(AUTHENTICATION_REQUEST), {
      host: "hope.creatorshare.com",
    }),
    request(JSON.stringify(AUTHENTICATION_REQUEST), {
      host: "www.creatorshare.com",
      origin: "https://www.creatorshare.com",
    }),
    request(JSON.stringify(AUTHENTICATION_REQUEST), {
      host: "preview.example.test",
      origin: "https://preview.example.test",
    }),
    request(JSON.stringify(AUTHENTICATION_REQUEST), {
      origin: "https://attacker.example",
    }),
    request(
      JSON.stringify(AUTHENTICATION_REQUEST),
      {},
      "/api/auth/advocate-invitations/redeem",
    ),
  ]) {
    const response = await POST(invalid)
    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({
      ok: false,
      code: "invalid_request",
    })
  }
  expect(createClientCalls).toBe(0)
  expect(authenticationReservationCalls).toHaveLength(0)

  verificationResult = {
    data: { session: null, user: null },
    error: { code: "otp_expired" },
  }
  writeAuthCookie = false
  currentUserResult = {
    data: { user: null },
    error: new AuthSessionMissingError(),
  }
  currentSessionCookie = {
    name: "sb-test-auth-token",
    value: "",
    options: { maxAge: 0, path: "/" },
  }
  const expired = await POST(request())
  expect(expired.status).toBe(410)
  expect(await json(expired)).toEqual({
    ok: false,
    code: "invalid_or_expired",
  })
  expect(expired.headers.get("set-cookie") ?? "").toContain(
    "sb-test-auth-token=",
  )
  expect(authenticationReservationCalls).toHaveLength(1)
})
