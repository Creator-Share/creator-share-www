import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"
import { supabaseAuthCookieConfiguration } from "../../src/utils/supabase/authCookieSecurity"

const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
test.beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co"
  process.env.NEXT_PUBLIC_BASE_URL = "https://creatorshare.com"
})
test.afterEach(() => {
  if (previousSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl
  if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL
  else process.env.NEXT_PUBLIC_BASE_URL = previousBaseUrl
})

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type SupabaseMiddlewareModule =
  typeof import("../../src/utils/supabase/middleware")
type CookieAdapter = {
  getAll(): Array<{ name: string; value: string }>
  setAll(
    cookies: Array<{
      name: string
      value: string
      options?: Record<string, unknown>
    }>,
  ): void
}

test("forwards refreshed Supabase and visitor cookies to the same request", async () => {
  const authCookieName = supabaseAuthCookieConfiguration(process.env.NEXT_PUBLIC_SUPABASE_URL!).name
  let cookiesSeenBeforeRefresh: Array<{ name: string; value: string }> = []
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
              async getUser() {
                cookiesSeenBeforeRefresh = options.cookies.getAll()
                options.cookies.setAll([
                  {
                    name: authCookieName,
                    value: "refreshed-session",
                    options: { httpOnly: true, path: "/" },
                  },
                ])
                return { data: { user: null }, error: null }
              },
            },
          }
        },
      }
    }
    return originalModuleLoad.call(this, request, parent, isMain)
  }

  const testRequire = createRequire(
    resolve(process.cwd(), "tests/sponsorships/supabase-middleware.spec.ts"),
  )
  delete testRequire.cache[
    testRequire.resolve("../../src/utils/supabase/middleware")
  ]
  let updateSession: SupabaseMiddlewareModule["updateSession"]
  try {
    ;({ updateSession } = testRequire(
      "../../src/utils/supabase/middleware",
    ) as SupabaseMiddlewareModule)
  } finally {
    nodeModule._load = originalModuleLoad
  }

  const request = new NextRequest("https://creatorshare.com/", {
    headers: {
      cookie: `existing=value; ${authCookieName}=old-session; sb-project-auth-token=legacy-session`,
      host: "creatorshare.com",
      "x-middleware-request-attacker": "spoofed",
    },
  })
  const response = await updateSession(request)
  const forwardedCookie = response.headers.get("x-middleware-request-cookie")
  const setCookies = (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie()

  expect(cookiesSeenBeforeRefresh).toEqual([
    { name: authCookieName, value: "old-session" },
  ])
  expect(forwardedCookie).toContain("existing=value")
  expect(forwardedCookie).toContain("cs_sponsorship_visitor_v1=v2.")
  expect(forwardedCookie).toContain(`${authCookieName}=refreshed-session`)
  expect(setCookies).toHaveLength(3)
  expect(setCookies).toEqual(
    expect.arrayContaining([
      expect.stringMatching(
        /cs_sponsorship_visitor_v1=; Domain=\.creatorshare\.com;.*Max-Age=0/,
      ),
      expect.stringMatching(
        /cs_sponsorship_visitor_v1=v2\.[^;]+;(?!.*Domain=)/,
      ),
      expect.stringContaining(`${authCookieName}=refreshed-session`),
    ]),
  )
  expect(
    setCookies.find((cookie) =>
      cookie.startsWith(`${authCookieName}=refreshed-session`),
    ),
  ).toMatch(/; Secure/i)
  expect(
    response.headers.get("x-middleware-request-x-middleware-request-attacker"),
  ).toBeNull()
})
