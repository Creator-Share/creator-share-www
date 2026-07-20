import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

type RouteModule =
  typeof import("../../src/app/api/auth/advocate-invitations/redeem/route")
type RecoveryRouteModule =
  typeof import("../../src/app/api/auth/advocate-invitations/recover/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333"
const OPERATION_ID = "44444444-4444-4444-8444-444444444444"
const ORIGIN = "https://creatorshare.com"
const MATERIAL = Object.freeze({
  capability: "a".repeat(64),
  authTokenHash: "Auth_hash.value~with-safe-characters_".repeat(2),
  authType: "magiclink" as const,
  version: 1 as const,
})
const REDEMPTION_REQUEST = Object.freeze({
  capability: MATERIAL.capability,
  operationId: OPERATION_ID,
  version: 1 as const,
})
const RECOVERY_REQUEST = Object.freeze({
  operationId: OPERATION_ID,
  version: 1 as const,
})

process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = Buffer.alloc(
  32,
  0x42,
).toString("base64")
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
process.env.VERCEL_URL = "preview.example.test"

let currentUserResult: {
  data: { user: { id: string } | null }
  error: { code?: string } | null
} = { data: { user: { id: AUTH_USER_ID } }, error: null }
let rpcResult: { data: unknown; error: { code?: string } | null } = {
  data: [
    {
      advocate_id: ADVOCATE_ID,
      membership_id: MEMBERSHIP_ID,
      membership_version: 1,
    },
  ],
  error: null,
}
let createClientCalls = 0
let getUserCalls = 0
let writeRefreshedSessionCookie = false
const rpcCalls: Array<{ name: string; input: unknown }> = []

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
            async getUser() {
              getUserCalls += 1
              if (writeRefreshedSessionCookie) {
                options.cookies.setAll([
                  {
                    name: "sb-refreshed-auth-token",
                    value: "refreshed-session-cookie",
                    options: {
                      httpOnly: true,
                      sameSite: "lax",
                      path: "/",
                    },
                  },
                ])
              }
              return currentUserResult
            },
          },
          async rpc(name: string, input?: unknown) {
            rpcCalls.push({ name, input })
            return rpcResult
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/invitation-redemption-route.spec.ts"),
)
const { POST: redeemPOST } = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/auth/advocate-invitations/redeem/route.ts",
  ),
) as RouteModule
const { POST: recoverPOST } = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/auth/advocate-invitations/recover/route.ts",
  ),
) as RecoveryRouteModule
nodeModule._load = originalModuleLoad

function request(
  body = JSON.stringify(REDEMPTION_REQUEST),
  headerOverrides: Record<string, string | null> = {},
  path = "/api/auth/advocate-invitations/redeem",
  transportOrigin = ORIGIN,
): NextRequest {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
    "x-trace-id": "trace-123",
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

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

test.beforeEach(() => {
  currentUserResult = { data: { user: { id: AUTH_USER_ID } }, error: null }
  rpcResult = {
    data: [
      {
        advocate_id: ADVOCATE_ID,
        membership_id: MEMBERSHIP_ID,
        membership_version: 1,
      },
    ],
    error: null,
  }
  createClientCalls = 0
  getUserCalls = 0
  writeRefreshedSessionCookie = false
  rpcCalls.length = 0
})

test.describe("advocate invitation redemption route", () => {
  test("rejects tenant, cross-site, wrong-path, and malformed requests before auth", async () => {
    for (const value of [
      request(JSON.stringify(REDEMPTION_REQUEST), {
        host: "hope.creatorshare.com",
      }),
      request(JSON.stringify(REDEMPTION_REQUEST), {
        host: "www.creatorshare.com",
        origin: "https://www.creatorshare.com",
      }),
      request(JSON.stringify(REDEMPTION_REQUEST), {
        host: "preview.example.test",
        origin: "https://preview.example.test",
      }),
      request(JSON.stringify(REDEMPTION_REQUEST), {
        origin: "https://attacker.example",
      }),
      request(JSON.stringify(REDEMPTION_REQUEST), {
        "sec-fetch-site": "cross-site",
      }),
      request(JSON.stringify(REDEMPTION_REQUEST), {
        "content-type": "text/plain",
      }),
      request(JSON.stringify(REDEMPTION_REQUEST), {}, "/api/auth/wrong"),
      request("{}"),
      request(JSON.stringify({ ...REDEMPTION_REQUEST, capability: "short" })),
      request(JSON.stringify({ ...REDEMPTION_REQUEST, operationId: "not-v4" })),
      request("x".repeat(2_049), { "content-length": "2049" }),
    ]) {
      const response = await redeemPOST(value)
      expect(response.status).toBe(400)
      expect(await json(response)).toEqual({
        ok: false,
        code: "invalid_request",
      })
    }
    expect(createClientCalls).toBe(0)
    expect(getUserCalls).toBe(0)
    expect(rpcCalls).toHaveLength(0)
  })

  test("uses the established session, redeems one operation, and establishes attribution identity", async () => {
    writeRefreshedSessionCookie = true
    const response = await redeemPOST(
      request(
        JSON.stringify(REDEMPTION_REQUEST),
        {
          "x-forwarded-for": "198.51.100.8",
          "user-agent": "browser-secret-bearing-agent",
        },
        "/api/auth/advocate-invitations/redeem",
        "http://internal-proxy.example",
      ),
    )
    expect(response.status).toBe(200)
    const payload = await json(response)
    expect(payload).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      redirect: "/portal",
    })
    expect(response.headers.get("cache-control")).toContain("no-store")
    const setCookie = response.headers.get("set-cookie")
    expect(setCookie).toMatch(/cs_advocate_attribution_identity_v1=/)
    expect(setCookie).toMatch(/sb-refreshed-auth-token=/)
    expect(setCookie).toMatch(/; Secure/i)
    expect(setCookie).toMatch(/; HttpOnly/i)
    expect(setCookie).toMatch(/; SameSite=Lax/i)
    expect(getUserCalls).toBe(1)
    expect(rpcCalls).toEqual([
      {
        name: "redeem_advocate_invitation",
        input: {
          redemption_operation_id: OPERATION_ID,
          plaintext_capability: MATERIAL.capability,
          change_reason: "Accept advocate portal invitation",
          request_id: OPERATION_ID,
          trace_id: "trace-123",
          session_id: null,
          client_ip: null,
          user_agent: null,
        },
      },
    ])
    expect(JSON.stringify(payload)).not.toContain(MATERIAL.capability)
    expect(JSON.stringify(payload)).not.toContain(MATERIAL.authTokenHash)
  })

  test("requires the session before touching database redemption", async () => {
    currentUserResult = { data: { user: null }, error: null }
    const unauthenticated = await redeemPOST(request())
    expect(unauthenticated.status).toBe(401)
    expect(await json(unauthenticated)).toEqual({
      ok: false,
      code: "authentication_required",
    })
    expect(rpcCalls).toHaveLength(0)
  })

  test("maps permission, membership, concurrency, and transient failures without leaking material", async () => {
    for (const [postgresCode, status, code] of [
      ["42501", 410, "invalid_or_expired"],
      ["28000", 401, "authentication_required"],
      ["23505", 409, "membership_conflict"],
      ["55000", 409, "membership_conflict"],
      ["40001", 409, "redemption_conflict"],
      ["22023", 400, "invalid_request"],
      ["XX000", 503, "redemption_unavailable"],
    ] as const) {
      rpcResult = { data: null, error: { code: postgresCode } }
      const response = await redeemPOST(request())
      expect(response.status).toBe(status)
      const payload = await json(response)
      expect(payload).toEqual({ ok: false, code })
      expect(JSON.stringify(payload)).not.toContain(MATERIAL.capability)
      expect(JSON.stringify(payload)).not.toContain(MATERIAL.authTokenHash)
    }

    rpcResult = { data: [{ membership_version: 1 }], error: null }
    const malformed = await redeemPOST(request())
    expect(malformed.status).toBe(503)
    expect(await json(malformed)).toEqual({
      ok: false,
      code: "redemption_unavailable",
    })
  })

  test("returns refreshed session cookies even when database redemption rejects the request", async () => {
    writeRefreshedSessionCookie = true
    rpcResult = { data: null, error: { code: "42501" } }

    const denied = await redeemPOST(request())

    expect(denied.status).toBe(410)
    expect(await json(denied)).toEqual({
      ok: false,
      code: "invalid_or_expired",
    })
    expect(denied.headers.get("set-cookie")).toMatch(
      /sb-refreshed-auth-token=refreshed-session-cookie/,
    )
  })

  test("recovers only through the authenticated operation receipt", async () => {
    writeRefreshedSessionCookie = true
    const recovered = await recoverPOST(
      request(
        JSON.stringify(RECOVERY_REQUEST),
        {},
        "/api/auth/advocate-invitations/recover",
      ),
    )
    expect(recovered.status).toBe(200)
    expect(await json(recovered)).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      redirect: "/portal",
    })
    const recoveryCookies = recovered.headers.get("set-cookie")
    expect(recoveryCookies).toMatch(/cs_advocate_attribution_identity_v1=/)
    expect(recoveryCookies).toMatch(
      /sb-refreshed-auth-token=refreshed-session-cookie/,
    )
    expect(rpcCalls).toEqual([
      {
        name: "recover_advocate_invitation_redemption",
        input: { redemption_operation_id: OPERATION_ID },
      },
    ])

    currentUserResult = { data: { user: null }, error: null }
    rpcCalls.length = 0
    const unauthenticated = await recoverPOST(
      request(
        JSON.stringify(RECOVERY_REQUEST),
        {},
        "/api/auth/advocate-invitations/recover",
      ),
    )
    expect(unauthenticated.status).toBe(401)
    expect(await json(unauthenticated)).toEqual({
      ok: false,
      code: "authentication_required",
    })
    expect(rpcCalls).toHaveLength(0)
  })

  test("rejects malformed recovery before auth and hides receipt lookup failures", async () => {
    for (const invalid of [
      "{}",
      JSON.stringify({ ...RECOVERY_REQUEST, operationId: "not-v4" }),
      JSON.stringify({ ...RECOVERY_REQUEST, capability: MATERIAL.capability }),
      JSON.stringify({ version: 1, operationId: OPERATION_ID }),
    ]) {
      const denied = await recoverPOST(
        request(invalid, {}, "/api/auth/advocate-invitations/recover"),
      )
      expect(denied.status).toBe(400)
      expect(await json(denied)).toEqual({
        ok: false,
        code: "invalid_request",
      })
    }
    expect(createClientCalls).toBe(0)

    rpcResult = { data: null, error: { code: "42501" } }
    const unavailable = await recoverPOST(
      request(
        JSON.stringify(RECOVERY_REQUEST),
        {},
        "/api/auth/advocate-invitations/recover",
      ),
    )
    expect(unavailable.status).toBe(410)
    expect(await json(unavailable)).toEqual({
      ok: false,
      code: "invalid_or_expired",
    })

    writeRefreshedSessionCookie = true
    rpcResult = { data: null, error: { code: "28000" } }
    const expiredSession = await recoverPOST(
      request(
        JSON.stringify(RECOVERY_REQUEST),
        {},
        "/api/auth/advocate-invitations/recover",
      ),
    )
    expect(expiredSession.status).toBe(401)
    expect(await json(expiredSession)).toEqual({
      ok: false,
      code: "authentication_required",
    })
    expect(expiredSession.headers.get("set-cookie")).toMatch(
      /sb-refreshed-auth-token=refreshed-session-cookie/,
    )
  })
})
