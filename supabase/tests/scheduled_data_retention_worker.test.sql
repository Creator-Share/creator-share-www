BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(62);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.purge_expired_advocate_tracking(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.purge_expired_gateway_event_payloads(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.purge_expired_audit_forensics(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.purge_expired_email_outbox_contact(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.purge_sponsorship_checkout_contact_envelopes(integer,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.purge_expired_sponsor_authentication_evidence(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.purge_expired_advocate_tracking(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_expired_gateway_event_payloads(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_expired_audit_forensics(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_expired_email_outbox_contact(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_sponsorship_checkout_contact_envelopes(integer,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_expired_sponsor_authentication_evidence(integer)',
    'EXECUTE'
  ),
  'only the service role can execute the scheduled retention RPCs'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'private.require_data_retention_service_role()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.require_data_retention_service_role()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'audit.purge_expired_forensics(integer)',
    'EXECUTE'
  ),
  'retention internals are not directly executable outside their public boundary'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_proc routine
    WHERE routine.oid IN (
      'public.purge_expired_advocate_tracking(integer)'::regprocedure,
      'public.purge_expired_gateway_event_payloads(integer)'::regprocedure,
      'public.purge_expired_audit_forensics(integer)'::regprocedure,
      'public.purge_expired_email_outbox_contact(integer)'::regprocedure,
      'public.purge_expired_sponsor_authentication_evidence(integer)'::regprocedure,
      'public.purge_sponsorship_checkout_contact_envelopes(integer,text,text)'::regprocedure
    )
      AND routine.prosecdef
      AND EXISTS (
        SELECT 1
        FROM unnest(routine.proconfig) setting
        WHERE setting LIKE 'search_path=%'
      )
  ),
  6,
  'all scheduled retention RPCs use a locked security definer boundary'
);

SET LOCAL ROLE authenticated;

SELECT extensions.throws_ok(
  $$SELECT * FROM public.purge_expired_advocate_tracking(1)$$,
  '42501',
  'permission denied for function purge_expired_advocate_tracking',
  'authenticated callers cannot invoke advocate retention cleanup'
);

RESET ROLE;

SET LOCAL session_replication_role = replica;

INSERT INTO public.browser_visitors (
  id,
  token_digest,
  consent_state,
  first_seen_at,
  last_seen_at,
  retention_expires_at,
  created_at,
  updated_at
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  decode(repeat('11', 32), 'hex'),
  'granted',
  '2020-01-01 00:00:00+00',
  '2020-01-01 00:00:00+00',
  '2021-02-04 00:00:00+00',
  '2020-01-01 00:00:00+00',
  '2020-01-01 00:00:00+00'
);

INSERT INTO public.advocate_exposures (
  id,
  event_key,
  advocate_id,
  advocate_domain_id,
  browser_visitor_id,
  occurred_at,
  recorded_at,
  retention_expires_at,
  is_qualified,
  exclusion_reason,
  consent_state
)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  '2020-01-01 00:00:00+00',
  '2020-01-01 00:00:00+00',
  '2021-02-04 00:00:00+00',
  true,
  NULL,
  'granted'
);

INSERT INTO public.payment_gateway_events (
  id,
  provider,
  provider_account_scope,
  provider_event_id,
  event_type,
  redacted_payload,
  payload_ciphertext,
  payload_sha256,
  payload_retention_expires_at,
  verification_method,
  signature_verified_at,
  occurred_at,
  received_at,
  processing_status,
  available_at,
  updated_at
)
VALUES (
  '66666666-6666-4666-8666-666666666666',
  'STRIPE',
  'stripe_us',
  'retention-worker-expired-event',
  'checkout.session.completed',
  '{}'::jsonb,
  decode(repeat('22', 32), 'hex'),
  decode(repeat('33', 32), 'hex'),
  '2020-04-01 00:00:00+00',
  'stripe_webhook_signature',
  '2020-01-01 00:00:00+00',
  '2020-01-01 00:00:00+00',
  '2020-01-01 00:00:00+00',
  'received',
  '2020-01-01 00:00:00+00',
  '2020-01-01 00:00:00+00'
);

INSERT INTO audit.audit_events (
  id,
  occurred_at,
  schema_name,
  table_name,
  operation,
  actor_type,
  system_actor,
  database_role,
  session_user_name,
  forensics_expires_at
)
VALUES (
  '77777777-7777-4777-8777-777777777777',
  '2020-01-01 00:00:00+00',
  'public',
  'retention_fixture',
  'UPDATE',
  'system',
  'retention-test-fixture',
  'postgres',
  'postgres',
  '2020-04-01 00:00:00+00'
);

INSERT INTO audit.audit_event_forensics (
  audit_event_id,
  captured_at,
  expires_at,
  client_ip,
  user_agent
)
VALUES (
  '77777777-7777-4777-8777-777777777777',
  '2020-01-01 00:00:00+00',
  '2020-03-31 00:00:00+00',
  '203.0.113.9',
  'retention-test-agent'
);

SET LOCAL session_replication_role = origin;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.purge_expired_advocate_tracking(NULL)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'advocate retention rejects a null batch'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.purge_expired_advocate_tracking(0)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'advocate retention rejects a zero batch'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.purge_expired_advocate_tracking(5001)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'advocate retention rejects an oversized batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_gateway_event_payloads(NULL)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'gateway retention rejects a null batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_gateway_event_payloads(0)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'gateway retention rejects a zero batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_gateway_event_payloads(5001)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'gateway retention rejects an oversized batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_audit_forensics(NULL)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'audit retention rejects a null batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_audit_forensics(0)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'audit retention rejects a zero batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_audit_forensics(5001)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'audit retention rejects an oversized batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_email_outbox_contact(NULL)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'email contact retention rejects a null batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_email_outbox_contact(0)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'email contact retention rejects a zero batch'
);

SELECT extensions.throws_ok(
  $$SELECT public.purge_expired_email_outbox_contact(5001)$$,
  '22023',
  'Retention batch size must be between 1 and 5000',
  'email contact retention rejects an oversized batch'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.purge_sponsorship_checkout_contact_envelopes(
      NULL,
      'retention-test-request',
      'retention-test-trace'
    )
  $$,
  '22023',
  'Checkout contact erasure batch size must be between 1 and 500',
  'checkout contact retention rejects a null batch'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.purge_sponsorship_checkout_contact_envelopes(
      0,
      'retention-test-request',
      'retention-test-trace'
    )
  $$,
  '22023',
  'Checkout contact erasure batch size must be between 1 and 500',
  'checkout contact retention rejects a zero batch'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.purge_sponsorship_checkout_contact_envelopes(
      501,
      'retention-test-request',
      'retention-test-trace'
    )
  $$,
  '22023',
  'Checkout contact erasure batch size must be between 1 and 500',
  'checkout contact retention rejects an oversized batch'
);

CREATE TEMP TABLE retention_tracking_result AS
SELECT * FROM public.purge_expired_advocate_tracking(1);

SELECT extensions.ok(
  (
    SELECT exposures_deleted = 1 AND visitors_deleted = 1
    FROM retention_tracking_result
  ),
  'advocate retention deletes an expired exposure and its unreferenced visitor'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.advocate_exposures
    WHERE id = '22222222-2222-4222-8222-222222222222'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.browser_visitors
    WHERE id = '11111111-1111-4111-8111-111111111111'
  ),
  'advocate retention removes the expired fixture rows'
);

SELECT extensions.is(
  public.purge_expired_gateway_event_payloads(1),
  1::bigint,
  'gateway retention redacts one expired encrypted payload'
);

SELECT extensions.ok(
  (
    SELECT payload_ciphertext IS NULL
      AND payload_redacted_at >= payload_retention_expires_at
    FROM public.payment_gateway_events
    WHERE id = '66666666-6666-4666-8666-666666666666'
  ),
  'gateway retention preserves the event while removing expired ciphertext'
);

SELECT extensions.is(
  public.purge_expired_audit_forensics(1),
  1,
  'audit retention deletes one expired raw forensic record'
);

RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM audit.audit_event_forensics
    WHERE audit_event_id = '77777777-7777-4777-8777-777777777777'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events
    WHERE id = '77777777-7777-4777-8777-777777777777'
  ),
  'audit retention preserves the sanitized indefinite event ledger'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is(
  public.purge_expired_email_outbox_contact(1),
  0::bigint,
  'email contact retention safely handles an empty bounded batch'
);

SELECT extensions.ok(
  (
    SELECT erased_count = 0
      AND succeeded_count = 0
      AND failed_count = 0
      AND cancelled_count = 0
      AND expired_count = 0
    FROM public.purge_sponsorship_checkout_contact_envelopes(
      1,
      'retention-test-request',
      'retention-test-trace'
    )
  ),
  'checkout contact retention safely handles an empty bounded batch'
);

WITH tracking AS MATERIALIZED (
  SELECT * FROM public.purge_expired_advocate_tracking(1)
), gateway AS MATERIALIZED (
  SELECT public.purge_expired_gateway_event_payloads(1) AS redacted
), email_contact AS MATERIALIZED (
  SELECT public.purge_expired_email_outbox_contact(1) AS redacted
), checkout_contact AS MATERIALIZED (
  SELECT *
  FROM public.purge_sponsorship_checkout_contact_envelopes(
    1,
    'retention-test-request-replay',
    'retention-test-trace-replay'
  )
), forensic AS MATERIALIZED (
  SELECT public.purge_expired_audit_forensics(1) AS deleted
)
SELECT extensions.ok(
  tracking.exposures_deleted = 0
  AND tracking.visitors_deleted = 0
  AND gateway.redacted = 0
  AND email_contact.redacted = 0
  AND checkout_contact.erased_count = 0
  AND checkout_contact.succeeded_count = 0
  AND checkout_contact.failed_count = 0
  AND checkout_contact.cancelled_count = 0
  AND checkout_contact.expired_count = 0
  AND forensic.deleted = 0,
  'replaying every retention RPC after cleanup is safely idempotent'
)
FROM tracking
CROSS JOIN gateway
CROSS JOIN email_contact
CROSS JOIN checkout_contact
CROSS JOIN forensic;

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.start_data_retention_run(uuid,integer,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.run_data_retention_step(uuid,text,integer,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.finish_data_retention_run(uuid,text[],text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.read_data_retention_health()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.start_data_retention_run(uuid,integer,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.read_data_retention_health()',
    'EXECUTE'
  ),
  'retention lifecycle and health RPCs are service role only'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'audit.data_retention_runs',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.data_retention_run_events',
    'SELECT'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.data_retention_backlog(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.data_retention_backlog_v1(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.data_retention_counts_are_valid_v1(text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.validate_data_retention_run_context(uuid,integer,text,text)',
    'EXECUTE'
  ),
  'raw retention evidence and private helpers are not exposed to the service role'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_proc routine
    WHERE routine.oid IN (
      'public.start_data_retention_run(uuid,integer,text,text)'::regprocedure,
      'public.run_data_retention_step(uuid,text,integer,text,text)'::regprocedure,
      'public.finish_data_retention_run(uuid,text[],text,text)'::regprocedure,
      'public.read_data_retention_health()'::regprocedure
    )
      AND routine.prosecdef
      AND EXISTS (
        SELECT 1
        FROM unnest(routine.proconfig) setting
        WHERE setting LIKE 'search_path=%'
      )
  ),
  4,
  'every retention lifecycle RPC is a locked security definer'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.start_data_retention_run(
      '00000000-0000-0000-0000-000000000000',
      1,
      'retention-run-zero',
      NULL
    )
  $$,
  '22023',
  'Data retention run id must be a nonzero UUID',
  'retention start rejects the zero UUID'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.start_data_retention_run(
      '81111111-1111-4111-8111-111111111111',
      1,
      ' retention-run-space ',
      NULL
    )
  $$,
  '22023',
  'Data retention request id and optional trace id must be normalized values no longer than 255 characters',
  'retention start rejects a nonnormalized request id'
);

SELECT extensions.is(
  public.start_data_retention_run(
    '81111111-1111-4111-8111-111111111111',
    1,
    'retention-run-one',
    NULL
  ),
  '81111111-1111-4111-8111-111111111111'::uuid,
  'retention start accepts a nullable trusted trace id'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT batch_size = 1
      AND request_id = 'retention-run-one'
      AND trace_id IS NULL
    FROM audit.data_retention_runs
    WHERE run_id = '81111111-1111-4111-8111-111111111111'
  ),
  'the immutable run header preserves exact normalized correlation context'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT public.start_data_retention_run(
      '82222222-2222-4222-8222-222222222222',
      1,
      'retention-run-overlap',
      'trace-overlap'
    )
  $$,
  '55P03',
  'Another data retention run is still active',
  'a second fresh run fails closed'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.run_data_retention_step(
      '81111111-1111-4111-8111-111111111111',
      'invented_step',
      1,
      'retention-run-one',
      NULL
    )
  $$,
  '22023',
  'Unknown data retention step',
  'step execution rejects keys outside the static vocabulary'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.run_data_retention_step(
      '81111111-1111-4111-8111-111111111111',
      'gateway_event_payloads',
      1,
      'wrong-request',
      NULL
    )
  $$,
  '22023',
  'Data retention run context does not match its immutable header',
  'step execution requires exact header correlation context'
);

RESET ROLE;
SET LOCAL session_replication_role = replica;

INSERT INTO public.payment_gateway_events (
  id,
  provider,
  provider_account_scope,
  provider_event_id,
  event_type,
  redacted_payload,
  payload_ciphertext,
  payload_sha256,
  payload_retention_expires_at,
  verification_method,
  signature_verified_at,
  occurred_at,
  received_at,
  processing_status,
  available_at,
  updated_at
)
VALUES
  (
    '83333333-3333-4333-8333-333333333331',
    'STRIPE',
    'stripe_us',
    'retention-run-backlog-one',
    'checkout.session.completed',
    '{}'::jsonb,
    decode(repeat('44', 32), 'hex'),
    decode(repeat('45', 32), 'hex'),
    '2020-05-01 00:00:00+00',
    'stripe_webhook_signature',
    '2020-01-01 00:00:00+00',
    '2020-01-01 00:00:00+00',
    '2020-01-01 00:00:00+00',
    'received',
    '2020-01-01 00:00:00+00',
    '2020-01-01 00:00:00+00'
  ),
  (
    '83333333-3333-4333-8333-333333333332',
    'STRIPE',
    'stripe_us',
    'retention-run-backlog-two',
    'checkout.session.completed',
    '{}'::jsonb,
    decode(repeat('46', 32), 'hex'),
    decode(repeat('47', 32), 'hex'),
    '2020-06-01 00:00:00+00',
    'stripe_webhook_signature',
    '2020-01-01 00:00:00+00',
    '2020-01-01 00:00:00+00',
    '2020-01-01 00:00:00+00',
    'received',
    '2020-01-01 00:00:00+00',
    '2020-01-01 00:00:00+00'
  );

INSERT INTO public.sponsor_identities (id)
VALUES ('88888888-8888-4888-8888-888888888888');

INSERT INTO public.sponsorship_intents (
  id,
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
VALUES (
  '89999999-9999-4999-8999-999999999999',
  'retention-future-contact-intent',
  'primary_site',
  'creatorshare.com',
  '88888888-8888-4888-8888-888888888888',
  decode(repeat('51', 32), 'hex'),
  1,
  1,
  'blind',
  'one_time',
  2500,
  2500,
  'USD',
  1,
  clock_timestamp(),
  'retention-test'
);

INSERT INTO public.sponsorship_account_claims (
  id,
  sponsorship_intent_id,
  email_hmac,
  token_digest,
  status,
  sponsor_identity_id,
  requested_at,
  expires_at,
  revoked_at,
  revocation_reason,
  created_at,
  updated_at
)
VALUES (
  '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '89999999-9999-4999-8999-999999999999',
  decode(repeat('51', 32), 'hex'),
  decode(repeat('52', 32), 'hex'),
  'revoked',
  '88888888-8888-4888-8888-888888888888',
  clock_timestamp() - interval '2 days',
  clock_timestamp() + interval '5 days',
  clock_timestamp() - interval '1 day',
  'Retention eligibility fixture',
  clock_timestamp() - interval '2 days',
  clock_timestamp() - interval '1 day'
);

INSERT INTO public.email_outbox (
  id,
  kind,
  account_claim_id,
  sponsor_identity_id,
  dedupe_key,
  recipient_email_ciphertext,
  recipient_email_hmac,
  email_normalization_version,
  email_hmac_key_version,
  email_encryption_key_version,
  template_key,
  template_data,
  secret_payload_ciphertext,
  contact_retention_expires_at,
  created_at,
  updated_at
)
VALUES (
  '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'sponsor_welcome',
  '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '88888888-8888-4888-8888-888888888888',
  'retention-future-contact-outbox',
  decode('010203', 'hex'),
  decode(repeat('51', 32), 'hex'),
  1,
  1,
  1,
  'sponsor-welcome-v1',
  '{}'::jsonb,
  decode('040506', 'hex'),
  '2026-09-29 00:00:00+00',
  '2026-07-01 00:00:00+00',
  '2026-07-01 00:00:00+00'
);

SET LOCAL session_replication_role = origin;

SELECT extensions.ok(
  (
    SELECT backlog.has_more
      AND backlog.oldest_expired_at IS NOT NULL
      AND backlog.oldest_expired_at <= clock_timestamp()
      AND backlog.oldest_expired_at < outbox.contact_retention_expires_at
    FROM private.data_retention_backlog('email_outbox_contact') backlog
    CROSS JOIN public.email_outbox outbox
    WHERE outbox.id = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  'undeliverable email backlog uses its effective eligibility time, never a future contact retention time'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE retention_run_one_steps (
  step_key text PRIMARY KEY,
  result jsonb NOT NULL
);

INSERT INTO retention_run_one_steps (step_key, result)
SELECT step.step_key, public.run_data_retention_step(
  '81111111-1111-4111-8111-111111111111',
  step.step_key,
  1,
  'retention-run-one',
  NULL
)
FROM unnest(ARRAY[
  'checkout_contact_envelopes',
  'email_outbox_contact',
  'gateway_event_payloads',
  'audit_forensics',
  'sponsor_authentication',
  'advocate_tracking'
]::text[]) WITH ORDINALITY step(step_key, ordinality)
ORDER BY step.ordinality;

SELECT extensions.ok(
  (
    SELECT result = jsonb_build_object(
      'step_key', 'checkout_contact_envelopes',
      'counts', jsonb_build_object(
        'erased_count', 0,
        'succeeded_count', 0,
        'failed_count', 0,
        'cancelled_count', 0,
        'expired_count', 0
      ),
      'has_more', false,
      'oldest_expired_at', NULL
    )
    FROM retention_run_one_steps
    WHERE step_key = 'checkout_contact_envelopes'
  ),
  'checkout retention returns its exact safe count contract'
);

SELECT extensions.ok(
  (
    SELECT result -> 'counts' = '{"redacted_count": 1}'::jsonb
      AND result ->> 'step_key' = 'email_outbox_contact'
      AND (result ->> 'has_more')::boolean = false
      AND result -> 'oldest_expired_at' = 'null'::jsonb
    FROM retention_run_one_steps
    WHERE step_key = 'email_outbox_contact'
  ),
  'email retention returns its exact safe count contract'
);

SELECT extensions.ok(
  (
    SELECT result -> 'counts' = '{"redacted_count": 1}'::jsonb
      AND (result ->> 'has_more')::boolean
      AND result -> 'oldest_expired_at' <> 'null'::jsonb
    FROM retention_run_one_steps
    WHERE step_key = 'gateway_event_payloads'
  ),
  'gateway retention reports bounded work and exact remaining backlog evidence'
);

SELECT extensions.ok(
  (
    SELECT result -> 'counts' = '{"deleted_count": 0}'::jsonb
      AND result ->> 'step_key' = 'audit_forensics'
    FROM retention_run_one_steps
    WHERE step_key = 'audit_forensics'
  ),
  'audit forensics retention returns its exact safe count contract'
);

SELECT extensions.ok(
  (
    SELECT result -> 'counts' = '{"exposures_deleted": 0, "visitors_deleted": 0}'::jsonb
      AND result ->> 'step_key' = 'advocate_tracking'
    FROM retention_run_one_steps
    WHERE step_key = 'advocate_tracking'
  )
  AND (
    SELECT result -> 'counts' = '{
      "recent_auth_receipts_deleted": 0,
      "passwordless_reservations_deleted": 0,
      "passwordless_verification_attempts_deleted": 0,
      "advocate_invitation_authentication_attempts_deleted": 0,
      "email_proof_issuance_gates_deleted": 0
    }'::jsonb
      AND result ->> 'step_key' = 'sponsor_authentication'
    FROM retention_run_one_steps
    WHERE step_key = 'sponsor_authentication'
  ),
  'sponsor authentication and advocate tracking return exact safe count contracts'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT count(*) = 6
      AND bool_and(status = 'completed')
      AND bool_and(request_id = 'retention-run-one')
      AND bool_and(trace_id IS NULL)
    FROM audit.data_retention_run_events
    WHERE run_id = '81111111-1111-4111-8111-111111111111'
      AND event_kind = 'step_outcome'
  ),
  'each successful cleanup has exactly one correlated immutable outcome'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE retention_run_one_finish AS
SELECT public.finish_data_retention_run(
  '81111111-1111-4111-8111-111111111111',
  ARRAY['gateway_event_payloads']::text[],
  'retention-run-one',
  NULL
) AS result;

SELECT extensions.ok(
  (
    SELECT result ->> 'status' = 'completed'
      AND result -> 'completed_steps' = '[
        "checkout_contact_envelopes",
        "email_outbox_contact",
        "gateway_event_payloads",
        "audit_forensics",
        "sponsor_authentication",
        "advocate_tracking"
      ]'::jsonb
      AND result -> 'failed_steps' = '[]'::jsonb
      AND result -> 'backlog_steps' = '["gateway_event_payloads"]'::jsonb
    FROM retention_run_one_finish
  ),
  'a durable completed outcome wins when its committed response was reported lost'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT status = 'completed'
      AND health_status = 'backlog_remaining'
      AND failed_steps = ARRAY[]::text[]
      AND backlog_steps = ARRAY['gateway_event_payloads']::text[]
    FROM audit.data_retention_run_events
    WHERE run_id = '81111111-1111-4111-8111-111111111111'
      AND event_kind = 'terminal'
  ),
  'a completed terminal with remaining backlog is explicitly not clean'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.ok(
  (
    SELECT health ->> 'last_terminal_run_id' =
        '81111111-1111-4111-8111-111111111111'
      AND health ->> 'last_terminal_status' = 'completed'
      AND health ->> 'last_terminal_health_status' = 'backlog_remaining'
      AND health -> 'last_backlog_steps' = '["gateway_event_payloads"]'::jsonb
      AND health -> 'last_clean_run_id' = 'null'::jsonb
      AND NOT health ? 'request_id'
      AND NOT health ? 'trace_id'
    FROM (
      SELECT public.read_data_retention_health() AS health
    ) summary
  ),
  'health reporting exposes backlog and last-success gaps without correlation identifiers'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.run_data_retention_step(
      '81111111-1111-4111-8111-111111111111',
      'gateway_event_payloads',
      1,
      'retention-run-one',
      NULL
    )
  $$,
  '55000',
  'Data retention run is already terminal',
  'terminal runs reject later cleanup attempts'
);

SELECT extensions.is(
  public.finish_data_retention_run(
    '81111111-1111-4111-8111-111111111111',
    ARRAY['gateway_event_payloads']::text[],
    'retention-run-one',
    NULL
  ),
  (SELECT result FROM retention_run_one_finish),
  'finish is idempotent after the same lost-response report'
);

SELECT extensions.is(
  public.start_data_retention_run(
    '84444444-4444-4444-8444-444444444444',
    1,
    'retention-run-two',
    'trace-run-two'
  ),
  '84444444-4444-4444-8444-444444444444'::uuid,
  'a terminal prior run releases the singleton execution boundary'
);

CREATE TEMP TABLE retention_run_two_steps AS
SELECT step.step_key, public.run_data_retention_step(
  '84444444-4444-4444-8444-444444444444',
  step.step_key,
  1,
  'retention-run-two',
  'trace-run-two'
) AS result
FROM unnest(ARRAY[
  'checkout_contact_envelopes',
  'email_outbox_contact',
  'gateway_event_payloads',
  'audit_forensics',
  'advocate_tracking'
]::text[]) WITH ORDINALITY step(step_key, ordinality)
ORDER BY step.ordinality;

SELECT extensions.is(
  (SELECT count(*)::integer FROM retention_run_two_steps),
  5,
  'the second run durably completes every nonfailing step'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.finish_data_retention_run(
      '84444444-4444-4444-8444-444444444444',
      ARRAY[]::text[],
      'retention-run-two',
      'trace-run-two'
    )
  $$,
  '55000',
  'Every retention step must complete or be reported failed before finish',
  'finish rejects a run with an unaccounted step'
);

CREATE TEMP TABLE retention_run_two_finish AS
SELECT public.finish_data_retention_run(
  '84444444-4444-4444-8444-444444444444',
  ARRAY['sponsor_authentication']::text[],
  'retention-run-two',
  'trace-run-two'
) AS result;

SELECT extensions.ok(
  (
    SELECT result ->> 'status' = 'completed_with_failures'
      AND result -> 'failed_steps' = '["sponsor_authentication"]'::jsonb
      AND result -> 'backlog_steps' = '[]'::jsonb
    FROM retention_run_two_finish
  ),
  'sponsor authentication failure terminalizes without blocking later retention steps'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT status = 'failed'
      AND counts = '{
        "recent_auth_receipts_deleted": 0,
        "passwordless_reservations_deleted": 0,
        "passwordless_verification_attempts_deleted": 0,
        "advocate_invitation_authentication_attempts_deleted": 0,
        "email_proof_issuance_gates_deleted": 0
      }'::jsonb
      AND has_more IS NULL
      AND oldest_expired_at IS NULL
      AND request_id = 'retention-run-two'
      AND trace_id = 'trace-run-two'
    FROM audit.data_retention_run_events
    WHERE run_id = '84444444-4444-4444-8444-444444444444'
      AND event_kind = 'step_outcome'
      AND step_key = 'sponsor_authentication'
  ),
  'failed-step evidence is sanitized, correlated, and records backlog as unknown'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.data_retention_runs
    SET request_id = 'tampered'
    WHERE run_id = '84444444-4444-4444-8444-444444444444'
  $$,
  '42501',
  'Data retention run evidence is append only',
  'retention run headers cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.data_retention_run_events
    WHERE run_id = '84444444-4444-4444-8444-444444444444'
  $$,
  '42501',
  'Data retention run evidence is append only',
  'retention run events cannot be deleted'
);

INSERT INTO audit.data_retention_runs (
  run_id,
  started_at,
  batch_size,
  request_id,
  trace_id
)
VALUES (
  '85555555-5555-4555-8555-555555555555',
  clock_timestamp() - interval '16 minutes',
  1,
  'retention-run-stale',
  NULL
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is(
  public.start_data_retention_run(
    '85555555-5555-4555-8555-555555555555',
    1,
    'retention-run-stale',
    NULL
  ),
  NULL::uuid,
  'a stale same-id replay is abandoned and rejected before cleanup'
);

RESET ROLE;

SELECT extensions.ok(
  (
    SELECT status = 'abandoned'
      AND health_status = 'abandoned'
      AND request_id = 'retention-run-stale'
      AND trace_id IS NULL
    FROM audit.data_retention_run_events
    WHERE run_id = '85555555-5555-4555-8555-555555555555'
      AND event_kind = 'terminal'
  ),
  'same-id stale abandonment leaves one immutable terminal event'
);

INSERT INTO audit.data_retention_runs (
  run_id,
  started_at,
  batch_size,
  request_id,
  trace_id
)
VALUES (
  '86666666-6666-4666-8666-666666666666',
  clock_timestamp() - interval '16 minutes',
  1,
  'retention-run-stale-predecessor',
  'trace-stale-predecessor'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is(
  public.start_data_retention_run(
    '87777777-7777-4777-8777-777777777777',
    1,
    'retention-run-three',
    NULL
  ),
  '87777777-7777-4777-8777-777777777777'::uuid,
  'a new run atomically abandons a stale predecessor before starting'
);

RESET ROLE;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.data_retention_run_events
    WHERE run_id = '86666666-6666-4666-8666-666666666666'
      AND event_kind = 'terminal'
      AND status = 'abandoned'
  ),
  'the later start leaves exactly one abandoned predecessor terminal'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.ok(
  (
    SELECT result ->> 'status' = 'completed_with_failures'
      AND jsonb_array_length(result -> 'failed_steps') = 6
    FROM (
      SELECT public.finish_data_retention_run(
        '87777777-7777-4777-8777-777777777777',
        ARRAY[
          'checkout_contact_envelopes',
          'email_outbox_contact',
          'gateway_event_payloads',
          'audit_forensics',
          'sponsor_authentication',
          'advocate_tracking'
        ]::text[],
        'retention-run-three',
        NULL
      ) AS result
    ) finished
  ),
  'a fully failed attempted run still receives bounded terminal evidence'
);

RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
