import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  PublicAdvocatePresentationRepository,
  ResolvePublicAdvocateRequestOptions,
} from "../../src/lib/advocates/publicPresentation"

type PublicPresentationModule =
  typeof import("../../src/lib/advocates/publicPresentation")
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
  resolve(process.cwd(), "tests/advocates/public-presentation.spec.ts"),
)
const publicPresentation = testRequire(
  "../../src/lib/advocates/publicPresentation",
) as PublicPresentationModule
nodeModule._load = originalModuleLoad

const {
  PUBLIC_ADVOCATE_LOGO_BUCKET,
  PUBLIC_ADVOCATE_METRIC_KEYS,
  resolvePublicAdvocateRequest,
} = publicPresentation

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ADVOCATE_ID = "12222222-2222-4222-8222-222222222222"
const LOGO_OBJECT_ID = "31111111-1111-4111-8111-111111111111"
const LOGO_STORAGE_PATH = `logos/alice/${LOGO_OBJECT_ID}.webp`
const LOGO_PUBLIC_ORIGIN = "https://project.supabase.co"
const READY_AT = "2026-07-18T13:00:00.000Z"

const BASE_SOURCE = {
  domain: {
    advocate_id: ADVOCATE_ID,
    hostname: "alice.creatorshare.com",
    status: "active",
    dns_verified_at: READY_AT,
    tls_ready_at: READY_AT,
    payments_ready_at: READY_AT,
    activated_at: READY_AT,
    provider_metadata: { secret: "provider-secret-must-not-escape" },
  },
  advocate: {
    id: ADVOCATE_ID,
    slug: "alice",
    display_name: "Alice Example",
    relationship_status: "active",
    publication_status: "active",
    beneficiary_mode: "all_featured",
    created_by_user_id: "owner-must-not-escape",
    contact_email: "contact-must-not-escape@example.com",
  },
  branding: {
    advocate_id: ADVOCATE_ID,
    primary_color: "#1c3c8c",
    accent_color: "#f4b942",
    logo_storage_path: LOGO_STORAGE_PATH,
    logo_alt_text: "Alice Example logo",
    opening_header_html:
      '<h1 class="hero" onclick="steal()">Welcome<script>alert(1)</script></h1>',
    about_biography_html:
      '<p>About <a href="https://tracker.example">us</a>.</p><img src="https://tracker.example/pixel">',
  },
  metricSelections: [
    {
      advocate_id: ADVOCATE_ID,
      metric_key: "children_sponsored",
      display_order: 2,
    },
    {
      advocate_id: ADVOCATE_ID,
      metric_key: "gross_raised_usd",
      display_order: 0,
    },
    {
      advocate_id: ADVOCATE_ID,
      metric_key: "direct_sponsorships",
      display_order: 1,
    },
  ],
  beneficiarySelections: Array.from({ length: 5_000 }, (_, index) => ({
    advocate_id: ADVOCATE_ID,
    beneficiary_id: `private-beneficiary-${index}`,
  })),
  memberships: [{ user_id: "member-must-not-escape" }],
  audit: { actor: "audit-must-not-escape" },
}

function cloneSource(): typeof BASE_SOURCE {
  return structuredClone(BASE_SOURCE)
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

async function resolveSource(
  source: unknown | null,
  rawHost = "alice.creatorshare.com",
  options: ResolvePublicAdvocateRequestOptions = {},
) {
  const repository = repositoryFor(source)
  const result = await resolvePublicAdvocateRequest(
    rawHost,
    repository.repository,
    {
      logoPublicOrigin: LOGO_PUBLIC_ORIGIN,
      ...options,
    },
  )
  return { ...repository, result }
}

test.describe("public advocate presentation boundary", () => {
  test("returns only the allowlisted public projection for an exact active tenant", async () => {
    const { result, calls } = await resolveSource(
      cloneSource(),
      "Alice.CreatorShare.com.",
    )

    expect(calls).toEqual(["alice.creatorshare.com"])
    expect(result.kind).toBe("active-advocate")
    if (result.kind !== "active-advocate") return

    expect(result.presentation).toEqual({
      canonicalHostname: "alice.creatorshare.com",
      slug: "alice",
      displayName: "Alice Example",
      beneficiaryMode: "all_featured",
      primaryColor: "#1C3C8C",
      accentColor: "#F4B942",
      logoUrl:
        `${LOGO_PUBLIC_ORIGIN}/storage/v1/object/public/` +
        `${PUBLIC_ADVOCATE_LOGO_BUCKET}/${LOGO_STORAGE_PATH}`,
      logoAltText: "Alice Example logo",
      openingHeaderHtml: "<h1>Welcome</h1>",
      aboutBiographyHtml: "<p>About us.</p>",
      publicMetricKeys: [
        "gross_raised_usd",
        "direct_sponsorships",
        "children_sponsored",
      ],
    })

    const serialized = JSON.stringify(result.presentation)
    for (const privateValue of [
      "provider-secret-must-not-escape",
      "owner-must-not-escape",
      "contact-must-not-escape@example.com",
      "member-must-not-escape",
      "audit-must-not-escape",
      "private-beneficiary-",
      ADVOCATE_ID,
    ]) {
      expect(serialized).not.toContain(privateValue)
    }
    expect(Object.keys(result.presentation).sort()).toEqual(
      [
        "aboutBiographyHtml",
        "accentColor",
        "beneficiaryMode",
        "canonicalHostname",
        "displayName",
        "logoAltText",
        "logoUrl",
        "openingHeaderHtml",
        "primaryColor",
        "publicMetricKeys",
        "slug",
      ].sort(),
    )
  })

  test("separates approved primary hosts from every other non-tenant host", async () => {
    const primary = repositoryFor(cloneSource())

    await expect(
      resolvePublicAdvocateRequest("creatorshare.com", primary.repository),
    ).resolves.toEqual({ kind: "primary", hostname: "creatorshare.com" })
    await expect(
      resolvePublicAdvocateRequest("www.creatorshare.com.", primary.repository),
    ).resolves.toEqual({
      kind: "primary",
      hostname: "www.creatorshare.com",
    })

    const unapproved = await resolvePublicAdvocateRequest(
      "preview-123.vercel.app",
      primary.repository,
    )
    expect(unapproved).toMatchObject({
      kind: "rejected-host",
      hostname: "preview-123.vercel.app",
    })

    await expect(
      resolvePublicAdvocateRequest(
        "preview-123.vercel.app",
        primary.repository,
        { approvedPrimaryHostnames: ["preview-123.vercel.app"] },
      ),
    ).resolves.toEqual({
      kind: "primary",
      hostname: "preview-123.vercel.app",
    })
    expect(primary.calls).toEqual([])
  })

  test("rejects invalid, reserved, nested, and outside hosts without a lookup", async () => {
    const { repository, calls } = repositoryFor(cloneSource())

    for (const host of [
      null,
      "admin.creatorshare.com",
      "campaign.alice.creatorshare.com",
      "alice.creatorshare.com.evil.example",
      "https://alice.creatorshare.com",
    ]) {
      const result = await resolvePublicAdvocateRequest(host, repository)
      expect(result.kind).toBe("rejected-host")
    }

    expect(calls).toEqual([])
  })

  test("separates an unavailable tenant from a repository failure", async () => {
    const unavailable = await resolveSource(null)
    expect(unavailable.result).toEqual({
      kind: "unavailable-tenant",
      canonicalHostname: "alice.creatorshare.com",
      reason: "not-found-or-inactive",
    })

    const failure = new Error("database details stay on the server")
    const failedRepository: PublicAdvocatePresentationRepository = {
      async loadByCanonicalHostname() {
        throw failure
      },
    }
    const result = await resolvePublicAdvocateRequest(
      "alice.creatorshare.com",
      failedRepository,
    )
    expect(result).toEqual({
      kind: "operational-failure",
      canonicalHostname: "alice.creatorshare.com",
      error: failure,
    })
  })

  test("maps explicitly enabled local requests to trusted production identities", async () => {
    const enabled = await resolveSource(cloneSource(), "alice.localhost:3000", {
      allowLocalhostDevelopment: true,
    })
    expect(enabled.calls).toEqual(["alice.creatorshare.com"])
    expect(enabled.result.kind).toBe("active-advocate")

    const disabled = await resolveSource(cloneSource(), "alice.localhost:3000")
    expect(disabled.calls).toEqual([])
    expect(disabled.result.kind).toBe("rejected-host")

    const localRoot = repositoryFor(cloneSource())
    await expect(
      resolvePublicAdvocateRequest("localhost:3000", localRoot.repository, {
        allowLocalhostDevelopment: true,
      }),
    ).resolves.toEqual({ kind: "primary", hostname: "localhost" })
    expect(localRoot.calls).toEqual([])
  })

  test("requires active lifecycle and complete active-domain readiness", async () => {
    const cases: Array<(source: typeof BASE_SOURCE) => void> = [
      (source) => {
        source.domain.status = "verifying"
      },
      (source) => {
        source.domain.dns_verified_at = null as unknown as string
      },
      (source) => {
        source.domain.tls_ready_at = "not-a-timestamp"
      },
      (source) => {
        source.domain.payments_ready_at = null as unknown as string
      },
      (source) => {
        source.domain.activated_at = "2026-99-99T99:99:99Z"
      },
      (source) => {
        source.advocate.relationship_status = "suspended"
      },
      (source) => {
        source.advocate.publication_status = "draft"
      },
    ]

    for (const mutate of cases) {
      const source = cloneSource()
      mutate(source)
      const { result } = await resolveSource(source)
      expect(result).toEqual({
        kind: "unavailable-tenant",
        canonicalHostname: "alice.creatorshare.com",
        reason: "invalid-presentation",
      })
    }
  })

  test("rejects cross-tenant ownership and malformed public values", async () => {
    const cases: Array<(source: typeof BASE_SOURCE) => void> = [
      (source) => {
        source.domain.hostname = "bob.creatorshare.com"
      },
      (source) => {
        source.advocate.id = OTHER_ADVOCATE_ID
      },
      (source) => {
        source.branding.advocate_id = OTHER_ADVOCATE_ID
      },
      (source) => {
        source.metricSelections[0].advocate_id = OTHER_ADVOCATE_ID
      },
      (source) => {
        source.domain.advocate_id = "not-a-uuid"
      },
      (source) => {
        source.advocate.slug = "Alice"
      },
      (source) => {
        source.advocate.display_name = " Alice Example "
      },
      (source) => {
        source.branding.primary_color = "#fff"
      },
      (source) => {
        source.branding.accent_color = "#12345g"
      },
    ]

    for (const mutate of cases) {
      const source = cloneSource()
      mutate(source)
      const { result } = await resolveSource(source)
      expect(result).toMatchObject({
        kind: "unavailable-tenant",
        reason: "invalid-presentation",
      })
    }
  })

  test("requires the exact tenant logo boundary and allows no SVG", async () => {
    const invalidPaths = [
      "advocate-logos/alice/logo.png",
      `logos/bob/${LOGO_OBJECT_ID}.webp`,
      `logos/alice/${LOGO_OBJECT_ID}.svg`,
      "logos/alice/3A111111-1111-4111-8111-111111111111.webp",
      "logos/alice/not-a-uuid.webp",
      `logos/alice/extra/${LOGO_OBJECT_ID}.webp`,
      `logos/alice/${LOGO_OBJECT_ID}.webp?download=1`,
      `logos/alice/${LOGO_OBJECT_ID}.webp/other`,
      "https://evil.example/logo.webp",
    ]

    for (const invalidPath of invalidPaths) {
      const source = cloneSource()
      source.branding.logo_storage_path = invalidPath
      const { result } = await resolveSource(source)
      expect(result, invalidPath).toMatchObject({
        kind: "unavailable-tenant",
        reason: "invalid-presentation",
      })
    }
  })

  test("composes logo URLs only for a safely configured server origin", async () => {
    for (const logoPublicOrigin of [
      null,
      "http://project.supabase.co",
      "https://user:password@project.supabase.co",
      "https://project.supabase.co/subpath",
      "https://project.supabase.co?secret=value",
    ]) {
      const { result } = await resolveSource(cloneSource(), undefined, {
        logoPublicOrigin,
      })
      expect(result.kind).toBe("active-advocate")
      if (result.kind === "active-advocate") {
        expect(result.presentation.logoUrl).toBeNull()
        expect(result.presentation.logoAltText).toBeNull()
      }
    }

    const localDenied = await resolveSource(cloneSource(), undefined, {
      logoPublicOrigin: "http://localhost:54321",
    })
    expect(localDenied.result.kind).toBe("active-advocate")
    if (localDenied.result.kind === "active-advocate") {
      expect(localDenied.result.presentation.logoUrl).toBeNull()
    }

    const localAllowed = await resolveSource(cloneSource(), undefined, {
      logoPublicOrigin: "http://localhost:54321",
      allowInsecureLocalLogoOrigin: true,
    })
    expect(localAllowed.result.kind).toBe("active-advocate")
    if (localAllowed.result.kind === "active-advocate") {
      expect(localAllowed.result.presentation.logoUrl).toBe(
        `http://localhost:54321/storage/v1/object/public/${PUBLIC_ADVOCATE_LOGO_BUCKET}/${LOGO_STORAGE_PATH}`,
      )
    }
  })

  test("handles absent logos and safe fallback alternative text", async () => {
    const absentSource = cloneSource()
    absentSource.branding.logo_storage_path = null as unknown as string
    absentSource.branding.logo_alt_text = null as unknown as string
    const absent = await resolveSource(absentSource)
    expect(absent.result.kind).toBe("active-advocate")
    if (absent.result.kind === "active-advocate") {
      expect(absent.result.presentation.logoUrl).toBeNull()
      expect(absent.result.presentation.logoAltText).toBeNull()
    }

    const fallbackSource = cloneSource()
    fallbackSource.branding.logo_alt_text = ""
    const fallback = await resolveSource(fallbackSource)
    expect(fallback.result.kind).toBe("active-advocate")
    if (fallback.result.kind === "active-advocate") {
      expect(fallback.result.presentation.logoAltText).toBe(
        "Alice Example logo",
      )
    }

    const invalidSource = cloneSource()
    invalidSource.branding.logo_alt_text = "a".repeat(301)
    const invalid = await resolveSource(invalidSource)
    expect(invalid.result).toMatchObject({
      kind: "unavailable-tenant",
      reason: "invalid-presentation",
    })
  })

  test("sanitizes rich text again on read and rejects unsafe shapes", async () => {
    const safe = await resolveSource(cloneSource())
    expect(safe.result.kind).toBe("active-advocate")
    if (safe.result.kind === "active-advocate") {
      expect(safe.result.presentation.openingHeaderHtml).toBe(
        "<h1>Welcome</h1>",
      )
      expect(safe.result.presentation.aboutBiographyHtml).toBe(
        "<p>About us.</p>",
      )
      expect(JSON.stringify(safe.result.presentation)).not.toMatch(
        /onclick|script|href|https:\/\/tracker|<img/i,
      )
    }

    const invalid = cloneSource()
    invalid.branding.opening_header_html = "a".repeat(16_385)
    const oversized = await resolveSource(invalid)
    expect(oversized.result).toMatchObject({
      kind: "unavailable-tenant",
      reason: "invalid-presentation",
    })
  })

  test("rejects duplicate, invalid, or ambiguously ordered public metrics", async () => {
    expect(PUBLIC_ADVOCATE_METRIC_KEYS).toHaveLength(9)

    const cases: Array<(source: typeof BASE_SOURCE) => void> = [
      (source) => {
        source.metricSelections[1].metric_key = "children_sponsored"
      },
      (source) => {
        source.metricSelections[0].metric_key = "private_exact_revenue"
      },
      (source) => {
        source.metricSelections[1].display_order = 2
      },
      (source) => {
        source.metricSelections[0].display_order = -1
      },
    ]

    for (const mutate of cases) {
      const source = cloneSource()
      mutate(source)
      const { result } = await resolveSource(source)
      expect(result).toMatchObject({
        kind: "unavailable-tenant",
        reason: "invalid-presentation",
      })
    }
  })

  test("keeps every beneficiary mode while exposing no beneficiary IDs", async () => {
    for (const beneficiaryMode of [
      "all",
      "all_featured",
      "selected",
    ] as const) {
      const source = cloneSource()
      source.advocate.beneficiary_mode = beneficiaryMode
      const { result } = await resolveSource(source)
      expect(result.kind).toBe("active-advocate")
      if (result.kind === "active-advocate") {
        expect(result.presentation.beneficiaryMode).toBe(beneficiaryMode)
        expect(JSON.stringify(result.presentation)).not.toContain(
          "private-beneficiary-",
        )
        expect(Object.keys(result.presentation)).not.toContain(
          "selectedBeneficiaryIds",
        )
        expect(Object.keys(result.presentation)).not.toContain(
          "featuredBeneficiaryIds",
        )
      }
    }
  })

  test("keeps the boundary and repository server only", () => {
    for (const path of [
      "src/lib/advocates/publicPresentation.ts",
      "src/lib/advocates/publicPresentationRepository.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8")
      expect(source.startsWith('import "server-only"')).toBe(true)
    }
  })
})
