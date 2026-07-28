import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { notFound } from "next/navigation"

import { AdvocateCleanupRecovery } from "@/components/advocates/creatorShareAdmin/AdvocateCleanupRecovery"
import { AdvocateInitialOwnerControls } from "@/components/advocates/creatorShareAdmin/AdvocateInitialOwnerControls"
import { AdvocateLifecycleControls } from "@/components/advocates/creatorShareAdmin/AdvocateLifecycleControls"
import { AdvocateOwnershipTransfer } from "@/components/advocates/creatorShareAdmin/AdvocateOwnershipTransfer"
import { AdvocatePublicationControl } from "@/components/advocates/creatorShareAdmin/AdvocatePublicationControl"
import type { CreatorShareAdvocateLifecycleAction } from "@/lib/advocates/creatorShareAdmin/lifecycleContracts"
import {
  createCreatorShareAdvocateControlRepository,
  CreatorShareAdvocateControlRepositoryError,
  selectCreatorShareAdvocateOwnershipTransferOptions,
  type CreatorShareAdvocateControlSnapshot,
  type CreatorShareAdvocateOwnershipCandidatePage,
} from "@/lib/advocates/creatorShareAdmin/lifecycle"
import { isCreatorShareAdvocateControlPathId } from "@/lib/advocates/creatorShareAdmin/routeSecurity"
import { createClient } from "@/utils/supabase/server"

export const dynamic = "force-dynamic"

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ")
}

function timestampLabel(value: string | null): string {
  if (value === null) return "Not recorded"
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))
}

function cleanupPhaseLabel(
  value: CreatorShareAdvocateControlSnapshot["cleanupPhase"],
): string {
  switch (value) {
    case "not_requested":
      return "Not requested"
    case "quiescing":
      return "Quiescing portal"
    case "cloudflare_dns_removal":
      return "Removing DNS"
    case "vercel_removal":
      return "Removing Vercel domain"
    case "stripe_us_removal":
      return "Removing Stripe US domain"
    case "stripe_uk_removal":
      return "Removing Stripe UK domain"
    case "paypal_removal":
      return "Removing PayPal domain"
    case "complete":
      return "Complete"
    case "needs_attention":
      return "Needs manual intervention"
  }
}

function ownershipSummaryLabel(
  snapshot: CreatorShareAdvocateControlSnapshot,
): string {
  switch (snapshot.ownershipStatus) {
    case "awaiting_owner_acceptance":
      return "Awaiting owner acceptance"
    case "owner_active":
      return `Owner: ${snapshot.ownerDisplayName}`
    case "owner_unassigned":
      return "Archived with no assigned owner"
  }
}

export default async function CreatorShareAdvocateControlDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  noStore()
  const { id: advocateId } = await params
  if (!isCreatorShareAdvocateControlPathId(advocateId)) notFound()

  const client = await createClient()
  const repository = createCreatorShareAdvocateControlRepository(client)
  let snapshot: CreatorShareAdvocateControlSnapshot
  let ownershipPage: CreatorShareAdvocateOwnershipCandidatePage
  try {
    snapshot = await repository.loadSnapshot(advocateId)
    ownershipPage =
      snapshot.relationshipStatus === "archived" ||
      snapshot.ownershipStatus === "awaiting_owner_acceptance"
        ? { candidates: [], hasMore: false }
        : await repository.listOwnershipCandidates(advocateId)
  } catch (error) {
    if (
      error instanceof CreatorShareAdvocateControlRepositoryError &&
      error.postgresCode === "23503"
    ) {
      notFound()
    }
    throw error
  }

  const ownershipTransfer =
    selectCreatorShareAdvocateOwnershipTransferOptions(ownershipPage)
  const availableActions: CreatorShareAdvocateLifecycleAction[] = []
  if (snapshot.ownershipStatus === "owner_active" && snapshot.canSuspend) {
    availableActions.push("suspend")
  }
  if (snapshot.ownershipStatus === "owner_active" && snapshot.canResume) {
    availableActions.push("resume")
  }
  if (snapshot.ownershipStatus === "owner_active" && snapshot.canRepair) {
    availableActions.push("repair")
  }
  if (snapshot.canArchive) availableActions.push("archive")

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/admin/advocates"
        className="text-sm font-semibold text-blue-700 hover:text-blue-900"
      >
        Back to advocate portals
      </Link>

      <header className="mt-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
              {snapshot.slug}.creatorshare.com
            </p>
            <h1 className="mt-1 text-3xl font-bold text-gray-950">
              {snapshot.displayName}
            </h1>
            <p className="mt-2 text-gray-600">
              {ownershipSummaryLabel(snapshot)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-900">
              {statusLabel(snapshot.relationshipStatus)} relationship
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-800">
              {statusLabel(snapshot.publicationStatus)} publication
            </span>
          </div>
        </div>

        <dl className="mt-7 grid gap-4 border-t border-gray-100 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Domain state
            </dt>
            <dd className="mt-1 font-semibold text-gray-950">
              {snapshot.primaryDomainStatus
                ? statusLabel(snapshot.primaryDomainStatus)
                : "Not provisioned"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Required readiness
            </dt>
            <dd className="mt-1 font-semibold text-gray-950">
              {snapshot.readyRequiredIntegrations} of{" "}
              {snapshot.requiredIntegrations}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Open provider work
            </dt>
            <dd className="mt-1 font-semibold text-gray-950">
              {snapshot.openProviderJobs}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Pending invitations
            </dt>
            <dd className="mt-1 font-semibold text-gray-950">
              {snapshot.pendingInvitations}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Cleanup phase
            </dt>
            <dd className="mt-1 font-semibold text-gray-950">
              {cleanupPhaseLabel(snapshot.cleanupPhase)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Open cleanup work
            </dt>
            <dd className="mt-1 font-semibold text-gray-950">
              {snapshot.openDeprovisionJobs}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Suspended, UTC
            </dt>
            <dd className="mt-1 text-sm font-semibold text-gray-950">
              {timestampLabel(snapshot.suspendedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Archived, UTC
            </dt>
            <dd className="mt-1 text-sm font-semibold text-gray-950">
              {timestampLabel(snapshot.archivedAt)}
            </dd>
          </div>
        </dl>
      </header>

      <AdvocatePublicationControl
        advocateId={snapshot.advocateId}
        slug={snapshot.slug}
        initialVersion={snapshot.advocateVersion}
        canBeginPublicationCanary={snapshot.canBeginPublicationCanary}
      />

      {snapshot.cleanupPhase === "needs_attention" ? (
        <section
          aria-labelledby="cleanup-attention-heading"
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950"
        >
          <h2 id="cleanup-attention-heading" className="font-bold">
            Archived cleanup needs intervention
          </h2>
          <p className="mt-1 text-sm">
            Automated cleanup stopped because the protected infrastructure
            evidence requires Creator Share review. Correct the external cause
            before requesting any eligible retry. Provider details remain in the
            protected operational record.
          </p>
          {snapshot.canRetryCleanup ? (
            <AdvocateCleanupRecovery
              advocateId={snapshot.advocateId}
              slug={snapshot.slug}
              initialVersion={snapshot.advocateVersion}
            />
          ) : (
            <p className="mt-3 text-sm font-semibold">
              No cleanup retry is currently eligible. Review the protected
              operational record before taking further action.
            </p>
          )}
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <AdvocateLifecycleControls
          advocateId={snapshot.advocateId}
          slug={snapshot.slug}
          initialVersion={snapshot.advocateVersion}
          availableActions={availableActions}
        />
        {snapshot.relationshipStatus === "archived" ? (
          <section
            aria-labelledby="archived-ownership-heading"
            className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 id="archived-ownership-heading" className="text-xl font-bold">
              Ownership is immutable
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {snapshot.ownershipStatus === "owner_unassigned"
                ? "This archived advocate has no assigned owner. No invitation or ownership action remains available."
                : "Archived advocate ownership cannot be transferred. The retained owner label is historical evidence, not an active control."}
            </p>
          </section>
        ) : snapshot.ownershipStatus === "awaiting_owner_acceptance" ? (
          <AdvocateInitialOwnerControls
            advocateId={snapshot.advocateId}
            slug={snapshot.slug}
            initialVersion={snapshot.advocateVersion}
            canReissueInitialOwner={snapshot.canReissueInitialOwner}
            canRevokeInitialOwner={snapshot.canRevokeInitialOwner}
          />
        ) : (
          <AdvocateOwnershipTransfer
            advocateId={snapshot.advocateId}
            slug={snapshot.slug}
            currentOwnerDisplayName={snapshot.ownerDisplayName!}
            expectedOwnerMembershipId={
              ownershipTransfer.currentOwnerMembershipId
            }
            candidates={ownershipTransfer.candidates}
            candidateListMayBeIncomplete={
              ownershipTransfer.candidateListMayBeIncomplete
            }
          />
        )}
      </div>
    </main>
  )
}
