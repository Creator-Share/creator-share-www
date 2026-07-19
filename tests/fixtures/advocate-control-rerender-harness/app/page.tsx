"use client"

import { useState } from "react"

import { AdvocateCleanupRecovery } from "@/components/advocates/creatorShareAdmin/AdvocateCleanupRecovery"
import { AdvocateLifecycleControls } from "@/components/advocates/creatorShareAdmin/AdvocateLifecycleControls"
import { AdvocateOwnershipTransfer } from "@/components/advocates/creatorShareAdmin/AdvocateOwnershipTransfer"

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
  const portal = PORTALS[portalKey]
  const refreshed = snapshotRevision > 0

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
      </div>

      <AdvocateLifecycleControls
        advocateId={portal.advocateId}
        slug={portal.slug}
        initialVersion={7 + snapshotRevision}
        availableActions={["suspend", "archive"]}
      />

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
