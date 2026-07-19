import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RouteModule =
  typeof import("../../src/app/api/portal/[slug]/branding/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const ORIGIN = "https://creatorshare.com"

let currentUser: { id: string } | null = { id: ACTOR_ID }
let accessPermissions = ["portal.branding.update", "portal.view"]
let accessRows: unknown = []
let updateResult: { data: unknown; error: { code?: string } | null } = {
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
            if (name === "update_advocate_branding") return updateResult
            return { data: null, error: { code: "XX000" } }
          },
        }
      },
      createServiceRoleClient() {
        serviceClientCalls += 1
        return {
          async rpc(name: string, input?: unknown) {
            rpcCalls.push({ name, input })
            if (name === "update_advocate_branding") return updateResult
            return { data: null, error: { code: "XX000" } }
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/portal-branding-route.spec.ts"),
)
const { POST } = testRequire(
  resolve(process.cwd(), "src/app/api/portal/[slug]/branding/route.ts"),
) as RouteModule
nodeModule._load = originalModuleLoad

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    expectedVersion: 7,
    primaryColor: "#1C3C8C",
    accentColor: "#F4B942",
    logoStoragePath: null,
    logoAltText: null,
    openingHeaderHtml: "<h2>Welcome</h2>",
    aboutBiographyHtml: "<p>We help families.</p>",
    changeReason: "Refresh the advocate portal branding.",
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
  return new Request(`${ORIGIN}/api/portal/hope/branding`, {
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
  accessPermissions = ["portal.branding.update", "portal.view"]
  accessRows = [validAccessRow()]
  updateResult = { data: 8, error: null }
  createClientCalls = 0
  serviceClientCalls = 0
  rpcCalls.length = 0
})

test.describe("advocate portal branding route", () => {
  test("rejects cross-origin and non-JSON requests before authentication", async () => {
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
    expect(serviceClientCalls).toBe(0)
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

  test("conceals inaccessible slugs and denies a read-only member", async () => {
    expect((await post(request(), "other")).status).toBe(404)

    accessPermissions = ["portal.view"]
    accessRows = [validAccessRow()]
    const denied = await post(request())
    expect(denied.status).toBe(403)
    expect(await json(denied)).toMatchObject({ ok: false, code: "forbidden" })
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "get_my_advocate_portal_access",
      "get_my_advocate_portal_access",
    ])
  })

  test("rejects malformed and oversized updates without calling the mutation", async () => {
    const malformed = await post(
      request(validBody({ unexpected: "must not cross" })),
    )
    expect(malformed.status).toBe(400)

    const oversized = await post(
      request("x".repeat(40_961), { "content-length": "40961" }),
    )
    expect(oversized.status).toBe(400)
    expect(
      rpcCalls.filter((call) => call.name === "update_advocate_branding"),
    ).toHaveLength(0)
  })

  test("persists one canonical version-fenced update and returns no settings", async () => {
    const response = await post(request())
    expect(response.status).toBe(200)
    const payload = await json(response)
    expect(payload).toMatchObject({
      ok: true,
      advocateVersion: 8,
    })
    expect(payload.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(Object.keys(payload).sort()).toEqual([
      "advocateVersion",
      "ok",
      "requestId",
    ])
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "get_my_advocate_portal_access",
      "update_advocate_branding",
    ])
    expect(rpcCalls[1].input).toMatchObject({
      target_advocate_id: ADVOCATE_ID,
      target_actor_user_id: ACTOR_ID,
      expected_advocate_version: 7,
      target_opening_header_html: "<h2>Welcome</h2>",
      target_logo_storage_path: null,
      target_logo_upload_reservation_id: null,
    })
    expect(serviceClientCalls).toBe(1)
  })

  test("maps stale writes and database failures without leaking details", async () => {
    updateResult = {
      data: null,
      error: { code: "40001", sensitive: "other tenant state" } as never,
    }
    const stale = await post(request())
    expect(stale.status).toBe(409)
    expect(await json(stale)).toMatchObject({
      ok: false,
      code: "version_conflict",
    })

    updateResult = { data: null, error: { code: "XX000" } }
    const failed = await post(request())
    expect(failed.status).toBe(500)
    expect(await json(failed)).toMatchObject({
      ok: false,
      code: "branding_update_failed",
    })
  })
})
