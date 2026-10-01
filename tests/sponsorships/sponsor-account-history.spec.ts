import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  buildSponsorAccountHistoryPage,
  parseSponsorAccountHistoryRequest,
  parseSponsorAccountHistoryRpcResult,
  SponsorAccountHistoryError,
  SponsorAccountHistoryRequestError,
} from "../../src/lib/sponsorships/sponsorAccountHistory"
import { presentSponsorHistoryMoney } from "../../src/lib/sponsorships/sponsorHistoryPresentation"

const STANDARD_INTENT_ID = "11111111-1111-4111-8111-111111111111"
const BENEFICIARY_ID = "22222222-2222-4222-8222-222222222222"

function standardRow(overrides: Record<string, unknown> = {}) {
  return {
    sponsorship_intent_id: STANDARD_INTENT_ID,
    subject_kind: "standard",
    beneficiary_id: BENEFICIARY_ID,
    beneficiary_name: "Example Child",
    beneficiary_username: "example-child",
    partnership_project: null,
    base_amount_usd_cents: 2500,
    charged_amount_minor: 2500,
    charged_currency: "USD",
    net_base_amount_usd_cents: 2500,
    net_charged_amount_minor: 2500,
    provider: "STRIPE",
    paid_at: "2026-07-17T10:00:00.123456+00:00",
    financial_status: "paid",
    ...overrides,
  }
}

test.describe("sponsor one time history boundary", () => {
  test("parses safe product rows and adjustment-specific statuses", () => {
    const parsed = parseSponsorAccountHistoryRpcResult([
      standardRow(),
      standardRow({
        sponsorship_intent_id: "33333333-3333-4333-8333-333333333333",
        subject_kind: "blind",
        beneficiary_id: null,
        beneficiary_name: null,
        beneficiary_username: null,
        financial_status: "partially_refunded",
        net_base_amount_usd_cents: "1200",
        net_charged_amount_minor: "1200",
        provider: "PAYPAL",
      }),
      standardRow({
        sponsorship_intent_id: "44444444-4444-4444-8444-444444444444",
        subject_kind: "partnership",
        beneficiary_id: null,
        beneficiary_name: null,
        beneficiary_username: null,
        partnership_project: "education",
        financial_status: "provider_reversed",
        net_base_amount_usd_cents: 0,
        net_charged_amount_minor: 0,
      }),
      standardRow({
        sponsorship_intent_id: "55555555-5555-4555-8555-555555555555",
        financial_status: "funds_withheld",
        net_base_amount_usd_cents: 1700,
        net_charged_amount_minor: 1700,
      }),
    ])

    expect(parsed).toHaveLength(4)
    expect(parsed[0]).toMatchObject({
      sponsorshipIntentId: STANDARD_INTENT_ID,
      beneficiaryName: "Example Child",
      financialStatus: "paid",
    })
    expect(parsed[1]).toMatchObject({
      subjectKind: "blind",
      provider: "PAYPAL",
      netChargedAmountMinor: 1200,
      financialStatus: "partially_refunded",
    })
    expect(parsed[2]).toMatchObject({
      subjectKind: "partnership",
      partnershipProject: "education",
      financialStatus: "provider_reversed",
    })
    expect(parsed[3].financialStatus).toBe("funds_withheld")
  })

  test("presents net money first and original money only as adjustment evidence", () => {
    const [refunded, foreignPaid] = parseSponsorAccountHistoryRpcResult([
      standardRow({
        financial_status: "refunded",
        net_base_amount_usd_cents: 0,
        net_charged_amount_minor: 0,
      }),
      standardRow({
        sponsorship_intent_id: "99999999-9999-4999-8999-999999999999",
        base_amount_usd_cents: 2500,
        charged_amount_minor: 3500,
        charged_currency: "AUD",
        net_base_amount_usd_cents: 2500,
        net_charged_amount_minor: 3500,
      }),
    ])

    expect(presentSponsorHistoryMoney(refunded)).toEqual({
      primaryAmount: "Net $0.00",
      normalizedNetAmount: null,
      originalAmount: "Originally $25.00",
    })
    expect(presentSponsorHistoryMoney(foreignPaid)).toEqual({
      primaryAmount: "A$35.00",
      normalizedNetAmount: "$25.00 normalized net",
      originalAmount: null,
    })

    const componentSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(app)/app/components/OneTimeSponsorshipHistory.tsx",
      ),
      "utf8",
    )
    expect(componentSource).toContain("presentSponsorHistoryMoney(item)")
    expect(componentSource).toContain("{money.primaryAmount}")
  })

  test("sanitizes harmless legacy display text without dropping the page", () => {
    const parsed = parseSponsorAccountHistoryRpcResult([
      standardRow({
        beneficiary_name: `  Legacy\n\tChild\u0001 ${"x".repeat(200)}  `,
        beneficiary_username: "  legacy\u0000\t handle  ",
      }),
      standardRow({
        sponsorship_intent_id: "66666666-6666-4666-8666-666666666666",
        beneficiary_name: " \t\n ",
        beneficiary_username: { unexpected: "legacy shape" },
      }),
    ])

    expect(parsed[0].beneficiaryName).toHaveLength(120)
    expect(parsed[0].beneficiaryName).toMatch(/^Legacy Child x+/)
    expect(parsed[0].beneficiaryName).not.toMatch(/[\u0000-\u001f]/)
    expect(parsed[0].beneficiaryUsername).toBe("legacy handle")
    expect(parsed[1].beneficiaryName).toBeNull()
    expect(parsed[1].beneficiaryUsername).toBeNull()
  })

  test("rejects malformed product and financial shapes", () => {
    const invalidRows = [
      standardRow({ beneficiary_id: null }),
      standardRow({
        subject_kind: "blind",
        beneficiary_id: BENEFICIARY_ID,
      }),
      standardRow({ partnership_project: "education" }),
      standardRow({ charged_currency: "BTC" }),
      standardRow({ net_charged_amount_minor: -1 }),
      standardRow({ charged_amount_minor: Number.MAX_SAFE_INTEGER + 1 }),
      standardRow({ paid_at: "not-a-date" }),
      standardRow({
        financial_status: "paid",
        net_base_amount_usd_cents: 2400,
        net_charged_amount_minor: 2400,
      }),
      standardRow({
        financial_status: "refunded",
        net_base_amount_usd_cents: 1,
        net_charged_amount_minor: 1,
      }),
      standardRow({
        financial_status: "partially_provider_reversed",
        net_base_amount_usd_cents: 0,
        net_charged_amount_minor: 0,
      }),
    ]

    for (const row of invalidRows) {
      expect(() => parseSponsorAccountHistoryRpcResult([row])).toThrow(
        SponsorAccountHistoryError,
      )
    }
  })

  test("uses limit plus one and an opaque exact keyset cursor", () => {
    const rows = [
      standardRow(),
      standardRow({
        sponsorship_intent_id: "77777777-7777-4777-8777-777777777777",
        paid_at: "2026-07-16T10:00:00.123456+00:00",
      }),
      standardRow({
        sponsorship_intent_id: "88888888-8888-4888-8888-888888888888",
        paid_at: "2026-07-15T10:00:00.123456+00:00",
      }),
    ]
    const page = buildSponsorAccountHistoryPage(rows, 2)

    expect(page.items.map((item) => item.sponsorshipIntentId)).toEqual([
      STANDARD_INTENT_ID,
      "77777777-7777-4777-8777-777777777777",
    ])
    expect(page.nextCursor).toBeTruthy()
    expect(page.nextCursor).not.toContain("customer_email")

    const request = parseSponsorAccountHistoryRequest(
      new URLSearchParams({ limit: "2", cursor: page.nextCursor! }),
    )
    expect(request).toEqual({
      pageSize: 2,
      rpcLimit: 3,
      beforePaidAt: "2026-07-16T10:00:00.123456+00:00",
      beforeSponsorshipIntentId: "77777777-7777-4777-8777-777777777777",
    })
    expect(buildSponsorAccountHistoryPage(rows.slice(0, 2), 2)).toEqual({
      items: parseSponsorAccountHistoryRpcResult(rows.slice(0, 2), 3),
      nextCursor: null,
    })
  })

  test("strictly rejects ambiguous or unbounded page requests", () => {
    const impossibleDateCursor = Buffer.from(
      JSON.stringify({
        version: 1,
        paidAt: "2026-02-31T10:00:00+00:00",
        sponsorshipIntentId: STANDARD_INTENT_ID,
      }),
    ).toString("base64url")
    const invalidQueries = [
      "limit=0",
      "limit=51",
      "limit=01",
      "limit=2&limit=3",
      "cursor=",
      "cursor=not_base64url",
      "cursor=eyJ2ZXJzaW9uIjoxfQ==",
      `cursor=${impossibleDateCursor}`,
      "unknown=value",
    ]

    for (const query of invalidQueries) {
      expect(() =>
        parseSponsorAccountHistoryRequest(new URLSearchParams(query)),
      ).toThrow(SponsorAccountHistoryRequestError)
    }

    expect(parseSponsorAccountHistoryRequest(new URLSearchParams())).toEqual({
      pageSize: 20,
      rpcLimit: 21,
      beforePaidAt: null,
      beforeSponsorshipIntentId: null,
    })
  })

  test("rejects duplicate, oversized, and malformed RPC result sets", () => {
    expect(() =>
      parseSponsorAccountHistoryRpcResult([standardRow(), standardRow()]),
    ).toThrow(SponsorAccountHistoryError)
    expect(() => parseSponsorAccountHistoryRpcResult({}, 100)).toThrow(
      SponsorAccountHistoryError,
    )
    expect(() =>
      parseSponsorAccountHistoryRpcResult(
        Array.from({ length: 101 }, (_, index) =>
          standardRow({
            sponsorship_intent_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          }),
        ),
        100,
      ),
    ).toThrow(SponsorAccountHistoryError)
  })

  test("drops unrecognized database fields from the browser response", () => {
    const parsed = parseSponsorAccountHistoryRpcResult([
      standardRow({
        customer_email: "must-not-cross@example.test",
        provider_object_id: "pi_must_not_cross",
        source_advocate_id: "99999999-9999-4999-8999-999999999999",
      }),
    ])

    expect(parsed[0]).not.toHaveProperty("customer_email")
    expect(parsed[0]).not.toHaveProperty("provider_object_id")
    expect(parsed[0]).not.toHaveProperty("source_advocate_id")
  })
})
