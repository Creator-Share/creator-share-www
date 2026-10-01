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
  configureFreshEmailOtpAuthenticatedTransaction,
  configureServiceRoleTransaction,
  createTransientLocalSupabaseDatabase,
} from "./support/local-supabase.mjs"
import { waitForClientsBlockedBy } from "./support/postgres-barrier.mjs"

const WORKSPACE = resolve(process.cwd())
const FIXTURE_PATH = resolve(
  WORKSPACE,
  "tests/database/fixtures/advocate-initial-owner-concurrency.sql",
)
const OWNER_EMAIL = "ff039-owner@example.test"
const OWNER_ROLE_ID = "00000000-0000-4000-8000-000000000001"
const ADMIN_REASON = "Exercise the FF-039 initial owner authority gate"
const AUDIT_TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/
const EXPECTED_PROVISIONING_TOPOLOGY = Object.freeze([
  Object.freeze({ provider: "cloudflare", environment: "production" }),
  Object.freeze({ provider: "vercel", environment: "production" }),
  Object.freeze({ provider: "stripe_us", environment: "live" }),
  Object.freeze({ provider: "stripe_uk", environment: "live" }),
  Object.freeze({ provider: "paypal", environment: "live" }),
])

const ACTORS = Object.freeze({
  adminOne: Object.freeze({
    userId: "f0390000-0000-4000-8000-000000000001",
    sessionId: "f0391000-0000-4000-8000-000000000001",
  }),
  adminTwo: Object.freeze({
    userId: "f0390000-0000-4000-8000-000000000002",
    sessionId: "f0391000-0000-4000-8000-000000000002",
  }),
  owner: Object.freeze({
    userId: "f0390000-0000-4000-8000-000000000003",
    sessionId: "f0391000-0000-4000-8000-000000000003",
  }),
})

const PORTAL_DEFINITIONS = Object.freeze({
  claimThenRevoke: Object.freeze({
    slug: "ff039-claim-then-revoke",
    displayName: "FF-039 Claim Then Revoke",
  }),
  revokeThenClaim: Object.freeze({
    slug: "ff039-revoke-then-claim",
    displayName: "FF-039 Revoke Then Claim",
  }),
  deliveryThenRevoke: Object.freeze({
    slug: "ff039-delivery-then-revoke",
    displayName: "FF-039 Delivery Then Revoke",
  }),
  revokeThenDelivery: Object.freeze({
    slug: "ff039-revoke-then-delivery",
    displayName: "FF-039 Revoke Then Delivery",
  }),
  redeemThenReissue: Object.freeze({
    slug: "ff039-redeem-then-reissue",
    displayName: "FF-039 Redeem Then Reissue",
  }),
  reissueThenRedeem: Object.freeze({
    slug: "ff039-reissue-then-redeem",
    displayName: "FF-039 Reissue Then Redeem",
  }),
  redeemThenArchive: Object.freeze({
    slug: "ff039-redeem-then-archive",
    displayName: "FF-039 Redeem Then Archive",
  }),
  archiveThenRedeem: Object.freeze({
    slug: "ff039-archive-then-redeem",
    displayName: "FF-039 Archive Then Redeem",
  }),
  reissueThenRevoke: Object.freeze({
    slug: "ff039-reissue-then-revoke",
    displayName: "FF-039 Reissue Then Revoke",
  }),
  revokeThenReissue: Object.freeze({
    slug: "ff039-revoke-then-reissue",
    displayName: "FF-039 Revoke Then Reissue",
  }),
  concurrentRedemption: Object.freeze({
    slug: "ff039-concurrent-redemption",
    displayName: "FF-039 Concurrent Redemption",
  }),
  redemptionRecovery: Object.freeze({
    slug: "ff039-redemption-recovery",
    displayName: "FF-039 Redemption Recovery",
  }),
  differentReissueOperations: Object.freeze({
    slug: "ff039-different-reissue-operations",
    displayName: "FF-039 Different Reissue Operations",
  }),
  differentRevocationOperations: Object.freeze({
    slug: "ff039-different-revocation-operations",
    displayName: "FF-039 Different Revocation Operations",
  }),
  exactReissueReplay: Object.freeze({
    slug: "ff039-exact-reissue-replay",
    displayName: "FF-039 Exact Reissue Replay",
  }),
  exactRevocationReplay: Object.freeze({
    slug: "ff039-exact-revocation-replay",
    displayName: "FF-039 Exact Revocation Replay",
  }),
})

function evidenceOutputPath() {
  const target = process.env.ADVOCATE_INITIAL_OWNER_CONCURRENCY_EVIDENCE_PATH
  return target ? resolve(target) : null
}

function material(label) {
  const token = createHash("sha256")
    .update(`ff039-capability:${label}`, "utf8")
    .digest("hex")
  const seed = createHash("sha256")
    .update(`ff039-envelope:${label}`, "utf8")
    .digest()
  const byte = (offset) => seed[offset % seed.length] || offset + 1
  return Object.freeze({
    token,
    capabilityDigest: createHash("sha256").update(token, "utf8").digest(),
    recipientEmailCiphertext: Buffer.alloc(64, byte(0)),
    recipientEmailHmac: Buffer.alloc(32, byte(1)),
    secretPayloadCiphertext: Buffer.alloc(96, byte(2)),
  })
}

function settled(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  )
}

function assertRejected(settlement, code) {
  assert.equal(settlement.status, "rejected")
  assert.equal(settlement.reason?.code, code)
}

function assertFulfilled(settlement) {
  assert.equal(settlement.status, "fulfilled")
  return settlement.value
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

async function authenticatedCall(client, actor, query) {
  await configureAuthenticatedTransaction(client, actor)
  return finishTransaction(client, query)
}

async function freshOwnerCall(client, query) {
  await configureFreshEmailOtpAuthenticatedTransaction(client, ACTORS.owner)
  return finishTransaction(client, query)
}

async function serviceRoleCall(client, query) {
  await configureServiceRoleTransaction(client)
  return finishTransaction(client, query)
}

async function beginAuthenticatedCall(client, actor, query) {
  await configureAuthenticatedTransaction(client, actor)
  try {
    return await query()
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

async function beginFreshOwnerCall(client, query) {
  await configureFreshEmailOtpAuthenticatedTransaction(client, ACTORS.owner)
  try {
    return await query()
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
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

async function onboardPortal(client, key) {
  const definition = PORTAL_DEFINITIONS[key]
  assert.ok(definition)
  const operationId = randomUUID()
  const invitationMaterial = material(`${key}:initial`)
  const result = await authenticatedCall(client, ACTORS.adminOne, () =>
    client.query(
      `SELECT
         operation_id::text,
         advocate_id::text,
         advocate_version::integer,
         onboarding_status,
         created
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
        OWNER_EMAIL,
        invitationMaterial.capabilityDigest,
        invitationMaterial.recipientEmailCiphertext,
        invitationMaterial.recipientEmailHmac,
        invitationMaterial.secretPayloadCiphertext,
        ADMIN_REASON,
        `ff039-onboard-${key}`,
        ACTORS.adminOne.sessionId,
      ],
    ),
  )
  assert.equal(result.rowCount, 1)
  assert.deepEqual(
    {
      advocateVersion: result.rows[0].advocate_version,
      onboardingStatus: result.rows[0].onboarding_status,
      created: result.rows[0].created,
    },
    {
      advocateVersion: 1,
      onboardingStatus: "initial_owner_invitation_queued",
      created: true,
    },
  )

  const authority = await client.query(
    `SELECT
       invitation.id::text AS invitation_id,
       outbox.id::text AS outbox_id
     FROM audit.creator_share_advocate_onboarding_receipts receipt
     JOIN public.advocate_invitations invitation
       ON invitation.id = receipt.invitation_id
      AND invitation.advocate_id = receipt.advocate_id
     JOIN public.advocate_invitation_email_outbox outbox
       ON outbox.invitation_id = invitation.id
      AND outbox.advocate_id = invitation.advocate_id
     WHERE receipt.operation_id = $1::uuid`,
    [operationId],
  )
  assert.equal(authority.rowCount, 1)
  return Object.freeze({
    key,
    slug: definition.slug,
    operationId,
    advocateId: result.rows[0].advocate_id,
    invitationId: authority.rows[0].invitation_id,
    outboxId: authority.rows[0].outbox_id,
    material: invitationMaterial,
  })
}

async function queryClaim(client, portal, suffix) {
  return client.query(
    `SELECT
       outbox_id::text,
       invitation_id::text,
       advocate_id::text,
       lease_token,
       recipient_email_hmac,
       capability_digest
     FROM public.claim_advocate_invitation_email_jobs(
       $1::text,
       1::smallint,
       1,
       $2::text,
       $3::text
     )`,
    [
      `ff039-worker-${portal.key}`,
      `ff039-claim-${portal.key}-${suffix}`,
      `ff039-claim-${portal.key}-${suffix}-trace`,
    ],
  )
}

async function claimPortal(client, portal, suffix) {
  const result = await serviceRoleCall(client, () =>
    queryClaim(client, portal, suffix),
  )
  assert.equal(result.rowCount, 1)
  assert.equal(result.rows[0].advocate_id, portal.advocateId)
  assert.equal(result.rows[0].invitation_id, portal.invitationId)
  assert.equal(result.rows[0].outbox_id, portal.outboxId)
  return Object.freeze(result.rows[0])
}

async function terminalizePortal(client, portal, claim) {
  const result = await serviceRoleCall(client, () =>
    client.query(
      `SELECT public.fail_advocate_invitation_email_delivery(
         $1::uuid,
         $2::text,
         'invitation_email_material_invalid',
         300,
         $3::text,
         $4::text
       ) AS retryable`,
      [
        claim.outbox_id,
        claim.lease_token,
        `ff039-terminal-${portal.key}`,
        `ff039-terminal-${portal.key}-trace`,
      ],
    ),
  )
  assert.equal(result.rowCount, 1)
  assert.equal(result.rows[0].retryable, false)
}

async function createPortalFixture(database, key, state = "pending") {
  return withPgClients(
    database,
    [`fixture_admin_${key}`, `fixture_worker_${key}`],
    async (admin, worker) => {
      const portal = await onboardPortal(admin, key)
      if (state === "pending") return portal
      const claim = await claimPortal(worker, portal, "fixture")
      if (state === "claimed") return Object.freeze({ ...portal, claim })
      assert.equal(state, "terminal")
      await terminalizePortal(worker, portal, claim)
      return portal
    },
  )
}

async function queryRevoke(client, actor, portal, operationId, trace) {
  return client.query(
    `SELECT
       operation_id::text,
       advocate_id::text,
       advocate_version::integer,
       revocation_status,
       created
     FROM public.revoke_advocate_initial_owner_invitation(
       $1::uuid,
       $2::uuid,
       1,
       $3::text,
       $1::text,
       $4::text,
       $5::text,
       NULL,
       NULL
     )`,
    [operationId, portal.advocateId, ADMIN_REASON, trace, actor.sessionId],
  )
}

async function revokePortal(client, actor, portal, operationId, trace) {
  return authenticatedCall(client, actor, () =>
    queryRevoke(client, actor, portal, operationId, trace),
  )
}

async function queryReissue(
  client,
  actor,
  portal,
  operationId,
  trace,
  replacementMaterial,
) {
  return client.query(
    `SELECT
       operation_id::text,
       advocate_id::text,
       advocate_version::integer,
       onboarding_status,
       created
     FROM public.reissue_advocate_initial_owner_invitation(
       $1::uuid,
       $2::uuid,
       1,
       $3::text,
       $4::bytea,
       $5::bytea,
       $6::bytea,
       $7::bytea,
       1::smallint,
       1::smallint,
       1::smallint,
       $8::text,
       $1::text,
       $9::text,
       $10::text,
       NULL,
       NULL
     )`,
    [
      operationId,
      portal.advocateId,
      OWNER_EMAIL,
      replacementMaterial.capabilityDigest,
      replacementMaterial.recipientEmailCiphertext,
      replacementMaterial.recipientEmailHmac,
      replacementMaterial.secretPayloadCiphertext,
      ADMIN_REASON,
      trace,
      actor.sessionId,
    ],
  )
}

async function reissuePortal(
  client,
  actor,
  portal,
  operationId,
  trace,
  replacementMaterial,
) {
  return authenticatedCall(client, actor, () =>
    queryReissue(
      client,
      actor,
      portal,
      operationId,
      trace,
      replacementMaterial,
    ),
  )
}

async function queryRedeem(
  client,
  portal,
  operationId,
  trace,
  capabilityToken = portal.material.token,
) {
  return client.query(
    `SELECT
       advocate_id::text,
       membership_id::text,
       membership_version::integer
     FROM public.redeem_advocate_invitation(
       $1::text,
       $2::text,
       $3::text,
       $4::text,
       $5::text,
       NULL,
       NULL,
       $6::uuid
     )`,
    [
      capabilityToken,
      "Accept the FF-039 initial owner invitation",
      operationId,
      trace,
      ACTORS.owner.sessionId,
      operationId,
    ],
  )
}

async function redeemPortal(client, portal, operationId, trace) {
  return freshOwnerCall(client, () =>
    queryRedeem(client, portal, operationId, trace),
  )
}

async function queryRecover(client, operationId) {
  return client.query(
    `SELECT
       advocate_id::text,
       membership_id::text,
       membership_version::integer
     FROM public.recover_advocate_invitation_redemption($1::uuid)`,
    [operationId],
  )
}

async function recoverPortal(client, operationId) {
  return authenticatedCall(client, ACTORS.owner, () =>
    queryRecover(client, operationId),
  )
}

async function queryArchive(client, actor, portal, requestId, trace) {
  return client.query(
    `SELECT
       advocate_id::text,
       advocate_version::integer,
       relationship_status,
       publication_status,
       domain_cleanup_requested
     FROM public.apply_creator_share_advocate_lifecycle_action(
       $1::uuid,
       1,
       'archive',
       $2::text,
       $3::uuid,
       $4::text,
       NULL,
       NULL
     )`,
    [portal.advocateId, ADMIN_REASON, requestId, trace],
  )
}

async function archivePortal(client, actor, portal, requestId, trace) {
  return authenticatedCall(client, actor, () =>
    queryArchive(client, actor, portal, requestId, trace),
  )
}

async function queryBeginDelivery(client, portal, claim, requestId, trace) {
  return client.query(
    `SELECT public.begin_advocate_invitation_email_delivery(
       $1::uuid,
       $2::text,
       $3::bytea,
       $4::bytea,
       $5::text,
       $6::text
     ) AS provider_idempotency_key`,
    [
      portal.outboxId,
      claim.lease_token,
      claim.recipient_email_hmac,
      claim.capability_digest,
      requestId,
      trace,
    ],
  )
}

async function beginDelivery(client, portal, claim, requestId, trace) {
  return serviceRoleCall(client, () =>
    queryBeginDelivery(client, portal, claim, requestId, trace),
  )
}

async function settleStaleDelivery(client, portal, claim, requestId, trace) {
  return serviceRoleCall(client, () =>
    client.query(
      `SELECT status
       FROM public.settle_advocate_invitation_email_delivery(
         $1::uuid,
         $2::text,
         'sent',
         'ff039-stale-provider-message',
         NULL,
         300,
         $3::text,
         $4::text
       )`,
      [portal.outboxId, claim.lease_token, requestId, trace],
    ),
  )
}

async function assertOpenTransaction(observer, client) {
  const result = await observer.query(
    `SELECT state, xact_start IS NOT NULL AS has_transaction
     FROM pg_catalog.pg_stat_activity
     WHERE pid = $1::integer
       AND application_name = $2::text`,
    [client.processID, client.connectionParameters.application_name],
  )
  assert.equal(result.rowCount, 1)
  assert.equal(result.rows[0].state, "idle in transaction")
  assert.equal(result.rows[0].has_transaction, true)
}

async function loadPortalState(client, portal) {
  const result = await client.query(
    `SELECT
       advocate.version::integer AS advocate_version,
       advocate.owner_onboarding_revision::integer,
       advocate.relationship_status,
       advocate.publication_status,
       (advocate.owner_membership_id IS NOT NULL) AS has_owner,
       (
         SELECT count(*)::integer
         FROM public.advocate_invitations invitation
         WHERE invitation.advocate_id = advocate.id
           AND invitation.invitation_kind = 'initial_owner'
       ) AS invitation_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_invitations invitation
         WHERE invitation.advocate_id = advocate.id
           AND invitation.invitation_kind = 'initial_owner'
           AND invitation.accepted_at IS NULL
           AND invitation.revoked_at IS NULL
       ) AS live_invitation_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_invitations invitation
         WHERE invitation.advocate_id = advocate.id
           AND invitation.accepted_at IS NOT NULL
       ) AS accepted_invitation_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_invitations invitation
         WHERE invitation.advocate_id = advocate.id
           AND invitation.revoked_at IS NOT NULL
       ) AS revoked_invitation_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_invitation_email_outbox outbox
         WHERE outbox.advocate_id = advocate.id
       ) AS outbox_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_invitation_email_outbox outbox
         WHERE outbox.advocate_id = advocate.id
           AND outbox.contact_redacted_at IS NOT NULL
       ) AS redacted_outbox_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_invitation_email_outbox outbox
         WHERE outbox.advocate_id = advocate.id
           AND (
             outbox.recipient_email_ciphertext IS NOT NULL
             OR outbox.recipient_email_hmac IS NOT NULL
             OR outbox.secret_payload_ciphertext IS NOT NULL
           )
       ) AS delivery_material_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_invitation_email_outbox outbox
         WHERE outbox.advocate_id = advocate.id
           AND (
             outbox.locked_at IS NOT NULL
             OR outbox.locked_by IS NOT NULL
             OR outbox.locked_lease_token_digest IS NOT NULL
             OR outbox.delivery_started_at IS NOT NULL
           )
       ) AS delivery_authority_residue_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_memberships membership
         WHERE membership.advocate_id = advocate.id
       ) AS membership_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_membership_roles membership_role
         WHERE membership_role.advocate_id = advocate.id
           AND membership_role.role_id = $2::uuid
       ) AS owner_role_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_domains domain
         WHERE domain.advocate_id = advocate.id
       ) AS domain_count,
       (
         SELECT count(*)::integer
         FROM public.advocate_domain_integrations integration
         WHERE integration.advocate_id = advocate.id
       ) AS integration_count,
       (
         SELECT count(*)::integer
         FROM public.domain_provisioning_jobs job
         WHERE job.advocate_id = advocate.id
       ) AS provisioning_job_count,
       (
         SELECT count(*)::integer
         FROM audit.advocate_portal_provisioning_starts provisioning_start
         WHERE provisioning_start.advocate_id = advocate.id
       ) AS provisioning_start_count,
       (
         SELECT count(*)::integer
         FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
         WHERE receipt.advocate_id = advocate.id
       ) AS redemption_receipt_count,
       (
         SELECT count(*)::integer
         FROM audit.creator_share_advocate_initial_owner_reissue_receipts receipt
         WHERE receipt.advocate_id = advocate.id
       ) AS reissue_receipt_count,
       (
         SELECT count(*)::integer
         FROM audit.creator_share_advocate_initial_owner_revocation_receipts receipt
         WHERE receipt.advocate_id = advocate.id
       ) AS revocation_receipt_count,
       (
         SELECT count(*)::integer
         FROM audit.creator_share_advocate_lifecycle_actions action
         WHERE action.advocate_id = advocate.id
       ) AS lifecycle_receipt_count,
       (
         SELECT count(*)::integer
         FROM private.advocate_lifecycle_mutation_guards mutation_guard
         WHERE mutation_guard.advocate_id = advocate.id
       ) AS lifecycle_guard_count
     FROM public.advocates advocate
     WHERE advocate.id = $1::uuid`,
    [portal.advocateId, OWNER_ROLE_ID],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function assertExactProvisioningTopology(
  client,
  portal,
  {
    invitationId = portal.invitationId,
    expectedAdvocateVersion = 2,
    resultingAdvocateVersion = 3,
  } = {},
) {
  const domain = await client.query(
    `SELECT
       domain.id::text AS domain_id,
       domain.hostname,
       domain.is_primary,
       domain.status::text
     FROM public.advocate_domains domain
     WHERE domain.advocate_id = $1::uuid`,
    [portal.advocateId],
  )
  assert.equal(domain.rowCount, 1)
  assert.deepEqual(
    {
      hostname: domain.rows[0].hostname,
      isPrimary: domain.rows[0].is_primary,
      status: domain.rows[0].status,
    },
    {
      hostname: `${portal.slug}.creatorshare.com`,
      isPrimary: true,
      status: "provisioning",
    },
  )

  const topology = await client.query(
    `SELECT
       integration.id::text AS integration_id,
       integration.provider::text,
       integration.environment,
       integration.is_required,
       integration.status::text AS integration_status,
       job.id::text AS job_id,
       job.kind::text AS job_kind,
       job.provider::text AS job_provider,
       job.status::text AS job_status,
       job.reconciliation_required,
       job.request_payload,
       job.advocate_id = integration.advocate_id AS advocate_binding_matches,
       job.domain_id = integration.domain_id AS domain_binding_matches,
       job.integration_id = integration.id AS integration_binding_matches
     FROM public.advocate_domain_integrations integration
     JOIN public.domain_provisioning_jobs job
       ON job.integration_id = integration.id
     WHERE integration.advocate_id = $1::uuid
       AND integration.domain_id = $2::uuid
     ORDER BY CASE integration.provider
       WHEN 'cloudflare' THEN 1
       WHEN 'vercel' THEN 2
       WHEN 'stripe_us' THEN 3
       WHEN 'stripe_uk' THEN 4
       WHEN 'paypal' THEN 5
       ELSE 6
     END`,
    [portal.advocateId, domain.rows[0].domain_id],
  )
  assert.deepEqual(
    topology.rows.map((row) => ({
      provider: row.provider,
      environment: row.environment,
      integrationRequired: row.is_required,
      integrationStatus: row.integration_status,
      jobKind: row.job_kind,
      jobProvider: row.job_provider,
      jobStatus: row.job_status,
      reconciliationRequired: row.reconciliation_required,
      requestPayload: row.request_payload,
      advocateBindingMatches: row.advocate_binding_matches,
      domainBindingMatches: row.domain_binding_matches,
      integrationBindingMatches: row.integration_binding_matches,
    })),
    EXPECTED_PROVISIONING_TOPOLOGY.map(({ provider, environment }) => ({
      provider,
      environment,
      integrationRequired: true,
      integrationStatus: "pending",
      jobKind: "provision",
      jobProvider: provider,
      jobStatus: "queued",
      reconciliationRequired: true,
      requestPayload: {
        schema_version: 1,
        reconciliation_policy: "lookup_before_mutation",
      },
      advocateBindingMatches: true,
      domainBindingMatches: true,
      integrationBindingMatches: true,
    })),
  )

  const provisioningStart = await client.query(
    `SELECT
       provisioning_start.initiating_user_id::text,
       provisioning_start.initiator_kind,
       provisioning_start.initial_owner_invitation_id::text,
       provisioning_start.advocate_id::text,
       provisioning_start.expected_advocate_version::integer,
       provisioning_start.resulting_advocate_version::integer,
       provisioning_start.domain_id::text,
       provisioning_start.hostname,
       provisioning_start.provider_topology_digest =
         private.advocate_required_provider_topology_digest()
         AS provider_topology_digest_matches,
       ARRAY(
         SELECT queued_job_id::text
         FROM unnest(provisioning_start.job_ids)
           WITH ORDINALITY AS queued(queued_job_id, ordinal)
         ORDER BY ordinal
       ) AS job_ids
     FROM audit.advocate_portal_provisioning_starts provisioning_start
     WHERE provisioning_start.advocate_id = $1::uuid`,
    [portal.advocateId],
  )
  assert.equal(provisioningStart.rowCount, 1)
  assert.deepEqual(
    {
      initiatingUserId: provisioningStart.rows[0].initiating_user_id,
      initiatorKind: provisioningStart.rows[0].initiator_kind,
      initialOwnerInvitationId:
        provisioningStart.rows[0].initial_owner_invitation_id,
      advocateId: provisioningStart.rows[0].advocate_id,
      expectedAdvocateVersion:
        provisioningStart.rows[0].expected_advocate_version,
      resultingAdvocateVersion:
        provisioningStart.rows[0].resulting_advocate_version,
      domainId: provisioningStart.rows[0].domain_id,
      hostname: provisioningStart.rows[0].hostname,
      providerTopologyDigestMatches:
        provisioningStart.rows[0].provider_topology_digest_matches,
      jobIds: provisioningStart.rows[0].job_ids,
    },
    {
      initiatingUserId: ACTORS.owner.userId,
      initiatorKind: "initial_owner_acceptance",
      initialOwnerInvitationId: invitationId,
      advocateId: portal.advocateId,
      expectedAdvocateVersion,
      resultingAdvocateVersion,
      domainId: domain.rows[0].domain_id,
      hostname: `${portal.slug}.creatorshare.com`,
      providerTopologyDigestMatches: true,
      jobIds: topology.rows.map((row) => row.job_id),
    },
  )
  return true
}

async function assertReissueReplayAuthority(
  client,
  portal,
  operationId,
  firstMaterial,
  secondMaterial,
) {
  const authority = await client.query(
    `SELECT
       receipt.initiating_user_id::text,
       receipt.advocate_id::text,
       receipt.prior_invitation_id::text,
       receipt.invitation_id::text,
       receipt.expected_advocate_version::integer,
       receipt.resulting_advocate_version::integer,
       receipt.request_fingerprint,
       invitation.invitation_kind::text,
       invitation.email,
       invitation.target_auth_user_id::text,
       invitation.created_by_user_id::text,
       invitation.token_digest,
       invitation.accepted_at,
       invitation.revoked_at,
       invitation.issuance_idempotency_key,
       invitation.issuance_fingerprint,
       outbox.id::text AS outbox_id,
       outbox.recipient_email_ciphertext,
       outbox.recipient_email_hmac,
       outbox.email_normalization_version::integer,
       outbox.email_hmac_key_version::integer,
       outbox.email_encryption_key_version::integer,
       outbox.secret_payload_ciphertext,
       outbox.secret_payload_ciphertext_sha256,
       outbox.template_key,
       outbox.template_data ->> 'invitation_id' AS template_invitation_id,
       outbox.status::text AS outbox_status,
       outbox.attempt_count::integer,
       outbox.locked_at,
       outbox.locked_by,
       outbox.locked_lease_token_digest,
       outbox.delivery_started_at,
       outbox.contact_redacted_at
     FROM audit.creator_share_advocate_initial_owner_reissue_receipts receipt
     JOIN public.advocate_invitations invitation
       ON invitation.id = receipt.invitation_id
      AND invitation.advocate_id = receipt.advocate_id
     JOIN public.advocate_invitation_email_outbox outbox
       ON outbox.invitation_id = invitation.id
      AND outbox.advocate_id = invitation.advocate_id
     WHERE receipt.operation_id = $1::uuid`,
    [operationId],
  )
  assert.equal(authority.rowCount, 1)
  const row = authority.rows[0]
  assert.deepEqual(
    {
      initiatingUserId: row.initiating_user_id,
      advocateId: row.advocate_id,
      priorInvitationId: row.prior_invitation_id,
      expectedAdvocateVersion: row.expected_advocate_version,
      resultingAdvocateVersion: row.resulting_advocate_version,
      invitationKind: row.invitation_kind,
      email: row.email,
      targetAuthUserId: row.target_auth_user_id,
      createdByUserId: row.created_by_user_id,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
      issuanceIdempotencyKey: row.issuance_idempotency_key,
      emailNormalizationVersion: row.email_normalization_version,
      emailHmacKeyVersion: row.email_hmac_key_version,
      emailEncryptionKeyVersion: row.email_encryption_key_version,
      templateKey: row.template_key,
      templateInvitationId: row.template_invitation_id,
      outboxStatus: row.outbox_status,
      attemptCount: row.attempt_count,
      lockedAt: row.locked_at,
      lockedBy: row.locked_by,
      lockedLeaseTokenDigest: row.locked_lease_token_digest,
      deliveryStartedAt: row.delivery_started_at,
      contactRedactedAt: row.contact_redacted_at,
    },
    {
      initiatingUserId: ACTORS.adminOne.userId,
      advocateId: portal.advocateId,
      priorInvitationId: portal.invitationId,
      expectedAdvocateVersion: 1,
      resultingAdvocateVersion: 2,
      invitationKind: "initial_owner",
      email: OWNER_EMAIL,
      targetAuthUserId: ACTORS.owner.userId,
      createdByUserId: ACTORS.adminOne.userId,
      acceptedAt: null,
      revokedAt: null,
      issuanceIdempotencyKey: `initial-owner-reissue:${operationId}`,
      emailNormalizationVersion: 1,
      emailHmacKeyVersion: 1,
      emailEncryptionKeyVersion: 1,
      templateKey: "advocate_initial_owner_invitation_v1",
      templateInvitationId: row.invitation_id,
      outboxStatus: "pending",
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
      lockedLeaseTokenDigest: null,
      deliveryStartedAt: null,
      contactRedactedAt: null,
    },
  )
  assert.deepEqual(row.request_fingerprint, row.issuance_fingerprint)
  assert.deepEqual(row.token_digest, firstMaterial.capabilityDigest)
  assert.deepEqual(
    row.recipient_email_ciphertext,
    firstMaterial.recipientEmailCiphertext,
  )
  assert.deepEqual(row.recipient_email_hmac, firstMaterial.recipientEmailHmac)
  assert.deepEqual(
    row.secret_payload_ciphertext,
    firstMaterial.secretPayloadCiphertext,
  )
  assert.deepEqual(
    row.secret_payload_ciphertext_sha256,
    createHash("sha256").update(firstMaterial.secretPayloadCiphertext).digest(),
  )

  const secondMaterialResidue = await client.query(
    `SELECT count(*)::integer AS residue_count
     FROM public.advocate_invitations invitation
     LEFT JOIN public.advocate_invitation_email_outbox outbox
       ON outbox.invitation_id = invitation.id
      AND outbox.advocate_id = invitation.advocate_id
     WHERE invitation.advocate_id = $1::uuid
       AND (
         invitation.token_digest = $2::bytea
         OR outbox.recipient_email_ciphertext = $3::bytea
         OR outbox.recipient_email_hmac = $4::bytea
         OR outbox.secret_payload_ciphertext = $5::bytea
       )`,
    [
      portal.advocateId,
      secondMaterial.capabilityDigest,
      secondMaterial.recipientEmailCiphertext,
      secondMaterial.recipientEmailHmac,
      secondMaterial.secretPayloadCiphertext,
    ],
  )
  assert.equal(secondMaterialResidue.rows[0].residue_count, 0)
  return Object.freeze({
    invitationId: row.invitation_id,
    outboxId: row.outbox_id,
  })
}

function assertRevokedState(state) {
  assert.deepEqual(
    {
      advocateVersion: state.advocate_version,
      ownerOnboardingRevision: state.owner_onboarding_revision,
      relationshipStatus: state.relationship_status,
      publicationStatus: state.publication_status,
      hasOwner: state.has_owner,
      invitationCount: state.invitation_count,
      liveInvitationCount: state.live_invitation_count,
      acceptedInvitationCount: state.accepted_invitation_count,
      revokedInvitationCount: state.revoked_invitation_count,
      outboxCount: state.outbox_count,
      redactedOutboxCount: state.redacted_outbox_count,
      deliveryMaterialCount: state.delivery_material_count,
      deliveryAuthorityResidueCount: state.delivery_authority_residue_count,
      membershipCount: state.membership_count,
      ownerRoleCount: state.owner_role_count,
      domainCount: state.domain_count,
      integrationCount: state.integration_count,
      provisioningJobCount: state.provisioning_job_count,
      provisioningStartCount: state.provisioning_start_count,
      redemptionReceiptCount: state.redemption_receipt_count,
      reissueReceiptCount: state.reissue_receipt_count,
      revocationReceiptCount: state.revocation_receipt_count,
      lifecycleReceiptCount: state.lifecycle_receipt_count,
      lifecycleGuardCount: state.lifecycle_guard_count,
    },
    {
      advocateVersion: 2,
      ownerOnboardingRevision: 1,
      relationshipStatus: "invited",
      publicationStatus: "draft",
      hasOwner: false,
      invitationCount: 1,
      liveInvitationCount: 0,
      acceptedInvitationCount: 0,
      revokedInvitationCount: 1,
      outboxCount: 1,
      redactedOutboxCount: 1,
      deliveryMaterialCount: 0,
      deliveryAuthorityResidueCount: 0,
      membershipCount: 0,
      ownerRoleCount: 0,
      domainCount: 0,
      integrationCount: 0,
      provisioningJobCount: 0,
      provisioningStartCount: 0,
      redemptionReceiptCount: 0,
      reissueReceiptCount: 0,
      revocationReceiptCount: 1,
      lifecycleReceiptCount: 0,
      lifecycleGuardCount: 0,
    },
  )
}

function assertReissuedState(state) {
  assert.deepEqual(
    {
      advocateVersion: state.advocate_version,
      ownerOnboardingRevision: state.owner_onboarding_revision,
      relationshipStatus: state.relationship_status,
      publicationStatus: state.publication_status,
      hasOwner: state.has_owner,
      invitationCount: state.invitation_count,
      liveInvitationCount: state.live_invitation_count,
      acceptedInvitationCount: state.accepted_invitation_count,
      revokedInvitationCount: state.revoked_invitation_count,
      outboxCount: state.outbox_count,
      redactedOutboxCount: state.redacted_outbox_count,
      deliveryMaterialCount: state.delivery_material_count,
      deliveryAuthorityResidueCount: state.delivery_authority_residue_count,
      membershipCount: state.membership_count,
      ownerRoleCount: state.owner_role_count,
      domainCount: state.domain_count,
      integrationCount: state.integration_count,
      provisioningJobCount: state.provisioning_job_count,
      provisioningStartCount: state.provisioning_start_count,
      redemptionReceiptCount: state.redemption_receipt_count,
      reissueReceiptCount: state.reissue_receipt_count,
      revocationReceiptCount: state.revocation_receipt_count,
      lifecycleReceiptCount: state.lifecycle_receipt_count,
      lifecycleGuardCount: state.lifecycle_guard_count,
    },
    {
      advocateVersion: 2,
      ownerOnboardingRevision: 1,
      relationshipStatus: "invited",
      publicationStatus: "draft",
      hasOwner: false,
      invitationCount: 2,
      liveInvitationCount: 1,
      acceptedInvitationCount: 0,
      revokedInvitationCount: 1,
      outboxCount: 2,
      redactedOutboxCount: 1,
      deliveryMaterialCount: 1,
      deliveryAuthorityResidueCount: 0,
      membershipCount: 0,
      ownerRoleCount: 0,
      domainCount: 0,
      integrationCount: 0,
      provisioningJobCount: 0,
      provisioningStartCount: 0,
      redemptionReceiptCount: 0,
      reissueReceiptCount: 1,
      revocationReceiptCount: 0,
      lifecycleReceiptCount: 0,
      lifecycleGuardCount: 0,
    },
  )
}

function assertRedeemedState(state, { reissued = false } = {}) {
  assert.deepEqual(
    {
      advocateVersion: state.advocate_version,
      ownerOnboardingRevision: state.owner_onboarding_revision,
      relationshipStatus: state.relationship_status,
      publicationStatus: state.publication_status,
      hasOwner: state.has_owner,
      invitationCount: state.invitation_count,
      liveInvitationCount: state.live_invitation_count,
      acceptedInvitationCount: state.accepted_invitation_count,
      revokedInvitationCount: state.revoked_invitation_count,
      outboxCount: state.outbox_count,
      redactedOutboxCount: state.redacted_outbox_count,
      deliveryMaterialCount: state.delivery_material_count,
      deliveryAuthorityResidueCount: state.delivery_authority_residue_count,
      membershipCount: state.membership_count,
      ownerRoleCount: state.owner_role_count,
      domainCount: state.domain_count,
      integrationCount: state.integration_count,
      provisioningJobCount: state.provisioning_job_count,
      provisioningStartCount: state.provisioning_start_count,
      redemptionReceiptCount: state.redemption_receipt_count,
      reissueReceiptCount: state.reissue_receipt_count,
      revocationReceiptCount: state.revocation_receipt_count,
      lifecycleReceiptCount: state.lifecycle_receipt_count,
      lifecycleGuardCount: state.lifecycle_guard_count,
    },
    {
      advocateVersion: reissued ? 4 : 3,
      ownerOnboardingRevision: reissued ? 1 : 0,
      relationshipStatus: "active",
      publicationStatus: "provisioning",
      hasOwner: true,
      invitationCount: reissued ? 2 : 1,
      liveInvitationCount: 0,
      acceptedInvitationCount: 1,
      revokedInvitationCount: reissued ? 1 : 0,
      outboxCount: reissued ? 2 : 1,
      redactedOutboxCount: reissued ? 2 : 1,
      deliveryMaterialCount: 0,
      deliveryAuthorityResidueCount: 0,
      membershipCount: 1,
      ownerRoleCount: 1,
      domainCount: 1,
      integrationCount: 5,
      provisioningJobCount: 5,
      provisioningStartCount: 1,
      redemptionReceiptCount: 1,
      reissueReceiptCount: reissued ? 1 : 0,
      revocationReceiptCount: 0,
      lifecycleReceiptCount: 0,
      lifecycleGuardCount: 0,
    },
  )
}

function assertArchivedState(state) {
  assert.deepEqual(
    {
      advocateVersion: state.advocate_version,
      ownerOnboardingRevision: state.owner_onboarding_revision,
      relationshipStatus: state.relationship_status,
      publicationStatus: state.publication_status,
      hasOwner: state.has_owner,
      invitationCount: state.invitation_count,
      liveInvitationCount: state.live_invitation_count,
      acceptedInvitationCount: state.accepted_invitation_count,
      revokedInvitationCount: state.revoked_invitation_count,
      outboxCount: state.outbox_count,
      redactedOutboxCount: state.redacted_outbox_count,
      deliveryMaterialCount: state.delivery_material_count,
      deliveryAuthorityResidueCount: state.delivery_authority_residue_count,
      membershipCount: state.membership_count,
      ownerRoleCount: state.owner_role_count,
      domainCount: state.domain_count,
      integrationCount: state.integration_count,
      provisioningJobCount: state.provisioning_job_count,
      provisioningStartCount: state.provisioning_start_count,
      redemptionReceiptCount: state.redemption_receipt_count,
      reissueReceiptCount: state.reissue_receipt_count,
      revocationReceiptCount: state.revocation_receipt_count,
      lifecycleReceiptCount: state.lifecycle_receipt_count,
      lifecycleGuardCount: state.lifecycle_guard_count,
    },
    {
      advocateVersion: 2,
      ownerOnboardingRevision: 0,
      relationshipStatus: "archived",
      publicationStatus: "suspended",
      hasOwner: false,
      invitationCount: 1,
      liveInvitationCount: 0,
      acceptedInvitationCount: 0,
      revokedInvitationCount: 1,
      outboxCount: 1,
      redactedOutboxCount: 1,
      deliveryMaterialCount: 0,
      deliveryAuthorityResidueCount: 0,
      membershipCount: 0,
      ownerRoleCount: 0,
      domainCount: 0,
      integrationCount: 0,
      provisioningJobCount: 0,
      provisioningStartCount: 0,
      redemptionReceiptCount: 0,
      reissueReceiptCount: 0,
      revocationReceiptCount: 0,
      lifecycleReceiptCount: 1,
      lifecycleGuardCount: 0,
    },
  )
}

async function countAuditValueOccurrences(client, values) {
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
      throw new Error("ff039_audit_table_name_invalid")
    }
    for (const value of values) {
      const result = await client.query(
        `SELECT count(*)::integer AS occurrence_count
         FROM audit."${tableName}" audit_row
         WHERE strpos(to_jsonb(audit_row)::text, $1::text) > 0`,
        [value],
      )
      total += result.rows[0].occurrence_count
    }
  }
  return total
}

async function assertNoAuditResidue(client, values) {
  assert.equal(await countAuditValueOccurrences(client, values), 0)
}

async function cleanupReissuedPortal(database, portal) {
  await withPgClients(database, [`cleanup_${portal.key}`], async (client) => {
    const operationId = randomUUID()
    const result = await authenticatedCall(client, ACTORS.adminOne, () =>
      client.query(
        `SELECT created
         FROM public.revoke_advocate_initial_owner_invitation(
           $1::uuid,
           $2::uuid,
           2,
           $3::text,
           $1::text,
           $4::text,
           $5::text,
           NULL,
           NULL
         )`,
        [
          operationId,
          portal.advocateId,
          "Close the isolated FF-039 replacement fixture",
          `ff039-cleanup-${portal.key}`,
          ACTORS.adminOne.sessionId,
        ],
      ),
    )
    assert.equal(result.rowCount, 1)
    assert.equal(result.rows[0].created, true)
  })
}

async function claimVersusRevoke(database) {
  let blockedSessions = 0
  let losingPathResidue = 0

  const claimFirstPortal = await createPortalFixture(
    database,
    "claimThenRevoke",
  )
  await withPgClients(
    database,
    [
      "claim_revoke_observer",
      "claim_revoke_claim_first",
      "claim_revoke_revoke_second",
      "claim_revoke_probe",
    ],
    async (observer, claimClient, revokeClient, probe) => {
      const revokeOperationId = randomUUID()
      const revokeTrace = "ff039-claim-first-revoke-second"
      const claim = await beginServiceRoleCall(claimClient, () =>
        queryClaim(claimClient, claimFirstPortal, "claim-first"),
      )
      assert.equal(claim.rowCount, 1)
      assert.equal(claim.rows[0].advocate_id, claimFirstPortal.advocateId)
      const revokeSettlement = settled(
        revokePortal(
          revokeClient,
          ACTORS.adminOne,
          claimFirstPortal,
          revokeOperationId,
          revokeTrace,
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [revokeClient],
        claimClient,
      )
      blockedSessions += observations.length
      await claimClient.query("COMMIT")
      const revokeResult = assertFulfilled(await revokeSettlement)
      assert.equal(revokeResult.rows[0].created, true)

      const staleBeginRequestId = "ff039-stale-claim-begin"
      const staleBeginTrace = `${staleBeginRequestId}-trace`
      const staleBegin = await settled(
        beginDelivery(
          probe,
          claimFirstPortal,
          claim.rows[0],
          staleBeginRequestId,
          staleBeginTrace,
        ),
      )
      assertRejected(staleBegin, "42501")
      assertRevokedState(await loadPortalState(observer, claimFirstPortal))
      const residue = await countAuditValueOccurrences(observer, [
        staleBeginRequestId,
        staleBeginTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )

  const revokeFirstPortal = await createPortalFixture(
    database,
    "revokeThenClaim",
  )
  await withPgClients(
    database,
    [
      "revoke_claim_observer",
      "revoke_claim_revoke_first",
      "revoke_claim_claim_second",
    ],
    async (observer, revokeClient, claimClient) => {
      const revokeOperationId = randomUUID()
      const claimRequestId = "ff039-loser-claim-after-revoke"
      const claimTrace = `${claimRequestId}-trace`
      const revoke = await beginAuthenticatedCall(
        revokeClient,
        ACTORS.adminOne,
        () =>
          queryRevoke(
            revokeClient,
            ACTORS.adminOne,
            revokeFirstPortal,
            revokeOperationId,
            "ff039-winner-revoke-before-claim",
          ),
      )
      assert.equal(revoke.rows[0].created, true)
      await assertOpenTransaction(observer, revokeClient)
      const claim = await serviceRoleCall(claimClient, () =>
        claimClient.query(
          `SELECT outbox_id
           FROM public.claim_advocate_invitation_email_jobs(
             'ff039-worker-revoke-first',
             1::smallint,
             1,
             $1::text,
             $2::text
           )`,
          [claimRequestId, claimTrace],
        ),
      )
      assert.equal(claim.rowCount, 0)
      await assertOpenTransaction(observer, revokeClient)
      await revokeClient.query("COMMIT")
      assertRevokedState(await loadPortalState(observer, revokeFirstPortal))
      const residue = await countAuditValueOccurrences(observer, [
        claimRequestId,
        claimTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )

  assert.equal(blockedSessions, 1)
  return {
    scenario: "claim_vs_revoke",
    interleavings: 2,
    blockedSessions,
    committedClaims: 1,
    skippedLockedClaims: 1,
    committedRevocations: 2,
    staleBeginSqlstate: "42501",
    losingPathResidue,
  }
}

async function deliveryStartVersusRevoke(database) {
  let blockedSessions = 0
  let losingPathResidue = 0

  const deliveryFirstPortal = await createPortalFixture(
    database,
    "deliveryThenRevoke",
    "claimed",
  )
  await withPgClients(
    database,
    [
      "delivery_revoke_observer",
      "delivery_revoke_begin_first",
      "delivery_revoke_revoke_second",
      "delivery_revoke_probe",
    ],
    async (observer, deliveryClient, revokeClient, probe) => {
      const delivery = await beginServiceRoleCall(deliveryClient, () =>
        queryBeginDelivery(
          deliveryClient,
          deliveryFirstPortal,
          deliveryFirstPortal.claim,
          "ff039-delivery-first",
          "ff039-delivery-first-trace",
        ),
      )
      assert.equal(delivery.rowCount, 1)
      const revokeSettlement = settled(
        revokePortal(
          revokeClient,
          ACTORS.adminOne,
          deliveryFirstPortal,
          randomUUID(),
          "ff039-delivery-first-revoke-second",
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [revokeClient],
        deliveryClient,
      )
      blockedSessions += observations.length
      await deliveryClient.query("COMMIT")
      const revoke = assertFulfilled(await revokeSettlement)
      assert.equal(revoke.rows[0].created, true)
      const staleSettlementRequestId = "ff039-stale-delivery-settlement"
      const staleSettlementTrace = `${staleSettlementRequestId}-trace`
      const staleSettlement = await settled(
        settleStaleDelivery(
          probe,
          deliveryFirstPortal,
          deliveryFirstPortal.claim,
          staleSettlementRequestId,
          staleSettlementTrace,
        ),
      )
      assertRejected(staleSettlement, "55P03")
      assertRevokedState(await loadPortalState(observer, deliveryFirstPortal))
      const residue = await countAuditValueOccurrences(observer, [
        staleSettlementRequestId,
        staleSettlementTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )

  const revokeFirstPortal = await createPortalFixture(
    database,
    "revokeThenDelivery",
    "claimed",
  )
  await withPgClients(
    database,
    [
      "revoke_delivery_observer",
      "revoke_delivery_revoke_first",
      "revoke_delivery_begin_second",
    ],
    async (observer, revokeClient, deliveryClient) => {
      const deliveryRequestId = "ff039-loser-delivery-after-revoke"
      const deliveryTrace = `${deliveryRequestId}-trace`
      const revoke = await beginAuthenticatedCall(
        revokeClient,
        ACTORS.adminOne,
        () =>
          queryRevoke(
            revokeClient,
            ACTORS.adminOne,
            revokeFirstPortal,
            randomUUID(),
            "ff039-winner-revoke-before-delivery",
          ),
      )
      assert.equal(revoke.rows[0].created, true)
      const deliverySettlement = settled(
        beginDelivery(
          deliveryClient,
          revokeFirstPortal,
          revokeFirstPortal.claim,
          deliveryRequestId,
          deliveryTrace,
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [deliveryClient],
        revokeClient,
      )
      blockedSessions += observations.length
      await revokeClient.query("COMMIT")
      assertRejected(await deliverySettlement, "42501")
      assertRevokedState(await loadPortalState(observer, revokeFirstPortal))
      const residue = await countAuditValueOccurrences(observer, [
        deliveryRequestId,
        deliveryTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )

  assert.equal(blockedSessions, 2)
  return {
    scenario: "delivery_start_vs_revoke",
    interleavings: 2,
    blockedSessions,
    committedDeliveryStarts: 1,
    rejectedDeliveryStarts: 1,
    committedRevocations: 2,
    staleSettlementSqlstate: "55P03",
    losingDeliverySqlstate: "42501",
    losingPathResidue,
  }
}

async function redemptionVersusReissue(database) {
  let blockedSessions = 0
  let losingPathResidue = 0
  let exactAcceptedTopology = false

  const redeemFirstPortal = await createPortalFixture(
    database,
    "redeemThenReissue",
    "terminal",
  )
  await withPgClients(
    database,
    [
      "redeem_reissue_observer",
      "redeem_reissue_redeem_first",
      "redeem_reissue_reissue_second",
    ],
    async (observer, redeemClient, reissueClient) => {
      const redeemOperationId = randomUUID()
      const reissueOperationId = randomUUID()
      const reissueTrace = "ff039-redeem-first-reissue-second"
      const redeemed = await beginFreshOwnerCall(redeemClient, () =>
        queryRedeem(
          redeemClient,
          redeemFirstPortal,
          redeemOperationId,
          "ff039-redeem-first-trace",
        ),
      )
      assert.equal(redeemed.rowCount, 1)
      const reissueSettlement = settled(
        reissuePortal(
          reissueClient,
          ACTORS.adminOne,
          redeemFirstPortal,
          reissueOperationId,
          reissueTrace,
          material("redeemThenReissue:replacement"),
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [reissueClient],
        redeemClient,
      )
      blockedSessions += observations.length
      await redeemClient.query("COMMIT")
      assertRejected(await reissueSettlement, "55000")
      assertRedeemedState(await loadPortalState(observer, redeemFirstPortal))
      exactAcceptedTopology = await assertExactProvisioningTopology(
        observer,
        redeemFirstPortal,
      )
      const residue = await countAuditValueOccurrences(observer, [
        reissueOperationId,
        reissueTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )

  const reissueFirstPortal = await createPortalFixture(
    database,
    "reissueThenRedeem",
    "terminal",
  )
  await withPgClients(
    database,
    [
      "reissue_redeem_observer",
      "reissue_redeem_reissue_first",
      "reissue_redeem_redeem_second",
    ],
    async (observer, reissueClient, redeemClient) => {
      const redeemOperationId = randomUUID()
      const redeemTrace = "ff039-loser-redeem-after-reissue"
      const reissued = await beginAuthenticatedCall(
        reissueClient,
        ACTORS.adminOne,
        () =>
          queryReissue(
            reissueClient,
            ACTORS.adminOne,
            reissueFirstPortal,
            randomUUID(),
            "ff039-winner-reissue-before-redeem",
            material("reissueThenRedeem:replacement"),
          ),
      )
      assert.equal(reissued.rows[0].created, true)
      const redeemSettlement = settled(
        redeemPortal(
          redeemClient,
          reissueFirstPortal,
          redeemOperationId,
          redeemTrace,
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [redeemClient],
        reissueClient,
      )
      blockedSessions += observations.length
      await reissueClient.query("COMMIT")
      assertRejected(await redeemSettlement, "42501")
      assertReissuedState(await loadPortalState(observer, reissueFirstPortal))
      const residue = await countAuditValueOccurrences(observer, [
        redeemOperationId,
        redeemTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )
  await cleanupReissuedPortal(database, reissueFirstPortal)

  assert.equal(blockedSessions, 2)
  return {
    scenario: "redemption_vs_reissue",
    interleavings: 2,
    blockedSessions,
    committedRedemptions: 1,
    committedReissues: 1,
    losingSqlstates: ["55000", "42501"],
    exactAcceptedTopology,
    exactReplacementAuthority: true,
    losingPathResidue,
  }
}

async function redemptionVersusArchive(database) {
  let blockedSessions = 0
  let losingPathResidue = 0
  let exactAcceptedTopology = false

  const redeemFirstPortal = await createPortalFixture(
    database,
    "redeemThenArchive",
  )
  await withPgClients(
    database,
    [
      "redeem_archive_observer",
      "redeem_archive_redeem_first",
      "redeem_archive_archive_second",
    ],
    async (observer, redeemClient, archiveClient) => {
      const redeemOperationId = randomUUID()
      const archiveRequestId = randomUUID()
      const archiveTrace = "ff039-redeem-first-archive-second"
      const redeemed = await beginFreshOwnerCall(redeemClient, () =>
        queryRedeem(
          redeemClient,
          redeemFirstPortal,
          redeemOperationId,
          "ff039-redeem-before-archive-trace",
        ),
      )
      assert.equal(redeemed.rowCount, 1)
      const archiveSettlement = settled(
        archivePortal(
          archiveClient,
          ACTORS.adminOne,
          redeemFirstPortal,
          archiveRequestId,
          archiveTrace,
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [archiveClient],
        redeemClient,
      )
      blockedSessions += observations.length
      await redeemClient.query("COMMIT")
      assertRejected(await archiveSettlement, "40001")
      assertRedeemedState(await loadPortalState(observer, redeemFirstPortal))
      exactAcceptedTopology = await assertExactProvisioningTopology(
        observer,
        redeemFirstPortal,
      )
      const residue = await countAuditValueOccurrences(observer, [
        archiveRequestId,
        archiveTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )

  const archiveFirstPortal = await createPortalFixture(
    database,
    "archiveThenRedeem",
  )
  await withPgClients(
    database,
    [
      "archive_redeem_observer",
      "archive_redeem_archive_first",
      "archive_redeem_redeem_second",
    ],
    async (observer, archiveClient, redeemClient) => {
      const redeemOperationId = randomUUID()
      const redeemTrace = "ff039-loser-redeem-after-archive"
      const archived = await beginAuthenticatedCall(
        archiveClient,
        ACTORS.adminOne,
        () =>
          queryArchive(
            archiveClient,
            ACTORS.adminOne,
            archiveFirstPortal,
            randomUUID(),
            "ff039-winner-archive-before-redeem",
          ),
      )
      assert.equal(archived.rows[0].relationship_status, "archived")
      const redeemSettlement = settled(
        redeemPortal(
          redeemClient,
          archiveFirstPortal,
          redeemOperationId,
          redeemTrace,
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [redeemClient],
        archiveClient,
      )
      blockedSessions += observations.length
      await archiveClient.query("COMMIT")
      assertRejected(await redeemSettlement, "42501")
      assertArchivedState(await loadPortalState(observer, archiveFirstPortal))
      const residue = await countAuditValueOccurrences(observer, [
        redeemOperationId,
        redeemTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )

  assert.equal(blockedSessions, 2)
  return {
    scenario: "redemption_vs_archive",
    interleavings: 2,
    blockedSessions,
    committedRedemptions: 1,
    committedArchives: 1,
    losingSqlstates: ["40001", "42501"],
    exactAcceptedTopology,
    exactArchivedState: true,
    losingPathResidue,
  }
}

async function reissueVersusRevocation(database) {
  let blockedSessions = 0
  let losingPathResidue = 0

  const reissueFirstPortal = await createPortalFixture(
    database,
    "reissueThenRevoke",
    "terminal",
  )
  await withPgClients(
    database,
    [
      "reissue_revoke_observer",
      "reissue_revoke_reissue_first",
      "reissue_revoke_revoke_second",
    ],
    async (observer, reissueClient, revokeClient) => {
      const revokeOperationId = randomUUID()
      const revokeTrace = "ff039-reissue-first-revoke-second"
      const reissued = await beginAuthenticatedCall(
        reissueClient,
        ACTORS.adminOne,
        () =>
          queryReissue(
            reissueClient,
            ACTORS.adminOne,
            reissueFirstPortal,
            randomUUID(),
            "ff039-winner-reissue-before-revoke",
            material("reissueThenRevoke:replacement"),
          ),
      )
      assert.equal(reissued.rows[0].created, true)
      const revokeSettlement = settled(
        revokePortal(
          revokeClient,
          ACTORS.adminTwo,
          reissueFirstPortal,
          revokeOperationId,
          revokeTrace,
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [revokeClient],
        reissueClient,
      )
      blockedSessions += observations.length
      await reissueClient.query("COMMIT")
      assertRejected(await revokeSettlement, "55000")
      assertReissuedState(await loadPortalState(observer, reissueFirstPortal))
      const residue = await countAuditValueOccurrences(observer, [
        revokeOperationId,
        revokeTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )
  await cleanupReissuedPortal(database, reissueFirstPortal)

  const revokeFirstPortal = await createPortalFixture(
    database,
    "revokeThenReissue",
    "terminal",
  )
  await withPgClients(
    database,
    [
      "revoke_reissue_observer",
      "revoke_reissue_revoke_first",
      "revoke_reissue_reissue_second",
    ],
    async (observer, revokeClient, reissueClient) => {
      const reissueOperationId = randomUUID()
      const reissueTrace = "ff039-revoke-first-reissue-second"
      const revoked = await beginAuthenticatedCall(
        revokeClient,
        ACTORS.adminOne,
        () =>
          queryRevoke(
            revokeClient,
            ACTORS.adminOne,
            revokeFirstPortal,
            randomUUID(),
            "ff039-winner-revoke-before-reissue",
          ),
      )
      assert.equal(revoked.rows[0].created, true)
      const reissueSettlement = settled(
        reissuePortal(
          reissueClient,
          ACTORS.adminTwo,
          revokeFirstPortal,
          reissueOperationId,
          reissueTrace,
          material("revokeThenReissue:replacement"),
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [reissueClient],
        revokeClient,
      )
      blockedSessions += observations.length
      await revokeClient.query("COMMIT")
      assertRejected(await reissueSettlement, "55000")
      assertRevokedState(await loadPortalState(observer, revokeFirstPortal))
      const residue = await countAuditValueOccurrences(observer, [
        reissueOperationId,
        reissueTrace,
      ])
      assert.equal(residue, 0)
      losingPathResidue += residue
    },
  )

  assert.equal(blockedSessions, 2)
  return {
    scenario: "reissue_vs_revocation",
    interleavings: 2,
    blockedSessions,
    committedReissues: 1,
    committedRevocations: 1,
    losingSqlstates: ["55000", "55000"],
    exactReplacementAuthority: true,
    exactRevokedAuthority: true,
    losingPathResidue,
  }
}

async function concurrentRedemption(database) {
  const portal = await createPortalFixture(database, "concurrentRedemption")
  const secondOperationId = randomUUID()
  const secondTrace = "ff039-loser-concurrent-redemption"
  let exactAcceptedTopology = false
  const blockedSessions = await withPgClients(
    database,
    [
      "redemption_concurrency_observer",
      "redemption_concurrency_first",
      "redemption_concurrency_second",
    ],
    async (observer, first, second) => {
      const firstOperationId = randomUUID()
      const firstResult = await beginFreshOwnerCall(first, () =>
        queryRedeem(
          first,
          portal,
          firstOperationId,
          "ff039-winner-concurrent-redemption-trace",
        ),
      )
      assert.equal(firstResult.rowCount, 1)
      const secondSettlement = settled(
        redeemPortal(second, portal, secondOperationId, secondTrace),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [second],
        first,
      )
      await first.query("COMMIT")
      assertRejected(await secondSettlement, "40001")
      assertRedeemedState(await loadPortalState(observer, portal))
      exactAcceptedTopology = await assertExactProvisioningTopology(
        observer,
        portal,
      )
      await assertNoAuditResidue(observer, [secondOperationId, secondTrace])
      return observations.length
    },
  )
  assert.equal(blockedSessions, 1)
  return {
    scenario: "concurrent_redemption",
    interleavings: 1,
    blockedSessions,
    committedRedemptions: 1,
    rejectedRedemptions: 1,
    loserSqlstate: "40001",
    redemptionReceipts: 1,
    exactAcceptedTopology,
    losingPathResidue: 0,
  }
}

async function redemptionVersusRecovery(database) {
  const portal = await createPortalFixture(database, "redemptionRecovery")
  const operationId = randomUUID()
  const result = await withPgClients(
    database,
    [
      "redemption_recovery_observer",
      "redemption_recovery_redeem",
      "redemption_recovery_recover",
    ],
    async (observer, redeemClient, recoveryClient) => {
      const redeemed = await beginFreshOwnerCall(redeemClient, () =>
        queryRedeem(
          redeemClient,
          portal,
          operationId,
          "ff039-redemption-recovery-redeem",
        ),
      )
      assert.equal(redeemed.rowCount, 1)

      const recoverySettlement = settled(
        recoverPortal(recoveryClient, operationId),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [recoveryClient],
        redeemClient,
      )
      await redeemClient.query("COMMIT")

      const recovered = assertFulfilled(await recoverySettlement)
      assert.equal(recovered.rowCount, 1)
      assert.deepEqual(recovered.rows[0], redeemed.rows[0])

      const state = await loadPortalState(observer, portal)
      assertRedeemedState(state)
      const receipt = await observer.query(
        `SELECT
           receipt.operation_id::text,
           receipt.invitation_kind::text,
           receipt.initiating_user_id::text,
           receipt.advocate_id::text,
           receipt.invitation_id::text,
           receipt.membership_id::text,
           receipt.membership_version::integer,
           (receipt.provisioning_request_id IS NOT NULL)
             AS has_provisioning_request,
           receipt.resulting_advocate_version::integer
         FROM audit.creator_share_advocate_invitation_redemption_receipts receipt
         WHERE receipt.advocate_id = $1::uuid`,
        [portal.advocateId],
      )
      assert.equal(receipt.rowCount, 1)
      assert.deepEqual(
        {
          operationId: receipt.rows[0].operation_id,
          invitationKind: receipt.rows[0].invitation_kind,
          initiatingUserId: receipt.rows[0].initiating_user_id,
          advocateId: receipt.rows[0].advocate_id,
          invitationId: receipt.rows[0].invitation_id,
          membershipId: receipt.rows[0].membership_id,
          membershipVersion: receipt.rows[0].membership_version,
          hasProvisioningRequest: receipt.rows[0].has_provisioning_request,
          resultingAdvocateVersion: receipt.rows[0].resulting_advocate_version,
        },
        {
          operationId,
          invitationKind: "initial_owner",
          initiatingUserId: ACTORS.owner.userId,
          advocateId: portal.advocateId,
          invitationId: portal.invitationId,
          membershipId: redeemed.rows[0].membership_id,
          membershipVersion: redeemed.rows[0].membership_version,
          hasProvisioningRequest: true,
          resultingAdvocateVersion: 3,
        },
      )
      const exactAcceptedTopology = await assertExactProvisioningTopology(
        observer,
        portal,
      )
      return {
        blockedSessions: observations.length,
        exactAcceptedTopology,
        redemptionReceipts: state.redemption_receipt_count,
      }
    },
  )

  assert.equal(result.blockedSessions, 1)
  assert.equal(result.redemptionReceipts, 1)
  return {
    scenario: "redemption_vs_recovery",
    interleavings: 1,
    blockedSessions: result.blockedSessions,
    committedRedemptions: 1,
    recoveredRedemptions: 1,
    sameOperation: true,
    capabilityFreeRecovery: true,
    exactRecoveredOutcome: true,
    redemptionReceipts: result.redemptionReceipts,
    exactAcceptedTopology: result.exactAcceptedTopology,
    losingPathResidue: 0,
  }
}

async function differentReissueOperations(database) {
  const portal = await createPortalFixture(
    database,
    "differentReissueOperations",
    "terminal",
  )
  const secondOperationId = randomUUID()
  const secondTrace = "ff039-loser-different-reissue-operation"
  const blockedSessions = await withPgClients(
    database,
    [
      "different_reissue_observer",
      "different_reissue_first",
      "different_reissue_second",
    ],
    async (observer, first, second) => {
      const firstResult = await beginAuthenticatedCall(
        first,
        ACTORS.adminOne,
        () =>
          queryReissue(
            first,
            ACTORS.adminOne,
            portal,
            randomUUID(),
            "ff039-winner-different-reissue-operation",
            material("differentReissueOperations:first"),
          ),
      )
      assert.equal(firstResult.rows[0].created, true)
      const secondSettlement = settled(
        reissuePortal(
          second,
          ACTORS.adminTwo,
          portal,
          secondOperationId,
          secondTrace,
          material("differentReissueOperations:second"),
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [second],
        first,
      )
      await first.query("COMMIT")
      assertRejected(await secondSettlement, "55000")
      assertReissuedState(await loadPortalState(observer, portal))
      await assertNoAuditResidue(observer, [secondOperationId, secondTrace])
      return observations.length
    },
  )
  await cleanupReissuedPortal(database, portal)
  assert.equal(blockedSessions, 1)
  return {
    scenario: "different_reissue_operations",
    interleavings: 1,
    blockedSessions,
    committedReissues: 1,
    rejectedReissues: 1,
    loserSqlstate: "55000",
    replacementReceipts: 1,
    losingPathResidue: 0,
  }
}

async function differentRevocationOperations(database) {
  const portal = await createPortalFixture(
    database,
    "differentRevocationOperations",
  )
  const secondOperationId = randomUUID()
  const secondTrace = "ff039-loser-different-revocation-operation"
  const blockedSessions = await withPgClients(
    database,
    [
      "different_revocation_observer",
      "different_revocation_first",
      "different_revocation_second",
    ],
    async (observer, first, second) => {
      const firstResult = await beginAuthenticatedCall(
        first,
        ACTORS.adminOne,
        () =>
          queryRevoke(
            first,
            ACTORS.adminOne,
            portal,
            randomUUID(),
            "ff039-winner-different-revocation-operation",
          ),
      )
      assert.equal(firstResult.rows[0].created, true)
      const secondSettlement = settled(
        revokePortal(
          second,
          ACTORS.adminTwo,
          portal,
          secondOperationId,
          secondTrace,
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [second],
        first,
      )
      await first.query("COMMIT")
      assertRejected(await secondSettlement, "55000")
      assertRevokedState(await loadPortalState(observer, portal))
      await assertNoAuditResidue(observer, [secondOperationId, secondTrace])
      return observations.length
    },
  )
  assert.equal(blockedSessions, 1)
  return {
    scenario: "different_revocation_operations",
    interleavings: 1,
    blockedSessions,
    committedRevocations: 1,
    rejectedRevocations: 1,
    loserSqlstate: "55000",
    revocationReceipts: 1,
    losingPathResidue: 0,
  }
}

async function exactReissueReplay(database) {
  const portal = await createPortalFixture(
    database,
    "exactReissueReplay",
    "terminal",
  )
  const operationId = randomUUID()
  const firstMaterial = material("exactReissueReplay:first")
  const secondMaterial = material("exactReissueReplay:second")
  const result = await withPgClients(
    database,
    [
      "reissue_replay_observer",
      "reissue_replay_first",
      "reissue_replay_second",
    ],
    async (observer, first, second) => {
      const firstResult = await beginAuthenticatedCall(
        first,
        ACTORS.adminOne,
        () =>
          queryReissue(
            first,
            ACTORS.adminOne,
            portal,
            operationId,
            "ff039-reissue-replay-first",
            firstMaterial,
          ),
      )
      assert.equal(firstResult.rows[0].created, true)
      const secondTrace = "ff039-reissue-replay-second"
      const secondSettlement = settled(
        reissuePortal(
          second,
          ACTORS.adminOne,
          portal,
          operationId,
          secondTrace,
          secondMaterial,
        ),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [second],
        first,
      )
      await first.query("COMMIT")
      const secondResult = assertFulfilled(await secondSettlement)
      assert.equal(secondResult.rows[0].created, false)
      assert.deepEqual(
        {
          operationId: firstResult.rows[0].operation_id,
          advocateId: firstResult.rows[0].advocate_id,
          advocateVersion: firstResult.rows[0].advocate_version,
          status: firstResult.rows[0].onboarding_status,
        },
        {
          operationId: secondResult.rows[0].operation_id,
          advocateId: secondResult.rows[0].advocate_id,
          advocateVersion: secondResult.rows[0].advocate_version,
          status: secondResult.rows[0].onboarding_status,
        },
      )
      assertReissuedState(await loadPortalState(observer, portal))
      const authority = await assertReissueReplayAuthority(
        observer,
        portal,
        operationId,
        firstMaterial,
        secondMaterial,
      )
      await assertNoAuditResidue(observer, [secondTrace])

      const replayCapabilityOperationId = randomUUID()
      const replayCapabilityTrace = "ff039-loser-replay-capability-redemption"
      const replayCapabilitySettlement = settled(
        freshOwnerCall(second, () =>
          queryRedeem(
            second,
            portal,
            replayCapabilityOperationId,
            replayCapabilityTrace,
            secondMaterial.token,
          ),
        ),
      )
      assertRejected(await replayCapabilitySettlement, "42501")
      assertReissuedState(await loadPortalState(observer, portal))
      await assertNoAuditResidue(observer, [
        replayCapabilityOperationId,
        replayCapabilityTrace,
      ])

      const winningCapabilityOperationId = randomUUID()
      const winningCapability = await freshOwnerCall(first, () =>
        queryRedeem(
          first,
          portal,
          winningCapabilityOperationId,
          "ff039-winning-reissue-capability-redemption-trace",
          firstMaterial.token,
        ),
      )
      assert.equal(winningCapability.rowCount, 1)
      assert.equal(winningCapability.rows[0].advocate_id, portal.advocateId)
      assert.ok(winningCapability.rows[0].membership_id)
      assertRedeemedState(await loadPortalState(observer, portal), {
        reissued: true,
      })
      const exactAcceptedTopology = await assertExactProvisioningTopology(
        observer,
        portal,
        {
          invitationId: authority.invitationId,
          expectedAdvocateVersion: 3,
          resultingAdvocateVersion: 4,
        },
      )
      return {
        blockedSessions: observations.length,
        exactAcceptedTopology,
      }
    },
  )
  assert.equal(result.blockedSessions, 1)
  return {
    scenario: "exact_reissue_replay",
    interleavings: 1,
    blockedSessions: result.blockedSessions,
    createdResults: 1,
    replayedResults: 1,
    replacementReceipts: 1,
    exactReplacementAuthority: true,
    replayCapabilityRejected: true,
    winningCapabilityRedeemed: true,
    exactAcceptedTopology: result.exactAcceptedTopology,
    losingPathResidue: 0,
  }
}

async function exactRevocationReplay(database) {
  const portal = await createPortalFixture(database, "exactRevocationReplay")
  const operationId = randomUUID()
  const result = await withPgClients(
    database,
    [
      "revocation_replay_observer",
      "revocation_replay_first",
      "revocation_replay_second",
    ],
    async (observer, first, second) => {
      const firstResult = await beginAuthenticatedCall(
        first,
        ACTORS.adminOne,
        () =>
          queryRevoke(
            first,
            ACTORS.adminOne,
            portal,
            operationId,
            "ff039-revocation-replay-first",
          ),
      )
      assert.equal(firstResult.rows[0].created, true)
      const secondTrace = "ff039-revocation-replay-second"
      const secondSettlement = settled(
        revokePortal(second, ACTORS.adminOne, portal, operationId, secondTrace),
      )
      const observations = await waitForClientsBlockedBy(
        observer,
        [second],
        first,
      )
      await first.query("COMMIT")
      const secondResult = assertFulfilled(await secondSettlement)
      assert.equal(secondResult.rows[0].created, false)
      assert.deepEqual(
        {
          operationId: firstResult.rows[0].operation_id,
          advocateId: firstResult.rows[0].advocate_id,
          advocateVersion: firstResult.rows[0].advocate_version,
          status: firstResult.rows[0].revocation_status,
        },
        {
          operationId: secondResult.rows[0].operation_id,
          advocateId: secondResult.rows[0].advocate_id,
          advocateVersion: secondResult.rows[0].advocate_version,
          status: secondResult.rows[0].revocation_status,
        },
      )
      assertRevokedState(await loadPortalState(observer, portal))
      await assertNoAuditResidue(observer, [secondTrace])
      return observations.length
    },
  )
  assert.equal(result, 1)
  return {
    scenario: "exact_revocation_replay",
    interleavings: 1,
    blockedSessions: result,
    createdResults: 1,
    replayedResults: 1,
    revocationReceipts: 1,
    losingPathResidue: 0,
  }
}

async function main() {
  let database
  const outputPath = evidenceOutputPath()
  const removeTerminationCleanup = installConcurrencyGateTerminationCleanup({
    gate: "FF-039",
    getDatabase: () => database,
  })
  try {
    await clearConcurrencyGateEvidence(outputPath)
    database = await createTransientLocalSupabaseDatabase({
      workspace: WORKSPACE,
      databasePrefix: "ff039",
    })
    const provenance = await loadConcurrencyGateProvenance(database, {
      workspace: WORKSPACE,
    })
    await database.executeSupabaseAdminSql(await readFile(FIXTURE_PATH, "utf8"))

    const scenarios = []
    scenarios.push(await claimVersusRevoke(database))
    process.stdout.write("ok FF-039 claim versus revoke\n")
    scenarios.push(await deliveryStartVersusRevoke(database))
    process.stdout.write("ok FF-039 delivery start versus revoke\n")
    scenarios.push(await redemptionVersusReissue(database))
    process.stdout.write("ok FF-039 redemption versus reissue\n")
    scenarios.push(await redemptionVersusArchive(database))
    process.stdout.write("ok FF-039 redemption versus archive\n")
    scenarios.push(await reissueVersusRevocation(database))
    process.stdout.write("ok FF-039 reissue versus revocation\n")
    scenarios.push(await concurrentRedemption(database))
    process.stdout.write("ok FF-039 concurrent redemption\n")
    scenarios.push(await redemptionVersusRecovery(database))
    process.stdout.write("ok FF-039 redemption versus recovery\n")
    scenarios.push(await differentReissueOperations(database))
    process.stdout.write("ok FF-039 different reissue operations\n")
    scenarios.push(await differentRevocationOperations(database))
    process.stdout.write("ok FF-039 different revocation operations\n")
    scenarios.push(await exactReissueReplay(database))
    process.stdout.write("ok FF-039 exact reissue replay\n")
    scenarios.push(await exactRevocationReplay(database))
    process.stdout.write("ok FF-039 exact revocation replay\n")

    assert.equal(scenarios.length, 11)
    assert.equal(
      scenarios.reduce((total, scenario) => total + scenario.interleavings, 0),
      16,
    )
    assert.equal(
      scenarios.every(
        (scenario) =>
          scenario.blockedSessions >= 1 && scenario.losingPathResidue === 0,
      ),
      true,
    )

    await database.dispose()
    database = undefined
    await writeConcurrencyGateEvidence({
      gate: "FF-039",
      outputPath,
      provenance,
      synchronization: "server_observed_blocking_pids_and_skip_locked_results",
      scenarios,
    })
    process.stdout.write(
      "FF-039 initial owner authority concurrency gate passed\n",
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
