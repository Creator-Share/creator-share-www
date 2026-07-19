"use client"

import { useEffect, useState } from "react"

import { AdvocateCleanupRecovery } from "@/components/advocates/creatorShareAdmin/AdvocateCleanupRecovery"
import { AdvocateInitialOwnerControls } from "@/components/advocates/creatorShareAdmin/AdvocateInitialOwnerControls"
import { AdvocateLifecycleControls } from "@/components/advocates/creatorShareAdmin/AdvocateLifecycleControls"
import { AdvocateOnboarding } from "@/components/advocates/creatorShareAdmin/AdvocateOnboarding"
import { AdvocateOwnershipTransfer } from "@/components/advocates/creatorShareAdmin/AdvocateOwnershipTransfer"
import { AdvocatePublicationControl } from "@/components/advocates/creatorShareAdmin/AdvocatePublicationControl"

const PORTALS = Object.freeze({
  alpha: Object.freeze({
    advocateId: "11111111-1111-4111-8111-111111111111",
    slug: "alpha",
  }),
  beta: Object.freeze({
    advocateId: "22222222-2222-4222-8222-222222222222",
    slug: "beta",
  }),
})

const OWNER_MEMBERSHIP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const FIRST_CANDIDATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const SECOND_CANDIDATE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const REISSUE_SNAPSHOT_STORAGE_KEY =
  "creator-share:test-initial-owner-snapshot:v1"

const INITIAL_CANDIDATES = Object.freeze([
  Object.freeze({
    membershipId: FIRST_CANDIDATE_ID,
    displayName: "Bailey Builder",
  }),
  Object.freeze({
    membershipId: SECOND_CANDIDATE_ID,
    displayName: "Casey Caretaker",
  }),
])

const REFRESHED_CANDIDATES = Object.freeze([
  Object.freeze({
    membershipId: SECOND_CANDIDATE_ID,
    displayName: "Casey Caretaker",
  }),
])

export default function AdvocateControlRerenderHarness() {
  const [portalKey, setPortalKey] = useState<keyof typeof PORTALS>("alpha")
  const [snapshotRevision, setSnapshotRevision] = useState(0)
  const [ownerSnapshot, setOwnerSnapshot] = useState({
    version: 7,
    canReissue: true,
    canRevoke: true,
  })
  const portal = PORTALS[portalKey]
  const refreshed = snapshotRevision > 0

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(REISSUE_SNAPSHOT_STORAGE_KEY)
      if (raw === null) return
      const parsed: unknown = JSON.parse(raw)
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        "version" in parsed &&
        typeof parsed.version === "number" &&
        Number.isSafeInteger(parsed.version) &&
        parsed.version >= 1 &&
        "canReissue" in parsed &&
        typeof parsed.canReissue === "boolean" &&
        "canRevoke" in parsed &&
        typeof parsed.canRevoke === "boolean"
      ) {
        setOwnerSnapshot({
          version: parsed.version,
          canReissue: parsed.canReissue,
          canRevoke: parsed.canRevoke,
        })
      }
    } catch {
      // The harness starts from the eligible snapshot when storage is invalid.
    }
  }, [])

  return (
    <main>
      <div aria-label="Harness controls">
        <button type="button" onClick={() => setPortalKey("beta")}>
          Navigate to beta portal
        </button>
        <button
          type="button"
          onClick={() => setSnapshotRevision((revision) => revision + 1)}
        >
          Apply refreshed snapshot
        </button>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(
              REISSUE_SNAPSHOT_STORAGE_KEY,
              JSON.stringify({
                version: 8,
                canReissue: false,
                canRevoke: true,
              }),
            )
            location.reload()
          }}
        >
          Reload committed reissue snapshot
        </button>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(
              REISSUE_SNAPSHOT_STORAGE_KEY,
              JSON.stringify({
                version: 8,
                canReissue: true,
                canRevoke: false,
              }),
            )
            location.reload()
          }}
        >
          Reload committed revocation snapshot
        </button>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(
              REISSUE_SNAPSHOT_STORAGE_KEY,
              JSON.stringify({
                version: 7,
                canReissue: false,
                canRevoke: true,
              }),
            )
            location.reload()
          }}
        >
          Reload revocable owner snapshot
        </button>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(
              REISSUE_SNAPSHOT_STORAGE_KEY,
              JSON.stringify({
                version: 7,
                canReissue: false,
                canRevoke: false,
              }),
            )
            location.reload()
          }}
        >
          Reload ineligible owner snapshot
        </button>
      </div>

      <AdvocateLifecycleControls
        advocateId={portal.advocateId}
        slug={portal.slug}
        initialVersion={7 + snapshotRevision}
        availableActions={["suspend", "archive"]}
      />

      <AdvocatePublicationControl
        advocateId={portal.advocateId}
        slug={portal.slug}
        initialVersion={7 + snapshotRevision}
        canBeginPublicationCanary
      />

      <AdvocateOnboarding />

      <section aria-label="Ownerless portal controls">
        <p>Awaiting owner acceptance</p>
        <AdvocateInitialOwnerControls
          advocateId={portal.advocateId}
          slug={portal.slug}
          initialVersion={ownerSnapshot.version}
          canReissueInitialOwner={ownerSnapshot.canReissue}
          canRevokeInitialOwner={ownerSnapshot.canRevoke}
        />
      </section>

      <AdvocateCleanupRecovery
        advocateId={portal.advocateId}
        slug={portal.slug}
        initialVersion={7 + snapshotRevision}
      />

      <AdvocateOwnershipTransfer
        advocateId={portal.advocateId}
        slug={portal.slug}
        currentOwnerDisplayName={refreshed ? "Bailey Builder" : "Alex Owner"}
        expectedOwnerMembershipId={
          refreshed ? FIRST_CANDIDATE_ID : OWNER_MEMBERSHIP_ID
        }
        candidates={refreshed ? REFRESHED_CANDIDATES : INITIAL_CANDIDATES}
        candidateListMayBeIncomplete={false}
      />
    </main>
  )
}
