import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const userId = "0f000000-0000-4000-8000-000000000002"
const calls: Array<Record<string, unknown>> = []
let rpcError: { code: string; message: string } | null = null
let rpcData: unknown = { disabled_count: 1 }
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown }
const original = loader._load
const testRequire = createRequire(resolve(process.cwd(), "tests/admin/account-offboarding-route.spec.ts"))
const cachedBefore = new Set(Object.keys(testRequire.cache))
let single: typeof import("../../src/app/api/admin/users/[id]/route")
let bulk: typeof import("../../src/app/api/admin/users/bulk-delete/route")
try {
  loader._load = (name, ...args) => {
    if (name === "server-only") return {}
    if (name === "@/utils/supabase/server") return {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "0f000000-0000-4000-8000-000000000001" } } }) },
        rpc: async (name: string, args: Record<string, unknown>) => {
          expect(name).toBe("offboard_creator_share_accounts")
          calls.push(args)
          return { data: rpcData, error: rpcError }
        },
        from: (table: string) => {
          expect(table).toBe("role_assignments")
          return { select: () => ({ eq: async () => ({ data: [{ roles: { name: "SUPER_ADMIN" } }], error: null }) }) }
        },
      }),
    }
    return original.call(Module, name, ...args)
  }
  single = testRequire("../../src/app/api/admin/users/[id]/route")
  bulk = testRequire("../../src/app/api/admin/users/bulk-delete/route")
} finally {
  loader._load = original
  for (const key of Object.keys(testRequire.cache)) if (!cachedBefore.has(key)) delete testRequire.cache[key]
}
function request(method: string, ids: unknown = [userId], origin = "https://creatorshare.com") {
  return new Request("https://creatorshare.com/api/admin/users/bulk-delete", {
    method, headers: { host: "creatorshare.com", origin, "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify({ ids }) } : {}),
  })
}
test.beforeEach(() => { calls.length = 0; rpcError = null; rpcData = { disabled_count: 1 } })

test("single and bulk account disablement use only the authenticated atomic command", async () => {
  const one = await single.DELETE(request("DELETE"), { params: Promise.resolve({ id: userId }) })
  const many = await bulk.POST(request("POST", [userId, userId.toUpperCase()]))
  expect(one.status).toBe(200)
  expect(many.status).toBe(200)
  expect(many.headers.get("cache-control")).toBe("no-store")
  expect(calls).toHaveLength(2)
  for (const call of calls) {
    expect(call.target_user_ids).toEqual([userId])
    expect(call.request_id).toMatch(/^[a-f0-9-]{36}$/)
  }
  expect(calls[0].request_id).not.toBe(calls[1].request_id)
})

test("ownership conflicts return a useful error without falling back to profile deletion", async () => {
  rpcError = { code: "55000", message: "private-provider-detail" }
  const response = await bulk.POST(request("POST"))
  expect(response.status).toBe(409)
  const body = await response.text()
  expect(body).toContain("Transfer Advocate ownership")
  expect(body).not.toContain("private-provider-detail")
  expect(calls).toHaveLength(1)
})

test("rejects malformed and oversized selections before the database command", async () => {
  for (const ids of [[], ["invalid"], Array(501).fill(userId), ["x".repeat(33000)]]) {
    expect((await bulk.POST(request("POST", ids))).status).toBe(400)
  }
  expect(calls).toHaveLength(0)
})

test("cross-origin requests cannot disable an account", async () => {
  expect((await bulk.POST(request("POST", [userId], "https://attacker.example"))).status).toBe(400)
  expect(calls).toHaveLength(0)
})

test("does not report success for an incomplete or ambiguous database result", async () => {
  for (const data of [null, {}, { disabled_count: 0 }, { disabled_count: "1" }]) {
    rpcData = data
    expect((await bulk.POST(request("POST"))).status).toBe(503)
  }
})


test("the account store does not retry a rejected batch or accept an incomplete success", async () => {
  const { useUserManagementStore } = testRequire("../../src/store/userManagementStore") as typeof import("../../src/store/userManagementStore")
  const previousFetch = globalThis.fetch
  const previousState = useUserManagementStore.getState()
  const requested: string[] = []
  try {
    for (const [status, body] of [[409, { error: "Transfer ownership first" }], [200, { success: true, disabled_count: 0 }]] as const) {
      requested.length = 0
      globalThis.fetch = async input => {
        requested.push(String(input))
        return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
      }
      await expect(useUserManagementStore.getState().disableAccounts([userId])).rejects.toThrow()
      expect(requested).toEqual(["/api/admin/users/bulk-delete"])
      expect(useUserManagementStore.getState().loading).toBe(false)
    }
  } finally {
    globalThis.fetch = previousFetch
    useUserManagementStore.setState(previousState, true)
  }
})
