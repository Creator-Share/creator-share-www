import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"
import { CookieJar } from "tough-cookie"

import {
  INTERNAL_ROUTE_SHELL_HEADER,
  TENANT_PAYMENT_SHELL,
} from "@/lib/advocates/tenantRoutePolicy"

type MiddlewareModule = typeof import("@/middleware")
type VisitorCookieModule = typeof import("@/lib/sponsorships/visitorCookie")
type IdentityCookieModule =
  typeof import("@/lib/advocates/attributionIdentityCookie")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/tenant-middleware.spec.ts"),
)
const { middleware } = testRequire("../../src/middleware") as MiddlewareModule
const {
  createSponsorshipVisitorToken: createScopedSponsorshipVisitorToken,
  SPONSORSHIP_VISITOR_COOKIE_NAME,
  verifySponsorshipVisitorToken: verifyScopedSponsorshipVisitorToken,
} = testRequire(
  "../../src/lib/sponsorships/visitorCookie",
) as VisitorCookieModule
const {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
} = testRequire(
  "../../src/lib/advocates/attributionIdentityCookie",
) as IdentityCookieModule
nodeModule._load = originalModuleLoad

function createSponsorshipVisitorToken(rawHost = "hope.creatorshare.com") {
  return createScopedSponsorshipVisitorToken({ rawHost })
}

function verifySponsorshipVisitorToken(
  value: string | null | undefined,
  rawHost = "hope.creatorshare.com",
) {
  return verifyScopedSponsorshipVisitorToken(value, { rawHost })
}

function request(
  pathname: string,
  options: {
    host?: string
    method?: string
    headers?: Record<string, string>
  } = {},
): NextRequest {
  const host = options.host ?? "hope.creatorshare.com"
  return new NextRequest(`https://${host}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      host,
      ...options.headers,
    },
  })
}

test.describe("advocate tenant middleware", () => {
  test("permanently canonicalizes production aliases for document requests only", async () => {
    for (const host of [
      "www.creatorshare.com",
      "creator-share-www.vercel.app",
    ]) {
      for (const method of ["GET", "HEAD"] as const) {
        const response = await middleware(
          request("/auth/confirm?next=%2Fapp", { host, method }),
        )
        expect(response.status).toBe(308)
        expect(response.headers.get("location")).toBe(
          "https://creatorshare.com/auth/confirm?next=%2Fapp",
        )
        expect(response.headers.get("set-cookie")).toBeNull()
        expect(response.headers.get("referrer-policy")).toBe("no-referrer")
        expect(response.headers.get("vary")).toBe("Host")
      }

      const post = await middleware(
        request("/api/webhooks/stripe", { host, method: "POST" }),
      )
      expect(post.status).not.toBe(308)
      expect(post.headers.get("location")).toBeNull()
    }
  })

  test("denies primary administrative paths on tenant hosts before continuing", async () => {
    for (const [pathname, method] of [
      ["/admin", "GET"],
      ["/portal", "GET"],
      ["/portal/hope/branding", "GET"],
      ["/api/portal/hope/branding", "POST"],
      ["/api/portal/hope/logo", "POST"],
    ] as const) {
      const response = await middleware(request(pathname, { method }))

      expect(response.status).toBe(404)
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(response.headers.get("x-middleware-next")).toBeNull()
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      )
      expect(response.headers.get("vary")).toBe("Host")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
      if (pathname.startsWith("/api/")) {
        expect(response.headers.get("content-security-policy")).toBeNull()
        expect(response.headers.get("x-frame-options")).toBeNull()
        await expect(response.json()).resolves.toEqual({ error: "not-found" })
      } else {
        expect(response.headers.get("content-security-policy")).toBe(
          "frame-ancestors 'none'",
        )
        expect(response.headers.get("x-frame-options")).toBe("DENY")
        await expect(response.text()).resolves.toBe("Not Found")
      }
    }
  })

  test("uses a neutral API response and exact Allow header for method failures", async () => {
    const response = await middleware(request("/api/stripe"))

    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("POST")
    expect(response.headers.get("set-cookie")).toBeNull()
    await expect(response.json()).resolves.toEqual({
      error: "method-not-allowed",
    })
  })

  test("issues only a host scoped visitor cookie for an allowed tenant browse page", async () => {
    const response = await middleware(request("/"))
    const cookies = (
      response.headers as Headers & { getSetCookie(): string[] }
    ).getSetCookie()
    const cookie = cookies.find((candidate) =>
      candidate.includes(`${SPONSORSHIP_VISITOR_COOKIE_NAME}=v2.`),
    )
    const parentDeletion = cookies.find(
      (candidate) =>
        candidate.includes("Domain=.creatorshare.com") &&
        candidate.includes("Max-Age=0"),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(cookie).toContain(`${SPONSORSHIP_VISITOR_COOKIE_NAME}=`)
    expect(cookies).toHaveLength(2)
    expect(parentDeletion).toBeTruthy()
    expect(cookie).not.toContain("Domain=")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=lax")
    expect(response.headers.get("vary")).toBe("Host, Cookie")
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'",
    )
    expect(response.headers.get("x-frame-options")).toBe("DENY")
  })

  test("rotates forged and duplicate visitor cookies before forwarding", async () => {
    const first = await createSponsorshipVisitorToken()
    const second = await createSponsorshipVisitorToken()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    for (const [cookieHeader, expectedStableToken] of [
      [
        `${SPONSORSHIP_VISITOR_COOKIE_NAME}=v1.${"a".repeat(43)}.${"b".repeat(22)}`,
        null,
      ],
      [
        `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${first}; ${SPONSORSHIP_VISITOR_COOKIE_NAME}=${second}`,
        null,
      ],
      [
        `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${first}; ${SPONSORSHIP_VISITOR_COOKIE_NAME}=${first}`,
        first,
      ],
      [
        `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${first}; ${SPONSORSHIP_VISITOR_COOKIE_NAME}=forged`,
        first,
      ],
    ] as const) {
      const response = await middleware(
        request("/", { headers: { cookie: cookieHeader } }),
      )
      const setCookies = (
        response.headers as Headers & { getSetCookie(): string[] }
      ).getSetCookie()
      const issuedCookie = setCookies.find(
        (cookie) =>
          cookie.includes(`${SPONSORSHIP_VISITOR_COOKIE_NAME}=v2.`) &&
          !cookie.includes("Max-Age=0"),
      )
      const parentDeletion = setCookies.find(
        (cookie) =>
          cookie.startsWith(`${SPONSORSHIP_VISITOR_COOKIE_NAME}=;`) &&
          cookie.includes("Domain=.creatorshare.com"),
      )
      const issuedToken = issuedCookie?.match(
        new RegExp(`${SPONSORSHIP_VISITOR_COOKIE_NAME}=([^;]+)`),
      )?.[1]
      const forwardedCookie = response.headers.get(
        "x-middleware-request-cookie",
      )

      expect(issuedToken).toBeTruthy()
      await expect(verifySponsorshipVisitorToken(issuedToken)).resolves.toBe(
        true,
      )
      if (expectedStableToken !== null) {
        expect(issuedToken).toBe(expectedStableToken)
      } else {
        expect(issuedToken).not.toBe(first)
        expect(issuedToken).not.toBe(second)
      }
      expect(setCookies).toHaveLength(2)
      expect(parentDeletion).toContain("Max-Age=0")
      expect(issuedCookie).not.toContain("Domain=")
      expect(forwardedCookie).toBe(
        `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${issuedToken}`,
      )
    }
  })

  test("normalizes local duplicates without deleting the host scoped replacement", async () => {
    const token = await createSponsorshipVisitorToken("hope.localhost:3000")
    expect(token).not.toBeNull()
    const response = await middleware(
      request("/", {
        host: "hope.localhost:3000",
        headers: {
          cookie:
            `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${token}; ` +
            `${SPONSORSHIP_VISITOR_COOKIE_NAME}=forged`,
        },
      }),
    )
    const setCookies = (
      response.headers as Headers & { getSetCookie(): string[] }
    ).getSetCookie()

    expect(setCookies).toHaveLength(1)
    expect(setCookies[0]).toContain(
      `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${token}`,
    )
    expect(setCookies[0]).not.toContain("Domain=")
    expect(setCookies[0]).not.toContain("Max-Age=0")
  })

  test("does not issue a fresh cookie or run auth for the neutral payment shell", async () => {
    const response = await middleware(
      request("/payments/success?provider=paypal", {
        headers: {
          [INTERNAL_ROUTE_SHELL_HEADER]: "attacker-controlled",
          cookie: `${SPONSORSHIP_VISITOR_COOKIE_NAME}=stale-parent-token`,
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain(
      `${SPONSORSHIP_VISITOR_COOKIE_NAME}=`,
    )
    expect(response.headers.get("set-cookie")).toContain(
      "Domain=.creatorshare.com",
    )
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
    expect(response.headers.get("set-cookie")).not.toContain("=v2.")
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(
      response.headers.get(
        `x-middleware-request-${INTERNAL_ROUTE_SHELL_HEADER}`,
      ),
    ).toBe(TENANT_PAYMENT_SHELL)
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'",
    )
    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("vary")).toBe("Host")
  })

  test("never turns a bare exposure request into a new durable visitor", async () => {
    const withoutCookie = await middleware(
      request("/api/advocates/exposure", { method: "POST" }),
    )
    expect(withoutCookie.status).toBe(200)
    expect(withoutCookie.headers.get("set-cookie")).toBeNull()
    expect(withoutCookie.headers.get("vary")).toBe("Host, Origin")

    const token = await createSponsorshipVisitorToken()
    expect(token).not.toBeNull()
    const cookie = `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${token}`
    const withCookie = await middleware(
      request("/api/advocates/exposure", {
        method: "POST",
        headers: { cookie },
      }),
    )
    expect(withCookie.headers.get("set-cookie")).toContain(
      `${SPONSORSHIP_VISITOR_COOKIE_NAME}=`,
    )
    expect(withCookie.headers.get("set-cookie")).toContain(
      "Domain=.creatorshare.com",
    )
    expect(withCookie.headers.get("set-cookie")).toContain("Max-Age=0")
    expect(withCookie.headers.get("set-cookie")).not.toContain("=v2.")
    expect(withCookie.headers.get("x-middleware-request-cookie")).toBe(cookie)
  })

  test("strips a spoofed payment shell header from ordinary tenant pages", async () => {
    const response = await middleware(
      request("/", {
        headers: {
          [INTERNAL_ROUTE_SHELL_HEADER]: TENANT_PAYMENT_SHELL,
          "x-middleware-override-headers": INTERNAL_ROUTE_SHELL_HEADER,
          [`x-middleware-request-${INTERNAL_ROUTE_SHELL_HEADER}`]:
            TENANT_PAYMENT_SHELL,
        },
      }),
    )

    expect(
      response.headers.get(
        `x-middleware-request-${INTERNAL_ROUTE_SHELL_HEADER}`,
      ),
    ).toBeNull()
    expect(response.headers.get("set-cookie")).toContain(
      `${SPONSORSHIP_VISITOR_COOKIE_NAME}=`,
    )
    expect(
      response.headers
        .get("x-middleware-override-headers")
        ?.toLowerCase()
        .split(",")
        .map((value) => value.trim()),
    ).not.toContain("x-middleware-override-headers")
    expect(
      response.headers.get(
        `x-middleware-request-x-middleware-request-${INTERNAL_ROUTE_SHELL_HEADER}`,
      ),
    ).toBeNull()
  })

  test("denies an unapproved Host before application or webhook handling", async () => {
    for (const [pathname, method] of [
      ["/", "GET"],
      ["/api/webhooks/stripe", "POST"],
    ] as const) {
      const response = await middleware(
        request(pathname, { host: "unapproved.example", method }),
      )

      expect(response.status).toBe(404)
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(response.headers.get("x-middleware-next")).toBeNull()
    }
  })

  test("keeps reserved and nested Creator Share hosts fully closed", async () => {
    for (const host of [
      "admin.creatorshare.com",
      "nested.hope.creatorshare.com",
    ]) {
      for (const [pathname, method] of [
        ["/", "GET"],
        ["/payments/success", "GET"],
        ["/api/beneficiaries/get", "GET"],
        ["/api/stripe", "POST"],
        ["/auth/callback", "GET"],
      ] as const) {
        const response = await middleware(request(pathname, { host, method }))
        expect(response.status).toBe(404)
        expect(response.headers.get("set-cookie")).toBeNull()
        expect(response.headers.get("x-middleware-next")).toBeNull()
      }
    }
  })

  test("passes only the negative sentinel root to the neutral application 404", async () => {
    const host = "publication-sentinel.creatorshare.com"
    const root = await middleware(request("/", { host, method: "GET" }))
    expect(root.status).toBe(200)
    expect(root.headers.get("x-middleware-next")).toBe("1")
    expect(root.headers.get("set-cookie")).toBeNull()
    expect(root.headers.get("vary")).toContain("Host")

    for (const [pathname, method] of [
      ["/", "POST"],
      ["/about", "GET"],
      ["/payments/success", "GET"],
      ["/api/beneficiaries/get", "GET"],
      ["/_next/static/chunks/app.js", "GET"],
      ["/favicon.ico", "GET"],
      ["/logo.png", "GET"],
      ["/.well-known/creator-share/advocate-publication-canary", "POST"],
    ] as const) {
      const response = await middleware(request(pathname, { host, method }))
      expect(response.status).toBe(404)
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(response.headers.get("x-middleware-next")).toBeNull()
    }
  })

  test("keeps the sentinel neutral when runtime URLs try to promote it", async () => {
    const host = "publication-sentinel.creatorshare.com"
    const attempts = [
      ["NEXT_PUBLIC_BASE_URL", `https://${host}`],
      [
        "NEXT_PUBLIC_SITE_URL",
        "https://PUBLICATION-SENTINEL.CREATORSHARE.COM.",
      ],
      ["VERCEL_URL", host],
    ] as const
    const variables = attempts.map(([variable]) => variable)
    const previous = Object.fromEntries(
      variables.map((variable) => [variable, process.env[variable]]),
    )

    try {
      for (const [variable, configured] of attempts) {
        process.env[variable] = configured

        const root = await middleware(request("/", { host }))
        expect(root.status).toBe(200)
        expect(root.headers.get("x-middleware-next")).toBe("1")
        expect(root.headers.get("set-cookie")).toBeNull()

        const webhook = await middleware(
          request("/api/webhooks/stripe", { host, method: "POST" }),
        )
        expect(webhook.status).toBe(404)
        expect(webhook.headers.get("x-middleware-next")).toBeNull()
        expect(webhook.headers.get("set-cookie")).toBeNull()
      }
    } finally {
      for (const variable of variables) {
        const value = previous[variable]
        if (value === undefined) delete process.env[variable]
        else process.env[variable] = value
      }
    }
  })

  test("canonicalizes a tenant auth callback before exchanging its code", async () => {
    const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
    process.env.NEXT_PUBLIC_BASE_URL = "https://creatorshare.com"
    const response = await middleware(
      request("/auth/callback?code=opaque_code&next=%2Fsponsor%2Fclaim"),
    ).finally(() => {
      if (previousBaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_BASE_URL
      } else {
        process.env.NEXT_PUBLIC_BASE_URL = previousBaseUrl
      }
    })

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://creatorshare.com/auth/callback?code=opaque_code&next=%2Fsponsor%2Fclaim",
    )
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'",
    )
    expect(response.headers.get("x-frame-options")).toBe("DENY")
  })

  test("bypasses session work only for exact primary webhook requests", async () => {
    for (const pathname of ["/api/webhooks/stripe", "/api/paypal/webhook"]) {
      const response = await middleware(
        request(pathname, {
          host: "creatorshare.com",
          method: "POST",
        }),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("x-middleware-next")).toBe("1")
      expect(response.headers.get("set-cookie")).toBeNull()
    }

    const tenantWebhook = await middleware(
      request("/api/paypal/webhook", { method: "POST" }),
    )
    expect(tenantWebhook.status).toBe(404)
    expect(tenantWebhook.headers.get("set-cookie")).toBeNull()
  })

  test("preserves valid apex host-only cookies on a bypass response", async () => {
    const url = "https://creatorshare.com/api/webhooks/stripe"
    const visitorToken = await createSponsorshipVisitorToken("creatorshare.com")
    const identityToken = createAdvocateAttributionIdentityCookieValue(
      { authUserId: "97000000-0000-4000-8000-000000000001" },
      { rawHost: "creatorshare.com" },
    )
    if (visitorToken === null || identityToken === null) {
      throw new Error("Cookie setup failed")
    }

    const jar = new CookieJar()
    await jar.setCookie(
      `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorToken}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      url,
    )
    await jar.setCookie(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityToken}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      url,
    )

    const response = await middleware(
      request("/api/webhooks/stripe", {
        host: "creatorshare.com",
        method: "POST",
        headers: { cookie: await jar.getCookieString(url) },
      }),
    )
    const responseCookies = (
      response.headers as Headers & { getSetCookie(): string[] }
    ).getSetCookie()
    expect(responseCookies).toEqual([])
    for (const cookie of responseCookies) await jar.setCookie(cookie, url)

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

  test("bypasses generic session work for exact invitation secret routes", async () => {
    for (const [pathname, method] of [
      ["/advocate-invitation", "GET"],
      ["/advocate-invitation", "HEAD"],
      ["/api/auth/advocate-invitations/authenticate", "POST"],
      ["/api/auth/advocate-invitations/redeem", "POST"],
      ["/api/auth/advocate-invitations/recover", "POST"],
    ] as const) {
      const response = await middleware(
        request(pathname, { host: "creatorshare.com", method }),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("x-middleware-next")).toBe("1")
      expect(response.headers.get("set-cookie")).toBeNull()

      const deniedTenant = await middleware(request(pathname, { method }))
      expect(deniedTenant.status).toBe(404)
      expect(deniedTenant.headers.get("set-cookie")).toBeNull()
    }
  })

  test("serves exact public assets without the former extension wildcard", async () => {
    const asset = await middleware(request("/logo_text.svg"))
    expect(asset.status).toBe(200)
    expect(asset.headers.get("x-middleware-next")).toBe("1")
    expect(asset.headers.get("set-cookie")).toBeNull()

    const lookalike = await middleware(request("/private-report.svg"))
    expect(lookalike.status).toBe(404)
    expect(lookalike.headers.get("set-cookie")).toBeNull()
  })

  test("bypasses session work for exact primary-only public assets", async () => {
    const primaryAsset = await middleware(
      request("/creator-text.svg", { host: "creatorshare.com" }),
    )
    expect(primaryAsset.status).toBe(200)
    expect(primaryAsset.headers.get("x-middleware-next")).toBe("1")
    expect(primaryAsset.headers.get("set-cookie")).toBeNull()

    const tenantAsset = await middleware(request("/creator-text.svg"))
    expect(tenantAsset.status).toBe(404)
    expect(tenantAsset.headers.get("set-cookie")).toBeNull()
  })
})
