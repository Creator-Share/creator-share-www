import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"

import {
  clearConcurrencyGateEvidence,
  installConcurrencyGateTerminationCleanup,
  loadConcurrencyGateProvenance,
  withPgClients,
  writeConcurrencyGateEvidence,
} from "./support/concurrency-gate.mjs"
import {
  configureServiceRoleTransaction,
  createTransientLocalSupabaseDatabase,
} from "./support/local-supabase.mjs"
import { waitForClientsBlockedBy } from "./support/postgres-barrier.mjs"

const WORKSPACE = resolve(process.cwd())
const EVIDENCE_OUTPUT_PATH = process.env
  .EMAIL_PROOF_ISSUANCE_CONCURRENCY_EVIDENCE_PATH
  ? resolve(process.env.EMAIL_PROOF_ISSUANCE_CONCURRENCY_EVIDENCE_PATH)
  : null
const ISSUANCE_FLOW = "advocate-invitation"

function recipient(byte) {
  return Buffer.alloc(32, byte)
}

function lease(byte) {
  return Buffer.alloc(32, byte)
}

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

async function queryAcquire(
  client,
  recipientDigest,
  operationId,
  leaseToken,
  issuanceFlow = ISSUANCE_FLOW,
) {
  return client.query(
    `SELECT acquisition_result, retry_after_seconds
     FROM public.acquire_email_proof_issuance_gate(
       $1::bytea,
       1::smallint,
       1::smallint,
       $2::text,
       $3::uuid,
       $4::bytea,
       $5::uuid,
       $6::text
     )`,
    [
      recipientDigest,
      issuanceFlow,
      operationId,
      leaseToken,
      randomUUID(),
      "email-proof-concurrency-acquire",
    ],
  )
}

async function acquire(
  client,
  recipientDigest,
  operationId,
  leaseToken,
  issuanceFlow = ISSUANCE_FLOW,
) {
  const decision = await acquireDecision(
    client,
    recipientDigest,
    operationId,
    leaseToken,
    issuanceFlow,
  )
  return decision.acquisitionResult
}

async function acquireDecision(
  client,
  recipientDigest,
  operationId,
  leaseToken,
  issuanceFlow = ISSUANCE_FLOW,
) {
  const result = await serviceRoleCall(client, () =>
    queryAcquire(
      client,
      recipientDigest,
      operationId,
      leaseToken,
      issuanceFlow,
    ),
  )
  assert.equal(result.rowCount, 1)
  assert.deepEqual(Object.keys(result.rows[0]), [
    "acquisition_result",
    "retry_after_seconds",
  ])
  assert.equal(
    ["acquired", "coalesced", "deferred"].includes(
      result.rows[0].acquisition_result,
    ),
    true,
  )
  assert.equal(Number.isInteger(result.rows[0].retry_after_seconds), true)
  assert.equal(result.rows[0].retry_after_seconds >= 0, true)
  assert.equal(result.rows[0].retry_after_seconds <= 3_900, true)
  if (result.rows[0].acquisition_result === "acquired") {
    assert.equal(result.rows[0].retry_after_seconds, 0)
  }
  return Object.freeze({
    acquisitionResult: result.rows[0].acquisition_result,
    retryAfterSeconds: result.rows[0].retry_after_seconds,
  })
}

async function beginIssuance(client, recipientDigest, operationId, leaseToken) {
  return serviceRoleCall(client, () =>
    client.query(
      `SELECT public.begin_email_proof_issuance(
         $1::bytea,
         1::smallint,
         1::smallint,
         $2::text,
         $3::uuid,
         $4::bytea,
         $5::uuid,
         $6::text
       )`,
      [
        recipientDigest,
        ISSUANCE_FLOW,
        operationId,
        leaseToken,
        randomUUID(),
        "email-proof-concurrency-begin",
      ],
    ),
  )
}

async function finishIssuance(
  client,
  recipientDigest,
  operationId,
  leaseToken,
  disposition,
) {
  return serviceRoleCall(client, () =>
    client.query(
      `SELECT public.finish_email_proof_issuance(
         $1::bytea,
         1::smallint,
         1::smallint,
         $2::text,
         $3::uuid,
         $4::bytea,
         $5::text,
         $6::uuid,
         $7::text
       )`,
      [
        recipientDigest,
        ISSUANCE_FLOW,
        operationId,
        leaseToken,
        disposition,
        randomUUID(),
        "email-proof-concurrency-finish",
      ],
    ),
  )
}

async function abandon(client, recipientDigest, operationId, leaseToken) {
  return serviceRoleCall(client, () =>
    client.query(
      `SELECT public.abandon_email_proof_issuance(
         $1::bytea,
         1::smallint,
         1::smallint,
         $2::text,
         $3::uuid,
         $4::bytea,
         $5::uuid,
         $6::text
       )`,
      [
        recipientDigest,
        ISSUANCE_FLOW,
        operationId,
        leaseToken,
        randomUUID(),
        "email-proof-concurrency-abandon",
      ],
    ),
  )
}

async function assertNoOpenTransaction(observer, target) {
  const result = await observer.query(
    `SELECT state, xact_start IS NULL AS transaction_closed
     FROM pg_catalog.pg_stat_activity
     WHERE pid = $1::integer
       AND application_name = $2::text`,
    [target.processID, target.connectionParameters.application_name],
  )
  assert.equal(result.rowCount, 1)
  assert.equal(result.rows[0].state, "idle")
  assert.equal(result.rows[0].transaction_closed, true)
}

async function loadGate(observer, recipientDigest) {
  const result = await observer.query(
    `SELECT
       id::text,
       issuance_flow,
       operation_id::text,
       phase,
       extract(
         epoch FROM reservation_expires_at - reservation_acquired_at
       )::integer AS reservation_seconds,
       extract(
         epoch FROM next_issuance_at - issuance_started_at
       )::integer AS spacing_seconds,
       extract(
         epoch FROM proof_exclusivity_expires_at - issuance_started_at
       )::integer AS proof_seconds,
       finish_disposition
     FROM private.email_proof_issuance_gates
     WHERE recipient_normalization_version = 1
       AND recipient_hmac_key_version = 1
       AND recipient_digest = $1::bytea`,
    [recipientDigest],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function concurrentSameOperation(database) {
  const recipientDigest = recipient(0x11)
  const operationId = randomUUID()
  const firstLease = lease(0xa1)
  const secondLease = lease(0xa2)

  return withPgClients(
    database,
    ["proof_same_observer", "proof_same_first", "proof_same_second"],
    async (observer, first, second) => {
      const firstResult = await beginServiceRoleCall(first, () =>
        queryAcquire(first, recipientDigest, operationId, firstLease),
      )
      assert.equal(firstResult.rows[0].acquisition_result, "acquired")
      assert.equal(firstResult.rows[0].retry_after_seconds, 0)

      const secondSettlement = settled(
        acquireDecision(second, recipientDigest, operationId, secondLease),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [second],
        first,
      )
      await first.query("COMMIT")
      const secondDecision = fulfilled(await secondSettlement)
      assert.equal(secondDecision.acquisitionResult, "coalesced")
      assert.equal(secondDecision.retryAfterSeconds >= 1, true)
      assert.equal(secondDecision.retryAfterSeconds <= 30, true)

      const flowMismatch = await acquireDecision(
        second,
        recipientDigest,
        operationId,
        lease(0xa3),
        "registration",
      )
      assert.equal(flowMismatch.acquisitionResult, "deferred")
      assert.equal(flowMismatch.retryAfterSeconds >= 1, true)
      assert.equal(flowMismatch.retryAfterSeconds <= 30, true)

      const count = await observer.query(
        `SELECT count(*)::integer AS row_count
         FROM private.email_proof_issuance_gates
         WHERE recipient_digest = $1::bytea`,
        [recipientDigest],
      )
      assert.equal(count.rows[0].row_count, 1)
      return {
        scenario: "same_operation_single_flight",
        blockedSessions: new Set(
          observations.map((observation) => observation.pid),
        ).size,
        blockingObservations: observations.length,
        acquired: 1,
        coalesced: 1,
        deferred: 1,
        mismatchedFlowDeferred: true,
        retryAfterSecondsMaximum: 30,
        recipientRows: 1,
      }
    },
  )
}

async function concurrentDifferentOperations(database) {
  const recipientDigest = recipient(0x22)
  const firstOperation = randomUUID()
  const secondOperation = randomUUID()

  return withPgClients(
    database,
    ["proof_diff_observer", "proof_diff_first", "proof_diff_second"],
    async (observer, first, second) => {
      const firstResult = await beginServiceRoleCall(first, () =>
        queryAcquire(first, recipientDigest, firstOperation, lease(0xb1)),
      )
      assert.equal(firstResult.rows[0].acquisition_result, "acquired")
      assert.equal(firstResult.rows[0].retry_after_seconds, 0)

      const secondSettlement = settled(
        acquireDecision(second, recipientDigest, secondOperation, lease(0xb2)),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [second],
        first,
      )
      await first.query("COMMIT")
      const secondDecision = fulfilled(await secondSettlement)
      assert.equal(secondDecision.acquisitionResult, "deferred")
      assert.equal(secondDecision.retryAfterSeconds >= 1, true)
      assert.equal(secondDecision.retryAfterSeconds <= 30, true)

      const gate = await loadGate(observer, recipientDigest)
      assert.equal(gate.operation_id, firstOperation)
      return {
        scenario: "different_operation_deferral",
        blockedSessions: new Set(
          observations.map((observation) => observation.pid),
        ).size,
        blockingObservations: observations.length,
        acquired: 1,
        coalesced: 0,
        deferred: 1,
        retryAfterSecondsMaximum: 30,
        winningOperationPreserved: true,
      }
    },
  )
}

async function crashBeforeBeginReclaim(database) {
  const recipientDigest = recipient(0x33)
  const staleOperation = randomUUID()
  const staleLease = lease(0xc1)
  const replacementLease = lease(0xc2)

  return withPgClients(
    database,
    ["proof_reclaim_observer", "proof_reclaim_worker"],
    async (observer, worker) => {
      assert.equal(
        await acquire(worker, recipientDigest, staleOperation, staleLease),
        "acquired",
      )
      const exactAcquireReplay = await acquireDecision(
        worker,
        recipientDigest,
        staleOperation,
        staleLease,
      )
      assert.equal(exactAcquireReplay.acquisitionResult, "acquired")
      assert.equal(exactAcquireReplay.retryAfterSeconds, 0)
      await observer.query(
        `WITH shifted AS (
           SELECT clock_timestamp() - interval '31 seconds' AS acquired_at
         )
         UPDATE private.email_proof_issuance_gates gate
         SET
           reservation_acquired_at = shifted.acquired_at,
           reservation_expires_at = shifted.acquired_at + interval '30 seconds',
           updated_at = shifted.acquired_at
         FROM shifted
         WHERE gate.recipient_digest = $1::bytea`,
        [recipientDigest],
      )

      const staleBegin = settled(
        beginIssuance(worker, recipientDigest, staleOperation, staleLease),
      )
      rejected(await staleBegin, "55000", "Email proof issuance fence is stale")

      const staleAcquire = settled(
        acquireDecision(worker, recipientDigest, staleOperation, staleLease),
      )
      rejected(
        await staleAcquire,
        "55000",
        "Email proof issuance fence is stale",
      )
      const unchangedGate = await loadGate(observer, recipientDigest)
      assert.equal(unchangedGate.operation_id, staleOperation)
      assert.equal(unchangedGate.phase, "reserved")

      assert.equal(
        await acquire(
          worker,
          recipientDigest,
          staleOperation,
          replacementLease,
        ),
        "acquired",
      )
      const staleOwner = settled(
        beginIssuance(worker, recipientDigest, staleOperation, staleLease),
      )
      rejected(await staleOwner, "55000", "Email proof issuance fence is stale")
      await beginIssuance(
        worker,
        recipientDigest,
        staleOperation,
        replacementLease,
      )
      await assertNoOpenTransaction(observer, worker)

      const gate = await loadGate(observer, recipientDigest)
      assert.equal(gate.operation_id, staleOperation)
      assert.equal(gate.phase, "begun")
      assert.equal(gate.reservation_seconds, 30)
      assert.equal(gate.spacing_seconds, 65)
      assert.equal(gate.proof_seconds, 3_900)
      return {
        scenario: "crash_before_begin_reclaim",
        blockedSessions: 0,
        staleLeaseRejected: true,
        exactAcquireReplaySucceeded: true,
        expiredExactLeaseReclaimRejected: true,
        staleOperationRejected: true,
        replacementAcquired: true,
        providerWorkOutsideTransaction: true,
      }
    },
  )
}

async function crashAfterBeginBlocking(database) {
  const recipientDigest = recipient(0x44)
  const firstOperation = randomUUID()
  const secondOperation = randomUUID()
  const firstLease = lease(0xd1)

  return withPgClients(
    database,
    ["proof_post_begin_observer", "proof_post_begin_worker"],
    async (observer, worker) => {
      assert.equal(
        await acquire(worker, recipientDigest, firstOperation, firstLease),
        "acquired",
      )
      await beginIssuance(worker, recipientDigest, firstOperation, firstLease)
      await assertNoOpenTransaction(observer, worker)

      await observer.query(
        `UPDATE private.email_proof_issuance_gates gate
         SET
           reservation_acquired_at = gate.reservation_acquired_at -
             interval '31 seconds',
           reservation_expires_at = gate.reservation_expires_at -
             interval '31 seconds'
         WHERE gate.recipient_digest = $1::bytea`,
        [recipientDigest],
      )

      const deferredDecision = await acquireDecision(
        worker,
        recipientDigest,
        secondOperation,
        lease(0xd2),
      )
      assert.equal(deferredDecision.acquisitionResult, "deferred")
      assert.equal(deferredDecision.retryAfterSeconds >= 3_899, true)
      assert.equal(deferredDecision.retryAfterSeconds <= 3_900, true)
      const abandonAfterBegin = settled(
        abandon(worker, recipientDigest, firstOperation, firstLease),
      )
      rejected(
        await abandonAfterBegin,
        "55000",
        "Email proof issuance fence is stale",
      )

      const gate = await loadGate(observer, recipientDigest)
      assert.equal(gate.phase, "begun")
      assert.equal(gate.operation_id, firstOperation)
      return {
        scenario: "crash_after_begin_blocking",
        blockedSessions: 0,
        replacementDeferred: true,
        retryAfterSecondsMaximum: 3_900,
        postBeginAbandonRejected: true,
        fullProofFencePreserved: true,
      }
    },
  )
}

async function finishAndAbandonFencing(database) {
  const abandonedRecipient = recipient(0x55)
  const abandonedOperation = randomUUID()
  const abandonedLease = lease(0xe1)
  const finishedRecipient = recipient(0x56)
  const finishedOperation = randomUUID()
  const finishedLease = lease(0xe2)

  return withPgClients(
    database,
    ["proof_fence_observer", "proof_fence_worker"],
    async (observer, worker) => {
      assert.equal(
        await acquire(
          worker,
          abandonedRecipient,
          abandonedOperation,
          abandonedLease,
        ),
        "acquired",
      )
      const wrongAbandon = settled(
        abandon(worker, abandonedRecipient, abandonedOperation, lease(0xef)),
      )
      rejected(
        await wrongAbandon,
        "55000",
        "Email proof issuance fence is stale",
      )
      await abandon(
        worker,
        abandonedRecipient,
        abandonedOperation,
        abandonedLease,
      )
      const absent = await observer.query(
        `SELECT count(*)::integer AS row_count
         FROM private.email_proof_issuance_gates
         WHERE recipient_digest = $1::bytea`,
        [abandonedRecipient],
      )
      assert.equal(absent.rows[0].row_count, 0)

      assert.equal(
        await acquire(
          worker,
          finishedRecipient,
          finishedOperation,
          finishedLease,
        ),
        "acquired",
      )
      await beginIssuance(
        worker,
        finishedRecipient,
        finishedOperation,
        finishedLease,
      )
      const wrongFinish = settled(
        finishIssuance(
          worker,
          finishedRecipient,
          finishedOperation,
          lease(0xee),
          "ambiguous",
        ),
      )
      rejected(
        await wrongFinish,
        "55000",
        "Email proof issuance fence is stale",
      )
      await finishIssuance(
        worker,
        finishedRecipient,
        finishedOperation,
        finishedLease,
        "ambiguous",
      )
      await finishIssuance(
        worker,
        finishedRecipient,
        finishedOperation,
        finishedLease,
        "ambiguous",
      )
      const conflictingFinish = settled(
        finishIssuance(
          worker,
          finishedRecipient,
          finishedOperation,
          finishedLease,
          "issued",
        ),
      )
      rejected(
        await conflictingFinish,
        "55000",
        "Email proof issuance fence is stale",
      )
      const terminalAbandon = settled(
        abandon(worker, finishedRecipient, finishedOperation, finishedLease),
      )
      rejected(
        await terminalAbandon,
        "55000",
        "Email proof issuance fence is stale",
      )

      const gate = await loadGate(observer, finishedRecipient)
      assert.equal(gate.phase, "finished")
      assert.equal(gate.finish_disposition, "ambiguous")
      assert.equal(gate.proof_seconds, 3_900)
      return {
        scenario: "finish_and_abandon_fencing",
        blockedSessions: 0,
        wrongAbandonRejected: true,
        exactPreBeginAbandonSucceeded: true,
        wrongFinishRejected: true,
        exactFinishReplaySucceeded: true,
        conflictingFinishRejected: true,
        terminalAbandonRejected: true,
      }
    },
  )
}

async function crossRecipientIndependence(database) {
  const heldRecipient = recipient(0x66)
  const independentRecipient = recipient(0x67)
  const heldOperation = randomUUID()
  const blockedOperation = randomUUID()
  const independentOperation = randomUUID()

  return withPgClients(
    database,
    [
      "proof_rows_observer",
      "proof_rows_holder",
      "proof_rows_blocked",
      "proof_rows_independent",
    ],
    async (observer, holder, blocked, independent) => {
      const heldResult = await beginServiceRoleCall(holder, () =>
        queryAcquire(holder, heldRecipient, heldOperation, lease(0xf1)),
      )
      assert.equal(heldResult.rows[0].acquisition_result, "acquired")
      assert.equal(heldResult.rows[0].retry_after_seconds, 0)

      const blockedSettlement = settled(
        acquire(blocked, heldRecipient, blockedOperation, lease(0xf2)),
      )
      const firstObservations = await waitForClientsBlockedBy(
        observer,
        [blocked],
        holder,
      )

      let timeout
      const independentPromise = acquire(
        independent,
        independentRecipient,
        independentOperation,
        lease(0xf3),
      )
      const independentSettlement = await Promise.race([
        independentPromise.then((value) => ({ timedOut: false, value })),
        new Promise((resolveTimeout) => {
          timeout = setTimeout(() => resolveTimeout({ timedOut: true }), 2_000)
        }),
      ])
      clearTimeout(timeout)
      if (independentSettlement.timedOut) {
        await holder.query("COMMIT")
        await Promise.allSettled([independentPromise, blockedSettlement])
        throw new Error("cross_recipient_acquisition_serialized")
      }
      assert.equal(independentSettlement.value, "acquired")

      const secondObservations = await waitForClientsBlockedBy(
        observer,
        [blocked],
        holder,
      )
      await holder.query("COMMIT")
      assert.equal(fulfilled(await blockedSettlement), "deferred")

      const blockingObservations = [...firstObservations, ...secondObservations]
      return {
        scenario: "cross_recipient_row_key_independence",
        blockedSessions: new Set(
          blockingObservations.map((observation) => observation.pid),
        ).size,
        blockingObservations: blockingObservations.length,
        heldAcquisitionUncommitted: true,
        sameRecipientBlocked: true,
        differentRecipientAcquiredWhileBlocked: true,
        globalSerializationObserved: false,
      }
    },
  )
}

async function main() {
  let database
  const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({
    gate: "FF-029",
    getDatabase: () => database,
  })
  try {
    await clearConcurrencyGateEvidence(EVIDENCE_OUTPUT_PATH)
    database = await createTransientLocalSupabaseDatabase({
      workspace: WORKSPACE,
      databasePrefix: "ff029proof",
    })
    const provenance = await loadConcurrencyGateProvenance(database, {
      workspace: WORKSPACE,
    })

    const scenarios = []
    scenarios.push(await concurrentSameOperation(database))
    process.stdout.write("ok email proof same operation single flight\n")
    scenarios.push(await concurrentDifferentOperations(database))
    process.stdout.write("ok email proof different operation deferral\n")
    scenarios.push(await crashBeforeBeginReclaim(database))
    process.stdout.write("ok email proof crash-before-begin reclaim\n")
    scenarios.push(await crashAfterBeginBlocking(database))
    process.stdout.write("ok email proof crash-after-begin blocking\n")
    scenarios.push(await finishAndAbandonFencing(database))
    process.stdout.write("ok email proof finish and abandon fencing\n")
    scenarios.push(await crossRecipientIndependence(database))
    process.stdout.write("ok email proof cross-recipient independence\n")

    assert.equal(scenarios.length, 6)
    assert.equal(
      scenarios
        .filter((scenario) => scenario.scenario.includes("operation"))
        .reduce((total, scenario) => total + scenario.acquired, 0),
      2,
    )
    assert.equal(
      scenarios.every((scenario) => scenario.blockedSessions >= 0),
      true,
    )
    assert.equal(
      scenarios.find(
        (scenario) =>
          scenario.scenario === "cross_recipient_row_key_independence",
      )?.globalSerializationObserved,
      false,
    )

    await database.dispose()
    database = undefined
    await writeConcurrencyGateEvidence({
      gate: "FF-029",
      outputPath: EVIDENCE_OUTPUT_PATH,
      provenance,
      synchronization: "server_observed_row_key_blocking",
      scenarios,
    })
    process.stdout.write(
      "shared email proof issuance concurrency gate passed\n",
    )
  } finally {
    try {
      if (database) await database.dispose()
    } finally {
      removeTerminationCleanup()
    }
  }
}

await main()
