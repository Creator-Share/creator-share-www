import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { configureAuthenticatedTransaction, createTransientLocalSupabaseDatabase } from "./support/local-supabase.mjs"
import { clearConcurrencyGateEvidence, installConcurrencyGateTerminationCleanup, loadConcurrencyGateProvenance, withPgClients, writeConcurrencyGateEvidence } from "./support/concurrency-gate.mjs"
import { waitForClientsBlockedBy } from "./support/postgres-barrier.mjs"

const user = n => `0f000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const member = n => `0f400000-0000-4000-8000-${String(n).padStart(12, "0")}`
const portal = "0f300000-0000-4000-8000-000000000001"
const actor = { userId: user(1), sessionId: "0f100000-0000-4000-8000-000000000001" }
const evidencePath = process.env.ACCOUNT_OFFBOARDING_CONCURRENCY_EVIDENCE_PATH ?? null
const settle = promise => promise.then(result => ({ result }), error => ({ code: error.code }))
const offboard = (client, n) => client.query("SELECT public.offboard_creator_share_accounts(ARRAY[$1::uuid],$2::uuid)", [user(n), randomUUID()])
const transfer = (client, from, to, requestId) => client.query(
  "SELECT public.transfer_creator_share_advocate_ownership($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6)",
  [portal, member(from), member(to), "Offboarding concurrency verification", requestId, "offboarding-concurrency"],
)

async function transferFirst(database) {
  return withPgClients(database, ["transfer-first", "offboarding-waiter", "observer"], async (ownership, disable, observer) => {
    await configureAuthenticatedTransaction(ownership, actor)
    await transfer(ownership, 3, 2, randomUUID())
    await configureAuthenticatedTransaction(disable, actor)
    const pending = settle(offboard(disable, 2))
    const blocked = await waitForClientsBlockedBy(observer, [disable], ownership)
    await ownership.query("COMMIT")
    assert.equal((await pending).code, "55000")
    await disable.query("ROLLBACK")
    const { rows } = await observer.query(`SELECT
      (SELECT owner_membership_id=$1::uuid FROM public.advocates WHERE id=$2::uuid) AS ownership_preserved,
      (SELECT banned_until IS NULL FROM auth.users WHERE id=$3::uuid) AS account_active,
      (SELECT count(*)::integer FROM audit.creator_share_account_offboardings) AS receipts`, [member(2), portal, user(2)])
    assert.deepEqual(rows[0], { ownership_preserved: true, account_active: true, receipts: 0 })
    return { scenario: "ownership_transfer_before_offboarding", blockedSessions: blocked.length, losingPathResidue: 0 }
  })
}

async function offboardFirst(database) {
  return withPgClients(database, ["offboarding-first", "transfer-waiter", "observer"], async (disable, ownership, observer) => {
    await configureAuthenticatedTransaction(disable, actor)
    await offboard(disable, 3)
    await configureAuthenticatedTransaction(ownership, actor)
    const operation = randomUUID()
    const pending = settle(transfer(ownership, 2, 3, operation))
    const blocked = await waitForClientsBlockedBy(observer, [ownership], disable)
    await disable.query("COMMIT")
    assert.equal((await pending).code, "23503")
    await ownership.query("ROLLBACK")
    const { rows } = await observer.query(`SELECT
      (SELECT owner_membership_id=$1::uuid FROM public.advocates WHERE id=$2::uuid) AS ownership_preserved,
      (SELECT count(*)::integer FROM auth.sessions WHERE user_id=$3::uuid) AS sessions,
      (SELECT count(*)::integer FROM audit.creator_share_advocate_ownership_transfers WHERE request_id=$4::uuid) AS losing_receipts,
      (SELECT count(*)::integer FROM audit.creator_share_account_offboardings WHERE user_id=$3::uuid) AS disable_receipts`, [member(2), portal, user(3), operation])
    assert.deepEqual(rows[0], { ownership_preserved: true, sessions: 0, losing_receipts: 0, disable_receipts: 1 })
    return { scenario: "offboarding_before_ownership_transfer", blockedSessions: blocked.length, losingPathResidue: 0 }
  })
}

async function authorityRevokedFirst(database) {
  return withPgClients(database, ["administrator-ban", "offboarding-waiter", "observer"], async (ban, disable, observer) => {
    await ban.query("BEGIN")
    await ban.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1::uuid", [actor.userId])
    await configureAuthenticatedTransaction(disable, actor)
    const pending = settle(offboard(disable, 4))
    const blocked = await waitForClientsBlockedBy(observer, [disable], ban)
    await ban.query("COMMIT")
    assert.equal((await pending).code, "42501")
    await disable.query("ROLLBACK")
    const { rows } = await observer.query(`SELECT
      (SELECT banned_until IS NULL FROM auth.users WHERE id=$1::uuid) AS target_active,
      (SELECT count(*)::integer FROM audit.creator_share_account_offboardings WHERE user_id=$1::uuid) AS receipts`, [user(4)])
    assert.deepEqual(rows[0], { target_active: true, receipts: 0 })
    return { scenario: "administrator_ban_before_offboarding", blockedSessions: blocked.length, losingPathResidue: 0 }
  })
}

let database
const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({ gate: "FF-077", getDatabase: () => database })
try {
  await clearConcurrencyGateEvidence(evidencePath)
  database = await createTransientLocalSupabaseDatabase({ workspace: process.cwd(), databasePrefix: "offboard" })
  const provenance = await loadConcurrencyGateProvenance(database)
  const fixtureParts = (await readFile("supabase/tests/global_account_offboarding.test.sql", "utf8"))
    .split("-- End shared offboarding fixture. The hosted concurrency harness reuses these rows.")
  assert.equal(fixtureParts.length, 2)
  const fixture = fixtureParts[0].replace("SELECT extensions.no_plan();", "")
  await database.executeSupabaseAdminSql(`${fixture}\nCOMMIT;`)
  const scenarios = [await transferFirst(database), await offboardFirst(database), await authorityRevokedFirst(database)]
  assert.ok(scenarios.every(scenario => scenario.blockedSessions === 1 && scenario.losingPathResidue === 0))
  await database.dispose()
  database = undefined
  await writeConcurrencyGateEvidence({ gate: "FF-077", outputPath: evidencePath, provenance, scenarios })
  process.stdout.write("FF-077 account offboarding concurrency passed: 3 observed interleavings\n")
} finally {
  try { if (database) await database.dispose() } finally { removeTerminationCleanup() }
}
