BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

-- Superuser fixture and unit calls use the shared private payment core.
-- Public caller authority and recovery contracts are exercised through v2.

CREATE TEMP TABLE adjustment_test_context (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE adjustment_test_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE adjustment_test_leases (
  key text PRIMARY KEY,
  gateway_event_id uuid NOT NULL,
  processing_lease_token uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE adjustment_test_attribution_snapshot (
  sponsorship_intent_id uuid PRIMARY KEY,
  evidence jsonb NOT NULL
) ON COMMIT DROP;

UPDATE public.payment_provider_accounts
SET environment = 'live'
WHERE (provider = 'STRIPE' AND scope = 'stripe_us')
   OR (provider = 'PAYPAL' AND scope = 'paypal');

WITH inserted AS (
  INSERT INTO public.beneficiaries (
    name,
    username,
    budget_goal,
    status
  )
  VALUES (
    'Financial Adjustment Beneficiary',
    'financial-adjustment-beneficiary',
    -1,
    'New'
  )
  RETURNING id
)
INSERT INTO adjustment_test_context
SELECT 'beneficiary', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO adjustment_test_context
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
  value,
  'email',
  'creator_share',
  decode(repeat('d1', 32), 'hex'),
  1,
  1,
  'provider_asserted'
FROM adjustment_test_context
WHERE key = 'identity';

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
    'financial-adjustment-stripe-intent-0001',
    'primary_site',
    'creatorshare.com',
    identity.value,
    decode(repeat('d1', 32), 'hex'),
    1,
    1,
    'standard',
    beneficiary.value,
    'one_time',
    10000,
    10000,
    'USD',
    1,
    clock_timestamp(),
    'financial-adjustment-test'
  FROM adjustment_test_context identity
  CROSS JOIN adjustment_test_context beneficiary
  WHERE identity.key = 'identity'
    AND beneficiary.key = 'beneficiary'
  RETURNING id
)
INSERT INTO adjustment_test_context
SELECT 'stripe_intent', id FROM inserted;

INSERT INTO adjustment_test_context
SELECT 'stripe_quote', payment_quote_id
FROM private.issue_sponsorship_payment_quote_core_v1(
  target_sponsorship_intent_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'stripe_intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'financial-adjustment-stripe-quote-0001'
);

INSERT INTO adjustment_test_context
SELECT 'stripe_attempt', payment_attempt_id
FROM private.begin_sponsorship_payment_core_v1(
  target_sponsorship_intent_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'stripe_intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'stripe_quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'financial-adjustment-stripe-attempt-0001',
  target_checkout_receipt_digest => decode(repeat('d2', 32), 'hex')
);

SELECT count(*)
FROM private.attach_sponsorship_payment_provider_object_core_v1(
  target_payment_attempt_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'stripe_attempt'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_test_financial_adjustment_0001'
);

INSERT INTO adjustment_test_times
VALUES ('stripe_gross', clock_timestamp());

INSERT INTO adjustment_test_context
SELECT 'stripe_gross_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'stripe_attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_gross_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_test_financial_adjustment_0001',
  target_redacted_payload => '{"payment_status":"paid"}'::jsonb,
  target_payload_ciphertext => decode('d3', 'hex'),
  target_payload_sha256 => decode(repeat('d3', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'stripe_gross'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'stripe_gross'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'stripe_attempt'
  ),
  target_fact_provider_movement_type => 'payment_intent',
  target_fact_provider_movement_id => 'pi_financial_adjustment_gross_0001',
  target_fact_base_amount_usd_cents => 10000,
  target_fact_charged_amount_minor => 10000,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
);

INSERT INTO adjustment_test_leases
SELECT
  'stripe_gross',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value FROM adjustment_test_context WHERE key = 'stripe_gross_event'
);

CREATE TEMP TABLE adjustment_stripe_gross_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'stripe_gross'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'stripe_gross'
  ),
  target_claim_token_digest => decode(repeat('d4', 32), 'hex'),
  target_recipient_email_ciphertext => decode('d4', 'hex'),
  target_email_encryption_key_version => 1::smallint,
  target_secret_payload_ciphertext => decode('d5', 'hex')
);

INSERT INTO adjustment_test_context
SELECT 'stripe_gross_movement', financial_movement_id
FROM adjustment_stripe_gross_result;

INSERT INTO adjustment_test_attribution_snapshot
SELECT
  attribution.sponsorship_intent_id,
  to_jsonb(attribution)
FROM public.sponsorship_attributions attribution
WHERE attribution.sponsorship_intent_id = (
  SELECT value FROM adjustment_test_context WHERE key = 'stripe_intent'
);

INSERT INTO public.sponsorship_refund_requirements (
  financial_movement_id,
  source_gateway_event_id,
  payment_attempt_id,
  sponsorship_intent_id,
  beneficiary_id,
  provider,
  provider_account_scope,
  reason,
  operational_alert
)
SELECT
  movement.id,
  movement.source_gateway_event_id,
  movement.payment_attempt_id,
  movement.sponsorship_intent_id,
  intent.beneficiary_id,
  movement.provider,
  movement.provider_account_scope,
  'Test fixture requiring a complete provider refund',
  jsonb_build_object(
    'severity', 'critical',
    'operation', 'refund_required',
    'fixture', true
  )
FROM public.sponsorship_financial_movements movement
JOIN public.sponsorship_intents intent
  ON intent.id = movement.sponsorship_intent_id
WHERE movement.id = (
  SELECT value
  FROM adjustment_test_context
  WHERE key = 'stripe_gross_movement'
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
    'financial-adjustment-paypal-intent-0001',
    'primary_site',
    'creatorshare.com',
    identity.value,
    decode(repeat('d1', 32), 'hex'),
    1,
    1,
    'standard',
    beneficiary.value,
    'one_time',
    5000,
    5000,
    'USD',
    1,
    clock_timestamp(),
    'financial-adjustment-test'
  FROM adjustment_test_context identity
  CROSS JOIN adjustment_test_context beneficiary
  WHERE identity.key = 'identity'
    AND beneficiary.key = 'beneficiary'
  RETURNING id
)
INSERT INTO adjustment_test_context
SELECT 'paypal_intent', id FROM inserted;

INSERT INTO adjustment_test_context
SELECT 'paypal_quote', payment_quote_id
FROM private.issue_sponsorship_payment_quote_core_v1(
  target_sponsorship_intent_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'paypal_intent'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_quote_idempotency_key => 'financial-adjustment-paypal-quote-0001'
);

INSERT INTO adjustment_test_context
SELECT 'paypal_attempt', payment_attempt_id
FROM private.begin_sponsorship_payment_core_v1(
  target_sponsorship_intent_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'paypal_intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'paypal_quote'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_idempotency_key => 'financial-adjustment-paypal-attempt-0001',
  target_checkout_receipt_digest => decode(repeat('d6', 32), 'hex')
);

SELECT count(*)
FROM private.attach_sponsorship_payment_provider_object_core_v1(
  target_payment_attempt_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'paypal_attempt'
  ),
  target_provider_object_type => 'order',
  target_provider_object_id => 'ORDER-FINANCIAL-ADJUSTMENT-0001'
);

INSERT INTO adjustment_test_times
VALUES ('paypal_gross', clock_timestamp());

INSERT INTO adjustment_test_context
SELECT 'paypal_gross_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'paypal_attempt'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-FINANCIAL-ADJUSTMENT-GROSS-0001',
  target_event_type => 'PAYMENT.CAPTURE.COMPLETED',
  target_provider_object_type => 'capture',
  target_provider_object_id => 'CAPTURE-FINANCIAL-ADJUSTMENT-0001',
  target_redacted_payload => '{"status":"COMPLETED"}'::jsonb,
  target_payload_ciphertext => decode('d7', 'hex'),
  target_payload_sha256 => decode(repeat('d7', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'paypal_gross'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'paypal_gross'
  ),
  target_verification_method => 'paypal_webhook_signature_api',
  target_fact_payment_status => 'completed',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'paypal_attempt'
  ),
  target_fact_parent_provider_object_type => 'order',
  target_fact_parent_provider_object_id => 'ORDER-FINANCIAL-ADJUSTMENT-0001',
  target_fact_provider_movement_type => 'capture',
  target_fact_provider_movement_id => 'CAPTURE-FINANCIAL-ADJUSTMENT-0001',
  target_fact_base_amount_usd_cents => 5000,
  target_fact_charged_amount_minor => 5000,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
);

INSERT INTO adjustment_test_leases
SELECT
  'paypal_gross',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value FROM adjustment_test_context WHERE key = 'paypal_gross_event'
);

CREATE TEMP TABLE adjustment_paypal_gross_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'paypal_gross'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'paypal_gross'
  )
);

INSERT INTO adjustment_test_context
SELECT 'paypal_gross_movement', financial_movement_id
FROM adjustment_paypal_gross_result;

INSERT INTO adjustment_test_times
VALUES ('partial_refund', clock_timestamp());

CREATE TEMP TABLE adjustment_partial_refund_ingest ON COMMIT DROP AS
SELECT *
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'stripe_gross_movement'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_partial_refund_0001',
  target_event_type => 'refund.created',
  target_provider_object_type => 'refund',
  target_provider_object_id => 're_financial_adjustment_partial_0001',
  target_adjustment_provider_movement_type => 'refund',
  target_adjustment_provider_movement_id => 're_financial_adjustment_partial_0001',
  target_charged_amount_minor => 2000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"succeeded"}'::jsonb,
  target_payload_ciphertext => decode('d8', 'hex'),
  target_payload_sha256 => decode(repeat('d8', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'partial_refund'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'partial_refund'
  ),
  target_verification_method => 'stripe_webhook_signature'
);

INSERT INTO adjustment_test_context
SELECT 'partial_refund_event', gateway_event_id
FROM adjustment_partial_refund_ingest;

INSERT INTO adjustment_test_leases
SELECT
  'partial_refund',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value FROM adjustment_test_context WHERE key = 'partial_refund_event'
);

CREATE TEMP TABLE adjustment_partial_refund_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_financial_adjustment(
  target_gateway_event_id => (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'partial_refund'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'partial_refund'
  )
);

SELECT extensions.is(
  (SELECT application_effect::text FROM adjustment_partial_refund_result),
  'refund_applied',
  'a verified partial Stripe refund appends one refund effect'
);

SELECT extensions.is(
  (SELECT net_base_amount_usd_cents FROM adjustment_partial_refund_result),
  8000::bigint,
  'a partial refund reduces normalized net USD without rewriting gross evidence'
);

SELECT extensions.ok(
  (
    SELECT
      movement.base_amount_usd_cents IS NULL
      AND movement.charged_amount_minor = 2000
      AND movement.net_charged_amount_minor = -2000
      AND movement.original_financial_movement_id = (
        SELECT value
        FROM adjustment_test_context
        WHERE key = 'stripe_gross_movement'
      )
    FROM public.sponsorship_financial_movements movement
    WHERE movement.id = (
      SELECT financial_movement_id
      FROM adjustment_partial_refund_result
    )
  ),
  'adjustment movement retains positive provider evidence and a signed canonical offset'
);

SELECT extensions.ok(
  (
    SELECT
      ledger.credit IS NULL
      AND ledger.charged_amount = 2000
      AND ledger.base_amount_usd_cents IS NULL
    FROM public.transaction_ledger ledger
    WHERE ledger.id = (
      SELECT transaction_ledger_id
      FROM adjustment_partial_refund_result
    )
  ),
  'adjustment ledger retains exact provider evidence without a rounded USD posting'
);

CREATE TEMP TABLE adjustment_partial_refund_replay ON COMMIT DROP AS
SELECT *
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'stripe_gross_movement'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_partial_refund_0001',
  target_event_type => 'refund.created',
  target_provider_object_type => 'refund',
  target_provider_object_id => 're_financial_adjustment_partial_0001',
  target_adjustment_provider_movement_type => 'refund',
  target_adjustment_provider_movement_id => 're_financial_adjustment_partial_0001',
  target_charged_amount_minor => 2000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"succeeded"}'::jsonb,
  target_payload_ciphertext => decode('d8', 'hex'),
  target_payload_sha256 => decode(repeat('d8', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'partial_refund'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'partial_refund'
  ),
  target_verification_method => 'stripe_webhook_signature'
);

SELECT extensions.ok(
  (
    SELECT
      replay.is_duplicate
      AND replay.gateway_event_id = original.gateway_event_id
    FROM adjustment_partial_refund_replay replay
    CROSS JOIN adjustment_partial_refund_ingest original
  ),
  'an exact provider event replay resolves to the original immutable event'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_financial_movements movement
    WHERE movement.original_financial_movement_id = (
      SELECT value
      FROM adjustment_test_context
      WHERE key = 'stripe_gross_movement'
    )
  ),
  1::bigint,
  'an exact event replay cannot append another financial movement'
);

INSERT INTO adjustment_test_times
VALUES ('duplicate_movement', clock_timestamp());

INSERT INTO adjustment_test_context
SELECT 'duplicate_movement_event', gateway_event_id
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'stripe_gross_movement'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_duplicate_movement_0001',
  target_event_type => 'refund.created',
  target_provider_object_type => 'refund',
  target_provider_object_id => 're_financial_adjustment_partial_0001',
  target_adjustment_provider_movement_type => 'refund',
  target_adjustment_provider_movement_id => 're_financial_adjustment_partial_0001',
  target_charged_amount_minor => 2000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"duplicate_delivery":true}'::jsonb,
  target_payload_ciphertext => decode('d9', 'hex'),
  target_payload_sha256 => decode(repeat('d9', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'duplicate_movement'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'duplicate_movement'
  ),
  target_verification_method => 'provider_api_response'
);

INSERT INTO adjustment_test_leases
SELECT
  'duplicate_movement',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value
  FROM adjustment_test_context
  WHERE key = 'duplicate_movement_event'
);

CREATE TEMP TABLE adjustment_duplicate_movement_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_financial_adjustment(
  target_gateway_event_id => (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'duplicate_movement'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'duplicate_movement'
  )
);

SELECT extensions.is(
  (
    SELECT application_effect::text
    FROM adjustment_duplicate_movement_result
  ),
  'duplicate_movement',
  'a new event for an existing provider movement is classified without double counting'
);

SELECT extensions.is(
  (
    SELECT net_base_amount_usd_cents
    FROM adjustment_duplicate_movement_result
  ),
  8000::bigint,
  'duplicate provider movement delivery leaves aggregate net unchanged'
);

INSERT INTO adjustment_test_times
VALUES ('over_refund', clock_timestamp());

INSERT INTO adjustment_test_context
SELECT 'over_refund_event', gateway_event_id
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'stripe_gross_movement'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_over_refund_0001',
  target_event_type => 'refund.created',
  target_provider_object_type => 'refund',
  target_provider_object_id => 're_financial_adjustment_over_0001',
  target_adjustment_provider_movement_type => 'refund',
  target_adjustment_provider_movement_id => 're_financial_adjustment_over_0001',
  target_charged_amount_minor => 9000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"succeeded"}'::jsonb,
  target_payload_ciphertext => decode('da', 'hex'),
  target_payload_sha256 => decode(repeat('da', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'over_refund'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'over_refund'
  ),
  target_verification_method => 'stripe_webhook_signature'
);

INSERT INTO adjustment_test_leases
SELECT
  'over_refund',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value FROM adjustment_test_context WHERE key = 'over_refund_event'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.apply_sponsorship_financial_adjustment(%L::uuid, %L::uuid)',
    (
      SELECT gateway_event_id::text
      FROM adjustment_test_leases
      WHERE key = 'over_refund'
    ),
    (
      SELECT processing_lease_token::text
      FROM adjustment_test_leases
      WHERE key = 'over_refund'
    )
  ),
  '23514',
  'Financial adjustment would move aggregate net outside the original gross payment',
  'aggregate offsets cannot reduce normalized or charged net below zero'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.apply_sponsorship_financial_adjustment(%L::uuid, %L::uuid)',
    (
      SELECT gateway_event_id::text
      FROM adjustment_test_leases
      WHERE key = 'over_refund'
    ),
    gen_random_uuid()::text
  ),
  '55P03',
  'Financial adjustment processing lease is missing or stale',
  'a stale or forged worker lease cannot settle a financial adjustment'
);

INSERT INTO adjustment_test_times
VALUES ('unmatched_dispute_credit', clock_timestamp());

INSERT INTO adjustment_test_context
SELECT 'unmatched_dispute_credit_event', gateway_event_id
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'stripe_gross_movement'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_unmatched_credit_0001',
  target_event_type => 'charge.dispute.funds_reinstated',
  target_provider_object_type => 'dispute',
  target_provider_object_id => 'dp_financial_adjustment_0001',
  target_adjustment_provider_movement_type => 'dispute',
  target_adjustment_provider_movement_id => 'dp_financial_adjustment_0001',
  target_charged_amount_minor => 1000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"won"}'::jsonb,
  target_payload_ciphertext => decode('e1', 'hex'),
  target_payload_sha256 => decode(repeat('e1', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value
    FROM adjustment_test_times
    WHERE key = 'unmatched_dispute_credit'
  ),
  target_occurred_at => (
    SELECT value
    FROM adjustment_test_times
    WHERE key = 'unmatched_dispute_credit'
  ),
  target_verification_method => 'stripe_webhook_signature'
);

INSERT INTO adjustment_test_leases
SELECT
  'unmatched_dispute_credit',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value
  FROM adjustment_test_context
  WHERE key = 'unmatched_dispute_credit_event'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.apply_sponsorship_financial_adjustment(%L::uuid, %L::uuid)',
    (
      SELECT gateway_event_id::text
      FROM adjustment_test_leases
      WHERE key = 'unmatched_dispute_credit'
    ),
    (
      SELECT processing_lease_token::text
      FROM adjustment_test_leases
      WHERE key = 'unmatched_dispute_credit'
    )
  ),
  '23514',
  'Dispute reinstatement exceeds the verified outstanding dispute debit',
  'dispute reinstatement cannot manufacture net value without its matching debit'
);

-- The worker persists a retry after an out-of-order credit fails settlement.
SELECT extensions.ok(
  (
    SELECT processing_status = 'failed' AND processing_lease_token IS NULL
    FROM public.retry_sponsorship_payment_gateway_event(
      (SELECT gateway_event_id FROM adjustment_test_leases
       WHERE key = 'unmatched_dispute_credit'),
      (SELECT processing_lease_token FROM adjustment_test_leases
       WHERE key = 'unmatched_dispute_credit'),
      'adjustment_dependency_pending',
      interval '1 hour'
    )
  ),
  'an early dispute credit remains durably retryable and releases its lease'
);

-- Provider occurrence order is debit then credit; delivery order is reversed.
INSERT INTO adjustment_test_times
SELECT
  'dispute_debit',
  original.occurred_at + (credit.value - original.occurred_at) / 2
FROM adjustment_test_times credit
JOIN public.sponsorship_financial_movements original
  ON original.id = (
    SELECT value FROM adjustment_test_context WHERE key = 'stripe_gross_movement'
  )
WHERE credit.key = 'unmatched_dispute_credit';

INSERT INTO adjustment_test_context
SELECT 'dispute_debit_event', gateway_event_id
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'stripe_gross_movement'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_dispute_debit_0001',
  target_event_type => 'charge.dispute.funds_withdrawn',
  target_provider_object_type => 'dispute',
  target_provider_object_id => 'dp_financial_adjustment_0001',
  target_adjustment_provider_movement_type => 'dispute',
  target_adjustment_provider_movement_id => 'dp_financial_adjustment_0001',
  target_charged_amount_minor => 1000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"lost"}'::jsonb,
  target_payload_ciphertext => decode('db', 'hex'),
  target_payload_sha256 => decode(repeat('db', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'dispute_debit'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'dispute_debit'
  ),
  target_verification_method => 'stripe_webhook_signature'
);

INSERT INTO adjustment_test_leases
SELECT
  'dispute_debit',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value FROM adjustment_test_context WHERE key = 'dispute_debit_event'
);

CREATE TEMP TABLE adjustment_dispute_debit_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_financial_adjustment(
  target_gateway_event_id => (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'dispute_debit'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'dispute_debit'
  )
);

SELECT extensions.ok(
  (
    SELECT
      application_effect = 'dispute_debit_applied'
      AND net_base_amount_usd_cents = 7000
      AND net_charged_amount_minor = 7000
    FROM adjustment_dispute_debit_result
  ),
  'Stripe dispute withdrawal appends a bounded negative dispute movement'
);

-- Advance only the retry schedule in this superuser fixture. The lifecycle
-- trigger correctly forbids application callers from editing it directly.
-- Restore triggers before exercising claim, stale-lease rejection, and settlement.
SET LOCAL session_replication_role = replica;
UPDATE public.payment_gateway_events
SET available_at = clock_timestamp() - interval '1 second'
WHERE id = (
  SELECT value FROM adjustment_test_context
  WHERE key = 'unmatched_dispute_credit_event'
);
SET LOCAL session_replication_role = origin;

INSERT INTO adjustment_test_leases
SELECT
  'dispute_credit',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value FROM adjustment_test_context WHERE key = 'unmatched_dispute_credit_event'
);

SELECT extensions.ok(
  (
    SELECT recovered.processing_lease_token <> original.processing_lease_token
    FROM adjustment_test_leases recovered
    JOIN adjustment_test_leases original
      ON original.gateway_event_id = recovered.gateway_event_id
    WHERE recovered.key = 'dispute_credit'
      AND original.key = 'unmatched_dispute_credit'
  ),
  'the same early credit is reclaimed with a fresh processing lease'
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.apply_sponsorship_financial_adjustment(%L::uuid, %L::uuid)',
    (SELECT gateway_event_id FROM adjustment_test_leases
     WHERE key = 'unmatched_dispute_credit'),
    (SELECT processing_lease_token FROM adjustment_test_leases
     WHERE key = 'unmatched_dispute_credit')
  ),
  '55P03',
  'Financial adjustment processing lease is missing or stale',
  'the original worker cannot settle a reclaimed dispute credit'
);

CREATE TEMP TABLE adjustment_dispute_credit_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_financial_adjustment(
  target_gateway_event_id => (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'dispute_credit'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'dispute_credit'
  )
);

SELECT extensions.ok(
  (
    SELECT
      application_effect = 'dispute_credit_applied'
      AND net_base_amount_usd_cents = 8000
      AND net_charged_amount_minor = 8000
    FROM adjustment_dispute_credit_result
  ),
  'the retried early dispute credit restores the net after its matching debit arrives'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_financial_movements movement
    WHERE movement.provider = 'STRIPE'
      AND movement.provider_account_scope = 'stripe_us'
      AND movement.provider_movement_type = 'dispute'
      AND movement.provider_movement_id = 'dp_financial_adjustment_0001'
  ),
  2::bigint,
  'one provider dispute can carry one debit and one distinct reinstatement movement'
);

INSERT INTO adjustment_test_times
VALUES ('full_refund', clock_timestamp());

INSERT INTO adjustment_test_context
SELECT 'full_refund_event', gateway_event_id
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'stripe_gross_movement'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_full_refund_0001',
  target_event_type => 'refund.created',
  target_provider_object_type => 'refund',
  target_provider_object_id => 're_financial_adjustment_full_0001',
  target_adjustment_provider_movement_type => 'refund',
  target_adjustment_provider_movement_id => 're_financial_adjustment_full_0001',
  target_charged_amount_minor => 8000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"succeeded"}'::jsonb,
  target_payload_ciphertext => decode('dd', 'hex'),
  target_payload_sha256 => decode(repeat('dd', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'full_refund'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'full_refund'
  ),
  target_verification_method => 'stripe_webhook_signature'
);

INSERT INTO adjustment_test_leases
SELECT
  'full_refund',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value FROM adjustment_test_context WHERE key = 'full_refund_event'
);

CREATE TEMP TABLE adjustment_full_refund_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_financial_adjustment(
  target_gateway_event_id => (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'full_refund'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'full_refund'
  )
);

SELECT extensions.ok(
  (
    SELECT
      application_effect = 'refund_applied'
      AND net_base_amount_usd_cents = 0
      AND net_charged_amount_minor = 0
      AND refund_requirement_resolution_id IS NOT NULL
    FROM adjustment_full_refund_result
  ),
  'a full verified refund reaches zero net and appends refund resolution evidence'
);

SELECT extensions.ok(
  (
    SELECT
      requirement.status = 'pending'
      AND resolution.final_net_base_amount_usd_cents = 0
      AND resolution.final_net_charged_amount_minor = 0
    FROM public.sponsorship_refund_requirements requirement
    JOIN public.sponsorship_refund_requirement_resolutions resolution
      ON resolution.refund_requirement_id = requirement.id
    WHERE requirement.financial_movement_id = (
      SELECT value
      FROM adjustment_test_context
      WHERE key = 'stripe_gross_movement'
    )
  ),
  'append-only refund requirement remains unchanged beside immutable resolution evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.ingest_verified_sponsorship_financial_adjustment(
      target_original_financial_movement_id => (
        SELECT value
        FROM adjustment_test_context
        WHERE key = 'paypal_gross_movement'
      ),
      target_provider => 'PAYPAL',
      target_provider_account_scope => 'paypal',
      target_provider_event_id => 'WH-FINANCIAL-ADJUSTMENT-BAD-MAPPING-0001',
      target_event_type => 'PAYMENT.CAPTURE.REFUNDED',
      target_provider_object_type => 'sale',
      target_provider_object_id => 'CAPTURE-FINANCIAL-ADJUSTMENT-0001',
      target_adjustment_provider_movement_type => 'refund',
      target_adjustment_provider_movement_id => 'REFUND-BAD-MAPPING-0001',
      target_charged_amount_minor => 5000,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_redacted_payload => '{}'::jsonb,
      target_payload_ciphertext => decode('e2', 'hex'),
      target_payload_sha256 => decode(repeat('e2', 32), 'hex'),
      target_signature_verified_at => clock_timestamp(),
      target_occurred_at => clock_timestamp(),
      target_verification_method => 'paypal_webhook_signature_api'
    )
  $$,
  '22023',
  'Unsupported financial adjustment event and object mapping',
  'PayPal capture and sale event subjects cannot be cross-wired'
);

INSERT INTO adjustment_test_times
VALUES ('paypal_dispute_debit', clock_timestamp());

CREATE TEMP TABLE adjustment_paypal_dispute_debit_ingest ON COMMIT DROP AS
SELECT ingested.*
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'paypal_gross_movement'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-PAYPAL-DISPUTE-DEBIT-0001',
  target_event_type => 'CUSTOMER.DISPUTE.CREATED',
  target_provider_object_type => 'capture',
  target_provider_object_id => 'CAPTURE-FINANCIAL-ADJUSTMENT-0001',
  target_adjustment_provider_movement_type => 'dispute',
  target_adjustment_provider_movement_id => 'PP-D-123456789',
  target_charged_amount_minor => 1200,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"UNDER_REVIEW"}'::jsonb,
  target_payload_ciphertext => decode('e7', 'hex'),
  target_payload_sha256 => decode(repeat('e7', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value
    FROM adjustment_test_times
    WHERE key = 'paypal_dispute_debit'
  ),
  target_occurred_at => (
    SELECT value
    FROM adjustment_test_times
    WHERE key = 'paypal_dispute_debit'
  ),
  target_verification_method => 'paypal_webhook_signature_api'
) ingested;

SELECT extensions.ok(
  (
    SELECT adjustment_kind = 'sponsorship_dispute_debit'
      AND NOT is_duplicate
    FROM adjustment_paypal_dispute_debit_ingest
  )
  AND (
    SELECT is_duplicate
    FROM public.ingest_verified_sponsorship_financial_adjustment(
      target_original_financial_movement_id => (
        SELECT value
        FROM adjustment_test_context
        WHERE key = 'paypal_gross_movement'
      ),
      target_provider => 'PAYPAL',
      target_provider_account_scope => 'paypal',
      target_provider_event_id => 'WH-PAYPAL-DISPUTE-DEBIT-0001',
      target_event_type => 'CUSTOMER.DISPUTE.CREATED',
      target_provider_object_type => 'capture',
      target_provider_object_id => 'CAPTURE-FINANCIAL-ADJUSTMENT-0001',
      target_adjustment_provider_movement_type => 'dispute',
      target_adjustment_provider_movement_id => 'PP-D-123456789',
      target_charged_amount_minor => 1200,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_redacted_payload => '{"status":"UNDER_REVIEW"}'::jsonb,
      target_payload_ciphertext => decode('e7', 'hex'),
      target_payload_sha256 => decode(repeat('e7', 32), 'hex'),
      target_signature_verified_at => clock_timestamp(),
      target_occurred_at => (
        SELECT value
        FROM adjustment_test_times
        WHERE key = 'paypal_dispute_debit'
      ),
      target_verification_method => 'paypal_webhook_signature_api'
    )
  ),
  'partial PayPal dispute debit ingestion is idempotent on one original capture'
);

INSERT INTO adjustment_test_leases
SELECT
  'paypal_dispute_debit',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT gateway_event_id
  FROM adjustment_paypal_dispute_debit_ingest
);

CREATE TEMP TABLE adjustment_paypal_dispute_debit_result ON COMMIT DROP AS
SELECT applied.*
FROM public.apply_sponsorship_financial_adjustment(
  (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'paypal_dispute_debit'
  ),
  (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'paypal_dispute_debit'
  )
) applied;

SELECT extensions.ok(
  (
    SELECT application_effect = 'dispute_debit_applied'
      AND net_base_amount_usd_cents = 3800
      AND net_charged_amount_minor = 3800
    FROM adjustment_paypal_dispute_debit_result
  ),
  'a partial PayPal dispute creates one bounded negative movement'
);

INSERT INTO adjustment_test_times
VALUES ('paypal_dispute_credit', clock_timestamp());

CREATE TEMP TABLE adjustment_paypal_dispute_credit_ingest ON COMMIT DROP AS
SELECT ingested.*
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'paypal_gross_movement'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-PAYPAL-DISPUTE-CREDIT-0001',
  target_event_type => 'CUSTOMER.DISPUTE.RESOLVED',
  target_provider_object_type => 'capture',
  target_provider_object_id => 'CAPTURE-FINANCIAL-ADJUSTMENT-0001',
  target_adjustment_provider_movement_type => 'dispute',
  target_adjustment_provider_movement_id => 'PP-D-123456789',
  target_charged_amount_minor => 1200,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"outcome":"RESOLVED_SELLER_FAVOUR"}'::jsonb,
  target_payload_ciphertext => decode('e8', 'hex'),
  target_payload_sha256 => decode(repeat('e8', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value
    FROM adjustment_test_times
    WHERE key = 'paypal_dispute_credit'
  ),
  target_occurred_at => (
    SELECT value
    FROM adjustment_test_times
    WHERE key = 'paypal_dispute_credit'
  ),
  target_verification_method => 'paypal_webhook_signature_api'
) ingested;

INSERT INTO adjustment_test_leases
SELECT
  'paypal_dispute_credit',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT gateway_event_id
  FROM adjustment_paypal_dispute_credit_ingest
);

CREATE TEMP TABLE adjustment_paypal_dispute_credit_result ON COMMIT DROP AS
SELECT applied.*
FROM public.apply_sponsorship_financial_adjustment(
  (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'paypal_dispute_credit'
  ),
  (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'paypal_dispute_credit'
  )
) applied;

SELECT extensions.ok(
  (
    SELECT application_effect = 'dispute_credit_applied'
      AND net_base_amount_usd_cents = 5000
      AND net_charged_amount_minor = 5000
    FROM adjustment_paypal_dispute_credit_result
  )
  AND (
    SELECT count(*) = 2
    FROM public.sponsorship_financial_movements movement
    WHERE movement.original_financial_movement_id = (
      SELECT value
      FROM adjustment_test_context
      WHERE key = 'paypal_gross_movement'
    )
      AND movement.provider = 'PAYPAL'
      AND movement.provider_movement_type = 'dispute'
      AND movement.provider_movement_id = 'PP-D-123456789'
      AND movement.entry_kind IN (
        'sponsorship_dispute_debit',
        'sponsorship_dispute_credit'
      )
  ),
  'a seller-favor PayPal resolution credits only the outstanding dispute debit'
);

INSERT INTO adjustment_test_times
VALUES ('paypal_reversal', clock_timestamp());

INSERT INTO adjustment_test_context
SELECT 'paypal_reversal_event', gateway_event_id
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'paypal_gross_movement'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-FINANCIAL-ADJUSTMENT-REVERSAL-0001',
  target_event_type => 'PAYMENT.CAPTURE.REVERSED',
  target_provider_object_type => 'capture',
  target_provider_object_id => 'CAPTURE-FINANCIAL-ADJUSTMENT-0001',
  target_adjustment_provider_movement_type => 'reversal',
  target_adjustment_provider_movement_id => 'REVERSAL-FINANCIAL-ADJUSTMENT-0001',
  target_charged_amount_minor => 5000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"REVERSED"}'::jsonb,
  target_payload_ciphertext => decode('de', 'hex'),
  target_payload_sha256 => decode(repeat('de', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'paypal_reversal'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'paypal_reversal'
  ),
  target_verification_method => 'paypal_webhook_signature_api'
);

INSERT INTO adjustment_test_leases
SELECT
  'paypal_reversal',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events(
  'financial-adjustment-test-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value
  FROM adjustment_test_context
  WHERE key = 'paypal_reversal_event'
);

CREATE TEMP TABLE adjustment_paypal_reversal_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_financial_adjustment(
  target_gateway_event_id => (
    SELECT gateway_event_id
    FROM adjustment_test_leases
    WHERE key = 'paypal_reversal'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token
    FROM adjustment_test_leases
    WHERE key = 'paypal_reversal'
  )
);

SELECT extensions.ok(
  (
    SELECT
      application_effect = 'reversal_applied'
      AND net_base_amount_usd_cents = 0
      AND net_charged_amount_minor = 0
    FROM adjustment_paypal_reversal_result
  ),
  'a verified PayPal capture reversal appends one complete offset'
);

SELECT extensions.is(
  (
    SELECT private.sum_normalized_usd_cents(
      original.base_amount_usd_cents, original.charged_amount_minor,
      movement.net_charged_amount_minor
    )::bigint
    FROM public.sponsorship_financial_movements movement
    JOIN public.sponsorship_financial_movements original
      ON original.id = movement.original_financial_movement_id
    WHERE movement.id = (
      SELECT financial_movement_id
      FROM adjustment_paypal_reversal_result
    )
  ),
  (-5000)::bigint,
  'PayPal reversal has a signed negative canonical value'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM adjustment_test_attribution_snapshot snapshot
    JOIN public.sponsorship_attributions attribution
      ON attribution.sponsorship_intent_id = snapshot.sponsorship_intent_id
    WHERE to_jsonb(attribution) IS DISTINCT FROM snapshot.evidence
  ),
  'refunds, disputes, and reversals never rewrite final sponsorship attribution'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.ingest_verified_sponsorship_financial_adjustment(uuid,public.sponsorship_method,text,text,text,text,text,text,text,bigint,public.payment_currency,numeric,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.apply_sponsorship_financial_adjustment(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'browser callers cannot invoke financial adjustment ingestion or settlement'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'public.sponsorship_financial_movements',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.sponsorship_refund_requirement_resolutions',
    'SELECT'
  ),
  'browser roles cannot read financial movements or refund resolution evidence'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_financial_movements
    SET base_amount_usd_cents = base_amount_usd_cents + 1
    WHERE id = (
      SELECT financial_movement_id
      FROM adjustment_partial_refund_result
    )
  $$,
  '42501',
  'Payment transaction evidence is append only',
  'financial adjustments remain immutable after application'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_refund_requirement_resolutions
    SET final_net_base_amount_usd_cents = 1
    WHERE id = (
      SELECT refund_requirement_resolution_id
      FROM adjustment_full_refund_result
    )
  $$,
  '42501',
  'Payment transaction evidence is append only',
  'refund requirement resolution evidence is append only'
);

-- Synthetic original-payment fixtures reuse the existing provider chains. Only
-- fixture creation bypasses triggers; ingestion, claim, and settlement do not.
CREATE FUNCTION pg_temp.clone_normalization_row(target_table regclass, source_value jsonb, changes jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE columns text;
BEGIN
  SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO columns
  FROM pg_attribute WHERE attrelid=target_table AND attnum>0 AND NOT attisdropped AND attgenerated='';
  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_record(NULL::%s,$1)',target_table,columns,columns,target_table)
    USING source_value || changes;
END;
$$;
CREATE FUNCTION pg_temp.normalization_payment(provider_name text, currency public.payment_currency, charged bigint, rate numeric)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  original public.sponsorship_financial_movements;
  intent_id uuid := gen_random_uuid(); attempt_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid(); movement_id uuid := gen_random_uuid();
  patch jsonb;
BEGIN
  SELECT * INTO original FROM public.sponsorship_financial_movements WHERE id=(
    SELECT value FROM adjustment_test_context WHERE key=lower(provider_name)||'_gross_movement');
  patch := jsonb_build_object('sponsorship_intent_id',intent_id,'payment_attempt_id',attempt_id,
    'base_amount_usd_cents',2500,'charged_amount_minor',charged,'charged_currency',currency,'conversion_rate',rate);
  PERFORM set_config('session_replication_role','replica',true);
  PERFORM pg_temp.clone_normalization_row('public.sponsorship_intents',
    (SELECT to_jsonb(t) FROM public.sponsorship_intents t WHERE id=original.sponsorship_intent_id),
    patch || jsonb_build_object('id',intent_id,'idempotency_key','normalization-'||intent_id));
  PERFORM pg_temp.clone_normalization_row('public.sponsorship_payment_attempts',
    (SELECT to_jsonb(t) FROM public.sponsorship_payment_attempts t WHERE id=original.payment_attempt_id),
    patch || jsonb_build_object('id',attempt_id,'provider_idempotency_key','normalization-'||attempt_id,
      'provider_object_id','normalization-'||attempt_id,
      'checkout_receipt_digest',extensions.digest(attempt_id::text,'sha256')));
  PERFORM pg_temp.clone_normalization_row('public.sponsorship_attributions',
    (SELECT to_jsonb(t) FROM public.sponsorship_attributions t WHERE sponsorship_intent_id=original.sponsorship_intent_id),
    jsonb_build_object('sponsorship_intent_id',intent_id));
  PERFORM pg_temp.clone_normalization_row('public.payment_gateway_events',
    (SELECT to_jsonb(t) FROM public.payment_gateway_events t WHERE id=original.source_gateway_event_id),
    patch || jsonb_build_object('id',event_id,'provider_event_id','normalization-'||event_id,
      'provider_object_id','normalization-'||attempt_id,
      'fact_provider_movement_id','normalization-'||movement_id,
      'fact_server_payment_attempt_id',attempt_id,'fact_base_amount_usd_cents',2500,
      'fact_charged_amount_minor',charged,'fact_charged_currency',currency,'fact_conversion_rate',rate));
  PERFORM pg_temp.clone_normalization_row('public.sponsorship_financial_movements',to_jsonb(original),
    patch || jsonb_build_object('id',movement_id,'source_gateway_event_id',event_id,'provider_movement_id','normalization-'||movement_id));
  PERFORM pg_temp.clone_normalization_row('public.payment_gateway_event_applications',
    (SELECT to_jsonb(t) FROM public.payment_gateway_event_applications t WHERE gateway_event_id=original.source_gateway_event_id),
    jsonb_build_object('id',gen_random_uuid(),'gateway_event_id',event_id,'financial_movement_id',movement_id));
  PERFORM set_config('session_replication_role','origin',true);
  RETURN movement_id;
END;
$$;
CREATE FUNCTION pg_temp.normalization_adjustment(root_id uuid, adjustment_kind text, amount bigint, movement_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE root public.sponsorship_financial_movements; operation_id uuid:=gen_random_uuid();
  event_id uuid; lease uuid; result jsonb; event_kind text; movement_type text;
BEGIN
  SELECT * INTO root FROM public.sponsorship_financial_movements WHERE id=root_id;
  movement_type := CASE WHEN adjustment_kind='refund' THEN 'refund' ELSE 'dispute' END;
  movement_key := coalesce(movement_key,'re_normalization_'||replace(operation_id::text,'-',''));
  event_kind := CASE WHEN root.provider='STRIPE' THEN CASE adjustment_kind
    WHEN 'refund' THEN 'refund.created' WHEN 'debit' THEN 'charge.dispute.funds_withdrawn' ELSE 'charge.dispute.funds_reinstated' END
    ELSE CASE adjustment_kind WHEN 'refund' THEN 'PAYMENT.CAPTURE.REFUNDED' WHEN 'debit' THEN 'CUSTOMER.DISPUTE.CREATED' ELSE 'CUSTOMER.DISPUTE.RESOLVED' END END;
  SELECT gateway_event_id INTO event_id FROM public.ingest_verified_sponsorship_financial_adjustment(
    target_original_financial_movement_id=>root.id,target_provider=>root.provider,
    target_provider_account_scope=>root.provider_account_scope,target_provider_event_id=>'normalization-'||operation_id,
    target_event_type=>event_kind,target_provider_object_type=>CASE WHEN root.provider='STRIPE' THEN movement_type ELSE root.provider_movement_type END,
    target_provider_object_id=>CASE WHEN root.provider='STRIPE' THEN movement_key ELSE root.provider_movement_id END,
    target_adjustment_provider_movement_type=>movement_type,target_adjustment_provider_movement_id=>movement_key,
    target_charged_amount_minor=>amount,target_charged_currency=>root.charged_currency,target_conversion_rate=>root.conversion_rate,
    target_redacted_payload=>'{}',target_payload_ciphertext=>decode('ab','hex'),target_payload_sha256=>extensions.digest(operation_id::text,'sha256'),
    target_signature_verified_at=>clock_timestamp(),target_occurred_at=>clock_timestamp(),
    target_verification_method=>CASE WHEN root.provider='STRIPE' THEN 'stripe_webhook_signature' ELSE 'paypal_webhook_signature_api' END);
  SELECT processing_lease_token INTO lease FROM public.claim_payment_gateway_events('normalization-test',100)
    WHERE gateway_event_id=event_id;
  SELECT to_jsonb(applied) INTO result FROM public.apply_sponsorship_financial_adjustment(event_id,lease) applied;
  RETURN result;
END;
$$;
CREATE FUNCTION pg_temp.verify_fractional_adjustments(provider_name text,currency public.payment_currency,charged bigint,rate numeric)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE root_id uuid; result jsonb; dispute_key text; label text:=provider_name||' '||currency;
BEGIN
  root_id:=pg_temp.normalization_payment(provider_name,currency,charged,rate);
  result:=pg_temp.normalization_adjustment(root_id,'refund',2);
  RETURN NEXT extensions.ok((result->>'net_charged_amount_minor')::bigint=charged-2,
    label||' accepts a two-unit provider refund without a rounded USD preimage');
  RETURN NEXT extensions.ok((result->>'net_base_amount_usd_cents')::bigint=private.round_normalized_usd(ARRAY[2500::numeric*(charged-2),charged::numeric]),
    label||' reports the exact-ratio remaining value');
  result:=pg_temp.normalization_adjustment(root_id,'refund',charged-2);
  RETURN NEXT extensions.ok(result @> '{"net_base_amount_usd_cents":0,"net_charged_amount_minor":0}'::jsonb,
    label||' split refunds completely reverse both original amounts');
  root_id:=pg_temp.normalization_payment(provider_name,currency,charged,rate);
  dispute_key:='dp_normalization_'||replace(root_id::text,'-','');
  PERFORM pg_temp.normalization_adjustment(root_id,'debit',1,dispute_key);
  PERFORM pg_temp.normalization_adjustment(root_id,'refund',1);
  result:=pg_temp.normalization_adjustment(root_id,'credit',1,dispute_key);
  RETURN NEXT extensions.ok((SELECT private.sum_normalized_usd_cents(2500,charged,net_charged_amount_minor)=0
    FROM public.sponsorship_financial_movements WHERE original_financial_movement_id=root_id
      AND entry_kind IN ('sponsorship_dispute_debit','sponsorship_dispute_credit')),
    label||' interleaved refund leaves no restored-dispute residual');
  RETURN NEXT extensions.ok((result->>'net_base_amount_usd_cents')::bigint=private.round_normalized_usd(ARRAY[2500::numeric*(charged-1),charged::numeric]),
    label||' restored dispute preserves the exact refund net');
END;
$$;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT checked.assertion FROM (VALUES ('STRIPE'),('PAYPAL')) provider(name)
CROSS JOIN (VALUES ('USD'::public.payment_currency,2500::bigint,1::numeric),('AUD',3500,1.4),('GBP',1850,0.74),('EUR',2150,0.86)) quote(currency,charged,rate)
CROSS JOIN LATERAL pg_temp.verify_fractional_adjustments(provider.name,quote.currency,quote.charged,quote.rate) checked(assertion);

SELECT * FROM extensions.finish();

ROLLBACK;
