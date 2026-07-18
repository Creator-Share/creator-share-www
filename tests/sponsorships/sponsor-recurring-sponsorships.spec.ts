import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ProjectionModule =
  typeof import("../../src/lib/sponsorships/sponsorRecurringSponsorships")

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/sponsor-recurring-sponsorships.spec.ts",
  ),
)
const { parseSponsorRecurringSponsorships, SponsorRecurringSponsorshipError } =
  testRequire(
    "../../src/lib/sponsorships/sponsorRecurringSponsorships",
  ) as ProjectionModule

const SAFE_ROW = {
  subscription_id: "9d000000-0000-4000-8000-000000000101",
  beneficiary_id: "9d000000-0000-4000-8000-000000000201",
  subscription_status: "complete",
  amount_usd_cents: 6000,
  recurrence_interval: "month",
  current_period_end: "2026-08-18T10:00:00",
  subject_kind: "standard",
  partnership_project: null,
  beneficiary_name: "A Child",
  beneficiary_username: "a-child",
}

test("recurring sponsorship projection maps only the sponsor UI shape", () => {
  expect(parseSponsorRecurringSponsorships([SAFE_ROW])).toEqual([
    {
      id: SAFE_ROW.subscription_id,
      beneficiary_id: SAFE_ROW.beneficiary_id,
      status: "complete",
      amount: 6000,
      interval: "month",
      current_period_end: "2026-08-18T10:00:00",
      subject_kind: "standard",
      partnership_project: null,
      child: { name: "A Child", username: "a-child" },
    },
  ])
})

test("recurring sponsorship projection rejects silent contact or provider expansion", () => {
  for (const forbiddenField of [
    "email",
    "customer_id",
    "stripe_subscription_id",
    "provider_subscription_object_id",
    "sponsor_identity_id",
  ]) {
    expect(() =>
      parseSponsorRecurringSponsorships([
        { ...SAFE_ROW, [forbiddenField]: "secret" },
      ]),
    ).toThrow(SponsorRecurringSponsorshipError)
  }
})

test("sponsor dashboard uses the authenticated projection instead of the base table", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/app/(app)/app/page.tsx"),
    "utf8",
  )
  expect(source).toContain('rpc(\n    "list_my_recurring_sponsorships"')
  expect(source).not.toContain('.from("subscriptions")')
  expect(source).not.toContain("select(\n          `\n          *")
})
