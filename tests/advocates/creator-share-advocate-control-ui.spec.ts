import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

test.describe("Creator Share advocate control plane UI", () => {
  test("adds the bounded advocate control plane to global administration", () => {
    const dashboard = source("src/app/(admin)/admin/page.tsx")
    const listPage = source("src/app/(admin)/admin/advocates/page.tsx")

    expect(dashboard).toContain('path: "/admin/advocates"')
    expect(listPage).toContain("createCreatorShareAdvocateControlRepository")
    expect(listPage).toContain("Next 50 portals")
    expect(listPage).toContain("relationshipStatus")
    expect(listPage).toContain("publicationStatus")
    expect(listPage).not.toMatch(
      /provider_id|provider_error|contact_email|auth_user_id|invitation_email/i,
    )
  })

  test("renders only server-derived lifecycle eligibility", () => {
    const detailPage = source("src/app/(admin)/admin/advocates/[id]/page.tsx")
    const client = source(
      "src/components/advocates/creatorShareAdmin/AdvocateLifecycleControls.tsx",
    )

    expect(detailPage).toContain("snapshot.canSuspend")
    expect(detailPage).toContain("snapshot.canResume")
    expect(detailPage).toContain("snapshot.canArchive")
    expect(detailPage).toContain("snapshot.canRepair")
    expect(detailPage).toContain('snapshot.relationshipStatus === "archived"')
    expect(detailPage).toContain("Ownership is immutable")
    expect(detailPage).toContain(
      'snapshot.relationshipStatus === "archived"\n        ? { candidates: [], hasMore: false }',
    )
    expect(client).toContain("availableActions.includes(action)")
    expect(client).toContain("Every action is version fenced and audited")
    expect(client).toContain('credentials: "same-origin"')
    expect(client).toContain('redirect: "error"')
    expect(client).toContain("globalThis.crypto.randomUUID()")
    expect(client).toContain("useEffect")
    expect(client).toContain("setCompleted(false)")
    expect(client).not.toContain('action: "force_publish"')
    expect(client).not.toContain('action: "unarchive"')
  })

  test("requires typed confirmation for archive and ownership transfer", () => {
    const lifecycleClient = source(
      "src/components/advocates/creatorShareAdmin/AdvocateLifecycleControls.tsx",
    )
    const ownershipClient = source(
      "src/components/advocates/creatorShareAdmin/AdvocateOwnershipTransfer.tsx",
    )

    expect(lifecycleClient).toContain("`ARCHIVE ${slug}`")
    expect(lifecycleClient).toContain('confirmation: action === "archive"')
    expect(ownershipClient).toContain("`TRANSFER ${slug}`")
    expect(ownershipClient).toContain('confirmation: "TRANSFER"')
    expect(ownershipClient).toContain("expectedOwnerMembershipId")
    expect(ownershipClient).toContain("useEffect")
    expect(ownershipClient).toContain("setCompleted(false)")
    expect(ownershipClient).not.toMatch(
      /targetOwnerUserId|expectedOwnerUserId|email|contact/i,
    )
  })

  test("surfaces cleanup intervention without exposing provider evidence", () => {
    const detailPage = source("src/app/(admin)/admin/advocates/[id]/page.tsx")
    const recoveryClient = source(
      "src/components/advocates/creatorShareAdmin/AdvocateCleanupRecovery.tsx",
    )
    expect(detailPage).toContain('case "needs_attention"')
    expect(detailPage).toContain("Needs manual intervention")
    expect(detailPage).toContain("Archived cleanup needs intervention")
    expect(detailPage).toContain("Correct the external cause")
    expect(detailPage).toContain("snapshot.canRetryCleanup")
    expect(recoveryClient).toContain("`RETRY CLEANUP ${slug}`")
    expect(recoveryClient).toContain('confirmation: "RETRY_CLEANUP"')
    expect(recoveryClient).toContain('credentials: "same-origin"')
    expect(recoveryClient).toContain("globalThis.crypto.randomUUID()")
    expect(recoveryClient).not.toMatch(/providerId|jobId|externalIdentifier/)
    expect(detailPage).not.toMatch(
      /provider_payload|provider_identifier|provider_error|api_secret/i,
    )
  })

  test("keeps the application cleanup phases aligned with the database snapshot", () => {
    const migration = source(
      "supabase/migrations/20260718154000_creator_share_advocate_lifecycle_controls.sql",
    )
    const repository = source(
      "src/lib/advocates/creatorShareAdmin/lifecycle.ts",
    )
    const phases = [
      "not_requested",
      "quiescing",
      "cloudflare_dns_removal",
      "vercel_removal",
      "stripe_us_removal",
      "stripe_uk_removal",
      "paypal_removal",
      "complete",
      "needs_attention",
    ]
    for (const phase of phases) {
      expect(migration).toContain(`'${phase}'`)
      expect(repository).toContain(`"${phase}"`)
    }
    expect(migration).not.toContain("THEN 'provider_cleanup'")
    expect(repository).not.toContain('"provider_cleanup"')
  })
})
