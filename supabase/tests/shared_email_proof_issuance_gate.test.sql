BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.columns_are(
  'private',
  'email_proof_issuance_gates',
  ARRAY[
    'id',
    'recipient_normalization_version',
    'recipient_hmac_key_version',
    'recipient_digest',
    'issuance_flow',
    'operation_id',
    'lease_token_digest',
    'phase',
    'reservation_acquired_at',
    'reservation_expires_at',
    'issuance_started_at',
    'next_issuance_at',
    'proof_exclusivity_expires_at',
    'finish_disposition',
    'finished_at',
    'updated_at',
    'legacy_proof_quarantine_expires_at'
  ],
  'the gate stores one bounded state machine without raw contact or provider material'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity AND relation.relforcerowsecurity
    FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'private.email_proof_issuance_gates'::regclass
  ),
  'the private gate uses forced row level security'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'private.email_proof_issuance_gates',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.email_proof_issuance_gates',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.email_proof_issuance_gates',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'runtime roles have no direct gate table access'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM pg_catalog.pg_constraint constraint_definition
    WHERE constraint_definition.conrelid =
        'private.email_proof_issuance_gates'::regclass
      AND constraint_definition.contype = 'u'
      AND pg_catalog.pg_get_constraintdef(constraint_definition.oid) =
        'UNIQUE (recipient_normalization_version, recipient_hmac_key_version, recipient_digest)'
  ),
  'one unique row exists per versioned 32-byte recipient HMAC'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'private'
      AND column_definition.table_name = 'email_proof_issuance_gates'
      AND column_definition.column_name IN (
        'email',
        'recipient_email',
        'source',
        'source_digest',
        'provider',
        'provider_response',
        'proof',
        'proof_hash',
        'proof_token',
        'token'
      )
  ),
  'the gate has no raw email, request source, provider response, or proof material column'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 5
    FROM pg_catalog.pg_proc routine
    WHERE routine.oid IN (
      'public.acquire_email_proof_issuance_gate(bytea,smallint,smallint,text,uuid,bytea,uuid,text)'::regprocedure,
      'public.begin_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,uuid,text)'::regprocedure,
      'public.finish_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,text,uuid,text)'::regprocedure,
      'public.abandon_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,uuid,text)'::regprocedure,
      'public.purge_expired_email_proof_issuance_gates(integer)'::regprocedure
    )
      AND routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
  ),
  'every public gate RPC is a locked security definer boundary'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.acquire_email_proof_issuance_gate(bytea,smallint,smallint,text,uuid,bytea,uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.begin_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.finish_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,text,uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.abandon_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.purge_expired_email_proof_issuance_gates(integer)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (
      VALUES ('anon'), ('authenticated')
    ) denied_role(role_name)
    CROSS JOIN (
      VALUES
        ('public.acquire_email_proof_issuance_gate(bytea,smallint,smallint,text,uuid,bytea,uuid,text)'),
        ('public.begin_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,uuid,text)'),
        ('public.finish_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,text,uuid,text)'),
        ('public.abandon_email_proof_issuance(bytea,smallint,smallint,text,uuid,bytea,uuid,text)'),
        ('public.purge_expired_email_proof_issuance_gates(integer)')
    ) denied_routine(routine_name)
    WHERE has_function_privilege(
      denied_role.role_name,
      denied_routine.routine_name,
      'EXECUTE'
    )
  ),
  'only the service role can invoke the public gate RPCs'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'private.require_email_proof_issuance_service_role()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.validate_email_proof_issuance_fence_input(bytea,smallint,smallint,text,uuid,bytea,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.prevent_email_proof_issuance_gate_truncate()',
    'EXECUTE'
  ),
  'the service role cannot invoke gate internals directly'
);

SELECT extensions.is(
  pg_catalog.pg_get_function_result(
    'public.acquire_email_proof_issuance_gate(bytea,smallint,smallint,text,uuid,bytea,uuid,text)'::regprocedure
  ),
  'TABLE(acquisition_result text, retry_after_seconds integer)',
  'acquire returns only the strict category and privacy-safe retry delay'
);

SELECT extensions.ok(
  NOT (
    pg_catalog.pg_get_functiondef(
      'public.acquire_email_proof_issuance_gate(bytea,smallint,smallint,text,uuid,bytea,uuid,text)'::regprocedure
    ) ILIKE '%advisory%'
  ),
  'acquisition contains no global advisory lock'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
        'private.email_proof_issuance_gates'::regclass
      AND trigger_definition.tgname =
        'email_proof_issuance_gates_audit_row_change'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled = 'O'
      AND trigger_definition.tgfoid =
        'audit.capture_row_change()'::regprocedure
  ),
  'every gate mutation enters the repository audit ledger'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
        'private.email_proof_issuance_gates'::regclass
      AND trigger_definition.tgname =
        'email_proof_issuance_gates_no_truncate'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled = 'O'
      AND trigger_definition.tgfoid =
        'private.prevent_email_proof_issuance_gate_truncate()'::regprocedure
  ),
  'a statement trigger rejects unauditable gate truncation'
);

SELECT extensions.ok(
  (
    SELECT array_agg(flow_match[1] ORDER BY flow_match[1]) = ARRAY[
      'account-claim',
      'advocate-invitation',
      'creator-share-admin-invitation',
      'generic-sign-in',
      'initial-claim',
      'password-reset',
      'reauthentication',
      'registration'
    ]::text[]
    FROM pg_catalog.pg_constraint constraint_definition
    CROSS JOIN LATERAL regexp_matches(
      pg_catalog.pg_get_constraintdef(constraint_definition.oid),
      '''([^'']+)''',
      'g'
    ) flow_match
    WHERE constraint_definition.conrelid =
        'private.email_proof_issuance_gates'::regclass
      AND constraint_definition.conname =
        'email_proof_issuance_gates_issuance_flow_check'
  ),
  'the bounded flow vocabulary exactly covers every inventoried proof issuer'
);

CREATE FUNCTION pg_temp.acquire_email_proof_issuance_gate(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_operation_id uuid,
  target_lease_token bytea,
  target_issuance_flow text DEFAULT 'advocate-invitation'
)
RETURNS TABLE (acquisition_result text, retry_after_seconds integer)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT *
  FROM public.acquire_email_proof_issuance_gate(
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_issuance_flow,
    target_operation_id,
    target_lease_token,
    gen_random_uuid(),
    'shared-email-proof-pgtap-acquire'
  );
$$;

CREATE FUNCTION pg_temp.begin_email_proof_issuance(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_operation_id uuid,
  target_lease_token bytea,
  target_issuance_flow text DEFAULT 'advocate-invitation'
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public.begin_email_proof_issuance(
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_issuance_flow,
    target_operation_id,
    target_lease_token,
    gen_random_uuid(),
    'shared-email-proof-pgtap-begin'
  );
$$;

CREATE FUNCTION pg_temp.finish_email_proof_issuance(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_operation_id uuid,
  target_lease_token bytea,
  target_finish_disposition text,
  target_issuance_flow text DEFAULT 'advocate-invitation'
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public.finish_email_proof_issuance(
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_issuance_flow,
    target_operation_id,
    target_lease_token,
    target_finish_disposition,
    gen_random_uuid(),
    'shared-email-proof-pgtap-finish'
  );
$$;

CREATE FUNCTION pg_temp.abandon_email_proof_issuance(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_operation_id uuid,
  target_lease_token bytea,
  target_issuance_flow text DEFAULT 'advocate-invitation'
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public.abandon_email_proof_issuance(
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_issuance_flow,
    target_operation_id,
    target_lease_token,
    gen_random_uuid(),
    'shared-email-proof-pgtap-abandon'
  );
$$;

SELECT extensions.throws_ok(
  $$
    TRUNCATE TABLE private.email_proof_issuance_gates
  $$,
  '42501',
  'Email proof issuance gates cannot be truncated',
  'privileged maintenance cannot bypass row audit by truncating the gate'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('01', 32), 'hex'),
      1::smallint,
      1::smallint,
      '10000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex')
    )
  $$,
  '42501',
  'permission denied for function acquire_email_proof_issuance_gate',
  'an anonymous caller cannot acquire a recipient gate'
);

RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('01', 31), 'hex'),
      1::smallint,
      1::smallint,
      '10000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex')
    )
  $$,
  '22023',
  'Email proof issuance fence input is invalid',
  'recipient HMAC input must be exactly 32 bytes'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('01', 32), 'hex'),
      1::smallint,
      1::smallint,
      '10000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 31), 'hex')
    )
  $$,
  '22023',
  'Email proof issuance fence input is invalid',
  'lease fencing material must be exactly 256 bits'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('01', 32), 'hex'),
      1::smallint,
      2::smallint,
      '10000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex')
    )
  $$,
  '22023',
  'Email proof issuance fence input is invalid',
  'MVP rejects a second HMAC key version that could split a recipient fence'
);

SELECT extensions.is(
  (
    SELECT acquisition_result || ':' || retry_after_seconds::text
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex')
    )
  ),
  'acquired:0',
  'the first operation acquires its recipient row with no retry delay'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      gate.phase = 'reserved'
      AND gate.reservation_expires_at =
        gate.reservation_acquired_at + interval '30 seconds'
      AND gate.operation_id =
        '11000000-0000-4000-8000-000000000001'::uuid
      AND gate.lease_token_digest = extensions.digest(
        decode(repeat('a1', 32), 'hex'),
        'sha256'
      )
      AND gate.lease_token_digest <>
        decode(repeat('a1', 32), 'hex')
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_digest = decode(repeat('11', 32), 'hex')
  ),
  'acquire stores a 30-second reservation and only the lease digest'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT acquisition_result || ':' || retry_after_seconds::text
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex')
    )
  ),
  'acquired:0',
  'an exact live acquire replay with the same operation and lease is safe'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a2', 32), 'hex')
    )
  ),
  'coalesced',
  'an active duplicate operation coalesces without receiving the incumbent lease'
);

SELECT extensions.ok(
  (
    SELECT retry_after_seconds BETWEEN 1 AND 30
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a2', 32), 'hex')
    )
  ),
  'a coalesced reservation returns only its rounded bounded retry interval'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a2', 32), 'hex'),
      'registration'
    )
  ),
  'deferred',
  'a reused operation cannot coalesce across different issuance flows'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('a2', 32), 'hex')
    )
  ),
  'deferred',
  'a different operation is deferred behind an active reservation'
);

SELECT extensions.ok(
  (
    SELECT retry_after_seconds BETWEEN 1 AND 30
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('a2', 32), 'hex')
    )
  ),
  'a deferred reservation returns only its rounded bounded retry interval'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.begin_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a2', 32), 'hex')
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'begin rejects the wrong 256-bit lease token'
);

SELECT extensions.lives_ok(
  $$
    SELECT pg_temp.begin_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex')
    )
  $$,
  'the exact operation and lease can begin issuance'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      gate.phase = 'begun'
      AND gate.next_issuance_at =
        gate.issuance_started_at + interval '65 seconds'
      AND gate.proof_exclusivity_expires_at =
        gate.issuance_started_at + interval '65 minutes'
      AND gate.finish_disposition IS NULL
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_digest = decode(repeat('11', 32), 'hex')
  ),
  'begin pessimistically installs the 65-second and 65-minute barriers'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.begin_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex')
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'a begun fence cannot authorize a second provider call after a lost response'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.abandon_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex')
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'a begun issuance can never use the pre-begin abandonment path'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a3', 32), 'hex')
    )
  ),
  'coalesced',
  'the begun operation continues to coalesce without disclosing its lease'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('a3', 32), 'hex')
    )
  ),
  'deferred',
  'a different operation remains deferred after issuance begins'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.finish_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a2', 32), 'hex'),
      'issued'
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'finish rejects the wrong lease token'
);

SELECT extensions.lives_ok(
  $$
    SELECT pg_temp.finish_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex'),
      'issued'
    )
  $$,
  'the exact operation and lease can record an issued proof'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      gate.phase = 'finished'
      AND gate.finish_disposition = 'issued'
      AND gate.proof_exclusivity_expires_at =
        gate.issuance_started_at + interval '65 minutes'
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_digest = decode(repeat('11', 32), 'hex')
  ),
  'an issued proof retains the complete 65-minute exclusivity fence'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.lives_ok(
  $$
    SELECT pg_temp.finish_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex'),
      'issued'
    )
  $$,
  'an exact finish retry is idempotent'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.finish_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a1', 32), 'hex'),
      'ambiguous'
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'an issued outcome cannot be rewritten as ambiguous by an exact lease holder'
);

SELECT extensions.is(
  public.purge_expired_email_proof_issuance_gates(100),
  0,
  'retention cannot remove a row while any issuance fence remains active'
);

RESET ROLE;

WITH shifted AS (
  SELECT clock_timestamp() - interval '66 minutes' AS started_at
)
UPDATE private.email_proof_issuance_gates gate
SET
  reservation_acquired_at = shifted.started_at - interval '1 second',
  reservation_expires_at = shifted.started_at + interval '29 seconds',
  issuance_started_at = shifted.started_at,
  next_issuance_at = shifted.started_at + interval '65 seconds',
  proof_exclusivity_expires_at = shifted.started_at + interval '65 minutes',
  finished_at = shifted.started_at + interval '1 second',
  updated_at = shifted.started_at + interval '1 second'
FROM shifted
WHERE gate.recipient_digest = decode(repeat('11', 32), 'hex');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      '11000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('a2', 32), 'hex')
    )
  ),
  'acquired',
  'the same operation reacquires only after every prior fence expires'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT count(*) >= 4
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'email_proof_issuance_gates'
  ),
  'the immutable audit layer records every gate state mutation'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      COALESCE(event.before_data ->> 'recipient_digest', '[REDACTED]') =
        '[REDACTED]'
      AND COALESCE(event.after_data ->> 'recipient_digest', '[REDACTED]') =
        '[REDACTED]'
      AND COALESCE(event.before_data ->> 'lease_token_digest', '[REDACTED]') =
        '[REDACTED]'
      AND COALESCE(event.after_data ->> 'lease_token_digest', '[REDACTED]') =
        '[REDACTED]'
    )
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'email_proof_issuance_gates'
  ),
  'audit row images redact both recipient and lease digests'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      event.record_pk = jsonb_build_object('id', event.record_pk -> 'id')
    )
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'email_proof_issuance_gates'
  ),
  'audit record identities contain only the surrogate row identifier'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      event.request_id IS NOT NULL
      AND event.request_id IS DISTINCT FROM
        COALESCE(
          event.after_data ->> 'operation_id',
          event.before_data ->> 'operation_id'
        )
    )
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'email_proof_issuance_gates'
      AND event.tool IN (
        'acquire_email_proof_issuance_gate',
        'begin_email_proof_issuance',
        'finish_email_proof_issuance',
        'abandon_email_proof_issuance'
      )
  ),
  'audit events preserve a request identifier separate from operation identity'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      event.trace_id IS NOT NULL
      AND event.trace_id LIKE 'shared-email-proof-pgtap-%'
    )
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'email_proof_issuance_gates'
      AND event.tool IN (
        'acquire_email_proof_issuance_gate',
        'begin_email_proof_issuance',
        'finish_email_proof_issuance',
        'abandon_email_proof_issuance'
      )
  ),
  'audit events preserve the bounded diagnostic trace identifier'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('b1', 32), 'hex')
    )
  ),
  'acquired',
  'a crash-before-begin fixture first acquires normally'
);

RESET ROLE;

WITH shifted AS (
  SELECT clock_timestamp() - interval '31 seconds' AS acquired_at
)
UPDATE private.email_proof_issuance_gates gate
SET
  reservation_acquired_at = shifted.acquired_at,
  reservation_expires_at = shifted.acquired_at + interval '30 seconds',
  updated_at = shifted.acquired_at
FROM shifted
WHERE gate.recipient_digest = decode(repeat('22', 32), 'hex');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.begin_email_proof_issuance(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('b1', 32), 'hex')
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'begin rejects a stale reservation lease after 30 seconds'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('b1', 32), 'hex')
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'an expired exact lease cannot resurrect its stale issuance epoch'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      gate.phase = 'reserved'
      AND gate.operation_id =
        '22000000-0000-4000-8000-000000000001'::uuid
      AND gate.lease_token_digest = extensions.digest(
        decode(repeat('b1', 32), 'hex'),
        'sha256'
      )
      AND gate.reservation_expires_at <= clock_timestamp()
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_digest = decode(repeat('22', 32), 'hex')
  ),
  'a rejected stale reclaim leaves the expired gate unchanged'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('b2', 32), 'hex')
    )
  ),
  'acquired',
  'the same operation can reclaim a crash-before-begin reservation'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.begin_email_proof_issuance(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('b1', 32), 'hex')
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'the prior lease token stays stale after reservation reclaim'
);

SELECT extensions.lives_ok(
  $$
    SELECT pg_temp.begin_email_proof_issuance(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('b2', 32), 'hex')
    )
  $$,
  'the reclaimed lease can begin issuance'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.finish_email_proof_issuance(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('b2', 32), 'hex'),
      'not_issued'
    )
  $$,
  '22023',
  'Email proof issuance finish disposition is invalid',
  'the database cannot represent unprovable nonissuance after begin'
);

SELECT extensions.lives_ok(
  $$
    SELECT pg_temp.finish_email_proof_issuance(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('b2', 32), 'hex'),
      'ambiguous'
    )
  $$,
  'the reclaimed lease records provider uncertainty as ambiguous'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('b3', 32), 'hex')
    )
  ),
  'deferred',
  'an ambiguous result preserves the complete proof exclusivity fence'
);

SELECT extensions.ok(
  (
    SELECT retry_after_seconds BETWEEN 3899 AND 3900
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('b3', 32), 'hex')
    )
  ),
  'an ambiguous result returns a rounded retry capped at the 65-minute fence'
);

RESET ROLE;

WITH shifted AS (
  SELECT clock_timestamp() - interval '66 minutes' AS started_at
)
UPDATE private.email_proof_issuance_gates gate
SET
  reservation_acquired_at = shifted.started_at - interval '1 second',
  reservation_expires_at = shifted.started_at + interval '29 seconds',
  issuance_started_at = shifted.started_at,
  next_issuance_at = shifted.started_at + interval '65 seconds',
  proof_exclusivity_expires_at = shifted.started_at + interval '65 minutes',
  finished_at = shifted.started_at + interval '1 second',
  updated_at = shifted.started_at + interval '1 second'
FROM shifted
WHERE gate.recipient_digest = decode(repeat('22', 32), 'hex');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      '22000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('b3', 32), 'hex')
    )
  ),
  'acquired',
  'an ambiguous row permits reuse only after its full 65-minute fence'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('33', 32), 'hex'),
      1::smallint,
      1::smallint,
      '33000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('c1', 32), 'hex')
    )
  ),
  'acquired',
  'a pre-begin abandonment fixture first acquires normally'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.abandon_email_proof_issuance(
      decode(repeat('33', 32), 'hex'),
      1::smallint,
      1::smallint,
      '33000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('c1', 32), 'hex')
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'abandon rejects a different operation even with the exact lease token'
);

SELECT extensions.lives_ok(
  $$
    SELECT pg_temp.abandon_email_proof_issuance(
      decode(repeat('33', 32), 'hex'),
      1::smallint,
      1::smallint,
      '33000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('c1', 32), 'hex')
    )
  $$,
  'the exact operation and lease can abandon only before begin'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('33', 32), 'hex'),
      1::smallint,
      1::smallint,
      '33000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('c2', 32), 'hex')
    )
  ),
  'acquired',
  'a new operation acquires immediately after exact pre-begin abandonment'
);

SELECT extensions.lives_ok(
  $$
    SELECT *
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('44', 32), 'hex'),
      1::smallint,
      1::smallint,
      '44000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('d1', 32), 'hex')
    );
    SELECT pg_temp.begin_email_proof_issuance(
      decode(repeat('44', 32), 'hex'),
      1::smallint,
      1::smallint,
      '44000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('d1', 32), 'hex')
    );
    SELECT pg_temp.finish_email_proof_issuance(
      decode(repeat('44', 32), 'hex'),
      1::smallint,
      1::smallint,
      '44000000-0000-4000-8000-000000000001'::uuid,
      decode(repeat('d1', 32), 'hex'),
      'ambiguous'
    )
  $$,
  'an ambiguous provider outcome reaches a fenced terminal state'
);

SELECT extensions.is(
  (
    SELECT acquisition_result
    FROM pg_temp.acquire_email_proof_issuance_gate(
      decode(repeat('44', 32), 'hex'),
      1::smallint,
      1::smallint,
      '44000000-0000-4000-8000-000000000002'::uuid,
      decode(repeat('d2', 32), 'hex')
    )
  ),
  'deferred',
  'an ambiguous result cannot release the conservative proof fence early'
);

RESET ROLE;

WITH shifted AS (
  SELECT clock_timestamp() - interval '31 seconds' AS acquired_at
)
INSERT INTO private.email_proof_issuance_gates (
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
  1,
  1,
  decode(repeat('55', 32), 'hex'),
  'advocate-invitation',
  '55000000-0000-4000-8000-000000000001'::uuid,
  extensions.digest(decode(repeat('e1', 32), 'hex'), 'sha256'),
  'reserved',
  shifted.acquired_at,
  shifted.acquired_at + interval '30 seconds',
  shifted.acquired_at
FROM shifted;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT extensions.is(
  public.purge_expired_email_proof_issuance_gates(1),
  1,
  'bounded retention removes an expired pre-begin reservation'
);

RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_digest = decode(repeat('55', 32), 'hex')
  )
  AND EXISTS (
    SELECT 1
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_digest = decode(repeat('44', 32), 'hex')
      AND gate.finish_disposition = 'ambiguous'
  ),
  'retention removes only safe rows and preserves an active proof fence'
);

SELECT * FROM extensions.finish();

ROLLBACK;
