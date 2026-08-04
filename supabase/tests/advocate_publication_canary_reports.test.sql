BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '45s';

SELECT extensions.plan(46);

CREATE TEMP TABLE canary_test_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  bigint_value bigint,
  timestamp_value timestamp with time zone,
  text_value text,
  bytea_value bytea
) ON COMMIT DROP;

CREATE TEMP TABLE canary_test_claims (
  provider public.advocate_domain_integration_provider PRIMARY KEY,
  job_id uuid NOT NULL,
  lease_token uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE canary_test_begin (
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

CREATE TEMP TABLE canary_test_reports (
  label text PRIMARY KEY,
  report_text text NOT NULL,
  report_sha256 bytea NOT NULL,
  completed_at timestamp with time zone NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.provider_result(
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
      'provider_resource_id', 'canaryreports.creatorshare.com',
      'deployment_id', 'prj_canary_reports',
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

CREATE OR REPLACE FUNCTION pg_temp.canonical_canary_report(
  target_run_id uuid,
  target_outcome text,
  target_error_code text,
  target_completed_at timestamp with time zone,
  substitute_stripe_us_attempt_id uuid DEFAULT NULL
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
        date_trunc('milliseconds', start.started_at) AT TIME ZONE 'UTC',
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
          'name', 'unprovisioned_sibling_dns_absent',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'hostname', 'unused-canaryreports.creatorshare.com',
            'unprovisioned', true,
            'resolved', false,
            'record_types', jsonb_build_array(),
            'answer_count', 0,
            'observed_at', source.started_at_text
          )
        ),
        jsonb_build_object(
          'name', 'negative_sentinel_hidden',
          'outcome', 'succeeded',
          'started_at', source.started_at_text,
          'completed_at', source.started_at_text,
          'evidence', jsonb_build_object(
            'schema_version', 1,
            'hostname', 'publication-sentinel.creatorshare.com',
            'cloudflare_ready', true,
            'vercel_ready', true,
            'dns_target_matched', true,
            'tls_certificate_verified', true,
            'tls_hostname_match', true,
            'tls_normal_certificate_verification', true,
            'tls_protocol', 'TLSv1.3',
            'http_status', 404,
            'content_type', 'text/html; charset=utf-8',
            'body_bytes', 64,
            'body_sha256', repeat('2', 64),
            'redirected', false,
            'generic_not_found', true,
            'identical_to_tenant_root', true,
            'observed_at', source.started_at_text
          )
        )
      ) || CASE
        WHEN target_outcome = 'failed' THEN jsonb_build_array(
          jsonb_build_object(
            'name', 'stripe_us_payment_canary',
            'outcome', 'failed',
            'started_at', source.started_at_text,
            'completed_at', source.started_at_text,
            'evidence', jsonb_build_object(
              'schema_version', 1,
              'failure_code', 'stripe_us_payment_canary_failed'
            )
          )
        )
        ELSE jsonb_build_array(
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
        )
      END AS steps
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
          'stripe_us', COALESCE(
            substitute_stripe_us_attempt_id,
            report.stripe_us_attempt_id
          ),
          'stripe_uk', report.stripe_uk_attempt_id,
          'paypal', report.paypal_attempt_id
        )
      ),
      'started_at', report.started_at_text,
      'completed_at', report.completed_at_text,
      'outcome', target_outcome,
      'error_code', target_error_code,
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
    '9d000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'canary-admin-one@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '9d000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'canary-admin-two@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '9d000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'canary-member@example.test',
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
    ('9d000000-0000-4000-8000-000000000001'::uuid),
    ('9d000000-0000-4000-8000-000000000002'::uuid)
) AS actor(user_id)
CROSS JOIN public.roles role
WHERE role.name = 'SUPER_ADMIN';

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

WITH created AS (
  SELECT public.create_advocate_portal(
    '9d000000-0000-4000-8000-000000000001'::uuid,
    'canaryreports',
    'Canary Reports',
    'Create the publication canary report fixture',
    'creator',
    'canary-reports-create-request',
    'canary-reports-create-trace',
    'canary-reports-create-session'
  ) AS advocate_id
)
INSERT INTO canary_test_context (key, uuid_value)
SELECT 'advocate', advocate_id FROM created;

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    uuid_value,
    'canaryreports.creatorshare.com',
    true
  FROM canary_test_context
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO canary_test_context (key, uuid_value)
SELECT 'domain', id FROM inserted;

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.uuid_value,
  domain.uuid_value,
  expected.provider::public.advocate_domain_integration_provider,
  expected.environment
FROM canary_test_context advocate
CROSS JOIN canary_test_context domain
CROSS JOIN (
  VALUES
    ('cloudflare', 'production'),
    ('vercel', 'production'),
    ('stripe_us', 'live'),
    ('stripe_uk', 'live'),
    ('paypal', 'live')
) AS expected(provider, environment)
WHERE advocate.key = 'advocate'
  AND domain.key = 'domain';

INSERT INTO canary_test_context (key, uuid_value)
SELECT
  'job_' || integration.provider::text,
  public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'provision',
    clock_timestamp(),
    'canary-report-provision-' || integration.provider::text
  )
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT uuid_value FROM canary_test_context WHERE key = 'domain'
);

INSERT INTO canary_test_claims (provider, job_id, lease_token)
SELECT claimed.provider, claimed.job_id, claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'canary-report-provider-worker',
  5,
  interval '10 minutes'
) claimed;

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  pg_temp.provider_result(claim.provider)
)
FROM canary_test_claims claim;

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  pg_temp.provider_result(claim.provider)
)
FROM canary_test_claims claim;

UPDATE canary_test_context context
SET bigint_value = advocate.version
FROM public.advocates advocate
WHERE context.key = 'advocate'
  AND advocate.id = context.uuid_value;

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.begin_advocate_publication_canary(uuid,bigint,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.begin_or_resume_advocate_publication_canary(uuid,bigint,uuid,text,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.begin_advocate_publication_canary(uuid,bigint,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.begin_advocate_publication_canary(uuid,bigint,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'only the authenticated durable-operation boundary may start or resume a canary'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.complete_advocate_publication_canary(uuid,text,bytea,text,text,timestamp with time zone,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.complete_advocate_publication_canary(uuid,text,bytea,text,text,timestamp with time zone,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.complete_advocate_publication_canary(uuid,text,bytea,text,text,timestamp with time zone,uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_claimed_advocate_publication_canary(uuid,text,bytea,text,text,timestamp with time zone,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'service completion is exposed only through the durable execution lease boundary'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon',
    'audit.advocate_publication_canary_starts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'audit.advocate_publication_canary_starts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_publication_canary_starts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'anon',
    'audit.advocate_publication_canary_reports',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'audit.advocate_publication_canary_reports',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_publication_canary_reports',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'no runtime role has direct access to either forensic table'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'private.advocate_publication_canary_report_is_publishable(uuid,uuid,bigint,text,bytea)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.advocate_publication_canary_report_is_publishable(uuid,uuid,bigint,text,bytea)',
    'EXECUTE'
  ),
  'the publishability proof has zero direct runtime exposure'
);

SELECT set_config('request.jwt.claim.sub', '', true);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000001'::uuid,
      'dpl_canary_reports',
      repeat('a', 40),
      'canary-start-unauthenticated',
      'Begin exact publication canaries'
    )
  $$,
  '28000',
  'Authentication is required',
  'canary start requires an authenticated user'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000003',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000002'::uuid,
      'dpl_canary_reports',
      repeat('a', 40),
      'canary-start-member',
      'Begin exact publication canaries'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'an ordinary authenticated user cannot begin a canary'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000002',
  true
);
UPDATE auth.users
SET banned_until = clock_timestamp() + interval '1 hour'
WHERE id = '9d000000-0000-4000-8000-000000000002'::uuid;

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000003'::uuid,
      'dpl_canary_reports',
      repeat('a', 40),
      'canary-start-banned',
      'Begin exact publication canaries'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned super administrator cannot begin a canary'
);

UPDATE auth.users
SET banned_until = NULL
WHERE id = '9d000000-0000-4000-8000-000000000002'::uuid;
SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value - 1 FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000004'::uuid,
      'dpl_canary_reports',
      repeat('a', 40),
      'canary-start-stale-version',
      'Begin exact publication canaries'
    )
  $$,
  '40001',
  'Advocate portal version changed before canary start',
  'canary start fails closed on an optimistic version conflict'
);

WITH inserted AS (
  INSERT INTO public.advocate_domain_integrations (
    advocate_id,
    domain_id,
    provider,
    environment,
    is_required
  )
  SELECT
    advocate.uuid_value,
    domain.uuid_value,
    'stripe_us',
    'test',
    false
  FROM canary_test_context advocate
  CROSS JOIN canary_test_context domain
  WHERE advocate.key = 'advocate'
    AND domain.key = 'domain'
  RETURNING id
)
INSERT INTO canary_test_context (key, uuid_value)
SELECT 'extra_integration', id FROM inserted;

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000005'::uuid,
      'dpl_canary_reports',
      repeat('a', 40),
      'canary-start-malformed-topology',
      'Begin exact publication canaries'
    )
  $$,
  '55000',
  'Exact five-provider readiness evidence is not publishable',
  'a sixth integration makes the provider topology ineligible'
);

DELETE FROM public.advocate_domain_integrations
WHERE id = (
  SELECT uuid_value FROM canary_test_context WHERE key = 'extra_integration'
);

INSERT INTO canary_test_begin
SELECT
  'success',
  result.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
  '9d100000-0000-4000-8000-000000000010'::uuid,
  'dpl_canary_reports',
  repeat('a', 40),
  'canary-start-success',
  'Begin exact publication canaries'
) result;

SELECT extensions.ok(
  (
    SELECT
      run_id IS NOT NULL
      AND advocate_id = (
        SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'
      )
      AND domain_id = (
        SELECT uuid_value FROM canary_test_context WHERE key = 'domain'
      )
      AND hostname = 'canaryreports.creatorshare.com'
      AND expected_advocate_version = (
        SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'
      )
      AND deployment_id = 'dpl_canary_reports'
      AND revision = repeat('a', 40)
      AND stripe_us_attempt_id <> stripe_uk_attempt_id
      AND stripe_us_attempt_id <> paypal_attempt_id
      AND stripe_uk_attempt_id <> paypal_attempt_id
    FROM canary_test_begin
    WHERE label = 'success'
  ),
  'begin returns only exact runner-safe target and attempt identifiers'
);

SELECT extensions.ok(
  (
    SELECT
      start.initiating_user_id =
        '9d000000-0000-4000-8000-000000000001'::uuid
      AND octet_length(start.provider_evidence_binding_sha256) = 32
      AND start.request_id =
        '9d100000-0000-4000-8000-000000000010'::uuid
      AND start.trace_id = 'canary-start-success'
      AND start.admin_reason = 'Begin exact publication canaries'
    FROM audit.advocate_publication_canary_starts start
    JOIN canary_test_begin result ON result.run_id = start.run_id
    WHERE result.label = 'success'
  ),
  'the private start row preserves actor, correlation, reason, and evidence binding'
);

INSERT INTO canary_test_begin
SELECT
  'replay',
  result.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
  '9d100000-0000-4000-8000-000000000010'::uuid,
  'dpl_canary_reports',
  repeat('a', 40),
  'canary-start-success',
  'Begin exact publication canaries'
) result;

SELECT extensions.ok(
  (
    SELECT
      original.run_id = replay.run_id
      AND original.stripe_us_attempt_id = replay.stripe_us_attempt_id
      AND original.stripe_uk_attempt_id = replay.stripe_uk_attempt_id
      AND original.paypal_attempt_id = replay.paypal_attempt_id
      AND original.started_at = replay.started_at
    FROM canary_test_begin original
    JOIN canary_test_begin replay ON replay.label = 'replay'
    WHERE original.label = 'success'
  )
  AND (
    SELECT count(*) = 1
    FROM audit.advocate_publication_canary_starts
    WHERE request_id = '9d100000-0000-4000-8000-000000000010'::uuid
  ),
  'exact begin replay returns the original run without a second record'
);

INSERT INTO canary_test_begin
SELECT
  'replay_changed_trace',
  result.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
  '9d100000-0000-4000-8000-000000000010'::uuid,
  'dpl_canary_reports',
  repeat('a', 40),
  'canary-start-transport-retry',
  'Begin exact publication canaries'
) result;

SELECT extensions.ok(
  (
    SELECT
      original.run_id = replay.run_id
      AND original.stripe_us_attempt_id = replay.stripe_us_attempt_id
      AND original.stripe_uk_attempt_id = replay.stripe_uk_attempt_id
      AND original.paypal_attempt_id = replay.paypal_attempt_id
    FROM canary_test_begin original
    JOIN canary_test_begin replay ON replay.label = 'replay_changed_trace'
    WHERE original.label = 'success'
  )
  AND (
    SELECT start.trace_id = 'canary-start-success'
    FROM audit.advocate_publication_canary_starts start
    WHERE start.request_id =
      '9d100000-0000-4000-8000-000000000010'::uuid
  ),
  'begin transport retry may change trace while preserving the committed run and first trace'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000011'::uuid,
      'dpl_canary_reports',
      repeat('a', 40),
      'canary-start-double-click',
      'Begin exact publication canaries'
    )
  $$,
  '40001',
  'An equivalent advocate publication canary is already in progress',
  'a second request cannot duplicate a fresh incomplete target and build'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000010'::uuid,
      'dpl_changed',
      repeat('a', 40),
      'canary-start-success',
      'Begin exact publication canaries'
    )
  $$,
  '40001',
  'Advocate publication canary replay does not match the committed request',
  'a reused begin request conflicts when any input changes'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000010'::uuid,
      'dpl_canary_reports',
      repeat('a', 40),
      'canary-start-success',
      'Begin exact publication canaries'
    )
  $$,
  '40001',
  'Advocate publication canary replay does not match the committed request',
  'a different super administrator cannot replay another actor request'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000012'::uuid,
      'dpl_canary_reports',
      repeat('a', 40),
      'canary-start-other-admin',
      'Begin exact publication canaries'
    )
  $$,
  '40001',
  'An equivalent advocate publication canary is already in progress',
  'a different administrator cannot duplicate the same fresh incomplete work'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.lives_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000013'::uuid,
      'dpl_canary_reports',
      repeat('d', 40),
      'canary-start-independent-build',
      'Begin an independent publication build'
    )
  $$,
  'the single-flight boundary keeps a different build independent'
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
  '9d300000-0000-4000-8000-000000000025'::uuid,
  '9d300000-0000-4000-8000-000000000026'::uuid,
  start.initiating_user_id,
  start.advocate_id,
  start.expected_advocate_version,
  start.domain_id,
  start.hostname,
  'dpl_canary_reports',
  repeat('e', 40),
  'canary-start-abandoned-fresh',
  'Retain an abandoned but fresh canary start',
  start.provider_evidence_binding_sha256,
  '9d400000-0000-4000-8000-000000000025'::uuid,
  '9d400000-0000-4000-8000-000000000026'::uuid,
  '9d400000-0000-4000-8000-000000000027'::uuid,
  clock_timestamp() - interval '25 minutes'
FROM audit.advocate_publication_canary_starts start
WHERE start.run_id = (
  SELECT run_id FROM canary_test_begin WHERE label = 'success'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d300000-0000-4000-8000-000000000027'::uuid,
      'dpl_canary_reports',
      repeat('e', 40),
      'canary-start-before-cooldown',
      'Retry abandoned publication work too early'
    )
  $$,
  '40001',
  'An equivalent advocate publication canary is already in progress',
  'an unleased 25 minute old start still owns its exact target and build'
);

INSERT INTO canary_test_reports (
  label,
  report_text,
  report_sha256,
  completed_at
)
SELECT
  'success',
  report_text,
  extensions.digest(pg_catalog.convert_to(report_text, 'UTF8'), 'sha256'),
  completed_at
FROM (
  SELECT
    pg_temp.canonical_canary_report(
      result.run_id,
      'succeeded',
      NULL,
      date_trunc('milliseconds', clock_timestamp())
    ) AS report_text,
    date_trunc('milliseconds', clock_timestamp()) AS completed_at
  FROM canary_test_begin result
  WHERE result.label = 'success'
) report;

-- Rebuild once so the exact timestamp inside the report and the input are the
-- same value rather than two close clock_timestamp calls.
UPDATE canary_test_reports report
SET
  report_text = pg_temp.canonical_canary_report(
    (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
    'succeeded',
    NULL,
    report.completed_at
  ),
  report_sha256 = extensions.digest(
    pg_catalog.convert_to(
      pg_temp.canonical_canary_report(
        (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
        'succeeded',
        NULL,
        report.completed_at
      ),
      'UTF8'
    ),
    'sha256'
  )
WHERE label = 'success';

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000001'::uuid,
      'canary-complete-wrong-actor',
      'Begin exact publication canaries'
    )
  $$,
  '42501',
  'Publication canary runner service role is required',
  'even the initiating super administrator cannot persist a fabricated report directly'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      decode(repeat('ab', 32), 'hex'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000002'::uuid,
      'canary-complete-wrong-digest',
      'Begin exact publication canaries'
    )
  $$,
  '22023',
  'Publication canary report SHA256 does not match its exact UTF8 bytes',
  'completion independently rejects an incorrect report digest'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      repeat('x', 65537),
      extensions.digest(repeat('x', 65537), 'sha256'),
      'succeeded',
      NULL,
      clock_timestamp(),
      '9d200000-0000-4000-8000-000000000003'::uuid,
      'canary-complete-oversize',
      'Begin exact publication canaries'
    )
  $$,
  '22023',
  'Advocate publication canary completion input is invalid',
  'completion rejects a report over 64 KiB before parsing it'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'succeeded',
      'dns_exact_host_failed',
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000004'::uuid,
      'canary-complete-success-code',
      'Begin exact publication canaries'
    )
  $$,
  '22023',
  'Publication canary outcome and failure code do not match',
  'a succeeded report must not carry a failure code'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'failed',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000005'::uuid,
      'canary-complete-failure-no-code',
      'Begin exact publication canaries'
    )
  $$,
  '22023',
  'Publication canary outcome and failure code do not match',
  'a failed report requires one allowlisted static failure code'
);

INSERT INTO canary_test_reports (
  label,
  report_text,
  report_sha256,
  completed_at
)
SELECT
  'wrong_target',
  report_text,
  extensions.digest(pg_catalog.convert_to(report_text, 'UTF8'), 'sha256'),
  completed_at
FROM (
  SELECT
    pg_temp.canonical_canary_report(
      result.run_id,
      'succeeded',
      NULL,
      success.completed_at,
      gen_random_uuid()
    ) AS report_text,
    success.completed_at
  FROM canary_test_begin result
  CROSS JOIN canary_test_reports success
  WHERE result.label = 'success'
    AND success.label = 'success'
) report;

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'wrong_target'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'wrong_target'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'wrong_target'),
      '9d200000-0000-4000-8000-000000000006'::uuid,
      'canary-complete-wrong-target',
      'Begin exact publication canaries'
    )
  $$,
  '22023',
  'Publication canary report target binding does not match its start',
  'completion rejects a report bound to another payment attempt identity'
);

INSERT INTO canary_test_context (
  key,
  uuid_value,
  timestamp_value
)
SELECT
  'drift_integration',
  integration.id,
  integration.last_verified_at
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT uuid_value FROM canary_test_context WHERE key = 'domain'
)
  AND integration.provider = 'cloudflare';

UPDATE public.advocate_domain_integrations integration
SET last_verified_at = integration.last_verified_at + interval '1 microsecond'
WHERE integration.id = (
  SELECT uuid_value FROM canary_test_context WHERE key = 'drift_integration'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000007'::uuid,
      'canary-complete-provider-drift',
      'Begin exact publication canaries'
    )
  $$,
  '40001',
  'Publication canary provider evidence binding changed',
  'completion fails closed when provider evidence drifts after start'
);

UPDATE public.advocate_domain_integrations integration
SET last_verified_at = context.timestamp_value
FROM canary_test_context context
WHERE context.key = 'drift_integration'
  AND integration.id = context.uuid_value;

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000009'::uuid,
      'canary-complete-reason-change',
      'Changed completion reason before first commit'
    )
  $$,
  '40001',
  'Advocate publication canary completion reason changed',
  'completion cannot replace the immutable administrator reason captured at start'
);

SELECT extensions.is(
  (
    SELECT outcome
    FROM public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000010'::uuid,
      'canary-complete-success',
      'Begin exact publication canaries'
    )
  ),
  'succeeded',
  'a valid unchanged report completes successfully'
);

SELECT extensions.ok(
  (
    SELECT
      report.canonical_report_text = expected.report_text
      AND report.report_sha256 = expected.report_sha256
      AND report.completing_user_id =
        '9d000000-0000-4000-8000-000000000001'::uuid
      AND report.completion_request_id =
        '9d200000-0000-4000-8000-000000000010'::uuid
      AND report.trace_id = 'canary-complete-success'
      AND report.admin_reason = 'Begin exact publication canaries'
    FROM audit.advocate_publication_canary_reports report
    JOIN canary_test_reports expected ON expected.label = 'success'
    WHERE report.run_id = (
      SELECT run_id FROM canary_test_begin WHERE label = 'success'
    )
  ),
  'completion stores the exact report bytes, digest, actor, and forensic provenance'
);

SELECT extensions.ok(
  (
    SELECT outcome = 'succeeded'
    FROM public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000010'::uuid,
      'canary-complete-success',
      'Begin exact publication canaries'
    )
  )
  AND (
    SELECT count(*) = 1
    FROM audit.advocate_publication_canary_reports
    WHERE run_id = (
      SELECT run_id FROM canary_test_begin WHERE label = 'success'
    )
  ),
  'exact completion replay returns the original single report'
);

SELECT extensions.ok(
  (
    SELECT outcome = 'succeeded'
    FROM public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000010'::uuid,
      'canary-complete-changed-replay',
      'Begin exact publication canaries'
    )
  )
  AND (
    SELECT
      report.trace_id = 'canary-complete-success'
      AND count(*) OVER () = 1
    FROM audit.advocate_publication_canary_reports report
    WHERE report.run_id = (
      SELECT run_id FROM canary_test_begin WHERE label = 'success'
    )
  ),
  'completion transport retry may change trace while preserving the committed report and first trace'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'success'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'success'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'success'),
      '9d200000-0000-4000-8000-000000000010'::uuid,
      'canary-complete-success',
      'Changed semantic completion reason'
    )
  $$,
  '40001',
  'Advocate publication canary completion reason changed',
  'a completion replay still conflicts when semantic input changes'
);

SELECT extensions.ok(
  private.advocate_publication_canary_report_is_publishable(
    (SELECT advocate_id FROM canary_test_begin WHERE label = 'success'),
    (SELECT domain_id FROM canary_test_begin WHERE label = 'success'),
    (
      SELECT expected_advocate_version
      FROM canary_test_begin
      WHERE label = 'success'
    ),
    'dpl_canary_reports',
    (SELECT report_sha256 FROM canary_test_reports WHERE label = 'success')
  ),
  'the private helper proves the exact recent successful report publishable'
);

SELECT extensions.ok(
  NOT private.advocate_publication_canary_report_is_publishable(
    (SELECT advocate_id FROM canary_test_begin WHERE label = 'success'),
    (SELECT domain_id FROM canary_test_begin WHERE label = 'success'),
    (
      SELECT expected_advocate_version
      FROM canary_test_begin
      WHERE label = 'success'
    ),
    'dpl_canary_reports',
    decode(repeat('ff', 32), 'hex')
  ),
  'the publishability helper fails closed on a different report digest'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO canary_test_begin
SELECT
  'failure',
  result.*
FROM public.begin_advocate_publication_canary(
  (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
  (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
  '9d100000-0000-4000-8000-000000000020'::uuid,
  'dpl_canary_reports',
  repeat('b', 40),
  'canary-start-failure',
  'Begin another exact publication canary'
) result;

INSERT INTO canary_test_reports (
  label,
  report_text,
  report_sha256,
  completed_at
)
SELECT
  'failure',
  report_text,
  extensions.digest(pg_catalog.convert_to(report_text, 'UTF8'), 'sha256'),
  completed_at
FROM (
  SELECT
    pg_temp.canonical_canary_report(
      result.run_id,
      'failed',
      'stripe_us_payment_canary_failed',
      date_trunc('milliseconds', clock_timestamp())
    ) AS report_text,
    date_trunc('milliseconds', clock_timestamp()) AS completed_at
  FROM canary_test_begin result
  WHERE result.label = 'failure'
) report;

UPDATE canary_test_reports report
SET
  report_text = pg_temp.canonical_canary_report(
    (SELECT run_id FROM canary_test_begin WHERE label = 'failure'),
    'failed',
    'stripe_us_payment_canary_failed',
    report.completed_at
  ),
  report_sha256 = extensions.digest(
    pg_catalog.convert_to(
      pg_temp.canonical_canary_report(
        (SELECT run_id FROM canary_test_begin WHERE label = 'failure'),
        'failed',
        'stripe_us_payment_canary_failed',
        report.completed_at
      ),
      'UTF8'
    ),
    'sha256'
  )
WHERE label = 'failure';

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.is(
  (
    SELECT outcome
    FROM public.complete_advocate_publication_canary(
      (SELECT run_id FROM canary_test_begin WHERE label = 'failure'),
      (SELECT report_text FROM canary_test_reports WHERE label = 'failure'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'failure'),
      'failed',
      'stripe_us_payment_canary_failed',
      (SELECT completed_at FROM canary_test_reports WHERE label = 'failure'),
      '9d200000-0000-4000-8000-000000000020'::uuid,
      'canary-complete-failure',
      'Begin another exact publication canary'
    )
  ),
  'failed',
  'an allowlisted failed report is retained as an immutable completion'
);

SELECT extensions.ok(
  (
    SELECT
      report.outcome = 'failed'
      AND report.failure_code = 'stripe_us_payment_canary_failed'
      AND report.canonical_report_text = expected.report_text
      AND report.report_sha256 = expected.report_sha256
    FROM audit.advocate_publication_canary_reports report
    JOIN canary_test_reports expected ON expected.label = 'failure'
    WHERE report.run_id = (
      SELECT run_id FROM canary_test_begin WHERE label = 'failure'
    )
  ),
  'failed completion stores the allowlisted static code and exact report bytes'
);

SELECT extensions.ok(
  NOT private.advocate_publication_canary_report_is_publishable(
    (SELECT advocate_id FROM canary_test_begin WHERE label = 'failure'),
    (SELECT domain_id FROM canary_test_begin WHERE label = 'failure'),
    (
      SELECT expected_advocate_version
      FROM canary_test_begin
      WHERE label = 'failure'
    ),
    'dpl_canary_reports',
    (SELECT report_sha256 FROM canary_test_reports WHERE label = 'failure')
  ),
  'a failed completion is never publishable'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.lives_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d100000-0000-4000-8000-000000000021'::uuid,
      'dpl_canary_reports',
      repeat('b', 40),
      'canary-start-after-failure',
      'Retry a failed publication canary'
    )
  $$,
  'a failed terminal report permits a fresh operation for the same target and build'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- A privileged fixture can construct an old immutable start, but the runtime
-- completion boundary must still reject it.
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
  '9d300000-0000-4000-8000-000000000001'::uuid,
  '9d300000-0000-4000-8000-000000000002'::uuid,
  '9d000000-0000-4000-8000-000000000001'::uuid,
  advocate.uuid_value,
  advocate.bigint_value,
  domain.uuid_value,
  'canaryreports.creatorshare.com',
  'dpl_canary_reports_stale',
  repeat('c', 40),
  'canary-start-stale',
  'Construct an old canary start fixture',
  private.advocate_publication_provider_binding_sha256(
    advocate.uuid_value,
    domain.uuid_value,
    clock_timestamp()
  ),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  clock_timestamp() - interval '30 minutes'
FROM canary_test_context advocate
CROSS JOIN canary_test_context domain
WHERE advocate.key = 'advocate'
  AND domain.key = 'domain';

INSERT INTO canary_test_reports (
  label,
  report_text,
  report_sha256,
  completed_at
)
SELECT
  'stale',
  report_text,
  extensions.digest(pg_catalog.convert_to(report_text, 'UTF8'), 'sha256'),
  completed_at
FROM (
  SELECT
    pg_temp.canonical_canary_report(
      '9d300000-0000-4000-8000-000000000001'::uuid,
      'succeeded',
      NULL,
      date_trunc('milliseconds', clock_timestamp())
    ) AS report_text,
    date_trunc('milliseconds', clock_timestamp()) AS completed_at
) report;

UPDATE canary_test_reports report
SET
  report_text = pg_temp.canonical_canary_report(
    '9d300000-0000-4000-8000-000000000001'::uuid,
    'succeeded',
    NULL,
    report.completed_at
  ),
  report_sha256 = extensions.digest(
    pg_catalog.convert_to(
      pg_temp.canonical_canary_report(
        '9d300000-0000-4000-8000-000000000001'::uuid,
        'succeeded',
        NULL,
        report.completed_at
      ),
      'UTF8'
    ),
    'sha256'
  )
WHERE label = 'stale';

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_advocate_publication_canary(
      '9d300000-0000-4000-8000-000000000001'::uuid,
      (SELECT report_text FROM canary_test_reports WHERE label = 'stale'),
      (SELECT report_sha256 FROM canary_test_reports WHERE label = 'stale'),
      'succeeded',
      NULL,
      (SELECT completed_at FROM canary_test_reports WHERE label = 'stale'),
      '9d300000-0000-4000-8000-000000000003'::uuid,
      'canary-complete-stale',
      'Construct an old canary start fixture'
    )
  $$,
  '55000',
  'Publication canary start or completion is stale',
  'completion requires a recent incomplete start'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9d000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.lives_ok(
  $$
    SELECT public.begin_advocate_publication_canary(
      (SELECT uuid_value FROM canary_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM canary_test_context WHERE key = 'advocate'),
      '9d300000-0000-4000-8000-000000000004'::uuid,
      'dpl_canary_reports_stale',
      repeat('c', 40),
      'canary-start-after-stale',
      'Retry an expired publication canary'
    )
  $$,
  'an incomplete start at the 30 minute boundary permits fresh work'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.advocate_publication_canary_starts
    SET admin_reason = 'Changed start evidence'
    WHERE run_id = (
      SELECT run_id FROM canary_test_begin WHERE label = 'success'
    )
  $$,
  '42501',
  'Advocate publication canary evidence is append-only',
  'start evidence cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.advocate_publication_canary_starts
    WHERE run_id = (
      SELECT run_id FROM canary_test_begin WHERE label = 'success'
    )
  $$,
  '42501',
  'Advocate publication canary evidence is append-only',
  'start evidence cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.advocate_publication_canary_reports
    SET admin_reason = 'Changed completion evidence'
    WHERE run_id = (
      SELECT run_id FROM canary_test_begin WHERE label = 'success'
    )
  $$,
  '42501',
  'Advocate publication canary evidence is append-only',
  'completion evidence cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.advocate_publication_canary_reports
    WHERE run_id = (
      SELECT run_id FROM canary_test_begin WHERE label = 'success'
    )
  $$,
  '42501',
  'Advocate publication canary evidence is append-only',
  'completion evidence cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    TRUNCATE audit.advocate_publication_canary_reports
  $$,
  '42501',
  'Advocate publication canary evidence is append-only',
  'completion evidence cannot be truncated'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM audit.audit_events event
    WHERE event.table_name = 'advocate_publication_canary_starts'
      AND event.record_pk ->> 'run_id' = (
        SELECT run_id::text FROM canary_test_begin WHERE label = 'success'
      )
      AND event.request_id =
        '9d100000-0000-4000-8000-000000000010'
      AND event.trace_id = 'canary-start-success'
      AND event.reason = 'Begin exact publication canaries'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
  )
  AND (
    SELECT count(*) = 1
    FROM audit.audit_events event
    WHERE event.table_name = 'advocate_publication_canary_reports'
      AND event.record_pk ->> 'run_id' = (
        SELECT run_id::text FROM canary_test_begin WHERE label = 'success'
      )
      AND event.request_id =
        '9d200000-0000-4000-8000-000000000010'
      AND event.trace_id = 'canary-complete-success'
      AND event.reason = 'Begin exact publication canaries'
      AND event.actor_type = 'system'
      AND event.actor_user_id IS NULL
      AND event.effective_user_id =
        '9d000000-0000-4000-8000-000000000001'::uuid
      AND event.system_actor = 'advocate-publication-canary-runner'
      AND event.tool = 'advocate-publication-canary-runner'
      AND event.before_data IS NULL
      AND event.after_data IS NULL
  ),
  'both forensic records carry exact general-ledger audit provenance without report duplication'
);

SELECT * FROM extensions.finish();

ROLLBACK;
