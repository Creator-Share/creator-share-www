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
  'the bounded sponsor authentication purge is a locked service-only boundary'
);

SELECT extensions.ok(
  private.data_retention_step_is_valid('sponsor_authentication')
  AND private.data_retention_zero_counts('sponsor_authentication') =
    '{
      "recent_auth_receipts_deleted": 0,
      "passwordless_reservations_deleted": 0,
      "passwordless_verification_attempts_deleted": 0,
      "advocate_invitation_authentication_attempts_deleted": 0
    }'::jsonb
  AND private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 5000,
      "passwordless_reservations_deleted": 5000,
      "passwordless_verification_attempts_deleted": 5000,
      "advocate_invitation_authentication_attempts_deleted": 5000
    }'::jsonb
  )
  AND NOT private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 5001,
      "passwordless_reservations_deleted": 0,
      "passwordless_verification_attempts_deleted": 0,
      "advocate_invitation_authentication_attempts_deleted": 0
    }'::jsonb
  )
  AND NOT private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 0,
      "passwordless_reservations_deleted": 0,
      "passwordless_verification_attempts_deleted": 0,
      "advocate_invitation_authentication_attempts_deleted": 5001
    }'::jsonb
  ),
  'the retention vocabulary accepts only bounded sponsor authentication counts'
);

SELECT extensions.ok(
  private.data_retention_counts_are_valid(
    'sponsor_authentication',
    '{
      "recent_auth_receipts_deleted": 1,
      "passwordless_reservations_deleted": 2,
      "passwordless_verification_attempts_deleted": 3
    }'::jsonb
  ),
  'historical three-count retention outcomes remain replay compatible'
);

SET LOCAL ROLE anon;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.purge_expired_sponsor_authentication_evidence(1)
  $$,
  '42501',
  'permission denied for function purge_expired_sponsor_authentication_evidence',
  'anonymous callers cannot purge sponsor authentication evidence'
);

RESET ROLE;

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
)
VALUES (
  '6a000000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'retention-sponsor@example.test',
  clock_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  clock_timestamp(),
  clock_timestamp(),
  false
);

INSERT INTO auth.sessions (
  id,
  user_id,
  created_at,
  updated_at,
  aal,
  not_after
)
VALUES
  (
    '6b000000-0000-4000-8000-000000000001'::uuid,
    '6a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp() - interval '30 minutes',
    clock_timestamp() - interval '30 minutes',
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '6b000000-0000-4000-8000-000000000002'::uuid,
    '6a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp() - interval '30 minutes',
    clock_timestamp() - interval '30 minutes',
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '6b000000-0000-4000-8000-000000000003'::uuid,
    '6a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '6b000000-0000-4000-8000-000000000004'::uuid,
    '6a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp() - interval '30 minutes',
    clock_timestamp() - interval '30 minutes',
    'aal1',
    clock_timestamp() + interval '1 hour'
  );

WITH receipt_times(auth_session_id, authenticated_at) AS (
  VALUES
    (
      '6b000000-0000-4000-8000-000000000001'::uuid,
      clock_timestamp() - interval '20 minutes'
    ),
    (
      '6b000000-0000-4000-8000-000000000002'::uuid,
      clock_timestamp() - interval '19 minutes'
    ),
    (
      '6b000000-0000-4000-8000-000000000003'::uuid,
      clock_timestamp()
    )
)
INSERT INTO private.sponsor_email_authentication_receipts (
  auth_session_id,
  auth_user_id,
  authenticated_at,
  expires_at,
  created_at,
  updated_at
)
SELECT
  receipt_times.auth_session_id,
  '6a000000-0000-4000-8000-000000000001'::uuid,
  receipt_times.authenticated_at,
  receipt_times.authenticated_at + interval '15 minutes',
  receipt_times.authenticated_at,
  receipt_times.authenticated_at
FROM receipt_times;

WITH reservation_times(request_id, requested_at) AS (
  VALUES
    (
      '6c000000-0000-4000-8000-000000000001',
      clock_timestamp() - interval '27 hours'
    ),
    (
      '6c000000-0000-4000-8000-000000000002',
      clock_timestamp() - interval '26 hours'
    ),
    (
      '6c000000-0000-4000-8000-000000000003',
      clock_timestamp() - interval '23 hours'
    )
)
INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
SELECT
  digest.request_digest,
  1,
  1,
  digest.source_digest,
  1,
  'generic-sign-in',
  reservation_times.requested_at,
  reservation_times.requested_at + interval '60 seconds',
  reservation_times.request_id
FROM reservation_times
CROSS JOIN LATERAL (
  SELECT
    extensions.digest(
      reservation_times.request_id || ':recipient',
      'sha256'
    )
      AS request_digest,
    extensions.digest(
      reservation_times.request_id || ':source',
      'sha256'
    )
      AS source_digest
) digest;

WITH attempt_times(request_id, attempted_at) AS (
  VALUES
    (
      '6e000000-0000-4000-8000-000000000001',
      clock_timestamp() - interval '27 hours'
    ),
    (
      '6e000000-0000-4000-8000-000000000002',
      clock_timestamp() - interval '26 hours'
    ),
    (
      '6e000000-0000-4000-8000-000000000003',
      clock_timestamp() - interval '23 hours'
    )
)
INSERT INTO private.sponsor_passwordless_email_verification_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at,
  request_id
)
SELECT
  extensions.digest(attempt_times.request_id || ':source', 'sha256'),
  1,
  attempt_times.attempted_at,
  attempt_times.request_id
FROM attempt_times;

INSERT INTO private.advocate_invitation_authentication_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at
)
VALUES
  (
    decode(repeat('51', 32), 'hex'),
    1,
    clock_timestamp() - interval '27 hours'
  ),
  (
    decode(repeat('52', 32), 'hex'),
    1,
    clock_timestamp() - interval '26 hours'
  ),
  (
    decode(repeat('53', 32), 'hex'),
    1,
    clock_timestamp() - interval '23 hours'
  );

SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.purge_expired_sponsor_authentication_evidence(NULL)
  $$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'the sponsor authentication purge rejects a null batch'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.purge_expired_sponsor_authentication_evidence(0)
  $$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'the sponsor authentication purge rejects a zero batch'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.purge_expired_sponsor_authentication_evidence(5001)
  $$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'the sponsor authentication purge rejects an oversized batch'
);

CREATE TEMP TABLE sponsor_authentication_first_purge
ON COMMIT DROP
AS
SELECT *
FROM public.purge_expired_sponsor_authentication_evidence(1);

SELECT extensions.ok(
  (
    SELECT recent_auth_receipts_deleted = 1
      AND passwordless_reservations_deleted = 1
      AND passwordless_verification_attempts_deleted = 1
      AND advocate_invitation_authentication_attempts_deleted = 1
    FROM sponsor_authentication_first_purge
  ),
  'one purge call deletes at most one eligible row from each evidence table'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT count(*) = 2
    FROM private.sponsor_email_authentication_receipts
  )
  AND (
    SELECT count(*) = 2
    FROM private.sponsor_passwordless_email_delivery_reservations
  )
  AND (
    SELECT count(*) = 2
    FROM private.sponsor_passwordless_email_verification_attempts
  )
  AND (
    SELECT count(*) = 2
    FROM private.advocate_invitation_authentication_attempts
  )
  AND (
    SELECT backlog.has_more
      AND backlog.oldest_expired_at <= clock_timestamp()
    FROM private.data_retention_backlog('sponsor_authentication') backlog
  ),
  'bounded cleanup preserves remaining expired backlog for the next hourly run'
);

SET LOCAL ROLE service_role;

CREATE TEMP TABLE sponsor_authentication_second_purge
ON COMMIT DROP
AS
SELECT *
FROM public.purge_expired_sponsor_authentication_evidence(10);

SELECT extensions.ok(
  (
    SELECT recent_auth_receipts_deleted = 1
      AND passwordless_reservations_deleted = 1
      AND passwordless_verification_attempts_deleted = 1
      AND advocate_invitation_authentication_attempts_deleted = 1
    FROM sponsor_authentication_second_purge
  ),
  'a later bounded purge removes the remaining eligible evidence'
);

SELECT extensions.ok(
  (
    SELECT recent_auth_receipts_deleted = 0
      AND passwordless_reservations_deleted = 0
      AND passwordless_verification_attempts_deleted = 0
      AND advocate_invitation_authentication_attempts_deleted = 0
    FROM public.purge_expired_sponsor_authentication_evidence(10)
  ),
  'replaying the sponsor authentication purge is idempotent'
);

RESET ROLE;

INSERT INTO private.advocate_invitation_authentication_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at
)
VALUES (
  decode(repeat('54', 32), 'hex'),
  1,
  clock_timestamp() - interval '25 hours'
);

SELECT extensions.ok(
  (
    SELECT backlog.has_more
      AND backlog.oldest_expired_at <= clock_timestamp()
    FROM private.data_retention_backlog('sponsor_authentication') backlog
  ),
  'an advocate-only quiet-traffic expiration is visible in durable backlog health'
);

SET LOCAL ROLE service_role;

SELECT extensions.ok(
  (
    SELECT recent_auth_receipts_deleted = 0
      AND passwordless_reservations_deleted = 0
      AND passwordless_verification_attempts_deleted = 0
      AND advocate_invitation_authentication_attempts_deleted = 1
    FROM public.purge_expired_sponsor_authentication_evidence(10)
  ),
  'the scheduled purge removes advocate-only expired evidence without new authentication traffic'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT NOT backlog.has_more
      AND backlog.oldest_expired_at IS NULL
    FROM private.data_retention_backlog('sponsor_authentication') backlog
  ),
  'advocate-only quiet-traffic backlog clears after the bounded scheduled purge'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM private.sponsor_email_authentication_receipts receipt
    WHERE receipt.auth_session_id =
      '6b000000-0000-4000-8000-000000000003'::uuid
      AND receipt.expires_at > clock_timestamp()
  )
  AND EXISTS (
    SELECT 1
    FROM private.sponsor_passwordless_email_delivery_reservations reservation
    WHERE reservation.request_id =
      '6c000000-0000-4000-8000-000000000003'
      AND reservation.requested_at >
        clock_timestamp() - interval '24 hours'
  )
  AND EXISTS (
    SELECT 1
    FROM private.sponsor_passwordless_email_verification_attempts attempt
    WHERE attempt.request_id =
      '6e000000-0000-4000-8000-000000000003'
      AND attempt.attempted_at > clock_timestamp() - interval '24 hours'
  )
  AND EXISTS (
    SELECT 1
    FROM private.advocate_invitation_authentication_attempts attempt
    WHERE attempt.source_digest = decode(repeat('53', 32), 'hex')
      AND attempt.attempted_at > clock_timestamp() - interval '24 hours'
  ),
  'cleanup preserves the complete fifteen minute authorization and twenty-four hour limiter quota windows'
);

WITH receipt_time AS (
  SELECT clock_timestamp() - interval '20 minutes' AS authenticated_at
)
INSERT INTO private.sponsor_email_authentication_receipts (
  auth_session_id,
  auth_user_id,
  authenticated_at,
  expires_at,
  created_at,
  updated_at
)
SELECT
  '6b000000-0000-4000-8000-000000000004'::uuid,
  '6a000000-0000-4000-8000-000000000001'::uuid,
  receipt_time.authenticated_at,
  receipt_time.authenticated_at + interval '15 minutes',
  receipt_time.authenticated_at,
  receipt_time.authenticated_at
FROM receipt_time;

WITH reservation_time AS (
  SELECT clock_timestamp() - interval '26 hours' AS requested_at
)
INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
  recipient_digest,
  recipient_normalization_version,
  recipient_hmac_key_version,
  source_digest,
  source_hmac_key_version,
  delivery_flow,
  requested_at,
  single_flight_expires_at,
  request_id
)
SELECT
  decode(repeat('61', 32), 'hex'),
  1,
  1,
  decode(repeat('62', 32), 'hex'),
  1,
  'reauthentication',
  reservation_time.requested_at,
  reservation_time.requested_at + interval '60 seconds',
  '6c000000-0000-4000-8000-000000000004'
FROM reservation_time;

WITH attempt_time AS (
  SELECT clock_timestamp() - interval '26 hours' AS attempted_at
)
INSERT INTO private.sponsor_passwordless_email_verification_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at,
  request_id
)
SELECT
  decode(repeat('63', 32), 'hex'),
  1,
  attempt_time.attempted_at,
  '6e000000-0000-4000-8000-000000000004'
FROM attempt_time;

INSERT INTO private.advocate_invitation_authentication_attempts (
  source_digest,
  source_hmac_key_version,
  attempted_at
)
VALUES (
  decode(repeat('64', 32), 'hex'),
  1,
  clock_timestamp() - interval '26 hours'
);

SET LOCAL ROLE service_role;

SELECT extensions.is(
  public.start_data_retention_run(
    '6d000000-0000-4000-8000-000000000001'::uuid,
    10,
    'sponsor-authentication-retention-run',
    'sponsor-authentication-retention-trace'
  ),
  '6d000000-0000-4000-8000-000000000001'::uuid,
  'the hourly retention lifecycle accepts the sponsor authentication step'
);

CREATE TEMP TABLE sponsor_authentication_step_result
ON COMMIT DROP
AS
SELECT public.run_data_retention_step(
  '6d000000-0000-4000-8000-000000000001'::uuid,
  'sponsor_authentication',
  10,
  'sponsor-authentication-retention-run',
  'sponsor-authentication-retention-trace'
) AS result;

SELECT extensions.ok(
  (
    SELECT result ->> 'step_key' = 'sponsor_authentication'
      AND result -> 'counts' = '{
        "recent_auth_receipts_deleted": 1,
        "passwordless_reservations_deleted": 1,
        "passwordless_verification_attempts_deleted": 1,
        "advocate_invitation_authentication_attempts_deleted": 1
      }'::jsonb
      AND (result ->> 'has_more')::boolean = false
      AND result -> 'oldest_expired_at' = 'null'::jsonb
    FROM sponsor_authentication_step_result
  ),
  'the hourly worker records sanitized sponsor authentication cleanup counts'
);

RESET ROLE;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.data_retention_run_events event
    WHERE event.run_id =
      '6d000000-0000-4000-8000-000000000001'::uuid
      AND event.event_kind = 'step_outcome'
      AND event.step_key = 'sponsor_authentication'
      AND event.status = 'completed'
      AND event.counts = '{
        "recent_auth_receipts_deleted": 1,
        "passwordless_reservations_deleted": 1,
        "passwordless_verification_attempts_deleted": 1,
        "advocate_invitation_authentication_attempts_deleted": 1
      }'::jsonb
      AND event.request_id = 'sponsor-authentication-retention-run'
      AND event.trace_id = 'sponsor-authentication-retention-trace'
  ),
  'the new step leaves bounded correlated retention evidence without row identifiers'
);

SELECT * FROM extensions.finish();

ROLLBACK;
