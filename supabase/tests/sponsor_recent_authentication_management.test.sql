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
      'private.require_recent_sponsor_email_authentication()'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.record_sponsor_email_authentication_receipt(uuid,uuid,text,text)'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.begin_recent_sponsor_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.begin_super_admin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.authorize_sponsor_subscription_payment_management(uuid)'::regprocedure
  )
  AND (
    SELECT routine.prosecdef
      AND COALESCE(array_to_string(routine.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc routine
    WHERE routine.oid =
      'public.resolve_owned_subscription_payment_management(uuid,uuid)'::regprocedure
  ),
  'every sponsor management boundary is a locked security definer function'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_sponsor_email_authentication_receipt(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_sponsor_email_authentication_receipt(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.begin_recent_sponsor_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.begin_recent_sponsor_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.begin_super_admin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.authorize_sponsor_subscription_payment_management(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.authorize_sponsor_subscription_payment_management(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.resolve_owned_subscription_payment_management(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.resolve_owned_subscription_payment_management(uuid,uuid)',
    'EXECUTE'
  ),
  'browser authorization, receipt recording, and provider resolution are capability separated'
);

SELECT extensions.ok(
  (
    SELECT class.relrowsecurity AND class.relforcerowsecurity
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relname = 'sponsor_email_authentication_receipts'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.sponsor_email_authentication_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.sponsor_email_authentication_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.require_recent_sponsor_email_authentication()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.require_recent_sponsor_email_authentication()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.require_sponsor_management_service_role()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.require_sponsor_management_service_role()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.execute_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)',
    'EXECUTE'
  ),
  'receipt evidence and private authorization helpers cannot be read or called directly'
);

SELECT extensions.ok(
  position(
    'begin_recent_sponsor_subscription_cancellation'
    IN pg_get_functiondef(
      'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
    )
  ) > 0
  AND position(
    'begin_super_admin_sponsorship_subscription_cancellation'
    IN pg_get_functiondef(
      'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
    )
  ) > 0
  AND position(
    'session_user IN (''postgres'', ''supabase_admin'')'
    IN pg_get_functiondef(
      'public.begin_sponsorship_subscription_cancellation(uuid,text,text,text,text,text)'::regprocedure
    )
  ) = 0,
  'the compatibility RPC contains no trusted-session bypass'
);

SELECT extensions.ok(
  pg_get_function_result(
    'public.authorize_sponsor_subscription_payment_management(uuid)'::regprocedure
  ) = 'TABLE(authorized boolean)'
  AND position(
    'provider_' IN pg_get_function_result(
      'public.authorize_sponsor_subscription_payment_management(uuid)'::regprocedure
    )
  ) = 0
  AND position(
    'provider_customer_id' IN pg_get_function_result(
      'public.resolve_owned_subscription_payment_management(uuid,uuid)'::regprocedure
    )
  ) > 0
  AND position(
    'provider_subscription_id' IN pg_get_function_result(
      'public.resolve_owned_subscription_payment_management(uuid,uuid)'::regprocedure
    )
  ) > 0,
  'only the service resolver can return provider identifiers'
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
    '7a000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'recent-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    '7a000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'recent-other@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    '7a000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'recent-admin@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  );

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT
  '7a000000-0000-4000-8000-000000000003'::uuid,
  role.id,
  NULL,
  NULL
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

INSERT INTO public.sponsor_identities (
  id,
  auth_user_id
)
VALUES
  (
    '7c000000-0000-4000-8000-000000000001'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '7c000000-0000-4000-8000-000000000002'::uuid,
    '7a000000-0000-4000-8000-000000000002'::uuid
  );

INSERT INTO public.sponsor_identifiers (
  sponsor_identity_id,
  kind,
  issuer_scope,
  identifier_digest,
  normalization_version,
  hmac_key_version,
  confidence,
  verified_at
)
VALUES
  (
    '7c000000-0000-4000-8000-000000000001'::uuid,
    'email',
    'creator_share',
    decode(repeat('7e', 32), 'hex'),
    1,
    1,
    'verified',
    clock_timestamp()
  ),
  (
    '7c000000-0000-4000-8000-000000000002'::uuid,
    'email',
    'creator_share',
    decode(repeat('7f', 32), 'hex'),
    1,
    1,
    'verified',
    clock_timestamp()
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
    '7d000000-0000-4000-8000-000000000001'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '7d000000-0000-4000-8000-000000000002'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal2',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '7d000000-0000-4000-8000-000000000003'::uuid,
    '7a000000-0000-4000-8000-000000000002'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '7d000000-0000-4000-8000-000000000004'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '7d000000-0000-4000-8000-000000000005'::uuid,
    '7a000000-0000-4000-8000-000000000003'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '7d000000-0000-4000-8000-000000000006'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '2 hours',
    'aal1',
    clock_timestamp() - interval '1 hour'
  ),
  (
    '7d000000-0000-4000-8000-000000000007'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal2',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '7d000000-0000-4000-8000-000000000008'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp() - interval '20 minutes',
    clock_timestamp() - interval '20 minutes',
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    '7d000000-0000-4000-8000-000000000009'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  );

CREATE FUNCTION pg_temp.set_sponsor_test_jwt(
  target_user_id uuid,
  target_session_id text,
  target_aal text DEFAULT 'aal1',
  target_method text DEFAULT 'token_refresh',
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
      'aal', target_aal,
      'session_id', target_session_id,
      'amr', jsonb_build_array(
        jsonb_build_object(
          'method', target_method,
          'timestamp', v_now_epoch
        )
      )
    )::text,
    true
  );
END;
$$;

CREATE FUNCTION pg_temp.set_sponsor_service_jwt()
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

SELECT pg_temp.set_sponsor_service_jwt();

SET LOCAL ROLE service_role;

CREATE TEMP TABLE recent_receipt_result
ON COMMIT DROP
AS
SELECT *
FROM public.record_sponsor_email_authentication_receipt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000001'::uuid,
  'recent-receipt-request',
  'recent-receipt-trace'
);

SELECT extensions.ok(
  (
    SELECT receipt_expires_at > clock_timestamp() + interval '14 minutes'
      AND receipt_expires_at <= clock_timestamp() + interval '16 minutes'
    FROM recent_receipt_result
  ),
  'the service recorder creates a fifteen minute receipt for an exact live session'
);

SELECT count(*)
FROM public.record_sponsor_email_authentication_receipt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000002'::uuid
);

SELECT count(*)
FROM public.record_sponsor_email_authentication_receipt(
  '7a000000-0000-4000-8000-000000000002'::uuid,
  '7d000000-0000-4000-8000-000000000003'::uuid
);

SELECT count(*)
FROM public.record_sponsor_email_authentication_receipt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000004'::uuid
);

SELECT count(*)
FROM public.record_sponsor_email_authentication_receipt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000007'::uuid
);

SELECT count(*)
FROM public.record_sponsor_email_authentication_receipt(
  '7a000000-0000-4000-8000-000000000003'::uuid,
  '7d000000-0000-4000-8000-000000000005'::uuid
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.record_sponsor_email_authentication_receipt(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      '7d000000-0000-4000-8000-000000000003'::uuid
    )
  $$,
  '42501',
  'Sponsor email authentication receipt is not authorized',
  'the service recorder rejects a mismatched user and session pair'
);

RESET ROLE;

WITH expired_receipt_times AS (
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
  receipt.auth_session_id,
  '7a000000-0000-4000-8000-000000000001'::uuid,
  expired_receipt_times.authenticated_at,
  expired_receipt_times.authenticated_at + interval '15 minutes',
  expired_receipt_times.authenticated_at,
  expired_receipt_times.authenticated_at
FROM expired_receipt_times
CROSS JOIN (
  VALUES
    ('7d000000-0000-4000-8000-000000000006'::uuid),
    ('7d000000-0000-4000-8000-000000000008'::uuid)
) AS receipt(auth_session_id);

UPDATE public.payment_provider_accounts
SET environment = 'live'
WHERE provider = 'STRIPE'
  AND scope = 'stripe_us';

CREATE TEMP TABLE recent_management_context (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE recent_management_lease (
  gateway_event_id uuid PRIMARY KEY,
  processing_lease_token uuid NOT NULL
) ON COMMIT DROP;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON recent_management_context, recent_management_lease
  TO service_role;

INSERT INTO public.sponsorship_intents (
  id,
  idempotency_key,
  source,
  source_host,
  auth_user_id,
  sponsor_identity_id,
  contact_email_hmac,
  contact_email_normalization_version,
  contact_email_hmac_key_version,
  subject_kind,
  payment_mode,
  recurrence_interval,
  base_amount_usd_cents,
  charged_amount_minor,
  charged_currency,
  conversion_rate,
  currency_quote_at,
  currency_rate_source
)
VALUES (
  '7e000000-0000-4000-8000-000000000001'::uuid,
  'recent-management-intent-0001',
  'primary_site',
  'creatorshare.com',
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7c000000-0000-4000-8000-000000000001'::uuid,
  decode(repeat('7e', 32), 'hex'),
  1,
  1,
  'blind',
  'recurring',
  'month',
  2500,
  2500,
  'USD',
  1,
  clock_timestamp(),
  'recent-management-test'
);

INSERT INTO recent_management_context
VALUES (
  'intent',
  '7e000000-0000-4000-8000-000000000001'::uuid
);

SELECT pg_temp.set_sponsor_service_jwt();

SET LOCAL ROLE service_role;

INSERT INTO recent_management_context
SELECT 'quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id =>
    '7e000000-0000-4000-8000-000000000001'::uuid,
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'recent-management-quote-0001'
);

INSERT INTO recent_management_context
SELECT 'attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id =>
    '7e000000-0000-4000-8000-000000000001'::uuid,
  target_payment_quote_id => (
    SELECT value FROM recent_management_context WHERE key = 'quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'recent-management-provider-0001',
  target_checkout_receipt_digest => decode(repeat('71', 32), 'hex')
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id => (
    SELECT value FROM recent_management_context WHERE key = 'attempt'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_test_recent_management_0001'
);

INSERT INTO recent_management_context
SELECT 'gateway_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM recent_management_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_recent_management_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_test_recent_management_0001',
  target_redacted_payload => '{"payment_status":"paid"}'::jsonb,
  target_payload_ciphertext => decode('cafe', 'hex'),
  target_payload_sha256 => decode(repeat('72', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM recent_management_context WHERE key = 'attempt'
  ),
  target_fact_provider_movement_type => 'invoice',
  target_fact_provider_movement_id => 'in_recent_management_0001',
  target_fact_provider_customer_id => 'cus_recent_modern_001',
  target_fact_provider_subscription_id => 'sub_recent_modern_001',
  target_fact_base_amount_usd_cents => 2500,
  target_fact_charged_amount_minor => 2500,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1,
  target_fact_period_start => clock_timestamp(),
  target_fact_period_end => clock_timestamp() + interval '1 month'
);

INSERT INTO recent_management_lease
SELECT gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events('recent-management-worker', 10)
WHERE gateway_event_id = (
  SELECT value FROM recent_management_context WHERE key = 'gateway_event'
);

INSERT INTO recent_management_context
SELECT 'subscription', subscription_id
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM recent_management_lease
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM recent_management_lease
  ),
  target_claim_token_digest => decode(repeat('73', 32), 'hex'),
  target_recipient_email_ciphertext => decode('010203', 'hex'),
  target_email_encryption_key_version => 1::smallint,
  target_secret_payload_ciphertext => decode('040506', 'hex'),
  target_welcome_template_key => 'sponsor-welcome-v1',
  target_welcome_template_data => '{"locale":"en-US"}'::jsonb
);

RESET ROLE;

INSERT INTO public.subscriptions (
  id,
  user_id,
  sponsor_identity_id,
  status,
  sponsorship_method,
  stripe_subscription_id,
  payment_region,
  customer_id,
  provider_account_scope,
  provider_subscription_object_type,
  provider_subscription_object_id
)
VALUES
  (
    '7b000000-0000-4000-8000-000000000001'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    '7c000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_recent_receipt_001',
    'us',
    'cus_recent_receipt_001',
    'stripe_us',
    'subscription',
    'sub_recent_receipt_001'
  ),
  (
    '7b000000-0000-4000-8000-000000000002'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    '7c000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_recent_aal2_002',
    'uk',
    'cus_recent_aal2_002',
    'stripe_uk',
    'subscription',
    'sub_recent_aal2_002'
  ),
  (
    '7b000000-0000-4000-8000-000000000003'::uuid,
    '7a000000-0000-4000-8000-000000000002'::uuid,
    '7c000000-0000-4000-8000-000000000002'::uuid,
    'complete',
    'STRIPE',
    'sub_recent_admin_003',
    'us',
    'cus_recent_admin_003',
    'stripe_us',
    'subscription',
    'sub_recent_admin_003'
  ),
  (
    '7b000000-0000-4000-8000-000000000004'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    '7c000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_manage_stripe_004',
    'us',
    'cus_manage_stripe_004',
    'stripe_us',
    'subscription',
    'sub_manage_stripe_004'
  ),
  (
    '7b000000-0000-4000-8000-000000000005'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    '7c000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'PAYPAL',
    'I-MANAGE-PAYPAL-005',
    'us',
    'PAYER-MANAGE-005',
    'paypal',
    'billing_subscription',
    'I-MANAGE-PAYPAL-005'
  ),
  (
    '7b000000-0000-4000-8000-000000000006'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    '7c000000-0000-4000-8000-000000000002'::uuid,
    'complete',
    'STRIPE',
    'sub_manage_owner_conflict_006',
    'us',
    'cus_manage_owner_conflict_006',
    'stripe_us',
    'subscription',
    'sub_manage_owner_conflict_006'
  ),
  (
    '7b000000-0000-4000-8000-000000000007'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    '7c000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_manage_legacy_conflict_007',
    'us',
    'cus_manage_conflict_007',
    'stripe_us',
    'subscription',
    'sub_manage_modern_conflict_007'
  ),
  (
    '7b000000-0000-4000-8000-000000000012'::uuid,
    '7a000000-0000-4000-8000-000000000003'::uuid,
    NULL,
    'complete',
    'STRIPE',
    'sub_recent_admin_personal_011',
    'us',
    'cus_recent_admin_personal_011',
    'stripe_us',
    'subscription',
    'sub_recent_admin_personal_011'
  );

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000009',
  'aal1',
  'magiclink'
);

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_recent_sponsor_subscription_cancellation(
      '7b000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'a magiclink AMR claim without a server receipt is rejected'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_subscription_cancellation(
      '7b000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'the compatibility RPC does not bypass receipt verification for session user postgres'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  'not-a-session-uuid',
  'aal1',
  'magiclink'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'a malformed signed session identifier is rejected'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000003',
  'aal1',
  'magiclink'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'a live session and receipt belonging to another user are rejected'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000006',
  'aal1',
  'magiclink'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'an expired Auth session is rejected even when a receipt row exists'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000007',
  'aal1',
  'magiclink'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'the signed assurance level must match the live Auth session'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000008',
  'aal1',
  'magiclink'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'an expired server receipt is rejected'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000001',
  'aal1',
  'magiclink',
  61
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'a JWT issued more than sixty seconds in the future is rejected'
);

RESET ROLE;

UPDATE auth.users
SET banned_until = clock_timestamp() + interval '1 hour'
WHERE id = '7a000000-0000-4000-8000-000000000001'::uuid;

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000001',
  'aal1',
  'token_refresh'
);

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '42501',
  'recent-verification-required: verify your email again to continue',
  'a sponsor banned after receipt issuance is rejected at action time'
);

RESET ROLE;

UPDATE auth.users
SET banned_until = NULL
WHERE id = '7a000000-0000-4000-8000-000000000001'::uuid;

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000001',
  'aal1',
  'token_refresh'
);

CREATE TEMP TABLE recent_owner_cancellation
ON COMMIT DROP
AS
SELECT cancellation.*
FROM public.begin_recent_sponsor_subscription_cancellation(
  '7b000000-0000-4000-8000-000000000001'::uuid,
  'recent-owner-cancellation'
) cancellation;

SELECT extensions.ok(
  (
    SELECT cancellation_status = 'pending'
      AND NOT is_terminal
      AND NOT replayed
    FROM recent_owner_cancellation
  ),
  'a live session with a server email receipt authorizes owner cancellation regardless of AMR vocabulary'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000002',
  'aal2',
  'password'
);

CREATE TEMP TABLE recent_aal2_cancellation
ON COMMIT DROP
AS
SELECT cancellation.*
FROM public.begin_recent_sponsor_subscription_cancellation(
  '7b000000-0000-4000-8000-000000000002'::uuid,
  'recent-aal2-cancellation'
) cancellation;

SELECT extensions.ok(
  (
    SELECT cancellation_status = 'pending'
      AND NOT is_terminal
      AND NOT replayed
    FROM recent_aal2_cancellation
  ),
  'a matching aal2 Auth session and server receipt authorize owner cancellation'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000004',
  'aal1',
  'token_refresh'
);

SELECT extensions.is(
  (
    SELECT authorized
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  true,
  'the privacy-safe browser RPC authorizes a recently verified owner'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000002'::uuid,
  '7d000000-0000-4000-8000-000000000003',
  'aal1',
  'token_refresh'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '42501',
  'Subscription payment management is not authorized',
  'recent authentication never grants payment management over another account'
);

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000001'::uuid,
  '7d000000-0000-4000-8000-000000000004',
  'aal1',
  'token_refresh'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.authorize_sponsor_subscription_payment_management(
      '7b000000-0000-4000-8000-000000000006'::uuid
    )
  $$,
  '42501',
  'Subscription payment management is not authorized',
  'conflicting direct and sponsor identity ownership fails closed'
);

RESET ROLE;

SELECT pg_temp.set_sponsor_test_jwt(
  '7a000000-0000-4000-8000-000000000003'::uuid,
  '7d000000-0000-4000-8000-000000000005',
  'aal1',
  'token_refresh'
);

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE recent_admin_personal_cancellation
ON COMMIT DROP
AS
SELECT cancellation.*
FROM public.begin_sponsorship_subscription_cancellation(
  target_subscription_id =>
    '7b000000-0000-4000-8000-000000000012'::uuid,
  context_request_id => 'recent-admin-personal-cancellation'
) cancellation;

SELECT extensions.ok(
  (
    SELECT cancellation_status = 'pending'
      AND NOT is_terminal
      AND NOT replayed
    FROM recent_admin_personal_cancellation
  ),
  'a global administrator manages a personally owned sponsorship through the recent sponsor policy'
);

RESET ROLE;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.id = (
      SELECT cancellation_operation_id
      FROM recent_admin_personal_cancellation
    )
      AND NOT operation.requester_is_super_admin
      AND operation.requested_by_user_id =
        '7a000000-0000-4000-8000-000000000003'::uuid
      AND operation.effective_user_id =
        '7a000000-0000-4000-8000-000000000003'::uuid
  ),
  'personal cancellation records the administrator as the sponsor rather than an override actor'
);

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_super_admin_sponsorship_subscription_cancellation(
      '7b000000-0000-4000-8000-000000000003'::uuid
    )
  $$,
  '22023',
  'A specific administrator cancellation reason is required',
  'the explicit administrator path always requires a specific reason'
);

RESET ROLE;

UPDATE auth.users
SET banned_until = clock_timestamp() + interval '1 hour'
WHERE id = '7a000000-0000-4000-8000-000000000003'::uuid;

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_super_admin_sponsorship_subscription_cancellation(
      target_subscription_id =>
        '7b000000-0000-4000-8000-000000000003'::uuid,
      request_reason => 'Resolve a verified duplicate recurring sponsorship'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'the administrator path rejects a banned administrator account'
);

RESET ROLE;

UPDATE auth.users
SET banned_until = NULL
WHERE id = '7a000000-0000-4000-8000-000000000003'::uuid;

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE recent_admin_cancellation
ON COMMIT DROP
AS
SELECT cancellation.*
FROM public.begin_super_admin_sponsorship_subscription_cancellation(
  target_subscription_id =>
    '7b000000-0000-4000-8000-000000000003'::uuid,
  context_request_id => 'recent-admin-cancellation',
  request_reason => 'Resolve a verified duplicate recurring sponsorship'
) cancellation;

SELECT extensions.ok(
  (
    SELECT cancellation_status = 'pending'
      AND NOT is_terminal
    FROM recent_admin_cancellation
  ),
  'a healthy reason-gated administrator can begin cancellation without sponsor reauthentication'
);

RESET ROLE;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_subscription_cancellations operation
    WHERE operation.id = (
      SELECT cancellation_operation_id FROM recent_admin_cancellation
    )
      AND operation.requester_is_super_admin
      AND operation.requested_by_user_id =
        '7a000000-0000-4000-8000-000000000003'::uuid
  ),
  'the administrator cancellation records the overriding global administrator'
);

SELECT pg_temp.set_sponsor_service_jwt();

SET LOCAL ROLE service_role;

SELECT extensions.is(
  (
    SELECT format(
      '%s|%s|%s|%s',
      payment_provider,
      provider_account_scope,
      provider_customer_id,
      provider_subscription_id
    )
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  'STRIPE|stripe_us|cus_manage_stripe_004|sub_manage_stripe_004',
  'the service resolver returns an exclusively owned legacy Stripe chain'
);

SELECT extensions.is(
  (
    SELECT format(
      '%s|%s|%s|%s',
      payment_provider,
      provider_account_scope,
      provider_customer_id,
      provider_subscription_id
    )
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      (SELECT value FROM recent_management_context WHERE key = 'subscription')
    )
  ),
  'STRIPE|stripe_us|cus_recent_modern_001|sub_recent_modern_001',
  'the service resolver validates the complete modern payment chain'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000002'::uuid,
      (SELECT value FROM recent_management_context WHERE key = 'subscription')
    )
  $$,
  '42501',
  'Subscription payment management is not authorized',
  'the modern payment chain rejects a mismatched account id'
);

SELECT extensions.is(
  (
    SELECT format(
      '%s|%s|%s|%s',
      payment_provider,
      provider_account_scope,
      provider_customer_id,
      provider_subscription_id
    )
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      '7b000000-0000-4000-8000-000000000005'::uuid
    )
  ),
  'PAYPAL|paypal|PAYER-MANAGE-005|I-MANAGE-PAYPAL-005',
  'the service resolver distinguishes an owned PayPal chain'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      '7b000000-0000-4000-8000-000000000006'::uuid
    )
  $$,
  '42501',
  'Subscription payment management is not authorized',
  'the service resolver independently rejects ownership conflict'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      '7b000000-0000-4000-8000-000000000007'::uuid
    )
  $$,
  '23514',
  'Subscription payment management provider chain is invalid',
  'conflicting modern and legacy provider references fail closed'
);

RESET ROLE;

INSERT INTO public.subscriptions (
  id,
  user_id,
  sponsor_identity_id,
  status,
  sponsorship_method,
  stripe_subscription_id,
  payment_region,
  customer_id,
  provider_account_scope,
  provider_subscription_object_type,
  provider_subscription_object_id
)
VALUES
  (
    '7b000000-0000-4000-8000-000000000008'::uuid,
    '7a000000-0000-4000-8000-000000000002'::uuid,
    '7c000000-0000-4000-8000-000000000002'::uuid,
    'complete',
    'STRIPE',
    'sub_recent_modern_conflict_008',
    'us',
    'cus_recent_modern_001',
    'stripe_us',
    'subscription',
    'sub_recent_modern_conflict_008'
  ),
  (
    '7b000000-0000-4000-8000-000000000009'::uuid,
    '7a000000-0000-4000-8000-000000000002'::uuid,
    '7c000000-0000-4000-8000-000000000002'::uuid,
    'complete',
    'STRIPE',
    'sub_manage_stripe_conflict_009',
    'us',
    'cus_manage_stripe_004',
    'stripe_us',
    'subscription',
    'sub_manage_stripe_conflict_009'
  ),
  (
    '7b000000-0000-4000-8000-000000000010'::uuid,
    '7a000000-0000-4000-8000-000000000001'::uuid,
    '7c000000-0000-4000-8000-000000000001'::uuid,
    'complete',
    'STRIPE',
    'sub_manage_scope_target_010',
    'us',
    'cus_manage_scope_ambiguity_010',
    'stripe_us',
    'subscription',
    'sub_manage_scope_target_010'
  ),
  (
    '7b000000-0000-4000-8000-000000000011'::uuid,
    '7a000000-0000-4000-8000-000000000002'::uuid,
    '7c000000-0000-4000-8000-000000000002'::uuid,
    'complete',
    'STRIPE',
    'sub_manage_scope_conflict_011',
    'us',
    'cus_manage_scope_ambiguity_010',
    'stripe_uk',
    'subscription',
    'sub_manage_scope_conflict_011'
  );

SELECT pg_temp.set_sponsor_service_jwt();

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      (SELECT value FROM recent_management_context WHERE key = 'subscription')
    )
  $$,
  '23514',
  'Subscription payment management provider customer ownership is ambiguous',
  'a modern chain cannot open a customer-wide portal shared with another sponsor'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      '7b000000-0000-4000-8000-000000000004'::uuid
    )
  $$,
  '23514',
  'Subscription payment management provider customer ownership is ambiguous',
  'a legacy chain cannot open a customer-wide portal shared with another sponsor'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resolve_owned_subscription_payment_management(
      '7a000000-0000-4000-8000-000000000001'::uuid,
      '7b000000-0000-4000-8000-000000000010'::uuid
    )
  $$,
  '23514',
  'Subscription payment management provider customer ownership is ambiguous',
  'a contradictory legacy scope and region cannot hide a shared Stripe customer'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
