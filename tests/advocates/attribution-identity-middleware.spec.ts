import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"
import { CookieJar } from "tough-cookie"

import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
  readAdvocateAttributionIdentityCookie,
} from "../../src/lib/advocates/attributionIdentityCookie"
import {
  createSponsorshipVisitorToken,
  SPONSORSHIP_VISITOR_COOKIE_NAME,
  verifySponsorshipVisitorToken,
} from "../../src/lib/sponsorships/visitorCookieToken"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type SupabaseMiddlewareModule =
  typeof import("../../src/utils/supabase/middleware")

const AUTH_USER_ID = "97000000-0000-4000-8000-000000000001"
const OTHER_AUTH_USER_ID = "97000000-0000-4000-8000-000000000002"

function loadUpdateSession(user: { id: string } | null) {
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
              async getUser() {
                return { data: { user }, error: null }
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
      "tests/advocates/attribution-identity-middleware.spec.ts",
    ),
  )
  const modulePath = testRequire.resolve("../../src/utils/supabase/middleware")
  delete testRequire.cache[modulePath]
  try {
    return (testRequire(modulePath) as SupabaseMiddlewareModule).updateSession
  } finally {
    nodeModule._load = originalModuleLoad
  }
}

async function authenticatedRequestCookies(
  identityUserId?: string,
): Promise<string> {
  const visitorToken = await createSponsorshipVisitorToken()
  if (visitorToken === null) throw new Error("Visitor token creation failed")

  const cookies = [`${SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorToken}`]
  if (identityUserId) {
    const identityToken = createAdvocateAttributionIdentityCookieValue({
      authUserId: identityUserId,
    })
    if (identityToken === null) {
      throw new Error("Attribution identity token creation failed")
    }
    cookies.push(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}`,
    )
  }
  return cookies.join("; ")
}

function request(cookie?: string) {
  return new NextRequest("https://creatorshare.com/app", {
    headers: {
      host: "creatorshare.com",
      ...(cookie ? { cookie } : {}),
    },
  })
}

function setCookies(response: Response): string[] {
  return (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie()
}

test("authenticated primary traffic issues a parent-domain exclusion signal", async () => {
  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const response = await updateSession(request())
  const cookies = setCookies(response)
  const identityCookie = cookies.find((cookie) =>
    cookie.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
  )

  expect(response.status).toBe(200)
  expect(cookies).toHaveLength(2)
  expect(identityCookie).toContain("Domain=.creatorshare.com")
  expect(identityCookie).toContain("HttpOnly")
  expect(identityCookie).toContain("Secure")
  expect(identityCookie).toContain("SameSite=lax")

  const forwardedCookie = response.headers.get("x-middleware-request-cookie")
  expect(
    readAdvocateAttributionIdentityCookie(forwardedCookie)?.authUserId,
  ).toBe(AUTH_USER_ID)
})

test("a matching exclusion signal remains stable", async () => {
  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const response = await updateSession(
    request(await authenticatedRequestCookies(AUTH_USER_ID)),
  )

  expect(response.status).toBe(200)
  expect(setCookies(response)).toEqual([])
  expect(
    readAdvocateAttributionIdentityCookie(
      response.headers.get("x-middleware-request-cookie"),
    )?.authUserId,
  ).toBe(AUTH_USER_ID)
})

test("an authenticated account change replaces and normalizes the signal", async () => {
  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const url = "https://creatorshare.com/app"
  const jar = new CookieJar()
  const initialCookies = await authenticatedRequestCookies(OTHER_AUTH_USER_ID)
  for (const cookie of initialCookies.split("; ")) {
    await jar.setCookie(`${cookie}; Domain=.creatorshare.com; Path=/`, url)
  }

  const response = await updateSession(request(await jar.getCookieString(url)))
  const cookies = setCookies(response)
  const sharedIdentityCookie = cookies.find(
    (cookie) =>
      cookie.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`) &&
      cookie.includes("Domain=.creatorshare.com"),
  )

  expect(cookies).toHaveLength(1)
  expect(sharedIdentityCookie).toBeTruthy()
  expect(
    readAdvocateAttributionIdentityCookie(
      response.headers.get("x-middleware-request-cookie"),
    )?.authUserId,
  ).toBe(AUTH_USER_ID)

  for (const cookie of cookies) await jar.setCookie(cookie, url)
  expect(
    readAdvocateAttributionIdentityCookie(
      await jar.getCookieString("https://hope.creatorshare.com/"),
    )?.authUserId,
  ).toBe(AUTH_USER_ID)
})

test("a sibling host deletes its host-only duplicate without deleting the shared replacement", async () => {
  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const url = "https://www.creatorshare.com/app"
  const jar = new CookieJar()
  const visitorToken = await createSponsorshipVisitorToken()
  const oldIdentity = createAdvocateAttributionIdentityCookieValue({
    authUserId: OTHER_AUTH_USER_ID,
  })
  if (visitorToken === null || oldIdentity === null) {
    throw new Error("Cookie setup failed")
  }
  await jar.setCookie(
    `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorToken}; Domain=.creatorshare.com; Path=/`,
    url,
  )
  await jar.setCookie(
    `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${oldIdentity}; Path=/`,
    url,
  )

  const response = await updateSession(
    new NextRequest(url, {
      headers: {
        host: "www.creatorshare.com",
        cookie: await jar.getCookieString(url),
      },
    }),
  )
  const cookies = setCookies(response)

  expect(cookies).toHaveLength(2)
  expect(cookies[0]).toContain("Domain=.creatorshare.com")
  expect(cookies[1]).toContain("Max-Age=0")
  expect(cookies[1]).not.toContain("Domain=")

  for (const cookie of cookies) await jar.setCookie(cookie, url)
  expect(
    readAdvocateAttributionIdentityCookie(
      await jar.getCookieString("https://hope.creatorshare.com/"),
    )?.authUserId,
  ).toBe(AUTH_USER_ID)
})

test("a missing local session does not erase a durable exclusion signal", async () => {
  const updateSession = loadUpdateSession(null)
  const response = await updateSession(
    request(await authenticatedRequestCookies(AUTH_USER_ID)),
  )

  expect(response.status).toBe(307)
  expect(response.headers.get("location")).toBe(
    "https://creatorshare.com/login",
  )
  expect(setCookies(response)).toEqual([])
})

test("apex visitor normalization does not erase its parent-domain replacement", async () => {
  const updateSession = loadUpdateSession(null)
  const url = "https://creatorshare.com/"
  const jar = new CookieJar()
  await jar.setCookie(`${SPONSORSHIP_VISITOR_COOKIE_NAME}=forged; Path=/`, url)

  const response = await updateSession(
    new NextRequest(url, {
      headers: {
        host: "creatorshare.com",
        cookie: await jar.getCookieString(url),
      },
    }),
  )
  const cookies = setCookies(response)

  expect(cookies).toHaveLength(1)
  expect(cookies[0]).toContain("Domain=.creatorshare.com")
  expect(cookies[0]).not.toContain("Max-Age=0")

  await jar.setCookie(cookies[0], url)
  const tenantCookie = await jar.getCookieString(
    "https://hope.creatorshare.com/",
  )
  const visitorValue = new URLSearchParams(
    tenantCookie.replaceAll("; ", "&"),
  ).get(SPONSORSHIP_VISITOR_COOKIE_NAME)
  expect(visitorValue).not.toBeNull()
  await expect(verifySponsorshipVisitorToken(visitorValue)).resolves.toBe(true)
})
