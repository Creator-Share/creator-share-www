BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(3);

CREATE TEMP TABLE paypal_success_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.paypal_success_request_claims(
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
    'product_display_fields_sha256', repeat('7a', 32),
    'return_urls_sha256', repeat('8b', 32),
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
SET
  status = 'active',
  environment = 'live'
WHERE provider = 'PAYPAL'
  AND scope = 'paypal';

INSERT INTO paypal_success_ids (key, value)
SELECT
  'intent',
  prepared.resolved_sponsorship_intent_id
FROM public.prepare_sponsorship_checkout_intent_v2(
  target_checkout_operation_id =>
    'a8000000-0000-4000-8000-000000000001'::uuid,
  target_checkout_receipt_digest => decode(repeat('a1', 32), 'hex'),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_idempotency_key =>
    'paypal-checkout:a8000000-0000-4000-8000-000000000001',
  target_idempotency_key =>
    'checkout-v2:a8000000-0000-4000-8000-000000000001',
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
  target_currency_rate_source => 'paypal-success-material-test'
) prepared;

INSERT INTO paypal_success_ids (key, value)
SELECT
  'quote',
  quote.payment_quote_id
FROM public.issue_sponsorship_payment_quote_v2(
  target_checkout_operation_id =>
    'a8000000-0000-4000-8000-000000000001'::uuid,
  target_sponsorship_intent_id => (
    SELECT value FROM paypal_success_ids WHERE key = 'intent'
  ),
  target_quote_idempotency_key =>
    'quote:a8000000-0000-4000-8000-000000000001'
) quote;

INSERT INTO paypal_success_ids (key, value)
SELECT
  'attempt',
  payment.payment_attempt_id
FROM public.begin_sponsorship_payment_v2(
  target_checkout_operation_id =>
    'a8000000-0000-4000-8000-000000000001'::uuid,
  target_sponsorship_intent_id => (
    SELECT value FROM paypal_success_ids WHERE key = 'intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM paypal_success_ids WHERE key = 'quote'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_idempotency_key =>
    'paypal-checkout:a8000000-0000-4000-8000-000000000001',
  target_checkout_receipt_digest => decode(repeat('a1', 32), 'hex'),
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_template_claims =>
    pg_temp.paypal_success_request_claims(
      'a8000000-0000-4000-8000-000000000001'::uuid,
      (SELECT value FROM paypal_success_ids WHERE key = 'intent'),
      (SELECT value FROM paypal_success_ids WHERE key = 'quote'),
      decode(repeat('c1', 32), 'hex'),
      CURRENT_TIMESTAMP + interval '10 minutes'
    ),
  target_provider_request_fingerprint => decode(repeat('c1', 32), 'hex'),
  target_provider_request_expires_at => CURRENT_TIMESTAMP + interval '10 minutes',
  target_provider_request_ciphertext => decode(repeat('d1', 64), 'hex'),
  target_provider_request_encryption_key_version => 1::smallint,
  target_provider_request_ciphertext_sha256 => extensions.digest(
    decode(repeat('d1', 64), 'hex'),
    'sha256'
  ),
  target_metadata => '{"test":"paypal_gateway_success_material"}'::jsonb
) payment;

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object_v2(
  target_payment_attempt_id => (
    SELECT value FROM paypal_success_ids WHERE key = 'attempt'
  ),
  target_provider_object_type => 'order',
  target_provider_object_id => '5O190127TN364715T',
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_fingerprint => decode(repeat('c1', 32), 'hex'),
  target_provider_request_expires_at => (
    SELECT recovery.provider_request_expires_at
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.payment_attempt_id = (
      SELECT value FROM paypal_success_ids WHERE key = 'attempt'
    )
  )
);

INSERT INTO paypal_success_ids (key, value)
SELECT
  'event',
  ingested.gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM paypal_success_ids WHERE key = 'attempt'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-PAYPAL-SUCCESS-MATERIAL-0001',
  target_event_type => 'PAYMENT.CAPTURE.COMPLETED',
  target_provider_object_type => 'capture',
  target_provider_object_id => '3C679366HH908993F',
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('cafe', 'hex'),
  target_payload_sha256 => decode(repeat('e1', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'paypal_webhook_signature_api',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM paypal_success_ids WHERE key = 'attempt'
  ),
  target_fact_parent_provider_object_type => 'order',
  target_fact_parent_provider_object_id => '5O190127TN364715T',
  target_fact_provider_movement_type => 'capture',
  target_fact_provider_movement_id => '3C679366HH908993F',
  target_fact_base_amount_usd_cents => 3333,
  target_fact_charged_amount_minor => 3333,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
) ingested;

CREATE TEMP TABLE paypal_success_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events(
  'paypal-success-material-worker',
  10
) claimed
WHERE claimed.gateway_event_id = (
  SELECT value FROM paypal_success_ids WHERE key = 'event'
);

CREATE TEMP TABLE paypal_success_material ON COMMIT DROP AS
SELECT material.*
FROM public.read_payment_gateway_event_success_material(
  (SELECT gateway_event_id FROM paypal_success_lease),
  (SELECT processing_lease_token FROM paypal_success_lease),
  'paypal-success-material-request',
  'paypal-success-material-trace'
) material;

SELECT extensions.ok(
  (
    SELECT
      welcome_required
      AND provider = 'PAYPAL'
      AND provider_account_scope = 'paypal'
      AND payment_attempt_id = (
        SELECT value FROM paypal_success_ids WHERE key = 'attempt'
      )
      AND checkout_operation_id =
        'a8000000-0000-4000-8000-000000000001'::uuid
    FROM paypal_success_material
  ),
  'typed PayPal capture success exposes its lease-fenced welcome envelope'
);

SELECT extensions.is(
  (
    SELECT count(*)::bigint
    FROM public.sponsorship_secret_material_accesses access
    WHERE access.gateway_event_id = (
      SELECT value FROM paypal_success_ids WHERE key = 'event'
    )
      AND access.access_kind = 'gateway_success_material'
  ),
  1::bigint,
  'PayPal welcome material access is memorialized exactly once'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.read_payment_gateway_event_success_material(
        %L::uuid,
        gen_random_uuid()
      )
    $sql$,
    (SELECT value FROM paypal_success_ids WHERE key = 'event')
  ),
  '55P03',
  'Gateway event processing lease is missing or stale',
  'PayPal welcome material rejects a different worker lease'
);

SELECT * FROM extensions.finish();

ROLLBACK;
