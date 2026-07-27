import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  clearConcurrencyGateEvidence,
  installConcurrencyGateTerminationCleanup,
  loadConcurrencyGateProvenance,
  withPgClients,
  writeConcurrencyGateEvidence,
} from "./support/concurrency-gate.mjs"
import {
  configureAuthenticatedTransaction,
  configureServiceRoleTransaction,
  createTransientLocalSupabaseDatabase,
} from "./support/local-supabase.mjs"
import { waitForClientsBlockedBy } from "./support/postgres-barrier.mjs"

const WORKSPACE = resolve(process.cwd())
const FIXTURE_PATH = resolve(
  WORKSPACE,
  "tests/database/fixtures/advocate-invitation-proof-quarantine-concurrency.sql",
)
const EVIDENCE_OUTPUT_PATH = process.env
  .ADVOCATE_INVITATION_PROOF_QUARANTINE_CONCURRENCY_EVIDENCE_PATH
  ? resolve(
      process.env
        .ADVOCATE_INVITATION_PROOF_QUARANTINE_CONCURRENCY_EVIDENCE_PATH,
    )
  : null

const FF042_EVIDENCE_SCENARIO_SCHEMA = Object.freeze({
  claim_signature_cutover: Object.freeze({
    scenario: "claim_signature_cutover",
    legacyClaimFunctions: "number",
    sharedIssuerClaimFunctions: "number",
  }),
  post_migration_arm_exact_replay: Object.freeze({
    scenario: "post_migration_arm_exact_replay",
    blockedSessions: "number",
    blockingObservations: "number",
    armMutations: "number",
    replayedResults: "number",
  }),
  committed_arm_early_quarantine_rejection: Object.freeze({
    scenario: "committed_arm_early_quarantine_rejection",
    rejectedBeforeDrainSeconds: "number",
    outcome: "drain_incomplete",
  }),
  quarantine_claim_and_gate_serialization: Object.freeze({
    scenario: "quarantine_claim_and_gate_serialization",
    blockedSessions: "number",
    blockingObservations: "number",
    quarantineExecutions: "number",
    replayedResults: "number",
    conflictingReplaysRejected: "number",
    closedLegacyRows: "number",
    recipientFences: "number",
    claimResults: "number",
    gateOutcome: "deferred",
    fixedFenceSeconds: "number",
    concurrentCreationCommitted: "number",
    concurrentSettlementsRejected: "number",
    concurrentRevocationsCommitted: "number",
    concurrentRetentionSkippedLockedRows: "number",
  }),
  exact_recipient_fence_boundary: Object.freeze({
    scenario: "exact_recipient_fence_boundary",
    fixedFenceSeconds: "number",
    activeOneMicrosecondBefore: "boolean",
    expiredAtBoundary: "boolean",
  }),
  reader_first_exclusive_lock_conflict: Object.freeze({
    scenario: "reader_first_exclusive_lock_conflict",
    priorTableLocks: "number",
    lockConflicts: "number",
    atomicFailures: "number",
    cleanRetries: "number",
    quarantineExecutions: "number",
    deadlocks: "number",
  }),
  settlement_first_exclusive_lock_conflict: Object.freeze({
    scenario: "settlement_first_exclusive_lock_conflict",
    blockedSessions: "number",
    blockingObservations: "number",
    priorTableLocks: "number",
    lockConflicts: "number",
    atomicFailures: "number",
    cleanRetries: "number",
    settlementOutcome: "ambiguous",
    quarantineExecutions: "number",
    deadlocks: "number",
  }),
  revocation_first_exclusive_lock_conflict: Object.freeze({
    scenario: "revocation_first_exclusive_lock_conflict",
    blockedSessions: "number",
    blockingObservations: "number",
    priorTableLocks: "number",
    lockConflicts: "number",
    atomicFailures: "number",
    cleanRetries: "number",
    revocationOutcome: "committed",
    deadlocks: "number",
    quarantineExecutions: "number",
  }),
  lifecycle_first_exclusive_lock_conflict: Object.freeze({
    scenario: "lifecycle_first_exclusive_lock_conflict",
    blockedSessions: "number",
    blockingObservations: "number",
    priorTableLocks: "number",
    lockConflicts: "number",
    atomicFailures: "number",
    cleanRetries: "number",
    lifecycleOutcome: "archived",
    quarantineExecutions: "number",
    deadlocks: "number",
  }),
})

function assertSanitizedFf042Evidence(scenarios) {
  assert.equal(
    scenarios.length,
    Object.keys(FF042_EVIDENCE_SCENARIO_SCHEMA).length,
  )
  const observedScenarioNames = new Set()
  for (const scenario of scenarios) {
    assert.equal(
      typeof scenario === "object" &&
        scenario !== null &&
        !Array.isArray(scenario),
      true,
    )
    const schema = FF042_EVIDENCE_SCENARIO_SCHEMA[scenario.scenario]
    assert.ok(schema)
    assert.equal(observedScenarioNames.has(scenario.scenario), false)
    observedScenarioNames.add(scenario.scenario)
    assert.deepEqual(Object.keys(scenario).sort(), Object.keys(schema).sort())
    for (const [key, expectation] of Object.entries(schema)) {
      if (expectation === "number" || expectation === "boolean") {
        assert.equal(typeof scenario[key], expectation)
      } else {
        assert.equal(scenario[key], expectation)
      }
      if (expectation === "number") {
        assert.equal(
          Number.isSafeInteger(scenario[key]) && scenario[key] >= 0,
          true,
        )
      }
    }
  }
}

const ACTORS = Object.freeze({
  admin: Object.freeze({
    userId: "f0420000-0000-4000-8000-000000000001",
    sessionId: "f0421000-0000-4000-8000-000000000001",
  }),
  owner: Object.freeze({
    userId: "f0420000-0000-4000-8000-000000000002",
    sessionId: "f0421000-0000-4000-8000-000000000002",
  }),
})

function settled(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  )
}

function fulfilled(settlement) {
  assert.equal(settlement.status, "fulfilled")
  return settlement.value
}

function rejected(settlement, code, message) {
  assert.equal(settlement.status, "rejected")
  assert.equal(settlement.reason?.code, code)
  assert.equal(settlement.reason?.message, message)
}

function rejectedCode(settlement, code) {
  assert.equal(settlement.status, "rejected")
  assert.equal(settlement.reason?.code, code)
}

async function finishTransaction(client, query) {
  try {
    const result = await query()
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

async function serviceRoleCall(client, query) {
  await configureServiceRoleTransaction(client)
  return finishTransaction(client, query)
}

async function beginServiceRoleCall(client, query) {
  await configureServiceRoleTransaction(client)
  try {
    return await query()
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

async function authenticatedCall(client, actor, query) {
  await configureAuthenticatedTransaction(client, actor)
  return finishTransaction(client, query)
}

async function queryArm(client, suffix) {
  return client.query(
    `SELECT public.arm_advocate_invitation_legacy_email_proof_quarantine(
       $1::uuid,
       $2::text
     ) AS legacy_claim_fenced_at`,
    [randomUUID(), `ff042-arm-${suffix}`],
  )
}

async function concurrentArm(database) {
  return withPgClients(
    database,
    ["ff042_arm_observer", "ff042_arm_first", "ff042_arm_second"],
    async (observer, first, second) => {
      const firstResult = await beginServiceRoleCall(first, () =>
        queryArm(first, "first"),
      )
      assert.equal(firstResult.rowCount, 1)

      const replaySettlement = settled(
        serviceRoleCall(second, () => queryArm(second, "second")),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [second],
        first,
      )

      await first.query("COMMIT")
      const replay = fulfilled(await replaySettlement)
      assert.equal(replay.rowCount, 1)
      assert.equal(
        replay.rows[0].legacy_claim_fenced_at.toISOString(),
        firstResult.rows[0].legacy_claim_fenced_at.toISOString(),
      )

      const receipt = await observer.query(
        `SELECT
           legacy_claim_fenced_at,
           executed_at,
           legacy_claim_fence_transaction_id IS NOT NULL AS has_arm_xid
         FROM private.advocate_invitation_legacy_email_proof_quarantine`,
      )
      assert.equal(receipt.rowCount, 1)
      assert.equal(receipt.rows[0].executed_at, null)
      assert.equal(receipt.rows[0].has_arm_xid, true)

      const audit = await observer.query(
        `SELECT count(*)::integer AS arm_events
         FROM audit.audit_events
         WHERE schema_name = 'private'
           AND table_name =
             'advocate_invitation_legacy_email_proof_quarantine'
           AND tool =
             'arm_advocate_invitation_legacy_email_proof_quarantine'
           AND operation = 'UPDATE'`,
      )
      assert.equal(audit.rows[0].arm_events, 1)

      return {
        scenario: "post_migration_arm_exact_replay",
        blockedSessions: new Set(
          observations.map((observation) => observation.pid),
        ).size,
        blockingObservations: observations.length,
        armMutations: 1,
        replayedResults: 1,
      }
    },
  )
}

async function onboardCandidate(client, definition) {
  const operationId = randomUUID()
  const capabilityDigest = createHash("sha256")
    .update(`ff042-proof-capability:${definition.slug}`, "utf8")
    .digest()
  const portal = await authenticatedCall(client, ACTORS.admin, () =>
    client.query(
      `SELECT advocate_id::text, advocate_version::integer, created
       FROM public.onboard_creator_share_advocate(
         $1::uuid,
         $2::text,
         $3::text,
         'creator',
         $4::text,
         $5::bytea,
         $6::bytea,
         $7::bytea,
         $8::bytea,
         1::smallint,
         1::smallint,
         1::smallint,
         $9::text,
         $1::text,
         $10::text,
         $11::text,
         NULL,
         NULL
       )`,
      [
        operationId,
        definition.slug,
        definition.displayName,
        definition.ownerEmail,
        capabilityDigest,
        Buffer.alloc(64, definition.ciphertextByte),
        definition.recipientDigest,
        Buffer.alloc(96, definition.secretByte),
        definition.reason,
        `ff042-onboard-${definition.slug}`,
        ACTORS.admin.sessionId,
      ],
    ),
  )
  assert.equal(portal.rowCount, 1)
  assert.equal(portal.rows[0].advocate_version, 1)
  assert.equal(portal.rows[0].created, true)

  const issued = await client.query(
    `SELECT
       receipt.invitation_id::text,
       outbox.id::text AS outbox_id
     FROM audit.creator_share_advocate_onboarding_receipts receipt
     JOIN public.advocate_invitation_email_outbox outbox
       ON outbox.invitation_id = receipt.invitation_id
      AND outbox.advocate_id = receipt.advocate_id
     WHERE receipt.operation_id = $1::uuid`,
    [operationId],
  )
  assert.equal(issued.rowCount, 1)

  return Object.freeze({
    operationId,
    advocateId: portal.rows[0].advocate_id,
    invitationId: issued.rows[0].invitation_id,
    outboxId: issued.rows[0].outbox_id,
    recipientDigest: definition.recipientDigest,
  })
}

async function createLegacyCandidates(database) {
  return withPgClients(
    database,
    ["ff042_fixture_admin", "ff042_fixture_service", "ff042_fixture_raw"],
    async (admin, service, raw) => {
      const legacy = await onboardCandidate(admin, {
        slug: "ff042-proof-quarantine",
        displayName: "FF-042 Proof Quarantine",
        ownerEmail: "ff042-owner@example.test",
        recipientDigest: Buffer.alloc(32, 0x61),
        ciphertextByte: 0x31,
        secretByte: 0x41,
        reason: "Create one attempted legacy proof candidate",
      })
      const settlementLease = "b".repeat(64)
      const settlement = await onboardCandidate(admin, {
        slug: "ff042-proof-settlement",
        displayName: "FF-042 Proof Settlement",
        ownerEmail: "ff042-settlement@example.test",
        recipientDigest: Buffer.alloc(32, 0x62),
        ciphertextByte: 0x32,
        secretByte: 0x42,
        reason: "Create one active legacy proof lease",
      })

      const retainedGate = await serviceRoleCall(service, () =>
        service.query(
          `SELECT acquisition_result, retry_after_seconds
           FROM public.acquire_email_proof_issuance_gate(
             $1::bytea,
             1::smallint,
             1::smallint,
             'advocate-invitation',
             $2::uuid,
             $3::bytea,
             $4::uuid,
             'ff042-retained-gate-setup'
           )`,
          [
            legacy.recipientDigest,
            randomUUID(),
            Buffer.alloc(32, 0x72),
            randomUUID(),
          ],
        ),
      )
      assert.deepEqual(retainedGate.rows[0], {
        acquisition_result: "acquired",
        retry_after_seconds: 0,
      })

      await raw.query("BEGIN")
      try {
        await raw.query("SET LOCAL session_replication_role = replica")
        const failed = await raw.query(
          `UPDATE public.advocate_invitation_email_outbox
           SET
             status = 'failed',
             attempt_count = 1,
             last_error_code = 'internal_error'
           WHERE id = $1::uuid`,
          [legacy.outboxId],
        )
        const processing = await raw.query(
          `UPDATE public.advocate_invitation_email_outbox
           SET
             status = 'processing',
             attempt_count = 1,
             locked_at = clock_timestamp(),
             locked_by = 'ff042-legacy-proof-worker',
             locked_lease_token_digest = extensions.digest($2::text, 'sha256')
           WHERE id = $1::uuid`,
          [settlement.outboxId, settlementLease],
        )
        const expiredGate = await raw.query(
          `WITH anchor AS (
             SELECT clock_timestamp() - interval '2 minutes' AS acquired_at
           )
           UPDATE private.email_proof_issuance_gates gate
           SET
             reservation_acquired_at = anchor.acquired_at,
             reservation_expires_at =
               anchor.acquired_at + interval '30 seconds',
             updated_at = anchor.acquired_at + interval '30 seconds'
           FROM anchor
           WHERE gate.recipient_digest = $1::bytea`,
          [legacy.recipientDigest],
        )
        assert.equal(failed.rowCount, 1)
        assert.equal(processing.rowCount, 1)
        assert.equal(expiredGate.rowCount, 1)
        await raw.query("SET LOCAL session_replication_role = origin")
        await raw.query("COMMIT")
      } catch (error) {
        await raw.query("ROLLBACK").catch(() => undefined)
        throw error
      }

      return Object.freeze({
        legacy,
        settlement: Object.freeze({
          ...settlement,
          leaseToken: settlementLease,
        }),
      })
    },
  )
}

async function backdateCommittedArm(database) {
  return withPgClients(database, ["ff042_arm_backdate"], async (client) => {
    await client.query("BEGIN")
    try {
      await client.query("SET LOCAL session_replication_role = replica")
      const result = await client.query(
        `UPDATE private.advocate_invitation_legacy_email_proof_quarantine
         SET legacy_claim_fenced_at = clock_timestamp() - interval '71 seconds'
         WHERE quarantine_identity =
           'advocate_invitation_legacy_email_proof_v1'
         RETURNING legacy_claim_fence_transaction_id IS NOT NULL AS has_arm_xid`,
      )
      assert.equal(result.rowCount, 1)
      assert.equal(result.rows[0].has_arm_xid, true)
      await client.query("SET LOCAL session_replication_role = origin")
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    }
  })
}

async function assertEarlyQuarantineRejected(database) {
  return withPgClients(database, ["ff042_early_quarantine"], async (client) => {
    const result = await settled(
      serviceRoleCall(client, () => queryQuarantine(client, "early")),
    )
    rejected(
      result,
      "55000",
      "Legacy advocate invitation worker quiescence is not complete",
    )
    return {
      scenario: "committed_arm_early_quarantine_rejection",
      rejectedBeforeDrainSeconds: 70,
      outcome: "drain_incomplete",
    }
  })
}

async function queryQuarantine(client, suffix, verifiedExpirySeconds = 1) {
  return client.query(
    `SELECT
       candidate_outbox_count,
       unique_recipient_count,
       quarantined_outbox_count,
       created_gate_count,
       preserved_gate_count,
       fence_expires_at,
       executed_at
     FROM public.quarantine_legacy_advocate_invitation_proofs(
       $3::smallint,
       $1::uuid,
       $2::text
     )`,
    [randomUUID(), `ff042-quarantine-${suffix}`, verifiedExpirySeconds],
  )
}

async function queryClaim(client) {
  return client.query(
    `SELECT outbox_id
     FROM public.claim_advocate_invitation_email_jobs(
       'ff042-shared-issuer-worker',
       1::smallint,
       10,
       'ff042-claim-after-quarantine',
       'ff042-claim-after-quarantine-trace'
     )`,
  )
}

async function queryAcquire(client, recipientDigest) {
  return client.query(
    `SELECT acquisition_result, retry_after_seconds
     FROM public.acquire_email_proof_issuance_gate(
       $1::bytea,
       1::smallint,
       1::smallint,
       'advocate-invitation',
       $2::uuid,
       $3::bytea,
       $4::uuid,
       'ff042-acquire-after-quarantine'
     )`,
    [recipientDigest, randomUUID(), Buffer.alloc(32, 0x71), randomUUID()],
  )
}

async function querySettlement(
  client,
  candidate,
  disposition = "deferred",
  retryAfterSeconds = 0,
) {
  return client.query(
    `SELECT retryable, attempt_refunded, available_at, settled_at
     FROM public.settle_advocate_invitation_email_proof_issuance(
       $1::uuid,
       $2::text,
       $3::text,
       $4::integer,
       $5::uuid,
       'ff042-settlement-during-quarantine'
     )`,
    [
      candidate.outboxId,
      candidate.leaseToken,
      disposition,
      retryAfterSeconds,
      randomUUID(),
    ],
  )
}

async function queryRevocation(client, candidate) {
  const operationId = randomUUID()
  return client.query(
    `SELECT advocate_version::integer, revocation_status, created
     FROM public.revoke_advocate_initial_owner_invitation(
       $1::uuid,
       $2::uuid,
       1::bigint,
       'Revoke a quarantined initial owner invitation',
       $1::text,
       'ff042-revocation-during-quarantine',
       $3::text,
       NULL,
       NULL
     )`,
    [operationId, candidate.advocateId, ACTORS.admin.sessionId],
  )
}

async function queryLifecycleArchive(client, candidate) {
  const operationId = randomUUID()
  return client.query(
    `SELECT
       advocate_version::integer,
       relationship_status::text,
       publication_status::text,
       domain_cleanup_requested
     FROM public.apply_creator_share_advocate_lifecycle_action(
       $1::uuid,
       1::bigint,
       'archive'::public.creator_share_advocate_lifecycle_action,
       'Archive an ownerless portal during the quarantine lock test',
       $2::uuid,
       'ff042-lifecycle-during-quarantine',
       NULL,
       NULL
     )`,
    [candidate.advocateId, operationId],
  )
}

async function queryRetention(client) {
  return client.query(
    `SELECT public.purge_expired_email_proof_issuance_gates(100) AS deleted`,
  )
}

async function prepareContentionDatabase(workspace, databasePrefix) {
  const database = await createTransientLocalSupabaseDatabase({
    workspace,
    databasePrefix,
  })
  try {
    await database.executeSupabaseAdminSql(await readFile(FIXTURE_PATH, "utf8"))
    await withPgClients(database, [`${databasePrefix}_arm`], async (client) => {
      const result = await serviceRoleCall(client, () =>
        queryArm(client, databasePrefix),
      )
      assert.equal(result.rowCount, 1)
    })
    await backdateCommittedArm(database)
    const candidates = await createLegacyCandidates(database)
    return Object.freeze({ database, candidates })
  } catch (error) {
    await database.dispose().catch(() => undefined)
    throw error
  }
}

async function createPendingCandidate(database, key, recipientByte) {
  return withPgClients(database, [`ff042_${key}_creator`], async (client) =>
    onboardCandidate(client, {
      slug: `ff042-${key}`,
      displayName: `FF-042 ${key}`,
      ownerEmail: `ff042-${key}@example.test`,
      recipientDigest: Buffer.alloc(32, recipientByte),
      ciphertextByte: recipientByte,
      secretByte: recipientByte + 16,
      reason: `Create the ${key} contention target`,
    }),
  )
}

async function assertGrantedInvitationTableLocks(observer, client, mode) {
  const result = await observer.query(
    `SELECT count(DISTINCT lock.relation)::integer AS relation_count
     FROM pg_catalog.pg_locks lock
     WHERE lock.pid = $1::integer
       AND lock.granted
       AND lock.mode = $2::text
       AND lock.relation IN (
         'public.advocate_invitations'::regclass,
         'public.advocate_invitation_email_outbox'::regclass
       )`,
    [client.processID, mode],
  )
  assert.equal(result.rows[0].relation_count, 2)
  return 2
}

async function assertQuarantineFailureWasAtomic(observer) {
  const result = await observer.query(
    `SELECT
       (SELECT count(*)::integer
        FROM private.advocate_invitation_legacy_email_proof_quarantine
        WHERE executed_at IS NULL) AS unexecuted_receipts,
       (SELECT count(*)::integer
        FROM public.advocate_invitation_email_outbox
        WHERE legacy_email_proof_quarantined_at IS NOT NULL) AS markers,
       (SELECT count(*)::integer
        FROM private.email_proof_issuance_gates
        WHERE legacy_proof_quarantine_expires_at IS NOT NULL) AS fences`,
  )
  assert.deepEqual(result.rows[0], {
    unexecuted_receipts: 1,
    markers: 0,
    fences: 0,
  })
}

async function assertBusyQuarantine(quarantine, observer, suffix) {
  const result = await settled(
    serviceRoleCall(quarantine, () => queryQuarantine(quarantine, suffix)),
  )
  rejectedCode(result, "55P03")
  await assertQuarantineFailureWasAtomic(observer)
}

async function assertCleanQuarantineRetry(quarantine, suffix) {
  const result = normalizeQuarantineResult(
    await serviceRoleCall(quarantine, () =>
      queryQuarantine(quarantine, `${suffix}-retry`),
    ),
  )
  assert.equal(result.candidateOutboxCount, 2)
  assert.equal(result.uniqueRecipientCount, 2)
  assert.equal(result.quarantinedOutboxCount, 2)
  return result
}

async function readerFirstQuarantine(database) {
  return withPgClients(
    database,
    [
      "ff042_reader_first_observer",
      "ff042_reader_first_reader",
      "ff042_reader_first_quarantine",
    ],
    async (observer, reader, quarantine) => {
      await reader.query("BEGIN")
      await reader.query(
        `SELECT
           (SELECT count(*) FROM public.advocate_invitations),
           (SELECT count(*) FROM public.advocate_invitation_email_outbox)`,
      )
      const readerLocks = await assertGrantedInvitationTableLocks(
        observer,
        reader,
        "AccessShareLock",
      )

      await assertBusyQuarantine(quarantine, observer, "reader-first")
      await reader.query("COMMIT")
      await assertCleanQuarantineRetry(quarantine, "reader-first")

      return {
        scenario: "reader_first_exclusive_lock_conflict",
        priorTableLocks: readerLocks,
        lockConflicts: 1,
        atomicFailures: 1,
        cleanRetries: 1,
        quarantineExecutions: 1,
        deadlocks: 0,
      }
    },
  )
}

async function settlementFirstQuarantine(database, candidate) {
  return withPgClients(
    database,
    [
      "ff042_settlement_first_observer",
      "ff042_settlement_first_blocker",
      "ff042_settlement_first_writer",
      "ff042_settlement_first_quarantine",
    ],
    async (observer, blocker, writer, quarantine) => {
      await blocker.query("BEGIN")
      await blocker.query(
        `LOCK TABLE audit.audit_events IN SHARE ROW EXCLUSIVE MODE`,
      )

      const writerSettlement = settled(
        serviceRoleCall(writer, () =>
          querySettlement(writer, candidate, "ambiguous", 3900),
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [writer],
        blocker,
      )
      const writerLocks = await assertGrantedInvitationTableLocks(
        observer,
        writer,
        "RowShareLock",
      )

      await assertBusyQuarantine(quarantine, observer, "settlement-first")
      await blocker.query("COMMIT")
      const writerResult = fulfilled(await writerSettlement)
      assert.equal(writerResult.rowCount, 1)
      assert.deepEqual(
        {
          retryable: writerResult.rows[0].retryable,
          attemptRefunded: writerResult.rows[0].attempt_refunded,
        },
        { retryable: true, attemptRefunded: false },
      )
      await assertCleanQuarantineRetry(quarantine, "settlement-first")

      return {
        scenario: "settlement_first_exclusive_lock_conflict",
        blockedSessions: new Set(
          observations.map((observation) => observation.pid),
        ).size,
        blockingObservations: observations.length,
        priorTableLocks: writerLocks,
        lockConflicts: 1,
        atomicFailures: 1,
        cleanRetries: 1,
        settlementOutcome: "ambiguous",
        quarantineExecutions: 1,
        deadlocks: 0,
      }
    },
  )
}

async function revocationFirstQuarantine(database, candidate) {
  return withPgClients(
    database,
    [
      "ff042_revocation_first_observer",
      "ff042_revocation_first_blocker",
      "ff042_revocation_first_writer",
      "ff042_revocation_first_quarantine",
    ],
    async (observer, blocker, writer, quarantine) => {
      await blocker.query("BEGIN")
      await blocker.query(
        `LOCK TABLE audit.audit_events IN SHARE ROW EXCLUSIVE MODE`,
      )

      const writerSettlement = settled(
        authenticatedCall(writer, ACTORS.admin, () =>
          queryRevocation(writer, candidate),
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [writer],
        blocker,
      )
      const writerLocks = await assertGrantedInvitationTableLocks(
        observer,
        writer,
        "RowShareLock",
      )

      await assertBusyQuarantine(quarantine, observer, "revocation-first")
      await blocker.query("COMMIT")
      const revocation = fulfilled(await writerSettlement)
      assert.equal(revocation.rowCount, 1)
      assert.equal(
        revocation.rows[0].revocation_status,
        "initial_owner_invitation_revoked",
      )
      await assertCleanQuarantineRetry(quarantine, "revocation-first")

      return {
        scenario: "revocation_first_exclusive_lock_conflict",
        blockedSessions: new Set(
          observations.map((observation) => observation.pid),
        ).size,
        blockingObservations: observations.length,
        priorTableLocks: writerLocks,
        lockConflicts: 1,
        atomicFailures: 1,
        cleanRetries: 1,
        revocationOutcome: "committed",
        quarantineExecutions: 1,
        deadlocks: 0,
      }
    },
  )
}

async function lifecycleFirstQuarantine(database, candidate) {
  return withPgClients(
    database,
    [
      "ff042_lifecycle_first_observer",
      "ff042_lifecycle_first_blocker",
      "ff042_lifecycle_first_writer",
      "ff042_lifecycle_first_quarantine",
    ],
    async (observer, blocker, writer, quarantine) => {
      await blocker.query("BEGIN")
      await blocker.query(
        `LOCK TABLE audit.audit_events IN SHARE ROW EXCLUSIVE MODE`,
      )

      const writerSettlement = settled(
        authenticatedCall(writer, ACTORS.admin, () =>
          queryLifecycleArchive(writer, candidate),
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [writer],
        blocker,
      )
      const writerLocks = await assertGrantedInvitationTableLocks(
        observer,
        writer,
        "RowShareLock",
      )

      await assertBusyQuarantine(quarantine, observer, "lifecycle-first")
      await blocker.query("COMMIT")
      const lifecycle = fulfilled(await writerSettlement)
      assert.equal(lifecycle.rowCount, 1)
      assert.equal(lifecycle.rows[0].relationship_status, "archived")
      await assertCleanQuarantineRetry(quarantine, "lifecycle-first")

      return {
        scenario: "lifecycle_first_exclusive_lock_conflict",
        blockedSessions: new Set(
          observations.map((observation) => observation.pid),
        ).size,
        blockingObservations: observations.length,
        priorTableLocks: writerLocks,
        lockConflicts: 1,
        atomicFailures: 1,
        cleanRetries: 1,
        lifecycleOutcome: "archived",
        quarantineExecutions: 1,
        deadlocks: 0,
      }
    },
  )
}

function normalizeQuarantineResult(result) {
  assert.equal(result.rowCount, 1)
  const row = result.rows[0]
  return Object.freeze({
    candidateOutboxCount: row.candidate_outbox_count,
    uniqueRecipientCount: row.unique_recipient_count,
    quarantinedOutboxCount: row.quarantined_outbox_count,
    createdGateCount: row.created_gate_count,
    preservedGateCount: row.preserved_gate_count,
    fenceExpiresAt: row.fence_expires_at.toISOString(),
    executedAt: row.executed_at.toISOString(),
  })
}

async function concurrentQuarantine(database, candidates) {
  return withPgClients(
    database,
    [
      "ff042_quarantine_observer",
      "ff042_quarantine_first",
      "ff042_quarantine_replay",
      "ff042_quarantine_claim",
      "ff042_quarantine_acquire",
      "ff042_quarantine_create",
      "ff042_quarantine_settlement",
      "ff042_quarantine_revocation",
      "ff042_quarantine_retention",
    ],
    async (
      observer,
      first,
      replay,
      claim,
      acquire,
      create,
      settlement,
      revoke,
      retention,
    ) => {
      const firstResult = await beginServiceRoleCall(first, () =>
        queryQuarantine(first, "first"),
      )
      const original = normalizeQuarantineResult(firstResult)
      assert.deepEqual(
        {
          candidateOutboxCount: original.candidateOutboxCount,
          uniqueRecipientCount: original.uniqueRecipientCount,
          quarantinedOutboxCount: original.quarantinedOutboxCount,
          createdGateCount: original.createdGateCount,
          preservedGateCount: original.preservedGateCount,
        },
        {
          candidateOutboxCount: 2,
          uniqueRecipientCount: 2,
          quarantinedOutboxCount: 2,
          createdGateCount: 1,
          preservedGateCount: 1,
        },
      )
      assert.equal(
        new Date(original.fenceExpiresAt).getTime() -
          new Date(original.executedAt).getTime(),
        3_900_000,
      )

      const replaySettlement = settled(
        serviceRoleCall(replay, () => queryQuarantine(replay, "replay")),
      )
      const claimSettlement = settled(
        serviceRoleCall(claim, () => queryClaim(claim)),
      )
      const acquireSettlement = settled(
        serviceRoleCall(acquire, () =>
          queryAcquire(acquire, candidates.settlement.recipientDigest),
        ),
      )
      const creationSettlement = settled(
        onboardCandidate(create, {
          slug: "ff042-concurrent-creation",
          displayName: "FF-042 Concurrent Creation",
          ownerEmail: "ff042-concurrent@example.test",
          recipientDigest: Buffer.alloc(32, 0x63),
          ciphertextByte: 0x33,
          secretByte: 0x43,
          reason: "Create an invitation while quarantine holds its table fence",
        }),
      )
      const proofSettlement = settled(
        serviceRoleCall(settlement, () =>
          querySettlement(settlement, candidates.settlement),
        ),
      )
      const revocationSettlement = settled(
        authenticatedCall(revoke, ACTORS.admin, () =>
          queryRevocation(revoke, candidates.legacy),
        ),
      )
      const retentionResult = await serviceRoleCall(retention, () =>
        queryRetention(retention),
      )
      assert.equal(retentionResult.rowCount, 1)
      assert.equal(retentionResult.rows[0].deleted, 0)

      const observations = await waitForClientsBlockedBy(
        observer,
        [replay, claim, acquire, create, settlement, revoke],
        first,
      )
      await first.query("COMMIT")

      const replayResult = normalizeQuarantineResult(
        fulfilled(await replaySettlement),
      )
      assert.deepEqual(replayResult, original)

      const conflict = await settled(
        serviceRoleCall(replay, () => queryQuarantine(replay, "conflict", 2)),
      )
      rejected(
        conflict,
        "55000",
        "Legacy advocate invitation email proof quarantine replay conflicts",
      )

      const claimResult = fulfilled(await claimSettlement)
      assert.equal(claimResult.rowCount, 0)

      const acquireResult = fulfilled(await acquireSettlement)
      assert.equal(acquireResult.rowCount, 1)
      assert.equal(acquireResult.rows[0].acquisition_result, "deferred")
      assert.equal(acquireResult.rows[0].retry_after_seconds >= 3_890, true)
      assert.equal(acquireResult.rows[0].retry_after_seconds <= 3_900, true)

      const createdPortal = fulfilled(await creationSettlement)
      assert.equal(createdPortal.advocateId.length, 36)

      rejected(
        await proofSettlement,
        "55P03",
        "Invitation email proof settlement does not match the active lease",
      )

      const revocation = fulfilled(await revocationSettlement)
      assert.equal(revocation.rowCount, 1)
      assert.deepEqual(revocation.rows[0], {
        advocate_version: 2,
        revocation_status: "initial_owner_invitation_revoked",
        created: true,
      })

      const durable = await observer.query(
        `SELECT
           (SELECT count(*)::integer
            FROM private.email_proof_issuance_gates
            WHERE recipient_digest IN ($1::bytea, $2::bytea)
              AND legacy_proof_quarantine_expires_at =
                (SELECT fence_expires_at
                 FROM private.advocate_invitation_legacy_email_proof_quarantine))
             AS gate_count,
           (SELECT count(*)::integer
            FROM public.advocate_invitation_email_outbox
            WHERE id IN ($3::uuid, $4::uuid)
              AND legacy_email_proof_quarantined_at IS NOT NULL) AS marker_count,
           (SELECT count(*)::integer
            FROM public.advocate_invitation_email_outbox
            WHERE id = $3::uuid
              AND status = 'cancelled'
              AND contact_redacted_at IS NOT NULL) AS revoked_count,
           (SELECT count(*)::integer
            FROM public.advocate_invitation_email_outbox
            WHERE id = $4::uuid
              AND status = 'processing'
              AND contact_redacted_at IS NULL) AS settlement_rejected_count,
           (SELECT count(*)::integer
            FROM public.advocate_invitation_email_outbox outbox
            WHERE outbox.advocate_id = $5::uuid
              AND outbox.attempt_count = 0
              AND outbox.legacy_email_proof_quarantined_at IS NULL)
             AS post_cutover_created_count,
           (SELECT count(*)::integer
            FROM private.advocate_invitation_legacy_email_proof_quarantine
            WHERE executed_at IS NOT NULL
              AND fence_expires_at = executed_at + interval '3900 seconds')
             AS receipt_count`,
        [
          candidates.legacy.recipientDigest,
          candidates.settlement.recipientDigest,
          candidates.legacy.outboxId,
          candidates.settlement.outboxId,
          createdPortal.advocateId,
        ],
      )
      assert.deepEqual(durable.rows[0], {
        gate_count: 2,
        marker_count: 2,
        revoked_count: 1,
        settlement_rejected_count: 1,
        post_cutover_created_count: 1,
        receipt_count: 1,
      })

      return {
        scenario: "quarantine_claim_and_gate_serialization",
        blockedSessions: new Set(
          observations.map((observation) => observation.pid),
        ).size,
        blockingObservations: observations.length,
        quarantineExecutions: 1,
        replayedResults: 1,
        conflictingReplaysRejected: 1,
        closedLegacyRows: 2,
        recipientFences: 2,
        claimResults: 0,
        gateOutcome: "deferred",
        fixedFenceSeconds: 3900,
        concurrentCreationCommitted: 1,
        concurrentSettlementsRejected: 1,
        concurrentRevocationsCommitted: 1,
        concurrentRetentionSkippedLockedRows: 1,
      }
    },
  )
}

async function assertExactFenceBoundary(database) {
  return withPgClients(
    database,
    ["ff042_boundary_assertion"],
    async (client) => {
      const result = await client.query(
        `SELECT
         private.legacy_advocate_invitation_proof_may_be_live(
           '2026-01-01 00:00:00+00'::timestamptz,
           '2026-01-01 01:05:00+00'::timestamptz
         ) AS live_at_boundary,
         private.legacy_advocate_invitation_proof_may_be_live(
           '2026-01-01 00:00:00+00'::timestamptz,
           '2026-01-01 01:04:59.999999+00'::timestamptz
         ) AS live_before_boundary,
         (SELECT fence_expires_at = executed_at + interval '3900 seconds'
          FROM private.advocate_invitation_legacy_email_proof_quarantine)
           AS receipt_boundary_exact`,
      )
      assert.deepEqual(result.rows[0], {
        live_at_boundary: false,
        live_before_boundary: true,
        receipt_boundary_exact: true,
      })
      return {
        scenario: "exact_recipient_fence_boundary",
        fixedFenceSeconds: 3900,
        activeOneMicrosecondBefore: true,
        expiredAtBoundary: true,
      }
    },
  )
}

async function assertFunctionCutover(database) {
  return withPgClients(
    database,
    ["ff042_cutover_assertion"],
    async (client) => {
      const result = await client.query(
        `SELECT
         to_regprocedure(
           'public.claim_advocate_invitation_email_jobs(text,integer,text,text)'
         ) IS NULL AS legacy_removed,
         to_regprocedure(
           'public.claim_advocate_invitation_email_jobs(text,smallint,integer,text,text)'
         ) IS NOT NULL AS shared_present`,
      )
      assert.deepEqual(result.rows[0], {
        legacy_removed: true,
        shared_present: true,
      })
      return {
        scenario: "claim_signature_cutover",
        legacyClaimFunctions: 0,
        sharedIssuerClaimFunctions: 1,
      }
    },
  )
}

async function main() {
  let database
  const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({
    gate: "FF-042",
    getDatabase: () => database,
  })
  try {
    await clearConcurrencyGateEvidence(EVIDENCE_OUTPUT_PATH)
    database = await createTransientLocalSupabaseDatabase({
      workspace: WORKSPACE,
      databasePrefix: "ff042quarantine",
    })
    const provenance = await loadConcurrencyGateProvenance(database, {
      workspace: WORKSPACE,
    })
    await database.executeSupabaseAdminSql(await readFile(FIXTURE_PATH, "utf8"))

    const scenarios = []
    scenarios.push(await assertFunctionCutover(database))
    process.stdout.write("ok FF-042 claim signature cutover\n")
    scenarios.push(await concurrentArm(database))
    process.stdout.write("ok FF-042 committed arm exact replay\n")

    scenarios.push(await assertEarlyQuarantineRejected(database))
    process.stdout.write("ok FF-042 early quarantine drain rejection\n")

    const candidates = await createLegacyCandidates(database)
    await backdateCommittedArm(database)
    scenarios.push(await concurrentQuarantine(database, candidates))
    process.stdout.write("ok FF-042 quarantine contention and claim closure\n")
    scenarios.push(await assertExactFenceBoundary(database))
    process.stdout.write("ok FF-042 exact recipient fence boundary\n")

    await database.dispose()
    database = undefined

    const readerFirst = await prepareContentionDatabase(
      WORKSPACE,
      "ff042reader",
    )
    database = readerFirst.database
    scenarios.push(await readerFirstQuarantine(database))
    process.stdout.write("ok FF-042 reader-first exclusive busy and retry\n")
    await database.dispose()
    database = undefined

    const settlementFirst = await prepareContentionDatabase(
      WORKSPACE,
      "ff042settlefirst",
    )
    database = settlementFirst.database
    scenarios.push(
      await settlementFirstQuarantine(
        database,
        settlementFirst.candidates.settlement,
      ),
    )
    process.stdout.write(
      "ok FF-042 settlement-first exclusive busy and retry\n",
    )
    await database.dispose()
    database = undefined

    const revocationFirst = await prepareContentionDatabase(
      WORKSPACE,
      "ff042revokefirst",
    )
    database = revocationFirst.database
    const revocationTarget = await createPendingCandidate(
      database,
      "revocation-target",
      0x64,
    )
    scenarios.push(await revocationFirstQuarantine(database, revocationTarget))
    process.stdout.write(
      "ok FF-042 revocation-first exclusive busy and retry\n",
    )
    await database.dispose()
    database = undefined

    const lifecycleFirst = await prepareContentionDatabase(
      WORKSPACE,
      "ff042lifecycle",
    )
    database = lifecycleFirst.database
    const lifecycleTarget = await createPendingCandidate(
      database,
      "lifecycle-target",
      0x65,
    )
    scenarios.push(await lifecycleFirstQuarantine(database, lifecycleTarget))
    process.stdout.write("ok FF-042 lifecycle-first exclusive busy and retry\n")

    assert.equal(scenarios.length, 9)
    assert.equal(
      scenarios.reduce(
        (count, scenario) => count + (scenario.blockedSessions ?? 0),
        0,
      ) >= 10,
      true,
    )
    assertSanitizedFf042Evidence(scenarios)

    await database.dispose()
    database = undefined
    await writeConcurrencyGateEvidence({
      gate: "FF-042",
      outputPath: EVIDENCE_OUTPUT_PATH,
      provenance,
      scenarios,
    })
  } finally {
    removeTerminationCleanup()
    if (database) await database.dispose()
  }
}

await main()
