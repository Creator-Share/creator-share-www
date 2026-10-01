import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"

import { expect, test } from "@playwright/test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

import {
  formatAnalyticsAsOf,
  formatAnalyticsMinorAmount,
} from "../../src/components/advocates/admin/AnalyticsDashboard"

type AnalyticsModule = typeof import("../../src/lib/advocates/admin/analytics")
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
  resolve(process.cwd(), "tests/advocates/portal-analytics.spec.ts"),
)
const analytics = testRequire(
  "../../src/lib/advocates/admin/analytics",
) as AnalyticsModule
nodeModule._load = originalModuleLoad

// Playwright rewrites JSX to its component-test representation. Compile this
// server component with the production React JSX runtime for actual SSR.
const dashboardSource = readFileSync(resolve(process.cwd(), "src/components/advocates/admin/AnalyticsDashboard.tsx"), "utf8")
const dashboardModule = { exports: {} }
runInNewContext(ts.transpileModule(dashboardSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { module: dashboardModule, exports: dashboardModule.exports, require: testRequire })
const { AnalyticsDashboard } = dashboardModule.exports as typeof import("../../src/components/advocates/admin/AnalyticsDashboard")

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"

function visibleCell(overrides: Record<string, unknown> = {}) {
  return {
    suppressed: false,
    sponsorships: 8,
    unique_sponsor_contacts: 6,
    verified_sponsor_accounts: 6,
    initial_collected_usd_cents: 10_000,
    renewal_collected_usd_cents: 5_000,
    gross_collected_usd_cents: 15_000,
    refunds_and_reversals_usd_cents: 1_000,
    dispute_debits_usd_cents: 500,
    dispute_credits_usd_cents: 250,
    net_collected_usd_cents: 13_750,
    active_monthly_commitment_usd_cents: 1_200,
    active_annual_commitment_usd_cents: 2_400,
    annualized_commitment_usd_cents: 16_800,
    ...overrides,
  }
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    disclosure: { state: "released", policy_version: "coordinated-v1", cadence: "weekly", minimum_changed_contacts: 5 },
    as_of: "2026-07-13T00:00:00+00:00",
    methodology: {
      minimum_sponsor_contacts_per_cell: 5,
      official_window_days: 30,
      observed_window_days: 365,
      renewals_increase_funds_not_counts: true,
      measure_suppression_enabled: true,
    },
    official: visibleCell(),
    observed: { suppressed: true },
    segments: analytics.ADVOCATE_ANALYTICS_SEGMENT_KEYS.map((key) => ({
      key,
      ...visibleCell(),
    })),
    original_currency: [
      {
        suppressed: false,
        currency: "AUD",
        sponsorships: 7,
        unique_sponsor_contacts: 5,
        initial_collected_minor: 10_000,
        renewal_collected_minor: 2_000,
        gross_collected_minor: 12_000,
        refunds_and_reversals_minor: 1_000,
        dispute_debits_minor: 250,
        dispute_credits_minor: 100,
        net_collected_minor: 10_850,
      },
      {
        suppressed: false,
        currency: "USD",
        sponsorships: 8,
        unique_sponsor_contacts: 6,
        initial_collected_minor: 10_000,
        renewal_collected_minor: 5_000,
        gross_collected_minor: 15_000,
        refunds_and_reversals_minor: 1_000,
        dispute_debits_minor: 500,
        dispute_credits_minor: 250,
        net_collected_minor: 13_750,
      },
    ],
    ...overrides,
  }
}

test.describe("advocate private analytics projection", () => {
  test("renders a fixed pending report and rejects financial data in that state", () => {
    const pending = snapshot({
      as_of: null,
      disclosure: { state: "pending", policy_version: "coordinated-v1", cadence: "weekly", minimum_changed_contacts: 5 },
      official: { suppressed: true }, observed: { suppressed: true },
      segments: null, original_currency: null,
    })
    const parsed = analytics.parseAdvocateAnalyticsSnapshot(pending)
    expect(parsed).toMatchObject({ asOf: null, disclosure: { state: "pending" } })
    if (!parsed) throw new Error("Expected the pending snapshot")
    const html = renderToStaticMarkup(createElement(AnalyticsDashboard, { advocateName: "Example", snapshot: parsed }))
    expect(html).toContain("The first report is pending")
    expect(html).not.toContain("Data cutoff:")
    expect(analytics.parseAdvocateAnalyticsSnapshot({ ...pending, official: visibleCell() })).toBeNull()
    expect(analytics.parseAdvocateAnalyticsSnapshot({ ...pending, as_of: "2026-07-13T00:00:00Z" })).toBeNull()
    for (const disclosure of [undefined, { ...pending.disclosure, state: ["released"] },
      { ...pending.disclosure, minimum_changed_contacts: 1 }, { ...pending.disclosure, policy_version: "unknown" }]) {
      expect(analytics.parseAdvocateAnalyticsSnapshot({ ...pending, disclosure })).toBeNull()
    }
  })

  test("renders withheld count and initial-fund updates across every financial surface", () => {
    const withheld = { sponsorships: null, unique_sponsor_contacts: null,
      verified_sponsor_accounts: null, initial_collected_usd_cents: null,
      gross_collected_usd_cents: null, net_collected_usd_cents: null }
    const source = snapshot({
      official: visibleCell(withheld),
      segments: analytics.ADVOCATE_ANALYTICS_SEGMENT_KEYS.map((key) => ({
        key, ...visibleCell(key === "observed_30_365_days" ? {} : withheld),
      })),
      original_currency: (snapshot().original_currency as Record<string, unknown>[]).map((row) => ({ ...row,
        sponsorships: null, unique_sponsor_contacts: null, initial_collected_minor: null,
        gross_collected_minor: null, net_collected_minor: null })),
    })
    const parsed = analytics.parseAdvocateAnalyticsSnapshot(source)
    expect(parsed?.official).toMatchObject({ sponsorships: null, initialCollectedUsdCents: null })
    if (!parsed) throw new Error("Expected the withheld snapshot")
    const html = renderToStaticMarkup(createElement(AnalyticsDashboard, { advocateName: "Example", snapshot: parsed }))
    expect(html).toContain("Withheld for privacy")
    expect(html).toContain("July 13, 2026")
    expect(html).toContain("an earlier report")
    expect(html).not.toContain("NaN")
    expect(analytics.parseAdvocateAnalyticsSnapshot({ ...source, as_of: "2026-07-14T00:00:00Z" })).toBeNull()
  })

  test("parses and freezes only the exact privacy safe snapshot", () => {
    const parsed = analytics.parseAdvocateAnalyticsSnapshot(snapshot())

    expect(parsed).toMatchObject({
      schemaVersion: 2,
      asOf: "2026-07-13T00:00:00+00:00",
      methodology: {
        minimumSponsorContactsPerCell: 5,
        officialWindowDays: 30,
        observedWindowDays: 365,
        renewalsIncreaseFundsNotCounts: true,
        measureSuppressionEnabled: true,
      },
      official: {
        suppressed: false,
        sponsorships: 8,
        uniqueSponsorContacts: 6,
        verifiedSponsorAccounts: 6,
        grossCollectedUsdCents: 15_000,
        netCollectedUsdCents: 13_750,
      },
      observed: { suppressed: true },
      segments: [
        expect.objectContaining({ key: "direct", suppressed: false }),
        expect.objectContaining({
          key: "post_visit_0_1_day",
          suppressed: false,
        }),
        expect.objectContaining({
          key: "post_visit_1_7_days",
          suppressed: false,
        }),
        expect.objectContaining({
          key: "post_visit_7_30_days",
          suppressed: false,
        }),
        expect.objectContaining({
          key: "observed_30_365_days",
          suppressed: false,
        }),
      ],
      originalCurrency: [
        expect.objectContaining({
          currency: "AUD",
          sponsorships: 7,
          uniqueSponsorContacts: 5,
          grossCollectedMinor: 12_000,
          netCollectedMinor: 10_850,
        }),
        expect.objectContaining({ currency: "USD" }),
      ],
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed?.official)).toBe(true)
    expect(Object.isFrozen(parsed?.segments)).toBe(true)
    expect(Object.isFrozen(parsed?.segments?.[0])).toBe(true)
    expect(Object.isFrozen(parsed?.originalCurrency)).toBe(true)
    expect(JSON.stringify(parsed)).not.toMatch(
      /email|auth_user|sponsor_identity|contact_email|visitor|exposure|intent_id|provider/i,
    )
  })

  test("accepts only all-family visibility or complete family suppression", () => {
    expect(
      analytics.parseAdvocateAnalyticsSnapshot(
        snapshot({ segments: null, original_currency: null }),
      ),
    ).toMatchObject({ segments: null, originalCurrency: null })

    const segmentSource = snapshot().segments as Record<string, unknown>[]
    for (const invalid of [
      segmentSource.slice(0, 4),
      [...segmentSource].reverse(),
      [
        { ...segmentSource[0], unique_sponsor_contacts: 4 },
        ...segmentSource.slice(1),
      ],
      [{ ...segmentSource[0], suppressed: true }, ...segmentSource.slice(1)],
      [
        { ...segmentSource[0], verified_sponsor_accounts: null },
        ...segmentSource.slice(1),
      ],
      [
        { ...segmentSource[0], active_annual_commitment_usd_cents: null },
        ...segmentSource.slice(1),
      ],
    ]) {
      expect(
        analytics.parseAdvocateAnalyticsSnapshot(
          snapshot({ segments: invalid }),
        ),
      ).toBeNull()
    }
  })

  test("retains exact keys while accepting withheld measures", () => {
    const parsed = analytics.parseAdvocateAnalyticsSnapshot(
      snapshot({
        official: visibleCell({
          verified_sponsor_accounts: null,
          renewal_collected_usd_cents: null,
          gross_collected_usd_cents: null,
          refunds_and_reversals_usd_cents: null,
          dispute_debits_usd_cents: null,
          dispute_credits_usd_cents: null,
          net_collected_usd_cents: null,
          active_monthly_commitment_usd_cents: null,
          active_annual_commitment_usd_cents: 2_400,
          annualized_commitment_usd_cents: null,
        }),
        original_currency: [
          {
            ...(snapshot().original_currency as Record<string, unknown>[])[0],
            renewal_collected_minor: null,
            gross_collected_minor: null,
            refunds_and_reversals_minor: null,
            dispute_debits_minor: null,
            dispute_credits_minor: null,
            net_collected_minor: null,
          },
        ],
      }),
    )

    expect(parsed?.official).toMatchObject({
      suppressed: false,
      initialCollectedUsdCents: 10_000,
      verifiedSponsorAccounts: null,
      renewalCollectedUsdCents: null,
      grossCollectedUsdCents: null,
      netCollectedUsdCents: null,
      activeMonthlyCommitmentUsdCents: null,
      activeAnnualCommitmentUsdCents: 2_400,
      annualizedCommitmentUsdCents: null,
    })
    expect(parsed?.originalCurrency?.[0]).toMatchObject({
      initialCollectedMinor: 10_000,
      renewalCollectedMinor: null,
      grossCollectedMinor: null,
      netCollectedMinor: null,
    })
  })

  test("does not mistake account and contact counts for a distinct-person complement", () => {
    expect(
      analytics.parseAdvocateAnalyticsSnapshot(
        snapshot({
          official: visibleCell({ verified_sponsor_accounts: 5 }),
        }),
      ),
    ).not.toBeNull()
  })

  test("enforces the sponsor contact floor on every cell", () => {
    // The count itself still requires at least five contact keys.
    for (const contacts of [1, 2, 3, 4]) {
      expect(
        analytics.parseAdvocateAnalyticsSnapshot(
          snapshot({
            official: visibleCell({
              unique_sponsor_contacts: contacts,
              verified_sponsor_accounts: null,
            }),
          }),
        ),
        `a cell built from ${contacts} sponsor contacts must not be published`,
      ).toBeNull()
    }

    // Five is the documented minimum and must still be accepted, so the
    // assertion turns on the boundary rather than on rejecting everything.
    expect(
      analytics.parseAdvocateAnalyticsSnapshot(
        snapshot({
          official: visibleCell({
            unique_sponsor_contacts: 5,
            verified_sponsor_accounts: null,
          }),
        }),
      ),
    ).not.toBeNull()
  })

  test("accepts independently certified financial totals and withheld details", () => {
    const core = visibleCell({
      sponsorships: null, unique_sponsor_contacts: null, verified_sponsor_accounts: 0,
      initial_collected_usd_cents: 10_733, renewal_collected_usd_cents: 0,
      gross_collected_usd_cents: 10_733, refunds_and_reversals_usd_cents: 7_500,
      dispute_debits_usd_cents: null, dispute_credits_usd_cents: null,
      net_collected_usd_cents: 3_233,
    })
    const parsed = analytics.parseAdvocateAnalyticsSnapshot(snapshot({
      official: core, segments: null,
      original_currency: [{
        currency: "USD", suppressed: false, sponsorships: null, unique_sponsor_contacts: null,
        initial_collected_minor: 10_733, renewal_collected_minor: 0, gross_collected_minor: 10_733,
        refunds_and_reversals_minor: 7_500, dispute_debits_minor: null, dispute_credits_minor: null,
        net_collected_minor: 3_233,
      }],
    }))
    expect(parsed?.official).toMatchObject({ grossCollectedUsdCents: 10_733,
      netCollectedUsdCents: 3_233, disputeDebitsUsdCents: null, uniqueSponsorContacts: null })
    expect(parsed?.originalCurrency?.[0]).toMatchObject({ netCollectedMinor: 3_233, disputeCreditsMinor: null })
    if (!parsed) throw new Error("Expected a certified partial report")
    const html = renderToStaticMarkup(createElement(AnalyticsDashboard, { advocateName: "Example", snapshot: parsed }))
    expect(html).toContain("Withheld")
    expect(html).toContain("32.33")
  })

  test("accepts certified projections without requiring both cadence details", () => {
    for (const cell of [
      visibleCell({ active_monthly_commitment_usd_cents: null }),
      visibleCell({ active_annual_commitment_usd_cents: null }),
    ]) {
      expect(analytics.parseAdvocateAnalyticsSnapshot(snapshot({ official: cell }))).not.toBeNull()
    }
  })

  test("accepts independently rounded USD components and net", () => {
    // Two exact 5/7-cent losses each display as one cent, while their total
    // loss displays as one cent. The database computes the net before rounding.
    const parsed = analytics.parseAdvocateAnalyticsSnapshot(
      snapshot({
        official: visibleCell({
          refunds_and_reversals_usd_cents: 1,
          dispute_debits_usd_cents: 1,
          dispute_credits_usd_cents: 0,
          net_collected_usd_cents: 14_999,
        }),
      }),
    )
    expect(parsed?.official).toMatchObject({
      refundsAndReversalsUsdCents: 1,
      disputeDebitsUsdCents: 1,
      disputeCreditsUsdCents: 0,
      netCollectedUsdCents: 14_999,
    })
  })

  test("rejects suppressed value smuggling, extra fields, and unsafe arithmetic", () => {
    const missingVisibleKey: Record<string, unknown> = visibleCell()
    delete missingVisibleKey.dispute_credits_usd_cents
    const invalid = [
      snapshot({ sponsor_email: "must-not-cross@example.com" }),
      snapshot({ official: { suppressed: true, sponsorships: 4 } }),
      snapshot({ official: visibleCell({ unique_sponsor_contacts: 4 }) }),
      snapshot({ official: visibleCell({ verified_sponsor_accounts: 9 }) }),
      snapshot({ official: visibleCell({ verified_sponsor_accounts: -1 }) }),
      ...[1, 2, 3, 4].map((verifiedSponsorAccounts) =>
        snapshot({
          official: visibleCell({
            verified_sponsor_accounts: verifiedSponsorAccounts,
          }),
        }),
      ),
      snapshot({
        official: visibleCell({
          renewal_collected_usd_cents: Number.MAX_SAFE_INTEGER + 1,
        }),
      }),
      snapshot({ official: missingVisibleKey }),
      snapshot({
        official: visibleCell({ gross_collected_usd_cents: 15_001 }),
      }),
      snapshot({
        official: visibleCell({
          annualized_commitment_usd_cents: 16_801,
        }),
      }),
      snapshot({ official: visibleCell({ sponsorships: 1.5 }) }),
      snapshot({
        official: visibleCell({
          sponsorships: Number.MAX_SAFE_INTEGER + 1,
        }),
      }),
      snapshot({ as_of: "not-a-timestamp" }),
      snapshot({ schema_version: 1 }),
      snapshot({
        methodology: {
          minimum_sponsor_contacts_per_cell: 4,
          official_window_days: 30,
          observed_window_days: 365,
          renewals_increase_funds_not_counts: true,
          measure_suppression_enabled: true,
        },
      }),
    ]
    for (const value of invalid) {
      expect(analytics.parseAdvocateAnalyticsSnapshot(value)).toBeNull()
    }
  })

  test("rejects malformed, sparse, unordered, or identity-bearing currency cells", () => {
    const base = snapshot().original_currency as Record<string, unknown>[]
    const missingCurrencyKey = { ...base[0] }
    delete missingCurrencyKey.net_collected_minor
    for (const invalid of [
      [{ ...base[0], unique_sponsor_contacts: 4 }],
      [{ ...base[0], currency: "CAD" }],
      [...base].reverse(),
      [{ ...base[0], sponsor_identity_id: ADVOCATE_ID }],
      [{ ...base[0], initial_collected_minor: 10_001 }],
      [{ ...base[0], initial_collected_minor: -1 }],
      [{ ...base[0], net_collected_minor: 10_851 }],
      [{ ...base[0], renewal_collected_minor: -1 }],
      [
        {
          ...base[0],
          renewal_collected_minor: null,
          gross_collected_minor: null,
          refunds_and_reversals_minor: null,
          dispute_debits_minor: null,
          dispute_credits_minor: null,
          net_collected_minor: null,
        },
        base[1],
      ],
      [
        {
          ...base[0],
          dispute_credits_minor: Number.MAX_SAFE_INTEGER + 1,
        },
      ],
      [missingCurrencyKey],
    ]) {
      expect(
        analytics.parseAdvocateAnalyticsSnapshot(
          snapshot({ original_currency: invalid }),
        ),
      ).toBeNull()
    }
  })
})

test.describe("advocate analytics repository", () => {
  test("calls only the fixed permission checked analytics RPC", async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const repository = analytics.createAdvocateAnalyticsRepository({
      async rpc(name: string, args: unknown) {
        calls.push({ name, args })
        return { data: snapshot(), error: null }
      },
    } as never)

    await expect(repository.load(ADVOCATE_ID)).resolves.toMatchObject({
      schemaVersion: 2,
    })
    expect(calls).toEqual([
      {
        name: "get_advocate_analytics_snapshot",
        args: { target_advocate_id: ADVOCATE_ID },
      },
    ])
  })

  test("fails closed on database errors and malformed response shapes", async () => {
    const databaseFailure = analytics.createAdvocateAnalyticsRepository({
      async rpc() {
        return { data: null, error: { code: "42501" } }
      },
    } as never)
    await expect(databaseFailure.load(ADVOCATE_ID)).rejects.toMatchObject({
      name: "AdvocateAnalyticsRepositoryError",
      stage: "query",
      message: "advocate_analytics_unavailable",
    })

    const shapeFailure = analytics.createAdvocateAnalyticsRepository({
      async rpc() {
        return {
          data: { email: "must-not-cross@example.com" },
          error: null,
        }
      },
    } as never)
    await expect(shapeFailure.load(ADVOCATE_ID)).rejects.toMatchObject({
      name: "AdvocateAnalyticsRepositoryError",
      stage: "shape",
      message: "advocate_analytics_unavailable",
    })
  })
})

test.describe("advocate analytics administrative UI contract", () => {
  test("formats integer minor units without floating point display", () => {
    expect(formatAnalyticsMinorAmount(1_234_567, "USD")).toBe("$12,345.67 USD")
    expect(formatAnalyticsMinorAmount(5, "GBP")).toBe("£0.05 GBP")
    expect(formatAnalyticsAsOf("2026-07-13T00:00:00+00:00")).toBe(
      "July 13, 2026",
    )
  })

  test("gates a dynamic no-store page before loading the fixed snapshot", () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(advocate-admin)/portal/[slug]/analytics/page.tsx",
      ),
      "utf8",
    )
    const dashboardSource = readFileSync(
      resolve(
        process.cwd(),
        "src/components/advocates/admin/AnalyticsDashboard.tsx",
      ),
      "utf8",
    )

    expect(pageSource).toContain('dynamic = "force-dynamic"')
    expect(pageSource).toContain("revalidate = 0")
    expect(pageSource).toContain("noStore()")
    expect(pageSource).toContain(
      'permissions.includes("portal.analytics.view")',
    )
    expect(pageSource.lastIndexOf("portal.analytics.view")).toBeLessThan(
      pageSource.lastIndexOf("createAdvocateAnalyticsRepository"),
    )
    expect(pageSource).toContain("portal.advocateId")
    expect(`${pageSource}\n${dashboardSource}`).not.toMatch(
      /sponsor_email|auth_user_id|sponsor_identity_id|contact_email|visitor_id|exposure_id|intent_id|provider_customer_id/i,
    )
    expect(dashboardSource).toContain(
      'aria-labelledby="advocate-analytics-heading"',
    )
    expect(dashboardSource).toContain("mutually exclusive")
    expect(dashboardSource).toContain("prevents subtraction")
    expect(dashboardSource).toContain('aria-label="Withheld for privacy"')
    expect(dashboardSource).toContain("Active monthly commitment")
    expect(dashboardSource).toContain("Active annual commitment")
    expect(dashboardSource).toContain("Annualized commitment projection")
    expect(dashboardSource).toContain("an earlier report")
    expect(dashboardSource).toContain("commitments reflect the stated cutoff")
    expect(dashboardSource.match(/role="region"/g)).toHaveLength(2)
    expect(dashboardSource.match(/tabIndex=\{0\}/g)).toHaveLength(2)
    expect(dashboardSource).toContain("focus-visible:outline-blue-700")
    expect(dashboardSource).not.toContain('"use client"')
    expect(dashboardSource).not.toMatch(/\bcompleted\b/i)
    expect(dashboardSource).not.toMatch(/<input|<select|<textarea|download=/i)
  })
})


test("accepts distinct verified accounts sharing historical contact keys", () => {
  const sharedContactCell = visibleCell({
    sponsorships: 10,
    unique_sponsor_contacts: 5,
    verified_sponsor_accounts: 10,
  })
  const result = analytics.parseAdvocateAnalyticsSnapshot(snapshot({
    official: sharedContactCell,
  }))
  expect(result?.official).toMatchObject({
    sponsorships: 10,
    uniqueSponsorContacts: 5,
    verifiedSponsorAccounts: 10,
  })
  expect(analytics.parseAdvocateAnalyticsSnapshot(snapshot({
    official: { ...sharedContactCell, verified_sponsor_accounts: 11 },
  }))).toBeNull()
})
