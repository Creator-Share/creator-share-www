import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  verifyAdvocateAttributionIdentityCookieValue,
} from "../../src/lib/advocates/attributionIdentityCookie"
import { completeAdvocateAttributionIdentitySignal } from "../../src/lib/advocates/attributionIdentityCompletion"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type CompletionRouteModule =
  typeof import("../../src/app/api/auth/attribution-identity/route")

const AUTH_USER_ID = "97000000-0000-4000-8000-000000000001"
const CURRENT_SECRET = Buffer.alloc(32, 67).toString("base64")
const ORIGINAL_ENVIRONMENT = {
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1:
    process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1,
}

let currentUser: { id: string } | null = { id: AUTH_USER_ID }
let getUserCalls = 0

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/utils/supabase/server") {
    return {
      async createClient() {
        return {
          auth: {
            async getUser() {
              getUserCalls += 1
              return { data: { user: currentUser }, error: null }
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
    "tests/advocates/attribution-identity-completion.spec.ts",
  ),
)
const { POST } = testRequire(
  "../../src/app/api/auth/attribution-identity/route",
) as CompletionRouteModule
nodeModule._load = originalModuleLoad

function request(overrides: { origin?: string; cookie?: string } = {}) {
  return new NextRequest(
    "https://creatorshare.com/api/auth/attribution-identity",
    {
      method: "POST",
      headers: {
        host: "creatorshare.com",
        origin: overrides.origin ?? "https://creatorshare.com",
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        ...(overrides.cookie ? { cookie: overrides.cookie } : {}),
      },
      body: "{}",
    },
  )
}

function setCookies(response: Response): string[] {
  return (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie()
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = "https://creatorshare.com"
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = CURRENT_SECRET
  currentUser = { id: AUTH_USER_ID }
  getUserCalls = 0
})

test.afterAll(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENVIRONMENT)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test("completes a client-created session with a parent-domain signal", async () => {
  const response = await POST(request())
  const identityCookie = setCookies(response).find((cookie) =>
    cookie.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
  )

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ ok: true })
  expect(getUserCalls).toBe(1)
  expect(identityCookie).toContain("Domain=.creatorshare.com")
  expect(identityCookie).toContain("HttpOnly")
  expect(identityCookie).toContain("Secure")
  const value = identityCookie?.slice(
    identityCookie.indexOf("=") + 1,
    identityCookie.indexOf(";"),
  )
  expect(
    verifyAdvocateAttributionIdentityCookieValue(value)?.signal.authUserId,
  ).toBe(AUTH_USER_ID)
})

test("requires exact same-origin authenticated completion", async () => {
  const crossOrigin = await POST(request({ origin: "https://evil.example" }))
  expect(crossOrigin.status).toBe(400)
  expect(getUserCalls).toBe(0)
  expect(setCookies(crossOrigin)).toEqual([])

  currentUser = null
  const unauthenticated = await POST(request())
  expect(unauthenticated.status).toBe(401)
  expect(getUserCalls).toBe(1)
  expect(setCookies(unauthenticated)).toEqual([])
})

test("client completion sends only a fixed empty same-origin request", async () => {
  const calls: Array<{ input: string; init: RequestInit }> = []
  const completed = await completeAdvocateAttributionIdentitySignal(
    async (input, init) => {
      calls.push({ input, init })
      return { ok: true }
    },
  )

  expect(completed).toBe(true)
  expect(calls).toEqual([
    {
      input: "/api/auth/attribution-identity",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      },
    },
  ])
  await expect(
    completeAdvocateAttributionIdentitySignal(async () => {
      throw new Error("network failure")
    }),
  ).resolves.toBe(false)
})

test("invitation sessions require server completion before authentication", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/set-password/page.tsx"),
    "utf8",
  )
  const setSession = source.indexOf("supabase.auth.setSession")
  const completeSignal = source.indexOf(
    "completeAdvocateAttributionIdentitySignal()",
  )
  const authenticated = source.indexOf("setIsAuthenticated(true)")

  expect(setSession).toBeGreaterThan(-1)
  expect(completeSignal).toBeGreaterThan(setSession)
  expect(authenticated).toBeGreaterThan(completeSignal)
  expect(source).toContain("if (!identityCompleted)")
  expect(source).toContain("await supabase.auth.signOut()")
})
