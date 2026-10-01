import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RouteModule =
  typeof import("../../src/app/api/portal/[slug]/catalog/route")
type CatalogModule = typeof import("../../src/lib/advocates/admin/catalog")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const BENEFICIARY_A_ID = "33333333-3333-4333-8333-333333333333"
const BENEFICIARY_B_ID = "44444444-4444-4444-8444-444444444444"
const BENEFICIARY_C_ID = "55555555-5555-4555-8555-555555555555"
const ORIGIN = "https://creatorshare.com"
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

interface DatabaseResult {
  data: unknown
  error: ({ code?: string; message?: string } & Record<string, unknown>) | null
}

let currentUser: { id: string } | null = { id: ACTOR_ID }
let accessPermissions = ["portal.beneficiaries.manage", "portal.view"]
let accessResult: DatabaseResult = { data: [], error: null }
let updateResult: DatabaseResult = { data: 8, error: null }
let createClientCalls = 0
let serviceClientCalls = 0
const rpcCalls: Array<{
  client: "authenticated" | "service"
  name: string
  input: unknown
}> = []

function validAccessRow() {
  return {
    advocate_id: ADVOCATE_ID,
    slug: "hope",
    display_name: "Hope Creates",
    relationship_status: "active",
    publication_status: "active",
    beneficiary_mode: "selected",
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
            rpcCalls.push({ client: "authenticated", name, input })
            if (name === "get_my_advocate_portal_access") {
              return accessResult
            }
            return { data: null, error: { code: "XX000" } }
          },
        }
      },
      createServiceRoleClient() {
        serviceClientCalls += 1
        return {
          async rpc(name: string, input?: unknown) {
            rpcCalls.push({ client: "service", name, input })
            if (name === "replace_advocate_beneficiary_configuration") {
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
  resolve(process.cwd(), "tests/advocates/portal-catalog-route.spec.ts"),
)
const { POST } = testRequire(
  resolve(process.cwd(), "src/app/api/portal/[slug]/catalog/route.ts"),
) as RouteModule
const {
  MAX_ADVOCATE_CATALOG_BODY_BYTES,
  classifyAdvocateCatalogUpdateFailure,
  loadAdvocateCatalogAdministration,
  parseAdvocateCatalogAdministration,
  parseAdvocateCatalogUpdateInput,
  readBoundedAdvocateCatalogBody,
  replaceAdvocateCatalogConfiguration,
} = testRequire(
  resolve(process.cwd(), "src/lib/advocates/admin/catalog.ts"),
) as CatalogModule
nodeModule._load = originalModuleLoad

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    expectedVersion: 7,
    mode: "selected",
    beneficiaryIds: [BENEFICIARY_A_ID, BENEFICIARY_B_ID],
    featuredBeneficiaryIds: [BENEFICIARY_B_ID],
    changeReason: "Feature the requested children in this exact order.",
    ...overrides,
  })
}

function request(
  body: BodyInit = validBody(),
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
  return new Request(`${ORIGIN}/api/portal/hope/catalog`, {
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

function validCatalogAdministration() {
  return {
    advocate_version: 7,
    beneficiary_mode: "selected",
    beneficiary_selections: [
      { beneficiary_id: BENEFICIARY_A_ID, is_featured: false },
      { beneficiary_id: BENEFICIARY_B_ID, is_featured: true },
    ],
    selection_limit: 1_000,
    beneficiaries: [
      {
        id: BENEFICIARY_A_ID,
        name: "Amina",
        username: "amina",
        status: "New",
        eligible: true,
        blocked_reason: null,
      },
      {
        id: BENEFICIARY_B_ID,
        name: null,
        username: null,
        status: null,
        eligible: false,
        blocked_reason: "unavailable",
      },
    ],
  }
}

test.beforeEach(() => {
  currentUser = { id: ACTOR_ID }
  accessPermissions = ["portal.beneficiaries.manage", "portal.view"]
  accessResult = { data: [validAccessRow()], error: null }
  updateResult = { data: 8, error: null }
  createClientCalls = 0
  serviceClientCalls = 0
  rpcCalls.length = 0
})

test.describe("advocate portal catalog route", () => {
  test("rejects untrusted origins and non JSON requests before authentication", async () => {
    const invalidHeaders: Array<Record<string, string | null>> = [
      { host: "attacker.example" },
      { origin: "https://attacker.example" },
      { origin: "https://hope.creatorshare.com" },
      { origin: null },
      { "sec-fetch-site": "cross-site" },
      { "content-type": "text/plain" },
    ]

    for (const headers of invalidHeaders) {
      const response = await post(request(validBody(), headers))
      expect(response.status).toBe(400)
      const payload = await json(response)
      expect(payload).toMatchObject({ ok: false, code: "invalid_request" })
      expect(Object.keys(payload).sort()).toEqual(["code", "ok", "requestId"])
    }

    expect(createClientCalls).toBe(0)
    expect(serviceClientCalls).toBe(0)
    expect(rpcCalls).toHaveLength(0)
  })

  test("requires an authenticated account before loading portal access", async () => {
    currentUser = null

    const response = await post(request())

    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "unauthorized",
    })
    expect(createClientCalls).toBe(1)
    expect(serviceClientCalls).toBe(0)
    expect(rpcCalls).toHaveLength(0)
  })

  test("conceals inaccessible slugs and denies members without catalog permission", async () => {
    const concealed = await post(request(), "other")
    expect(concealed.status).toBe(404)
    expect(await json(concealed)).toMatchObject({
      ok: false,
      code: "portal_not_found",
    })

    accessPermissions = ["portal.view"]
    accessResult = { data: [validAccessRow()], error: null }
    const denied = await post(request())
    expect(denied.status).toBe(403)
    expect(await json(denied)).toMatchObject({ ok: false, code: "forbidden" })

    expect(serviceClientCalls).toBe(0)
    expect(
      rpcCalls.filter(
        (call) => call.name === "replace_advocate_beneficiary_configuration",
      ),
    ).toHaveLength(0)
  })

  test("fails closed when the access boundary is unavailable without leaking its error", async () => {
    accessResult = {
      data: null,
      error: {
        code: "XX000",
        message: "private row identifier and tenant state",
        providerSecret: "must-not-leak",
      },
    }

    const response = await post(request())
    const payload = await json(response)

    expect(response.status).toBe(500)
    expect(payload).toMatchObject({
      ok: false,
      code: "catalog_update_failed",
    })
    expect(Object.keys(payload).sort()).toEqual(["code", "ok", "requestId"])
    expect(JSON.stringify(payload)).not.toMatch(
      /private row|tenant state|providerSecret|must-not-leak/i,
    )
    expect(serviceClientCalls).toBe(0)
  })

  test("rejects strict shape violations and every catalog mode invariant before mutation", async () => {
    const invalidBodies = [
      validBody({ requestId: "browser-owned" }),
      JSON.stringify({
        expectedVersion: 7,
        mode: "selected",
        beneficiaryIds: [BENEFICIARY_A_ID],
        featuredBeneficiaryIds: [],
      }),
      validBody({ expectedVersion: 0 }),
      validBody({ expectedVersion: 7.5 }),
      validBody({ mode: "custom" }),
      validBody({ beneficiaryIds: [BENEFICIARY_A_ID, BENEFICIARY_A_ID] }),
      validBody({ beneficiaryIds: [BENEFICIARY_A_ID.toUpperCase()] }),
      validBody({ featuredBeneficiaryIds: [BENEFICIARY_C_ID] }),
      validBody({ changeReason: "   " }),
      validBody({ changeReason: "invalid\u0000note" }),
      validBody({ changeReason: "x".repeat(501) }),
      validBody({
        mode: "all",
        beneficiaryIds: [BENEFICIARY_A_ID],
        featuredBeneficiaryIds: [],
      }),
      validBody({
        mode: "all_featured",
        beneficiaryIds: [],
        featuredBeneficiaryIds: [],
      }),
      validBody({
        mode: "all_featured",
        beneficiaryIds: [BENEFICIARY_A_ID, BENEFICIARY_B_ID],
        featuredBeneficiaryIds: [BENEFICIARY_A_ID],
      }),
      validBody({
        mode: "selected",
        beneficiaryIds: [],
        featuredBeneficiaryIds: [],
      }),
      "not-json",
      "[]",
    ]

    for (const body of invalidBodies) {
      const response = await post(request(body))
      expect(response.status).toBe(400)
      expect(await json(response)).toMatchObject({
        ok: false,
        code: "invalid_request",
      })
    }

    expect(serviceClientCalls).toBe(0)
    expect(
      rpcCalls.filter(
        (call) => call.name === "replace_advocate_beneficiary_configuration",
      ),
    ).toHaveLength(0)
  })

  test("bounds declared and streamed body bytes and rejects malformed UTF8", async () => {
    const declaredOversize = await post(
      request(validBody(), {
        "content-length": String(MAX_ADVOCATE_CATALOG_BODY_BYTES + 1),
      }),
    )
    expect(declaredOversize.status).toBe(400)

    const streamedOversize = await post(
      request("x".repeat(MAX_ADVOCATE_CATALOG_BODY_BYTES + 1)),
    )
    expect(streamedOversize.status).toBe(400)

    const malformedUtf8 = await post(request(Uint8Array.from([0xc3, 0x28])))
    expect(malformedUtf8.status).toBe(400)

    for (const response of [
      declaredOversize,
      streamedOversize,
      malformedUtf8,
    ]) {
      expect(await json(response)).toMatchObject({
        ok: false,
        code: "invalid_request",
      })
    }
    expect(serviceClientCalls).toBe(0)
  })

  test("persists one ordered actor aware update with server owned audit identifiers", async () => {
    const response = await post(
      request(validBody(), {
        "x-trace-id": "browser-controlled-trace",
        "x-vercel-id": "sfo1::iad1::catalog-platform-trace",
        "x-vercel-forwarded-for": "203.0.113.44",
        "cf-connecting-ip": "198.51.100.9",
        "x-forwarded-for": "198.51.100.10",
        "x-real-ip": "198.51.100.11",
        "user-agent": "Catalog administration test agent",
      }),
    )
    const payload = await json(response)

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ ok: true, advocateVersion: 8 })
    expect(Object.keys(payload).sort()).toEqual([
      "advocateVersion",
      "ok",
      "requestId",
    ])
    expect(payload.requestId).toMatch(UUID_V4_PATTERN)
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )

    expect(rpcCalls.map(({ client, name }) => ({ client, name }))).toEqual([
      { client: "authenticated", name: "get_my_advocate_portal_access" },
      {
        client: "service",
        name: "replace_advocate_beneficiary_configuration",
      },
    ])
    expect(serviceClientCalls).toBe(1)
    const mutation = rpcCalls[1].input as Record<string, unknown>
    expect(mutation).toMatchObject({
      target_advocate_id: ADVOCATE_ID,
      acting_user_id: ACTOR_ID,
      expected_advocate_version: 7,
      target_beneficiary_mode: "selected",
      target_beneficiary_ids: [BENEFICIARY_A_ID, BENEFICIARY_B_ID],
      target_featured_beneficiary_ids: [BENEFICIARY_B_ID],
      change_reason: "Feature the requested children in this exact order.",
      request_id: payload.requestId,
      session_id: null,
      client_ip: "203.0.113.44",
      user_agent: "Catalog administration test agent",
    })
    expect(mutation.trace_id).toBe("sfo1::iad1::catalog-platform-trace")
    expect(mutation.trace_id).not.toBe("browser-controlled-trace")
    expect(mutation.trace_id).not.toBe(payload.requestId)
    expect(Object.keys(mutation).sort()).toEqual([
      "acting_user_id",
      "change_reason",
      "client_ip",
      "expected_advocate_version",
      "request_id",
      "session_id",
      "target_advocate_id",
      "target_beneficiary_ids",
      "target_beneficiary_mode",
      "target_featured_beneficiary_ids",
      "trace_id",
      "user_agent",
    ])
  })

  test("fails closed when only browser forgeable client IP headers are present", async () => {
    const response = await post(
      request(validBody(), {
        "cf-ray": "browser-controlled-cloudflare-trace",
        "cf-connecting-ip": "203.0.113.44",
        "x-forwarded-for": "203.0.113.45",
        "x-real-ip": "203.0.113.46",
      }),
    )

    expect(response.status).toBe(200)
    const mutation = rpcCalls[1].input as Record<string, unknown>
    expect(mutation.client_ip).toBeNull()
    expect(mutation.trace_id).toMatch(UUID_V4_PATTERN)
    expect(mutation.trace_id).not.toBe("browser-controlled-cloudflare-trace")
  })

  test("fails closed on malformed Vercel client IP evidence", async () => {
    for (const clientIp of [
      "203.0.113.44, 198.51.100.9",
      "not-an-ip-address",
    ]) {
      rpcCalls.length = 0
      const response = await post(
        request(validBody(), {
          "x-vercel-forwarded-for": clientIp,
          "cf-connecting-ip": "203.0.113.47",
        }),
      )

      expect(response.status).toBe(200)
      const mutation = rpcCalls[1].input as Record<string, unknown>
      expect(mutation.client_ip).toBeNull()
    }
  })

  test("requires the database to return exactly the next aggregate version", async () => {
    for (const invalidVersion of [7, 9, 8.5, "8", null]) {
      updateResult = { data: invalidVersion, error: null }
      const response = await post(request())
      const payload = await json(response)

      expect(response.status).toBe(500)
      expect(payload).toMatchObject({
        ok: false,
        code: "catalog_update_failed",
      })
      expect(Object.keys(payload).sort()).toEqual(["code", "ok", "requestId"])
    }
  })

  test("maps no change, stale state, and database errors to static nonleaking outcomes", async () => {
    const cases: Array<{
      error: NonNullable<DatabaseResult["error"]>
      status: number
      code: string
    }> = [
      {
        error: {
          code: "22023",
          message: "Advocate beneficiary configuration is unchanged",
        },
        status: 409,
        code: "no_change",
      },
      {
        error: { code: "22023", message: "private validation detail" },
        status: 400,
        code: "invalid_request",
      },
      {
        error: {
          code: "23514",
          message: `Beneficiary ${BENEFICIARY_A_ID} named Amina is no longer eligible`,
          sensitive: "canonical child state",
        },
        status: 409,
        code: "eligibility_changed",
      },
      {
        error: { code: "40001", message: "other tenant version is 99" },
        status: 409,
        code: "version_conflict",
      },
      {
        error: { code: "55000", message: "private lifecycle state" },
        status: 409,
        code: "version_conflict",
      },
      {
        error: {
          code: "XX000",
          message: "provider secret and private row identifier",
          sensitive: "must-not-leak",
        },
        status: 500,
        code: "catalog_update_failed",
      },
    ]

    for (const candidate of cases) {
      updateResult = { data: null, error: candidate.error }
      const response = await post(request())
      const payload = await json(response)

      expect(response.status).toBe(candidate.status)
      expect(payload).toMatchObject({ ok: false, code: candidate.code })
      expect(Object.keys(payload).sort()).toEqual(["code", "ok", "requestId"])
      expect(JSON.stringify(payload)).not.toMatch(
        /Amina|canonical child|private|tenant version|provider secret|sensitive|must-not-leak/i,
      )
    }
  })
})

test.describe("advocate portal catalog boundary", () => {
  test("accepts only canonical updates that satisfy each mode invariant", () => {
    expect(
      parseAdvocateCatalogUpdateInput(
        validBody({
          mode: "all",
          beneficiaryIds: [],
          featuredBeneficiaryIds: [],
          changeReason: "  Return to the full child catalog.  ",
        }),
      ),
    ).toEqual({
      expectedVersion: 7,
      mode: "all",
      beneficiaryIds: [],
      featuredBeneficiaryIds: [],
      changeReason: "Return to the full child catalog.",
    })
    expect(
      parseAdvocateCatalogUpdateInput(
        validBody({
          mode: "all_featured",
          beneficiaryIds: [BENEFICIARY_B_ID, BENEFICIARY_A_ID],
          featuredBeneficiaryIds: [BENEFICIARY_B_ID, BENEFICIARY_A_ID],
        }),
      ),
    ).toMatchObject({
      mode: "all_featured",
      beneficiaryIds: [BENEFICIARY_B_ID, BENEFICIARY_A_ID],
      featuredBeneficiaryIds: [BENEFICIARY_B_ID, BENEFICIARY_A_ID],
    })
    expect(parseAdvocateCatalogUpdateInput(validBody())).toMatchObject({
      mode: "selected",
      beneficiaryIds: [BENEFICIARY_A_ID, BENEFICIARY_B_ID],
      featuredBeneficiaryIds: [BENEFICIARY_B_ID],
    })

    for (const invalid of [
      validBody({
        mode: "all",
        beneficiaryIds: [BENEFICIARY_A_ID],
        featuredBeneficiaryIds: [],
      }),
      validBody({
        mode: "all_featured",
        beneficiaryIds: [BENEFICIARY_A_ID],
        featuredBeneficiaryIds: [],
      }),
      validBody({
        mode: "selected",
        beneficiaryIds: [],
        featuredBeneficiaryIds: [],
      }),
      validBody({ featuredBeneficiaryIds: [BENEFICIARY_C_ID] }),
    ]) {
      expect(parseAdvocateCatalogUpdateInput(invalid)).toBeNull()
    }
  })

  test("enforces exact update keys, UUID uniqueness, selection limits, and audit note bounds", () => {
    const tooManyIds = Array.from({ length: 1_001 }, (_, index) => {
      const suffix = index.toString(16).padStart(12, "0")
      return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`
    })

    for (const invalid of [
      validBody({ browserRequestId: BENEFICIARY_C_ID }),
      validBody({ expectedVersion: Number.MAX_SAFE_INTEGER + 1 }),
      validBody({ beneficiaryIds: [BENEFICIARY_A_ID, BENEFICIARY_A_ID] }),
      validBody({ beneficiaryIds: ["not-a-uuid"] }),
      validBody({ beneficiaryIds: tooManyIds, featuredBeneficiaryIds: [] }),
      validBody({ changeReason: "x\nprivate" }),
      "{}",
      "null",
      "not-json",
    ]) {
      expect(parseAdvocateCatalogUpdateInput(invalid)).toBeNull()
    }
  })

  test("strictly parses the bounded privacy-safe catalog administration projection", () => {
    expect(
      parseAdvocateCatalogAdministration(validCatalogAdministration()),
    ).toEqual({
      advocateVersion: 7,
      mode: "selected",
      selections: [
        { beneficiaryId: BENEFICIARY_A_ID, isFeatured: false },
        { beneficiaryId: BENEFICIARY_B_ID, isFeatured: true },
      ],
      selectionLimit: 1_000,
      beneficiaries: [
        {
          id: BENEFICIARY_A_ID,
          name: "Amina",
          username: "amina",
          status: "New",
          eligible: true,
          blockedReason: null,
        },
        {
          id: BENEFICIARY_B_ID,
          name: null,
          username: null,
          status: null,
          eligible: false,
          blockedReason: "unavailable",
        },
      ],
    })

    for (const invalid of [
      { ...validCatalogAdministration(), selection_limit: 999 },
      {
        ...validCatalogAdministration(),
        private_sponsor_email: "x@example.com",
      },
      {
        ...validCatalogAdministration(),
        beneficiaries: [
          ...validCatalogAdministration().beneficiaries,
          validCatalogAdministration().beneficiaries[0],
        ],
      },
      {
        ...validCatalogAdministration(),
        beneficiaries: [
          {
            ...validCatalogAdministration().beneficiaries[0],
            sponsor_email: "x@example.com",
          },
        ],
      },
      {
        ...validCatalogAdministration(),
        beneficiaries: [
          {
            ...validCatalogAdministration().beneficiaries[0],
            status: "Secret status",
          },
        ],
      },
    ]) {
      expect(parseAdvocateCatalogAdministration(invalid)).toBeNull()
    }
  })

  test("bounds declared and streamed bodies and uses fatal UTF8 decoding", async () => {
    await expect(
      readBoundedAdvocateCatalogBody(request(validBody())),
    ).resolves.toBe(validBody())
    await expect(
      readBoundedAdvocateCatalogBody(
        request(validBody(), { "content-length": "not-a-number" }),
      ),
    ).resolves.toBeNull()
    await expect(
      readBoundedAdvocateCatalogBody(
        request(validBody(), {
          "content-length": String(MAX_ADVOCATE_CATALOG_BODY_BYTES + 1),
        }),
      ),
    ).resolves.toBeNull()
    await expect(
      readBoundedAdvocateCatalogBody(
        request("x".repeat(MAX_ADVOCATE_CATALOG_BODY_BYTES + 1)),
      ),
    ).resolves.toBeNull()
    await expect(
      readBoundedAdvocateCatalogBody(request(Uint8Array.from([0xc3, 0x28]))),
    ).resolves.toBeNull()
  })

  test("loads the administration projection with an actor aware service RPC", async () => {
    const calls: Array<{ name: string; input: unknown }> = []
    const client = {
      async rpc(name: string, input: unknown) {
        calls.push({ name, input })
        return { data: validCatalogAdministration(), error: null }
      },
    }

    await expect(
      loadAdvocateCatalogAdministration(client as never, {
        advocateId: ADVOCATE_ID,
        actorUserId: ACTOR_ID,
      }),
    ).resolves.toMatchObject({ selectionLimit: 1_000 })
    expect(calls).toEqual([
      {
        name: "read_advocate_catalog_administration",
        input: {
          target_advocate_id: ADVOCATE_ID,
          acting_user_id: ACTOR_ID,
        },
      },
    ])
  })

  test("maps only canonical database failures to static outcomes", () => {
    expect(
      classifyAdvocateCatalogUpdateFailure(
        "22023",
        "Advocate beneficiary configuration is unchanged",
      ),
    ).toEqual({ status: 409, code: "no_change" })
    expect(classifyAdvocateCatalogUpdateFailure("22023", "private")).toEqual({
      status: 400,
      code: "invalid_request",
    })
    expect(classifyAdvocateCatalogUpdateFailure("23514", "private")).toEqual({
      status: 409,
      code: "eligibility_changed",
    })
    expect(classifyAdvocateCatalogUpdateFailure("42501", "private")).toEqual({
      status: 403,
      code: "forbidden",
    })
    expect(classifyAdvocateCatalogUpdateFailure("23503", "private")).toEqual({
      status: 404,
      code: "portal_not_found",
    })
    expect(classifyAdvocateCatalogUpdateFailure("40001", "private")).toEqual({
      status: 409,
      code: "version_conflict",
    })
    expect(classifyAdvocateCatalogUpdateFailure("55000", "private")).toEqual({
      status: 409,
      code: "version_conflict",
    })
    expect(classifyAdvocateCatalogUpdateFailure("XX000", "private")).toEqual({
      status: 500,
      code: "catalog_update_failed",
    })
  })

  test("sends only the narrow actor aware mutation and rejects nonincremented results", async () => {
    const input = parseAdvocateCatalogUpdateInput(validBody())
    expect(input).not.toBeNull()
    if (input === null) return

    const calls: Array<{ name: string; input: unknown }> = []
    let result: DatabaseResult = { data: 8, error: null }
    const client = {
      async rpc(name: string, rpcInput: unknown) {
        calls.push({ name, input: rpcInput })
        return result
      },
    }
    const mutation = {
      advocateId: ADVOCATE_ID,
      actorUserId: ACTOR_ID,
      input,
      requestId: "66666666-6666-4666-8666-666666666666",
      traceId: "sfo1::iad1::catalog-service-trace",
      sessionId: null as null,
      clientIp: null,
      userAgent: null,
    }

    await expect(
      replaceAdvocateCatalogConfiguration(client as never, mutation),
    ).resolves.toBe(8)
    expect(calls).toEqual([
      {
        name: "replace_advocate_beneficiary_configuration",
        input: {
          target_advocate_id: ADVOCATE_ID,
          acting_user_id: ACTOR_ID,
          expected_advocate_version: 7,
          target_beneficiary_mode: "selected",
          target_beneficiary_ids: [BENEFICIARY_A_ID, BENEFICIARY_B_ID],
          target_featured_beneficiary_ids: [BENEFICIARY_B_ID],
          change_reason: "Feature the requested children in this exact order.",
          request_id: "66666666-6666-4666-8666-666666666666",
          trace_id: "sfo1::iad1::catalog-service-trace",
          session_id: null,
          client_ip: null,
          user_agent: null,
        },
      },
    ])

    for (const invalidVersion of [7, 9, 8.5, "8", null]) {
      result = { data: invalidVersion, error: null }
      await expect(
        replaceAdvocateCatalogConfiguration(client as never, mutation),
      ).rejects.toMatchObject({
        name: "AdvocateCatalogDatabaseError",
        stage: "update_shape",
      })
    }

    const invalidForensicMutations = [
      { ...mutation, requestId: "not-a-request-id" },
      { ...mutation, traceId: "" },
      { ...mutation, traceId: "bad\ntrace" },
      { ...mutation, clientIp: " padded" },
      { ...mutation, clientIp: "x".repeat(257) },
      { ...mutation, userAgent: "bad\u0000agent" },
      { ...mutation, userAgent: "x".repeat(1_025) },
      { ...mutation, sessionId: "browser-session" as never },
    ]
    const callsBeforeInvalidForensics = calls.length
    for (const invalidMutation of invalidForensicMutations) {
      await expect(
        replaceAdvocateCatalogConfiguration(client as never, invalidMutation),
      ).rejects.toMatchObject({
        name: "AdvocateCatalogDatabaseError",
        stage: "update_shape",
      })
    }
    expect(calls).toHaveLength(callsBeforeInvalidForensics)
  })
})
