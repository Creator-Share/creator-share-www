import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { configureAuthenticatedTransaction, createTransientLocalSupabaseDatabase } from "./support/local-supabase.mjs"
import { clearConcurrencyGateEvidence, installConcurrencyGateTerminationCleanup, loadConcurrencyGateProvenance, withPgClients, writeConcurrencyGateEvidence } from "./support/concurrency-gate.mjs"
import { waitForClientsBlockedBy } from "./support/postgres-barrier.mjs"

const actor = { userId: "bd000000-0000-4000-8000-000000000001", sessionId: "bd000000-0000-4000-8000-000000000002" }
const child = n => `bd100000-0000-4000-8000-${String(n).padStart(12, "0")}`
const operation = n => `bd500000-0000-4000-8000-${String(n).padStart(12, "0")}`
const evidencePath = process.env.BENEFICIARY_DELETION_CONCURRENCY_EVIDENCE_PATH ?? null
const deletionSql = "SELECT public.delete_creator_share_beneficiaries(ARRAY[$1::uuid],$2::uuid) AS result"
const referenceSql = `INSERT INTO public.paypal_billing_catalog_entries(
 id,catalog_key,subject_kind,beneficiary_id,product_name,recurrence_interval,
 base_amount_usd_cents,charged_amount_minor,charged_currency,conversion_rate,
 currency_rate_source,product_request_id,plan_request_id,provisioning_lease_token,provisioning_lease_expires_at
) SELECT $2::uuid,private.paypal_billing_catalog_key('standard',$1::uuid,'Concurrency fixture','month',1000,1000,'USD',1,'fixture'),
 'standard',$1::uuid,'Concurrency fixture','month',1000,1000,'USD',1,'fixture',$2::text,$3::text,gen_random_uuid(),now()+interval '5 minutes'`
const referenceArgs = n => [child(n), `bd600000-0000-4000-8000-${String(n).padStart(12, "0")}`, `bd700000-0000-4000-8000-${String(n).padStart(12, "0")}`]
const settle = promise => promise.then(result => ({ result }), error => ({ code: error.code }))

async function content(client, id) {
  const { rows } = await client.query(`SELECT
    (SELECT count(*)::integer FROM public.beneficiaries WHERE id=$1) AS children,
    (SELECT count(*)::integer FROM public.activities WHERE beneficiary_id=$1) AS activities,
    (SELECT count(*)::integer FROM public.media WHERE parent_id=$1) AS media`, [id])
  return rows[0]
}

async function referenceFirst(database) {
  return withPgClients(database, ["reference-first", "delete-waiter", "observer"], async (reference, deletion, observer) => {
    await reference.query("BEGIN")
    await reference.query(referenceSql, referenceArgs(3))
    await configureAuthenticatedTransaction(deletion, actor)
    const pending = settle(deletion.query(deletionSql, [child(3), operation(3)]))
    const blocked = await waitForClientsBlockedBy(observer, [deletion], reference)
    await reference.query("COMMIT")
    const outcome = await pending
    assert.ok(["23503", "23001"].includes(outcome.code))
    await deletion.query("ROLLBACK")
    assert.deepEqual(await content(observer, child(3)), { children: 1, activities: 1, media: 1 })
    const audit = await observer.query("SELECT count(*)::integer AS count FROM audit.audit_events WHERE request_id=$1", [operation(3)])
    assert.equal(audit.rows[0].count, 0)
    return { scenario: "financial_reference_before_deletion", blockedSessions: blocked.length, contentPreserved: true, successAuditCount: 0 }
  })
}

async function deletionFirst(database) {
  return withPgClients(database, ["delete-first", "reference-waiter", "observer"], async (deletion, reference, observer) => {
    await configureAuthenticatedTransaction(deletion, actor)
    const result = await deletion.query(deletionSql, [child(4), operation(4)])
    assert.equal(result.rows[0].result.deleted_count, 1)
    await reference.query("BEGIN")
    const pending = settle(reference.query(referenceSql, referenceArgs(4)))
    const blocked = await waitForClientsBlockedBy(observer, [reference], deletion)
    await deletion.query("COMMIT")
    const outcome = await pending
    assert.ok(["23503", "23001"].includes(outcome.code))
    await reference.query("ROLLBACK")
    assert.deepEqual(await content(observer, child(4)), { children: 0, activities: 0, media: 0 })
    const references = await observer.query("SELECT count(*)::integer AS count FROM public.paypal_billing_catalog_entries WHERE beneficiary_id=$1", [child(4)])
    assert.equal(references.rows[0].count, 0)
    return { scenario: "deletion_before_financial_reference", blockedSessions: blocked.length, contentDeleted: true, survivingReferences: 0 }
  })
}

async function banFirst(database) {
  return withPgClients(database, ["ban-first", "delete-waiter", "observer"], async (ban, deletion, observer) => {
    await ban.query("BEGIN")
    await ban.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1", [actor.userId])
    await configureAuthenticatedTransaction(deletion, actor)
    const pending = settle(deletion.query(deletionSql, [child(2), operation(5)]))
    const blocked = await waitForClientsBlockedBy(observer, [deletion], ban)
    await ban.query("COMMIT")
    assert.equal((await pending).code, "42501")
    await deletion.query("ROLLBACK")
    assert.deepEqual(await content(observer, child(2)), { children: 1, activities: 1, media: 1 })
    await observer.query("UPDATE auth.users SET banned_until=NULL WHERE id=$1", [actor.userId])
    return { scenario: "account_ban_before_deletion", blockedSessions: blocked.length, deniedCode: "42501", contentPreserved: true }
  })
}

async function deletionBeforeBan(database) {
  return withPgClients(database, ["delete-before-ban", "ban-waiter", "observer"], async (deletion, ban, observer) => {
    await configureAuthenticatedTransaction(deletion, actor)
    await deletion.query(deletionSql, [child(2), operation(6)])
    await ban.query("BEGIN")
    const pending = settle(ban.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1", [actor.userId]))
    const blocked = await waitForClientsBlockedBy(observer, [ban], deletion)
    await deletion.query("COMMIT")
    assert.ok((await pending).result)
    await ban.query("COMMIT")
    assert.deepEqual(await content(observer, child(2)), { children: 0, activities: 0, media: 0 })
    return { scenario: "deletion_before_account_ban", blockedSessions: blocked.length, contentDeleted: true }
  })
}

let database
const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({ gate: "FF-082", getDatabase: () => database })
try {
  await clearConcurrencyGateEvidence(evidencePath)
  database = await createTransientLocalSupabaseDatabase({ workspace: process.cwd(), databasePrefix: "benefdelete" })
  const provenance = await loadConcurrencyGateProvenance(database)
  await database.executeSupabaseAdminSql(await readFile(resolve("tests/database/fixtures/beneficiary-deletion.sql"), "utf8"))
  const scenarios = [await referenceFirst(database), await deletionFirst(database), await banFirst(database), await deletionBeforeBan(database)]
  assert.equal(scenarios.length, 4)
  assert.ok(scenarios.every(scenario => scenario.blockedSessions === 1))
  await database.dispose()
  database = undefined
  await writeConcurrencyGateEvidence({ gate: "FF-082", outputPath: evidencePath, provenance, scenarios })
  process.stdout.write("FF-082 beneficiary deletion concurrency passed: 4 observed interleavings\n")
} finally {
  try { if (database) await database.dispose() } finally { removeTerminationCleanup() }
}
