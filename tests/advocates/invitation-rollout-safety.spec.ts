import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

const RUNBOOK_PATHS = Object.freeze([
  "docs/advocate-domain-publication-runbook.md",
  "docs/advocate-payment-release-runbook.md",
  "docs/advocate-platform-roadmap.md",
])

test("requires the prior invitation worker to drain before the otp cutover", async () => {
  const [routeSource, ...runbooks] = await Promise.all([
    readFile(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/invitations/route.ts",
      ),
      "utf8",
    ),
    ...RUNBOOK_PATHS.map((path) =>
      readFile(resolve(process.cwd(), path), "utf8"),
    ),
  ])

  expect(routeSource).toContain("export const maxDuration = 60")
  for (const runbook of runbooks) {
    for (const requiredControl of [
      "ADVOCATE_INVITATION_EMAIL_WORKER_SECRET",
      "401",
      "70 seconds",
      "60 second maximum",
      "Vercel invocation telemetry",
      "processing",
      "delivery_started_at",
      "five-minute claim lease",
      "potentially delivered",
      "revoke",
    ]) {
      expect(runbook).toContain(requiredControl)
    }
  }
})
