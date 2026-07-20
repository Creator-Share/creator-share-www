BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(26);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

SELECT extensions.is(
  auth.role(),
  'service_role',
  'auth.role resolves the current consolidated service role claim'
);

SELECT extensions.lives_ok(
  $$SELECT private.require_payment_service_role()$$,
  'the payment guard accepts a consolidated service role claim'
);

SELECT extensions.lives_ok(
  $$SELECT private.require_data_retention_service_role()$$,
  'the retention guard accepts a consolidated service role claim'
);

SELECT extensions.lives_ok(
  $$SELECT private.require_advocate_logo_service_role()$$,
  'the advocate logo guard accepts a consolidated service role claim'
);

SELECT extensions.lives_ok(
  $$SELECT private.require_advocate_invitation_service_role()$$,
  'the advocate invitation guard accepts a consolidated service role claim'
);

SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"97000000-0000-4000-8000-000000000001"}',
  true
);

SELECT extensions.throws_ok(
  $$SELECT private.require_payment_service_role()$$,
  '42501',
  'Payment transaction RPCs require the service role',
  'a presented authenticated claim overrides the privileged SQL fallback for payments'
);

SELECT extensions.throws_ok(
  $$SELECT private.require_data_retention_service_role()$$,
  '42501',
  'Data retention RPCs require the service role',
  'a presented authenticated claim overrides the privileged SQL fallback for retention'
);

SELECT extensions.throws_ok(
  $$SELECT private.require_advocate_logo_service_role()$$,
  '42501',
  'Advocate logo RPCs require the service role',
  'a presented authenticated claim overrides the privileged SQL fallback for advocate logos'
);

SELECT extensions.throws_ok(
  $$SELECT private.require_advocate_invitation_service_role()$$,
  '42501',
  'Advocate invitation service role is required',
  'a presented authenticated claim overrides the privileged SQL fallback for advocate invitations'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claims', '{}', true);

SELECT extensions.lives_ok(
  $compatibility_sql_fallback$
    SELECT
      private.require_payment_service_role(),
      private.require_data_retention_service_role(),
      private.require_advocate_logo_service_role(),
      private.require_advocate_invitation_service_role()
  $compatibility_sql_fallback$,
  'direct PostgreSQL maintenance retains the narrow no-claim fallback'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{}', true);

SELECT extensions.is(
  auth.role(),
  'service_role',
  'auth.role retains compatibility with the legacy scalar role claim'
);

SELECT extensions.lives_ok(
  $compatibility_legacy_claim$
    SELECT
      private.require_payment_service_role(),
      private.require_data_retention_service_role(),
      private.require_advocate_logo_service_role(),
      private.require_advocate_invitation_service_role()
  $compatibility_legacy_claim$,
  'all shared service guards retain legacy scalar claim compatibility'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_proc routine
    WHERE routine.oid IN (
      'private.require_payment_service_role()'::regprocedure,
      'private.require_data_retention_service_role()'::regprocedure,
      'private.require_advocate_logo_service_role()'::regprocedure,
      'private.require_advocate_invitation_service_role()'::regprocedure
    )
      AND routine.prosecdef
      AND coalesce(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
      AND NOT has_function_privilege(
        'service_role',
        routine.oid,
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        routine.oid,
        'EXECUTE'
      )
  ),
  4,
  'all shared service guards remain locked security definer internals'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.proname IN (
        'assign_blind_sponsorship_beneficiary',
        'assign_blind_sponsorship_beneficiary_admin',
        'begin_sponsorship_subscription_cancellation',
        'claim_legacy_subscriptions_for_verified_email',
        'consume_sponsorship_account_claim',
        'get_my_legacy_paypal_subscription_presentation',
        'list_my_one_time_sponsorship_history',
        'list_my_recurring_sponsorships',
        'read_paypal_checkout_capture_material_v2',
        'redeem_advocate_invitation'
      )
      AND position('auth.role()' IN pg_get_functiondef(routine.oid)) > 0
      AND position(
        'request.jwt.claim.role' IN pg_get_functiondef(routine.oid)
      ) = 0
  ),
  10,
  'every inline runtime role gate uses the consolidated claim compatible resolver'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname IN ('audit', 'private', 'public')
      AND position(
        'request.jwt.claim.role' IN CASE
          WHEN routine.prokind IN ('f', 'p')
            THEN pg_get_functiondef(routine.oid)
          ELSE ''
        END
      ) > 0
  ),
  0,
  'no application runtime function reads the deprecated singular role claim directly'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

SELECT extensions.throws_ok(
  $compatibility_exposure$
    SELECT *
    FROM public.record_qualified_advocate_exposure(
      target_event_key => NULL,
      target_visitor_token_digest => decode(repeat('ab', 32), 'hex'),
      target_advocate_hostname => 'compatibility.invalid',
      target_consent_state => 'not_required'
    )
  $compatibility_exposure$,
  '22023',
  'Qualified advocate exposure identity is malformed',
  'a consolidated service role claim crosses the payment guard into exposure validation'
);

SELECT extensions.throws_ok(
  $compatibility_paypal_capture$
    SELECT *
    FROM public.read_paypal_checkout_capture_material_v2(NULL, NULL)
  $compatibility_paypal_capture$,
  '22023',
  'PayPal checkout capture scope is malformed',
  'a consolidated service role claim crosses the inline PayPal capture guard'
);

SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"97000000-0000-4000-8000-000000000001","session_id":"97000000-0000-4000-8000-000000000901"}',
  true
);

SELECT extensions.is(
  auth.role(),
  'authenticated',
  'auth.role resolves the current consolidated authenticated claim'
);

SELECT extensions.lives_ok(
  $$SELECT * FROM public.list_my_recurring_sponsorships()$$,
  'a consolidated authenticated claim crosses the recurring sponsorship role gate'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.list_my_one_time_sponsorship_history(0)$$,
  '22023',
  'Sponsorship history limit must be between 1 and 100',
  'a consolidated authenticated claim crosses the one time history role gate'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.consume_sponsorship_account_claim(NULL)$$,
  '22023',
  'Account claim token digest is malformed',
  'a consolidated authenticated claim crosses the account claim role gate'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.assign_blind_sponsorship_beneficiary(NULL, NULL)$$,
  '23514',
  'Blind sponsorship assignment requires a verified account',
  'a consolidated authenticated claim crosses the blind assignment role gate'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.begin_sponsorship_subscription_cancellation(NULL)$$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'a consolidated authenticated claim crosses the cancellation role gate into recent verification'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.claim_legacy_subscriptions_for_verified_email(NULL)$$,
  '22023',
  'Legacy subscription claim email proof is malformed',
  'a consolidated authenticated claim crosses the legacy claim role gate'
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
VALUES (
  '97000000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'postgrest-compatibility@example.test',
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
VALUES (
  '97000000-0000-4000-8000-000000000901'::uuid,
  '97000000-0000-4000-8000-000000000001'::uuid,
  clock_timestamp(),
  clock_timestamp(),
  'aal1',
  clock_timestamp() + interval '1 hour'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.redeem_advocate_invitation(repeat('0', 64), 'Compatibility test')$$,
  '42501',
  'Invitation is invalid or unavailable',
  'a consolidated authenticated claim crosses the invitation redemption role gate'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.get_my_legacy_paypal_subscription_presentation('bad')$$,
  '22023',
  'PayPal subscription identifier is malformed',
  'a consolidated authenticated claim crosses the legacy PayPal projection role gate'
);

SELECT * FROM extensions.finish();

ROLLBACK;
