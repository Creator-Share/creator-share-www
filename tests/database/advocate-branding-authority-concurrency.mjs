import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
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

const WORKSPACE = resolve(process.cwd())
const FIXTURE_PATH = resolve(
  WORKSPACE,
  "tests/database/fixtures/advocate-branding-authority-concurrency.sql",
)
const ADVOCATE_ID = "ba000000-0000-4000-8000-000000000001"
const ACTOR_USER_ID = "ba100000-0000-4000-8000-000000000002"
const ACTOR_MEMBERSHIP_ID = "ba200000-0000-4000-8000-000000000002"
const BRAND_EDITOR_ROLE_ID = "00000000-0000-4000-8000-000000000003"
const EVIDENCE_OUTPUT_PATH = process.env
  .ADVOCATE_BRANDING_AUTHORITY_CONCURRENCY_EVIDENCE_PATH
  ? resolve(
      process.env.ADVOCATE_BRANDING_AUTHORITY_CONCURRENCY_EVIDENCE_PATH,
    )
  : null
const TERMINATION_PROBE_MODE =
  process.env.ADVOCATE_BRANDING_AUTHORITY_TERMINATION_PROBE
if (TERMINATION_PROBE_MODE !== undefined && TERMINATION_PROBE_MODE !== "1") {
  throw new Error("branding_authority_termination_probe_invalid")
}
const DATABASE_PREFIX =
  process.env.ADVOCATE_BRANDING_AUTHORITY_DATABASE_PREFIX ?? "brandauth"
if (!/^[a-z][a-z0-9]{1,15}$/.test(DATABASE_PREFIX)) {
  throw new Error("branding_authority_database_prefix_invalid")
}

const FF048_EVIDENCE_SCENARIO_SCHEMA = Object.freeze({
  reservation_commits_before_account_ban: Object.freeze({
    scenario: "reservation_commits_before_account_ban",
    blockedSessions: "number",
    reservationCount: "number",
  }),
  account_ban_commits_before_reservation: Object.freeze({
    scenario: "account_ban_commits_before_reservation",
    deniedCode: "42501",
    reservationCount: "number",
    auditCount: "number",
  }),
  branding_commits_before_account_ban: Object.freeze({
    scenario: "branding_commits_before_account_ban",
    blockedSessions: "number",
    auditPresent: "boolean",
  }),
  account_ban_blocks_then_denies_branding: Object.freeze({
    scenario: "account_ban_blocks_then_denies_branding",
    blockedSessions: "number",
    deniedCode: "42501",
    accountBanned: "boolean",
    auditPresent: "boolean",
  }),
  account_ban_commits_before_branding: Object.freeze({
    scenario: "account_ban_commits_before_branding",
    deniedCode: "42501",
    auditPresent: "boolean",
  }),
  branding_commits_before_membership_suspension: Object.freeze({
    scenario: "branding_commits_before_membership_suspension",
    blockedSessions: "number",
    auditPresent: "boolean",
  }),
  membership_suspension_blocks_then_denies_branding: Object.freeze({
    scenario: "membership_suspension_blocks_then_denies_branding",
    blockedSessions: "number",
    deniedCode: "42501",
    membershipSuspended: "boolean",
    auditPresent: "boolean",
  }),
  membership_suspension_commits_before_branding: Object.freeze({
    scenario: "membership_suspension_commits_before_branding",
    deniedCode: "42501",
    auditPresent: "boolean",
  }),
  authority_lock_timeout_is_bounded_and_retryable: Object.freeze({
    scenario: "authority_lock_timeout_is_bounded_and_retryable",
    deniedCode: "55P03",
    elapsedMilliseconds: "number",
    retrySucceeded: "boolean",
  }),
  branding_commits_before_role_removal: Object.freeze({
    scenario: "branding_commits_before_role_removal",
    blockedSessions: "number",
    auditPresent: "boolean",
  }),
  role_removal_blocks_then_denies_reservation: Object.freeze({
    scenario: "role_removal_blocks_then_denies_reservation",
    blockedSessions: "number",
    deniedCode: "42501",
    roleCount: "number",
    reservationCount: "number",
    auditCount: "number",
  }),
  role_removal_commits_before_reservation: Object.freeze({
    scenario: "role_removal_commits_before_reservation",
    deniedCode: "42501",
    reservationCount: "number",
    auditCount: "number",
  }),
})

function assertSanitizedFf048Evidence(scenarios) {
  assert.equal(
    scenarios.length,
    Object.keys(FF048_EVIDENCE_SCENARIO_SCHEMA).length,
  )
  const observedScenarioNames = new Set()
  for (const scenario of scenarios) {
    assert.equal(
      typeof scenario === "object" && scenario !== null && !Array.isArray(scenario),
      true,
    )
    const schema = FF048_EVIDENCE_SCENARIO_SCHEMA[scenario.scenario]
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
        assert.equal(Number.isSafeInteger(scenario[key]) && scenario[key] >= 0, true)
      }
    }
  }
}

function settled(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  )
}

function assertRejectedCode(settlement, code) {
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

async function banActor(client) {
  await client.query("BEGIN")
  return finishTransaction(client, () =>
    client.query(
      `UPDATE auth.users account
       SET banned_until = clock_timestamp() + interval '1 hour'
       WHERE account.id = $1::uuid`,
      [ACTOR_USER_ID],
    ),
  )
}

async function restoreActor(client) {
  await client.query(
    `UPDATE auth.users account
     SET banned_until = NULL
     WHERE account.id = $1::uuid`,
    [ACTOR_USER_ID],
  )
}

async function beginActorBan(client) {
  await client.query("BEGIN")
  try {
    const result = await client.query(
      `UPDATE auth.users account
       SET banned_until = clock_timestamp() + interval '1 hour'
       WHERE account.id = $1::uuid`,
      [ACTOR_USER_ID],
    )
    assert.equal(result.rowCount, 1)
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

async function suspendActorMembership(client) {
  await client.query("BEGIN")
  await client.query("SET LOCAL session_replication_role = replica")
  return finishTransaction(client, () =>
    client.query(
      `UPDATE public.advocate_memberships membership
       SET
         status = 'suspended',
         version = membership.version + 1
       WHERE membership.id = $1::uuid
         AND membership.advocate_id = $2::uuid`,
      [ACTOR_MEMBERSHIP_ID, ADVOCATE_ID],
    ),
  )
}

async function restoreActorMembership(client) {
  await client.query("BEGIN")
  await client.query("SET LOCAL session_replication_role = replica")
  await finishTransaction(client, () =>
    client.query(
      `UPDATE public.advocate_memberships membership
       SET
         status = 'active',
         version = membership.version + 1
       WHERE membership.id = $1::uuid
         AND membership.advocate_id = $2::uuid`,
      [ACTOR_MEMBERSHIP_ID, ADVOCATE_ID],
    ),
  )
}

async function beginActorMembershipSuspension(client) {
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL session_replication_role = replica")
    const result = await client.query(
      `UPDATE public.advocate_memberships membership
       SET
         status = 'suspended',
         version = membership.version + 1
       WHERE membership.id = $1::uuid
         AND membership.advocate_id = $2::uuid`,
      [ACTOR_MEMBERSHIP_ID, ADVOCATE_ID],
    )
    assert.equal(result.rowCount, 1)
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

async function removeActorBrandingRole(client) {
  await client.query("BEGIN")
  // Disabling statement triggers isolates the exact role-row lock. Production
  // role removal also advances the membership version, which would otherwise
  // make the membership lock the first observable blocker.
  await client.query("SET LOCAL session_replication_role = replica")
  return finishTransaction(client, () =>
    client.query(
      `DELETE FROM public.advocate_membership_roles membership_role
       WHERE membership_role.advocate_id = $1::uuid
         AND membership_role.membership_id = $2::uuid
         AND membership_role.role_id = $3::uuid`,
      [ADVOCATE_ID, ACTOR_MEMBERSHIP_ID, BRAND_EDITOR_ROLE_ID],
    ),
  )
}

async function restoreActorBrandingRole(client) {
  await client.query("BEGIN")
  await client.query("SET LOCAL session_replication_role = replica")
  await finishTransaction(client, async () => {
    const result = await client.query(
      `INSERT INTO public.advocate_membership_roles (
         advocate_id,
         membership_id,
         role_id,
         assigned_by_user_id
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
      [
        ADVOCATE_ID,
        ACTOR_MEMBERSHIP_ID,
        BRAND_EDITOR_ROLE_ID,
        "ba100000-0000-4000-8000-000000000001",
      ],
    )
    assert.equal(result.rowCount, 1)
    return result
  })
}

async function beginActorBrandingRoleRemoval(client) {
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL session_replication_role = replica")
    const result = await client.query(
      `DELETE FROM public.advocate_membership_roles membership_role
       WHERE membership_role.advocate_id = $1::uuid
         AND membership_role.membership_id = $2::uuid
         AND membership_role.role_id = $3::uuid`,
      [ADVOCATE_ID, ACTOR_MEMBERSHIP_ID, BRAND_EDITOR_ROLE_ID],
    )
    assert.equal(result.rowCount, 1)
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

async function currentAdvocateVersion(client) {
  const result = await client.query(
    `SELECT advocate.version::text
     FROM public.advocates advocate
     WHERE advocate.id = $1::uuid`,
    [ADVOCATE_ID],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0].version
}

async function reservationBeforeBan(database) {
  return withPgClients(
    database,
    ["authority_reservation", "authority_ban", "authority_observer"],
    async (reservationClient, banClient, observerClient) => {
      const expectedVersion = await currentAdvocateVersion(observerClient)
      await configureServiceRoleTransaction(reservationClient)
      const reservation = await reservationClient.query(
        `SELECT reservation_id::text, object_path
         FROM public.reserve_advocate_logo_upload(
           $1::uuid,
           $2::uuid,
           $3::bigint,
           'authority-reservation-before-ban',
           NULL
         )`,
        [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
      )
      assert.equal(reservation.rowCount, 1)

      const pendingBan = banActor(banClient)
      const observations = await waitForClientsBlockedBy(
        observerClient,
        [banClient],
        reservationClient,
      )
      assert.equal(observations.length, 1)
      assert.equal(observations[0].waitEventType, "Lock")

      await reservationClient.query("COMMIT")
      await pendingBan

      const committed = await observerClient.query(
        `SELECT
           count(*)::integer AS reservation_count,
           count(*) FILTER (
             WHERE reservation.status = 'pending'
           )::integer AS pending_count
         FROM private.advocate_logo_upload_reservations reservation
         WHERE reservation.request_id = 'authority-reservation-before-ban'`,
      )
      assert.deepEqual(committed.rows[0], {
        reservation_count: 1,
        pending_count: 1,
      })

      return Object.freeze({
        scenario: "reservation_commits_before_account_ban",
        blockedSessions: observations.length,
        reservationCount: 1,
      })
    },
  )
}

async function bannedActorLeavesNoReservation(database) {
  return withPgClients(
    database,
    ["authority_banned_reservation", "authority_banned_assertion"],
    async (reservationClient, assertionClient) => {
      const expectedVersion = await currentAdvocateVersion(assertionClient)
      await assert.rejects(
        serviceRoleCall(reservationClient, () =>
          reservationClient.query(
            `SELECT *
             FROM public.reserve_advocate_logo_upload(
               $1::uuid,
               $2::uuid,
               $3::bigint,
               'authority-reservation-after-ban',
               NULL
             )`,
            [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
          ),
        ),
        (error) => error?.code === "42501",
      )

      const residue = await assertionClient.query(
        `SELECT
           (
             SELECT count(*)::integer
             FROM private.advocate_logo_upload_reservations reservation
             WHERE reservation.request_id = 'authority-reservation-after-ban'
           ) AS reservation_count,
           (
             SELECT count(*)::integer
             FROM audit.audit_events event
             WHERE event.request_id = 'authority-reservation-after-ban'
           ) AS audit_count`,
      )
      assert.deepEqual(residue.rows[0], {
        reservation_count: 0,
        audit_count: 0,
      })

      return Object.freeze({
        scenario: "account_ban_commits_before_reservation",
        deniedCode: "42501",
        reservationCount: 0,
        auditCount: 0,
      })
    },
  )
}

async function brandingBeforeBan(database) {
  return withPgClients(
    database,
    [
      "authority_branding",
      "authority_branding_ban",
      "authority_branding_observer",
    ],
    async (brandingClient, banClient, observerClient) => {
      await restoreActor(observerClient)
      const expectedVersion = await currentAdvocateVersion(observerClient)
      await configureServiceRoleTransaction(brandingClient)
      const branding = await brandingClient.query(
        `SELECT public.update_advocate_branding(
           $1::uuid,
           $2::uuid,
           $3::bigint,
           '#123456',
           '#ABCDEF',
           NULL,
           NULL,
           NULL,
           '<h2>Locked authority</h2>',
           '<p>Locked authority</p>',
           'Prove account authority remains locked through commit',
           'authority-branding-before-ban',
           NULL,
           NULL
         )::text AS resulting_version`,
        [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
      )
      assert.equal(branding.rowCount, 1)
      assert.equal(
        branding.rows[0].resulting_version,
        (BigInt(expectedVersion) + 1n).toString(),
      )

      const pendingBan = banActor(banClient)
      const observations = await waitForClientsBlockedBy(
        observerClient,
        [banClient],
        brandingClient,
      )
      assert.equal(observations.length, 1)
      assert.equal(observations[0].waitEventType, "Lock")

      await brandingClient.query("COMMIT")
      await pendingBan

      const committed = await observerClient.query(
        `SELECT
           advocate.version::text,
           branding.opening_header_html,
           EXISTS (
             SELECT 1
             FROM audit.audit_events event
             WHERE event.advocate_id = advocate.id
               AND event.request_id = 'authority-branding-before-ban'
           ) AS audit_present
         FROM public.advocates advocate
         JOIN public.advocate_branding branding
           ON branding.advocate_id = advocate.id
         WHERE advocate.id = $1::uuid`,
        [ADVOCATE_ID],
      )
      assert.deepEqual(committed.rows[0], {
        version: (BigInt(expectedVersion) + 1n).toString(),
        opening_header_html: "<h2>Locked authority</h2>",
        audit_present: true,
      })

      return Object.freeze({
        scenario: "branding_commits_before_account_ban",
        blockedSessions: observations.length,
        auditPresent: true,
      })
    },
  )
}

async function accountBanBlocksThenDeniesBranding(database) {
  return withPgClients(
    database,
    [
      "authority_pending_ban",
      "authority_branding_after_pending_ban",
      "authority_pending_ban_observer",
    ],
    async (banClient, brandingClient, observerClient) => {
      await restoreActor(observerClient)
      const expectedVersion = await currentAdvocateVersion(observerClient)
      await beginActorBan(banClient)
      let banCommitted = false
      const pendingBranding = settled(
        serviceRoleCall(brandingClient, () =>
          brandingClient.query(
            `SELECT public.update_advocate_branding(
               $1::uuid,
               $2::uuid,
               $3::bigint,
               '#654321',
               '#FEDCBA',
               NULL,
               NULL,
               NULL,
               '<h2>Pending ban loser</h2>',
               '<p>Pending ban loser</p>',
               'An account ban already in flight must deny branding',
               'authority-branding-after-pending-ban',
               NULL,
               NULL
             )`,
            [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
          ),
        ),
      )

      try {
        const observations = await waitForClientsBlockedBy(
          observerClient,
          [brandingClient],
          banClient,
        )
        assert.equal(observations.length, 1)
        assert.equal(observations[0].waitEventType, "Lock")

        await banClient.query("COMMIT")
        banCommitted = true
        const brandingSettlement = await pendingBranding
        assertRejectedCode(brandingSettlement, "42501")

        const residue = await observerClient.query(
          `SELECT
             advocate.version::text,
             branding.opening_header_html,
             account.banned_until > clock_timestamp() AS account_banned,
             EXISTS (
               SELECT 1
               FROM audit.audit_events event
               WHERE event.advocate_id = advocate.id
                 AND event.request_id =
                   'authority-branding-after-pending-ban'
             ) AS audit_present
           FROM public.advocates advocate
           JOIN public.advocate_branding branding
             ON branding.advocate_id = advocate.id
           JOIN auth.users account
             ON account.id = $2::uuid
           WHERE advocate.id = $1::uuid`,
          [ADVOCATE_ID, ACTOR_USER_ID],
        )
        assert.deepEqual(residue.rows[0], {
          version: expectedVersion,
          opening_header_html: "<h2>Locked authority</h2>",
          account_banned: true,
          audit_present: false,
        })

        return Object.freeze({
          scenario: "account_ban_blocks_then_denies_branding",
          blockedSessions: observations.length,
          deniedCode: "42501",
          accountBanned: true,
          auditPresent: false,
        })
      } finally {
        if (!banCommitted) {
          await banClient.query("ROLLBACK").catch(() => undefined)
        }
        await pendingBranding
      }
    },
  )
}

async function bannedActorLeavesNoBranding(database) {
  return withPgClients(
    database,
    ["authority_banned_branding", "authority_branding_assertion"],
    async (brandingClient, assertionClient) => {
      const expectedVersion = await currentAdvocateVersion(assertionClient)
      await assert.rejects(
        serviceRoleCall(brandingClient, () =>
          brandingClient.query(
            `SELECT public.update_advocate_branding(
               $1::uuid,
               $2::uuid,
               $3::bigint,
               '#654321',
               '#FEDCBA',
               NULL,
               NULL,
               NULL,
               '<h2>Denied authority</h2>',
               '<p>Denied authority</p>',
               'A completed account ban must deny branding',
               'authority-branding-after-ban',
               NULL,
               NULL
             )`,
            [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
          ),
        ),
        (error) => error?.code === "42501",
      )

      const residue = await assertionClient.query(
        `SELECT
           advocate.version::text,
           branding.opening_header_html,
           EXISTS (
             SELECT 1
             FROM audit.audit_events event
             WHERE event.advocate_id = advocate.id
               AND event.request_id = 'authority-branding-after-ban'
           ) AS audit_present
         FROM public.advocates advocate
         JOIN public.advocate_branding branding
           ON branding.advocate_id = advocate.id
         WHERE advocate.id = $1::uuid`,
        [ADVOCATE_ID],
      )
      assert.deepEqual(residue.rows[0], {
        version: expectedVersion,
        opening_header_html: "<h2>Locked authority</h2>",
        audit_present: false,
      })

      return Object.freeze({
        scenario: "account_ban_commits_before_branding",
        deniedCode: "42501",
        auditPresent: false,
      })
    },
  )
}

async function brandingBeforeMembershipSuspension(database) {
  return withPgClients(
    database,
    [
      "authority_membership_branding",
      "authority_membership_suspension",
      "authority_membership_observer",
    ],
    async (brandingClient, suspensionClient, observerClient) => {
      await restoreActor(observerClient)
      const expectedVersion = await currentAdvocateVersion(observerClient)
      await configureServiceRoleTransaction(brandingClient)
      const branding = await brandingClient.query(
        `SELECT public.update_advocate_branding(
           $1::uuid,
           $2::uuid,
           $3::bigint,
           '#234567',
           '#BCDEF0',
           NULL,
           NULL,
           NULL,
           '<h2>Membership lock winner</h2>',
           '<p>Membership lock winner</p>',
           'Prove branding authority remains locked through membership suspension',
           'authority-branding-before-membership-suspension',
           NULL,
           NULL
         )::text AS resulting_version`,
        [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
      )
      assert.equal(branding.rowCount, 1)
      assert.equal(
        branding.rows[0].resulting_version,
        (BigInt(expectedVersion) + 1n).toString(),
      )

      const pendingSuspension = suspendActorMembership(suspensionClient)
      const observations = await waitForClientsBlockedBy(
        observerClient,
        [suspensionClient],
        brandingClient,
      )
      assert.equal(observations.length, 1)
      assert.equal(observations[0].waitEventType, "Lock")

      await brandingClient.query("COMMIT")
      await pendingSuspension

      const committed = await observerClient.query(
        `SELECT
           advocate.version::text,
           branding.opening_header_html,
           membership.status::text AS membership_status,
           EXISTS (
             SELECT 1
             FROM audit.audit_events event
             WHERE event.advocate_id = advocate.id
               AND event.request_id =
                 'authority-branding-before-membership-suspension'
           ) AS audit_present
         FROM public.advocates advocate
         JOIN public.advocate_branding branding
           ON branding.advocate_id = advocate.id
         JOIN public.advocate_memberships membership
           ON membership.id = $2::uuid
          AND membership.advocate_id = advocate.id
         WHERE advocate.id = $1::uuid`,
        [ADVOCATE_ID, ACTOR_MEMBERSHIP_ID],
      )
      assert.deepEqual(committed.rows[0], {
        version: (BigInt(expectedVersion) + 1n).toString(),
        opening_header_html: "<h2>Membership lock winner</h2>",
        membership_status: "suspended",
        audit_present: true,
      })

      return Object.freeze({
        scenario: "branding_commits_before_membership_suspension",
        blockedSessions: observations.length,
        auditPresent: true,
      })
    },
  )
}

async function membershipSuspensionBlocksThenDeniesBranding(database) {
  return withPgClients(
    database,
    [
      "authority_pending_membership_suspension",
      "authority_branding_after_pending_membership_suspension",
      "authority_pending_membership_observer",
    ],
    async (suspensionClient, brandingClient, observerClient) => {
      await restoreActorMembership(observerClient)
      const expectedVersion = await currentAdvocateVersion(observerClient)
      await beginActorMembershipSuspension(suspensionClient)
      let suspensionCommitted = false
      const pendingBranding = settled(
        serviceRoleCall(brandingClient, () =>
          brandingClient.query(
            `SELECT public.update_advocate_branding(
               $1::uuid,
               $2::uuid,
               $3::bigint,
               '#345678',
               '#CDEF01',
               NULL,
               NULL,
               NULL,
               '<h2>Pending membership suspension loser</h2>',
               '<p>Pending membership suspension loser</p>',
               'A membership suspension already in flight must deny branding',
               'authority-branding-after-pending-membership-suspension',
               NULL,
               NULL
             )`,
            [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
          ),
        ),
      )

      try {
        const observations = await waitForClientsBlockedBy(
          observerClient,
          [brandingClient],
          suspensionClient,
        )
        assert.equal(observations.length, 1)
        assert.equal(observations[0].waitEventType, "Lock")

        await suspensionClient.query("COMMIT")
        suspensionCommitted = true
        const brandingSettlement = await pendingBranding
        assertRejectedCode(brandingSettlement, "42501")

        const residue = await observerClient.query(
          `SELECT
             advocate.version::text,
             branding.opening_header_html,
             membership.status::text AS membership_status,
             EXISTS (
               SELECT 1
               FROM audit.audit_events event
               WHERE event.advocate_id = advocate.id
                 AND event.request_id =
                   'authority-branding-after-pending-membership-suspension'
             ) AS audit_present
           FROM public.advocates advocate
           JOIN public.advocate_branding branding
             ON branding.advocate_id = advocate.id
           JOIN public.advocate_memberships membership
             ON membership.id = $2::uuid
            AND membership.advocate_id = advocate.id
           WHERE advocate.id = $1::uuid`,
          [ADVOCATE_ID, ACTOR_MEMBERSHIP_ID],
        )
        assert.deepEqual(residue.rows[0], {
          version: expectedVersion,
          opening_header_html: "<h2>Membership lock winner</h2>",
          membership_status: "suspended",
          audit_present: false,
        })

        return Object.freeze({
          scenario: "membership_suspension_blocks_then_denies_branding",
          blockedSessions: observations.length,
          deniedCode: "42501",
          membershipSuspended: true,
          auditPresent: false,
        })
      } finally {
        if (!suspensionCommitted) {
          await suspensionClient.query("ROLLBACK").catch(() => undefined)
        }
        await pendingBranding
      }
    },
  )
}

async function suspendedMembershipLeavesNoBranding(database) {
  return withPgClients(
    database,
    ["authority_suspended_branding", "authority_suspended_assertion"],
    async (brandingClient, assertionClient) => {
      const expectedVersion = await currentAdvocateVersion(assertionClient)
      await assert.rejects(
        serviceRoleCall(brandingClient, () =>
          brandingClient.query(
            `SELECT public.update_advocate_branding(
               $1::uuid,
               $2::uuid,
               $3::bigint,
               '#345678',
               '#CDEF01',
               NULL,
               NULL,
               NULL,
               '<h2>Suspended membership loser</h2>',
               '<p>Suspended membership loser</p>',
               'A completed membership suspension must deny branding',
               'authority-branding-after-membership-suspension',
               NULL,
               NULL
             )`,
            [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
          ),
        ),
        (error) => error?.code === "42501",
      )

      const residue = await assertionClient.query(
        `SELECT
           advocate.version::text,
           branding.opening_header_html,
           EXISTS (
             SELECT 1
             FROM audit.audit_events event
             WHERE event.advocate_id = advocate.id
               AND event.request_id =
                 'authority-branding-after-membership-suspension'
           ) AS audit_present
         FROM public.advocates advocate
         JOIN public.advocate_branding branding
           ON branding.advocate_id = advocate.id
         WHERE advocate.id = $1::uuid`,
        [ADVOCATE_ID],
      )
      assert.deepEqual(residue.rows[0], {
        version: expectedVersion,
        opening_header_html: "<h2>Membership lock winner</h2>",
        audit_present: false,
      })

      await restoreActorMembership(assertionClient)
      return Object.freeze({
        scenario: "membership_suspension_commits_before_branding",
        deniedCode: "42501",
        auditPresent: false,
      })
    },
  )
}

async function authorityLockTimeoutIsBounded(database) {
  return withPgClients(
    database,
    [
      "authority_timeout_blocker",
      "authority_timeout_branding",
      "authority_timeout_assertion",
    ],
    async (blockerClient, brandingClient, assertionClient) => {
      const expectedVersion = await currentAdvocateVersion(assertionClient)
      await blockerClient.query("BEGIN")
      await blockerClient.query(
        `UPDATE auth.users account
         SET updated_at = clock_timestamp()
         WHERE account.id = $1::uuid`,
        [ACTOR_USER_ID],
      )

      const startedAt = performance.now()
      try {
        await assert.rejects(
          serviceRoleCall(brandingClient, () =>
            brandingClient.query(
              `SELECT public.update_advocate_branding(
                 $1::uuid,
                 $2::uuid,
                 $3::bigint,
                 '#56789A',
                 '#EF0123',
                 NULL,
                 NULL,
                 NULL,
                 '<h2>Timed out authority</h2>',
                 '<p>Timed out authority</p>',
                 'A stale account lock must not pin branding indefinitely',
                 'authority-branding-lock-timeout',
                 NULL,
                 NULL
               )`,
              [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
            ),
          ),
          (error) => error?.code === "55P03",
        )
      } finally {
        await blockerClient.query("ROLLBACK").catch(() => undefined)
      }
      const elapsedMilliseconds = performance.now() - startedAt
      assert.ok(elapsedMilliseconds >= 4_500)
      assert.ok(elapsedMilliseconds < 10_000)

      const residue = await assertionClient.query(
        `SELECT
           advocate.version::text,
           branding.opening_header_html,
           EXISTS (
             SELECT 1
             FROM audit.audit_events event
             WHERE event.advocate_id = advocate.id
               AND event.request_id = 'authority-branding-lock-timeout'
           ) AS audit_present
         FROM public.advocates advocate
         JOIN public.advocate_branding branding
           ON branding.advocate_id = advocate.id
         WHERE advocate.id = $1::uuid`,
        [ADVOCATE_ID],
      )
      assert.deepEqual(residue.rows[0], {
        version: expectedVersion,
        opening_header_html: "<h2>Membership lock winner</h2>",
        audit_present: false,
      })

      const retry = await serviceRoleCall(brandingClient, () =>
        brandingClient.query(
          `SELECT public.update_advocate_branding(
             $1::uuid,
             $2::uuid,
             $3::bigint,
             '#56789A',
             '#EF0123',
             NULL,
             NULL,
             NULL,
             '<h2>Timeout retry succeeds</h2>',
             '<p>Timeout retry succeeds</p>',
             'Retry after the stale account lock is released',
             'authority-branding-after-lock-timeout',
             NULL,
             NULL
           )::text AS resulting_version`,
          [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
        ),
      )
      assert.equal(retry.rowCount, 1)
      assert.equal(
        retry.rows[0].resulting_version,
        (BigInt(expectedVersion) + 1n).toString(),
      )

      const committedRetry = await assertionClient.query(
        `SELECT
           advocate.version::text,
           branding.opening_header_html,
           EXISTS (
             SELECT 1
             FROM audit.audit_events event
             WHERE event.advocate_id = advocate.id
               AND event.request_id = 'authority-branding-after-lock-timeout'
           ) AS audit_present
         FROM public.advocates advocate
         JOIN public.advocate_branding branding
           ON branding.advocate_id = advocate.id
         WHERE advocate.id = $1::uuid`,
        [ADVOCATE_ID],
      )
      assert.deepEqual(committedRetry.rows[0], {
        version: (BigInt(expectedVersion) + 1n).toString(),
        opening_header_html: "<h2>Timeout retry succeeds</h2>",
        audit_present: true,
      })

      return Object.freeze({
        scenario: "authority_lock_timeout_is_bounded_and_retryable",
        deniedCode: "55P03",
        elapsedMilliseconds: Math.round(elapsedMilliseconds),
        retrySucceeded: true,
      })
    },
  )
}

async function brandingBeforeRoleRemoval(database) {
  return withPgClients(
    database,
    [
      "authority_role_branding",
      "authority_role_removal",
      "authority_role_observer",
    ],
    async (brandingClient, roleClient, observerClient) => {
      const expectedVersion = await currentAdvocateVersion(observerClient)
      await configureServiceRoleTransaction(brandingClient)
      const branding = await brandingClient.query(
        `SELECT public.update_advocate_branding(
           $1::uuid,
           $2::uuid,
           $3::bigint,
           '#456789',
           '#DEF012',
           NULL,
           NULL,
           NULL,
           '<h2>Role lock winner</h2>',
           '<p>Role lock winner</p>',
           'Prove branding authority remains locked through role removal',
           'authority-branding-before-role-removal',
           NULL,
           NULL
         )::text AS resulting_version`,
        [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
      )
      assert.equal(branding.rowCount, 1)
      assert.equal(
        branding.rows[0].resulting_version,
        (BigInt(expectedVersion) + 1n).toString(),
      )

      const pendingRemoval = removeActorBrandingRole(roleClient)
      const observations = await waitForClientsBlockedBy(
        observerClient,
        [roleClient],
        brandingClient,
      )
      assert.equal(observations.length, 1)
      assert.equal(observations[0].waitEventType, "Lock")

      await brandingClient.query("COMMIT")
      await pendingRemoval

      const committed = await observerClient.query(
        `SELECT
           advocate.version::text,
           branding.opening_header_html,
           (
             SELECT count(*)::integer
             FROM public.advocate_membership_roles membership_role
             WHERE membership_role.advocate_id = advocate.id
               AND membership_role.membership_id = $2::uuid
               AND membership_role.role_id = $3::uuid
           ) AS role_count,
           EXISTS (
             SELECT 1
             FROM audit.audit_events event
             WHERE event.advocate_id = advocate.id
               AND event.request_id = 'authority-branding-before-role-removal'
           ) AS audit_present
         FROM public.advocates advocate
         JOIN public.advocate_branding branding
           ON branding.advocate_id = advocate.id
         WHERE advocate.id = $1::uuid`,
        [ADVOCATE_ID, ACTOR_MEMBERSHIP_ID, BRAND_EDITOR_ROLE_ID],
      )
      assert.deepEqual(committed.rows[0], {
        version: (BigInt(expectedVersion) + 1n).toString(),
        opening_header_html: "<h2>Role lock winner</h2>",
        role_count: 0,
        audit_present: true,
      })

      return Object.freeze({
        scenario: "branding_commits_before_role_removal",
        blockedSessions: observations.length,
        auditPresent: true,
      })
    },
  )
}

async function roleRemovalBlocksThenDeniesReservation(database) {
  return withPgClients(
    database,
    [
      "authority_pending_role_removal",
      "authority_reservation_after_pending_role_removal",
      "authority_pending_role_observer",
    ],
    async (roleClient, reservationClient, observerClient) => {
      await restoreActorBrandingRole(observerClient)
      const expectedVersion = await currentAdvocateVersion(observerClient)
      await beginActorBrandingRoleRemoval(roleClient)
      let removalCommitted = false
      const pendingReservation = settled(
        serviceRoleCall(reservationClient, () =>
          reservationClient.query(
            `SELECT *
             FROM public.reserve_advocate_logo_upload(
               $1::uuid,
               $2::uuid,
               $3::bigint,
               'authority-reservation-after-pending-role-removal',
               NULL
             )`,
            [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
          ),
        ),
      )

      try {
        const observations = await waitForClientsBlockedBy(
          observerClient,
          [reservationClient],
          roleClient,
        )
        assert.equal(observations.length, 1)
        assert.equal(observations[0].waitEventType, "Lock")

        await roleClient.query("COMMIT")
        removalCommitted = true
        const reservationSettlement = await pendingReservation
        assertRejectedCode(reservationSettlement, "42501")

        const residue = await observerClient.query(
          `SELECT
             advocate.version::text,
             (
               SELECT count(*)::integer
               FROM public.advocate_membership_roles membership_role
               WHERE membership_role.advocate_id = advocate.id
                 AND membership_role.membership_id = $2::uuid
                 AND membership_role.role_id = $3::uuid
             ) AS role_count,
             (
               SELECT count(*)::integer
               FROM private.advocate_logo_upload_reservations reservation
               WHERE reservation.request_id =
                 'authority-reservation-after-pending-role-removal'
             ) AS reservation_count,
             (
               SELECT count(*)::integer
               FROM audit.audit_events event
               WHERE event.request_id =
                 'authority-reservation-after-pending-role-removal'
             ) AS audit_count
           FROM public.advocates advocate
           WHERE advocate.id = $1::uuid`,
          [ADVOCATE_ID, ACTOR_MEMBERSHIP_ID, BRAND_EDITOR_ROLE_ID],
        )
        assert.deepEqual(residue.rows[0], {
          version: expectedVersion,
          role_count: 0,
          reservation_count: 0,
          audit_count: 0,
        })

        return Object.freeze({
          scenario: "role_removal_blocks_then_denies_reservation",
          blockedSessions: observations.length,
          deniedCode: "42501",
          roleCount: 0,
          reservationCount: 0,
          auditCount: 0,
        })
      } finally {
        if (!removalCommitted) {
          await roleClient.query("ROLLBACK").catch(() => undefined)
        }
        await pendingReservation
      }
    },
  )
}

async function missingRoleLeavesNoReservation(database) {
  return withPgClients(
    database,
    ["authority_missing_role_reservation", "authority_role_assertion"],
    async (reservationClient, assertionClient) => {
      const expectedVersion = await currentAdvocateVersion(assertionClient)
      await assert.rejects(
        serviceRoleCall(reservationClient, () =>
          reservationClient.query(
            `SELECT *
             FROM public.reserve_advocate_logo_upload(
               $1::uuid,
               $2::uuid,
               $3::bigint,
               'authority-reservation-after-role-removal',
               NULL
             )`,
            [ADVOCATE_ID, ACTOR_USER_ID, expectedVersion],
          ),
        ),
        (error) => error?.code === "42501",
      )

      const residue = await assertionClient.query(
        `SELECT
           (
             SELECT count(*)::integer
             FROM private.advocate_logo_upload_reservations reservation
             WHERE reservation.request_id =
               'authority-reservation-after-role-removal'
           ) AS reservation_count,
           (
             SELECT count(*)::integer
             FROM audit.audit_events event
             WHERE event.request_id =
               'authority-reservation-after-role-removal'
           ) AS audit_count`,
      )
      assert.deepEqual(residue.rows[0], {
        reservation_count: 0,
        audit_count: 0,
      })

      return Object.freeze({
        scenario: "role_removal_commits_before_reservation",
        deniedCode: "42501",
        reservationCount: 0,
        auditCount: 0,
      })
    },
  )
}

async function waitForTerminationProbe(database) {
  if (TERMINATION_PROBE_MODE !== "1") return
  await withPgClients(
    database,
    ["termination_blocker", "termination_waiter", "termination_observer"],
    async (blockerClient, waiterClient, observerClient) => {
      await blockerClient.query("BEGIN")
      await blockerClient.query(
        "SELECT pg_catalog.pg_advisory_xact_lock(48048)",
      )
      await waiterClient.query("BEGIN")
      const pendingWait = waiterClient.query(
        "SELECT pg_catalog.pg_advisory_xact_lock(48048)",
      )
      pendingWait.catch(() => undefined)
      const observations = await waitForClientsBlockedBy(
        observerClient,
        [waiterClient],
        blockerClient,
      )
      assert.equal(observations.length, 1)
      assert.equal(observations[0].waitEventType, "Lock")
      process.stdout.write("FF-048 termination probe ready\n")
      await new Promise(() => {
        setInterval(() => undefined, 1_000)
      })
    },
  )
}

async function main() {
  let database
  const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({
    gate: "FF-048",
    getDatabase: () => database,
  })
  try {
    await clearConcurrencyGateEvidence(EVIDENCE_OUTPUT_PATH)
    database = await createTransientLocalSupabaseDatabase({
      workspace: WORKSPACE,
      databasePrefix: DATABASE_PREFIX,
    })
    const provenance = await loadConcurrencyGateProvenance(database, {
      workspace: WORKSPACE,
    })
    await database.executeSupabaseAdminSql(await readFile(FIXTURE_PATH, "utf8"))
    await waitForTerminationProbe(database)

    const scenarios = []
    scenarios.push(await reservationBeforeBan(database))
    process.stdout.write("ok branding authority reservation before ban\n")
    scenarios.push(await bannedActorLeavesNoReservation(database))
    process.stdout.write("ok branding authority ban before reservation\n")
    scenarios.push(await brandingBeforeBan(database))
    process.stdout.write("ok branding authority mutation before ban\n")
    scenarios.push(await accountBanBlocksThenDeniesBranding(database))
    process.stdout.write("ok branding authority pending ban before mutation\n")
    scenarios.push(await bannedActorLeavesNoBranding(database))
    process.stdout.write("ok branding authority ban before mutation\n")
    scenarios.push(await brandingBeforeMembershipSuspension(database))
    process.stdout.write(
      "ok branding authority mutation before membership suspension\n",
    )
    scenarios.push(
      await membershipSuspensionBlocksThenDeniesBranding(database),
    )
    process.stdout.write(
      "ok branding authority pending membership suspension before mutation\n",
    )
    scenarios.push(await suspendedMembershipLeavesNoBranding(database))
    process.stdout.write(
      "ok branding authority membership suspension before mutation\n",
    )
    scenarios.push(await authorityLockTimeoutIsBounded(database))
    process.stdout.write("ok branding authority lock timeout and retry\n")
    scenarios.push(await brandingBeforeRoleRemoval(database))
    process.stdout.write("ok branding authority mutation before role removal\n")
    scenarios.push(await roleRemovalBlocksThenDeniesReservation(database))
    process.stdout.write(
      "ok branding authority pending role removal before reservation\n",
    )
    scenarios.push(await missingRoleLeavesNoReservation(database))
    process.stdout.write(
      "ok branding authority role removal before reservation\n",
    )

    assert.equal(scenarios.length, 12)
    assert.equal(
      scenarios.reduce(
        (count, scenario) => count + (scenario.blockedSessions ?? 0),
        0,
      ),
      7,
    )
    assertSanitizedFf048Evidence(scenarios)
    await database.dispose()
    database = undefined
    await writeConcurrencyGateEvidence({
      gate: "FF-048",
      outputPath: EVIDENCE_OUTPUT_PATH,
      provenance,
      synchronization: "server_observed_authority_lock_blocking",
      scenarios,
    })
    process.stdout.write("FF-048 branding authority concurrency gate passed\n")
  } finally {
    try {
      if (database) await database.dispose()
    } finally {
      removeTerminationCleanup()
    }
  }
}

await main()
