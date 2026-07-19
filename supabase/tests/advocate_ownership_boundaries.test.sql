BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(30);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.create_advocate_portal(uuid,text,text,text,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.transfer_advocate_ownership(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ),
  'ownership boundaries are security definer functions with fixed empty search paths'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_advocate_portal(uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.transfer_advocate_ownership(uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.create_advocate_portal(uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.create_advocate_portal(uuid,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.transfer_advocate_ownership(uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'only authenticated user sessions can enter the ownership boundaries'
);

SELECT extensions.ok(
  NOT has_table_privilege('service_role', 'public.advocates', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.advocates', 'DELETE')
  AND NOT has_column_privilege(
    'service_role',
    'public.advocates',
    'owner_membership_id',
    'UPDATE'
  ),
  'the service role cannot create, delete, or replace advocate owners directly'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'public.advocate_memberships',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_memberships',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_memberships',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_membership_roles',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_membership_roles',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_membership_roles',
    'DELETE'
  ),
  'the service role cannot bypass membership and owner role boundaries'
);

CREATE TEMP TABLE ownership_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
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
)
VALUES
  (
    '91000000-0000-4000-8000-000000000101'::uuid,
    'authenticated',
    'authenticated',
    'ownership-owner-a@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '91000000-0000-4000-8000-000000000102'::uuid,
    'authenticated',
    'authenticated',
    'ownership-delegate@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '91000000-0000-4000-8000-000000000103'::uuid,
    'authenticated',
    'authenticated',
    'ownership-owner-b@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '91000000-0000-4000-8000-000000000104'::uuid,
    'authenticated',
    'authenticated',
    'ownership-successor@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '91000000-0000-4000-8000-000000000105'::uuid,
    'authenticated',
    'authenticated',
    'ownership-unverified@example.test',
    NULL,
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '91000000-0000-4000-8000-000000000106'::uuid,
    'authenticated',
    'authenticated',
    'ownership-suspended@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.create_advocate_portal(
      '91000000-0000-4000-8000-000000000101'::uuid,
      'ownership-forbidden',
      'Forbidden Ownership Portal',
      'A delegate cannot create a tenant'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'ordinary authenticated users cannot create advocate tenants'
);

SELECT extensions.throws_ok(
  $$
    DO $body$
    BEGIN
      SET CONSTRAINTS advocates_owner_invariant IMMEDIATE;
      INSERT INTO public.advocates (
        slug,
        display_name,
        relationship_status,
        publication_status
      )
      VALUES (
        'ownership-ownerless-draft',
        'Ownerless Active Draft',
        'active',
        'draft'
      );
    END
    $body$
  $$,
  '23514',
  'An active advocate portal requires one active owner',
  'an active advocate relationship cannot remain ownerless even while draft'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

WITH created AS (
  SELECT public.create_advocate_portal(
    '91000000-0000-4000-8000-000000000101'::uuid,
    'ownership-a',
    'Ownership Portal A',
    'Create the primary ownership test tenant',
    'creator',
    'request-ownership-create-a',
    'trace-ownership-create-a',
    'session-ownership-create-a'
  ) AS id
)
INSERT INTO ownership_test_ids (key, value)
SELECT 'advocate_a', id FROM created;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocates advocate
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = advocate.id
    WHERE advocate.slug = 'ownership-a'
      AND advocate.display_name = 'Ownership Portal A'
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status = 'draft'
      AND advocate.created_by_user_id =
        '3de44111-9900-4f04-815d-aeb42828229a'::uuid
  ),
  'a Creator Share administrator creates an active draft tenant atomically'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocates advocate
    JOIN public.advocate_memberships membership
      ON membership.id = advocate.owner_membership_id
     AND membership.advocate_id = advocate.id
    JOIN public.advocate_membership_roles membership_role
      ON membership_role.advocate_id = advocate.id
     AND membership_role.membership_id = membership.id
     AND membership_role.role_id =
       '00000000-0000-4000-8000-000000000001'::uuid
    JOIN public.advocate_branding branding
      ON branding.advocate_id = advocate.id
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = advocate.id
    WHERE membership.user_id =
        '91000000-0000-4000-8000-000000000101'::uuid
      AND membership.status = 'active'
  ),
  'tenant creation includes default branding and one active owner membership'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.advocate_membership_roles membership_role
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = membership_role.advocate_id
    WHERE membership_role.role_id =
      '00000000-0000-4000-8000-000000000001'::uuid
  ),
  1,
  'tenant creation establishes exactly one owner role'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = event.advocate_id
    WHERE event.table_name = 'advocates'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        '3de44111-9900-4f04-815d-aeb42828229a'::uuid
      AND event.effective_user_id =
        '91000000-0000-4000-8000-000000000101'::uuid
      AND event.tool = 'creator-share-admin-advocates'
      AND event.request_id = 'request-ownership-create-a'
      AND event.trace_id = 'trace-ownership-create-a'
      AND event.session_id = 'session-ownership-create-a'
      AND event.reason = 'Create the primary ownership test tenant'
      AND event.metadata ->> 'operation' = 'create_portal'
      AND event.metadata ->> 'role_key' = 'owner'
  ),
  'tenant creation records complete administrator and request audit context'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.create_advocate_portal(
      '91000000-0000-4000-8000-000000000105'::uuid,
      'ownership-unverified',
      'Unverified Ownership Portal',
      'This owner has not verified the account'
    )
  $$,
  '23503',
  'The initial owner must be an active account with a verified email',
  'tenant creation rejects an unverified initial owner'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.slug = 'ownership-unverified'
  ),
  'failed tenant creation leaves no partial advocate row'
);

WITH created AS (
  SELECT public.create_advocate_portal(
    '91000000-0000-4000-8000-000000000103'::uuid,
    'ownership-b',
    'Ownership Portal B',
    'Create the cross tenant control portal',
    'creator',
    'request-ownership-create-b'
  ) AS id
)
INSERT INTO ownership_test_ids (key, value)
SELECT 'advocate_b', id FROM created;

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT audit.set_actor_context(
  'system',
  NULL,
  NULL,
  'ownership-boundary-test',
  'database-test',
  'request-ownership-fixture',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'Prepare ownership transfer fixtures',
  jsonb_build_object('operation', 'prepare_fixture')
);

WITH inserted AS (
  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  SELECT
    context.value,
    fixture.user_id,
    fixture.status
  FROM ownership_test_ids context
  CROSS JOIN (
    VALUES
      (
        'delegate_membership',
        '91000000-0000-4000-8000-000000000102'::uuid,
        'active'::public.advocate_membership_status
      ),
      (
        'successor_membership',
        '91000000-0000-4000-8000-000000000104'::uuid,
        'active'::public.advocate_membership_status
      ),
      (
        'unverified_membership',
        '91000000-0000-4000-8000-000000000105'::uuid,
        'active'::public.advocate_membership_status
      ),
      (
        'suspended_membership',
        '91000000-0000-4000-8000-000000000106'::uuid,
        'suspended'::public.advocate_membership_status
      )
  ) AS fixture(key, user_id, status)
  WHERE context.key = 'advocate_a'
  RETURNING id, user_id
)
INSERT INTO ownership_test_ids (key, value)
SELECT
  CASE user_id
    WHEN '91000000-0000-4000-8000-000000000102'::uuid
      THEN 'delegate_membership'
    WHEN '91000000-0000-4000-8000-000000000104'::uuid
      THEN 'successor_membership'
    WHEN '91000000-0000-4000-8000-000000000105'::uuid
      THEN 'unverified_membership'
    ELSE 'suspended_membership'
  END,
  id
FROM inserted;

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
SELECT
  advocate.value,
  membership.value,
  role.id,
  '3de44111-9900-4f04-815d-aeb42828229a'::uuid
FROM ownership_test_ids advocate
JOIN ownership_test_ids membership
  ON membership.key IN ('delegate_membership', 'successor_membership')
JOIN public.advocate_roles role
  ON role.key = CASE membership.key
    WHEN 'delegate_membership' THEN 'administrator'
    ELSE 'brand_editor'
  END
WHERE advocate.key = 'advocate_a';

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000102',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000101'::uuid,
      '91000000-0000-4000-8000-000000000104'::uuid,
      'A portal administrator is not the owner'
    )
  $$,
  '42501',
  'Only the current active owner or a Creator Share super administrator can transfer ownership',
  'a nonowner delegate cannot transfer portal ownership'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000101'::uuid,
      '91000000-0000-4000-8000-000000000103'::uuid,
      'The user belongs to another portal only'
    )
  $$,
  '23503',
  'The target owner must have an active membership in this advocate portal',
  'membership in another tenant cannot satisfy the ownership transfer boundary'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000101'::uuid,
      '91000000-0000-4000-8000-000000000105'::uuid,
      'The target account has not verified its email'
    )
  $$,
  '23503',
  'The target owner must be an active account with a verified email',
  'an unverified account cannot become portal owner'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000101'::uuid,
      '91000000-0000-4000-8000-000000000106'::uuid,
      'The target membership is suspended'
    )
  $$,
  '23503',
  'The target owner must have an active membership in this advocate portal',
  'a suspended membership cannot become portal owner'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000101'::uuid,
      '91000000-0000-4000-8000-000000000102'::uuid,
      '   '
    )
  $$,
  '22023',
  'An ownership transfer reason between 1 and 2000 characters is required',
  'ownership transfer requires a substantive audit reason'
);

SELECT extensions.is(
  public.transfer_advocate_ownership(
    (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
    '91000000-0000-4000-8000-000000000101'::uuid,
    '91000000-0000-4000-8000-000000000102'::uuid,
    'Transfer the active portal to its administrator',
    'request-ownership-transfer-user',
    'trace-ownership-transfer-user',
    'session-ownership-transfer-user'
  ),
  (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
  'the current active owner can transfer to an active same tenant member'
);

SELECT extensions.ok(
  (
    SELECT owner_membership.user_id =
      '91000000-0000-4000-8000-000000000102'::uuid
    FROM public.advocates advocate
    JOIN public.advocate_memberships owner_membership
      ON owner_membership.id = advocate.owner_membership_id
     AND owner_membership.advocate_id = advocate.id
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = advocate.id
  )
  AND (
    SELECT count(*) = 1
    FROM public.advocate_membership_roles membership_role
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = membership_role.advocate_id
    WHERE membership_role.role_id =
      '00000000-0000-4000-8000-000000000001'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_membership_roles membership_role
    JOIN public.advocate_memberships membership
      ON membership.id = membership_role.membership_id
     AND membership.advocate_id = membership_role.advocate_id
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = membership_role.advocate_id
    WHERE membership.user_id =
        '91000000-0000-4000-8000-000000000101'::uuid
      AND membership_role.role_id =
        '00000000-0000-4000-8000-000000000001'::uuid
  ),
  'ownership transfer moves the sole owner pointer and role together'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_membership_roles membership_role
    JOIN public.advocate_memberships membership
      ON membership.id = membership_role.membership_id
     AND membership.advocate_id = membership_role.advocate_id
    JOIN public.advocate_roles role ON role.id = membership_role.role_id
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = membership_role.advocate_id
    WHERE membership.user_id =
        '91000000-0000-4000-8000-000000000102'::uuid
      AND role.key = 'administrator'
  ),
  'ownership transfer preserves the target membership nonowner roles'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = event.advocate_id
    WHERE event.request_id = 'request-ownership-transfer-user'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        '91000000-0000-4000-8000-000000000101'::uuid
      AND event.effective_user_id =
        '91000000-0000-4000-8000-000000000102'::uuid
      AND event.tool = 'advocate-portal-ownership'
      AND event.trace_id = 'trace-ownership-transfer-user'
      AND event.session_id = 'session-ownership-transfer-user'
      AND event.reason = 'Transfer the active portal to its administrator'
      AND event.metadata ->> 'operation' = 'transfer_ownership'
  ),
  'owner initiated transfer records the actor, target, reason, and request context'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000101'::uuid,
      '91000000-0000-4000-8000-000000000104'::uuid,
      'A stale former owner cannot race a later transfer'
    )
  $$,
  '42501',
  'Only the current active owner or a Creator Share super administrator can transfer ownership',
  'a stale former owner loses transfer authority after the serialized change'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000101'::uuid,
      '91000000-0000-4000-8000-000000000104'::uuid,
      'A stale administrator view cannot overwrite the new owner'
    )
  $$,
  '40001',
  'Advocate ownership changed; refresh and retry',
  'an administrator transfer rejects a stale expected owner after row locking'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT audit.set_actor_context(
  'system',
  NULL,
  NULL,
  'ownership-boundary-test',
  'database-test',
  'request-ownership-suspend',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'Suspend the ownership test portal',
  jsonb_build_object('operation', 'suspend_fixture')
);

UPDATE public.advocates
SET relationship_status = 'suspended'
WHERE id = (
  SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000102',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000102'::uuid,
      '91000000-0000-4000-8000-000000000104'::uuid,
      'Portal owners cannot mutate a suspended tenant'
    )
  $$,
  '42501',
  'Only the current active owner or a Creator Share super administrator can transfer ownership',
  'portal owners cannot transfer ownership while the tenant is suspended'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

SELECT extensions.is(
  public.transfer_advocate_ownership(
    (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
    '91000000-0000-4000-8000-000000000102'::uuid,
    '91000000-0000-4000-8000-000000000104'::uuid,
    'Recover ownership for the suspended tenant',
    'request-ownership-transfer-admin',
    'trace-ownership-transfer-admin',
    'session-ownership-transfer-admin'
  ),
  (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
  'a Creator Share administrator can recover ownership on a suspended tenant'
);

SELECT extensions.ok(
  (
    SELECT membership.user_id =
      '91000000-0000-4000-8000-000000000104'::uuid
    FROM public.advocates advocate
    JOIN public.advocate_memberships membership
      ON membership.id = advocate.owner_membership_id
     AND membership.advocate_id = advocate.id
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = advocate.id
  )
  AND (
    SELECT membership.user_id =
      '91000000-0000-4000-8000-000000000103'::uuid
    FROM public.advocates advocate
    JOIN public.advocate_memberships membership
      ON membership.id = advocate.owner_membership_id
     AND membership.advocate_id = advocate.id
    JOIN ownership_test_ids context
      ON context.key = 'advocate_b'
     AND context.value = advocate.id
  ),
  'administrator recovery updates only the requested tenant owner'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN ownership_test_ids context
      ON context.key = 'advocate_a'
     AND context.value = event.advocate_id
    WHERE event.request_id = 'request-ownership-transfer-admin'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        '3de44111-9900-4f04-815d-aeb42828229a'::uuid
      AND event.effective_user_id =
        '91000000-0000-4000-8000-000000000104'::uuid
      AND event.tool = 'creator-share-admin-advocates'
      AND event.reason = 'Recover ownership for the suspended tenant'
  ),
  'administrator recovery is distinctly identified in the audit ledger'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.request_id = 'request-ownership-create-a'
      AND disclosed.event_key = 'portal.created'
      AND disclosed.areas = ARRAY[
        'ownership',
        'portal_lifecycle',
        'portal_profile'
      ]::text[]
      AND disclosed.actor_kind = 'creator_share_staff'
      AND disclosed.actor_display_name = 'Creator Share staff'
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
    WHERE source.request_id = 'request-ownership-transfer-admin'
      AND disclosed.event_key = 'portal.ownership.transferred'
      AND disclosed.areas = ARRAY['ownership']::text[]
      AND disclosed.actor_kind = 'creator_share_staff'
      AND disclosed.actor_display_name = 'Creator Share staff'
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
  'real create and administrator transfer commands emit exact privacy-safe ownership events'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT audit.set_actor_context(
  'system',
  NULL,
  NULL,
  'ownership-boundary-test',
  'database-test',
  'request-ownership-archive',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'Archive the ownership test portal',
  jsonb_build_object('operation', 'archive_fixture')
);

UPDATE public.advocates
SET relationship_status = 'archived'
WHERE id = (
  SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.transfer_advocate_ownership(
      (SELECT value FROM ownership_test_ids WHERE key = 'advocate_a'),
      '91000000-0000-4000-8000-000000000104'::uuid,
      '91000000-0000-4000-8000-000000000102'::uuid,
      'Archived tenants remain closed'
    )
  $$,
  '55000',
  'Archived advocate portals cannot transfer ownership',
  'even a Creator Share administrator cannot transfer an archived tenant'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.transfer_advocate_ownership(uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ) LIKE '%FROM public.advocates advocate%FOR UPDATE%'
  AND EXISTS (
    SELECT 1
    FROM pg_indexes index_definition
    WHERE index_definition.schemaname = 'public'
      AND index_definition.tablename = 'advocate_membership_roles'
      AND index_definition.indexname =
        'advocate_membership_roles_one_owner_uidx'
      AND index_definition.indexdef LIKE '%WHERE (role_id =%'
  ),
  'row locking and the partial unique owner index serialize concurrent transfers'
);

SELECT extensions.finish();
ROLLBACK;
