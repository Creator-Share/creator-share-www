import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  createAdvocatePublicSite,
  createPaymentPublicSite,
  createPrimaryPublicSite,
  createPublicSiteImpactMetricItems,
  type PublicSiteMetric,
} from "../../src/lib/advocates/publicSite"

const METRIC_AS_OF = "2026-07-06T00:00:00Z"

const METRICS: readonly PublicSiteMetric[] = [
  {
    key: "gross_raised_usd",
    status: "published",
    value: "120000",
    unit: "usd_cents",
    qualifier: "at_least",
    asOf: METRIC_AS_OF,
  },
  {
    key: "direct_sponsorships",
    status: "pending",
    value: null,
    unit: null,
    qualifier: null,
    asOf: null,
  },
  {
    key: "children_sponsored",
    status: "published",
    value: "25",
    unit: "count",
    qualifier: "at_least",
    asOf: METRIC_AS_OF,
  },
]

function advocateSite(publicMetrics: readonly PublicSiteMetric[] = METRICS) {
  return createAdvocatePublicSite({
    canonicalHostname: "alice.creatorshare.com",
    slug: "alice",
    displayName: "Alice Example",
    beneficiaryMode: "all",
    primaryColor: "#173E8C",
    accentColor: "#F6C344",
    logoUrl: null,
    logoAltText: null,
    openingHeaderHtml: "",
    aboutBiographyHtml: "",
    publicMetrics,
  })
}

test.describe("public advocate impact metrics", () => {
  test("renders the selected metrics in their server-approved order", () => {
    const items = createPublicSiteImpactMetricItems(advocateSite())

    expect(items.map((item) => item.label)).toEqual([
      "Gross funds raised",
      "Direct sponsorships",
      "Children sponsored",
    ])
    expect(items.map((item) => item.formattedValue)).toEqual([
      "$1,200+",
      "Not available yet",
      "25+",
    ])
    expect(items[0].timing).toBe("As of Jul 6, 2026")
  })

  test("uses explicit accessible section and definition list semantics", () => {
    const componentSource = readFileSync(
      resolve(
        process.cwd(),
        "src/components/advocates/AdvocateImpactMetrics.tsx",
      ),
      "utf8",
    )

    expect(componentSource).toContain(
      'aria-labelledby="advocate-impact-heading"',
    )
    expect(componentSource).toContain('id="advocate-impact-heading"')
    expect(componentSource).toContain("<dl")
    expect(componentSource).toContain("<dt")
    expect(componentSource).toContain("<dd")
    expect(componentSource).toContain("aria-describedby=")
    expect(componentSource).toContain("<time dateTime={metric.asOf}")
    expect(componentSource).toContain(
      'className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"',
    )
    expect(componentSource).not.toContain("sm:grid-cols-2")
    expect(componentSource).not.toContain("<table")
    expect(componentSource).not.toContain("aria-live")
  })

  test("explains a pending privacy milestone without inventing an as-of date", () => {
    const items = createPublicSiteImpactMetricItems(advocateSite([METRICS[1]]))

    expect(items[0]).toMatchObject({
      formattedValue: "Not available yet",
      timing: "Updates after the first privacy-safe milestone.",
    })
    expect(items[0].timing).not.toContain("As of")
  })

  test("renders no metric data for empty, primary, or payment experiences", () => {
    for (const site of [
      advocateSite([]),
      createPrimaryPublicSite("creatorshare.com"),
      createPaymentPublicSite(),
    ]) {
      expect(createPublicSiteImpactMetricItems(site)).toEqual([])
    }
  })

  test("mounts immediately after the hero and uses no browser data channel", () => {
    const pageSource = readFileSync(
      resolve(process.cwd(), "src/app/page.tsx"),
      "utf8",
    )
    const componentSource = readFileSync(
      resolve(
        process.cwd(),
        "src/components/advocates/AdvocateImpactMetrics.tsx",
      ),
      "utf8",
    )

    expect(pageSource).toMatch(
      /<HomeHero[\s\S]*?<AdvocateImpactMetrics \/>[\s\S]*?<SponsorshipsContainer/,
    )
    expect(componentSource).toContain(
      "createPublicSiteImpactMetricItems(publicSite)",
    )
    expect(componentSource).toContain("if (metrics.length === 0) return null")
    expect(componentSource).not.toMatch(
      /fetch\(|createClient\(|useEffect|WebSocket/,
    )
    expect(componentSource).not.toMatch(/animate|transition|aria-live/)
  })
})
