BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

-- The application authenticates the user before crossing the service-only
-- sanitization boundary. This session-local helper preserves that shape for
-- settings tests while refusing to impersonate a different fixture actor.
CREATE OR REPLACE FUNCTION pg_temp.call_service_update_advocate_branding(
  target_advocate_id uuid,
  target_actor_user_id uuid,
  expected_advocate_version bigint,
  target_primary_color text,
  target_accent_color text,
  target_logo_storage_path text,
  target_logo_upload_reservation_id uuid,
  target_logo_alt_text text,
  target_opening_header_html text,
  target_about_biography_html text,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prior_role text := pg_catalog.current_setting(
    'request.jwt.claim.role',
    true
  );
  v_result bigint;
BEGIN
  IF auth.uid() IS DISTINCT FROM target_actor_user_id THEN
    RAISE EXCEPTION 'Test service bridge actor mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  v_result := public.update_advocate_branding(
    target_advocate_id,
    target_actor_user_id,
    expected_advocate_version,
    target_primary_color,
    target_accent_color,
    target_logo_storage_path,
    target_logo_upload_reservation_id,
    target_logo_alt_text,
    target_opening_header_html,
    target_about_biography_html,
    change_reason,
    request_id,
    trace_id,
    session_id
  );

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    COALESCE(v_prior_role, ''),
    true
  );

  RETURN v_result;
EXCEPTION WHEN others THEN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    COALESCE(v_prior_role, ''),
    true
  );
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.call_service_replace_advocate_public_metrics(
  target_advocate_id uuid,
  acting_user_id uuid,
  expected_advocate_version bigint,
  target_metric_keys public.advocate_public_metric_key[],
  change_reason text,
  request_id text,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prior_role text := pg_catalog.current_setting(
    'request.jwt.claim.role',
    true
  );
  v_result bigint;
BEGIN
  IF auth.uid() IS DISTINCT FROM acting_user_id THEN
    RAISE EXCEPTION 'Test service bridge actor mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  v_result := public.replace_advocate_public_metrics(
    target_advocate_id,
    acting_user_id,
    expected_advocate_version,
    target_metric_keys,
    change_reason,
    request_id,
    trace_id,
    session_id
  );

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    COALESCE(v_prior_role, ''),
    true
  );

  RETURN v_result;
EXCEPTION WHEN others THEN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    COALESCE(v_prior_role, ''),
    true
  );
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.call_service_replace_advocate_beneficiaries(
  target_advocate_id uuid,
  acting_user_id uuid,
  expected_advocate_version bigint,
  target_beneficiary_mode public.advocate_beneficiary_mode,
  target_beneficiary_ids uuid[],
  target_featured_beneficiary_ids uuid[],
  change_reason text,
  request_id text,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prior_role text := pg_catalog.current_setting(
    'request.jwt.claim.role',
    true
  );
  v_result bigint;
BEGIN
  IF auth.uid() IS DISTINCT FROM acting_user_id THEN
    RAISE EXCEPTION 'Test service bridge actor mismatch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );

  v_result := public.replace_advocate_beneficiary_configuration(
    target_advocate_id,
    acting_user_id,
    expected_advocate_version,
    target_beneficiary_mode,
    target_beneficiary_ids,
    target_featured_beneficiary_ids,
    change_reason,
    request_id,
    trace_id,
    session_id
  );

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    COALESCE(v_prior_role, ''),
    true
  );

  RETURN v_result;
EXCEPTION WHEN others THEN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role',
    COALESCE(v_prior_role, ''),
    true
  );
  RAISE;
END;
$$;

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_my_advocate_portal_access()'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_advocate_admin_settings(uuid)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path="",lock_timeout=5s'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.update_advocate_branding(uuid,uuid,bigint,text,text,text,uuid,text,text,text,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.replace_advocate_public_metrics(uuid,uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)'::regprocedure
  ),
  'every advocate settings RPC uses fixed definer authority and branding bounds lock waits'
);

SELECT extensions.ok(
  position(
    'FOR SHARE' IN pg_get_functiondef(
      'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'beneficiary replacement holds eligible child rows stable through commit'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_my_advocate_portal_access()',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.get_advocate_admin_settings(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.update_advocate_branding(uuid,uuid,bigint,text,text,text,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.update_advocate_branding(uuid,uuid,bigint,text,text,text,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
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
  AND NOT has_function_privilege(
    'authenticated',
    'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_my_advocate_portal_access()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.get_my_advocate_portal_access()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_advocate_admin_settings(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.get_advocate_admin_settings(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.update_advocate_branding(uuid,uuid,bigint,text,text,text,uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.replace_advocate_public_metrics(uuid,uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated sessions retain reads while only the service role can execute actor aware settings mutations'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_my_advocate_portal_access()'::regprocedure
  ),
  ARRAY[
    'advocate_id',
    'slug',
    'display_name',
    'relationship_status',
    'publication_status',
    'beneficiary_mode',
    'advocate_version',
    'canonical_hostname',
    'domain_status',
    'permissions'
  ]::text[],
  'the access RPC exposes exactly the ten application contract fields'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'public.advocate_branding',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_branding',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_branding',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_public_metric_selections',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_public_metric_selections',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_public_metric_selections',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_beneficiaries',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_beneficiaries',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_beneficiaries',
    'DELETE'
  ),
  'the service role cannot bypass the narrow configuration mutation RPCs'
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
    'a1000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'settings-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Settings","last_name":"Owner"}'::jsonb,
    now(),
    now()
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'settings-administrator@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Settings","last_name":"Administrator"}'::jsonb,
    now(),
    now()
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'settings-brand@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Settings","last_name":"Brand"}'::jsonb,
    now(),
    now()
  ),
  (
    'a1000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'settings-catalog@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Settings","last_name":"Catalog"}'::jsonb,
    now(),
    now()
  ),
  (
    'a1000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'settings-analytics@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Settings","last_name":"Analytics"}'::jsonb,
    now(),
    now()
  ),
  (
    'a1000000-0000-4000-8000-000000000006',
    'authenticated',
    'authenticated',
    'settings-audit@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Settings","last_name":"Audit"}'::jsonb,
    now(),
    now()
  ),
  (
    'a1000000-0000-4000-8000-000000000007',
    'authenticated',
    'authenticated',
    'settings-suspended@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'a1000000-0000-4000-8000-000000000008',
    'authenticated',
    'authenticated',
    'settings-revoked@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'a1000000-0000-4000-8000-000000000009',
    'authenticated',
    'authenticated',
    'settings-other-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Other","last_name":"Owner"}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.advocates (
  id,
  slug,
  display_name,
  relationship_status,
  publication_status,
  beneficiary_mode
)
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'adminsettingsa',
    'Admin Settings A',
    'active',
    'draft',
    'all'
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'adminsettingsb',
    'Admin Settings B',
    'active',
    'draft',
    'all'
  );

INSERT INTO public.advocate_branding (advocate_id)
VALUES
  ('a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002');

INSERT INTO public.advocate_domains (
  id,
  advocate_id,
  hostname,
  is_primary
)
VALUES (
  'a5000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'adminsettingsa.creatorshare.com',
  true
);

INSERT INTO public.advocate_memberships (
  id,
  advocate_id,
  user_id,
  status,
  suspended_at,
  revoked_at
)
VALUES
  (
    'a2000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'active',
    NULL,
    NULL
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'active',
    NULL,
    NULL
  ),
  (
    'a2000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000003',
    'active',
    NULL,
    NULL
  ),
  (
    'a2000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000004',
    'active',
    NULL,
    NULL
  ),
  (
    'a2000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000005',
    'active',
    NULL,
    NULL
  ),
  (
    'a2000000-0000-4000-8000-000000000006',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000006',
    'active',
    NULL,
    NULL
  ),
  (
    'a2000000-0000-4000-8000-000000000007',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000007',
    'suspended',
    now(),
    NULL
  ),
  (
    'a2000000-0000-4000-8000-000000000008',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000008',
    'revoked',
    NULL,
    now()
  ),
  (
    'a2000000-0000-4000-8000-000000000009',
    'a0000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000009',
    'active',
    NULL,
    NULL
  );

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000005',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000006',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000009',
    '00000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000009'
  );

UPDATE public.advocates
SET owner_membership_id = CASE id
  WHEN 'a0000000-0000-4000-8000-000000000001'::uuid
    THEN 'a2000000-0000-4000-8000-000000000001'::uuid
  ELSE 'a2000000-0000-4000-8000-000000000009'::uuid
END
WHERE id IN (
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002'
);

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES
  (
    'advocate-assets',
    'logos/adminsettingsa/a4000000-0000-4000-8000-000000000001.webp',
    jsonb_build_object('mimetype', 'image/webp', 'size', 4096)
  ),
  (
    'advocate-assets',
    'logos/adminsettingsb/a4000000-0000-4000-8000-000000000002.webp',
    jsonb_build_object('mimetype', 'image/webp', 'size', 4096)
  );

WITH reservation_context AS (
  SELECT clock_timestamp() AS created_at
)
INSERT INTO private.advocate_logo_upload_reservations (
  id,
  advocate_id,
  actor_user_id,
  expected_advocate_version,
  object_path,
  request_id,
  trace_id,
  created_at,
  expires_at
)
SELECT
  'a4000000-0000-4000-8000-000000000001',
  advocate.id,
  'a1000000-0000-4000-8000-000000000003',
  advocate.version,
  'logos/adminsettingsa/a4000000-0000-4000-8000-000000000001.webp',
  'settings-branding-success',
  'settings-branding-trace',
  reservation_context.created_at,
  reservation_context.created_at + interval '15 minutes'
FROM public.advocates advocate
CROSS JOIN reservation_context
WHERE advocate.id = 'a0000000-0000-4000-8000-000000000001';

INSERT INTO public.beneficiaries (
  id,
  name,
  username,
  birth_date,
  budget_goal,
  status,
  beneficiary_type,
  goal_fulfilled_at
)
VALUES
  (
    'a3000000-0000-4000-8000-000000000001',
    'Admin Settings Child One',
    'admin-settings-child-one',
    '2012-01-01',
    5000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    'a3000000-0000-4000-8000-000000000002',
    'Admin Settings Child Two',
    'admin-settings-child-two',
    '2013-01-01',
    6000,
    'Partially Funded',
    'IN_OUR_CARE',
    NULL
  ),
  (
    'a3000000-0000-4000-8000-000000000003',
    'Admin Settings Child Three',
    'admin-settings-child-three',
    '2014-01-01',
    -1,
    'Sponsorship Cancelled',
    'IN_OUR_CARE',
    NULL
  ),
  (
    'a3000000-0000-4000-8000-000000000004',
    'Admin Settings Draft Child',
    'admin-settings-draft-child',
    '2015-01-01',
    7000,
    'Draft',
    'IN_OUR_CARE',
    NULL
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.is(
  (
    SELECT access.permissions
    FROM public.get_my_advocate_portal_access() access
    WHERE access.advocate_id =
      'a0000000-0000-4000-8000-000000000001'
  ),
  ARRAY[
    'portal.analytics.view',
    'portal.archive',
    'portal.audit.view',
    'portal.beneficiaries.manage',
    'portal.branding.update',
    'portal.domains.manage',
    'portal.domains.view',
    'portal.members.invite',
    'portal.members.manage',
    'portal.members.view',
    'portal.ownership.transfer',
    'portal.public_metrics.update',
    'portal.settings.update',
    'portal.view'
  ]::text[],
  'the Owner receives the exact sorted complete permission set'
);

SELECT extensions.ok(
  (
    SELECT access.slug = 'adminsettingsa'
      AND access.display_name = 'Admin Settings A'
      AND access.relationship_status = 'active'
      AND access.publication_status = 'draft'
      AND access.beneficiary_mode = 'all'
      AND access.advocate_version > 1
      AND access.canonical_hostname = 'adminsettingsa.creatorshare.com'
      AND access.domain_status = 'pending'
    FROM public.get_my_advocate_portal_access() access
    WHERE access.advocate_id =
      'a0000000-0000-4000-8000-000000000001'
  ),
  'the access row returns the exact advocate root and canonical primary domain state'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.is(
  (
    SELECT permissions
    FROM public.get_my_advocate_portal_access()
  ),
  ARRAY[
    'portal.analytics.view',
    'portal.audit.view',
    'portal.beneficiaries.manage',
    'portal.branding.update',
    'portal.domains.manage',
    'portal.domains.view',
    'portal.members.invite',
    'portal.members.manage',
    'portal.members.view',
    'portal.public_metrics.update',
    'portal.settings.update',
    'portal.view'
  ]::text[],
  'the Administrator receives every operational permission except ownership and archival'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000003',
  true
);

SELECT extensions.is(
  (SELECT permissions FROM public.get_my_advocate_portal_access()),
  ARRAY[
    'portal.branding.update',
    'portal.public_metrics.update',
    'portal.view'
  ]::text[],
  'the Brand Editor receives only branding, public metric, and portal view permissions'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000004',
  true
);

SELECT extensions.is(
  (SELECT permissions FROM public.get_my_advocate_portal_access()),
  ARRAY['portal.beneficiaries.manage', 'portal.view']::text[],
  'the Catalog Curator receives only catalog and portal view permissions'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000005',
  true
);

SELECT extensions.is(
  (SELECT permissions FROM public.get_my_advocate_portal_access()),
  ARRAY['portal.analytics.view', 'portal.view']::text[],
  'the Analytics Viewer receives only analytics and portal view permissions'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000006',
  true
);

SELECT extensions.is(
  (SELECT permissions FROM public.get_my_advocate_portal_access()),
  ARRAY['portal.audit.view', 'portal.view']::text[],
  'the Audit Viewer receives only audit and portal view permissions'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000009',
  true
);

SELECT extensions.ok(
  (
    SELECT access.canonical_hostname IS NULL
      AND access.domain_status IS NULL
      AND access.permissions @> ARRAY['portal.view']::text[]
    FROM public.get_my_advocate_portal_access() access
    WHERE access.advocate_id =
      'a0000000-0000-4000-8000-000000000002'
  ),
  'the access row safely returns null canonical domain fields when no primary domain exists'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000003',
  true
);

SELECT extensions.is(
  ARRAY(
    SELECT key
    FROM jsonb_object_keys(
      public.get_advocate_admin_settings(
        'a0000000-0000-4000-8000-000000000001'
      )
    ) key
    ORDER BY key
  ),
  ARRAY[
    'advocate',
    'beneficiary_selections',
    'branding',
    'public_metric_selections'
  ]::text[],
  'the settings snapshot has exactly four allowlisted top level sections'
);

SELECT extensions.is(
  ARRAY(
    SELECT key
    FROM jsonb_object_keys(
      public.get_advocate_admin_settings(
        'a0000000-0000-4000-8000-000000000001'
      ) -> 'advocate'
    ) key
    ORDER BY key
  ),
  ARRAY[
    'advocate_type',
    'advocate_version',
    'beneficiary_mode',
    'display_name',
    'id',
    'publication_status',
    'relationship_status',
    'slug'
  ]::text[],
  'the settings advocate section contains only allowlisted tenant root fields'
);

SELECT extensions.is(
  ARRAY(
    SELECT key
    FROM jsonb_object_keys(
      public.get_advocate_admin_settings(
        'a0000000-0000-4000-8000-000000000001'
      ) -> 'branding'
    ) key
    ORDER BY key
  ),
  ARRAY[
    'about_biography_html',
    'accent_color',
    'logo_alt_text',
    'logo_storage_path',
    'opening_header_html',
    'primary_color'
  ]::text[],
  'the settings branding section contains only the six approved MVP fields'
);

SELECT extensions.ok(
  public.get_advocate_admin_settings(
    'a0000000-0000-4000-8000-000000000001'
  ) -> 'public_metric_selections' = '[]'::jsonb
  AND public.get_advocate_admin_settings(
    'a0000000-0000-4000-8000-000000000001'
  ) -> 'beneficiary_selections' = '[]'::jsonb
  AND pg_get_functiondef(
    'public.get_advocate_admin_settings(uuid)'::regprocedure
  ) !~ '(sponsor|contact|browser_visitors|advocate_exposures|payment_gateway|customer_)',
  'the initial settings snapshot contains no sponsor, contact, tracking, or payment surface'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_admin_settings(
      'a0000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a member cannot read another tenant settings snapshot'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_update_advocate_branding(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      '#123456',
      '#abcdef',
      'logos/adminsettingsa/a4999999-9999-4999-8999-999999999999.webp',
      NULL,
      'Missing logo',
      '<h2>Missing object</h2>',
      '<p>Missing object biography</p>',
      'Attempt to attach a missing logo object',
      'settings-branding-missing-object',
      'settings-branding-trace',
      'settings-branding-session'
    )
    FROM current_access
  $$,
  '42501',
  'Insufficient logo reservation permission',
  'branding cannot attach a new syntactically valid logo path without its server-issued reservation'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_update_advocate_branding(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      '#123456',
      '#abcdef',
      'logos/adminsettingsb/a4000000-0000-4000-8000-000000000002.webp',
      NULL,
      'Another tenant logo',
      '<h2>Wrong tenant</h2>',
      '<p>Wrong tenant biography</p>',
      'Attempt to attach another tenant logo',
      'settings-branding-cross-logo',
      'settings-branding-trace',
      'settings-branding-session'
    )
    FROM current_access
  $$,
  '23514',
  'Advocate logo storage path violates the tenant asset boundary',
  'branding cannot attach an existing logo from another tenant namespace'
);

SELECT extensions.is(
  (
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_update_advocate_branding(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      '#123456',
      '#abcdef',
      'logos/adminsettingsa/a4000000-0000-4000-8000-000000000001.webp',
      'a4000000-0000-4000-8000-000000000001',
      '  Admin Settings logo  ',
      '<h2>Admin settings opening</h2>',
      '<p>Admin settings biography marker</p>',
      'Publish the approved advocate branding',
      'settings-branding-success',
      'settings-branding-trace',
      'settings-branding-session'
    ) - current_access.advocate_version
    FROM current_access
  ),
  1::bigint,
  'a permitted branding replacement advances the aggregate advocate version exactly once'
);

SELECT extensions.ok(
  (
    SELECT branding.primary_color = '#123456'
      AND branding.accent_color = '#ABCDEF'
      AND branding.logo_storage_path =
        'logos/adminsettingsa/a4000000-0000-4000-8000-000000000001.webp'
      AND branding.logo_alt_text = 'Admin Settings logo'
      AND branding.opening_header_html = '<h2>Admin settings opening</h2>'
      AND branding.about_biography_html =
        '<p>Admin settings biography marker</p>'
    FROM public.advocate_branding branding
    WHERE branding.advocate_id =
      'a0000000-0000-4000-8000-000000000001'
  ),
  'branding replacement normalizes colors and alternative text while preserving bounded rich text'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version - 1 AS stale_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_update_advocate_branding(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.stale_version,
      '#123456',
      '#ABCDEF',
      'logos/adminsettingsa/a4000000-0000-4000-8000-000000000001.webp',
      NULL,
      'Admin Settings logo',
      '<h2>Stale opening</h2>',
      '<p>Stale biography</p>',
      'Attempt a stale branding save',
      'settings-branding-stale'
    )
    FROM current_access
  $$,
  '40001',
  'Advocate settings changed; refresh and retry',
  'branding replacement rejects a stale aggregate version'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_replace_advocate_public_metrics(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      ARRAY[
        'gross_raised_usd',
        'gross_raised_usd'
      ]::public.advocate_public_metric_key[],
      'Attempt duplicate public metrics',
      'settings-metrics-duplicate'
    )
    FROM current_access
  $$,
  '22023',
  'Public metric keys must be an ordered unique allowlisted array',
  'public metric replacement rejects duplicate keys'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_replace_advocate_public_metrics(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      ARRAY[
        'gross_raised_usd'::public.advocate_public_metric_key,
        NULL::public.advocate_public_metric_key
      ],
      'Attempt a null public metric key',
      'settings-metrics-null'
    )
    FROM current_access
  $$,
  '22023',
  'Public metric keys must be an ordered unique allowlisted array',
  'public metric replacement rejects null keys'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_replace_advocate_public_metrics(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      ARRAY[
        'verified_sponsor_accounts'
      ]::public.advocate_public_metric_key[],
      'Attempt to publish a private analytics metric',
      'settings-metrics-private-key'
    )
    FROM current_access
  $$,
  '22023',
  'Public metric keys must be an ordered unique allowlisted array',
  'public metric replacement rejects enum values reserved for private analytics'
);

SELECT extensions.is(
  (
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_replace_advocate_public_metrics(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      ARRAY[
        'gross_raised_usd',
        'direct_sponsorships',
        'children_sponsored'
      ]::public.advocate_public_metric_key[],
      'Choose the approved public metrics',
      'settings-metrics-success',
      'settings-metrics-trace',
      'settings-metrics-session'
    ) - current_access.advocate_version
    FROM current_access
  ),
  1::bigint,
  'a permitted metric replacement advances the aggregate advocate version exactly once'
);

SELECT extensions.is(
  public.get_advocate_admin_settings(
    'a0000000-0000-4000-8000-000000000001'
  ) -> 'public_metric_selections',
  jsonb_build_array(
    jsonb_build_object(
      'metric_key', 'gross_raised_usd',
      'display_order', 0
    ),
    jsonb_build_object(
      'metric_key', 'direct_sponsorships',
      'display_order', 1
    ),
    jsonb_build_object(
      'metric_key', 'children_sponsored',
      'display_order', 2
    )
  ),
  'the settings snapshot returns public metrics in the exact submitted order'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_replace_advocate_public_metrics(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      ARRAY[
        'gross_raised_usd',
        'direct_sponsorships',
        'children_sponsored'
      ]::public.advocate_public_metric_key[],
      'Attempt to save an unchanged public metric selection',
      'settings-metrics-no-op'
    )
    FROM current_access
  $$,
  '22023',
  'Public metric selection is unchanged',
  'public metric replacement rejects an exact no-op without advancing the aggregate version'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
      WHERE advocate_id = 'a0000000-0000-4000-8000-000000000001'
    )
    SELECT pg_temp.call_service_replace_advocate_beneficiaries(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      'selected',
      ARRAY['a3000000-0000-4000-8000-000000000001']::uuid[],
      ARRAY[]::uuid[],
      'Brand editors cannot change the catalog',
      'settings-catalog-brand-denied'
    )
    FROM current_access
  $$,
  '42501',
  'Insufficient portal permission',
  'the Brand Editor cannot mutate beneficiary configuration'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.call_service_update_advocate_branding(
      'a0000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000003',
      2,
      '#123456',
      '#ABCDEF',
      NULL,
      NULL,
      NULL,
      '<h2>Cross tenant</h2>',
      '<p>Cross tenant</p>',
      'Attempt a cross tenant branding mutation',
      'settings-branding-cross-tenant'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a Brand Editor cannot mutate another tenant even with a plausible version'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000004',
  true
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_beneficiaries(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      current_access.advocate_version,
      'selected',
      ARRAY[
        'a3000000-0000-4000-8000-000000000001',
        'a3000000-0000-4000-8000-000000000001'
      ]::uuid[],
      ARRAY[]::uuid[],
      'Attempt duplicate beneficiary selection',
      'settings-catalog-duplicate'
    )
    FROM current_access
  $$,
  '22023',
  'Beneficiary configuration requires at most 1000 ordered unique nonnull IDs',
  'beneficiary replacement rejects duplicate chosen IDs'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_beneficiaries(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      current_access.advocate_version,
      'selected',
      ARRAY['a3000000-0000-4000-8000-000000000001']::uuid[],
      ARRAY['a3000000-0000-4000-8000-000000000002']::uuid[],
      'Attempt a featured ID outside the chosen set',
      'settings-catalog-subset'
    )
    FROM current_access
  $$,
  '22023',
  'Featured beneficiaries must be a subset of selected beneficiaries',
  'beneficiary replacement rejects a featured ID outside the chosen set'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_beneficiaries(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      current_access.advocate_version,
      'all',
      ARRAY['a3000000-0000-4000-8000-000000000001']::uuid[],
      ARRAY[]::uuid[],
      'Attempt ignored rows in all mode',
      'settings-catalog-all-shape'
    )
    FROM current_access
  $$,
  '22023',
  'All mode does not accept stored beneficiary selections',
  'all mode requires both beneficiary arrays to be empty'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_beneficiaries(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      current_access.advocate_version,
      'all_featured',
      ARRAY[
        'a3000000-0000-4000-8000-000000000001',
        'a3000000-0000-4000-8000-000000000002'
      ]::uuid[],
      ARRAY['a3000000-0000-4000-8000-000000000001']::uuid[],
      'Attempt incomplete featured set',
      'settings-catalog-featured-shape'
    )
    FROM current_access
  $$,
  '22023',
  'All featured mode requires one or more chosen beneficiaries and every chosen beneficiary must be featured',
  'all featured mode requires every chosen beneficiary to be featured'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_beneficiaries(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      current_access.advocate_version,
      'selected',
      ARRAY[]::uuid[],
      ARRAY[]::uuid[],
      'Attempt an empty selected catalog',
      'settings-catalog-selected-empty'
    )
    FROM current_access
  $$,
  '22023',
  'Selected mode requires at least one chosen beneficiary',
  'selected mode requires at least one chosen beneficiary'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_beneficiaries(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      current_access.advocate_version,
      'selected',
      ARRAY['a3000000-0000-4000-8000-000000000004']::uuid[],
      ARRAY[]::uuid[],
      'Attempt to select an ineligible child',
      'settings-catalog-ineligible'
    )
    FROM current_access
  $$,
  '23514',
  'Every configured beneficiary must currently be eligible for the advocate child catalog',
  'beneficiary replacement rejects a child outside the shared advocate eligibility boundary'
);

SELECT extensions.is(
  (
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_beneficiaries(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      current_access.advocate_version,
      'selected',
      ARRAY[
        'a3000000-0000-4000-8000-000000000003',
        'a3000000-0000-4000-8000-000000000001',
        'a3000000-0000-4000-8000-000000000002'
      ]::uuid[],
      ARRAY[
        'a3000000-0000-4000-8000-000000000003',
        'a3000000-0000-4000-8000-000000000002'
      ]::uuid[],
      'Choose the approved beneficiary catalog',
      'settings-catalog-success',
      'settings-catalog-trace',
      'settings-catalog-session'
    ) - current_access.advocate_version
    FROM current_access
  ),
  1::bigint,
  'a permitted beneficiary replacement advances the aggregate advocate version exactly once'
);

SELECT extensions.is(
  public.get_advocate_admin_settings(
    'a0000000-0000-4000-8000-000000000001'
  ) -> 'beneficiary_selections',
  jsonb_build_array(
    jsonb_build_object(
      'beneficiary_id', 'a3000000-0000-4000-8000-000000000003'::uuid,
      'is_featured', true,
      'display_order', 0
    ),
    jsonb_build_object(
      'beneficiary_id', 'a3000000-0000-4000-8000-000000000001'::uuid,
      'is_featured', false,
      'display_order', 1
    ),
    jsonb_build_object(
      'beneficiary_id', 'a3000000-0000-4000-8000-000000000002'::uuid,
      'is_featured', true,
      'display_order', 2
    )
  ),
  'the settings snapshot preserves ordered selection and featured subset semantics'
);

SELECT extensions.is(
  public.get_advocate_admin_settings(
    'a0000000-0000-4000-8000-000000000001'
  ) #>> '{advocate,beneficiary_mode}',
  'selected',
  'beneficiary replacement updates mode in the same aggregate version transaction'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_update_advocate_branding(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      current_access.advocate_version,
      '#123456',
      '#ABCDEF',
      NULL,
      NULL,
      NULL,
      '<h2>Catalog editor</h2>',
      '<p>Catalog editor</p>',
      'Catalog editors cannot change branding',
      'settings-branding-catalog-denied'
    )
    FROM current_access
  $$,
  '42501',
  'Insufficient portal permission',
  'the Catalog Curator cannot mutate branding'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000005',
  true
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_public_metrics(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000005',
      current_access.advocate_version,
      ARRAY[]::public.advocate_public_metric_key[],
      'Analytics viewers cannot configure public metrics',
      'settings-metrics-analytics-denied'
    )
    FROM current_access
  $$,
  '42501',
  'Insufficient portal permission',
  'the Analytics Viewer cannot mutate public metric configuration'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000006',
  true
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_replace_advocate_public_metrics(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000006',
      current_access.advocate_version,
      ARRAY[]::public.advocate_public_metric_key[],
      'Audit viewers cannot configure public metrics',
      'settings-metrics-audit-denied'
    )
    FROM current_access
  $$,
  '42501',
  'Insufficient portal permission',
  'the Audit Viewer cannot mutate public metric configuration'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id =
        'a0000000-0000-4000-8000-000000000001'
      AND event.table_name = 'advocate_branding'
      AND event.operation = 'UPDATE'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        'a1000000-0000-4000-8000-000000000003'
      AND event.tool = 'advocate-portal-branding'
      AND event.request_id = 'settings-branding-success'
      AND event.trace_id = 'settings-branding-trace'
      AND event.session_id = 'settings-branding-session'
      AND event.reason = 'Publish the approved advocate branding'
      AND event.changed_columns @> ARRAY[
        'primary_color',
        'accent_color',
        'logo_storage_path',
        'logo_alt_text',
        'opening_header_html',
        'about_biography_html'
      ]::text[]
      AND event.before_data IS NULL
      AND event.after_data IS NULL
      AND event.metadata ->> 'operation' = 'update_branding'
      AND event.metadata ->> 'permission_key' = 'portal.branding.update'
  ),
  'branding audit records actor, tool, request, trace, session, reason, and changed columns without row images'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE concat_ws(
      ' ',
      event.before_data::text,
      event.after_data::text,
      event.metadata::text
    ) LIKE '%Admin settings biography marker%'
  ),
  'the indefinite audit ledger does not copy advocate rich text content'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id =
        'a0000000-0000-4000-8000-000000000001'
      AND event.table_name = 'advocate_public_metric_selections'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        'a1000000-0000-4000-8000-000000000003'
      AND event.tool = 'advocate-portal-public-metrics'
      AND event.request_id = 'settings-metrics-success'
      AND event.trace_id = 'settings-metrics-trace'
      AND event.session_id = 'settings-metrics-session'
      AND event.reason = 'Choose the approved public metrics'
      AND event.metadata ->> 'permission_key' =
        'portal.public_metrics.update'
  ),
  'public metric replacement retains complete safe audit context'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id =
        'a0000000-0000-4000-8000-000000000001'
      AND event.table_name = 'advocate_beneficiaries'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        'a1000000-0000-4000-8000-000000000004'
      AND event.tool = 'advocate-portal-beneficiaries'
      AND event.request_id = 'settings-catalog-success'
      AND event.trace_id = 'settings-catalog-trace'
      AND event.session_id = 'settings-catalog-session'
      AND event.reason = 'Choose the approved beneficiary catalog'
      AND event.metadata ->> 'permission_key' =
        'portal.beneficiaries.manage'
  ),
  'beneficiary replacement retains complete safe audit context'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.request_id = 'settings-branding-success'
      AND disclosed.event_key = 'branding.updated'
      AND disclosed.areas = ARRAY[
        'about',
        'colors',
        'logo',
        'opening_header'
      ]::text[]
      AND disclosed.actor_kind = 'portal_member'
      AND disclosed.actor_display_name = 'Settings B.'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  )
  AND EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.request_id = 'settings-metrics-success'
      AND disclosed.event_key = 'public_metrics.updated'
      AND disclosed.areas = ARRAY['public_metric_selection']::text[]
      AND disclosed.actor_kind = 'portal_member'
      AND disclosed.actor_display_name = 'Settings B.'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  )
  AND EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.request_id = 'settings-catalog-success'
      AND disclosed.event_key = 'catalog.updated'
      AND disclosed.areas = ARRAY[
        'catalog_mode',
        'catalog_order',
        'catalog_selection'
      ]::text[]
      AND disclosed.actor_kind = 'portal_member'
      AND disclosed.actor_display_name = 'Settings C.'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  ),
  'real branding, public metric, and catalog commands emit exact privacy-safe configuration events'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id =
        'a0000000-0000-4000-8000-000000000001'
      AND event.table_name = 'advocates'
      AND event.request_id IN (
        'settings-branding-success',
        'settings-metrics-success',
        'settings-catalog-success'
      )
      AND event.changed_columns @> ARRAY['version']::text[]
  ),
  'configuration mutations audit the aggregate advocate version advance'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000007',
  true
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.get_my_advocate_portal_access()),
  0,
  'a suspended membership receives no portal access row'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_admin_settings(
      'a0000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a suspended membership cannot read the portal settings snapshot'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000008',
  true
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.get_my_advocate_portal_access()),
  0,
  'a revoked membership receives no portal access row'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_admin_settings(
      'a0000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a revoked membership cannot read the portal settings snapshot'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

UPDATE public.advocates
SET relationship_status = 'suspended'
WHERE id = 'a0000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000003',
  true
);

SELECT extensions.ok(
  (
    SELECT access.relationship_status = 'suspended'
      AND access.publication_status = 'suspended'
    FROM public.get_my_advocate_portal_access() access
  )
  AND public.get_advocate_admin_settings(
    'a0000000-0000-4000-8000-000000000001'
  ) IS NOT NULL,
  'an active member can inspect a suspended portal for support and audit'
);

SELECT extensions.throws_ok(
  $$
    WITH current_access AS MATERIALIZED (
      SELECT advocate_version
      FROM public.get_my_advocate_portal_access()
    )
    SELECT pg_temp.call_service_update_advocate_branding(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      current_access.advocate_version,
      '#123456',
      '#ABCDEF',
      NULL,
      NULL,
      NULL,
      '<h2>Suspended</h2>',
      '<p>Suspended</p>',
      'Suspended portals cannot mutate branding',
      'settings-branding-suspended'
    )
    FROM current_access
  $$,
  '42501',
  'Insufficient portal permission',
  'a suspended portal rejects configuration mutations'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

UPDATE public.advocates
SET
  relationship_status = 'active',
  publication_status = 'draft'
WHERE id = 'a0000000-0000-4000-8000-000000000001';

UPDATE public.advocates
SET relationship_status = 'archived'
WHERE id = 'a0000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.get_my_advocate_portal_access()),
  0,
  'an archived advocate is removed from owner portal access discovery'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.get_advocate_admin_settings(
      'a0000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'an archived advocate settings snapshot is closed even to its owner'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.call_service_update_advocate_branding(
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      1,
      '#123456',
      '#ABCDEF',
      NULL,
      NULL,
      NULL,
      '<h2>Archived</h2>',
      '<p>Archived</p>',
      'Archived portals cannot mutate branding',
      'settings-branding-archived'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'an archived advocate rejects configuration mutations before version comparison'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT * FROM extensions.finish();

ROLLBACK;
