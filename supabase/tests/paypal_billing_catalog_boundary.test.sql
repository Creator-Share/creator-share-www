BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

UPDATE public.payment_provider_accounts
SET
  status = 'active',
  environment = 'live'
WHERE provider = 'PAYPAL'
  AND scope = 'paypal';

INSERT INTO public.beneficiaries (
  name,
  username,
  budget_goal,
  status
)
VALUES (
  'PayPal Catalog Child',
  'paypal-catalog-child',
  -1,
  'New'
);

CREATE TEMP TABLE paypal_catalog_test_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  text_value text
) ON COMMIT DROP;

INSERT INTO paypal_catalog_test_context (key, uuid_value)
SELECT 'beneficiary', id
FROM public.beneficiaries
WHERE username = 'paypal-catalog-child';

SELECT extensions.ok(
  to_regclass('public.paypal_billing_catalog_entries') IS NOT NULL
  AND to_regprocedure(
    'public.claim_paypal_billing_catalog_entry(public.sponsorship_subject_kind,uuid,text,text,bigint,bigint,public.payment_currency,numeric,text,interval,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.start_paypal_billing_catalog_provider_request(uuid,uuid,public.paypal_billing_catalog_request_phase,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.record_paypal_billing_catalog_product(uuid,uuid,text,interval,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.activate_paypal_billing_catalog_entry(uuid,uuid,text,text,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.fail_paypal_billing_catalog_entry(uuid,uuid,public.paypal_billing_catalog_request_phase,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.quarantine_paypal_billing_catalog_entry(uuid,uuid,public.paypal_billing_catalog_manual_review_code,bytea,text,text,text,text)'
  ) IS NOT NULL,
  'PayPal billing catalog table and lease fenced lifecycle RPCs exist'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_paypal_billing_catalog_entry(public.sponsorship_subject_kind,uuid,text,text,bigint,bigint,public.payment_currency,numeric,text,interval,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_paypal_billing_catalog_entry(public.sponsorship_subject_kind,uuid,text,text,bigint,bigint,public.payment_currency,numeric,text,interval,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.start_paypal_billing_catalog_provider_request(uuid,uuid,public.paypal_billing_catalog_request_phase,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.start_paypal_billing_catalog_provider_request(uuid,uuid,public.paypal_billing_catalog_request_phase,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.quarantine_paypal_billing_catalog_entry(uuid,uuid,public.paypal_billing_catalog_manual_review_code,bytea,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.quarantine_paypal_billing_catalog_entry(uuid,uuid,public.paypal_billing_catalog_manual_review_code,bytea,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.paypal_billing_catalog_entries',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'only payment service RPCs can mutate the contact-free catalog'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'paypal_billing_catalog_entries'
      AND column_name IN (
        'email',
        'customer_email',
        'contact_email',
        'sponsor_identity_id',
        'auth_user_id'
      )
  ),
  'PayPal billing catalog stores no sponsor contact or identity'
);

CREATE TEMP TABLE first_paypal_catalog_claim AS
SELECT claim.*
FROM public.claim_paypal_billing_catalog_entry(
  target_subject_kind => 'standard',
  target_beneficiary_id => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'beneficiary'
  ),
  target_product_name => 'Monthly Sponsorship for PayPal Catalog Child',
  target_recurrence_interval => 'month',
  target_base_amount_usd_cents => 3333,
  target_charged_amount_minor => 2466,
  target_charged_currency => 'GBP',
  target_conversion_rate => 0.74,
  target_currency_rate_source => 'paypal-catalog-test',
  context_request_id => 'paypal-catalog-create'
) claim;

INSERT INTO paypal_catalog_test_context (key, uuid_value)
SELECT 'catalog_entry', catalog_entry_id
FROM first_paypal_catalog_claim;

INSERT INTO paypal_catalog_test_context (key, uuid_value)
SELECT 'catalog_lease', provisioning_lease_token
FROM first_paypal_catalog_claim;

SELECT extensions.ok(
  (
    SELECT catalog_status = 'provisioning'
      AND provisioning_lease_token IS NOT NULL
      AND provisioning_required
      AND NOT replayed
      AND product_request_id = catalog_entry_id::text
      AND product_request_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND plan_request_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND product_request_id <> plan_request_id
      AND provider_product_id IS NULL
      AND provider_plan_id IS NULL
    FROM first_paypal_catalog_claim
  ),
  'first exact catalog claim creates one UUID-idempotent provisioning lease'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.claim_paypal_billing_catalog_entry(
        'standard',
        %L::uuid,
        'Monthly Sponsorship for PayPal Catalog Child',
        'month',
        3333,
        2466,
        'GBP',
        0.74,
        'paypal-catalog-test'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'beneficiary'
    )
  ),
  '55P03',
  'PayPal billing catalog entry is already provisioning',
  'an active catalog lease fences concurrent provisioning'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.start_paypal_billing_catalog_provider_request(
        %L::uuid,
        %L::uuid,
        'product'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_entry'
    ),
    gen_random_uuid()
  ),
  '55P03',
  'PayPal provider request lease is no longer owned',
  'a foreign lease cannot authorize a PayPal provider call'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.record_paypal_billing_catalog_product(
        %L::uuid,
        %L::uuid,
        'PROD-ABCDEFGHIJKLMNOPQ'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_entry'
    ),
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_lease'
    )
  ),
  '23514',
  'PayPal product response has no durable request marker',
  'a provider product cannot settle before a durable pre-call marker'
);

CREATE TEMP TABLE first_product_request_start AS
SELECT started.*
FROM public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_entry'
  ),
  target_provisioning_lease_token => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_lease'
  ),
  target_request_phase => 'product',
  context_request_id => 'paypal-catalog-product-start'
) started;

SELECT extensions.ok(
  (
    SELECT catalog_status = 'provisioning'
      AND request_phase = 'product'
      AND provider_request_id = catalog_entry_id::text
      AND request_started_at IS NOT NULL
      AND request_last_started_at = request_started_at
      AND request_reuse_expires_at = request_started_at + interval '48 hours'
      AND request_attempt_count = 1
      AND provider_call_allowed
      AND NOT replayed
      AND manual_review_code IS NULL
    FROM first_product_request_start
  ),
  'the lease fenced marker durably authorizes the first product call'
);

SELECT extensions.ok(
  (
    SELECT retried.provider_request_id = first_start.provider_request_id
      AND retried.request_started_at = first_start.request_started_at
      AND retried.request_last_started_at >= first_start.request_last_started_at
      AND retried.request_reuse_expires_at = first_start.request_reuse_expires_at
      AND retried.request_attempt_count = 2
      AND retried.provider_call_allowed
      AND retried.replayed
    FROM public.start_paypal_billing_catalog_provider_request(
      target_catalog_entry_id => (
        SELECT uuid_value
        FROM paypal_catalog_test_context
        WHERE key = 'catalog_entry'
      ),
      target_provisioning_lease_token => (
        SELECT uuid_value
        FROM paypal_catalog_test_context
        WHERE key = 'catalog_lease'
      ),
      target_request_phase => 'product'
    ) retried
    CROSS JOIN first_product_request_start first_start
  ),
  'retries within 48 hours reuse the same request ID and first-start anchor'
);

SELECT pg_catalog.set_config(
  'app.paypal_billing_catalog.lifecycle_operation',
  '',
  true
);

SELECT extensions.throws_ok(
  format(
    $sql$
      UPDATE public.paypal_billing_catalog_entries
      SET product_request_attempt_count = product_request_attempt_count + 1
      WHERE id = %L::uuid
    $sql$,
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_entry'
    )
  ),
  '42501',
  'PayPal billing catalog updates require a narrow lifecycle',
  'provider request markers cannot be advanced outside the narrow lifecycle'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.record_paypal_billing_catalog_product(
        %L::uuid,
        %L::uuid,
        'PROD-ABCDEFGHIJKLMNOPQ'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_entry'
    ),
    gen_random_uuid()
  ),
  '55P03',
  'PayPal catalog product lease is no longer owned',
  'a foreign lease cannot record a PayPal product'
);

CREATE TEMP TABLE first_product_settlement AS
SELECT settled.*
FROM public.record_paypal_billing_catalog_product(
  target_catalog_entry_id => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_entry'
  ),
  target_provisioning_lease_token => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_lease'
  ),
  target_provider_product_id => 'PROD-ABCDEFGHIJKLMNOPQ',
  context_request_id => 'paypal-catalog-product'
) settled;

SELECT extensions.ok(
  (
    SELECT provider_product_id = 'PROD-ABCDEFGHIJKLMNOPQ'
      AND provisioning_lease_expires_at > clock_timestamp()
      AND NOT replayed
    FROM first_product_settlement
  ),
  'owned product settlement records the exact provider product and extends the lease'
);

SELECT extensions.ok(
  (
    SELECT replayed
      AND provider_product_id = 'PROD-ABCDEFGHIJKLMNOPQ'
    FROM public.record_paypal_billing_catalog_product(
      target_catalog_entry_id => (
        SELECT uuid_value
        FROM paypal_catalog_test_context
        WHERE key = 'catalog_entry'
      ),
      target_provisioning_lease_token => (
        SELECT uuid_value
        FROM paypal_catalog_test_context
        WHERE key = 'catalog_lease'
      ),
      target_provider_product_id => 'PROD-ABCDEFGHIJKLMNOPQ'
    )
  ),
  'exact product settlement replays idempotently'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.record_paypal_billing_catalog_product(
        %L::uuid,
        %L::uuid,
        'PROD-ZYXWVUTSRQPONMLKJ'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_entry'
    ),
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_lease'
    )
  ),
  '23505',
  'PayPal catalog product was replayed with another ID',
  'conflicting product settlement fails closed'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.activate_paypal_billing_catalog_entry(
        %L::uuid,
        %L::uuid,
        'PROD-ABCDEFGHIJKLMNOPQ',
        'P-ABCDEFGHIJKLMNOPQRSTUVWX'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_entry'
    ),
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_lease'
    )
  ),
  '23514',
  'PayPal plan response has no durable request marker',
  'a provider plan cannot activate before a durable pre-call marker'
);

CREATE TEMP TABLE first_plan_request_start AS
SELECT started.*
FROM public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_entry'
  ),
  target_provisioning_lease_token => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_lease'
  ),
  target_request_phase => 'plan',
  context_request_id => 'paypal-catalog-plan-start'
) started;

SELECT extensions.ok(
  (
    SELECT request_phase = 'plan'
      AND provider_request_id = (
        SELECT plan_request_id
        FROM first_paypal_catalog_claim
      )
      AND request_attempt_count = 1
      AND request_reuse_expires_at = request_started_at + interval '48 hours'
      AND provider_call_allowed
      AND NOT replayed
    FROM first_plan_request_start
  ),
  'the lease fenced marker durably authorizes the first plan call'
);

CREATE TEMP TABLE first_plan_activation AS
SELECT activated.*
FROM public.activate_paypal_billing_catalog_entry(
  target_catalog_entry_id => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_entry'
  ),
  target_provisioning_lease_token => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_lease'
  ),
  target_provider_product_id => 'PROD-ABCDEFGHIJKLMNOPQ',
  target_provider_plan_id => 'P-ABCDEFGHIJKLMNOPQRSTUVWX',
  context_request_id => 'paypal-catalog-activate'
) activated;

SELECT extensions.ok(
  (
    SELECT catalog_status = 'active'
      AND provider_product_id = 'PROD-ABCDEFGHIJKLMNOPQ'
      AND provider_plan_id = 'P-ABCDEFGHIJKLMNOPQRSTUVWX'
      AND activated_at IS NOT NULL
      AND NOT replayed
    FROM first_plan_activation
  )
  AND (
    SELECT status = 'active'
      AND provisioning_lease_token IS NULL
      AND provisioning_lease_expires_at IS NULL
      AND provider_plan_id = 'P-ABCDEFGHIJKLMNOPQRSTUVWX'
    FROM public.paypal_billing_catalog_entries
    WHERE id = (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_entry'
    )
  ),
  'plan activation atomically closes the lease and freezes exact provider IDs'
);

SELECT extensions.ok(
  (
    SELECT catalog_status = 'active'
      AND provisioning_lease_token IS NULL
      AND NOT provisioning_required
      AND replayed
      AND provider_plan_id = 'P-ABCDEFGHIJKLMNOPQRSTUVWX'
    FROM public.claim_paypal_billing_catalog_entry(
      target_subject_kind => 'standard',
      target_beneficiary_id => (
        SELECT uuid_value
        FROM paypal_catalog_test_context
        WHERE key = 'beneficiary'
      ),
      target_product_name => 'Monthly Sponsorship for PayPal Catalog Child',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 3333,
      target_charged_amount_minor => 2466,
      target_charged_currency => 'GBP',
      target_conversion_rate => 0.74,
      target_currency_rate_source => 'paypal-catalog-test'
    )
  ),
  'later exact claims reuse the active plan without a new provider call'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      UPDATE public.paypal_billing_catalog_entries
      SET product_name = 'Tampered plan'
      WHERE id = %L::uuid
    $sql$,
    (
      SELECT uuid_value
      FROM paypal_catalog_test_context
      WHERE key = 'catalog_entry'
    )
  ),
  '23514',
  'PayPal billing catalog key does not match its terms',
  'active catalog financial and display terms cannot be edited'
);

CREATE TEMP TABLE failed_paypal_catalog_claim AS
SELECT claim.*
FROM public.claim_paypal_billing_catalog_entry(
  target_subject_kind => 'blind',
  target_beneficiary_id => NULL,
  target_product_name => 'Yearly Blind Sponsorship',
  target_recurrence_interval => 'year',
  target_base_amount_usd_cents => 39996,
  target_charged_amount_minor => 39996,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_rate_source => 'paypal-catalog-test'
) claim;

CREATE TEMP TABLE failed_product_request_start AS
SELECT started.*
FROM failed_paypal_catalog_claim claimed
CROSS JOIN LATERAL public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_request_phase => 'product',
  context_request_id => 'paypal-catalog-rejected-start'
) started;

SELECT failed.*
FROM failed_paypal_catalog_claim claimed
CROSS JOIN LATERAL public.fail_paypal_billing_catalog_entry(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_request_phase => 'product',
  context_request_id => 'paypal-catalog-fail'
) failed;

SELECT extensions.ok(
  (
    SELECT status = 'failed'
      AND last_error_code = 'provider_rejected'
      AND failed_at IS NOT NULL
      AND provisioning_lease_token IS NULL
      AND product_request_started_at IS NULL
      AND product_request_last_started_at IS NULL
      AND product_request_attempt_count = 0
    FROM public.paypal_billing_catalog_entries
    WHERE id = (
      SELECT catalog_entry_id
      FROM failed_paypal_catalog_claim
    )
  ),
  'known provider rejection clears only its side-effect-free request marker'
);

CREATE TEMP TABLE retried_paypal_catalog_claim AS
SELECT claim.*
FROM public.claim_paypal_billing_catalog_entry(
  target_subject_kind => 'blind',
  target_beneficiary_id => NULL,
  target_product_name => 'Yearly Blind Sponsorship',
  target_recurrence_interval => 'year',
  target_base_amount_usd_cents => 39996,
  target_charged_amount_minor => 39996,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_rate_source => 'paypal-catalog-test'
) claim;

SELECT extensions.ok(
  (
    SELECT catalog_entry_id = (
        SELECT prior.catalog_entry_id
        FROM failed_paypal_catalog_claim prior
      )
      AND catalog_status = 'provisioning'
      AND provisioning_attempt_count = 2
      AND provisioning_lease_token IS NOT NULL
      AND provisioning_required
      AND replayed
      AND product_request_id = (
        SELECT provider_request_id
        FROM failed_product_request_start
      )
    FROM retried_paypal_catalog_claim
  ),
  'known rejection reclaims the same catalog entry and provider request ID'
);

SELECT extensions.ok(
  (
    SELECT started.provider_request_id = prior.provider_request_id
      AND started.request_attempt_count = 1
      AND started.provider_call_allowed
      AND NOT started.replayed
    FROM retried_paypal_catalog_claim claimed
    CROSS JOIN LATERAL public.start_paypal_billing_catalog_provider_request(
      target_catalog_entry_id => claimed.catalog_entry_id,
      target_provisioning_lease_token => claimed.provisioning_lease_token,
      target_request_phase => 'product'
    ) started
    CROSS JOIN failed_product_request_start prior
  ),
  'known rejection permits a fresh marker with the same safe request ID'
);

CREATE TEMP TABLE ambiguous_product_claim AS
SELECT claim.*
FROM public.claim_paypal_billing_catalog_entry(
  target_subject_kind => 'blind',
  target_beneficiary_id => NULL,
  target_product_name => 'Monthly Ambiguous Product Sponsorship',
  target_recurrence_interval => 'month',
  target_base_amount_usd_cents => 3333,
  target_charged_amount_minor => 3333,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_rate_source => 'paypal-catalog-test'
) claim;

CREATE TEMP TABLE ambiguous_product_start AS
SELECT started.*
FROM ambiguous_product_claim claimed
CROSS JOIN LATERAL public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_request_phase => 'product'
) started;

SELECT pg_catalog.set_config(
  'app.paypal_billing_catalog.lifecycle_operation',
  'claim',
  true
);

UPDATE public.paypal_billing_catalog_entries entry
SET provisioning_lease_expires_at = clock_timestamp() - interval '1 second'
WHERE entry.id = (
  SELECT catalog_entry_id
  FROM ambiguous_product_claim
);

SELECT pg_catalog.set_config(
  'app.paypal_billing_catalog.lifecycle_operation',
  '',
  true
);

CREATE TEMP TABLE ambiguous_product_quarantine AS
SELECT quarantined.*
FROM ambiguous_product_claim claimed
CROSS JOIN LATERAL public.quarantine_paypal_billing_catalog_entry(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_manual_review_code => 'product_request_ambiguous',
  target_evidence_sha256 => extensions.digest(
    pg_catalog.convert_to('ambiguous-product-response', 'UTF8'),
    'sha256'
  ),
  context_request_id => 'paypal-catalog-ambiguous-product'
) quarantined;

SELECT extensions.ok(
  (
    SELECT catalog_status = 'manual_review'
      AND provider_product_id IS NULL
      AND provider_plan_id IS NULL
      AND manual_review_code = 'product_request_ambiguous'
      AND manual_review_at IS NOT NULL
      AND NOT replayed
    FROM ambiguous_product_quarantine
  )
  AND (
    SELECT status = 'manual_review'
      AND provisioning_lease_token IS NULL
      AND octet_length(manual_review_evidence_sha256) = 32
    FROM public.paypal_billing_catalog_entries entry
    WHERE entry.id = (
      SELECT catalog_entry_id
      FROM ambiguous_product_claim
    )
  ),
  'the current lease can immediately quarantine ambiguity even just after expiry'
);

SELECT extensions.ok(
  (
    SELECT replayed_quarantine.replayed
      AND replayed_quarantine.manual_review_code =
        'product_request_ambiguous'
    FROM ambiguous_product_claim claimed
    CROSS JOIN LATERAL public.quarantine_paypal_billing_catalog_entry(
      target_catalog_entry_id => claimed.catalog_entry_id,
      target_provisioning_lease_token => claimed.provisioning_lease_token,
      target_manual_review_code => 'product_request_ambiguous',
      target_evidence_sha256 => extensions.digest(
        pg_catalog.convert_to('ambiguous-product-response', 'UTF8'),
        'sha256'
      )
    ) replayed_quarantine
  ),
  'exact quarantine evidence replays without mutating forensic state'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT *
      FROM public.quarantine_paypal_billing_catalog_entry(
        %L::uuid,
        %L::uuid,
        'product_request_ambiguous',
        extensions.digest(
          pg_catalog.convert_to('conflicting-evidence', 'UTF8'),
          'sha256'
        )
      )
    $sql$,
    (
      SELECT catalog_entry_id
      FROM ambiguous_product_claim
    ),
    (
      SELECT provisioning_lease_token
      FROM ambiguous_product_claim
    )
  ),
  '23505',
  'PayPal catalog quarantine replay conflicts with prior evidence',
  'conflicting quarantine evidence fails closed'
);

CREATE TEMP TABLE plan_recording_claim AS
SELECT claim.*
FROM public.claim_paypal_billing_catalog_entry(
  target_subject_kind => 'blind',
  target_beneficiary_id => NULL,
  target_product_name => 'Monthly Plan Recording Sponsorship',
  target_recurrence_interval => 'month',
  target_base_amount_usd_cents => 4444,
  target_charged_amount_minor => 4444,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_rate_source => 'paypal-catalog-test'
) claim;

SELECT started.*
FROM plan_recording_claim claimed
CROSS JOIN LATERAL public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_request_phase => 'product'
) started;

SELECT recorded.*
FROM plan_recording_claim claimed
CROSS JOIN LATERAL public.record_paypal_billing_catalog_product(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_provider_product_id => 'PROD-BCDEFGHIJKLMNOPQR'
) recorded;

SELECT started.*
FROM plan_recording_claim claimed
CROSS JOIN LATERAL public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_request_phase => 'plan'
) started;

CREATE TEMP TABLE plan_recording_quarantine AS
SELECT quarantined.*
FROM plan_recording_claim claimed
CROSS JOIN LATERAL public.quarantine_paypal_billing_catalog_entry(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_manual_review_code => 'plan_response_recording_failed',
  target_evidence_sha256 => extensions.digest(
    pg_catalog.convert_to('valid-plan-response-not-recorded', 'UTF8'),
    'sha256'
  ),
  target_observed_provider_product_id => 'PROD-BCDEFGHIJKLMNOPQR',
  target_observed_provider_plan_id => 'P-BCDEFGHIJKLMNOPQRSTUVWXY',
  context_request_id => 'paypal-catalog-plan-recording-failed'
) quarantined;

SELECT extensions.ok(
  (
    SELECT catalog_status = 'manual_review'
      AND provider_product_id = 'PROD-BCDEFGHIJKLMNOPQR'
      AND provider_plan_id = 'P-BCDEFGHIJKLMNOPQRSTUVWXY'
      AND manual_review_code = 'plan_response_recording_failed'
      AND NOT replayed
    FROM plan_recording_quarantine
  ),
  'a valid plan response that could not activate is preserved and quarantined'
);

CREATE TEMP TABLE active_drift_quarantine AS
SELECT quarantined.*
FROM public.quarantine_paypal_billing_catalog_entry(
  target_catalog_entry_id => (
    SELECT uuid_value
    FROM paypal_catalog_test_context
    WHERE key = 'catalog_entry'
  ),
  target_provisioning_lease_token => NULL,
  target_manual_review_code => 'active_plan_drift',
  target_evidence_sha256 => extensions.digest(
    pg_catalog.convert_to('active-plan-drift-evidence', 'UTF8'),
    'sha256'
  ),
  target_observed_provider_product_id => 'PROD-ZYXWVUTSRQPONMLKJ',
  target_observed_provider_plan_id => 'P-ZYXWVUTSRQPONMLKJIHGFEDC',
  context_request_id => 'paypal-catalog-active-drift'
) quarantined;

SELECT extensions.ok(
  (
    SELECT catalog_status = 'manual_review'
      AND manual_review_code = 'active_plan_drift'
      AND provider_product_id = 'PROD-ABCDEFGHIJKLMNOPQ'
      AND provider_plan_id = 'P-ABCDEFGHIJKLMNOPQRSTUVWX'
      AND NOT replayed
    FROM active_drift_quarantine
  ),
  'active plan drift quarantines while preserving canonical provider IDs'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.schema_name = 'public'
      AND event.table_name = 'paypal_billing_catalog_entries'
      AND event.tool = 'quarantine_paypal_billing_catalog_entry'
      AND event.request_id = 'paypal-catalog-active-drift'
      AND event.metadata ->> 'operation' = 'quarantine'
      AND event.metadata ->> 'prior_status' = 'active'
      AND event.metadata ->> 'manual_review_code' = 'active_plan_drift'
      AND event.metadata ->> 'observed_provider_product_id' =
        'PROD-ZYXWVUTSRQPONMLKJ'
      AND event.metadata ->> 'observed_provider_plan_id' =
        'P-ZYXWVUTSRQPONMLKJIHGFEDC'
      AND length(event.metadata ->> 'evidence_sha256') = 64
  ),
  'quarantine audit metadata retains bounded forensic drift evidence'
);

CREATE TEMP TABLE aged_product_claim AS
SELECT claim.*
FROM public.claim_paypal_billing_catalog_entry(
  target_subject_kind => 'blind',
  target_beneficiary_id => NULL,
  target_product_name => 'Monthly Aged Request Sponsorship',
  target_recurrence_interval => 'month',
  target_base_amount_usd_cents => 5555,
  target_charged_amount_minor => 5555,
  target_charged_currency => 'USD',
  target_conversion_rate => 1,
  target_currency_rate_source => 'paypal-catalog-test'
) claim;

SELECT started.*
FROM aged_product_claim claimed
CROSS JOIN LATERAL public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_request_phase => 'product'
) started;

SELECT pg_catalog.set_config(
  'app.paypal_billing_catalog.lifecycle_operation',
  'start_product_request',
  true
);

UPDATE public.paypal_billing_catalog_entries entry
SET
  product_request_started_at = clock_timestamp() - interval '49 hours',
  product_request_last_started_at = clock_timestamp() - interval '49 hours'
WHERE entry.id = (
  SELECT catalog_entry_id
  FROM aged_product_claim
);

SELECT pg_catalog.set_config(
  'app.paypal_billing_catalog.lifecycle_operation',
  '',
  true
);

CREATE TEMP TABLE aged_product_result AS
SELECT started.*
FROM aged_product_claim claimed
CROSS JOIN LATERAL public.start_paypal_billing_catalog_provider_request(
  target_catalog_entry_id => claimed.catalog_entry_id,
  target_provisioning_lease_token => claimed.provisioning_lease_token,
  target_request_phase => 'product',
  context_request_id => 'paypal-catalog-aged-request'
) started;

SELECT extensions.ok(
  (
    SELECT catalog_status = 'manual_review'
      AND provider_request_id IS NULL
      AND NOT provider_call_allowed
      AND replayed
      AND manual_review_code = 'product_request_window_expired'
      AND request_reuse_expires_at < clock_timestamp()
    FROM aged_product_result
  )
  AND (
    SELECT catalog_status = 'manual_review'
      AND provisioning_lease_token IS NULL
      AND NOT provisioning_required
      AND replayed
      AND manual_review_code = 'product_request_window_expired'
    FROM public.claim_paypal_billing_catalog_entry(
      target_subject_kind => 'blind',
      target_beneficiary_id => NULL,
      target_product_name => 'Monthly Aged Request Sponsorship',
      target_recurrence_interval => 'month',
      target_base_amount_usd_cents => 5555,
      target_charged_amount_minor => 5555,
      target_charged_currency => 'USD',
      target_conversion_rate => 1,
      target_currency_rate_source => 'paypal-catalog-test'
    )
  ),
  'an unresolved request older than 48 hours enters manual review without a call token'
);

SELECT extensions.ok(
  (
    SELECT count(*) >= 12
    FROM audit.audit_events
    WHERE schema_name = 'public'
      AND table_name = 'paypal_billing_catalog_entries'
      AND system_actor = 'paypal_billing_catalog_service'
      AND tool IN (
        'claim_paypal_billing_catalog_entry',
        'start_paypal_billing_catalog_provider_request',
        'record_paypal_billing_catalog_product',
        'activate_paypal_billing_catalog_entry',
        'fail_paypal_billing_catalog_entry',
        'quarantine_paypal_billing_catalog_entry'
      )
  ),
  'request starts, settlement, activation, rejection, quarantine, and retry are audited'
);

SELECT * FROM extensions.finish();

ROLLBACK;
