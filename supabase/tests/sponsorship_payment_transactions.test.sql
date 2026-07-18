BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE payment_test_context (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE payment_test_leases (
  key text PRIMARY KEY,
  gateway_event_id uuid NOT NULL,
  processing_lease_token uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE payment_test_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE payment_test_email_leases (
  outbox_id uuid PRIMARY KEY,
  lease_token text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  recipient_email_ciphertext bytea NOT NULL,
  secret_payload_ciphertext bytea NOT NULL
) ON COMMIT DROP;

UPDATE public.payment_provider_accounts
SET environment = 'live'
WHERE provider = 'STRIPE'
  AND scope = 'stripe_us';

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO payment_test_context
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
  decode(repeat('ab', 32), 'hex'),
  1,
  1,
  'provider_asserted'
FROM payment_test_context
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
    'payment-test-intent-0001',
    'primary_site',
    'creatorshare.com',
    value,
    decode(repeat('ab', 32), 'hex'),
    1,
    1,
    'blind',
    'recurring',
    'month',
    3333,
    3333,
    'USD',
    1,
    clock_timestamp(),
    'payment-test'
  FROM payment_test_context
  WHERE key = 'identity'
  RETURNING id
)
INSERT INTO payment_test_context
SELECT 'intent', id FROM inserted;

INSERT INTO payment_test_context
SELECT 'quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM payment_test_context WHERE key = 'intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'payment-test-quote-key-0001'
);

SELECT extensions.is(
  (
    SELECT payment_quote_id
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM payment_test_context WHERE key = 'intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'payment-test-quote-key-0001'
    )
  ),
  (SELECT value FROM payment_test_context WHERE key = 'quote'),
  'server quote issuance is idempotent for identical terms'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_payment_quotes
    SET charged_amount_minor = charged_amount_minor + 1
    WHERE id = (SELECT value FROM payment_test_context WHERE key = 'quote')
  $$,
  '42501',
  'Payment transaction evidence is append only',
  'server issued quote evidence cannot be rewritten'
);

INSERT INTO payment_test_context
SELECT 'attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM payment_test_context WHERE key = 'intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM payment_test_context WHERE key = 'quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'payment-test-provider-key-0001',
  target_checkout_receipt_digest => decode(repeat('01', 32), 'hex'),
  target_metadata => '{"checkout":"payment-test"}'::jsonb
);

SELECT extensions.is(
  (
    SELECT payment_attempt_id
    FROM public.begin_sponsorship_payment(
      target_sponsorship_intent_id => (
        SELECT value FROM payment_test_context WHERE key = 'intent'
      ),
      target_payment_quote_id => (
        SELECT value FROM payment_test_context WHERE key = 'quote'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key => 'payment-test-provider-key-0001',
      target_checkout_receipt_digest => decode(repeat('01', 32), 'hex')
    )
  ),
  (SELECT value FROM payment_test_context WHERE key = 'attempt'),
  'payment begin is idempotent only for the same quote and receipt'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_payment_attempts
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  1::bigint,
  'idempotent payment begin creates one attempt'
);

SELECT extensions.is(
  (
    SELECT checkout_status
    FROM public.read_sponsorship_checkout_status(
      decode(repeat('01', 32), 'hex')
    )
  ),
  'created',
  'opaque checkout receipt returns minimal payment status'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.ingest_verified_payment_gateway_event(
      target_payment_attempt_id => (
        SELECT value FROM payment_test_context WHERE key = 'attempt'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_event_id => 'evt_missing_attempt_metadata_0001',
      target_event_type => 'checkout.session.completed',
      target_provider_object_type => 'checkout_session',
      target_provider_object_id => 'cs_test_payment_boundary_0001',
      target_redacted_payload => '{}'::jsonb,
      target_payload_ciphertext => decode('01', 'hex'),
      target_payload_sha256 => decode(repeat('11', 32), 'hex'),
      target_signature_verified_at => clock_timestamp(),
      target_occurred_at => clock_timestamp(),
      target_verification_method => 'stripe_webhook_signature',
      target_fact_payment_status => 'paid',
      target_fact_provider_movement_type => 'invoice',
      target_fact_provider_movement_id => 'in_missing_attempt_metadata_0001',
      target_fact_provider_customer_id => 'cus_payment_boundary_0001',
      target_fact_provider_subscription_id => 'sub_payment_boundary_0001',
      target_fact_base_amount_usd_cents => 3333,
      target_fact_charged_amount_minor => 3333,
      target_fact_charged_currency => 'USD',
      target_fact_conversion_rate => 1,
      target_fact_period_start => clock_timestamp(),
      target_fact_period_end => clock_timestamp() + interval '1 month'
    )
  $$,
  '23514',
  'Verified provider metadata does not bind the event to this payment attempt',
  'financial events require a signed server attempt reference'
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_test_payment_boundary_0001'
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.sponsorship_payment_attempts
    WHERE id = (SELECT value FROM payment_test_context WHERE key = 'attempt')
  ),
  'pending',
  'provider checkout attachment advances the attempt to pending'
);

SELECT extensions.is(
  (
    SELECT checkout_status
    FROM public.read_sponsorship_checkout_status(
      decode(repeat('01', 32), 'hex')
    )
  ),
  'pending',
  'opaque checkout receipt observes the provider attachment transition'
);

INSERT INTO payment_test_times
VALUES ('initial', clock_timestamp());

INSERT INTO payment_test_context
SELECT 'initial_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_payment_boundary_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_test_payment_boundary_0001',
  target_redacted_payload => '{"payment_status":"paid"}'::jsonb,
  target_payload_ciphertext => decode('cafe', 'hex'),
  target_payload_sha256 => decode(repeat('cd', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM payment_test_times WHERE key = 'initial'
  ),
  target_occurred_at => (
    SELECT value FROM payment_test_times WHERE key = 'initial'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_fact_provider_movement_type => 'invoice',
  target_fact_provider_movement_id => 'in_payment_boundary_0001',
  target_fact_provider_customer_id => 'cus_payment_boundary_0001',
  target_fact_provider_subscription_id => 'sub_payment_boundary_0001',
  target_fact_base_amount_usd_cents => 3333,
  target_fact_charged_amount_minor => 3333,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1,
  target_fact_period_start => (
    SELECT value FROM payment_test_times WHERE key = 'initial'
  ),
  target_fact_period_end => (
    SELECT value + interval '1 month'
    FROM payment_test_times WHERE key = 'initial'
  )
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.payment_gateway_events gateway_event
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = gateway_event.payment_attempt_id
     AND attempt.sponsorship_intent_id = gateway_event.sponsorship_intent_id
     AND attempt.provider = gateway_event.provider
     AND attempt.provider_account_scope = gateway_event.provider_account_scope
    WHERE gateway_event.id = (
      SELECT value FROM payment_test_context WHERE key = 'initial_event'
    )
  ),
  'verified gateway event resolves through the full server payment chain'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.payment_gateway_events
    SET fact_charged_amount_minor = 1
    WHERE id = (
      SELECT value FROM payment_test_context WHERE key = 'initial_event'
    )
  $$,
  '42501',
  'Gateway event verification evidence is immutable',
  'verified typed gateway facts are immutable'
);

INSERT INTO payment_test_leases
SELECT
  'initial',
  gateway_event_id,
  processing_lease_token
FROM public.claim_payment_gateway_events('payment-test-worker', 10)
WHERE gateway_event_id = (
  SELECT value FROM payment_test_context WHERE key = 'initial_event'
);

SELECT extensions.ok(
  (
    SELECT processing_lease_token IS NOT NULL
    FROM payment_test_leases
    WHERE key = 'initial'
  ),
  'gateway claim returns an unguessable processing lease token'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.apply_sponsorship_payment_success(
      target_gateway_event_id => (
        SELECT gateway_event_id FROM payment_test_leases WHERE key = 'initial'
      ),
      target_processing_lease_token => (
        SELECT processing_lease_token FROM payment_test_leases WHERE key = 'initial'
      ),
      target_claim_token_digest => decode(repeat('ef', 32), 'hex'),
      target_recipient_email_ciphertext => decode('010203', 'hex'),
      target_email_encryption_key_version => 1::smallint,
      target_secret_payload_ciphertext => decode('040506', 'hex'),
      target_welcome_template_data => '{"account_url":"https://attacker.test"}'::jsonb
    )
  $$,
  '22023',
  'Welcome template data contains unsafe or unsupported fields',
  'welcome template input rejects contact and navigation injection'
);

CREATE TEMP TABLE initial_payment_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM payment_test_leases WHERE key = 'initial'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM payment_test_leases WHERE key = 'initial'
  ),
  target_claim_token_digest => decode(repeat('ef', 32), 'hex'),
  target_recipient_email_ciphertext => decode('010203', 'hex'),
  target_email_encryption_key_version => 1::smallint,
  target_secret_payload_ciphertext => decode('040506', 'hex'),
  target_welcome_template_key => 'sponsor-welcome-v1',
  target_welcome_template_data => '{"locale":"en-US"}'::jsonb
);

SELECT extensions.is(
  (SELECT application_effect::text FROM initial_payment_result),
  'payment_succeeded',
  'first verified financial movement is applied atomically'
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.sponsorship_intents
    WHERE id = (SELECT value FROM payment_test_context WHERE key = 'intent')
  ),
  'succeeded',
  'initial verified payment succeeds the server intent'
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.sponsorship_payment_attempts
    WHERE id = (SELECT value FROM payment_test_context WHERE key = 'attempt')
  ),
  'succeeded',
  'initial verified payment succeeds the server attempt'
);

SELECT extensions.ok(
  (
    SELECT finalized_at IS NOT NULL
      AND conversion_occurred_at = (
        SELECT value FROM payment_test_times WHERE key = 'initial'
      )
    FROM public.sponsorship_attributions
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  'attribution finalizes at the signed provider conversion time'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.subscriptions
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  1::bigint,
  'initial recurring success creates one subscription'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_financial_movements
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  1::bigint,
  'initial success creates one canonical financial movement'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.transaction_ledger
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  1::bigint,
  'initial success creates one linked ledger entry'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_account_claims
    WHERE sponsor_identity_id = (
      SELECT value FROM payment_test_context WHERE key = 'identity'
    )
  ),
  1::bigint,
  'first success creates one passwordless account claim'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_outbox
    WHERE sponsor_identity_id = (
      SELECT value FROM payment_test_context WHERE key = 'identity'
    )
      AND kind = 'sponsor_welcome'
  ),
  1::bigint,
  'first success creates exactly one Creator Share welcome email'
);

SELECT extensions.ok(
  (
    SELECT template_data ? 'locale'
      AND NOT template_data ? 'email'
      AND NOT template_data ? 'account_url'
      AND NOT template_data ? 'token'
    FROM public.email_outbox
    WHERE sponsor_identity_id = (
      SELECT value FROM payment_test_context WHERE key = 'identity'
    )
      AND kind = 'sponsor_welcome'
  ),
  'welcome outbox data contains only server constructed safe fields'
);

INSERT INTO payment_test_email_leases
SELECT
  outbox_id,
  lease_token,
  lease_expires_at,
  recipient_email_ciphertext,
  secret_payload_ciphertext
FROM public.claim_email_outbox_jobs('payment-test-email-worker', 10);

SELECT extensions.ok(
  (
    SELECT length(lease_token) = 64
      AND lease_expires_at > clock_timestamp()
      AND recipient_email_ciphertext = decode('010203', 'hex')
      AND secret_payload_ciphertext = decode('040506', 'hex')
    FROM payment_test_email_leases
  ),
  'email worker receives one opaque lease and only the encrypted contact envelope'
);

SELECT extensions.ok(
  pg_get_function_result(
    'public.claim_email_outbox_jobs(text,integer)'::regprocedure
  ) NOT LIKE '%recipient_email_hmac%',
  'email claim output never reveals the immutable recipient proof'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_email_outbox_delivery(
      (SELECT outbox_id FROM payment_test_email_leases),
      repeat('0', 64),
      decode(repeat('ab', 32), 'hex'),
      'provider-message-wrong-lease'
    )
  $$,
  '42501',
  'Email completion proof does not match the active delivery lease',
  'a worker cannot complete an email with another lease token'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_email_outbox_delivery(
      (SELECT outbox_id FROM payment_test_email_leases),
      (SELECT lease_token FROM payment_test_email_leases),
      decode(repeat('ff', 32), 'hex'),
      'provider-message-wrong-envelope'
    )
  $$,
  '42501',
  'Email completion proof does not match the active delivery lease',
  'a worker cannot complete the wrong decrypted recipient envelope'
);

SELECT extensions.ok(
  public.complete_email_outbox_delivery(
    (SELECT outbox_id FROM payment_test_email_leases),
    (SELECT lease_token FROM payment_test_email_leases),
    decode(repeat('ab', 32), 'hex'),
    'provider-message-payment-test-0001'
  ) IS NOT NULL,
  'the active lease completes only with the server recomputed recipient proof'
);

SELECT extensions.ok(
  (
    SELECT status = 'sent'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND sent_at IS NOT NULL
      AND contact_retention_expires_at = created_at + interval '90 days'
    FROM public.email_outbox outbox
    JOIN payment_test_email_leases lease ON lease.outbox_id = outbox.id
  ),
  'email completion clears its lease and preserves the absolute contact deadline'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.claim_email_outbox_jobs('payment-test-email-worker', 10)
  ),
  0::bigint,
  'a sent welcome email cannot be claimed again'
);

SELECT extensions.ok(
  has_table_privilege('service_role', 'public.email_outbox', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.email_outbox', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.email_outbox', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.email_outbox', 'DELETE'),
  'the delivery service can enqueue but cannot read or mutate outbox rows directly'
);

INSERT INTO payment_test_context
SELECT 'duplicate_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_payment_boundary_0002',
  target_event_type => 'checkout.session.async_payment_succeeded',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_test_payment_boundary_0001',
  target_redacted_payload => '{}'::jsonb,
  target_payload_ciphertext => decode('cafe02', 'hex'),
  target_payload_sha256 => decode(repeat('ce', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_fact_provider_movement_type => 'invoice',
  target_fact_provider_movement_id => 'in_payment_boundary_0001',
  target_fact_provider_customer_id => 'cus_payment_boundary_0001',
  target_fact_provider_subscription_id => 'sub_payment_boundary_0001',
  target_fact_base_amount_usd_cents => 3333,
  target_fact_charged_amount_minor => 3333,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1,
  target_fact_period_start => (
    SELECT value FROM payment_test_times WHERE key = 'initial'
  ),
  target_fact_period_end => (
    SELECT value + interval '1 month'
    FROM payment_test_times WHERE key = 'initial'
  )
);

INSERT INTO payment_test_leases
SELECT 'duplicate', gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events('payment-test-worker', 10)
WHERE gateway_event_id = (
  SELECT value FROM payment_test_context WHERE key = 'duplicate_event'
);

CREATE TEMP TABLE duplicate_payment_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM payment_test_leases WHERE key = 'duplicate'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM payment_test_leases WHERE key = 'duplicate'
  )
);

SELECT extensions.is(
  (SELECT application_effect::text FROM duplicate_payment_result),
  'duplicate_movement',
  'a second event for the same provider movement is classified as duplicate'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.transaction_ledger
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  1::bigint,
  'duplicate provider movement cannot create another ledger entry'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.email_outbox
    WHERE sponsor_identity_id = (
      SELECT value FROM payment_test_context WHERE key = 'identity'
    )
      AND kind = 'sponsor_welcome'
  ),
  1::bigint,
  'duplicate provider movement cannot create another welcome email'
);

INSERT INTO payment_test_times
SELECT 'cancel', value + interval '2 minutes'
FROM payment_test_times WHERE key = 'initial';

INSERT INTO payment_test_context
SELECT 'cancel_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_subscription_cancel_0001',
  target_event_type => 'customer.subscription.deleted',
  target_provider_object_type => 'subscription',
  target_provider_object_id => 'sub_payment_boundary_0001',
  target_redacted_payload => '{}'::jsonb,
  target_payload_ciphertext => decode('ca01', 'hex'),
  target_payload_sha256 => decode(repeat('ca', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM payment_test_times WHERE key = 'cancel'
  ),
  target_occurred_at => (
    SELECT value FROM payment_test_times WHERE key = 'cancel'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_fact_provider_customer_id => 'cus_payment_boundary_0001',
  target_fact_provider_subscription_id => 'sub_payment_boundary_0001',
  target_fact_lifecycle_state => 'cancelled'
);

INSERT INTO payment_test_leases
SELECT 'cancel', gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events('payment-test-worker', 10)
WHERE gateway_event_id = (
  SELECT value FROM payment_test_context WHERE key = 'cancel_event'
);

SELECT count(*)
FROM public.apply_sponsorship_subscription_lifecycle(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM payment_test_leases WHERE key = 'cancel'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM payment_test_leases WHERE key = 'cancel'
  )
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.subscriptions
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  'cancelled',
  'verified provider lifecycle cancellation controls subscription status'
);

INSERT INTO payment_test_times
SELECT 'renewal', value + interval '3 minutes'
FROM payment_test_times WHERE key = 'initial';

INSERT INTO payment_test_context
SELECT 'renewal_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_payment_boundary_0003',
  target_event_type => 'invoice.paid',
  target_provider_object_type => 'invoice',
  target_provider_object_id => 'in_payment_boundary_0002',
  target_redacted_payload => '{}'::jsonb,
  target_payload_ciphertext => decode('cafe03', 'hex'),
  target_payload_sha256 => decode(repeat('cf', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM payment_test_times WHERE key = 'renewal'
  ),
  target_occurred_at => (
    SELECT value FROM payment_test_times WHERE key = 'renewal'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_fact_provider_movement_type => 'invoice',
  target_fact_provider_movement_id => 'in_payment_boundary_0002',
  target_fact_provider_customer_id => 'cus_payment_boundary_0001',
  target_fact_provider_subscription_id => 'sub_payment_boundary_0001',
  target_fact_base_amount_usd_cents => 3333,
  target_fact_charged_amount_minor => 3333,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1,
  target_fact_period_start => (
    SELECT value + interval '1 month'
    FROM payment_test_times WHERE key = 'initial'
  ),
  target_fact_period_end => (
    SELECT value + interval '2 months'
    FROM payment_test_times WHERE key = 'initial'
  )
);

INSERT INTO payment_test_leases
SELECT 'renewal', gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events('payment-test-worker', 10)
WHERE gateway_event_id = (
  SELECT value FROM payment_test_context WHERE key = 'renewal_event'
);

SELECT count(*)
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM payment_test_leases WHERE key = 'renewal'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM payment_test_leases WHERE key = 'renewal'
  )
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_financial_movements
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  2::bigint,
  'renewal adds one immutable financial movement even after cancellation'
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.subscriptions
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  'cancelled',
  'later financial success does not resurrect cancelled lifecycle state'
);

SELECT extensions.is(
  (
    SELECT payment_health
    FROM public.subscriptions
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  'paid',
  'financial success updates payment health independently of lifecycle status'
);

INSERT INTO payment_test_times
SELECT 'failure', value + interval '4 minutes'
FROM payment_test_times WHERE key = 'initial';

INSERT INTO payment_test_context
SELECT 'failure_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_payment_failure_0001',
  target_event_type => 'invoice.payment_failed',
  target_provider_object_type => 'invoice',
  target_provider_object_id => 'in_payment_boundary_0003',
  target_redacted_payload => '{}'::jsonb,
  target_payload_ciphertext => decode('fa01', 'hex'),
  target_payload_sha256 => decode(repeat('fa', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM payment_test_times WHERE key = 'failure'
  ),
  target_occurred_at => (
    SELECT value FROM payment_test_times WHERE key = 'failure'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_fact_provider_customer_id => 'cus_payment_boundary_0001',
  target_fact_provider_subscription_id => 'sub_payment_boundary_0001',
  target_fact_failure_code => 'card_declined'
);

INSERT INTO payment_test_leases
SELECT 'failure', gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events('payment-test-worker', 10)
WHERE gateway_event_id = (
  SELECT value FROM payment_test_context WHERE key = 'failure_event'
);

SELECT count(*)
FROM public.apply_sponsorship_payment_failure(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM payment_test_leases WHERE key = 'failure'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM payment_test_leases WHERE key = 'failure'
  )
);

SELECT extensions.ok(
  (
    SELECT payment_health = 'delinquent' AND status = 'cancelled'
    FROM public.subscriptions
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  'payment failure changes payment health without rewriting lifecycle status'
);

INSERT INTO payment_test_context
SELECT 'stale_lifecycle_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_subscription_stale_active_0001',
  target_event_type => 'customer.subscription.updated',
  target_provider_object_type => 'subscription',
  target_provider_object_id => 'sub_payment_boundary_0001',
  target_redacted_payload => '{}'::jsonb,
  target_payload_ciphertext => decode('ac01', 'hex'),
  target_payload_sha256 => decode(repeat('ac', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM payment_test_times WHERE key = 'cancel'
  ),
  target_occurred_at => (
    SELECT value FROM payment_test_times WHERE key = 'cancel'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'attempt'
  ),
  target_fact_provider_customer_id => 'cus_payment_boundary_0001',
  target_fact_provider_subscription_id => 'sub_payment_boundary_0001',
  target_fact_lifecycle_state => 'active'
);

INSERT INTO payment_test_leases
SELECT 'stale_lifecycle', gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events('payment-test-worker', 10)
WHERE gateway_event_id = (
  SELECT value FROM payment_test_context WHERE key = 'stale_lifecycle_event'
);

CREATE TEMP TABLE stale_lifecycle_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_subscription_lifecycle(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM payment_test_leases WHERE key = 'stale_lifecycle'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM payment_test_leases WHERE key = 'stale_lifecycle'
  )
);

SELECT extensions.is(
  (SELECT application_effect::text FROM stale_lifecycle_result),
  'ignored',
  'same time lifecycle precedence rejects stale active state after cancellation'
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
  updated_at
)
VALUES
  (
    '91000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'payment-claim@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Payment","last_name":"Claim"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '91000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'wrong-account@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Wrong","last_name":"Account"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);
SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.consume_sponsorship_account_claim(
      decode(repeat('ef', 32), 'hex')
    )
  $$,
  '23514',
  'Verified account email does not match the account claim',
  'another authenticated account cannot consume the sponsor claim'
);

SELECT count(*)
FROM public.issue_sponsor_account_email_verification(
  target_auth_user_id => '91000000-0000-4000-8000-000000000001'::uuid,
  target_email_hmac => decode(repeat('ab', 32), 'hex')
);

SELECT set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);

CREATE TEMP TABLE account_claim_result ON COMMIT DROP AS
SELECT *
FROM public.consume_sponsorship_account_claim(
  decode(repeat('ef', 32), 'hex')
);

SELECT extensions.is(
  (
    SELECT auth_user_id
    FROM public.sponsor_identities
    WHERE id = (SELECT value FROM payment_test_context WHERE key = 'identity')
  ),
  '91000000-0000-4000-8000-000000000001'::uuid,
  'authenticated proof attaches the sponsor identity to the correct account'
);

SELECT extensions.is(
  (
    SELECT confidence::text
    FROM public.sponsor_identifiers
    WHERE sponsor_identity_id = (
      SELECT value FROM payment_test_context WHERE key = 'identity'
    )
      AND kind = 'email'
  ),
  'verified',
  'account claim promotes the matching canonical email identifier'
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.sponsor_account_email_verifications
    WHERE auth_user_id = '91000000-0000-4000-8000-000000000001'::uuid
  ),
  'consumed',
  'account email proof is consumed in the same transaction as the claim'
);

SELECT extensions.is(
  (
    SELECT user_id
    FROM public.subscriptions
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'intent'
    )
  ),
  '91000000-0000-4000-8000-000000000001'::uuid,
  'claim atomically links historical subscriptions to the account'
);

SELECT extensions.is(
  (
    SELECT linked_subscription_count
    FROM public.consume_sponsorship_account_claim(
      decode(repeat('ef', 32), 'hex')
    )
  ),
  1,
  'same authenticated account can safely replay its consumed claim'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.begin_sponsorship_payment(uuid,uuid,public.sponsorship_method,text,text,bytea,interval,jsonb,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.begin_sponsorship_payment(uuid,uuid,public.sponsorship_method,text,text,bytea,interval,jsonb,text,text,text,text)',
    'EXECUTE'
  ),
  'browser roles cannot create server payment attempts'
);

SELECT extensions.ok(
  has_function_privilege(
    'anon',
    'public.read_sponsorship_checkout_status(bytea)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.read_sponsorship_checkout_status(bytea)',
    'EXECUTE'
  ),
  'browser roles may read status only with an opaque checkout receipt'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.consume_sponsorship_account_claim(bytea,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.consume_sponsorship_account_claim(bytea,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.consume_sponsorship_account_claim(bytea,text,text,text,text)',
    'EXECUTE'
  ),
  'only authenticated users may consume their own account claim'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'public.sponsorship_payment_attempts',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.payment_gateway_events',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.subscriptions',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.transaction_ledger',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsor_account_email_verifications',
    'INSERT'
  ),
  'service role cannot bypass atomic payment and account RPCs with direct inserts'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'public.sponsorship_financial_movements',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.payment_provider_object_links',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.sponsorship_refund_requirements',
    'SELECT'
  ),
  'browser roles cannot read payment evidence or refund operations'
);

WITH inserted AS (
  INSERT INTO public.beneficiaries (
    name,
    username,
    budget_goal,
    status
  )
  VALUES (
    'Payment Fixed Beneficiary',
    'payment-fixed-beneficiary',
    1200,
    'New'
  )
  RETURNING id
)
INSERT INTO payment_test_context
SELECT 'fixed_beneficiary', id FROM inserted;

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
    'payment-fixed-intent-0001',
    'primary_site',
    'creatorshare.com',
    identity.value,
    decode(repeat('ab', 32), 'hex'),
    1,
    1,
    'standard',
    beneficiary.value,
    'one_time',
    1200,
    1200,
    'USD',
    1,
    clock_timestamp(),
    'payment-test'
  FROM payment_test_context identity
  CROSS JOIN payment_test_context beneficiary
  WHERE identity.key = 'identity'
    AND beneficiary.key = 'fixed_beneficiary'
  RETURNING id
)
INSERT INTO payment_test_context
SELECT 'fixed_intent_1', id FROM inserted;

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
    'payment-fixed-intent-0002',
    'primary_site',
    'creatorshare.com',
    identity.value,
    decode(repeat('ab', 32), 'hex'),
    1,
    1,
    'standard',
    beneficiary.value,
    'one_time',
    1200,
    1200,
    'USD',
    1,
    clock_timestamp(),
    'payment-test'
  FROM payment_test_context identity
  CROSS JOIN payment_test_context beneficiary
  WHERE identity.key = 'identity'
    AND beneficiary.key = 'fixed_beneficiary'
  RETURNING id
)
INSERT INTO payment_test_context
SELECT 'fixed_intent_2', id FROM inserted;

INSERT INTO payment_test_context
SELECT 'fixed_quote_1', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_intent_1'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'payment-fixed-quote-key-0001'
);

INSERT INTO payment_test_context
SELECT 'fixed_quote_2', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_intent_2'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'payment-fixed-quote-key-0002'
);

INSERT INTO payment_test_context
SELECT 'fixed_attempt_1', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_intent_1'
  ),
  target_payment_quote_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_quote_1'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'payment-fixed-provider-key-0001',
  target_checkout_receipt_digest => decode(repeat('21', 32), 'hex')
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_payment(
      target_sponsorship_intent_id => (
        SELECT value FROM payment_test_context WHERE key = 'fixed_intent_2'
      ),
      target_payment_quote_id => (
        SELECT value FROM payment_test_context WHERE key = 'fixed_quote_2'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key => 'payment-fixed-provider-key-0002',
      target_checkout_receipt_digest => decode(repeat('22', 32), 'hex')
    )
  $$,
  '23505',
  NULL,
  'a fixed beneficiary permits only one active checkout reservation'
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_attempt_1'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_fixed_payment_boundary_0001',
  target_expires_at => clock_timestamp() + interval '30 minutes'
);

SELECT count(*)
FROM public.release_sponsorship_checkout_reservation(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_attempt_1'
  ),
  target_provider_terminal_status => 'expired',
  target_provider_reconciled_at => clock_timestamp(),
  target_reconciliation_evidence_sha256 => decode(repeat('31', 32), 'hex'),
  target_release_reason => 'provider API confirmed checkout expiration'
);

INSERT INTO payment_test_context
SELECT 'fixed_attempt_2', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_intent_2'
  ),
  target_payment_quote_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_quote_2'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'payment-fixed-provider-key-0002',
  target_checkout_receipt_digest => decode(repeat('22', 32), 'hex')
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_checkout_reservations
    WHERE beneficiary_id = (
      SELECT value FROM payment_test_context WHERE key = 'fixed_beneficiary'
    )
      AND status = 'active'
  ),
  1::bigint,
  'provider reconciled release allows the next fixed checkout reservation'
);

INSERT INTO payment_test_context
SELECT 'fixed_refund_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_attempt_1'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_fixed_refund_required_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_fixed_payment_boundary_0001',
  target_redacted_payload => '{}'::jsonb,
  target_payload_ciphertext => decode('de01', 'hex'),
  target_payload_sha256 => decode(repeat('de', 32), 'hex'),
  target_signature_verified_at => clock_timestamp(),
  target_occurred_at => clock_timestamp(),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM payment_test_context WHERE key = 'fixed_attempt_1'
  ),
  target_fact_provider_movement_type => 'payment_intent',
  target_fact_provider_movement_id => 'pi_fixed_refund_required_0001',
  target_fact_base_amount_usd_cents => 1200,
  target_fact_charged_amount_minor => 1200,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
);

INSERT INTO payment_test_leases
SELECT 'fixed_refund', gateway_event_id, processing_lease_token
FROM public.claim_payment_gateway_events('payment-test-worker', 10)
WHERE gateway_event_id = (
  SELECT value FROM payment_test_context WHERE key = 'fixed_refund_event'
);

CREATE TEMP TABLE fixed_refund_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM payment_test_leases WHERE key = 'fixed_refund'
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM payment_test_leases WHERE key = 'fixed_refund'
  )
);

SELECT extensions.is(
  (SELECT application_effect::text FROM fixed_refund_result),
  'refund_required',
  'paid fixed checkout without its active reservation requires a refund'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_refund_requirements
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'fixed_intent_1'
    )
      AND status = 'pending'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.transaction_ledger
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'fixed_intent_1'
    )
  )
  AND (
    SELECT finalized_at IS NULL
    FROM public.sponsorship_attributions
    WHERE sponsorship_intent_id = (
      SELECT value FROM payment_test_context WHERE key = 'fixed_intent_1'
    )
  ),
  'refund exception records the movement but creates no ledger or final attribution'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.payment_gateway_event_applications
    WHERE gateway_event_id IN (
      SELECT value
      FROM payment_test_context
      WHERE key IN (
        'initial_event',
        'duplicate_event',
        'cancel_event',
        'renewal_event',
        'failure_event',
        'stale_lifecycle_event',
        'fixed_refund_event'
      )
    )
  ),
  7::bigint,
  'every terminal gateway event has one immutable application result'
);

SELECT * FROM extensions.finish();

ROLLBACK;
