BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

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
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'stripe_intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'financial-adjustment-stripe-quote-0001'
);

INSERT INTO adjustment_test_context
SELECT 'stripe_attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
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
FROM public.attach_sponsorship_payment_provider_object(
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
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM adjustment_test_context WHERE key = 'paypal_intent'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_quote_idempotency_key => 'financial-adjustment-paypal-quote-0001'
);

INSERT INTO adjustment_test_context
SELECT 'paypal_attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
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
FROM public.attach_sponsorship_payment_provider_object(
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
  target_base_amount_usd_cents => 2000,
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
      movement.base_amount_usd_cents = 2000
      AND movement.charged_amount_minor = 2000
      AND movement.net_base_amount_usd_cents = -2000
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
      ledger.credit = -2000
      AND ledger.charged_amount = 2000
      AND ledger.base_amount_usd_cents = 2000
    FROM public.transaction_ledger ledger
    WHERE ledger.id = (
      SELECT transaction_ledger_id
      FROM adjustment_partial_refund_result
    )
  ),
  'adjustment ledger uses signed credit while charged evidence remains positive'
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
  target_base_amount_usd_cents => 2000,
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
  target_base_amount_usd_cents => 2000,
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
  target_base_amount_usd_cents => 9000,
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
  target_provider_object_id => 'dp_financial_adjustment_unmatched_0001',
  target_adjustment_provider_movement_type => 'dispute',
  target_adjustment_provider_movement_id => 'dp_financial_adjustment_unmatched_0001',
  target_base_amount_usd_cents => 1000,
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

INSERT INTO adjustment_test_times
VALUES ('dispute_debit', clock_timestamp());

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
  target_base_amount_usd_cents => 1000,
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

INSERT INTO adjustment_test_times
VALUES ('dispute_credit', clock_timestamp());

INSERT INTO adjustment_test_context
SELECT 'dispute_credit_event', gateway_event_id
FROM public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id => (
    SELECT value
    FROM adjustment_test_context
    WHERE key = 'stripe_gross_movement'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_financial_adjustment_dispute_credit_0001',
  target_event_type => 'charge.dispute.funds_reinstated',
  target_provider_object_type => 'dispute',
  target_provider_object_id => 'dp_financial_adjustment_0001',
  target_adjustment_provider_movement_type => 'dispute',
  target_adjustment_provider_movement_id => 'dp_financial_adjustment_0001',
  target_base_amount_usd_cents => 1000,
  target_charged_amount_minor => 1000,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_redacted_payload => '{"status":"won"}'::jsonb,
  target_payload_ciphertext => decode('dc', 'hex'),
  target_payload_sha256 => decode(repeat('dc', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'dispute_credit'
  ),
  target_occurred_at => (
    SELECT value FROM adjustment_test_times WHERE key = 'dispute_credit'
  ),
  target_verification_method => 'stripe_webhook_signature'
);

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
  SELECT value FROM adjustment_test_context WHERE key = 'dispute_credit_event'
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
  'Stripe dispute reinstatement appends a bounded positive dispute movement'
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
  target_base_amount_usd_cents => 8000,
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
      target_base_amount_usd_cents => 5000,
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
  target_base_amount_usd_cents => 5000,
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
    SELECT movement.net_base_amount_usd_cents
    FROM public.sponsorship_financial_movements movement
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
    'public.ingest_verified_sponsorship_financial_adjustment(uuid,public.sponsorship_method,text,text,text,text,text,text,text,bigint,bigint,public.payment_currency,numeric,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text)',
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

SELECT * FROM extensions.finish();

ROLLBACK;
