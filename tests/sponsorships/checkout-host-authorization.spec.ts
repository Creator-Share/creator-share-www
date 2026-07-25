import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * Which hostnames are allowed to take money on a tenant's behalf.
 *
 * The v2 checkout library is covered with `authorizeHost` supplied as a stub,
 * so the library's ordering is asserted but the route's own authorization
 * predicate never is. `authorizeCheckoutHost` in the Stripe route had no test
 * reference at all. It is the function that decides whether the hostname on an
 * incoming checkout is an active domain belonging to an advocate that is both
 * in an active relationship and published. Dropping any one of those three
 * predicates would let a suspended, unpublished, or retired tenant collect
 * sponsorships under its own branding, and nothing would have failed.
 *
 * These tests drive the real exported POST handler with a real tenant Host
 * header and a recording service-role client, so the predicate itself decides
 * the outcome. The Stripe client factory throws, which makes "before any
 * provider object exists" an assertion rather than an assumption.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ADVOCATE_HOST = "alice.creatorshare.com"

// The route builds its sponsorship cryptography from the environment before it
// authorizes anything, so a key must exist for the request to reach the
// predicate under test. The value is a throwaway all-zero key.
process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = Buffer.alloc(32, 47).toString(
  "base64",
)

interface QueryFilter {
  column: string
  value: unknown
}

interface RecordedQuery {
  table: string
  filters: QueryFilter[]
}

interface DomainRow {
  advocate_id: string
}

interface AdvocateRow {
  id: string
}

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"

/**
 * A refused host maps to a 23514 check violation, which the route translates
 * into exactly this response. Asserting the specific pair rather than "some
 * error" is what distinguishes a genuine refusal from the request merely
 * failing later for an unrelated reason.
 */
const REFUSAL_STATUS = 409
const REFUSAL_MESSAGE = "This sponsorship is no longer available"

let recordedQueries: RecordedQuery[] = []
let recordedRpcNames: string[] = []
let stripeClientRequested = false

/**
 * Rows the fake database will return for the two authorization lookups. Null
 * models "no row matched the filters", which is what an inactive domain or an
 * unpublished advocate produces against the real predicates.
 */
let domainRow: DomainRow | null = { advocate_id: ADVOCATE_ID }
let advocateRow: AdvocateRow | null = { id: ADVOCATE_ID }

function fakeServiceRoleClient() {
  return {
    from(table: string) {
      const query: RecordedQuery = { table, filters: [] }
      recordedQueries.push(query)
      const builder = {
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          query.filters.push({ column, value })
          return builder
        },
        async maybeSingle() {
          if (table === "advocate_domains") {
            return { data: domainRow, error: null }
          }
          if (table === "advocates") {
            return { data: advocateRow, error: null }
          }
          return { data: null, error: null }
        },
      }
      return builder
    },
    async rpc(name: string) {
      recordedRpcNames.push(name)
      // Reaching a stored procedure means authorization already passed. Return
      // an empty recovery so the request fails afterwards for an unrelated
      // reason rather than continuing toward a live provider.
      return { data: [], error: null }
    },
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
      createClient: async () => ({
        auth: {
          async getUser() {
            return { data: { user: null }, error: null }
          },
        },
      }),
      createServiceRoleClient: () => fakeServiceRoleClient(),
    }
  }
  if (request === "@/lib/stripe/config") {
    return {
      getStripeClient() {
        // A rejected host must never reach this. Recording and throwing keeps
        // a regression loud instead of letting a stub absorb it.
        stripeClientRequested = true
        throw new Error("stripe_client_must_not_be_created")
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/checkout-host-authorization.spec.ts",
  ),
)
const route = testRequire(
  "../../src/app/api/stripe/route",
) as typeof import("../../src/app/api/stripe/route")
nodeModule._load = originalModuleLoad

function checkoutRequest(host: string): Request {
  return new Request(`https://${host}/api/stripe`, {
    method: "POST",
    headers: {
      host,
      origin: `https://${host}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "partnership",
      amount: 12_000,
      project: "education",
      paymentType: "subscription",
      email: "sponsor@example.com",
      currency: "USD",
      checkoutRequestId: "33333333-3333-4333-8333-333333333333",
      beneficiaryId: "22222222-2222-4222-8222-222222222222",
    }),
  })
}

function filtersFor(table: string): QueryFilter[] | null {
  const query = recordedQueries.find((entry) => entry.table === table)
  return query ? query.filters : null
}

test.beforeEach(() => {
  recordedQueries = []
  recordedRpcNames = []
  stripeClientRequested = false
  domainRow = { advocate_id: ADVOCATE_ID }
  advocateRow = { id: ADVOCATE_ID }
})

test.describe("checkout host authorization", () => {
  test("authorizes a tenant only on an active domain owned by an active, published advocate", async () => {
    await route.POST(checkoutRequest(ADVOCATE_HOST))

    // The three predicates are the whole control. Asserting the exact filters
    // is what catches one of them being dropped, since removing a predicate
    // widens the match rather than producing an error.
    expect(filtersFor("advocate_domains")).toEqual([
      { column: "hostname", value: ADVOCATE_HOST },
      { column: "status", value: "active" },
    ])
    expect(filtersFor("advocates")).toEqual([
      { column: "id", value: ADVOCATE_ID },
      { column: "relationship_status", value: "active" },
      { column: "publication_status", value: "active" },
    ])
  })

  test("an authorized tenant continues past authorization", async () => {
    await route.POST(checkoutRequest(ADVOCATE_HOST))

    // Establishes that the accepted path really does proceed, so the rejection
    // tests below are observing a refusal rather than an unrelated early exit.
    expect(recordedRpcNames).toContain("recover_sponsorship_checkout_v2")
  })

  test("a hostname with no active domain is refused before any checkout work", async () => {
    domainRow = null

    const response = await route.POST(checkoutRequest(ADVOCATE_HOST))

    expect(response.status).toBe(REFUSAL_STATUS)
    expect(await response.json()).toEqual({ error: REFUSAL_MESSAGE })
    expect(recordedRpcNames).toEqual([])
    expect(stripeClientRequested).toBe(false)
  })

  test("an unpublished or suspended advocate is refused before any checkout work", async () => {
    // The domain row still resolves; only the advocate's own status fails. This
    // is the case a missing publication_status or relationship_status predicate
    // would silently allow.
    advocateRow = null

    const response = await route.POST(checkoutRequest(ADVOCATE_HOST))

    expect(response.status).toBe(REFUSAL_STATUS)
    expect(await response.json()).toEqual({ error: REFUSAL_MESSAGE })
    expect(recordedRpcNames).toEqual([])
    expect(stripeClientRequested).toBe(false)
  })

  test("a refused tenant is told nothing about why", async () => {
    domainRow = null
    const unknownTenant = await route.POST(checkoutRequest(ADVOCATE_HOST))
    const unknownBody = (await unknownTenant.json()) as { error?: string }

    domainRow = { advocate_id: ADVOCATE_ID }
    advocateRow = null
    const unpublishedTenant = await route.POST(checkoutRequest(ADVOCATE_HOST))
    const unpublishedBody = (await unpublishedTenant.json()) as {
      error?: string
    }

    // An attacker enumerating hostnames must not be able to distinguish "no
    // such tenant" from "that tenant exists but is not published".
    expect(unpublishedTenant.status).toBe(unknownTenant.status)
    expect(unpublishedBody.error).toBe(unknownBody.error)
    expect(unknownBody.error).not.toContain(ADVOCATE_HOST)
  })
})
