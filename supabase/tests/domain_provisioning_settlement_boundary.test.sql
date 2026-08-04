BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '30s';

SELECT extensions.plan(41);

CREATE TEMP TABLE settlement_test_context (
  key text PRIMARY KEY,
  uuid_value uuid
) ON COMMIT DROP;

CREATE TEMP TABLE settlement_test_claims (
  label text PRIMARY KEY,
  job_id uuid NOT NULL,
  provider public.advocate_domain_integration_provider NOT NULL,
  lease_token uuid NOT NULL
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
VALUES (
  '98000000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'settlement-admin@example.test',
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
SELECT
  '98000000-0000-4000-8000-000000000001'::uuid,
  role.id,
  NULL,
  NULL
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES (
    'settlementboundary',
    'Settlement Boundary',
    'active',
    'provisioning'
  )
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'main_advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    uuid_value,
    'settlementboundary.creatorshare.com',
    true
  FROM settlement_test_context
  WHERE key = 'main_advocate'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'main_domain', id FROM inserted;

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.uuid_value,
  domain.uuid_value,
  provider.provider::public.advocate_domain_integration_provider,
  provider.environment
FROM settlement_test_context advocate
CROSS JOIN settlement_test_context domain
CROSS JOIN (
  VALUES
    ('cloudflare', 'production'),
    ('vercel', 'production'),
    ('stripe_us', 'live'),
    ('stripe_uk', 'live'),
    ('paypal', 'live')
) AS provider(provider, environment)
WHERE advocate.key = 'main_advocate'
  AND domain.key = 'main_domain';

SELECT extensions.ok(
  has_table_privilege('service_role', 'public.advocate_domains', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.advocate_domains', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.advocate_domains', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.advocate_domains', 'DELETE')
  AND has_table_privilege('service_role', 'public.advocate_domain_integrations', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.advocate_domain_integrations', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.advocate_domain_integrations', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.advocate_domain_integrations', 'DELETE'),
  'the service role cannot bypass lifecycle RPCs with direct domain topology or state mutation'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.complete_domain_provisioning_job(uuid,uuid,public.domain_provisioning_job_status,text,jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.retry_domain_provisioning_job(uuid,uuid,interval,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.complete_domain_provisioning_job(uuid,uuid,public.domain_provisioning_job_status,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.retry_domain_provisioning_job(uuid,uuid,interval,text,jsonb)',
    'EXECUTE'
  ),
  'only the service worker can invoke lease-fenced settlement RPCs'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.begin_advocate_domain_deprovisioning(uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.begin_advocate_domain_deprovisioning(uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.begin_advocate_domain_deprovisioning(uuid,text,text)',
    'EXECUTE'
  ),
  'quiescing requires an authenticated Creator Share administrator boundary'
);

INSERT INTO settlement_test_context (key, uuid_value)
SELECT
  'main_provision_' || integration.provider::text,
  public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'provision',
    clock_timestamp(),
    'settlement-main-' || integration.provider::text
  )
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
);

INSERT INTO settlement_test_claims (label, job_id, provider, lease_token)
SELECT
  'main_provision_' || claimed.provider::text,
  claimed.job_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'settlement-worker-main',
  5,
  interval '10 minutes'
) claimed;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM settlement_test_claims
    WHERE label LIKE 'main_provision_%'
  ),
  5,
  'all five exact production integrations receive independent fenced leases'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      gen_random_uuid(),
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'dns_record_id', repeat('a', 32),
        'verified', true
      )
    )
    FROM settlement_test_claims claim
    WHERE claim.label = 'main_provision_cloudflare'
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'a wrong lease token cannot mutate job, integration, or domain state'
);

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  CASE claim.provider
    WHEN 'cloudflare' THEN jsonb_build_object(
      'provider_status', 'dns_only_cname_ready',
      'provider_resource_id', repeat('a', 32),
      'dns_record_id', repeat('a', 32),
      'http_status', 200,
      'verified', true
    )
    WHEN 'vercel' THEN jsonb_build_object(
      'provider_status', 'attached_verified',
      'provider_resource_id', 'settlementboundary.creatorshare.com',
      'deployment_id', 'prj_settlement',
      'http_status', 200,
      'verified', true
    )
    ELSE jsonb_build_object(
      'provider_status', 'payment_path_ready',
      'provider_resource_id', claim.provider::text || ':hosted_checkout',
      'http_status', 200,
      'verified', true
    )
  END
)
FROM settlement_test_claims claim
WHERE claim.label LIKE 'main_provision_%';

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'payment_path_ready',
        'provider_resource_id', 'paypal:hosted_checkout',
        'verified', true
      )
    )
    FROM settlement_test_claims claim
    WHERE claim.label = 'main_provision_stripe_us'
  $$,
  '55000',
  'Verified payment path evidence does not match the integration',
  'payment readiness must bind to the exact provider hosted checkout path'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'attached_verified',
        'provider_resource_id', 'other.creatorshare.com',
        'deployment_id', 'prj_settlement',
        'verified', true
      )
    )
    FROM settlement_test_claims claim
    WHERE claim.label = 'main_provision_vercel'
  $$,
  '55000',
  'Verified Vercel domain evidence does not match the integration',
  'Vercel success evidence must bind to the exact hostname in the locked chain'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', NULL,
        'dns_record_id', NULL,
        'verified', true
      )
    )
    FROM settlement_test_claims claim
    WHERE claim.label = 'main_provision_cloudflare'
  $$,
  '55000',
  'Verified Cloudflare DNS evidence does not match the integration',
  'Cloudflare success cannot omit the exact provider and DNS record identity'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'not_found',
        'provider_resource_id', repeat('a', 32),
        'dns_record_id', repeat('a', 32),
        'verified', true
      )
    )
    FROM settlement_test_claims claim
    WHERE claim.label = 'main_provision_cloudflare'
  $$,
  '55000',
  'Verified Cloudflare DNS evidence does not match the integration',
  'Cloudflare identifiers cannot compensate for a mismatched provider status'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  jsonb_build_object(
    'provider_status', 'dns_only_cname_ready',
    'provider_resource_id', repeat('a', 32),
    'dns_record_id', repeat('a', 32),
    'http_status', 200,
    'verified', true
  )
)
FROM settlement_test_claims claim
WHERE claim.label = 'main_provision_cloudflare';

SELECT extensions.ok(
  (
    SELECT
      integration.status = 'ready'
      AND integration.ready_at IS NOT NULL
      AND integration.last_verified_job_id = claim.job_id
      AND integration.last_verified_kind = 'provision'
      AND octet_length(integration.last_verified_evidence_digest) = 32
    FROM public.advocate_domain_integrations integration
    JOIN settlement_test_claims claim
      ON claim.label = 'main_provision_cloudflare'
     AND claim.provider = integration.provider
    WHERE integration.domain_id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
  ),
  'verified success atomically marks only the matching integration ready with durable evidence'
);

SELECT extensions.is(
  (
    SELECT domain.status::text
    FROM public.advocate_domains domain
    WHERE domain.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
  ),
  'provisioning',
  'one ready integration cannot prematurely activate the hostname'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  CASE claim.provider
    WHEN 'vercel' THEN jsonb_build_object(
      'provider_status', 'attached_verified',
      'provider_resource_id', 'settlementboundary.creatorshare.com',
      'deployment_id', 'prj_settlement',
      'http_status', 200,
      'verified', true
    )
    ELSE jsonb_build_object(
      'provider_status', 'payment_path_ready',
      'provider_resource_id', claim.provider::text || ':hosted_checkout',
      'http_status', 200,
      'verified', true
    )
  END
)
FROM settlement_test_claims claim
WHERE claim.label IN (
  'main_provision_vercel',
  'main_provision_stripe_us',
  'main_provision_stripe_uk',
  'main_provision_paypal'
)
ORDER BY claim.provider;

SELECT extensions.ok(
  (
    SELECT
      domain.status = 'verifying'
      AND domain.dns_verified_at IS NULL
      AND domain.tls_ready_at IS NULL
      AND domain.payments_ready_at IS NULL
      AND domain.activated_at IS NULL
    FROM public.advocate_domains domain
    WHERE domain.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
  ),
  'provider success stops at nonpublic verification even after every required integration is ready'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.advocate_domain_integrations integration
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
     AND job.integration_id = integration.id
     AND job.domain_id = integration.domain_id
     AND job.advocate_id = integration.advocate_id
     AND job.provider = integration.provider
    WHERE integration.domain_id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
      AND integration.status = 'ready'
      AND job.status = 'succeeded'
      AND job.result_payload @> '{"verified":true}'::jsonb
  ),
  5,
  'every provider readiness row traces to the exact successful provider job chain before publication'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_domain_integrations integration
    SET last_verified_job_id = (
      SELECT claim.job_id
      FROM settlement_test_claims claim
      WHERE claim.label = 'main_provision_vercel'
    )
    WHERE integration.domain_id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
      AND integration.provider = 'cloudflare'
  $$,
  '23503',
  'insert or update on table "advocate_domain_integrations" violates foreign key constraint "advocate_domain_integrations_verified_job_chain_fkey"',
  'verified evidence cannot point at another integration provider job'
);

SELECT extensions.is(
  (
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('a', 32),
        'dns_record_id', repeat('a', 32),
        'http_status', 200,
        'verified', true
      )
    )::text
    FROM settlement_test_claims claim
    WHERE claim.label = 'main_provision_cloudflare'
  ),
  'succeeded',
  'an exact terminal success replay is idempotent'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      gen_random_uuid(),
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('a', 32),
        'dns_record_id', repeat('a', 32),
        'http_status', 200,
        'verified', true
      )
    )
    FROM settlement_test_claims claim
    WHERE claim.label = 'main_provision_cloudflare'
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'a stale worker cannot disguise itself as an idempotent terminal replay'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN settlement_test_claims claim
      ON event.record_pk ->> 'id' = claim.job_id::text
    WHERE claim.label = 'main_provision_cloudflare'
      AND event.table_name = 'domain_provisioning_jobs'
      AND event.operation = 'UPDATE'
      AND event.actor_type = 'system'
      AND event.system_actor = 'settlement-worker-main'
      AND event.tool = 'domain-provisioning-settlement'
      AND event.reason = 'Atomically settle verified provider success and domain lifecycle'
      AND event.metadata ->> 'domain_hostname' = 'settlementboundary.creatorshare.com'
      AND event.metadata ->> 'provider_account_scope' = 'production'
      AND event.after_data ->> 'settlement_lease_token_digest' = '[REDACTED]'
  ),
  'settlement audit evidence names the worker, tool, reason, exact chain, and redacts lease proof'
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES ('retryboundary', 'Retry Boundary', 'active', 'provisioning')
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'retry_advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_domains (advocate_id, hostname, is_primary)
  SELECT uuid_value, 'retryboundary.creatorshare.com', true
  FROM settlement_test_context
  WHERE key = 'retry_advocate'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'retry_domain', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_domain_integrations (
    advocate_id,
    domain_id,
    provider,
    environment
  )
  SELECT
    advocate.uuid_value,
    domain.uuid_value,
    'cloudflare',
    'production'
  FROM settlement_test_context advocate
  CROSS JOIN settlement_test_context domain
  WHERE advocate.key = 'retry_advocate'
    AND domain.key = 'retry_domain'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'retry_integration', id FROM inserted;

INSERT INTO settlement_test_context (key, uuid_value)
SELECT
  'retry_job',
  public.enqueue_domain_provisioning_job_system(
    domain.uuid_value,
    integration.uuid_value,
    'provision',
    clock_timestamp(),
    'settlement-retry'
  )
FROM settlement_test_context domain
CROSS JOIN settlement_test_context integration
WHERE domain.key = 'retry_domain'
  AND integration.key = 'retry_integration';

INSERT INTO settlement_test_claims (label, job_id, provider, lease_token)
SELECT 'retry_first', job_id, provider, lease_token
FROM public.claim_domain_provisioning_jobs(
  'settlement-worker-retry',
  1,
  interval '10 minutes'
);

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'inconclusive',
  jsonb_build_object('provider_status', 'pending', 'verified', false)
)
FROM settlement_test_claims claim
WHERE claim.label = 'retry_first';

SELECT extensions.is(
  (
    SELECT public.retry_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      interval '1 hour',
      'provider_inconclusive',
      jsonb_build_object('provider_status', 'pending', 'verified', false)
    )::text
    FROM settlement_test_claims claim
    WHERE claim.label = 'retry_first'
  ),
  'queued',
  'a retryable result returns to the queue under the stable provider job'
);

SELECT extensions.ok(
  (
    SELECT
      domain.status = 'provisioning'
      AND domain.dns_verified_at IS NULL
      AND domain.activated_at IS NULL
      AND integration.status = 'provisioning'
      AND integration.ready_at IS NULL
      AND integration.last_verified_job_id IS NULL
    FROM public.advocate_domains domain
    JOIN public.advocate_domain_integrations integration
      ON integration.domain_id = domain.id
    WHERE domain.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'retry_domain'
    )
  ),
  'retry lifecycle state remains in progress and never fabricates readiness'
);

WITH inserted AS (
  INSERT INTO public.advocate_domain_integrations (
    advocate_id,
    domain_id,
    provider,
    environment
  )
  SELECT
    advocate.uuid_value,
    domain.uuid_value,
    'vercel',
    'production'
  FROM settlement_test_context advocate
  CROSS JOIN settlement_test_context domain
  WHERE advocate.key = 'retry_advocate'
    AND domain.key = 'retry_domain'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'failure_integration', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.domain_provisioning_jobs (
    advocate_id,
    domain_id,
    integration_id,
    kind,
    provider,
    max_attempts,
    request_payload
  )
  SELECT
    advocate.uuid_value,
    domain.uuid_value,
    integration.uuid_value,
    'provision',
    'vercel',
    1,
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  FROM settlement_test_context advocate
  CROSS JOIN settlement_test_context domain
  CROSS JOIN settlement_test_context integration
  WHERE advocate.key = 'retry_advocate'
    AND domain.key = 'retry_domain'
    AND integration.key = 'failure_integration'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'failure_job', id FROM inserted;

INSERT INTO settlement_test_claims (label, job_id, provider, lease_token)
SELECT 'failure_first', job_id, provider, lease_token
FROM public.claim_domain_provisioning_jobs(
  'settlement-worker-failure',
  1,
  interval '10 minutes'
);

SELECT extensions.is(
  (
    SELECT public.retry_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      interval '1 minute',
      'provider_exhausted',
      jsonb_build_object('provider_status', 'unavailable', 'verified', false)
    )::text
    FROM settlement_test_claims claim
    WHERE claim.label = 'failure_first'
  ),
  'failed',
  'an exhausted retry atomically becomes a terminal failure'
);

SELECT extensions.ok(
  (
    SELECT
      job.status = 'failed'
      AND job.settlement_lease_token_digest IS NOT NULL
      AND job.settlement_fingerprint IS NOT NULL
      AND integration.status = 'failed'
      AND integration.ready_at IS NULL
      AND integration.last_verified_job_id IS NULL
      AND domain.status = 'failed'
      AND domain.failure_code = 'provider_exhausted'
      AND domain.activated_at IS NULL
    FROM public.domain_provisioning_jobs job
    JOIN public.advocate_domain_integrations integration
      ON integration.id = job.integration_id
    JOIN public.advocate_domains domain
      ON domain.id = job.domain_id
    WHERE job.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'failure_job'
    )
  ),
  'terminal failure updates the matching integration and domain without readiness evidence'
);

SELECT extensions.is(
  (
    SELECT public.retry_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      interval '1 minute',
      'provider_exhausted',
      jsonb_build_object('provider_status', 'unavailable', 'verified', false)
    )::text
    FROM settlement_test_claims claim
    WHERE claim.label = 'failure_first'
  ),
  'failed',
  'an exact exhausted retry replay is idempotent'
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES ('leaseexpiry', 'Lease Expiry', 'active', 'provisioning')
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'expiry_advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_domains (advocate_id, hostname, is_primary)
  SELECT uuid_value, 'leaseexpiry.creatorshare.com', true
  FROM settlement_test_context
  WHERE key = 'expiry_advocate'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'expiry_domain', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_domain_integrations (
    advocate_id,
    domain_id,
    provider,
    environment
  )
  SELECT
    advocate.uuid_value,
    domain.uuid_value,
    'cloudflare',
    'production'
  FROM settlement_test_context advocate
  CROSS JOIN settlement_test_context domain
  WHERE advocate.key = 'expiry_advocate'
    AND domain.key = 'expiry_domain'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'expiry_integration', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.domain_provisioning_jobs (
    advocate_id,
    domain_id,
    integration_id,
    kind,
    provider,
    max_attempts,
    request_payload
  )
  SELECT
    advocate.uuid_value,
    domain.uuid_value,
    integration.uuid_value,
    'provision',
    'cloudflare',
    1,
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  FROM settlement_test_context advocate
  CROSS JOIN settlement_test_context domain
  CROSS JOIN settlement_test_context integration
  WHERE advocate.key = 'expiry_advocate'
    AND domain.key = 'expiry_domain'
    AND integration.key = 'expiry_integration'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'expiry_job', id FROM inserted;

INSERT INTO settlement_test_claims (label, job_id, provider, lease_token)
SELECT 'expiry_first', job_id, provider, lease_token
FROM public.claim_domain_provisioning_jobs(
  'settlement-worker-expiry',
  1,
  interval '5 seconds'
);

SELECT pg_sleep(5.2);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.claim_domain_provisioning_jobs(
      'settlement-worker-expiry-reaper',
      1,
      interval '10 minutes'
    )
  ),
  0,
  'an expired final lease is atomically settled instead of being reclaimed'
);

SELECT extensions.ok(
  (
    SELECT
      job.status = 'failed'
      AND job.last_error = 'lease_expired_max_attempts'
      AND octet_length(job.settlement_lease_token_digest) = 32
      AND octet_length(job.settlement_fingerprint) = 32
      AND job.settlement_schema_version = 1
      AND integration.status = 'failed'
      AND integration.last_error = 'lease_expired_max_attempts'
      AND domain.status = 'failed'
      AND domain.failure_code = 'lease_expired_max_attempts'
    FROM public.domain_provisioning_jobs job
    JOIN public.advocate_domain_integrations integration
      ON integration.id = job.integration_id
    JOIN public.advocate_domains domain
      ON domain.id = job.domain_id
    WHERE job.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'expiry_job'
    )
  ),
  'expired final lease settlement propagates durable failure through the exact lifecycle chain'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.begin_advocate_domain_deprovisioning(
      (SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'),
      '   ',
      'settlement-quiesce-no-reason'
    )
  $$,
  '22023',
  'A deprovisioning reason between 1 and 2000 characters is required',
  'quiescing cannot begin without an explicit administrator reason'
);

SELECT extensions.ok(
  public.begin_advocate_domain_deprovisioning(
    (SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'),
    'Retire the branded hostname after advocate approval',
    'settlement-quiesce-main'
  ),
  'an authorized administrator can atomically enter the targetless quiescing state'
);

SELECT extensions.ok(
  (
    SELECT
      domain.status = 'redirecting'
      AND domain.redirect_to_domain_id IS NULL
      AND domain.deactivated_at IS NOT NULL
    FROM public.advocate_domains domain
    WHERE domain.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.hostname = 'settlementboundary.creatorshare.com'
      AND domain.status = 'active'
  ),
  'targetless redirecting is internal quiescing state and fails the active public host lookup closed'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'advocate_domains'
      AND event.record_pk ->> 'id' = (
        SELECT uuid_value::text
        FROM settlement_test_context
        WHERE key = 'main_domain'
      )
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id = '98000000-0000-4000-8000-000000000001'::uuid
      AND event.tool = 'creator-share-admin-domains'
      AND event.request_id = 'settlement-quiesce-main'
      AND event.reason = 'Retire the branded hostname after advocate approval'
      AND event.metadata ->> 'outcome' = 'quiescing'
  ),
  'the quiescing transition memorializes the administrator, tool, request, reason, and public state'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.enqueue_domain_provisioning_job_system(
      integration.domain_id,
      integration.id,
      'reconcile',
      clock_timestamp(),
      'settlement-reconcile-after-quiesce'
    )
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
      AND integration.provider = 'cloudflare'
  $$,
  '55000',
  'Domain integration is not eligible for reconciliation',
  'targetless quiescing rejects newly enqueued provider reconciliation'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.enqueue_domain_provisioning_job_system(
      integration.domain_id,
      integration.id,
      'deprovision',
      clock_timestamp(),
      'settlement-vercel-too-early'
    )
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
      AND integration.provider = 'vercel'
  $$,
  '55000',
  'Cloudflare DNS removal must be verified before Vercel release',
  'the database refuses to enqueue Vercel release before verified DNS removal'
);

INSERT INTO settlement_test_context (key, uuid_value)
SELECT
  'main_deprovision_cloudflare',
  public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'deprovision',
    clock_timestamp(),
    'settlement-cloudflare-remove'
  )
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
)
  AND integration.provider = 'cloudflare';

INSERT INTO settlement_test_claims (label, job_id, provider, lease_token)
SELECT 'main_deprovision_cloudflare', job_id, provider, lease_token
FROM public.claim_domain_provisioning_jobs(
  'settlement-worker-deprovision-cloudflare',
  1,
  interval '10 minutes'
);

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  jsonb_build_object(
    'provider_status', 'absent',
    'http_status', 200,
    'verified', true,
    'already_applied', true
  )
)
FROM settlement_test_claims claim
WHERE claim.label = 'main_deprovision_cloudflare';

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  jsonb_build_object(
    'provider_status', 'absent',
    'http_status', 200,
    'verified', true,
    'already_applied', true
  )
)
FROM settlement_test_claims claim
WHERE claim.label = 'main_deprovision_cloudflare';

SELECT extensions.ok(
  (
    SELECT
      integration.status = 'disabled'
      AND integration.disabled_at IS NOT NULL
      AND integration.last_verified_kind = 'deprovision'
      AND job.kind = 'deprovision'
      AND job.status = 'succeeded'
      AND job.result_payload @> '{"provider_status":"absent","verified":true}'::jsonb
    FROM public.advocate_domain_integrations integration
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
    WHERE integration.domain_id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
      AND integration.provider = 'cloudflare'
  ),
  'Cloudflare disablement carries durable verified absence evidence from its exact job'
);

SELECT extensions.is(
  (
    SELECT domain.status::text
    FROM public.advocate_domains domain
    WHERE domain.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
  ),
  'redirecting',
  'DNS removal alone does not mark the domain fully disabled'
);

INSERT INTO settlement_test_context (key, uuid_value)
SELECT
  'main_deprovision_' || integration.provider::text,
  public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'deprovision',
    clock_timestamp(),
    'settlement-remove-' || integration.provider::text
  )
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
)
  AND integration.provider <> 'cloudflare';

INSERT INTO settlement_test_claims (label, job_id, provider, lease_token)
SELECT
  'main_deprovision_' || claimed.provider::text,
  claimed.job_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'settlement-worker-deprovision-rest',
  4,
  interval '10 minutes'
) claimed;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM settlement_test_claims
    WHERE label IN (
      'main_deprovision_vercel',
      'main_deprovision_stripe_us',
      'main_deprovision_stripe_uk',
      'main_deprovision_paypal'
    )
  ),
  4,
  'Vercel and payment cleanup become claimable only after Cloudflare absence is durable'
);

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  jsonb_build_object(
    'provider_status', 'absent',
    'http_status', 200,
    'verified', true,
    'already_applied', true
  ) || CASE
    WHEN claim.provider IN ('stripe_us', 'stripe_uk', 'paypal')
      THEN jsonb_build_object(
        'provider_resource_id', claim.provider::text || ':hosted_checkout'
      )
    ELSE '{}'::jsonb
  END
)
FROM settlement_test_claims claim
WHERE claim.label IN (
  'main_deprovision_vercel',
  'main_deprovision_stripe_us',
  'main_deprovision_stripe_uk',
  'main_deprovision_paypal'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  jsonb_build_object(
    'provider_status', 'absent',
    'http_status', 200,
    'verified', true,
    'already_applied', true
  )
)
FROM settlement_test_claims claim
WHERE claim.label = 'main_deprovision_vercel';

SELECT extensions.is(
  (
    SELECT domain.status::text
    FROM public.advocate_domains domain
    WHERE domain.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
  ),
  'redirecting',
  'Vercel removal still cannot disable the domain while required payment cleanup remains'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  jsonb_build_object(
    'provider_status', 'absent',
    'provider_resource_id', claim.provider::text || ':hosted_checkout',
    'http_status', 200,
    'verified', true,
    'already_applied', true
  )
)
FROM settlement_test_claims claim
WHERE claim.label IN (
  'main_deprovision_stripe_us',
  'main_deprovision_stripe_uk',
  'main_deprovision_paypal'
)
ORDER BY claim.provider;

SELECT extensions.ok(
  (
    SELECT
      domain.status = 'disabled'
      AND domain.deactivated_at IS NOT NULL
      AND domain.redirect_to_domain_id IS NULL
    FROM public.advocate_domains domain
    WHERE domain.id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
  ),
  'the domain becomes disabled only after every required teardown has verified absence'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.advocate_domain_integrations integration
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
     AND job.integration_id = integration.id
     AND job.domain_id = integration.domain_id
     AND job.advocate_id = integration.advocate_id
     AND job.provider = integration.provider
    WHERE integration.domain_id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
      AND integration.is_required
      AND integration.status = 'disabled'
      AND integration.last_verified_kind = 'deprovision'
      AND job.kind = 'deprovision'
      AND job.status = 'succeeded'
      AND job.result_payload @> '{"provider_status":"absent","verified":true}'::jsonb
  ),
  5,
  'every disabled required integration retains its exact verified deprovision job chain'
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES ('settlementrace', 'Settlement Race', 'active', 'provisioning')
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'race_advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_domains (advocate_id, hostname, is_primary)
  SELECT uuid_value, 'settlementrace.creatorshare.com', true
  FROM settlement_test_context
  WHERE key = 'race_advocate'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'race_domain', id FROM inserted;

UPDATE public.advocate_domains
SET status = 'provisioning'
WHERE id = (
  SELECT uuid_value FROM settlement_test_context WHERE key = 'race_domain'
);

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.uuid_value,
  domain.uuid_value,
  provider.provider::public.advocate_domain_integration_provider,
  'production'
FROM settlement_test_context advocate
CROSS JOIN settlement_test_context domain
CROSS JOIN (VALUES ('cloudflare'), ('vercel')) AS provider(provider)
WHERE advocate.key = 'race_advocate'
  AND domain.key = 'race_domain';

INSERT INTO settlement_test_context (key, uuid_value)
SELECT
  'race_reconcile_cloudflare',
  public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'reconcile',
    clock_timestamp(),
    'settlement-race-cloudflare'
  )
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT uuid_value FROM settlement_test_context WHERE key = 'race_domain'
)
  AND integration.provider = 'cloudflare';

INSERT INTO settlement_test_claims (label, job_id, provider, lease_token)
SELECT 'race_reconcile_cloudflare', job_id, provider, lease_token
FROM public.claim_domain_provisioning_jobs(
  'settlement-worker-race',
  1,
  interval '10 minutes'
);

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  jsonb_build_object(
    'provider_status', 'dns_only_cname_ready',
    'provider_resource_id', repeat('c', 32),
    'dns_record_id', repeat('c', 32),
    'verified', true
  )
)
FROM settlement_test_claims claim
WHERE claim.label = 'race_reconcile_cloudflare';

INSERT INTO settlement_test_context (key, uuid_value)
SELECT
  'race_reconcile_vercel',
  public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'reconcile',
    clock_timestamp(),
    'settlement-race-vercel'
  )
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT uuid_value FROM settlement_test_context WHERE key = 'race_domain'
)
  AND integration.provider = 'vercel';

SELECT set_config(
  'app.advocate_domain.quiescing_domain_id',
  (SELECT uuid_value::text FROM settlement_test_context WHERE key = 'race_domain'),
  true
);

UPDATE public.advocate_domains
SET
  status = 'redirecting',
  redirect_to_domain_id = NULL
WHERE id = (
  SELECT uuid_value FROM settlement_test_context WHERE key = 'race_domain'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.claim_domain_provisioning_jobs(
      'settlement-worker-race-guard',
      10,
      interval '10 minutes'
    ) claimed
    WHERE claimed.job_id = (
      SELECT uuid_value
      FROM settlement_test_context
      WHERE key = 'race_reconcile_vercel'
    )
  ),
  0,
  'claiming rechecks lifecycle state and skips queued work after quiescing'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('c', 32),
        'dns_record_id', repeat('c', 32),
        'verified', true
      )
    )
    FROM settlement_test_claims claim
    WHERE claim.label = 'race_reconcile_cloudflare'
  $$,
  '55000',
  'Domain provider success is no longer lifecycle eligible',
  'completion rechecks lifecycle state and rejects stale success after quiescing'
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES ('prematuredisable', 'Premature Disable', 'active', 'provisioning')
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'premature_advocate', id FROM inserted;

WITH inserted AS (
  INSERT INTO public.advocate_domains (advocate_id, hostname, is_primary)
  SELECT uuid_value, 'prematuredisable.creatorshare.com', true
  FROM settlement_test_context
  WHERE key = 'premature_advocate'
  RETURNING id
)
INSERT INTO settlement_test_context (key, uuid_value)
SELECT 'premature_domain', id FROM inserted;

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.uuid_value,
  domain.uuid_value,
  provider.provider::public.advocate_domain_integration_provider,
  'production'
FROM settlement_test_context advocate
CROSS JOIN settlement_test_context domain
CROSS JOIN (VALUES ('cloudflare'), ('vercel')) AS provider(provider)
WHERE advocate.key = 'premature_advocate'
  AND domain.key = 'premature_domain';

UPDATE public.advocate_domains
SET status = 'provisioning'
WHERE id = (
  SELECT uuid_value FROM settlement_test_context WHERE key = 'premature_domain'
);

SELECT public.begin_advocate_domain_deprovisioning(
  (SELECT uuid_value FROM settlement_test_context WHERE key = 'premature_domain'),
  'Test the fail-closed disablement guard',
  'settlement-premature-disable'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_domains
    SET status = 'disabled'
    WHERE id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'premature_domain'
    )
  $$,
  '55000',
  'Advocate domain cannot disable before verified provider deprovisioning completes',
  'even a direct database transition cannot bypass durable teardown completion evidence'
);

SELECT extensions.ok(
  (
    SELECT
      cloudflare.last_verified_at <= vercel.last_verified_at
      AND cloudflare.status = 'disabled'
      AND vercel.status = 'disabled'
    FROM public.advocate_domain_integrations cloudflare
    JOIN public.advocate_domain_integrations vercel
      ON vercel.domain_id = cloudflare.domain_id
     AND vercel.provider = 'vercel'
    WHERE cloudflare.domain_id = (
      SELECT uuid_value FROM settlement_test_context WHERE key = 'main_domain'
    )
      AND cloudflare.provider = 'cloudflare'
  ),
  'durable timestamps prove Cloudflare absence was committed no later than Vercel release'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.advocate_domains', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.advocate_domain_integrations', 'SELECT'),
  'anonymous clients cannot read internal quiescing or provider lifecycle rows'
);

SELECT * FROM extensions.finish();

ROLLBACK;
