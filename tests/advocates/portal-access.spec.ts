import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  activeAdvocatePublicPortalHref,
  buildAdvocatePortalNavigation,
} from "../../src/components/advocates/admin/PortalShell"
import {
  requiresAuthenticatedApiPath,
  requiresAuthenticatedPagePath,
} from "../../src/utils/supabase/middleware"

type AccessModule = typeof import("../../src/lib/advocates/admin/access")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/portal-access.spec.ts"),
)
const access = testRequire(
  "../../src/lib/advocates/admin/access",
) as AccessModule
nodeModule._load = originalModuleLoad

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"

const VALID_ROW = Object.freeze({
  advocate_id: ADVOCATE_ID,
  slug: "hope",
  display_name: "Hope Creates",
  relationship_status: "active",
  publication_status: "active",
  beneficiary_mode: "all_featured",
  advocate_version: 7,
  canonical_hostname: "hope.creatorshare.com",
  domain_status: "active",
  permissions: [
    "portal.branding.update",
    "portal.public_metrics.update",
    "portal.view",
  ],
})

test.describe("advocate portal access boundary", () => {
  test("parses only the exact immutable access projection", () => {
    const parsed = access.parseAdvocatePortalAccessRow(VALID_ROW)

    expect(parsed).toEqual({
      advocateId: ADVOCATE_ID,
      slug: "hope",
      displayName: "Hope Creates",
      relationshipStatus: "active",
      publicationStatus: "active",
      beneficiaryMode: "all_featured",
      advocateVersion: 7,
      canonicalHostname: "hope.creatorshare.com",
      domainStatus: "active",
      permissions: [
        "portal.branding.update",
        "portal.public_metrics.update",
        "portal.view",
      ],
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed?.permissions)).toBe(true)
  })

  test("rejects malformed identity, lifecycle, domain, version, and permissions", () => {
    const invalidRows = [
      { ...VALID_ROW, unexpected: true },
      { ...VALID_ROW, advocate_id: "not-a-uuid" },
      { ...VALID_ROW, slug: "Hope" },
      { ...VALID_ROW, display_name: " Hope Creates" },
      { ...VALID_ROW, relationship_status: "deleted" },
      { ...VALID_ROW, publication_status: "published" },
      { ...VALID_ROW, beneficiary_mode: "featured" },
      { ...VALID_ROW, advocate_version: "7" },
      { ...VALID_ROW, advocate_version: Number.MAX_SAFE_INTEGER + 1 },
      { ...VALID_ROW, canonical_hostname: "other.creatorshare.com" },
      { ...VALID_ROW, canonical_hostname: null },
      { ...VALID_ROW, domain_status: null },
      { ...VALID_ROW, domain_status: "ready" },
      {
        ...VALID_ROW,
        permissions: ["portal.view", "portal.branding.update"],
      },
      {
        ...VALID_ROW,
        permissions: [
          "portal.branding.update",
          "portal.branding.update",
          "portal.view",
        ],
      },
      { ...VALID_ROW, permissions: ["portal.unknown", "portal.view"] },
      { ...VALID_ROW, permissions: ["portal.branding.update"] },
    ]

    for (const row of invalidRows) {
      expect(access.parseAdvocatePortalAccessRow(row)).toBeNull()
    }
  })

  test("sorts portal rows and rejects duplicate tenant identities", () => {
    const second = {
      ...VALID_ROW,
      advocate_id: "22222222-2222-4222-8222-222222222222",
      slug: "alice",
      display_name: "Alice",
      canonical_hostname: "alice.creatorshare.com",
    }

    expect(
      access
        .parseAdvocatePortalAccessRows([VALID_ROW, second])
        ?.map((portal) => portal.slug),
    ).toEqual(["alice", "hope"])
    expect(
      access.parseAdvocatePortalAccessRows([VALID_ROW, { ...VALID_ROW }]),
    ).toBeNull()
    expect(
      access.parseAdvocatePortalAccessRows([
        VALID_ROW,
        {
          ...second,
          slug: "hope",
          canonical_hostname: "hope.creatorshare.com",
        },
      ]),
    ).toBeNull()
  })

  test("uses only the authenticated access RPC and fails closed on bad rows", async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const repository = access.createAdvocatePortalAccessRepository({
      async rpc(name: string, args?: unknown) {
        calls.push({ name, args })
        return { data: [VALID_ROW], error: null }
      },
    } as never)

    await expect(repository.listForCurrentUser()).resolves.toHaveLength(1)
    expect(calls).toEqual([
      { name: "get_my_advocate_portal_access", args: undefined },
    ])

    const malformed = access.createAdvocatePortalAccessRepository({
      async rpc() {
        return { data: [{ secret: "must-not-cross" }], error: null }
      },
    } as never)
    await expect(malformed.listForCurrentUser()).rejects.toMatchObject({
      name: "AdvocatePortalAccessRepositoryError",
      stage: "access_shape",
      message: "advocate_portal_access_unavailable",
    })
  })
})

test.describe("advocate portal navigation", () => {
  test("builds only permission appropriate navigation without dead links", () => {
    const viewer = buildAdvocatePortalNavigation({
      slug: "hope",
      permissions: ["portal.view"],
    })
    expect(viewer).toEqual([
      expect.objectContaining({
        section: "overview",
        href: "/portal/hope",
        availability: "available",
      }),
      expect.objectContaining({
        section: "branding",
        href: "/portal/hope/branding",
        availability: "available",
      }),
    ])

    const brandEditor = buildAdvocatePortalNavigation({
      slug: "hope",
      permissions: [
        "portal.branding.update",
        "portal.public_metrics.update",
        "portal.view",
      ],
    })
    expect(brandEditor.map((item) => item.section)).toEqual([
      "overview",
      "branding",
      "public-metrics",
    ])
    expect(brandEditor.filter((item) => item.href !== null)).toHaveLength(2)
    expect(brandEditor.at(-1)).toEqual(
      expect.objectContaining({ availability: "coming-soon", href: null }),
    )

    const branding = buildAdvocatePortalNavigation(
      { slug: "hope", permissions: ["portal.view"] },
      "branding",
    )
    expect(branding.find((item) => item.section === "branding")?.current).toBe(
      true,
    )
    expect(branding.find((item) => item.section === "overview")?.current).toBe(
      false,
    )
  })

  test("exposes the public portal link only when publication and domain are active", () => {
    expect(
      activeAdvocatePublicPortalHref({
        canonicalHostname: "hope.creatorshare.com",
        domainStatus: "active",
        publicationStatus: "active",
        relationshipStatus: "active",
      }),
    ).toBe("https://hope.creatorshare.com")

    for (const portal of [
      {
        canonicalHostname: "hope.creatorshare.com",
        domainStatus: "active" as const,
        publicationStatus: "suspended" as const,
        relationshipStatus: "active" as const,
      },
      {
        canonicalHostname: "hope.creatorshare.com",
        domainStatus: "verifying" as const,
        publicationStatus: "active" as const,
        relationshipStatus: "active" as const,
      },
      {
        canonicalHostname: null,
        domainStatus: null,
        publicationStatus: "active" as const,
        relationshipStatus: "active" as const,
      },
      {
        canonicalHostname: "hope.creatorshare.com",
        domainStatus: "active" as const,
        publicationStatus: "active" as const,
        relationshipStatus: "suspended" as const,
      },
    ]) {
      expect(activeAdvocatePublicPortalHref(portal)).toBeNull()
    }
  })
})

test.describe("advocate portal middleware protection", () => {
  test("protects exact portal page and API prefixes without catching lookalikes", () => {
    for (const path of ["/portal", "/portal/hope", "/portal/hope/branding"]) {
      expect(requiresAuthenticatedPagePath(path)).toBe(true)
    }
    for (const path of ["/api/portal", "/api/portal/hope/branding"]) {
      expect(requiresAuthenticatedApiPath(path)).toBe(true)
    }

    for (const path of ["/", "/portals", "/portalized", "/api/portals"]) {
      expect(requiresAuthenticatedPagePath(path)).toBe(false)
      expect(requiresAuthenticatedApiPath(path)).toBe(false)
    }
  })
})
