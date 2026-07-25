import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * Host scoping on the three public beneficiary detail routes.
 *
 * Four routes choose between an advocate-scoped loader and the platform-wide
 * primary loader by reading `site.kind`. `/api/beneficiaries/get` is covered by
 * public-catalog-host-routing.spec.ts. These three were not covered at all: a
 * reachability probe that appended a throwing statement to each file and ran
 * the complete offline lane confirmed no test loads them, so every assertion
 * about them lived in text-matching checks that read the source and asserted it
 * contains a symbol name.
 *
 * That cannot catch the decision itself. If any of these routes took the
 * primary branch on an advocate Host, a branded subdomain would serve media,
 * profiles, and activity for children the advocate never selected, and the
 * source text would still contain every symbol the existing checks look for.
 *
 * Each loader returns null here, which every parser treats as an absent record.
 * That keeps the tests about the routing decision rather than payload shape:
 * the decisive assertion is which repository method ran and with what hostname.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ADVOCATE_HOST = "hope-partners.creatorshare.com"
const PRIMARY_HOST = "creatorshare.com"
const BENEFICIARY_ID = "11111111-1111-4111-8111-111111111111"
const BENEFICIARY_USERNAME = "hopechild"

interface RepositoryCall {
  method: string
  args: readonly unknown[]
}

const calls: RepositoryCall[] = []
let resolvedSiteKind: "advocate" | "primary" | "not-found" = "primary"

function recorder(method: string) {
  return async (...args: readonly unknown[]) => {
    calls.push({ method, args })
    // Null is "no such record" to every public catalog parser, which keeps
    // these tests about routing rather than payload shape.
    return null
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
    return { createClient: () => ({}), createServiceRoleClient: () => ({}) }
  }
  if (request === "@/lib/advocates/publicPresentationRepository") {
    return {
      createServiceRolePublicAdvocatePresentationRepository: () => ({}),
    }
  }
  if (request === "@/lib/advocates/publicSiteRequest") {
    return {
      resolvePublicSiteRequest: async ({ rawHost }: { rawHost: string }) => {
        if (resolvedSiteKind === "not-found") return { kind: "not-found" }
        return {
          kind: "resolved",
          site: {
            kind: resolvedSiteKind,
            slug: resolvedSiteKind === "advocate" ? "hope-partners" : null,
            canonicalHostname: rawHost,
            displayName: "Hope Partners",
            beneficiaryMode: "all",
            primaryColor: "#2B7FF9",
            accentColor: "#F59E0B",
            logoUrl: null,
            logoAltText: null,
            openingHeaderHtml: "",
            aboutBiographyHtml: "",
            publicMetrics: [],
          },
        }
      },
    }
  }
  if (request === "@/lib/advocates/publicCatalogRepository") {
    return {
      createServiceRolePublicCatalogRepository: () => ({
        loadAdvocateBeneficiaryMediaById: recorder(
          "loadAdvocateBeneficiaryMediaById",
        ),
        loadPrimaryBeneficiaryMediaById: recorder(
          "loadPrimaryBeneficiaryMediaById",
        ),
        loadAdvocateBeneficiaryByUsername: recorder(
          "loadAdvocateBeneficiaryByUsername",
        ),
        loadPrimaryBeneficiaryByUsername: recorder(
          "loadPrimaryBeneficiaryByUsername",
        ),
        loadAdvocateBeneficiaryActivitiesById: recorder(
          "loadAdvocateBeneficiaryActivitiesById",
        ),
        loadPrimaryBeneficiaryActivitiesById: recorder(
          "loadPrimaryBeneficiaryActivitiesById",
        ),
      }),
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/advocates/public-beneficiary-detail-host-routing.spec.ts",
  ),
)
const mediaRoute = testRequire(
  "../../src/app/api/beneficiaries/images/[id]/route",
) as typeof import("../../src/app/api/beneficiaries/images/[id]/route")
const usernameRoute = testRequire(
  "../../src/app/api/beneficiaries/get/username/[username]/route",
) as typeof import("../../src/app/api/beneficiaries/get/username/[username]/route")
const activitiesRoute = testRequire(
  "../../src/app/api/beneficiaries/[id]/activities/route",
) as typeof import("../../src/app/api/beneficiaries/[id]/activities/route")
nodeModule._load = originalModuleLoad

function detailRequest(host: string, path: string): Request {
  return new Request(`https://${host}${path}`, { headers: { host } })
}

test.beforeEach(() => {
  calls.length = 0
  resolvedSiteKind = "primary"
})

test.describe("public beneficiary detail Host routing", () => {
  test("beneficiary media is scoped to the advocate on a tenant Host", async () => {
    resolvedSiteKind = "advocate"
    await mediaRoute.GET(
      detailRequest(
        ADVOCATE_HOST,
        `/api/beneficiaries/images/${BENEFICIARY_ID}`,
      ),
      { params: Promise.resolve({ id: BENEFICIARY_ID }) },
    )

    // Reaching the primary loader here would serve media for any child on the
    // platform from a branded subdomain.
    expect(calls).toEqual([
      {
        method: "loadAdvocateBeneficiaryMediaById",
        args: [ADVOCATE_HOST, BENEFICIARY_ID],
      },
    ])
  })

  test("beneficiary media uses the platform loader on the primary Host", async () => {
    resolvedSiteKind = "primary"
    await mediaRoute.GET(
      detailRequest(
        PRIMARY_HOST,
        `/api/beneficiaries/images/${BENEFICIARY_ID}`,
      ),
      { params: Promise.resolve({ id: BENEFICIARY_ID }) },
    )

    expect(calls).toEqual([
      { method: "loadPrimaryBeneficiaryMediaById", args: [BENEFICIARY_ID] },
    ])
  })

  test("a beneficiary profile is scoped to the advocate on a tenant Host", async () => {
    resolvedSiteKind = "advocate"
    await usernameRoute.GET(
      detailRequest(
        ADVOCATE_HOST,
        `/api/beneficiaries/get/username/${BENEFICIARY_USERNAME}`,
      ),
      { params: Promise.resolve({ username: BENEFICIARY_USERNAME }) },
    )

    expect(calls).toEqual([
      {
        method: "loadAdvocateBeneficiaryByUsername",
        args: [ADVOCATE_HOST, BENEFICIARY_USERNAME],
      },
    ])
  })

  test("a beneficiary profile uses the platform loader on the primary Host", async () => {
    resolvedSiteKind = "primary"
    await usernameRoute.GET(
      detailRequest(
        PRIMARY_HOST,
        `/api/beneficiaries/get/username/${BENEFICIARY_USERNAME}`,
      ),
      { params: Promise.resolve({ username: BENEFICIARY_USERNAME }) },
    )

    expect(calls).toEqual([
      {
        method: "loadPrimaryBeneficiaryByUsername",
        args: [BENEFICIARY_USERNAME],
      },
    ])
  })

  test("beneficiary activity is scoped to the advocate on a tenant Host", async () => {
    resolvedSiteKind = "advocate"
    await activitiesRoute.GET(
      detailRequest(
        ADVOCATE_HOST,
        `/api/beneficiaries/${BENEFICIARY_ID}/activities`,
      ),
      { params: Promise.resolve({ id: BENEFICIARY_ID }) },
    )

    expect(calls).toEqual([
      {
        method: "loadAdvocateBeneficiaryActivitiesById",
        args: [ADVOCATE_HOST, BENEFICIARY_ID],
      },
    ])
  })

  test("beneficiary activity uses the platform loader on the primary Host", async () => {
    resolvedSiteKind = "primary"
    await activitiesRoute.GET(
      detailRequest(
        PRIMARY_HOST,
        `/api/beneficiaries/${BENEFICIARY_ID}/activities`,
      ),
      { params: Promise.resolve({ id: BENEFICIARY_ID }) },
    )

    expect(calls).toEqual([
      {
        method: "loadPrimaryBeneficiaryActivitiesById",
        args: [BENEFICIARY_ID],
      },
    ])
  })

  test("an unresolvable Host reaches no loader on any detail route", async () => {
    resolvedSiteKind = "not-found"

    const media = await mediaRoute.GET(
      detailRequest("unprovisioned.example", "/api/beneficiaries/images/x"),
      { params: Promise.resolve({ id: BENEFICIARY_ID }) },
    )
    const username = await usernameRoute.GET(
      detailRequest(
        "unprovisioned.example",
        "/api/beneficiaries/get/username/x",
      ),
      { params: Promise.resolve({ username: BENEFICIARY_USERNAME }) },
    )
    const activities = await activitiesRoute.GET(
      detailRequest("unprovisioned.example", "/api/beneficiaries/x/activities"),
      { params: Promise.resolve({ id: BENEFICIARY_ID }) },
    )

    expect(media.status).toBe(404)
    expect(username.status).toBe(404)
    expect(activities.status).toBe(404)
    expect(calls).toEqual([])
  })

  test("every detail response is private and varies on Host", async () => {
    resolvedSiteKind = "advocate"
    const responses = [
      await mediaRoute.GET(
        detailRequest(
          ADVOCATE_HOST,
          `/api/beneficiaries/images/${BENEFICIARY_ID}`,
        ),
        { params: Promise.resolve({ id: BENEFICIARY_ID }) },
      ),
      await usernameRoute.GET(
        detailRequest(
          ADVOCATE_HOST,
          `/api/beneficiaries/get/username/${BENEFICIARY_USERNAME}`,
        ),
        { params: Promise.resolve({ username: BENEFICIARY_USERNAME }) },
      ),
      await activitiesRoute.GET(
        detailRequest(
          ADVOCATE_HOST,
          `/api/beneficiaries/${BENEFICIARY_ID}/activities`,
        ),
        { params: Promise.resolve({ id: BENEFICIARY_ID }) },
      ),
    ]

    // Without Vary: Host a shared cache could hand one tenant's child detail to
    // another, which is the cache-level form of a cross-tenant leak.
    for (const response of responses) {
      expect(response.headers.get("vary")).toBe("Host")
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      )
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    }
  })
})
