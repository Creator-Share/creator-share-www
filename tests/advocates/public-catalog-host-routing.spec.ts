import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * The public catalog route's Host-to-tenant wiring.
 *
 * A completion audit found this route was covered only by reading its source
 * text for the strings `resolvePublicSiteRequest` and
 * `createServiceRolePublicCatalogRepository`. That cannot catch the route
 * calling the primary loader for an advocate Host, which would serve the whole
 * catalog on a branded subdomain, nor an admin surface leaking onto a tenant.
 *
 * These tests invoke the real GET handler with real Host headers and assert
 * which repository method it reaches.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ADVOCATE_HOST = "hope-partners.creatorshare.com"
const PRIMARY_HOST = "creatorshare.com"

interface RepositoryCall {
  method: "loadAdvocatePage" | "loadPrimaryPage"
  hostname: string | null
}

const calls: RepositoryCall[] = []
let resolvedSiteKind: "advocate" | "primary" | "not-found" = "primary"

/** Matches the exact shape parsePublicCatalogPage accepts. */
function emptyPage(limit: number) {
  return {
    items: [],
    totalCount: 0,
    pageInfo: { limit, hasMore: false, nextCursor: null },
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
      createClient: () => ({}),
      createServiceRoleClient: () => ({}),
    }
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
        loadAdvocatePage: async (
          hostname: string,
          filters: { limit: number },
        ) => {
          calls.push({ method: "loadAdvocatePage", hostname })
          return emptyPage(filters.limit)
        },
        loadPrimaryPage: async (filters: { limit: number }) => {
          calls.push({ method: "loadPrimaryPage", hostname: null })
          return emptyPage(filters.limit)
        },
      }),
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/public-catalog-host-routing.spec.ts"),
)
const route = testRequire(
  "../../src/app/api/beneficiaries/get/route",
) as typeof import("../../src/app/api/beneficiaries/get/route")
nodeModule._load = originalModuleLoad

function catalogRequest(host: string, query = ""): Request {
  return new Request(`https://${host}/api/beneficiaries/get${query}`, {
    headers: { host },
  })
}

test.beforeEach(() => {
  calls.length = 0
  resolvedSiteKind = "primary"
})

test.describe("public catalog Host routing", () => {
  test("an advocate Host reaches the advocate loader with its canonical hostname", async () => {
    resolvedSiteKind = "advocate"
    const response = await route.GET(catalogRequest(ADVOCATE_HOST))

    expect(response.status).toBe(200)
    // The decisive assertion. Reaching loadPrimaryPage here would serve the
    // entire catalog on a branded subdomain.
    expect(calls).toEqual([
      { method: "loadAdvocatePage", hostname: ADVOCATE_HOST },
    ])
  })

  test("the primary Host reaches the primary loader", async () => {
    resolvedSiteKind = "primary"
    const response = await route.GET(catalogRequest(PRIMARY_HOST))

    expect(response.status).toBe(200)
    expect(calls).toEqual([{ method: "loadPrimaryPage", hostname: null }])
  })

  test("an unresolvable Host is a neutral 404 that touches no catalog", async () => {
    resolvedSiteKind = "not-found"
    const response = await route.GET(catalogRequest("unprovisioned.example"))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Catalog not found" })
    expect(calls).toEqual([])
  })

  test("admin mode is refused on an advocate Host and reaches no catalog", async () => {
    resolvedSiteKind = "advocate"
    const response = await route.GET(
      catalogRequest(ADVOCATE_HOST, "?admin_mode=true"),
    )

    // A tenant must not be able to request the administrator surface, and the
    // refusal must be indistinguishable from an absent catalog.
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Catalog not found" })
    expect(calls).toEqual([])
  })

  test("every catalog response is private and varies on Host", async () => {
    resolvedSiteKind = "advocate"
    const response = await route.GET(catalogRequest(ADVOCATE_HOST))

    // Without Vary: Host a shared cache could serve one tenant's catalog to
    // another, which is the cache-level form of a cross-tenant leak.
    expect(response.headers.get("vary")).toBe("Host")
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })
})
