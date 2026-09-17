import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  configureAuthenticatedTransaction,
  configureServiceRoleTransaction,
  createTransientLocalSupabaseDatabase,
} from "./support/local-supabase.mjs"
import {
  clearConcurrencyGateEvidence,
  installConcurrencyGateTerminationCleanup,
  loadConcurrencyGateProvenance,
  withPgClients as withClients,
  writeConcurrencyGateEvidence,
} from "./support/concurrency-gate.mjs"
import {
  holdAdvisoryLock,
  holdRowLock,
  releaseHeldLock,
  settleConcurrent,
  waitForClientsBlockedBy,
} from "./support/postgres-barrier.mjs"
import { buildSuccessfulPublicationCanaryReport } from "./support/publication-canary-report.mjs"

const WORKSPACE = resolve(process.cwd())
const FIXTURE_PATH = resolve(
  WORKSPACE,
  "tests/database/fixtures/advocate-publication-concurrency.sql",
)
const EVIDENCE_OUTPUT_PATH = process.env
  .ADVOCATE_PUBLICATION_CONCURRENCY_EVIDENCE_PATH
  ? resolve(process.env.ADVOCATE_PUBLICATION_CONCURRENCY_EVIDENCE_PATH)
  : null
const OPERATION_LOCK_SEED = 731929
const RUN_LOCK_SEED = 731927
const QUEUE_LOCK_SEED = 731928
const CREATOR_SHARE_ADMIN_AUTHORITY_LOCK = Object.freeze([112927, 1])
const ADMIN_REASON = "Approve the reviewed FF-040 publication operation"
const DEPLOYMENT_A = "dpl_ff040_a"
const REVISION_A = "a".repeat(40)
const ROLLOVER_DEPLOYMENT_A = "dpl_ff040_rollover_a"
const ROLLOVER_DEPLOYMENT_B = "dpl_ff040_rollover_b"
const ROLLOVER_REVISION_A = "c".repeat(40)
const ROLLOVER_REVISION_B = "d".repeat(40)
const AUDIT_TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/

const ACTORS = Object.freeze({
  initiator: Object.freeze({
    userId: "f0400000-0000-4000-8000-000000000001",
    sessionId: "f0401000-0000-4000-8000-000000000001",
  }),
  approverOne: Object.freeze({
    userId: "f0400000-0000-4000-8000-000000000002",
    sessionId: "f0401000-0000-4000-8000-000000000002",
  }),
  approverTwo: Object.freeze({
    userId: "f0400000-0000-4000-8000-000000000003",
    sessionId: "f0401000-0000-4000-8000-000000000003",
  }),
})

const IDS = Object.freeze({
  differentStartOne: "f0402000-0000-4000-8000-000000000001",
  differentStartTwo: "f0402000-0000-4000-8000-000000000002",
  replay: "f0402000-0000-4000-8000-000000000003",
  approval: "f0402000-0000-4000-8000-000000000004",
  lease: "f0402000-0000-4000-8000-000000000005",
  rollover: "f0402000-0000-4000-8000-000000000006",
  rolloverFresh: "f0402000-0000-4000-8000-000000000007",
  approvalCompletion: "f0403000-0000-4000-8000-000000000001",
  approvalOne: "f0403000-0000-4000-8000-000000000002",
  approvalTwo: "f0403000-0000-4000-8000-000000000003",
  leaseCompletion: "f0403000-0000-4000-8000-000000000004",
})

function pgError(error, code, message) {
  assert.equal(error?.code, code)
  assert.equal(error?.message, message)
}

function fulfilled(settlements) {
  return settlements.filter((result) => result.status === "fulfilled")
}

function rejected(settlements) {
  return settlements.filter((result) => result.status === "rejected")
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

async function authenticatedCall(client, actor, text, values) {
  await configureAuthenticatedTransaction(client, actor)
  return finishTransaction(client, () => client.query(text, values))
}

async function serviceRoleCall(client, text, values) {
  await configureServiceRoleTransaction(client)
  return finishTransaction(client, () => client.query(text, values))
}

async function startPublication(
  client,
  actor,
  portal,
  operationId,
  deploymentId,
  revision,
  trace,
) {
  const result = await authenticatedCall(
    client,
    actor,
    `SELECT
       operation_id::text,
       run_id::text,
       advocate_id::text,
       expected_advocate_version::text,
       deployment_id,
       revision,
       started_at,
       outcome,
       failure_code,
       CASE
         WHEN report_sha256 IS NULL THEN NULL
         ELSE encode(report_sha256, 'hex')
       END AS report_sha256,
       completed_at,
       published_advocate_version::text,
       created
     FROM public.begin_or_resume_advocate_publication_canary(
       $1::uuid,
       $2::bigint,
       $3::uuid,
       $4::text,
       $5::text,
       $6::text,
       $7::text,
       NULL,
       NULL
     )`,
    [
      portal.advocate_id,
      portal.advocate_version,
      operationId,
      deploymentId,
      revision,
      trace,
      ADMIN_REASON,
    ],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function claimExecution(client, runId, leaseSeconds = 120) {
  const result = await serviceRoleCall(
    client,
    `SELECT lease_token::text, leased_until
     FROM public.claim_advocate_publication_canary_execution(
       $1::uuid,
       $2::integer
     )`,
    [runId, leaseSeconds],
  )
  return result
}

async function claimNextExecution(
  client,
  deploymentId,
  revision,
  leaseSeconds = 120,
) {
  return serviceRoleCall(
    client,
    `SELECT
       run_id::text,
       advocate_id::text,
       deployment_id,
       revision,
       stripe_us_attempt_id::text,
       stripe_uk_attempt_id::text,
       paypal_attempt_id::text,
       start_request_id::text,
       lease_token::text,
       leased_until
     FROM public.claim_next_advocate_publication_canary_execution(
       $1::text,
       $2::text,
       $3::integer
     )`,
    [deploymentId, revision, leaseSeconds],
  )
}

async function completeExecution(
  client,
  start,
  lease,
  completionRequestId,
  suppliedEvidence,
) {
  const evidence =
    suppliedEvidence ?? buildSuccessfulPublicationCanaryReport(start, lease)
  const result = await serviceRoleCall(
    client,
    `SELECT
       run_id::text,
       outcome,
       encode(report_sha256, 'hex') AS report_sha256,
       completed_at
     FROM public.complete_claimed_advocate_publication_canary(
       $1::uuid,
       $2::text,
       $3::bytea,
       'succeeded',
       NULL,
       $4::timestamptz,
       $5::uuid,
       $6::text,
       $7::text,
       $8::uuid
     )`,
    [
      start.run_id,
      evidence.canonicalReport,
      evidence.reportSha256,
      evidence.completedAt,
      completionRequestId,
      `ff040-complete-${completionRequestId}`,
      ADMIN_REASON,
      lease.lease_token,
    ],
  )
  assert.equal(result.rowCount, 1)
  return { row: result.rows[0], evidence }
}

async function publishPortal(
  client,
  actor,
  start,
  reportSha256,
  approvalRequestId,
  capabilityId,
  trace,
) {
  const result = await authenticatedCall(
    client,
    actor,
    `SELECT public.publish_advocate_portal_from_canary_v2(
       $1::uuid,
       $2::bigint,
       $3::uuid,
       $4::uuid,
       $5::text,
       $6::bytea,
       $7::text,
       $8::uuid,
       $9::text,
       $10::uuid,
       NULL,
       NULL
     )::text AS resulting_advocate_version`,
    [
      start.advocate_id,
      start.expected_advocate_version,
      start.operation_id,
      start.run_id,
      start.deployment_id,
      reportSha256,
      ADMIN_REASON,
      approvalRequestId,
      trace,
      capabilityId,
    ],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function loadPortal(client, slug) {
  const result = await client.query(
    `SELECT
       advocate.id::text AS advocate_id,
       advocate.version::text AS advocate_version,
       advocate.publication_status,
       domain.id::text AS domain_id,
       domain.hostname,
       domain.status AS domain_status
     FROM public.advocates advocate
     JOIN public.advocate_domains domain
       ON domain.advocate_id = advocate.id
      AND domain.is_primary
     WHERE advocate.slug = $1::text`,
    [slug],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function loadStart(client, operationId) {
  const result = await client.query(
    `SELECT
       start.request_id::text AS operation_id,
       start.run_id::text,
       start.advocate_id::text,
       start.domain_id::text,
       start.hostname,
       start.expected_advocate_version::text,
       start.deployment_id,
       start.git_revision AS revision,
       start.stripe_us_attempt_id::text,
       start.stripe_uk_attempt_id::text,
       start.paypal_attempt_id::text,
       start.started_at
     FROM audit.advocate_publication_canary_starts start
     WHERE start.request_id = $1::uuid`,
    [operationId],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function loadLease(client, runId) {
  const result = await client.query(
    `SELECT
       lease_token::text,
       lease_version::integer,
       leased_at,
       leased_until,
       completed_at,
       completion_request_id::text
     FROM audit.advocate_publication_canary_execution_leases
     WHERE run_id = $1::uuid`,
    [runId],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function countAuditValueOccurrences(client, value) {
  const tables = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'audit'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  )
  assert.equal(tables.rowCount > 0, true)
  let total = 0
  for (const { table_name: tableName } of tables.rows) {
    if (!AUDIT_TABLE_NAME_PATTERN.test(tableName)) {
      throw new Error("ff040_audit_table_name_invalid")
    }
    const result = await client.query(
      `SELECT count(*)::integer AS occurrence_count
       FROM audit."${tableName}" audit_row
       WHERE strpos(to_jsonb(audit_row)::text, $1::text) > 0`,
      [value],
    )
    total += result.rows[0].occurrence_count
  }
  return total
}

async function differentOperationStartRace(database, portal) {
  return withClients(
    database,
    ["start_observer", "start_blocker", "start_one", "start_two"],
    async (observer, blocker, first, second) => {
      const held = await holdRowLock(blocker, {
        schema: "public",
        table: "advocates",
        value: portal.advocate_id,
      })
      let settlementPromise
      try {
        settlementPromise = settleConcurrent([
          () =>
            startPublication(
              first,
              ACTORS.initiator,
              portal,
              IDS.differentStartOne,
              DEPLOYMENT_A,
              REVISION_A,
              "ff040-different-start-one",
            ),
          () =>
            startPublication(
              second,
              ACTORS.approverOne,
              portal,
              IDS.differentStartTwo,
              DEPLOYMENT_A,
              REVISION_A,
              "ff040-different-start-two",
            ),
        ])
        const observations = await waitForClientsBlockedBy(
          observer,
          [first, second],
          blocker,
        )
        assert.equal(observations.length, 2)
        await releaseHeldLock(held)
        const settlements = await settlementPromise
        assert.equal(fulfilled(settlements).length, 1)
        assert.equal(rejected(settlements).length, 1)
        pgError(
          rejected(settlements)[0].reason,
          "40001",
          "An advocate publication operation is already in progress",
        )
        const state = await observer.query(
          `SELECT
             count(DISTINCT start.request_id)::integer AS start_count,
             count(DISTINCT start.run_id)::integer AS run_count,
             count(DISTINCT start.stripe_us_attempt_id)::integer AS stripe_us_count,
             count(DISTINCT start.stripe_uk_attempt_id)::integer AS stripe_uk_count,
             count(DISTINCT start.paypal_attempt_id)::integer AS paypal_count,
             count(DISTINCT attempt_id)::integer AS distinct_attempt_count
           FROM audit.advocate_publication_canary_starts start
           CROSS JOIN LATERAL unnest(ARRAY[
             start.stripe_us_attempt_id,
             start.stripe_uk_attempt_id,
             start.paypal_attempt_id
           ]) attempt_id
           WHERE start.advocate_id = $1::uuid
             AND start.expected_advocate_version = $2::bigint`,
          [portal.advocate_id, portal.advocate_version],
        )
        assert.deepEqual(state.rows[0], {
          start_count: 1,
          run_count: 1,
          stripe_us_count: 1,
          stripe_uk_count: 1,
          paypal_count: 1,
          distinct_attempt_count: 3,
        })

        const downstream = await observer.query(
          `SELECT
             count(lease.run_id)::integer AS lease_count,
             count(report.run_id)::integer AS report_count,
             count(capability.capability_id)::integer AS capability_count,
             count(approval.canary_run_id)::integer AS approval_count
           FROM audit.advocate_publication_canary_starts start
           LEFT JOIN audit.advocate_publication_canary_execution_leases lease
             ON lease.run_id = start.run_id
           LEFT JOIN audit.advocate_publication_canary_reports report
             ON report.run_id = start.run_id
           LEFT JOIN private.advocate_publication_deployment_capabilities capability
             ON capability.run_id = start.run_id
           LEFT JOIN audit.advocate_publication_approvals approval
             ON approval.canary_run_id = start.run_id
           WHERE start.advocate_id = $1::uuid`,
          [portal.advocate_id],
        )
        assert.deepEqual(downstream.rows[0], {
          lease_count: 0,
          report_count: 0,
          capability_count: 0,
          approval_count: 0,
        })

        return {
          scenario: "different_operation_start",
          blockedSessions: observations.length,
          committedStarts: 1,
          loserSqlstate: "40001",
        }
      } finally {
        await releaseHeldLock(held).catch(() => undefined)
        if (settlementPromise) await settlementPromise.catch(() => undefined)
      }
    },
  )
}

async function exactOperationReplayRace(database, portal) {
  return withClients(
    database,
    ["replay_observer", "replay_blocker", "replay_one", "replay_two"],
    async (observer, blocker, first, second) => {
      const held = await holdAdvisoryLock(blocker, {
        text: IDS.replay,
        seed: OPERATION_LOCK_SEED,
      })
      let settlementPromise
      try {
        settlementPromise = settleConcurrent([
          () =>
            startPublication(
              first,
              ACTORS.initiator,
              portal,
              IDS.replay,
              DEPLOYMENT_A,
              REVISION_A,
              "ff040-replay-one",
            ),
          () =>
            startPublication(
              second,
              ACTORS.approverOne,
              portal,
              IDS.replay,
              DEPLOYMENT_A,
              REVISION_A,
              "ff040-replay-two",
            ),
        ])
        const observations = await waitForClientsBlockedBy(
          observer,
          [first, second],
          blocker,
        )
        await releaseHeldLock(held)
        const settlements = await settlementPromise
        assert.equal(rejected(settlements).length, 0)
        const rows = fulfilled(settlements).map((result) => result.value)
        assert.deepEqual(rows.map((row) => row.created).sort(), [false, true])
        assert.equal(new Set(rows.map((row) => row.run_id)).size, 1)
        assert.equal(new Set(rows.map((row) => row.deployment_id)).size, 1)
        assert.equal(rows[0].deployment_id, DEPLOYMENT_A)
        assert.equal(rows[0].revision, REVISION_A)

        const state = await observer.query(
          `SELECT count(*)::integer AS start_count
           FROM audit.advocate_publication_canary_starts
           WHERE request_id = $1::uuid`,
          [IDS.replay],
        )
        assert.equal(state.rows[0].start_count, 1)
        return {
          scenario: "exact_operation_replay",
          blockedSessions: observations.length,
          committedStarts: 1,
          exactReplays: 1,
        }
      } finally {
        await releaseHeldLock(held).catch(() => undefined)
        if (settlementPromise) await settlementPromise.catch(() => undefined)
      }
    },
  )
}

async function completionAndApprovalRaces(database, portal) {
  const started = await withClients(
    database,
    ["approval_start"],
    async (client) =>
      startPublication(
        client,
        ACTORS.initiator,
        portal,
        IDS.approval,
        DEPLOYMENT_A,
        REVISION_A,
        "ff040-approval-start",
      ),
  )
  const start = await withClients(
    database,
    ["approval_start_reader"],
    (client) => loadStart(client, started.operation_id),
  )
  await withClients(database, ["approval_initial_claim"], async (client) => {
    const claim = await claimExecution(client, start.run_id)
    assert.equal(claim.rowCount, 1)
  })
  const initialLease = await withClients(
    database,
    ["approval_lease_reader"],
    (client) => loadLease(client, start.run_id),
  )
  const report = buildSuccessfulPublicationCanaryReport(start, initialLease)

  const completionRace = await withClients(
    database,
    [
      "completion_observer",
      "completion_blocker",
      "completion_worker",
      "premature_approver",
    ],
    async (observer, blocker, completionWorker, prematureApprover) => {
      const held = await holdAdvisoryLock(
        blocker,
        CREATOR_SHARE_ADMIN_AUTHORITY_LOCK,
      )
      let settlementPromise
      try {
        settlementPromise = settleConcurrent([
          () =>
            completeExecution(
              completionWorker,
              start,
              initialLease,
              IDS.approvalCompletion,
              report,
            ),
          () =>
            publishPortal(
              prematureApprover,
              ACTORS.approverOne,
              start,
              report.reportSha256,
              randomUUID(),
              null,
              "ff040-premature-approval-race",
            ),
        ])

        const observations = await waitForClientsBlockedBy(
          observer,
          [completionWorker, prematureApprover],
          blocker,
        )
        assert.equal(observations.length, 2)
        await releaseHeldLock(held)
        const settlements = await settlementPromise
        assert.equal(settlements[0].status, "fulfilled")
        assert.equal(settlements[1].status, "rejected")
        const completed = settlements[0].value
        assert.equal(completed.row.outcome, "succeeded")
        assert.equal(
          completed.row.report_sha256,
          report.reportSha256.toString("hex"),
        )
        const raceApprovalError = settlements[1].reason
        const allowedRaceErrors = new Map([
          [
            "55000",
            "Successful advocate publication canary evidence does not match",
          ],
          ["42501", "A current server deployment capability is required"],
        ])
        assert.equal(allowedRaceErrors.has(raceApprovalError?.code), true)
        assert.equal(
          raceApprovalError?.message,
          allowedRaceErrors.get(raceApprovalError?.code),
        )

        const completedState = await observer.query(
          `SELECT
             report.outcome AS report_outcome,
             encode(report.report_sha256, 'hex') AS report_sha256,
             lease.completed_at IS NOT NULL AS lease_completed,
             lease.completion_request_id::text,
             advocate.version::text AS advocate_version,
             advocate.publication_status,
             domain.status AS domain_status,
             (SELECT count(*)::integer
              FROM audit.advocate_publication_approvals
              WHERE canary_run_id = $1::uuid) AS approval_count,
             (SELECT count(*)::integer
              FROM private.advocate_publication_deployment_capabilities
              WHERE run_id = $1::uuid) AS capability_count
           FROM audit.advocate_publication_canary_reports report
           JOIN audit.advocate_publication_canary_execution_leases lease
             ON lease.run_id = report.run_id
           JOIN audit.advocate_publication_canary_starts start
             ON start.run_id = report.run_id
           JOIN public.advocates advocate
             ON advocate.id = start.advocate_id
           JOIN public.advocate_domains domain
             ON domain.id = start.domain_id
           WHERE report.run_id = $1::uuid`,
          [start.run_id],
        )
        assert.deepEqual(completedState.rows[0], {
          report_outcome: "succeeded",
          report_sha256: report.reportSha256.toString("hex"),
          lease_completed: true,
          completion_request_id: IDS.approvalCompletion,
          advocate_version: start.expected_advocate_version,
          publication_status: "provisioning",
          domain_status: "verifying",
          approval_count: 0,
          capability_count: 0,
        })

        await assert.rejects(
          publishPortal(
            prematureApprover,
            ACTORS.approverOne,
            start,
            report.reportSha256,
            randomUUID(),
            null,
            "ff040-post-completion-capability-denial",
          ),
          (error) => {
            pgError(
              error,
              "42501",
              "A current server deployment capability is required",
            )
            return true
          },
        )
        return {
          scenario: "completion_vs_premature_approval",
          blockedSessions: observations.length,
          raceApprovalSqlstate: raceApprovalError.code,
          postCompletionCapabilityDenialSqlstate: "42501",
          terminalReports: 1,
        }
      } finally {
        await releaseHeldLock(held).catch(() => undefined)
        if (settlementPromise) await settlementPromise.catch(() => undefined)
      }
    },
  )

  const capability = await withClients(
    database,
    ["capability_minter"],
    async (client) => {
      const result = await serviceRoleCall(
        client,
        `SELECT deployment_capability_id::text, expires_at
         FROM public.mint_advocate_publication_deployment_capability(
           $1::uuid,
           $2::uuid,
           $3::text,
           $4::text
         )`,
        [start.operation_id, start.run_id, start.deployment_id, start.revision],
      )
      assert.equal(result.rowCount, 1)
      return result.rows[0]
    },
  )

  const approvalRace = await withClients(
    database,
    ["approval_observer", "approval_blocker", "approver_one", "approver_two"],
    async (observer, blocker, first, second) => {
      const held = await holdAdvisoryLock(blocker, {
        text: start.operation_id,
        seed: OPERATION_LOCK_SEED,
      })
      let settlementPromise
      try {
        const actors = [ACTORS.approverOne, ACTORS.approverTwo]
        settlementPromise = settleConcurrent([
          () =>
            publishPortal(
              first,
              actors[0],
              start,
              report.reportSha256,
              IDS.approvalOne,
              capability.deployment_capability_id,
              "ff040-approval-one",
            ),
          () =>
            publishPortal(
              second,
              actors[1],
              start,
              report.reportSha256,
              IDS.approvalTwo,
              capability.deployment_capability_id,
              "ff040-approval-two",
            ),
        ])
        const observations = await waitForClientsBlockedBy(
          observer,
          [first, second],
          blocker,
        )
        await releaseHeldLock(held)
        const settlements = await settlementPromise
        assert.equal(fulfilled(settlements).length, 1)
        assert.equal(rejected(settlements).length, 1)
        pgError(
          rejected(settlements)[0].reason,
          "40001",
          "Committed advocate publication does not match the exact replay",
        )
        const winnerIndex = settlements.findIndex(
          (result) => result.status === "fulfilled",
        )
        const winnerActor = actors[winnerIndex]
        const winnerRequestId =
          winnerIndex === 0 ? IDS.approvalOne : IDS.approvalTwo
        const winnerTrace =
          winnerIndex === 0 ? "ff040-approval-one" : "ff040-approval-two"

        const state = await observer.query(
          `SELECT
             approval.request_id::text,
             approval.approving_user_id::text,
             approval.approving_session_id,
             approval.resulting_advocate_version::text,
             advocate.version::text AS current_advocate_version,
             advocate.publication_status,
             domain.status AS domain_status,
             (SELECT count(*)::integer
              FROM audit.advocate_publication_approvals receipt
              WHERE receipt.canary_run_id = $1::uuid) AS approval_count,
             (SELECT count(*)::integer
              FROM private.advocate_publication_deployment_capabilities current_capability
              WHERE current_capability.operation_id = $2::uuid) AS capability_count
           FROM audit.advocate_publication_approvals approval
           JOIN public.advocates advocate
             ON advocate.id = approval.advocate_id
           JOIN public.advocate_domains domain
             ON domain.id = approval.domain_id
           WHERE approval.canary_run_id = $1::uuid`,
          [start.run_id, start.operation_id],
        )
        assert.equal(state.rowCount, 1)
        assert.equal(state.rows[0].request_id, winnerRequestId)
        assert.equal(state.rows[0].approving_user_id, winnerActor.userId)
        assert.equal(state.rows[0].approving_session_id, winnerActor.sessionId)
        assert.equal(
          state.rows[0].resulting_advocate_version,
          String(Number(start.expected_advocate_version) + 1),
        )
        assert.equal(
          state.rows[0].current_advocate_version,
          state.rows[0].resulting_advocate_version,
        )
        assert.equal(state.rows[0].publication_status, "active")
        assert.equal(state.rows[0].domain_status, "active")
        assert.equal(state.rows[0].approval_count, 1)
        assert.equal(state.rows[0].capability_count, 0)
        assert.equal(
          await countAuditValueOccurrences(
            observer,
            capability.deployment_capability_id,
          ),
          0,
        )

        const replayActor = winnerIndex === 0 ? actors[1] : actors[0]
        const replayClient = winnerIndex === 0 ? second : first
        const replay = await publishPortal(
          replayClient,
          replayActor,
          start,
          report.reportSha256,
          winnerRequestId,
          null,
          winnerTrace,
        )
        assert.equal(
          replay.resulting_advocate_version,
          state.rows[0].resulting_advocate_version,
        )
        const finalCount = await observer.query(
          `SELECT count(*)::integer AS approval_count
           FROM audit.advocate_publication_approvals
           WHERE canary_run_id = $1::uuid`,
          [start.run_id],
        )
        assert.equal(finalCount.rows[0].approval_count, 1)

        return {
          scenario: "two_administrator_approval",
          blockedSessions: observations.length,
          committedApprovals: 1,
          loserSqlstate: "40001",
          exactReplays: 1,
        }
      } finally {
        await releaseHeldLock(held).catch(() => undefined)
        if (settlementPromise) await settlementPromise.catch(() => undefined)
      }
    },
  )

  return [completionRace, approvalRace]
}

async function leaseReclaimRace(database, portal) {
  const started = await withClients(database, ["lease_start"], (client) =>
    startPublication(
      client,
      ACTORS.initiator,
      portal,
      IDS.lease,
      DEPLOYMENT_A,
      REVISION_A,
      "ff040-lease-start",
    ),
  )
  const start = await withClients(database, ["lease_start_reader"], (client) =>
    loadStart(client, started.operation_id),
  )
  const initialLease = await withClients(
    database,
    ["lease_initial_claim"],
    async (client) => {
      const claim = await claimExecution(client, start.run_id, 120)
      assert.equal(claim.rowCount, 1)
      return claim.rows[0]
    },
  )

  return withClients(
    database,
    [
      "lease_observer",
      "lease_blocker",
      "lease_reclaimer_one",
      "lease_reclaimer_two",
      "lease_stale_completion",
    ],
    async (observer, blocker, first, second, staleCompletion) => {
      await observer.query(
        `UPDATE audit.advocate_publication_canary_execution_leases
         SET
           leased_at = clock_timestamp() - interval '2 minutes',
           leased_until = clock_timestamp() - interval '1 minute',
           updated_at = clock_timestamp()
         WHERE run_id = $1::uuid`,
        [start.run_id],
      )
      const held = await holdAdvisoryLock(blocker, {
        text: start.run_id,
        seed: RUN_LOCK_SEED,
      })
      let settlementPromise
      try {
        settlementPromise = settleConcurrent([
          () => claimExecution(first, start.run_id, 120),
          () => claimExecution(second, start.run_id, 120),
          () =>
            serviceRoleCall(
              staleCompletion,
              `SELECT *
               FROM public.complete_claimed_advocate_publication_canary(
                 $1::uuid,
                 '{}'::text,
                 decode(repeat('0', 64), 'hex'),
                 'succeeded',
                 NULL,
                 clock_timestamp(),
                 $2::uuid,
                 'ff040-stale-completion',
                 $3::text,
                 $4::uuid
               )`,
              [
                start.run_id,
                randomUUID(),
                ADMIN_REASON,
                initialLease.lease_token,
              ],
            ),
        ])
        const observations = await waitForClientsBlockedBy(
          observer,
          [first, second, staleCompletion],
          blocker,
        )
        await releaseHeldLock(held)
        const settlements = await settlementPromise
        assert.equal(settlements[0].status, "fulfilled")
        assert.equal(settlements[1].status, "fulfilled")
        assert.equal(settlements[2].status, "rejected")
        assert.equal(settlements[2].reason?.code, "40001")
        assert.equal(
          new Set([
            "Publication canary execution lease expired",
            "Publication canary execution lease does not match",
          ]).has(settlements[2].reason?.message),
          true,
        )
        const claims = [settlements[0].value, settlements[1].value]
        assert.deepEqual(claims.map((result) => result.rowCount).sort(), [0, 1])
        const currentLease = await loadLease(observer, start.run_id)
        assert.equal(currentLease.lease_version, 2)
        assert.notEqual(currentLease.lease_token, initialLease.lease_token)
        assert.equal(currentLease.completed_at, null)
        assert.equal(currentLease.completion_request_id, null)
        const beforeCompletion = await observer.query(
          `SELECT count(*)::integer AS report_count
           FROM audit.advocate_publication_canary_reports
           WHERE run_id = $1::uuid`,
          [start.run_id],
        )
        assert.equal(beforeCompletion.rows[0].report_count, 0)

        const completionClient = claims[0].rowCount === 1 ? first : second
        const completed = await completeExecution(
          completionClient,
          start,
          currentLease,
          IDS.leaseCompletion,
        )
        assert.equal(completed.row.outcome, "succeeded")
        const terminal = await observer.query(
          `SELECT
             lease.lease_version::integer,
             lease.completed_at IS NOT NULL AS lease_completed,
             lease.completion_request_id::text,
             count(report.run_id)::integer AS report_count
           FROM audit.advocate_publication_canary_execution_leases lease
           LEFT JOIN audit.advocate_publication_canary_reports report
             ON report.run_id = lease.run_id
           WHERE lease.run_id = $1::uuid
           GROUP BY
             lease.lease_version,
             lease.completed_at,
             lease.completion_request_id`,
          [start.run_id],
        )
        assert.deepEqual(terminal.rows[0], {
          lease_version: 2,
          lease_completed: true,
          completion_request_id: IDS.leaseCompletion,
          report_count: 1,
        })
        return {
          scenario: "lease_reclaim",
          blockedSessions: observations.length,
          leaseVersion: 2,
          successfulReclaims: 1,
          staleCompletionSqlstate: "40001",
          terminalReports: 1,
        }
      } finally {
        await releaseHeldLock(held).catch(() => undefined)
        if (settlementPromise) await settlementPromise.catch(() => undefined)
      }
    },
  )
}

async function deploymentRolloverRace(database, portal) {
  const original = await withClients(database, ["rollover_start"], (client) =>
    startPublication(
      client,
      ACTORS.initiator,
      portal,
      IDS.rollover,
      ROLLOVER_DEPLOYMENT_A,
      ROLLOVER_REVISION_A,
      "ff040-rollover-start",
    ),
  )

  return withClients(
    database,
    [
      "rollover_observer",
      "rollover_authority_blocker",
      "rollover_resume",
      "rollover_fresh",
      "rollover_mint",
      "rollover_original_worker",
      "rollover_new_worker",
    ],
    async (
      observer,
      blocker,
      resumeClient,
      freshClient,
      mintClient,
      originalWorker,
      newWorker,
    ) => {
      const held = await holdAdvisoryLock(
        blocker,
        CREATOR_SHARE_ADMIN_AUTHORITY_LOCK,
      )
      let originalQueueLock
      let newQueueLock
      let settlementPromise
      let queueSettlementPromise
      try {
        settlementPromise = settleConcurrent([
          () =>
            startPublication(
              resumeClient,
              ACTORS.approverOne,
              portal,
              IDS.rollover,
              ROLLOVER_DEPLOYMENT_B,
              ROLLOVER_REVISION_B,
              "ff040-rollover-resume",
            ),
          () =>
            startPublication(
              freshClient,
              ACTORS.approverTwo,
              portal,
              IDS.rolloverFresh,
              ROLLOVER_DEPLOYMENT_B,
              ROLLOVER_REVISION_B,
              "ff040-rollover-fresh",
            ),
        ])
        const observations = await waitForClientsBlockedBy(
          observer,
          [resumeClient, freshClient],
          blocker,
        )
        await releaseHeldLock(held)
        const settlements = await settlementPromise
        assert.equal(fulfilled(settlements).length, 1)
        assert.equal(rejected(settlements).length, 1)
        const resumed = fulfilled(settlements)[0].value
        assert.equal(resumed.created, false)
        assert.equal(resumed.run_id, original.run_id)
        assert.equal(resumed.deployment_id, ROLLOVER_DEPLOYMENT_A)
        assert.equal(resumed.revision, ROLLOVER_REVISION_A)
        pgError(
          rejected(settlements)[0].reason,
          "40001",
          "An advocate publication operation is already in progress",
        )
        const committedStart = await loadStart(observer, IDS.rollover)

        originalQueueLock = await holdAdvisoryLock(blocker, {
          text: `${ROLLOVER_DEPLOYMENT_A}:${ROLLOVER_REVISION_A}`,
          seed: QUEUE_LOCK_SEED,
        })
        newQueueLock = await holdAdvisoryLock(blocker, {
          text: `${ROLLOVER_DEPLOYMENT_B}:${ROLLOVER_REVISION_B}`,
          seed: QUEUE_LOCK_SEED,
        })
        queueSettlementPromise = settleConcurrent([
          () =>
            claimNextExecution(
              originalWorker,
              ROLLOVER_DEPLOYMENT_A,
              ROLLOVER_REVISION_A,
            ),
          () =>
            claimNextExecution(
              newWorker,
              ROLLOVER_DEPLOYMENT_B,
              ROLLOVER_REVISION_B,
            ),
        ])
        const queueObservations = await waitForClientsBlockedBy(
          observer,
          [originalWorker, newWorker],
          blocker,
        )
        await releaseHeldLock(originalQueueLock)
        await releaseHeldLock(newQueueLock)
        const queueSettlements = await queueSettlementPromise
        assert.equal(rejected(queueSettlements).length, 0)
        assert.equal(queueSettlements[0].value.rowCount, 1)
        assert.equal(queueSettlements[1].value.rowCount, 0)
        assert.equal(queueSettlements[0].value.rows[0].run_id, original.run_id)
        assert.equal(
          queueSettlements[0].value.rows[0].start_request_id,
          IDS.rollover,
        )
        assert.equal(
          queueSettlements[0].value.rows[0].deployment_id,
          ROLLOVER_DEPLOYMENT_A,
        )
        assert.equal(
          queueSettlements[0].value.rows[0].revision,
          ROLLOVER_REVISION_A,
        )
        assert.equal(
          queueSettlements[0].value.rows[0].stripe_us_attempt_id,
          committedStart.stripe_us_attempt_id,
        )
        assert.equal(
          queueSettlements[0].value.rows[0].stripe_uk_attempt_id,
          committedStart.stripe_uk_attempt_id,
        )
        assert.equal(
          queueSettlements[0].value.rows[0].paypal_attempt_id,
          committedStart.paypal_attempt_id,
        )

        await assert.rejects(
          serviceRoleCall(
            mintClient,
            `SELECT *
             FROM public.mint_advocate_publication_deployment_capability(
               $1::uuid,
               $2::uuid,
               $3::text,
               $4::text
             )`,
            [
              IDS.rollover,
              original.run_id,
              ROLLOVER_DEPLOYMENT_B,
              ROLLOVER_REVISION_B,
            ],
          ),
          (error) => {
            pgError(
              error,
              "40001",
              "Publication deployment capability does not match the committed operation",
            )
            return true
          },
        )

        const state = await observer.query(
          `SELECT
             count(*)::integer AS start_count,
             count(*) FILTER (
               WHERE start.request_id = $2::uuid
             )::integer AS fresh_start_count,
             count(report.run_id)::integer AS report_count,
             count(approval.canary_run_id)::integer AS approval_count,
             count(lease.run_id)::integer AS lease_count,
             max(lease.lease_version)::integer AS lease_version,
             count(capability.capability_id)::integer AS capability_count
           FROM audit.advocate_publication_canary_starts start
           LEFT JOIN audit.advocate_publication_canary_execution_leases lease
             ON lease.run_id = start.run_id
           LEFT JOIN audit.advocate_publication_canary_reports report
             ON report.run_id = start.run_id
           LEFT JOIN audit.advocate_publication_approvals approval
             ON approval.canary_run_id = start.run_id
           LEFT JOIN private.advocate_publication_deployment_capabilities capability
             ON capability.run_id = start.run_id
           WHERE start.advocate_id = $1::uuid
           GROUP BY start.advocate_id`,
          [portal.advocate_id, IDS.rolloverFresh],
        )
        assert.deepEqual(state.rows[0], {
          start_count: 1,
          fresh_start_count: 0,
          report_count: 0,
          approval_count: 0,
          lease_count: 1,
          lease_version: 1,
          capability_count: 0,
        })
        return {
          scenario: "deployment_rollover",
          blockedSessions: observations.length + queueObservations.length,
          startBlockedSessions: observations.length,
          workerBlockedSessions: queueObservations.length,
          committedStarts: 1,
          originalDeploymentClaims: 1,
          newDeploymentClaims: 0,
          immutableDeploymentBinding: true,
          loserSqlstate: "40001",
        }
      } finally {
        await releaseHeldLock(held).catch(() => undefined)
        if (originalQueueLock) {
          await releaseHeldLock(originalQueueLock).catch(() => undefined)
        }
        if (newQueueLock) {
          await releaseHeldLock(newQueueLock).catch(() => undefined)
        }
        if (settlementPromise) await settlementPromise.catch(() => undefined)
        if (queueSettlementPromise) {
          await queueSettlementPromise.catch(() => undefined)
        }
      }
    },
  )
}

async function main() {
  let database
  const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({
    gate: "FF-040",
    getDatabase: () => database,
  })
  try {
    await clearConcurrencyGateEvidence(EVIDENCE_OUTPUT_PATH)
    database = await createTransientLocalSupabaseDatabase({
      workspace: WORKSPACE,
      databasePrefix: "ff040",
    })
    const provenance = await loadConcurrencyGateProvenance(database, {
      workspace: WORKSPACE,
    })
    const fixtureSql = await readFile(FIXTURE_PATH, "utf8")
    await database.executeSupabaseAdminSql(fixtureSql)

    const portals = await withClients(
      database,
      ["fixture_reader"],
      async (client) => ({
        start: await loadPortal(client, "ff040-start-race"),
        replay: await loadPortal(client, "ff040-replay-race"),
        approval: await loadPortal(client, "ff040-approval-race"),
        lease: await loadPortal(client, "ff040-lease-race"),
        rollover: await loadPortal(client, "ff040-rollover-race"),
      }),
    )

    const scenarios = []
    scenarios.push(await differentOperationStartRace(database, portals.start))
    process.stdout.write("ok FF-040 different operation start race\n")
    scenarios.push(await exactOperationReplayRace(database, portals.replay))
    process.stdout.write("ok FF-040 exact operation replay race\n")
    scenarios.push(
      ...(await completionAndApprovalRaces(database, portals.approval)),
    )
    process.stdout.write("ok FF-040 completion and approval races\n")
    scenarios.push(await leaseReclaimRace(database, portals.lease))
    process.stdout.write("ok FF-040 lease reclaim race\n")
    scenarios.push(await deploymentRolloverRace(database, portals.rollover))
    process.stdout.write("ok FF-040 deployment rollover race\n")

    assert.equal(scenarios.length, 6)
    assert.equal(
      scenarios.every((scenario) => scenario.blockedSessions >= 1),
      true,
    )
    await database.dispose()
    database = undefined
    await writeConcurrencyGateEvidence({
      gate: "FF-040",
      outputPath: EVIDENCE_OUTPUT_PATH,
      provenance,
      scenarios,
    })
    process.stdout.write(
      "FF-040 publication authority concurrency gate passed\n",
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
