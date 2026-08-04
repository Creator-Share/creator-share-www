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
const CNAME_TARGET = "d1d4fc829fe7bc7c.vercel-dns-017.com"
const TEST_COOKIE_ENVIRONMENT = Object.freeze({ NODE_ENV: "test" })
const LOCAL_TEST_COOKIE_OPTIONS = Object.freeze({
  unsafeAllowParentDomainCookiesForLocalTests: true as const,
})

function localParentContext(rawHost: string) {
  return {
    rawHost,
    localTestOptions: LOCAL_TEST_COOKIE_OPTIONS,
  }
}

function productionCookieEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    NODE_ENV: "production",
    SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: Buffer.alloc(32, 81).toString(
      "base64",
    ),
    ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1: Buffer.alloc(
      32,
      82,
    ).toString("base64"),
    ...overrides,
  }
}

function approvedCookieTrustPolicy() {
  return {
    schemaVersion: 1,
    reviewState: "approved",
    tenantRoot: "creatorshare.com",
    policyRevision: "middleware-transition-test",
    advocateCnameTarget: CNAME_TARGET,
    vercelProjectId: "prj_cookieTrustProject123",
    staticHosts: [
      {
        hostname: "creatorshare.com",
        role: "primary",
        dnsRecords: [{ type: "A", content: "76.76.21.21", proxied: false }],
      },
      {
        hostname: "publication-sentinel.creatorshare.com",
        role: "sentinel",
        dnsRecords: [{ type: "CNAME", content: CNAME_TARGET, proxied: false }],
      },
      {
        hostname: "www.creatorshare.com",
        role: "static",
        dnsRecords: [{ type: "CNAME", content: CNAME_TARGET, proxied: false }],
      },
    ],
  }
}

function loadSupabaseMiddleware(user: { id: string } | null) {
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
    return testRequire(modulePath) as SupabaseMiddlewareModule
  } finally {
    nodeModule._load = originalModuleLoad
  }
}

function loadUpdateSession(user: { id: string } | null) {
  const { updateSession } = loadSupabaseMiddleware(user)
  return (
    request: Parameters<typeof updateSession>[0],
    options: Parameters<typeof updateSession>[1] = {},
  ) =>
    updateSession(request, {
      cookieEnvironment: TEST_COOKIE_ENVIRONMENT,
      localTestCookieOptions: LOCAL_TEST_COOKIE_OPTIONS,
      ...options,
    })
}

function loadUpdateSponsorshipVisitor() {
  const { updateSponsorshipVisitor } = loadSupabaseMiddleware(null)
  return (
    request: Parameters<typeof updateSponsorshipVisitor>[0],
    options: Parameters<typeof updateSponsorshipVisitor>[1] = {},
  ) =>
    updateSponsorshipVisitor(request, {
      cookieEnvironment: TEST_COOKIE_ENVIRONMENT,
      localTestCookieOptions: LOCAL_TEST_COOKIE_OPTIONS,
      ...options,
    })
}

async function authenticatedRequestCookies(
  identityUserId?: string,
): Promise<string> {
  const visitorToken = await createSponsorshipVisitorToken(
    localParentContext("creatorshare.com"),
    TEST_COOKIE_ENVIRONMENT,
  )
  if (visitorToken === null) throw new Error("Visitor token creation failed")

  const cookies = [`${SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorToken}`]
  if (identityUserId) {
    const identityToken = createAdvocateAttributionIdentityCookieValue(
      {
        authUserId: identityUserId,
      },
      localParentContext("creatorshare.com"),
      TEST_COOKIE_ENVIRONMENT,
    )
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

test("the explicit local seam can issue a parent-domain exclusion signal", async () => {
  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const response = await updateSession(request())
  const cookies = setCookies(response)
  const identityCookie = cookies.find(
    (cookie) =>
      cookie.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`) &&
      !cookie.includes("Max-Age=0"),
  )

  expect(response.status).toBe(200)
  expect(cookies).toHaveLength(4)
  expect(identityCookie).toContain("Domain=.creatorshare.com")
  expect(identityCookie).toContain("HttpOnly")
  expect(identityCookie).toContain("Secure")
  expect(identityCookie).toContain("SameSite=lax")

  const forwardedCookie = response.headers.get("x-middleware-request-cookie")
  expect(
    readAdvocateAttributionIdentityCookie(
      forwardedCookie,
      localParentContext("creatorshare.com"),
      TEST_COOKIE_ENVIRONMENT,
    )?.authUserId,
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
      localParentContext("creatorshare.com"),
      TEST_COOKIE_ENVIRONMENT,
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

  expect(cookies).toHaveLength(2)
  expect(sharedIdentityCookie).toBeTruthy()
  expect(
    readAdvocateAttributionIdentityCookie(
      response.headers.get("x-middleware-request-cookie"),
      localParentContext("creatorshare.com"),
      TEST_COOKIE_ENVIRONMENT,
    )?.authUserId,
  ).toBe(AUTH_USER_ID)

  for (const cookie of cookies) await jar.setCookie(cookie, url)
  expect(
    readAdvocateAttributionIdentityCookie(
      await jar.getCookieString("https://hope.creatorshare.com/"),
      localParentContext("hope.creatorshare.com"),
      TEST_COOKIE_ENVIRONMENT,
    )?.authUserId,
  ).toBe(AUTH_USER_ID)
})

test("a sibling host deletes its host-only duplicate without deleting the shared replacement", async () => {
  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const url = "https://www.creatorshare.com/app"
  const jar = new CookieJar()
  const visitorToken = await createSponsorshipVisitorToken(
    localParentContext("www.creatorshare.com"),
    TEST_COOKIE_ENVIRONMENT,
  )
  const oldIdentity = createAdvocateAttributionIdentityCookieValue(
    {
      authUserId: OTHER_AUTH_USER_ID,
    },
    { rawHost: "www.creatorshare.com" },
    TEST_COOKIE_ENVIRONMENT,
  )
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
  expect(cookies[0]).toContain("Max-Age=0")
  expect(cookies[0]).not.toContain("Domain=")
  expect(cookies[1]).toContain("Domain=.creatorshare.com")

  for (const cookie of cookies) await jar.setCookie(cookie, url)
  expect(
    readAdvocateAttributionIdentityCookie(
      await jar.getCookieString("https://hope.creatorshare.com/"),
      localParentContext("hope.creatorshare.com"),
      TEST_COOKIE_ENVIRONMENT,
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

  expect(cookies).toHaveLength(2)
  expect(cookies[0]).toContain("Max-Age=0")
  expect(cookies[0]).not.toContain("Domain=")
  expect(cookies[1]).toContain("Domain=.creatorshare.com")

  for (const cookie of cookies) await jar.setCookie(cookie, url)
  const tenantCookie = await jar.getCookieString(
    "https://hope.creatorshare.com/",
  )
  const visitorValue = new URLSearchParams(
    tenantCookie.replaceAll("; ", "&"),
  ).get(SPONSORSHIP_VISITOR_COOKIE_NAME)
  expect(visitorValue).not.toBeNull()
  await expect(
    verifySponsorshipVisitorToken(
      visitorValue,
      localParentContext("hope.creatorshare.com"),
      TEST_COOKIE_ENVIRONMENT,
    ),
  ).resolves.toBe(true)
})

test("active to host-only rollback deletes both parent cookies and preserves host values", async () => {
  const policy = approvedCookieTrustPolicy()
  const activeEnvironment = productionCookieEnvironment({
    NODE_ENV: "test",
  })
  const rollbackEnvironment = productionCookieEnvironment({
    ADVOCATE_CROSS_SUBDOMAIN_COOKIE_MODE: "disabled",
  })
  const parentContext = {
    rawHost: "creatorshare.com",
    cookieTrustPolicy: policy,
    localTestOptions: LOCAL_TEST_COOKIE_OPTIONS,
  }
  const visitorToken = await createSponsorshipVisitorToken(
    parentContext,
    activeEnvironment,
  )
  const identityToken = createAdvocateAttributionIdentityCookieValue(
    { authUserId: AUTH_USER_ID },
    parentContext,
    activeEnvironment,
  )
  if (visitorToken === null || identityToken === null) {
    throw new Error("Cookie setup failed")
  }

  const url = "https://creatorshare.com/app"
  const siblingUrl = "https://hope.creatorshare.com/"
  const jar = new CookieJar()
  await jar.setCookie(
    `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorToken}; Domain=.creatorshare.com; Path=/; Secure; HttpOnly; SameSite=Lax`,
    url,
  )
  await jar.setCookie(
    `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}; Domain=.creatorshare.com; Path=/; Secure; HttpOnly; SameSite=Lax`,
    url,
  )

  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const response = await updateSession(
    new NextRequest(url, {
      headers: {
        host: "creatorshare.com",
        cookie: await jar.getCookieString(url),
      },
    }),
    { cookieEnvironment: rollbackEnvironment },
  )
  const responseCookies = setCookies(response)
  expect(responseCookies).toHaveLength(4)
  expect(responseCookies[0]).toContain("Domain=.creatorshare.com")
  expect(responseCookies[0]).toContain("Max-Age=0")
  expect(responseCookies[1]).not.toContain("Domain=")
  expect(responseCookies[2]).toContain("Domain=.creatorshare.com")
  expect(responseCookies[2]).toContain("Max-Age=0")
  expect(responseCookies[3]).not.toContain("Domain=")

  for (const cookie of responseCookies) await jar.setCookie(cookie, url)
  const siblingCookies = await jar.getCookieString(siblingUrl)
  expect(siblingCookies).not.toContain(SPONSORSHIP_VISITOR_COOKIE_NAME)
  expect(siblingCookies).not.toContain(
    ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  )

  const apexCookies = await jar.getCookies(url)
  const visitor = apexCookies.find(
    (cookie) => cookie.key === SPONSORSHIP_VISITOR_COOKIE_NAME,
  )
  const identity = apexCookies.find(
    (cookie) => cookie.key === ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  )
  expect(visitor?.hostOnly).toBe(true)
  expect(identity?.hostOnly).toBe(true)
  expect(visitor?.value).not.toBe(visitorToken)
  expect(identity?.value).not.toBe(identityToken)
  await expect(
    verifySponsorshipVisitorToken(
      visitorToken,
      { rawHost: "creatorshare.com" },
      rollbackEnvironment,
    ),
  ).resolves.toBe(false)
  expect(
    readAdvocateAttributionIdentityCookie(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}`,
      { rawHost: "creatorshare.com" },
      rollbackEnvironment,
    ),
  ).toBeNull()
  await expect(
    verifySponsorshipVisitorToken(
      visitor?.value,
      { rawHost: "creatorshare.com" },
      rollbackEnvironment,
    ),
  ).resolves.toBe(true)
  expect(
    readAdvocateAttributionIdentityCookie(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identity?.value}`,
      { rawHost: "creatorshare.com" },
      rollbackEnvironment,
    )?.authUserId,
  ).toBe(AUTH_USER_ID)
})

test("anonymous apex and tenant rollback delete the parent identity without minting a replacement", async () => {
  const activeEnvironment = productionCookieEnvironment({ NODE_ENV: "test" })
  const rollbackEnvironment = productionCookieEnvironment({
    ["ADVOCATE_CROSS_SUBDOMAIN_COOKIE_MODE"]: "disabled",
  })
  const identityToken = createAdvocateAttributionIdentityCookieValue(
    { authUserId: AUTH_USER_ID },
    {
      rawHost: "creatorshare.com",
      localTestOptions: LOCAL_TEST_COOKIE_OPTIONS,
    },
    activeEnvironment,
  )
  if (identityToken === null) throw new Error("Cookie setup failed")

  for (const scenario of [
    {
      url: "https://creatorshare.com/",
      execute: loadUpdateSession(null),
    },
    {
      url: "https://hope.creatorshare.com/",
      execute: loadUpdateSponsorshipVisitor(),
    },
  ]) {
    const jar = new CookieJar()
    await jar.setCookie(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}; Domain=.creatorshare.com; Path=/; Secure; HttpOnly; SameSite=Lax`,
      scenario.url,
    )
    const host = new URL(scenario.url).host
    const response = await scenario.execute(
      new NextRequest(scenario.url, {
        headers: { host, cookie: await jar.getCookieString(scenario.url) },
      }),
      {
        cookieEnvironment: rollbackEnvironment,
        localTestCookieOptions: undefined,
      },
    )
    const responseCookies = setCookies(response)
    const identityHeaders = responseCookies.filter((header) =>
      header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
    )
    expect(identityHeaders).toHaveLength(1)
    expect(identityHeaders[0]).toContain("Domain=.creatorshare.com")
    expect(identityHeaders[0]).toContain("Max-Age=0")

    for (const cookie of responseCookies) {
      await jar.setCookie(cookie, scenario.url)
    }
    for (const inspectedUrl of [
      scenario.url,
      "https://other.creatorshare.com/",
    ]) {
      expect(await jar.getCookieString(inspectedUrl)).not.toContain(
        ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
      )
    }
  }
})

test("anonymous apex session refresh preserves valid host-only cookies", async () => {
  const context = { rawHost: "creatorshare.com" }
  const visitorToken = await createSponsorshipVisitorToken(
    context,
    TEST_COOKIE_ENVIRONMENT,
  )
  const identityToken = createAdvocateAttributionIdentityCookieValue(
    { authUserId: AUTH_USER_ID },
    context,
    TEST_COOKIE_ENVIRONMENT,
  )
  if (visitorToken === null || identityToken === null) {
    throw new Error("Cookie setup failed")
  }

  const url = "https://creatorshare.com/"
  const jar = new CookieJar()
  await jar.setCookie(
    `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorToken}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    url,
  )
  await jar.setCookie(
    `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    url,
  )

  const { updateSession } = loadSupabaseMiddleware(null)
  const response = await updateSession(
    new NextRequest(url, {
      headers: {
        host: "creatorshare.com",
        cookie: await jar.getCookieString(url),
      },
    }),
    { cookieEnvironment: TEST_COOKIE_ENVIRONMENT },
  )
  expect(setCookies(response)).toEqual([])

  for (const cookie of setCookies(response)) await jar.setCookie(cookie, url)
  const survivingCookies = await jar.getCookies(url)
  expect(
    survivingCookies.find(
      (cookie) => cookie.key === SPONSORSHIP_VISITOR_COOKIE_NAME,
    )?.value,
  ).toBe(visitorToken)
  expect(
    survivingCookies.find(
      (cookie) => cookie.key === ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
    )?.value,
  ).toBe(identityToken)
})

test("host-only to active transition replaces both cookies with shared scope", async () => {
  const policy = approvedCookieTrustPolicy()
  const environment = productionCookieEnvironment({
    NODE_ENV: "test",
  })
  const hostOnlyEnvironment = productionCookieEnvironment({
    ADVOCATE_CROSS_SUBDOMAIN_COOKIE_MODE: "disabled",
  })
  const hostOnlyContext = { rawHost: "www.creatorshare.com" }
  const visitorToken = await createSponsorshipVisitorToken(
    hostOnlyContext,
    hostOnlyEnvironment,
  )
  const identityToken = createAdvocateAttributionIdentityCookieValue(
    { authUserId: AUTH_USER_ID },
    hostOnlyContext,
    hostOnlyEnvironment,
  )
  if (visitorToken === null || identityToken === null) {
    throw new Error("Cookie setup failed")
  }

  const url = "https://www.creatorshare.com/app"
  const siblingUrl = "https://hope.creatorshare.com/"
  const jar = new CookieJar()
  await jar.setCookie(
    `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorToken}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    url,
  )
  await jar.setCookie(
    `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    url,
  )

  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const response = await updateSession(
    new NextRequest(url, {
      headers: {
        host: "www.creatorshare.com",
        cookie: await jar.getCookieString(url),
      },
    }),
    {
      cookieEnvironment: environment,
      cookieTrustPolicy: policy,
      localTestCookieOptions: LOCAL_TEST_COOKIE_OPTIONS,
    },
  )
  const responseCookies = setCookies(response)
  expect(responseCookies).toHaveLength(4)
  expect(responseCookies[0]).not.toContain("Domain=")
  expect(responseCookies[0]).toContain("Max-Age=0")
  expect(responseCookies[1]).toContain("Domain=.creatorshare.com")
  expect(responseCookies[2]).not.toContain("Domain=")
  expect(responseCookies[2]).toContain("Max-Age=0")
  expect(responseCookies[3]).toContain("Domain=.creatorshare.com")

  await expect(
    verifySponsorshipVisitorToken(
      visitorToken,
      { rawHost: "creatorshare.com" },
      hostOnlyEnvironment,
    ),
  ).resolves.toBe(false)
  await expect(
    verifySponsorshipVisitorToken(
      visitorToken,
      { rawHost: "hope.creatorshare.com" },
      hostOnlyEnvironment,
    ),
  ).resolves.toBe(false)
  expect(
    readAdvocateAttributionIdentityCookie(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}`,
      { rawHost: "creatorshare.com" },
      hostOnlyEnvironment,
    ),
  ).toBeNull()
  expect(
    readAdvocateAttributionIdentityCookie(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}`,
      { rawHost: "hope.creatorshare.com" },
      hostOnlyEnvironment,
    ),
  ).toBeNull()

  for (const cookie of responseCookies) await jar.setCookie(cookie, url)
  const siblingCookies = await jar.getCookieString(siblingUrl)
  expect(siblingCookies).toContain(SPONSORSHIP_VISITOR_COOKIE_NAME)
  expect(siblingCookies).toContain(ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME)

  const cookiesAtSource = await jar.getCookies(url)
  expect(
    cookiesAtSource.find(
      (cookie) => cookie.key === SPONSORSHIP_VISITOR_COOKIE_NAME,
    )?.hostOnly,
  ).toBe(false)
  expect(
    cookiesAtSource.find(
      (cookie) => cookie.key === ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
    )?.hostOnly,
  ).toBe(false)
})

test("apex host-only to active transition deletes before writing shared replacements", async () => {
  const policy = approvedCookieTrustPolicy()
  const activeEnvironment = productionCookieEnvironment({
    NODE_ENV: "test",
  })
  const hostOnlyEnvironment = productionCookieEnvironment({
    ADVOCATE_CROSS_SUBDOMAIN_COOKIE_MODE: "disabled",
  })
  const sourceContext = { rawHost: "creatorshare.com" }
  const visitorToken = await createSponsorshipVisitorToken(
    sourceContext,
    hostOnlyEnvironment,
  )
  const identityToken = createAdvocateAttributionIdentityCookieValue(
    { authUserId: AUTH_USER_ID },
    sourceContext,
    hostOnlyEnvironment,
  )
  if (visitorToken === null || identityToken === null) {
    throw new Error("Cookie setup failed")
  }

  const url = "https://creatorshare.com/app"
  const siblingUrl = "https://hope.creatorshare.com/"
  const jar = new CookieJar()
  await jar.setCookie(
    `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorToken}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    url,
  )
  await jar.setCookie(
    `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    url,
  )

  const updateSession = loadUpdateSession({ id: AUTH_USER_ID })
  const response = await updateSession(
    new NextRequest(url, {
      headers: {
        host: "creatorshare.com",
        cookie: await jar.getCookieString(url),
      },
    }),
    {
      cookieEnvironment: activeEnvironment,
      cookieTrustPolicy: policy,
      localTestCookieOptions: LOCAL_TEST_COOKIE_OPTIONS,
    },
  )
  const responseCookies = setCookies(response)
  expect(responseCookies).toHaveLength(4)
  for (const index of [0, 2]) {
    expect(responseCookies[index]).toContain("Max-Age=0")
    expect(responseCookies[index]).not.toContain("Domain=")
  }
  for (const index of [1, 3]) {
    expect(responseCookies[index]).toContain("Domain=.creatorshare.com")
    expect(responseCookies[index]).not.toContain("Max-Age=0")
  }

  for (const cookie of responseCookies) await jar.setCookie(cookie, url)
  const apexCookies = await jar.getCookies(url)
  expect(
    apexCookies.find((cookie) => cookie.key === SPONSORSHIP_VISITOR_COOKIE_NAME)
      ?.hostOnly,
  ).toBe(false)
  expect(
    apexCookies.find(
      (cookie) => cookie.key === ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
    )?.hostOnly,
  ).toBe(false)
  const siblingCookies = await jar.getCookieString(siblingUrl)
  expect(siblingCookies).toContain(SPONSORSHIP_VISITOR_COOKIE_NAME)
  expect(siblingCookies).toContain(ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME)
})
