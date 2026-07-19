import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RouteModule =
  typeof import("../../src/app/api/auth/advocate-invitations/redeem/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333"
const ORIGIN = "https://creatorshare.com"
const MATERIAL = Object.freeze({
  capability: "a".repeat(64),
  authTokenHash: "Auth_hash.value~with-safe-characters_".repeat(2),
  authType: "magiclink" as const,
  version: 1 as const,
})

process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = Buffer.alloc(
  32,
  0x42,
).toString("base64")

let verifyResult: {
  data: { user: { id: string } | null }
  error: { code?: string } | null
} = { data: { user: { id: AUTH_USER_ID } }, error: null }
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
const verifyCalls: unknown[] = []
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
  if (request === "@/utils/supabase/server") {
    return {
      async createClient() {
        createClientCalls += 1
        return {
          auth: {
            async verifyOtp(input: unknown) {
              verifyCalls.push(input)
              return verifyResult
            },
            async getUser() {
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
const { POST } = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/auth/advocate-invitations/redeem/route.ts",
  ),
) as RouteModule
nodeModule._load = originalModuleLoad

function request(
  body = JSON.stringify(MATERIAL),
  headerOverrides: Record<string, string | null> = {},
  path = "/api/auth/advocate-invitations/redeem",
) {
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
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body,
  })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

test.beforeEach(() => {
  verifyResult = { data: { user: { id: AUTH_USER_ID } }, error: null }
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
  verifyCalls.length = 0
  rpcCalls.length = 0
})

test.describe("advocate invitation redemption route", () => {
  test("rejects tenant, cross-site, wrong-path, and malformed requests before auth", async () => {
    for (const value of [
      request(JSON.stringify(MATERIAL), { host: "hope.creatorshare.com" }),
      request(JSON.stringify(MATERIAL), {
        origin: "https://attacker.example",
      }),
      request(JSON.stringify(MATERIAL), { "sec-fetch-site": "cross-site" }),
      request(JSON.stringify(MATERIAL), { "content-type": "text/plain" }),
      request(JSON.stringify(MATERIAL), {}, "/api/auth/wrong"),
      request("{}"),
      request(JSON.stringify({ ...MATERIAL, capability: "short" })),
      request("x".repeat(2_049), { "content-length": "2049" }),
    ]) {
      const response = await POST(value)
      expect(response.status).toBe(400)
      expect(await json(response)).toEqual({
        ok: false,
        code: "invalid_request",
      })
    }
    expect(createClientCalls).toBe(0)
    expect(verifyCalls).toHaveLength(0)
    expect(rpcCalls).toHaveLength(0)
  })

  test("verifies the email proof, redeems once, and establishes session attribution identity", async () => {
    const response = await POST(
      request(JSON.stringify(MATERIAL), {
        "x-forwarded-for": "198.51.100.8",
        "user-agent": "browser-secret-bearing-agent",
      }),
    )
    expect(response.status).toBe(200)
    const payload = await json(response)
    expect(payload).toEqual({ ok: true, redirect: "/portal" })
    expect(response.headers.get("cache-control")).toContain("no-store")
    const setCookie = response.headers.get("set-cookie")
    expect(setCookie).toMatch(/cs_advocate_attribution_identity_v1=/)
    expect(setCookie).toMatch(/; Secure/i)
    expect(setCookie).toMatch(/; HttpOnly/i)
    expect(setCookie).toMatch(/; SameSite=Lax/i)
    expect(verifyCalls).toEqual([
      { token_hash: MATERIAL.authTokenHash, type: "magiclink" },
    ])
    expect(rpcCalls).toEqual([
      {
        name: "redeem_advocate_invitation",
        input: {
          plaintext_capability: MATERIAL.capability,
          change_reason: "Accept advocate portal invitation",
          request_id: expect.any(String),
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

  test("retries redemption through the still-fresh authenticated session after OTP consumption", async () => {
    verifyResult = {
      data: { user: null },
      error: { code: "otp_expired" },
    }
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ ok: true, redirect: "/portal" })
    expect(rpcCalls).toHaveLength(1)

    currentUserResult = { data: { user: null }, error: null }
    rpcCalls.length = 0
    const unauthenticated = await POST(request())
    expect(unauthenticated.status).toBe(410)
    expect(await json(unauthenticated)).toEqual({
      ok: false,
      code: "invalid_or_expired",
    })
    expect(rpcCalls).toHaveLength(0)
  })

  test("maps permission, membership, concurrency, and transient failures without leaking material", async () => {
    for (const [postgresCode, status, code] of [
      ["42501", 410, "invalid_or_expired"],
      ["28000", 410, "invalid_or_expired"],
      ["23505", 409, "membership_conflict"],
      ["55000", 409, "membership_conflict"],
      ["40001", 409, "redemption_conflict"],
      ["22023", 400, "invalid_request"],
      ["XX000", 503, "redemption_unavailable"],
    ] as const) {
      rpcResult = { data: null, error: { code: postgresCode } }
      const response = await POST(request())
      expect(response.status).toBe(status)
      const payload = await json(response)
      expect(payload).toEqual({ ok: false, code })
      expect(JSON.stringify(payload)).not.toContain(MATERIAL.capability)
      expect(JSON.stringify(payload)).not.toContain(MATERIAL.authTokenHash)
    }

    rpcResult = { data: [{ membership_version: 1 }], error: null }
    const malformed = await POST(request())
    expect(malformed.status).toBe(503)
    expect(await json(malformed)).toEqual({
      ok: false,
      code: "redemption_unavailable",
    })
  })
})
