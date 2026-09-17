import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

test("the first release uses the shared issuer without an intermediate worker cutover", async () => {
  const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8")
  const [route, worker, repository] = await Promise.all([
    read("src/app/api/internal/advocates/invitations/route.ts"),
    read("src/lib/advocates/invitations/emailWorker.ts"),
    read("src/lib/advocates/invitations/emailRepository.ts"),
  ])
  expect(route).toContain("export const maxDuration = 120")
  expect(worker).toContain("110_000 as const")
  expect(repository).toContain("shared_email_proof_issuer_version: 1")
  for (const path of [
    "docs/advocate-domain-publication-runbook.md",
    "docs/advocate-payment-release-runbook.md",
    "docs/advocate-platform-roadmap.md",
  ]) {
    const runbook = await read(path)
    expect(runbook).toContain("mailer_otp_exp")
    expect(runbook).toContain("3,600 seconds")
    expect(runbook).toContain("Batch size must equal concurrency")
    expect(runbook).toContain("SMTP ambiguity quarantine")
    expect(runbook).not.toContain("arm_advocate_invitation_legacy_email_proof_quarantine")
    expect(runbook).not.toContain("quarantine_legacy_advocate_invitation_proofs")
  }
})
