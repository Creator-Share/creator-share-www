import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type IssueRouteModule =
  typeof import("../../src/app/api/portal/[slug]/team/invitations/route")
type RevokeRouteModule =
  typeof import("../../src/app/api/portal/[slug]/team/invitations/[invitationId]/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const INVITATION_ID = "33333333-3333-4333-8333-333333333333"
const OUTBOX_ID = "44444444-4444-4444-8444-444444444444"
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555"
const ORIGIN = "https://creatorshare.com"
const ORIGINAL_VERCEL = process.env.VERCEL
const ORIGINAL_CRYPTO_SECRET = process.env.SPONSORSHIP_CRYPTO_SECRET_V1

let currentUser: { id: string } | null = { id: ACTOR_ID }
let accessPermissions = [
  "portal.members.invite",
  "portal.members.view",
  "portal.view",
]
let serviceResult: { data: unknown; error: { code?: string } | null } = {
  data: null,
  error: null,
}
let pendingRows: unknown = []
let createClientCalls = 0
let createServiceClientCalls = 0
let createClientFailure = false
const authRpcCalls: Array<{ name: string; input: unknown }> = []
const serviceRpcCalls: Array<{ name: string; input: unknown }> = []

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

function pendingRow() {
  return {
    invitation_id: INVITATION_ID,
    invited_email: "delegate@example.com",
    role_keys: ["analytics_viewer", "brand_editor"],
    invitation_status: "pending",
    expires_at: "2026-07-25T12:00:00+00:00",
    created_at: "2026-07-18T12:00:00+00:00",
    created_by_current_user: true,
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
        if (createClientFailure) throw new Error("client unavailable")
        return {
          auth: {
            async getUser() {
              return { data: { user: currentUser } }
            },
          },
          async rpc(name: string, input?: unknown) {
            authRpcCalls.push({ name, input })
            if (name === "get_my_advocate_portal_access") {
              return { data: [validAccessRow()], error: null }
            }
            if (name === "get_advocate_pending_invitations") {
              return { data: pendingRows, error: null }
            }
            return { data: null, error: { code: "XX000" } }
          },
        }
      },
      createServiceRoleClient() {
        createServiceClientCalls += 1
        return {
          async rpc(name: string, input?: unknown) {
            serviceRpcCalls.push({ name, input })
            return serviceResult
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/portal-invitation-route.spec.ts"),
)
const { POST } = testRequire(
  resolve(process.cwd(), "src/app/api/portal/[slug]/team/invitations/route.ts"),
) as IssueRouteModule
const { DELETE } = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/portal/[slug]/team/invitations/[invitationId]/route.ts",
  ),
) as RevokeRouteModule
nodeModule._load = originalModuleLoad

function issueBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    email: "Delegate@Example.com",
    roleKeys: ["brand_editor", "analytics_viewer"],
    reason: "Provide reporting and brand access.",
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  })
}

function request(
  path: string,
  method: "POST" | "DELETE",
  body: string,
  headerOverrides: Record<string, string | null> = {},
) {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
    "x-vercel-id": "sfo1::trace-123",
  })
  for (const [name, value] of Object.entries(headerOverrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return new Request(`${ORIGIN}${path}`, { method, headers, body })
}

async function post(requestValue: Request, slug = "hope"): Promise<Response> {
  return POST(requestValue, { params: Promise.resolve({ slug }) })
}

async function remove(
  requestValue: Request,
  slug = "hope",
  invitationId = INVITATION_ID,
): Promise<Response> {
  return DELETE(requestValue, {
    params: Promise.resolve({ slug, invitationId }),
  })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

test.beforeAll(() => {
  process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = Buffer.alloc(32, 0x41).toString(
    "base64",
  )
  process.env.VERCEL = "1"
})

test.afterAll(() => {
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL
  else process.env.VERCEL = ORIGINAL_VERCEL
  if (ORIGINAL_CRYPTO_SECRET === undefined) {
    delete process.env.SPONSORSHIP_CRYPTO_SECRET_V1
  } else {
    process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = ORIGINAL_CRYPTO_SECRET
  }
})

test.beforeEach(() => {
  currentUser = { id: ACTOR_ID }
  accessPermissions = [
    "portal.members.invite",
    "portal.members.view",
    "portal.view",
  ]
  serviceResult = {
    data: [
      {
        invitation_id: INVITATION_ID,
        outbox_id: OUTBOX_ID,
        expires_at: "2026-07-25T12:00:00+00:00",
        created: true,
      },
    ],
    error: null,
  }
  pendingRows = [pendingRow()]
  createClientCalls = 0
  createServiceClientCalls = 0
  createClientFailure = false
  authRpcCalls.length = 0
  serviceRpcCalls.length = 0
})

test.describe("advocate invitation administration routes", () => {
  test("rejects untrusted requests before authentication or service access", async () => {
    for (const headers of [
      { host: "hope.creatorshare.com" },
      { host: "evil.example", origin: "https://evil.example" },
      { origin: "https://attacker.example" },
      { origin: null },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
    ] as Array<Record<string, string | null>>) {
      const response = await post(
        request(
          "/api/portal/hope/team/invitations",
          "POST",
          issueBody(),
          headers,
        ),
      )
      expect(response.status).toBe(400)
    }
    expect(createClientCalls).toBe(0)
    expect(createServiceClientCalls).toBe(0)
  })

  test("contains authenticated client construction failures behind generic responses", async () => {
    createClientFailure = true
    const issueResponse = await post(
      request("/api/portal/hope/team/invitations", "POST", issueBody()),
    )
    expect(issueResponse.status).toBe(500)
    expect(await json(issueResponse)).toMatchObject({
      ok: false,
      code: "invitation_failed",
    })

    const revokeResponse = await remove(
      request(
        `/api/portal/hope/team/invitations/${INVITATION_ID}`,
        "DELETE",
        JSON.stringify({ reason: "Access no longer needed." }),
      ),
    )
    expect(revokeResponse.status).toBe(500)
    expect(await json(revokeResponse)).toMatchObject({
      ok: false,
      code: "invitation_revoke_failed",
    })
    expect(createServiceClientCalls).toBe(0)
  })

  test("requires authenticated invitation permission and exact input", async () => {
    currentUser = null
    expect(
      (
        await post(
          request("/api/portal/hope/team/invitations", "POST", issueBody()),
        )
      ).status,
    ).toBe(401)

    currentUser = { id: ACTOR_ID }
    accessPermissions = ["portal.members.view", "portal.view"]
    expect(
      (
        await post(
          request("/api/portal/hope/team/invitations", "POST", issueBody()),
        )
      ).status,
    ).toBe(403)

    accessPermissions = [
      "portal.members.invite",
      "portal.members.view",
      "portal.view",
    ]
    for (const body of [
      "{}",
      issueBody({ email: "invalid" }),
      issueBody({ roleKeys: ["owner"] }),
      issueBody({ reason: "" }),
    ]) {
      expect(
        (await post(request("/api/portal/hope/team/invitations", "POST", body)))
          .status,
      ).toBe(400)
    }
    expect(createServiceClientCalls).toBe(0)
  })

  test("queues encrypted single-use delivery and returns only a safe projection", async () => {
    const response = await post(
      request("/api/portal/hope/team/invitations", "POST", issueBody()),
    )
    expect(response.status).toBe(201)
    const payload = await json(response)
    expect(payload).toMatchObject({
      ok: true,
      created: true,
      invitation: {
        invitationId: INVITATION_ID,
        invitedEmail: "delegate@example.com",
        roleKeys: ["analytics_viewer", "brand_editor"],
        status: "pending",
      },
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /capability|token|ciphertext|digest|outbox|provider|auth_user/i,
    )

    const issueCall = serviceRpcCalls[0]
    expect(issueCall.name).toBe("issue_advocate_invitation_email")
    expect(issueCall.input).toMatchObject({
      target_advocate_id: ADVOCATE_ID,
      acting_user_id: ACTOR_ID,
      invited_email: "delegate@example.com",
      role_keys: ["analytics_viewer", "brand_editor"],
      idempotency_key: IDEMPOTENCY_KEY,
      change_reason: "Provide reporting and brand access.",
      request_id: expect.any(String),
      trace_id: "sfo1::trace-123",
    })
    const delivery = issueCall.input as Record<string, unknown>
    expect(delivery.capability_digest).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(delivery.recipient_email_hmac).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(delivery.recipient_email_ciphertext).toMatch(/^\\x[0-9a-f]{64,}$/)
    expect(delivery.secret_payload_ciphertext).toMatch(/^\\x[0-9a-f]{64,}$/)
    expect(authRpcCalls.at(-1)).toEqual({
      name: "get_advocate_pending_invitations",
      input: { target_advocate_id: ADVOCATE_ID },
    })
  })

  test("preserves idempotent replay semantics and maps database failures", async () => {
    serviceResult = {
      data: [
        {
          invitation_id: INVITATION_ID,
          outbox_id: OUTBOX_ID,
          expires_at: "2026-07-25T12:00:00+00:00",
          created: false,
        },
      ],
      error: null,
    }
    const replay = await post(
      request("/api/portal/hope/team/invitations", "POST", issueBody()),
    )
    expect(replay.status).toBe(200)
    expect(await json(replay)).toMatchObject({ ok: true, created: false })

    for (const [postgresCode, status, code] of [
      ["42501", 403, "permission_changed"],
      ["22023", 400, "invalid_request"],
      ["23505", 409, "invitation_conflict"],
      ["55000", 409, "lifecycle_conflict"],
      ["XX000", 500, "invitation_failed"],
    ] as const) {
      serviceResult = { data: null, error: { code: postgresCode } }
      const response = await post(
        request("/api/portal/hope/team/invitations", "POST", issueBody()),
      )
      expect(response.status).toBe(status)
      expect(await json(response)).toMatchObject({ ok: false, code })
    }
  })

  test("revokes an exact invitation with an audited reason", async () => {
    serviceResult = { data: true, error: null }
    const response = await remove(
      request(
        `/api/portal/hope/team/invitations/${INVITATION_ID}`,
        "DELETE",
        JSON.stringify({ reason: "Delegate no longer needs access." }),
      ),
    )
    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({ ok: true, revoked: true })
    expect(serviceRpcCalls).toEqual([
      {
        name: "revoke_advocate_invitation",
        input: expect.objectContaining({
          target_advocate_id: ADVOCATE_ID,
          target_invitation_id: INVITATION_ID,
          acting_user_id: ACTOR_ID,
          change_reason: "Delegate no longer needs access.",
        }),
      },
    ])

    expect(
      (
        await remove(
          request(
            `/api/portal/hope/team/invitations/not-a-uuid`,
            "DELETE",
            JSON.stringify({ reason: "No access." }),
          ),
          "hope",
          "not-a-uuid",
        )
      ).status,
    ).toBe(404)
  })
})
