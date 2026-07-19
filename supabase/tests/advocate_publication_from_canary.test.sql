BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '60s';

SELECT extensions.plan(66);

CREATE TEMP TABLE publication_test_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  bigint_value bigint,
  text_value text,
  bytea_value bytea,
  timestamp_value timestamp with time zone
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_provisioning (
  advocate_id uuid NOT NULL,
  advocate_version bigint NOT NULL,
  domain_id uuid NOT NULL,
  hostname text NOT NULL,
  job_ids uuid[] NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_claims (
  provider public.advocate_domain_integration_provider PRIMARY KEY,
  job_id uuid NOT NULL,
  lease_token uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_runs (
  label text PRIMARY KEY,
  run_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  domain_id uuid NOT NULL,
  hostname text NOT NULL,
  expected_advocate_version bigint NOT NULL,
  deployment_id text NOT NULL,
  revision text NOT NULL,
  stripe_us_attempt_id uuid NOT NULL,
  stripe_uk_attempt_id uuid NOT NULL,
  paypal_attempt_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_leases (
  label text PRIMARY KEY,
  lease_token uuid NOT NULL,
  leased_until timestamp with time zone NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_lease_reports (
  run_id uuid PRIMARY KEY,
  report_text text NOT NULL,
  report_sha256 bytea NOT NULL,
  completed_at timestamp with time zone NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_forged_reports (
  label text PRIMARY KEY,
  report_text text NOT NULL,
  report_sha256 bytea NOT NULL,
  completed_at timestamp with time zone NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_queue_claims (
  label text PRIMARY KEY,
  run_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  domain_id uuid NOT NULL,
  hostname text NOT NULL,
  expected_advocate_version bigint NOT NULL,
  deployment_id text NOT NULL,
  revision text NOT NULL,
  stripe_us_attempt_id uuid NOT NULL,
  stripe_uk_attempt_id uuid NOT NULL,
  paypal_attempt_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL,
  start_request_id uuid NOT NULL,
  trace_id text NOT NULL,
  admin_reason text NOT NULL,
  lease_token uuid NOT NULL,
  leased_until timestamp with time zone NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.publication_provider_result(
  target_provider public.advocate_domain_integration_provider
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE target_provider
    WHEN 'cloudflare' THEN jsonb_build_object(
      'provider_status', 'dns_only_cname_ready',
      'provider_resource_id', repeat('b', 32),
      'dns_record_id', repeat('b', 32),
      'http_status', 200,
      'verified', true
    )
    WHEN 'vercel' THEN jsonb_build_object(
      'provider_status', 'attached_verified',
      'provider_resource_id', 'publicationgate.creatorshare.com',
      'deployment_id', 'dpl_publication_gate',
      'http_status', 200,
      'verified', true
    )
    ELSE jsonb_build_object(
      'provider_status', 'payment_path_ready',
      'provider_resource_id', target_provider::text || ':hosted_checkout',
      'http_status', 200,
      'verified', true
    )
  END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.publication_canonical_canary_report(
  target_run_id uuid,
  target_completed_at timestamp with time zone,
  target_execution_started_at timestamp with time zone DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH report_source AS (
    SELECT
      start.*,
      to_char(
        date_trunc(
          'milliseconds',
          COALESCE(target_execution_started_at, start.started_at)
        ) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS started_at_text,
      to_char(
        target_completed_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS completed_at_text,
      to_char(
        (date_trunc('milliseconds', start.started_at) - interval '1 day')
          AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS certificate_not_before_text,
      to_char(
        (date_trunc('milliseconds', start.started_at) + interval '1 day')
          AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS certificate_not_after_text
    FROM audit.advocate_publication_canary_starts start
    WHERE start.run_id = target_run_id
  ),
  report_steps AS (
    SELECT
      source.*,
      jsonb_build_array(
        jsonb_build_object(
          'name', 'dns_exact_host',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', source.hostname,
            'resolved', true,
            'provider_target_matched', true,
            'record_types', jsonb_build_array('A', 'CNAME'),
            'answer_count', 2,
            'observed_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'tls_exact_host',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', source.hostname,
            'server_name', source.hostname,
            'certificate_verified', true,
            'hostname_match', true,
            'normal_certificate_verification', true,
            'protocol', 'TLSv1.3',
            'certificate_not_before', source.certificate_not_before_text,
            'certificate_not_after', source.certificate_not_after_text,
            'observed_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'protected_exact_host_challenge',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', source.hostname,
            'http_status', 200,
            'response_bytes', 128,
            'response_sha256', repeat('1', 64),
            'response_verified', true,
            'verified_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'verifying_tenant_root_hidden',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', source.hostname,
            'http_status', 404,
            'content_type', 'text/html; charset=utf-8',
            'body_bytes', 64,
            'body_sha256', repeat('2', 64),
            'redirected', false,
            'generic_not_found', true
          )
        ),
        jsonb_build_object(
          'name', 'unprovisioned_sibling_hidden',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', 'unused-publicationgate.creatorshare.com',
            'http_status', 404,
            'content_type', 'text/html; charset=utf-8',
            'body_bytes', 64,
            'body_sha256', repeat('2', 64),
            'redirected', false,
            'generic_not_found', true,
            'unprovisioned', true,
            'identical_to_tenant_root', true
          )
        ),
        jsonb_build_object(
          'name', 'stripe_us_payment_canary',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'provider', 'stripe_us',
            'provider_resource_id', 'cs_live_fixtureus',
            'provider_status', 'checkout_session_expired_unpaid',
            'provider_created_at', source.started_at_text,
            'provider_return_urls_sha256', repeat('3', 64),
            'outbound_request_id_sha256', repeat('4', 64),
            'create_http_status', 200,
            'create_provider_status', 'expired',
            'cleanup_request_id_sha256', repeat('5', 64),
            'cleanup_http_status', 200,
            'cleanup_performed', true,
            'provider_credential_request_id', NULL,
            'provider_create_request_id', 'req_create_stripe_us',
            'provider_cleanup_request_id', 'req_cleanup_stripe_us',
            'financial_charge_attempted', false,
            'provider_capture_attempted', false,
            'sponsorship_state_created', false,
            'webhook_delivery_verified', false,
            'verified', true,
            'verified_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'stripe_uk_payment_canary',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'provider', 'stripe_uk',
            'provider_resource_id', 'cs_live_fixtureuk',
            'provider_status', 'checkout_session_expired_unpaid',
            'provider_created_at', source.started_at_text,
            'provider_return_urls_sha256', repeat('6', 64),
            'outbound_request_id_sha256', repeat('7', 64),
            'create_http_status', 200,
            'create_provider_status', 'expired',
            'cleanup_request_id_sha256', repeat('8', 64),
            'cleanup_http_status', 200,
            'cleanup_performed', true,
            'provider_credential_request_id', NULL,
            'provider_create_request_id', 'req_create_stripe_uk',
            'provider_cleanup_request_id', 'req_cleanup_stripe_uk',
            'financial_charge_attempted', false,
            'provider_capture_attempted', false,
            'sponsorship_state_created', false,
            'webhook_delivery_verified', false,
            'verified', true,
            'verified_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'paypal_payment_canary',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'provider', 'paypal',
            'provider_resource_id', 'I-ABCDEFGHIJKL',
            'provider_status', 'subscription_approval_pending',
            'provider_created_at', source.started_at_text,
            'provider_return_urls_sha256', repeat('9', 64),
            'outbound_request_id_sha256', repeat('a', 64),
            'create_http_status', 201,
            'create_provider_status', NULL,
            'cleanup_request_id_sha256', NULL,
            'cleanup_http_status', NULL,
            'cleanup_performed', NULL,
            'provider_credential_request_id', 'req_credential_paypal',
            'provider_create_request_id', 'req_create_paypal',
            'provider_cleanup_request_id', NULL,
            'financial_charge_attempted', false,
            'provider_capture_attempted', false,
            'sponsorship_state_created', false,
            'webhook_delivery_verified', false,
            'verified', true,
            'verified_at', source.started_at_text
          )
        )
      ) AS steps
    FROM report_source source
  )
  SELECT regexp_replace(
    jsonb_build_object(
      'schema_version', 1,
      'report_type', 'advocate_publication_canary',
      'canonicalization_version', 1,
      'target', jsonb_build_object(
        'run_id', report.run_id,
        'advocate_id', report.advocate_id,
        'domain_id', report.domain_id,
        'hostname', report.hostname,
        'expected_advocate_version', report.expected_advocate_version,
        'deployment_id', report.deployment_id,
        'revision', report.git_revision,
        'payment_attempt_ids', jsonb_build_object(
          'stripe_us', report.stripe_us_attempt_id,
          'stripe_uk', report.stripe_uk_attempt_id,
          'paypal', report.paypal_attempt_id
        )
      ),
      'started_at', report.started_at_text,
      'completed_at', report.completed_at_text,
      'outcome', 'succeeded',
      'error_code', NULL,
      'safety_claims', jsonb_build_object(
        'financial_charge_attempted', false,
        'provider_capture_attempted', false,
        'sponsorship_state_created', false,
        'webhook_delivery_verified', false
      ),
      'steps', report.steps
    )::text,
    '([,:]) ',
    '\1',
    'g'
  )
  FROM report_steps report;
$$;

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
    '9e000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'publication-admin-one@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '9e000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'publication-admin-two@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '9e000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'publication-member@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.role_assignments (
  user_id,
  role_id,
  organization_id,
  advocate_id
)
SELECT actor.user_id, role.id, NULL, NULL
FROM (
  VALUES
    ('9e000000-0000-4000-8000-000000000001'::uuid),
    ('9e000000-0000-4000-8000-000000000002'::uuid)
) AS actor(user_id)
CROSS JOIN public.roles role
WHERE role.name = 'SUPER_ADMIN';

SELECT set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

WITH created AS (
  SELECT public.create_advocate_portal(
    '9e000000-0000-4000-8000-000000000001'::uuid,
    'publicationgate',
    'Publication Gate',
    'Create the final publication boundary fixture',
    'creator',
    'publication-gate-create-request',
    'publication-gate-create-trace',
    'publication-gate-create-session'
  ) AS advocate_id
)
INSERT INTO publication_test_context (key, uuid_value)
SELECT 'advocate', advocate_id FROM created;

UPDATE publication_test_context context
SET bigint_value = advocate.version
FROM public.advocates advocate
WHERE context.key = 'advocate'
  AND advocate.id = context.uuid_value;

INSERT INTO publication_test_provisioning (
  advocate_id,
  advocate_version,
  domain_id,
  hostname,
  job_ids
)
SELECT *
FROM public.start_advocate_portal_provisioning(
  (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
  '9e100000-0000-4000-8000-000000000001'::uuid,
  'publication-provisioning-start'
);

UPDATE publication_test_context context
SET
  bigint_value = provisioning.advocate_version,
  text_value = provisioning.hostname
FROM publication_test_provisioning provisioning
WHERE context.key = 'advocate';

INSERT INTO publication_test_context (key, uuid_value)
SELECT 'domain', domain_id
FROM publication_test_provisioning;

INSERT INTO publication_test_claims (provider, job_id, lease_token)
SELECT claimed.provider, claimed.job_id, claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'publication-boundary-provider-worker',
  5,
  interval '10 minutes'
) claimed;

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  pg_temp.publication_provider_result(claim.provider)
)
FROM publication_test_claims claim;

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  pg_temp.publication_provider_result(claim.provider)
)
FROM publication_test_claims claim;

INSERT INTO publication_test_runs
SELECT
  'valid',
  canary.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
  '9e200000-0000-4000-8000-000000000001'::uuid,
  'dpl_publication_gate',
  repeat('a', 40),
  'publication-canary-valid',
  'Approve the exact tested portal'
) canary;

INSERT INTO publication_test_runs
SELECT
  'incomplete',
  canary.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
  '9e200000-0000-4000-8000-000000000002'::uuid,
  'dpl_publication_queue',
  repeat('e', 40),
  'publication-canary-incomplete',
  'Retain an incomplete transport recovery fixture'
) canary;

INSERT INTO publication_test_runs
SELECT
  'failed',
  canary.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
  '9e200000-0000-4000-8000-000000000003'::uuid,
  'dpl_publication_failed',
  repeat('f', 40),
  'publication-canary-failed',
  'Retain a failed publication canary fixture'
) canary;

INSERT INTO publication_test_runs
SELECT
  'leased',
  canary.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
  '9e200000-0000-4000-8000-000000000005'::uuid,
  'dpl_publication_leased',
  repeat('7', 40),
  'publication-canary-leased',
  'Complete serialized canary execution'
) canary;

-- Queue fixtures after the first runtime-created start are inserted directly
-- because the runtime begin boundary intentionally enforces one live operation
-- for an exact target and build. These rows exercise queue serialization, not
-- the administrator begin boundary.
INSERT INTO audit.advocate_publication_canary_starts (
  run_id,
  request_id,
  initiating_user_id,
  advocate_id,
  expected_advocate_version,
  domain_id,
  hostname,
  deployment_id,
  git_revision,
  trace_id,
  admin_reason,
  provider_evidence_binding_sha256,
  stripe_us_attempt_id,
  stripe_uk_attempt_id,
  paypal_attempt_id,
  started_at
)
SELECT
  fixture.run_id,
  fixture.request_id,
  start.initiating_user_id,
  start.advocate_id,
  start.expected_advocate_version,
  start.domain_id,
  start.hostname,
  start.deployment_id,
  start.git_revision,
  fixture.trace_id,
  fixture.admin_reason,
  start.provider_evidence_binding_sha256,
  fixture.stripe_us_attempt_id,
  fixture.stripe_uk_attempt_id,
  fixture.paypal_attempt_id,
  clock_timestamp() + fixture.started_at_offset
FROM audit.advocate_publication_canary_starts start
CROSS JOIN (
  VALUES
    (
      '9e300000-0000-4000-8000-000000000006'::uuid,
      '9e200000-0000-4000-8000-000000000006'::uuid,
      'publication-queue-old'::text,
      'Run the oldest queued deployment canary'::text,
      '9e400000-0000-4000-8000-000000000016'::uuid,
      '9e400000-0000-4000-8000-000000000017'::uuid,
      '9e400000-0000-4000-8000-000000000018'::uuid,
      interval '1 millisecond'
    ),
    (
      '9e300000-0000-4000-8000-000000000007'::uuid,
      '9e200000-0000-4000-8000-000000000007'::uuid,
      'publication-queue-new'::text,
      'Run the newest queued deployment canary'::text,
      '9e400000-0000-4000-8000-000000000019'::uuid,
      '9e400000-0000-4000-8000-000000000020'::uuid,
      '9e400000-0000-4000-8000-000000000021'::uuid,
      interval '2 milliseconds'
    )
) AS fixture(
  run_id,
  request_id,
  trace_id,
  admin_reason,
  stripe_us_attempt_id,
  stripe_uk_attempt_id,
  paypal_attempt_id,
  started_at_offset
)
WHERE start.run_id = (
  SELECT run_id FROM publication_test_runs WHERE label = 'incomplete'
);

INSERT INTO publication_test_runs
SELECT
  fixture.label,
  start.run_id,
  start.advocate_id,
  start.domain_id,
  start.hostname,
  start.expected_advocate_version,
  start.deployment_id,
  start.git_revision,
  start.stripe_us_attempt_id,
  start.stripe_uk_attempt_id,
  start.paypal_attempt_id,
  start.started_at
FROM (
  VALUES
    ('queue_old'::text, '9e300000-0000-4000-8000-000000000006'::uuid),
    ('queue_new'::text, '9e300000-0000-4000-8000-000000000007'::uuid)
) AS fixture(label, run_id)
JOIN audit.advocate_publication_canary_starts start
  ON start.run_id = fixture.run_id;

INSERT INTO publication_test_runs
SELECT
  'queue_other_deployment',
  canary.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
  '9e200000-0000-4000-8000-000000000008'::uuid,
  'dpl_other_publication_gate',
  repeat('a', 40),
  'publication-queue-other-deployment',
  'Run a different deployment canary'
) canary;

INSERT INTO publication_test_runs
SELECT
  'queue_other_revision',
  canary.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
  '9e200000-0000-4000-8000-000000000009'::uuid,
  'dpl_publication_gate',
  repeat('b', 40),
  'publication-queue-other-revision',
  'Run a different revision canary'
) canary;

INSERT INTO audit.advocate_publication_canary_starts (
  run_id,
  request_id,
  initiating_user_id,
  advocate_id,
  expected_advocate_version,
  domain_id,
  hostname,
  deployment_id,
  git_revision,
  trace_id,
  admin_reason,
  provider_evidence_binding_sha256,
  stripe_us_attempt_id,
  stripe_uk_attempt_id,
  paypal_attempt_id,
  started_at
)
SELECT
  '9e300000-0000-4000-8000-000000000014'::uuid,
  '9e200000-0000-4000-8000-000000000014'::uuid,
  start.initiating_user_id,
  start.advocate_id,
  start.expected_advocate_version,
  start.domain_id,
  start.hostname,
  'dpl_single_flight_cutoff',
  repeat('8', 40),
  'publication-canary-active-near-cutoff',
  'Retain active execution ownership near cutoff',
  start.provider_evidence_binding_sha256,
  '9e400000-0000-4000-8000-000000000022'::uuid,
  '9e400000-0000-4000-8000-000000000023'::uuid,
  '9e400000-0000-4000-8000-000000000024'::uuid,
  clock_timestamp() - interval '29 minutes'
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = (
  SELECT run_id FROM publication_test_runs WHERE label = 'valid'
);

INSERT INTO audit.advocate_publication_canary_execution_leases (
  run_id,
  advocate_id,
  domain_id,
  start_request_id,
  lease_token,
  lease_version,
  leased_at,
  leased_until,
  created_at,
  updated_at
)
SELECT
  start.run_id,
  start.advocate_id,
  start.domain_id,
  start.request_id,
  '9e700000-0000-4000-8000-000000000014'::uuid,
  1,
  clock_timestamp() - interval '5 seconds',
  clock_timestamp() + interval '30 seconds',
  clock_timestamp() - interval '5 seconds',
  clock_timestamp()
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = '9e300000-0000-4000-8000-000000000014'::uuid;

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      '9e200000-0000-4000-8000-000000000015'::uuid,
      'dpl_single_flight_cutoff',
      repeat('8', 40),
      'publication-canary-overlapping-cutoff',
      'Attempt overlapping publication execution'
    )
  $$,
  '40001',
  'An equivalent advocate publication canary is already in progress',
  'an active lease near the immutable cutoff cannot overlap a fresh operation'
);

INSERT INTO audit.advocate_publication_canary_starts (
  run_id,
  request_id,
  initiating_user_id,
  advocate_id,
  expected_advocate_version,
  domain_id,
  hostname,
  deployment_id,
  git_revision,
  trace_id,
  admin_reason,
  provider_evidence_binding_sha256,
  stripe_us_attempt_id,
  stripe_uk_attempt_id,
  paypal_attempt_id,
  started_at
)
SELECT
  '9e300000-0000-4000-8000-000000000004'::uuid,
  '9e200000-0000-4000-8000-000000000004'::uuid,
  start.initiating_user_id,
  start.advocate_id,
  start.expected_advocate_version,
  start.domain_id,
  start.hostname,
  start.deployment_id,
  start.git_revision,
  'publication-canary-stale',
  'Retain a stale publication canary fixture',
  start.provider_evidence_binding_sha256,
  '9e400000-0000-4000-8000-000000000004'::uuid,
  '9e400000-0000-4000-8000-000000000005'::uuid,
  '9e400000-0000-4000-8000-000000000006'::uuid,
  clock_timestamp() - interval '31 minutes'
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = (
  SELECT run_id FROM publication_test_runs WHERE label = 'valid'
);

INSERT INTO publication_test_runs
SELECT
  'stale',
  start.run_id,
  start.advocate_id,
  start.domain_id,
  start.hostname,
  start.expected_advocate_version,
  start.deployment_id,
  start.git_revision,
  start.stripe_us_attempt_id,
  start.stripe_uk_attempt_id,
  start.paypal_attempt_id,
  start.started_at
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = '9e300000-0000-4000-8000-000000000004'::uuid;

INSERT INTO audit.advocate_publication_canary_starts (
  run_id,
  request_id,
  initiating_user_id,
  advocate_id,
  expected_advocate_version,
  domain_id,
  hostname,
  deployment_id,
  git_revision,
  trace_id,
  admin_reason,
  provider_evidence_binding_sha256,
  stripe_us_attempt_id,
  stripe_uk_attempt_id,
  paypal_attempt_id,
  started_at
)
SELECT
  '9e300000-0000-4000-8000-000000000010'::uuid,
  '9e200000-0000-4000-8000-000000000010'::uuid,
  start.initiating_user_id,
  start.advocate_id,
  start.expected_advocate_version,
  start.domain_id,
  start.hostname,
  'dpl_stale_queue',
  repeat('c', 40),
  'publication-canary-insufficient-freshness',
  'Reject work that cannot finish inside the freshness window',
  start.provider_evidence_binding_sha256,
  '9e400000-0000-4000-8000-000000000010'::uuid,
  '9e400000-0000-4000-8000-000000000011'::uuid,
  '9e400000-0000-4000-8000-000000000012'::uuid,
  clock_timestamp() - interval '26 minutes'
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = (
  SELECT run_id FROM publication_test_runs WHERE label = 'valid'
);

INSERT INTO publication_test_runs
SELECT
  'insufficient_freshness',
  start.run_id,
  start.advocate_id,
  start.domain_id,
  start.hostname,
  start.expected_advocate_version,
  start.deployment_id,
  start.git_revision,
  start.stripe_us_attempt_id,
  start.stripe_uk_attempt_id,
  start.paypal_attempt_id,
  start.started_at
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = '9e300000-0000-4000-8000-000000000010'::uuid;

INSERT INTO audit.advocate_publication_canary_starts (
  run_id,
  request_id,
  initiating_user_id,
  advocate_id,
  expected_advocate_version,
  domain_id,
  hostname,
  deployment_id,
  git_revision,
  trace_id,
  admin_reason,
  provider_evidence_binding_sha256,
  stripe_us_attempt_id,
  stripe_uk_attempt_id,
  paypal_attempt_id,
  started_at
)
SELECT
  '9e300000-0000-4000-8000-000000000013'::uuid,
  '9e200000-0000-4000-8000-000000000013'::uuid,
  start.initiating_user_id,
  start.advocate_id,
  start.expected_advocate_version,
  start.domain_id,
  start.hostname,
  'dpl_delayed_execution',
  repeat('d', 40),
  'publication-canary-delayed-execution',
  'Complete a delayed but fresh canary execution',
  start.provider_evidence_binding_sha256,
  '9e400000-0000-4000-8000-000000000013'::uuid,
  '9e400000-0000-4000-8000-000000000014'::uuid,
  '9e400000-0000-4000-8000-000000000015'::uuid,
  clock_timestamp() - interval '5 minutes'
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = (
  SELECT run_id FROM publication_test_runs WHERE label = 'valid'
);

INSERT INTO publication_test_runs
SELECT
  'delayed_execution',
  start.run_id,
  start.advocate_id,
  start.domain_id,
  start.hostname,
  start.expected_advocate_version,
  start.deployment_id,
  start.git_revision,
  start.stripe_us_attempt_id,
  start.stripe_uk_attempt_id,
  start.paypal_attempt_id,
  start.started_at
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = '9e300000-0000-4000-8000-000000000013'::uuid;

INSERT INTO audit.advocate_publication_canary_reports (
  run_id,
  completion_request_id,
  completing_user_id,
  advocate_id,
  expected_advocate_version,
  domain_id,
  hostname,
  deployment_id,
  git_revision,
  outcome,
  failure_code,
  completed_at,
  canonical_report_text,
  report_sha256,
  trace_id,
  admin_reason
)
SELECT
  start.run_id,
  source.completion_request_id,
  start.initiating_user_id,
  start.advocate_id,
  start.expected_advocate_version,
  start.domain_id,
  start.hostname,
  start.deployment_id,
  start.git_revision,
  source.outcome,
  source.failure_code,
  source.completed_at,
  source.report_text,
  extensions.digest(
    pg_catalog.convert_to(source.report_text, 'UTF8'),
    'sha256'
  ),
  source.trace_id,
  start.admin_reason
FROM (
  VALUES
    (
      'valid'::text,
      '9e500000-0000-4000-8000-000000000001'::uuid,
      'succeeded'::text,
      NULL::text,
      date_trunc('milliseconds', clock_timestamp()),
      '{"fixture":"valid-publication-report"}'::text,
      'publication-complete-valid'::text,
      'Record a successful exact publication canary'::text
    ),
    (
      'failed'::text,
      '9e500000-0000-4000-8000-000000000002'::uuid,
      'failed'::text,
      'stripe_us_payment_canary_failed'::text,
      date_trunc('milliseconds', clock_timestamp()),
      '{"fixture":"failed-publication-report"}'::text,
      'publication-complete-failed'::text,
      'Record a failed exact publication canary'::text
    ),
    (
      'stale'::text,
      '9e500000-0000-4000-8000-000000000003'::uuid,
      'succeeded'::text,
      NULL::text,
      date_trunc(
        'milliseconds',
        clock_timestamp() - interval '30 minutes 59 seconds'
      ),
      '{"fixture":"stale-publication-report"}'::text,
      'publication-complete-stale'::text,
      'Record a stale exact publication canary'::text
    )
) AS source(
  label,
  completion_request_id,
  outcome,
  failure_code,
  completed_at,
  report_text,
  trace_id,
  admin_reason
)
JOIN publication_test_runs run ON run.label = source.label
JOIN audit.advocate_publication_canary_starts start
  ON start.run_id = run.run_id;

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.publish_advocate_portal_from_canary(uuid,bigint,uuid,text,bytea,text,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.publish_advocate_portal_from_canary(uuid,bigint,uuid,text,bytea,text,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.publish_advocate_portal_from_canary(uuid,bigint,uuid,text,bytea,text,uuid,text)',
    'EXECUTE'
  ),
  'only authenticated callers can reach the canary-bound publication RPC'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.publish_advocate_portal(uuid,bigint,uuid,text,bytea,timestamp with time zone,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.publish_advocate_portal(uuid,bigint,uuid,text,bytea,timestamp with time zone,text,text,text,text)',
    'EXECUTE'
  ),
  'the superseded administrator-attested publication RPC has no runtime caller'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.get_advocate_publication_canary_execution(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_advocate_publication_canary_execution(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.get_advocate_publication_canary_execution(uuid)',
    'EXECUTE'
  ),
  'only the service role can reach the canary transport recovery lookup'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.claim_advocate_publication_canary_execution(uuid,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_advocate_publication_canary_execution(uuid,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.claim_next_advocate_publication_canary_execution(text,text,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_next_advocate_publication_canary_execution(text,text,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_claimed_advocate_publication_canary(uuid,text,bytea,text,text,timestamp with time zone,uuid,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.complete_claimed_advocate_publication_canary(uuid,text,bytea,text,text,timestamp with time zone,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'only service role can claim and complete a serialized canary execution'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'public.complete_advocate_publication_canary(uuid,text,bytea,text,text,timestamp with time zone,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_publication_canary_execution_leases',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'audit.advocate_publication_canary_execution_leases',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'runtime roles cannot bypass the execution lease through the old completion RPC or table'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'audit.advocate_publication_approvals',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'audit.advocate_publication_approvals',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_publication_approvals',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'no runtime role has direct access to publication approval receipts'
);

SELECT extensions.is(
  pg_get_function_result(
    'public.get_advocate_publication_canary_execution(uuid)'::regprocedure
  ),
  'TABLE(run_id uuid, advocate_id uuid, domain_id uuid, hostname text, expected_advocate_version bigint, deployment_id text, revision text, stripe_us_attempt_id uuid, stripe_uk_attempt_id uuid, paypal_attempt_id uuid, started_at timestamp with time zone, outcome text, failure_code text, report_sha256 bytea, completed_at timestamp with time zone)',
  'the service lookup exposes only the bounded execution and optional completion shape'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'public.publish_advocate_portal_from_canary(uuid,bigint,uuid,text,bytea,text,uuid,text)'::regprocedure
  ) ~ 'FOR UPDATE NOWAIT'
  AND pg_get_functiondef(
    'public.publish_advocate_portal_from_canary(uuid,bigint,uuid,text,bytea,text,uuid,text)'::regprocedure
  ) ~ 'ORDER BY integration.provider::text, integration.environment[[:space:]]+FOR SHARE NOWAIT'
  AND pg_get_functiondef(
    'public.publish_advocate_portal_from_canary(uuid,bigint,uuid,text,bytea,text,uuid,text)'::regprocedure
  ) ~ 'FOR SHARE OF job NOWAIT',
  'publication encodes advocate, exact domain, ordered integrations, and ordered verified job locks'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000001'::uuid,
      'publication-approval-unauthenticated'
    )
  $$,
  '28000',
  'Authentication is required',
  'publication requires an authenticated user'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000003',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000002'::uuid,
      'publication-approval-member'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'an ordinary authenticated user cannot publish a portal'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000002',
  true
);
UPDATE auth.users
SET banned_until = clock_timestamp() + interval '1 hour'
WHERE id = '9e000000-0000-4000-8000-000000000002'::uuid;

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000003'::uuid,
      'publication-approval-banned'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned super administrator fails the post-lock account health check'
);

UPDATE auth.users
SET banned_until = NULL
WHERE id = '9e000000-0000-4000-8000-000000000002'::uuid;
SELECT set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      ' dpl_publication_gate',
      decode(repeat('1', 64), 'hex'),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000004'::uuid,
      'publication-approval-malformed'
    )
  $$,
  '22023',
  'Advocate publication approval input is invalid',
  'publication rejects noncanonical bounded input before reading evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      '9e300000-0000-4000-8000-000000000099'::uuid,
      'dpl_publication_gate',
      decode(repeat('1', 64), 'hex'),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000005'::uuid,
      'publication-approval-missing-run'
    )
  $$,
  '23503',
  'Completed advocate publication canary does not exist',
  'publication requires one completed exact canary run'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value - 1 FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000006'::uuid,
      'publication-approval-stale-version'
    )
  $$,
  '40001',
  'Advocate publication canary does not match the exact approval target',
  'publication binds the optimistic advocate version to the canary start'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'failed'),
      'dpl_publication_failed',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'failed'
      ),
      'Retain a failed publication canary fixture',
      '9e600000-0000-4000-8000-000000000007'::uuid,
      'publication-approval-failed-report'
    )
  $$,
  '55000',
  'Advocate publication canary is failed or stale',
  'a failed canary can never publish a portal'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'stale'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'stale'
      ),
      'Retain a stale publication canary fixture',
      '9e600000-0000-4000-8000-000000000008'::uuid,
      'publication-approval-stale-report'
    )
  $$,
  '55000',
  'Advocate publication canary is failed or stale',
  'a stale canary can never publish a portal'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_other_deployment',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000009'::uuid,
      'publication-approval-deployment-mismatch'
    )
  $$,
  '40001',
  'Advocate publication canary does not match the exact approval target',
  'publication binds the exact deployment identity'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      decode(repeat('f', 64), 'hex'),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000010'::uuid,
      'publication-approval-digest-mismatch'
    )
  $$,
  '40001',
  'Advocate publication canary does not match the exact approval target',
  'publication binds the exact 32 byte report digest'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'A different publication reason',
      '9e600000-0000-4000-8000-000000000015'::uuid,
      'publication-approval-reason-mismatch'
    )
  $$,
  '40001',
  'Advocate publication canary does not match the exact approval target',
  'publication requires the exact immutable canary start reason'
);

UPDATE public.advocate_domain_integrations integration
SET
  reconciliation_suppressed_at = clock_timestamp(),
  reconciliation_suppressed_by_user_id =
    '9e000000-0000-4000-8000-000000000001'::uuid,
  reconciliation_suppression_reason = 'Test provider drift after canary'
WHERE integration.domain_id = (
  SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
)
  AND integration.provider = 'paypal';

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000011'::uuid,
      'publication-approval-provider-drift'
    )
  $$,
  '55000',
  'Advocate publication canary is not publishable',
  'publication fails closed when provider evidence drifts after completion'
);

UPDATE public.advocate_domain_integrations integration
SET
  reconciliation_suppressed_at = NULL,
  reconciliation_suppressed_by_user_id = NULL,
  reconciliation_suppression_reason = NULL
WHERE integration.domain_id = (
  SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
)
  AND integration.provider = 'paypal';

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.get_advocate_publication_canary_execution(
      '9e200000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '42501',
  'Publication canary runner service role is required',
  'an authenticated client cannot invoke the service recovery lookup'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.get_advocate_publication_canary_execution(NULL)
  $$,
  '22023',
  'Publication canary request identity is required',
  'the service recovery lookup requires an exact request UUID'
);

SELECT extensions.is(
  (
    SELECT count(*)::bigint
    FROM public.get_advocate_publication_canary_execution(
      '9e200000-0000-4000-8000-000000000099'::uuid
    )
  ),
  0::bigint,
  'the service recovery lookup returns zero rows for an unknown request'
);

SELECT extensions.ok(
  (
    SELECT
      execution.run_id = run.run_id
      AND execution.advocate_id = run.advocate_id
      AND execution.domain_id = run.domain_id
      AND execution.hostname = run.hostname
      AND execution.expected_advocate_version = run.expected_advocate_version
      AND execution.deployment_id = run.deployment_id
      AND execution.revision = run.revision
      AND execution.stripe_us_attempt_id = run.stripe_us_attempt_id
      AND execution.stripe_uk_attempt_id = run.stripe_uk_attempt_id
      AND execution.paypal_attempt_id = run.paypal_attempt_id
      AND execution.started_at = run.started_at
      AND execution.outcome IS NULL
      AND execution.failure_code IS NULL
      AND execution.report_sha256 IS NULL
      AND execution.completed_at IS NULL
    FROM public.get_advocate_publication_canary_execution(
      '9e200000-0000-4000-8000-000000000002'::uuid
    ) execution
    JOIN publication_test_runs run ON run.label = 'incomplete'
  ),
  'the service lookup resumes an incomplete start with immutable attempt identities'
);

SELECT extensions.ok(
  (
    SELECT
      execution.run_id = run.run_id
      AND execution.outcome = report.outcome
      AND execution.failure_code IS NOT DISTINCT FROM report.failure_code
      AND execution.report_sha256 = report.report_sha256
      AND execution.completed_at = report.completed_at
    FROM public.get_advocate_publication_canary_execution(
      '9e200000-0000-4000-8000-000000000001'::uuid
    ) execution
    JOIN publication_test_runs run ON run.label = 'valid'
    JOIN audit.advocate_publication_canary_reports report
      ON report.run_id = run.run_id
  ),
  'the service lookup recovers only the bounded completion summary after a lost response'
);

SELECT extensions.ok(
  (
    SELECT
      execution.outcome = 'failed'
      AND execution.failure_code = 'stripe_us_payment_canary_failed'
      AND execution.report_sha256 = report.report_sha256
      AND execution.completed_at = report.completed_at
    FROM public.get_advocate_publication_canary_execution(
      '9e200000-0000-4000-8000-000000000003'::uuid
    ) execution
    JOIN publication_test_runs run ON run.label = 'failed'
    JOIN audit.advocate_publication_canary_reports report
      ON report.run_id = run.run_id
  ),
  'a failed completion returns its fixed actionable code with the digest and completion time'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.claim_advocate_publication_canary_execution(
      (
        SELECT run_id
        FROM publication_test_runs
        WHERE label = 'insufficient_freshness'
      ),
      300
    )
  $$,
  '55000',
  'Publication canary execution freshness window is insufficient',
  'a direct claim rejects work that cannot finish before the freshness boundary'
);

SELECT extensions.is(
  (
    SELECT count(*)::bigint
    FROM public.claim_next_advocate_publication_canary_execution(
      'dpl_stale_queue',
      repeat('c', 40),
      300
    )
  ),
  0::bigint,
  'the queue skips an incomplete start whose remaining freshness cannot cover its lease'
);

INSERT INTO publication_test_leases (label, lease_token, leased_until)
SELECT 'delayed', claim.lease_token, claim.leased_until
FROM public.claim_advocate_publication_canary_execution(
  (SELECT run_id FROM publication_test_runs WHERE label = 'delayed_execution'),
  300
) claim;

WITH timing AS (
  SELECT
    execution_lease.run_id,
    execution_lease.leased_at AS execution_started_at,
    date_trunc('milliseconds', clock_timestamp()) AS completed_at
  FROM audit.advocate_publication_canary_execution_leases execution_lease
  WHERE execution_lease.run_id = (
    SELECT run_id
    FROM publication_test_runs
    WHERE label = 'delayed_execution'
  )
), report AS (
  SELECT
    timing.run_id,
    pg_temp.publication_canonical_canary_report(
      timing.run_id,
      timing.completed_at,
      timing.execution_started_at
    ) AS report_text,
    timing.completed_at
  FROM timing
)
INSERT INTO publication_test_lease_reports (
  run_id,
  report_text,
  report_sha256,
  completed_at
)
SELECT
  report.run_id,
  report.report_text,
  extensions.digest(
    pg_catalog.convert_to(report.report_text, 'UTF8'),
    'sha256'
  ),
  report.completed_at
FROM report;

SELECT extensions.lives_ok(
  $$
    SELECT *
    FROM public.complete_claimed_advocate_publication_canary(
      (
        SELECT run_id
        FROM publication_test_runs
        WHERE label = 'delayed_execution'
      ),
      (
        SELECT report_text
        FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id
          FROM publication_test_runs
          WHERE label = 'delayed_execution'
        )
      ),
      (
        SELECT report_sha256
        FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id
          FROM publication_test_runs
          WHERE label = 'delayed_execution'
        )
      ),
      'succeeded',
      NULL,
      (
        SELECT completed_at
        FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id
          FROM publication_test_runs
          WHERE label = 'delayed_execution'
        )
      ),
      '9e500000-0000-4000-8000-000000000005'::uuid,
      'publication-complete-delayed-execution',
      'Complete a delayed but fresh canary execution',
      (
        SELECT lease_token
        FROM publication_test_leases
        WHERE label = 'delayed'
      )
    )
  $$,
  'a truthful execution may begin minutes after its immutable authorization start'
);

SELECT extensions.ok(
  (
    SELECT
      report.completed_at IS NOT NULL
      AND report.outcome = 'succeeded'
      AND (report.canonical_report_text::jsonb ->> 'started_at')::
        timestamp with time zone >= execution_lease.leased_at - interval '1 second'
      AND (report.canonical_report_text::jsonb ->> 'started_at')::
        timestamp with time zone <= execution_lease.leased_at + interval '30 seconds'
      AND (report.canonical_report_text::jsonb ->> 'started_at')::
        timestamp with time zone > start.started_at + interval '4 minutes'
      AND execution_lease.completed_at IS NOT NULL
    FROM publication_test_runs run
    JOIN audit.advocate_publication_canary_starts start
      ON start.run_id = run.run_id
    JOIN audit.advocate_publication_canary_reports report
      ON report.run_id = run.run_id
    JOIN audit.advocate_publication_canary_execution_leases execution_lease
      ON execution_lease.run_id = run.run_id
    WHERE run.label = 'delayed_execution'
  ),
  'the delayed report remains bound to its current lease and overall fresh run window'
);

INSERT INTO publication_test_leases (label, lease_token, leased_until)
SELECT 'initial', claim.lease_token, claim.leased_until
FROM public.claim_advocate_publication_canary_execution(
  (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
  30
) claim;

SELECT extensions.ok(
  (
    SELECT
      lease.lease_token IS NOT NULL
      AND lease.leased_until > clock_timestamp()
      AND execution_lease.run_id = run.run_id
      AND execution_lease.advocate_id = run.advocate_id
      AND execution_lease.domain_id = run.domain_id
      AND execution_lease.start_request_id =
        '9e200000-0000-4000-8000-000000000005'::uuid
      AND execution_lease.lease_version = 1
      AND execution_lease.completed_at IS NULL
    FROM publication_test_leases lease
    JOIN publication_test_runs run ON run.label = 'leased'
    JOIN audit.advocate_publication_canary_execution_leases execution_lease
      ON execution_lease.run_id = run.run_id
     AND execution_lease.lease_token = lease.lease_token
    WHERE lease.label = 'initial'
  ),
  'the first service claimant receives one durable current fencing token'
);

SELECT extensions.is(
  (
    SELECT count(*)::bigint
    FROM public.claim_advocate_publication_canary_execution(
      (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
      120
    )
  ),
  0::bigint,
  'a simultaneous second claimant receives no row while the lease is unexpired'
);

WITH report_time AS (
  SELECT date_trunc('milliseconds', clock_timestamp()) AS completed_at
), report AS (
  SELECT
    run.run_id,
    pg_temp.publication_canonical_canary_report(
      run.run_id,
      report_time.completed_at
    ) AS report_text,
    report_time.completed_at
  FROM publication_test_runs run
  CROSS JOIN report_time
  WHERE run.label = 'leased'
)
INSERT INTO publication_test_lease_reports (
  run_id,
  report_text,
  report_sha256,
  completed_at
)
SELECT
  report.run_id,
  report.report_text,
  extensions.digest(
    pg_catalog.convert_to(report.report_text, 'UTF8'),
    'sha256'
  ),
  report.completed_at
FROM report;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.complete_claimed_advocate_publication_canary(
      (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
      (
        SELECT report_text
        FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id FROM publication_test_runs WHERE label = 'leased'
        )
      ),
      (
        SELECT report_sha256
        FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id FROM publication_test_runs WHERE label = 'leased'
        )
      ),
      'succeeded',
      NULL,
      (
        SELECT completed_at
        FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id FROM publication_test_runs WHERE label = 'leased'
        )
      ),
      '9e500000-0000-4000-8000-000000000004'::uuid,
      'publication-complete-wrong-token',
      'Complete serialized canary execution',
      '9e700000-0000-4000-8000-000000000099'::uuid
    )
  $$,
  '40001',
  'Publication canary execution lease does not match',
  'a runner with the wrong fencing token cannot commit a report'
);

UPDATE audit.advocate_publication_canary_execution_leases execution_lease
SET
  leased_at = clock_timestamp() - interval '2 minutes',
  leased_until = clock_timestamp() - interval '1 minute',
  updated_at = clock_timestamp()
WHERE execution_lease.run_id = (
  SELECT run_id FROM publication_test_runs WHERE label = 'leased'
);

INSERT INTO publication_test_leases (label, lease_token, leased_until)
SELECT 'reclaimed', claim.lease_token, claim.leased_until
FROM public.claim_advocate_publication_canary_execution(
  (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
  120
) claim;

SELECT extensions.ok(
  (
    SELECT
      reclaimed.lease_token <> initial.lease_token
      AND reclaimed.leased_until > clock_timestamp()
      AND execution_lease.lease_token = reclaimed.lease_token
      AND execution_lease.lease_version = 2
      AND execution_lease.completed_at IS NULL
    FROM publication_test_leases reclaimed
    JOIN publication_test_leases initial ON initial.label = 'initial'
    JOIN publication_test_runs run ON run.label = 'leased'
    JOIN audit.advocate_publication_canary_execution_leases execution_lease
      ON execution_lease.run_id = run.run_id
    WHERE reclaimed.label = 'reclaimed'
  ),
  'an expired execution is reclaimable only with a rotated fencing token'
);

WITH timing AS (
  SELECT
    execution_lease.run_id,
    execution_lease.leased_at,
    execution_lease.leased_until,
    date_trunc('milliseconds', clock_timestamp()) AS valid_completed_at
  FROM audit.advocate_publication_canary_execution_leases execution_lease
  WHERE execution_lease.run_id = (
    SELECT run_id FROM publication_test_runs WHERE label = 'leased'
  )
), valid_report AS (
  SELECT
    timing.run_id,
    pg_temp.publication_canonical_canary_report(
      timing.run_id,
      timing.valid_completed_at,
      timing.leased_at
    ) AS report_text,
    timing.valid_completed_at AS completed_at
  FROM timing
)
UPDATE publication_test_lease_reports stored
SET
  report_text = valid_report.report_text,
  report_sha256 = extensions.digest(
    pg_catalog.convert_to(valid_report.report_text, 'UTF8'),
    'sha256'
  ),
  completed_at = valid_report.completed_at
FROM valid_report
WHERE stored.run_id = valid_report.run_id;

WITH timing AS (
  SELECT
    execution_lease.run_id,
    execution_lease.leased_at,
    execution_lease.leased_until,
    date_trunc('milliseconds', clock_timestamp()) AS now_completed_at
  FROM audit.advocate_publication_canary_execution_leases execution_lease
  WHERE execution_lease.run_id = (
    SELECT run_id FROM publication_test_runs WHERE label = 'leased'
  )
), forged AS (
  SELECT
    source.label,
    pg_temp.publication_canonical_canary_report(
      timing.run_id,
      source.completed_at,
      source.execution_started_at
    ) AS report_text,
    source.completed_at
  FROM timing
  CROSS JOIN LATERAL (
    VALUES
      (
        'pre_lease'::text,
        timing.leased_at - interval '2 seconds',
        timing.now_completed_at
      ),
      (
        'post_lease'::text,
        timing.leased_until + interval '1 second',
        date_trunc(
          'milliseconds',
          timing.leased_until + interval '1 second'
        )
      )
  ) AS source(label, execution_started_at, completed_at)
)
INSERT INTO publication_test_forged_reports (
  label,
  report_text,
  report_sha256,
  completed_at
)
SELECT
  forged.label,
  forged.report_text,
  extensions.digest(
    pg_catalog.convert_to(forged.report_text, 'UTF8'),
    'sha256'
  ),
  forged.completed_at
FROM forged;

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.complete_claimed_advocate_publication_canary(
      (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
      (
        SELECT report_text
        FROM publication_test_forged_reports
        WHERE label = 'pre_lease'
      ),
      (
        SELECT report_sha256
        FROM publication_test_forged_reports
        WHERE label = 'pre_lease'
      ),
      'succeeded',
      NULL,
      (
        SELECT completed_at
        FROM publication_test_forged_reports
        WHERE label = 'pre_lease'
      ),
      '9e500000-0000-4000-8000-000000000006'::uuid,
      'publication-complete-forged-pre-lease',
      'Complete serialized canary execution',
      (
        SELECT lease_token
        FROM publication_test_leases
        WHERE label = 'reclaimed'
      )
    )
  $$,
  '40001',
  'Publication canary report start does not match the current execution lease',
  'the current owner cannot forge an execution start before its lease'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.complete_claimed_advocate_publication_canary(
      (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
      (
        SELECT report_text
        FROM publication_test_forged_reports
        WHERE label = 'post_lease'
      ),
      (
        SELECT report_sha256
        FROM publication_test_forged_reports
        WHERE label = 'post_lease'
      ),
      'succeeded',
      NULL,
      (
        SELECT completed_at
        FROM publication_test_forged_reports
        WHERE label = 'post_lease'
      ),
      '9e500000-0000-4000-8000-000000000007'::uuid,
      'publication-complete-forged-post-lease',
      'Complete serialized canary execution',
      (
        SELECT lease_token
        FROM publication_test_leases
        WHERE label = 'reclaimed'
      )
    )
  $$,
  '40001',
  'Publication canary report start does not match the current execution lease',
  'the current owner cannot forge an execution start after its lease'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.complete_claimed_advocate_publication_canary(
      (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
      (
        SELECT report_text FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id FROM publication_test_runs WHERE label = 'leased'
        )
      ),
      (
        SELECT report_sha256 FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id FROM publication_test_runs WHERE label = 'leased'
        )
      ),
      'succeeded',
      NULL,
      (
        SELECT completed_at FROM publication_test_lease_reports
        WHERE run_id = (
          SELECT run_id FROM publication_test_runs WHERE label = 'leased'
        )
      ),
      '9e500000-0000-4000-8000-000000000004'::uuid,
      'publication-complete-stale-owner',
      'Complete serialized canary execution',
      (
        SELECT lease_token
        FROM publication_test_leases
        WHERE label = 'initial'
      )
    )
  $$,
  '40001',
  'Publication canary execution lease does not match',
  'the expired owner cannot commit after token rotation'
);

CREATE TEMP TABLE publication_test_claimed_completion
ON COMMIT DROP
AS
SELECT completion.*
FROM public.complete_claimed_advocate_publication_canary(
  (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
  (
    SELECT report_text FROM publication_test_lease_reports
    WHERE run_id = (
      SELECT run_id FROM publication_test_runs WHERE label = 'leased'
    )
  ),
  (
    SELECT report_sha256 FROM publication_test_lease_reports
    WHERE run_id = (
      SELECT run_id FROM publication_test_runs WHERE label = 'leased'
    )
  ),
  'succeeded',
  NULL,
  (
    SELECT completed_at FROM publication_test_lease_reports
    WHERE run_id = (
      SELECT run_id FROM publication_test_runs WHERE label = 'leased'
    )
  ),
  '9e500000-0000-4000-8000-000000000004'::uuid,
  'publication-complete-current-owner',
  'Complete serialized canary execution',
  (
    SELECT lease_token
    FROM publication_test_leases
    WHERE label = 'reclaimed'
  )
) completion;

SELECT extensions.ok(
  (
    SELECT
      completion.run_id = report.run_id
      AND completion.outcome = 'succeeded'
      AND completion.report_sha256 = report.report_sha256
      AND completion.completed_at = report.completed_at
    FROM publication_test_claimed_completion completion
    JOIN publication_test_lease_reports report
      ON report.run_id = completion.run_id
  ),
  'the current unexpired owner completes through the canonical report validator'
);

SELECT extensions.ok(
  (
    SELECT
      stored_report.outcome = 'succeeded'
      AND stored_report.failure_code IS NULL
      AND stored_report.report_sha256 = source.report_sha256
      AND stored_report.completed_at = source.completed_at
      AND execution_lease.completed_at IS NOT NULL
      AND execution_lease.completion_request_id =
        '9e500000-0000-4000-8000-000000000004'::uuid
      AND execution_lease.lease_token = reclaimed.lease_token
      AND execution_lease.lease_version = 2
    FROM publication_test_lease_reports source
    JOIN audit.advocate_publication_canary_reports stored_report
      ON stored_report.run_id = source.run_id
    JOIN audit.advocate_publication_canary_execution_leases execution_lease
      ON execution_lease.run_id = source.run_id
    JOIN publication_test_leases reclaimed
      ON reclaimed.label = 'reclaimed'
    WHERE source.run_id = (
      SELECT run_id FROM publication_test_runs WHERE label = 'leased'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name =
      'advocate_publication_canary_execution_leases'
      AND event.operation = 'UPDATE'
      AND event.advocate_id = (
        SELECT advocate_id
        FROM publication_test_runs
        WHERE label = 'leased'
      )
      AND event.system_actor = 'advocate-publication-canary-runner'
  ),
  'report insertion and terminal lease state commit atomically with audit evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.claim_advocate_publication_canary_execution(
      (SELECT run_id FROM publication_test_runs WHERE label = 'leased'),
      120
    )
  $$,
  '55000',
  'Publication canary execution is already completed',
  'a completed canary execution can never be claimed again'
);

SELECT extensions.ok(
  (
    SELECT
      execution.outcome = 'succeeded'
      AND execution.failure_code IS NULL
      AND execution.report_sha256 = source.report_sha256
      AND execution.completed_at = source.completed_at
    FROM public.get_advocate_publication_canary_execution(
      '9e200000-0000-4000-8000-000000000005'::uuid
    ) execution
    JOIN publication_test_lease_reports source
      ON source.run_id = execution.run_id
  ),
  'the recovery lookup observes the atomically completed leased execution'
);

INSERT INTO publication_test_queue_claims
SELECT 'first', claim.*
FROM public.claim_next_advocate_publication_canary_execution(
  'dpl_publication_queue',
  repeat('e', 40),
  120
) claim;

SELECT extensions.ok(
  (
    SELECT
      claim.run_id = run.run_id
      AND claim.advocate_id = run.advocate_id
      AND claim.domain_id = run.domain_id
      AND claim.hostname = run.hostname
      AND claim.expected_advocate_version = run.expected_advocate_version
      AND claim.deployment_id = run.deployment_id
      AND claim.revision = run.revision
      AND claim.stripe_us_attempt_id = run.stripe_us_attempt_id
      AND claim.stripe_uk_attempt_id = run.stripe_uk_attempt_id
      AND claim.paypal_attempt_id = run.paypal_attempt_id
      AND claim.started_at = run.started_at
      AND claim.start_request_id =
        '9e200000-0000-4000-8000-000000000002'::uuid
      AND claim.trace_id = start.trace_id
      AND claim.admin_reason = start.admin_reason
      AND claim.lease_token IS NOT NULL
      AND claim.leased_until > clock_timestamp()
    FROM publication_test_queue_claims claim
    JOIN publication_test_runs run ON run.label = 'incomplete'
    JOIN audit.advocate_publication_canary_starts start
      ON start.run_id = run.run_id
    WHERE claim.label = 'first'
  ),
  'queue claim filters exact deployment and revision and returns the oldest full execution target'
);

INSERT INTO publication_test_queue_claims
SELECT 'second', claim.*
FROM public.claim_next_advocate_publication_canary_execution(
  'dpl_publication_queue',
  repeat('e', 40),
  120
) claim;

SELECT extensions.ok(
  (
    SELECT
      second.run_id = expected.run_id
      AND second.run_id <> first.run_id
      AND second.lease_token <> first.lease_token
    FROM publication_test_queue_claims second
    JOIN publication_test_queue_claims first ON first.label = 'first'
    JOIN publication_test_runs expected ON expected.label = 'queue_old'
    WHERE second.label = 'second'
  ),
  'a concurrent queue claimant skips the active oldest lease and atomically owns the next FIFO start'
);

UPDATE audit.advocate_publication_canary_execution_leases execution_lease
SET
  leased_at = clock_timestamp() - interval '2 minutes',
  leased_until = clock_timestamp() - interval '1 minute',
  updated_at = clock_timestamp()
WHERE execution_lease.run_id = (
  SELECT run_id
  FROM publication_test_queue_claims
  WHERE label = 'first'
);

INSERT INTO publication_test_queue_claims
SELECT 'reclaimed_first', claim.*
FROM public.claim_next_advocate_publication_canary_execution(
  'dpl_publication_queue',
  repeat('e', 40),
  120
) claim;

SELECT extensions.ok(
  (
    SELECT
      reclaimed.run_id = original.run_id
      AND reclaimed.lease_token <> original.lease_token
      AND reclaimed.leased_until > clock_timestamp()
      AND execution_lease.lease_version = 2
      AND execution_lease.lease_token = reclaimed.lease_token
    FROM publication_test_queue_claims reclaimed
    JOIN publication_test_queue_claims original ON original.label = 'first'
    JOIN audit.advocate_publication_canary_execution_leases execution_lease
      ON execution_lease.run_id = reclaimed.run_id
    WHERE reclaimed.label = 'reclaimed_first'
  ),
  'the queue reclaims the oldest expired execution with a rotated token before newer work'
);

INSERT INTO publication_test_queue_claims
SELECT 'third', claim.*
FROM public.claim_next_advocate_publication_canary_execution(
  'dpl_publication_queue',
  repeat('e', 40),
  120
) claim;

SELECT extensions.is(
  (
    SELECT claim.run_id
    FROM publication_test_queue_claims claim
    WHERE claim.label = 'third'
  ),
  (
    SELECT run.run_id
    FROM publication_test_runs run
    WHERE run.label = 'queue_new'
  ),
  'the queue advances to the next FIFO start after active leases are excluded'
);

SELECT extensions.is(
  (
    SELECT count(*)::bigint
    FROM public.claim_next_advocate_publication_canary_execution(
      'dpl_publication_queue',
      repeat('e', 40),
      120
    )
  ),
  0::bigint,
  'the queue returns zero rows when no matching incomplete execution is eligible'
);

INSERT INTO publication_test_queue_claims
SELECT 'other_deployment', claim.*
FROM public.claim_next_advocate_publication_canary_execution(
  'dpl_other_publication_gate',
  repeat('a', 40),
  120
) claim;

SELECT extensions.is(
  (
    SELECT claim.run_id
    FROM publication_test_queue_claims claim
    WHERE claim.label = 'other_deployment'
  ),
  (
    SELECT run.run_id
    FROM publication_test_runs run
    WHERE run.label = 'queue_other_deployment'
  ),
  'queue selection never crosses the exact deployment identity'
);

INSERT INTO publication_test_queue_claims
SELECT 'other_revision', claim.*
FROM public.claim_next_advocate_publication_canary_execution(
  'dpl_publication_gate',
  repeat('b', 40),
  120
) claim;

SELECT extensions.is(
  (
    SELECT claim.run_id
    FROM publication_test_queue_claims claim
    WHERE claim.label = 'other_revision'
  ),
  (
    SELECT run.run_id
    FROM publication_test_runs run
    WHERE run.label = 'queue_other_revision'
  ),
  'queue selection never crosses the exact Git revision identity'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

WITH published AS (
  SELECT public.publish_advocate_portal_from_canary(
    (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
    (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
    (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
    'dpl_publication_gate',
    (
      SELECT report.report_sha256
      FROM audit.advocate_publication_canary_reports report
      JOIN publication_test_runs run ON run.run_id = report.run_id
      WHERE run.label = 'valid'
    ),
    'Approve the exact tested portal',
    '9e600000-0000-4000-8000-000000000012'::uuid,
    'publication-approval-success'
  ) AS resulting_version
)
INSERT INTO publication_test_context (key, bigint_value)
SELECT 'resulting_version', resulting_version
FROM published;

SELECT extensions.is(
  (SELECT bigint_value FROM publication_test_context WHERE key = 'resulting_version'),
  (SELECT bigint_value + 1 FROM publication_test_context WHERE key = 'advocate'),
  'successful publication returns the one-step optimistic advocate version'
);

SELECT extensions.ok(
  (
    SELECT
      domain.status = 'active'
      AND domain.dns_verified_at = report.completed_at
      AND domain.tls_ready_at = report.completed_at
      AND domain.payments_ready_at = report.completed_at
      AND domain.activated_at IS NOT NULL
    FROM public.advocate_domains domain
    JOIN publication_test_runs run ON run.domain_id = domain.id
      AND run.label = 'valid'
    JOIN audit.advocate_publication_canary_reports report
      ON report.run_id = run.run_id
  ),
  'successful publication activates the exact domain with honest canary timestamps'
);

SELECT extensions.ok(
  (
    SELECT
      advocate.publication_status = 'active'
      AND advocate.relationship_status = 'active'
      AND advocate.published_at IS NOT NULL
      AND advocate.version = (
        SELECT bigint_value
        FROM publication_test_context
        WHERE key = 'resulting_version'
      )
    FROM public.advocates advocate
    WHERE advocate.id = (
      SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
    )
  ),
  'successful publication atomically activates the eligible advocate version'
);

SELECT extensions.ok(
  (
    SELECT
      approval.approving_user_id =
        '9e000000-0000-4000-8000-000000000001'::uuid
      AND approval.advocate_id = run.advocate_id
      AND approval.domain_id = run.domain_id
      AND approval.hostname = run.hostname
      AND approval.expected_advocate_version = run.expected_advocate_version
      AND approval.resulting_advocate_version = (
        SELECT bigint_value
        FROM publication_test_context
        WHERE key = 'resulting_version'
      )
      AND approval.canary_run_id = run.run_id
      AND approval.deployment_id = run.deployment_id
      AND approval.report_sha256 = report.report_sha256
      AND approval.canary_completed_at = report.completed_at
      AND octet_length(approval.provider_evidence_binding_sha256) = 32
      AND octet_length(approval.publication_binding_sha256) = 32
      AND approval.admin_reason = 'Approve the exact tested portal'
      AND approval.trace_id = 'publication-approval-success'
    FROM audit.advocate_publication_approvals approval
    JOIN publication_test_runs run ON run.run_id = approval.canary_run_id
    JOIN audit.advocate_publication_canary_reports report
      ON report.run_id = run.run_id
    WHERE approval.request_id =
      '9e600000-0000-4000-8000-000000000012'::uuid
  ),
  'the immutable receipt binds actor, run, report, deployment, domain, versions, provider evidence, request, reason, and trace'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'advocate_publication_approvals'
      AND event.advocate_id = (
        SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
      )
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        '9e000000-0000-4000-8000-000000000001'::uuid
      AND event.tool = 'creator-share-admin-publication'
      AND event.request_id = '9e600000-0000-4000-8000-000000000012'
      AND event.trace_id = 'publication-approval-success'
      AND event.reason = 'Approve the exact tested portal'
      AND event.metadata ->> 'correlation_id' = (
        SELECT run_id::text
        FROM publication_test_runs
        WHERE label = 'valid'
      )
      AND event.metadata ->> 'deployment_id' = 'dpl_publication_gate'
      AND event.metadata ->> 'domain_hostname' =
        'publicationgate.creatorshare.com'
      AND event.metadata ->> 'evidence_sha256' = (
        SELECT encode(report.report_sha256, 'hex')
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      )
  ),
  'the general audit ledger carries the complete bounded publication provenance'
);

SELECT extensions.is(
  public.publish_advocate_portal_from_canary(
    (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
    (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
    (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
    'dpl_publication_gate',
    (
      SELECT report.report_sha256
      FROM audit.advocate_publication_canary_reports report
      JOIN publication_test_runs run ON run.run_id = report.run_id
      WHERE run.label = 'valid'
    ),
    'Approve the exact tested portal',
    '9e600000-0000-4000-8000-000000000012'::uuid,
    'publication-approval-success'
  ),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'resulting_version'),
  'an exact lost-response replay returns the original resulting version'
);

SELECT extensions.is(
  public.publish_advocate_portal_from_canary(
    (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
    (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
    (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
    'dpl_publication_gate',
    (
      SELECT report.report_sha256
      FROM audit.advocate_publication_canary_reports report
      JOIN publication_test_runs run ON run.run_id = report.run_id
      WHERE run.label = 'valid'
    ),
    'Approve the exact tested portal',
    '9e600000-0000-4000-8000-000000000012'::uuid,
    'publication-approval-transport-retry'
  ),
  (SELECT bigint_value FROM publication_test_context WHERE key = 'resulting_version'),
  'publication replay ignores a changed transport trace and returns the immutable result'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM audit.advocate_publication_approvals
  )
  AND (
    SELECT advocate.version = context.bigint_value
    FROM public.advocates advocate
    JOIN publication_test_context context
      ON context.key = 'resulting_version'
    WHERE advocate.id = (
      SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
    )
  ),
  'exact replay creates no second receipt and performs no second lifecycle update'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Changed replay reason',
      '9e600000-0000-4000-8000-000000000012'::uuid,
      'publication-approval-success'
    )
  $$,
  '40001',
  'Advocate publication approval replay does not match the committed request',
  'idempotent replay rejects any changed immutable request input'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      decode(repeat('f', 64), 'hex'),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000012'::uuid,
      'publication-approval-digest-replay'
    )
  $$,
  '40001',
  'Advocate publication approval replay does not match the committed request',
  'idempotent replay rejects a changed report digest'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_other_deployment',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000012'::uuid,
      'publication-approval-deployment-replay'
    )
  $$,
  '40001',
  'Advocate publication approval replay does not match the committed request',
  'idempotent replay rejects a changed deployment identity'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000013'::uuid,
      'publication-approval-reused-run'
    )
  $$,
  '40001',
  'Advocate publication canary has already been used',
  'one completed report cannot be replayed under another publication request'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Approve the exact tested portal',
      '9e600000-0000-4000-8000-000000000012'::uuid,
      'publication-approval-success'
    )
  $$,
  '40001',
  'Advocate publication approval replay does not match the committed request',
  'another super administrator cannot claim a committed publication request'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.advocate_publication_approvals
    SET trace_id = 'mutated'
    WHERE request_id = '9e600000-0000-4000-8000-000000000012'::uuid
  $$,
  '42501',
  'Advocate publication approvals are append-only',
  'publication receipts cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.advocate_publication_approvals
    WHERE request_id = '9e600000-0000-4000-8000-000000000012'::uuid
  $$,
  '42501',
  'Advocate publication approvals are append-only',
  'publication receipts cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    TRUNCATE audit.advocate_publication_approvals
  $$,
  '42501',
  'Advocate publication approvals are append-only',
  'publication receipts cannot be truncated'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal_from_canary(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT run_id FROM publication_test_runs WHERE label = 'valid'),
      'dpl_publication_gate',
      (
        SELECT report.report_sha256
        FROM audit.advocate_publication_canary_reports report
        JOIN publication_test_runs run ON run.run_id = report.run_id
        WHERE run.label = 'valid'
      ),
      'Attempt service publication',
      '9e600000-0000-4000-8000-000000000014'::uuid,
      'publication-service-direct'
    )
  $$,
  '28000',
  'Authentication is required',
  'service role cannot directly publish even when invoked by a privileged test session'
);

SELECT * FROM extensions.finish();

ROLLBACK;
