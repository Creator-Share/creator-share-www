import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type BrandingModule = typeof import("../../src/lib/advocates/admin/branding")
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
  resolve(process.cwd(), "tests/advocates/portal-branding.spec.ts"),
)
const {
  classifyAdvocateBrandingUpdateFailure,
  deriveAdvocateBrandingRequestId,
  exactAdvocateLogoStoragePath,
  MAX_ADVOCATE_BRANDING_BODY_BYTES,
  parseAdvocateBrandingUpdateInput,
  parseAdvocateBrandingUpdateResult,
  readBoundedAdvocateBrandingBody,
  updateAdvocateBranding,
} = testRequire(
  resolve(process.cwd(), "src/lib/advocates/admin/branding.ts"),
) as BrandingModule

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const LOGO_ID = "33333333-3333-4333-8333-333333333333"

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    expectedVersion: 7,
    primaryColor: "#1c3c8c",
    accentColor: "#f4b942",
    logoStoragePath: `logos/hope/${LOGO_ID}.webp`,
    logoAltText: "Hope Foundation logo",
    openingHeaderHtml: "<h1>Welcome</h1><p>Help a child.</p>",
    aboutBiographyHtml: "<h2>About us</h2><p>We serve families.</p>",
    changeReason: "Refresh the portal brand for the fall sponsorship drive.",
    ...overrides,
  })
}

test.describe("advocate portal branding boundary", () => {
  test("canonicalizes colors and approved rich text before persistence", () => {
    expect(parseAdvocateBrandingUpdateInput(body(), "hope")).toEqual({
      expectedVersion: 7,
      primaryColor: "#1C3C8C",
      accentColor: "#F4B942",
      logoStoragePath: `logos/hope/${LOGO_ID}.webp`,
      logoAltText: "Hope Foundation logo",
      openingHeaderHtml: "<h2>Welcome</h2><p>Help a child.</p>",
      aboutBiographyHtml: "<h3>About us</h3><p>We serve families.</p>",
      changeReason: "Refresh the portal brand for the fall sponsorship drive.",
    })

    expect(
      parseAdvocateBrandingUpdateInput(
        body({ logoStoragePath: null, logoAltText: null }),
        "hope",
      ),
    ).toMatchObject({ logoStoragePath: null, logoAltText: null })
  })

  test("removes executable and unsupported rich text rather than storing it", () => {
    const parsed = parseAdvocateBrandingUpdateInput(
      body({
        openingHeaderHtml:
          '<script>alert(1)</script><p class="evil" onclick="alert(1)">Safe</p><a href="https://evil.example">No link</a>',
        aboutBiographyHtml:
          "<svg><script>alert(1)</script></svg><blockquote>Story</blockquote>",
      }),
      "hope",
    )
    expect(parsed?.openingHeaderHtml).toBe("<p>Safe</p>No link")
    expect(parsed?.aboutBiographyHtml).toBe("<blockquote>Story</blockquote>")
  })

  test("requires an exact same tenant immutable logo path", () => {
    expect(
      exactAdvocateLogoStoragePath(`logos/hope/${LOGO_ID}.webp`, "hope"),
    ).toBe(`logos/hope/${LOGO_ID}.webp`)
    expect(exactAdvocateLogoStoragePath(null, "hope")).toBeNull()

    for (const invalid of [
      `logos/other/${LOGO_ID}.webp`,
      "logos/hope/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.webp",
      `logos/hope/${LOGO_ID}.png`,
      `logos/hope/extra/${LOGO_ID}.webp`,
      `logos/hope/${LOGO_ID}.webp?download=1`,
      `https://example.com/${LOGO_ID}.webp`,
    ]) {
      expect(exactAdvocateLogoStoragePath(invalid, "hope")).toBeUndefined()
    }
  })

  test("rejects shape smuggling, malformed fields, and invalid versions", () => {
    for (const invalid of [
      body({ unexpected: true }),
      body({ expectedVersion: 0 }),
      body({ expectedVersion: 1.5 }),
      body({ primaryColor: "blue" }),
      body({ logoAltText: "" }),
      body({ logoAltText: "x".repeat(301) }),
      body({ logoStoragePath: null }),
      body({ logoStoragePath: `logos/other/${LOGO_ID}.webp` }),
      body({ openingHeaderHtml: "x".repeat(16_385) }),
      body({ changeReason: "   " }),
      "[]",
      "not-json",
    ]) {
      expect(parseAdvocateBrandingUpdateInput(invalid, "hope")).toBeNull()
    }
  })

  test("bounds and strictly decodes the streamed request", async () => {
    await expect(
      readBoundedAdvocateBrandingBody(
        new Request("https://creatorshare.com/api/portal/hope/branding", {
          method: "POST",
          body: body(),
        }),
      ),
    ).resolves.toBe(body())

    const oversized = "x".repeat(MAX_ADVOCATE_BRANDING_BODY_BYTES + 1)
    await expect(
      readBoundedAdvocateBrandingBody(
        new Request("https://creatorshare.com/api/portal/hope/branding", {
          method: "POST",
          body: oversized,
        }),
      ),
    ).resolves.toBeNull()

    await expect(
      readBoundedAdvocateBrandingBody(
        new Request("https://creatorshare.com/api/portal/hope/branding", {
          method: "POST",
          body: Uint8Array.from([0xc3, 0x28]),
        }),
      ),
    ).resolves.toBeNull()
  })

  test("derives a stable content and actor bound request id", () => {
    const update = parseAdvocateBrandingUpdateInput(body(), "hope")
    expect(update).not.toBeNull()
    if (update === null) return

    const requestId = deriveAdvocateBrandingRequestId({
      actorUserId: ACTOR_ID,
      advocateId: ADVOCATE_ID,
      update,
    })
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(
      deriveAdvocateBrandingRequestId({
        actorUserId: ACTOR_ID,
        advocateId: ADVOCATE_ID,
        update,
      }),
    ).toBe(requestId)
    expect(
      deriveAdvocateBrandingRequestId({
        actorUserId: ACTOR_ID,
        advocateId: ADVOCATE_ID,
        update: { ...update, accentColor: "#000000" },
      }),
    ).not.toBe(requestId)
  })

  test("accepts only the exactly incremented aggregate version", () => {
    expect(parseAdvocateBrandingUpdateResult(8, 7)).toBe(8)
    for (const invalid of [7, 9, 8.5, "8", [8], null]) {
      expect(parseAdvocateBrandingUpdateResult(invalid, 7)).toBeNull()
    }
  })

  test("maps the canonical update to only the narrow server RPC", async () => {
    const update = parseAdvocateBrandingUpdateInput(body(), "hope")
    expect(update).not.toBeNull()
    if (update === null) return

    const calls: Array<{ name: string; input: unknown }> = []
    const client = {
      async rpc(name: string, input: unknown) {
        calls.push({ name, input })
        return { data: 8, error: null }
      },
    }
    await expect(
      updateAdvocateBranding(client as never, {
        advocateId: ADVOCATE_ID,
        actorUserId: ACTOR_ID,
        input: update,
        logoUploadReservationId: null,
        requestId: "44444444-4444-4444-8444-444444444444",
        traceId: "portal-trace-1",
        sessionId: null,
      }),
    ).resolves.toBe(8)

    expect(calls).toEqual([
      {
        name: "update_advocate_branding",
        input: {
          target_advocate_id: ADVOCATE_ID,
          target_actor_user_id: ACTOR_ID,
          expected_advocate_version: 7,
          target_primary_color: "#1C3C8C",
          target_accent_color: "#F4B942",
          target_logo_storage_path: `logos/hope/${LOGO_ID}.webp`,
          target_logo_upload_reservation_id: null,
          target_logo_alt_text: "Hope Foundation logo",
          target_opening_header_html: "<h2>Welcome</h2><p>Help a child.</p>",
          target_about_biography_html:
            "<h3>About us</h3><p>We serve families.</p>",
          change_reason:
            "Refresh the portal brand for the fall sponsorship drive.",
          request_id: "44444444-4444-4444-8444-444444444444",
          trace_id: "portal-trace-1",
          session_id: null,
        },
      },
    ])
  })

  test("maps database failures to static nonleaking outcomes", () => {
    expect(classifyAdvocateBrandingUpdateFailure("22023")).toEqual({
      status: 400,
      code: "invalid_request",
    })
    expect(classifyAdvocateBrandingUpdateFailure("42501")).toEqual({
      status: 403,
      code: "forbidden",
    })
    expect(classifyAdvocateBrandingUpdateFailure("23503")).toEqual({
      status: 404,
      code: "portal_not_found",
    })
    expect(classifyAdvocateBrandingUpdateFailure("40001")).toEqual({
      status: 409,
      code: "version_conflict",
    })
    expect(classifyAdvocateBrandingUpdateFailure("XX000")).toEqual({
      status: 500,
      code: "branding_update_failed",
    })
  })
})
