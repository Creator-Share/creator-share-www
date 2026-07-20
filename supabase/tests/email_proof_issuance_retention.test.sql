BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.purge_expired_sponsor_authentication_evidence(integer)'::regprocedure
  )
  AND has_function_privilege(
    'service_role',
    'public.purge_expired_sponsor_authentication_evidence(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_expired_sponsor_authentication_evidence(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.purge_expired_sponsor_authentication_evidence(integer)',
    'EXECUTE'
  ),
  'email proof retention remains inside the locked sponsor authentication boundary'
);

SELECT extensions.is(
  private.data_retention_step_keys(),
  ARRAY[
    'checkout_contact_envelopes',
    'email_outbox_contact',
    'gateway_event_payloads',
    'audit_forensics',
    'sponsor_authentication',
    'advocate_tracking'
  ]::text[],
  'email proof cleanup does not consume a seventh retention step'
);

SELECT extensions.is(
  private.data_retention_zero_counts('sponsor_authentication'),
  '{
    "recent_auth_receipts_deleted": 0,
    "passwordless_reservations_deleted": 0,
    "passwordless_verification_attempts_deleted": 0,
    "advocate_invitation_authentication_attempts_deleted": 0,
    "email_proof_issuance_gates_deleted": 0
  }'::jsonb,
  'the sponsor authentication zero aggregate includes email proof gates'
);

SELECT extensions.ok(
  private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 1,
      "passwordless_reservations_deleted": 2,
      "passwordless_verification_attempts_deleted": 3
    }'::jsonb
  )
  AND private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 1,
      "passwordless_reservations_deleted": 2,
      "passwordless_verification_attempts_deleted": 3,
      "advocate_invitation_authentication_attempts_deleted": 4
    }'::jsonb
  )
  AND private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 1,
      "passwordless_reservations_deleted": 2,
      "passwordless_verification_attempts_deleted": 3,
      "advocate_invitation_authentication_attempts_deleted": 4,
      "email_proof_issuance_gates_deleted": 5
    }'::jsonb
  ),
  'rolling deployments accept only the historical three, four, and current five count families'
);

SELECT extensions.ok(
  NOT private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 1,
      "passwordless_reservations_deleted": 2,
      "passwordless_verification_attempts_deleted": 3,
      "email_proof_issuance_gates_deleted": 5
    }'::jsonb
  )
  AND NOT private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 1,
      "passwordless_reservations_deleted": 2,
      "passwordless_verification_attempts_deleted": 3,
      "advocate_invitation_authentication_attempts_deleted": 4,
      "email_proof_issuance_gates_deleted": "5"
    }'::jsonb
  )
  AND NOT private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 1,
      "passwordless_reservations_deleted": 2,
      "passwordless_verification_attempts_deleted": 3,
      "advocate_invitation_authentication_attempts_deleted": 4,
      "email_proof_issuance_gates_deleted": 5001
    }'::jsonb
  )
  AND NOT private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 1,
      "passwordless_reservations_deleted": 2,
      "passwordless_verification_attempts_deleted": 3,
      "advocate_invitation_authentication_attempts_deleted": 4,
      "email_proof_issuance_gates_deleted": 5,
      "recipient_digest": 6
    }'::jsonb
  ),
  'malformed, transitional, unbounded, and expanded count envelopes fail closed'
);

SET LOCAL ROLE anon;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.purge_expired_sponsor_authentication_evidence(1)
  $$,
  '42501',
  'permission denied for function purge_expired_sponsor_authentication_evidence',
  'anonymous callers cannot reach email proof retention through the sponsor purge'
);

RESET ROLE;

WITH shifted AS (
  SELECT clock_timestamp() - interval '2 minutes' AS acquired_at
)
INSERT INTO private.email_proof_issuance_gates (
  id,
  recipient_normalization_version,
  recipient_hmac_key_version,
  recipient_digest,
  issuance_flow,
  operation_id,
  lease_token_digest,
  phase,
  reservation_acquired_at,
  reservation_expires_at,
  updated_at
)
SELECT
  'e1000000-0000-4000-8000-000000000001'::uuid,
  1,
  1,
  decode(repeat('e1', 32), 'hex'),
  'generic-sign-in',
  'e1100000-0000-4000-8000-000000000001'::uuid,
  decode(repeat('a1', 32), 'hex'),
  'reserved',
  shifted.acquired_at,
  shifted.acquired_at + interval '30 seconds',
  shifted.acquired_at
FROM shifted;

WITH shifted AS (
  SELECT clock_timestamp() - interval '66 minutes' AS started_at
)
INSERT INTO private.email_proof_issuance_gates (
  id,
  recipient_normalization_version,
  recipient_hmac_key_version,
  recipient_digest,
  issuance_flow,
  operation_id,
  lease_token_digest,
  phase,
  reservation_acquired_at,
  reservation_expires_at,
  issuance_started_at,
  next_issuance_at,
  proof_exclusivity_expires_at,
  finish_disposition,
  finished_at,
  updated_at
)
SELECT
  'e2000000-0000-4000-8000-000000000002'::uuid,
  1,
  1,
  decode(repeat('e2', 32), 'hex'),
  'registration',
  'e2100000-0000-4000-8000-000000000002'::uuid,
  decode(repeat('a2', 32), 'hex'),
  'finished',
  shifted.started_at - interval '1 second',
  shifted.started_at + interval '29 seconds',
  shifted.started_at,
  shifted.started_at + interval '65 seconds',
  shifted.started_at + interval '65 minutes',
  'issued',
  shifted.started_at + interval '1 second',
  shifted.started_at + interval '1 second'
FROM shifted;

WITH shifted AS (
  SELECT clock_timestamp() AS acquired_at
)
INSERT INTO private.email_proof_issuance_gates (
  id,
  recipient_normalization_version,
  recipient_hmac_key_version,
  recipient_digest,
  issuance_flow,
  operation_id,
  lease_token_digest,
  phase,
  reservation_acquired_at,
  reservation_expires_at,
  updated_at
)
SELECT
  'e3000000-0000-4000-8000-000000000003'::uuid,
  1,
  1,
  decode(repeat('e3', 32), 'hex'),
  'password-reset',
  'e3100000-0000-4000-8000-000000000003'::uuid,
  decode(repeat('a3', 32), 'hex'),
  'reserved',
  shifted.acquired_at,
  shifted.acquired_at + interval '30 seconds',
  shifted.acquired_at
FROM shifted;

WITH shifted AS (
  SELECT clock_timestamp() - interval '60 minutes' AS started_at
)
INSERT INTO private.email_proof_issuance_gates (
  id,
  recipient_normalization_version,
  recipient_hmac_key_version,
  recipient_digest,
  issuance_flow,
  operation_id,
  lease_token_digest,
  phase,
  reservation_acquired_at,
  reservation_expires_at,
  issuance_started_at,
  next_issuance_at,
  proof_exclusivity_expires_at,
  updated_at
)
SELECT
  'e3500000-0000-4000-8000-000000000003'::uuid,
  1,
  1,
  decode(repeat('e6', 32), 'hex'),
  'creator-share-admin-invitation',
  'e3600000-0000-4000-8000-000000000003'::uuid,
  decode(repeat('a6', 32), 'hex'),
  'begun',
  shifted.started_at - interval '1 second',
  shifted.started_at + interval '29 seconds',
  shifted.started_at,
  shifted.started_at + interval '65 seconds',
  shifted.started_at + interval '65 minutes',
  shifted.started_at
FROM shifted;

WITH shifted AS (
  SELECT clock_timestamp() - interval '60 minutes' AS started_at
)
INSERT INTO private.email_proof_issuance_gates (
  id,
  recipient_normalization_version,
  recipient_hmac_key_version,
  recipient_digest,
  issuance_flow,
  operation_id,
  lease_token_digest,
  phase,
  reservation_acquired_at,
  reservation_expires_at,
  issuance_started_at,
  next_issuance_at,
  proof_exclusivity_expires_at,
  finish_disposition,
  finished_at,
  updated_at
)
SELECT
  'e4000000-0000-4000-8000-000000000004'::uuid,
  1,
  1,
  decode(repeat('e4', 32), 'hex'),
  'reauthentication',
  'e4100000-0000-4000-8000-000000000004'::uuid,
  decode(repeat('a4', 32), 'hex'),
  'finished',
  shifted.started_at - interval '1 second',
  shifted.started_at + interval '29 seconds',
  shifted.started_at,
  shifted.started_at + interval '65 seconds',
  shifted.started_at + interval '65 minutes',
  'ambiguous',
  shifted.started_at + interval '1 second',
  shifted.started_at + interval '1 second'
FROM shifted;

SELECT extensions.ok(
  (
    SELECT backlog.has_more
      AND backlog.oldest_expired_at <= clock_timestamp()
      AND backlog.oldest_expired_at = (
        SELECT gate.reservation_expires_at
        FROM private.email_proof_issuance_gates gate
        WHERE gate.id = 'e1000000-0000-4000-8000-000000000001'::uuid
      )
    FROM private.data_retention_backlog('sponsor_authentication') backlog
  ),
  'email proof backlog reports the exact oldest fully expired fence timestamp'
);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

CREATE TEMP TABLE first_email_proof_retention
ON COMMIT DROP
AS
SELECT *
FROM public.purge_expired_sponsor_authentication_evidence(1);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT email_proof_issuance_gates_deleted = 1
    FROM first_email_proof_retention
  )
  AND (
    SELECT count(*) = 1
    FROM private.email_proof_issuance_gates gate
    WHERE gate.id IN (
      'e1000000-0000-4000-8000-000000000001'::uuid,
      'e2000000-0000-4000-8000-000000000002'::uuid
    )
  ),
  'one sponsor purge removes at most one expired email proof gate'
);

SET LOCAL ROLE service_role;

CREATE TEMP TABLE second_email_proof_retention
ON COMMIT DROP
AS
SELECT *
FROM public.purge_expired_sponsor_authentication_evidence(10);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT email_proof_issuance_gates_deleted = 1
    FROM second_email_proof_retention
  )
  AND (
    SELECT count(*) = 3
    FROM private.email_proof_issuance_gates gate
    WHERE gate.id IN (
      'e3000000-0000-4000-8000-000000000003'::uuid,
      'e3500000-0000-4000-8000-000000000003'::uuid,
      'e4000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  'a later purge preserves reserved, begun, and finished gates until every fence expires'
);

SET LOCAL ROLE service_role;

CREATE TEMP TABLE replayed_email_proof_retention
ON COMMIT DROP
AS
SELECT *
FROM public.purge_expired_sponsor_authentication_evidence(10);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT email_proof_issuance_gates_deleted = 0
    FROM replayed_email_proof_retention
  )
  AND (
    SELECT count(*) = 3
    FROM private.email_proof_issuance_gates gate
    WHERE gate.id IN (
      'e3000000-0000-4000-8000-000000000003'::uuid,
      'e3500000-0000-4000-8000-000000000003'::uuid,
      'e4000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  'replayed retention is idempotent while all remaining gates are protected'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 2
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'email_proof_issuance_gates'
      AND event.operation = 'DELETE'
      AND event.record_pk ->> 'id' IN (
        'e1000000-0000-4000-8000-000000000001',
        'e2000000-0000-4000-8000-000000000002'
      )
      AND event.tool = 'purge_expired_email_proof_issuance_gates'
      AND event.before_data ->> 'recipient_digest' = '[REDACTED]'
      AND event.before_data ->> 'lease_token_digest' = '[REDACTED]'
      AND event.after_data IS NULL
  ),
  'scheduled gate deletion emits only sanitized row audit evidence'
);

WITH shifted AS (
  SELECT clock_timestamp() - interval '2 minutes' AS acquired_at
)
INSERT INTO private.email_proof_issuance_gates (
  id,
  recipient_normalization_version,
  recipient_hmac_key_version,
  recipient_digest,
  issuance_flow,
  operation_id,
  lease_token_digest,
  phase,
  reservation_acquired_at,
  reservation_expires_at,
  updated_at
)
SELECT
  'e5000000-0000-4000-8000-000000000005'::uuid,
  1,
  1,
  decode(repeat('e5', 32), 'hex'),
  'account-claim',
  'e5100000-0000-4000-8000-000000000005'::uuid,
  decode(repeat('a5', 32), 'hex'),
  'reserved',
  shifted.acquired_at,
  shifted.acquired_at + interval '30 seconds',
  shifted.acquired_at
FROM shifted;

SET LOCAL ROLE service_role;

SELECT extensions.is(
  public.start_data_retention_run(
    'e6000000-0000-4000-8000-000000000006'::uuid,
    10,
    'email-proof-retention-run',
    'email-proof-retention-trace'
  ),
  'e6000000-0000-4000-8000-000000000006'::uuid,
  'the existing hourly lifecycle starts without a new top-level step'
);

CREATE TEMP TABLE email_proof_retention_step
ON COMMIT DROP
AS
SELECT public.run_data_retention_step(
  'e6000000-0000-4000-8000-000000000006'::uuid,
  'sponsor_authentication',
  10,
  'email-proof-retention-run',
  'email-proof-retention-trace'
) AS result;

SELECT extensions.ok(
  (
    SELECT result ->> 'step_key' = 'sponsor_authentication'
      AND result -> 'counts' = '{
        "recent_auth_receipts_deleted": 0,
        "passwordless_reservations_deleted": 0,
        "passwordless_verification_attempts_deleted": 0,
        "advocate_invitation_authentication_attempts_deleted": 0,
        "email_proof_issuance_gates_deleted": 1
      }'::jsonb
      AND (result ->> 'has_more')::boolean = false
      AND result -> 'oldest_expired_at' = 'null'::jsonb
    FROM email_proof_retention_step
  ),
  'the sponsor authentication step reports the fifth bounded count and clears backlog'
);

RESET ROLE;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.data_retention_run_events event
    WHERE event.run_id = 'e6000000-0000-4000-8000-000000000006'::uuid
      AND event.event_kind = 'step_outcome'
      AND event.step_key = 'sponsor_authentication'
      AND event.counts = '{
        "recent_auth_receipts_deleted": 0,
        "passwordless_reservations_deleted": 0,
        "passwordless_verification_attempts_deleted": 0,
        "advocate_invitation_authentication_attempts_deleted": 0,
        "email_proof_issuance_gates_deleted": 1
      }'::jsonb
      AND event.request_id = 'email-proof-retention-run'
      AND event.trace_id = 'email-proof-retention-trace'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM audit.data_retention_run_events event
    WHERE event.run_id = 'e6000000-0000-4000-8000-000000000006'::uuid
      AND (
        event.counts ? 'recipient_digest'
        OR event.counts ? 'operation_id'
        OR event.counts ? 'lease_token_digest'
      )
  ),
  'durable retention audit stores only aggregate counts and bounded correlation context'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'email_proof_issuance_gates'
      AND event.operation = 'DELETE'
      AND event.record_pk ->> 'id' =
        'e5000000-0000-4000-8000-000000000005'
      AND event.system_actor = 'retention-worker'
      AND event.tool = 'database-retention'
      AND event.request_id = 'email-proof-retention-run'
      AND event.trace_id = 'email-proof-retention-trace'
      AND event.metadata ->> 'batch_id' =
        'e6000000-0000-4000-8000-000000000006'
      AND event.metadata ->> 'resource_kind' =
        'email_proof_issuance_gate'
      AND event.before_data ->> 'recipient_digest' = '[REDACTED]'
      AND event.before_data ->> 'lease_token_digest' = '[REDACTED]'
      AND event.after_data IS NULL
  ),
  'gate row audit inherits the hourly run context without retaining proof identifiers'
);

SELECT * FROM extensions.finish();

ROLLBACK;
