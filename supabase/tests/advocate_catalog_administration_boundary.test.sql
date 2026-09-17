BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  to_regprocedure(
    'public.replace_advocate_beneficiary_configuration(uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text)'
  ) IS NULL
  AND to_regprocedure(
    'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)'
  ) IS NOT NULL,
  'the browser-callable beneficiary replacement is gone and the actor-aware application boundary exists'
);

SELECT extensions.ok(
  (
    SELECT routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.prorettype = 'jsonb'::regtype
      AND routine.proargnames = ARRAY[
        'target_advocate_id',
        'acting_user_id'
      ]::text[]
      AND coalesce(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.read_advocate_catalog_administration(uuid,uuid)'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.prorettype = 'int8'::regtype
      AND routine.proargnames = ARRAY[
        'target_advocate_id',
        'acting_user_id',
        'expected_advocate_version',
        'target_beneficiary_mode',
        'target_beneficiary_ids',
        'target_featured_beneficiary_ids',
        'change_reason',
        'request_id',
        'trace_id',
        'session_id',
        'client_ip',
        'user_agent'
      ]::text[]
      AND coalesce(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)'::regprocedure
  ),
  'both catalog administration RPCs have fixed security-definer contracts'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.read_advocate_catalog_administration(uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.read_advocate_catalog_administration(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.read_advocate_catalog_administration(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges privilege
    WHERE privilege.routine_schema = 'public'
      AND privilege.routine_name IN (
        'read_advocate_catalog_administration',
        'replace_advocate_beneficiary_configuration'
      )
      AND privilege.grantee = 'PUBLIC'
      AND privilege.privilege_type = 'EXECUTE'
  ),
  'only the service role can execute either public catalog administration RPC'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'private.require_advocate_catalog_service_role()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.require_advocate_catalog_service_role()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.require_advocate_catalog_service_role()',
    'EXECUTE'
  )
  AND position(
    'auth.role()' IN pg_get_functiondef(
      'private.require_advocate_catalog_service_role()'::regprocedure
    )
  ) > 0
  AND position(
    'request.jwt.claim.role' IN pg_get_functiondef(
      'private.require_advocate_catalog_service_role()'::regprocedure
    )
  ) = 0,
  'the private guard is uncallable by API roles and uses the PostgREST-compatible role resolver'
);

SELECT extensions.ok(
  NOT has_table_privilege(
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
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_beneficiaries',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_beneficiaries',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_beneficiaries',
    'DELETE'
  ),
  'the migration does not create a direct table-mutation bypass'
);

SELECT extensions.ok(
  (
    SELECT catalog_table.relrowsecurity
    FROM pg_class catalog_table
    WHERE catalog_table.oid = 'public.advocate_beneficiaries'::regclass
  )
  AND position(
    'FOR SHARE OF membership_role, role_permission, permission' IN
      pg_get_functiondef(
        'public.read_advocate_catalog_administration(uuid,uuid)'::regprocedure
      )
  ) > 0
  AND position(
    'FOR SHARE OF membership_role, role_permission, permission' IN
      pg_get_functiondef(
        'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)'::regprocedure
      )
  ) > 0
  AND position(
    'FOR SHARE' IN pg_get_functiondef(
      'public.replace_advocate_beneficiary_configuration(uuid,uuid,bigint,public.advocate_beneficiary_mode,uuid[],uuid[],text,text,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'RLS remains enabled and both RPCs lock exact permission evidence while mutations also lock beneficiary eligibility'
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  banned_until,
  deleted_at,
  created_at,
  updated_at
)
VALUES
  (
    'ca100000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'catalog-curator@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    NULL,
    NULL,
    now(),
    now()
  ),
  (
    'ca100000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'catalog-brand-only@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    NULL,
    NULL,
    now(),
    now()
  ),
  (
    'ca100000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'catalog-suspended@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    NULL,
    NULL,
    now(),
    now()
  ),
  (
    'ca100000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'catalog-unconfirmed@example.test',
    NULL,
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    NULL,
    NULL,
    now(),
    now()
  ),
  (
    'ca100000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'catalog-anonymous@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now(),
    now()
  ),
  (
    'ca100000-0000-4000-8000-000000000006',
    'authenticated',
    'authenticated',
    'catalog-banned@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    now() + interval '1 day',
    NULL,
    now(),
    now()
  ),
  (
    'ca100000-0000-4000-8000-000000000007',
    'authenticated',
    'authenticated',
    'catalog-deleted@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    NULL,
    now(),
    now(),
    now()
  ),
  (
    'ca100000-0000-4000-8000-000000000008',
    'authenticated',
    'authenticated',
    'catalog-other-owner@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    NULL,
    NULL,
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
    'ca000000-0000-4000-8000-000000000001',
    'catalogboundarya',
    'Catalog Boundary A',
    'active',
    'draft',
    'selected'
  ),
  (
    'ca000000-0000-4000-8000-000000000002',
    'catalogboundaryb',
    'Catalog Boundary B',
    'active',
    'draft',
    'all'
  );

INSERT INTO public.advocate_memberships (
  id,
  advocate_id,
  user_id,
  status,
  suspended_at
)
VALUES
  (
    'ca200000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'active',
    NULL
  ),
  (
    'ca200000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000002',
    'active',
    NULL
  ),
  (
    'ca200000-0000-4000-8000-000000000003',
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000003',
    'suspended',
    now()
  ),
  (
    'ca200000-0000-4000-8000-000000000004',
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000004',
    'active',
    NULL
  ),
  (
    'ca200000-0000-4000-8000-000000000005',
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000005',
    'active',
    NULL
  ),
  (
    'ca200000-0000-4000-8000-000000000006',
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000006',
    'active',
    NULL
  ),
  (
    'ca200000-0000-4000-8000-000000000007',
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000007',
    'active',
    NULL
  ),
  (
    'ca200000-0000-4000-8000-000000000008',
    'ca000000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000008',
    'active',
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
    'ca000000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    'ca100000-0000-4000-8000-000000000001'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    'ca100000-0000-4000-8000-000000000001'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000004',
    'ca100000-0000-4000-8000-000000000001'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000004',
    'ca100000-0000-4000-8000-000000000001'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000004',
    'ca100000-0000-4000-8000-000000000001'
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000004',
    'ca100000-0000-4000-8000-000000000001'
  ),
  (
    'ca000000-0000-4000-8000-000000000002',
    'ca200000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000008'
  );

UPDATE public.advocates
SET owner_membership_id = CASE id
  WHEN 'ca000000-0000-4000-8000-000000000001'::uuid
    THEN 'ca200000-0000-4000-8000-000000000001'::uuid
  ELSE 'ca200000-0000-4000-8000-000000000008'::uuid
END
WHERE id IN (
  'ca000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000002'
);

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
    'ca300000-0000-4000-8000-000000000001',
    'alpha Child',
    'catalog-alpha',
    '2012-01-01',
    5000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    'ca300000-0000-4000-8000-000000000002',
    'Alpha Child',
    'catalog-alpha-uppercase',
    '2013-01-01',
    6000,
    'Partially Funded',
    'IN_OUR_CARE',
    NULL
  ),
  (
    'ca300000-0000-4000-8000-000000000003',
    'Beta Child',
    'catalog-beta',
    '2014-01-01',
    -1,
    'Sponsorship Cancelled',
    'IN_OUR_CARE',
    NULL
  ),
  (
    'ca300000-0000-4000-8000-000000000004',
    'Former Selected Child',
    'catalog-former-selected',
    '2015-01-01',
    7000,
    'Draft',
    'IN_OUR_CARE',
    NULL
  ),
  (
    'ca300000-0000-4000-8000-000000000005',
    'Unselected Draft Child',
    'catalog-unselected-draft',
    '2016-01-01',
    8000,
    'Draft',
    'IN_OUR_CARE',
    NULL
  );

INSERT INTO public.beneficiaries (
  id,
  name,
  username,
  biography,
  birth_date,
  budget_goal,
  status,
  beneficiary_type,
  goal_fulfilled_at
)
VALUES
  (
    'ca300000-0000-4000-8000-000000000006',
    'Unsafe Selected Child',
    'catalog-unsafe-selected',
    E'Unsafe\001biography',
    '2014-01-01',
    5000,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    'ca300000-0000-4000-8000-000000000008',
    'Hidden Animal',
    'catalog-hidden-animal',
    NULL,
    '2020-01-01',
    -1,
    'New',
    'ANIMAL',
    NULL
  );

ALTER TABLE public.beneficiaries
DISABLE TRIGGER beneficiary_username_public_shape_guard;

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
VALUES (
  'ca300000-0000-4000-8000-000000000007',
  'Unsafe Unselected Child',
  E'catalog\nunsafe-unselected',
  '2014-01-01',
  5000,
  'New',
  'IN_OUR_CARE',
  NULL
);

ALTER TABLE public.beneficiaries
ENABLE TRIGGER beneficiary_username_public_shape_guard;

INSERT INTO public.advocate_beneficiaries (
  advocate_id,
  beneficiary_id,
  is_featured,
  display_order
)
VALUES
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000004',
    false,
    0
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000003',
    true,
    1
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000006',
    false,
    2
  ),
  (
    'ca000000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000008',
    false,
    3
  );

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"ca100000-0000-4000-8000-000000000001"}',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Advocate catalog RPCs require the service role',
  'a presented browser role cannot cross the catalog service guard even under a privileged SQL session'
);

SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

SET LOCAL ROLE service_role;

SELECT extensions.lives_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001'
    )
  $$,
  'a consolidated PostgREST service-role claim crosses the catalog boundary'
);

SELECT extensions.is(
  (
    SELECT array_agg(key ORDER BY key)
    FROM jsonb_object_keys(
      public.read_advocate_catalog_administration(
        'ca000000-0000-4000-8000-000000000001',
        'ca100000-0000-4000-8000-000000000001'
      )
    ) key
  ),
  ARRAY[
    'advocate_version',
    'beneficiaries',
    'beneficiary_mode',
    'beneficiary_selections',
    'selection_limit'
  ]::text[],
  'the catalog response has exactly the single-snapshot application contract keys'
);

SELECT extensions.is(
  public.read_advocate_catalog_administration(
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001'
  ) -> 'selection_limit',
  '1000'::jsonb,
  'the catalog response publishes the exact 1000-selection limit'
);

SELECT extensions.ok(
  (
    SELECT
      (result ->> 'advocate_version')::bigint = advocate.version
      AND result ->> 'beneficiary_mode' = advocate.beneficiary_mode::text
      AND result -> 'beneficiary_selections' = jsonb_build_array(
        jsonb_build_object(
          'beneficiary_id',
          'ca300000-0000-4000-8000-000000000004'::uuid,
          'is_featured', false
        ),
        jsonb_build_object(
          'beneficiary_id',
          'ca300000-0000-4000-8000-000000000003'::uuid,
          'is_featured', true
        ),
        jsonb_build_object(
          'beneficiary_id',
          'ca300000-0000-4000-8000-000000000006'::uuid,
          'is_featured', false
        ),
        jsonb_build_object(
          'beneficiary_id',
          'ca300000-0000-4000-8000-000000000008'::uuid,
          'is_featured', false
        )
      )
    FROM public.advocates advocate
    CROSS JOIN LATERAL public.read_advocate_catalog_administration(
      advocate.id,
      'ca100000-0000-4000-8000-000000000001'
    ) AS response(result)
    WHERE advocate.id = 'ca000000-0000-4000-8000-000000000001'
  ),
  'version, mode, and exact ordered selections come from the same actor-aware database snapshot as the choices'
);

SELECT extensions.is(
  (
    SELECT array_agg(DISTINCT key ORDER BY key)
    FROM jsonb_array_elements(
      public.read_advocate_catalog_administration(
        'ca000000-0000-4000-8000-000000000001',
        'ca100000-0000-4000-8000-000000000001'
      ) -> 'beneficiaries'
    ) row_value
    CROSS JOIN LATERAL jsonb_object_keys(row_value) key
  ),
  ARRAY[
    'blocked_reason',
    'eligible',
    'id',
    'name',
    'status',
    'username'
  ]::text[],
  'every beneficiary choice exposes only the bounded administration fields'
);

SELECT extensions.is(
  public.read_advocate_catalog_administration(
    'ca000000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001'
  ) -> 'beneficiaries',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000002'::uuid,
      'name', 'Alpha Child',
      'username', 'catalog-alpha-uppercase',
      'status', 'Partially Funded',
      'eligible', true,
      'blocked_reason', NULL
    ),
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000001'::uuid,
      'name', 'alpha Child',
      'username', 'catalog-alpha',
      'status', 'New',
      'eligible', true,
      'blocked_reason', NULL
    ),
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000003'::uuid,
      'name', 'Beta Child',
      'username', 'catalog-beta',
      'status', 'Sponsorship Cancelled',
      'eligible', true,
      'blocked_reason', NULL
    ),
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000004'::uuid,
      'name', NULL,
      'username', NULL,
      'status', NULL,
      'eligible', false,
      'blocked_reason', 'unavailable'
    ),
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000006'::uuid,
      'name', NULL,
      'username', NULL,
      'status', NULL,
      'eligible', false,
      'blocked_reason', 'unavailable'
    ),
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000008'::uuid,
      'name', NULL,
      'username', NULL,
      'status', NULL,
      'eligible', false,
      'blocked_reason', 'unavailable'
    )
  ),
  'choices use deterministic case-folded name ordering, keep every ineligible selected repair record opaque, and omit unrelated unsafe rows'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000002',
      'ca100000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'an authorized curator cannot read another tenant catalog'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'an active delegate without the exact beneficiary permission cannot read choices'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a suspended curator cannot read choices'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000004'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'an unconfirmed account cannot read choices'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000005'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'an anonymous account cannot read choices'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000006'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a banned account cannot read choices'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000007'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a deleted account cannot read choices'
);

RESET ROLE;

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000002',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'all',
      ARRAY[]::uuid[],
      ARRAY[]::uuid[],
      'Brand-only delegates cannot replace the catalog',
      'catalog-brand-denied'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a delegate without the exact permission cannot replace the catalog'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000002',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000002'),
      'all',
      ARRAY[]::uuid[],
      ARRAY[]::uuid[],
      'Cross-tenant replacement must fail',
      'catalog-cross-tenant'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'an authorized curator cannot replace another tenant catalog'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000004',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'all',
      ARRAY[]::uuid[],
      ARRAY[]::uuid[],
      'Unconfirmed actors cannot replace the catalog',
      'catalog-unconfirmed-denied'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'an unconfirmed account cannot replace the catalog even with a matching active membership and role'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000003',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'all',
      ARRAY[]::uuid[],
      ARRAY[]::uuid[],
      'Suspended delegates cannot replace the catalog',
      'catalog-suspended-denied'
    )
  $$,
  '42501',
  'Insufficient portal permission',
  'a suspended membership cannot replace the catalog'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      ARRAY['ca300000-0000-4000-8000-000000000001']::uuid[],
      ARRAY['ca300000-0000-4000-8000-000000000003']::uuid[],
      'Featured rows must remain selected',
      'catalog-feature-subset'
    )
  $$,
  '22023',
  'Featured beneficiaries must be a subset of selected beneficiaries',
  'featured IDs must be a subset of selected IDs'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'all',
      ARRAY['ca300000-0000-4000-8000-000000000001']::uuid[],
      ARRAY[]::uuid[],
      'All mode stores no chosen rows',
      'catalog-all-invariant'
    )
  $$,
  '22023',
  'All mode does not accept stored beneficiary selections',
  'all mode requires both arrays to be empty'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'all_featured',
      ARRAY[
        'ca300000-0000-4000-8000-000000000001',
        'ca300000-0000-4000-8000-000000000002'
      ]::uuid[],
      ARRAY[
        'ca300000-0000-4000-8000-000000000002'
      ]::uuid[],
      'Every all-featured choice must be featured',
      'catalog-featured-set-invariant'
    )
  $$,
  '22023',
  'All featured mode requires one or more chosen beneficiaries and every chosen beneficiary must be featured',
  'all-featured mode requires every nonempty selected ID to be featured'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      ARRAY[]::uuid[],
      ARRAY[]::uuid[],
      'Selected mode needs choices',
      'catalog-selected-invariant'
    )
  $$,
  '22023',
  'Selected mode requires at least one chosen beneficiary',
  'selected mode requires at least one chosen row'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      ARRAY[
        'ca300000-0000-4000-8000-000000000001',
        'ca300000-0000-4000-8000-000000000001'
      ]::uuid[],
      ARRAY[]::uuid[],
      'Duplicate choices are malformed',
      'catalog-duplicate'
    )
  $$,
  '22023',
  'Beneficiary configuration requires at most 1000 ordered unique nonnull IDs',
  'selected and featured arrays must be unique and nonnull'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      (
        SELECT array_agg(md5('catalog-limit-' || ordinal::text)::uuid ORDER BY ordinal)
        FROM generate_series(1, 1001) ordinal
      ),
      ARRAY[]::uuid[],
      'Oversized choices are malformed',
      'catalog-selection-limit'
    )
  $$,
  '22023',
  'Beneficiary configuration requires at most 1000 ordered unique nonnull IDs',
  'the mutation rejects more than 1000 selected IDs before eligibility work'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      ARRAY['ca300000-0000-4000-8000-000000000001']::uuid[],
      ARRAY[]::uuid[],
      E'Invalid\nreason',
      'catalog-reason-controls'
    )
  $$,
  '22023',
  'A beneficiary configuration reason between 1 and 500 characters without control characters is required',
  'change reasons reject control characters'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      ARRAY['ca300000-0000-4000-8000-000000000001']::uuid[],
      ARRAY[]::uuid[],
      'A server request ID is mandatory',
      ' '
    )
  $$,
  '22023',
  'Beneficiary audit identifiers are malformed',
  'the service must supply a nonblank bounded request ID'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      ARRAY['ca300000-0000-4000-8000-000000000006']::uuid[],
      ARRAY[]::uuid[],
      'Unsafe public projections cannot be selected',
      'catalog-unsafe-projection'
    )
  $$,
  '23514',
  'Every configured beneficiary must currently be eligible for the advocate child catalog',
  'the mutation rejects a canonically sponsorable child whose complete public projection is unsafe'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      ARRAY['ca300000-0000-4000-8000-000000000008']::uuid[],
      ARRAY[]::uuid[],
      'Nonchild rows cannot be selected',
      'catalog-nonchild'
    )
  $$,
  '23514',
  'Every configured beneficiary must currently be eligible for the advocate child catalog',
  'the mutation rejects a canonically sponsorable animal outside the advocate child type boundary'
);

CREATE TEMP TABLE catalog_before_invalid
ON COMMIT DROP
AS
SELECT
  advocate.version,
  advocate.beneficiary_mode,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', selection.beneficiary_id,
        'featured', selection.is_featured,
        'order', selection.display_order
      )
      ORDER BY selection.display_order
    ) FILTER (WHERE selection.beneficiary_id IS NOT NULL),
    '[]'::jsonb
  ) AS selections
FROM public.advocates advocate
LEFT JOIN public.advocate_beneficiaries selection
  ON selection.advocate_id = advocate.id
WHERE advocate.id = 'ca000000-0000-4000-8000-000000000001'
GROUP BY advocate.version, advocate.beneficiary_mode;

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'selected',
      ARRAY['ca300000-0000-4000-8000-000000000005']::uuid[],
      ARRAY[]::uuid[],
      'A draft child cannot become selectable',
      'catalog-ineligible'
    )
  $$,
  '23514',
  'Every configured beneficiary must currently be eligible for the advocate child catalog',
  'the mutation rechecks the complete advocate child eligibility boundary under beneficiary row locks'
);

SELECT extensions.ok(
  (
    SELECT
      advocate.version = before.version
      AND advocate.beneficiary_mode = before.beneficiary_mode
      AND coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', selection.beneficiary_id,
            'featured', selection.is_featured,
            'order', selection.display_order
          )
          ORDER BY selection.display_order
        ) FILTER (WHERE selection.beneficiary_id IS NOT NULL),
        '[]'::jsonb
      ) = before.selections
    FROM public.advocates advocate
    LEFT JOIN public.advocate_beneficiaries selection
      ON selection.advocate_id = advocate.id
    CROSS JOIN catalog_before_invalid before
    WHERE advocate.id = 'ca000000-0000-4000-8000-000000000001'
    GROUP BY
      advocate.version,
      advocate.beneficiary_mode,
      before.version,
      before.beneficiary_mode,
      before.selections
  ),
  'a rejected canonical eligibility check leaves mode, ordered rows, featured flags, and aggregate version untouched'
);

SELECT extensions.is(
  (
    WITH before AS MATERIALIZED (
      SELECT version
      FROM public.advocates
      WHERE id = 'ca000000-0000-4000-8000-000000000001'
    )
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      before.version,
      'selected',
      ARRAY[
        'ca300000-0000-4000-8000-000000000003',
        'ca300000-0000-4000-8000-000000000001',
        'ca300000-0000-4000-8000-000000000002'
      ]::uuid[],
      ARRAY[
        'ca300000-0000-4000-8000-000000000002',
        'ca300000-0000-4000-8000-000000000003'
      ]::uuid[],
      'Publish the approved ordered beneficiary catalog',
      'catalog-success-request',
      'catalog-success-trace',
      'catalog-success-session',
      '203.0.113.44',
      'Catalog administration test agent'
    ) - before.version
    FROM before
  ),
  1::bigint,
  'a successful complete replacement advances the advocate version exactly once'
);

SELECT extensions.is(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', selection.beneficiary_id,
        'featured', selection.is_featured,
        'order', selection.display_order
      )
      ORDER BY selection.display_order
    )
    FROM public.advocate_beneficiaries selection
    WHERE selection.advocate_id =
      'ca000000-0000-4000-8000-000000000001'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000003'::uuid,
      'featured', true,
      'order', 0
    ),
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000001'::uuid,
      'featured', false,
      'order', 1
    ),
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000002'::uuid,
      'featured', true,
      'order', 2
    )
  ),
  'complete replacement preserves exact submitted order and featured subset while removing prior rows'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = 'ca000000-0000-4000-8000-000000000001'
      AND event.request_id = 'catalog-success-request'
      AND event.trace_id = 'catalog-success-trace'
      AND event.session_id = 'catalog-success-session'
      AND event.actor_type = 'user'
      AND event.actor_user_id = 'ca100000-0000-4000-8000-000000000001'
      AND event.tool = 'advocate-portal-beneficiaries'
      AND event.reason = 'Publish the approved ordered beneficiary catalog'
      AND event.metadata = jsonb_build_object(
        'operation', 'replace_beneficiaries',
        'resource_kind', 'advocate_beneficiaries',
        'resource_id', 'ca000000-0000-4000-8000-000000000001',
        'permission_key', 'portal.beneficiaries.manage'
      )
      AND event.table_name IN ('advocate_beneficiaries', 'advocates')
  ),
  'row audit records retain the exact actor, tool, request, trace, session, reason, and allowlisted metadata context'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN audit.audit_event_forensics forensics
      ON forensics.audit_event_id = event.id
    WHERE event.advocate_id = 'ca000000-0000-4000-8000-000000000001'
      AND event.request_id = 'catalog-success-request'
      AND forensics.client_ip = '203.0.113.44'
      AND forensics.user_agent = 'Catalog administration test agent'
      AND forensics.expires_at = forensics.captured_at + interval '90 days'
  ),
  'server-supplied IP and user-agent evidence is isolated in the exact 90-day forensic layer'
);

CREATE TEMP TABLE catalog_before_noop
ON COMMIT DROP
AS
SELECT version
FROM public.advocates
WHERE id = 'ca000000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version FROM catalog_before_noop),
      'selected',
      ARRAY[
        'ca300000-0000-4000-8000-000000000003',
        'ca300000-0000-4000-8000-000000000001',
        'ca300000-0000-4000-8000-000000000002'
      ]::uuid[],
      ARRAY[
        'ca300000-0000-4000-8000-000000000002',
        'ca300000-0000-4000-8000-000000000003'
      ]::uuid[],
      'Do not memorialize an exact no-op',
      'catalog-no-op'
    )
  $$,
  '22023',
  'Advocate beneficiary configuration is unchanged',
  'an exact mode and selection-order no-op is rejected even when the equivalent featured set arrives in another order'
);

SELECT extensions.is(
  (
    SELECT version
    FROM public.advocates
    WHERE id = 'ca000000-0000-4000-8000-000000000001'
  ),
  (SELECT version FROM catalog_before_noop),
  'no-op rejection does not advance the aggregate version'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      (SELECT version - 1 FROM public.advocates WHERE id = 'ca000000-0000-4000-8000-000000000001'),
      'all',
      ARRAY[]::uuid[],
      ARRAY[]::uuid[],
      'Stale writers must refresh',
      'catalog-version-conflict'
    )
  $$,
  '40001',
  'Advocate settings changed; refresh and retry',
  'optimistic concurrency rejects a stale aggregate version before mutation'
);

SELECT extensions.is(
  (
    WITH before AS MATERIALIZED (
      SELECT version
      FROM public.advocates
      WHERE id = 'ca000000-0000-4000-8000-000000000001'
    )
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      before.version,
      'all',
      ARRAY[]::uuid[],
      ARRAY[]::uuid[],
      'Return this portal to the complete catalog',
      'catalog-all-success'
    ) - before.version
    FROM before
  ),
  1::bigint,
  'all mode atomically clears every stored selection and advances one version'
);

SELECT extensions.ok(
  (
    SELECT beneficiary_mode = 'all'
    FROM public.advocates
    WHERE id = 'ca000000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_beneficiaries selection
    WHERE selection.advocate_id =
      'ca000000-0000-4000-8000-000000000001'
  ),
  'all mode retains no ignored selected or featured rows'
);

SELECT extensions.is(
  (
    WITH before AS MATERIALIZED (
      SELECT version
      FROM public.advocates
      WHERE id = 'ca000000-0000-4000-8000-000000000001'
    )
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      before.version,
      'all_featured',
      ARRAY[
        'ca300000-0000-4000-8000-000000000002',
        'ca300000-0000-4000-8000-000000000003'
      ]::uuid[],
      ARRAY[
        'ca300000-0000-4000-8000-000000000002',
        'ca300000-0000-4000-8000-000000000003'
      ]::uuid[],
      'Feature two choices while preserving the full eligible catalog',
      'catalog-all-featured-success'
    ) - before.version
    FROM before
  ),
  1::bigint,
  'all-featured mode accepts an identical nonempty ordered selection and feature list'
);

SELECT extensions.is(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', selection.beneficiary_id,
        'featured', selection.is_featured,
        'order', selection.display_order
      )
      ORDER BY selection.display_order
    )
    FROM public.advocate_beneficiaries selection
    WHERE selection.advocate_id =
      'ca000000-0000-4000-8000-000000000001'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000002'::uuid,
      'featured', true,
      'order', 0
    ),
    jsonb_build_object(
      'id', 'ca300000-0000-4000-8000-000000000003'::uuid,
      'featured', true,
      'order', 1
    )
  ),
  'all-featured mode stores every chosen row as featured in exact order'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.lives_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001'
    )
  $$,
  'the service guard retains legacy scalar claim compatibility'
);

CREATE TEMP TABLE catalog_eligible_baseline
ON COMMIT DROP
AS
SELECT count(*)::integer AS eligible_count
FROM public.beneficiaries beneficiary
WHERE private.is_advocate_child_eligible(
  beneficiary.status,
  beneficiary.budget_goal,
  beneficiary.goal_fulfilled_at,
  beneficiary.name,
  beneficiary.username,
  beneficiary.biography,
  beneficiary.country,
  beneficiary.location_str,
  beneficiary.video_url,
  beneficiary.introduction,
  beneficiary.beneficiary_type
);

SELECT extensions.ok(
  eligible_count BETWEEN 1 AND 1000,
  'the exact-limit fixture starts from a bounded nonempty eligible catalog'
)
FROM catalog_eligible_baseline;

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
SELECT
  md5('catalog-bounded-read-' || ordinal::text)::uuid,
  'Catalog Bounded Child ' || lpad(ordinal::text, 4, '0'),
  'catalog-bounded-' || ordinal::text,
  '2012-01-01'::date,
  5000,
  'New'::public."PersonStatus",
  'IN_OUR_CARE',
  NULL
FROM catalog_eligible_baseline baseline
CROSS JOIN LATERAL generate_series(
  1,
  1000 - baseline.eligible_count
) ordinal;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.beneficiaries beneficiary
    WHERE private.is_advocate_child_eligible(
      beneficiary.status,
      beneficiary.budget_goal,
      beneficiary.goal_fulfilled_at,
      beneficiary.name,
      beneficiary.username,
      beneficiary.biography,
      beneficiary.country,
      beneficiary.location_str,
      beneficiary.video_url,
      beneficiary.introduction,
      beneficiary.beneficiary_type
    )
  ),
  1000,
  'the exact-limit fixture produces exactly 1000 eligible advocate children'
);

SELECT extensions.is(
  (
    SELECT jsonb_array_length(result -> 'beneficiaries')
    FROM public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001'
    ) result
  ),
  1000,
  'the administration read returns the complete catalog at the exact 1000-choice boundary'
);

SELECT extensions.is(
  (
    WITH before AS MATERIALIZED (
      SELECT version
      FROM public.advocates
      WHERE id = 'ca000000-0000-4000-8000-000000000001'
    ), eligible AS MATERIALIZED (
      SELECT array_agg(beneficiary.id ORDER BY beneficiary.name, beneficiary.id) AS ids
      FROM public.beneficiaries beneficiary
      WHERE private.is_advocate_child_eligible(
        beneficiary.status,
        beneficiary.budget_goal,
        beneficiary.goal_fulfilled_at,
        beneficiary.name,
        beneficiary.username,
        beneficiary.biography,
        beneficiary.country,
        beneficiary.location_str,
        beneficiary.video_url,
        beneficiary.introduction,
        beneficiary.beneficiary_type
      )
    )
    SELECT public.replace_advocate_beneficiary_configuration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001',
      before.version,
      'selected',
      eligible.ids,
      ARRAY[]::uuid[],
      'Prove the exact 1000-child catalog mutation boundary',
      'catalog-exact-limit-success'
    ) - before.version
    FROM before
    CROSS JOIN eligible
  ),
  1::bigint,
  'the mutation accepts exactly 1000 ordered eligible child IDs and advances one version'
);

SELECT extensions.ok(
  (
    SELECT
      count(*) = 1000
      AND min(selection.display_order) = 0
      AND max(selection.display_order) = 999
      AND bool_and(NOT selection.is_featured)
    FROM public.advocate_beneficiaries selection
    WHERE selection.advocate_id =
      'ca000000-0000-4000-8000-000000000001'
  ),
  'the exact-limit mutation persists all 1000 rows with contiguous order and no invented featured state'
);

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
VALUES (
  md5('catalog-bounded-read-overflow')::uuid,
  'Catalog Bounded Overflow Child',
  'catalog-bounded-overflow',
  '2012-01-01',
  5000,
  'New',
  'IN_OUR_CARE',
  NULL
);

SELECT extensions.throws_ok(
  $$
    SELECT public.read_advocate_catalog_administration(
      'ca000000-0000-4000-8000-000000000001',
      'ca100000-0000-4000-8000-000000000001'
    )
  $$,
  '54000',
  'Eligible beneficiary catalog exceeds the administration boundary',
  'the read fails closed instead of truncating when more than 1000 eligible choices exist'
);

SELECT extensions.finish();

ROLLBACK;
