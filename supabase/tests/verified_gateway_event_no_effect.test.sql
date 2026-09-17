BEGIN;

SELECT plan(17);

SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE no_effect_fixture AS
SELECT
  clock_timestamp() - interval '30 seconds' AS occurred_at,
  decode(repeat('ab', 48), 'hex') AS payload_ciphertext,
  decode(repeat('cd', 32), 'hex') AS payload_sha256;

CREATE TEMP TABLE no_effect_result AS
SELECT *
FROM public.ingest_verified_payment_gateway_event_no_effect(
  'STRIPE',
  'stripe_us',
  'evt_no_effect_pending_0001',
  'refund.created',
  'refund',
  're_no_effect_pending_0001',
  'pending',
  jsonb_build_object(
    'redaction_version', 'stripe_refund_no_effect_v1',
    'delivery_payload_sha256', repeat('12', 32),
    'stripe_signature', 't=1234567890,v1=redacted',
    'webhook_secret_version', 'current'
  ),
  (SELECT payload_ciphertext FROM no_effect_fixture),
  (SELECT payload_sha256 FROM no_effect_fixture),
  clock_timestamp(),
  (SELECT occurred_at FROM no_effect_fixture),
  'stripe_webhook_signature',
  'no-effect-test-request',
  'no-effect-test-trace',
  '203.0.113.12',
  'no-effect-test-agent'
);

SELECT is(
  (SELECT processing_status::text FROM no_effect_result),
  'ignored',
  'a verified provider state with no financial effect is terminally ignored'
);

SELECT is(
  (SELECT is_duplicate FROM no_effect_result),
  false,
  'the first no-effect event delivery is not a duplicate'
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
    WHERE id = (SELECT gateway_event_id FROM no_effect_result)
  ),
  'no-effect evidence contains no intent, attempt, or typed financial facts'
);

SELECT ok(
  (
    SELECT
      redacted_payload @>
        '{"provider_event_disposition":"no_financial_effect","provider_state":"pending"}'::jsonb
      AND NOT (redacted_payload ? 'quarantine')
      AND NOT (redacted_payload ? 'requires_operational_review')
      AND NOT (
        redacted_payload ?| ARRAY[
          'sponsorship_intent_id',
          'payment_attempt_id',
          'sponsor_identity_id',
          'base_amount_usd_cents',
          'charged_amount_minor',
          'charged_currency',
          'conversion_rate'
        ]
      )
    FROM public.payment_gateway_events
    WHERE id = (SELECT gateway_event_id FROM no_effect_result)
  ),
  'the durable disposition is explicit and carries no review or sponsor marker'
);

SELECT ok(
  (
    SELECT
      payload_ciphertext =
        (SELECT payload_ciphertext FROM no_effect_fixture)
      AND payload_sha256 = (SELECT payload_sha256 FROM no_effect_fixture)
      AND payload_retention_expires_at IS NOT NULL
      AND payload_redacted_at IS NULL
    FROM public.payment_gateway_events
    WHERE id = (SELECT gateway_event_id FROM no_effect_result)
  ),
  'encrypted evidence and its canonical digest are retained'
);

SELECT is(
  (
    SELECT effect::text
    FROM public.payment_gateway_event_applications
    WHERE gateway_event_id = (SELECT gateway_event_id FROM no_effect_result)
  ),
  'ignored',
  'the no-effect event records one immutable ignored application'
);

CREATE TEMP TABLE accepted_no_effect_states AS
SELECT
  candidate.provider_state,
  result.gateway_event_id,
  result.processing_status,
  result.is_duplicate
FROM (
  VALUES
    (
      'requires_action'::text,
      'evt_no_effect_requires_action_0001'::text,
      'refund.updated'::text,
      're_no_effect_requires_action_0001'::text
    ),
    (
      'failed'::text,
      'evt_no_effect_failed_0001'::text,
      'refund.updated'::text,
      're_no_effect_failed_0001'::text
    ),
    (
      'canceled'::text,
      'evt_no_effect_canceled_0001'::text,
      'refund.updated'::text,
      're_no_effect_canceled_0001'::text
    )
) AS candidate(
  provider_state,
  provider_event_id,
  event_type,
  provider_object_id
)
CROSS JOIN LATERAL public.ingest_verified_payment_gateway_event_no_effect(
  'STRIPE',
  'stripe_us',
  candidate.provider_event_id,
  candidate.event_type,
  'refund',
  candidate.provider_object_id,
  candidate.provider_state,
  '{"redaction_version":"stripe_refund_no_effect_v1"}'::jsonb,
  decode(repeat('bc', 48), 'hex'),
  extensions.digest(candidate.provider_event_id, 'sha256'),
  clock_timestamp(),
  clock_timestamp() - interval '10 seconds',
  'stripe_webhook_signature'
) result;

SELECT is(
  (
    SELECT count(*)
    FROM accepted_no_effect_states
    WHERE processing_status = 'ignored'
      AND is_duplicate = false
  ),
  3::bigint,
  'requires-action, failed, and canceled refund states are terminally ignored'
);

SELECT is(
  (
    SELECT count(*)
    FROM accepted_no_effect_states result
    JOIN public.payment_gateway_events event
      ON event.id = result.gateway_event_id
    WHERE event.redacted_payload ->> 'provider_state' =
        result.provider_state
      AND event.redacted_payload ->> 'provider_event_disposition' =
        'no_financial_effect'
      AND NOT (event.redacted_payload ? 'requires_operational_review')
  ),
  3::bigint,
  'each accepted refund event retains its exact provider state without review'
);

SELECT is(
  (
    SELECT is_duplicate
    FROM public.ingest_verified_payment_gateway_event_no_effect(
      'STRIPE',
      'stripe_us',
      'evt_no_effect_pending_0001',
      'refund.created',
      'refund',
      're_no_effect_pending_0001',
      'pending',
      jsonb_build_object(
        'redaction_version', 'stripe_refund_no_effect_v1',
        'delivery_payload_sha256', repeat('34', 32),
        'stripe_signature', 't=1234567999,v1=redelivery',
        'webhook_secret_version', 'previous'
      ),
      decode(repeat('ef', 48), 'hex'),
      (SELECT payload_sha256 FROM no_effect_fixture),
      clock_timestamp(),
      (SELECT occurred_at FROM no_effect_fixture),
      'stripe_webhook_signature'
    )
  ),
  true,
  'delivery-specific signature changes preserve canonical replay idempotency'
);

SELECT ok(
  (
    SELECT count(*) = 1
    FROM public.payment_gateway_events
    WHERE provider = 'STRIPE'
      AND provider_account_scope = 'stripe_us'
      AND provider_event_id = 'evt_no_effect_pending_0001'
  )
  AND (
    SELECT count(*) = 1
    FROM public.payment_gateway_event_applications
    WHERE gateway_event_id = (SELECT gateway_event_id FROM no_effect_result)
  ),
  'an exact replay creates neither a second event nor a second application'
);

SELECT throws_ok(
  $$SELECT * FROM public.ingest_verified_payment_gateway_event_no_effect(
    'STRIPE',
    'stripe_us',
    'evt_no_effect_pending_0001',
    'refund.created',
    'refund',
    're_no_effect_pending_0001',
    'pending',
    '{"redaction_version":"stripe_refund_no_effect_v1"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    (SELECT occurred_at FROM no_effect_fixture),
    'stripe_webhook_signature'
  )$$,
  '23505',
  'Verified provider event identifier conflicts with durable no-effect evidence',
  'the same provider event ID cannot replay with a different canonical digest'
);

SELECT throws_ok(
  $$SELECT * FROM public.ingest_verified_payment_gateway_event_no_effect(
    'STRIPE',
    'stripe_us',
    'evt_no_effect_pending_0001',
    'refund.created',
    'refund',
    're_no_effect_pending_0001',
    'requires_action',
    '{"redaction_version":"stripe_refund_no_effect_v1"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('cd', 32), 'hex'),
    clock_timestamp(),
    (SELECT occurred_at FROM no_effect_fixture),
    'stripe_webhook_signature'
  )$$,
  '23505',
  'Verified provider event identifier conflicts with durable no-effect evidence',
  'the same provider event ID cannot replay with a different provider state'
);

SELECT throws_ok(
  $$SELECT * FROM public.ingest_verified_payment_gateway_event_no_effect(
    'STRIPE',
    'stripe_us',
    'evt_no_effect_pending_0001',
    'refund.created',
    'refund',
    're_no_effect_pending_0001',
    'pending',
    '{"redaction_version":"stripe_refund_no_effect_v2"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('cd', 32), 'hex'),
    clock_timestamp(),
    (SELECT occurred_at FROM no_effect_fixture),
    'stripe_webhook_signature'
  )$$,
  '23505',
  'Verified provider event identifier conflicts with durable no-effect evidence',
  'a replay cannot change stable redacted evidence under the canonical digest'
);

SELECT throws_ok(
  $$SELECT * FROM public.ingest_verified_payment_gateway_event_no_effect(
    'STRIPE',
    'stripe_us',
    'evt_no_effect_unknown_0001',
    'refund.updated',
    'refund',
    're_no_effect_unknown_0001',
    'unknown_transition',
    '{"redaction_version":"stripe_refund_no_effect_v1"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    clock_timestamp() - interval '10 seconds',
    'stripe_webhook_signature'
  )$$,
  '22023',
  'Unsupported no-effect provider event disposition',
  'unknown refund states cannot silently enter the no-effect path'
);

SELECT throws_ok(
  $$SELECT * FROM public.ingest_verified_payment_gateway_event_no_effect(
    'PAYPAL',
    'paypal_global',
    'WH-no-effect-pending-0001',
    'PAYMENT.CAPTURE.PENDING',
    'capture',
    'capture-no-effect-pending-0001',
    'pending',
    '{"redaction_version":"paypal_no_effect_v1"}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    clock_timestamp() - interval '10 seconds',
    'paypal_webhook_signature_api'
  )$$,
  '22023',
  'Unsupported no-effect provider event disposition',
  'the provider-generic signature does not admit an unapproved PayPal mapping'
);

SELECT throws_ok(
  $$SELECT * FROM public.ingest_verified_payment_gateway_event_no_effect(
    'STRIPE',
    'stripe_us',
    'evt_no_effect_review_0001',
    'refund.updated',
    'refund',
    're_no_effect_review_0001',
    'requires_action',
    '{"redaction_version":"stripe_refund_no_effect_v1","requires_operational_review":true}'::jsonb,
    decode(repeat('ef', 48), 'hex'),
    decode(repeat('aa', 32), 'hex'),
    clock_timestamp(),
    clock_timestamp() - interval '10 seconds',
    'stripe_webhook_signature'
  )$$,
  '22023',
  'No-effect redacted evidence contains reserved facts',
  'no-effect evidence cannot smuggle an operational review marker'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.ingest_verified_payment_gateway_event_no_effect(public.sponsorship_method,text,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.ingest_verified_payment_gateway_event_no_effect(public.sponsorship_method,text,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.ingest_verified_payment_gateway_event_no_effect(public.sponsorship_method,text,text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text,text)'::regprocedure,
    'EXECUTE'
  ),
  'only the service role can execute the no-effect ingestion boundary'
);

SELECT * FROM finish();

ROLLBACK;
