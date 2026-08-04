BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

UPDATE public.payment_provider_accounts
SET
  status = 'active',
  environment = 'live'
WHERE provider = 'PAYPAL'
  AND scope = 'paypal';

CREATE TEMP TABLE paypal_webhook_parity_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  text_value text
) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO public.beneficiaries (
    name,
    username,
    budget_goal,
    status
  )
  VALUES (
    'PayPal Webhook Parity Child',
    'paypal-webhook-parity-child',
    -1,
    'New'
  )
  RETURNING id
)
INSERT INTO paypal_webhook_parity_context (key, uuid_value)
SELECT 'beneficiary', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO paypal_webhook_parity_context (key, uuid_value)
SELECT 'identity', id FROM inserted;

INSERT INTO public.sponsor_identifiers (
  sponsor_identity_id,
  kind,
  issuer_scope,
  identifier_digest,
  normalization_version,
  hmac_key_version,
  confidence
)
SELECT
  uuid_value,
  'email',
  'creator_share',
  decode(repeat('91', 32), 'hex'),
  1,
  1,
  'provider_asserted'
FROM paypal_webhook_parity_context
WHERE key = 'identity';

SELECT extensions.ok(
  to_regprocedure(
    'public.read_paypal_webhook_expected_plan(uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.ingest_verified_paypal_payment_failure_v2(uuid,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,uuid,text,text,text,text,text,text,text,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.ingest_verified_paypal_dispute_no_effect(text,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.apply_paypal_payment_failure_v2(uuid,uuid,text,text,text,text)'
  ) IS NOT NULL,
  'PayPal webhook parity exposes only the scoped typed RPC boundaries'
);

WITH inserted AS (
  INSERT INTO public.sponsorship_intents (
    idempotency_key,
    source,
    source_host,
    sponsor_identity_id,
    contact_email_hmac,
    contact_email_normalization_version,
    contact_email_hmac_key_version,
    subject_kind,
    beneficiary_id,
    payment_mode,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    currency_rate_source
  )
  SELECT
    'paypal-webhook-parity-one-time-intent',
    'primary_site',
    'creatorshare.com',
    identity.uuid_value,
    decode(repeat('91', 32), 'hex'),
    1,
    1,
    'standard',
    beneficiary.uuid_value,
    'one_time',
    2500,
    2500,
    'USD',
    1,
    clock_timestamp(),
    'paypal-webhook-parity'
  FROM paypal_webhook_parity_context identity
  CROSS JOIN paypal_webhook_parity_context beneficiary
  WHERE identity.key = 'identity'
    AND beneficiary.key = 'beneficiary'
  RETURNING id
)
INSERT INTO paypal_webhook_parity_context (key, uuid_value)
SELECT 'one_time_intent', id FROM inserted;

INSERT INTO paypal_webhook_parity_context (key, uuid_value)
SELECT 'one_time_quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'one_time_intent'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_quote_idempotency_key => 'paypal-webhook-parity-one-time-quote'
);

INSERT INTO paypal_webhook_parity_context (key, uuid_value)
SELECT 'one_time_attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'one_time_intent'
  ),
  target_payment_quote_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'one_time_quote'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_idempotency_key =>
    'paypal-webhook-parity-one-time-attempt',
  target_checkout_receipt_digest => decode(repeat('92', 32), 'hex')
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'one_time_attempt'
  ),
  target_provider_object_type => 'order',
  target_provider_object_id => '5O190127TN364715T'
);

SELECT extensions.is(
  (
    SELECT provider_plan_id
    FROM public.read_paypal_webhook_expected_plan(
      (
        SELECT uuid_value
        FROM paypal_webhook_parity_context
        WHERE key = 'one_time_attempt'
      )
    )
  ),
  NULL::text,
  'one-time PayPal attempts require no billing plan'
);

CREATE TEMP TABLE paypal_capture_declined_ingest ON COMMIT DROP AS
SELECT failure.*
FROM public.ingest_verified_paypal_payment_failure_v2(
  target_payment_attempt_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'one_time_attempt'
  ),
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-PAYPAL-CAPTURE-DECLINED-0001',
  target_event_type => 'PAYMENT.CAPTURE.DECLINED',
  target_provider_object_type => 'capture',
  target_provider_object_id => '3Y662965014333303',
  target_redacted_payload => '{"redaction_version":"test"}'::jsonb,
  target_payload_ciphertext => decode('93', 'hex'),
  target_payload_sha256 => decode(repeat('93', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'paypal_webhook_signature_api',
  target_fact_server_payment_attempt_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'one_time_attempt'
  ),
  target_fact_parent_provider_object_type => 'order',
  target_fact_parent_provider_object_id => '5O190127TN364715T',
  target_fact_provider_customer_id => NULL,
  target_fact_provider_subscription_id => NULL,
  target_fact_failure_code => 'paypal_capture_declined'
) failure;

SELECT extensions.ok(
  (
    SELECT
      processing_status = 'received'
      AND NOT is_duplicate
      AND payment_attempt_id = (
        SELECT uuid_value
        FROM paypal_webhook_parity_context
        WHERE key = 'one_time_attempt'
      )
    FROM paypal_capture_declined_ingest
  )
  AND (
    SELECT is_duplicate
    FROM public.ingest_verified_paypal_payment_failure_v2(
      target_payment_attempt_id => (
        SELECT uuid_value
        FROM paypal_webhook_parity_context
        WHERE key = 'one_time_attempt'
      ),
      target_provider_account_scope => 'paypal',
      target_provider_event_id => 'WH-PAYPAL-CAPTURE-DECLINED-0001',
      target_event_type => 'PAYMENT.CAPTURE.DECLINED',
      target_provider_object_type => 'capture',
      target_provider_object_id => '3Y662965014333303',
      target_redacted_payload => '{"redaction_version":"test"}'::jsonb,
      target_payload_ciphertext => decode('93', 'hex'),
      target_payload_sha256 => decode(repeat('93', 32), 'hex'),
      target_signature_verified_at => clock_timestamp(),
      target_occurred_at => (
        SELECT occurred_at
        FROM public.payment_gateway_events
        WHERE id = (
          SELECT gateway_event_id FROM paypal_capture_declined_ingest
        )
      ),
      target_verification_method => 'paypal_webhook_signature_api',
      target_fact_server_payment_attempt_id => (
        SELECT uuid_value
        FROM paypal_webhook_parity_context
        WHERE key = 'one_time_attempt'
      ),
      target_fact_parent_provider_object_type => 'order',
      target_fact_parent_provider_object_id => '5O190127TN364715T',
      target_fact_provider_customer_id => NULL,
      target_fact_provider_subscription_id => NULL,
      target_fact_failure_code => 'paypal_capture_declined'
    )
  ),
  'PayPal capture decline ingestion is typed and idempotent'
);

CREATE TEMP TABLE paypal_capture_declined_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events(
  'paypal-webhook-parity-worker',
  20
) claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM paypal_capture_declined_ingest
);

CREATE TEMP TABLE paypal_capture_declined_applied ON COMMIT DROP AS
SELECT applied.*
FROM public.apply_paypal_payment_failure_v2(
  (
    SELECT gateway_event_id FROM paypal_capture_declined_lease
  ),
  (
    SELECT processing_lease_token FROM paypal_capture_declined_lease
  )
) applied;

SELECT extensions.ok(
  (
    SELECT application_effect = 'payment_failed'
    FROM paypal_capture_declined_applied
  )
  AND (
    SELECT attempt.status = 'failed'
      AND attempt.failure_code = 'paypal_capture_declined'
    FROM public.sponsorship_payment_attempts attempt
    WHERE attempt.id = (
      SELECT uuid_value
      FROM paypal_webhook_parity_context
      WHERE key = 'one_time_attempt'
    )
  ),
  'a typed PayPal capture decline terminally fails one pending attempt'
);

CREATE TEMP TABLE paypal_dispute_update_no_effect ON COMMIT DROP AS
SELECT ignored.*
FROM public.ingest_verified_paypal_dispute_no_effect(
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-PAYPAL-DISPUTE-UPDATED-0001',
  target_event_type => 'CUSTOMER.DISPUTE.UPDATED',
  target_provider_object_type => 'dispute',
  target_provider_object_id => 'PP-D-123456789',
  target_provider_state => 'updated_waiting_for_seller_response',
  target_redacted_payload => '{"redaction_version":"test"}'::jsonb,
  target_payload_ciphertext => decode('94', 'hex'),
  target_payload_sha256 => decode(repeat('94', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'paypal_webhook_signature_api'
) ignored;

SELECT extensions.ok(
  (
    SELECT processing_status = 'ignored' AND NOT is_duplicate
    FROM paypal_dispute_update_no_effect
  )
  AND EXISTS (
    SELECT 1
    FROM public.payment_gateway_events event
    JOIN public.payment_gateway_event_applications application
      ON application.gateway_event_id = event.id
    WHERE event.id = (
      SELECT gateway_event_id FROM paypal_dispute_update_no_effect
    )
      AND event.payment_attempt_id IS NULL
      AND event.original_financial_movement_id IS NULL
      AND event.redacted_payload @>
        '{"provider_event_disposition":"no_financial_effect"}'::jsonb
      AND application.effect = 'ignored'
  ),
  'PayPal dispute updates persist contact-free lifecycle evidence without money'
);

SELECT extensions.ok(
  (
    SELECT is_duplicate
    FROM public.ingest_verified_paypal_dispute_no_effect(
      target_provider_account_scope => 'paypal',
      target_provider_event_id => 'WH-PAYPAL-DISPUTE-UPDATED-0001',
      target_event_type => 'CUSTOMER.DISPUTE.UPDATED',
      target_provider_object_type => 'dispute',
      target_provider_object_id => 'PP-D-123456789',
      target_provider_state => 'updated_waiting_for_seller_response',
      target_redacted_payload => '{"redaction_version":"test"}'::jsonb,
      target_payload_ciphertext => decode('94', 'hex'),
      target_payload_sha256 => decode(repeat('94', 32), 'hex'),
      target_signature_verified_at => clock_timestamp(),
      target_occurred_at => (
        SELECT occurred_at
        FROM public.payment_gateway_events
        WHERE id = (
          SELECT gateway_event_id FROM paypal_dispute_update_no_effect
        )
      ),
      target_verification_method => 'paypal_webhook_signature_api'
    )
  ),
  'a repeated PayPal dispute update remains one durable ignored event'
);

WITH inserted AS (
  INSERT INTO public.sponsorship_intents (
    idempotency_key,
    source,
    source_host,
    sponsor_identity_id,
    contact_email_hmac,
    contact_email_normalization_version,
    contact_email_hmac_key_version,
    subject_kind,
    beneficiary_id,
    payment_mode,
    recurrence_interval,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    currency_rate_source
  )
  SELECT
    'paypal-webhook-parity-recurring-intent',
    'primary_site',
    'creatorshare.com',
    identity.uuid_value,
    decode(repeat('91', 32), 'hex'),
    1,
    1,
    'standard',
    beneficiary.uuid_value,
    'recurring',
    'month',
    2700,
    2700,
    'USD',
    1,
    clock_timestamp(),
    'paypal-webhook-parity'
  FROM paypal_webhook_parity_context identity
  CROSS JOIN paypal_webhook_parity_context beneficiary
  WHERE identity.key = 'identity'
    AND beneficiary.key = 'beneficiary'
  RETURNING id
)
INSERT INTO paypal_webhook_parity_context (key, uuid_value)
SELECT 'recurring_intent', id FROM inserted;

INSERT INTO paypal_webhook_parity_context (key, uuid_value)
SELECT 'recurring_quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'recurring_intent'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_quote_idempotency_key => 'paypal-webhook-parity-recurring-quote'
);

INSERT INTO paypal_webhook_parity_context (key, uuid_value)
SELECT 'recurring_attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'recurring_intent'
  ),
  target_payment_quote_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'recurring_quote'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_idempotency_key =>
    'paypal-webhook-parity-recurring-attempt',
  target_checkout_receipt_digest => decode(repeat('95', 32), 'hex')
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'recurring_attempt'
  ),
  target_provider_object_type => 'billing_subscription',
  target_provider_object_id => 'I-BW452GLLEP1G'
);

CREATE TEMP TABLE paypal_parity_catalog_claim ON COMMIT DROP AS
SELECT claim.*
FROM public.claim_paypal_billing_catalog_entry(
  target_subject_kind => 'standard',
  target_beneficiary_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'beneficiary'
  ),
  target_product_name => 'Monthly PayPal Webhook Parity Sponsorship',
  target_recurrence_interval => 'month',
  target_base_amount_usd_cents => 2700,
  target_charged_amount_minor => 2700,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_rate_source => 'paypal-webhook-parity'
) claim;

SELECT count(*)
FROM public.start_paypal_billing_catalog_provider_request(
  (
    SELECT catalog_entry_id FROM paypal_parity_catalog_claim
  ),
  (
    SELECT provisioning_lease_token FROM paypal_parity_catalog_claim
  ),
  'product'
);

SELECT count(*)
FROM public.record_paypal_billing_catalog_product(
  (
    SELECT catalog_entry_id FROM paypal_parity_catalog_claim
  ),
  (
    SELECT provisioning_lease_token FROM paypal_parity_catalog_claim
  ),
  'PROD-ZYXWVUTSRQPONMLKJ'
);

SELECT count(*)
FROM public.start_paypal_billing_catalog_provider_request(
  (
    SELECT catalog_entry_id FROM paypal_parity_catalog_claim
  ),
  (
    SELECT provisioning_lease_token FROM paypal_parity_catalog_claim
  ),
  'plan'
);

SELECT count(*)
FROM public.activate_paypal_billing_catalog_entry(
  (
    SELECT catalog_entry_id FROM paypal_parity_catalog_claim
  ),
  (
    SELECT provisioning_lease_token FROM paypal_parity_catalog_claim
  ),
  'PROD-ZYXWVUTSRQPONMLKJ',
  'P-ZYXWVUTSRQPONMLKJIHGFEDC'
);

SELECT extensions.is(
  (
    SELECT provider_plan_id
    FROM public.read_paypal_webhook_expected_plan(
      (
        SELECT uuid_value
        FROM paypal_webhook_parity_context
        WHERE key = 'recurring_attempt'
      )
    )
  ),
  'P-ZYXWVUTSRQPONMLKJIHGFEDC'::text,
  'recurring PayPal webhooks resolve the sole exact active server plan'
);

CREATE TEMP TABLE paypal_subscription_failed_ingest ON COMMIT DROP AS
SELECT failure.*
FROM public.ingest_verified_paypal_payment_failure_v2(
  target_payment_attempt_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'recurring_attempt'
  ),
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-PAYPAL-SUBSCRIPTION-FAILED-0001',
  target_event_type => 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  target_provider_object_type => 'billing_subscription',
  target_provider_object_id => 'I-BW452GLLEP1G',
  target_redacted_payload => '{"redaction_version":"test"}'::jsonb,
  target_payload_ciphertext => decode('96', 'hex'),
  target_payload_sha256 => decode(repeat('96', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'paypal_webhook_signature_api',
  target_fact_server_payment_attempt_id => (
    SELECT uuid_value
    FROM paypal_webhook_parity_context
    WHERE key = 'recurring_attempt'
  ),
  target_fact_parent_provider_object_type => NULL,
  target_fact_parent_provider_object_id => NULL,
  target_fact_provider_customer_id => 'QDGTZ7B92B9QT',
  target_fact_provider_subscription_id => 'I-BW452GLLEP1G',
  target_fact_failure_code => 'paypal_subscription_payment_failed'
) failure;

CREATE TEMP TABLE paypal_subscription_failed_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events(
  'paypal-webhook-parity-worker',
  20
) claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM paypal_subscription_failed_ingest
);

CREATE TEMP TABLE paypal_subscription_failed_applied ON COMMIT DROP AS
SELECT applied.*
FROM public.apply_paypal_payment_failure_v2(
  (
    SELECT gateway_event_id FROM paypal_subscription_failed_lease
  ),
  (
    SELECT processing_lease_token FROM paypal_subscription_failed_lease
  )
) applied;

SELECT extensions.ok(
  (
    SELECT application_effect = 'payment_failed'
      AND subscription_id IS NULL
    FROM paypal_subscription_failed_applied
  )
  AND (
    SELECT status = 'pending'
    FROM public.sponsorship_payment_attempts
    WHERE id = (
      SELECT uuid_value
      FROM paypal_webhook_parity_context
      WHERE key = 'recurring_attempt'
    )
  ),
  'a retryable initial PayPal subscription failure is recorded without terminating checkout'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.ingest_verified_paypal_dispute_no_effect(
      'paypal',
      'WH-PAYPAL-DISPUTE-BAD-SELLER-WIN',
      'CUSTOMER.DISPUTE.RESOLVED',
      'dispute',
      'PP-D-999999999',
      'resolved_seller_favor',
      '{}'::jsonb,
      decode('97', 'hex'),
      decode(repeat('97', 32), 'hex'),
      clock_timestamp(),
      clock_timestamp(),
      'paypal_webhook_signature_api'
    )
  $$,
  '22023',
  'Unsupported PayPal no-effect dispute disposition',
  'seller-favor dispute resolutions cannot bypass the monetary credit path'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.read_paypal_webhook_expected_plan(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.read_paypal_webhook_expected_plan(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.apply_paypal_payment_failure_v2(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.ingest_verified_paypal_dispute_no_effect(text,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text)',
    'EXECUTE'
  ),
  'browser callers cannot read plan boundaries or apply PayPal webhook evidence'
);

SELECT * FROM extensions.finish();

ROLLBACK;
