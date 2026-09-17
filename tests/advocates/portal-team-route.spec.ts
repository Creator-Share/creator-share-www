import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RouteModule =
  typeof import("../../src/app/api/portal/[slug]/team/members/[membershipId]/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333"
const ORIGIN = "https://creatorshare.com"

let currentUser: { id: string } | null = { id: ACTOR_ID }
let accessPermissions = [
  "portal.members.manage",
  "portal.members.view",
  "portal.view",
]
let accessRows: unknown = []
let mutationResult: {
  data: unknown
  error: { code?: string } | null
} = { data: 8, error: null }
let createClientCalls = 0
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
            if (
              name === "replace_advocate_member_roles" ||
              name === "change_advocate_member_status"
            ) {
              return mutationResult
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
  resolve(process.cwd(), "tests/advocates/portal-team-route.spec.ts"),
)
const { PATCH } = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/portal/[slug]/team/members/[membershipId]/route.ts",
  ),
) as RouteModule
nodeModule._load = originalModuleLoad

function roleBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    action: "replace_roles",
    expectedVersion: 7,
    roleKeys: ["administrator", "brand_editor"],
    reason: "Align access with current responsibilities.",
    ...overrides,
  })
}

function statusBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    action: "change_status",
    expectedVersion: 7,
    status: "suspended",
    reason: "Pause access during a role transition.",
    ...overrides,
  })
}

function request(
  body = roleBody(),
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
  return new Request(
    `${ORIGIN}/api/portal/hope/team/members/${MEMBERSHIP_ID}`,
    {
      method: "PATCH",
      headers,
      body,
    },
  )
}

async function patch(
  requestValue: Request,
  slug = "hope",
  membershipId = MEMBERSHIP_ID,
) {
  return PATCH(requestValue, {
    params: Promise.resolve({ slug, membershipId }),
  })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

test.beforeEach(() => {
  currentUser = { id: ACTOR_ID }
  accessPermissions = [
    "portal.members.manage",
    "portal.members.view",
    "portal.view",
  ]
  accessRows = [validAccessRow()]
  mutationResult = { data: 8, error: null }
  createClientCalls = 0
  rpcCalls.length = 0
})

test.describe("advocate team member route", () => {
  test("rejects untrusted origins and content types before authentication", async () => {
    for (const headers of [
      { host: "hope.creatorshare.com" },
      { host: "evil.example", origin: "https://evil.example" },
      { origin: "https://attacker.example" },
      { origin: null },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
    ] as Array<Record<string, string | null>>) {
      const response = await patch(request(roleBody(), headers))
      expect(response.status).toBe(400)
      expect(await json(response)).toMatchObject({
        ok: false,
        code: "invalid_request",
      })
    }
    expect(createClientCalls).toBe(0)
    expect(rpcCalls).toHaveLength(0)
  })

  test("requires authentication, exact portal access, permission, and member identity", async () => {
    currentUser = null
    expect((await patch(request())).status).toBe(401)
    expect(rpcCalls).toHaveLength(0)

    currentUser = { id: ACTOR_ID }
    expect((await patch(request(), "other")).status).toBe(404)

    accessPermissions = ["portal.members.view", "portal.view"]
    accessRows = [validAccessRow()]
    expect((await patch(request())).status).toBe(403)

    accessPermissions = [
      "portal.members.manage",
      "portal.members.view",
      "portal.view",
    ]
    accessRows = [validAccessRow()]
    expect((await patch(request(), "hope", "not-a-uuid")).status).toBe(404)
    expect(
      rpcCalls.filter(
        (call) =>
          call.name === "replace_advocate_member_roles" ||
          call.name === "change_advocate_member_status",
      ),
    ).toHaveLength(0)
  })

  test("rejects malformed and oversized bodies before mutation", async () => {
    for (const body of [
      "{}",
      roleBody({ roleKeys: ["owner"] }),
      roleBody({ expectedVersion: 0 }),
      roleBody({ reason: "" }),
      statusBody({ status: "invited" }),
    ]) {
      expect((await patch(request(body))).status).toBe(400)
    }

    const oversized = request("x".repeat(8_193), {
      "content-length": "8193",
    })
    expect((await patch(oversized)).status).toBe(400)
    expect(
      rpcCalls.filter(
        (call) =>
          call.name === "replace_advocate_member_roles" ||
          call.name === "change_advocate_member_status",
      ),
    ).toHaveLength(0)
  })

  test("persists exact version-fenced role and lifecycle mutations", async () => {
    const roles = await patch(request())
    expect(roles.status).toBe(200)
    expect(await json(roles)).toMatchObject({
      ok: true,
      membershipVersion: 8,
    })
    expect(rpcCalls.at(-1)).toEqual({
      name: "replace_advocate_member_roles",
      input: {
        target_advocate_id: ADVOCATE_ID,
        target_membership_id: MEMBERSHIP_ID,
        expected_membership_version: 7,
        target_role_keys: ["administrator", "brand_editor"],
        change_reason: "Align access with current responsibilities.",
        request_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        trace_id: null,
        session_id: null,
      },
    })

    const status = await patch(
      request(statusBody(), { "x-trace-id": "trace-123" }),
    )
    expect(status.status).toBe(200)
    expect(await json(status)).toMatchObject({
      ok: true,
      membershipVersion: 8,
    })
    expect(rpcCalls.at(-1)).toMatchObject({
      name: "change_advocate_member_status",
      input: {
        target_advocate_id: ADVOCATE_ID,
        target_membership_id: MEMBERSHIP_ID,
        expected_membership_version: 7,
        target_status: "suspended",
        change_reason: "Pause access during a role transition.",
        trace_id: "trace-123",
        session_id: null,
      },
    })
  })

  test("maps concurrency, permission, lifecycle, and opaque failures", async () => {
    const cases = [
      ["40001", 409, "version_conflict"],
      ["42501", 403, "permission_changed"],
      ["28000", 403, "permission_changed"],
      ["22023", 400, "invalid_request"],
      ["55000", 409, "lifecycle_conflict"],
      ["23514", 409, "lifecycle_conflict"],
      ["XX000", 500, "team_update_failed"],
    ] as const

    for (const [postgresCode, status, code] of cases) {
      mutationResult = { data: null, error: { code: postgresCode } }
      const result = await patch(request())
      expect(result.status).toBe(status)
      expect(await json(result)).toMatchObject({ ok: false, code })
    }
  })

  test("fails closed when the database returns a malformed version", async () => {
    mutationResult = { data: 0, error: null }
    const response = await patch(request())
    expect(response.status).toBe(500)
    const payload = await json(response)
    expect(payload).toMatchObject({
      ok: false,
      code: "team_update_failed",
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /email|user_id|sponsor|contact/i,
    )
  })
})
