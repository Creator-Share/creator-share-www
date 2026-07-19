BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';
SET LOCAL session_replication_role = 'replica';

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
    'f0400000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'publication-initiator@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    'f0400000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'publication-approver-one@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  ),
  (
    'f0400000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'publication-approver-two@example.test',
    clock_timestamp(),
    '{}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    false
  );

INSERT INTO auth.sessions (
  id,
  user_id,
  created_at,
  updated_at,
  aal,
  not_after
)
VALUES
  (
    'f0401000-0000-4000-8000-000000000001'::uuid,
    'f0400000-0000-4000-8000-000000000001'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    'f0401000-0000-4000-8000-000000000002'::uuid,
    'f0400000-0000-4000-8000-000000000002'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
  ),
  (
    'f0401000-0000-4000-8000-000000000003'::uuid,
    'f0400000-0000-4000-8000-000000000003'::uuid,
    clock_timestamp(),
    clock_timestamp(),
    'aal1',
    clock_timestamp() + interval '1 hour'
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
    ('f0400000-0000-4000-8000-000000000001'::uuid),
    ('f0400000-0000-4000-8000-000000000002'::uuid),
    ('f0400000-0000-4000-8000-000000000003'::uuid)
) AS actor(user_id)
CROSS JOIN public.roles role
WHERE role.name = 'SUPER_ADMIN';

SET LOCAL session_replication_role = 'origin';

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'f0400000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', 'f0400000-0000-4000-8000-000000000001',
    'session_id', 'f0401000-0000-4000-8000-000000000001',
    'aal', 'aal1'
  )::text,
  true
);

SELECT public.create_advocate_portal(
  'f0400000-0000-4000-8000-000000000001'::uuid,
  fixture.slug,
  fixture.display_name,
  'Create an isolated FF-040 publication concurrency fixture',
  'creator',
  'ff040-create-' || fixture.slug,
  'ff040-fixture-setup',
  'f0401000-0000-4000-8000-000000000001'
)
FROM (
  VALUES
    ('ff040-start-race', 'FF-040 Start Race'),
    ('ff040-replay-race', 'FF-040 Replay Race'),
    ('ff040-approval-race', 'FF-040 Approval Race'),
    ('ff040-lease-race', 'FF-040 Lease Race'),
    ('ff040-rollover-race', 'FF-040 Rollover Race')
) AS fixture(slug, display_name);

DO $fixture$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT advocate.id, advocate.version, advocate.slug
    FROM public.advocates advocate
    WHERE advocate.slug LIKE 'ff040-%-race'
    ORDER BY advocate.slug
  LOOP
    PERFORM *
    FROM public.start_advocate_portal_provisioning(
      target.id,
      target.version,
      gen_random_uuid(),
      'ff040-provision-' || target.slug
    );
  END LOOP;
END;
$fixture$;

CREATE TEMP TABLE ff040_domain_hostnames (
  domain_id uuid PRIMARY KEY,
  hostname text NOT NULL
) ON COMMIT DROP;

INSERT INTO ff040_domain_hostnames (domain_id, hostname)
SELECT domain.id, domain.hostname
FROM public.advocate_domains domain
JOIN public.advocates advocate
  ON advocate.id = domain.advocate_id
WHERE advocate.slug LIKE 'ff040-%-race';

GRANT SELECT ON ff040_domain_hostnames TO service_role;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
SET LOCAL ROLE service_role;

CREATE TEMP TABLE ff040_provisioning_claims (
  provider public.advocate_domain_integration_provider NOT NULL,
  job_id uuid PRIMARY KEY,
  lease_token uuid NOT NULL,
  hostname text NOT NULL
) ON COMMIT DROP;

INSERT INTO ff040_provisioning_claims (
  provider,
  job_id,
  lease_token,
  hostname
)
SELECT
  claimed.provider,
  claimed.job_id,
  claimed.lease_token,
  domain.hostname
FROM public.claim_domain_provisioning_jobs(
  'ff040-fixture-provider-worker',
  100,
  interval '10 minutes'
) claimed
JOIN ff040_domain_hostnames domain
  ON domain.domain_id = claimed.domain_id;

DO $fixture$
DECLARE
  claim record;
  provider_result jsonb;
BEGIN
  FOR claim IN
    SELECT *
    FROM ff040_provisioning_claims
    ORDER BY provider::text, job_id
  LOOP
    provider_result := CASE claim.provider
      WHEN 'cloudflare' THEN jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('d', 32),
        'dns_record_id', repeat('d', 32),
        'http_status', 200,
        'verified', true
      )
      WHEN 'vercel' THEN jsonb_build_object(
        'provider_status', 'attached_verified',
        'provider_resource_id', claim.hostname,
        'deployment_id', 'dpl_ff040_fixture',
        'http_status', 200,
        'verified', true
      )
      ELSE jsonb_build_object(
        'provider_status', 'payment_path_ready',
        'provider_resource_id', claim.provider::text || ':hosted_checkout',
        'http_status', 200,
        'verified', true
      )
    END;

    PERFORM public.record_domain_provisioning_reconciliation(
      claim.job_id,
      claim.lease_token,
      'matches_intent',
      provider_result
    );

    PERFORM public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      provider_result
    );
  END LOOP;
END;
$fixture$;

RESET ROLE;

DO $fixture$
DECLARE
  fixture_count integer;
  ready_integration_count integer;
BEGIN
  SELECT count(*)::integer
  INTO fixture_count
  FROM public.advocates advocate
  JOIN public.advocate_domains domain
    ON domain.advocate_id = advocate.id
   AND domain.is_primary
   AND domain.status = 'verifying'
  WHERE advocate.slug LIKE 'ff040-%-race'
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status = 'provisioning';

  SELECT count(*)::integer
  INTO ready_integration_count
  FROM public.advocates advocate
  JOIN public.advocate_domain_integrations integration
    ON integration.advocate_id = advocate.id
   AND integration.is_required
   AND integration.status = 'ready'
  WHERE advocate.slug LIKE 'ff040-%-race';

  IF fixture_count <> 5 OR ready_integration_count <> 25 THEN
    RAISE EXCEPTION
      'FF-040 fixture provisioning did not produce five exact ready portals';
  END IF;
END;
$fixture$;

COMMIT;
