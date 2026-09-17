import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

let signedIn = false
let administrator = false
let providerCalls = 0
let databaseWrites = 0
const loader = Module as unknown as {
  _load: (name: string, ...args: unknown[]) => unknown
}
const original = loader._load
const testRequire = createRequire(resolve(process.cwd(), "tests/auth/diagnostic-route-authorization.spec.ts"))
const cachedBefore = new Set(Object.keys(testRequire.cache))
let email: typeof import("../../src/app/api/test/payment-failed-email/route")
let telegram: typeof import("../../src/app/api/test/telegram/route")
let child: typeof import("../../src/app/api/test/create-child/route")
try {
  loader._load = (name, ...args) => {
    if (name === "server-only") return {}
    if (name === "@/utils/email") return {
      sendPaymentFailedEmail: async () => { providerCalls += 1; return { sent: true } },
    }
    if (name === "@/services/telegram") return {
      createTelegramService: () => ({ sendMessage: async () => { providerCalls += 1; return true } }),
      notifyChildCreated: async () => { providerCalls += 1 },
    }
    if (name === "@/utils/supabase/server") return {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: signedIn ? { id: "11111111-1111-4111-8111-111111111111" } : null } }) },
        from: (table: string) => {
          if (table === "role_assignments") return {
            select: () => ({ eq: async () => ({ data: administrator ? [{ roles: { name: "SUPER_ADMIN" } }] : [], error: null }) }),
          }
          return { insert: () => {
            databaseWrites += 1
            return { select: () => ({ single: async () => ({ data: null, error: { message: "fixture write denied" } }) }) }
          } }
        },
      }),
    }
    return original.call(Module, name, ...args)
  }
  email = testRequire("../../src/app/api/test/payment-failed-email/route")
  telegram = testRequire("../../src/app/api/test/telegram/route")
  child = testRequire("../../src/app/api/test/create-child/route")
} finally {
  loader._load = original
  for (const key of Object.keys(testRequire.cache)) {
    if (!cachedBefore.has(key)) delete testRequire.cache[key]
  }
}

function request(method: "GET" | "POST", origin = "https://creatorshare.com"): Request {
  return new Request("https://creatorshare.com/api/test/payment-failed-email?email=fixture@example.test", {
    method,
    headers: { host: "creatorshare.com", origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    ...(method === "POST" ? { body: "{}" } : {}),
  })
}

async function allRequests(origin?: string): Promise<Response[]> {
  return [
    await email.GET(request("GET", origin)),
    await telegram.POST(request("POST", origin)),
    await telegram.GET(request("GET", origin)),
    await child.POST(request("POST", origin)),
    await child.GET(request("GET", origin)),
  ]
}

test.beforeEach(() => {
  signedIn = false
  administrator = false
  providerCalls = 0
  databaseWrites = 0
})

test("diagnostic routes deny anonymous callers before provider or database mutation", async () => {
  const responses = await allRequests()
  expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401, 401])
  expect(providerCalls).toBe(0)
  expect(databaseWrites).toBe(0)
})

test("diagnostic routes require a Creator Share super administrator", async () => {
  signedIn = true
  const responses = await allRequests()
  expect(responses.map(response => response.status)).toEqual([403, 403, 403, 403, 403])
  expect(providerCalls).toBe(0)
  expect(databaseWrites).toBe(0)
})

test("diagnostic routes reject cross-origin requests even for an administrator", async () => {
  signedIn = true
  administrator = true
  const responses = await allRequests("https://outside.example")
  expect(responses.map(response => response.status)).toEqual([400, 400, 400, 400, 400])
  expect(providerCalls).toBe(0)
  expect(databaseWrites).toBe(0)
})

test("authorized same-origin diagnostic email remains available", async () => {
  signedIn = true
  administrator = true
  expect((await email.GET(request("GET"))).status).toBe(200)
  expect(providerCalls).toBe(1)
})

test("diagnostic GET accepts same-origin fetches without Origin but rejects cross-site navigation", async () => {
  signedIn = true
  administrator = true
  const input = request("GET")
  input.headers.delete("origin")
  expect((await email.GET(input)).status).toBe(200)
  input.headers.set("sec-fetch-site", "cross-site")
  expect((await email.GET(input)).status).toBe(400)
  input.headers.set("sec-fetch-site", "none")
  expect((await email.GET(input)).status).toBe(400)
  expect(providerCalls).toBe(1)
})
