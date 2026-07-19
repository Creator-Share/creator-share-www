import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RecoveryRouteModule =
  typeof import("../../src/app/api/admin/advocates/[id]/initial-owner/reissue/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const OPERATION_ID = "22222222-2222-4222-8222-222222222222"
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
        if (authStatus === "throws") throw new Error("auth unavailable")
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
    "tests/advocates/creator-share-initial-owner-recovery-route.spec.ts",
  ),
)
const recoveryRoute = testRequire(
  "../../src/app/api/admin/advocates/[id]/initial-owner/reissue/route",
) as RecoveryRouteModule
nodeModule._load = originalModuleLoad

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    expectedVersion: 3,
    ownerEmail: "Owner@Example.com",
    reason: "The prior invitation expired before the owner could accept it.",
    operationId: OPERATION_ID,
    confirmation: "REISSUE_INITIAL_OWNER",
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
  return new Request(
    `${ORIGIN}/api/admin/advocates/${ADVOCATE_ID}/initial-owner/reissue`,
    { method: "POST", headers, body: requestBody },
  )
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

async function post(requestBody = body()): Promise<Response> {
  return await recoveryRoute.POST(request(requestBody), {
    params: Promise.resolve({ id: ADVOCATE_ID }),
  })
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

test.describe("Creator Share initial owner reissue route", () => {
  test("rejects untrusted requests before authentication", async () => {
    for (const headers of [
      { host: "attacker.example" },
      { origin: "https://attacker.example" },
      { origin: "https://hope.creatorshare.com" },
      { origin: null },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
    ] as Array<Record<string, string | null>>) {
      const response = await recoveryRoute.POST(request(body(), headers), {
        params: Promise.resolve({ id: ADVOCATE_ID }),
      })
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

  test("retains no contact detail in authentication failures or logs", async () => {
    authStatus = "unauthorized"
    const unauthorized = await post()
    expect(unauthorized.status).toBe(401)
    expect(await json(unauthorized)).toEqual({
      ok: false,
      operationId: null,
      code: "unauthorized",
    })

    authStatus = "throws"
    const logged: unknown[][] = []
    const originalConsoleError = console.error
    console.error = (...values: unknown[]) => logged.push(values)
    try {
      const unavailable = await post()
      expect(unavailable.status).toBe(503)
      expect(unavailable.headers.get("cache-control")).toContain("no-store")
      expect(await json(unavailable)).toEqual({
        ok: false,
        operationId: null,
        code: "initial_owner_reissue_unavailable",
      })
    } finally {
      console.error = originalConsoleError
    }
    expect(rpcCalls).toHaveLength(0)
    expect(JSON.stringify(logged)).not.toMatch(
      /owner@example|capability|ciphertext|request body/i,
    )
  })

  test("creates fresh sealed material and returns only sanitized evidence", async () => {
    rpcResult = {
      data: [
        {
          operation_id: OPERATION_ID,
          advocate_id: ADVOCATE_ID,
          advocate_version: 4,
          onboarding_status: "initial_owner_invitation_requeued",
          created: true,
        },
      ],
      error: null,
    }
    const response = await post()
    const payload = await json(response)
    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(payload).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 4,
      reissueStatus: "initial_owner_invitation_requeued",
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /email|invitationId|outbox|capability|ciphertext|provider/i,
    )
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toMatchObject({
      name: "reissue_advocate_initial_owner_invitation",
      args: {
        reissue_operation_id: OPERATION_ID,
        target_advocate_id: ADVOCATE_ID,
        expected_advocate_version: 3,
        owner_email: "owner@example.com",
        change_reason:
          "The prior invitation expired before the owner could accept it.",
        request_id: OPERATION_ID,
        trace_id: "trace-reference",
        session_id: null,
        client_ip: "203.0.113.42",
        user_agent: "Creator Share Admin Test/1.0",
      },
    })
    expect(rpcCalls[0].args).not.toHaveProperty("capability")
    expect(rpcCalls[0].args.capability_digest).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(rpcCalls[0].args.recipient_email_ciphertext).toMatch(/^\\x/)
    expect(rpcCalls[0].args.secret_payload_ciphertext).toMatch(/^\\x/)
  })

  test("uses 200 for an exact replay", async () => {
    rpcResult = {
      data: [
        {
          operation_id: OPERATION_ID,
          advocate_id: ADVOCATE_ID,
          advocate_version: "4",
          onboarding_status: "initial_owner_invitation_requeued",
          created: false,
        },
      ],
      error: null,
    }
    const response = await post()
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 4,
      reissueStatus: "initial_owner_invitation_requeued",
    })
  })

  test("rejects malformed requests and maps private conflicts statically", async () => {
    for (const invalid of [
      body({ ownerEmail: "owner@localhost" }),
      body({ confirmation: "REISSUE" }),
      body({ invitationId: ADVOCATE_ID }),
      body({ provider: "resend" }),
    ]) {
      const response = await post(invalid)
      expect(response.status).toBe(400)
    }
    expect(rpcCalls).toHaveLength(0)

    rpcResult = {
      data: null,
      error: { code: "55000", detail: "private invitation evidence" } as never,
    }
    const conflict = await post()
    expect(conflict.status).toBe(409)
    const payload = await json(conflict)
    expect(payload).toEqual({
      ok: false,
      operationId: OPERATION_ID,
      code: "initial_owner_reissue_conflict",
    })
    expect(JSON.stringify(payload)).not.toMatch(/email|invitation evidence/i)
  })

  test("returns a fixed outage without logging contact or sealed material", async () => {
    rpcResult = { data: null, error: {} }
    const logged: unknown[][] = []
    const originalConsoleError = console.error
    console.error = (...values: unknown[]) => logged.push(values)
    try {
      const response = await post()
      expect(response.status).toBe(503)
      expect(await json(response)).toEqual({
        ok: false,
        operationId: OPERATION_ID,
        code: "initial_owner_reissue_unavailable",
      })
    } finally {
      console.error = originalConsoleError
    }
    expect(JSON.stringify(logged)).not.toMatch(
      /owner@example|capability|ciphertext|request body/i,
    )
  })
})
