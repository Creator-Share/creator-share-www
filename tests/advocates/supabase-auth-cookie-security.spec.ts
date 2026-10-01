import { expect, test } from "@playwright/test"

import {
  secureSupabaseAuthCookieOptions,
  supabaseAuthCookieConfiguration,
  parseSupabaseAuthCookies,
  supabaseAuthCookiesMustBeSecure,
} from "../../src/utils/supabase/authCookieSecurity"

test.describe("Supabase authentication cookie transport security", () => {
  test("forces Secure for production and every trusted HTTPS origin", () => {
    expect(
      supabaseAuthCookiesMustBeSecure({
        environment: {
          NODE_ENV: "production",
          NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
        },
      }),
    ).toBe(true)
    expect(
      supabaseAuthCookiesMustBeSecure({
        environment: { NODE_ENV: "test" },
        trustedUrl: "https://advocate-staging.creatorshare.com/auth/callback",
      }),
    ).toBe(true)
    expect(
      secureSupabaseAuthCookieOptions(
        { httpOnly: true, sameSite: "lax", secure: false },
        {
          environment: { NODE_ENV: "test" },
          trustedUrl: "https://creatorshare.com",
        },
      ),
    ).toEqual({ httpOnly: true, sameSite: "lax", secure: true })
  })

  test("permits nonsecure cookies only for explicit loopback development", () => {
    for (const trustedUrl of [
      "http://localhost:3000",
      "http://hope.localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(
        supabaseAuthCookiesMustBeSecure({
          environment: { NODE_ENV: "development" },
          trustedUrl,
        }),
      ).toBe(false)
    }

    expect(
      supabaseAuthCookiesMustBeSecure({
        environment: { NODE_ENV: "development" },
        trustedUrl: "http://staging.example.com",
      }),
    ).toBe(true)
    expect(
      secureSupabaseAuthCookieOptions(
        { httpOnly: true },
        {
          environment: { NODE_ENV: "development" },
          trustedUrl: "http://localhost:3000",
        },
      ),
    ).toEqual({ httpOnly: true })
  })

  test("defaults to Secure when the development origin is absent or invalid", () => {
    for (const trustedUrl of [
      undefined,
      "",
      "not a URL",
      "javascript:alert(1)",
      "http://user:password@localhost:3000",
      " http://localhost:3000",
    ]) {
      expect(supabaseAuthCookiesMustBeSecure({
        environment: { NODE_ENV: "development" },
        trustedUrl,
      })).toBe(true)
    }
  })

  test("supports an already validated route transport decision", () => {
    expect(
      secureSupabaseAuthCookieOptions(
        { path: "/", secure: false },
        {
          environment: { NODE_ENV: "test" },
          forceSecure: true,
        },
      ),
    ).toEqual({ path: "/", secure: true })
  })
})


test("uses a fresh host-bound namespace and a distinct loopback namespace", () => {
  const hosted = supabaseAuthCookieConfiguration("https://project.supabase.co", {
    environment: { NODE_ENV: "production" },
  })
  expect(hosted).toEqual({
    name: "__Host-cs-project-auth-v2", path: "/", sameSite: "lax", secure: true,
  })
  expect(supabaseAuthCookieConfiguration("http://127.0.0.1:54321", {
    environment: { NODE_ENV: "development", NEXT_PUBLIC_BASE_URL: "http://localhost:3000" },
  })).toEqual({ name: "cs-127-auth-v2", path: "/", sameSite: "lax", secure: false })
})

test("the real SDK ignores legacy cookies, shares the new session, and clears its chunks", async () => {
  const { createServerClient, createBrowserClient } = await import("@supabase/ssr")
  const cookieOptions = supabaseAuthCookieConfiguration("https://project.supabase.co", {
    environment: { NODE_ENV: "production" },
  })
  const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated" }
  const claims = { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }
  const token = [ {}, claims, {} ].map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".")
  const session = { access_token: token, refresh_token: "r".repeat(6000), expires_in: 3600, token_type: "bearer", user }
  const writes: Array<{ name: string; value: string; options: Record<string, unknown> }> = []
  const jar = new Map<string, string>([["sb-project-auth-token", JSON.stringify(session)]])
  let calls = 0
  const global = { fetch: async () => {
    calls += 1
    return new Response(JSON.stringify(session), { status: 200, headers: { "Content-Type": "application/json" } })
  } }
  const cookies = {
    getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
    setAll: (batch: typeof writes) => {
      writes.push(...batch)
      for (const cookie of batch) {
        if (cookie.options.maxAge === 0) jar.delete(cookie.name)
        else jar.set(cookie.name, cookie.value)
      }
    },
  }
  const server = createServerClient("https://project.supabase.co", "test-public-key", { cookieOptions, cookies, global })
  expect((await server.auth.getSession()).data.session).toBeNull()
  expect(calls).toBe(0)
  expect((await server.auth.signInWithPassword({ email: "session@example.test", password: "test-password" })).error).toBeNull()
  expect(writes.filter(cookie => cookie.value).length).toBeGreaterThan(1)
  for (const cookie of writes) {
    expect(cookie.name.startsWith(cookieOptions.name)).toBe(true)
    expect(cookie.options).toMatchObject({ path: "/", secure: true, sameSite: "lax" })
    expect(cookie.options).not.toHaveProperty("domain")
  }
  const browser = createBrowserClient("https://project.supabase.co", "test-public-key", {
    isSingleton: false, cookieOptions, cookies, global,
  })
  expect((await browser.auth.getSession()).data.session?.access_token).toBe(token)
  await server.auth.signOut({ scope: "local" })
  expect(Array.from(jar.keys()).filter(name => name.startsWith(cookieOptions.name))).toEqual([])
  expect(jar.has("sb-project-auth-token")).toBe(true)
})


test("host-prefixed cookies cannot be planted by a sibling or sent to it", async () => {
  const { CookieJar } = await import("tough-cookie")
  const jar = new CookieJar(undefined, { prefixSecurity: "strict" })
  const name = "__Host-cs-project-auth-v2.0"
  await expect(jar.setCookie(`${name}=injected; Domain=creatorshare.com; Path=/; Secure`, "https://sibling.creatorshare.com")).rejects.toThrow()
  await jar.setCookie(`${name}=session; Path=/; Secure; SameSite=Lax`, "https://creatorshare.com")
  expect(await jar.getCookieString("https://sibling.creatorshare.com")).toBe("")
  expect(await jar.getCookieString("http://creatorshare.com")).toBe("")
  expect(await jar.getCookieString("https://creatorshare.com")).toBe(`${name}=session`)
})


test("rejects raw duplicate, mixed, and incomplete session or PKCE chunks", () => {
  const name = "__Host-cs-project-auth-v2"
  for (const header of [
    `${name}=first; ${name}=second`,
    `${name}=second; ${name}=first`,
    `${name}=base; ${name}.0=chunk`,
    `${name}.0=first; ${name}.2=third`,
    `${name}.00=first`,
    `${name}.32=extra`,
    `${name}=valid; ${name}-code-verifier=first; ${name}-code-verifier=second`,
    `${name}=valid; ${name}-code-verifier.1=missing-first`,
    `${name}=%invalid`,
  ]) expect(parseSupabaseAuthCookies(header, name)).toEqual([])
  expect(parseSupabaseAuthCookies(`sb-project-auth-token=legacy; ${name}.1=second; ${name}.0=first; ${name}-code-verifier=proof%2Fvalue`, name)).toEqual([
    { name: `${name}.1`, value: "second" },
    { name: `${name}.0`, value: "first" },
    { name: `${name}-code-verifier`, value: "proof/value" },
  ])
})
