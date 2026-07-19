import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import sharp from "sharp"

type RouteModule = typeof import("../../src/app/api/portal/[slug]/logo/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333"
const RESERVATION_PATH = `logos/hope/${RESERVATION_ID}.webp`
const ORIGIN = "https://creatorshare.com"

let currentUser: { id: string } | null = { id: ACTOR_ID }
let updateResult: { data: unknown; error: { code?: string } | null } = {
  data: 8,
  error: null,
}
let reserveResult: { data: unknown; error: { code?: string } | null } = {
  data: [
    {
      reservation_id: RESERVATION_ID,
      object_path: RESERVATION_PATH,
      expires_at: "2026-07-19T00:00:00.000Z",
    },
  ],
  error: null,
}
let inspectResult: { data: unknown; error: { code?: string } | null } = {
  data: [
    {
      status: "pending",
      object_path: RESERVATION_PATH,
      expected_version: 7,
      resulting_version: null,
    },
  ],
  error: null,
}
let storageUploadError: { message: string } | null = null
let storageRemoveError: { message: string } | null = null
let storageUploadThrows = false
let storageRemoveThrows = false
let createClientCalls = 0
let serviceClientCalls = 0
let portalAccess = accessRow()
const serviceClientOptionsCalls: unknown[] = []
const rpcCalls: Array<{ name: string; input: Record<string, unknown> }> = []
const uploadCalls: Array<{
  bucket: string
  path: string
  bytes: Uint8Array
  options: Record<string, unknown>
}> = []
const removeCalls: Array<{ bucket: string; paths: string[] }> = []

function accessRow() {
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
    permissions: ["portal.branding.update", "portal.view"],
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
          async rpc(name: string, input?: Record<string, unknown>) {
            rpcCalls.push({ name, input: input ?? {} })
            if (name === "get_my_advocate_portal_access") {
              return { data: [portalAccess], error: null }
            }
            return { data: null, error: { code: "XX000" } }
          },
        }
      },
      createServiceRoleClient(options?: unknown) {
        serviceClientCalls += 1
        serviceClientOptionsCalls.push(options)
        return {
          async rpc(name: string, input?: Record<string, unknown>) {
            rpcCalls.push({ name, input: input ?? {} })
            if (name === "reserve_advocate_logo_upload") {
              return reserveResult
            }
            if (name === "update_advocate_branding") return updateResult
            if (name === "get_advocate_logo_upload_reservation_result") {
              return inspectResult
            }
            if (name === "settle_advocate_logo_upload_reservation") {
              return {
                data: input?.target_status ?? null,
                error: null,
              }
            }
            return { data: null, error: { code: "XX000" } }
          },
          storage: {
            from(bucket: string) {
              return {
                async upload(
                  path: string,
                  bytes: Uint8Array,
                  options: Record<string, unknown>,
                ) {
                  uploadCalls.push({ bucket, path, bytes, options })
                  if (storageUploadThrows) {
                    throw new DOMException("request timed out", "TimeoutError")
                  }
                  return {
                    data: storageUploadError ? null : { path },
                    error: storageUploadError,
                  }
                },
                async remove(paths: string[]) {
                  removeCalls.push({ bucket, paths })
                  if (storageRemoveThrows) {
                    throw new DOMException("request timed out", "TimeoutError")
                  }
                  return { data: [], error: storageRemoveError }
                },
              }
            },
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/portal-logo-route.spec.ts"),
)
const routeModule = testRequire(
  resolve(process.cwd(), "src/app/api/portal/[slug]/logo/route.ts"),
) as RouteModule
const { POST } = routeModule
nodeModule._load = originalModuleLoad

async function validLogo(): Promise<Uint8Array> {
  return Uint8Array.from(
    await sharp({
      create: {
        width: 320,
        height: 160,
        channels: 4,
        background: { r: 28, g: 60, b: 140, alpha: 0.9 },
      },
    })
      .png()
      .toBuffer(),
  )
}

async function request(
  options: {
    bytes?: Uint8Array
    expectedVersion?: string
    origin?: string | null
    fetchSite?: string | null
  } = {},
) {
  const form = new FormData()
  const bytes = options.bytes ?? (await validLogo())
  form.set("file", new File([Uint8Array.from(bytes).buffer], "logo.png"))
  form.set("expectedVersion", options.expectedVersion ?? "7")
  form.set("primaryColor", "#1C3C8C")
  form.set("accentColor", "#F4B942")
  form.set("logoAltText", "Hope Creates logo")
  form.set("openingHeaderHtml", "<h2>Welcome</h2>")
  form.set("aboutBiographyHtml", "<p>We help families.</p>")
  form.set("changeReason", "Upload the approved portal logo.")

  const headers = new Headers({ host: "creatorshare.com" })
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN)
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin")
  }
  return new Request(`${ORIGIN}/api/portal/hope/logo`, {
    method: "POST",
    headers,
    body: form,
  })
}

async function post(requestValue: Request) {
  return POST(requestValue, { params: Promise.resolve({ slug: "hope" }) })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

test.beforeEach(() => {
  currentUser = { id: ACTOR_ID }
  updateResult = { data: 8, error: null }
  reserveResult = {
    data: [
      {
        reservation_id: RESERVATION_ID,
        object_path: RESERVATION_PATH,
        expires_at: "2026-07-19T00:00:00.000Z",
      },
    ],
    error: null,
  }
  inspectResult = {
    data: [
      {
        status: "pending",
        object_path: RESERVATION_PATH,
        expected_version: 7,
        resulting_version: null,
      },
    ],
    error: null,
  }
  storageUploadError = null
  storageRemoveError = null
  storageUploadThrows = false
  storageRemoveThrows = false
  createClientCalls = 0
  serviceClientCalls = 0
  portalAccess = accessRow()
  serviceClientOptionsCalls.length = 0
  rpcCalls.length = 0
  uploadCalls.length = 0
  removeCalls.length = 0
})

test.describe("advocate portal logo route", () => {
  test("declares matching foreground execution limits", () => {
    const vercel = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      functions?: Record<string, { maxDuration?: number }>
    }

    expect(routeModule.maxDuration).toBe(60)
    expect(
      vercel.functions?.["src/app/api/portal/[slug]/logo/route.ts"]
        ?.maxDuration,
    ).toBe(60)
  })

  test("rejects cross-origin multipart before authentication or decoding", async () => {
    for (const options of [
      { origin: "https://attacker.example" },
      { origin: "https://hope.creatorshare.com" },
      { origin: null },
      { fetchSite: "cross-site" },
    ]) {
      const response = await post(await request(options))
      expect(response.status).toBe(400)
    }
    expect(createClientCalls).toBe(0)
    expect(serviceClientCalls).toBe(0)
  })

  test("settles undecodable source bytes before privileged storage access", async () => {
    const response = await post(
      await request({ bytes: Uint8Array.from([1, 2, 3, 4]) }),
    )
    expect(response.status).toBe(400)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "invalid_source",
    })
    expect(serviceClientCalls).toBe(1)
    expect(uploadCalls).toHaveLength(0)
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "get_my_advocate_portal_access",
      "reserve_advocate_logo_upload",
      "settle_advocate_logo_upload_reservation",
    ])
  })

  test("rejects unauthenticated and read-only users before reservations", async () => {
    currentUser = null
    const unauthenticated = await post(await request())
    expect(unauthenticated.status).toBe(401)
    expect(serviceClientCalls).toBe(0)

    currentUser = { id: ACTOR_ID }
    portalAccess = { ...accessRow(), permissions: ["portal.view"] }
    const readOnly = await post(await request())
    expect(readOnly.status).toBe(403)
    expect(serviceClientCalls).toBe(0)
    expect(uploadCalls).toHaveLength(0)
  })

  test("rejects suspended portals before reading or processing the body", async () => {
    portalAccess = {
      ...accessRow(),
      relationship_status: "suspended",
      publication_status: "suspended",
    }
    const response = await post(await request())
    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "forbidden",
    })
    expect(serviceClientCalls).toBe(0)
    expect(uploadCalls).toHaveLength(0)
  })

  test("rejects stale editors before decoding or privileged storage access", async () => {
    const response = await post(await request({ expectedVersion: "6" }))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "version_conflict",
    })
    expect(serviceClientCalls).toBe(0)
    expect(uploadCalls).toHaveLength(0)
  })

  test("uploads one immutable WebP and atomically attaches its exact path", async () => {
    const response = await post(await request())
    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({
      ok: true,
      advocateVersion: 8,
    })
    expect(uploadCalls).toHaveLength(1)
    expect(serviceClientOptionsCalls).toEqual([
      { requestTimeoutMilliseconds: 15_000 },
    ])
    expect(uploadCalls[0].bucket).toBe("advocate-assets")
    expect(uploadCalls[0].path).toBe(RESERVATION_PATH)
    expect(uploadCalls[0].options).toEqual({
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: false,
    })
    expect((await sharp(uploadCalls[0].bytes).metadata()).format).toBe("webp")

    const update = rpcCalls.find(
      (call) => call.name === "update_advocate_branding",
    )
    expect(update?.input.target_logo_storage_path).toBe(uploadCalls[0].path)
    expect(update?.input.target_logo_upload_reservation_id).toBe(RESERVATION_ID)
    expect(update?.input.target_actor_user_id).toBe(ACTOR_ID)
    expect(update?.input.expected_advocate_version).toBe(7)
    expect(removeCalls).toHaveLength(0)
  })

  test("compensates the new object when the version fence loses", async () => {
    updateResult = { data: null, error: { code: "40001" } }
    const response = await post(await request())
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "version_conflict",
    })
    expect(uploadCalls).toHaveLength(1)
    expect(removeCalls).toEqual([
      { bucket: "advocate-assets", paths: [uploadCalls[0].path] },
    ])
    expect(
      rpcCalls.find(
        (call) => call.name === "settle_advocate_logo_upload_reservation",
      )?.input,
    ).toMatchObject({
      target_reservation_id: RESERVATION_ID,
      target_status: "cancelled",
      failure_code: "branding_40001",
    })
  })

  test("never mutates branding when storage does not confirm the exact path", async () => {
    storageUploadError = { message: "sensitive provider detail" }
    const response = await post(await request())
    expect(response.status).toBe(500)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "logo_upload_failed",
    })
    expect(
      rpcCalls.filter((call) => call.name === "update_advocate_branding"),
    ).toHaveLength(0)
    expect(removeCalls).toHaveLength(1)
    expect(
      rpcCalls.find(
        (call) => call.name === "settle_advocate_logo_upload_reservation",
      )?.input,
    ).toMatchObject({
      target_status: "cancelled",
      failure_code: "storage_upload_failed",
    })
  })

  test("compensates after a storage upload timeout", async () => {
    storageUploadThrows = true
    const response = await post(await request())

    expect(response.status).toBe(500)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "logo_upload_failed",
    })
    expect(removeCalls).toEqual([
      { bucket: "advocate-assets", paths: [RESERVATION_PATH] },
    ])
    expect(
      rpcCalls.find(
        (call) => call.name === "settle_advocate_logo_upload_reservation",
      )?.input,
    ).toMatchObject({
      target_status: "cancelled",
      failure_code: "storage_upload_failed",
    })
  })

  test("preserves timed-out storage cleanup for durable reconciliation", async () => {
    storageUploadThrows = true
    storageRemoveThrows = true
    const response = await post(await request())

    expect(response.status).toBe(500)
    expect(await json(response)).toMatchObject({
      ok: false,
      code: "logo_upload_failed",
    })
    expect(removeCalls).toEqual([
      { bucket: "advocate-assets", paths: [RESERVATION_PATH] },
    ])
    expect(
      rpcCalls.find(
        (call) => call.name === "settle_advocate_logo_upload_reservation",
      )?.input,
    ).toMatchObject({
      target_status: "cleanup_required",
      failure_code: "storage_upload_failed",
    })
  })

  test("maps durable single-flight and rate limits before image processing", async () => {
    reserveResult = { data: null, error: { code: "55000" } }
    const pending = await post(await request())
    expect(pending.status).toBe(409)
    expect(await json(pending)).toMatchObject({
      ok: false,
      code: "upload_in_progress",
    })
    expect(uploadCalls).toHaveLength(0)

    reserveResult = { data: null, error: { code: "54000" } }
    const limited = await post(await request())
    expect(limited.status).toBe(429)
    expect(await json(limited)).toMatchObject({
      ok: false,
      code: "rate_limited",
    })
    expect(uploadCalls).toHaveLength(0)
  })

  test("recovers an attached commit after an ambiguous database response", async () => {
    updateResult = { data: { unexpected: true }, error: null }
    inspectResult = {
      data: [
        {
          status: "attached",
          object_path: RESERVATION_PATH,
          expected_version: 7,
          resulting_version: 8,
        },
      ],
      error: null,
    }
    const recovered = await post(await request())
    expect(recovered.status).toBe(200)
    expect(await json(recovered)).toMatchObject({
      ok: true,
      advocateVersion: 8,
    })
    expect(removeCalls).toHaveLength(0)
  })

  test("preserves ambiguous pending work for durable reconciliation", async () => {
    updateResult = { data: { unexpected: true }, error: null }
    const pending = await post(await request())
    expect(pending.status).toBe(503)
    expect(await json(pending)).toMatchObject({
      ok: false,
      code: "logo_reconciliation_pending",
    })
    expect(removeCalls).toHaveLength(0)
    expect(
      rpcCalls.filter(
        (call) => call.name === "settle_advocate_logo_upload_reservation",
      ),
    ).toHaveLength(0)
  })
})
