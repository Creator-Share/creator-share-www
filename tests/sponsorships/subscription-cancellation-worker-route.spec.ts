import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { NextRequest } from "next/server"
import { expect, test } from "@playwright/test"

/**
 * The subscription cancellation worker's authentication boundary.
 *
 * The bearer helper itself is well covered, including a null header. The
 * route's *use* of it was covered only by a source-text check that the file
 * contains the helper's name, which cannot see a changed call. A mutation
 * making the gate conditional on a header being present therefore left the
 * suite green, and an anonymous caller that simply omits `Authorization` would
 * run a full cancellation batch against live Stripe subscriptions.
 *
 * These tests drive the real exported handlers. The worker runtime records
 * whether it was reached, which is what makes "before any effect" an assertion
 * rather than an assumption.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const SECRET = "s".repeat(48)

let workerRuns = 0
let secretAvailable = true

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (
    request ===
    "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerConfig"
  ) {
    return {
      loadSubscriptionCancellationWorkerSecret() {
        if (!secretAvailable) throw new Error("worker_unavailable")
        return SECRET
      },
      loadSubscriptionCancellationWorkerConfig: () => ({ batchSize: 1 }),
    }
  }
  if (
    request ===
    "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerRuntime"
  ) {
    return {
      async runSubscriptionCancellationWorkerBatchFromEnvironment() {
        workerRuns += 1
        return {
          claimed: 0,
          cancelled: 0,
          manualReview: 0,
          claimFailed: 0,
          settlementUnknown: 0,
          deferred: 0,
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/subscription-cancellation-worker-route.spec.ts",
  ),
)
/**
 * Another spec loads this same route with its own stubs, and Node's require
 * cache is shared across specs in one worker process. Whichever loads first
 * would otherwise bind the module for the other, so this purges anything it
 * adds and anything already cached for the same paths. Without it, the route
 * stays bound to this file's secret and a legitimately authorized request
 * elsewhere is answered 401.
 */
const routeSpecifier =
  "../../src/app/api/internal/sponsorships/subscription-cancellations/route"
const moduleCache = testRequire.cache as Record<string, unknown>

function purgeLoadedModules(previousKeys: ReadonlySet<string>): void {
  for (const key of Object.keys(moduleCache)) {
    if (!previousKeys.has(key)) delete moduleCache[key]
  }
}

const cachedBeforeLoad = new Set(Object.keys(moduleCache))
// Drop any instance another spec already bound, so this one is stubbed here.
delete moduleCache[testRequire.resolve(routeSpecifier)]
const route = testRequire(
  routeSpecifier,
) as typeof import("../../src/app/api/internal/sponsorships/subscription-cancellations/route")
nodeModule._load = originalModuleLoad
purgeLoadedModules(cachedBeforeLoad)

function workerRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "https://creatorshare.com/api/internal/sponsorships/subscription-cancellations",
    { method: "POST", headers },
  )
}

test.beforeEach(() => {
  workerRuns = 0
  secretAvailable = true
})

test.describe("subscription cancellation worker route", () => {
  test("refuses an anonymous caller that omits the header entirely", async () => {
    // The decisive case. A gate applied only to requests that bother to send a
    // header is not a gate: omitting it is the cheapest possible attack.
    const response = await route.POST(workerRequest())

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: "unauthorized" })
    expect(workerRuns).toBe(0)
  })

  test("refuses wrong, malformed, and near-miss credentials", async () => {
    for (const authorization of [
      "",
      SECRET,
      `Basic ${SECRET}`,
      `Bearer ${"x".repeat(48)}`,
      `bearer ${SECRET}`,
    ]) {
      // A trailing space is deliberately absent from this list. The helper
      // rejects it, but the HTTP header layer trims it before the route reads
      // the value, so asserting it here would test header parsing rather than
      // this gate.
      workerRuns = 0
      const response = await route.POST(workerRequest({ authorization }))

      expect(
        response.status,
        `${JSON.stringify(authorization)} must not run the worker`,
      ).toBe(401)
      expect(workerRuns).toBe(0)
    }
  })

  test("fails closed when the worker secret is unavailable", async () => {
    secretAvailable = false

    const response = await route.POST(
      workerRequest({ authorization: `Bearer ${SECRET}` }),
    )

    expect(response.status).toBe(503)
    expect(workerRuns).toBe(0)
  })

  test("runs the batch for the exact bearer secret", async () => {
    // Without this the refusals above would be satisfied by a route that never
    // runs the worker at all.
    const response = await route.POST(
      workerRequest({ authorization: `Bearer ${SECRET}` }),
    )

    expect(response.status).toBe(200)
    expect(workerRuns).toBe(1)
  })

  test("applies the same gate to GET", async () => {
    const anonymous = await route.GET(workerRequest())
    expect(anonymous.status).toBe(401)
    expect(workerRuns).toBe(0)

    const authorized = await route.GET(
      workerRequest({ authorization: `Bearer ${SECRET}` }),
    )
    expect(authorized.status).toBe(200)
    expect(workerRuns).toBe(1)
  })
})
