import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

const RUNBOOK_PATHS = Object.freeze([
  "docs/advocate-domain-publication-runbook.md",
  "docs/advocate-payment-release-runbook.md",
  "docs/advocate-platform-roadmap.md",
])

test("requires the legacy worker to drain before the shared issuer cutover", async () => {
  const [routeSource, workerSource, repositorySource, ...runbooks] =
    await Promise.all([
      readFile(
        resolve(
          process.cwd(),
          "src/app/api/internal/advocates/invitations/route.ts",
        ),
        "utf8",
      ),
      readFile(
        resolve(process.cwd(), "src/lib/advocates/invitations/emailWorker.ts"),
        "utf8",
      ),
      readFile(
        resolve(
          process.cwd(),
          "src/lib/advocates/invitations/emailRepository.ts",
        ),
        "utf8",
      ),
      ...RUNBOOK_PATHS.map((path) =>
        readFile(resolve(process.cwd(), path), "utf8"),
      ),
    ])

  expect(routeSource).toContain("export const maxDuration = 120")
  expect(workerSource).toContain("110_000 as const")
  expect(repositorySource).toContain("shared_email_proof_issuer_version: 1")

  for (const runbook of runbooks) {
    for (const requiredControl of [
      "ADVOCATE_INVITATION_EMAIL_WORKER_SECRET",
      "401",
      "70 seconds",
      "legacy worker's 60 second maximum",
      "Vercel invocation telemetry",
      "processing",
      "delivery_started_at",
      "five-minute claim lease",
      "potentially delivered",
      "version 1",
      "contact-free",
      "fence_expires_at",
      "last_sent_at",
      "mailer_otp_exp",
      "3,600 seconds",
      "fixed one-hour maximum proof lifetime plus the fixed 300 second safety margin",
      "exactly 3,900 seconds",
      "120 second",
      "110 second",
      "lock_timeout",
      "statement_timeout",
      "all invitation reads and writes",
      "standalone autocommit RPC",
      "ACCESS EXCLUSIVE",
      "NOWAIT",
      "55P03",
      "ROLLBACK",
      "Stop and investigate every failure",
      "Do not retry blindly",
      "arm_advocate_invitation_legacy_email_proof_quarantine",
      "quarantine_legacy_advocate_invitation_proofs",
      "candidate_outbox_count",
      "unique_recipient_count",
      "quarantined_outbox_count",
      "created_gate_count",
      "preserved_gate_count",
      "executed_at",
      "revoke",
    ]) {
      expect(runbook).toContain(requiredControl)
    }
    expect(runbook).toContain(
      "https://supabase.com/docs/guides/auth/auth-email-passwordless",
    )
    expect(runbook).toContain("https://supabase.com/docs/guides/auth/users")
    expect(runbook).toMatch(/local `supabase\/config\.toml`/i)
    expect(runbook).toMatch(/production Vercel plan/i)
    expect(runbook).toMatch(
      /verified hosted expiry .*retained as release evidence/i,
    )
    expect(runbook).toMatch(/cannot shorten (?:the )?safety/i)
    expect(runbook).toMatch(/expected .*count .*zero/i)
    expect(runbook).toMatch(/nonzero count .*stop/i)
    expect(runbook).toMatch(/service-only .*arm/i)
    expect(runbook).toMatch(/after (?:the )?migration .*commit/i)
    expect(runbook).toMatch(/recent (?:contact-)?redact/i)
    expect(runbook).toMatch(/never restore/i)
    expect(runbook).toMatch(/[Bb]atch size (?:must )?equal(?:s)? concurrency/)
  }
})
