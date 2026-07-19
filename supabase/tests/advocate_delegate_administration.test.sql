BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(46);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name = 'advocate_memberships'
      AND column_definition.column_name = 'version'
      AND column_definition.data_type = 'bigint'
      AND column_definition.is_nullable = 'NO'
      AND column_definition.column_default = '1'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_constraint constraint_definition
    WHERE constraint_definition.conrelid =
        'public.advocate_memberships'::regclass
      AND constraint_definition.conname =
        'advocate_memberships_version_positive_check'
  ),
  'memberships have a positive durable optimistic version'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'private.prepare_advocate_membership_lifecycle()'::regprocedure
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.prepare_advocate_membership_lifecycle()',
    'EXECUTE'
  ),
  'membership lifecycle protection is fixed path and not directly callable'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'private.bump_advocate_membership_role_versions()'::regprocedure
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.bump_advocate_membership_role_versions()',
    'EXECUTE'
  ),
  'role version maintenance is fixed path and unavailable to API roles'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    )
    FROM pg_proc function_definition
    WHERE function_definition.oid = ANY (ARRAY[
      'public.get_advocate_team(uuid)'::regprocedure,
      'public.replace_advocate_member_roles(uuid,uuid,bigint,text[],text,text,text,text)'::regprocedure,
      'public.change_advocate_member_status(uuid,uuid,bigint,public.advocate_membership_status,text,text,text,text)'::regprocedure
    ])
  ),
  'all delegate administration RPCs are security definer functions with fixed empty search paths'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_advocate_team(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.replace_advocate_member_roles(uuid,uuid,bigint,text[],text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.change_advocate_member_status(uuid,uuid,bigint,public.advocate_membership_status,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_advocate_team(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.replace_advocate_member_roles(uuid,uuid,bigint,text[],text,text,text,text)',
    'EXECUTE'
  ),
  'only authenticated user sessions can enter the delegate administration RPCs'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'public.advocate_memberships',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_membership_roles',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_roles',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_permissions',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.advocate_role_permissions',
    'SELECT'
  ),
  'authenticated sessions cannot read the base membership or RBAC dictionaries'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'public.advocate_memberships',
    'INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_memberships',
    'INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_membership_roles',
    'INSERT,UPDATE,DELETE'
  ),
  'API roles cannot bypass membership mutations through base tables'
);

SELECT extensions.is(
  (
    SELECT array_agg(role.key ORDER BY role.key)
    FROM public.advocate_roles role
    WHERE role.can_be_invited
  ),
  ARRAY[
    'administrator',
    'analytics_viewer',
    'audit_viewer',
    'brand_editor',
    'catalog_curator'
  ]::text[],
  'the MVP exposes exactly five predefined nonowner delegate roles'
);

CREATE TEMP TABLE delegate_test_ids (
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
    '94000000-0000-4000-8000-000000000101'::uuid,
    'authenticated',
    'authenticated',
    'delegate-owner-a@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Olivia","last_name":"Archer"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '94000000-0000-4000-8000-000000000102'::uuid,
    'authenticated',
    'authenticated',
    'delegate-admin-a@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Amir","last_name":"Mendez"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '94000000-0000-4000-8000-000000000103'::uuid,
    'authenticated',
    'authenticated',
    'delegate-target-a@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Ta\nlia","last_name":"Porter"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '94000000-0000-4000-8000-000000000104'::uuid,
    'authenticated',
    'authenticated',
    'delegate-owner-b@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Bea","last_name":"Owner"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '94000000-0000-4000-8000-000000000105'::uuid,
    'authenticated',
    'authenticated',
    'delegate-target-b@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Bryn","last_name":"Tenant"}'::jsonb,
    now(),
    now(),
    false
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

WITH created AS (
  SELECT public.create_advocate_portal(
    '94000000-0000-4000-8000-000000000101'::uuid,
    'delegate-a',
    'Delegate Portal A',
    'Create the primary delegate administration fixture',
    'creator',
    'request-delegate-create-a'
  ) AS id
)
INSERT INTO delegate_test_ids (key, value)
SELECT 'advocate_a', id FROM created;

WITH created AS (
  SELECT public.create_advocate_portal(
    '94000000-0000-4000-8000-000000000104'::uuid,
    'delegate-b',
    'Delegate Portal B',
    'Create the cross tenant delegate fixture',
    'creator',
    'request-delegate-create-b'
  ) AS id
)
INSERT INTO delegate_test_ids (key, value)
SELECT 'advocate_b', id FROM created;

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT audit.set_actor_context(
  'system',
  NULL,
  NULL,
  'delegate-administration-test',
  'database-test',
  'request-delegate-fixtures',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'Prepare delegate administration fixtures',
  jsonb_build_object('operation', 'prepare_fixture')
);

WITH inserted AS (
  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  SELECT
    advocate.value,
    fixture.user_id,
    'active'::public.advocate_membership_status
  FROM delegate_test_ids advocate
  JOIN (
    VALUES
      ('advocate_a', 'admin_a', '94000000-0000-4000-8000-000000000102'::uuid),
      ('advocate_a', 'target_a', '94000000-0000-4000-8000-000000000103'::uuid),
      ('advocate_b', 'target_b', '94000000-0000-4000-8000-000000000105'::uuid)
  ) fixture(advocate_key, membership_key, user_id)
    ON fixture.advocate_key = advocate.key
  RETURNING id, advocate_id, user_id
)
INSERT INTO delegate_test_ids (key, value)
SELECT
  CASE inserted.user_id
    WHEN '94000000-0000-4000-8000-000000000102'::uuid THEN 'admin_a'
    WHEN '94000000-0000-4000-8000-000000000103'::uuid THEN 'target_a'
    ELSE 'target_b'
  END,
  inserted.id
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
  '94000000-0000-4000-8000-000000000101'::uuid
FROM delegate_test_ids advocate
JOIN delegate_test_ids membership
  ON membership.key IN ('admin_a', 'target_a', 'target_b')
JOIN public.advocate_roles role
  ON role.key = CASE membership.key
    WHEN 'admin_a' THEN 'administrator'
    WHEN 'target_a' THEN 'brand_editor'
    ELSE 'analytics_viewer'
  END
WHERE advocate.key = CASE membership.key
  WHEN 'target_b' THEN 'advocate_b'
  ELSE 'advocate_a'
END;

SELECT extensions.is(
  (
    SELECT membership.version
    FROM public.advocates advocate
    JOIN public.advocate_memberships membership
      ON membership.id = advocate.owner_membership_id
    WHERE advocate.id = (
      SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'
    )
  ),
  2::bigint,
  'initial owner role insertion advances the membership version once'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000102',
  true
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.get_advocate_team(
      (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a')
    )
  ),
  3,
  'a member viewer receives every membership in the requested tenant only'
);

SELECT extensions.is(
  (
    SELECT array_agg(team.member_display_name ORDER BY team.member_display_name)
    FROM public.get_advocate_team(
      (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a')
    ) team
  ),
  ARRAY['Amir M.', 'Olivia A.', 'Talia P.']::text[],
  'team display names stop at first name and last initial'
);

SELECT extensions.is(
  (
    SELECT team.role_keys
    FROM public.get_advocate_team(
      (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a')
    ) team
    WHERE team.membership_id = (
      SELECT value FROM delegate_test_ids WHERE key = 'admin_a'
    )
  ),
  ARRAY['administrator']::text[],
  'the team projection returns a sorted predefined role set'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.parameters parameter_definition
    WHERE parameter_definition.specific_schema = 'public'
      AND parameter_definition.specific_name LIKE 'get_advocate_team_%'
      AND parameter_definition.parameter_name = ANY (ARRAY[
        'email',
        'user_id',
        'sponsor_id',
        'contact_id'
      ]::text[])
  )
  AND pg_get_functiondef('public.get_advocate_team(uuid)'::regprocedure)
    NOT LIKE '%subscriptions%'
  AND pg_get_functiondef('public.get_advocate_team(uuid)'::regprocedure)
    NOT LIKE '%advocate_exposures%',
  'the team projection has no contact, sponsor, subscription, or raw attribution surface'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.get_advocate_team(%L::uuid)',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_b')
  ),
  '42501',
  'Insufficient portal member permission',
  'a tenant administrator cannot read another tenant team'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000103',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.get_advocate_team(%L::uuid)',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a')
  ),
  '42501',
  'Insufficient portal member permission',
  'a brand editor cannot read team administration data'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000102',
  true
);

SELECT extensions.is(
  public.replace_advocate_member_roles(
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'target_a'),
    2,
    ARRAY['audit_viewer', 'analytics_viewer'],
    'Give the delegate privacy safe reporting access',
    'request-delegate-role-change',
    'trace-delegate-role-change',
    'session-delegate-role-change'
  ),
  4::bigint,
  'role replacement advances once for deletion and once for insertion'
);

SELECT extensions.is(
  (
    SELECT array_agg(role.key ORDER BY role.key)
    FROM public.advocate_membership_roles membership_role
    JOIN public.advocate_roles role ON role.id = membership_role.role_id
    WHERE membership_role.advocate_id = (
      SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'
    )
      AND membership_role.membership_id = (
        SELECT value FROM delegate_test_ids WHERE key = 'target_a'
      )
  ),
  ARRAY['analytics_viewer', 'audit_viewer']::text[],
  'role replacement stores exactly the complete requested predefined set'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = (
        SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'
      )
      AND event.request_id = 'request-delegate-role-change'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        '94000000-0000-4000-8000-000000000102'::uuid
      AND event.effective_user_id =
        '94000000-0000-4000-8000-000000000103'::uuid
      AND event.tool = 'advocate-portal-team'
      AND event.trace_id = 'trace-delegate-role-change'
      AND event.session_id = 'session-delegate-role-change'
      AND event.reason = 'Give the delegate privacy safe reporting access'
      AND event.metadata ->> 'operation' = 'replace_member_roles'
      AND event.metadata ->> 'permission_key' = 'portal.members.manage'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
  ),
  'role changes carry complete request context and retain columns only audit evidence'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.replace_advocate_member_roles(%L::uuid,%L::uuid,2,ARRAY[''brand_editor''],''Use a stale editor view'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'target_a')
  ),
  '40001',
  'Portal membership changed; refresh and retry',
  'stale membership versions cannot overwrite a later role replacement'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.replace_advocate_member_roles(%L::uuid,%L::uuid,2,ARRAY[''brand_editor''],''Cross tenant target'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'target_b')
  ),
  '42501',
  'Insufficient portal member permission',
  'a same shaped membership identifier from another tenant is not mutable'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.replace_advocate_member_roles(%L::uuid,(SELECT owner_membership_id FROM public.advocates WHERE id=%L::uuid),2,ARRAY[''administrator''],''Attempt owner mutation'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a')
  ),
  '42501',
  'Portal ownership is immutable through delegate administration',
  'tenant delegates cannot alter the owner membership role set'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.replace_advocate_member_roles(%L::uuid,%L::uuid,4,ARRAY[''owner''],''Smuggle ownership'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'target_a')
  ),
  '22023',
  'Only unique predefined nonowner delegate roles may be assigned',
  'owner cannot be smuggled through the delegate role boundary'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.replace_advocate_member_roles(%L::uuid,%L::uuid,4,ARRAY[''audit_viewer'',''audit_viewer''],''Duplicate role'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'target_a')
  ),
  '22023',
  'Only unique predefined nonowner delegate roles may be assigned',
  'duplicate role keys are rejected rather than silently collapsed'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.replace_advocate_member_roles(%L::uuid,%L::uuid,4,ARRAY[''brand_editor''],''   '')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'target_a')
  ),
  '22023',
  'A role change reason between 1 and 2000 characters is required',
  'role changes require a substantive audit reason'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.replace_advocate_member_roles(%L::uuid,%L::uuid,4,ARRAY[''brand_editor''],%L)',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'target_a'),
    E'control\ncharacter'
  ),
  '22023',
  'A role change reason between 1 and 2000 characters is required',
  'audit reasons reject control characters'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  format(
    'UPDATE public.advocate_membership_roles SET assigned_by_user_id=%L::uuid WHERE membership_id=%L::uuid',
    '94000000-0000-4000-8000-000000000102',
    (SELECT value FROM delegate_test_ids WHERE key = 'target_a')
  ),
  '42501',
  'Advocate membership role rows must be replaced, not updated',
  'role assignment facts cannot be edited in place'
);

SELECT set_config(
  'app.advocate.invitation_operation',
  'issue',
  true
);

WITH fixture_time AS (
  SELECT clock_timestamp() AS created_at
)
INSERT INTO public.advocate_invitations (
  advocate_id,
  email,
  token_digest,
  expires_at,
  created_by_user_id,
  created_at,
  last_sent_at,
  issuance_idempotency_key,
  issuance_fingerprint
)
SELECT
  (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
  'pending-from-admin@example.test',
  extensions.digest('delegate-admin-issued-capability', 'sha256'),
  fixture_time.created_at + interval '7 days',
  '94000000-0000-4000-8000-000000000102'::uuid,
  fixture_time.created_at,
  NULL,
  'delegate-test-issuance-0001',
  extensions.digest('delegate-test-issuance-fingerprint', 'sha256')
FROM fixture_time;

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.is(
  public.change_advocate_member_status(
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'admin_a'),
    2,
    'suspended',
    'Suspend the delegate after a security review',
    'request-delegate-suspend',
    'trace-delegate-suspend',
    'session-delegate-suspend'
  ),
  3::bigint,
  'suspension advances the exact target membership version once'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.id = (
        SELECT value FROM delegate_test_ids WHERE key = 'admin_a'
      )
      AND membership.status = 'suspended'
      AND membership.version = 3
      AND membership.suspended_at IS NOT NULL
      AND membership.revoked_at IS NULL
  ),
  'suspension records a server timestamp and preserves revocation separation'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    WHERE invitation.email = 'pending-from-admin@example.test'
      AND invitation.revoked_at IS NOT NULL
      AND invitation.revoked_by_user_id =
        '94000000-0000-4000-8000-000000000101'::uuid
  ),
  'suspending an issuer cancels every outstanding invitation they created'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'advocate_invitations'
      AND event.request_id = 'request-delegate-suspend'
      AND event.actor_user_id =
        '94000000-0000-4000-8000-000000000101'::uuid
      AND event.effective_user_id =
        '94000000-0000-4000-8000-000000000102'::uuid
      AND event.before_data ->> 'email' = '[REDACTED]'
      AND event.after_data ->> 'email' = '[REDACTED]'
      AND event.before_data ->> 'token_digest' = '[REDACTED]'
      AND event.after_data ->> 'token_digest' = '[REDACTED]'
  ),
  'invitation cancellation audit evidence redacts email and capability digest'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000102',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.get_advocate_team(%L::uuid)',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a')
  ),
  '42501',
  'Insufficient portal member permission',
  'suspension removes the delegate authorization immediately'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.change_advocate_member_status(%L::uuid,%L::uuid,2,''active'',''Use stale lifecycle version'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'admin_a')
  ),
  '40001',
  'Portal membership changed; refresh and retry',
  'stale lifecycle versions cannot overwrite a suspension'
);

SELECT extensions.is(
  public.change_advocate_member_status(
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'admin_a'),
    3,
    'active',
    'Reactivate the healthy suspended administrator',
    'request-delegate-reactivate'
  ),
  4::bigint,
  'a healthy suspended member can be deliberately reactivated'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.id = (
        SELECT value FROM delegate_test_ids WHERE key = 'admin_a'
      )
      AND membership.status = 'active'
      AND membership.version = 4
      AND membership.suspended_at IS NULL
      AND membership.revoked_at IS NULL
  ),
  'suspended reactivation clears lifecycle timestamps'
);

SELECT extensions.is(
  public.change_advocate_member_status(
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'admin_a'),
    4,
    'revoked',
    'Permanently revoke the delegate membership',
    'request-delegate-revoke'
  ),
  5::bigint,
  'revocation advances the exact target membership version once'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.id = (
        SELECT value FROM delegate_test_ids WHERE key = 'admin_a'
      )
      AND membership.status = 'revoked'
      AND membership.version = 5
      AND membership.suspended_at IS NULL
      AND membership.revoked_at IS NOT NULL
  ),
  'revocation records a separate server managed terminal timestamp'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.change_advocate_member_status(%L::uuid,%L::uuid,5,''active'',''Bypass a fresh invitation'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'admin_a')
  ),
  '42501',
  'Revoked memberships require a fresh invitation',
  'the tenant lifecycle RPC cannot reactivate a revoked member'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.replace_advocate_member_roles(%L::uuid,%L::uuid,5,ARRAY[''administrator''],''Mutate revoked member'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'admin_a')
  ),
  '42501',
  'Revoked memberships require a fresh invitation',
  'revoked memberships cannot be repurposed through role administration'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  format(
    'UPDATE public.advocate_memberships SET status=''active'',version=version+1 WHERE id=%L::uuid',
    (SELECT value FROM delegate_test_ids WHERE key = 'admin_a')
  ),
  '42501',
  'A revoked membership requires a fresh invitation for reactivation',
  'the row guard rejects revoked reactivation without the invitation contract'
);

SELECT set_config(
  'app.advocate.reactivation_membership_id',
  (SELECT value::text FROM delegate_test_ids WHERE key = 'admin_a'),
  true
);

UPDATE public.advocate_memberships membership
SET status = 'active', version = membership.version + 1
WHERE membership.id = (
  SELECT value FROM delegate_test_ids WHERE key = 'admin_a'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.advocate_memberships membership
    WHERE membership.id = (
        SELECT value FROM delegate_test_ids WHERE key = 'admin_a'
      )
      AND membership.status = 'active'
      AND membership.version = 6
      AND membership.revoked_at IS NULL
  ),
  'the exact transaction local invitation hook can reactivate the locked revoked membership'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.change_advocate_member_status(%L::uuid,(SELECT owner_membership_id FROM public.advocates WHERE id=%L::uuid),2,''suspended'',''Attempt owner suspension'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a')
  ),
  '42501',
  'Portal ownership is immutable through delegate administration',
  'tenant delegates cannot suspend or revoke the owner membership'
);

UPDATE auth.users
SET banned_until = now() + interval '1 day'
WHERE id = '94000000-0000-4000-8000-000000000101'::uuid;

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.get_advocate_team(%L::uuid)',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a')
  ),
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned member cannot retain the sanitized team read surface'
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.change_advocate_member_status(%L::uuid,%L::uuid,6,''suspended'',''Banned actor attempt'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'),
    (SELECT value FROM delegate_test_ids WHERE key = 'admin_a')
  ),
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned owner cannot use retained database membership permissions'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.change_advocate_member_status(%L::uuid,%L::uuid,2,''suspended'',''Global role is not tenant authority'')',
    (SELECT value FROM delegate_test_ids WHERE key = 'advocate_b'),
    (SELECT value FROM delegate_test_ids WHERE key = 'target_b')
  ),
  '42501',
  'Insufficient portal member permission',
  'Creator Share super administrator status does not silently cross the tenant delegate boundary'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id = (
        SELECT value FROM delegate_test_ids WHERE key = 'advocate_a'
      )
      AND event.request_id = 'request-delegate-suspend'
      AND event.table_name = 'advocate_memberships'
      AND event.actor_user_id =
        '94000000-0000-4000-8000-000000000101'::uuid
      AND event.effective_user_id =
        '94000000-0000-4000-8000-000000000102'::uuid
      AND event.reason = 'Suspend the delegate after a security review'
      AND event.metadata ->> 'operation' = 'change_member_status'
      AND event.metadata ->> 'prior_status' = 'active'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
      AND event.changed_columns @> ARRAY[
        'status',
        'suspended_at',
        'version'
      ]::text[]
  ),
  'membership lifecycle audit evidence is complete, scoped, and columns only'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.replace_advocate_member_roles(uuid,uuid,bigint,text[],text,text,text,text)'::regprocedure
  ) LIKE '%FROM public.advocates advocate%FOR UPDATE%'
  AND pg_get_functiondef(
    'public.replace_advocate_member_roles(uuid,uuid,bigint,text[],text,text,text,text)'::regprocedure
  ) LIKE '%ORDER BY membership.id%FOR UPDATE%'
  AND pg_get_functiondef(
    'public.change_advocate_member_status(uuid,uuid,bigint,public.advocate_membership_status,text,text,text,text)'::regprocedure
  ) LIKE '%ORDER BY membership.id%FOR UPDATE%',
  'both mutation RPCs serialize on the tenant root and exact ordered membership rows'
);

SELECT extensions.finish();
ROLLBACK;
