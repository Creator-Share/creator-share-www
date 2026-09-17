import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { NextRequest } from "next/server"
import { expect, test } from "@playwright/test"

/**
 * The sponsor's own one-time sponsorship history endpoint.
 *
 * A reachability probe that appended a throwing statement to this route and
 * ran the complete offline lane passed unchanged, so no test loaded it. The
 * pagination contract is split across two modules and only one half was
 * asserted: `parseSponsorAccountHistoryRequest` produces an `rpcLimit` of
 * `pageSize + 1`, and `buildSponsorAccountHistoryPage` detects a further page
 * by seeing more rows than the page size. The route is what carries the first
 * to the database.
 *
 * Passing `pageSize` instead of `rpcLimit` makes `nextCursor` permanently
 * null, so every sponsor's history silently truncates at the first page and
 * older receipts become unreachable, with a 200 and no error.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const AUTH_USER = { id: "99999999-9999-4999-8999-999999999999" }
const INTENT_ID = "11111111-1111-4111-8111-111111111111"
const BENEFICIARY_ID = "22222222-2222-4222-8222-222222222222"

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

const rpcCalls: RpcCall[] = []
let authenticatedUser: { id: string } | null = AUTH_USER
let rpcRows: unknown = []
let rpcError: unknown = null

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
      createClient: async () => ({
        auth: {
          async getUser() {
            return {
              data: { user: authenticatedUser },
              error: authenticatedUser === null ? { code: "401" } : null,
            }
          },
        },
        async rpc(name: string, args: Record<string, unknown>) {
          rpcCalls.push({ name, args })
          return { data: rpcRows, error: rpcError }
        },
      }),
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/sponsor-account-history-route.spec.ts",
  ),
)
const moduleCache = testRequire.cache as Record<string, unknown>
const specifier = "../../src/app/api/sponsor-account/history/route"
const cachedBeforeLoad = new Set(Object.keys(moduleCache))
delete moduleCache[testRequire.resolve(specifier)]
const route = testRequire(
  specifier,
) as typeof import("../../src/app/api/sponsor-account/history/route")
nodeModule._load = originalModuleLoad
// The require cache is shared across specs in one worker process.
for (const key of Object.keys(moduleCache)) {
  if (!cachedBeforeLoad.has(key)) delete moduleCache[key]
}

function historyRow(index: number) {
  return {
    sponsorship_intent_id: `${index}`.padStart(8, "0") + INTENT_ID.slice(8),
    subject_kind: "standard",
    beneficiary_id: BENEFICIARY_ID,
    beneficiary_name: "Example Child",
    beneficiary_username: "example-child",
    partnership_project: null,
    base_amount_usd_cents: 2500,
    charged_amount_minor: 2500,
    charged_currency: "USD",
    net_base_amount_usd_cents: 2500,
    net_charged_amount_minor: 2500,
    provider: "STRIPE",
    paid_at: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.123456+00:00`,
    financial_status: "paid",
  }
}

function historyRequest(query = ""): NextRequest {
  return new NextRequest(
    `https://creatorshare.com/api/sponsor-account/history${query}`,
  )
}

test.beforeEach(() => {
  rpcCalls.length = 0
  authenticatedUser = AUTH_USER
  rpcRows = []
  rpcError = null
})

test.describe("sponsor account history route", () => {
  test("asks the database for one row beyond the page so a cursor can exist", async () => {
    // The decisive assertion. Requesting exactly the page size makes the
    // further-page check unsatisfiable and truncates every history silently.
    rpcRows = Array.from({ length: 21 }, (_, index) => historyRow(index))

    const response = await route.GET(historyRequest())
    const body = (await response.json()) as {
      items: unknown[]
      nextCursor: string | null
    }

    expect(response.status).toBe(200)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe("list_my_one_time_sponsorship_history")
    expect(rpcCalls[0].args.target_limit).toBe(21)
    expect(body.items).toHaveLength(20)
    expect(body.nextCursor).not.toBeNull()
  })

  test("honours an explicit page size in both the query and the lookahead", async () => {
    rpcRows = Array.from({ length: 6 }, (_, index) => historyRow(index))

    const response = await route.GET(historyRequest("?limit=5"))
    const body = (await response.json()) as {
      items: unknown[]
      nextCursor: string | null
    }

    expect(rpcCalls[0].args.target_limit).toBe(6)
    expect(body.items).toHaveLength(5)
    expect(body.nextCursor).not.toBeNull()
  })

  test("reports no further page when the lookahead row is absent", async () => {
    // The other side of the boundary, so the assertions above cannot be
    // satisfied by always emitting a cursor.
    rpcRows = Array.from({ length: 20 }, (_, index) => historyRow(index))

    const body = (await (await route.GET(historyRequest())).json()) as {
      items: unknown[]
      nextCursor: string | null
    }

    expect(body.items).toHaveLength(20)
    expect(body.nextCursor).toBeNull()
  })

  test("refuses an unauthenticated caller before touching the database", async () => {
    authenticatedUser = null

    const response = await route.GET(historyRequest())

    expect(response.status).toBe(401)
    expect(rpcCalls).toEqual([])
  })

  test("rejects a malformed request before touching the database", async () => {
    for (const query of ["?limit=0", "?limit=-1", "?limit=abc", "?unknown=1"]) {
      rpcCalls.length = 0
      const response = await route.GET(historyRequest(query))

      expect(response.status, `${query} must be refused`).toBe(400)
      expect(rpcCalls).toEqual([])
    }
  })

  test("keeps a sponsor's own history private and uncacheable", async () => {
    rpcRows = []
    const response = await route.GET(historyRequest())

    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("vary")).toBe("Cookie")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  test("fails closed when the database errors", async () => {
    rpcError = { code: "08006" }

    const response = await route.GET(historyRequest())

    expect(response.status).toBe(503)
  })
})
