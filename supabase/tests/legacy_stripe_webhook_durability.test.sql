BEGIN;

SELECT plan(18);

SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE legacy_fixture AS
SELECT
  clock_timestamp() - interval '10 seconds' AS occurred_at,
  decode(repeat('ab', 48), 'hex') AS ciphertext,
  decode(repeat('cd', 32), 'hex') AS payload_digest,
  jsonb_build_object(
    'redaction_version', 'stripe_legacy_durable_v1',
    'provider', 'STRIPE',
    'source', 'verified_webhook',
    'processing_lane', 'legacy',
    'event_type', 'invoice.paid',
    'provider_object_type', 'invoice',
    'delivery_payload_sha256', repeat('12', 32),
    'webhook_secret_version', 'current'
  ) AS redacted_payload;

CREATE TEMP TABLE legacy_ingestion AS
SELECT ingested.*
FROM legacy_fixture fixture
CROSS JOIN LATERAL public.ingest_verified_legacy_stripe_gateway_event(
  'stripe_us',
  'evt_legacy_durable_test_1',
  'invoice.paid',
  'invoice',
  'in_legacy_durable_test_1',
  fixture.redacted_payload,
  fixture.ciphertext,
  fixture.payload_digest,
  clock_timestamp(),
  fixture.occurred_at,
  'legacy-durable-request',
  'legacy-durable-trace',
  '203.0.113.25',
  'legacy-durable-test-agent'
) ingested;

SELECT is(
  (SELECT processing_status::text FROM legacy_ingestion),
  'received',
  'a verified legacy Stripe event enters the shared durable inbox'
);

SELECT is(
  (SELECT is_duplicate FROM legacy_ingestion),
  false,
  'the first durable legacy delivery is not a duplicate'
);

SELECT ok(
  (
    SELECT
      provider = 'STRIPE'
      AND provider_account_scope = 'stripe_us'
      AND verification_method = 'stripe_webhook_signature_legacy'
      AND sponsorship_intent_id IS NULL
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
    WHERE id = (SELECT gateway_event_id FROM legacy_ingestion)
  ),
  'the legacy marker carries no server intent link or typed v2 facts'
);

SELECT is(
  (
    SELECT is_duplicate
    FROM legacy_fixture fixture
    CROSS JOIN LATERAL public.ingest_verified_legacy_stripe_gateway_event(
      'stripe_us',
      'evt_legacy_durable_test_1',
      'invoice.paid',
      'invoice',
      'in_legacy_durable_test_1',
      fixture.redacted_payload,
      fixture.ciphertext,
      fixture.payload_digest,
      clock_timestamp(),
      fixture.occurred_at
    ) replayed
  ),
  true,
  'exact signed evidence is an idempotent duplicate before application'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM legacy_fixture fixture
    CROSS JOIN LATERAL public.ingest_verified_legacy_stripe_gateway_event(
      'stripe_us',
      'evt_legacy_durable_test_1',
      'invoice.paid',
      'invoice',
      'in_legacy_durable_test_1',
      fixture.redacted_payload,
      fixture.ciphertext,
      decode(repeat('ef', 32), 'hex'),
      clock_timestamp(),
      fixture.occurred_at
    ) replayed
  $$,
  '23505',
  'Provider event identifier was replayed with different evidence',
  'conflicting immutable evidence fails closed'
);

SELECT throws_ok(
  $$
    INSERT INTO public.payment_gateway_events (
      provider,
      provider_account_scope,
      provider_event_id,
      event_type,
      provider_object_type,
      provider_object_id,
      redacted_payload,
      payload_ciphertext,
      payload_sha256,
      signature_verified_at,
      occurred_at,
      verification_method,
      fact_payment_status
    )
    SELECT
      'STRIPE',
      'stripe_us',
      'evt_legacy_typed_fact_forbidden',
      'invoice.paid',
      'invoice',
      'in_legacy_typed_fact_forbidden',
      fixture.redacted_payload,
      fixture.ciphertext,
      fixture.payload_digest,
      clock_timestamp(),
      fixture.occurred_at,
      'stripe_webhook_signature_legacy',
      'paid'
    FROM legacy_fixture fixture
  $$,
  '23514',
  NULL,
  'the legacy verification marker is structurally incompatible with typed facts'
);

CREATE TEMP TABLE legacy_claim AS
SELECT claimed.*
FROM public.claim_payment_gateway_events(
  'legacy-stripe-worker:test',
  100,
  'legacy-claim-request',
  'legacy-claim-trace'
) claimed
WHERE claimed.gateway_event_id = (
  SELECT gateway_event_id FROM legacy_ingestion
);

SELECT is(
  (SELECT verification_method FROM legacy_claim),
  'stripe_webhook_signature_legacy',
  'the shared claim boundary exposes only the explicit legacy lane marker'
);

SELECT is(
  (SELECT processing_attempt_count::integer FROM legacy_claim),
  1,
  'legacy processing consumes the normal shared retry budget'
);

SELECT throws_ok(
  format(
    'SELECT * FROM public.read_legacy_stripe_gateway_event_payload(%L, %L)',
    (SELECT gateway_event_id FROM legacy_claim),
    gen_random_uuid()
  ),
  '55P03',
  'Legacy Stripe event payload requires its exact active lease',
  'encrypted legacy evidence cannot be read without the exact active lease'
);

SELECT is(
  (
    SELECT encode(payload_ciphertext, 'hex')
    FROM legacy_claim claim
    CROSS JOIN LATERAL public.read_legacy_stripe_gateway_event_payload(
      claim.gateway_event_id,
      claim.processing_lease_token,
      'legacy-read-request',
      'legacy-read-trace'
    ) material
  ),
  repeat('ab', 48),
  'the exact lease can read the encrypted payload for app-tier replay'
);

CREATE TEMP TABLE legacy_completion AS
SELECT completed.*
FROM legacy_claim claim
CROSS JOIN LATERAL public.complete_legacy_stripe_gateway_event(
  claim.gateway_event_id,
  claim.processing_lease_token,
  'legacy-complete-request',
  'legacy-complete-trace'
) completed;

SELECT is(
  (SELECT processing_status::text FROM legacy_completion),
  'processed',
  'legacy application settles the shared event lease atomically'
);

SELECT is(
  (SELECT application_effect::text FROM legacy_completion),
  'legacy_applied',
  'legacy application records a distinct durable disposition'
);

SELECT is(
  (
    SELECT effect::text
    FROM public.payment_gateway_event_applications
    WHERE gateway_event_id = (SELECT gateway_event_id FROM legacy_ingestion)
  ),
  'legacy_applied',
  'the append-only application record prevents a second side effect pass'
);

SELECT is(
  (
    SELECT processing_status::text || ':' || is_duplicate::text
    FROM legacy_fixture fixture
    CROSS JOIN LATERAL public.ingest_verified_legacy_stripe_gateway_event(
      'stripe_us',
      'evt_legacy_durable_test_1',
      'invoice.paid',
      'invoice',
      'in_legacy_durable_test_1',
      fixture.redacted_payload,
      fixture.ciphertext,
      fixture.payload_digest,
      clock_timestamp(),
      fixture.occurred_at
    ) replayed
  ),
  'processed:true',
  'identical redelivery after completion is a processed no-op'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_payment_gateway_events(
      'legacy-stripe-worker:duplicate',
      100
    ) claimed
    WHERE claimed.gateway_event_id = (
      SELECT gateway_event_id FROM legacy_ingestion
    )
  ),
  0,
  'a processed legacy event cannot be leased for another side effect pass'
);

SELECT throws_ok(
  format(
    'SELECT * FROM public.complete_legacy_stripe_gateway_event(%L, %L)',
    (SELECT gateway_event_id FROM legacy_claim),
    (SELECT processing_lease_token FROM legacy_claim)
  ),
  '55P03',
  'Legacy Stripe event completion requires its exact active lease',
  'a completed legacy lease cannot be replayed'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.ingest_verified_legacy_stripe_gateway_event(text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.read_legacy_stripe_gateway_event_payload(uuid,uuid,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_legacy_stripe_gateway_event(uuid,uuid,text,text)'::regprocedure,
    'EXECUTE'
  ),
  'the payment service role can capture, lease-read, and complete legacy events'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.ingest_verified_legacy_stripe_gateway_event(text,text,text,text,text,jsonb,bytea,bytea,timestamp with time zone,timestamp with time zone,text,text,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.read_legacy_stripe_gateway_event_payload(uuid,uuid,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.complete_legacy_stripe_gateway_event(uuid,uuid,text,text)'::regprocedure,
    'EXECUTE'
  ),
  'browser roles cannot access the durable legacy event boundary'
);

SELECT * FROM finish();

ROLLBACK;
