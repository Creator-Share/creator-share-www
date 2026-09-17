import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const subscriptionId = "11111111-1111-4111-8111-111111111111"
const beneficiaryId = "22222222-2222-4222-8222-222222222222"
const calls: Array<{ name: string; args: Record<string, unknown> }> = []
let authenticated = true
let replay = false
let rpcError: { code: string } | null = null
let sentEmails = 0
const loader = Module as unknown as {
  _load: (name: string, ...args: unknown[]) => unknown
}
const original = loader._load
const testRequire = createRequire(resolve(process.cwd(), "tests/sponsorships/self-assignment-route.spec.ts"))
const cachedBefore = new Set(Object.keys(testRequire.cache))
let post: typeof import("../../src/app/api/sponsorships/self-assign/route").POST
try {
  loader._load = (name, ...args) => {
    if (name === "server-only") return {}
    if (name === "@/utils/email") return {
      sendBlindSponsorshipMatchedEmail: async () => { sentEmails += 1 },
    }
    if (name === "@/utils/supabase/server") return {
      createClient: async () => ({
        auth: { getUser: async () => ({
          data: { user: authenticated ? { id: subscriptionId, email: "sponsor@example.test" } : null },
          error: null,
        }) },
        rpc: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args })
          return { error: rpcError, data: [{
            assignment_id: beneficiaryId,
            subscription_id: subscriptionId,
            beneficiary_id: beneficiaryId,
            beneficiary_name: "Example child",
            beneficiary_username: "example-child",
            subscription_amount_usd_cents: 2500,
            billing_interval: "month",
            was_already_assigned: replay,
          }] }
        },
        from: () => ({ select: () => ({ eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }) }) }),
      }),
    }
    return original.call(Module, name, ...args)
  }
  ;({ POST: post } = testRequire("../../src/app/api/sponsorships/self-assign/route"))
} finally {
  loader._load = original
  for (const key of Object.keys(testRequire.cache)) {
    if (!cachedBefore.has(key)) delete testRequire.cache[key]
  }
}

function request(body: unknown = { subscriptionId, beneficiaryId }): Request {
  return new Request("https://creatorshare.com/api/sponsorships/self-assign", {
    method: "POST",
    headers: { host: "creatorshare.com", origin: "https://creatorshare.com", "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

test.beforeEach(() => {
  calls.length = 0
  authenticated = true
  replay = false
  rpcError = null
  sentEmails = 0
})

test("assignment rejects untrusted origins and form content before mutation", async () => {
  for (const [header, value] of [
    ["origin", "https://outside.example"],
    ["origin", "https://other.creatorshare.com"],
    ["content-type", "text/plain"],
    ["sec-fetch-site", "cross-site"],
  ]) {
    const input = request()
    input.headers.set(header, value)
    expect((await post(input)).status).toBe(400)
  }
  expect(calls).toEqual([])
  expect(sentEmails).toBe(0)
})

test("assignment bounds actual bytes when content length is absent or dishonest", async () => {
  for (const declaredLength of [null, "1"]) {
    const input = request({ subscriptionId, beneficiaryId, padding: "é".repeat(4096) })
    if (declaredLength !== null) input.headers.set("content-length", declaredLength)
    expect((await post(input)).status).toBe(400)
  }
  expect(calls).toEqual([])
  expect(sentEmails).toBe(0)
})

test("assignment rejects malformed identifiers and unauthenticated callers", async () => {
  expect((await post(request({ subscriptionId: "invalid", beneficiaryId }))).status).toBe(400)
  authenticated = false
  expect((await post(request())).status).toBe(401)
  expect(calls).toEqual([])
})

test("assignment preserves database ownership denial without sending mail", async () => {
  rpcError = { code: "42501" }
  expect((await post(request())).status).toBe(403)
  expect(calls).toHaveLength(1)
  expect(sentEmails).toBe(0)
})

test("assignment invokes the authoritative RPC and sends mail only for a new assignment", async () => {
  const response = await post(request())
  expect(response.status).toBe(200)
  expect(calls[0].name).toBe("assign_blind_sponsorship_beneficiary")
  expect(calls[0].args).toMatchObject({ target_subscription_id: subscriptionId, target_beneficiary_id: beneficiaryId })
  expect(calls[0].args.context_request_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(sentEmails).toBe(1)
  replay = true
  expect((await post(request())).status).toBe(200)
  expect(sentEmails).toBe(1)
})
