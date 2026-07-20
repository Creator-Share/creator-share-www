import { createRequire } from "node:module"
import Module from "node:module"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RouteModule =
  typeof import("../../src/app/api/admin/users/invite/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ORIGIN = "https://creatorshare.com"
const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const INVITED_USER_ID = "22222222-2222-4222-8222-222222222222"
const ROLE_ONE_ID = "33333333-3333-4333-8333-333333333333"
const ROLE_TWO_ID = "44444444-4444-4444-8444-444444444444"
const CLIENT_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type IssuanceResult =
  | { status: "issued"; userId: string }
  | { status: "coalesced" | "deferred"; retryAfterSeconds: number }
  | { status: "ambiguous"; retryAfterSeconds: 3900 }
  | { status: "unavailable"; stage: "configuration" | "acquire" }
  | { status: "unavailable"; stage: "begin"; retryAfterSeconds: 3900 }

let authStatus: "ok" | "unauthorized" | "forbidden" | "throws" = "ok"
let createClientFailure = false
let createClientCalls = 0
const createClientOptions: Array<Record<string, unknown> | undefined> = []
let monotonicTimes = [0, 0]
let issuanceResult: IssuanceResult = {
  status: "issued",
  userId: INVITED_USER_ID,
}
let issuanceThrows = false
let roleCatalogData: unknown = [
  { id: ROLE_ONE_ID },
  { id: ROLE_TWO_ID },
]
let roleCatalogError: { code?: string } | null = null
let roleRpcData: unknown = [
  { role_id: ROLE_ONE_ID, role_name: "EDITOR", secret: "not public" },
  { role_id: ROLE_TWO_ID, role_name: "SUPER_ADMIN", secret: "not public" },
]
let roleRpcError: { code?: string } | null = null
const issuerCalls: Array<Record<string, unknown>> = []
const catalogCalls: Array<Record<string, unknown>> = []
const roleRpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

const client = {
  from(table: string) {
    return {
      select(columns: string) {
        return {
          async in(column: string, values: string[]) {
            catalogCalls.push({ table, columns, column, values })
            return { data: roleCatalogData, error: roleCatalogError }
          },
        }
      },
    }
  },
  async rpc(name: string, args: Record<string, unknown>) {
    roleRpcCalls.push({ name, args })
    return { data: roleRpcData, error: roleRpcError }
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
  if (request === "node:perf_hooks") {
    return {
      performance: {
        now() {
          return monotonicTimes.length > 1
            ? (monotonicTimes.shift() as number)
            : (monotonicTimes[0] ?? 0)
        },
      },
    }
  }
  if (request === "@/utils/supabase/server") {
    return {
      async createClient(options?: Record<string, unknown>) {
        createClientCalls += 1
        createClientOptions.push(options)
        if (createClientFailure) throw new Error("client unavailable")
        return client
      },
    }
  }
  if (request === "@/utils/auth/requireSuperAdmin") {
    return {
      async requireSuperAdmin() {
        if (authStatus === "throws") throw new Error("auth unavailable")
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
  if (request === "@/lib/auth/supabaseEmailProofIssuer") {
    return {
      EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS: 3900,
      EMAIL_PROOF_ISSUER_WORST_CASE_DURATION_MILLISECONDS: 42_000,
      async issueCreatorShareAdminInvitationEmailProof(
        options: Record<string, unknown>,
      ) {
        issuerCalls.push(options)
        if (issuanceThrows) throw new Error("provider payload must stay private")
        return issuanceResult
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/auth/creator-share-admin-invitation-route.spec.ts",
  ),
)
const route = testRequire(
  "../../src/app/api/admin/users/invite/route",
) as RouteModule
nodeModule._load = originalModuleLoad

function invitationBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    email: "Invitee@Example.com",
    role_ids: [ROLE_ONE_ID, ROLE_TWO_ID],
    ...overrides,
  })
}

function request(
  body: string,
  overrides: Record<string, string | null> = {},
): Request {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": CLIENT_REQUEST_ID,
    "x-vercel-id": "sfo1::admin-invitation-test",
  })
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return new Request(`${ORIGIN}/api/admin/users/invite`, {
    method: "POST",
    headers,
    body,
  })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

async function captureErrors<T>(operation: () => Promise<T>): Promise<{
  result: T
  calls: unknown[][]
}> {
  const calls: unknown[][] = []
  const original = console.error
  console.error = (...values: unknown[]) => calls.push(values)
  try {
    return { result: await operation(), calls }
  } finally {
    console.error = original
  }
}

const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
const originalVercel = process.env.VERCEL

test.beforeAll(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  process.env.VERCEL = "1"
})

test.afterAll(() => {
  if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL
  else process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl
  if (originalVercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = originalVercel
})

test.beforeEach(() => {
  authStatus = "ok"
  createClientFailure = false
  createClientCalls = 0
  createClientOptions.length = 0
  monotonicTimes = [0, 0]
  issuanceResult = { status: "issued", userId: INVITED_USER_ID }
  issuanceThrows = false
  roleCatalogData = [{ id: ROLE_ONE_ID }, { id: ROLE_TWO_ID }]
  roleCatalogError = null
  roleRpcData = [
    { role_id: ROLE_ONE_ID, role_name: "EDITOR", secret: "not public" },
    {
      role_id: ROLE_TWO_ID,
      role_name: "SUPER_ADMIN",
      secret: "not public",
    },
  ]
  roleRpcError = null
  issuerCalls.length = 0
  catalogCalls.length = 0
  roleRpcCalls.length = 0
  process.env.VERCEL = "1"
})

test.describe("Creator Share administrator invitation route", () => {
  test("declares a 120 second function and outcome-safe UI copy", () => {
    expect(route.maxDuration).toBe(120)
    const vercel = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      functions: Record<string, { maxDuration?: number }>
    }
    expect(
      vercel.functions["src/app/api/admin/users/invite/route.ts"],
    ).toEqual({ maxDuration: 120 })

    const dialog = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(admin)/admin/users/components/InviteUserDialog.tsx",
      ),
      "utf8",
    )
    const store = readFileSync(
      resolve(process.cwd(), "src/store/userManagementStore.ts"),
      "utf8",
    )
    const inviteStoreAction = store.slice(
      store.indexOf("inviteUser: async"),
      store.indexOf("assignRole: async"),
    )
    expect(dialog).toContain('title: "Request accepted"')
    expect(dialog).toContain("We received the invitation request.")
    expect(dialog).not.toMatch(/User invited successfully/i)
    expect(inviteStoreAction).toMatch(/request was accepted/i)
    expect(inviteStoreAction).not.toContain("fetchUsers")
    expect(inviteStoreAction).not.toMatch(/invited successfully/i)
  })

  test("rejects untrusted requests before authentication, parsing, or issuance", async () => {
    const invalidHeaders: Array<Record<string, string | null>> = [
      { host: "invitee.creatorshare.com", origin: ORIGIN },
      { host: "attacker.example", origin: "https://attacker.example" },
      { origin: "https://attacker.example" },
      { origin: null },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
    ]
    for (const headers of invalidHeaders) {
      const response = await route.POST(request(invitationBody(), headers))
      expect(response.status).toBe(400)
      expect(await json(response)).toEqual({
        ok: false,
        code: "invalid_request",
        error: "Invalid request",
      })
    }
    expect(createClientCalls).toBe(0)
    expect(issuerCalls).toHaveLength(0)
    expect(catalogCalls).toHaveLength(0)
  })

  test("requires a super administrator before parsing the body", async () => {
    authStatus = "unauthorized"
    const unauthorized = await route.POST(request("not-json"))
    expect(unauthorized.status).toBe(401)
    expect((await json(unauthorized)).code).toBe("unauthorized")

    authStatus = "forbidden"
    const forbidden = await route.POST(request("not-json"))
    expect(forbidden.status).toBe(403)
    expect((await json(forbidden)).code).toBe("forbidden")
    expect(issuerCalls).toHaveLength(0)
    expect(catalogCalls).toHaveLength(0)
  })

  test("strictly rejects malformed, oversized, duplicate, zero, and noncanonical input", async () => {
    const invalidBodies = [
      "not-json",
      JSON.stringify([]),
      invitationBody({ extra: true }),
      invitationBody({ email: "bad address@example.com" }),
      invitationBody({ role_ids: [] }),
      invitationBody({ role_ids: [ROLE_ONE_ID, ROLE_ONE_ID] }),
      invitationBody({
        role_ids: ["00000000-0000-0000-0000-000000000000"],
      }),
      invitationBody({
        role_ids: ["AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
      }),
      invitationBody({ role_ids: ["not-a-role"] }),
      invitationBody({ reason: "" }),
      invitationBody({ reason: " padded " }),
      invitationBody({ reason: "unsafe\u0000reason" }),
    ]
    for (const body of invalidBodies) {
      const response = await route.POST(request(body))
      expect(response.status).toBe(400)
      expect((await json(response)).code).toBe("invalid_request")
    }

    const oversized = await route.POST(
      request(invitationBody(), { "content-length": "8193" }),
    )
    expect(oversized.status).toBe(400)
    expect(issuerCalls).toHaveLength(0)
    expect(catalogCalls).toHaveLength(0)
  })

  test("contains a request body reader failure before catalog or provider access", async () => {
    const base = request(invitationBody())
    const unreadable = {
      headers: base.headers,
      body: {
        getReader() {
          throw new Error("reader unavailable")
        },
      },
    } as unknown as Request
    const response = await route.POST(unreadable)
    expect(response.status).toBe(400)
    expect((await json(response)).code).toBe("invalid_request")
    expect(issuerCalls).toHaveLength(0)
    expect(catalogCalls).toHaveLength(0)
  })

  test("fails closed on a missing role or unavailable authorized catalog", async () => {
    roleCatalogData = [{ id: ROLE_ONE_ID }]
    const missingRole = await route.POST(request(invitationBody()))
    expect(missingRole.status).toBe(400)
    expect((await json(missingRole)).code).toBe("invalid_request")
    expect(issuerCalls).toHaveLength(0)

    roleCatalogData = null
    roleCatalogError = { code: "XX000" }
    const { result: unavailable, calls } = await captureErrors(() =>
      route.POST(request(invitationBody())),
    )
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get("retry-after")).toBe("3900")
    expect((await json(unavailable)).code).toBe("invitation_unavailable")
    expect(issuerCalls).toHaveLength(0)
    expect(JSON.stringify(calls)).not.toMatch(/invitee@example|role_one|provider/i)
  })

  test("normalizes the email and assigns exact roles under one server request id", async () => {
    const response = await route.POST(request(invitationBody()))
    const payload = await json(response)
    expect(response.status).toBe(202)
    expect(response.headers.get("retry-after")).toBeNull()
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(payload).toEqual({
      ok: true,
      requestId: expect.stringMatching(UUID_PATTERN),
      code: "invitation_accepted",
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /email|user|role|sent|provider|secret/i,
    )
    expect(createClientOptions).toEqual([
      { requestTimeoutMilliseconds: 8_000 },
    ])

    expect(issuerCalls).toEqual([
      {
        recipientEmail: "invitee@example.com",
        redirectTo: "https://creatorshare.com/set-password",
        invitedByUserId: ACTOR_ID,
        context: {
          requestId: payload.requestId,
          traceId: "sfo1::admin-invitation-test",
        },
      },
    ])
    expect(catalogCalls).toEqual([
      {
        table: "roles",
        columns: "id",
        column: "id",
        values: [ROLE_ONE_ID, ROLE_TWO_ID],
      },
    ])
    expect(roleRpcCalls).toEqual([
      {
        name: "replace_creator_share_user_roles",
        args: {
          target_user_id: INVITED_USER_ID,
          target_role_ids: [ROLE_ONE_ID, ROLE_TWO_ID],
          change_reason:
            "Administrator assigned initial Creator Share roles to an invited user",
          request_id: payload.requestId,
        },
      },
    ])
    expect(payload.requestId).not.toBe(CLIENT_REQUEST_ID)
  })

  test("does not begin provider work without issuer and settlement headroom", async () => {
    monotonicTimes = [0, 55_000]
    const { result, calls } = await captureErrors(() =>
      route.POST(request(invitationBody())),
    )
    expect(result.status).toBe(503)
    expect(result.headers.get("retry-after")).toBe("3900")
    expect((await json(result)).code).toBe("invitation_unavailable")
    expect(issuerCalls).toHaveLength(0)
    expect(roleRpcCalls).toHaveLength(0)
    expect(JSON.stringify(calls)).toContain(
      "CREATOR_SHARE_ADMIN_INVITATION_DEADLINE_INSUFFICIENT",
    )
  })

  test("passes one strictly bounded explicit role reason", async () => {
    const response = await route.POST(
      request(invitationBody({ reason: "Grant approved operational access." })),
    )
    expect(response.status).toBe(202)
    expect(roleRpcCalls[0].args.change_reason).toBe(
      "Grant approved operational access.",
    )
  })

  test("maps every safe pre-provider nonissued result to one generic retry", async () => {
    const outcomes: IssuanceResult[] = [
      { status: "coalesced", retryAfterSeconds: 0 },
      { status: "coalesced", retryAfterSeconds: 120 },
      { status: "deferred", retryAfterSeconds: 3900 },
      { status: "unavailable", stage: "configuration" },
      { status: "unavailable", stage: "acquire" },
      { status: "unavailable", stage: "begin", retryAfterSeconds: 3900 },
    ]
    const observed: Array<Record<string, unknown>> = []
    const { calls } = await captureErrors(async () => {
      for (const outcome of outcomes) {
        issuanceResult = outcome
        const response = await route.POST(request(invitationBody()))
        expect(response.status).toBe(503)
        expect(response.headers.get("retry-after")).toBe("3900")
        const payload = await json(response)
        expect(payload).toEqual({
          ok: false,
          requestId: expect.stringMatching(UUID_PATTERN),
          code: "invitation_unavailable",
          error: "Invitation temporarily unavailable",
        })
        observed.push({ ...payload, requestId: "redacted" })
      }
    })
    expect(new Set(observed.map((value) => JSON.stringify(value))).size).toBe(1)
    expect(roleRpcCalls).toHaveLength(0)
    expect(JSON.stringify(calls)).not.toMatch(/invitee@example|configuration|acquire|begin/i)
  })

  test("makes provider ambiguity externally identical to accepted success", async () => {
    issuanceResult = { status: "ambiguous", retryAfterSeconds: 3900 }
    const { result: ambiguous, calls } = await captureErrors(() =>
      route.POST(request(invitationBody())),
    )
    const ambiguousPayload = await json(ambiguous)
    expect(ambiguous.status).toBe(202)
    expect(ambiguous.headers.get("retry-after")).toBeNull()
    expect(ambiguousPayload).toEqual({
      ok: true,
      requestId: expect.stringMatching(UUID_PATTERN),
      code: "invitation_accepted",
    })
    expect(roleRpcCalls).toHaveLength(0)
    expect(JSON.stringify(calls)).not.toMatch(/invitee@example|ambiguous|provider/i)
  })

  test("accepts malformed issued identity and role failure for manual attention without retry", async () => {
    issuanceResult = { status: "issued", userId: "not-a-uuid" }
    const malformed = await captureErrors(() =>
      route.POST(request(invitationBody())),
    )
    expect(malformed.result.status).toBe(202)
    expect(malformed.result.headers.get("retry-after")).toBeNull()
    expect((await json(malformed.result)).code).toBe("invitation_accepted")
    expect(roleRpcCalls).toHaveLength(0)

    issuanceResult = { status: "issued", userId: INVITED_USER_ID }
    roleRpcError = { code: "XX000" }
    const failedRoles = await captureErrors(() =>
      route.POST(request(invitationBody())),
    )
    expect(failedRoles.result.status).toBe(202)
    expect(failedRoles.result.headers.get("retry-after")).toBeNull()
    const payload = await json(failedRoles.result)
    expect(payload).toEqual({
      ok: true,
      requestId: expect.stringMatching(UUID_PATTERN),
      code: "invitation_accepted",
    })
    expect(JSON.stringify(failedRoles.calls)).not.toMatch(
      /invitee@example|xx000|provider|role_ids/i,
    )
  })

  test("treats an unexpected post-validation issuer failure as accepted manual attention", async () => {
    issuanceThrows = true
    const { result, calls } = await captureErrors(() =>
      route.POST(request(invitationBody())),
    )
    expect(result.status).toBe(202)
    expect(result.headers.get("retry-after")).toBeNull()
    expect((await json(result)).code).toBe("invitation_accepted")
    expect(roleRpcCalls).toHaveLength(0)
    expect(JSON.stringify(calls)).not.toMatch(
      /invitee@example|provider payload|recipient/i,
    )
  })

  test("trusts the trace only in a declared Vercel runtime", async () => {
    delete process.env.VERCEL
    const response = await route.POST(request(invitationBody()))
    expect(response.status).toBe(202)
    expect(
      (issuerCalls[0].context as { traceId: string | null }).traceId,
    ).toBeNull()
  })

  test("contains client and authorization construction failures", async () => {
    createClientFailure = true
    const first = await captureErrors(() =>
      route.POST(request(invitationBody())),
    )
    expect(first.result.status).toBe(503)
    expect((await json(first.result)).code).toBe("invitation_unavailable")

    createClientFailure = false
    authStatus = "throws"
    const second = await captureErrors(() =>
      route.POST(request(invitationBody())),
    )
    expect(second.result.status).toBe(503)
    expect((await json(second.result)).code).toBe("invitation_unavailable")
    expect(issuerCalls).toHaveLength(0)
    expect(catalogCalls).toHaveLength(0)
  })
})
