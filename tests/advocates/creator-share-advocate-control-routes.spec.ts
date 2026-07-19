import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type LifecycleRouteModule =
  typeof import("../../src/app/api/admin/advocates/[id]/lifecycle/route")
type CleanupRecoveryRouteModule =
  typeof import("../../src/app/api/admin/advocates/[id]/cleanup-recovery/route")
type OwnershipRouteModule =
  typeof import("../../src/app/api/admin/advocates/[id]/ownership/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const ACTOR_ID = "22222222-2222-4222-8222-222222222222"
const OWNER_MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333"
const TARGET_MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444"
const OPERATION_ID = "55555555-5555-4555-8555-555555555555"
const ORIGIN = "https://creatorshare.com"

let authStatus: "ok" | "unauthorized" | "forbidden" = "ok"
let createClientCalls = 0
let rpcResult: { data: unknown; error: { code?: string } | null } = {
  data: null,
  error: null,
}
const rpcCalls: Array<{ name: string; args: unknown }> = []

const client = {
  async rpc(name: string, args: unknown) {
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
    "tests/advocates/creator-share-advocate-control-routes.spec.ts",
  ),
)
const lifecycleRoute = testRequire(
  resolve(process.cwd(), "src/app/api/admin/advocates/[id]/lifecycle/route.ts"),
) as LifecycleRouteModule
const cleanupRecoveryRoute = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/admin/advocates/[id]/cleanup-recovery/route.ts",
  ),
) as CleanupRecoveryRouteModule
const ownershipRoute = testRequire(
  resolve(process.cwd(), "src/app/api/admin/advocates/[id]/ownership/route.ts"),
) as OwnershipRouteModule
nodeModule._load = originalModuleLoad

function lifecycleBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: "suspend",
    expectedVersion: 7,
    reason: "Pause this portal while the partnership is reviewed.",
    operationId: OPERATION_ID,
    confirmation: null,
    ...overrides,
  })
}

function ownershipBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    expectedOwnerMembershipId: OWNER_MEMBERSHIP_ID,
    targetOwnerMembershipId: TARGET_MEMBERSHIP_ID,
    reason: "Appoint the active delegate as the new portal owner.",
    operationId: OPERATION_ID,
    confirmation: "TRANSFER",
    ...overrides,
  })
}

function cleanupRecoveryBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    expectedVersion: 7,
    reason: "The protected external issue was corrected and verified.",
    operationId: OPERATION_ID,
    confirmation: "RETRY_CLEANUP",
    ...overrides,
  })
}

function request(
  path: "cleanup-recovery" | "lifecycle" | "ownership",
  body: string,
  overrides: Record<string, string | null> = {},
): Request {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
    "x-trace-id": "trace-123",
    "x-vercel-forwarded-for": "203.0.113.42",
    "user-agent": "Creator Share Admin Test/1.0",
  })
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return new Request(`${ORIGIN}/api/admin/advocates/${ADVOCATE_ID}/${path}`, {
    method: "POST",
    headers,
    body,
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
})

test.describe("Creator Share advocate lifecycle route", () => {
  test("rejects cross-origin, tenant-origin, and non-JSON requests before authentication", async () => {
    const invalidHeaders: Array<Record<string, string | null>> = [
      { origin: "https://attacker.example" },
      { origin: "https://hope.creatorshare.com" },
      { origin: null },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
    ]
    for (const headers of invalidHeaders) {
      const response = await lifecycleRoute.POST(
        request("lifecycle", lifecycleBody(), headers),
        { params: Promise.resolve({ id: ADVOCATE_ID }) },
      )
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

  test("requires a Creator Share super administrator", async () => {
    authStatus = "unauthorized"
    const unauthorized = await lifecycleRoute.POST(
      request("lifecycle", lifecycleBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(unauthorized.status).toBe(401)
    expect(await json(unauthorized)).toEqual({
      ok: false,
      operationId: null,
      code: "unauthorized",
    })

    authStatus = "forbidden"
    const forbidden = await lifecycleRoute.POST(
      request("lifecycle", lifecycleBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(forbidden.status).toBe(403)
    expect(rpcCalls).toHaveLength(0)
  })

  test("submits one exact versioned and idempotent lifecycle command", async () => {
    rpcResult = {
      data: [
        {
          advocate_id: ADVOCATE_ID,
          advocate_version: 8,
          relationship_status: "suspended",
          publication_status: "suspended",
          domain_cleanup_requested: false,
        },
      ],
      error: null,
    }
    const response = await lifecycleRoute.POST(
      request("lifecycle", lifecycleBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await json(response)).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      advocateVersion: 8,
      relationshipStatus: "suspended",
      publicationStatus: "suspended",
      domainCleanupRequested: false,
    })
    expect(rpcCalls).toEqual([
      {
        name: "apply_creator_share_advocate_lifecycle_action",
        args: {
          target_advocate_id: ADVOCATE_ID,
          expected_advocate_version: 7,
          target_action: "suspend",
          change_reason: "Pause this portal while the partnership is reviewed.",
          request_id: OPERATION_ID,
          trace_id: "trace-123",
          client_ip: "203.0.113.42",
          user_agent: "Creator Share Admin Test/1.0",
        },
      },
    ])
  })

  test("rejects forbidden actions and missing archive confirmation without an RPC", async () => {
    for (const body of [
      lifecycleBody({ action: "force_publish" }),
      lifecycleBody({ action: "unarchive" }),
      lifecycleBody({ action: "archive", confirmation: null }),
      lifecycleBody({ providerId: "must-not-cross" }),
    ]) {
      const response = await lifecycleRoute.POST(request("lifecycle", body), {
        params: Promise.resolve({ id: ADVOCATE_ID }),
      })
      expect(response.status).toBe(400)
    }
    expect(rpcCalls).toHaveLength(0)
  })

  test("maps database failures without leaking details", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "40001",
        providerError: "private provider payload",
      } as never,
    }
    const response = await lifecycleRoute.POST(
      request("lifecycle", lifecycleBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(response.status).toBe(409)
    const payload = await json(response)
    expect(payload).toEqual({
      ok: false,
      operationId: OPERATION_ID,
      code: "lifecycle_conflict",
    })
    expect(JSON.stringify(payload)).not.toMatch(/provider|payload/i)
  })

  test("treats terminal lifecycle ineligibility as a conflict", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "55000",
        details: "private topology state",
      } as never,
    }
    const response = await lifecycleRoute.POST(
      request("lifecycle", lifecycleBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(response.status).toBe(409)
    const payload = await json(response)
    expect(payload).toEqual({
      ok: false,
      operationId: OPERATION_ID,
      code: "lifecycle_conflict",
    })
    expect(JSON.stringify(payload)).not.toMatch(/topology|details|private/i)
  })
})

test.describe("Creator Share advocate cleanup recovery route", () => {
  test("rejects untrusted requests before authentication", async () => {
    for (const headers of [
      { origin: "https://attacker.example" },
      { origin: "https://hope.creatorshare.com" },
      { origin: null },
      { "content-type": "text/plain" },
    ] as Array<Record<string, string | null>>) {
      const response = await cleanupRecoveryRoute.POST(
        request("cleanup-recovery", cleanupRecoveryBody(), headers),
        { params: Promise.resolve({ id: ADVOCATE_ID }) },
      )
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

  test("requires a super administrator and an exact provider-free request", async () => {
    authStatus = "forbidden"
    const forbidden = await cleanupRecoveryRoute.POST(
      request("cleanup-recovery", cleanupRecoveryBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(forbidden.status).toBe(403)
    expect(rpcCalls).toHaveLength(0)

    authStatus = "ok"
    for (const body of [
      cleanupRecoveryBody({ confirmation: "RETRY" }),
      cleanupRecoveryBody({ provider: "cloudflare" }),
      cleanupRecoveryBody({ jobId: TARGET_MEMBERSHIP_ID }),
    ]) {
      const response = await cleanupRecoveryRoute.POST(
        request("cleanup-recovery", body),
        { params: Promise.resolve({ id: ADVOCATE_ID }) },
      )
      expect(response.status).toBe(400)
    }
    expect(rpcCalls).toHaveLength(0)
  })

  test("submits one exact versioned cleanup recovery command", async () => {
    rpcResult = {
      data: [
        {
          advocate_id: ADVOCATE_ID,
          advocate_version: 8,
          cleanup_phase: "cloudflare_dns_removal",
          cleanup_retry_requested: true,
        },
      ],
      error: null,
    }
    const response = await cleanupRecoveryRoute.POST(
      request("cleanup-recovery", cleanupRecoveryBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(response.status).toBe(200)
    const payload = await json(response)
    expect(payload).toEqual({
      ok: true,
      operationId: OPERATION_ID,
      advocateVersion: 8,
      cleanupPhase: "cloudflare_dns_removal",
      cleanupRetryRequested: true,
    })
    expect(rpcCalls).toEqual([
      {
        name: "retry_creator_share_advocate_cleanup",
        args: {
          target_advocate_id: ADVOCATE_ID,
          expected_advocate_version: 7,
          change_reason:
            "The protected external issue was corrected and verified.",
          request_id: OPERATION_ID,
          trace_id: "trace-123",
          client_ip: "203.0.113.42",
          user_agent: "Creator Share Admin Test/1.0",
        },
      },
    ])
    expect(JSON.stringify(payload)).not.toMatch(/job|identifier|payload/i)
  })

  test("maps stale or ineligible recovery to one static conflict", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "55000",
        details: "private provider topology",
      } as never,
    }
    const response = await cleanupRecoveryRoute.POST(
      request("cleanup-recovery", cleanupRecoveryBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(response.status).toBe(409)
    const payload = await json(response)
    expect(payload).toEqual({
      ok: false,
      operationId: OPERATION_ID,
      code: "cleanup_recovery_conflict",
    })
    expect(JSON.stringify(payload)).not.toMatch(/provider|topology|details/i)
  })
})

test.describe("Creator Share advocate ownership route", () => {
  test("rejects cross-origin, tenant-origin, and non-JSON requests before authentication", async () => {
    const invalidHeaders: Array<Record<string, string | null>> = [
      { origin: "https://attacker.example" },
      { origin: "https://hope.creatorshare.com" },
      { origin: null },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
    ]
    for (const headers of invalidHeaders) {
      const response = await ownershipRoute.POST(
        request("ownership", ownershipBody(), headers),
        { params: Promise.resolve({ id: ADVOCATE_ID }) },
      )
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

  test("requires a Creator Share super administrator", async () => {
    authStatus = "unauthorized"
    const unauthorized = await ownershipRoute.POST(
      request("ownership", ownershipBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(unauthorized.status).toBe(401)
    expect(await json(unauthorized)).toEqual({
      ok: false,
      operationId: null,
      code: "unauthorized",
    })

    authStatus = "forbidden"
    const forbidden = await ownershipRoute.POST(
      request("ownership", ownershipBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(forbidden.status).toBe(403)
    expect(await json(forbidden)).toEqual({
      ok: false,
      operationId: null,
      code: "forbidden",
    })
    expect(rpcCalls).toHaveLength(0)
  })

  test("rejects malformed and identity-bearing bodies without an RPC", async () => {
    for (const body of [
      "{",
      ownershipBody({ confirmation: "YES" }),
      ownershipBody({ targetAuthUserId: TARGET_MEMBERSHIP_ID }),
      ownershipBody({ reason: " padded " }),
    ]) {
      const response = await ownershipRoute.POST(request("ownership", body), {
        params: Promise.resolve({ id: ADVOCATE_ID }),
      })
      expect(response.status).toBe(400)
      expect(await json(response)).toEqual({
        ok: false,
        operationId: null,
        code: "invalid_request",
      })
    }
    expect(rpcCalls).toHaveLength(0)
  })

  test("transfers by tenant membership identifiers only", async () => {
    rpcResult = { data: ADVOCATE_ID, error: null }
    const response = await ownershipRoute.POST(
      request("ownership", ownershipBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(response.status).toBe(200)
    const payload = await json(response)
    expect(payload).toEqual({
      ok: true,
      operationId: OPERATION_ID,
    })
    expect(rpcCalls).toEqual([
      {
        name: "transfer_creator_share_advocate_ownership",
        args: {
          target_advocate_id: ADVOCATE_ID,
          expected_owner_membership_id: OWNER_MEMBERSHIP_ID,
          target_owner_membership_id: TARGET_MEMBERSHIP_ID,
          change_reason: "Appoint the active delegate as the new portal owner.",
          request_id: OPERATION_ID,
          trace_id: "trace-123",
          client_ip: "203.0.113.42",
          user_agent: "Creator Share Admin Test/1.0",
        },
      },
    ])
    expect(JSON.stringify(payload)).not.toMatch(
      /auth_user|email|contact|provider/i,
    )
  })

  test("requires explicit transfer confirmation and maps stale ownership", async () => {
    const invalid = await ownershipRoute.POST(
      request("ownership", ownershipBody({ confirmation: "YES" })),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(invalid.status).toBe(400)
    expect(rpcCalls).toHaveLength(0)

    rpcResult = { data: null, error: { code: "23503" } }
    const conflict = await ownershipRoute.POST(
      request("ownership", ownershipBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(conflict.status).toBe(409)
    expect(await json(conflict)).toEqual({
      ok: false,
      operationId: OPERATION_ID,
      code: "ownership_conflict",
    })
  })
})
