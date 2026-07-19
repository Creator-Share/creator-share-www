import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  MAX_CREATOR_SHARE_ADVOCATE_CONTROL_BODY_BYTES,
  parseCreatorShareAdvocateCleanupRecoveryRequest,
  parseCreatorShareAdvocateCleanupRecoveryResponse,
  parseCreatorShareAdvocateLifecycleRequest,
  parseCreatorShareAdvocateLifecycleResponse,
  parseCreatorShareAdvocateOwnershipTransferRequest,
  parseCreatorShareAdvocateOwnershipTransferResponse,
  readBoundedCreatorShareAdvocateControlBody,
} from "../../src/lib/advocates/creatorShareAdmin/lifecycleContracts"

type LifecycleModule =
  typeof import("../../src/lib/advocates/creatorShareAdmin/lifecycle")
type RouteSecurityModule =
  typeof import("../../src/lib/advocates/creatorShareAdmin/routeSecurity")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/advocates/creator-share-advocate-lifecycle.spec.ts",
  ),
)
const lifecycle = testRequire(
  "../../src/lib/advocates/creatorShareAdmin/lifecycle",
) as LifecycleModule
const routeSecurity = testRequire(
  "../../src/lib/advocates/creatorShareAdmin/routeSecurity",
) as RouteSecurityModule
nodeModule._load = originalModuleLoad

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const SECOND_ADVOCATE_ID = "00000000-0000-4000-8000-000000000001"
const DOMAIN_ID = "22222222-2222-4222-8222-222222222222"
const OWNER_MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333"
const TARGET_MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444"
const OPERATION_ID = "55555555-5555-4555-8555-555555555555"

const SUMMARY_ROW = Object.freeze({
  advocate_id: ADVOCATE_ID,
  slug: "hope",
  display_name: "Hope Creates",
  relationship_status: "active",
  publication_status: "active",
  advocate_version: "7",
  owner_display_name: "Aubrey F.",
  ownership_status: "owner_active",
  can_reissue_initial_owner: false,
  can_revoke_initial_owner: false,
  primary_hostname: "hope.creatorshare.com",
  primary_domain_status: "active",
  ready_required_integrations: 5,
  required_integrations: 5,
  open_provider_jobs: 0,
  pending_invitations: 2,
  suspended_at: null,
  archived_at: null,
  updated_at: "2026-07-19T04:00:00+00:00",
  created_at: "2026-07-19T03:00:00+00:00",
})

const SNAPSHOT_ROW = Object.freeze({
  ...SUMMARY_ROW,
  primary_domain_id: DOMAIN_ID,
  open_deprovision_jobs: 0,
  cleanup_phase: "not_requested",
  can_retry_cleanup: false,
  can_begin_publication_canary: false,
  can_suspend: true,
  can_resume: false,
  can_archive: true,
  can_repair: true,
  created_at: undefined,
})

function snapshotRow(): Record<string, unknown> {
  const { created_at: _createdAt, ...row } = SNAPSHOT_ROW
  return row
}

const CANDIDATES = Object.freeze([
  {
    membership_id: OWNER_MEMBERSHIP_ID,
    display_name: "Aubrey F.",
    membership_status: "active",
    is_current_owner: true,
    is_eligible: false,
  },
  {
    membership_id: TARGET_MEMBERSHIP_ID,
    display_name: "Taylor R.",
    membership_status: "active",
    is_current_owner: false,
    is_eligible: true,
  },
])

test.describe("Creator Share advocate lifecycle contracts", () => {
  test("bounds forensic request metadata before it reaches an audit RPC", () => {
    const context = routeSecurity.creatorShareAdvocateControlForensicContext(
      new Request("https://creatorshare.com/admin/advocates", {
        headers: {
          "cf-connecting-ip": "198.51.100.9",
          "x-vercel-forwarded-for": "203.0.113.42",
          "user-agent": "a".repeat(2_000),
        },
      }),
    )
    expect(context).toEqual({
      clientIp: "203.0.113.42",
      userAgent: "a".repeat(1_024),
    })
    expect(Object.isFrozen(context)).toBe(true)

    const spoofed = routeSecurity.creatorShareAdvocateControlForensicContext(
      new Request("https://creatorshare.com/admin/advocates", {
        headers: {
          "cf-connecting-ip": "198.51.100.9",
          "x-forwarded-for": "198.51.100.10",
          "x-real-ip": "198.51.100.11",
          "x-vercel-forwarded-for": "not-an-ip",
        },
      }),
    )
    expect(spoofed.clientIp).toBeNull()
  })

  test("accepts only exact versioned lifecycle requests with archive confirmation", () => {
    expect(
      parseCreatorShareAdvocateLifecycleRequest(
        JSON.stringify({
          action: "suspend",
          expectedVersion: 7,
          reason: "Pause publication while the partnership is reviewed.",
          operationId: OPERATION_ID,
          confirmation: null,
        }),
      ),
    ).toEqual({
      action: "suspend",
      expectedVersion: 7,
      reason: "Pause publication while the partnership is reviewed.",
      operationId: OPERATION_ID,
      confirmation: null,
    })
    expect(
      parseCreatorShareAdvocateLifecycleRequest(
        JSON.stringify({
          action: "archive",
          expectedVersion: 7,
          reason: "The partnership ended and cleanup is approved.",
          operationId: OPERATION_ID,
          confirmation: "ARCHIVE",
        }),
      ),
    ).toMatchObject({ action: "archive", confirmation: "ARCHIVE" })
    expect(
      parseCreatorShareAdvocateLifecycleRequest(
        JSON.stringify({
          action: "suspend",
          expectedVersion: 7,
          reason: "Pause publication.\nReview the relationship next week.",
          operationId: OPERATION_ID,
          confirmation: null,
        }),
      ),
    ).toMatchObject({
      reason: "Pause publication.\nReview the relationship next week.",
    })

    for (const invalid of [
      {},
      {
        action: "unarchive",
        expectedVersion: 7,
        reason: "Forbidden action.",
        operationId: OPERATION_ID,
        confirmation: null,
      },
      {
        action: "force_publish",
        expectedVersion: 7,
        reason: "Forbidden action.",
        operationId: OPERATION_ID,
        confirmation: null,
      },
      {
        action: "archive",
        expectedVersion: 7,
        reason: "Missing confirmation.",
        operationId: OPERATION_ID,
        confirmation: null,
      },
      {
        action: "resume",
        expectedVersion: 7,
        reason: "Unexpected confirmation.",
        operationId: OPERATION_ID,
        confirmation: "ARCHIVE",
      },
      {
        action: "resume",
        expectedVersion: 0,
        reason: "Bad version.",
        operationId: OPERATION_ID,
        confirmation: null,
      },
      {
        action: "resume",
        expectedVersion: 7,
        reason: " padded ",
        operationId: OPERATION_ID,
        confirmation: null,
      },
      {
        action: "resume",
        expectedVersion: 7,
        reason: "Extra key.",
        operationId: OPERATION_ID,
        confirmation: null,
        providerId: "must-not-cross",
      },
      {
        action: "resume",
        expectedVersion: 7,
        reason: "Browser session identity must not cross.",
        operationId: OPERATION_ID,
        confirmation: null,
        sessionId: "browser-supplied-session",
      },
    ]) {
      expect(
        parseCreatorShareAdvocateLifecycleRequest(JSON.stringify(invalid)),
      ).toBeNull()
    }
  })

  test("accepts only tenant-scoped membership identifiers for ownership transfer", () => {
    const request = {
      expectedOwnerMembershipId: OWNER_MEMBERSHIP_ID,
      targetOwnerMembershipId: TARGET_MEMBERSHIP_ID,
      reason: "Appoint the active delegate as the new portal owner.",
      operationId: OPERATION_ID,
      confirmation: "TRANSFER",
    }
    expect(
      parseCreatorShareAdvocateOwnershipTransferRequest(
        JSON.stringify(request),
      ),
    ).toEqual(request)

    for (const invalid of [
      { ...request, expectedOwnerMembershipId: "bad" },
      { ...request, targetOwnerMembershipId: OWNER_MEMBERSHIP_ID },
      {
        ...request,
        operationId: "55555555-5555-1555-8555-555555555555",
      },
      { ...request, confirmation: "YES" },
      { ...request, authUserId: TARGET_MEMBERSHIP_ID },
      { ...request, sessionId: "browser-supplied-session" },
      { ...request, reason: "" },
    ]) {
      expect(
        parseCreatorShareAdvocateOwnershipTransferRequest(
          JSON.stringify(invalid),
        ),
      ).toBeNull()
    }
  })

  test("accepts only exact versioned cleanup recovery requests and results", () => {
    const request = {
      expectedVersion: 7,
      reason: "The protected external issue was corrected and verified.",
      operationId: OPERATION_ID,
      confirmation: "RETRY_CLEANUP",
    }
    expect(
      parseCreatorShareAdvocateCleanupRecoveryRequest(JSON.stringify(request)),
    ).toEqual(request)
    for (const invalid of [
      { ...request, confirmation: "RETRY" },
      { ...request, expectedVersion: 0 },
      { ...request, reason: " padded " },
      { ...request, provider: "cloudflare" },
      { ...request, sessionId: "browser-supplied-session" },
    ]) {
      expect(
        parseCreatorShareAdvocateCleanupRecoveryRequest(
          JSON.stringify(invalid),
        ),
      ).toBeNull()
    }

    const expected = { operationId: OPERATION_ID, expectedVersion: 7 }
    expect(
      parseCreatorShareAdvocateCleanupRecoveryResponse(
        {
          ok: true,
          operationId: OPERATION_ID,
          advocateVersion: 8,
          cleanupPhase: "cloudflare_dns_removal",
          cleanupRetryRequested: true,
        },
        expected,
      ),
    ).toMatchObject({ ok: true, advocateVersion: 8 })
    for (const invalid of [
      {
        ok: true,
        operationId: OPERATION_ID,
        advocateVersion: 8,
        cleanupPhase: "needs_attention",
        cleanupRetryRequested: true,
      },
      {
        ok: true,
        operationId: OPERATION_ID,
        advocateVersion: 8,
        cleanupPhase: "cloudflare_dns_removal",
        cleanupRetryRequested: true,
        providerId: "must-not-cross",
      },
    ]) {
      expect(
        parseCreatorShareAdvocateCleanupRecoveryResponse(invalid, expected),
      ).toBeNull()
    }
  })

  test("bounds the request stream and rejects invalid UTF-8", async () => {
    const body = JSON.stringify({ ok: true })
    await expect(
      readBoundedCreatorShareAdvocateControlBody(
        new Request(
          "https://creatorshare.com/api/admin/advocates/id/lifecycle",
          {
            method: "POST",
            body,
          },
        ),
      ),
    ).resolves.toBe(body)

    await expect(
      readBoundedCreatorShareAdvocateControlBody(
        new Request(
          "https://creatorshare.com/api/admin/advocates/id/lifecycle",
          {
            method: "POST",
            body: "x".repeat(MAX_CREATOR_SHARE_ADVOCATE_CONTROL_BODY_BYTES + 1),
          },
        ),
      ),
    ).resolves.toBeNull()
    await expect(
      readBoundedCreatorShareAdvocateControlBody(
        new Request(
          "https://creatorshare.com/api/admin/advocates/id/lifecycle",
          {
            method: "POST",
            body: Uint8Array.from([0xc3, 0x28]),
          },
        ),
      ),
    ).resolves.toBeNull()
  })

  test("strictly parses action-specific lifecycle responses", () => {
    const expected = {
      operationId: OPERATION_ID,
      expectedVersion: 7,
      action: "repair" as const,
    }
    expect(
      parseCreatorShareAdvocateLifecycleResponse(
        {
          ok: true,
          operationId: OPERATION_ID,
          advocateVersion: 8,
          relationshipStatus: "active",
          publicationStatus: "provisioning",
          domainCleanupRequested: false,
        },
        expected,
      ),
    ).toMatchObject({ ok: true, advocateVersion: 8 })

    for (const invalid of [
      {
        ok: true,
        operationId: OPERATION_ID,
        advocateVersion: 8,
        relationshipStatus: "active",
        publicationStatus: "active",
        domainCleanupRequested: false,
      },
      {
        ok: true,
        operationId: OPERATION_ID,
        advocateVersion: 8,
        relationshipStatus: "active",
        publicationStatus: "provisioning",
        domainCleanupRequested: false,
        providerError: "must-not-cross",
      },
      {
        ok: true,
        operationId: "66666666-6666-4666-8666-666666666666",
        advocateVersion: 8,
        relationshipStatus: "active",
        publicationStatus: "provisioning",
        domainCleanupRequested: false,
      },
    ]) {
      expect(
        parseCreatorShareAdvocateLifecycleResponse(invalid, expected),
      ).toBeNull()
    }
    expect(
      parseCreatorShareAdvocateLifecycleResponse(
        {
          ok: false,
          operationId: OPERATION_ID,
          code: "lifecycle_conflict",
        },
        expected,
      ),
    ).toEqual({
      ok: false,
      operationId: OPERATION_ID,
      code: "lifecycle_conflict",
    })
  })

  test("strictly parses ownership responses without accepting identity fields", () => {
    expect(
      parseCreatorShareAdvocateOwnershipTransferResponse(
        { ok: true, operationId: OPERATION_ID },
        OPERATION_ID,
      ),
    ).toEqual({ ok: true, operationId: OPERATION_ID })
    expect(
      parseCreatorShareAdvocateOwnershipTransferResponse(
        {
          ok: true,
          operationId: OPERATION_ID,
          targetAuthUserId: TARGET_MEMBERSHIP_ID,
        },
        OPERATION_ID,
      ),
    ).toBeNull()
  })
})

test.describe("Creator Share advocate control projections", () => {
  test("parses the exact privacy-limited list projection", () => {
    const parsed =
      lifecycle.parseCreatorShareAdvocateControlSummary(SUMMARY_ROW)
    expect(parsed).toMatchObject({
      advocateId: ADVOCATE_ID,
      ownerDisplayName: "Aubrey F.",
      readyRequiredIntegrations: 5,
    })
    expect(JSON.stringify(parsed)).not.toMatch(
      /primary_domain_id|provider_id|provider_error|email|auth_user|contact/i,
    )

    const awaitingOwner = lifecycle.parseCreatorShareAdvocateControlSummary({
      ...SUMMARY_ROW,
      relationship_status: "invited",
      publication_status: "draft",
      owner_display_name: null,
      ownership_status: "awaiting_owner_acceptance",
      can_reissue_initial_owner: true,
      can_revoke_initial_owner: true,
      primary_hostname: null,
      primary_domain_status: null,
      ready_required_integrations: 0,
      required_integrations: 0,
      open_provider_jobs: 0,
    })
    expect(awaitingOwner).toMatchObject({
      ownerDisplayName: null,
      ownershipStatus: "awaiting_owner_acceptance",
      canReissueInitialOwner: true,
      canRevokeInitialOwner: true,
    })
    expect(JSON.stringify(awaitingOwner)).not.toMatch(
      /email|invitation_id|outbox|capability|ciphertext|provider_error/i,
    )

    const archivedOwnerless = lifecycle.parseCreatorShareAdvocateControlSummary(
      {
        ...SUMMARY_ROW,
        relationship_status: "archived",
        publication_status: "suspended",
        owner_display_name: null,
        ownership_status: "owner_unassigned",
        can_reissue_initial_owner: false,
        can_revoke_initial_owner: false,
        primary_domain_status: "disabled",
        pending_invitations: 0,
        suspended_at: "2026-07-19T05:00:00+00:00",
        archived_at: "2026-07-19T05:00:00+00:00",
      },
    )
    expect(archivedOwnerless).toMatchObject({
      relationshipStatus: "archived",
      publicationStatus: "suspended",
      ownerDisplayName: null,
      ownershipStatus: "owner_unassigned",
      canReissueInitialOwner: false,
      canRevokeInitialOwner: false,
    })
    expect(JSON.stringify(archivedOwnerless)).not.toMatch(
      /email|invitation_id|outbox|capability|ciphertext|provider_error/i,
    )

    for (const invalid of [
      { ...SUMMARY_ROW, owner_display_name: "owner@example.com" },
      { ...SUMMARY_ROW, owner_display_name: null },
      {
        ...SUMMARY_ROW,
        ownership_status: "awaiting_owner_acceptance",
        can_reissue_initial_owner: true,
        can_revoke_initial_owner: true,
      },
      {
        ...SUMMARY_ROW,
        owner_display_name: null,
        ownership_status: "owner_unassigned",
      },
      {
        ...SUMMARY_ROW,
        relationship_status: "archived",
        publication_status: "suspended",
        owner_display_name: null,
        ownership_status: "owner_unassigned",
        can_reissue_initial_owner: true,
        archived_at: "2026-07-19T05:00:00+00:00",
      },
      { ...SUMMARY_ROW, primary_hostname: "hope.example.com" },
      { ...SUMMARY_ROW, ready_required_integrations: 6 },
      { ...SUMMARY_ROW, auth_user_id: TARGET_MEMBERSHIP_ID },
      { ...SUMMARY_ROW, archived_at: "2026-07-19T05:00:00+00:00" },
    ]) {
      expect(
        lifecycle.parseCreatorShareAdvocateControlSummary(invalid),
      ).toBeNull()
    }
  })

  test("requires unique reverse-ordered list rows", () => {
    const second = {
      ...SUMMARY_ROW,
      advocate_id: SECOND_ADVOCATE_ID,
      slug: "care",
      display_name: "Care Together",
      primary_hostname: "care.creatorshare.com",
      created_at: "2026-07-19T02:00:00+00:00",
    }
    expect(
      lifecycle.parseCreatorShareAdvocateControlSummaries([
        SUMMARY_ROW,
        second,
      ]),
    ).toHaveLength(2)
    expect(
      lifecycle.parseCreatorShareAdvocateControlSummaries([
        second,
        SUMMARY_ROW,
      ]),
    ).toBeNull()
    expect(
      lifecycle.parseCreatorShareAdvocateControlSummaries([
        SUMMARY_ROW,
        SUMMARY_ROW,
      ]),
    ).toBeNull()

    const newerMicrosecond = {
      ...SUMMARY_ROW,
      created_at: "2026-07-19T03:00:00.123456+00:00",
    }
    const olderMicrosecond = {
      ...second,
      created_at: "2026-07-19T03:00:00.123455+00:00",
    }
    expect(
      lifecycle.parseCreatorShareAdvocateControlSummaries([
        newerMicrosecond,
        olderMicrosecond,
      ]),
    ).toHaveLength(2)
    expect(
      lifecycle.parseCreatorShareAdvocateControlSummaries([
        olderMicrosecond,
        newerMicrosecond,
      ]),
    ).toBeNull()
  })

  test("validates and then discards the private domain resource identifier", () => {
    const snapshot = lifecycle.parseCreatorShareAdvocateControlSnapshot([
      snapshotRow(),
    ])
    expect(snapshot).toMatchObject({
      advocateId: ADVOCATE_ID,
      canSuspend: true,
      cleanupPhase: "not_requested",
    })
    expect(JSON.stringify(snapshot)).not.toContain(DOMAIN_ID)

    const publicationReady = lifecycle.parseCreatorShareAdvocateControlSnapshot(
      [
        {
          ...snapshotRow(),
          publication_status: "provisioning",
          primary_domain_status: "verifying",
          can_begin_publication_canary: true,
        },
      ],
    )
    expect(publicationReady).toMatchObject({
      canBeginPublicationCanary: true,
      primaryDomainStatus: "verifying",
    })
    expect(
      lifecycle.parseCreatorShareAdvocateControlSnapshot([
        {
          ...snapshotRow(),
          can_begin_publication_canary: true,
        },
      ]),
    ).toBeNull()
    expect(
      lifecycle.parseCreatorShareAdvocateControlSnapshot([
        { ...snapshotRow(), provider_error: "must-not-cross" },
      ]),
    ).toBeNull()
    expect(
      lifecycle.parseCreatorShareAdvocateControlSnapshot([
        { ...snapshotRow(), primary_domain_id: "bad" },
      ]),
    ).toBeNull()

    const needsAttention = lifecycle.parseCreatorShareAdvocateControlSnapshot([
      {
        ...snapshotRow(),
        relationship_status: "archived",
        publication_status: "suspended",
        archived_at: "2026-07-19T05:00:00+00:00",
        cleanup_phase: "needs_attention",
        can_retry_cleanup: true,
        can_suspend: false,
        can_resume: false,
        can_archive: false,
        can_repair: false,
      },
    ])
    expect(needsAttention).toMatchObject({
      cleanupPhase: "needs_attention",
      canRetryCleanup: true,
    })
    expect(
      lifecycle.parseCreatorShareAdvocateControlSnapshot([
        { ...snapshotRow(), can_retry_cleanup: true },
      ]),
    ).toBeNull()

    const awaitingOwner = lifecycle.parseCreatorShareAdvocateControlSnapshot([
      {
        ...snapshotRow(),
        relationship_status: "invited",
        publication_status: "draft",
        owner_display_name: null,
        ownership_status: "awaiting_owner_acceptance",
        can_reissue_initial_owner: true,
        can_revoke_initial_owner: true,
        primary_domain_id: null,
        primary_hostname: null,
        primary_domain_status: null,
        ready_required_integrations: 0,
        required_integrations: 0,
        open_provider_jobs: 0,
        can_suspend: false,
        can_resume: false,
        can_repair: false,
      },
    ])
    expect(awaitingOwner).toMatchObject({
      ownershipStatus: "awaiting_owner_acceptance",
      ownerDisplayName: null,
      canReissueInitialOwner: true,
      canRevokeInitialOwner: true,
      canSuspend: false,
    })

    const archivedOwnerless =
      lifecycle.parseCreatorShareAdvocateControlSnapshot([
        {
          ...snapshotRow(),
          relationship_status: "archived",
          publication_status: "suspended",
          owner_display_name: null,
          ownership_status: "owner_unassigned",
          can_reissue_initial_owner: false,
          can_revoke_initial_owner: false,
          primary_domain_status: "disabled",
          pending_invitations: 0,
          suspended_at: "2026-07-19T05:00:00+00:00",
          archived_at: "2026-07-19T05:00:00+00:00",
          cleanup_phase: "quiescing",
          open_deprovision_jobs: 1,
          can_retry_cleanup: false,
          can_suspend: false,
          can_resume: false,
          can_archive: false,
          can_repair: false,
        },
      ])
    expect(archivedOwnerless).toMatchObject({
      relationshipStatus: "archived",
      publicationStatus: "suspended",
      ownershipStatus: "owner_unassigned",
      ownerDisplayName: null,
      canReissueInitialOwner: false,
      canRevokeInitialOwner: false,
      canArchive: false,
    })
  })

  test("accepts only sorted privacy-safe ownership candidates", () => {
    const candidates =
      lifecycle.parseCreatorShareAdvocateOwnershipCandidates(CANDIDATES)
    expect(candidates).toEqual([
      {
        membershipId: OWNER_MEMBERSHIP_ID,
        displayName: "Aubrey F.",
        status: "active",
        isCurrentOwner: true,
        isEligible: false,
      },
      {
        membershipId: TARGET_MEMBERSHIP_ID,
        displayName: "Taylor R.",
        status: "active",
        isCurrentOwner: false,
        isEligible: true,
      },
    ])
    expect(JSON.stringify(candidates)).not.toMatch(/email|user_id|contact/i)
    expect(
      lifecycle.parseCreatorShareAdvocateOwnershipCandidates([
        { ...CANDIDATES[0], email: "must-not-cross@example.com" },
      ]),
    ).toBeNull()
    expect(
      lifecycle.parseCreatorShareAdvocateOwnershipCandidates([
        CANDIDATES[1],
        CANDIDATES[0],
      ]),
    ).toBeNull()
    expect(
      lifecycle.parseCreatorShareAdvocateOwnershipCandidates([
        CANDIDATES[0],
        {
          ...CANDIDATES[1],
          is_current_owner: true,
          is_eligible: false,
        },
      ]),
    ).toBeNull()
  })

  test("uses a canonical opaque keyset cursor", () => {
    const cursor = lifecycle.encodeCreatorShareAdvocateControlCursor({
      createdAt: SUMMARY_ROW.created_at,
      advocateId: ADVOCATE_ID,
    })
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(lifecycle.parseCreatorShareAdvocateControlCursor(cursor)).toEqual({
      createdAt: SUMMARY_ROW.created_at,
      advocateId: ADVOCATE_ID,
    })
    expect(
      lifecycle.parseCreatorShareAdvocateControlCursor(`${cursor}=`),
    ).toBeNull()
  })
})

test.describe("Creator Share advocate control repository", () => {
  test("uses only bounded purpose-built readers", async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const client = {
      async rpc(name: string, args: unknown) {
        calls.push({ name, args })
        if (name === "list_creator_share_advocate_controls") {
          return { data: [SUMMARY_ROW], error: null }
        }
        if (name === "get_creator_share_advocate_control_snapshot") {
          return { data: [snapshotRow()], error: null }
        }
        return { data: CANDIDATES, error: null }
      },
    }
    const repository = lifecycle.createCreatorShareAdvocateControlRepository(
      client as never,
    )

    await expect(
      repository.list({
        relationshipStatus: "active",
        publicationStatus: null,
        cursor: null,
      }),
    ).resolves.toMatchObject({ advocates: [expect.any(Object)] })
    await expect(repository.loadSnapshot(ADVOCATE_ID)).resolves.toMatchObject({
      advocateId: ADVOCATE_ID,
    })
    await expect(
      repository.listOwnershipCandidates(ADVOCATE_ID),
    ).resolves.toMatchObject({ candidates: expect.any(Array), hasMore: false })

    expect(calls).toEqual([
      {
        name: "list_creator_share_advocate_controls",
        args: {
          page_size: 51,
          before_created_at: null,
          before_advocate_id: null,
          relationship_filter: "active",
          publication_filter: null,
        },
      },
      {
        name: "get_creator_share_advocate_control_snapshot",
        args: { target_advocate_id: ADVOCATE_ID },
      },
      {
        name: "list_creator_share_advocate_ownership_candidates",
        args: {
          target_advocate_id: ADVOCATE_ID,
          page_size: 200,
          after_membership_id: null,
        },
      },
    ])
  })

  test("writes exact idempotent lifecycle, cleanup, and ownership commands", async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const client = {
      async rpc(name: string, args: unknown) {
        calls.push({ name, args })
        if (name === "apply_creator_share_advocate_lifecycle_action") {
          return {
            data: [
              {
                advocate_id: ADVOCATE_ID,
                advocate_version: 8,
                relationship_status: "suspended",
                publication_status: "suspended",
                domain_cleanup_requested: false,
              },
            ],
            error: null,
          }
        }
        if (name === "retry_creator_share_advocate_cleanup") {
          return {
            data: [
              {
                advocate_id: ADVOCATE_ID,
                advocate_version: 8,
                cleanup_phase: "cloudflare_dns_removal",
                cleanup_retry_requested: true,
              },
            ],
            error: null,
          }
        }
        return { data: ADVOCATE_ID, error: null }
      },
    }
    const repository = lifecycle.createCreatorShareAdvocateControlRepository(
      client as never,
    )
    await expect(
      repository.applyLifecycleAction({
        advocateId: ADVOCATE_ID,
        expectedVersion: 7,
        action: "suspend",
        reason: "Pause the portal.",
        operationId: OPERATION_ID,
        traceId: "trace-1",
        clientIp: "203.0.113.42",
        userAgent: "repository-test-agent",
      }),
    ).resolves.toMatchObject({ advocateVersion: 8 })
    await expect(
      repository.retryCleanup({
        advocateId: ADVOCATE_ID,
        expectedVersion: 7,
        reason: "The protected external issue was corrected.",
        operationId: OPERATION_ID,
        traceId: "trace-recovery",
        clientIp: "203.0.113.42",
        userAgent: "repository-test-agent",
      }),
    ).resolves.toMatchObject({
      advocateVersion: 8,
      cleanupPhase: "cloudflare_dns_removal",
      cleanupRetryRequested: true,
    })
    await expect(
      repository.transferOwnership({
        advocateId: ADVOCATE_ID,
        expectedOwnerMembershipId: OWNER_MEMBERSHIP_ID,
        targetOwnerMembershipId: TARGET_MEMBERSHIP_ID,
        reason: "Appoint the new owner.",
        operationId: OPERATION_ID,
        traceId: "trace-2",
        clientIp: "203.0.113.42",
        userAgent: "repository-test-agent",
      }),
    ).resolves.toBeUndefined()

    expect(calls).toEqual([
      {
        name: "apply_creator_share_advocate_lifecycle_action",
        args: {
          target_advocate_id: ADVOCATE_ID,
          expected_advocate_version: 7,
          target_action: "suspend",
          change_reason: "Pause the portal.",
          request_id: OPERATION_ID,
          trace_id: "trace-1",
          client_ip: "203.0.113.42",
          user_agent: "repository-test-agent",
        },
      },
      {
        name: "retry_creator_share_advocate_cleanup",
        args: {
          target_advocate_id: ADVOCATE_ID,
          expected_advocate_version: 7,
          change_reason: "The protected external issue was corrected.",
          request_id: OPERATION_ID,
          trace_id: "trace-recovery",
          client_ip: "203.0.113.42",
          user_agent: "repository-test-agent",
        },
      },
      {
        name: "transfer_creator_share_advocate_ownership",
        args: {
          target_advocate_id: ADVOCATE_ID,
          expected_owner_membership_id: OWNER_MEMBERSHIP_ID,
          target_owner_membership_id: TARGET_MEMBERSHIP_ID,
          change_reason: "Appoint the new owner.",
          request_id: OPERATION_ID,
          trace_id: "trace-2",
          client_ip: "203.0.113.42",
          user_agent: "repository-test-agent",
        },
      },
    ])
  })

  test("fails closed on database and projection errors", async () => {
    const denied = lifecycle.createCreatorShareAdvocateControlRepository({
      async rpc() {
        return { data: null, error: { code: "42501" } }
      },
    } as never)
    await expect(denied.loadSnapshot(ADVOCATE_ID)).rejects.toMatchObject({
      name: "CreatorShareAdvocateControlRepositoryError",
      stage: "snapshot",
      postgresCode: "42501",
    })

    const malformed = lifecycle.createCreatorShareAdvocateControlRepository({
      async rpc() {
        return { data: [{ provider_error: "must-not-cross" }], error: null }
      },
    } as never)
    await expect(
      malformed.list({
        relationshipStatus: null,
        publicationStatus: null,
        cursor: null,
      }),
    ).rejects.toMatchObject({ stage: "shape" })
  })

  test("maps database failures to static browser-safe outcomes", () => {
    expect(
      lifecycle.classifyCreatorShareAdvocateLifecycleFailure("42501"),
    ).toEqual({ status: 403, code: "forbidden" })
    expect(
      lifecycle.classifyCreatorShareAdvocateLifecycleFailure("40001"),
    ).toEqual({ status: 409, code: "lifecycle_conflict" })
    expect(
      lifecycle.classifyCreatorShareAdvocateLifecycleFailure("23505"),
    ).toEqual({ status: 409, code: "lifecycle_conflict" })
    expect(
      lifecycle.classifyCreatorShareAdvocateLifecycleFailure("55000"),
    ).toEqual({ status: 409, code: "lifecycle_conflict" })
    expect(
      lifecycle.classifyCreatorShareAdvocateLifecycleFailure("XX000"),
    ).toEqual({ status: 500, code: "lifecycle_update_failed" })
    expect(
      lifecycle.classifyCreatorShareAdvocateOwnershipFailure("23503"),
    ).toEqual({ status: 409, code: "ownership_conflict" })
    for (const code of ["55000", "23514", "23505", "55P03"]) {
      expect(
        lifecycle.classifyCreatorShareAdvocateOwnershipFailure(code),
      ).toEqual({ status: 409, code: "ownership_conflict" })
    }
    expect(
      lifecycle.classifyCreatorShareAdvocateCleanupRecoveryFailure("55000"),
    ).toEqual({ status: 409, code: "cleanup_recovery_conflict" })
    expect(
      lifecycle.classifyCreatorShareAdvocateCleanupRecoveryFailure("XX000"),
    ).toEqual({ status: 500, code: "cleanup_recovery_failed" })
  })
})
