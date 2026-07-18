BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

CREATE TEMP TABLE paypal_capture_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.paypal_capture_request_claims(
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
    'product_display_fields_sha256', repeat('7c', 32),
    'return_urls_sha256', repeat('8d', 32),
    'provider_request_expires_at_epoch_microseconds',
      (extract(epoch FROM target_request_expires_at) * 1000000)::bigint,
    'canonical_template_sha256', encode(target_request_fingerprint, 'hex')
  )
  FROM public.sponsorship_checkout_operations operation
  JOIN public.sponsorship_intents intent ON intent.id = target_intent_id
  JOIN public.sponsorship_payment_quotes quote ON quote.id = target_quote_id
  WHERE operation.operation_id = target_operation_id;
$$;

UPDATE public.payment_provider_accounts
SET status = 'active', environment = 'live'
WHERE provider = 'PAYPAL' AND scope = 'paypal';

INSERT INTO paypal_capture_ids (key, value)
SELECT 'intent', prepared.resolved_sponsorship_intent_id
FROM public.prepare_sponsorship_checkout_intent_v2(
  target_checkout_operation_id =>
    'b8000000-0000-4000-8000-000000000001'::uuid,
  target_checkout_receipt_digest => decode(repeat('b1', 32), 'hex'),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_idempotency_key =>
    'paypal-checkout:b8000000-0000-4000-8000-000000000001',
  target_idempotency_key =>
    'checkout-v2:b8000000-0000-4000-8000-000000000001',
  target_source => 'primary_site',
  target_advocate_hostname => NULL,
  target_visitor_token_digest => NULL,
  target_auth_user_id => NULL,
  target_contact_email_hmac => decode(repeat('ab', 32), 'hex'),
  target_contact_email_normalization_version => 1::smallint,
  target_contact_email_hmac_key_version => 1::smallint,
  target_subject_kind => 'blind',
  target_beneficiary_id => NULL,
  target_partnership_project => NULL,
  target_payment_mode => 'one_time',
  target_recurrence_interval => NULL,
  target_base_amount_usd_cents => 3333,
  target_charged_amount_minor => 3333,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_quote_at => clock_timestamp(),
  target_currency_rate_source => 'paypal-capture-material-test'
) prepared;

INSERT INTO paypal_capture_ids (key, value)
SELECT 'quote', quote.payment_quote_id
FROM public.issue_sponsorship_payment_quote_v2(
  target_checkout_operation_id =>
    'b8000000-0000-4000-8000-000000000001'::uuid,
  target_sponsorship_intent_id => (
    SELECT value FROM paypal_capture_ids WHERE key = 'intent'
  ),
  target_quote_idempotency_key =>
    'quote:b8000000-0000-4000-8000-000000000001'
) quote;

INSERT INTO paypal_capture_ids (key, value)
SELECT 'attempt', payment.payment_attempt_id
FROM public.begin_sponsorship_payment_v2(
  target_checkout_operation_id =>
    'b8000000-0000-4000-8000-000000000001'::uuid,
  target_sponsorship_intent_id => (
    SELECT value FROM paypal_capture_ids WHERE key = 'intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM paypal_capture_ids WHERE key = 'quote'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_idempotency_key =>
    'paypal-checkout:b8000000-0000-4000-8000-000000000001',
  target_checkout_receipt_digest => decode(repeat('b1', 32), 'hex'),
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_template_claims =>
    pg_temp.paypal_capture_request_claims(
      'b8000000-0000-4000-8000-000000000001'::uuid,
      (SELECT value FROM paypal_capture_ids WHERE key = 'intent'),
      (SELECT value FROM paypal_capture_ids WHERE key = 'quote'),
      decode(repeat('c2', 32), 'hex'),
      CURRENT_TIMESTAMP + interval '10 minutes'
    ),
  target_provider_request_fingerprint => decode(repeat('c2', 32), 'hex'),
  target_provider_request_expires_at => CURRENT_TIMESTAMP + interval '10 minutes',
  target_provider_request_ciphertext => decode(repeat('d2', 64), 'hex'),
  target_provider_request_encryption_key_version => 1::smallint,
  target_provider_request_ciphertext_sha256 => extensions.digest(
    decode(repeat('d2', 64), 'hex'),
    'sha256'
  ),
  target_metadata => '{"test":"paypal_checkout_capture_material"}'::jsonb
) payment;

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object_v2(
  target_payment_attempt_id => (
    SELECT value FROM paypal_capture_ids WHERE key = 'attempt'
  ),
  target_provider_object_type => 'order',
  target_provider_object_id => '5O190127TN364715T',
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_fingerprint => decode(repeat('c2', 32), 'hex'),
  target_provider_request_expires_at => (
    SELECT recovery.provider_request_expires_at
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.payment_attempt_id = (
      SELECT value FROM paypal_capture_ids WHERE key = 'attempt'
    )
  )
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc function_record
    JOIN pg_catalog.pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname =
        'read_paypal_checkout_capture_material_v2'
      AND function_record.prosecdef
      AND function_record.provolatile = 's'
  ),
  'capture material boundary is a stable security definer function'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.read_paypal_checkout_capture_material_v2(bytea,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot read PayPal capture material'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.read_paypal_checkout_capture_material_v2(bytea,uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot read PayPal capture material'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.read_paypal_checkout_capture_material_v2(bytea,uuid)',
    'EXECUTE'
  ),
  'only the payment service can read PayPal capture material'
);

CREATE TEMP TABLE paypal_capture_material ON COMMIT DROP AS
SELECT material.*
FROM public.read_paypal_checkout_capture_material_v2(
  decode(repeat('b1', 32), 'hex'),
  'b8000000-0000-4000-8000-000000000001'::uuid
) material;

SELECT extensions.is(
  (SELECT count(*)::integer FROM paypal_capture_material),
  1,
  'one pending attached PayPal order returns exactly one capture boundary'
);

SELECT extensions.is(
  (SELECT provider_object_id FROM paypal_capture_material),
  '5O190127TN364715T',
  'capture material returns only the server attached PayPal order'
);

SELECT extensions.is(
  (SELECT provider_request_ciphertext FROM paypal_capture_material),
  decode(repeat('d2', 64), 'hex'),
  'capture material preserves the exact sealed provider request'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM information_schema.parameters parameter
    WHERE parameter.specific_schema = 'public'
      AND parameter.specific_name LIKE
        'read_paypal_checkout_capture_material_v2_%'
      AND parameter.parameter_name ~ '(email|contact|name)'
  ),
  0,
  'capture material exposes no sponsor contact or display name column'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.read_paypal_checkout_capture_material_v2(
      decode(repeat('b2', 32), 'hex'),
      'b8000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23505',
  'PayPal checkout capture scope conflicts with its immutable operation',
  'a mismatched opaque receipt is rejected'
);

SET LOCAL session_replication_role = replica;
UPDATE public.sponsorship_payment_attempts
SET
  status = 'succeeded',
  completed_at = clock_timestamp()
WHERE id = (SELECT value FROM paypal_capture_ids WHERE key = 'attempt');
SET LOCAL session_replication_role = origin;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.read_paypal_checkout_capture_material_v2(
      decode(repeat('b1', 32), 'hex'),
      'b8000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23514',
  'PayPal checkout capture requires one active attached order',
  'terminal attempts cannot reopen capture material'
);

SELECT * FROM extensions.finish();

ROLLBACK;
