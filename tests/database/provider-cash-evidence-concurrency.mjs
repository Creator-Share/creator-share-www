import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { configureServiceRoleTransaction, createTransientLocalSupabaseDatabase } from "./support/local-supabase.mjs"
import { clearConcurrencyGateEvidence, installConcurrencyGateTerminationCleanup, loadConcurrencyGateProvenance, withPgClients, writeConcurrencyGateEvidence } from "./support/concurrency-gate.mjs"
import { waitForClientsBlockedBy } from "./support/postgres-barrier.mjs"

function record(client, original, scenario, contender, options = {}) {
  const event = `evt_cash_${scenario}_${options.otherEvent ? "other" : "event"}`
  return client.query(`SELECT public.record_verified_stripe_cash_movement(
    $1::uuid,'stripe_us',$2,$3,$4::bigint,50,$4::bigint-50,'EUR',0.86,
    $8::timestamptz,$5,$6::bytea,clock_timestamp(),$7) AS id`, [
    original.id, `txn_cash_${scenario}_${options.otherMovement ? "other" : "movement"}`, "dp_cash_concurrency",
    options.otherAmount ? -11001 : -11000, event, createHash("sha256").update(options.otherDigest ? `${event}_changed` : event).digest(),
    `cash-concurrency-${scenario}-${contender}`, original.cashOccurredAt,
  ])
}
const outcome = promise => promise.then(result => ({ id: result.rows[0].id }), error => ({ code: error.code }))
async function state(client, original, scenario) {
  const { rows: [result] } = await client.query(`SELECT
    (SELECT count(*)::integer FROM private.provider_cash_movements WHERE starts_with(provider_movement_id,$1)) AS cash,
    (SELECT count(*)::integer FROM private.provider_cash_evidence WHERE starts_with(source_event_id,$2)) AS observations,
    (SELECT count(*)::integer FROM audit.audit_events WHERE starts_with(request_id,$3)
      AND schema_name='private' AND table_name IN ('provider_cash_movements','provider_cash_evidence')) AS audit,
    (SELECT count(*)::integer FROM public.sponsorship_financial_movements
      WHERE id=$4::uuid OR original_financial_movement_id=$4::uuid) AS principal`, [
    `txn_cash_${scenario}_`, `evt_cash_${scenario}_`, `cash-concurrency-${scenario}-`, original.id,
  ])
  return result
}
const emptyState = { cash: 0, observations: 0, audit: 0, principal: 1 }

async function race(database, original, scenario, secondOptions = {}, rollbackFirst = false) {
  return withPgClients(database, ["cash-first", "cash-second", "cash-observer"], async (first, second, observer) => {
    await configureServiceRoleTransaction(first)
    await configureServiceRoleTransaction(second)
    const initial = await record(first, original, scenario, "first")
    const pending = outcome(record(second, original, scenario, "second", secondOptions))
    const blocked = await waitForClientsBlockedBy(observer, [second], first)
    assert.equal(blocked.length, 1)
    assert.deepEqual(await state(observer, original, scenario), emptyState)
    await first.query(rollbackFirst ? "ROLLBACK" : "COMMIT")
    const result = await pending
    const conflicting = !rollbackFirst && (secondOptions.otherAmount || secondOptions.otherMovement || secondOptions.otherDigest)
    if (conflicting) {
      assert.equal(result.code, "23505")
      await second.query("ROLLBACK")
    } else {
      assert.equal(typeof result.id, "string")
      if (rollbackFirst) assert.notEqual(result.id, initial.rows[0].id)
      else assert.equal(result.id, initial.rows[0].id)
      await second.query("COMMIT")
    }
    const observations = !rollbackFirst && secondOptions.otherEvent ? 2 : 1
    assert.deepEqual(await state(observer, original, scenario), {
      cash: 1, observations, audit: 1 + observations, principal: 1,
    })
    const { rows: [losing] } = await observer.query(`SELECT count(*)::integer AS audit FROM audit.audit_events
      WHERE request_id=$1 AND schema_name='private' AND table_name IN ('provider_cash_movements','provider_cash_evidence')`,
    [`cash-concurrency-${scenario}-${rollbackFirst ? "first" : "second"}`])
    if (conflicting || rollbackFirst) assert.equal(losing.audit, 0)
    return { scenario, blockedSessions: blocked.length, cashMovements: 1, observations,
      partialEvidenceVisible: false, losingAuditResidue: 0, principalMutations: 0 }
  })
}

async function interruption(database, original) {
  const scenario = "interrupted"
  return withPgClients(database, ["cash-writer", "cash-barrier", "cash-observer"], async (writer, barrier, observer) => {
    await observer.query(`CREATE FUNCTION private.test_pause_cash_observation() RETURNS trigger
      LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
        IF NEW.source_event_id='evt_cash_interrupted_event' THEN
          IF NOT EXISTS(SELECT 1 FROM private.provider_cash_movements WHERE id=NEW.cash_movement_id) THEN
            RAISE EXCEPTION 'Cash insertion checkpoint was not reached';
          END IF;
          PERFORM pg_advisory_xact_lock(hashtextextended('provider-cash-observation-test',0));
        END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER test_pause_cash_observation BEFORE INSERT ON private.provider_cash_evidence
        FOR EACH ROW EXECUTE FUNCTION private.test_pause_cash_observation();`)
    await barrier.query("BEGIN")
    await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended('provider-cash-observation-test',0))")
    await configureServiceRoleTransaction(writer)
    const pending = outcome(record(writer, original, scenario, "canceled"))
    const blocked = await waitForClientsBlockedBy(observer, [writer], barrier)
    assert.equal(blocked.length, 1)
    assert.deepEqual(await state(observer, original, scenario), emptyState)
    assert.equal((await observer.query("SELECT pg_cancel_backend($1) AS canceled", [writer.processID])).rows[0].canceled, true)
    assert.equal((await pending).code, "57014")
    await writer.query("ROLLBACK")
    await barrier.query("ROLLBACK")
    assert.deepEqual(await state(observer, original, scenario), emptyState)
    await observer.query(`DROP TRIGGER test_pause_cash_observation ON private.provider_cash_evidence;
      DROP FUNCTION private.test_pause_cash_observation();`)
    await configureServiceRoleTransaction(writer)
    await record(writer, original, scenario, "retry")
    assert.deepEqual(await state(observer, original, scenario), emptyState)
    await writer.query("COMMIT")
    assert.deepEqual(await state(observer, original, scenario), { cash: 1, observations: 1, audit: 2, principal: 1 })
    assert.equal((await observer.query("SELECT count(*)::integer AS count FROM audit.audit_events WHERE request_id=$1",
      [`cash-concurrency-${scenario}-canceled`])).rows[0].count, 0)
    return { scenario: "interruption_between_cash_and_observation", blockedSessions: blocked.length,
      partialEvidenceVisible: false, canceledEvidenceResidue: 0, principalMutations: 0, retrySucceeded: true }
  })
}

async function recoveryRace(database, original, scenario, { sameOperation = false, rollbackFirst = false } = {}) {
  return withPgClients(database, ["recovery-first", "recovery-second", "recovery-observer"], async (first, second, observer) => {
    const firstOperation = randomUUID()
    const secondOperation = sameOperation ? firstOperation : randomUUID()
    await configureServiceRoleTransaction(first)
    const { rows: [quarantine] } = await first.query(`SELECT gateway_event_id FROM public.quarantine_verified_payment_gateway_event(
      'STRIPE','stripe_us',$1,'refund.created','refund',$2,'{}',decode('ab','hex'),$3::bytea,
      clock_timestamp(),clock_timestamp(),'stripe_webhook_signature','provider-fact-mismatch','Recovery concurrency fixture')`,
      [`evt_recovery_${scenario}`, `re_recovery_${scenario}`, createHash("sha256").update(scenario).digest()])
    const id = quarantine.gateway_event_id
    await first.query("COMMIT")
    // Service callers cannot SELECT the event table. The fixture observer supplies
    // original evidence as RPC arguments, preserving PostgreSQL timestamp precision.
    const { rows: [source] } = await observer.query(`SELECT provider_event_id,event_type,provider_object_id,
      payload_ciphertext,payload_sha256,verification_method,
      to_jsonb(event)->>'signature_verified_at' AS verified_at,to_jsonb(event)->>'occurred_at' AS occurred_at
      FROM public.payment_gateway_events event WHERE id=$1::uuid`, [id])
    const admit = (client, operation) => client.query(`SELECT * FROM public.ingest_verified_sponsorship_financial_adjustment(
        target_original_financial_movement_id=>$1::uuid,target_provider=>'STRIPE',target_provider_account_scope=>'stripe_us',
        target_provider_event_id=>$2,target_event_type=>$3,
        target_provider_object_type=>'refund',target_provider_object_id=>$4,
        target_adjustment_provider_movement_type=>'refund',target_adjustment_provider_movement_id=>$4,
        target_charged_amount_minor=>1,target_charged_currency=>'USD',target_conversion_rate=>1,
        target_redacted_payload=>'{}',target_payload_ciphertext=>$5::bytea,target_payload_sha256=>$6::bytea,
        target_signature_verified_at=>$7::timestamptz,target_occurred_at=>$8::timestamptz,
        target_verification_method=>$9,target_revalidation_operation_id=>$10::uuid
      )`, [original.id, source.provider_event_id, source.event_type, source.provider_object_id,
        source.payload_ciphertext, source.payload_sha256, source.verified_at, source.occurred_at, source.verification_method, operation])
    await configureServiceRoleTransaction(first)
    await configureServiceRoleTransaction(second)
    assert.equal((await admit(first, firstOperation)).rows[0].is_duplicate, false)
    const pending = admit(second, secondOperation).then(result => ({ result: result.rows[0] }), error => ({ code: error.code }))
    const blocked = await waitForClientsBlockedBy(observer, [second], first)
    assert.equal(blocked.length, 1)
    const { rows: [uncommitted] } = await observer.query(`SELECT processing_status,
      original_financial_movement_id IS NULL AS unlinked,
      (SELECT count(*)::integer FROM audit.payment_gateway_event_revalidations WHERE gateway_event_id=$1::uuid) AS receipts
      FROM public.payment_gateway_events WHERE id=$1::uuid`, [id])
    assert.deepEqual(uncommitted, { processing_status: "quarantined", unlinked: true, receipts: 0 })
    await configureServiceRoleTransaction(observer)
    const claimed = await observer.query("SELECT gateway_event_id FROM public.claim_payment_gateway_events('recovery-observer',100)")
    assert.equal(claimed.rows.some(row => row.gateway_event_id === id), false)
    await observer.query("ROLLBACK")
    await first.query(rollbackFirst ? "ROLLBACK" : "COMMIT")
    const result = await pending
    if (!sameOperation && !rollbackFirst) {
      assert.equal(result.code, "23505")
      await second.query("ROLLBACK")
    } else {
      assert.equal(result.result.gateway_event_id, id)
      assert.equal(result.result.is_duplicate, !rollbackFirst)
      await second.query("COMMIT")
    }
    const { rows: [receipt] } = await observer.query(`SELECT operation_id FROM audit.payment_gateway_event_revalidations
      WHERE gateway_event_id=$1::uuid`, [id])
    assert.equal(receipt.operation_id, rollbackFirst ? secondOperation : firstOperation)
    await configureServiceRoleTransaction(first)
    const { rows } = await first.query("SELECT * FROM public.claim_payment_gateway_events('recovery-settlement',100)")
    const lease = rows.find(row => row.gateway_event_id === id)
    assert.ok(lease)
    await first.query("SELECT * FROM public.apply_sponsorship_financial_adjustment($1::uuid,$2::uuid)", [id, lease.processing_lease_token])
    await first.query("COMMIT")
    const { rows: [settled] } = await observer.query(`SELECT
      (SELECT count(*)::integer FROM public.payment_gateway_event_applications WHERE gateway_event_id=$1::uuid) AS applications,
      (SELECT count(*)::integer FROM public.sponsorship_financial_movements WHERE source_gateway_event_id=$1::uuid) AS movements`, [id])
    assert.deepEqual(settled, { applications: 1, movements: 1 })
    return { scenario: `recovery_${scenario}`, blockedSessions: blocked.length, partialInterpretationVisible: false,
      claimedBeforeCommit: false, interpretationReceipts: 1, financialApplications: 1, financialMovements: 1 }
  })
}

let database
const evidencePath = process.env.PROVIDER_CASH_CONCURRENCY_EVIDENCE_PATH ?? null
const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({ gate: "FF-084", getDatabase: () => database })
try {
  await clearConcurrencyGateEvidence(evidencePath)
  database = await createTransientLocalSupabaseDatabase({ workspace: process.cwd(), databasePrefix: "providercash" })
  const provenance = await loadConcurrencyGateProvenance(database)
  const parts = (await readFile("supabase/tests/sponsorship_financial_adjustments.test.sql", "utf8"))
    .split("-- End shared provider cash fixture.")
  assert.equal(parts.length, 2)
  const fixture = parts[0].replace("SELECT extensions.no_plan();", "")
    .replace("BEGIN;", `BEGIN; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);`)
  // The transient clone copies schema and role dictionaries, not payment policy/account rows.
  const paymentDictionaries = `
    INSERT INTO public.sponsorship_attribution_policies(version,effective_at)
      VALUES ('2026-07-16-v1','2026-07-16 00:00:00+00');
    INSERT INTO public.payment_provider_accounts(provider,scope,stripe_region,environment)
      VALUES ('STRIPE','stripe_us','us','configured');`
  await database.executeSupabaseAdminSql(`${paymentDictionaries}\n${fixture}\nCOMMIT;`)
  const original = await withPgClients(database, ["cash-fixture"], async client => {
    const { rows } = await client.query(`SELECT id,occurred_at+interval '1 second' AS "cashOccurredAt"
      FROM public.sponsorship_financial_movements
      WHERE provider='STRIPE' AND provider_account_scope='stripe_us'
        AND provider_movement_id='pi_financial_adjustment_gross_0001' AND entry_kind='sponsorship_payment'`)
    assert.equal(rows.length, 1)
    return rows[0]
  })
  const scenarios = [
    await race(database, original, "identical_delivery"),
    await race(database, original, "corroborating_event", { otherEvent: true }),
    await race(database, original, "conflicting_cash", { otherAmount: true }),
    await race(database, original, "conflicting_binding", { otherMovement: true }),
    await race(database, original, "conflicting_digest", { otherDigest: true }),
    await race(database, original, "first_writer_rollback", {}, true),
    await interruption(database, original),
    await recoveryRace(database, original, "identical_operation", { sameOperation: true }),
    await recoveryRace(database, original, "competing_operations"),
    await recoveryRace(database, original, "admission_rollback", { rollbackFirst: true }),
  ]
  await database.dispose()
  database = undefined
  await writeConcurrencyGateEvidence({ gate: "FF-084", outputPath: evidencePath, provenance, scenarios })
  process.stdout.write("Provider cash and recovery concurrency passed: 10 observed interleavings\n")
} finally {
  try { if (database) await database.dispose() } finally { removeTerminationCleanup() }
}
