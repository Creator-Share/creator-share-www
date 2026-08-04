BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE sponsor_history_context (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE sponsor_history_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

UPDATE public.payment_provider_accounts
SET
  status = 'active',
  environment = 'live'
WHERE (provider = 'STRIPE' AND scope = 'stripe_us')
   OR (provider = 'PAYPAL' AND scope = 'paypal');

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
    '9b000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'one-time-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"One","last_name":"Time"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '9b000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'other-owner@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Other","last_name":"Owner"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO sponsor_history_context
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
  decode(repeat('b7', 32), 'hex'),
  1,
  1,
  'provider_asserted'
FROM sponsor_history_context
WHERE key = 'identity';

INSERT INTO sponsor_history_times
VALUES ('currency_quote_at', clock_timestamp());

/* Model a malformed row that predates the public username write guard. */
ALTER TABLE public.beneficiaries
DISABLE TRIGGER beneficiary_username_public_shape_guard;

WITH inserted AS (
  INSERT INTO public.beneficiaries (
    name,
    username,
    budget_goal,
    status
  )
  VALUES (
    '   Legacy' || chr(10) || chr(9) || 'Child ' || repeat('N', 180),
    '  legacy' || chr(1) || chr(9) || 'handle  ',
    2400,
    'New'
  )
  RETURNING id
)
INSERT INTO sponsor_history_context
SELECT 'beneficiary', id FROM inserted;

ALTER TABLE public.beneficiaries
ENABLE TRIGGER beneficiary_username_public_shape_guard;

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
    'sponsor-history-intent-0001',
    'primary_site',
    'creatorshare.com',
    value,
    decode(repeat('b7', 32), 'hex'),
    1,
    1,
    'standard',
    (
      SELECT value
      FROM sponsor_history_context
      WHERE key = 'beneficiary'
    ),
    'one_time',
    NULL,
    2400,
    2400,
    'USD',
    1,
    (SELECT value FROM sponsor_history_times WHERE key = 'currency_quote_at'),
    'sponsor-history-test'
  FROM sponsor_history_context
  WHERE key = 'identity'
  RETURNING id
)
INSERT INTO sponsor_history_context
SELECT 'intent', id FROM inserted;

INSERT INTO sponsor_history_context
SELECT 'quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'sponsor-history-quote-0001'
);

INSERT INTO sponsor_history_context
SELECT 'attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'sponsor-history-provider-0001',
  target_checkout_receipt_digest => decode(repeat('71', 32), 'hex'),
  target_metadata => '{"test":"sponsor-history"}'::jsonb
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'attempt'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_sponsor_history_0001',
  target_expires_at => clock_timestamp() + interval '30 minutes'
);

INSERT INTO sponsor_history_times
VALUES ('paid_at', clock_timestamp());

INSERT INTO sponsor_history_context
SELECT 'event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'attempt'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_event_id => 'evt_sponsor_history_0001',
  target_event_type => 'checkout.session.completed',
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_sponsor_history_0001',
  target_redacted_payload => '{"payment_status":"paid"}'::jsonb,
  target_payload_ciphertext => decode('cafe', 'hex'),
  target_payload_sha256 => decode(repeat('72', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM sponsor_history_times WHERE key = 'paid_at'
  ),
  target_occurred_at => (
    SELECT value FROM sponsor_history_times WHERE key = 'paid_at'
  ),
  target_verification_method => 'stripe_webhook_signature',
  target_fact_payment_status => 'paid',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'attempt'
  ),
  target_fact_provider_movement_type => 'payment_intent',
  target_fact_provider_movement_id => 'pi_sponsor_history_0001',
  target_fact_base_amount_usd_cents => 2400,
  target_fact_charged_amount_minor => 2400,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
);

CREATE TEMP TABLE sponsor_history_gateway_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events('sponsor-history-worker', 10) claimed
WHERE claimed.gateway_event_id = (
  SELECT value FROM sponsor_history_context WHERE key = 'event'
);

CREATE TEMP TABLE sponsor_history_success_result ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM sponsor_history_gateway_lease
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM sponsor_history_gateway_lease
  ),
  target_claim_token_digest => decode(repeat('73', 32), 'hex'),
  target_recipient_email_ciphertext => decode('010203', 'hex'),
  target_email_encryption_key_version => 1::smallint,
  target_secret_payload_ciphertext => decode('040506', 'hex'),
  target_welcome_template_key => 'sponsor-welcome-v1',
  target_welcome_template_data => '{"locale":"en-US"}'::jsonb
);

INSERT INTO sponsor_history_context
SELECT 'gross_movement', financial_movement_id
FROM sponsor_history_success_result;

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
    'sponsor-history-paypal-intent-0001',
    'primary_site',
    'creatorshare.com',
    value,
    decode(repeat('b7', 32), 'hex'),
    1,
    1,
    'blind',
    'one_time',
    NULL,
    1000,
    1000,
    'USD',
    1,
    clock_timestamp(),
    'sponsor-history-test'
  FROM sponsor_history_context
  WHERE key = 'identity'
  RETURNING id
)
INSERT INTO sponsor_history_context
SELECT 'paypal_intent', id FROM inserted;

INSERT INTO sponsor_history_context
SELECT 'paypal_quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'paypal_intent'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_quote_idempotency_key => 'sponsor-history-paypal-quote-0001'
);

INSERT INTO sponsor_history_context
SELECT 'paypal_attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'paypal_intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'paypal_quote'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_idempotency_key => 'sponsor-history-paypal-attempt-0001',
  target_checkout_receipt_digest => decode(repeat('74', 32), 'hex')
);

SELECT count(*)
FROM public.attach_sponsorship_payment_provider_object(
  target_payment_attempt_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'paypal_attempt'
  ),
  target_provider_object_type => 'order',
  target_provider_object_id => 'ORDER-SPONSOR-HISTORY-0001'
);

INSERT INTO sponsor_history_times
VALUES ('paypal_paid_at', clock_timestamp());

INSERT INTO sponsor_history_context
SELECT 'paypal_event', gateway_event_id
FROM public.ingest_verified_payment_gateway_event(
  target_payment_attempt_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'paypal_attempt'
  ),
  target_provider => 'PAYPAL',
  target_provider_account_scope => 'paypal',
  target_provider_event_id => 'WH-SPONSOR-HISTORY-GROSS-0001',
  target_event_type => 'PAYMENT.CAPTURE.COMPLETED',
  target_provider_object_type => 'capture',
  target_provider_object_id => 'CAPTURE-SPONSOR-HISTORY-0001',
  target_redacted_payload => '{"status":"COMPLETED"}'::jsonb,
  target_payload_ciphertext => decode('75', 'hex'),
  target_payload_sha256 => decode(repeat('75', 32), 'hex'),
  target_signature_verified_at => (
    SELECT value FROM sponsor_history_times WHERE key = 'paypal_paid_at'
  ),
  target_occurred_at => (
    SELECT value FROM sponsor_history_times WHERE key = 'paypal_paid_at'
  ),
  target_verification_method => 'paypal_webhook_signature_api',
  target_fact_payment_status => 'completed',
  target_fact_server_payment_attempt_id => (
    SELECT value FROM sponsor_history_context WHERE key = 'paypal_attempt'
  ),
  target_fact_parent_provider_object_type => 'order',
  target_fact_parent_provider_object_id => 'ORDER-SPONSOR-HISTORY-0001',
  target_fact_provider_movement_type => 'capture',
  target_fact_provider_movement_id => 'CAPTURE-SPONSOR-HISTORY-0001',
  target_fact_base_amount_usd_cents => 1000,
  target_fact_charged_amount_minor => 1000,
  target_fact_charged_currency => 'USD',
  target_fact_conversion_rate => 1
);

CREATE TEMP TABLE sponsor_history_paypal_lease ON COMMIT DROP AS
SELECT claimed.gateway_event_id, claimed.processing_lease_token
FROM public.claim_payment_gateway_events(
  'sponsor-history-paypal-worker',
  10
) claimed
WHERE claimed.gateway_event_id = (
  SELECT value FROM sponsor_history_context WHERE key = 'paypal_event'
);

CREATE TEMP TABLE sponsor_history_paypal_success ON COMMIT DROP AS
SELECT *
FROM public.apply_sponsorship_payment_success(
  target_gateway_event_id => (
    SELECT gateway_event_id FROM sponsor_history_paypal_lease
  ),
  target_processing_lease_token => (
    SELECT processing_lease_token FROM sponsor_history_paypal_lease
  ),
  target_claim_token_digest => decode(repeat('73', 32), 'hex'),
  target_recipient_email_ciphertext => decode('010203', 'hex'),
  target_email_encryption_key_version => 1::smallint,
  target_secret_payload_ciphertext => decode('040506', 'hex'),
  target_welcome_template_key => 'sponsor-welcome-v1',
  target_welcome_template_data => '{"locale":"en-US"}'::jsonb
);

INSERT INTO sponsor_history_context
SELECT 'paypal_gross_movement', financial_movement_id
FROM sponsor_history_paypal_success;

UPDATE public.sponsor_identifiers
SET confidence = 'verified'
WHERE sponsor_identity_id = (
  SELECT value FROM sponsor_history_context WHERE key = 'identity'
)
  AND kind = 'email';

UPDATE public.sponsor_identities
SET auth_user_id = '9b000000-0000-4000-8000-000000000001'::uuid
WHERE id = (
  SELECT value FROM sponsor_history_context WHERE key = 'identity'
);

UPDATE public.sponsorship_intents
SET auth_user_id = '9b000000-0000-4000-8000-000000000001'::uuid
WHERE id IN (
  SELECT value
  FROM sponsor_history_context
  WHERE key IN ('intent', 'paypal_intent')
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  $$
    SELECT * FROM public.list_my_one_time_sponsorship_history()
  $$,
  '42501',
  'Sponsorship history requires an authenticated account',
  'anonymous callers cannot read sponsor financial history'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9b000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.list_my_one_time_sponsorship_history()
  ),
  0::bigint,
  'another authenticated account cannot read the sponsorship'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9b000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.list_my_one_time_sponsorship_history()
  ),
  2::bigint,
  'the stable sponsor identity owner can read every one-time sponsorship'
);

SELECT extensions.ok(
  (
    SELECT
      history.sponsorship_intent_id = (
        SELECT value FROM sponsor_history_context WHERE key = 'intent'
      )
      AND history.subject_kind = 'standard'
      AND history.beneficiary_id = (
        SELECT value FROM sponsor_history_context WHERE key = 'beneficiary'
      )
      AND pg_catalog.length(history.beneficiary_name) = 120
      AND history.beneficiary_name LIKE 'Legacy Child N%'
      AND history.beneficiary_name !~ '[[:cntrl:]]'
      AND history.beneficiary_username = 'legacy handle'
      AND history.partnership_project IS NULL
      AND history.base_amount_usd_cents = 2400
      AND history.charged_amount_minor = 2400
      AND history.charged_currency = 'USD'
      AND history.net_base_amount_usd_cents = 2400
      AND history.net_charged_amount_minor = 2400
      AND history.provider = 'STRIPE'
      AND history.paid_at = (
        SELECT value FROM sponsor_history_times WHERE key = 'paid_at'
      )
      AND history.financial_status = 'paid'
    FROM public.list_my_one_time_sponsorship_history() history
    WHERE history.sponsorship_intent_id = (
      SELECT value FROM sponsor_history_context WHERE key = 'intent'
    )
  ),
  'history returns only the safe product and normalized financial state'
);

SELECT extensions.is(
  (
    SELECT history.sponsorship_intent_id
    FROM public.list_my_one_time_sponsorship_history(
      target_limit => 1
    ) history
  ),
  (
    SELECT value FROM sponsor_history_context WHERE key = 'paypal_intent'
  ),
  'the first bounded page returns the newest sponsorship'
);

SELECT extensions.is(
  (
    SELECT history.sponsorship_intent_id
    FROM public.list_my_one_time_sponsorship_history(
      target_limit => 10,
      target_before_paid_at => (
        SELECT value
        FROM sponsor_history_times
        WHERE key = 'paypal_paid_at'
      ),
      target_before_sponsorship_intent_id => (
        SELECT value
        FROM sponsor_history_context
        WHERE key = 'paypal_intent'
      )
    ) history
  ),
  (
    SELECT value FROM sponsor_history_context WHERE key = 'intent'
  ),
  'a complete keyset cursor returns the next sponsorship without overlap'
);

UPDATE public.beneficiaries
SET
  name = ' ' || chr(9) || chr(10) || ' ',
  username = repeat('u', 140)
WHERE id = (
  SELECT value FROM sponsor_history_context WHERE key = 'beneficiary'
);

SELECT extensions.ok(
  (
    SELECT
      history.beneficiary_name IS NULL
      AND pg_catalog.length(history.beneficiary_username) = 80
    FROM public.list_my_one_time_sponsorship_history() history
    WHERE history.sponsorship_intent_id = (
      SELECT value FROM sponsor_history_context WHERE key = 'intent'
    )
  ),
  'blank display text becomes null and long legacy text is safely bounded'
);

CREATE OR REPLACE FUNCTION pg_temp.apply_sponsor_history_adjustment(
  test_original_context_key text,
  test_provider public.sponsorship_method,
  test_provider_scope text,
  test_provider_event_id text,
  test_event_type text,
  test_provider_object_type text,
  test_provider_object_id text,
  test_movement_type text,
  test_movement_id text,
  test_amount bigint,
  test_digest_byte text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_lease_token uuid;
  v_effect text;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT result.gateway_event_id
  INTO v_event_id
  FROM public.ingest_verified_sponsorship_financial_adjustment(
    target_original_financial_movement_id => (
      SELECT value
      FROM pg_temp.sponsor_history_context
      WHERE key = test_original_context_key
    ),
    target_provider => test_provider,
    target_provider_account_scope => test_provider_scope,
    target_provider_event_id => test_provider_event_id,
    target_event_type => test_event_type,
    target_provider_object_type => test_provider_object_type,
    target_provider_object_id => test_provider_object_id,
    target_adjustment_provider_movement_type => test_movement_type,
    target_adjustment_provider_movement_id => test_movement_id,
    target_base_amount_usd_cents => test_amount,
    target_charged_amount_minor => test_amount,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_redacted_payload => jsonb_build_object(
      'source',
      'sponsor-history-test'
    ),
    target_payload_ciphertext => decode(test_digest_byte, 'hex'),
    target_payload_sha256 => decode(repeat(test_digest_byte, 32), 'hex'),
    target_signature_verified_at => v_now,
    target_occurred_at => v_now,
    target_verification_method => CASE test_provider
      WHEN 'STRIPE' THEN 'stripe_webhook_signature'
      ELSE 'paypal_webhook_signature_api'
    END
  ) result;

  SELECT claimed.processing_lease_token
  INTO v_lease_token
  FROM public.claim_payment_gateway_events(
    'sponsor-history-adjustment-worker',
    10
  ) claimed
  WHERE claimed.gateway_event_id = v_event_id;

  SELECT result.application_effect::text
  INTO v_effect
  FROM public.apply_sponsorship_financial_adjustment(
    target_gateway_event_id => v_event_id,
    target_processing_lease_token => v_lease_token
  ) result;

  RETURN v_effect;
END;
$$;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.is(
  pg_temp.apply_sponsor_history_adjustment(
    'gross_movement',
    'STRIPE',
    'stripe_us',
    'evt_sponsor_history_refund_0001',
    'refund.created',
    'refund',
    're_sponsor_history_0001',
    'refund',
    're_sponsor_history_0001',
    400,
    '81'
  ),
  'refund_applied',
  'a verified partial refund is applied to the history fixture'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9b000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.ok(
  (
    SELECT
      history.financial_status = 'partially_refunded'
      AND history.net_base_amount_usd_cents = 2000
      AND history.net_charged_amount_minor = 2000
    FROM public.list_my_one_time_sponsorship_history() history
    WHERE history.sponsorship_intent_id = (
      SELECT value FROM sponsor_history_context WHERE key = 'intent'
    )
  ),
  'a refund is labeled as a partial refund with both net currencies preserved'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.is(
  pg_temp.apply_sponsor_history_adjustment(
    'gross_movement',
    'STRIPE',
    'stripe_us',
    'evt_sponsor_history_dispute_debit_0001',
    'charge.dispute.funds_withdrawn',
    'dispute',
    'dp_sponsor_history_0001',
    'dispute',
    'dp_sponsor_history_0001',
    600,
    '82'
  ),
  'dispute_debit_applied',
  'a verified dispute debit is applied to the mixed history fixture'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9b000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.ok(
  (
    SELECT
      history.financial_status = 'funds_withheld'
      AND history.net_base_amount_usd_cents = 1400
      AND history.net_charged_amount_minor = 1400
    FROM public.list_my_one_time_sponsorship_history() history
    WHERE history.sponsorship_intent_id = (
      SELECT value FROM sponsor_history_context WHERE key = 'intent'
    )
  ),
  'outstanding dispute funds use the honest funds withheld label'
);

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.is(
  pg_temp.apply_sponsor_history_adjustment(
    'gross_movement',
    'STRIPE',
    'stripe_us',
    'evt_sponsor_history_dispute_credit_0001',
    'charge.dispute.funds_reinstated',
    'dispute',
    'dp_sponsor_history_0001',
    'dispute',
    'dp_sponsor_history_0001',
    600,
    '83'
  ),
  'dispute_credit_applied',
  'verified dispute reinstatement clears the outstanding withheld amount'
);

SELECT extensions.is(
  pg_temp.apply_sponsor_history_adjustment(
    'paypal_gross_movement',
    'PAYPAL',
    'paypal',
    'WH-SPONSOR-HISTORY-REVERSAL-0001',
    'PAYMENT.CAPTURE.REVERSED',
    'capture',
    'CAPTURE-SPONSOR-HISTORY-0001',
    'reversal',
    'REVERSAL-SPONSOR-HISTORY-0001',
    1000,
    '84'
  ),
  'reversal_applied',
  'a verified provider reversal is applied to the PayPal history fixture'
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '9b000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.ok(
  (
    SELECT
      history.financial_status = 'partially_refunded'
      AND history.net_base_amount_usd_cents = 2000
      AND history.net_charged_amount_minor = 2000
    FROM public.list_my_one_time_sponsorship_history() history
    WHERE history.sponsorship_intent_id = (
      SELECT value FROM sponsor_history_context WHERE key = 'intent'
    )
  ),
  'reinstated dispute funds reveal the remaining mixed refund status'
);

SELECT extensions.ok(
  (
    SELECT
      history.financial_status = 'provider_reversed'
      AND history.net_base_amount_usd_cents = 0
      AND history.net_charged_amount_minor = 0
    FROM public.list_my_one_time_sponsorship_history() history
    WHERE history.sponsorship_intent_id = (
      SELECT value FROM sponsor_history_context WHERE key = 'paypal_intent'
    )
  ),
  'provider reversals remain distinct from refunds in account history'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.list_my_one_time_sponsorship_history(
      target_limit => 101
    )
  $$,
  '22023',
  'Sponsorship history limit must be between 1 and 100',
  'history rejects an unbounded result request'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.list_my_one_time_sponsorship_history(
      target_limit => 10,
      target_before_paid_at => clock_timestamp(),
      target_before_sponsorship_intent_id => NULL
    )
  $$,
  '22023',
  'Sponsorship history cursor is incomplete',
  'history requires a complete keyset cursor'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.list_my_one_time_sponsorship_history(integer,timestamptz,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.list_my_one_time_sponsorship_history(integer,timestamptz,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.list_my_one_time_sponsorship_history(integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'history execution is granted only to authenticated sponsor accounts'
);

SELECT extensions.is(
  (
    SELECT array_agg(argument.name ORDER BY argument.ordinality)::text
    FROM pg_catalog.pg_proc procedure
    CROSS JOIN LATERAL unnest(
      procedure.proargnames,
      procedure.proargmodes
    ) WITH ORDINALITY AS argument(name, mode, ordinality)
    WHERE procedure.oid =
      'public.list_my_one_time_sponsorship_history(integer,timestamptz,uuid)'::regprocedure
      AND argument.mode = 't'
  ),
  ARRAY[
    'sponsorship_intent_id',
    'subject_kind',
    'beneficiary_id',
    'beneficiary_name',
    'beneficiary_username',
    'partnership_project',
    'base_amount_usd_cents',
    'charged_amount_minor',
    'charged_currency',
    'net_base_amount_usd_cents',
    'net_charged_amount_minor',
    'provider',
    'paid_at',
    'financial_status'
  ]::text,
  'history output contains no contact, attribution, provider object, or identity columns'
);

SELECT * FROM extensions.finish();

ROLLBACK;
