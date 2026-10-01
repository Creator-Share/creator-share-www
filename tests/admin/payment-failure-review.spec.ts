import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const userId = "0f000000-0000-4000-8000-000000000002"
const calls: Array<Record<string, unknown>> = []
const recoveryCalls: Array<Record<string, unknown>> = []
let recoveryResult: Record<string, unknown> = { admitted: true, processingStatus: "received", replay: false }
let recoveryError: Error | null = null
let recoveryRoute: typeof import("../../src/app/api/internal/payments/gateway-event-recovery/route")
let RecoveryError: typeof import("../../src/lib/sponsorships/gateways/paymentGatewayRecovery").GatewayRecoveryError
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
    if (name === "@/lib/sponsorships/gateways/paymentGatewayEventConfig") return {
      loadPaymentGatewayEventWorkerSecret: () => "recovery-test-secret-".repeat(3),
    }
    if (name === "@/lib/sponsorships/gateways/paymentGatewayRecoveryRuntime") return {
      recoverPaymentGatewayEventFromEnvironment: async (eventId: string, operationId: string, requestId: string) => {
        recoveryCalls.push({ eventId, operationId, requestId })
        if (recoveryError) throw recoveryError
        return recoveryResult
      },
    }
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
  recoveryRoute = testRequire("../../src/app/api/internal/payments/gateway-event-recovery/route")
  RecoveryError = testRequire("../../src/lib/sponsorships/gateways/paymentGatewayRecovery").GatewayRecoveryError
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
test.beforeEach(() => { recoveryCalls.length = 0; recoveryError = null;
  recoveryResult = { admitted: true, processingStatus: "received", replay: false }; calls.length = 0; rpcError = null; rpcData = { acknowledged: true, resolved: false } })

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
    expired_final_leases: 1, payloads_expiring_within_seven_days: 0, payloads_unavailable: 1,
    cash_without_gateway_event: 0, stale_cash_without_gateway_event: 0 }
  rpcData = { ...healthy, provider_event_id: "private-event" }
  expect(await runtime.readPaymentFailureHealth()).toEqual(healthy)
  for (const data of [null, [], {}, { ...healthy, unresolved: "3" }, { ...healthy, unacknowledged: 4 },
    { ...healthy, stale_cash_without_gateway_event: 1 },
    { ...healthy, cash_without_gateway_event: undefined }, { ...healthy, exhausted: -1 }, { ...healthy, quarantined: 2 }, { ...healthy, payloads_unavailable: 4 },
    { ...healthy, unresolved: Number.MAX_SAFE_INTEGER + 1 }]) {
    rpcData = data
    await expect(runtime.readPaymentFailureHealth()).rejects.toThrow("Payment failure health unavailable")
  }
  rpcData = healthy
  rpcError = { code: "XX000", message: "private database detail" }
  await expect(runtime.readPaymentFailureHealth()).rejects.toThrow("Payment failure health unavailable")
})


const recoveryInput = { eventId: userId, operationId: "0f000000-0000-4000-8000-000000000003" }
function recoveryRequest(body: unknown = recoveryInput, authorized = true) {
  return new Request("https://creatorshare.com/api/internal/payments/gateway-event-recovery", {
    method: "POST", headers: { authorization: authorized ? "Bearer " + "recovery-test-secret-".repeat(3) : "Bearer wrong",
      "content-type": "application/json" }, body: JSON.stringify(body),
  })
}

test("operator recovery requires the worker credential and strict operation identities", async () => {
  expect((await recoveryRoute.POST(recoveryRequest(recoveryInput, false))).status).toBe(401)
  for (const body of [null, [], {}, { ...recoveryInput, operationId: "bad" }, { ...recoveryInput, eventId: "bad" },
    { ...recoveryInput, payload: "untrusted financial facts" }, { ...recoveryInput, padding: "x".repeat(1024) }]) {
    expect((await recoveryRoute.POST(recoveryRequest(body))).status).toBe(400)
  }
  expect(recoveryCalls).toEqual([])
  expect("GET" in recoveryRoute).toBe(false)
})

test("operator recovery preserves retry identity and returns only categorical admission state", async () => {
  recoveryResult = { ...recoveryResult, providerEvidence: "private provider details" }
  const initial = await recoveryRoute.POST(recoveryRequest())
  expect(initial.status).toBe(202)
  expect(initial.headers.get("cache-control")).toBe("no-store")
  expect(await initial.json()).toEqual({ ok: true, admitted: true, processingStatus: "received", replay: false,
    requestId: expect.any(String) })
  recoveryResult = { admitted: true, processingStatus: "processed", replay: true }
  expect((await recoveryRoute.POST(recoveryRequest())).status).toBe(200)
  expect(recoveryCalls).toHaveLength(2)
  expect(recoveryCalls.every(call => call.eventId === recoveryInput.eventId && call.operationId === recoveryInput.operationId)).toBe(true)
  expect(recoveryCalls[0].requestId).not.toBe(recoveryCalls[1].requestId)
})

test("operator recovery errors remain categorical and do not disclose provider details", async () => {
  for (const [code, status] of [["not_found", 404], ["conflict", 409], ["expired", 422], ["incomplete", 422],
    ["unsupported", 422], ["outcome_unknown", 503]] as const) {
    recoveryError = new RecoveryError(code)
    const result = await recoveryRoute.POST(recoveryRequest())
    expect(result.status).toBe(status)
    expect(await result.json()).toEqual({ ok: false, code, requestId: expect.any(String) })
  }
  recoveryError = new Error("private provider details")
  expect(await (await recoveryRoute.POST(recoveryRequest())).text()).not.toContain("private provider")
})

test("aborted operator bodies stop before execution even when producer cancellation stalls", async () => {
  const controller = new AbortController()
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new TextEncoder().encode('{"eventId":')) },
    cancel() { canceled = true; return new Promise<void>(() => {}) },
  })
  const request = new Request("https://creatorshare.com/api/internal/payments/gateway-event-recovery", {
    method: "POST", headers: { authorization: "Bearer " + "recovery-test-secret-".repeat(3) },
    body, signal: controller.signal, duplex: "half",
  } as RequestInit & { duplex: "half" })
  const pending = recoveryRoute.POST(request)
  controller.abort()
  expect((await pending).status).toBe(400)
  expect(canceled).toBe(true)
  expect(recoveryCalls).toEqual([])
})
