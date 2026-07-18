BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

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
    '9d000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'recurring-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '9d000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'recurring-other@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '9d000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'recurring-admin@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT
  '9d000000-0000-4000-8000-000000000003'::uuid,
  role.id,
  NULL,
  NULL
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

INSERT INTO public.sponsor_identities (
  id,
  auth_user_id,
  status
)
VALUES
  (
    '9d000000-0000-4000-8000-000000000301'::uuid,
    '9d000000-0000-4000-8000-000000000001'::uuid,
    'active'
  ),
  (
    '9d000000-0000-4000-8000-000000000302'::uuid,
    '9d000000-0000-4000-8000-000000000002'::uuid,
    'active'
  );

INSERT INTO public.beneficiaries (
  id,
  name,
  username,
  location_str,
  budget_goal,
  status
)
VALUES (
  '9d000000-0000-4000-8000-000000000201'::uuid,
  '  Projection' || chr(10) || chr(9) || 'Child  ',
  '  projection' || chr(1) || 'child  ',
  '  Arusha' || chr(10) || 'Tanzania  ',
  -1,
  'New'
);

INSERT INTO public.subscriptions (
  id,
  user_id,
  sponsor_identity_id,
  beneficiary_id,
  status,
  amount,
  interval,
  current_period_end,
  customer_id,
  email,
  sponsorship_method,
  stripe_subscription_id,
  provider_account_scope,
  provider_subscription_object_type,
  provider_subscription_object_id,
  subject_kind
)
VALUES
  (
    '9d000000-0000-4000-8000-000000000101'::uuid,
    '9d000000-0000-4000-8000-000000000001'::uuid,
    '9d000000-0000-4000-8000-000000000301'::uuid,
    '9d000000-0000-4000-8000-000000000201'::uuid,
    'complete',
    6000,
    'month',
    '2026-08-18 10:00:00',
    'payer-owner-secret',
    'owner-contact@example.test',
    'PAYPAL',
    NULL,
    'paypal',
    'billing_subscription',
    'I-PROJECTION-OWNER-101',
    'standard'
  ),
  (
    '9d000000-0000-4000-8000-000000000102'::uuid,
    NULL,
    '9d000000-0000-4000-8000-000000000301'::uuid,
    '9d000000-0000-4000-8000-000000000201'::uuid,
    'cancelled',
    2400,
    'year',
    '2027-07-18 10:00:00',
    'payer-legacy-secret',
    'legacy-contact@example.test',
    'PAYPAL',
    'I-PROJECTION-LEGACY-102',
    NULL,
    NULL,
    NULL,
    'standard'
  ),
  (
    '9d000000-0000-4000-8000-000000000103'::uuid,
    '9d000000-0000-4000-8000-000000000002'::uuid,
    NULL,
    NULL,
    'complete',
    3600,
    'month',
    '2026-08-19 10:00:00',
    'customer-other-secret',
    'other-contact@example.test',
    'STRIPE',
    'sub_projection_other_103',
    'stripe_us',
    'subscription',
    'sub_projection_other_103',
    'blind'
  ),
  (
    '9d000000-0000-4000-8000-000000000104'::uuid,
    '9d000000-0000-4000-8000-000000000001'::uuid,
    '9d000000-0000-4000-8000-000000000302'::uuid,
    '9d000000-0000-4000-8000-000000000201'::uuid,
    'complete',
    1200,
    'month',
    '2026-08-20 10:00:00',
    'payer-conflict-secret',
    'conflict-contact@example.test',
    'PAYPAL',
    NULL,
    'paypal',
    'billing_subscription',
    'I-PROJECTION-CONFLICT-104',
    'standard'
  );

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.subscriptions'::regclass
  )
  AND has_table_privilege(
    'authenticated',
    'public.subscriptions',
    'SELECT'
  ),
  'the base table keeps RLS and authenticated table privilege for the admin policy'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'subscriptions'
      AND policy.policyname = 'subscriptions_select_super_admin'
      AND policy.roles = ARRAY['authenticated']::name[]
      AND policy.qual LIKE '%is_creator_share_super_admin%'
      AND policy.qual NOT LIKE '%user_id%'
      AND policy.qual NOT LIKE '%auth.uid%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'subscriptions'
      AND policy.policyname <> 'subscriptions_select_super_admin'
      AND 'authenticated' = ANY(policy.roles)
  ),
  'only Creator Share super administrators can select the base subscription table'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.list_my_recurring_sponsorships()',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.list_my_recurring_sponsorships()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.list_my_recurring_sponsorships()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_my_legacy_paypal_subscription_presentation(text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.get_my_legacy_paypal_subscription_presentation(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.get_my_legacy_paypal_subscription_presentation(text)',
    'EXECUTE'
  ),
  'only authenticated sponsor sessions can execute the safe projections'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  $$
    SELECT * FROM public.list_my_recurring_sponsorships()
  $$,
  '42501',
  'Recurring sponsorships require an authenticated account',
  'anonymous callers cannot list recurring sponsorships'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.list_my_recurring_sponsorships()
  ),
  2::bigint,
  'the sponsor recurring projection returns only the owner rows'
);

SELECT extensions.ok(
  (
    SELECT
      recurring.subscription_status = 'complete'
      AND recurring.amount_usd_cents = 6000
      AND recurring.recurrence_interval = 'month'
      AND recurring.subject_kind = 'standard'
      AND recurring.partnership_project IS NULL
      AND recurring.beneficiary_name = 'Projection Child'
      AND recurring.beneficiary_username = 'projection child'
    FROM public.list_my_recurring_sponsorships() recurring
    WHERE recurring.subscription_id =
      '9d000000-0000-4000-8000-000000000101'::uuid
  ),
  'the recurring projection exposes sanitized beneficiary and UI state'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.list_my_recurring_sponsorships() recurring
    WHERE recurring.subscription_id =
      '9d000000-0000-4000-8000-000000000102'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.list_my_recurring_sponsorships() recurring
    WHERE recurring.subscription_id =
      '9d000000-0000-4000-8000-000000000104'::uuid
  ),
  'active identity ownership is accepted while contradictory dual ownership is excluded'
);

SELECT extensions.ok(
  (
    SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(recurring))::text
      NOT LIKE '%owner-contact@example.test%'
      AND pg_catalog.jsonb_agg(pg_catalog.to_jsonb(recurring))::text
        NOT LIKE '%payer-owner-secret%'
      AND pg_catalog.jsonb_agg(pg_catalog.to_jsonb(recurring))::text
        NOT LIKE '%I-PROJECTION-OWNER-101%'
    FROM public.list_my_recurring_sponsorships() recurring
  ),
  'the recurring projection cannot reveal contact or provider identifiers'
);

SELECT extensions.is(
  (
    SELECT array_agg(argument.name ORDER BY argument.ordinality)::text
    FROM pg_catalog.pg_proc procedure
    CROSS JOIN LATERAL unnest(
      procedure.proargnames,
      procedure.proargmodes
    ) WITH ORDINALITY AS argument(name, mode, ordinality)
    WHERE procedure.oid =
      'public.list_my_recurring_sponsorships()'::regprocedure
      AND argument.mode = 't'
  ),
  ARRAY[
    'subscription_id',
    'beneficiary_id',
    'subscription_status',
    'amount_usd_cents',
    'recurrence_interval',
    'current_period_end',
    'subject_kind',
    'partnership_project',
    'beneficiary_name',
    'beneficiary_username'
  ]::text,
  'the recurring projection output has only the exact sponsor UI fields'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.get_my_legacy_paypal_subscription_presentation(
      'I-PROJECTION-OWNER-101'
    )
  ),
  1::bigint,
  'the owner can personalize a canonical PayPal subscription return'
);

SELECT extensions.ok(
  (
    SELECT
      presentation.subscription_status = 'complete'
      AND presentation.amount_usd_cents = 6000
      AND presentation.recurrence_interval = 'month'
      AND presentation.charged_currency = 'USD'
      AND presentation.beneficiary_name = 'Projection Child'
      AND presentation.beneficiary_location = 'Arusha Tanzania'
    FROM public.get_my_legacy_paypal_subscription_presentation(
      'I-PROJECTION-OWNER-101'
    ) presentation
  ),
  'PayPal return personalization contains only safe owner presentation'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.get_my_legacy_paypal_subscription_presentation(
      'I-PROJECTION-LEGACY-102'
    )
  ),
  1::bigint,
  'the owner safe PayPal projection supports legacy stored identifiers'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.get_my_legacy_paypal_subscription_presentation(
      'I-PROJECTION-CONFLICT-104'
    )
  ),
  0::bigint,
  'contradictory dual ownership cannot personalize a PayPal return'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.ok(
  (
    SELECT count(*) = 1
      AND min(recurring.subscription_id::text) =
        '9d000000-0000-4000-8000-000000000103'
    FROM public.list_my_recurring_sponsorships() recurring
  ),
  'another sponsor sees only their own recurring sponsorship'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.get_my_legacy_paypal_subscription_presentation(
      'I-PROJECTION-OWNER-101'
    )
  ),
  0::bigint,
  'another sponsor cannot personalize the owner PayPal subscription'
);

SELECT extensions.is(
  (
    SELECT array_agg(argument.name ORDER BY argument.ordinality)::text
    FROM pg_catalog.pg_proc procedure
    CROSS JOIN LATERAL unnest(
      procedure.proargnames,
      procedure.proargmodes
    ) WITH ORDINALITY AS argument(name, mode, ordinality)
    WHERE procedure.oid =
      'public.get_my_legacy_paypal_subscription_presentation(text)'::regprocedure
      AND argument.mode = 't'
  ),
  ARRAY[
    'subscription_status',
    'amount_usd_cents',
    'recurrence_interval',
    'charged_amount_minor',
    'charged_currency',
    'beneficiary_name',
    'beneficiary_location'
  ]::text,
  'the PayPal projection never returns its lookup identifier or owner identity'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.get_my_legacy_paypal_subscription_presentation(
      'not-a-paypal-subscription'
    )
  $$,
  '22023',
  'PayPal subscription identifier is malformed',
  'the PayPal projection rejects malformed lookup identifiers'
);

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM (
      SELECT
        subscription.email,
        subscription.customer_id,
        subscription.stripe_subscription_id,
        subscription.provider_subscription_object_id
      FROM public.subscriptions subscription
    ) private_subscription_fields
  ),
  0::bigint,
  'a sponsor cannot select base contact or provider identifier columns'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000003',
  true
);

SELECT extensions.is(
  (SELECT count(*) FROM public.subscriptions),
  4::bigint,
  'a Creator Share super administrator retains base subscription access'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
