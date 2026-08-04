BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE checkout_tenant_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE checkout_tenant_test_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.activate_checkout_tenant_domain(
  target_domain_id uuid,
  worker_id text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_claim record;
  v_evidence jsonb;
  v_hostname text;
  v_completed integer := 0;
BEGIN
  SELECT domain.hostname
  INTO v_hostname
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id;

  IF v_hostname IS NULL THEN
    RAISE EXCEPTION 'Test advocate domain is missing';
  END IF;

  PERFORM public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'provision',
    clock_timestamp(),
    worker_id || ':' || integration.provider::text
  )
  FROM public.advocate_domain_integrations integration
  WHERE integration.domain_id = target_domain_id;

  FOR v_claim IN
    SELECT *
    FROM public.claim_domain_provisioning_jobs(
      worker_id,
      5,
      interval '10 minutes'
    )
  LOOP
    IF v_claim.domain_id IS DISTINCT FROM target_domain_id THEN
      RAISE EXCEPTION 'Test worker claimed an unrelated domain job';
    END IF;

    v_evidence := CASE v_claim.provider
      WHEN 'cloudflare' THEN jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('a', 32),
        'dns_record_id', repeat('a', 32),
        'http_status', 200,
        'verified', true
      )
      WHEN 'vercel' THEN jsonb_build_object(
        'provider_status', 'attached_verified',
        'provider_resource_id', v_hostname,
        'deployment_id', worker_id || '_deployment',
        'http_status', 200,
        'verified', true
      )
      ELSE jsonb_build_object(
        'provider_status', 'payment_path_ready',
        'provider_resource_id',
          v_claim.provider::text || ':hosted_checkout',
        'http_status', 200,
        'verified', true
      )
    END;

    PERFORM public.record_domain_provisioning_reconciliation(
      v_claim.job_id,
      v_claim.lease_token,
      'matches_intent',
      v_evidence
    );
    PERFORM public.complete_domain_provisioning_job(
      v_claim.job_id,
      v_claim.lease_token,
      'succeeded',
      NULL,
      v_evidence
    );
    v_completed := v_completed + 1;
  END LOOP;

  IF v_completed <> 5 THEN
    RAISE EXCEPTION 'Test domain did not settle all five provider jobs';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.checkout_tenant_provider_claims(
  target_operation_id uuid,
  target_intent_id uuid,
  target_quote_id uuid,
  target_request_fingerprint bytea,
  target_request_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'canonical_json_version', 1,
    'provider', operation.provider::text,
    'provider_account_scope', operation.provider_account_scope,
    'checkout_operation_id', operation.operation_id::text,
    'sponsorship_intent_id', intent.id::text,
    'payment_quote_id', quote.id::text,
    'payment_attempt_id_placeholder',
      '{"$creator_share":"server_payment_attempt_id","type":"uuid"}'::jsonb,
    'payment_attempt_id_placeholder_path', '/paymentAttemptId',
    'unresolved_placeholder_count', 1,
    'financial_terms', jsonb_build_object(
      'payment_mode', quote.payment_mode::text,
      'recurrence_interval', quote.recurrence_interval,
      'base_amount_usd_cents', quote.base_amount_usd_cents,
      'charged_amount_minor', quote.charged_amount_minor,
      'charged_currency', quote.charged_currency::text,
      'conversion_rate', quote.conversion_rate,
      'currency_quote_at_epoch_microseconds',
        (extract(epoch FROM intent.currency_quote_at) * 1000000)::bigint
    ),
    'sponsor_email_binding', jsonb_build_object(
      'representation', 'encrypted_in_template',
      'normalization_version', intent.contact_email_normalization_version,
      'hmac_key_version', intent.contact_email_hmac_key_version,
      'hmac_sha256', encode(intent.contact_email_hmac, 'hex')
    ),
    'product_display_fields_sha256', repeat('4a', 32),
    'return_urls_sha256', repeat('5b', 32),
    'provider_request_expires_at_epoch_microseconds',
      (extract(epoch FROM target_request_expires_at) * 1000000)::bigint,
    'canonical_template_sha256', encode(target_request_fingerprint, 'hex')
  )
  FROM public.sponsorship_checkout_operations operation
  JOIN public.sponsorship_intents intent
    ON intent.id = target_intent_id
  JOIN public.sponsorship_payment_quotes quote
    ON quote.id = target_quote_id
  WHERE operation.operation_id = target_operation_id;
$$;

CREATE OR REPLACE FUNCTION pg_temp.prepare_advocate_checkout(
  target_operation_id uuid,
  target_receipt_hex_byte text,
  target_email_hex_byte text,
  target_currency_quote_at timestamptz,
  target_partnership_project public.project_type,
  target_amount_cents bigint
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_intent_id uuid;
BEGIN
  SELECT prepared.resolved_sponsorship_intent_id
  INTO STRICT v_intent_id
  FROM public.prepare_sponsorship_checkout_intent_v2(
    target_checkout_operation_id => target_operation_id,
    target_checkout_receipt_digest => decode(
      repeat(target_receipt_hex_byte, 32),
      'hex'
    ),
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_idempotency_key =>
      'stripe-checkout:' || target_operation_id::text,
    target_idempotency_key => 'checkout-v2:' || target_operation_id::text,
    target_source => 'advocate_domain',
    target_advocate_hostname =>
      'checkouttenantauth.creatorshare.com',
    target_visitor_token_digest => NULL,
    target_auth_user_id => NULL,
    target_contact_email_hmac => decode(
      repeat(target_email_hex_byte, 32),
      'hex'
    ),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'partnership',
    target_beneficiary_id => NULL,
    target_partnership_project => target_partnership_project,
    target_payment_mode => 'recurring',
    target_recurrence_interval => 'month',
    target_base_amount_usd_cents => target_amount_cents,
    target_charged_amount_minor => target_amount_cents,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => target_currency_quote_at,
    target_currency_rate_source => 'checkout-tenant-authorization-test'
  ) prepared;

  RETURN v_intent_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.issue_advocate_quote(
  target_operation_id uuid,
  target_intent_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_quote_id uuid;
BEGIN
  SELECT quote.payment_quote_id
  INTO STRICT v_quote_id
  FROM public.issue_sponsorship_payment_quote_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => target_intent_id,
    target_quote_idempotency_key =>
      'quote:' || target_operation_id::text
  ) quote;

  RETURN v_quote_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.begin_advocate_checkout(
  target_operation_id uuid,
  target_intent_id uuid,
  target_quote_id uuid,
  target_receipt_hex_byte text,
  target_fingerprint_hex_byte text,
  target_ciphertext_hex_byte text,
  target_request_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempt_id uuid;
  v_fingerprint bytea := decode(
    repeat(target_fingerprint_hex_byte, 32),
    'hex'
  );
  v_ciphertext bytea := decode(
    repeat(target_ciphertext_hex_byte, 64),
    'hex'
  );
BEGIN
  SELECT payment.payment_attempt_id
  INTO STRICT v_attempt_id
  FROM public.begin_sponsorship_payment_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => target_intent_id,
    target_payment_quote_id => target_quote_id,
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_idempotency_key =>
      'stripe-checkout:' || target_operation_id::text,
    target_checkout_receipt_digest => decode(
      repeat(target_receipt_hex_byte, 32),
      'hex'
    ),
    target_provider_request_schema_version => 1::smallint,
    target_provider_request_template_claims =>
      pg_temp.checkout_tenant_provider_claims(
        target_operation_id,
        target_intent_id,
        target_quote_id,
        v_fingerprint,
        target_request_expires_at
      ),
    target_provider_request_fingerprint => v_fingerprint,
    target_provider_request_expires_at => target_request_expires_at,
    target_provider_request_ciphertext => v_ciphertext,
    target_provider_request_encryption_key_version => 7::smallint,
    target_provider_request_ciphertext_sha256 => extensions.digest(
      v_ciphertext,
      'sha256'
    ),
    target_metadata =>
      '{"test":"checkout_tenant_authorization_v2"}'::jsonb
  ) payment;

  RETURN v_attempt_id;
END;
$$;

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
VALUES (
  '98400000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'checkout-tenant-owner@example.test',
  clock_timestamp(),
  '{}'::jsonb,
  '{"first_name":"Checkout","last_name":"Tenant"}'::jsonb,
  clock_timestamp(),
  clock_timestamp()
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status
  )
  VALUES (
    'checkouttenantauth',
    'Checkout Tenant Authorization',
    'active'
  )
  RETURNING id
)
INSERT INTO checkout_tenant_test_ids (key, value)
SELECT 'advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  SELECT
    value,
    '98400000-0000-4000-8000-000000000001'::uuid,
    'active'
  FROM checkout_tenant_test_ids
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO checkout_tenant_test_ids (key, value)
SELECT 'owner_membership', id FROM inserted;

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
SELECT
  advocate.value,
  membership.value,
  '00000000-0000-4000-8000-000000000001'::uuid,
  '98400000-0000-4000-8000-000000000001'::uuid
FROM checkout_tenant_test_ids advocate
CROSS JOIN checkout_tenant_test_ids membership
WHERE advocate.key = 'advocate'
  AND membership.key = 'owner_membership';

UPDATE public.advocates
SET
  owner_membership_id = (
    SELECT value
    FROM checkout_tenant_test_ids
    WHERE key = 'owner_membership'
  ),
  publication_status = 'provisioning'
WHERE id = (
  SELECT value FROM checkout_tenant_test_ids WHERE key = 'advocate'
);

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    value,
    'checkouttenantauth.creatorshare.com',
    true
  FROM checkout_tenant_test_ids
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO checkout_tenant_test_ids (key, value)
SELECT 'domain', id FROM inserted;

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.value,
  domain.value,
  required.provider::public.advocate_domain_integration_provider,
  required.environment
FROM checkout_tenant_test_ids advocate
CROSS JOIN checkout_tenant_test_ids domain
CROSS JOIN (
  VALUES
    ('cloudflare', 'production'),
    ('vercel', 'production'),
    ('stripe_us', 'live'),
    ('stripe_uk', 'live'),
    ('paypal', 'live')
) AS required(provider, environment)
WHERE advocate.key = 'advocate'
  AND domain.key = 'domain';

SELECT pg_temp.activate_checkout_tenant_domain(
  (
    SELECT value FROM checkout_tenant_test_ids WHERE key = 'domain'
  ),
  'checkout-tenant-auth-worker'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT public.publish_advocate_portal(
  (SELECT value FROM checkout_tenant_test_ids WHERE key = 'advocate'),
  (
    SELECT advocate.version
    FROM public.advocates advocate
    WHERE advocate.id = (
      SELECT value FROM checkout_tenant_test_ids WHERE key = 'advocate'
    )
  ),
  (SELECT value FROM checkout_tenant_test_ids WHERE key = 'domain'),
  'checkouttenantauth.creatorshare.com',
  extensions.digest('checkout-tenant-publication-canary', 'sha256'),
  clock_timestamp(),
  'Publish the checkout tenant fixture after all provider chains settle',
  'checkout-tenant-test-deployment',
  'checkout-tenant-publication-request',
  'checkout-tenant-publication-trace'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

UPDATE public.payment_provider_accounts
SET
  status = 'active',
  environment = 'live'
WHERE provider = 'STRIPE'
  AND scope = 'stripe_us';

INSERT INTO checkout_tenant_test_times (key, value)
VALUES
  ('created_quote_at', clock_timestamp()),
  ('pending_quote_at', clock_timestamp()),
  ('prebegin_quote_at', clock_timestamp()),
  ('late_attach_quote_at', clock_timestamp()),
  ('created_request_expires_at', clock_timestamp() + interval '61 minutes'),
  ('pending_request_expires_at', clock_timestamp() + interval '61 minutes'),
  ('late_attach_request_expires_at', clock_timestamp() + interval '61 minutes');

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'created_intent',
  pg_temp.prepare_advocate_checkout(
    '98500000-0000-4000-8000-000000000001'::uuid,
    'a1',
    'b1',
    (SELECT value FROM checkout_tenant_test_times WHERE key = 'created_quote_at'),
    'education',
    2500
  );

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'created_quote',
  pg_temp.issue_advocate_quote(
    '98500000-0000-4000-8000-000000000001'::uuid,
    (SELECT value FROM checkout_tenant_test_ids WHERE key = 'created_intent')
  );

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'created_attempt',
  pg_temp.begin_advocate_checkout(
    '98500000-0000-4000-8000-000000000001'::uuid,
    (SELECT value FROM checkout_tenant_test_ids WHERE key = 'created_intent'),
    (SELECT value FROM checkout_tenant_test_ids WHERE key = 'created_quote'),
    'a1',
    'c1',
    'd1',
    (
      SELECT value FROM checkout_tenant_test_times
      WHERE key = 'created_request_expires_at'
    )
  );

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'pending_intent',
  pg_temp.prepare_advocate_checkout(
    '98500000-0000-4000-8000-000000000002'::uuid,
    'a2',
    'b2',
    (SELECT value FROM checkout_tenant_test_times WHERE key = 'pending_quote_at'),
    'nutrition',
    3000
  );

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'pending_quote',
  pg_temp.issue_advocate_quote(
    '98500000-0000-4000-8000-000000000002'::uuid,
    (SELECT value FROM checkout_tenant_test_ids WHERE key = 'pending_intent')
  );

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'pending_attempt',
  pg_temp.begin_advocate_checkout(
    '98500000-0000-4000-8000-000000000002'::uuid,
    (SELECT value FROM checkout_tenant_test_ids WHERE key = 'pending_intent'),
    (SELECT value FROM checkout_tenant_test_ids WHERE key = 'pending_quote'),
    'a2',
    'c2',
    'd2',
    (
      SELECT value FROM checkout_tenant_test_times
      WHERE key = 'pending_request_expires_at'
    )
  );

SELECT public.attach_sponsorship_payment_provider_object_v2(
  target_payment_attempt_id => (
    SELECT value FROM checkout_tenant_test_ids WHERE key = 'pending_attempt'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_checkout_tenant_pending_002',
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_fingerprint => decode(repeat('c2', 32), 'hex'),
  target_provider_request_expires_at => (
    SELECT value FROM checkout_tenant_test_times
    WHERE key = 'pending_request_expires_at'
  ),
  target_recovery_lease_token => NULL
);

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'prebegin_intent',
  pg_temp.prepare_advocate_checkout(
    '98500000-0000-4000-8000-000000000003'::uuid,
    'a3',
    'b3',
    (SELECT value FROM checkout_tenant_test_times WHERE key = 'prebegin_quote_at'),
    'shelter',
    3500
  );

SELECT public.prepare_sponsorship_checkout_operation_v2(
  target_checkout_operation_id =>
    '98500000-0000-4000-8000-000000000004'::uuid,
  target_checkout_receipt_digest => decode(repeat('a4', 32), 'hex'),
  target_sponsorship_intent_id => (
    SELECT value FROM checkout_tenant_test_ids WHERE key = 'prebegin_intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key =>
    'stripe-checkout:98500000-0000-4000-8000-000000000004',
  target_predecessor_operation_id =>
    '98500000-0000-4000-8000-000000000003'::uuid,
  target_retry_after_payment_attempt_id => NULL
);

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'late_attach_intent',
  pg_temp.prepare_advocate_checkout(
    '98500000-0000-4000-8000-000000000005'::uuid,
    'a5',
    'b5',
    (
      SELECT value FROM checkout_tenant_test_times
      WHERE key = 'late_attach_quote_at'
    ),
    'general',
    4000
  );

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'late_attach_quote',
  pg_temp.issue_advocate_quote(
    '98500000-0000-4000-8000-000000000005'::uuid,
    (
      SELECT value FROM checkout_tenant_test_ids
      WHERE key = 'late_attach_intent'
    )
  );

INSERT INTO checkout_tenant_test_ids (key, value)
SELECT
  'late_attach_attempt',
  pg_temp.begin_advocate_checkout(
    '98500000-0000-4000-8000-000000000005'::uuid,
    (
      SELECT value FROM checkout_tenant_test_ids
      WHERE key = 'late_attach_intent'
    ),
    (
      SELECT value FROM checkout_tenant_test_ids
      WHERE key = 'late_attach_quote'
    ),
    'a5',
    'c5',
    'd5',
    (
      SELECT value FROM checkout_tenant_test_times
      WHERE key = 'late_attach_request_expires_at'
    )
  );

SET LOCAL session_replication_role = replica;
UPDATE public.advocate_domains
SET status = 'disabled'
WHERE id = (
  SELECT value FROM checkout_tenant_test_ids WHERE key = 'domain'
);
SET LOCAL session_replication_role = origin;

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.prepare_advocate_checkout(
      '98500000-0000-4000-8000-000000000001'::uuid,
      'a1',
      'b1',
      (
        SELECT value FROM checkout_tenant_test_times
        WHERE key = 'created_quote_at'
      ),
      'education',
      2500
    )
  $$,
  '23514',
  'Advocate portal is not currently authorized for checkout',
  'an exact intent replay is rejected after its persisted domain is disabled'
);

SET LOCAL session_replication_role = replica;
UPDATE public.advocate_domains
SET
  status = 'active',
  deactivated_at = NULL
WHERE id = (
  SELECT value FROM checkout_tenant_test_ids WHERE key = 'domain'
);
SET LOCAL session_replication_role = origin;

UPDATE public.advocates
SET relationship_status = 'suspended'
WHERE id = (
  SELECT value FROM checkout_tenant_test_ids WHERE key = 'advocate'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.prepare_advocate_checkout(
      '98500000-0000-4000-8000-000000000002'::uuid,
      'a2',
      'b2',
      (
        SELECT value FROM checkout_tenant_test_times
        WHERE key = 'pending_quote_at'
      ),
      'nutrition',
      3000
    )
  $$,
  '23514',
  'Advocate portal is not currently authorized for checkout',
  'an exact intent replay is rejected when the advocate relationship is suspended'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_sponsorship_payment_quote_v2(
      '98500000-0000-4000-8000-000000000001'::uuid,
      (
        SELECT value FROM checkout_tenant_test_ids
        WHERE key = 'created_intent'
      ),
      'quote:98500000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'Advocate portal is not currently authorized for checkout',
  'an existing quote cannot bypass current tenant authorization'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.begin_advocate_checkout(
      '98500000-0000-4000-8000-000000000001'::uuid,
      (
        SELECT value FROM checkout_tenant_test_ids
        WHERE key = 'created_intent'
      ),
      (
        SELECT value FROM checkout_tenant_test_ids
        WHERE key = 'created_quote'
      ),
      'a1',
      'c1',
      'd1',
      (
        SELECT value FROM checkout_tenant_test_times
        WHERE key = 'created_request_expires_at'
      )
    )
  $$,
  '23514',
  'Advocate portal is not currently authorized for checkout',
  'an existing begun operation cannot bypass current tenant authorization'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.prepare_sponsorship_checkout_operation_v2(
      target_checkout_operation_id =>
        '98500000-0000-4000-8000-000000000004'::uuid,
      target_checkout_receipt_digest => decode(repeat('a4', 32), 'hex'),
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_tenant_test_ids
        WHERE key = 'prebegin_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key =>
        'stripe-checkout:98500000-0000-4000-8000-000000000004',
      target_predecessor_operation_id =>
        '98500000-0000-4000-8000-000000000003'::uuid,
      target_retry_after_payment_attempt_id => NULL
    )
  $$,
  '23514',
  'Advocate portal is not currently authorized for checkout',
  'an exact successor operation replay cannot bypass tenant suspension'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resume_sponsorship_checkout_operation_v2(
      decode(repeat('a1', 32), 'hex'),
      '98500000-0000-4000-8000-000000000001'::uuid,
      'STRIPE',
      'stripe_us',
      'stripe-checkout:98500000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  'Advocate portal is not currently authorized for checkout',
  'foreground resume cannot expose sealed provider material after suspension'
);

SELECT extensions.is(
  (
    SELECT recovered.recovery_status
    FROM public.recover_sponsorship_checkout_v2(
      decode(repeat('a1', 32), 'hex'),
      '98500000-0000-4000-8000-000000000001'::uuid,
      'STRIPE',
      'stripe_us',
      'stripe-checkout:98500000-0000-4000-8000-000000000001'
    ) recovered
  ),
  'available',
  'safe receipt recovery remains available without exposing provider material'
);

SELECT extensions.ok(
  (
    SELECT attached.status = 'pending'
      AND attached.provider_object_attached
    FROM public.attach_sponsorship_payment_provider_object_v2(
      target_payment_attempt_id => (
        SELECT value FROM checkout_tenant_test_ids
        WHERE key = 'late_attach_attempt'
      ),
      target_provider_object_type => 'checkout_session',
      target_provider_object_id => 'cs_checkout_tenant_late_attach_005',
      target_provider_request_schema_version => 1::smallint,
      target_provider_request_fingerprint => decode(repeat('c5', 32), 'hex'),
      target_provider_request_expires_at => (
        SELECT value FROM checkout_tenant_test_times
        WHERE key = 'late_attach_request_expires_at'
      ),
      target_recovery_lease_token => NULL
    ) attached
  ),
  'an object created during a suspension race can still attach for durable reconciliation'
);

SET LOCAL session_replication_role = replica;
UPDATE public.sponsorship_checkout_recovery_states
SET next_reconciliation_at = clock_timestamp()
WHERE payment_attempt_id IN (
  SELECT value
  FROM checkout_tenant_test_ids
  WHERE key IN ('created_attempt', 'pending_attempt')
);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE checkout_tenant_claimed
ON COMMIT DROP
AS
SELECT claimed.*
FROM public.claim_sponsorship_checkout_recoveries_v2(
  'checkout-tenant-inactive-worker',
  10,
  300
) claimed;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM checkout_tenant_claimed
  ),
  1,
  'the worker claim excludes a created provider request for an inactive advocate'
);

SELECT extensions.ok(
  (
    SELECT claimed.payment_attempt_id = (
      SELECT value FROM checkout_tenant_test_ids WHERE key = 'pending_attempt'
    )
      AND claimed.attempt_status = 'pending'
      AND claimed.recovery_stage = 'reconcile_pending'
      AND claimed.provider_object_id = 'cs_checkout_tenant_pending_002'
      AND claimed.provider_request_ciphertext = decode(repeat('d2', 64), 'hex')
    FROM checkout_tenant_claimed claimed
  ),
  'a pending object remains claimable for reconciliation after tenant suspension'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.payment_attempt_id = (
      SELECT value FROM checkout_tenant_test_ids WHERE key = 'created_attempt'
    )
      AND recovery.status = 'manual_review'
      AND recovery.attempt_count = recovery.max_attempts
      AND recovery.last_error_code = 'advocate_portal_inactive'
      AND recovery.lease_token IS NULL
  ),
  'the stopped provider creation is visible as an explicit manual review'
);

SELECT extensions.ok(
  (
    SELECT finalized.attempt_status = 'expired'
      AND finalized.intent_status = 'failed'
      AND finalized.recovery_status = 'closed'
      AND finalized.resolution = 'provider_terminal'
    FROM public.finalize_sponsorship_checkout_recovery_v2(
      target_payment_attempt_id => (
        SELECT value FROM checkout_tenant_test_ids WHERE key = 'pending_attempt'
      ),
      target_recovery_lease_token => (
        SELECT recovery_lease_token FROM checkout_tenant_claimed
      ),
      target_resolution => 'provider_terminal',
      target_provider_request_schema_version => 1::smallint,
      target_provider_request_fingerprint => decode(repeat('c2', 32), 'hex'),
      target_provider_request_expires_at => (
        SELECT value FROM checkout_tenant_test_times
        WHERE key = 'pending_request_expires_at'
      ),
      target_provider_terminal_status => 'expired',
      target_provider_reconciled_at => clock_timestamp(),
      target_reconciliation_evidence_sha256 => decode(repeat('e2', 32), 'hex'),
      target_reconciliation_evidence_ciphertext => decode(
        repeat('f2', 64),
        'hex'
      ),
      target_reconciliation_evidence_encryption_key_version => 9::smallint,
      target_release_reason =>
        'provider confirmed terminal after advocate suspension'
    ) finalized
  ),
  'provider terminal finalization remains authorized after tenant suspension'
);

SELECT * FROM extensions.finish();

ROLLBACK;
