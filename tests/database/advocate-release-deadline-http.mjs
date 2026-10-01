import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createPgClient } from "./support/local-supabase.mjs"
import { discoverLocalSupabaseHttp, createBoundedLocalSupabaseFetch, loadLocalSupabaseHttpProvenance } from "./support/local-supabase-http.mjs"
import { withPgClients, clearConcurrencyGateEvidence, writeConcurrencyGateEvidence } from "./support/concurrency-gate.mjs"

// Hosted gate over an already running, verified loopback stack. No services,
// users, domains, provider objects, or financial facts created. The test temporarily
// lengthens this RPC's competing lock timeout and restores its exact configuration.
const evidencePath = process.env.ADVOCATE_RELEASE_DEADLINE_EVIDENCE_PATH ?? null
const controller = new AbortController()
const onInterrupt = () => { process.exitCode = 130; controller.abort() }
const onTerminate = () => { process.exitCode = 143; controller.abort() }
process.once("SIGINT", onInterrupt)
process.once("SIGTERM", onTerminate)
let timer
try {
  await clearConcurrencyGateEvidence(evidencePath)
  const stack = await discoverLocalSupabaseHttp()
  const provenance = await loadLocalSupabaseHttpProvenance(stack, {
    harnessPaths: ["tests/database/advocate-release-deadline-http.mjs", "tests/database/support/local-supabase-http.mjs",
      "tests/database/support/local-supabase.mjs", "tests/database/support/concurrency-gate.mjs"],
    compatibilityTestPath: "supabase/tests/advocate_public_metrics_boundary.test.sql",
    expectedSourceRevision: process.env.ADVOCATE_RELEASE_DEADLINE_SOURCE_REVISION,
    requireCleanCheckout: true,
  })
  const deadline = Date.now() + 60_000
  timer = setTimeout(() => controller.abort(), 60_000)
  const httpController = new AbortController()
  const request = createBoundedLocalSupabaseFetch({ allowedOrigin: stack.apiOrigin,
    allowedPathPrefixes: ["/rest/v1/"], requestTimeoutMilliseconds: 45_000,
    getAbsoluteDeadline: () => deadline, getSignal: () => AbortSignal.any([controller.signal, httpController.signal]) })
  const database = { createClient: label => createPgClient(stack.database.sourceConnectionString, label,
    { idleTransactionTimeoutMilliseconds: 60_000 }) }
  const scenario = await withPgClients(database, ["release-deadline-barrier", "release-deadline-observer"], async (barrier, observer) => {
    const requestId = randomUUID()
    const storedState = async () => (await observer.query(`SELECT
      (SELECT count(*)::integer FROM private.advocate_analytics_releases) AS private_releases,
      (SELECT count(*)::integer FROM private.advocate_analytics_basis_columns) AS columns,
      (SELECT count(*)::integer FROM private.advocate_public_metric_releases) AS public_releases,
      (SELECT count(*)::integer FROM audit.audit_events WHERE request_id=$1) AS request_audit
    `, [requestId])).rows[0]
    const { rows: [configuration] } = await observer.query(`SELECT proconfig FROM pg_proc
      WHERE oid='public.refresh_advocate_public_metric_releases(integer,text,text)'::regprocedure`)
    assert.ok(configuration.proconfig.includes("statement_timeout=40s"))
    const before = await storedState()
    assert.equal(configuration.proconfig.some(value => value.startsWith("lock_timeout=")), false)
    let pending
    let lockTimeoutChanged = false
    try {
      // The hosted stack cancels lock waits after eight seconds. Isolate the
      // statement deadline without changing its value or the production body.
      await observer.query("ALTER FUNCTION public.refresh_advocate_public_metric_releases(integer,text,text) SET lock_timeout = '50s'")
      lockTimeoutChanged = true
      await barrier.query("BEGIN; LOCK TABLE public.advocates IN ACCESS EXCLUSIVE MODE")
      const started = Date.now()
      pending = request(`${stack.apiOrigin}/rest/v1/rpc/refresh_advocate_public_metric_releases`, {
        method: "POST", headers: { apikey: stack.secretKey, "Content-Type": "application/json" },
        body: JSON.stringify({ batch_limit: 100, request_id: requestId, trace_id: null }),
      }).then(response => ({ response }), () => ({ response: null }))
      let observed = false
      for (let attempt = 0; attempt < 50; attempt += 1) {
        controller.signal.throwIfAborted()
        const { rows: [state] } = await observer.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE $1=ANY(pg_blocking_pids(pid)) AND state='active'
            AND query LIKE '%refresh_advocate_public_metric_releases%') AS blocked`, [barrier.processID])
        if (state.blocked) { observed = true; break }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.equal(observed, true)
      const { response } = await pending
      assert.ok(response, "The server must respond before the HTTP deadline")
      const body = await response.json()
      const elapsed = Date.now() - started
      process.stdout.write(JSON.stringify({ elapsedMilliseconds: elapsed, httpStatus: response.status,
        sqlstate: typeof body.code === "string" && /^[A-Z0-9]{5}$/.test(body.code) ? body.code : "invalid" }) + "\n")
      assert.equal(response.status, 500)
      assert.equal(body.code, "57014")
      assert.ok(elapsed >= 35_000 && elapsed < 45_000)
      assert.deepEqual(await storedState(), before)
      return { scenario: "postgrest_hoists_release_deadline", statementTimeoutMilliseconds: 40_000,
        httpTimeoutMilliseconds: 45_000, elapsedMilliseconds: elapsed, sqlstate: "57014",
        serverBlockingObserved: true, historyUnchanged: true,
        competingLockTimeoutMilliseconds: 50_000, functionConfigurationRestored: true }
    } finally {
      try {
        httpController.abort()
        // Cancel only release requests still blocked by this gate's own lock.
        // Release the lock only after the HTTP operation has joined.
        await observer.query(`SELECT pg_cancel_backend(pid) FROM pg_stat_activity
          WHERE $1=ANY(pg_blocking_pids(pid)) AND state='active'
            AND query LIKE '%refresh_advocate_public_metric_releases%'`, [barrier.processID])
        if (pending) await pending
        await barrier.query("ROLLBACK")
      } finally {
        if (lockTimeoutChanged) {
          await observer.query("ALTER FUNCTION public.refresh_advocate_public_metric_releases(integer,text,text) RESET lock_timeout")
          const { rows: [restored] } = await observer.query(`SELECT proconfig FROM pg_proc
            WHERE oid='public.refresh_advocate_public_metric_releases(integer,text,text)'::regprocedure`)
          assert.deepEqual(restored.proconfig, configuration.proconfig)
        }
      }
    }
  })
  controller.signal.throwIfAborted()
  await writeConcurrencyGateEvidence({ gate: "FF-034", outputPath: evidencePath,
    provenance: { postgresqlMajorVersion: stack.versions.postgresqlMajor,
      migrationBoundary: provenance.migrationBoundary, migrationSetSha256: provenance.migrationSetSha256 },
    synchronization: "server_observed_blocking_and_postgrest_statement_timeout", scenarios: [scenario] })
  controller.signal.throwIfAborted()
  process.stdout.write("Analytics RPC server deadline and unchanged history verified\n")
} catch (error) {
  await clearConcurrencyGateEvidence(evidencePath).catch(() => undefined)
  const category = typeof error?.message === "string" && /^[a-z][a-z0-9_]{0,120}$/.test(error.message)
    ? error.message : "assertion_or_transport_failure"
  process.stderr.write(`Analytics RPC deadline proof failed: ${category}\n`)
  process.exitCode ??= 1
} finally {
  clearTimeout(timer)
  process.removeListener("SIGINT", onInterrupt)
  process.removeListener("SIGTERM", onTerminate)
}
