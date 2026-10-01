import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { presentSubscriptionSubject } from "../../src/lib/sponsorships/subscriptionPresentation"

test.describe("subscription subject presentation", () => {
  test("uses canonical partnership subject and humanized project without blind controls", () => {
    expect(
      presentSubscriptionSubject({
        subjectKind: "partnership",
        partnershipProject: "education",
        beneficiaryId: null,
      }),
    ).toEqual({
      subjectKind: "partnership",
      title: "Education Partnership",
      subtitle: "Creator Share Partnership",
      canChooseChild: false,
    })
  })

  test("preserves canonical and historical blind matching", () => {
    expect(
      presentSubscriptionSubject({
        subjectKind: "blind",
        partnershipProject: null,
        beneficiaryId: null,
      }).canChooseChild,
    ).toBe(true)
    expect(
      presentSubscriptionSubject({
        subjectKind: null,
        partnershipProject: null,
        beneficiaryId: null,
      }).subjectKind,
    ).toBe("blind")
  })

  test("never lets beneficiary null override a canonical standard or partnership subject", () => {
    expect(
      presentSubscriptionSubject({
        subjectKind: "standard",
        partnershipProject: null,
        beneficiaryId: null,
      }).canChooseChild,
    ).toBe(false)
    expect(
      presentSubscriptionSubject({
        subjectKind: "partnership",
        partnershipProject: null,
        beneficiaryId: null,
      }),
    ).toMatchObject({
      subjectKind: "partnership",
      title: "Creator Share Partnership",
      canChooseChild: false,
    })
  })

  test("subscription dashboards consume canonical subject presentation", () => {
    const sponsorPage = readFileSync(
      resolve(process.cwd(), "src/app/(app)/app/page.tsx"),
      "utf8",
    )
    const sponsorColumns = readFileSync(
      resolve(process.cwd(), "src/app/(app)/app/columns.tsx"),
      "utf8",
    )
    const adminPage = readFileSync(
      resolve(process.cwd(), "src/app/(admin)/admin/subscriptions/page.tsx"),
      "utf8",
    )

    expect(sponsorPage).toContain("presentSubscriptionSubject")
    expect(sponsorColumns).toContain("presentSubscriptionSubject")
    expect(adminPage).toContain("presentSubscriptionSubject")
    expect(sponsorColumns).not.toContain("if (!subscription.beneficiary_id)")
  })
})
