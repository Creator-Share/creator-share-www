BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

CREATE TEMP TABLE legacy_claim_test_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  time_value timestamptz
) ON COMMIT DROP;

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
    '92000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'legacy-stripe@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Legacy","last_name":"Stripe"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '92000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'legacy-paypal@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Legacy","last_name":"PayPal"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '92000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'legacy-conflict@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{"first_name":"Legacy","last_name":"Conflict"}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );

INSERT INTO public.subscriptions (
  id,
  user_id,
  beneficiary_id,
  status,
  amount,
  interval,
  customer_id,
  sponsorship_method,
  stripe_subscription_id,
  payment_region,
  charged_amount,
  charged_currency,
  conversion_rate,
  email
)
VALUES
  (
    '93000000-0000-4000-8000-000000000001'::uuid,
    NULL,
    NULL,
    'complete',
    2500,
    'month',
    'cus_legacy_stripe_1',
    'STRIPE',
    'sub_legacy_stripe_1',
    'us',
    2500,
    'USD',
    1,
    'legacy-stripe@example.test'
  ),
  (
    '93000000-0000-4000-8000-000000000002'::uuid,
    NULL,
    NULL,
    'complete',
    3200,
    'month',
    'PAYER-LEGACY-PAYPAL-1',
    'PAYPAL',
    'I-LEGACY-PAYPAL-1',
    'us',
    3200,
    'USD',
    1,
    NULL
  ),
  (
    '93000000-0000-4000-8000-000000000003'::uuid,
    NULL,
    NULL,
    'complete',
    1800,
    'month',
    'cus_legacy_email_conflict',
    'STRIPE',
    'sub_legacy_email_conflict',
    'us',
    1800,
    'USD',
    1,
    'legacy-stripe@example.test'
  ),
  (
    '93000000-0000-4000-8000-000000000004'::uuid,
    NULL,
    NULL,
    'complete',
    1900,
    'month',
    'cus_legacy_incomplete',
    'STRIPE',
    'sub_legacy_incomplete',
    'us',
    1900,
    'USD',
    1,
    'legacy-stripe@example.test'
  ),
  (
    '93000000-0000-4000-8000-000000000005'::uuid,
    NULL,
    NULL,
    'complete',
    2100,
    'month',
    'cus_legacy_unavailable',
    'STRIPE',
    'sub_legacy_unavailable',
    'us',
    2100,
    'USD',
    1,
    'legacy-stripe@example.test'
  ),
  (
    '93000000-0000-4000-8000-000000000006'::uuid,
    '92000000-0000-4000-8000-000000000003'::uuid,
    NULL,
    'complete',
    2200,
    'month',
    'cus_legacy_account_conflict',
    'STRIPE',
    'sub_legacy_account_conflict',
    'us',
    2200,
    'USD',
    1,
    'legacy-stripe@example.test'
  );

INSERT INTO public.transaction_ledger (
  id,
  user_id,
  subscription_id,
  credit,
  charged_amount,
  charged_currency,
  conversion_rate,
  customer_email,
  customer_id,
  reference,
  tx_action,
  subscription_type
)
VALUES
  (
    '94000000-0000-4000-8000-000000000001'::uuid,
    NULL,
    '93000000-0000-4000-8000-000000000001'::uuid,
    2500,
    2500,
    'USD',
    1,
    'legacy-stripe@example.test',
    'cus_legacy_stripe_1',
    'in_legacy_stripe_1',
    'SPONSORSHIP',
    'subscription'
  ),
  (
    '94000000-0000-4000-8000-000000000002'::uuid,
    NULL,
    NULL,
    3200,
    3200,
    'USD',
    1,
    'legacy-paypal@example.test',
    'PAYER-LEGACY-PAYPAL-1',
    'I-LEGACY-PAYPAL-1',
    'SPONSORSHIP',
    'subscription'
  );

INSERT INTO legacy_claim_test_context (key, time_value)
VALUES ('observed_at', clock_timestamp());

SELECT extensions.ok(
  (
    SELECT bool_and(relation.relrowsecurity)
    FROM pg_class relation
    WHERE relation.oid IN (
      'public.legacy_subscription_reconciliation_runs'::regclass,
      'public.legacy_subscription_reconciliation_evidence'::regclass,
      'public.legacy_subscription_ownership_links'::regclass,
      'public.legacy_subscription_ownership_quarantines'::regclass
    )
  ),
  'all legacy ownership evidence tables enforce row level security'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'public.legacy_subscription_reconciliation_runs',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.legacy_subscription_reconciliation_evidence',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.legacy_subscription_ownership_links',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.legacy_subscription_reconciliation_runs',
    'SELECT'
  ),
  'workers and browser clients cannot directly mutate or inspect ownership evidence'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.begin_legacy_subscription_reconciliation(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.record_legacy_subscription_email_evidence(uuid,public.legacy_subscription_evidence_source,uuid,text,public.legacy_subscription_evidence_outcome,bytea,smallint,smallint,public.legacy_subscription_source_failure,bytea,timestamp with time zone,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.finalize_legacy_subscription_reconciliation(uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.finalize_legacy_subscription_reconciliation(uuid,text,text)',
    'EXECUTE'
  ),
  'the backfill worker receives only narrow reconciliation RPCs'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.claim_legacy_subscriptions_for_verified_email(bytea,smallint,smallint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.claim_legacy_subscriptions_for_verified_email(bytea,smallint,smallint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.claim_legacy_subscriptions_for_verified_email(bytea,smallint,smallint,text,text)',
    'EXECUTE'
  ),
  'only an authenticated account can attach resolved legacy ownership'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name IN (
        'legacy_subscription_reconciliation_runs',
        'legacy_subscription_reconciliation_evidence',
        'legacy_subscription_ownership_links',
        'legacy_subscription_ownership_quarantines'
      )
      AND column_info.data_type IN ('text', 'character varying')
      AND column_info.column_name LIKE '%email%'
  ),
  0,
  'long lived ownership tables have no plaintext email column'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'stripe_run', run.id
FROM public.begin_legacy_subscription_reconciliation(
  '93000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000001'::uuid,
  'legacy-stripe-begin',
  'legacy-test-trace'
) run;

SELECT extensions.is(
  (
    SELECT run.id
    FROM public.begin_legacy_subscription_reconciliation(
      '93000000-0000-4000-8000-000000000001'::uuid,
      '95000000-0000-4000-8000-000000000001'::uuid
    ) run
  ),
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run'),
  'begin reconciliation is idempotent for one subscription and batch'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'stripe_subscription_evidence', evidence.id
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run'),
  'subscription_record'::public.legacy_subscription_evidence_source,
  '93000000-0000-4000-8000-000000000001'::uuid,
  NULL::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('a1', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
) evidence;

SELECT extensions.is(
  (
    SELECT evidence.id
    FROM public.record_legacy_subscription_email_evidence(
      (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run'),
      'subscription_record'::public.legacy_subscription_evidence_source,
      '93000000-0000-4000-8000-000000000001'::uuid,
      NULL::text,
      'email_observed'::public.legacy_subscription_evidence_outcome,
      decode(repeat('11', 32), 'hex'),
      1::smallint,
      1::smallint,
      NULL::public.legacy_subscription_source_failure,
      decode(repeat('a1', 32), 'hex'),
      (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
    ) evidence
  ),
  (
    SELECT uuid_value
    FROM legacy_claim_test_context
    WHERE key = 'stripe_subscription_evidence'
  ),
  'identical source evidence replay returns the original immutable row'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.record_legacy_subscription_email_evidence(
      (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run'),
      'subscription_record'::public.legacy_subscription_evidence_source,
      '93000000-0000-4000-8000-000000000001'::uuid,
      NULL::text,
      'email_observed'::public.legacy_subscription_evidence_outcome,
      decode(repeat('22', 32), 'hex'),
      1::smallint,
      1::smallint,
      NULL::public.legacy_subscription_source_failure,
      decode(repeat('a2', 32), 'hex'),
      (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
    )
  $$,
  '23505',
  'Evidence source was already recorded with different facts',
  'a worker cannot rewrite one source within a scan batch'
);

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run'),
  'transaction_ledger_record'::public.legacy_subscription_evidence_source,
  '94000000-0000-4000-8000-000000000001'::uuid,
  NULL::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('a3', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run'),
  'provider_api'::public.legacy_subscription_evidence_source,
  NULL::uuid,
  'sub_legacy_stripe_1'::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('a4', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.finalize_legacy_subscription_reconciliation(
      (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run')
    )
  ),
  'resolved',
  'matching Stripe database and provider evidence resolves one email digest'
);

SELECT extensions.is(
  (
    SELECT distinct_email_count
    FROM public.legacy_subscription_reconciliation_runs
    WHERE id = (
      SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run'
    )
  ),
  1,
  'a resolved manifest memorializes exactly one canonical email digest'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'stripe_collecting_retry', run.id
FROM public.begin_legacy_subscription_reconciliation(
  '93000000-0000-4000-8000-000000000001'::uuid,
  '95000000-0000-4000-8000-000000000007'::uuid,
  'legacy-stripe-retry',
  'legacy-test-trace'
) run;

SELECT count(*)
FROM public.issue_sponsor_account_email_verification(
  target_auth_user_id => '92000000-0000-4000-8000-000000000001'::uuid,
  target_email_hmac => decode(repeat('11', 32), 'hex')
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '92000000-0000-4000-8000-000000000001',
  true
);

CREATE TEMP TABLE stripe_claim_result ON COMMIT DROP AS
SELECT *
FROM public.claim_legacy_subscriptions_for_verified_email(
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  'legacy-stripe-claim',
  'legacy-test-trace'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'stripe_identity', sponsor_identity_id
FROM stripe_claim_result;

SELECT extensions.is(
  (SELECT attached_subscription_count FROM stripe_claim_result),
  1,
  'a fresh authenticated email proof attaches the resolved Stripe subscription'
);

SELECT extensions.ok(
  (
    SELECT
      subscription.user_id = '92000000-0000-4000-8000-000000000001'::uuid
      AND subscription.sponsor_identity_id = (
        SELECT uuid_value
        FROM legacy_claim_test_context
        WHERE key = 'stripe_identity'
      )
    FROM public.subscriptions subscription
    WHERE subscription.id = '93000000-0000-4000-8000-000000000001'::uuid
  ),
  'runtime subscription ownership points to the stable verified account identity'
);

SELECT extensions.ok(
  (
    SELECT
      ledger.user_id = '92000000-0000-4000-8000-000000000001'::uuid
      AND ledger.sponsor_identity_id = (
        SELECT uuid_value
        FROM legacy_claim_test_context
        WHERE key = 'stripe_identity'
      )
    FROM public.transaction_ledger ledger
    WHERE ledger.id = '94000000-0000-4000-8000-000000000001'::uuid
  ),
  'the safely correlated historical ledger follows the subscription ownership'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.legacy_subscription_ownership_links ownership
    JOIN public.sponsor_account_email_verifications proof
      ON proof.id = ownership.email_verification_id
    WHERE ownership.subscription_id =
      '93000000-0000-4000-8000-000000000001'::uuid
      AND proof.status = 'consumed'
      AND ownership.claimed_email_hmac = decode(repeat('11', 32), 'hex')
  ),
  'append-only ownership evidence references the consumed email proof, not plaintext'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.legacy_subscription_ownership_links ownership
    WHERE ownership.subscription_id =
      '93000000-0000-4000-8000-000000000001'::uuid
      AND ownership.reconciliation_run_id = (
        SELECT uuid_value
        FROM legacy_claim_test_context
        WHERE key = 'stripe_run'
      )
  )
  AND EXISTS (
    SELECT 1
    FROM public.legacy_subscription_reconciliation_runs run
    WHERE run.id = (
      SELECT uuid_value
      FROM legacy_claim_test_context
      WHERE key = 'stripe_collecting_retry'
    )
      AND run.status = 'collecting'
  ),
  'a collecting retry does not suppress the latest finalized ownership evidence'
);

SELECT extensions.is(
  (
    SELECT attached_subscription_count
    FROM public.claim_legacy_subscriptions_for_verified_email(
      decode(repeat('11', 32), 'hex')
    )
  ),
  0,
  'the authenticated legacy claim is safely replayable'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT count(*)
FROM public.issue_sponsor_account_email_verification(
  target_auth_user_id => '92000000-0000-4000-8000-000000000002'::uuid,
  target_email_hmac => decode(repeat('33', 32), 'hex')
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '92000000-0000-4000-8000-000000000002',
  true
);

CREATE TEMP TABLE paypal_initial_claim_result ON COMMIT DROP AS
SELECT *
FROM public.claim_legacy_subscriptions_for_verified_email(
  decode(repeat('33', 32), 'hex')
);

SELECT extensions.is(
  (SELECT attached_subscription_count FROM paypal_initial_claim_result),
  0,
  'an account may verify before its historical provider scan completes'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'paypal_identity', sponsor_identity_id
FROM paypal_initial_claim_result;

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'paypal_run', run.id
FROM public.begin_legacy_subscription_reconciliation(
  '93000000-0000-4000-8000-000000000002'::uuid,
  '95000000-0000-4000-8000-000000000002'::uuid
) run;

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'paypal_run'),
  'subscription_record'::public.legacy_subscription_evidence_source,
  '93000000-0000-4000-8000-000000000002'::uuid,
  NULL::text,
  'email_absent'::public.legacy_subscription_evidence_outcome,
  NULL::bytea,
  NULL::smallint,
  NULL::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('b1', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'paypal_run'),
  'transaction_ledger_record'::public.legacy_subscription_evidence_source,
  '94000000-0000-4000-8000-000000000002'::uuid,
  NULL::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('33', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('b2', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'paypal_run'),
  'provider_api'::public.legacy_subscription_evidence_source,
  NULL::uuid,
  'I-LEGACY-PAYPAL-1'::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('33', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('b3', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.finalize_legacy_subscription_reconciliation(
      (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'paypal_run')
    )
  ),
  'resolved',
  'PayPal provider and safely correlated unlinked ledger evidence resolve'
);

SELECT extensions.ok(
  (
    SELECT
      subscription.user_id = '92000000-0000-4000-8000-000000000002'::uuid
      AND subscription.sponsor_identity_id = (
        SELECT uuid_value
        FROM legacy_claim_test_context
        WHERE key = 'paypal_identity'
      )
    FROM public.subscriptions subscription
    WHERE subscription.id = '93000000-0000-4000-8000-000000000002'::uuid
  ),
  'a later PayPal scan automatically attaches to the previously verified stable identity'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'email_conflict_run', run.id
FROM public.begin_legacy_subscription_reconciliation(
  '93000000-0000-4000-8000-000000000003'::uuid,
  '95000000-0000-4000-8000-000000000003'::uuid
) run;

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'email_conflict_run'),
  'subscription_record'::public.legacy_subscription_evidence_source,
  '93000000-0000-4000-8000-000000000003'::uuid,
  NULL::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('c1', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'email_conflict_run'),
  'provider_api'::public.legacy_subscription_evidence_source,
  NULL::uuid,
  'sub_legacy_email_conflict'::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('44', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('c2', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT extensions.is(
  (
    SELECT quarantine_reason::text
    FROM public.finalize_legacy_subscription_reconciliation(
      (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'email_conflict_run')
    )
  ),
  'email_conflict',
  'conflicting local and provider email digests are quarantined instead of guessed'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'incomplete_run', run.id
FROM public.begin_legacy_subscription_reconciliation(
  '93000000-0000-4000-8000-000000000004'::uuid,
  '95000000-0000-4000-8000-000000000004'::uuid
) run;

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'incomplete_run'),
  'subscription_record'::public.legacy_subscription_evidence_source,
  '93000000-0000-4000-8000-000000000004'::uuid,
  NULL::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('d1', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT extensions.is(
  (
    SELECT quarantine_reason::text
    FROM public.finalize_legacy_subscription_reconciliation(
      (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'incomplete_run')
    )
  ),
  'incomplete_manifest',
  'a partial worker scan cannot become ownership evidence'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'unavailable_run', run.id
FROM public.begin_legacy_subscription_reconciliation(
  '93000000-0000-4000-8000-000000000005'::uuid,
  '95000000-0000-4000-8000-000000000005'::uuid
) run;

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'unavailable_run'),
  'subscription_record'::public.legacy_subscription_evidence_source,
  '93000000-0000-4000-8000-000000000005'::uuid,
  NULL::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('e1', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'unavailable_run'),
  'provider_api'::public.legacy_subscription_evidence_source,
  NULL::uuid,
  'sub_legacy_unavailable'::text,
  'source_unavailable'::public.legacy_subscription_evidence_outcome,
  NULL::bytea,
  NULL::smallint,
  NULL::smallint,
  'provider_error'::public.legacy_subscription_source_failure,
  decode(repeat('e2', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT extensions.is(
  (
    SELECT quarantine_reason::text
    FROM public.finalize_legacy_subscription_reconciliation(
      (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'unavailable_run')
    )
  ),
  'source_unavailable',
  'provider lookup failure remains quarantined for a later scan batch'
);

INSERT INTO legacy_claim_test_context (key, uuid_value)
SELECT 'account_conflict_run', run.id
FROM public.begin_legacy_subscription_reconciliation(
  '93000000-0000-4000-8000-000000000006'::uuid,
  '95000000-0000-4000-8000-000000000006'::uuid
) run;

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'account_conflict_run'),
  'subscription_record'::public.legacy_subscription_evidence_source,
  '93000000-0000-4000-8000-000000000006'::uuid,
  NULL::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('f1', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT count(*)
FROM public.record_legacy_subscription_email_evidence(
  (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'account_conflict_run'),
  'provider_api'::public.legacy_subscription_evidence_source,
  NULL::uuid,
  'sub_legacy_account_conflict'::text,
  'email_observed'::public.legacy_subscription_evidence_outcome,
  decode(repeat('11', 32), 'hex'),
  1::smallint,
  1::smallint,
  NULL::public.legacy_subscription_source_failure,
  decode(repeat('f2', 32), 'hex'),
  (SELECT time_value FROM legacy_claim_test_context WHERE key = 'observed_at')
);

SELECT extensions.is(
  (
    SELECT status::text
    FROM public.finalize_legacy_subscription_reconciliation(
      (SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'account_conflict_run')
    )
  ),
  'resolved',
  'email evidence may resolve before account ownership is adjudicated'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.legacy_subscription_ownership_quarantines quarantine
    WHERE quarantine.subscription_id =
      '93000000-0000-4000-8000-000000000006'::uuid
      AND quarantine.reason = 'account_conflict'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.legacy_subscription_ownership_links ownership
    WHERE ownership.subscription_id =
      '93000000-0000-4000-8000-000000000006'::uuid
  ),
  'a pre-owned subscription is quarantined instead of reassigned'
);

UPDATE auth.users
SET
  email = 'changed-email@example.test',
  updated_at = clock_timestamp()
WHERE id = '92000000-0000-4000-8000-000000000001'::uuid;

SELECT count(*)
FROM public.issue_sponsor_account_email_verification(
  target_auth_user_id => '92000000-0000-4000-8000-000000000001'::uuid,
  target_email_hmac => decode(repeat('55', 32), 'hex')
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '92000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.claim_legacy_subscriptions_for_verified_email(
      decode(repeat('55', 32), 'hex')
    )
  $$,
  '23514',
  'Changing an account email does not claim another email history',
  'an account email change does not automatically claim another historical identity'
);

SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  $$
    UPDATE public.legacy_subscription_reconciliation_evidence
    SET evidence_payload_sha256 = decode(repeat('99', 32), 'hex')
    WHERE reconciliation_run_id = (
      SELECT uuid_value FROM legacy_claim_test_context WHERE key = 'stripe_run'
    )
  $$,
  '42501',
  'Legacy subscription evidence is append only',
  'finalized contact provenance cannot be rewritten'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.tool = 'begin_legacy_subscription_reconciliation'
      AND event.table_name = 'legacy_subscription_reconciliation_runs'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.tool = 'record_legacy_subscription_email_evidence'
      AND event.table_name = 'legacy_subscription_reconciliation_evidence'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.tool IN (
      'finalize_legacy_subscription_reconciliation',
      'claim_legacy_subscriptions_for_verified_email'
    )
      AND event.table_name IN (
        'legacy_subscription_ownership_links',
        'legacy_subscription_ownership_quarantines'
      )
  ),
  'reconciliation, verified attachment, and quarantine mutations are fully audited'
);

SELECT * FROM extensions.finish();

ROLLBACK;
