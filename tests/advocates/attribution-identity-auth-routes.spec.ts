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
type AuthCallbackModule = typeof import("../../src/app/auth/callback/route")
type LogoutModule = typeof import("../../src/app/api/auth/logout/route")
type ChangePasswordModule =
  typeof import("../../src/app/api/auth/change-password/route")
type AttributionIdentityCookieModule =
  typeof import("../../src/lib/advocates/attributionIdentityCookie")

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const CURRENT_SECRET = Buffer.alloc(32, 7).toString("base64")
const PREVIOUS_ENVIRONMENT = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1:
    process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1,
}

let exchangeUser: { id: string } | null = { id: AUTH_USER_ID }
let exchangeError: { message: string } | null = null
let signOutError: { message: string } | null = null
let updateUserError: { message: string } | null = null
let exchangeCalls = 0
let signOutCalls = 0
let updateUserCalls = 0

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
      createServerClient() {
        return {
          auth: {
            async exchangeCodeForSession() {
              exchangeCalls += 1
              return {
                data: { user: exchangeUser },
                error: exchangeError,
              }
            },
          },
        }
      },
    }
  }
  if (request === "@/utils/supabase/server") {
    return {
      async createClient() {
        return {
          auth: {
            async signOut() {
              signOutCalls += 1
              return { error: signOutError }
            },
            async updateUser() {
              updateUserCalls += 1
              return { error: updateUserError }
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
    "tests/advocates/attribution-identity-auth-routes.spec.ts",
  ),
)
const { GET: authCallback } = testRequire(
  "../../src/app/auth/callback/route",
) as AuthCallbackModule
const { POST: logout } = testRequire(
  "../../src/app/api/auth/logout/route",
) as LogoutModule
const { POST: changePassword } = testRequire(
  "../../src/app/api/auth/change-password/route",
) as ChangePasswordModule
const {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS,
  verifyAdvocateAttributionIdentityCookieValue,
} = testRequire(
  "../../src/lib/advocates/attributionIdentityCookie",
) as AttributionIdentityCookieModule
nodeModule._load = originalModuleLoad

function setCookieHeaders(response: Response): string[] {
  return (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie()
}

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"))
}

function authCallbackRequest(host = "creatorshare.com"): NextRequest {
  return new NextRequest(
    `https://${host}/auth/callback?code=opaque_auth_code_123&next=%2Fsponsor%2Fclaim`,
    { headers: { host } },
  )
}

function postRequest(
  path: string,
  host = "creatorshare.com",
  body?: Record<string, unknown>,
): Request {
  return new Request(`https://${host}${path}`, {
    method: "POST",
    headers: {
      host,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
  process.env.NEXT_PUBLIC_BASE_URL = "https://creatorshare.com"
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = CURRENT_SECRET

  exchangeUser = { id: AUTH_USER_ID }
  exchangeError = null
  signOutError = null
  updateUserError = null
  exchangeCalls = 0
  signOutCalls = 0
  updateUserCalls = 0
})

test.afterAll(() => {
  for (const [name, value] of Object.entries(PREVIOUS_ENVIRONMENT)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test("successful auth completion issues a signed parent-domain exclusion signal", async () => {
  const response = await authCallback(authCallbackRequest())
  const identityCookie = setCookieHeaders(response).find((header) =>
    header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
  )

  expect(response.status).toBe(303)
  expect(response.headers.get("location")).toContain("state=ready")
  expect(exchangeCalls).toBe(1)
  expect(identityCookie).toBeDefined()
  expect(identityCookie).toContain("Domain=.creatorshare.com")
  expect(identityCookie).toContain("Path=/")
  expect(identityCookie).toContain(
    `Max-Age=${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS}`,
  )
  expect(identityCookie).toContain("HttpOnly")
  expect(identityCookie).toContain("Secure")
  expect(identityCookie).toContain("SameSite=lax")

  const verified = verifyAdvocateAttributionIdentityCookieValue(
    cookieValue(identityCookie!),
  )
  expect(verified?.signal.authUserId).toBe(AUTH_USER_ID)
})

test("failed or userless auth completion does not issue an exclusion signal", async () => {
  exchangeError = { message: "provider failure" }
  const failed = await authCallback(authCallbackRequest())
  expect(
    setCookieHeaders(failed).some((header) =>
      header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
    ),
  ).toBe(false)

  exchangeError = null
  exchangeUser = null
  const userless = await authCallback(authCallbackRequest())
  expect(
    setCookieHeaders(userless).some((header) =>
      header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
    ),
  ).toBe(false)
})

test("successful logout expires the exact parent-domain signal", async () => {
  const response = await logout(postRequest("/api/auth/logout"))
  const identityCookie = setCookieHeaders(response).find((header) =>
    header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
  )

  expect(response.status).toBe(200)
  expect(signOutCalls).toBe(1)
  expect(identityCookie).toContain("Domain=.creatorshare.com")
  expect(identityCookie).toContain("Path=/")
  expect(identityCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT")
  expect(identityCookie).toContain("Max-Age=0")
  expect(identityCookie).toContain("HttpOnly")
  expect(identityCookie).toContain("Secure")
  expect(identityCookie).toContain("SameSite=lax")
})

test("logout failure preserves the attribution identity signal", async () => {
  signOutError = { message: "provider failure" }
  const response = await logout(postRequest("/api/auth/logout"))

  expect(response.status).toBe(400)
  expect(signOutCalls).toBe(1)
  expect(
    setCookieHeaders(response).some((header) =>
      header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
    ),
  ).toBe(false)
})

test("successful password reset signout expires the parent-domain signal", async () => {
  const response = await changePassword(
    postRequest("/api/auth/change-password", "creatorshare.com", {
      password: "correct horse battery staple",
    }),
  )
  const identityCookie = setCookieHeaders(response).find((header) =>
    header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
  )

  expect(response.status).toBe(200)
  expect(updateUserCalls).toBe(1)
  expect(signOutCalls).toBe(1)
  expect(identityCookie).toContain("Domain=.creatorshare.com")
  expect(identityCookie).toContain("Path=/")
  expect(identityCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT")
  expect(identityCookie).toContain("Max-Age=0")
  expect(identityCookie).toContain("HttpOnly")
  expect(identityCookie).toContain("Secure")
  expect(identityCookie).toContain("SameSite=lax")
})

test("password reset signout failure preserves the signal", async () => {
  signOutError = { message: "provider failure" }
  const response = await changePassword(
    postRequest("/api/auth/change-password", "creatorshare.com", {
      password: "correct horse battery staple",
    }),
  )

  expect(response.status).toBe(500)
  expect(updateUserCalls).toBe(1)
  expect(signOutCalls).toBe(1)
  expect(
    setCookieHeaders(response).some((header) =>
      header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
    ),
  ).toBe(false)
})

test("local logout clears a host-only nonsecure signal", async () => {
  const response = await logout(
    new Request("http://hope.localhost:3000/api/auth/logout", {
      method: "POST",
      headers: { host: "hope.localhost:3000" },
    }),
  )
  const identityCookie = setCookieHeaders(response).find((header) =>
    header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
  )

  expect(identityCookie).toBeDefined()
  expect(identityCookie).not.toContain("Domain=")
  expect(identityCookie).not.toContain("Secure")
  expect(identityCookie).toContain("Path=/")
  expect(identityCookie).toContain("Max-Age=0")
})
