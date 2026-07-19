BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relname = 'advocate_logo_upload_reservations'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'private'
      AND policy.tablename = 'advocate_logo_upload_reservations'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.advocate_logo_upload_reservations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_logo_upload_reservations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_logo_upload_reservations',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_logo_upload_reservations',
    'UPDATE'
  ),
  'the durable reservation ledger is forced-RLS default deny with no direct application role access'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.reserve_advocate_logo_upload(uuid,uuid,bigint,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.settle_advocate_logo_upload_reservation(uuid,uuid,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND function_definition.provolatile = 's'
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_advocate_logo_upload_reservation_result(uuid,uuid,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.update_advocate_branding(uuid,uuid,bigint,text,text,text,uuid,text,text,text,text,text,text,text)'::regprocedure
  ),
  'every public logo boundary RPC has fixed definer authority and the result lookup is stable'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.reserve_advocate_logo_upload(uuid,uuid,bigint,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.settle_advocate_logo_upload_reservation(uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.get_advocate_logo_upload_reservation_result(uuid,uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.update_advocate_branding(uuid,uuid,bigint,text,text,text,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reserve_advocate_logo_upload(uuid,uuid,bigint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.settle_advocate_logo_upload_reservation(uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.get_advocate_logo_upload_reservation_result(uuid,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.update_advocate_branding(uuid,uuid,bigint,text,text,text,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reserve_advocate_logo_upload(uuid,uuid,bigint,text,text)',
    'EXECUTE'
  ),
  'only the service role can execute reservation, settlement, result, and sanitized branding mutation RPCs'
);

SELECT extensions.ok(
  to_regprocedure(
    'public.update_advocate_branding(uuid,bigint,text,text,text,text,text,text,text,text,text,text)'
  ) IS NULL,
  'the former authenticated branding mutation signature no longer exists'
);

SELECT extensions.ok(
  to_regprocedure(
    'public.replace_advocate_public_metrics(uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)'
  ) IS NULL
  AND NOT has_function_privilege(
    'authenticated',
    'public.replace_advocate_public_metrics(uuid,uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.replace_advocate_public_metrics(uuid,uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.replace_advocate_beneficiary_configuration(uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text)',
    'EXECUTE'
  ),
  'public metrics use a service only actor aware contract while beneficiary configuration remains authenticated'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.reserve_advocate_logo_upload(uuid,uuid,bigint,text,text)'::regprocedure
  ),
  ARRAY[
    'target_advocate_id',
    'target_actor_user_id',
    'expected_advocate_version',
    'request_id',
    'trace_id',
    'reservation_id',
    'object_path',
    'expires_at'
  ]::text[],
  'the reservation RPC exposes the exact stable input and result field names'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_advocate_logo_upload_reservation_result(uuid,uuid,text)'::regprocedure
  ),
  ARRAY[
    'target_reservation_id',
    'target_actor_user_id',
    'request_id',
    'status',
    'object_path',
    'expected_version',
    'resulting_version'
  ]::text[],
  'the ambiguity recovery RPC returns only status, path, expected version, and resulting version'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.update_advocate_branding(uuid,uuid,bigint,text,text,text,uuid,text,text,text,text,text,text,text)'::regprocedure
  ),
  ARRAY[
    'target_advocate_id',
    'target_actor_user_id',
    'expected_advocate_version',
    'target_primary_color',
    'target_accent_color',
    'target_logo_storage_path',
    'target_logo_upload_reservation_id',
    'target_logo_alt_text',
    'target_opening_header_html',
    'target_about_biography_html',
    'change_reason',
    'request_id',
    'trace_id',
    'session_id'
  ]::text[],
  'the service branding RPC preserves every prior argument name and adds only actor and reservation identity'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.reserve_advocate_logo_upload(uuid,uuid,bigint,text,text)'::regprocedure
  ) LIKE '%pg_advisory_xact_lock%'
  AND pg_get_functiondef(
    'public.reserve_advocate_logo_upload(uuid,uuid,bigint,text,text)'::regprocedure
  ) LIKE '%FOR UPDATE%'
  AND EXISTS (
    SELECT 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'private'
      AND index_definition.tablename = 'advocate_logo_upload_reservations'
      AND index_definition.indexname =
        'advocate_logo_upload_one_pending_version_uidx'
      AND index_definition.indexdef LIKE '%UNIQUE%'
      AND index_definition.indexdef LIKE '%status = ''pending''%'
  ),
  'actor rate limiting and tenant single-flight are serialized and backed by a partial unique index'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.get_advocate_audit_events(uuid,bigint,integer)'::regprocedure
  ) LIKE '%advocate_logo_upload_reservations%',
  'the sanitized advocate audit reader allowlists logo reservation lifecycle events'
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
  updated_at
)
VALUES
  (
    'b1000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'logo-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Logo","last_name":"Owner"}'::jsonb,
    now(),
    now()
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'logo-brand@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Logo","last_name":"Editor"}'::jsonb,
    now(),
    now()
  ),
  (
    'b1000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'logo-catalog@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'b1000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'logo-rate-actor@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'b1000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'logo-rate-tenant@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'b1000000-0000-4000-8000-000000000006',
    'authenticated',
    'authenticated',
    'logo-suspended@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
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
  updated_at
)
SELECT
  (
    'b2000000-0000-4000-8000-' || lpad(series.value::text, 12, '0')
  )::uuid,
  'authenticated',
  'authenticated',
  'logo-tenant-history-' || series.value::text || '@example.test',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
FROM generate_series(1, 20) AS series(value);

INSERT INTO public.advocates (
  id,
  slug,
  display_name,
  relationship_status,
  publication_status
)
VALUES
  (
    'b0000000-0000-4000-8000-000000000001',
    'logoreservea',
    'Logo Reserve A',
    'active',
    'draft'
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    'logoreserveb',
    'Logo Reserve B',
    'active',
    'draft'
  ),
  (
    'b0000000-0000-4000-8000-000000000003',
    'logorateactor',
    'Logo Rate Actor',
    'active',
    'draft'
  ),
  (
    'b0000000-0000-4000-8000-000000000004',
    'logoratetenant',
    'Logo Rate Tenant',
    'active',
    'draft'
  ),
  (
    'b0000000-0000-4000-8000-000000000005',
    'logosuspended',
    'Logo Suspended',
    'active',
    'suspended'
  );

INSERT INTO public.advocate_branding (advocate_id)
SELECT advocate.id
FROM public.advocates advocate
WHERE advocate.id IN (
  'b0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000004',
  'b0000000-0000-4000-8000-000000000005'
);

INSERT INTO public.advocate_memberships (
  id,
  advocate_id,
  user_id,
  status
)
VALUES
  ('b3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'active'),
  ('b3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'active'),
  ('b3000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'active'),
  ('b3000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001', 'active'),
  ('b3000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001', 'active'),
  ('b3000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'active'),
  ('b3000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'active'),
  ('b3000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'active'),
  ('b3000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004', 'active'),
  ('b3000000-0000-4000-8000-000000000015', 'b0000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000005', 'active'),
  ('b3000000-0000-4000-8000-000000000016', 'b0000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000006', 'active');

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
SELECT
  membership.advocate_id,
  membership.id,
  '00000000-0000-4000-8000-000000000001'::uuid,
  'b1000000-0000-4000-8000-000000000001'::uuid
FROM public.advocate_memberships membership
WHERE membership.id IN (
  'b3000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000002',
  'b3000000-0000-4000-8000-000000000003',
  'b3000000-0000-4000-8000-000000000004',
  'b3000000-0000-4000-8000-000000000005'
);

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
SELECT
  membership.advocate_id,
  membership.id,
  CASE
    WHEN membership.id = 'b3000000-0000-4000-8000-000000000013'::uuid
      THEN '00000000-0000-4000-8000-000000000004'::uuid
    ELSE '00000000-0000-4000-8000-000000000003'::uuid
  END,
  'b1000000-0000-4000-8000-000000000001'::uuid
FROM public.advocate_memberships membership
WHERE membership.id IN (
  'b3000000-0000-4000-8000-000000000011',
  'b3000000-0000-4000-8000-000000000012',
  'b3000000-0000-4000-8000-000000000013',
  'b3000000-0000-4000-8000-000000000014',
  'b3000000-0000-4000-8000-000000000015',
  'b3000000-0000-4000-8000-000000000016'
);

UPDATE public.advocates advocate
SET owner_membership_id = CASE advocate.id
  WHEN 'b0000000-0000-4000-8000-000000000001'::uuid THEN 'b3000000-0000-4000-8000-000000000001'::uuid
  WHEN 'b0000000-0000-4000-8000-000000000002'::uuid THEN 'b3000000-0000-4000-8000-000000000002'::uuid
  WHEN 'b0000000-0000-4000-8000-000000000003'::uuid THEN 'b3000000-0000-4000-8000-000000000003'::uuid
  WHEN 'b0000000-0000-4000-8000-000000000004'::uuid THEN 'b3000000-0000-4000-8000-000000000004'::uuid
  ELSE 'b3000000-0000-4000-8000-000000000005'::uuid
END
WHERE advocate.id IN (
  'b0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000004',
  'b0000000-0000-4000-8000-000000000005'
);

SET CONSTRAINTS ALL IMMEDIATE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b1000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      1,
      'browser-direct-reserve',
      NULL
    )
  $$,
  '42501',
  NULL,
  'an authenticated browser cannot call the reservation RPC directly'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.update_advocate_branding(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      1,
      '#123456',
      '#ABCDEF',
      NULL,
      NULL,
      NULL,
      '<h2>Direct browser write</h2>',
      '<p>Denied</p>',
      'Attempt a direct browser write',
      'browser-direct-branding',
      NULL,
      NULL
    )
  $$,
  '42501',
  NULL,
  'an authenticated browser cannot bypass server rich-text sanitization through the branding RPC'
);

RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.lives_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000001'
      ),
      'logo-a-canonical',
      'logo-a-trace'
    )
  $$,
  'the service can reserve one authorized exact-version logo upload'
);

RESET ROLE;

DO $$
BEGIN
  PERFORM set_config(
    'test.logo_a_reservation_id',
    (
      SELECT reservation.id::text
      FROM private.advocate_logo_upload_reservations reservation
      WHERE reservation.request_id = 'logo-a-canonical'
    ),
    true
  );
  PERFORM set_config(
    'test.logo_a_object_path',
    (
      SELECT reservation.object_path
      FROM private.advocate_logo_upload_reservations reservation
      WHERE reservation.request_id = 'logo-a-canonical'
    ),
    true
  );
  PERFORM set_config(
    'test.logo_a_expected_version',
    (
      SELECT reservation.expected_advocate_version::text
      FROM private.advocate_logo_upload_reservations reservation
      WHERE reservation.request_id = 'logo-a-canonical'
    ),
    true
  );
END;
$$;

SELECT extensions.ok(
  (
    SELECT reservation.status = 'pending'
      AND reservation.object_path =
        'logos/logoreservea/' || reservation.id::text || '.webp'
      AND reservation.expires_at - reservation.created_at = interval '15 minutes'
      AND reservation.resulting_advocate_version IS NULL
      AND reservation.trace_id = 'logo-a-trace'
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.id =
      current_setting('test.logo_a_reservation_id')::uuid
  ),
  'the reservation stores an exact tenant path, immutable evidence, and a 15 minute pending lease'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      current_setting('test.logo_a_expected_version')::bigint,
      'logo-a-second-flight',
      NULL
    )
  $$,
  '55000',
  'An advocate logo upload is already pending',
  'one advocate version permits only one active logo upload flight'
);

SELECT extensions.is(
  (
    SELECT result.status
      || '|' || result.object_path
      || '|' || result.expected_version::text
      || '|' || coalesce(result.resulting_version::text, 'null')
    FROM public.get_advocate_logo_upload_reservation_result(
      current_setting('test.logo_a_reservation_id')::uuid,
      'b1000000-0000-4000-8000-000000000002',
      'logo-a-canonical'
    ) result
  ),
  'pending|'
    || current_setting('test.logo_a_object_path')
    || '|'
    || current_setting('test.logo_a_expected_version')
    || '|null',
  'the result lookup reports the exact pending state without inventing a resulting version'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.get_advocate_logo_upload_reservation_result(
      current_setting('test.logo_a_reservation_id')::uuid,
      'b1000000-0000-4000-8000-000000000001',
      'logo-a-canonical'
    )
  $$,
  '42501',
  'Insufficient logo reservation permission',
  'result inspection rejects the wrong actor'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.get_advocate_logo_upload_reservation_result(
      current_setting('test.logo_a_reservation_id')::uuid,
      'b1000000-0000-4000-8000-000000000002',
      'wrong-request'
    )
  $$,
  '42501',
  'Insufficient logo reservation permission',
  'result inspection rejects the wrong request binding'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.update_advocate_branding(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001',
      current_setting('test.logo_a_expected_version')::bigint,
      '#123456',
      '#ABCDEF',
      current_setting('test.logo_a_object_path'),
      current_setting('test.logo_a_reservation_id')::uuid,
      'Logo A',
      '<h2>Wrong actor</h2>',
      '<p>Wrong actor</p>',
      'Attempt a wrong actor attachment',
      'logo-a-canonical',
      'logo-a-trace',
      'logo-a-session'
    )
  $$,
  '42501',
  'Insufficient logo reservation permission',
  'an otherwise authorized tenant owner cannot consume another actor reservation'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.update_advocate_branding(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      current_setting('test.logo_a_expected_version')::bigint - 1,
      '#123456',
      '#ABCDEF',
      current_setting('test.logo_a_object_path'),
      current_setting('test.logo_a_reservation_id')::uuid,
      'Logo A',
      '<h2>Stale</h2>',
      '<p>Stale</p>',
      'Attempt a stale attachment',
      'logo-a-canonical',
      NULL,
      NULL
    )
  $$,
  '40001',
  'Advocate settings changed; refresh and retry',
  'branding attachment rejects a stale aggregate version before consuming the reservation'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.update_advocate_branding(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      current_setting('test.logo_a_expected_version')::bigint,
      '#123456',
      '#ABCDEF',
      'logos/logoreservea/baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp',
      current_setting('test.logo_a_reservation_id')::uuid,
      'Logo A',
      '<h2>Wrong path</h2>',
      '<p>Wrong path</p>',
      'Attempt a mismatched path attachment',
      'logo-a-canonical',
      NULL,
      NULL
    )
  $$,
  '42501',
  'Insufficient logo reservation permission',
  'branding attachment rejects a path different from the immutable reservation path'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.update_advocate_branding(
      'b0000000-0000-4000-8000-000000000002',
      'b1000000-0000-4000-8000-000000000002',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000002'
      ),
      '#123456',
      '#ABCDEF',
      current_setting('test.logo_a_object_path'),
      current_setting('test.logo_a_reservation_id')::uuid,
      'Logo A',
      '<h2>Wrong tenant</h2>',
      '<p>Wrong tenant</p>',
      'Attempt a cross tenant attachment',
      'logo-a-canonical',
      NULL,
      NULL
    )
  $$,
  '23514',
  'Advocate logo storage path violates the tenant asset boundary',
  'branding attachment rejects another tenant namespace even for a shared delegate'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.update_advocate_branding(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      current_setting('test.logo_a_expected_version')::bigint,
      '#123456',
      '#ABCDEF',
      current_setting('test.logo_a_object_path'),
      current_setting('test.logo_a_reservation_id')::uuid,
      'Logo A',
      '<h2>Missing object</h2>',
      '<p>Missing object</p>',
      'Attempt attachment before provider upload',
      'logo-a-canonical',
      NULL,
      NULL
    )
  $$,
  '23503',
  'Reserved advocate logo object does not exist or is invalid',
  'a valid reservation cannot be consumed before its validated storage object exists'
);

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES (
  'advocate-assets',
  current_setting('test.logo_a_object_path'),
  jsonb_build_object('mimetype', 'image/webp', 'size', 4096)
);

SELECT extensions.is(
  public.update_advocate_branding(
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    current_setting('test.logo_a_expected_version')::bigint,
    '#123456',
    '#abcdef',
    current_setting('test.logo_a_object_path'),
    current_setting('test.logo_a_reservation_id')::uuid,
    '  Logo A  ',
    '<h2>Approved opening</h2>',
    '<p>Approved biography</p>',
    'Attach the sanitized approved advocate logo',
    'logo-a-canonical',
    'logo-a-trace',
    'logo-a-session'
  ),
  current_setting('test.logo_a_expected_version')::bigint + 1,
  'the branding transaction atomically attaches the exact reserved object and advances the aggregate once'
);

SELECT extensions.is(
  (
    SELECT result.status
      || '|' || result.object_path
      || '|' || result.expected_version::text
      || '|' || result.resulting_version::text
    FROM public.get_advocate_logo_upload_reservation_result(
      current_setting('test.logo_a_reservation_id')::uuid,
      'b1000000-0000-4000-8000-000000000002',
      'logo-a-canonical'
    ) result
  ),
  'attached|'
    || current_setting('test.logo_a_object_path')
    || '|'
    || current_setting('test.logo_a_expected_version')
    || '|'
    || (
      current_setting('test.logo_a_expected_version')::bigint + 1
    )::text,
  'an ambiguous client response can recover the exact attached commit and resulting aggregate version'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT reservation.status = 'attached'
      AND reservation.settled_at IS NOT NULL
      AND reservation.failure_code IS NULL
      AND reservation.resulting_advocate_version =
        reservation.expected_advocate_version + 1
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.id =
      current_setting('test.logo_a_reservation_id')::uuid
  )
  AND (
    SELECT branding.logo_storage_path =
        current_setting('test.logo_a_object_path')
      AND branding.logo_alt_text = 'Logo A'
      AND branding.primary_color = '#123456'
      AND branding.accent_color = '#ABCDEF'
      AND branding.opening_header_html = '<h2>Approved opening</h2>'
      AND branding.about_biography_html = '<p>Approved biography</p>'
    FROM public.advocate_branding branding
    WHERE branding.advocate_id =
      'b0000000-0000-4000-8000-000000000001'
  ),
  'the attached reservation and branding row record one consistent committed state'
);

SELECT extensions.throws_ok(
  $$
    UPDATE private.advocate_logo_upload_reservations reservation
    SET failure_code = 'tampered'
    WHERE reservation.id =
      current_setting('test.logo_a_reservation_id')::uuid
  $$,
  '55000',
  'Terminal logo reservations are immutable',
  'an attached reservation cannot be altered directly after commit'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'advocate_logo_upload_reservations'
      AND event.operation = 'UPDATE'
      AND event.advocate_id =
        'b0000000-0000-4000-8000-000000000001'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        'b1000000-0000-4000-8000-000000000002'
      AND event.tool = 'advocate-portal-branding'
      AND event.request_id = 'logo-a-canonical'
      AND event.trace_id = 'logo-a-trace'
      AND event.reason = 'Attach the sanitized approved advocate logo'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
      AND event.changed_columns @> ARRAY[
        'status',
        'settled_at',
        'resulting_advocate_version'
      ]::text[]
  ),
  'reservation attachment is audited with actor, tool, request, trace, reason, safe changed columns, and no row image'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b1000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.get_advocate_audit_events(
      'b0000000-0000-4000-8000-000000000001'
    ) event
    WHERE event.table_name = 'advocate_logo_upload_reservations'
      AND event.actor_user_id =
        'b1000000-0000-4000-8000-000000000002'
      AND event.tool IN (
        'advocate-portal-logo',
        'advocate-portal-branding'
      )
  ),
  'a tenant audit viewer receives the sanitized logo reservation lifecycle entry'
);

RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is(
  public.update_advocate_branding(
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    (
      SELECT advocate.version
      FROM public.advocates advocate
      WHERE advocate.id = 'b0000000-0000-4000-8000-000000000001'
    ),
    '#123456',
    '#ABCDEF',
    current_setting('test.logo_a_object_path'),
    NULL,
    'Logo A',
    '<h2>Retained opening</h2>',
    '<p>Retained biography</p>',
    'Retain the existing immutable logo path',
    'logo-a-retain',
    NULL,
    NULL
  ),
  current_setting('test.logo_a_expected_version')::bigint + 2,
  'retaining the exact existing logo path requires no new reservation'
);

SELECT extensions.is(
  public.update_advocate_branding(
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    (
      SELECT advocate.version
      FROM public.advocates advocate
      WHERE advocate.id = 'b0000000-0000-4000-8000-000000000001'
    ),
    '#123456',
    '#ABCDEF',
    NULL,
    NULL,
    NULL,
    '<h2>Removed logo</h2>',
    '<p>Removed logo biography</p>',
    'Remove the advocate logo',
    'logo-a-remove',
    NULL,
    NULL
  ),
  current_setting('test.logo_a_expected_version')::bigint + 3,
  'removing a logo requires no reservation and still advances the aggregate exactly once'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.update_advocate_branding(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000001'
      ),
      '#123456',
      '#ABCDEF',
      NULL,
      current_setting('test.logo_a_reservation_id')::uuid,
      NULL,
      '<h2>Irrelevant reservation</h2>',
      '<p>Irrelevant reservation</p>',
      'Attempt reservation reuse without a new path',
      'logo-a-irrelevant',
      NULL,
      NULL
    )
  $$,
  '22023',
  'A logo reservation is valid only for a new logo path',
  'retaining or removing a logo cannot consume an unrelated reservation'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.settle_advocate_logo_upload_reservation(
      current_setting('test.logo_a_reservation_id')::uuid,
      'b1000000-0000-4000-8000-000000000002',
      'logo-a-canonical',
      'cleanup_required',
      'ambiguous_upload'
    )
  $$,
  '55000',
  'Logo reservation is already terminal',
  'failure settlement cannot rewrite an attached reservation'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000003',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000001'
      ),
      'logo-permission-denied',
      NULL
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a catalog-only delegate cannot reserve a branding upload'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000005',
      'b1000000-0000-4000-8000-000000000006',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000005'
      ),
      'logo-suspended-denied',
      NULL
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a branding delegate cannot reserve an upload while portal publication is suspended'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      (
        SELECT advocate.version - 1
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000001'
      ),
      'logo-reserve-stale',
      NULL
    )
  $$,
  '40001',
  'Advocate settings changed; refresh and retry',
  'reservation rejects a stale aggregate version'
);

SELECT extensions.lives_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000002',
      'b1000000-0000-4000-8000-000000000002',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000002'
      ),
      'logo-b-cleanup',
      'logo-b-trace'
    )
  $$,
  'a second tenant can reserve an independent upload'
);

RESET ROLE;

DO $$
BEGIN
  PERFORM set_config(
    'test.logo_b_cleanup_id',
    (
      SELECT reservation.id::text
      FROM private.advocate_logo_upload_reservations reservation
      WHERE reservation.request_id = 'logo-b-cleanup'
    ),
    true
  );
END;
$$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT public.settle_advocate_logo_upload_reservation(
      current_setting('test.logo_b_cleanup_id')::uuid,
      'b1000000-0000-4000-8000-000000000001',
      'logo-b-cleanup',
      'cleanup_required',
      'provider_upload_ambiguous'
    )
  $$,
  '42501',
  'Insufficient logo reservation permission',
  'failure settlement rejects the wrong actor binding'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.settle_advocate_logo_upload_reservation(
      current_setting('test.logo_b_cleanup_id')::uuid,
      'b1000000-0000-4000-8000-000000000002',
      'wrong-request',
      'cleanup_required',
      'provider_upload_ambiguous'
    )
  $$,
  '42501',
  'Insufficient logo reservation permission',
  'failure settlement rejects the wrong request binding'
);

SELECT extensions.is(
  public.settle_advocate_logo_upload_reservation(
    current_setting('test.logo_b_cleanup_id')::uuid,
    'b1000000-0000-4000-8000-000000000002',
    'logo-b-cleanup',
    'cleanup_required',
    'provider_upload_ambiguous'
  ),
  'cleanup_required',
  'an ambiguous failed provider upload settles durably to cleanup_required'
);

SELECT extensions.is(
  public.settle_advocate_logo_upload_reservation(
    current_setting('test.logo_b_cleanup_id')::uuid,
    'b1000000-0000-4000-8000-000000000002',
    'logo-b-cleanup',
    'cleanup_required',
    'provider_upload_ambiguous'
  ),
  'cleanup_required',
  'an exact retry of the same terminal settlement is idempotent'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.settle_advocate_logo_upload_reservation(
      current_setting('test.logo_b_cleanup_id')::uuid,
      'b1000000-0000-4000-8000-000000000002',
      'logo-b-cleanup',
      'cancelled',
      'upload_cancelled'
    )
  $$,
  '55000',
  'Logo reservation is already terminal',
  'a terminal cleanup reservation cannot transition to cancelled'
);

SELECT extensions.is(
  (
    SELECT result.status
      || '|' || coalesce(result.resulting_version::text, 'null')
    FROM public.get_advocate_logo_upload_reservation_result(
      current_setting('test.logo_b_cleanup_id')::uuid,
      'b1000000-0000-4000-8000-000000000002',
      'logo-b-cleanup'
    ) result
  ),
  'cleanup_required|null',
  'cleanup-required inspection never masquerades as an attached commit'
);

SELECT extensions.lives_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000002',
      'b1000000-0000-4000-8000-000000000002',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000002'
      ),
      'logo-b-stale',
      NULL
    )
  $$,
  'a terminal failure releases the tenant single-flight boundary'
);

RESET ROLE;

DO $$
BEGIN
  PERFORM set_config(
    'test.logo_b_stale_id',
    (
      SELECT reservation.id::text
      FROM private.advocate_logo_upload_reservations reservation
      WHERE reservation.request_id = 'logo-b-stale'
    ),
    true
  );
END;
$$;

UPDATE public.advocates advocate
SET display_name = advocate.display_name
WHERE advocate.id = 'b0000000-0000-4000-8000-000000000002';

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.lives_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000002',
      'b1000000-0000-4000-8000-000000000002',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000002'
      ),
      'logo-b-after-stale',
      NULL
    )
  $$,
  'a new aggregate version expires the stale pending flight and issues one new path'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT reservation.status = 'expired'
      AND reservation.failure_code = 'reservation_expired'
      AND reservation.settled_at IS NOT NULL
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.id = current_setting('test.logo_b_stale_id')::uuid
  )
  AND (
    SELECT count(*) = 1
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.advocate_id =
      'b0000000-0000-4000-8000-000000000002'
      AND reservation.status = 'pending'
  ),
  'stale pending evidence is retained as expired while exactly one current flight remains pending'
);

DO $$
BEGIN
  PERFORM set_config(
    'test.logo_b_current_id',
    (
      SELECT reservation.id::text
      FROM private.advocate_logo_upload_reservations reservation
      WHERE reservation.request_id = 'logo-b-after-stale'
    ),
    true
  );
END;
$$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is(
  public.settle_advocate_logo_upload_reservation(
    current_setting('test.logo_b_current_id')::uuid,
    'b1000000-0000-4000-8000-000000000002',
    'logo-b-after-stale',
    'cancelled',
    'upload_cancelled'
  ),
  'cancelled',
  'a provider-free cancellation durably closes the current flight'
);

RESET ROLE;

WITH attempts AS (
  SELECT
    (
      'bc000000-0000-4000-8000-' || lpad(series.value::text, 12, '0')
    )::uuid AS reservation_id,
    clock_timestamp() - interval '30 minutes'
      + make_interval(secs => series.value) AS created_at,
    series.value
  FROM generate_series(1, 10) AS series(value)
)
INSERT INTO private.advocate_logo_upload_reservations (
  id,
  advocate_id,
  actor_user_id,
  expected_advocate_version,
  object_path,
  status,
  request_id,
  failure_code,
  created_at,
  expires_at,
  settled_at
)
SELECT
  attempt.reservation_id,
  'b0000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000004',
  advocate.version,
  'logos/logorateactor/' || attempt.reservation_id::text || '.webp',
  'cancelled',
  'actor-rate-' || attempt.value::text,
  'upload_cancelled',
  attempt.created_at,
  attempt.created_at + interval '15 minutes',
  attempt.created_at + interval '1 minute'
FROM attempts attempt
CROSS JOIN public.advocates advocate
WHERE advocate.id = 'b0000000-0000-4000-8000-000000000003';

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000003',
      'b1000000-0000-4000-8000-000000000004',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000003'
      ),
      'actor-rate-rejected',
      NULL
    )
  $$,
  '54000',
  'Advocate logo upload rate limit exceeded',
  'the eleventh rolling-hour attempt by one actor is rejected durably'
);

RESET ROLE;

WITH attempts AS (
  SELECT
    (
      'bd000000-0000-4000-8000-' || lpad(series.value::text, 12, '0')
    )::uuid AS reservation_id,
    (
      'b2000000-0000-4000-8000-' || lpad(series.value::text, 12, '0')
    )::uuid AS actor_user_id,
    clock_timestamp() - interval '30 minutes'
      + make_interval(secs => series.value) AS created_at,
    series.value
  FROM generate_series(1, 20) AS series(value)
)
INSERT INTO private.advocate_logo_upload_reservations (
  id,
  advocate_id,
  actor_user_id,
  expected_advocate_version,
  object_path,
  status,
  request_id,
  failure_code,
  created_at,
  expires_at,
  settled_at
)
SELECT
  attempt.reservation_id,
  'b0000000-0000-4000-8000-000000000004',
  attempt.actor_user_id,
  advocate.version,
  'logos/logoratetenant/' || attempt.reservation_id::text || '.webp',
  'cancelled',
  'tenant-rate-' || attempt.value::text,
  'upload_cancelled',
  attempt.created_at,
  attempt.created_at + interval '15 minutes',
  attempt.created_at + interval '1 minute'
FROM attempts attempt
CROSS JOIN public.advocates advocate
WHERE advocate.id = 'b0000000-0000-4000-8000-000000000004';

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.reserve_advocate_logo_upload(
      'b0000000-0000-4000-8000-000000000004',
      'b1000000-0000-4000-8000-000000000005',
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = 'b0000000-0000-4000-8000-000000000004'
      ),
      'tenant-rate-rejected',
      NULL
    )
  $$,
  '54000',
  'Advocate logo upload rate limit exceeded',
  'the twenty-first rolling-hour attempt for one tenant is rejected across actors'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.actor_user_id =
      'b1000000-0000-4000-8000-000000000004'
      AND reservation.created_at >= clock_timestamp() - interval '1 hour'
  ),
  10,
  'a rejected actor-limited request creates no extra durable attempt row'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.advocate_id =
      'b0000000-0000-4000-8000-000000000004'
      AND reservation.created_at >= clock_timestamp() - interval '1 hour'
  ),
  20,
  'a rejected tenant-limited request creates no extra durable attempt row'
);

SELECT * FROM extensions.finish();

ROLLBACK;
