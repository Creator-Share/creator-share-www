BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE checkout_replay_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE checkout_replay_test_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

UPDATE public.payment_provider_accounts
SET
  status = 'active',
  environment = 'live'
WHERE provider = 'STRIPE'
  AND scope = 'stripe_us';

WITH inserted AS (
  INSERT INTO public.sponsor_identities DEFAULT VALUES
  RETURNING id
)
INSERT INTO checkout_replay_test_ids
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
  decode(repeat('71', 32), 'hex'),
  1,
  1,
  'provider_asserted'
FROM checkout_replay_test_ids
WHERE key = 'identity';

WITH inserted AS (
  INSERT INTO public.beneficiaries (
    name,
    username,
    budget_goal,
    status
  )
  VALUES (
    'Checkout Replay Beneficiary',
    'checkout-replay-beneficiary',
    1200,
    'New'
  )
  RETURNING id
)
INSERT INTO checkout_replay_test_ids
SELECT 'beneficiary', id FROM inserted;

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
    'checkout-replay-intent-main-0001',
    'primary_site',
    'creatorshare.com',
    identity.value,
    decode(repeat('71', 32), 'hex'),
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
    'checkout-replay-test'
  FROM checkout_replay_test_ids identity
  CROSS JOIN checkout_replay_test_ids beneficiary
  WHERE identity.key = 'identity'
    AND beneficiary.key = 'beneficiary'
  RETURNING id
)
INSERT INTO checkout_replay_test_ids
SELECT 'main_intent', id FROM inserted;

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
    'checkout-replay-intent-changed-0001',
    'primary_site',
    'creatorshare.com',
    value,
    decode(repeat('71', 32), 'hex'),
    1,
    1,
    'blind',
    'recurring',
    'month',
    2400,
    2400,
    'USD',
    1,
    clock_timestamp(),
    'checkout-replay-test'
  FROM checkout_replay_test_ids
  WHERE key = 'identity'
  RETURNING id
)
INSERT INTO checkout_replay_test_ids
SELECT 'changed_terms_intent', id FROM inserted;

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
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    currency_quote_at,
    currency_rate_source
  )
  SELECT
    'checkout-replay-intent-failed-0001',
    'primary_site',
    'creatorshare.com',
    value,
    decode(repeat('71', 32), 'hex'),
    1,
    1,
    'blind',
    'one_time',
    1800,
    1800,
    'USD',
    1,
    clock_timestamp(),
    'checkout-replay-test'
  FROM checkout_replay_test_ids
  WHERE key = 'identity'
  RETURNING id
)
INSERT INTO checkout_replay_test_ids
SELECT 'failed_intent', id FROM inserted;

INSERT INTO checkout_replay_test_ids
SELECT 'main_quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'checkout-replay-quote-key-main-0001'
);

INSERT INTO checkout_replay_test_times
SELECT 'main_quote_issued_at', issued_at
FROM public.sponsorship_payment_quotes
WHERE id = (
  SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'
);

INSERT INTO checkout_replay_test_times
SELECT 'main_quote_expires_at', expires_at
FROM public.sponsorship_payment_quotes
WHERE id = (
  SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'
);

SELECT extensions.is(
  (
    SELECT payment_quote_id
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'checkout-replay-quote-key-main-0001'
    )
  ),
  (SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'),
  'an exact quote retry returns the created quote'
);

INSERT INTO checkout_replay_test_ids
SELECT 'main_attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'checkout-replay-provider-key-main-0001',
  target_checkout_receipt_digest => decode(repeat('72', 32), 'hex'),
  target_metadata => '{"checkout":"replay-test"}'::jsonb
);

INSERT INTO checkout_replay_test_times
SELECT 'main_receipt_expires_at', checkout_receipt_expires_at
FROM public.sponsorship_payment_attempts
WHERE id = (
  SELECT value FROM checkout_replay_test_ids WHERE key = 'main_attempt'
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.sponsorship_intents
    WHERE id = (
      SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
    )
  ),
  'committed',
  'the first payment begin commits the sponsorship intent'
);

SELECT extensions.is(
  (
    SELECT payment_quote_id
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'checkout-replay-quote-key-main-0001',
      target_valid_for => interval '30 minutes'
    )
  ),
  (SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'),
  'an exact quote retry recovers the quote after payment begin'
);

SELECT extensions.is(
  (
    SELECT expires_at
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'checkout-replay-quote-key-main-0001',
      target_valid_for => interval '30 minutes'
    )
  ),
  (
    SELECT value
    FROM checkout_replay_test_times
    WHERE key = 'main_quote_expires_at'
  ),
  'quote replay never extends the immutable expiry'
);

UPDATE public.sponsorship_intents
SET status = 'processing'
WHERE id = (
  SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
);

SELECT extensions.is(
  (
    SELECT payment_quote_id
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'checkout-replay-quote-key-main-0001'
    )
  ),
  (SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'),
  'an exact quote retry remains recoverable while processing'
);

UPDATE public.sponsorship_intents
SET status = 'succeeded'
WHERE id = (
  SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
);

SELECT extensions.is(
  (
    SELECT payment_quote_id
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'checkout-replay-quote-key-main-0001'
    )
  ),
  (SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'),
  'an exact quote retry remains recoverable after success'
);

SELECT extensions.is(
  (
    SELECT payment_attempt_id
    FROM public.begin_sponsorship_payment(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_payment_quote_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key => 'checkout-replay-provider-key-main-0001',
      target_checkout_receipt_digest => decode(repeat('72', 32), 'hex'),
      target_metadata => '{"checkout":"replay-test"}'::jsonb
    )
  ),
  (SELECT value FROM checkout_replay_test_ids WHERE key = 'main_attempt'),
  'payment begin returns the exact attempt before checking the succeeded intent status'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_payment(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_payment_quote_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key => 'checkout-replay-provider-key-main-0001',
      target_checkout_receipt_digest => decode(repeat('73', 32), 'hex')
    )
  $$,
  '23505',
  'Provider idempotency key belongs to another sponsorship intent',
  'payment begin rejects a changed receipt digest for an existing provider key'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_uk',
      target_quote_idempotency_key => 'checkout-replay-quote-key-main-0001'
    )
  $$,
  '23505',
  'Payment quote idempotency key belongs to another sponsorship checkout',
  'quote replay cannot cross provider account scopes'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids
        WHERE key = 'changed_terms_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'checkout-replay-quote-key-main-0001'
    )
  $$,
  '23505',
  'Payment quote idempotency key belongs to another sponsorship checkout',
  'quote replay cannot move to another intent with changed financial terms'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'checkout-replay-unrelated-quote-key-0001'
    )
  $$,
  '23514',
  'Payment quote requires a newly created sponsorship intent',
  'an unrelated quote key cannot mint another quote after checkout begins'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_payment(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
      ),
      target_payment_quote_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key => 'checkout-replay-unrelated-provider-key-0001',
      target_checkout_receipt_digest => decode(repeat('72', 32), 'hex')
    )
  $$,
  '23514',
  'Sponsorship intent cannot begin payment in its current state',
  'an unrelated provider key cannot mint another attempt after checkout begins'
);

INSERT INTO checkout_replay_test_ids
SELECT 'failed_quote', payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM checkout_replay_test_ids WHERE key = 'failed_intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'checkout-replay-quote-key-failed-0001'
);

INSERT INTO checkout_replay_test_ids
SELECT 'failed_attempt', payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM checkout_replay_test_ids WHERE key = 'failed_intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM checkout_replay_test_ids WHERE key = 'failed_quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'checkout-replay-provider-key-failed-0001',
  target_checkout_receipt_digest => decode(repeat('74', 32), 'hex')
);

UPDATE public.sponsorship_intents
SET status = 'failed'
WHERE id = (
  SELECT value FROM checkout_replay_test_ids WHERE key = 'failed_intent'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'failed_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'checkout-replay-quote-key-failed-0001'
    )
  $$,
  '23514',
  'Payment quote cannot replay for a terminal sponsorship intent',
  'quote replay rejects a terminal failed intent'
);

SELECT extensions.is(
  (
    SELECT payment_attempt_id
    FROM public.begin_sponsorship_payment(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'failed_intent'
      ),
      target_payment_quote_id => (
        SELECT value FROM checkout_replay_test_ids WHERE key = 'failed_quote'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key => 'checkout-replay-provider-key-failed-0001',
      target_checkout_receipt_digest => decode(repeat('74', 32), 'hex')
    )
  ),
  (SELECT value FROM checkout_replay_test_ids WHERE key = 'failed_attempt'),
  'payment begin still recovers the exact attempt before checking failed intent status'
);

SELECT extensions.is(
  (
    SELECT issued_at
    FROM public.sponsorship_payment_quotes
    WHERE id = (
      SELECT value FROM checkout_replay_test_ids WHERE key = 'main_quote'
    )
  ),
  (
    SELECT value
    FROM checkout_replay_test_times
    WHERE key = 'main_quote_issued_at'
  ),
  'quote replay preserves the original issue time'
);

SELECT extensions.is(
  (
    SELECT checkout_receipt_expires_at
    FROM public.sponsorship_payment_attempts
    WHERE id = (
      SELECT value FROM checkout_replay_test_ids WHERE key = 'main_attempt'
    )
  ),
  (
    SELECT value
    FROM checkout_replay_test_times
    WHERE key = 'main_receipt_expires_at'
  ),
  'payment begin replay preserves the original receipt expiry'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_payment_quotes
    WHERE quote_idempotency_key LIKE 'checkout-replay-quote-key-%'
  ),
  2::bigint,
  'all quote retries preserve one quote per intended checkout'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_payment_attempts
    WHERE provider_idempotency_key LIKE 'checkout-replay-provider-key-%'
  ),
  2::bigint,
  'all payment begin retries preserve one attempt per intended checkout'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_payment_attempts
    WHERE sponsorship_intent_id = (
      SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
    )
  ),
  1::bigint,
  'main checkout replay never creates a second payment attempt'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_checkout_reservations
    WHERE sponsorship_intent_id = (
      SELECT value FROM checkout_replay_test_ids WHERE key = 'main_intent'
    )
  ),
  1::bigint,
  'main checkout replay never creates a second beneficiary reservation'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.sponsorship_payment_quotes
    WHERE sponsorship_intent_id = (
      SELECT value FROM checkout_replay_test_ids
      WHERE key = 'changed_terms_intent'
    )
  ),
  0::bigint,
  'a changed terms replay creates no quote for the unrelated intent'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.issue_sponsorship_payment_quote(uuid,public.sponsorship_method,text,text,interval,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.issue_sponsorship_payment_quote(uuid,public.sponsorship_method,text,text,interval,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.issue_sponsorship_payment_quote(uuid,public.sponsorship_method,text,text,interval,text,text)',
    'EXECUTE'
  ),
  'only the payment service role may issue or replay sponsorship quotes'
);

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_sponsorship_payment_quote(
      '97100000-0000-4000-8000-000000000001'::uuid,
      'STRIPE',
      'stripe_us',
      'checkout-replay-unauthorized-key-0001'
    )
  $$,
  '42501',
  NULL,
  'an authenticated browser caller cannot execute the quote replay boundary'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
