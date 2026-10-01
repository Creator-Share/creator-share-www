import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RouteModule =
  typeof import("../../src/app/api/portal/[slug]/public-metrics/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const ORIGIN = "https://creatorshare.com"

let currentUser: { id: string } | null = { id: ACTOR_ID }
let accessPermissions = ["portal.public_metrics.update", "portal.view"]
let accessRows: unknown = []
let updateResult: {
  data: unknown
  error: { code?: string; message?: string } | null
} = {
  data: 8,
  error: null,
}
let createClientCalls = 0
let serviceClientCalls = 0
const rpcCalls: Array<{ name: string; input: unknown }> = []

function validAccessRow() {
  return {
    advocate_id: ADVOCATE_ID,
    slug: "hope",
    display_name: "Hope Creates",
    relationship_status: "active",
    publication_status: "active",
    beneficiary_mode: "all",
    advocate_version: 7,
    canonical_hostname: "hope.creatorshare.com",
    domain_status: "active",
    permissions: [...accessPermissions].sort(),
  }
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
        return {
          auth: {
            async getUser() {
              return { data: { user: currentUser } }
            },
          },
          async rpc(name: string, input?: unknown) {
            rpcCalls.push({ name, input })
            if (name === "get_my_advocate_portal_access") {
              return { data: accessRows, error: null }
            }
            return { data: null, error: { code: "XX000" } }
          },
        }
      },
      createServiceRoleClient() {
        serviceClientCalls += 1
        return {
          async rpc(name: string, input?: unknown) {
            rpcCalls.push({ name, input })
            if (name === "replace_advocate_public_metrics") {
              return updateResult
            }
            return { data: null, error: { code: "XX000" } }
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/portal-public-metrics-route.spec.ts"),
)
const { POST } = testRequire(
  resolve(process.cwd(), "src/app/api/portal/[slug]/public-metrics/route.ts"),
) as RouteModule
nodeModule._load = originalModuleLoad

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    expectedVersion: 7,
    metricKeys: [
      "gross_raised_usd",
      "children_sponsored",
      "direct_sponsorships",
    ],
    changeReason: "Put public impact totals in the requested order.",
    ...overrides,
  })
}

function request(
  body = validBody(),
  headerOverrides: Record<string, string | null> = {},
) {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
  })
  for (const [name, value] of Object.entries(headerOverrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return new Request(`${ORIGIN}/api/portal/hope/public-metrics`, {
    method: "POST",
    headers,
    body,
  })
}

async function post(requestValue: Request, slug = "hope") {
  return POST(requestValue, { params: Promise.resolve({ slug }) })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

test.beforeEach(() => {
  currentUser = { id: ACTOR_ID }
  accessPermissions = ["portal.public_metrics.update", "portal.view"]
  accessRows = [validAccessRow()]
  updateResult = { data: 8, error: null }
  createClientCalls = 0
  serviceClientCalls = 0
  rpcCalls.length = 0
})

test.describe("advocate portal public metrics route", () => {
  test("rejects cross origin and non JSON requests before authentication", async () => {
    const invalidHeaders: Array<Record<string, string | null>> = [
      { origin: "https://attacker.example" },
      { origin: "https://hope.creatorshare.com" },
      { origin: null },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
    ]
    for (const headers of invalidHeaders) {
      const response = await post(request(validBody(), headers))
      expect(response.status).toBe(400)
      expect(await json(response)).toMatchObject({
        ok: false,
        code: "invalid_request",
      })
    }
    expect(createClientCalls).toBe(0)
    expect(serviceClientCalls).toBe(0)
    expect(rpcCalls).toHaveLength(0)
  })

  test("requires an authenticated account", async () => {
    currentUser = null
    const response = await post(request())
    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "unauthorized",
    })
    expect(rpcCalls).toHaveLength(0)
  })

  test("conceals inaccessible slugs and denies members without update permission", async () => {
    expect((await post(request(), "other")).status).toBe(404)

    accessPermissions = ["portal.view"]
    accessRows = [validAccessRow()]
    const denied = await post(request())
    expect(denied.status).toBe(403)
    expect(await json(denied)).toMatchObject({ ok: false, code: "forbidden" })
    expect(
      rpcCalls.filter(
        (call) => call.name === "replace_advocate_public_metrics",
      ),
    ).toHaveLength(0)
  })

  test("rejects extra fields, forbidden keys, duplicates, invalid notes, and oversized bodies", async () => {
    const invalidBodies = [
      validBody({ requestId: "browser-controlled" }),
      validBody({ metricKeys: ["net_raised_usd"] }),
      validBody({
        metricKeys: ["children_sponsored", "children_sponsored"],
      }),
      validBody({ changeReason: "   " }),
      validBody({ changeReason: "x".repeat(501) }),
    ]
    for (const body of invalidBodies) {
      const response = await post(request(body))
      expect(response.status).toBe(400)
      expect(await json(response)).toMatchObject({
        ok: false,
        code: "invalid_request",
      })
    }

    const oversized = await post(
      request("x".repeat(4_097), { "content-length": "4097" }),
    )
    expect(oversized.status).toBe(400)
    expect(
      rpcCalls.filter(
        (call) => call.name === "replace_advocate_public_metrics",
      ),
    ).toHaveLength(0)
  })

  test("persists one ordered actor aware update with server owned audit identifiers", async () => {
    const response = await post(
      request(validBody(), {
        "x-trace-id": "browser-controlled-trace",
        "x-vercel-id": "browser-controlled-proxy-id",
      }),
    )
    expect(response.status).toBe(200)
    const payload = await json(response)
    expect(Object.keys(payload).sort()).toEqual([
      "advocateVersion",
      "ok",
      "requestId",
    ])
    expect(payload).toMatchObject({ ok: true, advocateVersion: 8 })
    expect(payload.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    expect(rpcCalls.map((call) => call.name)).toEqual([
      "get_my_advocate_portal_access",
      "replace_advocate_public_metrics",
    ])
    expect(serviceClientCalls).toBe(1)
    const mutation = rpcCalls[1].input as Record<string, unknown>
    expect(mutation).toMatchObject({
      target_advocate_id: ADVOCATE_ID,
      acting_user_id: ACTOR_ID,
      expected_advocate_version: 7,
      target_metric_keys: [
        "gross_raised_usd",
        "children_sponsored",
        "direct_sponsorships",
      ],
      change_reason: "Put public impact totals in the requested order.",
      request_id: payload.requestId,
      session_id: null,
    })
    expect(mutation.trace_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(mutation.trace_id).not.toBe("browser-controlled-trace")
    expect(Object.keys(mutation).sort()).toEqual([
      "acting_user_id",
      "change_reason",
      "expected_advocate_version",
      "request_id",
      "session_id",
      "target_advocate_id",
      "target_metric_keys",
      "trace_id",
    ])
  })

  test("maps no change, stale, and database failures without detail leakage", async () => {
    updateResult = {
      data: null,
      error: {
        code: "22023",
        message: "Public metric selection is unchanged",
      },
    }
    const unchanged = await post(request())
    expect(unchanged.status).toBe(409)
    expect(await json(unchanged)).toMatchObject({
      ok: false,
      code: "no_change",
    })

    updateResult = {
      data: null,
      error: {
        code: "40001",
        message: "Advocate settings changed; refresh and retry",
        sensitive: "other tenant state",
      } as never,
    }
    const stale = await post(request())
    expect(stale.status).toBe(409)
    const staleBody = await json(stale)
    expect(staleBody).toMatchObject({
      ok: false,
      code: "version_conflict",
    })
    expect(Object.keys(staleBody).sort()).toEqual(["code", "ok", "requestId"])

    updateResult = {
      data: null,
      error: { code: "XX000", sensitive: "provider secret" } as never,
    }
    const failed = await post(request())
    expect(failed.status).toBe(500)
    const failedBody = await json(failed)
    expect(failedBody).toMatchObject({
      ok: false,
      code: "public_metrics_update_failed",
    })
    expect(JSON.stringify(failedBody)).not.toMatch(
      /sensitive|tenant state|provider secret/i,
    )
  })
})
