BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE success_material_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE success_material_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.success_provider_request_claims(
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
  JOIN public.sponsorship_intents intent ON intent.id = target_intent_id
  JOIN public.sponsorship_payment_quotes quote ON quote.id = target_quote_id
  WHERE operation.operation_id = target_operation_id;
$$;

CREATE OR REPLACE FUNCTION pg_temp.create_success_chain(
  target_operation_id uuid,
  target_subject_kind public.sponsorship_subject_kind,
  target_partnership_project public.project_type,
  target_contact_email_hmac bytea,
  target_provider_suffix text
)
RETURNS TABLE (
  sponsorship_intent_id uuid,
  sponsor_identity_id uuid,
  payment_attempt_id uuid,
  gateway_event_id uuid,
  processing_lease_token uuid
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_intent_id uuid;
  v_identity_id uuid;
  v_quote_id uuid;
  v_attempt_id uuid;
  v_event_id uuid;
  v_lease_token uuid;
  v_recovery_lease_token uuid;
  v_currency_quote_at timestamptz := clock_timestamp();
  v_request_expires_at timestamptz := clock_timestamp() + interval '31 minutes';
  v_receipt_digest bytea := extensions.digest(
    'receipt:' || target_operation_id::text,
    'sha256'
  );
  v_request_fingerprint bytea := extensions.digest(
    'fingerprint:' || target_operation_id::text,
    'sha256'
  );
  v_provider_object_id text := 'cs_success_' || target_provider_suffix;
BEGIN
  SELECT
    prepared.resolved_sponsorship_intent_id,
    prepared.resolved_sponsor_identity_id
  INTO v_intent_id, v_identity_id
  FROM public.prepare_sponsorship_checkout_intent_v2(
    target_checkout_operation_id => target_operation_id,
    target_checkout_receipt_digest => v_receipt_digest,
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_idempotency_key =>
      'stripe-checkout:' || target_operation_id::text,
    target_idempotency_key => 'checkout-v2:' || target_operation_id::text,
    target_source => 'primary_site',
    target_advocate_hostname => NULL,
    target_visitor_token_digest => NULL,
    target_auth_user_id => NULL,
    target_contact_email_hmac => target_contact_email_hmac,
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => target_subject_kind,
    target_beneficiary_id => NULL,
    target_partnership_project => target_partnership_project,
    target_payment_mode => 'one_time',
    target_recurrence_interval => NULL,
    target_base_amount_usd_cents => 1700,
    target_charged_amount_minor => 1700,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => v_currency_quote_at,
    target_currency_rate_source => 'success-material-eligibility-test'
  ) prepared;

  SELECT quote.payment_quote_id
  INTO v_quote_id
  FROM public.issue_sponsorship_payment_quote_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => v_intent_id,
    target_quote_idempotency_key => 'quote:' || target_operation_id::text
  ) quote;

  SELECT payment.payment_attempt_id
  INTO v_attempt_id
  FROM public.begin_sponsorship_payment_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => v_intent_id,
    target_payment_quote_id => v_quote_id,
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_idempotency_key =>
      'stripe-checkout:' || target_operation_id::text,
    target_checkout_receipt_digest => v_receipt_digest,
    target_provider_request_schema_version => 1::smallint,
    target_provider_request_template_claims =>
      pg_temp.success_provider_request_claims(
        target_operation_id,
        v_intent_id,
        v_quote_id,
        v_request_fingerprint,
        v_request_expires_at
      ),
    target_provider_request_fingerprint => v_request_fingerprint,
    target_provider_request_expires_at => v_request_expires_at,
    target_provider_request_ciphertext => decode(repeat('d2', 64), 'hex'),
    target_provider_request_encryption_key_version => 1::smallint,
    target_provider_request_ciphertext_sha256 => extensions.digest(
      decode(repeat('d2', 64), 'hex'),
      'sha256'
    ),
    target_metadata => '{"test":"welcome_eligibility"}'::jsonb
  ) payment;

  SELECT resumed.foreground_lease_token
  INTO v_recovery_lease_token
  FROM public.resume_sponsorship_checkout_operation_v2(
    v_receipt_digest,
    target_operation_id,
    'STRIPE',
    'stripe_us',
    'stripe-checkout:' || target_operation_id::text,
    'welcome-eligibility-resume',
    NULL
  ) resumed;

  PERFORM count(*)
  FROM public.finalize_sponsorship_checkout_recovery_v2(
    target_payment_attempt_id => v_attempt_id,
    target_recovery_lease_token => v_recovery_lease_token,
    target_resolution => 'provider_attached',
    target_provider_request_schema_version => 1::smallint,
    target_provider_request_fingerprint => v_request_fingerprint,
    target_provider_request_expires_at => v_request_expires_at,
    target_provider_object_type => 'checkout_session',
    target_provider_object_id => v_provider_object_id
  );

  SELECT ingested.gateway_event_id
  INTO v_event_id
  FROM public.ingest_verified_payment_gateway_event(
    target_payment_attempt_id => v_attempt_id,
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_event_id => 'evt_success_' || target_provider_suffix,
    target_event_type => 'checkout.session.completed',
    target_provider_object_type => 'checkout_session',
    target_provider_object_id => v_provider_object_id,
    target_redacted_payload => '{"verified":true}'::jsonb,
    target_payload_ciphertext => decode('cafe', 'hex'),
    target_payload_sha256 => extensions.digest(
      'payload:' || target_operation_id::text,
      'sha256'
    ),
    target_signature_verified_at => clock_timestamp(),
    target_occurred_at => clock_timestamp(),
    target_verification_method => 'stripe_webhook_signature',
    target_fact_payment_status => 'paid',
    target_fact_server_payment_attempt_id => v_attempt_id,
    target_fact_provider_movement_type => 'payment_intent',
    target_fact_provider_movement_id => 'pi_success_' || target_provider_suffix,
    target_fact_base_amount_usd_cents => 1700,
    target_fact_charged_amount_minor => 1700,
    target_fact_charged_currency => 'USD',
    target_fact_conversion_rate => 1
  ) ingested;

  SELECT claimed.processing_lease_token
  INTO v_lease_token
  FROM public.claim_payment_gateway_events(
    'success-chain-' || target_provider_suffix,
    10
  ) claimed
  WHERE claimed.gateway_event_id = v_event_id;

  IF v_intent_id IS NULL
     OR v_identity_id IS NULL
     OR v_attempt_id IS NULL
     OR v_event_id IS NULL
     OR v_lease_token IS NULL THEN
    RAISE EXCEPTION 'Success chain helper did not produce a complete lease'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY SELECT
    v_intent_id,
    v_identity_id,
    v_attempt_id,
    v_event_id,
    v_lease_token;
END;
$$;

UPDATE public.payment_provider_accounts
SET
  status = 'active',
  environment = 'live'
WHERE provider = 'STRIPE'
  AND scope = 'stripe_us';

INSERT INTO success_material_times
VALUES
  ('currency_quote_at', clock_timestamp()),
  ('request_expires_at', clock_timestamp() + interval '31 minutes');

INSERT INTO success_material_ids (key, value)
SELECT
  'intent',
  prepared.resolved_sponsorship_intent_id
FROM public.prepare_sponsorship_checkout_intent_v2(
  target_checkout_operation_id =>
    '98000000-0000-4000-8000-000000000001'::uuid,
  target_checkout_receipt_digest => decode(repeat('a1', 32), 'hex'),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key =>
    'stripe-checkout:98000000-0000-4000-8000-000000000001',
  target_idempotency_key =>
    'checkout-v2:98000000-0000-4000-8000-000000000001',
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
  target_base_amount_usd_cents => 1600,
  target_charged_amount_minor => 1600,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_quote_at => (
    SELECT value FROM success_material_times WHERE key = 'currency_quote_at'
  ),
  target_currency_rate_source => 'success-material-test'
) prepared;

INSERT INTO success_material_ids (key, value)
SELECT
  'quote',
  quote.payment_quote_id
FROM public.issue_sponsorship_payment_quote_v2(
  target_checkout_operation_id =>
    '98000000-0000-4000-8000-000000000001'::uuid,
  target_sponsorship_intent_id => (
    SELECT value FROM success_material_ids WHERE key = 'intent'
  ),
  target_quote_idempotency_key =>
    'quote:98000000-0000-4000-8000-000000000001'
) quote;

INSERT INTO success_material_ids (key, value)
SELECT
  'attempt',
  payment.payment_attempt_id
FROM public.begin_sponsorship_payment_v2(
  target_checkout_operation_id =>
    '98000000-0000-4000-8000-000000000001'::uuid,
  target_sponsorship_intent_id => (
    SELECT value FROM success_material_ids WHERE key = 'intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM success_material_ids WHERE key = 'quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key =>
    'stripe-checkout:98000000-0000-4000-8000-000000000001',
  target_checkout_receipt_digest => decode(repeat('a1', 32), 'hex'),
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_template_claims =>
    pg_temp.success_provider_request_claims(
      '98000000-0000-4000-8000-000000000001'::uuid,
      (SELECT value FROM success_material_ids WHERE key = 'intent'),
      (SELECT value FROM success_material_ids WHERE key = 'quote'),
      decode(repeat('c1', 32), 'hex'),
      (
        SELECT value FROM success_material_times
        WHERE key = 'request_expires_at'
      )
    ),
  target_provider_request_fingerprint => decode(repeat('c1', 32), 'hex'),
  target_provider_request_expires_at => (
    SELECT value FROM success_material_times WHERE key = 'request_expires_at'
  ),
  target_provider_request_ciphertext => decode(repeat('d1', 64), 'hex'),
  target_provider_request_encryption_key_version => 1::smallint,
  target_provider_request_ciphertext_sha256 => extensions.digest(
    decode(repeat('d1', 64), 'hex'),
    'sha256'
  ),
  target_metadata => '{"test":"gateway_success_material"}'::jsonb
) payment;

CREATE TEMP TABLE success_material_resume ON COMMIT DROP AS
SELECT resumed.*
FROM public.resume_sponsorship_checkout_operation_v2(
  decode(repeat('a1', 32), 'hex'),
  '98000000-0000-4000-8000-000000000001'::uuid,
  'STRIPE',
  'stripe_us',
  'stripe-checkout:98000000-0000-4000-8000-000000000001',
  'success-material-resume',
  'success-material-trace'
) resumed;

SELECT count(*)
FROM public.finalize_sponsorship_checkout_recovery_v2(
  target_payment_attempt_id => (
    SELECT value FROM success_material_ids WHERE key = 'attempt'
  ),
  target_recovery_lease_token => (
    SELECT foreground_lease_token FROM success_material_resume
  ),
  target_resolution => 'provider_attached',
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_fingerprint => decode(repeat('c1', 32), 'hex'),
  target_provider_request_expires_at => (
    SELECT value FROM success_material_times WHERE key = 'request_expires_at'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_success_material_0001'
);

INSERT INTO success_material_times
VALUES ('success_occurred_at', clock_timestamp());

INSERT INTO success_material_ids (key, value)
SELECT
  'success_event',
  ingested.gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM success_material_ids WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_success_material_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_success_material_0001',
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('cafe', 'hex'),
  target_payload_sha256 => decode(repeat('e1', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM success_material_times WHERE key = 'success_occurred_at'
  ),
  target_occurred_at => (
    SELECT value FROM success_material_times WHERE key = 'success_occurred_at'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM success_material_ids WHERE key = 'attempt'
  ),
  target_fact_provider_movement_type => 'payment_intent',
  target_fact_provider_movement_id => 'pi_success_material_0001',
  target_fact_base_amount_usd_cents => 1600,
  target_fact_charged_amount_minor => 1600,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
) ingested;

CREATE TEMP TABLE success_material_gateway_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('success-material-worker', 10)
  claimed
WHERE claimed.gateway_event_id = (
  SELECT value FROM success_material_ids WHERE key = 'success_event'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.read_payment_gateway_event_success_material(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.read_payment_gateway_event_success_material(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.read_payment_gateway_event_success_material(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.verify_email_outbox_delivery_material(uuid,text,bytea,bytea,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.verify_email_outbox_delivery_material(uuid,text,bytea,bytea,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.verify_email_outbox_delivery_material(uuid,text,bytea,bytea,text,text)',
    'EXECUTE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_secret_material_accesses',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_secret_material_accesses',
    'INSERT'
  ),
  'secret material RPCs are service-only and expose no direct ledger access'
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
    (SELECT value FROM success_material_ids WHERE key = 'success_event')
  ),
  '55P03',
  'Gateway event processing lease is missing or stale',
  'sealed provider material rejects a different gateway event lease'
);

CREATE TEMP TABLE success_material_result ON COMMIT DROP AS
SELECT material.*
FROM public.read_payment_gateway_event_success_material(
  (
    SELECT gateway_event_id FROM success_material_gateway_lease
  ),
  (
    SELECT processing_lease_token FROM success_material_gateway_lease
  ),
  'success-material-request',
  'success-material-trace'
) material;

SELECT extensions.ok(
  (
    SELECT
      result.gateway_event_id = (
        SELECT value FROM success_material_ids WHERE key = 'success_event'
      )
      AND result.payment_attempt_id = (
        SELECT value FROM success_material_ids WHERE key = 'attempt'
      )
      AND result.welcome_required
      AND result.checkout_operation_id =
        '98000000-0000-4000-8000-000000000001'::uuid
      AND result.sponsorship_intent_id = (
        SELECT value FROM success_material_ids WHERE key = 'intent'
      )
      AND result.payment_quote_id = (
        SELECT value FROM success_material_ids WHERE key = 'quote'
      )
      AND result.provider = 'STRIPE'
      AND result.provider_account_scope = 'stripe_us'
      AND result.provider_idempotency_key =
        'stripe-checkout:98000000-0000-4000-8000-000000000001'
      AND result.provider_request_schema_version = 1
      AND result.provider_request_fingerprint = decode(repeat('c1', 32), 'hex')
      AND result.provider_request_ciphertext = decode(repeat('d1', 64), 'hex')
      AND result.provider_request_ciphertext_sha256 = extensions.digest(
        decode(repeat('d1', 64), 'hex'),
        'sha256'
      )
      AND result.contact_email_hmac = decode(repeat('ab', 32), 'hex')
      AND result.contact_email_normalization_version = 1
      AND result.contact_email_hmac_key_version = 1
    FROM success_material_result result
  ),
  'lease fenced material read returns only the exact sealed checkout and intent email binding'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_secret_material_accesses access
    WHERE access.access_kind = 'gateway_success_material'
      AND access.gateway_event_id = (
        SELECT value FROM success_material_ids WHERE key = 'success_event'
      )
      AND access.payment_attempt_id = (
        SELECT value FROM success_material_ids WHERE key = 'attempt'
      )
      AND access.lease_attempt_count = 1
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'sponsorship_secret_material_accesses'
      AND event.tool = 'read_payment_gateway_event_success_material'
      AND event.request_id = 'success-material-request'
      AND event.trace_id = 'success-material-trace'
  ),
  'sealed material access is memorialized without copying the secret material'
);

CREATE TEMP TABLE success_application_result ON COMMIT DROP AS
SELECT applied.*
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM success_material_gateway_lease
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM success_material_gateway_lease
  ),
  target_claim_token_digest => decode(repeat('ef', 32), 'hex'),
  target_recipient_email_ciphertext => decode('010203', 'hex'),
  target_email_encryption_key_version => 1::smallint,
  target_secret_payload_ciphertext => decode('040506', 'hex'),
  target_welcome_template_key => 'sponsor-welcome-v1',
  target_welcome_template_data => '{}'::jsonb
) applied;

SELECT extensions.is(
  (SELECT application_effect::text FROM success_application_result),
  'payment_succeeded',
  'the same leased event applies its success and creates the welcome outbox'
);

SELECT extensions.is(
  (
    SELECT max_attempts
    FROM public.email_outbox
    WHERE id = (SELECT email_outbox_id FROM success_application_result)
  ),
  128::smallint,
  'new welcome outbox rows receive the resilient retry budget'
);

INSERT INTO success_material_ids (key, value)
SELECT
  'duplicate_success_event',
  ingested.gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM success_material_ids WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_success_material_duplicate_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_success_material_0001',
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('f00d', 'hex'),
  target_payload_sha256 => decode(repeat('e3', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM success_material_ids WHERE key = 'attempt'
  ),
  target_fact_provider_movement_type => 'payment_intent',
  target_fact_provider_movement_id => 'pi_success_material_0001',
  target_fact_base_amount_usd_cents => 1600,
  target_fact_charged_amount_minor => 1600,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
) ingested;

CREATE TEMP TABLE success_material_duplicate_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('success-material-duplicate-worker', 10)
  claimed
WHERE claimed.gateway_event_id = (
  SELECT value FROM success_material_ids WHERE key = 'duplicate_success_event'
);

CREATE TEMP TABLE success_material_duplicate_result ON COMMIT DROP AS
SELECT material.*
FROM public.read_payment_gateway_event_success_material(
  (
    SELECT gateway_event_id FROM success_material_duplicate_lease
  ),
  (
    SELECT processing_lease_token FROM success_material_duplicate_lease
  )
) material;

SELECT extensions.ok(
  (
    SELECT
      NOT result.welcome_required
      AND result.provider_request_ciphertext IS NULL
      AND result.provider_request_ciphertext_sha256 IS NULL
      AND result.contact_email_hmac IS NULL
    FROM success_material_duplicate_result result
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.sponsorship_secret_material_accesses access
    WHERE access.gateway_event_id = (
      SELECT value FROM success_material_ids
      WHERE key = 'duplicate_success_event'
    )
  ),
  'a later success bypasses sealed checkout material after the sponsor welcome exists'
);

SELECT extensions.is(
  (
    SELECT application_effect::text
    FROM public.apply_sponsorship_payment_success(
      target_gateway_event_id => (
        SELECT gateway_event_id FROM success_material_duplicate_lease
      ),
      target_processing_lease_token => (
        SELECT processing_lease_token FROM success_material_duplicate_lease
      )
    )
  ),
  'duplicate_movement',
  'a later success applies without manufacturing another welcome bundle'
);

INSERT INTO success_material_ids (key, value)
SELECT
  'failure_event',
  ingested.gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM success_material_ids WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_success_material_failure_0001',
  target_event_type => 'checkout.session.async_payment_failed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_success_material_0001',
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('babe', 'hex'),
  target_payload_sha256 => decode(repeat('e2', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM success_material_ids WHERE key = 'attempt'
  ),
  target_fact_failure_code => 'stripe_checkout_async_payment_failed'
) ingested;

CREATE TEMP TABLE success_material_failure_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('success-material-failure-worker', 10)
  claimed
WHERE claimed.gateway_event_id = (
  SELECT value FROM success_material_ids WHERE key = 'failure_event'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.read_payment_gateway_event_success_material(
        %L::uuid,
        %L::uuid
      )
    $sql$,
    (
      SELECT gateway_event_id::text
      FROM success_material_failure_lease
    ),
    (
      SELECT processing_lease_token::text
      FROM success_material_failure_lease
    )
  ),
  '23514',
  'Gateway event is not a typed sponsorship payment success',
  'sealed welcome material is unavailable to a typed payment failure event'
);

CREATE TEMP TABLE success_material_email_lease ON COMMIT DROP AS
SELECT claimed.*
FROM public.claim_email_outbox_jobs('success-material-email-worker', 1)
  claimed;

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_email_outbox_delivery(
      outbox_id => (
        SELECT outbox_id FROM success_material_email_lease
      ),
      lease_token => (
        SELECT lease_token FROM success_material_email_lease
      ),
      verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
      provider_message_id => 'message-before-material-verification'
    )
  $$,
  '42501',
  'Email completion proof does not match an unresolved SMTP handoff',
  'delivery completion is impossible before pre-send material verification'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.verify_email_outbox_delivery_material(
      target_outbox_id => (
        SELECT outbox_id FROM success_material_email_lease
      ),
      target_lease_token => repeat('ff', 32),
      verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
      verified_claim_token_digest => decode(repeat('ef', 32), 'hex')
    )
  $$,
  '55P03',
  'Email delivery material does not match the active outbox lease',
  'pre-send verification reports a stale lease separately from invalid material'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.verify_email_outbox_delivery_material(
      target_outbox_id => (
        SELECT outbox_id FROM success_material_email_lease
      ),
      target_lease_token => (
        SELECT lease_token FROM success_material_email_lease
      ),
      verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
      verified_claim_token_digest => decode(repeat('ee', 32), 'hex')
    )
  $$,
  '23514',
  'Email delivery material does not match its pending account claim',
  'pre-send verification rejects a decrypted claim token from another claim'
);

SELECT extensions.lives_ok(
  $test$
    DO $terminal_test$
    DECLARE
      v_outbox_id uuid;
      v_lease_token text;
      v_retryable boolean;
      v_status public.email_outbox_status;
      v_available_at timestamptz;
      v_retention_expires_at timestamptz;
    BEGIN
      SELECT lease.outbox_id, lease.lease_token
      INTO v_outbox_id, v_lease_token
      FROM success_material_email_lease lease;

      BEGIN
        SELECT public.fail_email_outbox_delivery(
          outbox_id => v_outbox_id,
          lease_token => v_lease_token,
          error_summary => 'welcome_email_material_invalid',
          retry_after_seconds => 1
        )
        INTO v_retryable;

        SELECT outbox.status, outbox.available_at,
          outbox.contact_retention_expires_at
        INTO v_status, v_available_at, v_retention_expires_at
        FROM public.email_outbox outbox
        WHERE outbox.id = v_outbox_id;

        IF v_retryable IS DISTINCT FROM false
           OR v_status IS DISTINCT FROM 'failed'
           OR v_available_at IS DISTINCT FROM v_retention_expires_at
           OR EXISTS (
             SELECT 1
             FROM public.claim_email_outbox_jobs(
               'success-material-terminal-check',
               1
             ) claimed
             WHERE claimed.outbox_id = v_outbox_id
           ) THEN
          RAISE EXCEPTION 'Invalid material was not terminalized durably'
            USING ERRCODE = '23514';
        END IF;

        RAISE EXCEPTION 'Rollback terminal material test state'
          USING ERRCODE = 'P9001';
      EXCEPTION WHEN SQLSTATE 'P9001' THEN
        NULL;
      END;
    END;
    $terminal_test$
  $test$,
  'invalid sealed material is terminal, durable, and unavailable for reclaim'
);

SELECT extensions.ok(
  (
    SELECT verified
    FROM public.verify_email_outbox_delivery_material(
      target_outbox_id => (
        SELECT outbox_id FROM success_material_email_lease
      ),
      target_lease_token => (
        SELECT lease_token FROM success_material_email_lease
      ),
      verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
      verified_claim_token_digest => decode(repeat('ef', 32), 'hex'),
      context_request_id => 'success-email-request',
      context_trace_id => 'success-email-trace'
    )
  ),
  'pre-send verification binds decrypted recipient and claim token to one active lease'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_secret_material_accesses access
    WHERE access.access_kind = 'email_delivery_material_verification'
      AND access.email_outbox_id = (
        SELECT outbox_id FROM success_material_email_lease
      )
      AND access.lease_attempt_count = 1
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'sponsorship_secret_material_accesses'
      AND event.tool = 'verify_email_outbox_delivery_material'
      AND event.request_id = 'success-email-request'
      AND event.trace_id = 'success-email-trace'
  ),
  'pre-send material verification is recorded in both access and audit ledgers'
);

SELECT extensions.ok(
  public.fail_email_outbox_delivery(
    outbox_id => (
      SELECT outbox_id FROM success_material_email_lease
    ),
    lease_token => (
      SELECT lease_token FROM success_material_email_lease
    ),
    error_summary => 'Simulated provider handoff failure',
    retry_after_seconds => 1
  ),
  'a verified delivery may still fail safely before the provider accepts it'
);

SELECT pg_sleep(1.05);

CREATE TEMP TABLE success_material_email_reclaim ON COMMIT DROP AS
SELECT claimed.*
FROM public.claim_email_outbox_jobs('success-material-email-worker', 1)
  claimed;

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_email_outbox_delivery(
      outbox_id => (
        SELECT outbox_id FROM success_material_email_reclaim
      ),
      lease_token => (
        SELECT lease_token FROM success_material_email_reclaim
      ),
      verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
      provider_message_id => 'message-with-stale-material-verification'
    )
  $$,
  '42501',
  'Email completion proof does not match an unresolved SMTP handoff',
  'material verification from an earlier delivery attempt cannot authorize a reclaimed lease'
);

SELECT extensions.ok(
  (
    SELECT verified
    FROM public.verify_email_outbox_delivery_material(
      target_outbox_id => (
        SELECT outbox_id FROM success_material_email_reclaim
      ),
      target_lease_token => (
        SELECT lease_token FROM success_material_email_reclaim
      ),
      verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
      verified_claim_token_digest => decode(repeat('ef', 32), 'hex')
    )
  ),
  'the reclaimed lease records a fresh verification for its own attempt generation'
);

SELECT extensions.ok(
  public.fail_email_outbox_delivery(
    outbox_id => (
      SELECT outbox_id FROM success_material_email_reclaim
    ),
    lease_token => (
      SELECT lease_token FROM success_material_email_reclaim
    ),
    error_summary => 'Simulated second provider handoff failure',
    retry_after_seconds => 1
  ),
  'a second provider failure remains retryable within retention'
);

SELECT extensions.ok(
  (
    SELECT
      outbox.available_at >= clock_timestamp() + interval '1 second'
      AND outbox.available_at <= clock_timestamp() + interval '3 seconds'
    FROM public.email_outbox outbox
    WHERE outbox.id = (
      SELECT outbox_id FROM success_material_email_reclaim
    )
  ),
  'the second provider failure exponentially doubles the requested base delay'
);

SELECT pg_sleep(2.05);

CREATE TEMP TABLE success_material_email_final_lease ON COMMIT DROP AS
SELECT claimed.*
FROM public.claim_email_outbox_jobs('success-material-email-worker', 1)
  claimed;

SELECT extensions.ok(
  (
    SELECT verified
    FROM public.verify_email_outbox_delivery_material(
      target_outbox_id => (
        SELECT outbox_id FROM success_material_email_final_lease
      ),
      target_lease_token => (
        SELECT lease_token FROM success_material_email_final_lease
      ),
      verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
      verified_claim_token_digest => decode(repeat('ef', 32), 'hex')
    )
  ),
  'the final retry receives a fresh material verification'
);

SELECT public.begin_email_outbox_delivery_handoff(
  target_outbox_id => (
    SELECT outbox_id FROM success_material_email_final_lease
  ),
  target_lease_token => (
    SELECT lease_token FROM success_material_email_final_lease
  ),
  verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
  target_provider_message_id =>
    '<sponsor-welcome.' ||
    (SELECT outbox_id::text FROM success_material_email_final_lease) ||
    '@creatorshare.com>'
);

SELECT extensions.ok(
  public.complete_email_outbox_delivery(
    outbox_id => (
      SELECT outbox_id FROM success_material_email_final_lease
    ),
    lease_token => (
      SELECT lease_token FROM success_material_email_final_lease
    ),
    verified_recipient_email_hmac => decode(repeat('ab', 32), 'hex'),
    provider_message_id =>
      '<sponsor-welcome.' ||
      (SELECT outbox_id::text FROM success_material_email_final_lease) ||
      '@creatorshare.com>'
  ) IS NOT NULL,
  'the same verified final delivery lease may complete after provider send'
);

CREATE TEMP TABLE success_material_partnership_chain ON COMMIT DROP AS
SELECT chain.*
FROM pg_temp.create_success_chain(
  '98000000-0000-4000-8000-000000000002'::uuid,
  'partnership',
  'general',
  decode(repeat('bc', 32), 'hex'),
  'partnership_0001'
) chain;

CREATE TEMP TABLE success_material_partnership_read ON COMMIT DROP AS
SELECT material.*
FROM public.read_payment_gateway_event_success_material(
  (
    SELECT gateway_event_id FROM success_material_partnership_chain
  ),
  (
    SELECT processing_lease_token FROM success_material_partnership_chain
  )
) material;

SELECT extensions.ok(
  (
    SELECT
      NOT material.welcome_required
      AND material.provider_request_ciphertext IS NULL
      AND material.contact_email_hmac IS NULL
    FROM success_material_partnership_read material
  ),
  'a partnership success never releases encrypted welcome material'
);

SELECT extensions.is(
  (
    SELECT application_effect::text
    FROM public.apply_sponsorship_payment_success(
      target_gateway_event_id => (
        SELECT gateway_event_id FROM success_material_partnership_chain
      ),
      target_processing_lease_token => (
        SELECT processing_lease_token FROM success_material_partnership_chain
      )
    )
  ),
  'payment_succeeded',
  'a partnership payment succeeds atomically without a welcome bundle'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.sponsorship_account_claims claim
    WHERE claim.sponsorship_intent_id = (
      SELECT sponsorship_intent_id FROM success_material_partnership_chain
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.email_outbox outbox
    WHERE outbox.sponsor_identity_id = (
      SELECT sponsor_identity_id FROM success_material_partnership_chain
    )
  ),
  'partnership success does not consume the identity welcome dedupe'
);

CREATE TEMP TABLE success_material_later_blind_chain ON COMMIT DROP AS
SELECT chain.*
FROM pg_temp.create_success_chain(
  '98000000-0000-4000-8000-000000000003'::uuid,
  'blind',
  NULL,
  decode(repeat('bc', 32), 'hex'),
  'later_blind_0001'
) chain;

SELECT extensions.is(
  (
    SELECT sponsor_identity_id
    FROM success_material_later_blind_chain
  ),
  (
    SELECT sponsor_identity_id
    FROM success_material_partnership_chain
  ),
  'the later eligible sponsorship resolves to the same sponsor identity'
);

SELECT extensions.ok(
  (
    SELECT material.welcome_required
    FROM public.read_payment_gateway_event_success_material(
      (
        SELECT gateway_event_id FROM success_material_later_blind_chain
      ),
      (
        SELECT processing_lease_token FROM success_material_later_blind_chain
      )
    ) material
  ),
  'the later blind sponsorship retains the identity welcome opportunity'
);

SELECT extensions.is(
  (
    SELECT application_effect::text
    FROM public.apply_sponsorship_payment_success(
      target_gateway_event_id => (
        SELECT gateway_event_id FROM success_material_later_blind_chain
      ),
      target_processing_lease_token => (
        SELECT processing_lease_token FROM success_material_later_blind_chain
      ),
      target_claim_token_digest => decode(repeat('fa', 32), 'hex'),
      target_recipient_email_ciphertext => decode('111213', 'hex'),
      target_email_encryption_key_version => 1::smallint,
      target_secret_payload_ciphertext => decode('141516', 'hex'),
      target_welcome_template_key => 'sponsor-welcome-v1',
      target_welcome_template_data => '{}'::jsonb
    )
  ),
  'payment_succeeded',
  'the later blind sponsorship creates the deferred welcome atomically'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_outbox outbox
    WHERE outbox.sponsor_identity_id = (
      SELECT sponsor_identity_id FROM success_material_partnership_chain
    )
  ),
  1::bigint,
  'the eligible sponsorship creates one welcome after partnership did not consume it'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_secret_material_accesses
    SET accessed_at = clock_timestamp()
  $$,
  '42501',
  'Secret material access records are append-only',
  'secret material access evidence cannot be rewritten'
);

SELECT extensions.is(
  (
    SELECT array_agg(column_name ORDER BY ordinal_position)::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sponsorship_secret_material_accesses'
  ),
  ARRAY[
    'id',
    'access_kind',
    'gateway_event_id',
    'payment_attempt_id',
    'email_outbox_id',
    'account_claim_id',
    'lease_attempt_count',
    'accessed_at'
  ]::text[]::text,
  'the access ledger contains only purpose, foreign keys, lease generation, and time'
);

SELECT * FROM extensions.finish();

ROLLBACK;
