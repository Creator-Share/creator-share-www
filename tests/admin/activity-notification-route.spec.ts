import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { NextRequest, NextResponse } from "next/server"

const testRequire = createRequire(resolve(process.cwd(), "tests/admin/activity-notification-route.spec.ts"))
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown }

async function exercise(options: {
  outcomes?: Array<"accepted" | "failed" | "thrown">
  wrongChild?: boolean
  audienceError?: boolean
  authorized?: boolean
} = {}) {
  const original = loader._load
  const originalConsole = console.error
  const cachedBefore = new Set(Object.keys(testRequire.cache))
  const routePath = testRequire.resolve("../../src/app/api/admin/activities/notify/route")
  const oldRoute = testRequire.cache[routePath]
  delete testRequire.cache[routePath]
  let calls = 0
  let reads = 0
  const email = { sendActivityNotificationEmail: async () => {
    const outcome = options.outcomes?.[calls] ?? "accepted"
    calls += 1
    if (outcome === "thrown") throw new Error("private provider failure")
    return { success: outcome === "accepted" }
  } }
  try {
    console.error = () => {}
    loader._load = (name, ...args) => {
      if (name === "server-only") return {}
      if (name === "@/utils/email") return email
      if (name === "@/utils/auth/requireSuperAdminRequest") return {
        requireSuperAdminRequest: async () => options.authorized === false
          ? { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
          : { ok: true },
      }
      if (name === "@/utils/supabase/server") return {
        createClient: async () => ({ from: (table: string) => {
          reads += 1
          const filters = new Map<string, unknown>()
          const result = () => {
            if (table === "activities") return { data: options.wrongChild && filters.get("beneficiary_id") === "other"
              ? null : { id: "activity", beneficiary_id: "child", created_by: "admin", title: "Update", description: "News" } }
            if (table === "beneficiaries") return { data: { name: "Child" } }
            if (table === "activity_subscriptions") return { data: [{ email: "first@example.test" }, { email: "second@example.test" }], error: options.audienceError ? { message: "private database error" } : null }
            return { data: [], error: null }
          }
          const query = {
            select: () => query,
            eq: (key: string, value: unknown) => { filters.set(key, value); return query },
            not: () => query,
            in: () => query,
            or: () => query,
            single: async () => result(),
            then: (resolveResult: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolveResult),
          }
          return query
        } }),
      }
      return original.call(Module, name, ...args)
    }
    const { POST } = testRequire(routePath) as typeof import("../../src/app/api/admin/activities/notify/route")
    const response = await POST(new NextRequest("https://creatorshare.com/api/admin/activities/notify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityId: "activity", beneficiaryId: options.wrongChild ? "other" : "child", selectedSponsorshipIds: [] }),
    }))
    return { status: response.status, body: await response.json(), calls, reads }
  } finally {
    loader._load = original
    console.error = originalConsole
    if (oldRoute) testRequire.cache[routePath] = oldRoute
    else delete testRequire.cache[routePath]
    for (const key of Object.keys(testRequire.cache)) if (!cachedBefore.has(key)) delete testRequire.cache[key]
  }
}

test("notification counts represent accepted transport results", async () => {
  expect(await exercise({ outcomes: ["accepted", "failed"] })).toMatchObject({
    status: 200, calls: 2, body: { success: false, emailsSent: 1, emailsFailed: 1 },
  })
  expect(await exercise({ outcomes: ["failed", "thrown"] })).toMatchObject({
    status: 200, calls: 2, body: { success: false, emailsSent: 0, emailsFailed: 2 },
  })
  expect(await exercise()).toMatchObject({
    status: 200, calls: 2, body: { success: true, emailsSent: 2, emailsFailed: 0 },
  })
})

test("activity and audience must belong to the same child", async () => {
  expect(await exercise({ wrongChild: true })).toMatchObject({ status: 404, calls: 0 })
})

test("an unavailable audience never produces a partial send or raw error", async () => {
  expect(await exercise({ audienceError: true })).toMatchObject({
    status: 503, calls: 0, body: { error: "Notification audience unavailable" },
  })
})

test("unauthorized requests cannot query an audience or send mail", async () => {
  expect(await exercise({ authorized: false })).toMatchObject({ status: 401, calls: 0, reads: 0 })
})
