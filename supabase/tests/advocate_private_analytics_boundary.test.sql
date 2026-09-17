BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND function_definition.provolatile = 's'
      AND function_definition.prorettype = 'jsonb'::regtype
      AND function_definition.proargnames = ARRAY['target_advocate_id']::text[]
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.get_advocate_analytics_snapshot(uuid)'::regprocedure
  ),
  'the analytics snapshot is one fixed stable JSON security definer boundary'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
      AND NOT has_function_privilege(
        'anon',
        function_definition.oid,
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        function_definition.oid,
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'service_role',
        function_definition.oid,
        'EXECUTE'
      )
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'private.set_attribution_analytics_eligibility()'::regprocedure
  ),
  'the analytics eligibility trigger function is hardened and not directly callable'
);

SELECT extensions.ok(
  (
    SELECT trigger_definition.tgenabled = 'O'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgfoid =
        'private.set_attribution_analytics_eligibility()'::regprocedure
      AND trigger_definition.tgname > 'sponsorship_attributions_validate'
      AND pg_get_triggerdef(trigger_definition.oid) LIKE '%BEFORE INSERT%'
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.sponsorship_attributions'::regclass
      AND trigger_definition.tgname =
        'sponsorship_attributions_zz_analytics_eligibility'
  ),
  'immutable analytics eligibility runs after canonical attribution validation'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_advocate_analytics_snapshot(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_advocate_analytics_snapshot(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.get_advocate_analytics_snapshot(uuid)',
    'EXECUTE'
  ),
  'only authenticated advocate sessions can execute the private analytics reader'
);

SELECT extensions.ok(
  coalesce(
    (
      SELECT function_definition.prosecdef
        AND function_definition.provolatile = 'v'
        AND function_definition.prorettype = 'bigint'::regtype
        AND function_definition.pronargs = 0
        AND coalesce(
          array_to_string(function_definition.proconfig, ','),
          ''
        ) = 'search_path=""'
      FROM pg_proc function_definition
      WHERE function_definition.oid = to_regprocedure(
        'private.backfill_attribution_analytics_eligibility()'
      )
    ),
    false
  ),
  'the historical eligibility backfill is one fixed privileged boundary'
);

SELECT extensions.ok(
  coalesce(
    (
      SELECT bool_and(
        NOT has_function_privilege(
          runtime_role.role_name,
          protected_function.function_oid,
          'EXECUTE'
        )
      )
      FROM (
        VALUES
          ('anon'),
          ('authenticated'),
          ('service_role')
      ) AS runtime_role(role_name)
      CROSS JOIN (
        VALUES
          (
            to_regprocedure(
              'private.resolve_attribution_analytics_exclusion(uuid,uuid,timestamptz)'
            )
          ),
          (
            to_regprocedure(
              'private.backfill_attribution_analytics_eligibility()'
            )
          )
      ) AS protected_function(function_oid)
      WHERE protected_function.function_oid IS NOT NULL
      HAVING count(*) = 6
    ),
    false
  ),
  'no runtime API role can call the eligibility resolver or historical backfill'
);

SELECT extensions.ok(
  coalesce(
    (
      SELECT attribute.attnotnull
        AND default_definition.oid IS NULL
      FROM pg_attribute attribute
      LEFT JOIN pg_attrdef default_definition
        ON default_definition.adrelid = attribute.attrelid
       AND default_definition.adnum = attribute.attnum
      WHERE attribute.attrelid =
        'public.sponsorship_attributions'::regclass
        AND attribute.attname = 'analytics_eligible'
        AND NOT attribute.attisdropped
    ),
    false
  ),
  'analytics eligibility is required and cannot silently inherit a default'
);

SELECT extensions.ok(
  coalesce(
    (
      SELECT constraint_definition.convalidated
      FROM pg_constraint constraint_definition
      WHERE constraint_definition.conrelid =
        'public.sponsorship_attributions'::regclass
        AND constraint_definition.conname =
          'sponsorship_attributions_analytics_eligibility_check'
        AND constraint_definition.contype = 'c'
    ),
    false
  ),
  'the attribution analytics eligibility consistency check is validated'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated',
    'public.sponsorship_intents',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.sponsorship_attributions',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.sponsorship_financial_movements',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.sponsor_identities',
    'SELECT'
  ),
  'analytics viewers have no direct grants on private attribution and identity facts'
);

CREATE TEMP TABLE analytics_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE analytics_test_times (
  key text PRIMARY KEY,
  value timestamp with time zone NOT NULL
) ON COMMIT DROP;

INSERT INTO analytics_test_times (key, value)
VALUES (
  'as_of',
  date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
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
  updated_at,
  is_anonymous
)
VALUES
  (
    '96000000-0000-4000-8000-000000000101'::uuid,
    'authenticated',
    'authenticated',
    'analytics-main-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Main","last_name":"Owner"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '96000000-0000-4000-8000-000000000102'::uuid,
    'authenticated',
    'authenticated',
    'analytics-viewer@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Ada","last_name":"Analyst"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '96000000-0000-4000-8000-000000000103'::uuid,
    'authenticated',
    'authenticated',
    'analytics-brand-editor@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Bryn","last_name":"Brand"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '96000000-0000-4000-8000-000000000104'::uuid,
    'authenticated',
    'authenticated',
    'analytics-suppression-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Sam","last_name":"Suppression"}'::jsonb,
    now(),
    now(),
    false
  ),
  (
    '96000000-0000-4000-8000-000000000105'::uuid,
    'authenticated',
    'authenticated',
    'analytics-contact-owner@example.test',
    now(),
    '{}'::jsonb,
    '{"first_name":"Casey","last_name":"Contact"}'::jsonb,
    now(),
    now(),
    false
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

WITH created AS (
  SELECT public.create_advocate_portal(
    '96000000-0000-4000-8000-000000000101'::uuid,
    'analytics-main',
    'Analytics Main',
    'Create the complete analytics fixture tenant',
    'creator',
    'request-analytics-main'
  ) AS id
)
INSERT INTO analytics_test_ids (key, value)
SELECT 'main_advocate', id FROM created;

WITH created AS (
  SELECT public.create_advocate_portal(
    '96000000-0000-4000-8000-000000000104'::uuid,
    'analytics-suppression',
    'Analytics Suppression',
    'Create the family suppression fixture tenant',
    'creator',
    'request-analytics-suppression'
  ) AS id
)
INSERT INTO analytics_test_ids (key, value)
SELECT 'suppress_advocate', id FROM created;

WITH created AS (
  SELECT public.create_advocate_portal(
    '96000000-0000-4000-8000-000000000105'::uuid,
    'analytics-contact',
    'Analytics Contact',
    'Create the repeated contact suppression fixture tenant',
    'creator',
    'request-analytics-contact'
  ) AS id
)
INSERT INTO analytics_test_ids (key, value)
SELECT 'contact_advocate', id FROM created;

SELECT audit.set_actor_context(
  'system',
  NULL,
  NULL,
  'advocate-private-analytics-test',
  'database-test',
  'request-analytics-memberships',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'Prepare private analytics authorization fixtures',
  jsonb_build_object('operation', 'prepare_fixture')
);

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    context.value,
    CASE context.key
      WHEN 'main_advocate' THEN 'analytics-main.creatorshare.com'
      WHEN 'suppress_advocate' THEN 'analytics-suppression.creatorshare.com'
      ELSE 'analytics-contact.creatorshare.com'
    END,
    true
  FROM analytics_test_ids context
  WHERE context.key IN (
    'main_advocate',
    'suppress_advocate',
    'contact_advocate'
  )
  RETURNING id, advocate_id
)
INSERT INTO analytics_test_ids (key, value)
SELECT
  replace(context.key, '_advocate', '_domain'),
  inserted.id
FROM inserted
JOIN analytics_test_ids context ON context.value = inserted.advocate_id;

SELECT set_config('request.jwt.claim.sub', '', true);

WITH inserted AS (
  INSERT INTO public.advocate_memberships (
    advocate_id,
    user_id,
    status
  )
  SELECT
    advocate.value,
    fixture.user_id,
    'active'::public.advocate_membership_status
  FROM analytics_test_ids advocate
  JOIN (
    VALUES
      (
        'main_advocate',
        'analytics_viewer_membership',
        '96000000-0000-4000-8000-000000000102'::uuid
      ),
      (
        'main_advocate',
        'brand_editor_membership',
        '96000000-0000-4000-8000-000000000103'::uuid
      )
  ) fixture(advocate_key, membership_key, user_id)
    ON fixture.advocate_key = advocate.key
  RETURNING id, user_id
)
INSERT INTO analytics_test_ids (key, value)
SELECT
  CASE inserted.user_id
    WHEN '96000000-0000-4000-8000-000000000102'::uuid
      THEN 'analytics_viewer_membership'
    ELSE 'brand_editor_membership'
  END,
  inserted.id
FROM inserted;

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
SELECT
  advocate.value,
  membership.value,
  role_definition.id,
  '96000000-0000-4000-8000-000000000101'::uuid
FROM analytics_test_ids advocate
JOIN analytics_test_ids membership
  ON membership.key IN (
    'analytics_viewer_membership',
    'brand_editor_membership'
  )
JOIN public.advocate_roles role_definition
  ON role_definition.key = CASE membership.key
    WHEN 'analytics_viewer_membership' THEN 'analytics_viewer'
    ELSE 'brand_editor'
  END
WHERE advocate.key = 'main_advocate';

CREATE TEMP TABLE analytics_fixture_intents (
  label text PRIMARY KEY,
  advocate_key text NOT NULL,
  segment_key text NOT NULL,
  exposure_lag interval,
  charged_currency public.payment_currency NOT NULL,
  contact_group text NOT NULL,
  payment_mode public.sponsorship_payment_mode NOT NULL,
  recurrence_interval text,
  initial_usd_cents bigint NOT NULL,
  initial_minor bigint NOT NULL,
  conversion_at timestamp with time zone NOT NULL,
  payment_occurred_at timestamp with time zone NOT NULL,
  sponsor_auth_user_id uuid,
  identity_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL DEFAULT gen_random_uuid(),
  initial_movement_id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),
  gateway_event_id uuid NOT NULL DEFAULT gen_random_uuid()
) ON COMMIT DROP;

INSERT INTO analytics_fixture_intents (
  label,
  advocate_key,
  segment_key,
  exposure_lag,
  charged_currency,
  contact_group,
  payment_mode,
  recurrence_interval,
  initial_usd_cents,
  initial_minor,
  conversion_at,
  payment_occurred_at,
  sponsor_auth_user_id
)
SELECT
  format('main_direct_%s', fixture_number),
  'main_advocate',
  'direct',
  NULL,
  'USD'::public.payment_currency,
  format('main-direct-contact-%s', fixture_number),
  'recurring'::public.sponsorship_payment_mode,
  CASE WHEN fixture_number >= 10 THEN 'year' ELSE 'month' END,
  CASE fixture_number
    WHEN 1 THEN 1000
    WHEN 2 THEN 2400
    WHEN 3 THEN 300
    WHEN 4 THEN 400
    WHEN 5 THEN 500
    ELSE fixture_number * 100
  END,
  CASE fixture_number
    WHEN 1 THEN 1000
    WHEN 2 THEN 2400
    WHEN 3 THEN 300
    WHEN 4 THEN 400
    WHEN 5 THEN 500
    ELSE fixture_number * 100
  END,
  cutoff.value - interval '40 days',
  cutoff.value - interval '20 days',
  gen_random_uuid()
FROM generate_series(1, 14) fixture_number
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO analytics_fixture_intents (
  label,
  advocate_key,
  segment_key,
  exposure_lag,
  charged_currency,
  contact_group,
  payment_mode,
  recurrence_interval,
  initial_usd_cents,
  initial_minor,
  conversion_at,
  payment_occurred_at
)
SELECT
  'main_unverified_complement',
  'main_advocate',
  'direct',
  NULL,
  'USD'::public.payment_currency,
  'main-direct-unverified-complement',
  'one_time'::public.sponsorship_payment_mode,
  NULL,
  100,
  100,
  cutoff.value - interval '15 days',
  cutoff.value - interval '10 days'
FROM analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO analytics_fixture_intents (
  label,
  advocate_key,
  segment_key,
  exposure_lag,
  charged_currency,
  contact_group,
  payment_mode,
  recurrence_interval,
  initial_usd_cents,
  initial_minor,
  conversion_at,
  payment_occurred_at,
  sponsor_auth_user_id
)
SELECT
  format('%s_%s', dimension.label_prefix, fixture_number),
  'main_advocate',
  dimension.segment_key,
  CASE
    WHEN fixture_number = 1 THEN dimension.exact_boundary
    ELSE dimension.interior_lag
  END,
  dimension.currency,
  format('%s-contact-%s', dimension.label_prefix, fixture_number),
  'one_time'::public.sponsorship_payment_mode,
  NULL,
  100,
  CASE WHEN dimension.currency = 'USD' THEN 100 ELSE 200 END,
  cutoff.value - interval '20 days',
  cutoff.value - interval '10 days',
  gen_random_uuid()
FROM (
  VALUES
    (
      'main_post_0_1',
      'post_visit_0_1_day',
      interval '1 day',
      interval '12 hours',
      'EUR'::public.payment_currency
    ),
    (
      'main_post_1_7',
      'post_visit_1_7_days',
      interval '7 days',
      interval '2 days',
      'GBP'::public.payment_currency
    ),
    (
      'main_post_7_30',
      'post_visit_7_30_days',
      interval '30 days',
      interval '8 days',
      'AUD'::public.payment_currency
    ),
    (
      'main_observed',
      'observed_30_365_days',
      interval '365 days',
      interval '31 days',
      'USD'::public.payment_currency
    )
) dimension(
  label_prefix,
  segment_key,
  exact_boundary,
  interior_lag,
  currency
)
CROSS JOIN generate_series(1, 5) fixture_number
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO analytics_fixture_intents (
  label,
  advocate_key,
  segment_key,
  exposure_lag,
  charged_currency,
  contact_group,
  payment_mode,
  recurrence_interval,
  initial_usd_cents,
  initial_minor,
  conversion_at,
  payment_occurred_at
)
SELECT
  format('suppress_direct_%s', fixture_number),
  'suppress_advocate',
  'direct',
  NULL,
  'USD'::public.payment_currency,
  format('suppress-direct-contact-%s', fixture_number),
  CASE
    WHEN fixture_number = 1
      THEN 'recurring'::public.sponsorship_payment_mode
    ELSE 'one_time'::public.sponsorship_payment_mode
  END,
  CASE WHEN fixture_number = 1 THEN 'month' ELSE NULL END,
  100,
  100,
  cutoff.value - interval '8 days',
  cutoff.value - interval '7 days'
FROM generate_series(1, 5) fixture_number
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO analytics_fixture_intents (
  label,
  advocate_key,
  segment_key,
  exposure_lag,
  charged_currency,
  contact_group,
  payment_mode,
  recurrence_interval,
  initial_usd_cents,
  initial_minor,
  conversion_at,
  payment_occurred_at
)
SELECT
  format('suppress_post_0_1_%s', fixture_number),
  'suppress_advocate',
  'post_visit_0_1_day',
  interval '1 hour',
  'EUR'::public.payment_currency,
  format('suppress-post-contact-%s', fixture_number),
  'one_time'::public.sponsorship_payment_mode,
  NULL,
  100,
  200,
  cutoff.value - interval '8 days',
  cutoff.value - interval '7 days'
FROM generate_series(1, 5) fixture_number
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO analytics_fixture_intents (
  label,
  advocate_key,
  segment_key,
  exposure_lag,
  charged_currency,
  contact_group,
  payment_mode,
  recurrence_interval,
  initial_usd_cents,
  initial_minor,
  conversion_at,
  payment_occurred_at
)
SELECT
  format('contact_repeat_%s', fixture_number),
  'contact_advocate',
  'direct',
  NULL,
  'USD'::public.payment_currency,
  'one-repeated-contact',
  'one_time'::public.sponsorship_payment_mode,
  NULL,
  100,
  100,
  cutoff.value - interval '8 days',
  cutoff.value - interval '7 days'
FROM generate_series(1, 5) fixture_number
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO analytics_fixture_intents (
  label,
  advocate_key,
  segment_key,
  exposure_lag,
  charged_currency,
  contact_group,
  payment_mode,
  recurrence_interval,
  initial_usd_cents,
  initial_minor,
  conversion_at,
  payment_occurred_at
)
SELECT
  boundary.label,
  'main_advocate',
  boundary.segment_key,
  boundary.exposure_lag,
  'USD'::public.payment_currency,
  boundary.label || '-contact',
  'one_time'::public.sponsorship_payment_mode,
  NULL,
  999,
  999,
  cutoff.value + boundary.conversion_offset,
  cutoff.value + boundary.payment_offset
FROM (
  VALUES
    (
      'main_conversion_at_cutoff',
      'direct',
      NULL::interval,
      interval '0 seconds',
      interval '-1 hour'
    ),
    (
      'main_payment_at_cutoff',
      'direct',
      NULL::interval,
      interval '-1 day',
      interval '0 seconds'
    ),
    (
      'main_finalized_at_cutoff',
      'direct',
      NULL::interval,
      interval '-1 day',
      interval '-1 hour'
    ),
    (
      'main_outside_365_days',
      'observed_30_365_days',
      interval '365 days 1 second',
      interval '-2 days',
      interval '-1 day'
    )
) boundary(
  label,
  segment_key,
  exposure_lag,
  conversion_offset,
  payment_offset
)
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_anonymous
)
SELECT
  fixture.sponsor_auth_user_id,
  'authenticated',
  'authenticated',
  format('verified-%s@example.test', fixture.label),
  cutoff.value - interval '30 days',
  '{}'::jsonb,
  '{}'::jsonb,
  cutoff.value - interval '31 days',
  cutoff.value - interval '30 days',
  false
FROM analytics_fixture_intents fixture
CROSS JOIN analytics_test_times cutoff
WHERE fixture.sponsor_auth_user_id IS NOT NULL
  AND cutoff.key = 'as_of';

SET LOCAL session_replication_role = replica;

INSERT INTO public.sponsor_identities (
  id,
  auth_user_id,
  status,
  created_at,
  updated_at
)
SELECT
  fixture.identity_id,
  fixture.sponsor_auth_user_id,
  'active'::public.sponsor_identity_status,
  fixture.conversion_at - interval '2 days',
  fixture.conversion_at - interval '2 days'
FROM analytics_fixture_intents fixture;

INSERT INTO public.sponsorship_intents (
  id,
  idempotency_key,
  source,
  source_host,
  source_advocate_id,
  source_advocate_domain_id,
  auth_user_id,
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
  currency_rate_source,
  status,
  committed_at,
  succeeded_at,
  created_at,
  updated_at
)
SELECT
  fixture.intent_id,
  'analytics-intent-' || fixture.label,
  CASE
    WHEN fixture.segment_key = 'direct'
      THEN 'advocate_domain'::public.sponsorship_intent_source
    ELSE 'primary_site'::public.sponsorship_intent_source
  END,
  CASE
    WHEN fixture.segment_key = 'direct' THEN domain.hostname
    ELSE 'creatorshare.com'
  END,
  CASE
    WHEN fixture.segment_key = 'direct' THEN advocate.value
    ELSE NULL
  END,
  CASE
    WHEN fixture.segment_key = 'direct' THEN domain.id
    ELSE NULL
  END,
  fixture.sponsor_auth_user_id,
  fixture.identity_id,
  extensions.digest(fixture.contact_group, 'sha256'),
  1,
  1,
  'blind'::public.sponsorship_subject_kind,
  fixture.payment_mode,
  fixture.recurrence_interval,
  fixture.initial_usd_cents,
  fixture.initial_minor,
  fixture.charged_currency,
  CASE
    WHEN fixture.charged_currency = 'USD' THEN 1::numeric
    ELSE fixture.initial_usd_cents::numeric / fixture.initial_minor::numeric
  END,
  fixture.conversion_at - interval '1 day',
  'analytics-test',
  'succeeded'::public.sponsorship_intent_status,
  fixture.conversion_at - interval '1 hour',
  fixture.conversion_at,
  fixture.conversion_at - interval '1 day',
  fixture.conversion_at
FROM analytics_fixture_intents fixture
JOIN analytics_test_ids advocate
  ON advocate.key = fixture.advocate_key
JOIN public.advocate_domains domain ON domain.advocate_id = advocate.value;

INSERT INTO public.sponsorship_attributions (
  sponsorship_intent_id,
  kind,
  advocate_id,
  exposure_id,
  exposure_lag,
  decision_context,
  decided_at,
  finalized_at,
  conversion_occurred_at,
  analytics_eligible,
  analytics_exclusion_reason
)
SELECT
  fixture.intent_id,
  CASE
    WHEN fixture.segment_key = 'direct'
      THEN 'direct'::public.sponsorship_attribution_kind
    WHEN fixture.segment_key = 'observed_30_365_days'
      THEN 'post_visit_observed'::public.sponsorship_attribution_kind
    ELSE 'post_visit_attributed'::public.sponsorship_attribution_kind
  END,
  advocate.value,
  CASE WHEN fixture.segment_key = 'direct' THEN NULL ELSE gen_random_uuid() END,
  fixture.exposure_lag,
  '{}'::jsonb,
  fixture.conversion_at,
  fixture.conversion_at,
  fixture.conversion_at,
  true,
  NULL
FROM analytics_fixture_intents fixture
JOIN analytics_test_ids advocate ON advocate.key = fixture.advocate_key;

UPDATE public.sponsorship_attributions attribution
SET finalized_at = cutoff.value
FROM analytics_fixture_intents fixture
CROSS JOIN analytics_test_times cutoff
WHERE attribution.sponsorship_intent_id = fixture.intent_id
  AND fixture.label = 'main_finalized_at_cutoff'
  AND cutoff.key = 'as_of';

INSERT INTO public.sponsorship_financial_movements (
  id,
  source_gateway_event_id,
  payment_attempt_id,
  sponsorship_intent_id,
  sponsor_identity_id,
  provider,
  provider_account_scope,
  provider_movement_type,
  provider_movement_id,
  entry_kind,
  payment_mode,
  base_amount_usd_cents,
  charged_amount_minor,
  charged_currency,
  conversion_rate,
  occurred_at,
  recorded_at,
  original_financial_movement_id
)
SELECT
  fixture.initial_movement_id,
  fixture.gateway_event_id,
  fixture.payment_attempt_id,
  fixture.intent_id,
  fixture.identity_id,
  'STRIPE'::public.sponsorship_method,
  'stripe_us',
  'payment',
  'analytics-payment-' || fixture.label,
  'sponsorship_payment'::public.sponsorship_financial_entry_kind,
  fixture.payment_mode,
  fixture.initial_usd_cents,
  fixture.initial_minor,
  fixture.charged_currency,
  CASE
    WHEN fixture.charged_currency = 'USD' THEN 1::numeric
    ELSE fixture.initial_usd_cents::numeric / fixture.initial_minor::numeric
  END,
  fixture.payment_occurred_at,
  fixture.payment_occurred_at,
  NULL
FROM analytics_fixture_intents fixture;

INSERT INTO public.sponsorship_financial_movements (
  source_gateway_event_id,
  payment_attempt_id,
  sponsorship_intent_id,
  sponsor_identity_id,
  provider,
  provider_account_scope,
  provider_movement_type,
  provider_movement_id,
  entry_kind,
  payment_mode,
  base_amount_usd_cents,
  charged_amount_minor,
  charged_currency,
  conversion_rate,
  occurred_at,
  recorded_at,
  original_financial_movement_id
)
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  fixture.intent_id,
  fixture.identity_id,
  'STRIPE'::public.sponsorship_method,
  'stripe_us',
  'payment',
  'analytics-renewal-' || fixture.label,
  'sponsorship_payment'::public.sponsorship_financial_entry_kind,
  'recurring'::public.sponsorship_payment_mode,
  50,
  50,
  'USD'::public.payment_currency,
  1,
  cutoff.value - interval '2 days',
  cutoff.value - interval '2 days',
  NULL
FROM analytics_fixture_intents fixture
CROSS JOIN analytics_test_times cutoff
WHERE fixture.label LIKE 'main_direct_%'
  AND cutoff.key = 'as_of';

INSERT INTO public.sponsorship_financial_movements (
  source_gateway_event_id,
  payment_attempt_id,
  sponsorship_intent_id,
  sponsor_identity_id,
  provider,
  provider_account_scope,
  provider_movement_type,
  provider_movement_id,
  entry_kind,
  payment_mode,
  base_amount_usd_cents,
  charged_amount_minor,
  charged_currency,
  conversion_rate,
  occurred_at,
  recorded_at,
  original_financial_movement_id
)
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  fixture.intent_id,
  fixture.identity_id,
  'STRIPE'::public.sponsorship_method,
  'stripe_us',
  'payment',
  'analytics-late-recorded-main-direct-1',
  'sponsorship_payment'::public.sponsorship_financial_entry_kind,
  'recurring'::public.sponsorship_payment_mode,
  77,
  77,
  'USD'::public.payment_currency,
  1,
  cutoff.value - interval '1 day',
  cutoff.value,
  NULL
FROM analytics_fixture_intents fixture
CROSS JOIN analytics_test_times cutoff
WHERE fixture.label = 'main_direct_1'
  AND cutoff.key = 'as_of';

INSERT INTO public.sponsorship_financial_movements (
  source_gateway_event_id,
  payment_attempt_id,
  sponsorship_intent_id,
  sponsor_identity_id,
  provider,
  provider_account_scope,
  provider_movement_type,
  provider_movement_id,
  entry_kind,
  payment_mode,
  base_amount_usd_cents,
  charged_amount_minor,
  charged_currency,
  conversion_rate,
  occurred_at,
  recorded_at,
  original_financial_movement_id
)
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  fixture.intent_id,
  fixture.identity_id,
  'STRIPE'::public.sponsorship_method,
  'stripe_us',
  'payment',
  'analytics-sparse-renewal-suppress-direct-1',
  'sponsorship_payment'::public.sponsorship_financial_entry_kind,
  'recurring'::public.sponsorship_payment_mode,
  25,
  25,
  'USD'::public.payment_currency,
  1,
  cutoff.value - interval '2 days',
  cutoff.value - interval '2 days',
  NULL
FROM analytics_fixture_intents fixture
CROSS JOIN analytics_test_times cutoff
WHERE fixture.label = 'suppress_direct_1'
  AND cutoff.key = 'as_of';

INSERT INTO public.sponsorship_financial_movements (
  source_gateway_event_id,
  payment_attempt_id,
  sponsorship_intent_id,
  sponsor_identity_id,
  provider,
  provider_account_scope,
  provider_movement_type,
  provider_movement_id,
  entry_kind,
  payment_mode,
  base_amount_usd_cents,
  charged_amount_minor,
  charged_currency,
  conversion_rate,
  occurred_at,
  recorded_at,
  original_financial_movement_id
)
SELECT
  gen_random_uuid(),
  fixture.payment_attempt_id,
  fixture.intent_id,
  fixture.identity_id,
  'STRIPE'::public.sponsorship_method,
  'stripe_us',
  'adjustment',
  'analytics-adjustment-' || adjustment.suffix || '-' || fixture.label,
  adjustment.entry_kind,
  'recurring'::public.sponsorship_payment_mode,
  adjustment.amount,
  adjustment.amount,
  'USD'::public.payment_currency,
  1,
  cutoff.value + adjustment.occurred_offset,
  cutoff.value + adjustment.occurred_offset,
  fixture.initial_movement_id
FROM analytics_fixture_intents fixture
CROSS JOIN analytics_test_times cutoff
CROSS JOIN (
  VALUES
    (
      'refund',
      'sponsorship_refund'::public.sponsorship_financial_entry_kind,
      20::bigint,
      (-20)::bigint,
      interval '-1 day'
    ),
    (
      'reversal',
      'sponsorship_reversal'::public.sponsorship_financial_entry_kind,
      10::bigint,
      (-10)::bigint,
      interval '-1 day'
    ),
    (
      'dispute-debit',
      'sponsorship_dispute_debit'::public.sponsorship_financial_entry_kind,
      5::bigint,
      (-5)::bigint,
      interval '-1 day'
    ),
    (
      'dispute-credit',
      'sponsorship_dispute_credit'::public.sponsorship_financial_entry_kind,
      3::bigint,
      3::bigint,
      interval '-1 day'
    ),
    (
      'refund-at-cutoff',
      'sponsorship_refund'::public.sponsorship_financial_entry_kind,
      99::bigint,
      (-99)::bigint,
      interval '0 seconds'
    )
) adjustment(suffix, entry_kind, amount, net_amount, occurred_offset)
WHERE fixture.label LIKE 'main_direct_%'
  AND cutoff.key = 'as_of';

INSERT INTO public.subscriptions (
  id,
  created_at,
  beneficiary_id,
  status,
  amount,
  interval,
  canceled_at,
  sponsorship_method,
  charged_amount,
  charged_currency,
  conversion_rate,
  sponsorship_intent_id,
  sponsor_identity_id,
  payment_attempt_id,
  provider_account_scope,
  provider_subscription_object_type,
  provider_subscription_object_id,
  subject_kind,
  initial_gateway_event_id,
  payment_health,
  last_provider_payment_event_occurred_at,
  last_provider_payment_event_precedence,
  last_provider_payment_event_id
)
SELECT
  gen_random_uuid(),
  CASE
    WHEN fixture.label = 'main_direct_5' THEN cutoff.value
    ELSE cutoff.value - interval '10 days'
  END,
  NULL,
  CASE
    WHEN fixture.label IN ('main_direct_3', 'main_direct_4')
      THEN 'cancelled'::public."SubscriptionStatus"
    ELSE 'complete'::public."SubscriptionStatus"
  END,
  fixture.initial_usd_cents::integer,
  fixture.recurrence_interval,
  CASE
    WHEN fixture.label = 'main_direct_3'
      THEN (cutoff.value + interval '1 hour') AT TIME ZONE 'UTC'
    WHEN fixture.label = 'main_direct_4'
      THEN (cutoff.value - interval '1 hour') AT TIME ZONE 'UTC'
    ELSE NULL
  END,
  'STRIPE'::public.sponsorship_method,
  fixture.initial_minor::integer,
  'USD'::public.payment_currency,
  1,
  fixture.intent_id,
  fixture.identity_id,
  fixture.payment_attempt_id,
  'stripe_us',
  'subscription',
  'sub-analytics-' || fixture.label,
  'blind'::public.sponsorship_subject_kind,
  fixture.gateway_event_id,
  'paid',
  fixture.payment_occurred_at,
  100,
  'event-analytics-' || fixture.label
FROM analytics_fixture_intents fixture
CROSS JOIN analytics_test_times cutoff
WHERE (
    fixture.label LIKE 'main_direct_%'
    OR fixture.label = 'suppress_direct_1'
  )
  AND cutoff.key = 'as_of';

INSERT INTO public.payment_gateway_events (
  id,
  provider,
  provider_account_scope,
  provider_event_id,
  event_type,
  redacted_payload,
  payload_sha256,
  signature_verified_at,
  occurred_at,
  verification_method,
  fact_period_start,
  fact_period_end
)
SELECT
  fixture.gateway_event_id,
  'STRIPE'::public.sponsorship_method,
  'stripe_us',
  'analytics-period-' || fixture.label,
  'invoice.paid',
  '{}'::jsonb,
  extensions.digest('analytics-period-' || fixture.label, 'sha256'),
  fixture.payment_occurred_at,
  fixture.payment_occurred_at,
  'analytics_test',
  cutoff.value - interval '1 month',
  CASE
    WHEN fixture.label = 'main_direct_6' THEN cutoff.value
    ELSE cutoff.value + interval '1 month'
  END
FROM analytics_fixture_intents fixture
CROSS JOIN analytics_test_times cutoff
WHERE (
    fixture.label LIKE 'main_direct_%'
    OR fixture.label = 'suppress_direct_1'
  )
  AND cutoff.key = 'as_of';

INSERT INTO public.payment_gateway_events (
  id,
  provider,
  provider_account_scope,
  provider_event_id,
  event_type,
  redacted_payload,
  payload_sha256,
  signature_verified_at,
  occurred_at,
  verification_method,
  fact_lifecycle_state
)
SELECT
  lifecycle.gateway_event_id,
  'STRIPE'::public.sponsorship_method,
  'stripe_us',
  lifecycle.provider_event_id,
  'customer.subscription.updated',
  '{}'::jsonb,
  extensions.digest(lifecycle.provider_event_id, 'sha256'),
  cutoff.value + lifecycle.event_offset,
  cutoff.value + lifecycle.event_offset,
  'analytics_test',
  lifecycle.lifecycle_state
FROM (
  VALUES
    (
      '96000000-0000-4000-8000-000000000201'::uuid,
      'analytics-lifecycle-active-main-direct-2',
      'active'::text,
      interval '-2 hours'
    ),
    (
      '96000000-0000-4000-8000-000000000202'::uuid,
      'analytics-lifecycle-cancelled-main-direct-2',
      'cancelled'::text,
      interval '0 seconds'
    )
) lifecycle(
  gateway_event_id,
  provider_event_id,
  lifecycle_state,
  event_offset
)
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO public.payment_gateway_event_applications (
  gateway_event_id,
  effect,
  subscription_id,
  summary,
  applied_at
)
SELECT
  event.id,
  'subscription_lifecycle'::public.gateway_event_application_effect,
  subscription.id,
  '{}'::jsonb,
  cutoff.value + lifecycle.application_offset
FROM (
  VALUES
    (
      'analytics-lifecycle-active-main-direct-2',
      interval '-90 minutes'
    ),
    (
      'analytics-lifecycle-cancelled-main-direct-2',
      interval '0 seconds'
    )
) lifecycle(provider_event_id, application_offset)
JOIN public.payment_gateway_events event
  ON event.provider_event_id = lifecycle.provider_event_id
JOIN analytics_fixture_intents fixture
  ON fixture.label = 'main_direct_2'
JOIN public.subscriptions subscription
  ON subscription.sponsorship_intent_id = fixture.intent_id
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO public.sponsorship_subscription_cancellations (
  subscription_id,
  requested_by_user_id,
  requester_is_super_admin,
  status,
  result,
  settled_at,
  created_at,
  updated_at
)
SELECT
  subscription.id,
  '96000000-0000-4000-8000-000000000101'::uuid,
  false,
  'cancelled'::public.sponsorship_subscription_cancellation_status,
  'subscription_already_cancelled'::public.sponsorship_subscription_cancellation_result,
  cutoff.value + cancellation.settled_offset,
  cutoff.value - interval '2 days',
  cutoff.value + cancellation.settled_offset
FROM (
  VALUES
    ('main_direct_3', interval '0 seconds'),
    ('main_direct_4', interval '-1 hour')
) cancellation(fixture_label, settled_offset)
JOIN analytics_fixture_intents fixture
  ON fixture.label = cancellation.fixture_label
JOIN public.subscriptions subscription
  ON subscription.sponsorship_intent_id = fixture.intent_id
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  format(
    'SELECT public.get_advocate_analytics_snapshot(%L::uuid)',
    (SELECT value FROM analytics_test_ids WHERE key = 'main_advocate')
  ),
  '42501',
  'Analytics access is unavailable',
  'an unauthenticated caller cannot read private advocate analytics'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '96000000-0000-4000-8000-000000000103',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.get_advocate_analytics_snapshot(%L::uuid)',
    (SELECT value FROM analytics_test_ids WHERE key = 'main_advocate')
  ),
  '42501',
  'Analytics access is unavailable',
  'a healthy tenant member without analytics permission is denied'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '96000000-0000-4000-8000-000000000104',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.get_advocate_analytics_snapshot(%L::uuid)',
    (SELECT value FROM analytics_test_ids WHERE key = 'main_advocate')
  ),
  '42501',
  'Analytics access is unavailable',
  'an owner with analytics permission in another tenant cannot cross the tenant boundary'
);

UPDATE auth.users
SET banned_until = now() + interval '1 day'
WHERE id = '96000000-0000-4000-8000-000000000102'::uuid;

SELECT set_config(
  'request.jwt.claim.sub',
  '96000000-0000-4000-8000-000000000102',
  true
);

SELECT extensions.throws_ok(
  format(
    'SELECT public.get_advocate_analytics_snapshot(%L::uuid)',
    (SELECT value FROM analytics_test_ids WHERE key = 'main_advocate')
  ),
  '42501',
  'Analytics access is unavailable',
  'a banned analytics delegate cannot use a retained token to read private metrics'
);

UPDATE auth.users
SET banned_until = NULL
WHERE id = '96000000-0000-4000-8000-000000000102'::uuid;

CREATE TEMP TABLE analytics_snapshots (
  key text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO analytics_snapshots (key, payload)
SELECT
  'main',
  public.get_advocate_analytics_snapshot(
    (SELECT value FROM analytics_test_ids WHERE key = 'main_advocate')
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '96000000-0000-4000-8000-000000000104',
  true
);

INSERT INTO analytics_snapshots (key, payload)
SELECT
  'suppress',
  public.get_advocate_analytics_snapshot(
    (SELECT value FROM analytics_test_ids WHERE key = 'suppress_advocate')
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '96000000-0000-4000-8000-000000000105',
  true
);

INSERT INTO analytics_snapshots (key, payload)
SELECT
  'contact',
  public.get_advocate_analytics_snapshot(
    (SELECT value FROM analytics_test_ids WHERE key = 'contact_advocate')
  );

SELECT extensions.is(
  (
    SELECT array_agg(root_key ORDER BY root_key)
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_object_keys(snapshot.payload) root(root_key)
    WHERE snapshot.key = 'main'
  ),
  ARRAY[
    'as_of',
    'methodology',
    'observed',
    'official',
    'original_currency',
    'schema_version',
    'segments'
  ]::text[],
  'the root analytics payload has exactly the safe fixed contract keys'
);

SELECT extensions.is(
  (
    SELECT payload -> 'methodology'
    FROM analytics_snapshots
    WHERE key = 'main'
  ),
  jsonb_build_object(
    'minimum_sponsor_contacts_per_cell', 5,
    'official_window_days', 30,
    'observed_window_days', 365,
    'measure_suppression_enabled', true,
    'renewals_increase_funds_not_counts', true
  ),
  'the snapshot publishes the fixed privacy and attribution methodology'
);

SELECT extensions.ok(
  (
    SELECT payload ->> 'as_of' = to_char(
      cutoff.value AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
      AND payload ->> 'as_of' ~ 'T00:00:00Z$'
    FROM analytics_snapshots snapshot
    CROSS JOIN analytics_test_times cutoff
    WHERE snapshot.key = 'main'
      AND cutoff.key = 'as_of'
  ),
  'the snapshot cutoff is the previous complete UTC day boundary'
);

SELECT extensions.is(
  (
    SELECT array_agg(cell_key ORDER BY cell_key)
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_object_keys(snapshot.payload -> 'official') cell(cell_key)
    WHERE snapshot.key = 'main'
  ),
  ARRAY[
    'active_annual_commitment_usd_cents',
    'active_monthly_commitment_usd_cents',
    'annualized_commitment_usd_cents',
    'dispute_credits_usd_cents',
    'dispute_debits_usd_cents',
    'gross_collected_usd_cents',
    'initial_collected_usd_cents',
    'net_collected_usd_cents',
    'refunds_and_reversals_usd_cents',
    'renewal_collected_usd_cents',
    'sponsorships',
    'suppressed',
    'unique_sponsor_contacts',
    'verified_sponsor_accounts'
  ]::text[],
  'a visible aggregate cell has exactly the approved safe metric keys'
);

SELECT extensions.ok(
  (
    SELECT
      (payload #>> '{official,suppressed}')::boolean = false
      AND (payload #>> '{official,sponsorships}')::bigint = 30
      AND (payload #>> '{official,unique_sponsor_contacts}')::bigint = 30
      AND payload #> '{official,verified_sponsor_accounts}' = 'null'::jsonb
      AND (payload #>> '{official,initial_collected_usd_cents}')::bigint = 15200
      AND (payload #>> '{official,renewal_collected_usd_cents}')::bigint = 700
      AND (payload #>> '{official,gross_collected_usd_cents}')::bigint = 15900
      AND (payload #>> '{official,refunds_and_reversals_usd_cents}')::bigint = 420
      AND (payload #>> '{official,dispute_debits_usd_cents}')::bigint = 70
      AND (payload #>> '{official,dispute_credits_usd_cents}')::bigint = 42
      AND (payload #>> '{official,net_collected_usd_cents}')::bigint = 15452
      AND (
        payload #>> '{official,active_monthly_commitment_usd_cents}'
      )::bigint = 6100
      AND (
        payload #>> '{official,active_annual_commitment_usd_cents}'
      )::bigint = 6000
      AND (
        payload #>> '{official,annualized_commitment_usd_cents}'
      )::bigint = 79200
    FROM analytics_snapshots
    WHERE key = 'main'
  ),
  'official totals exclude cutoff events and reconstruct active commitments at the cutoff'
);

SELECT extensions.ok(
  (
    SELECT
      (payload #>> '{observed,suppressed}')::boolean = false
      AND (payload #>> '{observed,sponsorships}')::bigint = 5
      AND (payload #>> '{observed,unique_sponsor_contacts}')::bigint = 5
      AND (payload #>> '{observed,verified_sponsor_accounts}')::bigint = 5
      AND (payload #>> '{observed,initial_collected_usd_cents}')::bigint = 500
      AND (payload #>> '{observed,renewal_collected_usd_cents}')::bigint = 0
      AND (payload #>> '{observed,gross_collected_usd_cents}')::bigint = 500
      AND (payload #>> '{observed,net_collected_usd_cents}')::bigint = 500
      AND (
        payload #>> '{observed,active_monthly_commitment_usd_cents}'
      )::bigint = 0
      AND (
        payload #>> '{observed,active_annual_commitment_usd_cents}'
      )::bigint = 0
    FROM analytics_snapshots
    WHERE key = 'main'
  ),
  'observed one year associations remain separate from official funds and commitments'
);

SELECT extensions.is(
  (
    SELECT array_agg(segment.value ->> 'key' ORDER BY segment.ordinality)
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'segments')
      WITH ORDINALITY segment(value, ordinality)
    WHERE snapshot.key = 'main'
  ),
  ARRAY[
    'direct',
    'post_visit_0_1_day',
    'post_visit_1_7_days',
    'post_visit_7_30_days',
    'observed_30_365_days'
  ]::text[],
  'segment cells preserve the fixed mutually exclusive attribution order'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      (segment.value #>> '{sponsorships}')::bigint = CASE
        WHEN segment.value ->> 'key' = 'direct' THEN 15
        ELSE 5
      END
      AND (segment.value #>> '{unique_sponsor_contacts}')::bigint = CASE
        WHEN segment.value ->> 'key' = 'direct' THEN 15
        ELSE 5
      END
    )
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'segments')
      segment(value)
    WHERE snapshot.key = 'main'
  ),
  'exact 1, 7, 30, and 365 day boundaries land in their inclusive bands'
);

SELECT extensions.ok(
  (
    SELECT payload #> '{official,verified_sponsor_accounts}' = 'null'::jsonb
      AND bool_and(
        segment.value #> '{verified_sponsor_accounts}' = 'null'::jsonb
      )
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'segments')
      segment(value)
    WHERE snapshot.key = 'main'
    GROUP BY snapshot.payload
  ),
  'five or more verified contacts cannot reveal a one-to-four-contact nonverified complement'
);

SELECT extensions.ok(
  (
    SELECT
      (segment.value #>> '{sponsorships}')::bigint = 15
      AND (segment.value #>> '{initial_collected_usd_cents}')::bigint = 13700
      AND (segment.value #>> '{renewal_collected_usd_cents}')::bigint = 700
      AND (segment.value #>> '{gross_collected_usd_cents}')::bigint = 14400
      AND (segment.value #>> '{net_collected_usd_cents}')::bigint = 13952
      AND (
        segment.value #>> '{active_monthly_commitment_usd_cents}'
      )::bigint = 6100
      AND (
        segment.value #>> '{active_annual_commitment_usd_cents}'
      )::bigint = 6000
      AND (
        segment.value #>> '{annualized_commitment_usd_cents}'
      )::bigint = 79200
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'segments')
      segment(value)
    WHERE snapshot.key = 'main'
      AND segment.value ->> 'key' = 'direct'
  ),
  'renewals, lifecycle history, settled cancellations, and billing periods reconstruct direct commitments'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      (
        SELECT array_agg(segment_key ORDER BY segment_key)
        FROM jsonb_object_keys(segment.value) keys(segment_key)
      ) = ARRAY[
        'active_annual_commitment_usd_cents',
        'active_monthly_commitment_usd_cents',
        'annualized_commitment_usd_cents',
        'dispute_credits_usd_cents',
        'dispute_debits_usd_cents',
        'gross_collected_usd_cents',
        'initial_collected_usd_cents',
        'key',
        'net_collected_usd_cents',
        'refunds_and_reversals_usd_cents',
        'renewal_collected_usd_cents',
        'sponsorships',
        'suppressed',
        'unique_sponsor_contacts',
        'verified_sponsor_accounts'
      ]::text[]
    )
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'segments')
      segment(value)
    WHERE snapshot.key = 'main'
  ),
  'every visible segment has the same exact safe flat cell shape'
);

SELECT extensions.is(
  (
    SELECT array_agg(currency.value ->> 'currency' ORDER BY currency.ordinality)
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'original_currency')
      WITH ORDINALITY currency(value, ordinality)
    WHERE snapshot.key = 'main'
  ),
  ARRAY['AUD', 'EUR', 'GBP', 'USD']::text[],
  'safe original currency cells are emitted in lexical order'
);

SELECT extensions.ok(
  (
    SELECT
      (currency.value #>> '{sponsorships}')::bigint = 15
      AND (currency.value #>> '{unique_sponsor_contacts}')::bigint = 15
      AND (currency.value #>> '{initial_collected_minor}')::bigint = 13700
      AND (currency.value #>> '{renewal_collected_minor}')::bigint = 700
      AND (currency.value #>> '{gross_collected_minor}')::bigint = 14400
      AND (currency.value #>> '{refunds_and_reversals_minor}')::bigint = 420
      AND (currency.value #>> '{dispute_debits_minor}')::bigint = 70
      AND (currency.value #>> '{dispute_credits_minor}')::bigint = 42
      AND (currency.value #>> '{net_collected_minor}')::bigint = 13952
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'original_currency')
      currency(value)
    WHERE snapshot.key = 'main'
      AND currency.value ->> 'currency' = 'USD'
  ),
  'original USD arithmetic excludes observed funds and honors every signed adjustment'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      (currency.value #>> '{sponsorships}')::bigint = 5
      AND (currency.value #>> '{unique_sponsor_contacts}')::bigint = 5
      AND (currency.value #>> '{initial_collected_minor}')::bigint = 1000
      AND (currency.value #>> '{gross_collected_minor}')::bigint = 1000
      AND (currency.value #>> '{net_collected_minor}')::bigint = 1000
    )
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'original_currency')
      currency(value)
    WHERE snapshot.key = 'main'
      AND currency.value ->> 'currency' IN ('AUD', 'EUR', 'GBP')
  ),
  'non-USD currency cells preserve normalized counts and original minor units'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      (
        SELECT array_agg(currency_key ORDER BY currency_key)
        FROM jsonb_object_keys(currency.value) keys(currency_key)
      ) = ARRAY[
        'currency',
        'dispute_credits_minor',
        'dispute_debits_minor',
        'gross_collected_minor',
        'initial_collected_minor',
        'net_collected_minor',
        'refunds_and_reversals_minor',
        'renewal_collected_minor',
        'sponsorships',
        'suppressed',
        'unique_sponsor_contacts'
      ]::text[]
    )
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'original_currency')
      currency(value)
    WHERE snapshot.key = 'main'
  ),
  'every visible original currency cell has only approved aggregate fields'
);

SELECT extensions.ok(
  (
    SELECT
      (payload #>> '{official,suppressed}')::boolean = false
      AND (payload #>> '{official,sponsorships}')::bigint = 10
      AND (payload #>> '{official,unique_sponsor_contacts}')::bigint = 10
      AND (payload #>> '{official,initial_collected_usd_cents}')::bigint = 1000
      AND payload #> '{official,renewal_collected_usd_cents}' = 'null'::jsonb
      AND payload #> '{official,gross_collected_usd_cents}' = 'null'::jsonb
      AND payload #> '{official,net_collected_usd_cents}' = 'null'::jsonb
      AND payload #> '{official,active_monthly_commitment_usd_cents}' = 'null'::jsonb
      AND payload #> '{official,annualized_commitment_usd_cents}' = 'null'::jsonb
      AND (
        payload #>> '{official,active_annual_commitment_usd_cents}'
      )::bigint = 0
      AND (
        payload #>> '{official,refunds_and_reversals_usd_cents}'
      )::bigint = 0
      AND jsonb_typeof(payload -> 'segments') = 'array'
      AND jsonb_typeof(payload -> 'original_currency') = 'array'
    FROM analytics_snapshots
    WHERE key = 'suppress'
  ),
  'sparse renewal and monthly commitment measures hide dependent aggregate values'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 5
      AND bool_and(
        segment.value #> '{active_monthly_commitment_usd_cents}' = 'null'::jsonb
        AND segment.value #> '{annualized_commitment_usd_cents}' = 'null'::jsonb
      )
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'segments')
      segment(value)
    WHERE snapshot.key = 'suppress'
  ),
  'one sparse monthly cadence suppresses monthly and annualized commitments across every segment'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 2
      AND bool_and(
        currency.value #> '{renewal_collected_minor}' = 'null'::jsonb
        AND currency.value #> '{gross_collected_minor}' = 'null'::jsonb
        AND currency.value #> '{net_collected_minor}' = 'null'::jsonb
      )
    FROM analytics_snapshots snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'original_currency')
      currency(value)
    WHERE snapshot.key = 'suppress'
  ),
  'one sparse renewal cadence suppresses subtractive measures across every currency cell'
);

SELECT extensions.ok(
  (
    SELECT
      (payload #>> '{observed,suppressed}')::boolean = false
      AND (payload #>> '{observed,sponsorships}')::bigint = 0
      AND (payload #>> '{observed,unique_sponsor_contacts}')::bigint = 0
    FROM analytics_snapshots
    WHERE key = 'suppress'
  ),
  'an exactly zero cell remains visibly zero instead of being privacy suppressed'
);

SELECT extensions.is(
  (
    SELECT payload -> 'official'
    FROM analytics_snapshots
    WHERE key = 'contact'
  ),
  '{"suppressed":true}'::jsonb,
  'five sponsorships sharing one contact reveal neither the contact count nor money'
);

SELECT extensions.ok(
  (
    SELECT payload -> 'segments' = 'null'::jsonb
      AND payload -> 'original_currency' = 'null'::jsonb
    FROM analytics_snapshots
    WHERE key = 'contact'
  ),
  'contact suppression also closes complementary segment and currency families'
);

SELECT extensions.ok(
  (
    SELECT NOT EXISTS (
      SELECT 1
      FROM analytics_fixture_intents fixture
      WHERE snapshot.payload::text LIKE '%' || fixture.intent_id::text || '%'
         OR snapshot.payload::text LIKE '%' || fixture.identity_id::text || '%'
         OR snapshot.payload::text LIKE '%' || fixture.initial_movement_id::text || '%'
         OR snapshot.payload::text LIKE '%' || fixture.payment_attempt_id::text || '%'
         OR snapshot.payload::text LIKE '%' || fixture.gateway_event_id::text || '%'
         OR snapshot.payload::text LIKE '%' || encode(
           extensions.digest(fixture.contact_group, 'sha256'),
           'hex'
         ) || '%'
    )
    AND snapshot.payload::text NOT LIKE '%@example.test%'
    AND snapshot.payload::text NOT LIKE '%analytics-payment-%'
    AND snapshot.payload::text NOT LIKE '%STRIPE%'
    AND snapshot.payload::text NOT LIKE '%provider_%'
    AND snapshot.payload::text NOT LIKE '%occurred_at%'
    AND snapshot.payload::text NOT LIKE '%recorded_at%'
    AND snapshot.payload::text NOT LIKE '%finalized_at%'
    AND snapshot.payload::text NOT LIKE '%conversion_occurred_at%'
    FROM analytics_snapshots snapshot
    WHERE snapshot.key = 'main'
  ),
  'the safe JSON contains no raw ids, contacts, HMACs, provider facts, or event timestamps'
);

SET LOCAL session_replication_role = replica;

INSERT INTO public.sponsor_identities (
  id,
  auth_user_id,
  status,
  created_at,
  updated_at
)
SELECT
  fixture.identity_id,
  fixture.auth_user_id,
  'active'::public.sponsor_identity_status,
  cutoff.value - interval '3 days',
  cutoff.value - interval '3 days'
FROM (
  VALUES
    (
      '96000000-0000-4000-8000-000000000301'::uuid,
      '3de44111-9900-4f04-815d-aeb42828229a'::uuid
    ),
    (
      '96000000-0000-4000-8000-000000000302'::uuid,
      '96000000-0000-4000-8000-000000000101'::uuid
    ),
    (
      '96000000-0000-4000-8000-000000000303'::uuid,
      '96000000-0000-4000-8000-000000000105'::uuid
    )
) fixture(identity_id, auth_user_id)
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO public.sponsorship_intents (
  id,
  idempotency_key,
  source,
  source_host,
  source_advocate_id,
  source_advocate_domain_id,
  auth_user_id,
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
  currency_rate_source,
  status,
  committed_at,
  succeeded_at,
  created_at,
  updated_at
)
SELECT
  fixture.intent_id,
  'analytics-historical-' || fixture.label,
  'advocate_domain'::public.sponsorship_intent_source,
  domain.hostname,
  advocate.value,
  domain_context.value,
  fixture.auth_user_id,
  fixture.identity_id,
  extensions.digest('analytics-historical-' || fixture.label, 'sha256'),
  1,
  1,
  'blind'::public.sponsorship_subject_kind,
  'one_time'::public.sponsorship_payment_mode,
  NULL,
  100,
  100,
  'USD'::public.payment_currency,
  1,
  cutoff.value,
  'analytics-historical-test',
  'succeeded'::public.sponsorship_intent_status,
  cutoff.value + interval '1 day',
  cutoff.value + interval '1 day',
  cutoff.value + interval '1 day',
  cutoff.value + interval '1 day'
FROM (
  VALUES
    (
      'staff',
      '96000000-0000-4000-8000-000000000311'::uuid,
      '96000000-0000-4000-8000-000000000301'::uuid,
      '3de44111-9900-4f04-815d-aeb42828229a'::uuid
    ),
    (
      'same-member',
      '96000000-0000-4000-8000-000000000312'::uuid,
      '96000000-0000-4000-8000-000000000302'::uuid,
      '96000000-0000-4000-8000-000000000101'::uuid
    ),
    (
      'unrelated',
      '96000000-0000-4000-8000-000000000313'::uuid,
      '96000000-0000-4000-8000-000000000303'::uuid,
      '96000000-0000-4000-8000-000000000105'::uuid
    )
) fixture(label, intent_id, identity_id, auth_user_id)
JOIN analytics_test_ids advocate ON advocate.key = 'main_advocate'
JOIN analytics_test_ids domain_context ON domain_context.key = 'main_domain'
JOIN public.advocate_domains domain ON domain.id = domain_context.value
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

INSERT INTO public.sponsorship_attributions (
  sponsorship_intent_id,
  kind,
  advocate_id,
  exposure_id,
  exposure_lag,
  decision_context,
  decided_at,
  finalized_at,
  conversion_occurred_at,
  analytics_eligible,
  analytics_exclusion_reason
)
SELECT
  fixture.intent_id,
  'direct'::public.sponsorship_attribution_kind,
  advocate.value,
  NULL,
  NULL,
  '{}'::jsonb,
  cutoff.value - interval '1 day',
  cutoff.value - interval '1 day',
  cutoff.value - interval '1 day',
  true,
  NULL
FROM (
  VALUES
    ('96000000-0000-4000-8000-000000000311'::uuid),
    ('96000000-0000-4000-8000-000000000312'::uuid),
    ('96000000-0000-4000-8000-000000000313'::uuid)
) fixture(intent_id)
JOIN analytics_test_ids advocate ON advocate.key = 'main_advocate'
CROSS JOIN analytics_test_times cutoff
WHERE cutoff.key = 'as_of';

SET LOCAL session_replication_role = origin;

LOCK TABLE public.sponsorship_attributions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.sponsorship_attributions
  ALTER COLUMN analytics_eligible DROP NOT NULL;

ALTER TABLE public.sponsorship_attributions
  DISABLE TRIGGER sponsorship_attributions_protect;

SELECT extensions.ok(
  (
    SELECT bool_and(
      CASE trigger_definition.tgname
        WHEN 'sponsorship_attributions_protect'
          THEN trigger_definition.tgenabled = 'D'
        ELSE trigger_definition.tgenabled = 'O'
      END
    )
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.sponsorship_attributions'::regclass
      AND NOT trigger_definition.tgisinternal
  ),
  'the historical replay disables only attribution immutability while audit remains enabled'
);

UPDATE public.sponsorship_attributions attribution
SET
  analytics_eligible = NULL,
  analytics_exclusion_reason = NULL
WHERE attribution.sponsorship_intent_id IN (
  '96000000-0000-4000-8000-000000000311'::uuid,
  '96000000-0000-4000-8000-000000000312'::uuid,
  '96000000-0000-4000-8000-000000000313'::uuid
);

SELECT extensions.is(
  private.backfill_attribution_analytics_eligibility(),
  3::bigint,
  'the historical backfill classifies every previously unclassified attribution once'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      CASE attribution.sponsorship_intent_id
        WHEN '96000000-0000-4000-8000-000000000311'::uuid
          THEN NOT attribution.analytics_eligible
            AND attribution.analytics_exclusion_reason = 'creator_share_staff'
        WHEN '96000000-0000-4000-8000-000000000312'::uuid
          THEN NOT attribution.analytics_eligible
            AND attribution.analytics_exclusion_reason = 'same_advocate_member'
        ELSE attribution.analytics_eligible
          AND attribution.analytics_exclusion_reason IS NULL
      END
    )
    FROM public.sponsorship_attributions attribution
    WHERE attribution.sponsorship_intent_id IN (
      '96000000-0000-4000-8000-000000000311'::uuid,
      '96000000-0000-4000-8000-000000000312'::uuid,
      '96000000-0000-4000-8000-000000000313'::uuid
    )
  ),
  'historical staff and same-portal members are excluded while unrelated sponsors remain eligible'
);

SELECT extensions.is(
  private.backfill_attribution_analytics_eligibility(),
  0::bigint,
  'the historical eligibility backfill is idempotent'
);

ALTER TABLE public.sponsorship_attributions
  ENABLE TRIGGER sponsorship_attributions_protect;

SELECT extensions.is(
  (
    SELECT trigger_definition.tgenabled
    FROM pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.sponsorship_attributions'::regclass
      AND trigger_definition.tgname = 'sponsorship_attributions_protect'
  ),
  'O'::"char",
  'attribution immutability is restored immediately after the historical replay'
);

ALTER TABLE public.sponsorship_attributions
  ALTER COLUMN analytics_eligible SET NOT NULL;

SELECT * FROM extensions.finish();

ROLLBACK;
