BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE refund_updated_test_context (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE refund_updated_test_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

UPDATE public.payment_provider_accounts
SET environment = 'live'
WHERE provider = 'STRIPE'
  AND scope = 'stripe_us';

WITH inserted AS (
  INSERT INTO public.beneficiaries (
    name,
    username,
    budget_goal,
    status
  )
  VALUES (
    'Refund Updated Adjustment Beneficiary',
    'refund-updated-adjustment-beneficiary',
    -1,
    'New'
  )
  RETURNING id
)
INSERT INTO refund_updated_test_context
SELECT 'beneficiary', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO refund_updated_test_context
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
  decode(repeat('e1', 32), 'hex'),
  1,
  1,
  'provider_asserted'
FROM refund_updated_test_context
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
    'refund-updated-adjustment-intent-0001',
    'primary_site',
    'creatorshare.com',
    identity.value,
    decode(repeat('e1', 32), 'hex'),
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
    'refund-updated-adjustment-test'
  FROM refund_updated_test_context identity
  CROSS JOIN refund_updated_test_context beneficiary
  WHERE identity.key = 'identity'
    AND beneficiary.key = 'beneficiary'
  RETURNING id
)
INSERT INTO refund_updated_test_context
SELECT 'intent', id FROM inserted;

INSERT INTO refund_updated_test_context
SELECT 'quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM refund_updated_test_context WHERE key = 'intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'refund-updated-adjustment-quote-0001'
);

INSERT INTO refund_updated_test_context
SELECT 'attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM refund_updated_test_context WHERE key = 'intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM refund_updated_test_context WHERE key = 'quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'refund-updated-adjustment-attempt-0001',
  target_checkout_receipt_digest => decode(repeat('e2', 32), 'hex')
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id => (
    SELECT value FROM refund_updated_test_context WHERE key = 'attempt'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_refund_updated_adjustment_0001'
);

INSERT INTO refund_updated_test_times
VALUES ('gross', clock_timestamp());

INSERT INTO refund_updated_test_context
SELECT 'gross_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM refund_updated_test_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_refund_updated_adjustment_gross_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_refund_updated_adjustment_0001',
  target_redacted_payload => '{"payment_status":"paid"}'::jsonb,
  target_payload_ciphertext => decode('e3', 'hex'),
  target_payload_sha256 => decode(repeat('e3', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM refund_updated_test_times WHERE key = 'gross'
  ),
  target_occurred_at => (
    SELECT value FROM refund_updated_test_times WHERE key = 'gross'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM refund_updated_test_context WHERE key = 'attempt'
  ),
  target_fact_provider_movement_type => 'payment_intent',
  target_fact_provider_movement_id => 'pi_refund_updated_adjustment_0001',
  target_fact_base_amount_usd_cents => 10000,
  target_fact_charged_amount_minor => 10000,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
);

CREATE TEMP TABLE refund_updated_gross_lease ON COMMIT DROP AS
SELECT gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events(
  'refund-updated-adjustment-gross-worker',
  20
)
WHERE gateway_event_id = (
  SELECT value FROM refund_updated_test_context WHERE key = 'gross_event'
);

CREATE TEMP TABLE refund_updated_gross_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM refund_updated_gross_lease
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM refund_updated_gross_lease
  ),
  target_claim_token_digest => decode(repeat('e4', 32), 'hex'),
  target_recipient_email_ciphertext => decode('e4', 'hex'),
  target_email_encryption_key_version => 1::smallint,
  target_secret_payload_ciphertext => decode('e5', 'hex')
);

INSERT INTO refund_updated_test_context
SELECT 'gross_movement', financial_movement_id
FROM refund_updated_gross_result;

CREATE OR REPLACE FUNCTION pg_temp.ingest_test_stripe_refund(
  test_provider_event_id text,
  test_event_type text,
  test_refund_id text,
  test_amount bigint,
  test_digest_byte text,
  test_occurred_at timestamptz
)
RETURNS TABLE (
  gateway_event_id uuid,
  adjustment_kind text,
  is_duplicate boolean
)
LANGUAGE sql
AS $$
  SELECT
    result.gateway_event_id,
    result.adjustment_kind::text,
    result.is_duplicate
  FROM public.ingest_verified_sponsorship_financial_adjustment(
    target_original_financial_movement_id => (
      SELECT value
      FROM pg_temp.refund_updated_test_context
      WHERE key = 'gross_movement'
    ),
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_event_id => test_provider_event_id,
    target_event_type => test_event_type,
    target_provider_object_type => 'refund',
    target_provider_object_id => test_refund_id,
    target_adjustment_provider_movement_type => 'refund',
    target_adjustment_provider_movement_id => test_refund_id,
    target_base_amount_usd_cents => test_amount,
    target_charged_amount_minor => test_amount,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_redacted_payload => jsonb_build_object(
      'status', 'succeeded',
      'event_type', test_event_type
    ),
    target_payload_ciphertext => decode(test_digest_byte, 'hex'),
    target_payload_sha256 => decode(repeat(test_digest_byte, 32), 'hex'),
    target_signature_verified_at => test_occurred_at,
    target_occurred_at => test_occurred_at,
    target_verification_method => 'stripe_webhook_signature'
  ) result;
$$;

SELECT extensions.is(
  private.resolve_sponsorship_financial_adjustment_kind(
    'STRIPE',
    'refund.created',
    'refund',
    'refund'
  )::text,
  'sponsorship_refund',
  'refund.created retains the canonical Stripe refund mapping'
);

SELECT extensions.is(
  private.resolve_sponsorship_financial_adjustment_kind(
    'STRIPE',
    'refund.updated',
    'refund',
    'refund'
  )::text,
  'sponsorship_refund',
  'refund.updated maps to the same canonical Stripe refund movement kind'
);

SELECT extensions.is(
  private.resolve_sponsorship_financial_adjustment_kind(
    'STRIPE',
    'charge.dispute.funds_withdrawn',
    'dispute',
    'dispute'
  )::text,
  'sponsorship_dispute_debit',
  'Stripe dispute withdrawal remains a debit movement'
);

SELECT extensions.is(
  private.resolve_sponsorship_financial_adjustment_kind(
    'STRIPE',
    'charge.dispute.funds_reinstated',
    'dispute',
    'dispute'
  )::text,
  'sponsorship_dispute_credit',
  'Stripe dispute reinstatement remains a distinct credit movement'
);

SELECT extensions.throws_ok(
  $$SELECT private.resolve_sponsorship_financial_adjustment_kind(
    'STRIPE',
    'refund.updated',
    'charge',
    'refund'
  )$$,
  '22023',
  'Unsupported financial adjustment event and object mapping',
  'refund.updated cannot be relabeled as another provider object type'
);

INSERT INTO refund_updated_test_times
VALUES ('quarantine', clock_timestamp());

CREATE TEMP TABLE refund_updated_quarantine_result ON COMMIT DROP AS
SELECT *
FROM public.quarantine_verified_payment_gateway_event(
  'STRIPE',
  'stripe_us',
  'evt_refund_updated_quarantine_0001',
  'refund.updated',
  'refund',
  're_refund_updated_quarantine_0001',
  '{"source":"verified_webhook"}'::jsonb,
  decode(repeat('e6', 48), 'hex'),
  decode(repeat('e6', 32), 'hex'),
  (SELECT value FROM refund_updated_test_times WHERE key = 'quarantine'),
  (
    SELECT value - interval '10 seconds'
    FROM refund_updated_test_times
    WHERE key = 'quarantine'
  ),
  'stripe_webhook_signature',
  'provider-fact-mismatch',
  'Signed refund evidence could not be linked to an original movement'
);

SELECT extensions.is(
  (SELECT processing_status::text FROM refund_updated_quarantine_result),
  'ignored',
  'an unlinkable refund.updated event can be preserved in durable quarantine'
);

SELECT extensions.ok(
  (
    SELECT
      event.original_financial_movement_id IS NULL
      AND event.payment_attempt_id IS NULL
      AND event.sponsorship_intent_id IS NULL
      AND event.redacted_payload @> '{"quarantine": true}'::jsonb
    FROM public.payment_gateway_events event
    WHERE event.id = (
      SELECT gateway_event_id FROM refund_updated_quarantine_result
    )
  ),
  'quarantined refund.updated evidence cannot manufacture a payment chain'
);

SELECT extensions.is(
  (
    SELECT is_duplicate
    FROM public.quarantine_verified_payment_gateway_event(
      'STRIPE',
      'stripe_us',
      'evt_refund_updated_quarantine_0001',
      'refund.updated',
      'refund',
      're_refund_updated_quarantine_0001',
      '{"source":"verified_webhook"}'::jsonb,
      decode(repeat('e7', 48), 'hex'),
      decode(repeat('e6', 32), 'hex'),
      (
        SELECT value
        FROM refund_updated_test_times
        WHERE key = 'quarantine'
      ),
      (
        SELECT value - interval '10 seconds'
        FROM refund_updated_test_times
        WHERE key = 'quarantine'
      ),
      'stripe_webhook_signature',
      'provider-fact-mismatch',
      'Signed refund evidence could not be linked to an original movement'
    )
  ),
  true,
  'durable refund.updated quarantine is idempotent by immutable event digest'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.payment_gateway_events (
    provider,
    provider_account_scope,
    provider_event_id,
    event_type,
    provider_object_type,
    provider_object_id,
    redacted_payload,
    payload_sha256,
    signature_verified_at,
    occurred_at,
    verification_method
  ) VALUES (
    'STRIPE',
    'stripe_us',
    'evt_refund_updated_unlinked_0001',
    'refund.updated',
    'refund',
    're_refund_updated_unlinked_0001',
    '{}'::jsonb,
    decode(repeat('e8', 32), 'hex'),
    clock_timestamp(),
    clock_timestamp(),
    'stripe_webhook_signature'
  )$$,
  '23514',
  'new row for relation "payment_gateway_events" violates check constraint "payment_gateway_events_financial_adjustment_link_check"',
  'refund.updated cannot enter the operational queue without a linked gross movement or quarantine marker'
);

INSERT INTO refund_updated_test_times
VALUES ('refund_updated', clock_timestamp());

CREATE TEMP TABLE refund_updated_ingest ON COMMIT DROP AS
SELECT *
FROM pg_temp.ingest_test_stripe_refund(
  'evt_refund_updated_succeeded_0001',
  'refund.updated',
  're_refund_updated_shared_0001',
  2000,
  'e9',
  (SELECT value FROM refund_updated_test_times WHERE key = 'refund_updated')
);

SELECT extensions.is(
  (SELECT adjustment_kind FROM refund_updated_ingest),
  'sponsorship_refund',
  'a succeeded refund.updated event enters the linked adjustment queue'
);

SELECT extensions.ok(
  (
    SELECT
      event.original_financial_movement_id = (
        SELECT value
        FROM refund_updated_test_context
        WHERE key = 'gross_movement'
      )
      AND event.fact_provider_movement_type = 'refund'
      AND event.fact_provider_movement_id = 're_refund_updated_shared_0001'
      AND event.fact_base_amount_usd_cents = 2000
    FROM public.payment_gateway_events event
    WHERE event.id = (
      SELECT gateway_event_id FROM refund_updated_ingest
    )
  ),
  'refund.updated persists a complete immutable adjustment chain'
);

SELECT extensions.ok(
  (
    SELECT
      replay.is_duplicate
      AND replay.gateway_event_id = original.gateway_event_id
    FROM pg_temp.ingest_test_stripe_refund(
      'evt_refund_updated_succeeded_0001',
      'refund.updated',
      're_refund_updated_shared_0001',
      2000,
      'e9',
      (SELECT value FROM refund_updated_test_times WHERE key = 'refund_updated')
    ) replay
    CROSS JOIN refund_updated_ingest original
  ),
  'an exact refund.updated event replay returns the original durable event'
);

CREATE TEMP TABLE refund_updated_lease ON COMMIT DROP AS
SELECT gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events(
  'refund-updated-adjustment-worker',
  20
)
WHERE gateway_event_id = (
  SELECT gateway_event_id FROM refund_updated_ingest
);

CREATE TEMP TABLE refund_updated_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_financial_adjustment(
  (SELECT gateway_event_id FROM refund_updated_lease),
  (SELECT processing_lease_token FROM refund_updated_lease)
);

SELECT extensions.ok(
  (
    SELECT
      application_effect = 'refund_applied'
      AND net_base_amount_usd_cents = 8000
      AND net_charged_amount_minor = 8000
    FROM refund_updated_result
  ),
  'refund.updated applies one bounded signed refund movement'
);

INSERT INTO refund_updated_test_times
VALUES ('refund_created_duplicate', clock_timestamp());

CREATE TEMP TABLE refund_created_duplicate_ingest ON COMMIT DROP AS
SELECT *
FROM pg_temp.ingest_test_stripe_refund(
  'evt_refund_created_duplicate_0001',
  'refund.created',
  're_refund_updated_shared_0001',
  2000,
  'ea',
  (
    SELECT value
    FROM refund_updated_test_times
    WHERE key = 'refund_created_duplicate'
  )
);

CREATE TEMP TABLE refund_created_duplicate_lease ON COMMIT DROP AS
SELECT gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events(
  'refund-created-duplicate-worker',
  20
)
WHERE gateway_event_id = (
  SELECT gateway_event_id FROM refund_created_duplicate_ingest
);

CREATE TEMP TABLE refund_created_duplicate_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_financial_adjustment(
  (SELECT gateway_event_id FROM refund_created_duplicate_lease),
  (SELECT processing_lease_token FROM refund_created_duplicate_lease)
);

SELECT extensions.is(
  (
    SELECT application_effect::text
    FROM refund_created_duplicate_result
  ),
  'duplicate_movement',
  'refund.created and refund.updated for the same refund ID cannot double count'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_financial_movements movement
    WHERE movement.provider = 'STRIPE'
      AND movement.provider_account_scope = 'stripe_us'
      AND movement.provider_movement_type = 'refund'
      AND movement.provider_movement_id = 're_refund_updated_shared_0001'
      AND movement.entry_kind = 'sponsorship_refund'
  ),
  1::bigint,
  'one Stripe refund ID has exactly one canonical refund movement'
);

INSERT INTO refund_updated_test_times
VALUES ('refund_updated_conflict', clock_timestamp());

CREATE TEMP TABLE refund_updated_conflict_ingest ON COMMIT DROP AS
SELECT *
FROM pg_temp.ingest_test_stripe_refund(
  'evt_refund_updated_conflict_0001',
  'refund.updated',
  're_refund_updated_shared_0001',
  1500,
  'eb',
  (
    SELECT value
    FROM refund_updated_test_times
    WHERE key = 'refund_updated_conflict'
  )
);

CREATE TEMP TABLE refund_updated_conflict_lease ON COMMIT DROP AS
SELECT gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events(
  'refund-updated-conflict-worker',
  20
)
WHERE gateway_event_id = (
  SELECT gateway_event_id FROM refund_updated_conflict_ingest
);

SELECT extensions.throws_ok(
  format(
    'SELECT * FROM public.apply_sponsorship_financial_adjustment(%L::uuid, %L::uuid)',
    (
      SELECT gateway_event_id::text
      FROM refund_updated_conflict_lease
    ),
    (
      SELECT processing_lease_token::text
      FROM refund_updated_conflict_lease
    )
  ),
  '23505',
  'Provider adjustment movement conflicts with another payment chain',
  'a later event cannot change the amount attached to an existing Stripe refund ID'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 2
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid =
      'public.sponsorship_financial_movements'::regclass
      AND constraint_row.contype = 'u'
      AND constraint_row.conname IN (
        'sponsorship_financial_movements_provider_identity_unique',
        'sponsorship_financial_movements_adjustment_chain_unique'
      )
  ),
  'provider movement identity and original payment chains remain database constrained'
);

SELECT * FROM extensions.finish();

ROLLBACK;
