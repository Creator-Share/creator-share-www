BEGIN;

SELECT plan(17);

SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE quarantine_fixture AS
SELECT clock_timestamp() - interval '10 seconds' AS occurred_at;

CREATE TEMP TABLE quarantine_result AS
SELECT *
FROM public.quarantine_verified_payment_gateway_event(
  'STRIPE',
  'stripe_us',
  'evt_quarantine_test_1',
  'checkout.session.unexpected',
  'checkout_session',
  'cs_test_quarantine_1',
  jsonb_build_object(
    'redaction_version', 'stripe_verified_quarantine_v1',
    'delivery_payload_sha256', repeat('12', 32),
    'stripe_signature', 't=1234567890,v1=redacted',
    'webhook_secret_version', 'current'
  ),
  decode(repeat('ab', 48), 'hex'),
  decode(repeat('cd', 32), 'hex'),
  clock_timestamp(),
  (SELECT occurred_at FROM quarantine_fixture),
  'stripe_webhook_signature',
  'unsupported-event',
  'Signed event type is not registered',
  'quarantine-test-request',
  'quarantine-test-trace',
  '203.0.113.10',
  'quarantine-test-agent'
);

SELECT is(
  (SELECT processing_status::text FROM quarantine_result),
  'ignored',
  'quarantined evidence is terminally ignored'
);

SELECT is(
  (SELECT is_duplicate FROM quarantine_result),
  false,
  'the first quarantined delivery is not a duplicate'
);

SELECT is(
  (
    SELECT payment_attempt_id
    FROM public.payment_gateway_events
    WHERE id = (SELECT gateway_event_id FROM quarantine_result)
  ),
  NULL::uuid,
  'quarantined evidence cannot attach itself to a payment attempt'
);

SELECT ok(
  (
    SELECT
      sponsorship_intent_id IS NULL
      AND payment_attempt_id IS NULL
      AND original_financial_movement_id IS NULL
      AND fact_payment_status IS NULL
      AND fact_server_payment_attempt_id IS NULL
      AND fact_parent_provider_object_type IS NULL
      AND fact_parent_provider_object_id IS NULL
      AND fact_provider_movement_type IS NULL
      AND fact_provider_movement_id IS NULL
      AND fact_provider_customer_id IS NULL
      AND fact_provider_subscription_id IS NULL
      AND fact_base_amount_usd_cents IS NULL
      AND fact_charged_amount_minor IS NULL
      AND fact_charged_currency IS NULL
      AND fact_conversion_rate IS NULL
      AND fact_period_start IS NULL
      AND fact_period_end IS NULL
      AND fact_failure_code IS NULL
      AND fact_lifecycle_state IS NULL
    FROM public.payment_gateway_events
    WHERE id = (SELECT gateway_event_id FROM quarantine_result)
  ),
  'quarantine carries no sponsor, attempt, or typed payment facts'
);

SELECT is(
  (
    SELECT redacted_payload ->> 'requires_operational_review'
    FROM public.payment_gateway_events
    WHERE id = (SELECT gateway_event_id FROM quarantine_result)
  ),
  'true',
  'quarantined evidence carries an operational review marker'
);

SELECT is(
  (
    SELECT effect::text
    FROM public.payment_gateway_event_applications
    WHERE gateway_event_id = (SELECT gateway_event_id FROM quarantine_result)
  ),
  'ignored',
  'quarantine records an immutable application disposition'
);

SELECT is(
  (
    SELECT is_duplicate
    FROM public.quarantine_verified_payment_gateway_event(
      'STRIPE',
      'stripe_us',
      'evt_quarantine_test_1',
      'checkout.session.unexpected',
      'checkout_session',
      'cs_test_quarantine_1',
      jsonb_build_object(
        'redaction_version', 'stripe_verified_quarantine_v1',
        'delivery_payload_sha256', repeat('12', 32),
        'stripe_signature', 't=1234567890,v1=redacted',
        'webhook_secret_version', 'current'
      ),
      decode(repeat('ef', 48), 'hex'),
      decode(repeat('cd', 32), 'hex'),
      clock_timestamp(),
      (SELECT occurred_at FROM quarantine_fixture),
      'stripe_webhook_signature',
      'unsupported-event',
      'Signed event type is not registered'
    )
  ),
  true,
  'the same immutable event digest is an exact quarantine duplicate'
);

SELECT is(
  (
    SELECT is_duplicate
    FROM public.quarantine_verified_payment_gateway_event(
      'STRIPE',
      'stripe_us',
      'evt_quarantine_test_1',
      'checkout.session.unexpected',
      'checkout_session',
      'cs_test_quarantine_1',
      jsonb_build_object(
        'redaction_version', 'stripe_verified_quarantine_v1',
        'delivery_payload_sha256', repeat('34', 32),
        'stripe_signature', 't=2234567890,v1=rotated',
        'webhook_secret_version', 'previous'
      ),
      decode(repeat('ef', 48), 'hex'),
      decode(repeat('cd', 32), 'hex'),
      clock_timestamp(),
      (SELECT occurred_at FROM quarantine_fixture),
      'stripe_webhook_signature',
      'unsupported-event',
      'Signed event type is not registered'
    )
  ),
  true,
  'delivery-specific signature evidence may change on exact canonical replay'
);

SELECT throws_ok(
  $$SELECT * FROM public.quarantine_verified_payment_gateway_event(
    'STRIPE',
    'stripe_us',
    'evt_quarantine_test_1',
    'checkout.session.unexpected',
    'checkout_session',
    'cs_test_quarantine_1',
    '{"redaction_version":"stripe_verified_quarantine_v1"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    (SELECT occurred_at FROM quarantine_fixture),
    'stripe_webhook_signature',
    'unsupported-event',
    'Signed event type is not registered'
  )$$,
  '23505',
  'Verified provider event identifier conflicts with durable evidence',
  'a provider event ID cannot be replayed with different immutable evidence'
);

SELECT throws_ok(
  $$SELECT * FROM public.quarantine_verified_payment_gateway_event(
    'STRIPE',
    'stripe_us',
    'evt_quarantine_test_1',
    'checkout.session.unexpected',
    'checkout_session',
    'cs_test_quarantine_1',
    '{"redaction_version":"stripe_verified_quarantine_v2"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('cd', 32), 'hex'),
    clock_timestamp(),
    (SELECT occurred_at FROM quarantine_fixture),
    'stripe_webhook_signature',
    'unsupported-event',
    'Signed event type is not registered'
  )$$,
  '23505',
  'Verified provider event identifier conflicts with durable evidence',
  'a replay cannot change stable redacted quarantine evidence'
);

SELECT throws_ok(
  $$SELECT * FROM public.quarantine_verified_payment_gateway_event(
    'STRIPE',
    'stripe_us',
    'evt_quarantine_test_1',
    'checkout.session.unexpected',
    'checkout_session',
    'cs_test_quarantine_1',
    '{"redaction_version":"stripe_verified_quarantine_v1"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('cd', 32), 'hex'),
    clock_timestamp(),
    (SELECT occurred_at FROM quarantine_fixture),
    'stripe_webhook_signature',
    'boundary-mismatch',
    'Signed event terms conflict with the server boundary'
  )$$,
  '23505',
  'Verified provider event identifier conflicts with durable evidence',
  'a replay cannot silently change its quarantine disposition'
);

SELECT throws_ok(
  $$SELECT * FROM public.quarantine_verified_payment_gateway_event(
    'STRIPE',
    'stripe_us',
    'evt_quarantine_test_1',
    'checkout.session.unexpected',
    'checkout_session',
    'cs_test_quarantine_1',
    '{"redaction_version":"stripe_verified_quarantine_v1"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('cd', 32), 'hex'),
    clock_timestamp(),
    (SELECT occurred_at FROM quarantine_fixture) - interval '1 second',
    'stripe_webhook_signature',
    'unsupported-event',
    'Signed event type is not registered'
  )$$,
  '23505',
  'Verified provider event identifier conflicts with durable evidence',
  'a replay cannot change the signed event occurrence time'
);

SELECT throws_ok(
  $$SELECT * FROM public.quarantine_verified_payment_gateway_event(
    'STRIPE',
    'stripe_us',
    'evt_quarantine_test_2',
    'checkout.session.unexpected',
    'checkout_session',
    'cs_test_quarantine_2',
    '{"source":"verified_webhook"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    clock_timestamp(),
    'provider_api_response',
    'unsupported-event',
    'Signed event type is not registered'
  )$$,
  '22023',
  'Quarantine verification method does not match provider',
  'quarantine requires a signature-verification method'
);

SELECT throws_ok(
  $$SELECT * FROM public.quarantine_verified_payment_gateway_event(
    'STRIPE',
    'stripe_us',
    'evt_quarantine_reserved_1',
    'checkout.session.unexpected',
    'checkout_session',
    'cs_test_quarantine_reserved_1',
    '{"payment_attempt_id":"11111111-1111-4111-8111-111111111111"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    clock_timestamp(),
    'stripe_webhook_signature',
    'unsupported-event',
    'Signed event type is not registered'
  )$$,
  '22023',
  'Quarantined provider evidence is malformed',
  'quarantine evidence cannot smuggle an attempt or typed payment fact'
);

SELECT throws_ok(
  $$SELECT * FROM public.quarantine_verified_payment_gateway_event(
    'STRIPE',
    'stripe_us',
    'evt_quarantine_disposition_1',
    'refund.updated',
    'refund',
    're_quarantine_disposition_1',
    '{"provider_event_disposition":"no_financial_effect","provider_state":"pending"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    clock_timestamp(),
    'stripe_webhook_signature',
    'boundary-mismatch',
    'Signed refund evidence conflicts with its durable boundary'
  )$$,
  '22023',
  'Quarantined provider evidence is malformed',
  'quarantine cannot claim the mutually exclusive no-effect disposition'
);

SELECT throws_ok(
  $$SELECT * FROM public.quarantine_verified_payment_gateway_event(
    'STRIPE',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '{}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    clock_timestamp(),
    'stripe_webhook_signature',
    'unsupported-event',
    'Signed event type is not registered'
  )$$,
  '22023',
  'Quarantined provider identifiers are malformed',
  'null provider identifiers are rejected at the quarantine boundary'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.quarantine_verified_payment_gateway_event(public.sponsorship_method,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.quarantine_verified_payment_gateway_event(public.sponsorship_method,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.quarantine_verified_payment_gateway_event(public.sponsorship_method,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,text)'::regprocedure,
    'EXECUTE'
  ),
  'only the payment service role can quarantine verified provider evidence'
);

SELECT * FROM finish();

ROLLBACK;
