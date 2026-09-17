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
      'public.consume_password_recovery_authorization()'::regprocedure
  ),
  'password recovery consumption is a locked security definer boundary'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.consume_password_recovery_authorization()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.consume_password_recovery_authorization()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.consume_password_recovery_authorization()',
    'EXECUTE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.sponsor_email_authentication_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'only an authenticated caller can consume proof through the narrow RPC'
);

SELECT extensions.is(
  pg_get_function_result(
    'public.consume_password_recovery_authorization()'::regprocedure
  ),
  'TABLE(authorized_auth_user_id uuid, authorized_auth_session_id uuid)',
  'the consume result contains only the exact user and session binding'
);

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
VALUES
  (
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'recovery-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    '9a000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'recovery-other@example.test',
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
    '9d000000-0000-4000-8000-000000000001'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '9d000000-0000-4000-8000-000000000002'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '9d000000-0000-4000-8000-000000000003'::uuid,
    '9a000000-0000-4000-8000-000000000002'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '9d000000-0000-4000-8000-000000000004'::uuid,
    '9a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp() - interval '20 minutes',
    clock_timestamp() - interval '20 minutes',
    'aal1',
    clock_timestamp() + interval '1 hour'
  );

CREATE FUNCTION pg_temp.set_password_recovery_jwt(
  target_user_id uuid,
  target_session_id text,
  target_issued_offset_seconds bigint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_now_epoch bigint := extract(epoch FROM clock_timestamp())::bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', target_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', target_user_id::text,
      'role', 'authenticated',
      'iat', v_now_epoch + target_issued_offset_seconds,
      'aal', 'aal1',
      'session_id', target_session_id,
      'amr', jsonb_build_array(
        jsonb_build_object('method', 'recovery', 'timestamp', v_now_epoch)
      )
    )::text,
    true
  );
END;
$$;

CREATE FUNCTION pg_temp.set_password_recovery_service_jwt()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );
END;
$$;

SELECT pg_temp.set_password_recovery_service_jwt();
SET LOCAL ROLE service_role;

CREATE TEMP TABLE password_recovery_receipt_result
ON COMMIT DROP
AS
SELECT *
FROM public.record_sponsor_email_authentication_receipt(
  '9a000000-0000-4000-8000-000000000001'::uuid,
  '9d000000-0000-4000-8000-000000000001'::uuid,
  'password-recovery-request',
  'password-recovery-trace'
);

SELECT extensions.ok(
  (
    SELECT receipt_expires_at > clock_timestamp() + interval '14 minutes'
      AND receipt_expires_at <= clock_timestamp() + interval '16 minutes'
    FROM password_recovery_receipt_result
  ),
  'recovery verification records the existing exact fifteen minute receipt'
);

SELECT count(*)
FROM public.record_sponsor_email_authentication_receipt(
  '9a000000-0000-4000-8000-000000000002'::uuid,
  '9d000000-0000-4000-8000-000000000003'::uuid
);

RESET ROLE;

WITH expired_time AS (
  SELECT clock_timestamp() - interval '16 minutes' AS authenticated_at
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
  '9d000000-0000-4000-8000-000000000004'::uuid,
  '9a000000-0000-4000-8000-000000000001'::uuid,
  expired_time.authenticated_at,
  expired_time.authenticated_at + interval '15 minutes',
  expired_time.authenticated_at,
  expired_time.authenticated_at
FROM expired_time;

SELECT pg_temp.set_password_recovery_jwt(
  '9a000000-0000-4000-8000-000000000001'::uuid,
  '9d000000-0000-4000-8000-000000000002'
);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$ SELECT * FROM public.consume_password_recovery_authorization() $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'an ordinary authenticated password session has no recovery authority'
);

RESET ROLE;
SELECT pg_temp.set_password_recovery_jwt(
  '9a000000-0000-4000-8000-000000000001'::uuid,
  '9d000000-0000-4000-8000-000000000003'
);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$ SELECT * FROM public.consume_password_recovery_authorization() $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'a session owned by another user cannot satisfy the recovery binding'
);

RESET ROLE;
SELECT pg_temp.set_password_recovery_jwt(
  '9a000000-0000-4000-8000-000000000001'::uuid,
  '9d000000-0000-4000-8000-000000000004'
);
SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$ SELECT * FROM public.consume_password_recovery_authorization() $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'an expired recovery receipt cannot authorize a password mutation'
);

RESET ROLE;
SELECT pg_temp.set_password_recovery_jwt(
  '9a000000-0000-4000-8000-000000000001'::uuid,
  '9d000000-0000-4000-8000-000000000001'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE consumed_password_recovery_authorization
ON COMMIT DROP
AS
SELECT * FROM public.consume_password_recovery_authorization();

SELECT extensions.is(
  (
    SELECT authorized_auth_user_id
    FROM consumed_password_recovery_authorization
  ),
  '9a000000-0000-4000-8000-000000000001'::uuid,
  'consumption returns the exact authenticated user binding'
);

SELECT extensions.is(
  (
    SELECT authorized_auth_session_id
    FROM consumed_password_recovery_authorization
  ),
  '9d000000-0000-4000-8000-000000000001'::uuid,
  'consumption returns the exact authenticated session binding'
);

SELECT extensions.throws_ok(
  $$ SELECT * FROM public.consume_password_recovery_authorization() $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'the same recovery authorization cannot be replayed'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.sponsor_email_authentication_receipts receipt
    WHERE receipt.auth_session_id =
      '9d000000-0000-4000-8000-000000000001'::uuid
  ),
  0,
  'successful consumption atomically removes the exact receipt'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.sponsor_email_authentication_receipts receipt
    WHERE receipt.auth_session_id IN (
      '9d000000-0000-4000-8000-000000000003'::uuid,
      '9d000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  2,
  'wrong-session and expired failures do not consume unrelated evidence'
);

SELECT * FROM extensions.finish();

ROLLBACK;
