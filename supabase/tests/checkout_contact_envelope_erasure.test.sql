BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE OR REPLACE FUNCTION pg_temp.contact_erasure_provider_request_claims(
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

CREATE OR REPLACE FUNCTION pg_temp.create_contact_erasure_chain(
  target_operation_id uuid,
  target_provider_suffix text,
  target_contact_email_hmac bytea,
  target_payment_mode public.sponsorship_payment_mode,
  target_subject_kind public.sponsorship_subject_kind DEFAULT 'blind',
  target_partnership_project public.project_type DEFAULT NULL
)
RETURNS TABLE (
  operation_id uuid,
  sponsorship_intent_id uuid,
  sponsor_identity_id uuid,
  payment_quote_id uuid,
  payment_attempt_id uuid,
  provider_object_id text,
  receipt_digest bytea,
  request_fingerprint bytea,
  request_expires_at timestamptz,
  request_template_claims jsonb,
  request_ciphertext bytea,
  request_ciphertext_sha256 bytea
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_intent_id uuid;
  v_identity_id uuid;
  v_quote_id uuid;
  v_attempt_id uuid;
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
  v_request_ciphertext bytea := decode(repeat('d2', 64), 'hex');
  v_provider_object_id text := 'cs_contact_' || target_provider_suffix;
  v_request_template_claims jsonb;
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
    target_payment_mode => target_payment_mode,
    target_recurrence_interval => CASE
      WHEN target_payment_mode = 'recurring' THEN 'month'
      ELSE NULL
    END,
    target_base_amount_usd_cents => 1700,
    target_charged_amount_minor => 1700,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => v_currency_quote_at,
    target_currency_rate_source => 'contact-erasure-test'
  ) prepared;

  SELECT quote.payment_quote_id
  INTO v_quote_id
  FROM public.issue_sponsorship_payment_quote_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => v_intent_id,
    target_quote_idempotency_key => 'quote:' || target_operation_id::text
  ) quote;

  v_request_template_claims := pg_temp.contact_erasure_provider_request_claims(
    target_operation_id,
    v_intent_id,
    v_quote_id,
    v_request_fingerprint,
    v_request_expires_at
  );

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
    target_provider_request_template_claims => v_request_template_claims,
    target_provider_request_fingerprint => v_request_fingerprint,
    target_provider_request_expires_at => v_request_expires_at,
    target_provider_request_ciphertext => v_request_ciphertext,
    target_provider_request_encryption_key_version => 1::smallint,
    target_provider_request_ciphertext_sha256 => extensions.digest(
      v_request_ciphertext,
      'sha256'
    ),
    target_metadata => '{"test":"contact_erasure"}'::jsonb
  ) payment;

  SELECT resumed.foreground_lease_token
  INTO v_recovery_lease_token
  FROM public.resume_sponsorship_checkout_operation_v2(
    v_receipt_digest,
    target_operation_id,
    'STRIPE',
    'stripe_us',
    'stripe-checkout:' || target_operation_id::text,
    'contact-erasure-resume',
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

  RETURN QUERY SELECT
    target_operation_id,
    v_intent_id,
    v_identity_id,
    v_quote_id,
    v_attempt_id,
    v_provider_object_id,
    v_receipt_digest,
    v_request_fingerprint,
    v_request_expires_at,
    v_request_template_claims,
    v_request_ciphertext,
    extensions.digest(v_request_ciphertext, 'sha256');
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.create_paypal_contact_erasure_chain(
  target_operation_id uuid,
  target_contact_email_hmac bytea
)
RETURNS TABLE (
  operation_id uuid,
  sponsorship_intent_id uuid,
  sponsor_identity_id uuid,
  payment_quote_id uuid,
  payment_attempt_id uuid,
  provider_object_id text,
  receipt_digest bytea,
  request_fingerprint bytea,
  request_expires_at timestamptz,
  request_template_claims jsonb,
  request_ciphertext bytea,
  request_ciphertext_sha256 bytea
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_intent_id uuid;
  v_identity_id uuid;
  v_quote_id uuid;
  v_attempt_id uuid;
  v_currency_quote_at timestamptz := clock_timestamp();
  v_request_expires_at timestamptz := clock_timestamp() + interval '31 minutes';
  v_receipt_digest bytea := extensions.digest(
    'paypal-receipt:' || target_operation_id::text,
    'sha256'
  );
  v_request_fingerprint bytea := extensions.digest(
    'paypal-fingerprint:' || target_operation_id::text,
    'sha256'
  );
  v_request_ciphertext bytea := decode(repeat('d7', 64), 'hex');
  v_provider_object_id text := '5O190127TN364716T';
  v_request_template_claims jsonb;
BEGIN
  SELECT
    prepared.resolved_sponsorship_intent_id,
    prepared.resolved_sponsor_identity_id
  INTO v_intent_id, v_identity_id
  FROM public.prepare_sponsorship_checkout_intent_v2(
    target_checkout_operation_id => target_operation_id,
    target_checkout_receipt_digest => v_receipt_digest,
    target_provider => 'PAYPAL',
    target_provider_account_scope => 'paypal',
    target_provider_idempotency_key =>
      'paypal-checkout:' || target_operation_id::text,
    target_idempotency_key => 'checkout-v2:' || target_operation_id::text,
    target_source => 'primary_site',
    target_advocate_hostname => NULL,
    target_visitor_token_digest => NULL,
    target_auth_user_id => NULL,
    target_contact_email_hmac => target_contact_email_hmac,
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'blind',
    target_beneficiary_id => NULL,
    target_partnership_project => NULL,
    target_payment_mode => 'one_time',
    target_recurrence_interval => NULL,
    target_base_amount_usd_cents => 1900,
    target_charged_amount_minor => 1900,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => v_currency_quote_at,
    target_currency_rate_source => 'contact-erasure-paypal-test'
  ) prepared;

  SELECT quote.payment_quote_id
  INTO v_quote_id
  FROM public.issue_sponsorship_payment_quote_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => v_intent_id,
    target_quote_idempotency_key => 'quote:' || target_operation_id::text
  ) quote;

  v_request_template_claims := pg_temp.contact_erasure_provider_request_claims(
    target_operation_id,
    v_intent_id,
    v_quote_id,
    v_request_fingerprint,
    v_request_expires_at
  );

  SELECT payment.payment_attempt_id
  INTO v_attempt_id
  FROM public.begin_sponsorship_payment_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => v_intent_id,
    target_payment_quote_id => v_quote_id,
    target_provider => 'PAYPAL',
    target_provider_account_scope => 'paypal',
    target_provider_idempotency_key =>
      'paypal-checkout:' || target_operation_id::text,
    target_checkout_receipt_digest => v_receipt_digest,
    target_provider_request_schema_version => 1::smallint,
    target_provider_request_template_claims => v_request_template_claims,
    target_provider_request_fingerprint => v_request_fingerprint,
    target_provider_request_expires_at => v_request_expires_at,
    target_provider_request_ciphertext => v_request_ciphertext,
    target_provider_request_encryption_key_version => 1::smallint,
    target_provider_request_ciphertext_sha256 => extensions.digest(
      v_request_ciphertext,
      'sha256'
    ),
    target_metadata => '{"test":"contact_erasure_paypal"}'::jsonb
  ) payment;

  PERFORM count(*)
  FROM public.attach_sponsorship_payment_provider_object_v2(
    target_payment_attempt_id => v_attempt_id,
    target_provider_object_type => 'order',
    target_provider_object_id => v_provider_object_id,
    target_provider_request_schema_version => 1::smallint,
    target_provider_request_fingerprint => v_request_fingerprint,
    target_provider_request_expires_at => v_request_expires_at
  );

  RETURN QUERY SELECT
    target_operation_id,
    v_intent_id,
    v_identity_id,
    v_quote_id,
    v_attempt_id,
    v_provider_object_id,
    v_receipt_digest,
    v_request_fingerprint,
    v_request_expires_at,
    v_request_template_claims,
    v_request_ciphertext,
    extensions.digest(v_request_ciphertext, 'sha256');
END;
$$;

UPDATE public.payment_provider_accounts
SET
  status = 'active',
  environment = 'live'
WHERE (
    provider = 'STRIPE'
    AND scope = 'stripe_us'
  )
  OR (
    provider = 'PAYPAL'
    AND scope = 'paypal'
  );

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'sponsorship_checkout_recovery_states'
      AND column_info.column_name = 'provider_request_ciphertext'
      AND column_info.is_nullable = 'YES'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'sponsorship_checkout_recovery_states'
      AND column_info.column_name = 'provider_request_contact_erased_at'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'sponsorship_checkout_recovery_states'
      AND column_info.column_name = 'provider_request_contact_erasure_reason'
  ),
  'checkout recovery can erase only its reversible contact envelope'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.ingest_verified_stripe_checkout_expiration(uuid,text,text,text,jsonb,bytea,bytea,timestamptz,timestamptz,text,text,text,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.apply_sponsorship_checkout_expiration(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.purge_sponsorship_checkout_contact_envelopes(integer,text,text)',
    'EXECUTE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_checkout_expiration_facts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_checkout_expiration_facts',
    'INSERT'
  ),
  'expiration evidence and contact erasure are service-only RPC boundaries'
);

CREATE TEMP TABLE erasure_success_chain ON COMMIT DROP AS
SELECT *
FROM pg_temp.create_contact_erasure_chain(
  '9b000000-0000-4000-8000-000000000001'::uuid,
  'success_0001',
  decode(repeat('a1', 32), 'hex'),
  'one_time'
);

CREATE TEMP TABLE erasure_success_event ON COMMIT DROP AS
SELECT ingested.gateway_event_id
FROM erasure_success_chain chain
CROSS JOIN LATERAL public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => chain.payment_attempt_id,
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_contact_success_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => chain.provider_object_id,
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('cafe', 'hex'),
  target_payload_sha256 => decode(repeat('e1', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => chain.payment_attempt_id,
  target_fact_provider_movement_type => 'payment_intent',
  target_fact_provider_movement_id => 'pi_contact_success_0001',
  target_fact_base_amount_usd_cents => 1700,
  target_fact_charged_amount_minor => 1700,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
) ingested;

CREATE TEMP TABLE erasure_success_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('contact-erasure-success', 10) claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM erasure_success_event
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_sponsorship_payment_success(
      target_gateway_event_id => (
        SELECT gateway_event_id FROM erasure_success_lease
      ),
      target_processing_lease_token => (
        SELECT processing_lease_token FROM erasure_success_lease
      ),
      target_claim_token_digest => decode(repeat('ef', 32), 'hex'),
      target_recipient_email_ciphertext => decode('010203', 'hex'),
      target_email_encryption_key_version => 1::smallint,
      target_secret_payload_ciphertext => decode('040506', 'hex'),
      target_welcome_template_key => 'sponsor-welcome-v1',
      target_welcome_template_data => '{}'::jsonb
    )
  $$,
  '23514',
  'First sponsor welcome requires sealed material access under the active success lease',
  'first welcome materialization rejects a bundle without matching secret access'
);

SELECT count(*)
FROM public.read_payment_gateway_event_success_material(
  (SELECT gateway_event_id FROM erasure_success_lease),
  (SELECT processing_lease_token FROM erasure_success_lease)
);

SELECT count(*)
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM erasure_success_lease
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM erasure_success_lease
  ),
  target_claim_token_digest => decode(repeat('ef', 32), 'hex'),
  target_recipient_email_ciphertext => decode('010203', 'hex'),
  target_email_encryption_key_version => 1::smallint,
  target_secret_payload_ciphertext => decode('040506', 'hex'),
  target_welcome_template_key => 'sponsor-welcome-v1',
  target_welcome_template_data => '{}'::jsonb
);

CREATE TEMP TABLE erasure_success_purge ON COMMIT DROP AS
SELECT *
FROM public.purge_sponsorship_checkout_contact_envelopes(
  100,
  'contact-erasure-success-request',
  'contact-erasure-success-trace'
);

SELECT extensions.ok(
  (SELECT erased_count = 1 AND succeeded_count = 1
   FROM erasure_success_purge)
  AND EXISTS (
    SELECT 1
    FROM erasure_success_chain chain
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = chain.payment_attempt_id
    WHERE recovery.provider_request_ciphertext IS NULL
      AND recovery.provider_request_encryption_key_version IS NULL
      AND recovery.provider_request_ciphertext_sha256 IS NULL
      AND recovery.provider_request_contact_erased_at IS NOT NULL
      AND recovery.provider_request_contact_erasure_reason =
        'settled_welcome_materialized'
  )
  AND EXISTS (
    SELECT 1
    FROM erasure_success_chain chain
    JOIN public.sponsorship_financial_movements movement
      ON movement.payment_attempt_id = chain.payment_attempt_id
    JOIN public.email_outbox email
      ON email.sponsor_identity_id = chain.sponsor_identity_id
    WHERE movement.entry_kind = 'sponsorship_payment'
      AND email.kind = 'sponsor_welcome'
  ),
  'settlement, welcome, and financial evidence survive contact erasure'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM erasure_success_chain chain
    CROSS JOIN LATERAL public.begin_sponsorship_payment_v2(
      target_checkout_operation_id => chain.operation_id,
      target_sponsorship_intent_id => chain.sponsorship_intent_id,
      target_payment_quote_id => chain.payment_quote_id,
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key =>
        'stripe-checkout:' || chain.operation_id::text,
      target_checkout_receipt_digest => chain.receipt_digest,
      target_provider_request_schema_version => 1::smallint,
      target_provider_request_template_claims => chain.request_template_claims,
      target_provider_request_fingerprint => chain.request_fingerprint,
      target_provider_request_expires_at => chain.request_expires_at,
      target_provider_request_ciphertext => decode(repeat('f3', 64), 'hex'),
      target_provider_request_encryption_key_version => 1::smallint,
      target_provider_request_ciphertext_sha256 => extensions.digest(
        decode(repeat('f3', 64), 'hex'),
        'sha256'
      ),
      target_metadata => '{"test":"contact_erasure"}'::jsonb
    ) replay
    WHERE replay.replayed
      AND replay.status = 'succeeded'
      AND replay.payment_attempt_id = chain.payment_attempt_id
  ),
  'terminal replay validates immutable evidence without retaining ciphertext'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      UPDATE public.sponsorship_checkout_recovery_states
      SET provider_request_ciphertext = decode(repeat('aa', 64), 'hex')
      WHERE payment_attempt_id = %L::uuid
    $sql$,
    (SELECT payment_attempt_id::text FROM erasure_success_chain)
  ),
  '42501',
  NULL,
  'erased contact material cannot be restored by a direct row update'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN erasure_success_chain chain
      ON event.record_pk ->> 'payment_attempt_id' =
        chain.payment_attempt_id::text
    WHERE event.table_name = 'sponsorship_checkout_recovery_states'
      AND event.actor_type = 'system'
      AND event.system_actor = 'retention-worker'
      AND event.tool = 'checkout-contact-erasure'
      AND event.request_id = 'contact-erasure-success-request'
      AND event.trace_id = 'contact-erasure-success-trace'
  ),
  'contact erasure records system actor and forensic request context'
);

CREATE TEMP TABLE erasure_partnership_chain ON COMMIT DROP AS
SELECT *
FROM pg_temp.create_contact_erasure_chain(
  '9b000000-0000-4000-8000-000000000005'::uuid,
  'partnership_0001',
  decode(repeat('a5', 32), 'hex'),
  'one_time',
  'partnership',
  'general'
);

CREATE TEMP TABLE erasure_partnership_event ON COMMIT DROP AS
SELECT ingested.gateway_event_id
FROM erasure_partnership_chain chain
CROSS JOIN LATERAL public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => chain.payment_attempt_id,
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_contact_partnership_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => chain.provider_object_id,
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('ca11', 'hex'),
  target_payload_sha256 => decode(repeat('e5', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => chain.payment_attempt_id,
  target_fact_provider_movement_type => 'payment_intent',
  target_fact_provider_movement_id => 'pi_contact_partnership_0001',
  target_fact_base_amount_usd_cents => 1700,
  target_fact_charged_amount_minor => 1700,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
) ingested;

CREATE TEMP TABLE erasure_partnership_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('contact-erasure-partnership', 10)
  claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM erasure_partnership_event
);

CREATE TEMP TABLE erasure_partnership_material ON COMMIT DROP AS
SELECT material.*
FROM public.read_payment_gateway_event_success_material(
  (SELECT gateway_event_id FROM erasure_partnership_lease),
  (SELECT processing_lease_token FROM erasure_partnership_lease)
) material;

SELECT count(*)
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM erasure_partnership_lease
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM erasure_partnership_lease
  )
);

CREATE TEMP TABLE erasure_partnership_purge ON COMMIT DROP AS
SELECT * FROM public.purge_sponsorship_checkout_contact_envelopes(100);

SELECT extensions.ok(
  (
    SELECT
      NOT material.welcome_required
      AND material.provider_request_ciphertext IS NULL
      AND material.contact_email_hmac IS NULL
    FROM erasure_partnership_material material
  )
  AND (SELECT erased_count = 1 AND succeeded_count = 1
       FROM erasure_partnership_purge)
  AND EXISTS (
    SELECT 1
    FROM erasure_partnership_chain chain
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = chain.payment_attempt_id
    JOIN public.sponsorship_financial_movements movement
      ON movement.payment_attempt_id = chain.payment_attempt_id
    JOIN public.payment_gateway_event_applications application
      ON application.gateway_event_id = movement.source_gateway_event_id
    WHERE recovery.provider_request_contact_erasure_reason =
        'settled_welcome_not_applicable'
      AND recovery.provider_request_ciphertext IS NULL
      AND application.effect = 'payment_succeeded'
      AND application.financial_movement_id = movement.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM erasure_partnership_chain chain
    JOIN public.sponsorship_account_claims claim
      ON claim.sponsorship_intent_id = chain.sponsorship_intent_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM erasure_partnership_chain chain
    JOIN public.email_outbox email
      ON email.sponsor_identity_id = chain.sponsor_identity_id
  ),
  'partnership settlement erases contact without manufacturing a welcome or claim'
);

CREATE TEMP TABLE erasure_failure_chain ON COMMIT DROP AS
SELECT *
FROM pg_temp.create_contact_erasure_chain(
  '9b000000-0000-4000-8000-000000000002'::uuid,
  'failure_0001',
  decode(repeat('a2', 32), 'hex'),
  'one_time'
);

CREATE TEMP TABLE erasure_failure_event ON COMMIT DROP AS
SELECT ingested.gateway_event_id
FROM erasure_failure_chain chain
CROSS JOIN LATERAL public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => chain.payment_attempt_id,
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_contact_failure_0001',
  target_event_type => 'checkout.session.async_payment_failed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => chain.provider_object_id,
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('babe', 'hex'),
  target_payload_sha256 => decode(repeat('e2', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'unpaid',
  target_fact_server_payment_attempt_id => chain.payment_attempt_id,
  target_fact_failure_code => 'stripe_checkout_async_payment_failed'
) ingested;

CREATE TEMP TABLE erasure_failure_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('contact-erasure-failure', 10) claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM erasure_failure_event
);

SELECT count(*)
FROM public.apply_sponsorship_payment_failure(
  (SELECT gateway_event_id FROM erasure_failure_lease),
  (SELECT processing_lease_token FROM erasure_failure_lease)
);

CREATE TEMP TABLE erasure_failure_purge ON COMMIT DROP AS
SELECT * FROM public.purge_sponsorship_checkout_contact_envelopes(100);

SELECT extensions.ok(
  (SELECT erased_count = 1 AND failed_count = 1
   FROM erasure_failure_purge)
  AND EXISTS (
    SELECT 1
    FROM erasure_failure_chain chain
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = chain.payment_attempt_id
    WHERE recovery.provider_request_contact_erasure_reason =
        'gateway_terminal_failure'
      AND recovery.provider_request_ciphertext IS NULL
  ),
  'signed asynchronous Checkout failure is terminal no-payment evidence'
);

CREATE TEMP TABLE erasure_expiration_chain ON COMMIT DROP AS
SELECT *
FROM pg_temp.create_contact_erasure_chain(
  '9b000000-0000-4000-8000-000000000003'::uuid,
  'expired_0001',
  decode(repeat('a3', 32), 'hex'),
  'one_time'
);

CREATE TEMP TABLE erasure_expiration_event ON COMMIT DROP AS
SELECT ingested.gateway_event_id
FROM erasure_expiration_chain chain
CROSS JOIN LATERAL public.ingest_verified_stripe_checkout_expiration(
  target_payment_attempt_id => chain.payment_attempt_id,
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_contact_expired_0001',
  target_provider_object_id => chain.provider_object_id,
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('face', 'hex'),
  target_payload_sha256 => decode(repeat('e3', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_checkout_status => 'expired',
  target_payment_status => 'unpaid',
  target_fact_server_payment_attempt_id => chain.payment_attempt_id
) ingested;

CREATE TEMP TABLE erasure_expiration_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('contact-erasure-expiration', 10)
  claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM erasure_expiration_event
);

SELECT count(*)
FROM public.apply_sponsorship_checkout_expiration(
  (SELECT gateway_event_id FROM erasure_expiration_lease),
  (SELECT processing_lease_token FROM erasure_expiration_lease)
);

CREATE TEMP TABLE erasure_expiration_purge ON COMMIT DROP AS
SELECT * FROM public.purge_sponsorship_checkout_contact_envelopes(100);

SELECT extensions.ok(
  (SELECT erased_count = 1 AND expired_count = 1
   FROM erasure_expiration_purge)
  AND EXISTS (
    SELECT 1
    FROM erasure_expiration_chain chain
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = chain.payment_attempt_id
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = chain.payment_attempt_id
    JOIN public.sponsorship_checkout_expiration_facts fact
      ON fact.payment_attempt_id = chain.payment_attempt_id
    JOIN public.payment_gateway_event_applications application
      ON application.gateway_event_id = fact.gateway_event_id
    WHERE attempt.status = 'expired'
      AND recovery.provider_request_contact_erasure_reason =
        'gateway_terminal_expired'
      AND fact.checkout_status = 'expired'
      AND fact.payment_status = 'unpaid'
      AND application.effect = 'checkout_expired'
  ),
  'signed expired and unpaid facts atomically finalize then erase the checkout contact'
);

CREATE TEMP TABLE erasure_invoice_chain ON COMMIT DROP AS
SELECT *
FROM pg_temp.create_contact_erasure_chain(
  '9b000000-0000-4000-8000-000000000004'::uuid,
  'invoice_retry_0001',
  decode(repeat('a4', 32), 'hex'),
  'recurring'
);

CREATE TEMP TABLE erasure_invoice_event ON COMMIT DROP AS
SELECT ingested.gateway_event_id
FROM erasure_invoice_chain chain
CROSS JOIN LATERAL public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => chain.payment_attempt_id,
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_contact_invoice_retry_0001',
  target_event_type => 'invoice.payment_failed',
  target_provider_object_type => 'invoice',
  target_provider_object_id => 'in_contact_retry_0001',
  target_redacted_payload => '{"verified":true}'::jsonb,
  target_payload_ciphertext => decode('feed', 'hex'),
  target_payload_sha256 => decode(repeat('e4', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'unpaid',
  target_fact_server_payment_attempt_id => chain.payment_attempt_id,
  target_fact_failure_code => 'stripe_invoice_payment_failed'
) ingested;

CREATE TEMP TABLE erasure_invoice_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('contact-erasure-invoice', 10) claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM erasure_invoice_event
);

SELECT count(*)
FROM public.apply_sponsorship_payment_failure(
  (SELECT gateway_event_id FROM erasure_invoice_lease),
  (SELECT processing_lease_token FROM erasure_invoice_lease)
);

CREATE TEMP TABLE erasure_invoice_purge ON COMMIT DROP AS
SELECT * FROM public.purge_sponsorship_checkout_contact_envelopes(100);

SELECT extensions.ok(
  (SELECT erased_count = 0 FROM erasure_invoice_purge)
  AND EXISTS (
    SELECT 1
    FROM erasure_invoice_chain chain
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = chain.payment_attempt_id
    JOIN public.sponsorship_intents intent
      ON intent.id = chain.sponsorship_intent_id
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = chain.payment_attempt_id
    JOIN public.payment_gateway_events gateway_event
      ON gateway_event.id = (SELECT gateway_event_id FROM erasure_invoice_event)
    JOIN public.payment_gateway_event_applications application
      ON application.gateway_event_id = gateway_event.id
    WHERE attempt.status = 'pending'
      AND intent.status = 'processing'
      AND recovery.status <> 'closed'
      AND recovery.provider_request_ciphertext IS NOT NULL
      AND application.effect = 'payment_failed'
      AND application.summary ->> 'operation' =
        'retryable_invoice_payment_failed'
  ),
  'invoice payment failure is recorded while initial checkout recovery stays live'
);

CREATE TEMP TABLE erasure_paypal_chain ON COMMIT DROP AS
SELECT *
FROM pg_temp.create_paypal_contact_erasure_chain(
  '9b000000-0000-4000-8000-000000000006'::uuid,
  decode(repeat('a6', 32), 'hex')
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM erasure_paypal_chain chain
    JOIN public.sponsorship_checkout_operations operation
      ON operation.operation_id = chain.operation_id
    JOIN public.sponsorship_intents intent
      ON intent.id = chain.sponsorship_intent_id
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = chain.payment_attempt_id
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = chain.payment_attempt_id
    WHERE operation.provider = 'PAYPAL'
      AND operation.provider_account_scope = 'paypal'
      AND intent.status = 'processing'
      AND attempt.provider = 'PAYPAL'
      AND attempt.provider_account_scope = 'paypal'
      AND attempt.payment_mode = 'one_time'
      AND attempt.status = 'pending'
      AND attempt.provider_object_type = 'order'
      AND attempt.provider_object_id = chain.provider_object_id
      AND recovery.status = 'available'
      AND recovery.provider_attached_at IS NOT NULL
      AND recovery.provider_attached_expires_at = chain.request_expires_at
      AND recovery.provider_request_fingerprint = chain.request_fingerprint
      AND recovery.provider_request_template_claims =
        chain.request_template_claims
      AND recovery.provider_request_ciphertext = chain.request_ciphertext
      AND recovery.provider_request_encryption_key_version = 1
      AND recovery.provider_request_ciphertext_sha256 =
        chain.request_ciphertext_sha256
      AND recovery.provider_request_contact_erased_at IS NULL
      AND recovery.provider_request_contact_erasure_reason IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM erasure_paypal_chain chain
    JOIN public.sponsorship_financial_movements movement
      ON movement.payment_attempt_id = chain.payment_attempt_id
  ),
  'fresh v2 PayPal checkout retains its sealed contact until terminal evidence exists'
);

CREATE TEMP TABLE erasure_paypal_event ON COMMIT DROP AS
SELECT ingested.gateway_event_id
FROM erasure_paypal_chain chain
CROSS JOIN LATERAL public.ingest_verified_paypal_payment_failure_v2(
  target_payment_attempt_id => chain.payment_attempt_id,
  target_provider_account_scope => 'paypal',
  target_provider_event_id =>
    'WH-CONTACT-ERASURE-CAPTURE-DECLINED-0001',
  target_event_type => 'PAYMENT.CAPTURE.DECLINED',
  target_provider_object_type => 'capture',
  target_provider_object_id => '3Y662965014333304',
  target_redacted_payload => '{"redaction_version":"test"}'::jsonb,
  target_payload_ciphertext => decode('97', 'hex'),
  target_payload_sha256 => decode(repeat('97', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'paypal_webhook_signature_api',
  target_fact_server_payment_attempt_id => chain.payment_attempt_id,
  target_fact_parent_provider_object_type => 'order',
  target_fact_parent_provider_object_id => chain.provider_object_id,
  target_fact_provider_customer_id => NULL,
  target_fact_provider_subscription_id => NULL,
  target_fact_failure_code => 'paypal_capture_declined'
) ingested;

CREATE TEMP TABLE erasure_paypal_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events(
  'contact-erasure-paypal',
  10
) claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM erasure_paypal_event
);

CREATE TEMP TABLE erasure_paypal_applied ON COMMIT DROP AS
SELECT applied.*
FROM public.apply_paypal_payment_failure_v2(
  (SELECT gateway_event_id FROM erasure_paypal_lease),
  (SELECT processing_lease_token FROM erasure_paypal_lease)
) applied;

SELECT extensions.ok(
  (SELECT application_effect = 'payment_failed'
   FROM erasure_paypal_applied)
  AND EXISTS (
    SELECT 1
    FROM erasure_paypal_chain chain
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = chain.payment_attempt_id
    JOIN public.sponsorship_intents intent
      ON intent.id = chain.sponsorship_intent_id
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = chain.payment_attempt_id
    JOIN public.payment_gateway_events gateway_event
      ON gateway_event.id = (
        SELECT gateway_event_id FROM erasure_paypal_event
      )
    JOIN public.payment_gateway_event_applications application
      ON application.gateway_event_id = gateway_event.id
    WHERE attempt.status = 'failed'
      AND attempt.failure_code = 'paypal_capture_declined'
      AND intent.status = 'failed'
      AND recovery.status = 'closed'
      AND recovery.final_outcome = 'attempt_terminal'
      AND recovery.finalized_at IS NOT NULL
      AND recovery.provider_request_ciphertext = chain.request_ciphertext
      AND recovery.provider_request_contact_erased_at IS NULL
      AND gateway_event.provider = 'PAYPAL'
      AND gateway_event.provider_account_scope = 'paypal'
      AND gateway_event.event_type = 'PAYMENT.CAPTURE.DECLINED'
      AND gateway_event.provider_object_type = 'capture'
      AND gateway_event.fact_server_payment_attempt_id = attempt.id
      AND gateway_event.fact_parent_provider_object_type = 'order'
      AND gateway_event.fact_parent_provider_object_id =
        attempt.provider_object_id
      AND gateway_event.fact_failure_code = 'paypal_capture_declined'
      AND gateway_event.verification_method =
        'paypal_webhook_signature_api'
      AND gateway_event.signature_verified_at IS NOT NULL
      AND gateway_event.processing_status = 'processed'
      AND gateway_event.processing_lease_token IS NULL
      AND application.effect = 'payment_failed'
      AND application.financial_movement_id IS NULL
      AND application.subscription_id IS NULL
      AND application.summary = jsonb_build_object(
        'provider', 'PAYPAL',
        'provider_account_scope', 'paypal',
        'event_type', 'PAYMENT.CAPTURE.DECLINED',
        'outcome', 'payment_failed'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM erasure_paypal_chain chain
    JOIN public.sponsorship_financial_movements movement
      ON movement.payment_attempt_id = chain.payment_attempt_id
  ),
  'signed PayPal capture decline closes the exact never paid v2 checkout chain'
);

CREATE TEMP TABLE erasure_paypal_before_purge ON COMMIT DROP AS
SELECT
  to_jsonb(recovery) AS recovery_row,
  to_jsonb(attempt) AS attempt_row,
  to_jsonb(intent) AS intent_row,
  to_jsonb(gateway_event) AS gateway_event_row,
  to_jsonb(application) AS application_row
FROM erasure_paypal_chain chain
JOIN public.sponsorship_payment_attempts attempt
  ON attempt.id = chain.payment_attempt_id
JOIN public.sponsorship_intents intent
  ON intent.id = chain.sponsorship_intent_id
JOIN public.sponsorship_checkout_recovery_states recovery
  ON recovery.payment_attempt_id = chain.payment_attempt_id
JOIN public.payment_gateway_events gateway_event
  ON gateway_event.id = (
    SELECT gateway_event_id FROM erasure_paypal_event
  )
JOIN public.payment_gateway_event_applications application
  ON application.gateway_event_id = gateway_event.id;

CREATE TEMP TABLE erasure_paypal_purge ON COMMIT DROP AS
SELECT * FROM public.purge_sponsorship_checkout_contact_envelopes(100);

SELECT extensions.ok(
  (SELECT erased_count = 1 AND failed_count = 1
   FROM erasure_paypal_purge)
  AND EXISTS (
    SELECT 1
    FROM erasure_paypal_chain chain
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = chain.payment_attempt_id
    JOIN public.sponsorship_intents intent
      ON intent.id = chain.sponsorship_intent_id
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = chain.payment_attempt_id
    JOIN public.payment_gateway_events gateway_event
      ON gateway_event.id = (
        SELECT gateway_event_id FROM erasure_paypal_event
      )
    JOIN public.payment_gateway_event_applications application
      ON application.gateway_event_id = gateway_event.id
    CROSS JOIN erasure_paypal_before_purge before_purge
    WHERE recovery.provider_request_ciphertext IS NULL
      AND recovery.provider_request_encryption_key_version IS NULL
      AND recovery.provider_request_ciphertext_sha256 IS NULL
      AND recovery.provider_request_contact_erased_at IS NOT NULL
      AND recovery.provider_request_contact_erasure_reason =
        'gateway_terminal_failure'
      AND (
        to_jsonb(recovery) - ARRAY[
          'provider_request_ciphertext',
          'provider_request_encryption_key_version',
          'provider_request_ciphertext_sha256',
          'provider_request_contact_erased_at',
          'provider_request_contact_erasure_reason',
          'updated_at'
        ]::text[]
      ) = (
        before_purge.recovery_row - ARRAY[
          'provider_request_ciphertext',
          'provider_request_encryption_key_version',
          'provider_request_ciphertext_sha256',
          'provider_request_contact_erased_at',
          'provider_request_contact_erasure_reason',
          'updated_at'
        ]::text[]
      )
      AND to_jsonb(attempt) = before_purge.attempt_row
      AND to_jsonb(intent) = before_purge.intent_row
      AND to_jsonb(gateway_event) = before_purge.gateway_event_row
      AND to_jsonb(application) = before_purge.application_row
      AND recovery.provider_request_fingerprint =
        chain.request_fingerprint
      AND recovery.provider_request_template_claims =
        chain.request_template_claims
      AND recovery.provider_request_expires_at = chain.request_expires_at
      AND recovery.provider_attached_at IS NOT NULL
      AND recovery.provider_attached_expires_at = chain.request_expires_at
      AND octet_length(recovery.last_finalized_lease_token_digest) = 32
      AND octet_length(recovery.last_finalization_fingerprint) = 32
      AND gateway_event.payload_ciphertext = decode('97', 'hex')
      AND gateway_event.payload_sha256 = decode(repeat('97', 32), 'hex')
      AND gateway_event.signature_verified_at IS NOT NULL
      AND gateway_event.verification_method =
        'paypal_webhook_signature_api'
      AND application.effect = 'payment_failed'
      AND attempt.status = 'failed'
      AND attempt.failure_code = 'paypal_capture_declined'
      AND intent.status = 'failed'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM erasure_paypal_chain chain
    JOIN public.sponsorship_financial_movements movement
      ON movement.payment_attempt_id = chain.payment_attempt_id
  ),
  'PayPal no payment purge erases only reversible contact and preserves forensic evidence'
);

SELECT * FROM extensions.finish();

ROLLBACK;
