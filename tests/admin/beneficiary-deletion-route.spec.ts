import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const childId = "bd100000-0000-4000-8000-000000000002"
const media = { id: "bd300000-0000-4000-8000-000000000002", parent_id: childId, type: "IMAGE", extension: "jpg" }
const events: string[] = []
const calls: Array<Record<string, unknown>> = []
let rpcError: { code: string; message: string } | null = null
let rpcData: unknown = { deleted_count: 1, media: [media] }
let storageFailure = false
let waitForRpc: Promise<void> | null = null
let rpcStarted: (() => void) | null = null
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown }
const original = loader._load
const testRequire = createRequire(resolve(process.cwd(), "tests/admin/beneficiary-deletion-route.spec.ts"))
const cachedBefore = new Set(Object.keys(testRequire.cache))
let single: typeof import("../../src/app/api/admin/beneficiaries/delete/[id]/route")
let bulk: typeof import("../../src/app/api/admin/beneficiaries/bulk-delete/route")
try {
  loader._load = (name, ...args) => {
    if (name === "server-only") return {}
    if (name === "@/utils/supabase/media") return {
      deleteFile: async () => { events.push("storage"); return { error: storageFailure ? new Error("fixture failure") : null } },
    }
    if (name === "@/utils/supabase/server") return {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: childId } } }) },
        rpc: async (name: string, args: Record<string, unknown>) => {
          expect(name).toBe("delete_creator_share_beneficiaries")
          events.push("rpc")
          calls.push(args)
          rpcStarted?.()
          if (waitForRpc) await waitForRpc
          return { data: rpcData, error: rpcError }
        },
        from: (table: string) => ({
          select: () => {
            const result = async () => ({ data: table === "role_assignments" ? [{ roles: { name: "SUPER_ADMIN" } }] : [media], error: null })
            return { eq: result, in: result }
          },
          delete: () => {
            const result = async () => { events.push(`delete:${table}`); return { error: table === "beneficiaries" ? rpcError : null } }
            return { eq: result, in: result }
          },
        }),
      }),
    }
    return original.call(Module, name, ...args)
  }
  single = testRequire("../../src/app/api/admin/beneficiaries/delete/[id]/route")
  bulk = testRequire("../../src/app/api/admin/beneficiaries/bulk-delete/route")
} finally {
  loader._load = original
  for (const key of Object.keys(testRequire.cache)) if (!cachedBefore.has(key)) delete testRequire.cache[key]
}

function request(method: string, ids: unknown = [childId]) {
  return new Request("https://creatorshare.com/api/admin/beneficiaries/bulk-delete", {
    method,
    headers: { host: "creatorshare.com", origin: "https://creatorshare.com", "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify({ ids }) } : {}),
  })
}

test.beforeEach(() => {
  events.length = 0
  calls.length = 0
  rpcError = null
  rpcData = { deleted_count: 1, media: [media] }
  storageFailure = false
  waitForRpc = null
  rpcStarted = null
})

test("rejected single and bulk deletion perform no storage or separate content writes", async () => {
  rpcError = { code: "23503", message: "fixture financial reference" }
  const one = await single.DELETE(request("DELETE"), { params: Promise.resolve({ id: childId }) })
  const many = await bulk.POST(request("POST"))
  expect(events).toEqual(["rpc", "rpc"])
  expect(one.status).toBe(409)
  expect(many.status).toBe(409)
})

test("storage cleanup waits for the atomic database result", async () => {
  let release!: () => void
  waitForRpc = new Promise(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { rpcStarted = resolve })
  const pending = bulk.POST(request("POST", [childId, childId]))
  await started
  expect(events).toEqual(["rpc"])
  release()
  expect((await pending).status).toBe(200)
  expect(events).toEqual(["rpc", "storage"])
  expect(calls[0].target_beneficiary_ids).toEqual([childId])
})

test("invalid identifiers cannot reach the database command", async () => {
  for (const ids of [[], ["invalid"], [null], Array(501).fill(childId)]) {
    expect((await bulk.POST(request("POST", ids))).status).toBe(400)
  }
  expect(events).toEqual([])
})

test("an unconfirmed result cannot initiate storage deletion", async () => {
  rpcData = null
  expect((await bulk.POST(request("POST"))).status).toBe(500)
  expect(events).toEqual(["rpc"])
})

test("storage failure after commit does not repeat the database deletion", async () => {
  storageFailure = true
  expect((await bulk.POST(request("POST"))).status).toBe(200)
  expect(events).toEqual(["rpc", "storage"])
})
