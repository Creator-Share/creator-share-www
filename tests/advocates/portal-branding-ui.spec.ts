import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { currentAdvocatePortalNavigationHref } from "../../src/components/advocates/admin/PortalNavigation"
import {
  advocateBrandingFormFingerprint,
  buildAdvocateBrandingJsonPayload,
  buildAdvocateBrandingLogoFormData,
  isAdvocateBrandingRichTextWithinLimit,
  normalizeAdvocateBrandingFormColor,
  parseAdvocateBrandingSaveResponse,
  resolveAdvocateBrandingEditability,
  validateAdvocateBrandingLogoFile,
  type AdvocateBrandingFormValues,
} from "../../src/lib/advocates/admin/brandingForm"

const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const LOGO_PATH = "logos/hope/22222222-2222-4222-8222-222222222222.webp"

const VALUES: AdvocateBrandingFormValues = Object.freeze({
  expectedVersion: 7,
  primaryColor: "#1C3C8C",
  accentColor: "#F4B942",
  logoStoragePath: LOGO_PATH,
  logoAltText: "Hope Creates logo",
  openingHeaderHtml: "<h2>Welcome</h2>",
  aboutBiographyHtml: "<p>We help families.</p>",
  changeReason: "Refresh the welcome message",
})

test.describe("advocate branding form boundary", () => {
  test("normalizes colors and enforces client-side rich text and logo bounds", () => {
    expect(normalizeAdvocateBrandingFormColor(" #1c3c8c ")).toBe("#1C3C8C")
    expect(normalizeAdvocateBrandingFormColor("#12345G")).toBeNull()

    expect(isAdvocateBrandingRichTextWithinLimit("<p>Welcome</p>")).toBe(true)
    expect(isAdvocateBrandingRichTextWithinLimit("x".repeat(16_385))).toBe(
      false,
    )

    expect(
      validateAdvocateBrandingLogoFile({ size: 10, type: "image/png" }),
    ).toBeNull()
    expect(
      validateAdvocateBrandingLogoFile({ size: 10, type: "image/svg+xml" }),
    ).toBe("logo_type")
    expect(
      validateAdvocateBrandingLogoFile({
        size: 5 * 1024 * 1024 + 1,
        type: "image/webp",
      }),
    ).toBe("logo_too_large")
  })

  test("builds exact sponsor-free JSON and multipart mutation payloads", async () => {
    expect(buildAdvocateBrandingJsonPayload(VALUES)).toEqual(VALUES)
    expect(
      Object.keys(buildAdvocateBrandingJsonPayload(VALUES)).sort(),
    ).toEqual([
      "aboutBiographyHtml",
      "accentColor",
      "changeReason",
      "expectedVersion",
      "logoAltText",
      "logoStoragePath",
      "openingHeaderHtml",
      "primaryColor",
    ])

    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", {
      type: "image/png",
    })
    const { logoStoragePath: _path, ...logoValues } = VALUES
    const {
      expectedVersion: _version,
      changeReason: _reason,
      ...fingerprintValues
    } = VALUES
    const form = buildAdvocateBrandingLogoFormData({
      file,
      values: logoValues,
    })
    expect([...form.keys()].sort()).toEqual([
      "aboutBiographyHtml",
      "accentColor",
      "changeReason",
      "expectedVersion",
      "file",
      "logoAltText",
      "openingHeaderHtml",
      "primaryColor",
    ])
    expect(form.get("expectedVersion")).toBe("7")
    expect(form.get("file")).toBe(file)

    const serialized = JSON.stringify({
      json: buildAdvocateBrandingJsonPayload(VALUES),
      fingerprint: advocateBrandingFormFingerprint(fingerprintValues),
      multipartKeys: [...form.keys()],
    })
    expect(serialized).not.toMatch(
      /sponsor_email|sponsor_identity|contact_email|visitor_id|payment_provider/i,
    )
  })

  test("accepts only the exact next advocate version response", () => {
    expect(
      parseAdvocateBrandingSaveResponse(
        { ok: true, requestId: REQUEST_ID, advocateVersion: 8 },
        7,
      ),
    ).toEqual({ ok: true, requestId: REQUEST_ID, advocateVersion: 8 })

    for (const value of [
      { ok: true, requestId: REQUEST_ID, advocateVersion: 7 },
      { ok: true, requestId: REQUEST_ID, advocateVersion: 9 },
      {
        ok: true,
        requestId: REQUEST_ID,
        advocateVersion: 8,
        sponsor_email: "must-not-cross@example.com",
      },
      { ok: true, requestId: "bad", advocateVersion: 8 },
    ]) {
      expect(parseAdvocateBrandingSaveResponse(value, 7)).toBeNull()
    }

    expect(
      parseAdvocateBrandingSaveResponse(
        { ok: false, requestId: REQUEST_ID, code: "version_conflict" },
        7,
      ),
    ).toEqual({ ok: false, requestId: REQUEST_ID, code: "version_conflict" })
  })

  test("matches branding mutation permission and lifecycle eligibility", () => {
    for (const publicationStatus of [
      "draft",
      "provisioning",
      "active",
      "failed",
    ] as const) {
      expect(
        resolveAdvocateBrandingEditability({
          hasBrandingPermission: true,
          relationshipStatus: "active",
          publicationStatus,
        }),
      ).toEqual({ canEdit: true, readOnlyReason: null })
    }

    expect(
      resolveAdvocateBrandingEditability({
        hasBrandingPermission: false,
        relationshipStatus: "active",
        publicationStatus: "active",
      }),
    ).toEqual({
      canEdit: false,
      readOnlyReason:
        "You have view access. A portal administrator with branding permission must make changes.",
    })

    const ineligible = [
      {
        relationshipStatus: "invited" as const,
        publicationStatus: "draft" as const,
        reason: "invitation is accepted",
      },
      {
        relationshipStatus: "suspended" as const,
        publicationStatus: "active" as const,
        reason: "relationship is suspended",
      },
      {
        relationshipStatus: "archived" as const,
        publicationStatus: "active" as const,
        reason: "relationship is archived",
      },
      {
        relationshipStatus: "active" as const,
        publicationStatus: "suspended" as const,
        reason: "portal is suspended",
      },
    ]
    for (const lifecycle of ineligible) {
      const result = resolveAdvocateBrandingEditability({
        hasBrandingPermission: true,
        relationshipStatus: lifecycle.relationshipStatus,
        publicationStatus: lifecycle.publicationStatus,
      })
      expect(result.canEdit).toBe(false)
      expect(result.readOnlyReason).toContain(lifecycle.reason)
    }
  })
})

test.describe("advocate branding administrative UI contract", () => {
  test("selects the deepest available portal route as current", () => {
    const navigation = [
      {
        section: "overview" as const,
        label: "Overview",
        href: "/portal/hope",
        current: false,
        availability: "available" as const,
      },
      {
        section: "branding" as const,
        label: "Branding",
        href: "/portal/hope/branding",
        current: false,
        availability: "available" as const,
      },
    ]

    expect(
      currentAdvocatePortalNavigationHref("/portal/hope/branding/", navigation),
    ).toBe("/portal/hope/branding")
    expect(
      currentAdvocatePortalNavigationHref("/portal/hope", navigation),
    ).toBe("/portal/hope")
  })

  test("loads the fixed settings projection and gates mutation on branding permission", () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(advocate-admin)/portal/[slug]/branding/page.tsx",
      ),
      "utf8",
    )
    const clientSource = readFileSync(
      resolve(
        process.cwd(),
        "src/components/advocates/admin/BrandingSettingsClient.tsx",
      ),
      "utf8",
    )

    expect(pageSource).toContain("createAdvocateAdminSettingsRepository")
    expect(pageSource).toContain("resolveAdvocateBrandingEditability")
    expect(pageSource).toContain("logoStoragePath")
    expect(clientSource).toContain("settings.readOnlyReason")
    expect(clientSource).toContain('role="status"')
    expect(clientSource).toContain('aria-live="polite"')
    expect(clientSource).toContain('window.addEventListener("beforeunload"')
    expect(clientSource).toContain("version_conflict")
    expect(clientSource).toContain("Live preview")
    expect(`${pageSource}\n${clientSource}`).not.toMatch(
      /sponsor_email|sponsor_identity_id|contact_email|visitor_id|provider_customer_id/i,
    )
  })
})
