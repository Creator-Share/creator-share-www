import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const userId = "0f000000-0000-4000-8000-000000000002"
const calls: Array<Record<string, unknown>> = []
let rpcError: { code: string; message: string } | null = null
let rpcData: unknown = { acknowledged: true, resolved: false }
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown }
const original = loader._load
const testRequire = createRequire(resolve(process.cwd(), "tests/admin/payment-failure-review.spec.ts"))
const cachedBefore = new Set(Object.keys(testRequire.cache))
let runtime: typeof import("../../src/lib/sponsorships/gateways/paymentGatewayEventRuntime")
let route: typeof import("../../src/app/api/admin/payment-failures/acknowledge/route")
try {
  loader._load = (name, ...args) => {
    if (name === "server-only") return {}
    if (["@/lib/sponsorships/crypto", "@/lib/sponsorships/gateways/paymentGatewayEventRepository",
      "@/app/api/webhooks/stripe/handler"].includes(name)) return {}
    if (name === "@/utils/supabase/server") return {
      createServiceRoleClient: () => ({ rpc: async (name: string) => {
        expect(name).toBe("get_payment_failure_health")
        return { data: rpcData, error: rpcError }
      } }),
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "0f000000-0000-4000-8000-000000000001" } } }) },
        rpc: async (name: string, args: Record<string, unknown>) => {
          expect(name).toBe("acknowledge_payment_failure")
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
  route = testRequire("../../src/app/api/admin/payment-failures/acknowledge/route")
  runtime = testRequire("../../src/lib/sponsorships/gateways/paymentGatewayEventRuntime")
} finally {
  loader._load = original
  for (const key of Object.keys(testRequire.cache)) if (!cachedBefore.has(key)) delete testRequire.cache[key]
}
const input = { eventId: userId, failureVersion: "ab".repeat(32), reason: "investigating" }
function request(body: unknown = input, origin = "https://creatorshare.com") {
  return new Request("https://creatorshare.com/api/admin/payment-failures/acknowledge", {
    method: "POST", headers: { host: "creatorshare.com", origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
test.beforeEach(() => { calls.length = 0; rpcError = null; rpcData = { acknowledged: true, resolved: false } })

test("acknowledgment binds observed failure evidence and a server-issued request identity", async () => {
  const response = await route.POST(request({ ...input, requestId: userId }))
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toEqual({ acknowledged: true, resolved: false })
  expect(calls[0]).toMatchObject({ target_event_id: userId, expected_failure_version: input.failureVersion, reason_code: "investigating" })
  expect(calls[0].request_id).toMatch(/^[a-f0-9-]{36}$/)
  expect(calls[0].request_id).not.toBe(userId)
})

test("stale evidence and revoked authority fail without leaking database details", async () => {
  for (const [code, status] of [["40001", 409], ["42501", 403], ["XX000", 503]] as const) {
    rpcError = { code, message: "private provider evidence" }
    const response = await route.POST(request())
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain("private provider")
  }
})

test("malformed and oversized acknowledgment bodies never reach the database", async () => {
  for (const value of [null, [], { ...input, eventId: "bad" }, { ...input, failureVersion: "bad" },
    { ...input, reason: "retry_payment" }, { ...input, reason: null }, { ...input, ignored: "x".repeat(2048) }]) {
    expect((await route.POST(request(value))).status).toBe(400)
  }
  expect(calls).toEqual([])
})

test("cross-origin acknowledgment is rejected before the command", async () => {
  expect((await route.POST(request(input, "https://other.example"))).status).toBe(400)
  expect(calls).toEqual([])
})

test("ambiguous or financially resolved responses are never reported as acknowledgment success", async () => {
  for (const data of [null, {}, { acknowledged: true }, { acknowledged: true, resolved: true }]) {
    rpcData = data
    const response = await route.POST(request())
    expect(response.status).toBe(503)
  }
})


test("health projection rejects inconsistent counts and strips unexpected private fields", async () => {
  const healthy = { unresolved: 3, unacknowledged: 2, quarantined: 1, exhausted: 1,
    expired_final_leases: 1, payloads_expiring_within_seven_days: 0, payloads_unavailable: 1 }
  rpcData = { ...healthy, provider_event_id: "private-event" }
  expect(await runtime.readPaymentFailureHealth()).toEqual(healthy)
  for (const data of [null, [], {}, { ...healthy, unresolved: "3" }, { ...healthy, unacknowledged: 4 },
    { ...healthy, exhausted: -1 }, { ...healthy, quarantined: 2 }, { ...healthy, payloads_unavailable: 4 },
    { ...healthy, unresolved: Number.MAX_SAFE_INTEGER + 1 }]) {
    rpcData = data
    await expect(runtime.readPaymentFailureHealth()).rejects.toThrow("Payment failure health unavailable")
  }
  rpcData = healthy
  rpcError = { code: "XX000", message: "private database detail" }
  await expect(runtime.readPaymentFailureHealth()).rejects.toThrow("Payment failure health unavailable")
})
