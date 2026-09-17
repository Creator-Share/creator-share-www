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
type PublicationRouteModule =
  typeof import("../../src/app/api/admin/advocates/[id]/publish/route")
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
const CANARY_RUN_ID = "66666666-6666-4666-8666-666666666666"
const DEPLOYMENT_CAPABILITY_ID = "77777777-7777-4777-8777-777777777777"
const ORIGIN = "https://creatorshare.com"
const DEPLOYMENT_ID = "dpl_1234567890abcdef"
const REVISION = "a".repeat(40)

let authStatus: "ok" | "unauthorized" | "forbidden" = "ok"
let createClientCalls = 0
let createServiceRoleClientCalls = 0
let rpcResult: { data: unknown; error: { code?: string } | null } = {
  data: null,
  error: null,
}
const rpcCalls: Array<{ name: string; args: unknown }> = []
const rpcResultsByName = new Map<
  string,
  { data: unknown; error: { code?: string } | null }
>()

const client = {
  async rpc(name: string, args: unknown) {
    rpcCalls.push({ name, args })
    return rpcResultsByName.get(name) ?? rpcResult
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
      createServiceRoleClient() {
        createServiceRoleClientCalls += 1
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
const publicationRoute = testRequire(
  resolve(process.cwd(), "src/app/api/admin/advocates/[id]/publish/route.ts"),
) as PublicationRouteModule
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

function publicationBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    expectedVersion: 7,
    operationId: OPERATION_ID,
    adminReason: "Approve the verified production release for this portal.",
    ...overrides,
  })
}

function request(
  path: "cleanup-recovery" | "lifecycle" | "ownership" | "publish",
  body: string,
  overrides: Record<string, string | null> = {},
): Request {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
    "x-vercel-id": "trace-123",
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
  createServiceRoleClientCalls = 0
  rpcCalls.length = 0
  rpcResultsByName.clear()
  rpcResult = { data: null, error: null }
})

test.describe("Creator Share advocate publication route", () => {
  test("rejects untrusted requests before authentication", async () => {
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
      const headers = new Headers({
        host: "creatorshare.com",
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json; charset=utf-8",
      })
      for (const [name, value] of Object.entries(overrides)) {
        if (value === null) headers.delete(name)
        else headers.set(name, value)
      }
      const response = await publicationRoute.POST(
        new Request(`${ORIGIN}/api/admin/advocates/${ADVOCATE_ID}/publish`, {
          method: "POST",
          headers,
          body: "{}",
        }),
        { params: Promise.resolve({ id: ADVOCATE_ID }) },
      )

      expect(response.status).toBe(400)
      expect(await json(response)).toEqual({
        ok: false,
        code: "invalid_request",
        operationId: null,
      })
    }
    expect(createClientCalls).toBe(0)
  })

  test("normalizes authentication failures without losing operation correlation", async () => {
    authStatus = "unauthorized"
    const unauthorized = await publicationRoute.POST(
      request("publish", publicationBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get("cache-control")).toContain("no-store")
    expect(unauthorized.headers.get("pragma")).toBe("no-cache")
    expect(await json(unauthorized)).toEqual({
      ok: false,
      code: "unauthorized",
      operationId: OPERATION_ID,
    })

    authStatus = "forbidden"
    const forbidden = await publicationRoute.POST(
      request("publish", publicationBody()),
      { params: Promise.resolve({ id: ADVOCATE_ID }) },
    )
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get("cache-control")).toContain("no-store")
    expect(forbidden.headers.get("pragma")).toBe("no-cache")
    expect(await json(forbidden)).toEqual({
      ok: false,
      code: "forbidden",
      operationId: OPERATION_ID,
    })
    expect(rpcCalls).toHaveLength(0)
    expect(createServiceRoleClientCalls).toBe(0)
  })

  test("recovers an immutable published receipt through the authenticated database boundary", async () => {
    const priorEnvironment = {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
      VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    }
    Object.assign(process.env, {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
      VERCEL_GIT_COMMIT_SHA: REVISION,
    })
    rpcResult = {
      data: [
        {
          operation_id: OPERATION_ID,
          run_id: CANARY_RUN_ID,
          advocate_id: ADVOCATE_ID,
          expected_advocate_version: 7,
          deployment_id: "dpl_original123456",
          revision: "b".repeat(40),
          started_at: "2026-07-19T18:00:00.000Z",
          outcome: "succeeded",
          failure_code: null,
          report_sha256: `\\x${"c".repeat(64)}`,
          completed_at: "2026-07-19T18:01:00.000Z",
          published_advocate_version: 8,
          created: false,
        },
      ],
      error: null,
    }

    try {
      const published = await publicationRoute.POST(
        request("publish", publicationBody()),
        { params: Promise.resolve({ id: ADVOCATE_ID }) },
      )
      expect(published.status).toBe(200)
      expect(published.headers.get("cache-control")).toContain("no-store")
      expect(published.headers.get("pragma")).toBe("no-cache")
      expect(await json(published)).toEqual({
        ok: true,
        code: "publication_committed",
        operationId: OPERATION_ID,
        runId: CANARY_RUN_ID,
        advocateVersion: 8,
      })
      expect(rpcCalls).toEqual([
        {
          name: "begin_or_resume_advocate_publication_canary",
          args: {
            target_advocate_id: ADVOCATE_ID,
            target_expected_advocate_version: 7,
            target_operation_id: OPERATION_ID,
            target_deployment_id: DEPLOYMENT_ID,
            target_git_revision: REVISION,
            target_trace_id: "trace-123",
            target_admin_reason:
              "Approve the verified production release for this portal.",
            target_client_ip: "203.0.113.42",
            target_user_agent: "Creator Share Admin Test/1.0",
          },
        },
      ])
      expect(createServiceRoleClientCalls).toBe(0)
    } finally {
      for (const [name, value] of Object.entries(priorEnvironment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  test("returns a fixed terminal result without scheduling another worker", async () => {
    const priorEnvironment = {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
      VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    }
    Object.assign(process.env, {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
      VERCEL_GIT_COMMIT_SHA: REVISION,
    })
    rpcResult = {
      data: [
        {
          operation_id: OPERATION_ID,
          run_id: CANARY_RUN_ID,
          advocate_id: ADVOCATE_ID,
          expected_advocate_version: 7,
          deployment_id: DEPLOYMENT_ID,
          revision: REVISION,
          started_at: new Date(Date.now() - 60_000).toISOString(),
          outcome: "failed",
          failure_code: "tls_exact_host_failed",
          report_sha256: `\\x${"d".repeat(64)}`,
          completed_at: new Date().toISOString(),
          published_advocate_version: null,
          created: false,
        },
      ],
      error: null,
    }

    try {
      const failed = await publicationRoute.POST(
        request("publish", publicationBody()),
        { params: Promise.resolve({ id: ADVOCATE_ID }) },
      )
      expect(failed.status).toBe(409)
      expect(await json(failed)).toEqual({
        ok: false,
        code: "publication_canary_failed",
        operationId: OPERATION_ID,
        runId: CANARY_RUN_ID,
        retryWithNewOperationId: true,
      })
      expect(createServiceRoleClientCalls).toBe(0)
    } finally {
      for (const [name, value] of Object.entries(priorEnvironment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  test("requires server deployment authority plus the authenticated administrator to publish", async () => {
    const priorEnvironment = {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
      VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    }
    Object.assign(process.env, {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
      VERCEL_GIT_COMMIT_SHA: REVISION,
    })
    const reportSha256 = "e".repeat(64)
    rpcResultsByName.set("begin_or_resume_advocate_publication_canary", {
      data: [
        {
          operation_id: OPERATION_ID,
          run_id: CANARY_RUN_ID,
          advocate_id: ADVOCATE_ID,
          expected_advocate_version: 7,
          deployment_id: DEPLOYMENT_ID,
          revision: REVISION,
          started_at: new Date(Date.now() - 60_000).toISOString(),
          outcome: "succeeded",
          failure_code: null,
          report_sha256: `\\x${reportSha256}`,
          completed_at: new Date().toISOString(),
          published_advocate_version: null,
          created: false,
        },
      ],
      error: null,
    })
    rpcResultsByName.set("mint_advocate_publication_deployment_capability", {
      data: [
        {
          deployment_capability_id: DEPLOYMENT_CAPABILITY_ID,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      error: null,
    })
    rpcResultsByName.set("publish_advocate_portal_from_canary_v2", {
      data: 8,
      error: null,
    })

    try {
      const published = await publicationRoute.POST(
        request("publish", publicationBody()),
        { params: Promise.resolve({ id: ADVOCATE_ID }) },
      )
      expect(published.status).toBe(200)
      const payload = await json(published)
      expect(payload).toEqual({
        ok: true,
        code: "publication_committed",
        operationId: OPERATION_ID,
        runId: CANARY_RUN_ID,
        advocateVersion: 8,
      })
      expect(JSON.stringify(payload)).not.toContain(DEPLOYMENT_CAPABILITY_ID)
      expect(rpcCalls.map((call) => call.name)).toEqual([
        "begin_or_resume_advocate_publication_canary",
        "mint_advocate_publication_deployment_capability",
        "publish_advocate_portal_from_canary_v2",
      ])
      expect(rpcCalls[2]?.args).toMatchObject({
        target_operation_id: OPERATION_ID,
        target_canary_run_id: CANARY_RUN_ID,
        target_deployment_id: DEPLOYMENT_ID,
        target_deployment_capability_id: DEPLOYMENT_CAPABILITY_ID,
      })
      expect(createServiceRoleClientCalls).toBe(1)
    } finally {
      for (const [name, value] of Object.entries(priorEnvironment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })
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
