BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '30s';

SELECT extensions.plan(31);

CREATE TEMP TABLE publication_test_context (
  key text PRIMARY KEY,
  uuid_value uuid
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_versions (
  key text PRIMARY KEY,
  bigint_value bigint NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_times (
  key text PRIMARY KEY,
  timestamp_value timestamp with time zone NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE publication_test_claims (
  label text PRIMARY KEY,
  job_id uuid NOT NULL,
  provider public.advocate_domain_integration_provider NOT NULL,
  lease_token uuid NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.attempt_direct_advocate_publication()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.advocates advocate
  SET publication_status = 'active'
  WHERE advocate.id = pg_catalog.current_setting(
    'test.publication_advocate_id'
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION pg_temp.attempt_direct_domain_activation()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.advocate_domains domain
  SET status = 'active'
  WHERE domain.id = pg_catalog.current_setting(
    'test.publication_domain_id'
  )::uuid;
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
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'publication-admin@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '9a000000-0000-4000-8000-000000000002'::uuid,
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
SELECT
  '9a000000-0000-4000-8000-000000000001'::uuid,
  role.id,
  NULL,
  NULL
FROM public.roles role
WHERE role.name = 'SUPER_ADMIN';

SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000001',
  true
);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);

WITH created AS (
  SELECT public.create_advocate_portal(
    '9a000000-0000-4000-8000-000000000001'::uuid,
    'publicationboundary',
    'Publication Boundary',
    'Create the publication approval test portal',
    'creator',
    'publication-create-request',
    'publication-create-trace',
    'publication-create-session'
  ) AS id
)
INSERT INTO publication_test_context (key, uuid_value)
SELECT 'advocate', id FROM created;

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    uuid_value,
    'publicationboundary.creatorshare.com',
    true
  FROM publication_test_context
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO publication_test_context (key, uuid_value)
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
  provider.provider::public.advocate_domain_integration_provider,
  provider.environment
FROM publication_test_context advocate
CROSS JOIN publication_test_context domain
CROSS JOIN (
  VALUES
    ('cloudflare', 'production'),
    ('vercel', 'production'),
    ('stripe_us', 'live'),
    ('stripe_uk', 'live'),
    ('paypal', 'live')
) AS provider(provider, environment)
WHERE advocate.key = 'advocate'
  AND domain.key = 'domain';

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.publish_advocate_portal(uuid,bigint,uuid,text,bytea,timestamp with time zone,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.publish_advocate_portal(uuid,bigint,uuid,text,bytea,timestamp with time zone,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.publish_advocate_portal(uuid,bigint,uuid,text,bytea,timestamp with time zone,text,text,text,text)',
    'EXECUTE'
  ),
  'only authenticated callers can reach the super administrator publication boundary'
);

SELECT extensions.ok(
  NOT has_column_privilege(
    'service_role',
    'public.advocates',
    'publication_status',
    'UPDATE'
  ),
  'the service role cannot update advocate publication status directly'
);

INSERT INTO publication_test_context (key, uuid_value)
SELECT
  'provision_' || integration.provider::text,
  public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'provision',
    clock_timestamp(),
    'publication-provision-' || integration.provider::text
  )
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
);

INSERT INTO publication_test_claims (label, job_id, provider, lease_token)
SELECT
  'provision_' || claimed.provider::text,
  claimed.job_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'publication-provider-worker',
  5,
  interval '10 minutes'
) claimed;

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  CASE claim.provider
    WHEN 'cloudflare' THEN jsonb_build_object(
      'provider_status', 'dns_only_cname_ready',
      'provider_resource_id', repeat('b', 32),
      'dns_record_id', repeat('b', 32),
      'http_status', 200,
      'verified', true
    )
    WHEN 'vercel' THEN jsonb_build_object(
      'provider_status', 'attached_verified',
      'provider_resource_id', 'publicationboundary.creatorshare.com',
      'deployment_id', 'prj_publication_boundary',
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
FROM publication_test_claims claim;

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  CASE claim.provider
    WHEN 'cloudflare' THEN jsonb_build_object(
      'provider_status', 'dns_only_cname_ready',
      'provider_resource_id', repeat('b', 32),
      'dns_record_id', repeat('b', 32),
      'http_status', 200,
      'verified', true
    )
    WHEN 'vercel' THEN jsonb_build_object(
      'provider_status', 'attached_verified',
      'provider_resource_id', 'publicationboundary.creatorshare.com',
      'deployment_id', 'prj_publication_boundary',
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
FROM publication_test_claims claim
WHERE claim.provider <> 'paypal';

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-missing-provider',
      'publication-trace-missing-provider'
    )
  $$,
  '55000',
  'Every required domain integration must carry verified readiness evidence',
  'publication fails closed when one required provider chain is not ready'
);

SELECT extensions.ok(
  (
    SELECT
      advocate.publication_status = 'draft'
      AND advocate.published_at IS NULL
      AND domain.status = 'provisioning'
      AND domain.activated_at IS NULL
    FROM public.advocates advocate
    JOIN public.advocate_domains domain ON domain.advocate_id = advocate.id
    WHERE advocate.id = (
      SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
    )
  ),
  'a failed approval leaves both publication surfaces unchanged'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  jsonb_build_object(
    'provider_status', 'payment_path_ready',
    'provider_resource_id', 'paypal:hosted_checkout',
    'http_status', 200,
    'verified', true
  )
)
FROM publication_test_claims claim
WHERE claim.provider = 'paypal';

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
      SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
    )
  ),
  'all automated provider successes stop at the nonpublic verifying state'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000002',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-ordinary-user',
      'publication-trace-ordinary-user'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'an ordinary authenticated user cannot publish a portal'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000001',
  true
);

UPDATE auth.users actor
SET banned_until = clock_timestamp() + interval '1 hour'
WHERE actor.id = '9a000000-0000-4000-8000-000000000001'::uuid;

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-banned-admin',
      'publication-trace-banned-admin'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned super administrator cannot approve publication'
);

UPDATE auth.users actor
SET banned_until = NULL
WHERE actor.id = '9a000000-0000-4000-8000-000000000001'::uuid;

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      decode(repeat('ab', 31), 'hex'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-short-digest',
      'publication-trace-short-digest'
    )
  $$,
  '22023',
  'Publication evidence SHA256 must contain exactly 32 bytes',
  'publication rejects evidence that is not one exact SHA256 digest'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      ' ',
      'publication-request-missing-deployment',
      'publication-trace-missing-deployment'
    )
  $$,
  '22023',
  'Deployment, request, and trace identifiers are required and limited to 255 characters',
  'publication requires deployment, request, and trace correlation metadata'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      gen_random_uuid(),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-wrong-domain',
      'publication-trace-wrong-domain'
    )
  $$,
  '23503',
  'Exact advocate primary domain does not match',
  'publication binds approval to the exact primary domain identity and hostname'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version - 1
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-stale-version',
      'publication-trace-stale-version'
    )
  $$,
  '40001',
  'Advocate portal version changed before publication approval',
  'a stale administrative read cannot publish over a concurrent advocate change'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      ' ',
      'dpl_publication_boundary',
      'publication-request-no-reason',
      'publication-trace-no-reason'
    )
  $$,
  '22023',
  'A publication reason between 1 and 2000 characters is required',
  'publication requires an explicit bounded administrator reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp() - interval '31 minutes',
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-stale-canary',
      'publication-trace-stale-canary'
    )
  $$,
  '22023',
  'Publication canary evidence must be completed within the last 30 minutes',
  'publication rejects stale exact-host canary evidence'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      (
        SELECT max(integration.last_verified_at) - interval '1 second'
        FROM public.advocate_domain_integrations integration
        WHERE integration.domain_id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
        )
          AND integration.is_required
      ),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-predated-canary',
      'publication-trace-predated-canary'
    )
  $$,
  '55000',
  'Publication canary evidence predates provider readiness',
  'publication rejects a canary report captured before the newest provider readiness'
);

UPDATE public.advocate_domain_integrations integration
SET last_verified_at = clock_timestamp() - interval '31 minutes'
WHERE integration.domain_id = (
    SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
  )
  AND integration.provider = 'cloudflare'
  AND integration.environment = 'production';

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-stale-provider',
      'publication-trace-stale-provider'
    )
  $$,
  '55000',
  'Every required domain integration must carry verified readiness evidence',
  'publication rejects provider evidence older than the 30 minute approval window'
);

UPDATE public.advocate_domain_integrations integration
SET last_verified_at = integration.last_checked_at
WHERE integration.domain_id = (
    SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
  )
  AND integration.provider = 'cloudflare'
  AND integration.environment = 'production';

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.uuid_value,
  domain.uuid_value,
  'stripe_us',
  'test'
FROM publication_test_context advocate
CROSS JOIN publication_test_context domain
WHERE advocate.key = 'advocate'
  AND domain.key = 'domain';

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-extra-required',
      'publication-trace-extra-required'
    )
  $$,
  '55000',
  'Every required domain integration must carry verified readiness evidence',
  'publication rejects any required integration beyond the five exact production tuples'
);

DELETE FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
    SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
  )
  AND integration.provider = 'stripe_us'
  AND integration.environment = 'test';

SELECT set_config(
  'test.publication_advocate_id',
  (SELECT uuid_value::text FROM publication_test_context WHERE key = 'advocate'),
  true
);
SELECT set_config(
  'test.publication_domain_id',
  (SELECT uuid_value::text FROM publication_test_context WHERE key = 'domain'),
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.attempt_direct_advocate_publication()
  $$,
  '42501',
  'Advocate publication requires an approved administrator transaction',
  'the advocate trigger rejects activation without transaction local approval'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.attempt_direct_domain_activation()
  $$,
  '42501',
  'Advocate domain activation requires an approved administrator transaction',
  'the domain trigger rejects activation without transaction local approval'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocates
    SET publication_status = 'active'
    WHERE id = current_setting('test.publication_advocate_id')::uuid
  $$,
  '42501',
  'permission denied for table advocates',
  'a direct service role update is rejected by column privileges before lifecycle mutation'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

WITH inserted AS (
  INSERT INTO publication_test_context (key, uuid_value)
  SELECT
    'open_reconcile_cloudflare',
    public.enqueue_domain_provisioning_job_system(
      integration.domain_id,
      integration.id,
      'reconcile',
      clock_timestamp(),
      'publication-open-job'
    )
  FROM public.advocate_domain_integrations integration
  WHERE integration.domain_id = (
    SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
  )
    AND integration.provider = 'cloudflare'
  RETURNING uuid_value
)
SELECT count(*) FROM inserted;

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-open-job',
      'publication-trace-open-job'
    )
  $$,
  '55000',
  'Advocate publication cannot proceed while provider jobs are open',
  'publication rejects queued or running provider work for the advocate'
);

INSERT INTO publication_test_claims (label, job_id, provider, lease_token)
SELECT
  'reconcile_cloudflare',
  claimed.job_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'publication-reconcile-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  jsonb_build_object(
    'provider_status', 'dns_only_cname_ready',
    'provider_resource_id', repeat('b', 32),
    'dns_record_id', repeat('b', 32),
    'http_status', 200,
    'verified', true
  )
)
FROM publication_test_claims claim
WHERE claim.label = 'reconcile_cloudflare';

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'succeeded',
  NULL,
  jsonb_build_object(
    'provider_status', 'dns_only_cname_ready',
    'provider_resource_id', repeat('b', 32),
    'dns_record_id', repeat('b', 32),
    'http_status', 200,
    'verified', true
  )
)
FROM publication_test_claims claim
WHERE claim.label = 'reconcile_cloudflare';

INSERT INTO publication_test_versions (key, bigint_value)
SELECT 'before_publish', advocate.version
FROM public.advocates advocate
WHERE advocate.id = (
  SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
);

INSERT INTO publication_test_times (key, timestamp_value)
VALUES ('canary_completed_at', clock_timestamp());

SELECT extensions.lives_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_versions WHERE key = 'before_publish'),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      (
        SELECT timestamp_value
        FROM publication_test_times
        WHERE key = 'canary_completed_at'
      ),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-success',
      'publication-trace-success'
    )
  $$,
  'a super administrator can atomically approve complete external evidence'
);

SELECT extensions.ok(
  (
    SELECT
      advocate.publication_status = 'active'
      AND advocate.published_at IS NOT NULL
      AND domain.status = 'active'
      AND domain.dns_verified_at = (
        SELECT timestamp_value
        FROM publication_test_times
        WHERE key = 'canary_completed_at'
      )
      AND domain.tls_ready_at = (
        SELECT timestamp_value
        FROM publication_test_times
        WHERE key = 'canary_completed_at'
      )
      AND domain.payments_ready_at = (
        SELECT timestamp_value
        FROM publication_test_times
        WHERE key = 'canary_completed_at'
      )
      AND domain.activated_at IS NOT NULL
    FROM public.advocates advocate
    JOIN public.advocate_domains domain ON domain.advocate_id = advocate.id
    WHERE advocate.id = (
      SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
    )
  ),
  'successful approval atomically activates the advocate and exact primary domain readiness'
);

SELECT extensions.is(
  (
    SELECT advocate.version
    FROM public.advocates advocate
    WHERE advocate.id = (
      SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
    )
  ),
  (
    SELECT bigint_value + 2
    FROM publication_test_versions
    WHERE key = 'before_publish'
  ),
  'draft publication records both the internal provisioning transition and final activation version'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = (
      SELECT uuid_value FROM publication_test_context WHERE key = 'domain'
    )
      AND integration.status = 'ready'
      AND integration.ready_at IS NOT NULL
      AND integration.last_verified_job_id IS NOT NULL
      AND octet_length(integration.last_verified_evidence_digest) = 32
  ),
  5,
  'publication preserves five exact provider backed ready integration chains'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name = 'advocates'
      AND event.record_pk ->> 'id' = (
        SELECT uuid_value::text
        FROM publication_test_context
        WHERE key = 'advocate'
      )
      AND event.operation = 'UPDATE'
      AND event.after_data ->> 'publication_status' = 'active'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id = '9a000000-0000-4000-8000-000000000001'::uuid
      AND event.tool = 'creator-share-admin-publication'
      AND event.request_id = 'publication-request-success'
      AND event.trace_id = 'publication-trace-success'
      AND event.reason = 'Approve the exact branded portal after external canaries'
      AND event.metadata ->> 'operation' = 'publish_portal'
      AND event.metadata ->> 'outcome' = 'active'
      AND event.metadata ->> 'deployment_id' = 'dpl_publication_boundary'
      AND event.metadata ->> 'domain_hostname' = 'publicationboundary.creatorshare.com'
      AND event.metadata ->> 'evidence_sha256' = encode(
        extensions.digest('publication-canary-v1', 'sha256'),
        'hex'
      )
      AND event.metadata ->> 'canary_completed_at' = to_char(
        (
          SELECT timestamp_value AT TIME ZONE 'UTC'
          FROM publication_test_times
          WHERE key = 'canary_completed_at'
        ),
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
      AND event.metadata ->> 'publication_binding_sha256' = encode(
        extensions.digest(
          pg_catalog.convert_to(
            jsonb_build_object(
              'schema_version', 1,
              'advocate_id', (
                SELECT uuid_value
                FROM publication_test_context
                WHERE key = 'advocate'
              ),
              'domain_id', (
                SELECT uuid_value
                FROM publication_test_context
                WHERE key = 'domain'
              ),
              'evidence_sha256', encode(
                extensions.digest('publication-canary-v1', 'sha256'),
                'hex'
              ),
              'domain_hostname', 'publicationboundary.creatorshare.com',
              'deployment_id', 'dpl_publication_boundary',
              'canary_completed_at', to_char(
                (
                  SELECT timestamp_value AT TIME ZONE 'UTC'
                  FROM publication_test_times
                  WHERE key = 'canary_completed_at'
                ),
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ),
              'integrations', (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'advocate_id', integration.advocate_id,
                    'domain_id', integration.domain_id,
                    'integration_id', integration.id,
                    'provider', integration.provider::text,
                    'environment', integration.environment,
                    'last_verified_job_id', integration.last_verified_job_id,
                    'last_verified_at', to_char(
                      integration.last_verified_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ),
                    'evidence_sha256', encode(
                      integration.last_verified_evidence_digest,
                      'hex'
                    )
                  )
                  ORDER BY integration.provider::text, integration.environment
                )
                FROM public.advocate_domain_integrations integration
                WHERE integration.domain_id = (
                  SELECT uuid_value
                  FROM publication_test_context
                  WHERE key = 'domain'
                )
                  AND integration.is_required
              )
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
  ),
  'publication writes immutable actor, correlation, canary, supplied digest, and server-bound provider evidence'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM audit.audit_events event
    WHERE event.table_name IN ('advocates', 'advocate_domains')
      AND event.request_id = 'publication-request-success'
      AND (
        event.before_data::text LIKE '%publication-canary-v1%'
        OR event.after_data::text LIKE '%publication-canary-v1%'
        OR event.metadata::text LIKE '%publication-canary-v1%'
      )
  ),
  'publication audit retains only the canary digest and never raw canary evidence'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.audit_events event
    SET reason = 'tampered'
    WHERE event.request_id = 'publication-request-success'
  $$,
  '42501',
  'audit.audit_events is append-only',
  'publication approval evidence cannot be edited after commit'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (SELECT bigint_value FROM publication_test_versions WHERE key = 'before_publish'),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-stale-replay',
      'publication-trace-stale-replay'
    )
  $$,
  '40001',
  'Advocate portal version changed before publication approval',
  'an exact stale replay is rejected by optimistic concurrency'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_advocate_portal(
      (SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'),
      (
        SELECT advocate.version
        FROM public.advocates advocate
        WHERE advocate.id = (
          SELECT uuid_value FROM publication_test_context WHERE key = 'advocate'
        )
      ),
      (SELECT uuid_value FROM publication_test_context WHERE key = 'domain'),
      'publicationboundary.creatorshare.com',
      extensions.digest('publication-canary-v1', 'sha256'),
      clock_timestamp(),
      'Approve the exact branded portal after external canaries',
      'dpl_publication_boundary',
      'publication-request-current-replay',
      'publication-trace-current-replay'
    )
  $$,
  '55000',
  'Advocate primary domain is not awaiting publication approval',
  'a replay with a refreshed version cannot republish an already active hostname'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM audit.audit_events event
    WHERE event.table_name = 'advocates'
      AND event.request_id IN (
        'publication-request-stale-replay',
        'publication-request-current-replay'
      )
  ),
  0,
  'rejected replays create no misleading publication audit event'
);

SELECT extensions.ok(
  position(
    'FOR SHARE OF assignment' IN pg_catalog.pg_get_functiondef(
      'public.publish_advocate_portal(uuid,bigint,uuid,text,bytea,timestamp with time zone,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'publication holds the selected super administrator assignment against concurrent role changes'
);

SELECT * FROM extensions.finish();

ROLLBACK;
