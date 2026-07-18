BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.read_public_advocate_presentation_snapshot(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.read_public_advocate_presentation_snapshot(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.read_public_advocate_presentation_snapshot(text)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges privilege
    WHERE privilege.routine_schema = 'public'
      AND privilege.routine_name =
        'read_public_advocate_presentation_snapshot'
      AND privilege.grantee = 'PUBLIC'
      AND privilege.privilege_type = 'EXECUTE'
  ),
  'only the service role can execute the public presentation snapshot RPC'
);

SELECT extensions.ok(
  (
    SELECT NOT function_definition.prosecdef
      AND function_definition.provolatile = 's'
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'public.read_public_advocate_presentation_snapshot(text)'::regprocedure
  ),
  'the snapshot is a stable security invoker function with an empty search path'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'private.validate_advocate_logo_storage_path()'::regprocedure
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.validate_advocate_logo_storage_path()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.validate_advocate_logo_storage_path()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.validate_advocate_logo_storage_path()',
    'EXECUTE'
  ),
  'the tenant logo trigger has fixed definer authority and is not directly callable'
);

SELECT extensions.is(
  public.read_public_advocate_presentation_snapshot(
    'unknown.creatorshare.com'
  ),
  NULL::jsonb,
  'an unknown tenant has no public presentation snapshot'
);

CREATE TEMP TABLE presentation_test_ids (
  key text PRIMARY KEY,
  value uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE presentation_test_snapshot (
  value jsonb NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.activate_presentation_test_domain(
  target_domain_id uuid,
  worker_id text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_claim record;
  v_evidence jsonb;
  v_hostname text;
  v_completed integer := 0;
BEGIN
  SELECT domain.hostname
  INTO v_hostname
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id;

  IF v_hostname IS NULL THEN
    RAISE EXCEPTION 'Test advocate domain is missing';
  END IF;

  PERFORM public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'provision',
    clock_timestamp(),
    worker_id || ':' || integration.provider::text
  )
  FROM public.advocate_domain_integrations integration
  WHERE integration.domain_id = target_domain_id;

  FOR v_claim IN
    SELECT *
    FROM public.claim_domain_provisioning_jobs(
      worker_id,
      5,
      interval '10 minutes'
    )
  LOOP
    IF v_claim.domain_id IS DISTINCT FROM target_domain_id THEN
      RAISE EXCEPTION 'Test worker claimed an unrelated domain job';
    END IF;

    v_evidence := CASE v_claim.provider
      WHEN 'cloudflare' THEN jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('a', 32),
        'dns_record_id', repeat('a', 32),
        'http_status', 200,
        'verified', true
      )
      WHEN 'vercel' THEN jsonb_build_object(
        'provider_status', 'attached_verified',
        'provider_resource_id', v_hostname,
        'deployment_id', worker_id || '_deployment',
        'http_status', 200,
        'verified', true
      )
      ELSE jsonb_build_object(
        'provider_status', 'payment_path_ready',
        'provider_resource_id',
          v_claim.provider::text || ':hosted_checkout',
        'http_status', 200,
        'verified', true
      )
    END;

    PERFORM public.record_domain_provisioning_reconciliation(
      v_claim.job_id,
      v_claim.lease_token,
      'matches_intent',
      v_evidence
    );
    PERFORM public.complete_domain_provisioning_job(
      v_claim.job_id,
      v_claim.lease_token,
      'succeeded',
      NULL,
      v_evidence
    );
    v_completed := v_completed + 1;
  END LOOP;

  IF v_completed <> 5 THEN
    RAISE EXCEPTION 'Test domain did not settle all five provider jobs';
  END IF;
END;
$$;

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status,
    beneficiary_mode
  )
  VALUES (
    'snapshotportal',
    'Snapshot Portal',
    'active',
    'draft',
    'all_featured'
  )
  RETURNING id
)
INSERT INTO presentation_test_ids (key, value)
SELECT 'advocate', id
FROM inserted;

INSERT INTO public.advocate_branding (
  advocate_id,
  primary_color,
  accent_color,
  logo_storage_path,
  logo_alt_text,
  opening_header_html,
  about_biography_html
)
SELECT
  value,
  '#123456',
  '#ABCDEF',
  'logos/snapshotportal/31111111-1111-4111-8111-111111111111.webp',
  'Snapshot Portal logo',
  '<h1>Welcome</h1>',
  '<p>About this portal.</p>'
FROM presentation_test_ids
WHERE key = 'advocate';

INSERT INTO public.advocate_public_metric_selections (
  advocate_id,
  metric_key,
  display_order
)
SELECT
  advocate.value,
  metric.metric_key::public.advocate_public_metric_key,
  metric.display_order
FROM presentation_test_ids advocate
CROSS JOIN (
  VALUES
    ('children_sponsored', 2),
    ('gross_raised_usd', 0),
    ('direct_sponsorships', 1)
) AS metric(metric_key, display_order)
WHERE advocate.key = 'advocate';

UPDATE public.advocates
SET publication_status = 'provisioning'
WHERE id = (
  SELECT value FROM presentation_test_ids WHERE key = 'advocate'
);

WITH inserted AS (
  INSERT INTO public.advocate_domains (
    advocate_id,
    hostname,
    is_primary
  )
  SELECT
    value,
    'snapshotportal.creatorshare.com',
    true
  FROM presentation_test_ids
  WHERE key = 'advocate'
  RETURNING id
)
INSERT INTO presentation_test_ids (key, value)
SELECT 'domain', id
FROM inserted;

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment
)
SELECT
  advocate.value,
  domain.value,
  required.provider::public.advocate_domain_integration_provider,
  required.environment
FROM presentation_test_ids advocate
CROSS JOIN presentation_test_ids domain
CROSS JOIN (
  VALUES
    ('cloudflare', 'production'),
    ('vercel', 'production'),
    ('stripe_us', 'live'),
    ('stripe_uk', 'live'),
    ('paypal', 'live')
) AS required(provider, environment)
WHERE advocate.key = 'advocate'
  AND domain.key = 'domain';

SELECT extensions.is(
  public.read_public_advocate_presentation_snapshot(
    'snapshotportal.creatorshare.com'
  ),
  NULL::jsonb,
  'a known but inactive domain has no public presentation snapshot'
);

SELECT pg_temp.activate_presentation_test_domain(
  (SELECT value FROM presentation_test_ids WHERE key = 'domain'),
  'presentation-test-worker'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '3de44111-9900-4f04-815d-aeb42828229a',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT public.publish_advocate_portal(
  (SELECT value FROM presentation_test_ids WHERE key = 'advocate'),
  (
    SELECT advocate.version
    FROM public.advocates advocate
    WHERE advocate.id = (
      SELECT value FROM presentation_test_ids WHERE key = 'advocate'
    )
  ),
  (SELECT value FROM presentation_test_ids WHERE key = 'domain'),
  'snapshotportal.creatorshare.com',
  extensions.digest('presentation-test-publication-canary', 'sha256'),
  clock_timestamp(),
  'Publish the presentation fixture after all provider chains settle',
  'presentation-test-deployment',
  'presentation-test-publication-request',
  'presentation-test-publication-trace'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

INSERT INTO presentation_test_snapshot (value)
SELECT public.read_public_advocate_presentation_snapshot(
  'snapshotportal.creatorshare.com'
);

SELECT extensions.ok(
  (
    SELECT value IS NOT NULL
      AND (
        SELECT array_agg(key ORDER BY key)
        FROM jsonb_object_keys(value) key
      ) = ARRAY['advocate', 'branding', 'domain', 'metricSelections']::text[]
    FROM presentation_test_snapshot
  ),
  'the active tenant snapshot has exactly the four allowlisted sections'
);

SELECT extensions.ok(
  (
    SELECT
      value #>> '{domain,hostname}' =
        'snapshotportal.creatorshare.com'
      AND value #>> '{domain,status}' = 'active'
      AND value #>> '{advocate,slug}' = 'snapshotportal'
      AND value #>> '{advocate,display_name}' = 'Snapshot Portal'
      AND value #>> '{advocate,beneficiary_mode}' = 'all_featured'
      AND value #>> '{branding,primary_color}' = '#123456'
      AND value #>> '{branding,accent_color}' = '#ABCDEF'
      AND value #>> '{branding,logo_storage_path}' =
        'logos/snapshotportal/31111111-1111-4111-8111-111111111111.webp'
    FROM presentation_test_snapshot
  ),
  'the snapshot contains the exact active tenant lifecycle and presentation fields'
);

SELECT extensions.is(
  (
    SELECT value -> 'metricSelections'
    FROM presentation_test_snapshot
  ),
  jsonb_build_array(
    jsonb_build_object(
      'advocate_id',
      (SELECT value FROM presentation_test_ids WHERE key = 'advocate'),
      'metric_key', 'gross_raised_usd',
      'display_order', 0
    ),
    jsonb_build_object(
      'advocate_id',
      (SELECT value FROM presentation_test_ids WHERE key = 'advocate'),
      'metric_key', 'direct_sponsorships',
      'display_order', 1
    ),
    jsonb_build_object(
      'advocate_id',
      (SELECT value FROM presentation_test_ids WHERE key = 'advocate'),
      'metric_key', 'children_sponsored',
      'display_order', 2
    )
  ),
  'public metric selections are captured in deterministic display order'
);

SELECT extensions.ok(
  (
    SELECT
      NOT (value ? 'beneficiarySelections')
      AND NOT (value -> 'domain' ? 'provider_metadata')
      AND NOT (value -> 'advocate' ? 'created_by_user_id')
      AND NOT (value -> 'advocate' ? 'owner_membership_id')
      AND NOT (value -> 'branding' ? 'updated_at')
    FROM presentation_test_snapshot
  ),
  'beneficiary selections and private operational fields are excluded'
);

SELECT extensions.lives_ok(
  $$
    UPDATE public.advocate_branding
    SET logo_storage_path =
      'logos/snapshotportal/32222222-2222-4222-8222-222222222222.webp'
    WHERE advocate_id = (
      SELECT value FROM presentation_test_ids WHERE key = 'advocate'
    )
  $$,
  'the exact tenant slug and lowercase UUID WebP logo path is accepted'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_branding
    SET logo_storage_path =
      'logos/another-tenant/32222222-2222-4222-8222-222222222222.webp'
    WHERE advocate_id = (
      SELECT value FROM presentation_test_ids WHERE key = 'advocate'
    )
  $$,
  '23514',
  'Advocate logo storage path violates the tenant asset boundary',
  'a tenant cannot reference another advocate logo namespace'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_branding
    SET logo_storage_path =
      'logos/snapshotportal/32222222-2222-4222-8222-222222222222.svg'
    WHERE advocate_id = (
      SELECT value FROM presentation_test_ids WHERE key = 'advocate'
    )
  $$,
  '23514',
  'Advocate logo storage path violates the tenant asset boundary',
  'active SVG content is not accepted as an advocate logo'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocates
    SET slug = 'renamed-snapshot-portal'
    WHERE id = (
      SELECT value FROM presentation_test_ids WHERE key = 'advocate'
    )
  $$,
  '42501',
  'Advocate identity fields are immutable',
  'an immutable advocate slug cannot invalidate an existing tenant logo path'
);

UPDATE public.advocates
SET relationship_status = 'suspended'
WHERE id = (
  SELECT value FROM presentation_test_ids WHERE key = 'advocate'
);

SELECT extensions.is(
  public.read_public_advocate_presentation_snapshot(
    'snapshotportal.creatorshare.com'
  ),
  NULL::jsonb,
  'a suspended advocate immediately loses its public presentation snapshot'
);

SELECT * FROM extensions.finish();

ROLLBACK;
