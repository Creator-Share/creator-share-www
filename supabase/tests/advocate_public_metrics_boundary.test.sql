BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  (
    SELECT constraint_definition.convalidated
    FROM pg_constraint constraint_definition
    WHERE constraint_definition.conrelid =
      'public.advocate_public_metric_selections'::regclass
      AND constraint_definition.conname =
        'advocate_public_metric_selections_public_allowlist_check'
      AND constraint_definition.contype = 'c'
  ),
  'the table level public metric allowlist is validated'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND function_definition.provolatile = 'v'
      AND function_definition.prorettype = 'jsonb'::regtype
      AND function_definition.proargnames = ARRAY[
        'batch_limit',
        'request_id',
        'trace_id'
      ]::text[]
      AND coalesce(
        array_to_string(function_definition.proconfig, ','),
        ''
      ) = 'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.refresh_advocate_public_metric_releases(integer,text,text)'::regprocedure
  ),
  'the weekly worker has one fixed JSON security definer contract'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.refresh_advocate_public_metric_releases(integer,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.refresh_advocate_public_metric_releases(integer,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.refresh_advocate_public_metric_releases(integer,text,text)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges privilege
    WHERE privilege.routine_schema = 'public'
      AND privilege.routine_name =
        'refresh_advocate_public_metric_releases'
      AND privilege.grantee = 'PUBLIC'
      AND privilege.privilege_type = 'EXECUTE'
  ),
  'only the service role can execute the weekly release worker'
);

SELECT extensions.ok(
  position(
    'auth.role()' IN pg_get_functiondef(
      'private.require_advocate_public_metric_service_role()'::regprocedure
    )
  ) > 0
  AND position(
    'request.jwt.claim.role' IN pg_get_functiondef(
      'private.require_advocate_public_metric_service_role()'::regprocedure
    )
  ) = 0,
  'service authorization uses the current PostgREST JWT role boundary rather than a deprecated scalar claim setting'
);

SELECT extensions.ok(
  to_regprocedure(
    'public.replace_advocate_public_metrics(uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)'
  ) IS NULL
  AND has_function_privilege(
    'service_role',
    'public.replace_advocate_public_metrics(uuid,uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.replace_advocate_public_metrics(uuid,uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.replace_advocate_public_metrics(uuid,uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)',
    'EXECUTE'
  ),
  'the former browser mutation is gone and its actor aware replacement is service only'
);

SELECT extensions.is(
  (
    SELECT function_definition.proargnames
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.replace_advocate_public_metrics(uuid,uuid,bigint,public.advocate_public_metric_key[],text,text,text,text)'::regprocedure
  ),
  ARRAY[
    'target_advocate_id',
    'acting_user_id',
    'expected_advocate_version',
    'target_metric_keys',
    'change_reason',
    'request_id',
    'trace_id',
    'session_id'
  ]::text[],
  'the actor aware mutation names exactly the trusted application inputs'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'private.advocate_public_metric_releases',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_public_metric_releases',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_public_metric_releases',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.advocate_public_metric_releases',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.advocate_public_metric_releases',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.advocate_public_metric_releases',
    'SELECT'
  ),
  'no API role can inspect or mutate the private release ledger directly'
);

SELECT extensions.ok(
  (
    SELECT array_agg(
      column_definition.column_name::text
      ORDER BY column_definition.ordinal_position
    )
    FROM information_schema.columns column_definition
    WHERE column_definition.table_schema = 'private'
      AND column_definition.table_name =
        'advocate_public_metric_releases'
  ) = ARRAY[
    'advocate_id',
    'metric_key',
    'policy_version',
    'released_bucket',
    'unit',
    'source_cutoff',
    'created_at'
  ]::text[],
  'the release ledger stores no raw totals, support counts, sponsor facts, or release identifiers'
);

SELECT extensions.ok(
  position(
    'pg_try_advisory_xact_lock' IN pg_get_functiondef(
      'public.refresh_advocate_public_metric_releases(integer,text,text)'::regprocedure
    )
  ) > 0
  AND position(
    'LIMIT batch_limit' IN pg_get_functiondef(
      'public.refresh_advocate_public_metric_releases(integer,text,text)'::regprocedure
    )
  ) > 0,
  'the weekly worker has a transaction concurrency fence and a bounded batch'
);

INSERT INTO public.advocates (
  id,
  slug,
  display_name,
  relationship_status,
  publication_status,
  beneficiary_mode
)
VALUES (
  '97000000-0000-4000-8000-000000000099',
  'publicmetriccleanup',
  'Public Metric Cleanup',
  'active',
  'draft',
  'all'
);

ALTER TABLE public.advocate_public_metric_selections
  DROP CONSTRAINT
    advocate_public_metric_selections_public_allowlist_check;

INSERT INTO public.advocate_public_metric_selections (
  advocate_id,
  metric_key,
  display_order,
  created_at,
  updated_at
)
VALUES
  (
    '97000000-0000-4000-8000-000000000099',
    'children_sponsored',
    0,
    clock_timestamp() - interval '3 days',
    clock_timestamp() - interval '2 days'
  ),
  (
    '97000000-0000-4000-8000-000000000099',
    'unique_sponsor_contacts',
    1,
    clock_timestamp() - interval '3 days',
    clock_timestamp() - interval '2 days'
  ),
  (
    '97000000-0000-4000-8000-000000000099',
    'gross_raised_usd',
    2,
    clock_timestamp() - interval '3 days',
    clock_timestamp() - interval '2 days'
  );

CREATE TEMP TABLE public_metric_cleanup_before
ON COMMIT DROP
AS
SELECT
  advocate.version AS advocate_version,
  jsonb_object_agg(
    selection.metric_key,
    jsonb_build_object(
      'created_at', selection.created_at,
      'updated_at', selection.updated_at
    )
  ) FILTER (
    WHERE selection.metric_key IN (
      'children_sponsored',
      'gross_raised_usd'
    )
  ) AS survivor_times
FROM public.advocates advocate
JOIN public.advocate_public_metric_selections selection
  ON selection.advocate_id = advocate.id
WHERE advocate.id = '97000000-0000-4000-8000-000000000099'
GROUP BY advocate.version;

SELECT extensions.is(
  private.restrict_advocate_public_metric_selections_v1(),
  1::bigint,
  'the locked cleanup reports exactly one affected advocate'
);

SELECT extensions.is(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'key', selection.metric_key,
        'display_order', selection.display_order
      )
      ORDER BY selection.display_order
    )
    FROM public.advocate_public_metric_selections selection
    WHERE selection.advocate_id =
      '97000000-0000-4000-8000-000000000099'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'key', 'children_sponsored',
      'display_order', 0
    ),
    jsonb_build_object(
      'key', 'gross_raised_usd',
      'display_order', 1
    )
  ),
  'cleanup removes the unsafe middle selection and compacts safe survivors to orders zero and one'
);

SELECT extensions.ok(
  (
    SELECT advocate.version = before.advocate_version + 1
    FROM public.advocates advocate
    CROSS JOIN public_metric_cleanup_before before
    WHERE advocate.id = '97000000-0000-4000-8000-000000000099'
  )
  AND (
    SELECT jsonb_object_agg(
      selection.metric_key,
      jsonb_build_object(
        'created_at', selection.created_at,
        'updated_at', selection.updated_at
      )
    ) = before.survivor_times
    FROM public.advocate_public_metric_selections selection
    CROSS JOIN public_metric_cleanup_before before
    WHERE selection.advocate_id =
      '97000000-0000-4000-8000-000000000099'
    GROUP BY before.survivor_times
  ),
  'cleanup advances the aggregate version exactly once while preserving survivor timestamps'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id =
        '97000000-0000-4000-8000-000000000099'
      AND event.table_name = 'advocate_public_metric_selections'
      AND event.operation = 'DELETE'
      AND event.actor_type = 'system'
      AND event.system_actor = 'advocate-public-metrics-migration'
      AND event.request_id =
        '20260718151000-public-metric-allowlist'
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.advocate_id =
        '97000000-0000-4000-8000-000000000099'
      AND event.table_name = 'advocates'
      AND event.operation = 'UPDATE'
      AND event.actor_type = 'system'
      AND event.system_actor = 'advocate-public-metrics-migration'
      AND event.request_id =
        '20260718151000-public-metric-allowlist'
  ),
  'cleanup memorializes selection replacement and aggregate version advancement under system audit context'
);

ALTER TABLE public.advocate_public_metric_selections
  ADD CONSTRAINT advocate_public_metric_selections_public_allowlist_check
  CHECK (
    metric_key IN (
      'children_sponsored',
      'gross_raised_usd',
      'direct_sponsorships',
      'post_visit_attributed_sponsorships'
    )
  ) NOT VALID;

ALTER TABLE public.advocate_public_metric_selections
  VALIDATE CONSTRAINT
    advocate_public_metric_selections_public_allowlist_check;

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocate_public_metric_selections (
      advocate_id,
      metric_key,
      display_order
    )
    VALUES (
      gen_random_uuid(),
      'unique_sponsor_contacts',
      0
    )
  $$,
  '23514',
  NULL,
  'the table rejects private analytics enum values even outside the mutation RPC'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.refresh_advocate_public_metric_releases(
      0,
      'public-metric-invalid-batch'
    )
  $$,
  '22023',
  'Public metric refresh batch limit must be between 1 and 100',
  'the worker rejects a batch below its lower bound'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.refresh_advocate_public_metric_releases(
      101,
      'public-metric-invalid-batch'
    )
  $$,
  '22023',
  'Public metric refresh batch limit must be between 1 and 100',
  'the worker rejects a batch above its upper bound'
);

CREATE TEMP TABLE public_metric_test_times (
  key text PRIMARY KEY,
  value timestamp with time zone NOT NULL
) ON COMMIT DROP;

INSERT INTO public_metric_test_times (key, value)
VALUES (
  'source_cutoff',
  (
    date_trunc('week', clock_timestamp() AT TIME ZONE 'UTC')
      - interval '7 days'
  ) AT TIME ZONE 'UTC'
);

CREATE TEMP TABLE public_metric_test_advocates (
  fixture_key text PRIMARY KEY,
  advocate_id uuid NOT NULL,
  domain_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO public_metric_test_advocates (
  fixture_key,
  advocate_id,
  domain_id
)
VALUES
  (
    'full',
    '97000000-0000-4000-8000-000000000001',
    '97000000-0000-4000-8000-000000000011'
  ),
  (
    'small',
    '97000000-0000-4000-8000-000000000002',
    '97000000-0000-4000-8000-000000000012'
  );

CREATE TEMP TABLE public_metric_test_beneficiaries (
  advocate_id uuid NOT NULL,
  ordinal integer NOT NULL,
  beneficiary_id uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY (advocate_id, ordinal)
) ON COMMIT DROP;

INSERT INTO public_metric_test_beneficiaries (advocate_id, ordinal)
SELECT fixture.advocate_id, ordinal
FROM public_metric_test_advocates fixture
CROSS JOIN generate_series(
  1,
  CASE fixture.fixture_key WHEN 'full' THEN 10 ELSE 4 END
) ordinal;

CREATE TEMP TABLE public_metric_test_facts (
  label text PRIMARY KEY,
  advocate_id uuid NOT NULL,
  domain_id uuid NOT NULL,
  attribution_kind public.sponsorship_attribution_kind NOT NULL,
  exposure_lag interval,
  contact_group text NOT NULL,
  subject_kind public.sponsorship_subject_kind NOT NULL,
  beneficiary_id uuid,
  partnership_project public.project_type,
  payment_mode public.sponsorship_payment_mode NOT NULL,
  recurrence_interval text,
  amount_usd_cents bigint NOT NULL,
  analytics_eligible boolean NOT NULL,
  effective_at timestamp with time zone NOT NULL,
  identity_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),
  gateway_event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL DEFAULT gen_random_uuid()
) ON COMMIT DROP;

INSERT INTO public_metric_test_facts (
  label,
  advocate_id,
  domain_id,
  attribution_kind,
  exposure_lag,
  contact_group,
  subject_kind,
  beneficiary_id,
  payment_mode,
  recurrence_interval,
  amount_usd_cents,
  analytics_eligible,
  effective_at
)
SELECT
  format('full-direct-%s', beneficiary.ordinal),
  fixture.advocate_id,
  fixture.domain_id,
  'direct',
  NULL,
  format('full-direct-contact-%s', beneficiary.ordinal),
  'standard',
  beneficiary.beneficiary_id,
  'recurring',
  'month',
  1000,
  true,
  cutoff.value - interval '28 days'
FROM public_metric_test_advocates fixture
JOIN public_metric_test_beneficiaries beneficiary
  ON beneficiary.advocate_id = fixture.advocate_id
 AND beneficiary.ordinal BETWEEN 1 AND 5
CROSS JOIN public_metric_test_times cutoff
WHERE fixture.fixture_key = 'full'
  AND cutoff.key = 'source_cutoff';

INSERT INTO public_metric_test_facts (
  label,
  advocate_id,
  domain_id,
  attribution_kind,
  exposure_lag,
  contact_group,
  subject_kind,
  beneficiary_id,
  payment_mode,
  recurrence_interval,
  amount_usd_cents,
  analytics_eligible,
  effective_at
)
SELECT
  format('full-post-%s', beneficiary.ordinal - 5),
  fixture.advocate_id,
  fixture.domain_id,
  'post_visit_attributed',
  interval '7 days',
  format('full-post-contact-%s', beneficiary.ordinal - 5),
  CASE
    WHEN beneficiary.ordinal = 10 THEN 'blind'
    ELSE 'standard'
  END::public.sponsorship_subject_kind,
  CASE
    WHEN beneficiary.ordinal = 10 THEN NULL
    ELSE beneficiary.beneficiary_id
  END,
  CASE
    WHEN beneficiary.ordinal = 10 THEN 'recurring'
    ELSE 'one_time'
  END::public.sponsorship_payment_mode,
  CASE
    WHEN beneficiary.ordinal = 10 THEN 'month'
    ELSE NULL
  END,
  2000,
  true,
  cutoff.value - interval '14 days'
FROM public_metric_test_advocates fixture
JOIN public_metric_test_beneficiaries beneficiary
  ON beneficiary.advocate_id = fixture.advocate_id
 AND beneficiary.ordinal BETWEEN 6 AND 10
CROSS JOIN public_metric_test_times cutoff
WHERE fixture.fixture_key = 'full'
  AND cutoff.key = 'source_cutoff';

INSERT INTO public_metric_test_facts (
  label,
  advocate_id,
  domain_id,
  attribution_kind,
  exposure_lag,
  contact_group,
  subject_kind,
  beneficiary_id,
  partnership_project,
  payment_mode,
  recurrence_interval,
  amount_usd_cents,
  analytics_eligible,
  effective_at
)
SELECT
  extra.label,
  fixture.advocate_id,
  fixture.domain_id,
  extra.attribution_kind::public.sponsorship_attribution_kind,
  extra.exposure_lag,
  extra.contact_group,
  extra.subject_kind::public.sponsorship_subject_kind,
  CASE
    WHEN extra.subject_kind = 'standard' THEN beneficiary.beneficiary_id
    ELSE NULL
  END,
  CASE
    WHEN extra.subject_kind = 'partnership'
      THEN 'general'::public.project_type
    ELSE NULL
  END,
  'one_time',
  NULL,
  extra.amount_usd_cents,
  extra.analytics_eligible,
  cutoff.value - interval '28 days'
FROM public_metric_test_advocates fixture
JOIN public_metric_test_beneficiaries beneficiary
  ON beneficiary.advocate_id = fixture.advocate_id
 AND beneficiary.ordinal = 1
CROSS JOIN public_metric_test_times cutoff
CROSS JOIN (
  VALUES
    (
      'full-unassigned-blind',
      'direct',
      NULL::interval,
      'full-direct-contact-1',
      'blind',
      100::bigint,
      true
    ),
    (
      'full-partnership',
      'direct',
      NULL::interval,
      'full-direct-contact-1',
      'partnership',
      100::bigint,
      true
    ),
    (
      'full-observed-excluded',
      'post_visit_observed',
      interval '60 days',
      'full-excluded-contact-1',
      'standard',
      5000000::bigint,
      true
    ),
    (
      'full-lag-excluded',
      'post_visit_attributed',
      interval '30 days 1 second',
      'full-excluded-contact-2',
      'standard',
      5000000::bigint,
      true
    ),
    (
      'full-ineligible-excluded',
      'direct',
      NULL::interval,
      'full-excluded-contact-3',
      'standard',
      5000000::bigint,
      false
    ),
    (
      'full-member-excluded',
      'direct',
      NULL::interval,
      'full-excluded-contact-4',
      'standard',
      5000000::bigint,
      false
    )
) extra(
  label,
  attribution_kind,
  exposure_lag,
  contact_group,
  subject_kind,
  amount_usd_cents,
  analytics_eligible
)
WHERE fixture.fixture_key = 'full'
  AND cutoff.key = 'source_cutoff';

INSERT INTO public_metric_test_facts (
  label,
  advocate_id,
  domain_id,
  attribution_kind,
  exposure_lag,
  contact_group,
  subject_kind,
  beneficiary_id,
  payment_mode,
  recurrence_interval,
  amount_usd_cents,
  analytics_eligible,
  effective_at
)
SELECT
  format('small-direct-%s', beneficiary.ordinal),
  fixture.advocate_id,
  fixture.domain_id,
  'direct',
  NULL,
  format('small-contact-%s', beneficiary.ordinal),
  'standard',
  beneficiary.beneficiary_id,
  'one_time',
  NULL,
  6000,
  true,
  cutoff.value - interval '14 days'
FROM public_metric_test_advocates fixture
JOIN public_metric_test_beneficiaries beneficiary
  ON beneficiary.advocate_id = fixture.advocate_id
CROSS JOIN public_metric_test_times cutoff
WHERE fixture.fixture_key = 'small'
  AND cutoff.key = 'source_cutoff';

SET LOCAL session_replication_role = replica;

INSERT INTO public.advocates (
  id,
  slug,
  display_name,
  relationship_status,
  publication_status,
  beneficiary_mode,
  published_at
)
SELECT
  fixture.advocate_id,
  'publicmetrics' || CASE fixture.fixture_key
    WHEN 'full' THEN 'full'
    ELSE 'small'
  END,
  'Public Metrics ' || initcap(fixture.fixture_key),
  'active',
  'active',
  'all',
  cutoff.value - interval '30 days'
FROM public_metric_test_advocates fixture
CROSS JOIN public_metric_test_times cutoff
WHERE cutoff.key = 'source_cutoff';

INSERT INTO public.advocate_branding (advocate_id)
SELECT fixture.advocate_id
FROM public_metric_test_advocates fixture;

INSERT INTO public.advocate_domains (
  id,
  advocate_id,
  hostname,
  is_primary,
  status,
  dns_verified_at,
  tls_ready_at,
  payments_ready_at,
  activated_at
)
SELECT
  fixture.domain_id,
  fixture.advocate_id,
  'publicmetrics' || CASE fixture.fixture_key
    WHEN 'full' THEN 'full'
    ELSE 'small'
  END || '.creatorshare.com',
  true,
  'active',
  cutoff.value - interval '30 days',
  cutoff.value - interval '30 days',
  cutoff.value - interval '30 days',
  cutoff.value - interval '30 days'
FROM public_metric_test_advocates fixture
CROSS JOIN public_metric_test_times cutoff
WHERE cutoff.key = 'source_cutoff';

INSERT INTO public.advocate_public_metric_selections (
  advocate_id,
  metric_key,
  display_order
)
SELECT
  fixture.advocate_id,
  metric.metric_key::public.advocate_public_metric_key,
  metric.display_order
FROM public_metric_test_advocates fixture
CROSS JOIN (
  VALUES
    ('children_sponsored', 0),
    ('gross_raised_usd', 1),
    ('direct_sponsorships', 2),
    ('post_visit_attributed_sponsorships', 3)
) metric(metric_key, display_order)
WHERE fixture.fixture_key = 'small'
   OR metric.metric_key <> 'post_visit_attributed_sponsorships';

INSERT INTO public.beneficiaries (
  id,
  name,
  username,
  birth_date,
  budget_goal,
  status,
  beneficiary_type
)
SELECT
  beneficiary.beneficiary_id,
  format('Public Metric Child %s', beneficiary.beneficiary_id),
  'public-metric-child-' || replace(beneficiary.beneficiary_id::text, '-', ''),
  '2012-01-01',
  5000,
  'New',
  'IN_OUR_CARE'
FROM public_metric_test_beneficiaries beneficiary;

INSERT INTO public.sponsor_identities (
  id,
  status,
  created_at,
  updated_at
)
SELECT
  fact.identity_id,
  'active',
  fact.effective_at - interval '1 day',
  fact.effective_at
FROM public_metric_test_facts fact;

INSERT INTO public.sponsorship_intents (
  id,
  idempotency_key,
  source,
  source_host,
  source_advocate_id,
  source_advocate_domain_id,
  sponsor_identity_id,
  contact_email_hmac,
  contact_email_normalization_version,
  contact_email_hmac_key_version,
  subject_kind,
  beneficiary_id,
  partnership_project,
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
  fact.intent_id,
  'public-metric-intent-' || fact.label,
  CASE
    WHEN fact.attribution_kind = 'direct' THEN 'advocate_domain'
    ELSE 'primary_site'
  END::public.sponsorship_intent_source,
  CASE
    WHEN fact.attribution_kind = 'direct'
      THEN domain.hostname
    ELSE 'creatorshare.com'
  END,
  CASE
    WHEN fact.attribution_kind = 'direct' THEN fact.advocate_id
    ELSE NULL
  END,
  CASE
    WHEN fact.attribution_kind = 'direct' THEN fact.domain_id
    ELSE NULL
  END,
  fact.identity_id,
  extensions.digest(fact.contact_group, 'sha256'),
  1,
  1,
  fact.subject_kind,
  fact.beneficiary_id,
  fact.partnership_project,
  fact.payment_mode,
  fact.recurrence_interval,
  fact.amount_usd_cents,
  fact.amount_usd_cents,
  'USD',
  1,
  fact.effective_at - interval '1 day',
  'public-metric-test',
  'succeeded',
  fact.effective_at - interval '1 hour',
  fact.effective_at,
  fact.effective_at - interval '1 day',
  fact.effective_at
FROM public_metric_test_facts fact
JOIN public.advocate_domains domain ON domain.id = fact.domain_id;

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
  fact.intent_id,
  fact.attribution_kind,
  fact.advocate_id,
  CASE
    WHEN fact.attribution_kind = 'direct' THEN NULL
    ELSE gen_random_uuid()
  END,
  fact.exposure_lag,
  '{}'::jsonb,
  fact.effective_at,
  fact.effective_at,
  fact.effective_at,
  fact.analytics_eligible,
  CASE
    WHEN fact.analytics_eligible THEN NULL
    WHEN fact.label = 'full-member-excluded'
      THEN 'same_advocate_member'
    ELSE 'creator_share_staff'
  END
FROM public_metric_test_facts fact;

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
  fact.movement_id,
  fact.gateway_event_id,
  fact.payment_attempt_id,
  fact.intent_id,
  fact.identity_id,
  'STRIPE',
  'stripe_us',
  'payment',
  'public-metric-payment-' || fact.label,
  'sponsorship_payment',
  fact.payment_mode,
  fact.amount_usd_cents,
  fact.amount_usd_cents,
  'USD',
  1,
  fact.effective_at,
  fact.effective_at,
  NULL
FROM public_metric_test_facts fact;

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
  fact.payment_attempt_id,
  fact.intent_id,
  fact.identity_id,
  'STRIPE',
  'stripe_us',
  'payment',
  'public-metric-renewal-' || fact.label,
  'sponsorship_payment',
  fact.payment_mode,
  1000,
  1000,
  'USD',
  1,
  fact.effective_at + interval '1 day',
  fact.effective_at + interval '1 day',
  NULL
FROM public_metric_test_facts fact
WHERE fact.label LIKE 'full-direct-%';

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
  fact.payment_attempt_id,
  fact.intent_id,
  fact.identity_id,
  'STRIPE',
  'stripe_us',
  'refund',
  'public-metric-refund-' || fact.label,
  'sponsorship_refund',
  fact.payment_mode,
  999999,
  999999,
  'USD',
  1,
  fact.effective_at + interval '2 days',
  fact.effective_at + interval '2 days',
  fact.movement_id
FROM public_metric_test_facts fact
WHERE fact.label = 'full-direct-1';

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
  fact.subscription_id,
  fact.effective_at,
  beneficiary.beneficiary_id,
  'complete',
  fact.amount_usd_cents::integer,
  'month',
  NULL,
  'STRIPE',
  fact.amount_usd_cents::integer,
  'USD',
  1,
  fact.intent_id,
  fact.identity_id,
  fact.payment_attempt_id,
  'stripe_us',
  'subscription',
  'sub-public-metric-blind',
  'blind',
  fact.gateway_event_id,
  'paid',
  fact.effective_at,
  100,
  'event-public-metric-blind'
FROM public_metric_test_facts fact
JOIN public_metric_test_beneficiaries beneficiary
  ON beneficiary.advocate_id = fact.advocate_id
 AND beneficiary.ordinal = 10
WHERE fact.label = 'full-post-5';

INSERT INTO public.subscription_beneficiary_assignments (
  subscription_id,
  beneficiary_id,
  sponsorship_intent_id,
  sponsor_identity_id,
  assignment_source,
  assignment_reason,
  created_at
)
SELECT
  fact.subscription_id,
  beneficiary.beneficiary_id,
  fact.intent_id,
  fact.identity_id,
  'creator_share_admin',
  'Assign the blind public metric fixture before its release cutoff',
  fact.effective_at + interval '1 day'
FROM public_metric_test_facts fact
JOIN public_metric_test_beneficiaries beneficiary
  ON beneficiary.advocate_id = fact.advocate_id
 AND beneficiary.ordinal = 10
WHERE fact.label = 'full-post-5';

SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT audit.set_actor_context(
  context_actor_type => 'system'::audit.audit_actor_type,
  context_system_actor => 'advocate-public-metrics-test-fixture',
  context_tool => 'database-test',
  context_request_id => 'public-metric-prior-releases',
  context_reason => 'Seed internally consistent prior public metric lower bounds',
  context_metadata => jsonb_build_object(
    'operation', 'prepare_fixture',
    'resource_kind', 'advocate_public_metric_releases',
    'resource_id', 'public-v1'
  )
);

SELECT pg_catalog.set_config(
  'app.advocate_public_metric_release.operation',
  'refresh-public-v1',
  true
);

INSERT INTO private.advocate_public_metric_releases (
  advocate_id,
  metric_key,
  policy_version,
  released_bucket,
  unit,
  source_cutoff
)
SELECT
  '97000000-0000-4000-8000-000000000001',
  prior.metric_key::public.advocate_public_metric_key,
  'public-v1',
  prior.released_bucket,
  prior.unit,
  cutoff.value - interval '21 days'
FROM public_metric_test_times cutoff
CROSS JOIN (
  VALUES
    ('children_sponsored', 5::bigint, 'count'),
    ('gross_raised_usd', 10000::bigint, 'usd_cents'),
    ('direct_sponsorships', 5::bigint, 'count')
) prior(metric_key, released_bucket, unit)
WHERE cutoff.key = 'source_cutoff';

SELECT extensions.ok(
  (
    SELECT candidate.candidate_bucket IS NULL
      AND candidate.metric_unit = 'usd_cents'
    FROM public_metric_test_times cutoff
    CROSS JOIN LATERAL private.calculate_advocate_public_metric_candidate(
        '97000000-0000-4000-8000-000000000002',
        'gross_raised_usd',
        cutoff.value - interval '21 days',
        10000,
        cutoff.value
      ) candidate
    WHERE cutoff.key = 'source_cutoff'
  ),
  'four new contacts cannot advance a larger monetary bucket after a prior release'
);

SELECT extensions.ok(
  (
    SELECT candidate.candidate_bucket = 5
      AND candidate.metric_unit = 'count'
    FROM public_metric_test_times cutoff
    CROSS JOIN LATERAL private.calculate_advocate_public_metric_candidate(
        '97000000-0000-4000-8000-000000000001',
        'post_visit_attributed_sponsorships',
        NULL,
        NULL,
        cutoff.value
      ) candidate
    WHERE cutoff.key = 'source_cutoff'
  ),
  'five contacts permit the first rounded post visit release'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.refresh_advocate_public_metric_releases(
      1,
      'public-metric-capacity-guard'
    )
  $$,
  '54000',
  'Active advocate count exceeds public metric refresh batch capacity',
  'the worker fails closed before a bounded batch could starve later advocates'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM private.advocate_public_metric_releases
  ),
  3::bigint,
  'the capacity guard writes no partial release rows'
);

CREATE TEMP TABLE public_metric_test_results (
  invocation integer PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO public_metric_test_results (invocation, payload)
VALUES (
  1,
  public.refresh_advocate_public_metric_releases(
    100,
    'public-metric-release-first',
    'public-metric-release-trace'
  )
);

SELECT extensions.is(
  (
    SELECT array_agg(key ORDER BY key)
    FROM public_metric_test_results result
    CROSS JOIN LATERAL jsonb_object_keys(result.payload) key
    WHERE result.invocation = 1
  ),
  ARRAY[
    'inserted_releases',
    'pending_metrics',
    'policy_version',
    'processed_advocates',
    'source_cutoff'
  ]::text[],
  'the worker returns only its five fixed aggregate fields'
);

SELECT extensions.ok(
  (
    SELECT
      jsonb_typeof(payload -> 'processed_advocates') = 'number'
      AND jsonb_typeof(payload -> 'inserted_releases') = 'number'
      AND jsonb_typeof(payload -> 'pending_metrics') = 'number'
      AND (payload ->> 'processed_advocates')::integer = 2
      AND (payload ->> 'inserted_releases')::integer = 3
      AND (payload ->> 'pending_metrics')::integer = 5
      AND payload ->> 'policy_version' = 'public-v1'
      AND payload ->> 'source_cutoff' ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T00:00:00Z$'
      AND (
        (payload ->> 'inserted_releases')::integer
        + (payload ->> 'pending_metrics')::integer
      ) = (payload ->> 'processed_advocates')::integer * 4
    FROM public_metric_test_results
    WHERE invocation = 1
  ),
  'the first batch advances two delta gated metrics, creates one initial release, and leaves five candidates pending'
);

SELECT extensions.ok(
  (
    SELECT
      extract(isodow FROM cutoff.value AT TIME ZONE 'UTC') = 1
      AND (cutoff.value AT TIME ZONE 'UTC')::time = time '00:00:00'
      AND cutoff.value <= clock_timestamp() - interval '7 days'
      AND result.payload ->> 'source_cutoff' = to_char(
        cutoff.value AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      )
    FROM public_metric_test_times cutoff
    CROSS JOIN public_metric_test_results result
    WHERE cutoff.key = 'source_cutoff'
      AND result.invocation = 1
  ),
  'the source cutoff is an internally derived Monday UTC boundary under a seven day embargo'
);

SELECT extensions.is(
  (
    SELECT jsonb_object_agg(
      release.metric_key,
      jsonb_build_object(
        'value', release.released_bucket,
        'unit', release.unit
      )
    )
    FROM (
      SELECT DISTINCT ON (stored.metric_key)
        stored.metric_key,
        stored.released_bucket,
        stored.unit
      FROM private.advocate_public_metric_releases stored
      WHERE stored.advocate_id =
        '97000000-0000-4000-8000-000000000001'
        AND stored.policy_version = 'public-v1'
      ORDER BY stored.metric_key, stored.source_cutoff DESC
    ) release
  ),
  jsonb_build_object(
    'children_sponsored', jsonb_build_object(
      'value', 10,
      'unit', 'count'
    ),
    'gross_raised_usd', jsonb_build_object(
      'value', 20000,
      'unit', 'usd_cents'
    ),
    'direct_sponsorships', jsonb_build_object(
      'value', 5,
      'unit', 'count'
    ),
    'post_visit_attributed_sponsorships', jsonb_build_object(
      'value', 5,
      'unit', 'count'
    )
  ),
  'each metric independently releases the expected lower bound from official eligible facts'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM private.advocate_public_metric_releases release
    WHERE release.advocate_id =
      '97000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'four distinct contacts never produce a public release even when the monetary bucket changed'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.schema_name = 'private'
      AND event.table_name = 'advocate_public_metric_releases'
      AND event.operation = 'INSERT'
      AND event.actor_type = 'system'
      AND event.system_actor = 'advocate-public-metrics-worker'
      AND event.tool = 'advocate-public-metrics-refresh'
      AND event.request_id = 'public-metric-release-first'
      AND event.trace_id = 'public-metric-release-trace'
      AND event.reason =
        'Publish privacy protected weekly advocate metric buckets'
  ),
  'every release is memorialized under the fixed system worker audit identity'
);

SELECT extensions.ok(
  (
    SELECT jsonb_array_length(snapshot -> 'metricSelections') = 3
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(snapshot -> 'metricSelections') metric
        WHERE metric ->> 'key' =
          'post_visit_attributed_sponsorships'
      )
    FROM (
      SELECT public.read_public_advocate_presentation_snapshot(
        'publicmetricsfull.creatorshare.com'
      ) AS snapshot
    ) public_snapshot
  )
  AND EXISTS (
    SELECT 1
    FROM private.advocate_public_metric_releases release
    WHERE release.advocate_id =
      '97000000-0000-4000-8000-000000000001'
      AND release.metric_key =
        'post_visit_attributed_sponsorships'
      AND release.released_bucket = 5
  ),
  'the worker calculates an unselected safe metric without exposing it publicly'
);

INSERT INTO public.advocate_public_metric_selections (
  advocate_id,
  metric_key,
  display_order
)
VALUES (
  '97000000-0000-4000-8000-000000000001',
  'post_visit_attributed_sponsorships',
  3
);

SELECT extensions.ok(
  (
    SELECT count(*)
    FROM private.advocate_public_metric_releases
    WHERE advocate_id =
      '97000000-0000-4000-8000-000000000001'
  ) = 6
  AND (
    SELECT snapshot #>> '{metricSelections,3,value}' = '5'
      AND snapshot #>> '{metricSelections,3,status}' = 'published'
    FROM (
      SELECT public.read_public_advocate_presentation_snapshot(
        'publicmetricsfull.creatorshare.com'
      ) AS snapshot
    ) public_snapshot
  ),
  'later selection reveals the prior release without calculating or changing it'
);

INSERT INTO public_metric_test_results (invocation, payload)
VALUES (
  2,
  public.refresh_advocate_public_metric_releases(
    100,
    'public-metric-release-repeat'
  )
);

SELECT extensions.ok(
  (
    SELECT
      (payload ->> 'processed_advocates')::integer = 2
      AND (payload ->> 'inserted_releases')::integer = 0
      AND (payload ->> 'pending_metrics')::integer = 8
    FROM public_metric_test_results
    WHERE invocation = 2
  )
  AND (
    SELECT count(*)
    FROM private.advocate_public_metric_releases
  ) = 6,
  'repeating the same weekly batch is idempotent and cannot advance an unchanged bucket cursor'
);

SELECT extensions.is(
  (
    SELECT snapshot -> 'metricSelections'
    FROM (
      SELECT public.read_public_advocate_presentation_snapshot(
        'publicmetricsfull.creatorshare.com'
      ) AS snapshot
    ) public_snapshot
  ),
  jsonb_build_array(
    jsonb_build_object(
      'key', 'children_sponsored',
      'display_order', 0,
      'status', 'published',
      'value', '10',
      'unit', 'count',
      'qualifier', 'at_least',
      'as_of', (
        SELECT payload ->> 'source_cutoff'
        FROM public_metric_test_results
        WHERE invocation = 1
      )
    ),
    jsonb_build_object(
      'key', 'gross_raised_usd',
      'display_order', 1,
      'status', 'published',
      'value', '20000',
      'unit', 'usd_cents',
      'qualifier', 'at_least',
      'as_of', (
        SELECT payload ->> 'source_cutoff'
        FROM public_metric_test_results
        WHERE invocation = 1
      )
    ),
    jsonb_build_object(
      'key', 'direct_sponsorships',
      'display_order', 2,
      'status', 'published',
      'value', '5',
      'unit', 'count',
      'qualifier', 'at_least',
      'as_of', (
        SELECT to_char(
          cutoff.value AT TIME ZONE 'UTC' - interval '21 days',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
        FROM public_metric_test_times cutoff
        WHERE cutoff.key = 'source_cutoff'
      )
    ),
    jsonb_build_object(
      'key', 'post_visit_attributed_sponsorships',
      'display_order', 3,
      'status', 'published',
      'value', '5',
      'unit', 'count',
      'qualifier', 'at_least',
      'as_of', (
        SELECT payload ->> 'source_cutoff'
        FROM public_metric_test_results
        WHERE invocation = 1
      )
    )
  ),
  'the public snapshot returns only ordered published lower bounds with RFC3339 cutoffs'
);

SELECT extensions.is(
  (
    SELECT snapshot -> 'metricSelections'
    FROM (
      SELECT public.read_public_advocate_presentation_snapshot(
        'publicmetricssmall.creatorshare.com'
      ) AS snapshot
    ) public_snapshot
  ),
  jsonb_build_array(
    jsonb_build_object(
      'key', 'children_sponsored',
      'display_order', 0,
      'status', 'pending',
      'value', NULL,
      'unit', NULL,
      'qualifier', NULL,
      'as_of', NULL
    ),
    jsonb_build_object(
      'key', 'gross_raised_usd',
      'display_order', 1,
      'status', 'pending',
      'value', NULL,
      'unit', NULL,
      'qualifier', NULL,
      'as_of', NULL
    ),
    jsonb_build_object(
      'key', 'direct_sponsorships',
      'display_order', 2,
      'status', 'pending',
      'value', NULL,
      'unit', NULL,
      'qualifier', NULL,
      'as_of', NULL
    ),
    jsonb_build_object(
      'key', 'post_visit_attributed_sponsorships',
      'display_order', 3,
      'status', 'pending',
      'value', NULL,
      'unit', NULL,
      'qualifier', NULL,
      'as_of', NULL
    )
  ),
  'an unreleased metric remains generically pending without exposing threshold or support state'
);

SELECT extensions.ok(
  (
    SELECT bool_and(
      (
        SELECT array_agg(key ORDER BY key)
        FROM jsonb_object_keys(metric.value) key
      ) = ARRAY[
        'as_of',
        'display_order',
        'key',
        'qualifier',
        'status',
        'unit',
        'value'
      ]::text[]
    )
    FROM jsonb_array_elements(
      public.read_public_advocate_presentation_snapshot(
        'publicmetricsfull.creatorshare.com'
      ) -> 'metricSelections'
    ) metric(value)
  ),
  'public metric items expose exactly seven allowlisted fields and no internal release identity'
);

SELECT extensions.throws_ok(
  $$
    UPDATE private.advocate_public_metric_releases
    SET released_bucket = released_bucket + 5
    WHERE advocate_id =
      '97000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'Advocate public metric releases are append only',
  'release rows cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM private.advocate_public_metric_releases
    WHERE advocate_id =
      '97000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'Advocate public metric releases are append only',
  'release rows cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    TRUNCATE private.advocate_public_metric_releases
  $$,
  '42501',
  'Operational sponsorship tables cannot be truncated',
  'the entire release ledger cannot be truncated'
);

SELECT pg_catalog.set_config(
  'app.advocate_public_metric_release.operation',
  '',
  true
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO private.advocate_public_metric_releases (
      advocate_id,
      metric_key,
      policy_version,
      released_bucket,
      unit,
      source_cutoff
    )
    VALUES (
      '97000000-0000-4000-8000-000000000001',
      'children_sponsored',
      'public-v1',
      15,
      'count',
      (
        date_trunc('week', clock_timestamp() AT TIME ZONE 'UTC')
          - interval '14 days'
      ) AT TIME ZONE 'UTC'
    )
  $$,
  '42501',
  'Advocate public metric releases require the worker RPC',
  'even a database insert requires the narrow worker operation context'
);

SELECT * FROM extensions.finish();

ROLLBACK;
