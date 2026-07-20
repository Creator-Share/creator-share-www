import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

type AttributionIdentityCookieModule =
  typeof import("../../src/lib/advocates/attributionIdentityCookie")
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
const ORIGIN = "https://hope.creatorshare.com"

let currentUser: { id: string } | null = null
let serviceClientCalls = 0
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
              return { data: { user: currentUser } }
            },
          },
        }
      },
      createServiceRoleClient() {
        serviceClientCalls += 1
        return {
          async rpc(name: string, input: Record<string, unknown>) {
            rpcCalls.push({ name, input })
            return { data: null, error: null }
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
const visitorCookie = testRequire(
  resolve(process.cwd(), "src/lib/sponsorships/visitorCookie.ts"),
) as VisitorCookieModule
const { POST } = testRequire(
  resolve(process.cwd(), "src/app/api/advocates/exposure/route.ts"),
) as RouteModule
nodeModule._load = originalModuleLoad

function requireIdentityCookie(authUserId = SIGNAL_USER_ID): string {
  const value = identityCookie.createAdvocateAttributionIdentityCookieValue(
    {
      authUserId,
    },
    { rawHost: "hope.creatorshare.com" },
  )
  if (value === null) {
    throw new Error(
      "Expected the test attribution identity cookie to be signed",
    )
  }
  return value
}

function forgeIdentityCookie(value: string): string {
  const tagStart = value.lastIndexOf(".") + 1
  const firstTagCharacter = value[tagStart]
  const replacement = firstTagCharacter === "A" ? "B" : "A"
  return `${value.slice(0, tagStart)}${replacement}${value.slice(tagStart + 1)}`
}

async function requireVisitorCookie(): Promise<string> {
  const value = await visitorCookie.createSponsorshipVisitorToken({
    rawHost: "hope.creatorshare.com",
  })
  if (value === null) {
    throw new Error("Expected the test sponsorship visitor cookie to be signed")
  }
  return value
}

async function request(identityCookieValue: string): Promise<NextRequest> {
  const visitorCookieValue = await requireVisitorCookie()
  return new NextRequest(`${ORIGIN}/api/advocates/exposure`, {
    method: "POST",
    headers: {
      cookie: [
        `${visitorCookie.SPONSORSHIP_VISITOR_COOKIE_NAME}=${visitorCookieValue}`,
        `${identityCookie.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${identityCookieValue}`,
      ].join("; "),
      host: "hope.creatorshare.com",
      origin: ORIGIN,
      referer: `${ORIGIN}/sponsorships/amina`,
      "sec-fetch-site": "same-origin",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
    },
  })
}

test.beforeEach(() => {
  currentUser = null
  serviceClientCalls = 0
  rpcCalls.length = 0
})

test.describe("cross-host advocate exposure identity exclusion", () => {
  test("uses a valid parent-domain identity signal when tenant auth is absent", async () => {
    const response = await POST(await request(requireIdentityCookie()))

    expect(response.status).toBe(204)
    expect(serviceClientCalls).toBe(1)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toMatchObject({
      name: "record_qualified_advocate_exposure",
      input: { target_auth_user_id: SIGNAL_USER_ID },
    })
  })

  test("fails closed when local auth conflicts with the identity signal", async () => {
    currentUser = { id: SESSION_USER_ID }

    const response = await POST(await request(requireIdentityCookie()))

    expect(response.status).toBe(204)
    expect(serviceClientCalls).toBe(0)
    expect(rpcCalls).toHaveLength(0)
  })

  test("treats a forged identity signal as a guest exposure", async () => {
    const forgedCookie = forgeIdentityCookie(requireIdentityCookie())

    const response = await POST(await request(forgedCookie))

    expect(response.status).toBe(204)
    expect(serviceClientCalls).toBe(1)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toMatchObject({
      name: "record_qualified_advocate_exposure",
      input: { target_auth_user_id: null },
    })
  })
})
