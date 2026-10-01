import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  configureAuthenticatedTransaction,
  configureServiceRoleTransaction,
  createTransientLocalSupabaseDatabase,
} from "./support/local-supabase.mjs"
import {
  clearConcurrencyGateEvidence,
  installConcurrencyGateTerminationCleanup,
  loadConcurrencyGateProvenance,
  withPgClients,
  writeConcurrencyGateEvidence,
} from "./support/concurrency-gate.mjs"
import { waitForClientsBlockedBy } from "./support/postgres-barrier.mjs"

const advocateId = "97000000-0000-4000-8000-000000000001"
const actor = {
  userId: "97000000-0000-4000-8000-000000000101",
  sessionId: "97000000-0000-4000-8000-000000000102",
}
const pauseKey = "analytics-release-test-public-insert"
const refresh = (client, requestId) => client.query(
  "SELECT public.refresh_advocate_public_metric_releases(100,$1) AS result",
  [requestId],
)
const readReport = async client => {
  await configureAuthenticatedTransaction(client, actor)
  try {
    return (await client.query(
      "SELECT public.get_advocate_analytics_snapshot($1::uuid) AS snapshot", [advocateId],
    )).rows[0].snapshot
  } finally {
    await client.query("ROLLBACK")
  }
}
const storedState = async client => (await client.query(`SELECT
  (SELECT count(*)::integer FROM private.advocate_analytics_releases) AS private_releases,
  (SELECT count(*)::integer FROM private.advocate_analytics_basis_columns) AS contributions,
  (SELECT count(*)::integer FROM private.advocate_public_metric_releases) AS public_releases,
  (SELECT count(*)::integer FROM audit.audit_events WHERE request_id='analytics-release-canceled') AS canceled_audit
`)).rows[0]

async function releaseInterruption(database) {
  return withPgClients(database, ["barrier", "release", "competitor", "reader", "observer"],
    async (barrier, worker, competitor, reader, observer) => {
      const before = await storedState(observer)
      assert.deepEqual(before, { private_releases: 0, contributions: 0, public_releases: 3, canceled_audit: 0 })
      assert.equal((await readReport(reader)).disclosure.state, "pending")
      await observer.query(`
        CREATE FUNCTION private.test_pause_public_analytics_release() RETURNS trigger
        LANGUAGE plpgsql SET search_path='' AS $$
        BEGIN
          IF NOT EXISTS(SELECT 1 FROM private.advocate_analytics_releases
            WHERE advocate_id=NEW.advocate_id AND source_cutoff=NEW.source_cutoff)
            OR NOT EXISTS(SELECT 1 FROM private.advocate_analytics_basis_columns
              WHERE advocate_id=NEW.advocate_id AND source_cutoff=NEW.source_cutoff) THEN
            RAISE EXCEPTION 'Private release checkpoint was not reached';
          END IF;
          PERFORM pg_advisory_xact_lock(hashtextextended('analytics-release-test-public-insert',0));
          RETURN NEW;
        END; $$;
        CREATE TRIGGER test_pause_public_analytics_release BEFORE INSERT
          ON private.advocate_public_metric_releases FOR EACH ROW
          EXECUTE FUNCTION private.test_pause_public_analytics_release();
      `)
      await barrier.query("BEGIN")
      await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [pauseKey])
      await configureServiceRoleTransaction(worker)
      const pending = refresh(worker, "analytics-release-canceled")
        .then(() => "unexpected_success", error => error.code)
      const blocked = await waitForClientsBlockedBy(observer, [worker], barrier)
      assert.equal(blocked.length, 1)
      assert.deepEqual(await storedState(observer), before)
      assert.equal((await readReport(reader)).disclosure.state, "pending")

      await configureServiceRoleTransaction(competitor)
      const { rows: [skipped] } = await refresh(competitor, "analytics-release-concurrent-skip")
      assert.deepEqual(
        [skipped.result.processed_advocates, skipped.result.inserted_releases, skipped.result.pending_metrics],
        [0, 0, 0],
      )
      await competitor.query("COMMIT")
      const { rows: [canceled] } = await observer.query(
        "SELECT pg_cancel_backend($1) AS canceled", [worker.processID],
      )
      assert.equal(canceled.canceled, true)
      assert.equal(await pending, "57014")
      await worker.query("ROLLBACK")
      await barrier.query("ROLLBACK")
      assert.deepEqual(await storedState(observer), before)
      assert.equal((await readReport(reader)).disclosure.state, "pending")
      await observer.query(`DROP TRIGGER test_pause_public_analytics_release ON private.advocate_public_metric_releases;
        DROP FUNCTION private.test_pause_public_analytics_release();`)

      await configureServiceRoleTransaction(worker)
      const { rows: [retry] } = await refresh(worker, "analytics-release-retry")
      assert.equal(retry.result.processed_advocates, 2)
      assert.equal(retry.result.inserted_releases, 1)
      assert.deepEqual(await storedState(observer), before)
      assert.equal((await readReport(reader)).disclosure.state, "pending")
      await worker.query("COMMIT")
      const committed = await storedState(observer)
      assert.equal(committed.private_releases, 2)
      assert.ok(committed.contributions > 0)
      assert.equal(committed.public_releases, 4)
      assert.equal(committed.canceled_audit, 0)
      const snapshot = await readReport(reader)
      assert.equal(snapshot.disclosure.state, "released")
      assert.equal(snapshot.as_of, retry.result.source_cutoff)
      assert.equal(snapshot.official.gross_collected_usd_cents, 20200)
      assert.equal(snapshot.official.sponsorships, null)
      await configureServiceRoleTransaction(competitor)
      assert.equal((await refresh(competitor, "analytics-release-repeat")).rows[0].result.inserted_releases, 0)
      await competitor.query("COMMIT")
      assert.deepEqual(await storedState(observer), committed)
      assert.deepEqual(await readReport(reader), snapshot)

      // A report is immutable, but the authority to read it is not. An
      // uncommitted ban does not apply early; the next read after commit fails.
      await barrier.query("BEGIN")
      await barrier.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1::uuid", [actor.userId])
      assert.deepEqual(await readReport(reader), snapshot)
      await barrier.query("COMMIT")
      await assert.rejects(readReport(reader), error => error.code === "42501")
      assert.deepEqual(await storedState(observer), committed)
      return [
        { scenario: "concurrent_worker_skips_in_flight_release", blockedSessions: blocked.length, partialReleaseVisible: false },
        { scenario: "cancel_after_private_before_public", canceled: true, privateResidue: 0, publicResidue: 0, auditResidue: 0 },
        { scenario: "retry_commits_both_surfaces_and_replay_preserves_history", duplicateReleases: 0, duplicateContributions: 0 },
        { scenario: "committed_account_ban_revokes_existing_report", denied: true, disclosureHistoryPreserved: true },
      ]
    })
}

// Synthetic capacity evidence, separate from the transactional race assertions.
// A timeout is recorded as a capacity limit, never described as certification.
async function observeDenseHistory(database) {
  return withPgClients(database, ["capacity"], async client => {
    await client.query("SET statement_timeout='15s'")
    const observations = []
    for (const [width, repeatColumn] of [[64, false], [128, false], [256, false], [128, true]]) {
      let seed = 907
      const next = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed % 1000 + 1
      }
      const rows = Array.from({ length: width }, () => Array.from({ length: width }, next))
      const columns = Array.from({ length: width }, (_, column) => Object.fromEntries(
        Array.from({ length: 5 * width }, (_, subject) => [
          String(subject).padStart(5, "0"), [rows[subject % width][column], 1],
        ]),
      ))
      if (repeatColumn) columns.push(columns[0])
      const started = performance.now()
      let outcome
      try {
        const { rows: [result] } = await client.query(
          "SELECT jsonb_array_length(private.certify_analytics_columns($1::jsonb)) AS width",
          [JSON.stringify(columns)],
        )
        assert.equal(result.width, width)
        outcome = "certified"
      } catch (error) {
        if (error.code !== "57014") throw error
        outcome = "query_canceled"
      }
      observations.push({ columns: columns.length, independentColumns: width, subjects: 5 * width, outcome,
        milliseconds: Math.round(performance.now() - started), statementTimeoutMilliseconds: 15_000 })
    }
    return { scenario: "synthetic_dense_history_capacity", observations }
  })
}

let database
const evidencePath = process.env.ADVOCATE_ANALYTICS_CONCURRENCY_EVIDENCE_PATH ?? null
const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({
  gate: "FF-034", getDatabase: () => database,
})
try {
  await clearConcurrencyGateEvidence(evidencePath)
  database = await createTransientLocalSupabaseDatabase({ workspace: process.cwd(), databasePrefix: "analyticsrelease" })
  const provenance = await loadConcurrencyGateProvenance(database)
  const parts = (await readFile("supabase/tests/advocate_public_metrics_boundary.test.sql", "utf8"))
    .split("-- End shared analytics release fixture.")
  assert.equal(parts.length, 2)
  await database.executeSupabaseAdminSql(`${parts[0]}\n
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
      VALUES('${actor.userId}','authenticated','authenticated','analytics-release-viewer@example.test',now(),'{}','{"first_name":"Analytics","last_name":"Viewer"}',now(),now(),false);
    -- The shared financial fixture bypasses onboarding. Give its published
    -- tenants consistent owner pointers before exercising authenticated reads.
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.advocate_memberships(advocate_id,user_id,status)
      SELECT id,'${actor.userId}','active' FROM public.advocates WHERE relationship_status IN ('active','suspended') OR publication_status='active';
    INSERT INTO public.advocate_membership_roles(advocate_id,membership_id,role_id,assigned_by_user_id)
      SELECT membership.advocate_id,membership.id,role.id,'${actor.userId}'
      FROM public.advocate_memberships membership CROSS JOIN public.advocate_roles role
      WHERE membership.user_id='${actor.userId}' AND role.key='owner';
    UPDATE public.advocates advocate SET owner_membership_id=membership.id
      FROM public.advocate_memberships membership
      WHERE membership.advocate_id=advocate.id AND membership.user_id='${actor.userId}';
    SET LOCAL session_replication_role = origin;
    COMMIT;`)
  const scenarios = await releaseInterruption(database)
  scenarios.push(await observeDenseHistory(database))
  await database.dispose()
  database = undefined
  await writeConcurrencyGateEvidence({
    gate: "FF-034", outputPath: evidencePath, provenance, scenarios,
    synchronization: "server_observed_blocking_pids_and_transaction_visibility",
  })
  process.stdout.write("Analytics release concurrency passed: 4 scenarios; bounded capacity observation recorded\n")
} finally {
  try { if (database) await database.dispose() } finally { removeTerminationCleanup() }
}
