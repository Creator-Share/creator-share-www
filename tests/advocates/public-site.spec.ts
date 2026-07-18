import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  CREATOR_SHARE_ACCENT_COLOR,
  CREATOR_SHARE_PRIMARY_COLOR,
  createPrimaryPublicSite,
} from "../../src/lib/advocates/publicSite"
import {
  contrastRatio,
  createPublicSiteCssVariables,
  deriveAccessibleBrandInkColor,
  deriveAccessibleForegroundColor,
  resolvePublicSiteTheme,
} from "../../src/lib/advocates/publicSiteTheme"
import type { PublicAdvocatePresentationRepository } from "../../src/lib/advocates/publicPresentation"

type PublicSiteRequestModule =
  typeof import("../../src/lib/advocates/publicSiteRequest")
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
  resolve(process.cwd(), "tests/advocates/public-site.spec.ts"),
)
const publicSiteRequest = testRequire(
  "../../src/lib/advocates/publicSiteRequest",
) as PublicSiteRequestModule
nodeModule._load = originalModuleLoad

const { configuredPrimaryHostnames, resolvePublicSiteRequest } =
  publicSiteRequest

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const READY_AT = "2026-07-18T13:00:00.000Z"
const PRODUCTION_ENVIRONMENT = {
  NODE_ENV: "production",
  NEXT_PUBLIC_BASE_URL: "https://dev.creatorshare.com",
  NEXT_PUBLIC_SITE_URL: "https://creatorshare.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  VERCEL_URL: "creator-share-git-feature.vercel.app",
}

const ACTIVE_PRESENTATION_SOURCE = {
  domain: {
    advocate_id: ADVOCATE_ID,
    hostname: "alice.creatorshare.com",
    status: "active",
    dns_verified_at: READY_AT,
    tls_ready_at: READY_AT,
    payments_ready_at: READY_AT,
    activated_at: READY_AT,
  },
  advocate: {
    id: ADVOCATE_ID,
    slug: "alice",
    display_name: "Alice Example",
    relationship_status: "active",
    publication_status: "active",
    beneficiary_mode: "selected",
  },
  branding: {
    advocate_id: ADVOCATE_ID,
    primary_color: "#173E8C",
    accent_color: "#F6C344",
    logo_storage_path: null,
    logo_alt_text: null,
    opening_header_html: "<h1>Welcome</h1>",
    about_biography_html: "<p>About Alice.</p>",
  },
  metricSelections: [
    {
      advocate_id: ADVOCATE_ID,
      metric_key: "children_sponsored",
      display_order: 0,
    },
  ],
}

function repositoryFor(source: unknown | null): {
  repository: PublicAdvocatePresentationRepository
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    repository: {
      async loadByCanonicalHostname(hostname) {
        calls.push(hostname)
        return source
      },
    },
  }
}

test.describe("public site request shell", () => {
  test("keeps primary and configured deployment hosts out of tenant lookup", async () => {
    const { repository, calls } = repositoryFor(ACTIVE_PRESENTATION_SOURCE)

    for (const rawHost of [
      "creatorshare.com",
      "www.creatorshare.com",
      "dev.creatorshare.com",
      "creator-share-git-feature.vercel.app",
    ]) {
      const result = await resolvePublicSiteRequest({
        rawHost,
        repository,
        environment: PRODUCTION_ENVIRONMENT,
      })
      expect(result).toMatchObject({
        kind: "ready",
        site: { kind: "primary", canonicalHostname: rawHost },
      })
    }

    expect(calls).toEqual([])
  })

  test("maps only an exact active advocate to the client safe site DTO", async () => {
    const { repository, calls } = repositoryFor(ACTIVE_PRESENTATION_SOURCE)
    const result = await resolvePublicSiteRequest({
      rawHost: "alice.creatorshare.com",
      repository,
      environment: PRODUCTION_ENVIRONMENT,
    })

    expect(calls).toEqual(["alice.creatorshare.com"])
    expect(result).toEqual({
      kind: "ready",
      site: {
        kind: "advocate",
        canonicalHostname: "alice.creatorshare.com",
        slug: "alice",
        displayName: "Alice Example",
        beneficiaryMode: "selected",
        primaryColor: "#173E8C",
        accentColor: "#F6C344",
        logoUrl: null,
        logoAltText: null,
        openingHeaderHtml: "<h2>Welcome</h2>",
        aboutBiographyHtml: "<p>About Alice.</p>",
        publicMetricKeys: ["children_sponsored"],
      },
    })

    expect(JSON.stringify(result)).not.toContain(ADVOCATE_ID)
  })

  test("fails closed for rejected, inactive, and unavailable tenant hosts", async () => {
    const unavailable = repositoryFor(null)
    await expect(
      resolvePublicSiteRequest({
        rawHost: "alice.creatorshare.com",
        repository: unavailable.repository,
        environment: PRODUCTION_ENVIRONMENT,
      }),
    ).resolves.toEqual({
      kind: "not-found",
      reason: "unavailable-tenant",
      hostname: "alice.creatorshare.com",
    })

    const rejected = repositoryFor(ACTIVE_PRESENTATION_SOURCE)
    await expect(
      resolvePublicSiteRequest({
        rawHost: "attacker.example",
        repository: rejected.repository,
        environment: PRODUCTION_ENVIRONMENT,
      }),
    ).resolves.toEqual({
      kind: "not-found",
      reason: "rejected-host",
      hostname: "attacker.example",
    })
    expect(rejected.calls).toEqual([])
  })

  test("keeps repository failures distinct without placing details in a site DTO", async () => {
    const failure = new Error("private database detail")
    const repository: PublicAdvocatePresentationRepository = {
      async loadByCanonicalHostname() {
        throw failure
      },
    }

    await expect(
      resolvePublicSiteRequest({
        rawHost: "alice.creatorshare.com",
        repository,
        environment: PRODUCTION_ENVIRONMENT,
      }),
    ).resolves.toEqual({
      kind: "operational-failure",
      hostname: "alice.creatorshare.com",
      error: failure,
    })
  })

  test("accepts only exact configured deployment origins", () => {
    expect(configuredPrimaryHostnames(PRODUCTION_ENVIRONMENT)).toEqual([
      "dev.creatorshare.com",
      "creatorshare.com",
      "creator-share-git-feature.vercel.app",
    ])
    expect(
      configuredPrimaryHostnames({
        NEXT_PUBLIC_BASE_URL: "https://user:secret@example.com",
        NEXT_PUBLIC_SITE_URL: "https://example.com/path",
        VERCEL_URL: " example.com",
      }),
    ).toEqual([])
  })
})

test.describe("public site theme boundary", () => {
  test("uses validated colors and derives accessible foregrounds", () => {
    for (const background of [
      "#000000",
      "#FFFFFF",
      "#777777",
      "#173E8C",
      "#F6C344",
      "#FF0000",
      "#00FF00",
      "#0000FF",
    ]) {
      const foreground = deriveAccessibleForegroundColor(background)
      expect(["#000000", "#FFFFFF"]).toContain(foreground)
      expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5)
    }
  })

  test("derives a minimally darkened primary ink for light surfaces", () => {
    for (const primaryColor of [
      "#FFFFFF",
      "#F6C344",
      "#00FF00",
      "#2B7FF9",
      "#173E8C",
      "#000000",
    ]) {
      const ink = deriveAccessibleBrandInkColor(primaryColor)
      expect(contrastRatio(ink, "#FFFFFF")).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(ink, "#F9FAFB")).toBeGreaterThanOrEqual(4.5)
      if (contrastRatio(primaryColor, "#F9FAFB") >= 4.5) {
        expect(ink).toBe(primaryColor)
      }
    }

    expect(deriveAccessibleBrandInkColor("not-a-color")).toBe("#000000")
  })

  test("replaces malformed style input before constructing CSS variables", () => {
    const site = createPrimaryPublicSite("creatorshare.com")
    const malformed = {
      ...site,
      primaryColor: "red; background-image: url(https://tracker.example)",
      accentColor: "#12345G",
    }

    expect(resolvePublicSiteTheme(malformed)).toEqual({
      primaryColor: CREATOR_SHARE_PRIMARY_COLOR,
      primaryInkColor: CREATOR_SHARE_PRIMARY_COLOR,
      primaryForegroundColor: "#FFFFFF",
      accentColor: CREATOR_SHARE_ACCENT_COLOR,
      accentForegroundColor: "#000000",
    })
    expect(createPublicSiteCssVariables(malformed)).toEqual({
      "--public-site-primary": CREATOR_SHARE_PRIMARY_COLOR,
      "--public-site-primary-ink": CREATOR_SHARE_PRIMARY_COLOR,
      "--public-site-primary-foreground": "#FFFFFF",
      "--public-site-accent": CREATOR_SHARE_ACCENT_COLOR,
      "--public-site-accent-foreground": "#000000",
    })
  })

  test("uses nonredirecting and neutral terminal shells", () => {
    const notFoundSource = readFileSync(
      resolve(process.cwd(), "src/app/not-found.tsx"),
      "utf8",
    )
    expect(notFoundSource).not.toContain("redirect(")
    expect(notFoundSource).toContain("NotFoundContent")

    const globalNotFoundSource = readFileSync(
      resolve(process.cwd(), "src/app/global-not-found.tsx"),
      "utf8",
    )
    expect(globalNotFoundSource).toContain("NotFoundContent")

    const globalErrorSource = readFileSync(
      resolve(process.cwd(), "src/app/global-error.tsx"),
      "utf8",
    )
    expect(globalErrorSource.startsWith('"use client"')).toBe(true)
    expect(globalErrorSource).not.toContain("error.message")
    expect(globalErrorSource).not.toContain("error.digest")
  })
})
