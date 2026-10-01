BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(48);

SELECT extensions.ok(
  to_regclass('public.subscription_beneficiary_assignments') IS NOT NULL,
  'blind sponsorship assignment evidence has a dedicated table'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    WHERE relation.oid =
      'public.subscription_beneficiary_assignments'::regclass
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'subscription_beneficiary_assignments'
  ),
  'assignment evidence uses deny by default row security'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.assign_blind_sponsorship_beneficiary(uuid,uuid,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.assign_blind_sponsorship_beneficiary_admin(uuid,uuid,text,text,text,text,text)'::regprocedure
  ),
  'public assignment boundaries are security definer functions with empty search paths'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'private.assign_blind_sponsorship_beneficiary_core(uuid,uuid,uuid,text,text,boolean,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'private.protect_subscription_beneficiary_assignment()'::regprocedure
  ),
  'private assignment implementation is security definer code with an empty search path'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.assign_blind_sponsorship_beneficiary(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.assign_blind_sponsorship_beneficiary_admin(uuid,uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.assign_blind_sponsorship_beneficiary(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.assign_blind_sponsorship_beneficiary(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.assign_blind_sponsorship_beneficiary_admin(uuid,uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.assign_blind_sponsorship_beneficiary_admin(uuid,uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'only authenticated sessions can enter either public assignment boundary'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'private.assign_blind_sponsorship_beneficiary_core(uuid,uuid,uuid,text,text,boolean,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.assign_blind_sponsorship_beneficiary_core(uuid,uuid,uuid,text,text,boolean,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.assign_blind_sponsorship_beneficiary_core(uuid,uuid,uuid,text,text,boolean,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.protect_subscription_beneficiary_assignment()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.protect_subscription_beneficiary_assignment()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.protect_subscription_beneficiary_assignment()',
    'EXECUTE'
  ),
  'no API role can invoke private assignment implementation functions'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'public.subscription_beneficiary_assignments',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.subscription_beneficiary_assignments',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.subscription_beneficiary_assignments',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'assignment evidence is opaque and directly immutable to every API role'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
        'public.subscription_beneficiary_assignments'::regclass
      AND trigger_definition.tgname =
        'subscription_beneficiary_assignments_protect'
      AND NOT trigger_definition.tgisinternal
  )
  AND EXISTS (
    SELECT 1
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
        'public.subscription_beneficiary_assignments'::regclass
      AND trigger_definition.tgname =
        'subscription_beneficiary_assignments_no_truncate'
      AND NOT trigger_definition.tgisinternal
  )
  AND EXISTS (
    SELECT 1
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
        'public.subscription_beneficiary_assignments'::regclass
      AND trigger_definition.tgname =
        'subscription_beneficiary_assignments_audit'
      AND NOT trigger_definition.tgisinternal
  ),
  'assignment evidence has row protection, truncate protection, and audit triggers'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_index index_definition
    WHERE index_definition.indrelid =
        'public.subscription_beneficiary_assignments'::regclass
      AND index_definition.indisunique
      AND index_definition.indnatts = 1
      AND index_definition.indkey[0] = (
        (
          SELECT attribute.attnum::smallint
          FROM pg_attribute attribute
          WHERE attribute.attrelid =
              'public.subscription_beneficiary_assignments'::regclass
            AND attribute.attname = 'subscription_id'
        )
      )
  ),
  'one subscription can have only one immutable beneficiary assignment'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint constraint_definition
    WHERE constraint_definition.conrelid =
        'public.subscription_beneficiary_assignments'::regclass
      AND constraint_definition.conname =
        'subscription_beneficiary_assignments_assigned_by_user_id_fkey'
      AND constraint_definition.confrelid = 'auth.users'::regclass
      AND constraint_definition.confdeltype = 'r'
  ),
  'immutable assignment evidence restricts deletion of its authenticated actor'
);

CREATE TEMP TABLE blind_assignment_results (
  call_key text PRIMARY KEY,
  assignment_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  beneficiary_id uuid NOT NULL,
  beneficiary_name text,
  beneficiary_username text,
  subscription_amount_usd_cents integer,
  billing_interval text,
  was_already_assigned boolean NOT NULL
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
    'blind-owner-a@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '94000000-0000-4000-8000-000000000102'::uuid,
    'authenticated',
    'authenticated',
    'blind-owner-b@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '94000000-0000-4000-8000-000000000103'::uuid,
    'authenticated',
    'authenticated',
    'blind-unverified@example.test',
    NULL,
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '94000000-0000-4000-8000-000000000104'::uuid,
    'authenticated',
    'authenticated',
    'blind-admin@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '94000000-0000-4000-8000-000000000105'::uuid,
    'authenticated',
    'authenticated',
    'blind-nonadmin@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false
  );

INSERT INTO public.sponsor_identities (id, auth_user_id)
VALUES
  (
    '94300000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid
  ),
  (
    '94300000-0000-4000-8000-000000000002'::uuid,
    '94000000-0000-4000-8000-000000000102'::uuid
  );

INSERT INTO public.roles (id, name, display_name, description)
SELECT
  '94400000-0000-4000-8000-000000000001'::uuid,
  'SUPER_ADMIN',
  'Super Administrator',
  'Creator Share global administrator test role'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.roles role
  WHERE role.name = 'SUPER_ADMIN'
);

INSERT INTO public.role_assignments (user_id, role_id)
SELECT
  '94000000-0000-4000-8000-000000000104'::uuid,
  role.id
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

INSERT INTO public.beneficiaries (
  id,
  name,
  username,
  budget_goal,
  budget_raised,
  status,
  active_subscriptions,
  goal_fulfilled_at
)
VALUES
  (
    '94100000-0000-4000-8000-000000000001'::uuid,
    'Primary Assignment Child',
    'blind-assignment-primary',
    10000,
    0,
    'New',
    0,
    NULL
  ),
  (
    '94100000-0000-4000-8000-000000000002'::uuid,
    'Alternative Assignment Child',
    'blind-assignment-alternative',
    10000,
    0,
    'New',
    0,
    NULL
  ),
  (
    '94100000-0000-4000-8000-000000000003'::uuid,
    'Capacity Assignment Child',
    'blind-assignment-capacity',
    5000,
    0,
    'New',
    0,
    NULL
  ),
  (
    '94100000-0000-4000-8000-000000000004'::uuid,
    'Annual Assignment Child',
    'blind-assignment-annual',
    2000,
    0,
    'New',
    0,
    NULL
  ),
  (
    '94100000-0000-4000-8000-000000000005'::uuid,
    'Open Assignment Child',
    'blind-assignment-open',
    -1,
    0,
    'New',
    0,
    NULL
  ),
  (
    '94100000-0000-4000-8000-000000000006'::uuid,
    'Draft Open Assignment Child',
    'blind-assignment-open-draft',
    -1,
    0,
    'Draft',
    0,
    NULL
  ),
  (
    '94100000-0000-4000-8000-000000000007'::uuid,
    'Fulfilled Assignment Child',
    'blind-assignment-fulfilled',
    1000,
    1000,
    'Budget Fulfilled',
    1,
    now()
  ),
  (
    '94100000-0000-4000-8000-000000000008'::uuid,
    'Server Owned Blind Assignment Child',
    'blind-assignment-server-owned',
    10000,
    0,
    'New',
    0,
    NULL
  ),
  (
    '94100000-0000-4000-8000-000000000009'::uuid,
    'Administrative Assignment Child',
    'blind-assignment-admin',
    10000,
    0,
    'New',
    0,
    NULL
  );

INSERT INTO public.subscriptions (
  id,
  user_id,
  beneficiary_id,
  status,
  amount,
  interval
)
VALUES
  (
    '94200000-0000-4000-8000-000000000101'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    '94100000-0000-4000-8000-000000000003'::uuid,
    'complete',
    4000,
    'month'
  ),
  (
    '94200000-0000-4000-8000-000000000102'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    '94100000-0000-4000-8000-000000000004'::uuid,
    'complete',
    1099,
    'month'
  );

INSERT INTO public.subscriptions (
  id,
  user_id,
  status,
  amount,
  interval,
  sponsor_identity_id,
  subject_kind
)
VALUES
  (
    '94200000-0000-4000-8000-000000000001'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    3000,
    'month',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000002'::uuid,
    '94000000-0000-4000-8000-000000000102'::uuid,
    'complete',
    1000,
    'month',
    '94300000-0000-4000-8000-000000000002'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000003'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    1000,
    'month',
    '94300000-0000-4000-8000-000000000002'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000004'::uuid,
    '94000000-0000-4000-8000-000000000103'::uuid,
    'complete',
    1000,
    'month',
    NULL,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000005'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'incomplete',
    1000,
    'month',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000006'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    1500,
    'month',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000007'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    10801,
    'year',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000008'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    1200,
    'month',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000009'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    1200,
    'month',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000010'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    1200,
    'month',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000011'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    1200,
    'month',
    '94300000-0000-4000-8000-000000000001'::uuid,
    'blind'
  ),
  (
    '94200000-0000-4000-8000-000000000012'::uuid,
    '94000000-0000-4000-8000-000000000102'::uuid,
    'complete',
    1200,
    'month',
    '94300000-0000-4000-8000-000000000002'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000013'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    1200,
    'week',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  ),
  (
    '94200000-0000-4000-8000-000000000014'::uuid,
    '94000000-0000-4000-8000-000000000101'::uuid,
    'complete',
    1200,
    'month',
    '94300000-0000-4000-8000-000000000001'::uuid,
    NULL
  );

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000001'::uuid,
      '94100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '42501',
  'Blind sponsorship assignment requires an authenticated account',
  'self assignment rejects an unauthenticated request'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000103',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000004'::uuid,
      '94100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514',
  'Blind sponsorship assignment requires a verified account',
  'self assignment requires a verified email account'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000101',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000002'::uuid,
      '94100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '42501',
  'Blind sponsorship does not belong to the authenticated account',
  'self assignment requires exact subscription ownership'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000003'::uuid,
      '94100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '42501',
  'Blind sponsorship does not belong to the authenticated account',
  'self assignment requires ownership of the stable sponsor identity'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000005'::uuid,
      '94100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514',
  'Subscription is not an assignable blind sponsorship',
  'an incomplete sponsorship cannot be assigned'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000013'::uuid,
      '94100000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514',
  'Subscription is not an assignable blind sponsorship',
  'assignment accepts only monthly or annual recurring sponsorships'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO blind_assignment_results
    SELECT
      'self_initial',
      assignment.*
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000001'::uuid,
      '94100000-0000-4000-8000-000000000001'::uuid,
      'request-blind-self',
      'trace-blind-self',
      '192.0.2.25',
      'blind-assignment-test-agent'
    ) assignment
  $$,
  'a verified owner can atomically assign an eligible blind sponsorship'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM blind_assignment_results result
    WHERE result.call_key = 'self_initial'
      AND result.subscription_id =
        '94200000-0000-4000-8000-000000000001'::uuid
      AND result.beneficiary_id =
        '94100000-0000-4000-8000-000000000001'::uuid
      AND result.beneficiary_name = 'Primary Assignment Child'
      AND result.beneficiary_username = 'blind-assignment-primary'
      AND result.subscription_amount_usd_cents = 3000
      AND result.billing_interval = 'month'
      AND NOT result.was_already_assigned
  ),
  'self assignment returns only the intended sponsorship and beneficiary projection'
);

SELECT extensions.is(
  (
    SELECT subscription.beneficiary_id
    FROM public.subscriptions subscription
    WHERE subscription.id =
      '94200000-0000-4000-8000-000000000001'::uuid
  ),
  '94100000-0000-4000-8000-000000000001'::uuid,
  'self assignment links the subscription to the selected beneficiary'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.subscription_beneficiary_assignments assignment
    WHERE assignment.subscription_id =
        '94200000-0000-4000-8000-000000000001'::uuid
      AND assignment.beneficiary_id =
        '94100000-0000-4000-8000-000000000001'::uuid
      AND assignment.sponsorship_intent_id IS NULL
      AND assignment.sponsor_identity_id =
        '94300000-0000-4000-8000-000000000001'::uuid
      AND assignment.assigned_by_user_id =
        '94000000-0000-4000-8000-000000000101'::uuid
      AND assignment.assignment_source = 'self_service'
      AND assignment.assignment_reason =
        'Sponsor selected a beneficiary for a blind sponsorship'
      AND assignment.request_id = 'request-blind-self'
      AND assignment.trace_id = 'trace-blind-self'
  ),
  'self assignment stores complete immutable actor, source, and request evidence'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id =
        '94100000-0000-4000-8000-000000000001'::uuid
      AND beneficiary.budget_raised = 3000
      AND beneficiary.active_subscriptions = 1
      AND beneficiary.status = 'Partially Funded'
      AND beneficiary.goal_fulfilled_at IS NULL
  ),
  'self assignment recalculates beneficiary funding state in the same transaction'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'subscription_beneficiary_assignments'
      AND event.operation = 'INSERT'
      AND event.actor_type = 'user'
      AND event.actor_user_id =
        '94000000-0000-4000-8000-000000000101'::uuid
      AND event.effective_user_id =
        '94000000-0000-4000-8000-000000000101'::uuid
      AND event.tool = 'assign_blind_sponsorship_beneficiary'
      AND event.request_id = 'request-blind-self'
      AND event.trace_id = 'trace-blind-self'
      AND event.reason =
        'Sponsor selected a beneficiary for a blind sponsorship'
      AND event.metadata ->> 'operation' = 'assign'
      AND event.metadata ->> 'resource_kind' = 'subscription'
      AND event.metadata ->> 'resource_id' =
        '94200000-0000-4000-8000-000000000001'
      AND event.metadata ->> 'outcome' = 'assigned'
  ),
  'self assignment records actor, tool, reason, request, trace, and resource audit context'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_event_forensics forensics
    JOIN audit.audit_events event
      ON event.id = forensics.audit_event_id
    WHERE event.table_name = 'subscription_beneficiary_assignments'
      AND event.request_id = 'request-blind-self'
      AND forensics.client_ip = '192.0.2.25'
      AND forensics.user_agent = 'blind-assignment-test-agent'
      AND forensics.expires_at =
        forensics.captured_at + interval '90 days'
  ),
  'self assignment isolates raw request forensics behind the 90 day retention boundary'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO blind_assignment_results
    SELECT
      'self_retry',
      assignment.*
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000001'::uuid,
      '94100000-0000-4000-8000-000000000001'::uuid,
      'request-blind-self-retry'
    ) assignment
  $$,
  'retrying the same assignment is safe'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM blind_assignment_results initial
    JOIN blind_assignment_results retry
      ON retry.assignment_id = initial.assignment_id
    WHERE initial.call_key = 'self_initial'
      AND retry.call_key = 'self_retry'
      AND retry.was_already_assigned
  ),
  'an idempotent retry returns the original assignment and identifies the retry'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.subscription_beneficiary_assignments assignment
    WHERE assignment.subscription_id =
      '94200000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'an idempotent retry creates no duplicate assignment evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000001'::uuid,
      '94100000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  '23505',
  'Blind sponsorship is already assigned to another beneficiary',
  'a completed assignment cannot be redirected to another beneficiary'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO blind_assignment_results
    SELECT
      'annual_exact_capacity',
      assignment.*
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000007'::uuid,
      '94100000-0000-4000-8000-000000000004'::uuid,
      'request-blind-annual-capacity'
    ) assignment
  $$,
  'annual sponsorship capacity is normalized to a monthly amount and can exactly fill a goal'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id =
        '94100000-0000-4000-8000-000000000004'::uuid
      AND beneficiary.budget_raised = 2000
      AND beneficiary.active_subscriptions = 2
      AND beneficiary.status = 'Budget Fulfilled'
      AND beneficiary.goal_fulfilled_at IS NOT NULL
  ),
  'an exact annual capacity assignment recalculates the beneficiary as fulfilled'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000006'::uuid,
      '94100000-0000-4000-8000-000000000003'::uuid
    )
  $$,
  '23514',
  'Beneficiary does not have enough remaining sponsorship capacity',
  'a blind assignment cannot exceed exact remaining monthly capacity'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO blind_assignment_results
    SELECT
      'open_beneficiary',
      assignment.*
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000008'::uuid,
      '94100000-0000-4000-8000-000000000005'::uuid,
      'request-blind-open'
    ) assignment
  $$,
  'an eligible open beneficiary accepts a blind sponsorship without a capacity ceiling'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id =
        '94100000-0000-4000-8000-000000000005'::uuid
      AND beneficiary.budget_raised = 1200
      AND beneficiary.active_subscriptions = 1
      AND beneficiary.status = 'Partially Funded'
      AND beneficiary.goal_fulfilled_at IS NULL
  ),
  'open beneficiary funding remains active and never auto fulfills'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000009'::uuid,
      '94100000-0000-4000-8000-000000000006'::uuid
    )
  $$,
  '23514',
  'Beneficiary is unavailable for sponsorship',
  'a draft open beneficiary is ineligible for assignment'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000010'::uuid,
      '94100000-0000-4000-8000-000000000007'::uuid
    )
  $$,
  '23514',
  'Beneficiary is unavailable for sponsorship',
  'a fulfilled fixed beneficiary is ineligible for assignment'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO blind_assignment_results
    SELECT
      'server_owned_blind',
      assignment.*
    FROM public.assign_blind_sponsorship_beneficiary(
      '94200000-0000-4000-8000-000000000011'::uuid,
      '94100000-0000-4000-8000-000000000008'::uuid,
      'request-blind-server-owned'
    ) assignment
  $$,
  'a server owned subscription that remains typed blind can receive its final beneficiary'
);

SELECT extensions.is(
  (
    SELECT subscription.beneficiary_id
    FROM public.subscriptions subscription
    WHERE subscription.id =
      '94200000-0000-4000-8000-000000000011'::uuid
  ),
  '94100000-0000-4000-8000-000000000008'::uuid,
  'assignment preserves a server owned blind subscription while linking its beneficiary'
);

SELECT set_config(
  'app.subscription_beneficiary_assignment.operation',
  '',
  true
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.subscription_beneficiary_assignments (
      subscription_id,
      beneficiary_id,
      sponsor_identity_id,
      assigned_by_user_id,
      assignment_source,
      assignment_reason
    )
    VALUES (
      '94200000-0000-4000-8000-000000000014'::uuid,
      '94100000-0000-4000-8000-000000000002'::uuid,
      '94300000-0000-4000-8000-000000000001'::uuid,
      '94000000-0000-4000-8000-000000000101'::uuid,
      'self_service',
      'Attempt to bypass the assignment boundary'
    )
  $$,
  '42501',
  'Subscription beneficiary assignments require a narrow assignment RPC',
  'direct evidence insertion is rejected without a narrow operation context'
);

SELECT set_config(
  'app.subscription_beneficiary_assignment.operation',
  'self_service',
  true
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.subscription_beneficiary_assignments (
      subscription_id,
      beneficiary_id,
      sponsor_identity_id,
      assigned_by_user_id,
      assignment_source,
      assignment_reason
    )
    VALUES (
      '94200000-0000-4000-8000-000000000014'::uuid,
      '94100000-0000-4000-8000-000000000002'::uuid,
      '94300000-0000-4000-8000-000000000001'::uuid,
      '94000000-0000-4000-8000-000000000102'::uuid,
      'self_service',
      'Attempt to forge the assignment actor'
    )
  $$,
  '42501',
  'Assignment actor does not match the authenticated account',
  'assignment evidence cannot forge a different authenticated actor'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.subscription_beneficiary_assignments
    SET assignment_reason = 'Rewrite immutable assignment evidence'
    WHERE subscription_id =
      '94200000-0000-4000-8000-000000000001'::uuid
  $$,
  '42501',
  'Subscription beneficiary assignment evidence is immutable',
  'assignment evidence cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM public.subscription_beneficiary_assignments
    WHERE subscription_id =
      '94200000-0000-4000-8000-000000000001'::uuid
  $$,
  '42501',
  'Subscription beneficiary assignment evidence is immutable',
  'assignment evidence cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    TRUNCATE TABLE public.subscription_beneficiary_assignments
  $$,
  '42501',
  'Operational sponsorship tables cannot be truncated',
  'assignment evidence cannot be truncated'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000105',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary_admin(
      '94200000-0000-4000-8000-000000000012'::uuid,
      '94100000-0000-4000-8000-000000000009'::uuid,
      'A nonadministrator cannot assign another sponsor subscription'
    )
  $$,
  '42501',
  'Blind sponsorship administration requires a Creator Share super administrator',
  'an ordinary authenticated user cannot enter the administrative boundary'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000104',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.assign_blind_sponsorship_beneficiary_admin(
      '94200000-0000-4000-8000-000000000012'::uuid,
      '94100000-0000-4000-8000-000000000009'::uuid,
      'no'
    )
  $$,
  '22023',
  'Administrative assignment requires a reason of 5 to 1000 characters',
  'administrative assignment requires a substantive reason'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO blind_assignment_results
    SELECT
      'admin_assignment',
      assignment.*
    FROM public.assign_blind_sponsorship_beneficiary_admin(
      '94200000-0000-4000-8000-000000000012'::uuid,
      '94100000-0000-4000-8000-000000000009'::uuid,
      'Resolve sponsor request through the Creator Share support workflow',
      'request-blind-admin',
      'trace-blind-admin',
      '198.51.100.19',
      'blind-assignment-admin-test-agent'
    ) assignment
  $$,
  'a global Creator Share super administrator can resolve another sponsor assignment'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM blind_assignment_results result
    JOIN public.subscription_beneficiary_assignments assignment
      ON assignment.id = result.assignment_id
    WHERE result.call_key = 'admin_assignment'
      AND result.subscription_id =
        '94200000-0000-4000-8000-000000000012'::uuid
      AND result.beneficiary_id =
        '94100000-0000-4000-8000-000000000009'::uuid
      AND NOT result.was_already_assigned
      AND assignment.assignment_source = 'creator_share_admin'
      AND assignment.assignment_reason =
        'Resolve sponsor request through the Creator Share support workflow'
      AND assignment.assigned_by_user_id =
        '94000000-0000-4000-8000-000000000104'::uuid
      AND assignment.sponsor_identity_id =
        '94300000-0000-4000-8000-000000000002'::uuid
      AND assignment.request_id = 'request-blind-admin'
      AND assignment.trace_id = 'trace-blind-admin'
  ),
  'administrative assignment retains the explicit reason, actor, sponsor identity, and request evidence'
);

SELECT extensions.is(
  (
    SELECT subscription.beneficiary_id
    FROM public.subscriptions subscription
    WHERE subscription.id =
      '94200000-0000-4000-8000-000000000012'::uuid
  ),
  '94100000-0000-4000-8000-000000000009'::uuid,
  'administrative assignment can resolve a subscription owned by another verified sponsor'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'subscription_beneficiary_assignments'
      AND event.operation = 'INSERT'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        '94000000-0000-4000-8000-000000000104'::uuid
      AND event.effective_user_id =
        '94000000-0000-4000-8000-000000000102'::uuid
      AND event.tool = 'assign_blind_sponsorship_beneficiary_admin'
      AND event.request_id = 'request-blind-admin'
      AND event.trace_id = 'trace-blind-admin'
      AND event.reason =
        'Resolve sponsor request through the Creator Share support workflow'
      AND event.metadata ->> 'operation' = 'assign'
      AND event.metadata ->> 'resource_kind' = 'subscription'
      AND event.metadata ->> 'resource_id' =
        '94200000-0000-4000-8000-000000000012'
      AND event.metadata ->> 'outcome' = 'assigned'
  ),
  'administrative assignment distinguishes the administrator from the affected sponsor in audit evidence'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.subscription_beneficiary_assignments assignment
    WHERE assignment.subscription_id IN (
      '94200000-0000-4000-8000-000000000002'::uuid,
      '94200000-0000-4000-8000-000000000003'::uuid,
      '94200000-0000-4000-8000-000000000004'::uuid,
      '94200000-0000-4000-8000-000000000005'::uuid,
      '94200000-0000-4000-8000-000000000006'::uuid,
      '94200000-0000-4000-8000-000000000009'::uuid,
      '94200000-0000-4000-8000-000000000010'::uuid,
      '94200000-0000-4000-8000-000000000013'::uuid,
      '94200000-0000-4000-8000-000000000014'::uuid
    )
  ),
  0::bigint,
  'rejected ownership, eligibility, capacity, and bypass attempts leave no partial evidence'
);

SELECT * FROM extensions.finish();

ROLLBACK;
