import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

test.describe("Creator Share advocate control plane UI", () => {
  test("adds privacy-preserving email-first onboarding with durable retry identity", () => {
    const listPage = source("src/app/(admin)/admin/advocates/page.tsx")
    const onboarding = source(
      "src/components/advocates/creatorShareAdmin/AdvocateOnboarding.tsx",
    )

    expect(listPage).toContain("<AdvocateOnboarding />")
    expect(onboarding).toContain("Reserve portal and invite owner")
    expect(onboarding).toContain(
      "provider setup will wait until it is accepted",
    )
    expect(onboarding).toContain("sessionStorage.setItem")
    expect(onboarding).toContain(
      "JSON.stringify({ version: 1, operationId: operationId.current })",
    )
    expect(onboarding).toContain("Discard saved retry")
    expect(onboarding).toContain('credentials: "same-origin"')
    expect(onboarding).toContain('redirect: "error"')
    expect(onboarding).toContain("response.status !== 200")
    expect(onboarding).toContain("hasExpectedErrorStatus")
    expect(onboarding).toContain("if (!parsed.ok)")
    expect(onboarding).toContain("storageResolved &&")
    expect(onboarding).toContain("disabled={!storageResolved || busy}")
    expect(onboarding).not.toMatch(
      /if \(!parsed\.ok\)[\s\S]{0,420}clearOperation\(\)/,
    )
    expect(onboarding).not.toContain("response.status < 500")
    expect(onboarding).not.toMatch(
      /sessionStorage\.setItem[\s\S]{0,240}(ownerEmail|displayName|reason|slug)/,
    )
  })

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
      'snapshot.ownershipStatus === "awaiting_owner_acceptance"',
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

  test("renders ownerless portals as awaiting acceptance with recovery gated by the server", () => {
    const listPage = source("src/app/(admin)/admin/advocates/page.tsx")
    const detailPage = source("src/app/(admin)/admin/advocates/[id]/page.tsx")
    const recovery = source(
      "src/components/advocates/creatorShareAdmin/AdvocateInitialOwnerRecovery.tsx",
    )
    const controls = source(
      "src/components/advocates/creatorShareAdmin/AdvocateInitialOwnerControls.tsx",
    )
    const revocation = source(
      "src/components/advocates/creatorShareAdmin/AdvocateInitialOwnerRevocation.tsx",
    )

    expect(listPage).toContain("Awaiting owner acceptance")
    expect(detailPage).toContain(
      'snapshot.ownershipStatus === "awaiting_owner_acceptance"',
    )
    expect(detailPage).toContain("snapshot.canReissueInitialOwner")
    expect(detailPage).toContain("snapshot.canRevokeInitialOwner")
    expect(detailPage).toContain("<AdvocateInitialOwnerControls")
    expect(controls).toContain('if (canReissueInitialOwner) return "reissue"')
    expect(controls).toContain('hasSavedOperation("revoke", advocateId)')
    expect(controls).toContain('useState<InitialOwnerControlMode>("resolving")')
    expect(controls).toContain(
      'mode === "resolving" || resolvedContextKey !== resolutionContextKey',
    )
    expect(controls).toContain("setResolutionRevision")
    expect(recovery).toContain("owner-only lifecycle controls")
    expect(recovery).toContain("REISSUE OWNER ${slug}")
    expect(recovery).toContain('credentials: "same-origin"')
    expect(recovery).toContain('redirect: "error"')
    expect(recovery).toContain("sessionStorage.setItem")
    expect(recovery).toContain("expectedVersion: initialVersion")
    expect(recovery).toContain("storageResolved &&")
    expect(recovery).toContain(
      "resolvedStorageContextKey === storageContextKey",
    )
    expect(recovery).toContain("disabled={!storageResolved || busy}")
    expect(recovery).not.toMatch(
      /sessionStorage\.setItem[\s\S]{0,300}(ownerEmail|reason)/,
    )
    expect(revocation).toContain("REVOKE OWNER ${slug}")
    expect(revocation).toContain('confirmation: "REVOKE_INITIAL_OWNER"')
    expect(revocation).toContain('credentials: "same-origin"')
    expect(revocation).toContain("sessionStorage.setItem")
    expect(revocation).toContain("storageResolved &&")
    expect(revocation).toContain(
      "resolvedStorageContextKey === storageContextKey",
    )
    expect(revocation).toContain("disabled={!storageResolved || busy}")
    expect(revocation).not.toMatch(
      /sessionStorage\.setItem[\s\S]{0,300}(email|reason)/i,
    )
    expect(detailPage).not.toMatch(
      /invitationId|outboxId|recipientEmail|capability|ciphertext/i,
    )
  })

  test("renders archived ownerless portals without pending or identity controls", () => {
    const listPage = source("src/app/(admin)/admin/advocates/page.tsx")
    const detailPage = source("src/app/(admin)/admin/advocates/[id]/page.tsx")

    expect(listPage).toContain('case "owner_unassigned"')
    expect(listPage).toContain("Owner unassigned")
    expect(detailPage).toContain('case "owner_unassigned"')
    expect(detailPage).toContain("Archived with no assigned owner")
    expect(detailPage).toContain(
      "This archived advocate has no assigned owner. No invitation or ownership action remains available.",
    )
    expect(detailPage).toMatch(
      /snapshot\.relationshipStatus === "archived" \? \([\s\S]+?\) : snapshot\.ownershipStatus === "awaiting_owner_acceptance" \? \(/,
    )
    expect(detailPage).not.toContain("Owner: null")
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
