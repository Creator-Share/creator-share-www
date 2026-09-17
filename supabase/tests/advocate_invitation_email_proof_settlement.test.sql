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
    'public.settle_advocate_invitation_email_proof_issuance(uuid,text,text,integer,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.settle_advocate_invitation_email_proof_issuance(uuid,text,text,integer,uuid,text)',
    'EXECUTE'
  ),
  'only the service role can operate the settlement boundary'
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
  'the shared issuer claim returns every new settlement fixture without a historical cutover'
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
    SELECT 1 FROM audit.audit_events event
    WHERE event.table_name = 'advocate_invitation_email_proof_settlements'
  )
  AND NOT EXISTS (
    SELECT 1 FROM audit.audit_events event
    WHERE event.table_name = 'advocate_invitation_email_proof_settlements'
      AND (
        COALESCE(event.before_data, '{}'::jsonb)::text ||
          COALESCE(event.after_data, '{}'::jsonb)::text ~ '@'
        OR COALESCE(event.before_data, '{}'::jsonb)::text ||
          COALESCE(event.after_data, '{}'::jsonb)::text ~
            '\\\\x[0-9a-fA-F]{64}'
      )
  ),
  'settlement audits are present and contain no contact or credential material'
);

SELECT * FROM extensions.finish();

ROLLBACK;
