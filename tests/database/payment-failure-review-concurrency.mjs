import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { configureAuthenticatedTransaction, configureServiceRoleTransaction, createTransientLocalSupabaseDatabase } from "./support/local-supabase.mjs"
import { clearConcurrencyGateEvidence, installConcurrencyGateTerminationCleanup, loadConcurrencyGateProvenance, withPgClients, writeConcurrencyGateEvidence } from "./support/concurrency-gate.mjs"
import { waitForClientsBlockedBy } from "./support/postgres-barrier.mjs"

const actor = { userId: "0e000000-0000-4000-8000-000000000001", sessionId: "0e100000-0000-4000-8000-000000000001" }
const eventId = n => `0e300000-0000-4000-8000-${String(n).padStart(12, "0")}`
const outcome = promise => promise.then(() => "ok", error => error.code)
const acknowledge = (client, id, version) => client.query(
  "SELECT public.acknowledge_payment_failure($1::uuid,$2,'investigating',$3::uuid)", [id, version, randomUUID()],
)
const settle = (client, id, lease) => client.query(
  "SELECT public.ignore_sponsorship_payment_gateway_event($1::uuid,$2::uuid,'verified-no-effect')", [id, lease],
)

async function settlementRace(database, acknowledgmentFirst) {
  return withPgClients(database, ["review", "settlement", "observer"], async (review, worker, observer) => {
    const id = eventId(acknowledgmentFirst ? 4 : 3)
    const { rows: [event] } = await observer.query(
      "SELECT private.payment_failure_version(e) AS version,processing_lease_token AS lease FROM public.payment_gateway_events e WHERE id=$1::uuid", [id],
    )
    await configureAuthenticatedTransaction(review, actor)
    await configureServiceRoleTransaction(worker)
    let pending, blocked
    if (acknowledgmentFirst) {
      await acknowledge(review, id, event.version)
      pending = outcome(settle(worker, id, event.lease))
      blocked = await waitForClientsBlockedBy(observer, [worker], review)
      await review.query("COMMIT")
      assert.equal(await pending, "ok")
      await worker.query("COMMIT")
    } else {
      await settle(worker, id, event.lease)
      pending = outcome(acknowledge(review, id, event.version))
      blocked = await waitForClientsBlockedBy(observer, [review], worker)
      await worker.query("COMMIT")
      assert.equal(await pending, "40001")
      await review.query("ROLLBACK")
    }
    const { rows: [result] } = await observer.query(`SELECT
      (SELECT private.payment_failure_kind(e) IS NULL FROM public.payment_gateway_events e WHERE id=$1::uuid) AS no_failure,
      (SELECT count(*)::integer FROM audit.payment_failure_acknowledgments WHERE gateway_event_id=$1::uuid) AS receipts,
      (SELECT count(*)::integer FROM public.payment_gateway_event_applications WHERE gateway_event_id=$1::uuid) AS applications`, [id])
    assert.deepEqual(result, { no_failure: true, receipts: acknowledgmentFirst ? 1 : 0, applications: 1 })
    return { scenario: acknowledgmentFirst ? "acknowledgment_before_settlement" : "settlement_before_acknowledgment", blockedSessions: blocked.length, losingPathResidue: 0 }
  })
}

async function revocationRace(database) {
  return withPgClients(database, ["administrator-ban", "review", "observer"], async (ban, review, observer) => {
    const id = eventId(1)
    const { rows: [event] } = await observer.query("SELECT private.payment_failure_version(e) AS version FROM public.payment_gateway_events e WHERE id=$1::uuid", [id])
    await ban.query("BEGIN")
    await ban.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1::uuid", [actor.userId])
    await configureAuthenticatedTransaction(review, actor)
    const pending = outcome(acknowledge(review, id, event.version))
    const blocked = await waitForClientsBlockedBy(observer, [review], ban)
    await ban.query("COMMIT")
    assert.equal(await pending, "42501")
    await review.query("ROLLBACK")
    const { rows: [result] } = await observer.query("SELECT count(*)::integer AS receipts FROM audit.payment_failure_acknowledgments WHERE gateway_event_id=$1::uuid", [id])
    assert.equal(result.receipts, 0)
    return { scenario: "administrator_revocation_before_acknowledgment", blockedSessions: blocked.length, losingPathResidue: 0 }
  })
}

let database
const evidencePath = process.env.PAYMENT_FAILURE_REVIEW_CONCURRENCY_EVIDENCE_PATH ?? null
const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({ gate: "FF-085", getDatabase: () => database })
try {
  await clearConcurrencyGateEvidence(evidencePath)
  database = await createTransientLocalSupabaseDatabase({ workspace: process.cwd(), databasePrefix: "paymentreview" })
  const provenance = await loadConcurrencyGateProvenance(database)
  const parts = (await readFile("supabase/tests/payment_failure_review.test.sql", "utf8")).split("-- End shared payment failure fixture.")
  assert.equal(parts.length, 2)
  const fixture = parts[0].replace("SELECT extensions.no_plan();", "").replace("WHEN i=4 THEN now() END", "WHEN i=4 THEN now()-interval '11 minutes' END")
  await database.executeSupabaseAdminSql(`${fixture}\nCOMMIT;`)
  const scenarios = [await settlementRace(database, false), await settlementRace(database, true), await revocationRace(database)]
  assert.ok(scenarios.every(item => item.blockedSessions === 1 && item.losingPathResidue === 0))
  await database.dispose()
  database = undefined
  await writeConcurrencyGateEvidence({ gate: "FF-085", outputPath: evidencePath, provenance, scenarios })
  process.stdout.write("Payment failure review concurrency passed: 3 observed interleavings\n")
} finally {
  try { if (database) await database.dispose() } finally { removeTerminationCleanup() }
}
