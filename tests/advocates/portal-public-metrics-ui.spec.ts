import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { buildAdvocatePortalNavigation } from "../../src/components/advocates/admin/PortalShell"
import {
  advocatePublicMetricsFingerprint,
  ADVOCATE_PUBLIC_METRIC_KEYS,
  ADVOCATE_PUBLIC_METRIC_OPTIONS,
  moveAdvocatePublicMetric,
  normalizeAdvocatePublicMetricKeys,
  orderedAdvocatePublicMetricOptions,
  parseAdvocatePublicMetricsSaveResponse,
} from "../../src/lib/advocates/admin/publicMetricsForm"

const REQUEST_ID = "11111111-1111-4111-8111-111111111111"

test.describe("advocate public metric form boundary", () => {
  test("exposes only the four approved public metric choices", () => {
    expect(ADVOCATE_PUBLIC_METRIC_KEYS).toEqual([
      "children_sponsored",
      "gross_raised_usd",
      "direct_sponsorships",
      "post_visit_attributed_sponsorships",
    ])
    expect(ADVOCATE_PUBLIC_METRIC_OPTIONS.map((option) => option.key)).toEqual(
      ADVOCATE_PUBLIC_METRIC_KEYS,
    )
    expect(JSON.stringify(ADVOCATE_PUBLIC_METRIC_OPTIONS)).not.toMatch(
      /verified_sponsor|unique_sponsor|net_raised|post_visit_observed/i,
    )
  })

  test("preserves exact selection order and rejects duplicates or forbidden keys", () => {
    expect(
      normalizeAdvocatePublicMetricKeys([
        "gross_raised_usd",
        "children_sponsored",
      ]),
    ).toEqual(["gross_raised_usd", "children_sponsored"])
    expect(normalizeAdvocatePublicMetricKeys([])).toEqual([])
    expect(
      normalizeAdvocatePublicMetricKeys([
        "children_sponsored",
        "children_sponsored",
      ]),
    ).toBeNull()
    expect(normalizeAdvocatePublicMetricKeys(["net_raised_usd"])).toBeNull()
    expect(
      normalizeAdvocatePublicMetricKeys([
        ...ADVOCATE_PUBLIC_METRIC_KEYS,
        "gross_raised_usd",
      ]),
    ).toBeNull()

    const options = orderedAdvocatePublicMetricOptions([
      "direct_sponsorships",
      "children_sponsored",
    ])
    expect(options.map((option) => option.key)).toEqual([
      "direct_sponsorships",
      "children_sponsored",
      "gross_raised_usd",
      "post_visit_attributed_sponsorships",
    ])
  })

  test("moves selected metrics without crossing list boundaries", () => {
    const selected = [
      "children_sponsored",
      "gross_raised_usd",
      "direct_sponsorships",
    ] as const
    expect(
      moveAdvocatePublicMetric(selected, "gross_raised_usd", "up"),
    ).toEqual(["gross_raised_usd", "children_sponsored", "direct_sponsorships"])
    expect(
      moveAdvocatePublicMetric(selected, "gross_raised_usd", "down"),
    ).toEqual(["children_sponsored", "direct_sponsorships", "gross_raised_usd"])
    expect(moveAdvocatePublicMetric(selected, "children_sponsored", "up")).toBe(
      selected,
    )
    expect(
      moveAdvocatePublicMetric(selected, "direct_sponsorships", "down"),
    ).toBe(selected)
    expect(advocatePublicMetricsFingerprint(selected)).not.toBe(
      advocatePublicMetricsFingerprint([...selected].reverse()),
    )
  })

  test("strictly parses saved and stale responses while rejecting unchanged success", () => {
    expect(
      parseAdvocatePublicMetricsSaveResponse(
        { ok: true, requestId: REQUEST_ID, advocateVersion: 8 },
        7,
      ),
    ).toEqual({
      ok: true,
      requestId: REQUEST_ID,
      advocateVersion: 8,
    })
    expect(
      parseAdvocatePublicMetricsSaveResponse(
        { ok: false, requestId: REQUEST_ID, code: "version_conflict" },
        7,
      ),
    ).toEqual({
      ok: false,
      requestId: REQUEST_ID,
      code: "version_conflict",
    })

    for (const value of [
      { ok: true, requestId: REQUEST_ID, advocateVersion: 7 },
      { ok: true, requestId: REQUEST_ID, advocateVersion: 9 },
      {
        ok: true,
        requestId: REQUEST_ID,
        advocateVersion: 8,
        sponsorEmail: "must-not-cross@example.com",
      },
      {
        ok: false,
        requestId: REQUEST_ID,
        code: "version_conflict",
        details: "tenant internals",
      },
      { ok: true, requestId: "bad", advocateVersion: 8 },
    ]) {
      expect(parseAdvocatePublicMetricsSaveResponse(value, 7)).toBeNull()
    }
  })
})

test.describe("advocate public metric administrative UI contract", () => {
  test("adds a permission appropriate live navigation link", () => {
    const navigation = buildAdvocatePortalNavigation({
      slug: "hope",
      permissions: ["portal.public_metrics.update", "portal.view"],
    })
    expect(navigation.at(-1)).toEqual(
      expect.objectContaining({
        section: "public-metrics",
        href: "/portal/hope/public-metrics",
        availability: "available",
      }),
    )

    const viewerNavigation = buildAdvocatePortalNavigation({
      slug: "hope",
      permissions: ["portal.view"],
    })
    expect(
      viewerNavigation.some((item) => item.section === "public-metrics"),
    ).toBe(false)
  })

  test("loads settings behind update permission and renders privacy safe ordered controls", () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(advocate-admin)/portal/[slug]/public-metrics/page.tsx",
      ),
      "utf8",
    )
    const clientSource = readFileSync(
      resolve(
        process.cwd(),
        "src/components/advocates/admin/PublicMetricSettingsClient.tsx",
      ),
      "utf8",
    )

    expect(pageSource).toContain("createAdvocateAdminSettingsRepository")
    expect(pageSource).toContain('"portal.public_metrics.update"')
    expect(pageSource).toContain("notFound()")
    expect(pageSource).not.toContain(".filter(isAdvocatePublicMetricKey)")
    expect(clientSource).toContain("Move up")
    expect(clientSource).toContain("Move down")
    expect(clientSource).toContain("delayed lower bounds")
    expect(clientSource).toContain("may remain Pending")
    expect(clientSource).toContain("Public totals never identify")
    expect(clientSource).toContain("maxLength={500}")
    expect(clientSource).toContain('window.addEventListener("beforeunload"')
    expect(clientSource).toContain("Reload latest settings")
    expect(clientSource).toContain("version_conflict")
    expect(clientSource).toContain("no_change")
    expect(clientSource).toContain('aria-live="polite"')
    expect(`${pageSource}\n${clientSource}`).not.toMatch(
      /sponsor_email|sponsor_identity_id|contact_email|visitor_id|provider_customer_id/i,
    )
  })
})
