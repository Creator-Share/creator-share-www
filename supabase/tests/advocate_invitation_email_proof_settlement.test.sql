BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '60s';

SELECT extensions.no_plan();

SELECT extensions.ok(
  to_regprocedure(
    'public.claim_advocate_invitation_email_jobs(text,integer,text,text)'
  ) IS NULL
  AND to_regprocedure(
    'public.claim_advocate_invitation_email_jobs(text,smallint,integer,text,text)'
  ) IS NOT NULL,
  'the legacy claim overload is removed and only the shared issuer claim remains'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity AND relation.relforcerowsecurity
    FROM pg_catalog.pg_class relation
    WHERE relation.oid =
      'private.advocate_invitation_email_proof_settlements'::regclass
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_invitation_email_proof_settlements',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.advocate_invitation_email_proof_settlements',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'settlement replay receipts are forced-RLS and have no direct runtime access'
);

SELECT extensions.columns_are(
  'private',
  'advocate_invitation_email_proof_settlements',
  ARRAY[
    'outbox_id',
    'lease_token_digest',
    'disposition',
    'requested_retry_after_seconds',
    'retryable',
    'attempt_refunded',
    'available_at',
    'settled_at'
  ],
  'the immutable receipt stores no contact, raw lease, capability, or provider payload'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.arm_advocate_invitation_legacy_email_proof_quarantine(uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.quarantine_legacy_advocate_invitation_proofs(smallint,uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.settle_advocate_invitation_email_proof_issuance(uuid,text,text,integer,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.quarantine_legacy_advocate_invitation_proofs(smallint,uuid,text)',
    'EXECUTE'
  ),
  'only the service role can operate the cutover and settlement boundaries'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'private.bind_advocate_invitation_email_target_unguarded(uuid,text,uuid,bytea,bytea,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.bind_advocate_invitation_email_target_unguarded(uuid,text,uuid,bytea,bytea,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.bind_advocate_invitation_email_target_unguarded(uuid,text,uuid,bytea,bytea,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.begin_advocate_invitation_email_delivery_unguarded(uuid,text,bytea,bytea,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.begin_advocate_invitation_email_delivery_unguarded(uuid,text,bytea,bytea,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.begin_advocate_invitation_email_delivery_unguarded(uuid,text,bytea,bytea,text,text)',
    'EXECUTE'
  ),
  'private quarantine bypass helpers have no runtime execute privilege'
);

SELECT extensions.ok(
  (
    SELECT
      'lock_timeout=5s' = ANY(COALESCE(routine.proconfig, ARRAY[]::text[]))
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(routine.proconfig, ARRAY[]::text[])) setting
        WHERE setting LIKE 'statement_timeout=%'
      )
    FROM pg_catalog.pg_proc routine
    WHERE routine.oid =
      'public.quarantine_legacy_advocate_invitation_proofs(smallint,uuid,text)'::regprocedure
  ),
  'quarantine self-bounds lock waits without claiming a function-local statement timeout'
);

SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.quarantine_legacy_advocate_invitation_proofs(smallint,uuid,text)'::regprocedure
    ),
    'public.advocate_invitations,'
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.quarantine_legacy_advocate_invitation_proofs(smallint,uuid,text)'::regprocedure
    ),
    'public.advocate_invitation_email_outbox'
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.quarantine_legacy_advocate_invitation_proofs(smallint,uuid,text)'::regprocedure
    ),
    'IN ACCESS EXCLUSIVE MODE NOWAIT'
  ) > 0,
  'quarantine acquires fail-fast exclusive locks over both invitation tables before scanning evidence'
);

CREATE TEMP TABLE proof_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE proof_fixture (
  key text PRIMARY KEY,
  invitation_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  recipient_digest bytea NOT NULL,
  capability_digest bytea NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE proof_claim (
  outbox_id uuid,
  invitation_id uuid,
  advocate_id uuid,
  lease_token text,
  lease_expires_at timestamp with time zone,
  target_auth_user_id uuid,
  template_key text,
  template_data jsonb,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  secret_payload_ciphertext bytea,
  capability_digest bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  provider_idempotency_key text,
  attempt_count smallint
) ON COMMIT DROP;

CREATE TEMP TABLE proof_settlement_result (
  key text PRIMARY KEY,
  retryable boolean NOT NULL,
  attempt_refunded boolean NOT NULL,
  available_at timestamp with time zone NOT NULL,
  settled_at timestamp with time zone NOT NULL
) ON COMMIT DROP;

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_anonymous
) VALUES (
  'a7400000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'proof-owner@example.test',
  clock_timestamp(),
  '{}'::jsonb,
  '{"first_name":"Proof","last_name":"Owner"}'::jsonb,
  clock_timestamp(),
  clock_timestamp(),
  false
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

WITH created AS (
  SELECT public.create_advocate_portal(
    'a7400000-0000-4000-8000-000000000001'::uuid,
    'proof-settlement-tests',
    'Proof Settlement Tests',
    'Create the proof settlement fixture',
    'creator',
    'proof-settlement-create-portal'
  ) AS id
)
INSERT INTO proof_test_ids (key, value)
SELECT 'advocate', id FROM created;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE FUNCTION pg_temp.issue_proof_fixture(
  fixture_key text,
  digest_byte text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_issued record;
  v_recipient_digest bytea := decode(repeat(digest_byte, 32), 'hex');
  v_capability_digest bytea := extensions.digest(
    'proof-capability:' || fixture_key,
    'sha256'
  );
BEGIN
  SELECT *
  INTO STRICT v_issued
  FROM public.issue_advocate_invitation_email(
    (SELECT value FROM pg_temp.proof_test_ids WHERE key = 'advocate'),
    'a7400000-0000-4000-8000-000000000001'::uuid,
    fixture_key || '@proof-settlement.example.test',
    ARRAY['analytics_viewer'],
    'proof-settlement-' || fixture_key,
    v_capability_digest,
    decode(repeat('31', 64), 'hex'),
    v_recipient_digest,
    decode(repeat('41', 96), 'hex'),
    1::smallint,
    1::smallint,
    1::smallint,
    'Exercise ' || fixture_key || ' proof settlement'
  );

  INSERT INTO pg_temp.proof_fixture (
    key,
    invitation_id,
    outbox_id,
    recipient_digest,
    capability_digest
  ) VALUES (
    fixture_key,
    v_issued.invitation_id,
    v_issued.outbox_id,
    v_recipient_digest,
    v_capability_digest
  );
END;
$$;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.claim_advocate_invitation_email_jobs(
      'proof-worker-before-cutover',
      1::smallint,
      10,
      'proof-claim-before-cutover',
      'proof-claim-before-cutover-trace'
    )
  $$,
  '55000',
  'Legacy advocate invitation email proof quarantine is not complete',
  'version one claims remain closed before the cutover commits'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.quarantine_legacy_advocate_invitation_proofs(
      3600::smallint,
      'a7400000-0000-4000-8000-000000000701'::uuid,
      'proof-unarmed-quarantine'
    )
  $$,
  '55000',
  'Legacy advocate invitation email proof quarantine is not armed',
  'quarantine rejects an unarmed receipt'
);

SELECT pg_temp.issue_proof_fixture('legacy_failed', '11');
SELECT pg_temp.issue_proof_fixture('legacy_sent', '11');
SELECT pg_temp.issue_proof_fixture('legacy_recent', '22');
SELECT pg_temp.issue_proof_fixture('legacy_redacted', '33');
SELECT pg_temp.issue_proof_fixture('legacy_missing', '44');

RESET ROLE;
SET LOCAL session_replication_role = replica;

UPDATE public.advocate_invitation_email_outbox outbox
SET
  status = 'failed',
  attempt_count = 1,
  last_error_code = 'internal_error'
FROM proof_fixture fixture
WHERE fixture.key = 'legacy_failed'
  AND outbox.id = fixture.outbox_id;

UPDATE public.advocate_invitation_email_outbox outbox
SET
  status = 'sent',
  attempt_count = CASE fixture.key
    WHEN 'legacy_sent' THEN 1
    ELSE 0
  END,
  delivery_started_at = clock_timestamp() - interval '2 seconds',
  provider_message_id = 'legacy-provider-' || fixture.key,
  sent_at = clock_timestamp() - interval '1 second'
FROM proof_fixture fixture
WHERE fixture.key IN ('legacy_sent', 'legacy_recent')
  AND outbox.id = fixture.outbox_id;

UPDATE public.advocate_invitations invitation
SET last_sent_at = clock_timestamp()
FROM proof_fixture fixture
WHERE fixture.key = 'legacy_recent'
  AND invitation.id = fixture.invitation_id;

UPDATE public.advocate_invitation_email_outbox outbox
SET
  status = 'cancelled',
  attempt_count = CASE fixture.key
    WHEN 'legacy_redacted' THEN 1
    ELSE 0
  END,
  recipient_email_ciphertext = NULL,
  recipient_email_hmac = NULL,
  email_normalization_version = NULL,
  email_hmac_key_version = NULL,
  email_encryption_key_version = NULL,
  secret_payload_ciphertext = NULL,
  secret_payload_ciphertext_sha256 = NULL,
  cancelled_at = clock_timestamp(),
  contact_redacted_at = clock_timestamp()
FROM proof_fixture fixture
WHERE fixture.key IN ('legacy_redacted', 'legacy_missing')
  AND outbox.id = fixture.outbox_id;

UPDATE public.advocate_invitations invitation
SET last_sent_at = clock_timestamp()
FROM proof_fixture fixture
WHERE fixture.key = 'legacy_missing'
  AND invitation.id = fixture.invitation_id;

SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE proof_cutover_arm AS
SELECT public.arm_advocate_invitation_legacy_email_proof_quarantine(
  'a7400000-0000-4000-8000-000000000702'::uuid,
  'proof-cutover-arm'
) AS legacy_claim_fenced_at;

SELECT extensions.is(
  public.arm_advocate_invitation_legacy_email_proof_quarantine(
    'a7400000-0000-4000-8000-000000000703'::uuid,
    'proof-cutover-arm-replay'
  ),
  (SELECT legacy_claim_fenced_at FROM proof_cutover_arm),
  'arm replay returns the immutable original server timestamp'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.quarantine_legacy_advocate_invitation_proofs(
      1::smallint,
      'a7400000-0000-4000-8000-000000000704'::uuid,
      'proof-same-transaction-quarantine'
    )
  $$,
  '55000',
  'Legacy advocate invitation email proof quarantine arm must commit first',
  'quarantine rejects the arm transaction itself'
);

RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE private.advocate_invitation_legacy_email_proof_quarantine
SET
  legacy_claim_fenced_at = clock_timestamp() - interval '71 seconds',
  legacy_claim_fence_transaction_id = '1'::xid8
WHERE quarantine_identity = 'advocate_invitation_legacy_email_proof_v1';
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.quarantine_legacy_advocate_invitation_proofs(
      1::smallint,
      'a7400000-0000-4000-8000-000000000705'::uuid,
      'proof-recent-redacted-quarantine'
    )
  $$,
  '55000',
  'A recent redacted legacy invitation proof cannot be fenced',
  'recent attempted redaction fails closed'
);

RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.advocate_invitation_email_outbox outbox
SET contact_redacted_at = clock_timestamp() - interval '3900 seconds'
FROM proof_fixture fixture
WHERE fixture.key = 'legacy_redacted'
  AND outbox.id = fixture.outbox_id;
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.quarantine_legacy_advocate_invitation_proofs(
      1::smallint,
      'a7400000-0000-4000-8000-000000000706'::uuid,
      'proof-missing-evidence-quarantine'
    )
  $$,
  '55000',
  'A recent legacy invitation send has no recipient fence evidence',
  'a recent send without retained recipient evidence fails closed'
);

RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.advocate_invitations invitation
SET last_sent_at = clock_timestamp() - interval '3900 seconds'
FROM proof_fixture fixture
WHERE fixture.key = 'legacy_missing'
  AND invitation.id = fixture.invitation_id;
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE proof_quarantine_result AS
SELECT *
FROM public.quarantine_legacy_advocate_invitation_proofs(
  1::smallint,
  'a7400000-0000-4000-8000-000000000707'::uuid,
  'proof-quarantine-success'
);

SELECT extensions.ok(
  (
    SELECT candidate_outbox_count = 3
      AND unique_recipient_count = 2
      AND quarantined_outbox_count = 1
      AND created_gate_count = 2
      AND preserved_gate_count = 0
      AND fence_expires_at = executed_at + interval '3900 seconds'
    FROM proof_quarantine_result
  ),
  'verified expiry one still produces the fixed 3900-second fence and exact counts'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    JOIN proof_fixture fixture ON fixture.outbox_id = outbox.id
    WHERE fixture.key = 'legacy_failed'
      AND outbox.legacy_email_proof_quarantined_at IS NOT NULL
      AND outbox.legacy_email_proof_quarantine_reason =
        'shared_issuer_cutover_unresolved_legacy_proof'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    JOIN proof_fixture fixture ON fixture.outbox_id = outbox.id
    WHERE fixture.key IN ('legacy_sent', 'legacy_recent')
      AND outbox.legacy_email_proof_quarantined_at IS NOT NULL
  ),
  'only unresolved attempted outbox rows receive the permanent quarantine marker'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 2
      AND bool_and(
        gate.legacy_proof_quarantine_expires_at =
          (SELECT fence_expires_at FROM proof_quarantine_result)
      )
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_digest IN (
      decode(repeat('11', 32), 'hex'),
      decode(repeat('22', 32), 'hex')
    )
  )
  AND (
    SELECT gate.operation_id = LEAST(
      (SELECT outbox_id FROM proof_fixture WHERE key = 'legacy_failed'),
      (SELECT outbox_id FROM proof_fixture WHERE key = 'legacy_sent')
    )
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_digest = decode(repeat('11', 32), 'hex')
  ),
  'quarantine creates one fixed fence per recipient with a deterministic representative'
);

SELECT extensions.ok(
  (
    SELECT ROW(replay.*) IS NOT DISTINCT FROM ROW(original.*)
    FROM public.quarantine_legacy_advocate_invitation_proofs(
      1::smallint,
      'a7400000-0000-4000-8000-000000000708'::uuid,
      'proof-quarantine-replay'
    ) replay
    CROSS JOIN proof_quarantine_result original
  ),
  'same-evidence quarantine replay returns the original result without extending the fence'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.quarantine_legacy_advocate_invitation_proofs(
      2::smallint,
      'a7400000-0000-4000-8000-000000000709'::uuid,
      'proof-quarantine-conflict'
    )
  $$,
  '55000',
  'Legacy advocate invitation email proof quarantine replay conflicts',
  'quarantine binds replay to the verified hosted expiry evidence'
);

SELECT extensions.is(
  private.legacy_advocate_invitation_proof_may_be_live(
    '2026-01-01 00:00:00+00'::timestamptz,
    '2026-01-01 01:05:00+00'::timestamptz
  ),
  false,
  'legacy proof evidence expires at the exact 3900-second boundary'
);

SELECT extensions.is(
  private.legacy_advocate_invitation_proof_may_be_live(
    '2026-01-01 00:00:00+00'::timestamptz,
    '2026-01-01 01:04:59.999999+00'::timestamptz
  ),
  true,
  'legacy proof evidence remains live one microsecond before the boundary'
);

SELECT extensions.ok(
  (
    SELECT acquisition_result = 'deferred'
      AND retry_after_seconds BETWEEN 3890 AND 3900
    FROM public.acquire_email_proof_issuance_gate(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      'advocate-invitation',
      'a7400000-0000-4000-8000-000000000710'::uuid,
      decode(repeat('71', 32), 'hex'),
      'a7400000-0000-4000-8000-000000000711'::uuid,
      'proof-quarantine-gate-acquire'
    )
  ),
  'shared proof acquisition defers while the fixed legacy fence is active'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_email_proof_issuance(
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      'advocate-invitation',
      'a7400000-0000-4000-8000-000000000710'::uuid,
      decode(repeat('71', 32), 'hex'),
      'a7400000-0000-4000-8000-000000000712'::uuid,
      'proof-quarantine-gate-begin'
    )
  $$,
  '55000',
  'Email proof issuance fence is stale',
  'begin cannot cross an active legacy proof fence'
);

SELECT extensions.is(
  public.purge_expired_email_proof_issuance_gates(100),
  0,
  'retention cannot remove an active legacy proof fence'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.bind_advocate_invitation_email_target(%L::uuid,%L,%L::uuid,decode(%L,''hex''),decode(%L,''hex''))',
    (SELECT outbox_id FROM proof_fixture WHERE key = 'legacy_failed'),
    repeat('a', 64),
    'a7400000-0000-4000-8000-000000000001',
    repeat('11', 32),
    encode(
      (SELECT capability_digest FROM proof_fixture WHERE key = 'legacy_failed'),
      'hex'
    )
  ),
  '42501',
  'Invitation target-binding proof does not match the active lease',
  'a quarantined legacy worker cannot bind an invitation target'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.begin_advocate_invitation_email_delivery(%L::uuid,%L,decode(%L,''hex''),decode(%L,''hex''))',
    (SELECT outbox_id FROM proof_fixture WHERE key = 'legacy_failed'),
    repeat('a', 64),
    repeat('11', 32),
    encode(
      (SELECT capability_digest FROM proof_fixture WHERE key = 'legacy_failed'),
      'hex'
    )
  ),
  '42501',
  'Invitation delivery proof does not match the active lease',
  'a quarantined legacy worker cannot begin SMTP handoff'
);

SELECT pg_temp.issue_proof_fixture('coalesced', '51');
SELECT pg_temp.issue_proof_fixture('deferred', '52');
SELECT pg_temp.issue_proof_fixture('unavailable', '53');
SELECT pg_temp.issue_proof_fixture('begin_ambiguous', '54');
SELECT pg_temp.issue_proof_fixture('ambiguous', '55');
SELECT pg_temp.issue_proof_fixture('issued_not_handed_off', '56');
SELECT pg_temp.issue_proof_fixture('issued_target_mismatch', '57');
SELECT pg_temp.issue_proof_fixture('expired_provider_free', '58');
SELECT pg_temp.issue_proof_fixture('expired_issued', '59');
SELECT pg_temp.issue_proof_fixture('stale_lease', '5a');
SELECT pg_temp.issue_proof_fixture('fail_target', '5b');

INSERT INTO proof_claim
SELECT *
FROM public.claim_advocate_invitation_email_jobs(
  'proof-settlement-worker',
  1::smallint,
  50,
  'proof-settlement-claim',
  'proof-settlement-claim-trace'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM proof_claim),
  11,
  'the shared issuer claim returns every new settlement fixture after cutover'
);

CREATE FUNCTION pg_temp.settle_proof_fixture(
  fixture_key text,
  target_disposition text,
  target_retry_after_seconds integer
)
RETURNS TABLE (
  retryable boolean,
  attempt_refunded boolean,
  available_at timestamp with time zone,
  settled_at timestamp with time zone
)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT settlement.*
  FROM pg_temp.proof_fixture fixture
  JOIN pg_temp.proof_claim claim ON claim.outbox_id = fixture.outbox_id
  CROSS JOIN LATERAL public.settle_advocate_invitation_email_proof_issuance(
    fixture.outbox_id,
    claim.lease_token,
    target_disposition,
    target_retry_after_seconds,
    gen_random_uuid(),
    'proof-settlement-' || fixture_key
  ) settlement
  WHERE fixture.key = fixture_key;
$$;

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.settle_advocate_invitation_email_proof_issuance(%L::uuid,%L,%L,%s,%L::uuid)',
    (SELECT outbox_id FROM proof_fixture WHERE key = 'stale_lease'),
    repeat('f', 64),
    'deferred',
    0,
    'a7400000-0000-4000-8000-000000000720'
  ),
  '55P03',
  'Invitation email proof settlement does not match the active lease',
  'settlement rejects a stale or foreign lease'
);

RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.advocate_invitations invitation
SET
  created_at = clock_timestamp() - interval '2 seconds',
  expires_at = clock_timestamp() - interval '1 second'
FROM proof_fixture fixture
WHERE fixture.key IN ('expired_provider_free', 'expired_issued')
  AND invitation.id = fixture.invitation_id;
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO proof_settlement_result
SELECT 'coalesced', result.*
FROM pg_temp.settle_proof_fixture('coalesced', 'coalesced', 120) result;
INSERT INTO proof_settlement_result
SELECT 'deferred', result.*
FROM pg_temp.settle_proof_fixture('deferred', 'deferred', 0) result;
INSERT INTO proof_settlement_result
SELECT 'unavailable', result.*
FROM pg_temp.settle_proof_fixture('unavailable', 'unavailable', 17) result;
INSERT INTO proof_settlement_result
SELECT 'begin_ambiguous', result.*
FROM pg_temp.settle_proof_fixture('begin_ambiguous', 'begin_ambiguous', 3900) result;
INSERT INTO proof_settlement_result
SELECT 'ambiguous', result.*
FROM pg_temp.settle_proof_fixture('ambiguous', 'ambiguous', 3900) result;
INSERT INTO proof_settlement_result
SELECT 'issued_not_handed_off', result.*
FROM pg_temp.settle_proof_fixture(
  'issued_not_handed_off',
  'issued_not_handed_off',
  3900
) result;
INSERT INTO proof_settlement_result
SELECT 'issued_target_mismatch', result.*
FROM pg_temp.settle_proof_fixture(
  'issued_target_mismatch',
  'issued_target_mismatch',
  3900
) result;
INSERT INTO proof_settlement_result
SELECT 'expired_provider_free', result.*
FROM pg_temp.settle_proof_fixture(
  'expired_provider_free',
  'coalesced',
  0
) result;
INSERT INTO proof_settlement_result
SELECT 'expired_issued', result.*
FROM pg_temp.settle_proof_fixture(
  'expired_issued',
  'issued_not_handed_off',
  3900
) result;

SELECT extensions.ok(
  (
    SELECT count(*) = 4
      AND bool_and(retryable)
      AND bool_and(attempt_refunded)
    FROM proof_settlement_result
    WHERE key IN ('coalesced', 'deferred', 'unavailable', 'begin_ambiguous')
  )
  AND (
    SELECT count(*) = 2
      AND bool_and(retryable)
      AND bool_and(NOT attempt_refunded)
    FROM proof_settlement_result
    WHERE key IN ('ambiguous', 'issued_not_handed_off')
  )
  AND (
    SELECT NOT retryable AND NOT attempt_refunded
    FROM proof_settlement_result
    WHERE key = 'issued_target_mismatch'
  ),
  'all seven dispositions apply their exact refund and retry semantics'
);

SELECT extensions.ok(
  (
    SELECT available_at - settled_at = interval '120 seconds'
    FROM proof_settlement_result WHERE key = 'coalesced'
  )
  AND (
    SELECT available_at = settled_at
    FROM proof_settlement_result WHERE key = 'deferred'
  )
  AND (
    SELECT available_at - settled_at = interval '17 seconds'
    FROM proof_settlement_result WHERE key = 'unavailable'
  )
  AND (
    SELECT bool_and(available_at - settled_at = interval '3900 seconds')
    FROM proof_settlement_result
    WHERE key IN (
      'begin_ambiguous',
      'ambiguous',
      'issued_not_handed_off'
    )
  ),
  'retryable settlements preserve the caller bounded delay without amplification'
);

SELECT extensions.ok(
  (
    SELECT NOT retryable
      AND attempt_refunded
      AND available_at = settled_at
    FROM proof_settlement_result
    WHERE key = 'expired_provider_free'
  )
  AND (
    SELECT NOT retryable
      AND NOT attempt_refunded
      AND available_at = settled_at
    FROM proof_settlement_result
    WHERE key = 'expired_issued'
  ),
  'expiry during work settles both provider-free and issued outcomes at the exact safe timestamp boundary'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      outbox.last_error_code = CASE fixture.key
        WHEN 'coalesced' THEN 'email_proof_deferred'
        WHEN 'deferred' THEN 'email_proof_deferred'
        WHEN 'unavailable' THEN 'email_proof_unavailable'
        WHEN 'begin_ambiguous' THEN 'email_proof_issuance_ambiguous'
        WHEN 'ambiguous' THEN 'email_proof_issuance_ambiguous'
        WHEN 'issued_not_handed_off' THEN 'email_proof_issued_not_handed_off'
        WHEN 'issued_target_mismatch' THEN 'invitation_target_unavailable'
      END
      AND outbox.attempt_count = CASE
        WHEN fixture.key IN (
          'coalesced',
          'deferred',
          'unavailable',
          'begin_ambiguous'
        ) THEN 0
        ELSE 1
      END
    )
    FROM proof_fixture fixture
    JOIN public.advocate_invitation_email_outbox outbox
      ON outbox.id = fixture.outbox_id
    WHERE fixture.key IN (
      'coalesced',
      'deferred',
      'unavailable',
      'begin_ambiguous',
      'ambiguous',
      'issued_not_handed_off',
      'issued_target_mismatch'
    )
  ),
  'outbox rows contain the exact bounded error mapping and attempt accounting'
);

SELECT extensions.ok(
  (
    SELECT ROW(replay.*) IS NOT DISTINCT FROM ROW(
      original.retryable,
      original.attempt_refunded,
      original.available_at,
      original.settled_at
    )
    FROM pg_temp.settle_proof_fixture('coalesced', 'coalesced', 120) replay
    CROSS JOIN proof_settlement_result original
    WHERE original.key = 'coalesced'
  ),
  'exact settlement replay returns the immutable original receipt'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM pg_temp.settle_proof_fixture(%L,%L,%s)',
    'coalesced',
    'deferred',
    0
  ),
  '55000',
  'Invitation email proof settlement replay conflicts',
  'a conflicting settlement replay is rejected'
);

SELECT extensions.is(
  public.fail_advocate_invitation_email_delivery(
    (SELECT outbox_id FROM proof_fixture WHERE key = 'fail_target'),
    (
      SELECT claim.lease_token
      FROM proof_claim claim
      JOIN proof_fixture fixture ON fixture.outbox_id = claim.outbox_id
      WHERE fixture.key = 'fail_target'
    ),
    'invitation_target_unavailable',
    60
  ),
  false,
  'target unavailability is terminal in the pre-handoff failure boundary'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    JOIN proof_fixture fixture ON fixture.outbox_id = outbox.id
    WHERE fixture.key = 'fail_target'
      AND outbox.status = 'failed'
      AND outbox.last_error_code = 'invitation_target_unavailable'
  ),
  'terminal target unavailability persists the exact sanitized error code'
);

RESET ROLE;

SELECT extensions.throws_ok(
  $$
    UPDATE private.advocate_invitation_email_proof_settlements
    SET retryable = NOT retryable
  $$,
  '42501',
  'Advocate invitation email proof settlements are immutable',
  'settlement receipts cannot be rewritten'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name =
        'advocate_invitation_legacy_email_proof_quarantine'
      AND event.tool =
        'arm_advocate_invitation_legacy_email_proof_quarantine'
      AND event.operation = 'UPDATE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name IN (
        'advocate_invitation_legacy_email_proof_quarantine',
        'advocate_invitation_email_proof_settlements'
      )
      AND (
        COALESCE(event.before_data, '{}'::jsonb)::text ||
          COALESCE(event.after_data, '{}'::jsonb)::text ~ '@'
        OR COALESCE(event.before_data, '{}'::jsonb)::text ||
          COALESCE(event.after_data, '{}'::jsonb)::text ~
            '\\\\x[0-9a-fA-F]{64}'
      )
  ),
  'arm and settlement audits are present and contain no contact or credential material'
);

SELECT * FROM extensions.finish();

ROLLBACK;
