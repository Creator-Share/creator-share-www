import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { AuthSessionMissingError } from "@supabase/supabase-js"
import { NextRequest } from "next/server"

type AttributionIdentityCookieModule =
  typeof import("../../src/lib/advocates/attributionIdentityCookie")
type ExposureProtocolModule =
  typeof import("../../src/lib/advocates/exposureBrokerProtocol")
type RouteModule = typeof import("../../src/app/api/advocates/exposure/route")
type VisitorCookieModule =
  typeof import("../../src/lib/sponsorships/visitorCookie")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const SIGNAL_USER_ID = "11111111-1111-4111-8111-111111111111"
const SESSION_USER_ID = "22222222-2222-4222-8222-222222222222"
const APEX_ORIGIN = "https://creatorshare.com"
const TENANT_ORIGIN = "https://hope.creatorshare.com"

let currentUser: { id: string } | null = null
let currentAuthError: Error | null = null
let recordError: { code: string } | null = null
const activeHostnames = new Set(["hope.creatorshare.com"])
const rpcCalls: Array<{ name: string; input: Record<string, unknown> }> = []

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
              return {
                data: { user: currentUser },
                error: currentAuthError,
              }
            },
          },
        }
      },
      createServiceRoleClient() {
        return {
          async rpc(name: string, input: Record<string, unknown>) {
            rpcCalls.push({ name, input })
            if (name === "read_public_advocate_presentation_snapshot") {
              const hostname = String(input.target_hostname)
              return activeHostnames.has(hostname)
                ? {
                    data: { domain: { hostname, status: "active" } },
                    error: null,
                  }
                : { data: null, error: null }
            }
            return { data: null, error: recordError }
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
    "tests/advocates/exposure-attribution-identity.spec.ts",
  ),
)
const identityCookie = testRequire(
  resolve(process.cwd(), "src/lib/advocates/attributionIdentityCookie.ts"),
) as AttributionIdentityCookieModule
const protocol = testRequire(
  resolve(process.cwd(), "src/lib/advocates/exposureBrokerProtocol.ts"),
) as ExposureProtocolModule
const visitorCookie = testRequire(
  resolve(process.cwd(), "src/lib/sponsorships/visitorCookie.ts"),
) as VisitorCookieModule
const { OPTIONS, POST } = testRequire(
  resolve(process.cwd(), "src/app/api/advocates/exposure/route.ts"),
) as RouteModule
nodeModule._load = originalModuleLoad

const BROWSER_HEADERS = {
  host: "creatorshare.com",
  origin: TENANT_ORIGIN,
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
} as const

function requireIdentityCookie(authUserId = SIGNAL_USER_ID): string {
  const value = identityCookie.createAdvocateAttributionIdentityCookieValue(
    { authUserId },
    { rawHost: "creatorshare.com" },
  )
  if (value === null) throw new Error("Expected a signed identity cookie")
  return value
}

function forgeIdentityCookie(value: string): string {
  const tagStart = value.lastIndexOf(".") + 1
  const replacement = value[tagStart] === "A" ? "B" : "A"
  return `${value.slice(0, tagStart)}${replacement}${value.slice(tagStart + 1)}`
}

async function requireVisitorCookie(rawHost = "creatorshare.com") {
  const value = await visitorCookie.createSponsorshipVisitorToken({ rawHost })
  if (value === null) throw new Error("Expected a signed visitor cookie")
  return value
}

function postRequest(
  options: {
    body?: string
    headers?: Record<string, string>
    host?: string
    origin?: string
  } = {},
): NextRequest {
  const host = options.host ?? "creatorshare.com"
  return new NextRequest(
    `${host === "creatorshare.com" ? APEX_ORIGIN : `https://${host}`}${
      protocol.ADVOCATE_EXPOSURE_BROKER_PATH
    }`,
    {
      method: "POST",
      body: options.body ?? JSON.stringify({ pagePath: "/sponsorships/amina" }),
      headers: {
        ...BROWSER_HEADERS,
        host,
        origin: options.origin ?? TENANT_ORIGIN,
        "content-type": protocol.ADVOCATE_EXPOSURE_CONTENT_TYPE,
        [protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER]:
          protocol.ADVOCATE_EXPOSURE_BROKER_VERSION,
        ...options.headers,
      },
    },
  )
}

function optionsRequest(headers: Record<string, string> = {}): NextRequest {
  const requestHeaders: Record<string, string> = {
    ...BROWSER_HEADERS,
    "access-control-request-headers": `content-type, ${protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER}`,
    "access-control-request-method": "POST",
  }
  Object.assign(requestHeaders, headers)
  return new NextRequest(
    `${APEX_ORIGIN}${protocol.ADVOCATE_EXPOSURE_BROKER_PATH}`,
    {
      method: "OPTIONS",
      headers: requestHeaders,
    },
  )
}

function setCookies(response: Response): string[] {
  return (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie()
}

function recordCalls() {
  return rpcCalls.filter(
    ({ name }) => name === "record_qualified_advocate_exposure",
  )
}

test.beforeEach(() => {
  currentUser = null
  currentAuthError = null
  recordError = null
  activeHostnames.clear()
  activeHostnames.add("hope.creatorshare.com")
  rpcCalls.length = 0
})

test.describe("canonical apex advocate exposure broker", () => {
  test("grants a credentialed preflight only after an exact active tenant lookup", async () => {
    const response = await OPTIONS(optionsRequest())

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      TENANT_ORIGIN,
    )
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    )
    expect(response.headers.get("access-control-allow-methods")).toBe("POST")
    expect(response.headers.get("access-control-allow-headers")).toBe(
      `content-type, ${protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER}`,
    )
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("vary")).toContain("Origin")
    expect(setCookies(response)).toEqual([])
    expect(rpcCalls).toEqual([
      {
        name: "read_public_advocate_presentation_snapshot",
        input: { target_hostname: "hope.creatorshare.com" },
      },
    ])
  })

  test("keeps hostile, inactive, malformed, and non-browser preflights neutral", async () => {
    for (const [label, request] of [
      [
        "unmanaged sibling",
        optionsRequest({ origin: "https://hostile.creatorshare.com" }),
      ],
      [
        "reserved sibling",
        optionsRequest({ origin: "https://admin.creatorshare.com" }),
      ],
      [
        "outside origin",
        optionsRequest({ origin: "https://hope.creatorshare.com.evil.test" }),
      ],
      [
        "wrong method",
        optionsRequest({ "access-control-request-method": "PUT" }),
      ],
      [
        "extra header",
        optionsRequest({
          "access-control-request-headers": `content-type, ${protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER}, authorization`,
        }),
      ],
      ["wrong site", optionsRequest({ "sec-fetch-site": "cross-site" })],
      ["wrong mode", optionsRequest({ "sec-fetch-mode": "navigate" })],
      ["wrong destination", optionsRequest({ "sec-fetch-dest": "document" })],
    ] as const) {
      rpcCalls.length = 0
      const response = await OPTIONS(request)
      expect(response.status, label).toBe(204)
      expect(
        response.headers.get("access-control-allow-origin"),
        label,
      ).toBeNull()
      expect(setCookies(response), label).toEqual([])
      expect(recordCalls(), label).toEqual([])
    }
  })

  test("does not grant CORS to a structurally valid but inactive tenant", async () => {
    activeHostnames.clear()
    const response = await OPTIONS(optionsRequest())

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(setCookies(response)).toEqual([])
    expect(rpcCalls).toHaveLength(1)
  })

  test("records with a new host-only apex visitor and never discloses identity", async () => {
    const response = await POST(postRequest())
    const cookies = setCookies(response)
    const visitorSet = cookies.find(
      (value) =>
        value.startsWith(
          `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=v2.`,
        ) && !value.includes("Max-Age=0"),
    )
    const parentDeletion = cookies.find(
      (value) =>
        value.startsWith(
          `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=;`,
        ) && value.includes("Domain=.creatorshare.com"),
    )
    const recorded = recordCalls()

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      TENANT_ORIGIN,
    )
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    )
    expect(visitorSet).toContain("HttpOnly")
    expect(visitorSet).toContain("Secure")
    expect(visitorSet).not.toContain("Domain=")
    expect(parentDeletion).toContain("Max-Age=0")
    expect(recorded).toHaveLength(1)
    expect(recorded[0].input).toMatchObject({
      target_advocate_hostname: "hope.creatorshare.com",
      target_auth_user_id: null,
      target_page_path: "/sponsorships/amina",
      target_referrer_host: null,
    })
    expect(recorded[0].input.target_visitor_token_digest).toMatch(
      /^\\x[0-9a-f]{64}$/,
    )
    expect(recorded[0].input).not.toHaveProperty("visitor_id")
    expect(recorded[0].input).not.toHaveProperty("advocate_id")
    await expect(response.text()).resolves.toBe("")
    expect(JSON.stringify(recorded[0].input)).not.toContain("v2.")
  })

  test("reuses one valid apex visitor without rewriting it", async () => {
    const token = await requireVisitorCookie()
    const digest = visitorCookie.sponsorshipVisitorDigestFromToken(token)
    expect(digest).not.toBeNull()
    const response = await POST(
      postRequest({
        headers: {
          cookie: `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=${token}`,
        },
      }),
    )

    expect(response.status).toBe(204)
    expect(setCookies(response)).toEqual([])
    expect(recordCalls()).toHaveLength(1)
    expect(recordCalls()[0].input.target_visitor_token_digest).toBe(
      `\\x${digest?.toString("hex")}`,
    )
  })

  test("rejects tenant-scoped and duplicate tokens and writes one apex replacement", async () => {
    const tenantToken = await requireVisitorCookie("hope.creatorshare.com")
    const apexToken = await requireVisitorCookie()

    for (const cookie of [
      `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=${tenantToken}`,
      `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=${apexToken}; ` +
        `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=${tenantToken}`,
    ]) {
      rpcCalls.length = 0
      const response = await POST(postRequest({ headers: { cookie } }))
      const replacement = setCookies(response)
        .find(
          (value) =>
            value.startsWith(
              `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=v2.`,
            ) && !value.includes("Max-Age=0"),
        )
        ?.match(
          new RegExp(
            `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=([^;]+)`,
          ),
        )?.[1]

      expect(response.status).toBe(204)
      expect(replacement).toBeTruthy()
      await expect(
        visitorCookie.verifySponsorshipVisitorToken(replacement, {
          rawHost: "creatorshare.com",
        }),
      ).resolves.toBe(true)
      await expect(
        visitorCookie.verifySponsorshipVisitorToken(replacement, {
          rawHost: "hope.creatorshare.com",
        }),
      ).resolves.toBe(false)
      expect(
        setCookies(response).some((value) =>
          value.includes("Domain=.creatorshare.com"),
        ),
      ).toBe(true)
      expect(recordCalls()).toHaveLength(1)
    }
  })

  test("preserves apex staff exclusion and fails closed on conflicting signals", async () => {
    const visitor = await requireVisitorCookie()
    const identity = requireIdentityCookie()
    const cookie = [
      `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitor}`,
      `${identityCookie.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identity}`,
    ].join("; ")

    let response = await POST(postRequest({ headers: { cookie } }))
    expect(response.status).toBe(204)
    expect(recordCalls()[0].input.target_auth_user_id).toBe(SIGNAL_USER_ID)

    rpcCalls.length = 0
    currentUser = { id: SESSION_USER_ID }
    response = await POST(postRequest({ headers: { cookie } }))
    expect(response.status).toBe(204)
    expect(recordCalls()).toEqual([])
    expect(setCookies(response)).toEqual([])
  })

  test("fails closed when the apex session cannot be verified", async () => {
    currentAuthError = new Error("provider unavailable")
    const response = await POST(postRequest())

    expect(response.status).toBe(503)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      TENANT_ORIGIN,
    )
    expect(recordCalls()).toEqual([])
    expect(setCookies(response)).toEqual([])
  })

  test("keeps an explicitly missing apex session on the guest path", async () => {
    currentAuthError = new AuthSessionMissingError()
    const response = await POST(postRequest())

    expect(response.status).toBe(204)
    expect(recordCalls()).toHaveLength(1)
    expect(recordCalls()[0].input.target_auth_user_id).toBeNull()
  })

  test("treats a forged apex identity signal as a guest", async () => {
    const forged = forgeIdentityCookie(requireIdentityCookie())
    const response = await POST(
      postRequest({
        headers: {
          cookie: `${identityCookie.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${forged}`,
        },
      }),
    )

    expect(response.status).toBe(204)
    expect(recordCalls()).toHaveLength(1)
    expect(recordCalls()[0].input.target_auth_user_id).toBeNull()
    expect(
      setCookies(response).some((value) => value.includes("Max-Age=0")),
    ).toBe(true)
  })

  test("returns a credentialed transient failure without exposing the visitor token", async () => {
    recordError = { code: "57014" }
    const response = await POST(postRequest())

    expect(response.status).toBe(503)
    expect(response.headers.get("access-control-allow-origin")).toBe(
      TENANT_ORIGIN,
    )
    expect(setCookies(response).some((value) => value.includes("=v2."))).toBe(
      true,
    )
    await expect(response.text()).resolves.toBe("")
  })

  test("rejects malformed, oversized, overprivileged, and nonqualifying bodies neutrally", async () => {
    for (const [label, body] of [
      ["malformed", "{"],
      ["oversized", JSON.stringify({ pagePath: `/${"a".repeat(1_100)}` })],
      ["array", JSON.stringify(["/"])],
      ["extra identity", JSON.stringify({ pagePath: "/", advocateId: "x" })],
      ["query", JSON.stringify({ pagePath: "/?source=forged" })],
      ["payment", JSON.stringify({ pagePath: "/payments/success" })],
    ] as const) {
      rpcCalls.length = 0
      const response = await POST(postRequest({ body }))
      expect(response.status, label).toBe(204)
      expect(
        response.headers.get("access-control-allow-origin"),
        label,
      ).toBeNull()
      expect(setCookies(response), label).toEqual([])
      expect(rpcCalls, label).toEqual([])
    }
  })

  test("rejects a tenant Host, wrong protocol headers, and wrong content negotiation before state", async () => {
    for (const [label, request] of [
      ["tenant host", postRequest({ host: "hope.creatorshare.com" })],
      [
        "wrong version",
        postRequest({
          headers: {
            [protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER]: "2",
          },
        }),
      ],
      [
        "wrong content type",
        postRequest({ headers: { "content-type": "text/plain" } }),
      ],
      [
        "same origin metadata",
        postRequest({ headers: { "sec-fetch-site": "same-origin" } }),
      ],
    ] as const) {
      rpcCalls.length = 0
      const response = await POST(request)
      expect(response.status, label).toBe(204)
      expect(
        response.headers.get("access-control-allow-origin"),
        label,
      ).toBeNull()
      expect(setCookies(response), label).toEqual([])
      expect(rpcCalls, label).toEqual([])
    }
  })
})
