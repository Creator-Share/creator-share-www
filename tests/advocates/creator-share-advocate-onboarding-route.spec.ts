import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type OnboardingRouteModule =
  typeof import("../../src/app/api/admin/advocates/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const ACTOR_ID = "33333333-3333-4333-8333-333333333333"
const ORIGIN = "https://creatorshare.com"

let authStatus: "ok" | "unauthorized" | "forbidden" | "throws" = "ok"
let createClientCalls = 0
let rpcResult: { data: unknown; error: { code?: string } | null } = {
  data: null,
  error: null,
}
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

const client = {
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ name, args })
    return rpcResult
  },
}

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
        return client
      },
    }
  }
  if (request === "@/utils/auth/requireSuperAdmin") {
    return {
      async requireSuperAdmin() {
        if (authStatus === "ok") return { ok: true, user: { id: ACTOR_ID } }
        if (authStatus === "throws") throw new Error("auth backend unavailable")
        return {
          ok: false,
          response: new Response(null, {
            status: authStatus === "unauthorized" ? 401 : 403,
          }),
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/advocates/creator-share-advocate-onboarding-route.spec.ts",
  ),
)
const onboardingRoute = testRequire(
  "../../src/app/api/admin/advocates/route",
) as OnboardingRouteModule
nodeModule._load = originalModuleLoad

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    slug: "hope-partners",
    displayName: "Hope Partners",
    advocateType: "organization",
    ownerEmail: "Owner@Example.com",
    reason: "Create the approved Hope Partners advocate portal.",
    operationId: OPERATION_ID,
    ...overrides,
  })
}

function request(
  requestBody: string,
  overrides: Record<string, string | null> = {},
): Request {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
    "x-vercel-id": "trace-reference",
    "x-vercel-forwarded-for": "203.0.113.42",
    "user-agent": "Creator Share Admin Test/1.0",
  })
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return new Request(`${ORIGIN}/api/admin/advocates`, {
    method: "POST",
    headers,
    body: requestBody,
  })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

test.beforeEach(() => {
  authStatus = "ok"
  createClientCalls = 0
  rpcCalls.length = 0
  rpcResult = { data: null, error: null }
  process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = Buffer.alloc(32, 47).toString(
    "base64",
  )
})

test.afterAll(() => {
  delete process.env.SPONSORSHIP_CRYPTO_SECRET_V1
})

test.describe("Creator Share advocate onboarding route", () => {
  test("rejects untrusted requests before client creation or body parsing", async () => {
    const invalidHeaders: Array<Record<string, string | null>> = [
      { host: "attacker.example" },
      { origin: "https://attacker.example" },
      {
        host: "hope.creatorshare.com",
        origin: "https://hope.creatorshare.com",
      },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
      { origin: null },
    ]

    for (const overrides of invalidHeaders) {
      const response = await onboardingRoute.POST(request(body(), overrides))
      expect(response.status).toBe(400)
      expect(await json(response)).toEqual({
        ok: false,
        operationId: null,
        code: "invalid_request",
      })
    }
    expect(createClientCalls).toBe(0)
    expect(rpcCalls).toHaveLength(0)
  })

  test("requires a Creator Share super administrator before body parsing", async () => {
    authStatus = "unauthorized"
    const unauthorized = await onboardingRoute.POST(request(body()))
    expect(unauthorized.status).toBe(401)
    expect(await json(unauthorized)).toEqual({
      ok: false,
      operationId: null,
      code: "unauthorized",
    })

    authStatus = "forbidden"
    const forbidden = await onboardingRoute.POST(request("not-json"))
    expect(forbidden.status).toBe(403)
    expect(await json(forbidden)).toEqual({
      ok: false,
      operationId: null,
      code: "forbidden",
    })
    expect(rpcCalls).toHaveLength(0)
  })

  test("returns a fixed no-store outage when authentication throws", async () => {
    authStatus = "throws"
    const logged: unknown[][] = []
    const originalConsoleError = console.error
    console.error = (...values: unknown[]) => {
      logged.push(values)
    }
    try {
      const response = await onboardingRoute.POST(request("not-json"))
      expect(response.status).toBe(503)
      expect(response.headers.get("cache-control")).toContain("no-store")
      expect(await json(response)).toEqual({
        ok: false,
        operationId: null,
        code: "onboarding_unavailable",
      })
    } finally {
      console.error = originalConsoleError
    }
    expect(rpcCalls).toHaveLength(0)
    expect(JSON.stringify(logged)).not.toMatch(/owner@example|capability|body/i)
  })

  test("returns only sanitized immutable onboarding evidence", async () => {
    rpcResult = {
      data: [
        {
          operation_id: OPERATION_ID,
          advocate_id: ADVOCATE_ID,
          advocate_version: 1,
          onboarding_status: "initial_owner_invitation_queued",
          created: true,
        },
      ],
      error: null,
    }
    const response = await onboardingRoute.POST(request(body()))
    const payload = await json(response)
    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(payload).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 1,
      onboardingStatus: "initial_owner_invitation_queued",
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /email|invitationId|outbox|capability|ciphertext|targetAuth|provider/i,
    )

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toMatchObject({
      name: "onboard_creator_share_advocate",
      args: {
        onboarding_operation_id: OPERATION_ID,
        portal_slug: "hope-partners",
        portal_display_name: "Hope Partners",
        portal_advocate_type: "organization",
        owner_email: "owner@example.com",
        change_reason: "Create the approved Hope Partners advocate portal.",
        request_id: OPERATION_ID,
        trace_id: "trace-reference",
        session_id: null,
        client_ip: "203.0.113.42",
        user_agent: "Creator Share Admin Test/1.0",
      },
    })
    expect(rpcCalls[0].args).not.toHaveProperty("capability")
  })

  test("returns a byte-equivalent replay without exposing the internal replay flag", async () => {
    rpcResult = {
      data: [
        {
          operation_id: OPERATION_ID,
          advocate_id: ADVOCATE_ID,
          advocate_version: "1",
          onboarding_status: "initial_owner_invitation_queued",
          created: false,
        },
      ],
      error: null,
    }
    const response = await onboardingRoute.POST(request(body()))
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 1,
      onboardingStatus: "initial_owner_invitation_queued",
    })
  })

  test("rejects malformed bodies and maps deterministic conflicts", async () => {
    const malformed = await onboardingRoute.POST(
      request(body({ ownerEmail: "owner@localhost" })),
    )
    expect(malformed.status).toBe(400)
    expect(rpcCalls).toHaveLength(0)

    rpcResult = { data: null, error: { code: "23505" } }
    const conflict = await onboardingRoute.POST(request(body()))
    expect(conflict.status).toBe(409)
    expect(await json(conflict)).toEqual({
      ok: false,
      operationId: OPERATION_ID,
      code: "onboarding_conflict",
    })
  })

  test("returns a fixed no-store outage for an unavailable onboarding RPC", async () => {
    rpcResult = { data: null, error: {} }
    const logged: unknown[][] = []
    const originalConsoleError = console.error
    console.error = (...values: unknown[]) => {
      logged.push(values)
    }
    try {
      const response = await onboardingRoute.POST(request(body()))
      expect(response.status).toBe(503)
      expect(response.headers.get("cache-control")).toContain("no-store")
      expect(await json(response)).toEqual({
        ok: false,
        operationId: OPERATION_ID,
        code: "onboarding_unavailable",
      })
    } finally {
      console.error = originalConsoleError
    }
    expect(JSON.stringify(logged)).not.toMatch(
      /owner@example|capability|ciphertext|body/i,
    )
  })
})
