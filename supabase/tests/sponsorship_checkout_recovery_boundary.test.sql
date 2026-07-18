BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE checkout_recovery_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE checkout_recovery_test_times (
  key text PRIMARY KEY,
  value timestamptz NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE checkout_recovery_test_bytes (
  key text PRIMARY KEY,
  value bytea NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.provider_request_claims(
  target_operation_id uuid,
  target_intent_id uuid,
  target_quote_id uuid,
  target_request_fingerprint bytea,
  target_request_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'canonical_json_version', 1,
    'provider', operation.provider::text,
    'provider_account_scope', operation.provider_account_scope,
    'checkout_operation_id', operation.operation_id::text,
    'sponsorship_intent_id', intent.id::text,
    'payment_quote_id', quote.id::text,
    'payment_attempt_id_placeholder',
      '{"$creator_share":"server_payment_attempt_id","type":"uuid"}'::jsonb,
    'payment_attempt_id_placeholder_path', '/paymentAttemptId',
    'unresolved_placeholder_count', 1,
    'financial_terms', jsonb_build_object(
      'payment_mode', quote.payment_mode::text,
      'recurrence_interval', quote.recurrence_interval,
      'base_amount_usd_cents', quote.base_amount_usd_cents,
      'charged_amount_minor', quote.charged_amount_minor,
      'charged_currency', quote.charged_currency::text,
      'conversion_rate', quote.conversion_rate,
      'currency_quote_at_epoch_microseconds',
        (extract(epoch FROM intent.currency_quote_at) * 1000000)::bigint
    ),
    'sponsor_email_binding', jsonb_build_object(
      'representation', 'encrypted_in_template',
      'normalization_version', intent.contact_email_normalization_version,
      'hmac_key_version', intent.contact_email_hmac_key_version,
      'hmac_sha256', encode(intent.contact_email_hmac, 'hex')
    ),
    'product_display_fields_sha256', repeat('4a', 32),
    'return_urls_sha256', repeat('5b', 32),
    'provider_request_expires_at_epoch_microseconds',
      (extract(epoch FROM target_request_expires_at) * 1000000)::bigint,
    'canonical_template_sha256', encode(target_request_fingerprint, 'hex')
  )
  FROM public.sponsorship_checkout_operations operation
  JOIN public.sponsorship_intents intent
    ON intent.id = target_intent_id
  JOIN public.sponsorship_payment_quotes quote
    ON quote.id = target_quote_id
  WHERE operation.operation_id = target_operation_id;
$$;

CREATE OR REPLACE FUNCTION pg_temp.prepare_recovery_checkout(
  target_operation_id uuid,
  target_receipt_digest bytea,
  target_email_hex_byte text,
  target_beneficiary_id uuid,
  target_currency_quote_at timestamptz,
  target_provider public.sponsorship_method DEFAULT 'STRIPE',
  target_provider_account_scope text DEFAULT 'stripe_us'
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_intent_id uuid;
BEGIN
  SELECT prepared.resolved_sponsorship_intent_id
  INTO STRICT v_intent_id
  FROM public.prepare_sponsorship_checkout_intent_v2(
    target_checkout_operation_id => target_operation_id,
    target_checkout_receipt_digest => target_receipt_digest,
    target_provider => target_provider,
    target_provider_account_scope => target_provider_account_scope,
    target_provider_idempotency_key =>
      lower(target_provider::text) || '-checkout:' || target_operation_id::text,
    target_idempotency_key => 'checkout-v2:' || target_operation_id::text,
    target_source => 'primary_site',
    target_advocate_hostname => NULL,
    target_visitor_token_digest => NULL,
    target_auth_user_id => NULL,
    target_contact_email_hmac => decode(
      repeat(target_email_hex_byte, 32),
      'hex'
    ),
    target_contact_email_normalization_version => 1::smallint,
    target_contact_email_hmac_key_version => 1::smallint,
    target_subject_kind => 'standard',
    target_beneficiary_id => target_beneficiary_id,
    target_partnership_project => NULL,
    target_payment_mode => 'one_time',
    target_recurrence_interval => NULL,
    target_base_amount_usd_cents => 1600,
    target_charged_amount_minor => 1600,
    target_charged_currency => 'USD',
    target_conversion_rate => 1,
    target_currency_quote_at => target_currency_quote_at,
    target_currency_rate_source => 'checkout-recovery-test'
  ) prepared;

  RETURN v_intent_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.issue_recovery_quote(
  target_operation_id uuid,
  target_intent_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_quote_id uuid;
BEGIN
  SELECT quote.payment_quote_id
  INTO STRICT v_quote_id
  FROM public.issue_sponsorship_payment_quote_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => target_intent_id,
    target_quote_idempotency_key => 'quote:' || target_operation_id::text
  ) quote;

  RETURN v_quote_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.begin_recovery_checkout(
  target_operation_id uuid,
  target_intent_id uuid,
  target_quote_id uuid,
  target_receipt_digest bytea,
  target_request_fingerprint bytea,
  target_request_expires_at timestamptz,
  target_request_ciphertext bytea
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempt_id uuid;
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
BEGIN
  SELECT operation.*
  INTO STRICT v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_operation_id;

  SELECT payment.payment_attempt_id
  INTO STRICT v_attempt_id
  FROM public.begin_sponsorship_payment_v2(
    target_checkout_operation_id => target_operation_id,
    target_sponsorship_intent_id => target_intent_id,
    target_payment_quote_id => target_quote_id,
    target_provider => v_operation.provider,
    target_provider_account_scope => v_operation.provider_account_scope,
    target_provider_idempotency_key => v_operation.provider_idempotency_key,
    target_checkout_receipt_digest => target_receipt_digest,
    target_provider_request_schema_version => 1::smallint,
    target_provider_request_template_claims =>
      pg_temp.provider_request_claims(
        target_operation_id,
        target_intent_id,
        target_quote_id,
        target_request_fingerprint,
        target_request_expires_at
      ),
    target_provider_request_fingerprint => target_request_fingerprint,
    target_provider_request_expires_at => target_request_expires_at,
    target_provider_request_ciphertext => target_request_ciphertext,
    target_provider_request_encryption_key_version => 7::smallint,
    target_provider_request_ciphertext_sha256 => extensions.digest(
      target_request_ciphertext,
      'sha256'
    ),
    target_metadata => '{"test":"checkout_recovery_v2"}'::jsonb
  ) payment;

  RETURN v_attempt_id;
END;
$$;

UPDATE public.payment_provider_accounts
SET
  status = 'active',
  environment = 'live'
WHERE (provider = 'STRIPE' AND scope = 'stripe_us')
   OR (provider = 'PAYPAL' AND scope = 'paypal');

INSERT INTO public.beneficiaries (
  name,
  username,
  budget_goal,
  status
)
VALUES
  ('Recovery Main Beneficiary', 'recovery-v2-main-beneficiary', 1600, 'New'),
  ('Recovery Manual Beneficiary', 'recovery-v2-manual-beneficiary', 1600, 'New'),
  ('Recovery Legacy Beneficiary', 'recovery-v2-legacy-beneficiary', -1, 'New'),
  ('Recovery Prebegin Beneficiary', 'recovery-v2-prebegin-beneficiary', 1600, 'New');

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  CASE username
    WHEN 'recovery-v2-main-beneficiary' THEN 'main_beneficiary'
    WHEN 'recovery-v2-manual-beneficiary' THEN 'manual_beneficiary'
    WHEN 'recovery-v2-legacy-beneficiary' THEN 'legacy_beneficiary'
    ELSE 'prebegin_beneficiary'
  END,
  id
FROM public.beneficiaries
WHERE username IN (
  'recovery-v2-main-beneficiary',
  'recovery-v2-manual-beneficiary',
  'recovery-v2-legacy-beneficiary',
  'recovery-v2-prebegin-beneficiary'
);

SELECT extensions.ok(
  to_regprocedure(
    'public.prepare_sponsorship_checkout_intent(text,public.sponsorship_intent_source,text,bytea,uuid,bytea,smallint,smallint,public.sponsorship_subject_kind,uuid,public.project_type,public.sponsorship_payment_mode,text,bigint,bigint,public.payment_currency,numeric,timestamptz,text,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.prepare_sponsorship_checkout_intent_v2(uuid,bytea,public.sponsorship_method,text,text,text,public.sponsorship_intent_source,text,bytea,uuid,bytea,smallint,smallint,public.sponsorship_subject_kind,uuid,public.project_type,public.sponsorship_payment_mode,text,bigint,bigint,public.payment_currency,numeric,timestamptz,text,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.begin_sponsorship_payment_v2(uuid,uuid,uuid,public.sponsorship_method,text,text,bytea,smallint,jsonb,bytea,timestamptz,bytea,smallint,bytea,interval,jsonb,text,text,text,text)'
  ) IS NOT NULL,
  'v1 compatibility and additive v2 checkout RPCs coexist during caller cutover'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.recover_sponsorship_checkout_v2(bytea,uuid,public.sponsorship_method,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.recover_sponsorship_checkout_v2(bytea,uuid,public.sponsorship_method,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.claim_sponsorship_checkout_recoveries_v2(text,integer,integer,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'anon',
    'public.read_sponsorship_checkout_status_v2(bytea)',
    'EXECUTE'
  ),
  'v2 recovery work is service only while opaque browser status remains readable'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    WHERE relation.oid = 'public.sponsorship_checkout_operations'::regclass
  )
  AND (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    WHERE relation.oid =
      'public.sponsorship_checkout_recovery_states'::regclass
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_checkout_operations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_checkout_operations',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_checkout_operations',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_checkout_recovery_states',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_checkout_recovery_states',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.sponsorship_checkout_recovery_states',
    'UPDATE'
  )
  AND has_function_privilege(
    'service_role',
    'public.prepare_sponsorship_checkout_intent(text,public.sponsorship_intent_source,text,bytea,uuid,bytea,smallint,smallint,public.sponsorship_subject_kind,uuid,public.project_type,public.sponsorship_payment_mode,text,bigint,bigint,public.payment_currency,numeric,timestamptz,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.prepare_sponsorship_checkout_intent(text,public.sponsorship_intent_source,text,bytea,uuid,bytea,smallint,smallint,public.sponsorship_subject_kind,uuid,public.project_type,public.sponsorship_payment_mode,text,bigint,bigint,public.payment_currency,numeric,timestamptz,text,text,text)',
    'EXECUTE'
  ),
  'checkout state is RPC only and both compatibility generations remain service scoped'
);

SELECT extensions.ok(
  (
    SELECT gate.checkout_schema_version = 2
      AND gate.legacy_rpc_enabled
      AND gate.v2_rpc_enabled
      AND gate.caller_cutover_required
      AND gate.later_legacy_drain_migration_required
    FROM public.read_sponsorship_checkout_rpc_release_gate_v2() gate
  ),
  'the release gate advertises the explicit two phase v1 and v2 cutover'
);

SELECT extensions.ok(
  pg_get_function_result(
    'public.recover_sponsorship_checkout_v2(bytea,uuid,public.sponsorship_method,text,text)'::regprocedure
  ) NOT LIKE '%provider_object_id%'
  AND pg_get_function_result(
    'public.recover_sponsorship_checkout_v2(bytea,uuid,public.sponsorship_method,text,text)'::regprocedure
  ) NOT LIKE '%provider_request_ciphertext%'
  AND pg_get_function_result(
    'public.resume_sponsorship_checkout_operation_v2(bytea,uuid,public.sponsorship_method,text,text,text,text)'::regprocedure
  ) NOT LIKE '%provider_object_id%'
  AND pg_get_function_result(
    'public.list_sponsorship_checkout_manual_reviews_v2(timestamptz,uuid,integer,text,text)'::regprocedure
  ) NOT LIKE '%provider_object_id%',
  'browser recovery, foreground resume, and manual review outputs omit provider object IDs'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgrelid =
      'public.sponsorship_checkout_recovery_states'::regclass
      AND trigger_record.tgname =
        'sponsorship_checkout_recovery_states_audit'
      AND encode(trigger_record.tgargs, 'escape') LIKE '%lease_token%'
      AND encode(trigger_record.tgargs, 'escape') LIKE
        '%provider_request_template_claims%'
      AND encode(trigger_record.tgargs, 'escape') LIKE
        '%reconciliation_evidence_ciphertext%'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgrelid =
      'public.sponsorship_payment_attempts'::regclass
      AND trigger_record.tgname =
        'sponsorship_payment_attempts_recovery_terminal_invariant'
      AND (trigger_record.tgdeferrable AND trigger_record.tginitdeferred)
  ),
  'audit redaction and the deferred terminal chain invariant are installed'
);

SELECT extensions.ok(
  position(
    'v_intent.status = ''failed'''
    IN pg_get_functiondef(
      'public.begin_sponsorship_payment_v2_pre_contact_erasure(uuid,uuid,uuid,public.sponsorship_method,text,text,bytea,smallint,jsonb,bytea,timestamptz,bytea,smallint,bytea,interval,jsonb,text,text,text,text)'::regprocedure
    )
  ) > 0
  AND position(
    'v_intent.currency_quote_at < v_now - interval ''5 minutes'''
    IN pg_get_functiondef(
      'public.begin_sponsorship_payment_v2_pre_contact_erasure(uuid,uuid,uuid,public.sponsorship_method,text,text,bytea,smallint,jsonb,bytea,timestamptz,bytea,smallint,bytea,interval,jsonb,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'a retry cannot begin after its original five minute currency basis expires'
);

SELECT extensions.ok(
  position(
    'v_recovery.provider_request_expires_at <= clock_timestamp()'
    IN pg_get_functiondef(
      'public.attach_sponsorship_payment_provider_object_v2(uuid,text,text,smallint,bytea,timestamptz,uuid,text,text,text,text)'::regprocedure
    )
  ) > 0
  AND position(
    'least('
    IN pg_get_functiondef(
      'public.resume_sponsorship_checkout_operation_v2(bytea,uuid,public.sponsorship_method,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'first attachment and foreground leases cannot outlive sealed request validity'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.prepare_sponsorship_checkout_intent(
      target_idempotency_key =>
        'checkout-v2:97000000-0000-4000-8000-000000000099',
      target_source => 'primary_site',
      target_advocate_hostname => NULL,
      target_visitor_token_digest => NULL,
      target_auth_user_id => NULL,
      target_contact_email_hmac => decode(repeat('b9', 32), 'hex'),
      target_contact_email_normalization_version => 1::smallint,
      target_contact_email_hmac_key_version => 1::smallint,
      target_subject_kind => 'standard',
      target_beneficiary_id => (
        SELECT value FROM checkout_recovery_test_ids WHERE key = 'legacy_beneficiary'
      ),
      target_partnership_project => NULL,
      target_payment_mode => 'one_time',
      target_recurrence_interval => NULL,
      target_base_amount_usd_cents => 1600,
      target_charged_amount_minor => 1600,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_quote_at => clock_timestamp(),
      target_currency_rate_source => 'checkout-recovery-test'
    )
  $$,
  '23514',
  'Legacy checkout preparation cannot enter a v2 operation scope',
  'the v1 prepare wrapper cannot mint a v2 intent'
);

INSERT INTO checkout_recovery_test_times
VALUES ('main_currency_quote_at', clock_timestamp());

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'main_intent',
  pg_temp.prepare_recovery_checkout(
    '97000000-0000-4000-8000-000000000001'::uuid,
    decode(repeat('a1', 32), 'hex'),
    'b1',
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_beneficiary'),
    (SELECT value FROM checkout_recovery_test_times WHERE key = 'main_currency_quote_at')
  );

SELECT extensions.is(
  (
    SELECT recovered.recovery_status
    FROM public.recover_sponsorship_checkout_v2(
      decode(repeat('a1', 32), 'hex'),
      '97000000-0000-4000-8000-000000000001'::uuid,
      'STRIPE',
      'stripe_us',
      'stripe-checkout:97000000-0000-4000-8000-000000000001'
    ) recovered
  ),
  'intent_prepared',
  'an exact v2 receipt recovers before quote creation'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_sponsorship_payment_quote(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent'
      ),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_quote_idempotency_key => 'legacy-blocked-quote-v2-main'
    )
  $$,
  '23514',
  'Legacy payment quote cannot mutate a v2 checkout operation',
  'the v1 quote wrapper cannot mutate a v2 intent'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.begin_sponsorship_payment(
      target_sponsorship_intent_id => (
        SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent'
      ),
      target_payment_quote_id => gen_random_uuid(),
      target_provider => 'STRIPE',
      target_provider_account_scope => 'stripe_us',
      target_provider_idempotency_key =>
        'legacy-blocked:97000000-0000-4000-8000-000000000001',
      target_checkout_receipt_digest => decode(repeat('a1', 32), 'hex')
    )
  $$,
  '23514',
  'Legacy payment begin cannot mutate a v2 checkout operation',
  'the v1 begin wrapper cannot mutate a v2 intent'
);

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'main_quote',
  pg_temp.issue_recovery_quote(
    '97000000-0000-4000-8000-000000000001'::uuid,
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent')
  );

SELECT extensions.is(
  (
    SELECT recovered.recovery_status
    FROM public.recover_sponsorship_checkout_v2(
      decode(repeat('a1', 32), 'hex'),
      '97000000-0000-4000-8000-000000000001'::uuid,
      'STRIPE',
      'stripe_us',
      'stripe-checkout:97000000-0000-4000-8000-000000000001'
    ) recovered
  ),
  'quote_issued',
  'an exact v2 receipt recovers the operation scoped quote before begin'
);

INSERT INTO checkout_recovery_test_times
VALUES ('main_request_expires_at', clock_timestamp() + interval '61 minutes');

INSERT INTO checkout_recovery_test_bytes
VALUES
  ('main_request_fingerprint', decode(repeat('c1', 32), 'hex')),
  ('main_request_ciphertext', decode(repeat('d1', 64), 'hex'));

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'main_attempt',
  pg_temp.begin_recovery_checkout(
    '97000000-0000-4000-8000-000000000001'::uuid,
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent'),
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_quote'),
    decode(repeat('a1', 32), 'hex'),
    (SELECT value FROM checkout_recovery_test_bytes WHERE key = 'main_request_fingerprint'),
    (SELECT value FROM checkout_recovery_test_times WHERE key = 'main_request_expires_at'),
    (SELECT value FROM checkout_recovery_test_bytes WHERE key = 'main_request_ciphertext')
  );

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_recovery_states recovery
    JOIN public.sponsorship_checkout_reservations reservation
      ON reservation.payment_attempt_id = recovery.payment_attempt_id
    WHERE recovery.payment_attempt_id = (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
    )
      AND recovery.provider_request_template_claims ->
        'payment_attempt_id_placeholder' =
        '{"$creator_share":"server_payment_attempt_id","type":"uuid"}'::jsonb
      AND recovery.provider_request_template_claims ->>
        'payment_attempt_id_placeholder_path' = '/paymentAttemptId'
      AND recovery.provider_request_template_claims ->>
        'unresolved_placeholder_count' = '1'
      AND recovery.provider_request_ciphertext = (
        SELECT value FROM checkout_recovery_test_bytes
        WHERE key = 'main_request_ciphertext'
      )
      AND reservation.status = 'active'
      AND reservation.lease_expires_at = recovery.provider_request_expires_at
      AND reservation.lease_expires_at > clock_timestamp() + interval '30 minutes'
  ),
  'begin seals one typed attempt placeholder and reserves through the full provider request lifetime'
);

CREATE TEMP TABLE checkout_recovery_main_begin_replay
ON COMMIT DROP
AS
SELECT payment.*
FROM public.begin_sponsorship_payment_v2(
  target_checkout_operation_id =>
    '97000000-0000-4000-8000-000000000001'::uuid,
  target_sponsorship_intent_id => (
    SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key =>
    'stripe-checkout:97000000-0000-4000-8000-000000000001',
  target_checkout_receipt_digest => decode(repeat('a1', 32), 'hex'),
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_template_claims => pg_temp.provider_request_claims(
    '97000000-0000-4000-8000-000000000001'::uuid,
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent'),
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_quote'),
    (SELECT value FROM checkout_recovery_test_bytes WHERE key = 'main_request_fingerprint'),
    (SELECT value FROM checkout_recovery_test_times WHERE key = 'main_request_expires_at')
  ),
  target_provider_request_fingerprint => (
    SELECT value FROM checkout_recovery_test_bytes
    WHERE key = 'main_request_fingerprint'
  ),
  target_provider_request_expires_at => (
    SELECT value FROM checkout_recovery_test_times
    WHERE key = 'main_request_expires_at'
  ),
  target_provider_request_ciphertext => decode(repeat('d2', 64), 'hex'),
  target_provider_request_encryption_key_version => 7::smallint,
  target_provider_request_ciphertext_sha256 => extensions.digest(
    decode(repeat('d2', 64), 'hex'),
    'sha256'
  ),
  target_metadata => '{"test":"checkout_recovery_v2"}'::jsonb
) payment;

SELECT extensions.ok(
  (
    SELECT replay.replayed
      AND replay.payment_attempt_id = (
        SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
      )
    FROM checkout_recovery_main_begin_replay replay
  )
  AND EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.payment_attempt_id = (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
    )
      AND recovery.provider_request_ciphertext = decode(repeat('d1', 64), 'hex')
  ),
  'exact begin replay keeps the first randomized ciphertext and original attempt'
);

CREATE TEMP TABLE checkout_recovery_main_resume
ON COMMIT DROP
AS
SELECT resumed.*
FROM public.resume_sponsorship_checkout_operation_v2(
  decode(repeat('a1', 32), 'hex'),
  '97000000-0000-4000-8000-000000000001'::uuid,
  'STRIPE',
  'stripe_us',
  'stripe-checkout:97000000-0000-4000-8000-000000000001',
  'recovery-main-resume',
  'recovery-main-trace'
) resumed;

SELECT extensions.ok(
  (
    SELECT resumed.payment_attempt_id = (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
    )
      AND resumed.attempt_status = 'created'
      AND NOT resumed.provider_object_attached
      AND resumed.provider_request_ciphertext = decode(repeat('d1', 64), 'hex')
      AND resumed.foreground_lease_token IS NOT NULL
      AND resumed.foreground_lease_expires_at > clock_timestamp()
    FROM checkout_recovery_main_resume resumed
  ),
  'foreground resume returns exact sealed evidence under its first five minute lease'
);

CREATE TEMP TABLE checkout_recovery_main_attach
ON COMMIT DROP
AS
SELECT finalized.*
FROM public.finalize_sponsorship_checkout_recovery_v2(
  target_payment_attempt_id => (
    SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
  ),
  target_recovery_lease_token => (
    SELECT foreground_lease_token FROM checkout_recovery_main_resume
  ),
  target_resolution => 'provider_attached',
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_fingerprint => (
    SELECT value FROM checkout_recovery_test_bytes
    WHERE key = 'main_request_fingerprint'
  ),
  target_provider_request_expires_at => (
    SELECT value FROM checkout_recovery_test_times
    WHERE key = 'main_request_expires_at'
  ),
  target_provider_object_type => 'checkout_session',
  target_provider_object_id => 'cs_recovery_v2_main_001'
) finalized;

SELECT extensions.ok(
  (
    SELECT finalized.attempt_status = 'pending'
      AND finalized.intent_status = 'processing'
      AND finalized.recovery_status = 'available'
      AND finalized.provider_object_attached
    FROM checkout_recovery_main_attach finalized
  )
  AND EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_reservations reservation
    WHERE reservation.payment_attempt_id = (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
    )
      AND reservation.status = 'active'
      AND reservation.lease_expires_at = (
        SELECT value FROM checkout_recovery_test_times
        WHERE key = 'main_request_expires_at'
      )
  ),
  'lease fenced attachment preserves the reservation through request expiry'
);

SET LOCAL session_replication_role = replica;
UPDATE public.sponsorship_checkout_recovery_states
SET next_reconciliation_at = clock_timestamp()
WHERE payment_attempt_id = (
  SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE checkout_recovery_main_claim
ON COMMIT DROP
AS
SELECT claimed.*
FROM public.claim_sponsorship_checkout_recoveries_v2(
  'recovery-main-worker',
    1::smallint,
  300
) claimed;

INSERT INTO checkout_recovery_test_times
VALUES ('main_provider_reconciled_at', clock_timestamp());

CREATE TEMP TABLE checkout_recovery_main_terminal
ON COMMIT DROP
AS
SELECT finalized.*
FROM public.finalize_sponsorship_checkout_recovery_v2(
  target_payment_attempt_id => (
    SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
  ),
  target_recovery_lease_token => (
    SELECT recovery_lease_token FROM checkout_recovery_main_claim
  ),
  target_resolution => 'provider_terminal',
  target_provider_request_schema_version => 1::smallint,
  target_provider_request_fingerprint => (
    SELECT value FROM checkout_recovery_test_bytes
    WHERE key = 'main_request_fingerprint'
  ),
  target_provider_request_expires_at => (
    SELECT value FROM checkout_recovery_test_times
    WHERE key = 'main_request_expires_at'
  ),
  target_provider_terminal_status => 'expired',
  target_provider_reconciled_at => (
    SELECT value FROM checkout_recovery_test_times
    WHERE key = 'main_provider_reconciled_at'
  ),
  target_reconciliation_evidence_sha256 => decode(repeat('e1', 32), 'hex'),
  target_reconciliation_evidence_ciphertext => decode(repeat('e2', 64), 'hex'),
  target_reconciliation_evidence_encryption_key_version => 9::smallint,
  target_release_reason => 'provider confirmed the checkout is terminal'
) finalized;

SET CONSTRAINTS sponsorship_payment_attempts_recovery_terminal_invariant IMMEDIATE;
SET CONSTRAINTS sponsorship_payment_attempts_recovery_terminal_invariant DEFERRED;

SELECT extensions.ok(
  (
    SELECT finalized.attempt_status = 'expired'
      AND finalized.intent_status = 'failed'
      AND finalized.recovery_status = 'closed'
      AND NOT finalized.replayed
    FROM checkout_recovery_main_terminal finalized
  )
  AND EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_reservations reservation
    WHERE reservation.payment_attempt_id = (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
    )
      AND reservation.status = 'released'
  ),
  'explicit provider terminal evidence maps aggregate intent to failed and releases the reservation'
);

SELECT extensions.is(
  (
    SELECT finalized.replayed
    FROM public.finalize_sponsorship_checkout_recovery_v2(
      target_payment_attempt_id => (
        SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
      ),
      target_recovery_lease_token => (
        SELECT recovery_lease_token FROM checkout_recovery_main_claim
      ),
      target_resolution => 'provider_terminal',
      target_provider_request_schema_version => 1::smallint,
      target_provider_request_fingerprint => (
        SELECT value FROM checkout_recovery_test_bytes
        WHERE key = 'main_request_fingerprint'
      ),
      target_provider_request_expires_at => (
        SELECT value FROM checkout_recovery_test_times
        WHERE key = 'main_request_expires_at'
      ),
      target_provider_terminal_status => 'expired',
      target_provider_reconciled_at => (
        SELECT value FROM checkout_recovery_test_times
        WHERE key = 'main_provider_reconciled_at'
      ),
      target_reconciliation_evidence_sha256 => decode(repeat('e1', 32), 'hex'),
      target_reconciliation_evidence_ciphertext => decode(repeat('e3', 64), 'hex'),
      target_reconciliation_evidence_encryption_key_version => 9::smallint,
      target_release_reason => 'provider confirmed the checkout is terminal'
    ) finalized
  ),
  true,
  'terminal replay identity uses canonical plaintext evidence rather than randomized ciphertext'
);

SELECT extensions.is(
  (
    SELECT recovery.reconciliation_evidence_ciphertext
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.payment_attempt_id = (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
    )
  ),
  decode(repeat('e2', 64), 'hex'),
  'terminal replay retains the first encrypted forensic response'
);

DO $$
BEGIN
  PERFORM public.prepare_sponsorship_checkout_operation_v2(
    target_checkout_operation_id =>
      '97000000-0000-4000-8000-000000000002'::uuid,
    target_checkout_receipt_digest => decode(repeat('a2', 32), 'hex'),
    target_sponsorship_intent_id => (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent'
    ),
    target_provider => 'PAYPAL',
    target_provider_account_scope => 'paypal',
    target_provider_idempotency_key =>
      'paypal-checkout:97000000-0000-4000-8000-000000000002',
    target_predecessor_operation_id =>
      '97000000-0000-4000-8000-000000000001'::uuid,
    target_retry_after_payment_attempt_id => (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_attempt'
    )
  );
END;
$$;

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'paypal_quote',
  pg_temp.issue_recovery_quote(
    '97000000-0000-4000-8000-000000000002'::uuid,
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent')
  );

INSERT INTO checkout_recovery_test_times
VALUES ('paypal_request_expires_at', clock_timestamp() + interval '10 minutes');

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'paypal_attempt',
  pg_temp.begin_recovery_checkout(
    '97000000-0000-4000-8000-000000000002'::uuid,
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'main_intent'),
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'paypal_quote'),
    decode(repeat('a2', 32), 'hex'),
    decode(repeat('c2', 32), 'hex'),
    (SELECT value FROM checkout_recovery_test_times WHERE key = 'paypal_request_expires_at'),
    decode(repeat('d2', 64), 'hex')
  );

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_payment_attempts attempt
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = attempt.id
    JOIN public.sponsorship_checkout_reservations reservation
      ON reservation.payment_attempt_id = attempt.id
    WHERE attempt.id = (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'paypal_attempt'
    )
      AND attempt.attempt_number = 2
      AND attempt.provider = 'PAYPAL'
      AND attempt.status = 'created'
      AND attempt.metadata ->> 'checkout_boundary_version' = '2'
      AND attempt.metadata ->> 'checkout_operation_id' =
        '97000000-0000-4000-8000-000000000002'
      AND recovery.checkout_operation_id =
        '97000000-0000-4000-8000-000000000002'::uuid
      AND reservation.status = 'active'
      AND reservation.lease_expires_at = recovery.provider_request_expires_at
  ),
  'a failed intent can cross gateways only through its exact terminal successor operation'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.attach_sponsorship_payment_provider_object(
      (SELECT value FROM checkout_recovery_test_ids WHERE key = 'paypal_attempt'),
      'order',
      'paypal_order_v2_002',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL
    )
  $$,
  '23514',
  'Legacy provider attachment cannot mutate a v2 checkout operation',
  'the v1 attachment wrapper cannot mutate a v2 attempt'
);

INSERT INTO checkout_recovery_test_times
VALUES ('manual_currency_quote_at', clock_timestamp());

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'manual_intent',
  pg_temp.prepare_recovery_checkout(
    '97000000-0000-4000-8000-000000000003'::uuid,
    decode(repeat('a3', 32), 'hex'),
    'b3',
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_beneficiary'),
    (SELECT value FROM checkout_recovery_test_times WHERE key = 'manual_currency_quote_at')
  );

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'manual_quote',
  pg_temp.issue_recovery_quote(
    '97000000-0000-4000-8000-000000000003'::uuid,
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_intent')
  );

INSERT INTO checkout_recovery_test_times
VALUES ('manual_request_expires_at', clock_timestamp() + interval '61 minutes');

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'manual_attempt',
  pg_temp.begin_recovery_checkout(
    '97000000-0000-4000-8000-000000000003'::uuid,
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_intent'),
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_quote'),
    decode(repeat('a3', 32), 'hex'),
    decode(repeat('c3', 32), 'hex'),
    (SELECT value FROM checkout_recovery_test_times WHERE key = 'manual_request_expires_at'),
    decode(repeat('d3', 64), 'hex')
  );

DO $$
BEGIN
  PERFORM public.attach_sponsorship_payment_provider_object_v2(
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_attempt'),
    'checkout_session',
    'cs_recovery_v2_manual_003',
    1::smallint,
    decode(repeat('c3', 32), 'hex'),
    (
      SELECT value FROM checkout_recovery_test_times
      WHERE key = 'manual_request_expires_at'
    ),
    NULL
  );
END;
$$;

CREATE TEMP TABLE checkout_recovery_pending_resume
ON COMMIT DROP
AS
SELECT resumed.*
FROM public.resume_sponsorship_checkout_operation_v2(
  decode(repeat('a3', 32), 'hex'),
  '97000000-0000-4000-8000-000000000003'::uuid,
  'STRIPE',
  'stripe_us',
  'stripe-checkout:97000000-0000-4000-8000-000000000003'
) resumed;

SELECT extensions.ok(
  (
    SELECT resumed.attempt_status = 'pending'
      AND resumed.provider_object_attached
      AND resumed.provider_request_ciphertext = decode(repeat('d3', 64), 'hex')
      AND resumed.foreground_lease_token IS NOT NULL
    FROM checkout_recovery_pending_resume resumed
  ),
  'foreground resume can fence an attached but still open pending checkout'
);

SELECT extensions.is(
  (
    SELECT retried.recovery_status
    FROM public.retry_sponsorship_checkout_recovery_v2(
      (SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_attempt'),
      (SELECT foreground_lease_token FROM checkout_recovery_pending_resume),
      interval '15 seconds',
      'foreground_resume_handoff'
    ) retried
  ),
  'available',
  'an unresolved foreground pending resume returns to the durable worker queue'
);

SET LOCAL session_replication_role = replica;
UPDATE public.sponsorship_checkout_recovery_states
SET
  max_attempts = 2,
  next_reconciliation_at = clock_timestamp()
WHERE payment_attempt_id = (
  SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_attempt'
);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE checkout_recovery_manual_claim
ON COMMIT DROP
AS
SELECT claimed.*
FROM public.claim_sponsorship_checkout_recoveries_v2(
  'recovery-manual-worker',
  1,
  300
) claimed;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.resume_sponsorship_checkout_operation_v2(
      decode(repeat('a3', 32), 'hex'),
      '97000000-0000-4000-8000-000000000003'::uuid,
      'STRIPE',
      'stripe_us',
      'stripe-checkout:97000000-0000-4000-8000-000000000003'
    )
  $$,
  '55P03',
  'Foreground checkout resume cannot race prior recovery work or a terminal chain',
  'foreground resume cannot race a prior worker claim'
);

SELECT extensions.is(
  (
    SELECT retried.recovery_status
    FROM public.retry_sponsorship_checkout_recovery_v2(
      (SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_attempt'),
      (SELECT recovery_lease_token FROM checkout_recovery_manual_claim),
      interval '15 seconds',
      'transient_provider_error'
    ) retried
  ),
  'manual_review',
  'exhausted provider creation recovery becomes explicit manual review'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.list_sponsorship_checkout_manual_reviews_v2() review
    WHERE review.payment_attempt_id = (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'manual_attempt'
    )
      AND review.recovery_stage = 'reconcile_pending'
      AND review.active_reservation_retained
  ),
  'manual review remains discoverable while retaining its fixed beneficiary reservation'
);

INSERT INTO checkout_recovery_test_times
VALUES ('prebegin_currency_quote_at', clock_timestamp());

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'prebegin_intent',
  pg_temp.prepare_recovery_checkout(
    '97000000-0000-4000-8000-000000000004'::uuid,
    decode(repeat('a4', 32), 'hex'),
    'b4',
    (SELECT value FROM checkout_recovery_test_ids WHERE key = 'prebegin_beneficiary'),
    (SELECT value FROM checkout_recovery_test_times WHERE key = 'prebegin_currency_quote_at')
  );

DO $$
BEGIN
  PERFORM public.prepare_sponsorship_checkout_operation_v2(
    target_checkout_operation_id =>
      '97000000-0000-4000-8000-000000000005'::uuid,
    target_checkout_receipt_digest => decode(repeat('a5', 32), 'hex'),
    target_sponsorship_intent_id => (
      SELECT value FROM checkout_recovery_test_ids WHERE key = 'prebegin_intent'
    ),
    target_provider => 'STRIPE',
    target_provider_account_scope => 'stripe_us',
    target_provider_idempotency_key =>
      'stripe-checkout:97000000-0000-4000-8000-000000000005',
    target_predecessor_operation_id =>
      '97000000-0000-4000-8000-000000000004'::uuid,
    target_retry_after_payment_attempt_id => NULL
  );
END;
$$;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.issue_sponsorship_payment_quote_v2(
      '97000000-0000-4000-8000-000000000004'::uuid,
      (SELECT value FROM checkout_recovery_test_ids WHERE key = 'prebegin_intent'),
      'quote:97000000-0000-4000-8000-000000000004'
    )
  $$,
  '23514',
  'V2 payment quote requires the latest unbegun retryable operation',
  'an unbegun predecessor cannot issue a quote after exact supersession'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_operations operation
    WHERE operation.operation_id =
      '97000000-0000-4000-8000-000000000005'::uuid
      AND operation.operation_sequence = 2
      AND operation.predecessor_operation_id =
        '97000000-0000-4000-8000-000000000004'::uuid
      AND operation.retry_after_payment_attempt_id IS NULL
  ),
  'one unbegun operation may be superseded without fabricating an attempt'
);

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'legacy_intent',
  prepared.resolved_sponsorship_intent_id
FROM public.prepare_sponsorship_checkout_intent(
  target_idempotency_key => 'legacy-checkout-recovery-v1-001',
  target_source => 'primary_site',
  target_advocate_hostname => NULL,
  target_visitor_token_digest => NULL,
  target_auth_user_id => NULL,
  target_contact_email_hmac => decode(repeat('b6', 32), 'hex'),
  target_contact_email_normalization_version => 1::smallint,
  target_contact_email_hmac_key_version => 1::smallint,
  target_subject_kind => 'standard',
  target_beneficiary_id => (
    SELECT value FROM checkout_recovery_test_ids WHERE key = 'legacy_beneficiary'
  ),
  target_partnership_project => NULL,
  target_payment_mode => 'one_time',
  target_recurrence_interval => NULL,
  target_base_amount_usd_cents => 1600,
  target_charged_amount_minor => 1600,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_quote_at => clock_timestamp(),
  target_currency_rate_source => 'checkout-recovery-test'
) prepared;

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'legacy_quote',
  quote.payment_quote_id
FROM public.issue_sponsorship_payment_quote(
  target_sponsorship_intent_id => (
    SELECT value FROM checkout_recovery_test_ids WHERE key = 'legacy_intent'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_quote_idempotency_key => 'legacy-recovery-quote-v1-001'
) quote;

INSERT INTO checkout_recovery_test_ids (key, value)
SELECT
  'legacy_attempt',
  payment.payment_attempt_id
FROM public.begin_sponsorship_payment(
  target_sponsorship_intent_id => (
    SELECT value FROM checkout_recovery_test_ids WHERE key = 'legacy_intent'
  ),
  target_payment_quote_id => (
    SELECT value FROM checkout_recovery_test_ids WHERE key = 'legacy_quote'
  ),
  target_provider => 'STRIPE',
  target_provider_account_scope => 'stripe_us',
  target_provider_idempotency_key => 'legacy-recovery-begin-v1-001',
  target_checkout_receipt_digest => decode(repeat('a6', 32), 'hex')
) payment;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.attach_sponsorship_payment_provider_object_v2(
      (SELECT value FROM checkout_recovery_test_ids WHERE key = 'legacy_attempt'),
      'checkout_session',
      'cs_legacy_v1_attempt',
      1::smallint,
      decode(repeat('c6', 32), 'hex'),
      clock_timestamp() + interval '1 hour'
    )
  $$,
  '23514',
  'Payment attempt has no exact checkout recovery state',
  'the v2 attachment path cannot mutate a v1 attempt'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.sponsorship_checkout_operations
    SET provider_idempotency_key =
      'changed:97000000-0000-4000-8000-000000000003'
    WHERE operation_id =
      '97000000-0000-4000-8000-000000000003'::uuid
  $$,
  '42501',
  'Sponsorship checkout operations are append only',
  'checkout operation lineage remains append only'
);

SELECT * FROM extensions.finish();

ROLLBACK;
