import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type SettingsModule = typeof import("../../src/lib/advocates/admin/settings")
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
  resolve(process.cwd(), "tests/advocates/portal-settings.spec.ts"),
)
const settingsModule = testRequire(
  resolve(process.cwd(), "src/lib/advocates/admin/settings.ts"),
) as SettingsModule

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const BENEFICIARY_ID = "22222222-2222-4222-8222-222222222222"
const LOGO_ID = "33333333-3333-4333-8333-333333333333"
const EXPECTED = { advocateId: ADVOCATE_ID, slug: "hope" }

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    advocate: {
      id: ADVOCATE_ID,
      slug: "hope",
      display_name: "Hope Creates",
      advocate_type: "creator",
      relationship_status: "active",
      publication_status: "active",
      beneficiary_mode: "all_featured",
      advocate_version: 7,
    },
    branding: {
      primary_color: "#1C3C8C",
      accent_color: "#F4B942",
      logo_storage_path: `logos/hope/${LOGO_ID}.webp`,
      logo_alt_text: "Hope Creates logo",
      opening_header_html: "<h2>Welcome</h2>",
      about_biography_html: "<p>We help families.</p>",
    },
    public_metric_selections: [
      { metric_key: "children_sponsored", display_order: 0 },
      { metric_key: "gross_raised_usd", display_order: 1 },
    ],
    beneficiary_selections: [
      {
        beneficiary_id: BENEFICIARY_ID,
        is_featured: true,
        display_order: 0,
      },
    ],
    ...overrides,
  }
}

test.describe("advocate portal settings projection", () => {
  test("parses the fixed sponsor-free settings document", () => {
    expect(
      settingsModule.parseAdvocateAdminSettings(snapshot(), EXPECTED),
    ).toEqual({
      advocate: {
        id: ADVOCATE_ID,
        slug: "hope",
        displayName: "Hope Creates",
        advocateType: "creator",
        relationshipStatus: "active",
        publicationStatus: "active",
        beneficiaryMode: "all_featured",
        advocateVersion: 7,
      },
      branding: {
        primaryColor: "#1C3C8C",
        accentColor: "#F4B942",
        logoStoragePath: `logos/hope/${LOGO_ID}.webp`,
        logoAltText: "Hope Creates logo",
        openingHeaderHtml: "<h2>Welcome</h2>",
        aboutBiographyHtml: "<p>We help families.</p>",
      },
      publicMetricSelections: [
        { metricKey: "children_sponsored", displayOrder: 0 },
        { metricKey: "gross_raised_usd", displayOrder: 1 },
      ],
      beneficiarySelections: [
        {
          beneficiaryId: BENEFICIARY_ID,
          isFeatured: true,
          displayOrder: 0,
        },
      ],
    })
  })

  test("sanitizes stored rich text again on the administrative read path", () => {
    const value = snapshot()
    value.branding.opening_header_html =
      '<script>alert(1)</script><h1 onclick="alert(1)">Welcome</h1>'
    value.branding.about_biography_html =
      '<a href="https://evil.example">No link</a><blockquote>Our story</blockquote>'

    const parsed = settingsModule.parseAdvocateAdminSettings(value, EXPECTED)
    expect(parsed?.branding.openingHeaderHtml).toBe("<h2>Welcome</h2>")
    expect(parsed?.branding.aboutBiographyHtml).toBe(
      "No link<blockquote>Our story</blockquote>",
    )
  })

  test("fails closed on cross tenant logo paths and identity mismatches", () => {
    const wrongLogo = snapshot()
    wrongLogo.branding.logo_storage_path = `logos/other/${LOGO_ID}.webp`
    expect(
      settingsModule.parseAdvocateAdminSettings(wrongLogo, EXPECTED),
    ).toBeNull()

    const wrongIdentity = snapshot()
    wrongIdentity.advocate.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    expect(
      settingsModule.parseAdvocateAdminSettings(wrongIdentity, EXPECTED),
    ).toBeNull()
  })

  test("rejects added fields, malformed ordering, duplicates, and sponsor leakage", () => {
    const variants = [
      snapshot({ sponsor_email: "must-not-cross@example.com" }),
      snapshot({
        public_metric_selections: [
          { metric_key: "children_sponsored", display_order: 1 },
        ],
      }),
      snapshot({
        public_metric_selections: [
          { metric_key: "children_sponsored", display_order: 0 },
          { metric_key: "children_sponsored", display_order: 1 },
        ],
      }),
      snapshot({
        public_metric_selections: [
          { metric_key: "sponsor_email", display_order: 0 },
        ],
      }),
      snapshot({
        beneficiary_selections: [
          {
            beneficiary_id: BENEFICIARY_ID,
            is_featured: true,
            display_order: 1,
          },
        ],
      }),
      snapshot({
        beneficiary_selections: [
          {
            beneficiary_id: BENEFICIARY_ID,
            is_featured: true,
            display_order: 0,
            sponsor_identity_id: ADVOCATE_ID,
          },
        ],
      }),
    ]

    for (const value of variants) {
      expect(
        settingsModule.parseAdvocateAdminSettings(value, EXPECTED),
      ).toBeNull()
    }
  })

  test("uses only the fixed authenticated settings RPC", async () => {
    const calls: Array<{ name: string; input: unknown }> = []
    const repository = settingsModule.createAdvocateAdminSettingsRepository({
      async rpc(name: string, input?: unknown) {
        calls.push({ name, input })
        return { data: snapshot(), error: null }
      },
    } as never)

    await expect(repository.load(EXPECTED)).resolves.toMatchObject({
      advocate: { id: ADVOCATE_ID },
    })
    expect(calls).toEqual([
      {
        name: "get_advocate_admin_settings",
        input: { target_advocate_id: ADVOCATE_ID },
      },
    ])
  })
})
