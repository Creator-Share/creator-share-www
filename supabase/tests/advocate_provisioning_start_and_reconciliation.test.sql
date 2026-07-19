BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL statement_timeout = '30s';

SELECT extensions.plan(92);

CREATE TEMP TABLE provisioning_test_context (
  key text PRIMARY KEY,
  uuid_value uuid,
  bigint_value bigint,
  text_value text,
  uuid_array_value uuid[]
) ON COMMIT DROP;

CREATE TEMP TABLE provisioning_start_result (
  advocate_id uuid,
  advocate_version bigint,
  domain_id uuid,
  hostname text,
  job_ids uuid[]
) ON COMMIT DROP;

CREATE TEMP TABLE provisioning_replay_result
(LIKE provisioning_start_result) ON COMMIT DROP;

CREATE TEMP TABLE provisioning_reconciliation_result (
  domain_id uuid,
  enqueued_job_count integer,
  quarantined boolean
) ON COMMIT DROP;

CREATE TEMP TABLE provisioning_claims (
  job_id uuid,
  domain_id uuid,
  integration_id uuid,
  provider public.advocate_domain_integration_provider,
  lease_token uuid
) ON COMMIT DROP;

GRANT ALL ON provisioning_start_result TO authenticated;
GRANT ALL ON provisioning_replay_result TO authenticated;
GRANT ALL ON provisioning_reconciliation_result TO service_role;
GRANT SELECT ON provisioning_start_result TO service_role;
GRANT ALL ON provisioning_test_context TO authenticated;
GRANT SELECT ON provisioning_test_context TO service_role;

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  created_at,
  updated_at
)
VALUES
  (
    'a9000000-0000-4000-8000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'provisioning-admin@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'a9000000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'provisioning-second-admin@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'a9000000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'provisioning-member@example.test',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    now(),
    now()
  ),
  (
    'a9000000-0000-4000-8000-000000000004'::uuid,
    'authenticated',
    'authenticated',
    'provisioning-unhealthy-admin@example.test',
    NULL,
    '{}'::jsonb,
    '{}'::jsonb,
    false,
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
    ('a9000000-0000-4000-8000-000000000001'::uuid),
    ('a9000000-0000-4000-8000-000000000002'::uuid),
    ('a9000000-0000-4000-8000-000000000004'::uuid)
) AS actor(user_id)
CROSS JOIN public.roles role
WHERE role.name = 'SUPER_ADMIN';

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'a9000000-0000-4000-8000-000000000001',
  true
);

CREATE OR REPLACE FUNCTION pg_temp.settle_initial_provisioning_jobs(
  target_worker_id text
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claim record;
  v_hostname text;
  v_evidence jsonb;
  v_settled_count integer := 0;
BEGIN
  FOR v_claim IN
    SELECT *
    FROM public.claim_domain_provisioning_jobs(
      target_worker_id,
      5,
      interval '10 minutes'
    )
  LOOP
    SELECT domain.hostname
    INTO v_hostname
    FROM public.advocate_domains domain
    WHERE domain.id = v_claim.domain_id;

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
        'deployment_id', 'prj_atomic_portal',
        'http_status', 200,
        'verified', true
      )
      ELSE jsonb_build_object(
        'provider_status', 'payment_path_ready',
        'provider_resource_id', v_claim.provider::text || ':hosted_checkout',
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
    v_settled_count := v_settled_count + 1;
  END LOOP;

  RETURN v_settled_count;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.repair_failed_cloudflare_integration(
  target_domain_id uuid,
  target_correlation_id text,
  target_worker_id text
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claim record;
  v_evidence jsonb := jsonb_build_object(
    'provider_status', 'dns_only_cname_ready',
    'provider_resource_id', repeat('a', 32),
    'dns_record_id', repeat('a', 32),
    'http_status', 200,
    'verified', true
  );
  v_status text;
BEGIN
  UPDATE public.advocate_domain_integrations integration
  SET last_checked_at = clock_timestamp() - interval '1 hour'
  WHERE integration.domain_id = target_domain_id
    AND integration.provider = 'cloudflare';

  PERFORM *
  FROM public.enqueue_due_advocate_domain_reconciliations(
    100,
    target_correlation_id
  );

  SELECT claimed.*
  INTO v_claim
  FROM public.claim_domain_provisioning_jobs(
    target_worker_id,
    1,
    interval '10 minutes'
  ) claimed;

  IF NOT FOUND OR v_claim.provider <> 'cloudflare' THEN
    RAISE EXCEPTION 'Expected one Cloudflare repair claim';
  END IF;

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

  SELECT domain.status::text
  INTO v_status
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id;

  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.repair_failed_provider_integration(
  target_domain_id uuid,
  target_provider public.advocate_domain_integration_provider,
  target_correlation_id text,
  target_worker_id text
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claim record;
  v_hostname text;
  v_evidence jsonb;
  v_status text;
BEGIN
  SELECT domain.hostname
  INTO v_hostname
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id;

  UPDATE public.advocate_domain_integrations integration
  SET last_checked_at = clock_timestamp() - interval '1 hour'
  WHERE integration.domain_id = target_domain_id
    AND integration.provider = target_provider;

  PERFORM *
  FROM public.enqueue_due_advocate_domain_reconciliations(
    100,
    target_correlation_id
  );

  SELECT claimed.*
  INTO v_claim
  FROM public.claim_domain_provisioning_jobs(
    target_worker_id,
    1,
    interval '10 minutes'
  ) claimed;

  IF NOT FOUND OR v_claim.provider <> target_provider THEN
    RAISE EXCEPTION 'Expected one % repair claim', target_provider;
  END IF;

  v_evidence := CASE target_provider
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
      'deployment_id', 'prj_provider_repair',
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

  SELECT domain.status::text
  INTO v_status
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id;

  RETURN v_status;
END;
$$;

SELECT extensions.ok(
  to_regclass('audit.advocate_portal_provisioning_starts') IS NOT NULL,
  'atomic provisioning start has a dedicated immutable evidence relation'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.start_advocate_portal_provisioning(uuid,bigint,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.start_advocate_portal_provisioning(uuid,bigint,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.start_advocate_portal_provisioning(uuid,bigint,uuid,text)',
    'EXECUTE'
  ),
  'only authenticated callers can reach the super administrator provisioning boundary'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.enqueue_due_advocate_domain_reconciliations(integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.enqueue_due_advocate_domain_reconciliations(integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.enqueue_due_advocate_domain_reconciliations(integer,text)',
    'EXECUTE'
  ),
  'only the service role can enqueue scheduled provider reconciliation'
);

SELECT extensions.ok(
  has_table_privilege('service_role', 'public.advocate_domains', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.advocate_domains', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.advocate_domains', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.advocate_domains', 'DELETE')
  AND has_table_privilege(
    'service_role',
    'public.advocate_domain_integrations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_domain_integrations',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_domain_integrations',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.advocate_domain_integrations',
    'DELETE'
  ),
  'the service role can read topology but cannot create or mutate it directly'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'audit.advocate_portal_provisioning_starts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_portal_provisioning_starts',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_portal_provisioning_starts',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'audit.advocate_portal_provisioning_starts',
    'DELETE'
  ),
  'runtime roles cannot read or forge provisioning start evidence directly'
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES ('atomicportal', 'Atomic Portal', 'active', 'draft')
  RETURNING id, version
)
INSERT INTO provisioning_test_context (key, uuid_value, bigint_value)
SELECT 'main_advocate', id, version FROM inserted;

INSERT INTO public.advocate_branding (advocate_id)
SELECT uuid_value
FROM provisioning_test_context
WHERE key = 'main_advocate';

SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'main_advocate'
      ),
      1,
      'a1000000-0000-4000-8000-000000000010'::uuid,
      'missing-auth-start-trace'
    )
  $$,
  '28000',
  'Authentication is required',
  'provisioning start requires an authenticated user identity'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  'a9000000-0000-4000-8000-000000000003',
  true
);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'main_advocate'
      ),
      1,
      'a1000000-0000-4000-8000-000000000011'::uuid,
      'member-start-trace'
    )
  $$,
  '42501',
  'Creator Share super administrator access is required',
  'a regular authenticated member cannot begin provider provisioning'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  'a9000000-0000-4000-8000-000000000004',
  true
);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'main_advocate'
      ),
      1,
      'a1000000-0000-4000-8000-000000000012'::uuid,
      'unverified-admin-start-trace'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'an unverified super administrator account cannot provision a portal'
);
RESET ROLE;

UPDATE auth.users
SET email_confirmed_at = now(), is_anonymous = true
WHERE id = 'a9000000-0000-4000-8000-000000000004'::uuid;

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'main_advocate'
      ),
      1,
      'a1000000-0000-4000-8000-000000000013'::uuid,
      'anonymous-admin-start-trace'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'an anonymous super administrator identity cannot provision a portal'
);
RESET ROLE;

UPDATE auth.users
SET is_anonymous = false, banned_until = now() + interval '1 hour'
WHERE id = 'a9000000-0000-4000-8000-000000000004'::uuid;

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'main_advocate'
      ),
      1,
      'a1000000-0000-4000-8000-000000000014'::uuid,
      'banned-admin-start-trace'
    )
  $$,
  '42501',
  'An active authenticated account with a verified email is required',
  'a banned super administrator account cannot provision a portal'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  'a9000000-0000-4000-8000-000000000001',
  true
);

SET LOCAL ROLE authenticated;
INSERT INTO provisioning_start_result
SELECT *
FROM public.start_advocate_portal_provisioning(
  (
    SELECT uuid_value
    FROM provisioning_test_context
    WHERE key = 'main_advocate'
  ),
  1,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'atomic-start-trace-001'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      result.advocate_id = context.uuid_value
      AND result.advocate_version = 2
      AND result.hostname = 'atomicportal.creatorshare.com'
      AND cardinality(result.job_ids) = 5
      AND array_position(result.job_ids, NULL) IS NULL
    FROM provisioning_start_result result
    JOIN provisioning_test_context context
      ON context.key = 'main_advocate'
  ),
  'start derives the exact hostname and returns one relational five-job result'
);

SELECT extensions.ok(
  (
    SELECT
      advocate.version = 2
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status = 'provisioning'
    FROM public.advocates advocate
    JOIN provisioning_test_context context
      ON context.uuid_value = advocate.id
     AND context.key = 'main_advocate'
  ),
  'start advances the optimistic advocate version and publication lifecycle once'
);

SELECT extensions.ok(
  (
    SELECT
      count(*) = 1
      AND bool_and(domain.id = result.domain_id)
      AND bool_and(domain.hostname = result.hostname)
      AND bool_and(domain.is_primary)
      AND bool_and(domain.status = 'provisioning')
    FROM public.advocate_domains domain
    JOIN provisioning_start_result result
      ON result.advocate_id = domain.advocate_id
  ),
  'start creates exactly one server-derived primary domain in provisioning'
);

SELECT extensions.ok(
  (
    SELECT
      count(*) = 5
      AND count(*) FILTER (
        WHERE integration.provider = 'cloudflare'
          AND integration.environment = 'production'
          AND integration.is_required
      ) = 1
      AND count(*) FILTER (
        WHERE integration.provider = 'vercel'
          AND integration.environment = 'production'
          AND integration.is_required
      ) = 1
      AND count(*) FILTER (
        WHERE integration.provider = 'stripe_us'
          AND integration.environment = 'live'
          AND integration.is_required
      ) = 1
      AND count(*) FILTER (
        WHERE integration.provider = 'stripe_uk'
          AND integration.environment = 'live'
          AND integration.is_required
      ) = 1
      AND count(*) FILTER (
        WHERE integration.provider = 'paypal'
          AND integration.environment = 'live'
          AND integration.is_required
      ) = 1
    FROM public.advocate_domain_integrations integration
    JOIN provisioning_start_result result
      ON result.domain_id = integration.domain_id
  ),
  'start creates exactly the five required live production integrations'
);

SELECT extensions.ok(
  (
    SELECT
      count(*) = 5
      AND count(DISTINCT job.integration_id) = 5
      AND count(DISTINCT job.provider) = 5
      AND count(DISTINCT job.idempotency_key) = 5
      AND count(DISTINCT job.provider_idempotency_key) = 5
      AND bool_and(job.kind = 'provision')
      AND bool_and(job.status = 'queued')
      AND bool_and(job.reconciliation_required)
    FROM public.domain_provisioning_jobs job
    JOIN provisioning_start_result result
      ON result.domain_id = job.domain_id
    WHERE job.id = ANY(result.job_ids)
  ),
  'start atomically creates five independently idempotent initial provision jobs'
);

SELECT extensions.ok(
  (
    SELECT
      start.request_id = 'a1000000-0000-4000-8000-000000000001'::uuid
      AND start.trace_id = 'atomic-start-trace-001'
      AND start.initiating_user_id =
        'a9000000-0000-4000-8000-000000000001'::uuid
      AND start.advocate_id = result.advocate_id
      AND start.expected_advocate_version = 1
      AND start.resulting_advocate_version = 2
      AND start.domain_id = result.domain_id
      AND start.hostname = result.hostname
      AND start.job_ids = result.job_ids
      AND octet_length(start.provider_topology_digest) = 32
    FROM audit.advocate_portal_provisioning_starts start
    CROSS JOIN provisioning_start_result result
  ),
  'append-only evidence binds administrator, request, trace, version, hostname, topology, and jobs'
);

SELECT extensions.ok(
  (
    SELECT count(*) >= 12
    FROM audit.audit_events event
    JOIN provisioning_start_result result
      ON event.advocate_id = result.advocate_id
    WHERE event.request_id = 'a1000000-0000-4000-8000-000000000001'
      AND event.trace_id = 'atomic-start-trace-001'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        'a9000000-0000-4000-8000-000000000001'::uuid
      AND event.system_actor IS NULL
      AND event.tool = 'creator-share-admin-domains'
      AND event.reason = 'Atomically begin exact advocate portal provisioning'
      AND event.metadata ->> 'domain_hostname' =
        'atomicportal.creatorshare.com'
  ),
  'every start mutation carries the initiating administrator request and trace context'
);

SET LOCAL ROLE authenticated;
INSERT INTO provisioning_replay_result
SELECT *
FROM public.start_advocate_portal_provisioning(
  (
    SELECT advocate_id FROM provisioning_start_result
  ),
  1,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'atomic-start-trace-001'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      replay.advocate_id = original.advocate_id
      AND replay.advocate_version = original.advocate_version
      AND replay.domain_id = original.domain_id
      AND replay.hostname = original.hostname
      AND replay.job_ids = original.job_ids
    FROM provisioning_replay_result replay
    CROSS JOIN provisioning_start_result original
  ),
  'an exact replay returns the original relational result byte for byte'
);

SELECT extensions.ok(
  (SELECT count(*) FROM public.advocate_domains) = 1
  AND (SELECT count(*) FROM public.advocate_domain_integrations) = 5
  AND (SELECT count(*) FROM public.domain_provisioning_jobs) = 5
  AND (
    SELECT count(*)
    FROM audit.advocate_portal_provisioning_starts
  ) = 1,
  'an exact replay creates no duplicate topology, jobs, or evidence'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a9000000-0000-4000-8000-000000000002',
  true
);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (SELECT advocate_id FROM provisioning_start_result),
      1,
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'atomic-start-trace-001'
    )
  $$,
  '40001',
  'Advocate provisioning replay does not match the committed request',
  'a different super administrator cannot replay another administrator request'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  'a9000000-0000-4000-8000-000000000001',
  true
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (SELECT advocate_id FROM provisioning_start_result),
      2,
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'atomic-start-trace-001'
    )
  $$,
  '40001',
  'Advocate provisioning replay does not match the committed request',
  'a replay cannot change the original optimistic version'
);
RESET ROLE;

TRUNCATE provisioning_replay_result;
SET LOCAL ROLE authenticated;
INSERT INTO provisioning_replay_result
SELECT *
FROM public.start_advocate_portal_provisioning(
  (SELECT advocate_id FROM provisioning_start_result),
  1,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'transport-retry-trace'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT replay.job_ids = original.job_ids
    FROM provisioning_replay_result replay
    CROSS JOIN provisioning_start_result original
  )
  AND (
    SELECT start.trace_id = 'atomic-start-trace-001'
    FROM audit.advocate_portal_provisioning_starts start
    WHERE start.request_id =
      'a1000000-0000-4000-8000-000000000001'::uuid
  ),
  'an idempotent retry may use a new transport trace while retaining committed evidence'
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (SELECT advocate_id FROM provisioning_start_result),
      2,
      'a1000000-0000-4000-8000-000000000002'::uuid,
      'atomic-start-trace-002'
    )
  $$,
  '40001',
  'Advocate provisioning already began with another request',
  'one advocate cannot begin a second provisioning intent'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      'a2000000-0000-4000-8000-000000000001'::uuid,
      1,
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'atomic-start-trace-001'
    )
  $$,
  '40001',
  'Advocate provisioning replay does not match the committed request',
  'a request UUID cannot be replayed against another advocate'
);
RESET ROLE;

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES ('staleportal', 'Stale Portal', 'active', 'draft')
  RETURNING id
)
INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'stale_advocate', id FROM inserted;

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'stale_advocate'
      ),
      2,
      'a1000000-0000-4000-8000-000000000003'::uuid,
      'stale-start-trace'
    )
  $$,
  '40001',
  'Advocate portal version changed before provisioning began',
  'a stale optimistic version fails before any provider topology is created'
);
RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    JOIN provisioning_test_context context
      ON context.uuid_value = domain.advocate_id
     AND context.key = 'stale_advocate'
  ),
  'stale start failure leaves the advocate topology empty'
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES ('invitedportal', 'Invited Portal', 'invited', 'draft')
  RETURNING id
)
INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'invited_advocate', id FROM inserted;

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'invited_advocate'
      ),
      1,
      'a1000000-0000-4000-8000-000000000004'::uuid,
      'invited-start-trace'
    )
  $$,
  '55000',
  'Advocate portal is not eligible to begin provisioning',
  'an inactive advocate relationship cannot provision a hostname'
);
RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    JOIN provisioning_test_context context
      ON context.uuid_value = domain.advocate_id
     AND context.key = 'invited_advocate'
  ),
  'relationship rejection rolls back every topology mutation'
);

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES ('partialportal', 'Partial Portal', 'active', 'draft')
  RETURNING id
)
INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'partial_advocate', id FROM inserted;

INSERT INTO public.advocate_domains (advocate_id, hostname, is_primary)
SELECT uuid_value, 'partialportal.creatorshare.com', true
FROM provisioning_test_context
WHERE key = 'partial_advocate';

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'partial_advocate'
      ),
      1,
      'a1000000-0000-4000-8000-000000000005'::uuid,
      'partial-start-trace'
    )
  $$,
  '55000',
  'Advocate provisioning requires an empty domain topology',
  'a partial preexisting topology is rejected instead of being filled in'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT count(*) = 1
    FROM public.advocate_domains domain
    JOIN provisioning_test_context context
      ON context.uuid_value = domain.advocate_id
     AND context.key = 'partial_advocate'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    JOIN provisioning_test_context context
      ON context.uuid_value = integration.advocate_id
     AND context.key = 'partial_advocate'
  ),
  'partial topology rejection neither deletes history nor creates missing rows'
);

SELECT extensions.throws_ok(
  $$
    UPDATE audit.advocate_portal_provisioning_starts
    SET trace_id = 'forged-trace'
    WHERE request_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  $$,
  '42501',
  'Advocate provisioning start evidence is append-only',
  'provisioning start evidence cannot be updated'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM audit.advocate_portal_provisioning_starts
    WHERE request_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  $$,
  '42501',
  'Advocate provisioning start evidence is append-only',
  'provisioning start evidence cannot be deleted'
);

SELECT extensions.throws_ok(
  $$TRUNCATE audit.advocate_portal_provisioning_starts$$,
  '42501',
  'Advocate provisioning start evidence is append-only',
  'provisioning start evidence cannot be truncated'
);

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocate_domains (
      advocate_id,
      hostname,
      is_primary
    )
    VALUES (
      'a2000000-0000-4000-8000-000000000002'::uuid,
      'forged.creatorshare.com',
      true
    )
  $$,
  '42501',
  'permission denied for table advocate_domains',
  'the service role cannot forge a domain outside the start boundary'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(
  $$
    INSERT INTO public.advocate_domain_integrations (
      advocate_id,
      domain_id,
      provider,
      environment
    )
    VALUES (
      'a2000000-0000-4000-8000-000000000002'::uuid,
      'a2000000-0000-4000-8000-000000000003'::uuid,
      'cloudflare',
      'production'
    )
  $$,
  '42501',
  'permission denied for table advocate_domain_integrations',
  'the service role cannot forge a provider integration outside the boundary'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.enqueue_due_advocate_domain_reconciliations(
      0,
      'reconcile-batch-low'
    )
  $$,
  '22023',
  'Reconciliation enqueue batch size must be between 1 and 100',
  'the reconciliation scheduler rejects an empty batch'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.enqueue_due_advocate_domain_reconciliations(
      101,
      'reconcile-batch-high'
    )
  $$,
  '22023',
  'Reconciliation enqueue batch size must be between 1 and 100',
  'the reconciliation scheduler is capped at one hundred integrations'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.enqueue_due_advocate_domain_reconciliations(20, ' ')
  $$,
  '22023',
  'Reconciliation correlation id is invalid',
  'scheduled reconciliation requires a durable correlation identity'
);
RESET ROLE;

SELECT extensions.is(
  pg_temp.settle_initial_provisioning_jobs('atomic-start-worker'),
  5,
  'all five initial provider jobs settle through the existing fenced worker boundary'
);

SELECT extensions.is(
  (
    SELECT domain.status::text
    FROM public.advocate_domains domain
    JOIN provisioning_start_result result ON result.domain_id = domain.id
  ),
  'verifying',
  'automated provider success stops the newly provisioned domain at verifying'
);

SELECT set_config('request.jwt.claim.role', '', true);

UPDATE public.advocate_domains domain
SET status = 'active'
FROM provisioning_start_result result
WHERE domain.id = result.domain_id;

UPDATE public.advocates advocate
SET publication_status = 'active'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id;

SELECT extensions.ok(
  public.read_public_advocate_presentation_snapshot(
    'atomicportal.creatorshare.com'
  ) IS NOT NULL,
  'the exact hostname resolves only after an explicit publication transition'
);

UPDATE public.advocate_domain_integrations integration
SET last_checked_at = clock_timestamp() - interval '1 hour'
FROM provisioning_start_result result
WHERE integration.domain_id = result.domain_id;

SET LOCAL ROLE service_role;
INSERT INTO provisioning_reconciliation_result
SELECT *
FROM public.enqueue_due_advocate_domain_reconciliations(
  100,
  'active-domain-not-due-001'
);
RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM provisioning_reconciliation_result),
  'an active domain is not due after one hour of healthy provider state'
);

UPDATE public.advocate_domain_integrations integration
SET last_checked_at = clock_timestamp() - interval '7 hours'
FROM provisioning_start_result result
WHERE integration.domain_id = result.domain_id;

SET LOCAL ROLE service_role;
INSERT INTO provisioning_reconciliation_result
SELECT *
FROM public.enqueue_due_advocate_domain_reconciliations(
  100,
  'active-domain-reconcile-001'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      count(*) = 1
      AND bool_and(result.domain_id = start_result.domain_id)
      AND sum(result.enqueued_job_count) = 5
    FROM provisioning_reconciliation_result result
    CROSS JOIN provisioning_start_result start_result
  ),
  'one bounded scheduler call enqueues all five due active provider checks'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.domain_provisioning_jobs job
    JOIN provisioning_start_result result ON result.domain_id = job.domain_id
    WHERE job.kind = 'reconcile'
      AND job.status = 'queued'
  ),
  5,
  'the due scheduler creates one reconcile job per exact required integration'
);

TRUNCATE provisioning_reconciliation_result;
SET LOCAL ROLE service_role;
INSERT INTO provisioning_reconciliation_result
SELECT *
FROM public.enqueue_due_advocate_domain_reconciliations(
  100,
  'active-domain-reconcile-002'
);
RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM provisioning_reconciliation_result)
  AND (
    SELECT count(*)
    FROM public.domain_provisioning_jobs job
    JOIN provisioning_start_result result ON result.domain_id = job.domain_id
    WHERE job.kind = 'reconcile'
  ) = 5,
  'a repeated scheduler pass is idempotent while reconcile jobs remain open'
);

SELECT extensions.ok(
  (
    SELECT count(*) >= 5
    FROM audit.audit_events event
    JOIN provisioning_start_result result
      ON event.advocate_id = result.advocate_id
    WHERE event.table_name = 'domain_provisioning_jobs'
      AND event.operation = 'INSERT'
      AND event.trace_id = 'active-domain-reconcile-001'
      AND event.system_actor = 'advocate-domain-reconciler'
      AND event.tool = 'advocate-domain-reconciliation-enqueue'
  ),
  'scheduled reconciliation jobs retain the scheduler correlation evidence'
);

INSERT INTO provisioning_claims (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'active-drift-worker',
  5,
  interval '10 minutes'
) claimed;

SELECT extensions.throws_ok(
  $$
    SELECT public.record_domain_provisioning_reconciliation(
      (SELECT job_id FROM provisioning_claims WHERE provider = 'cloudflare'),
      gen_random_uuid(),
      'matches_intent',
      jsonb_build_object('verified', true)
    )
  $$,
  '42501',
  'Domain provisioning lease is unavailable',
  'reconciliation evidence rejects a stale or foreign lease token'
);

SELECT extensions.is(
  (
    SELECT public.record_domain_provisioning_reconciliation(
      claim.job_id,
      claim.lease_token,
      'matches_intent',
      jsonb_build_object(
        'provider_status', 'dns_only_cname_ready',
        'provider_resource_id', repeat('a', 32),
        'dns_record_id', repeat('a', 32),
        'http_status', 200,
        'verified', true
      )
    )
    FROM provisioning_claims claim
    WHERE claim.provider = 'cloudflare'
  ),
  true,
  'verified matches_intent preserves active public eligibility'
);

SELECT extensions.ok(
  (
    SELECT domain.status = 'active'
    FROM public.advocate_domains domain
    JOIN provisioning_start_result result ON result.domain_id = domain.id
  )
  AND (
    SELECT advocate.publication_status = 'active'
    FROM public.advocates advocate
    JOIN provisioning_start_result result ON result.advocate_id = advocate.id
  ),
  'a clean active reconciliation leaves domain and publication active'
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
    FROM provisioning_claims claim
    WHERE claim.provider = 'cloudflare'
  ),
  'succeeded',
  'clean active reconciliation can settle without withdrawing the portal'
);

SELECT extensions.is(
  (
    SELECT public.record_domain_provisioning_reconciliation(
      claim.job_id,
      claim.lease_token,
      'conflict',
      jsonb_build_object(
        'provider_status', 'conflict',
        'http_status', 409,
        'verified', false
      )
    )
    FROM provisioning_claims claim
    WHERE claim.provider = 'vercel'
  ),
  false,
  'an active required-provider conflict withdraws public eligibility before mutation'
);

SELECT extensions.ok(
  (
    SELECT
      job.status = 'running'
      AND job.reconciliation_outcome = 'conflict'
      AND job.result_payload @> '{"verified":false}'::jsonb
      AND integration.status = 'failed'
      AND integration.ready_at IS NULL
      AND integration.last_error = 'active_provider_reconciliation_unverified'
      AND domain.status = 'failed'
      AND domain.failure_code = 'active_provider_reconciliation_unverified'
      AND advocate.publication_status = 'failed'
    FROM provisioning_claims claim
    JOIN public.domain_provisioning_jobs job ON job.id = claim.job_id
    JOIN public.advocate_domain_integrations integration
      ON integration.id = claim.integration_id
    JOIN public.advocate_domains domain ON domain.id = claim.domain_id
    JOIN public.advocates advocate ON advocate.id = domain.advocate_id
    WHERE claim.provider = 'vercel'
  ),
  'conflict evidence is recorded before integration, domain, and publication fail closed'
);

SELECT extensions.is(
  (
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'failed',
      'provider_drift_terminal',
      '{}'::jsonb
    )::text
    FROM provisioning_claims claim
    WHERE claim.provider = 'vercel'
  ),
  'failed',
  'the worker can terminally settle a committed active-drift withdrawal'
);

SELECT extensions.ok(
  public.read_public_advocate_presentation_snapshot(
    'atomicportal.creatorshare.com'
  ) IS NULL,
  'the failed domain disappears from exact public tenant resolution immediately'
);

DO $cleanup_open_active_reconciliations$
DECLARE
  v_claim record;
  v_evidence jsonb;
BEGIN
  FOR v_claim IN
    SELECT *
    FROM provisioning_claims claim
    WHERE claim.provider IN ('stripe_us', 'stripe_uk', 'paypal')
    ORDER BY claim.provider
  LOOP
    v_evidence := jsonb_build_object(
      'provider_status', 'payment_path_ready',
      'provider_resource_id', v_claim.provider::text || ':hosted_checkout',
      'http_status', 200,
      'verified', true
    );

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
  END LOOP;
END;
$cleanup_open_active_reconciliations$;

UPDATE public.advocate_domain_integrations integration
SET last_checked_at = clock_timestamp() - interval '1 hour'
FROM provisioning_claims claim
WHERE integration.id = claim.integration_id
  AND claim.provider = 'vercel';

TRUNCATE provisioning_reconciliation_result;
SET LOCAL ROLE service_role;
INSERT INTO provisioning_reconciliation_result
SELECT *
FROM public.enqueue_due_advocate_domain_reconciliations(
  100,
  'failed-domain-repair-001'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      count(*) = 1
      AND bool_and(result.enqueued_job_count = 1)
    FROM provisioning_reconciliation_result result
  ),
  'the scheduler creates one repair reconciliation after the failed provider becomes due'
);

TRUNCATE provisioning_claims;
INSERT INTO provisioning_claims (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'failed-drift-repair-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  jsonb_build_object(
    'provider_status', 'attached_verified',
    'provider_resource_id', 'atomicportal.creatorshare.com',
    'deployment_id', 'prj_atomic_portal_repair',
    'http_status', 200,
    'verified', true
  )
)
FROM provisioning_claims claim;

SELECT extensions.is(
  (
    SELECT public.complete_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      'succeeded',
      NULL,
      jsonb_build_object(
        'provider_status', 'attached_verified',
        'provider_resource_id', 'atomicportal.creatorshare.com',
        'deployment_id', 'prj_atomic_portal_repair',
        'http_status', 200,
        'verified', true
      )
    )::text
    FROM provisioning_claims claim
  ),
  'succeeded',
  'verified provider repair settles through the same fenced boundary'
);

SELECT extensions.ok(
  (
    SELECT
      integration.status = 'ready'
      AND integration.ready_at IS NOT NULL
      AND integration.last_error IS NULL
      AND domain.status = 'verifying'
      AND domain.activated_at IS NOT NULL
      AND advocate.publication_status = 'failed'
    FROM provisioning_claims claim
    JOIN public.advocate_domain_integrations integration
      ON integration.id = claim.integration_id
    JOIN public.advocate_domains domain ON domain.id = claim.domain_id
    JOIN public.advocates advocate ON advocate.id = domain.advocate_id
  ),
  'repair restores readiness but leaves the domain verifying and publication failed'
);

SELECT extensions.ok(
  public.read_public_advocate_presentation_snapshot(
    'atomicportal.creatorshare.com'
  ) IS NULL,
  'automation cannot reactivate the public tenant after a successful repair'
);

UPDATE public.advocates advocate
SET publication_status = 'provisioning'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'failed';

UPDATE public.advocate_domains domain
SET status = 'active'
FROM provisioning_start_result result
WHERE domain.id = result.domain_id
  AND domain.status = 'verifying';

UPDATE public.advocates advocate
SET publication_status = 'active'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'provisioning';

SELECT public.enqueue_domain_provisioning_job_system(
  integration.domain_id,
  integration.id,
  'reconcile',
  clock_timestamp(),
  'active-unverified-match-enqueue'
)
FROM public.advocate_domain_integrations integration
JOIN provisioning_start_result result ON result.domain_id = integration.domain_id
WHERE integration.provider = 'stripe_us';

TRUNCATE provisioning_claims;
INSERT INTO provisioning_claims (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'active-unverified-match-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT extensions.is(
  (
    SELECT public.record_domain_provisioning_reconciliation(
      claim.job_id,
      claim.lease_token,
      'matches_intent',
      jsonb_build_object(
        'provider_status', 'payment_path_ready',
        'provider_resource_id', 'stripe_us:hosted_checkout',
        'http_status', 200,
        'verified', false
      )
    )
    FROM provisioning_claims claim
  ),
  false,
  'matches_intent without verified true withdraws active public eligibility'
);

SELECT extensions.ok(
  (
    SELECT
      job.result_payload @> '{"verified":false}'::jsonb
      AND integration.status = 'failed'
      AND domain.status = 'failed'
      AND advocate.publication_status = 'failed'
    FROM provisioning_claims claim
    JOIN public.domain_provisioning_jobs job ON job.id = claim.job_id
    JOIN public.advocate_domain_integrations integration
      ON integration.id = claim.integration_id
    JOIN public.advocate_domains domain ON domain.id = claim.domain_id
    JOIN public.advocates advocate ON advocate.id = domain.advocate_id
  ),
  'unverified match evidence is durable and the full public chain fails closed'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'failed',
  'unverified_match_terminal',
  '{}'::jsonb
)
FROM provisioning_claims claim;

SELECT extensions.is(
  pg_temp.repair_failed_provider_integration(
    (SELECT domain_id FROM provisioning_start_result),
    'stripe_us',
    'repair-after-unverified-match',
    'repair-after-unverified-match-worker'
  ),
  'verifying',
  'verified repair after an unverified match stops at verifying'
);

UPDATE public.advocates advocate
SET publication_status = 'provisioning'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'failed';

UPDATE public.advocate_domains domain
SET status = 'active'
FROM provisioning_start_result result
WHERE domain.id = result.domain_id
  AND domain.status = 'verifying';

UPDATE public.advocates advocate
SET publication_status = 'active'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'provisioning';

SELECT public.enqueue_domain_provisioning_job_system(
  integration.domain_id,
  integration.id,
  'reconcile',
  clock_timestamp(),
  'active-inconclusive-enqueue'
)
FROM public.advocate_domain_integrations integration
JOIN provisioning_start_result result ON result.domain_id = integration.domain_id
WHERE integration.provider = 'stripe_uk';

TRUNCATE provisioning_claims;
INSERT INTO provisioning_claims (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'active-inconclusive-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT extensions.is(
  (
    SELECT public.record_domain_provisioning_reconciliation(
      claim.job_id,
      claim.lease_token,
      'inconclusive',
      jsonb_build_object(
        'provider_status', 'unknown',
        'http_status', 503,
        'verified', false
      )
    )
    FROM provisioning_claims claim
  ),
  false,
  'an inconclusive active provider lookup fails public eligibility closed'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'failed',
  'inconclusive_terminal',
  '{}'::jsonb
)
FROM provisioning_claims claim;

SELECT extensions.is(
  pg_temp.repair_failed_provider_integration(
    (SELECT domain_id FROM provisioning_start_result),
    'stripe_uk',
    'repair-after-inconclusive',
    'repair-after-inconclusive-worker'
  ),
  'verifying',
  'verified repair after an inconclusive lookup stops at verifying'
);

UPDATE public.advocates advocate
SET publication_status = 'provisioning'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'failed';

UPDATE public.advocate_domains domain
SET status = 'active'
FROM provisioning_start_result result
WHERE domain.id = result.domain_id
  AND domain.status = 'verifying';

UPDATE public.advocates advocate
SET publication_status = 'active'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'provisioning';

SELECT public.enqueue_domain_provisioning_job_system(
  integration.domain_id,
  integration.id,
  'reconcile',
  clock_timestamp(),
  'active-definitive-drift-enqueue'
)
FROM public.advocate_domain_integrations integration
JOIN provisioning_start_result result ON result.domain_id = integration.domain_id
WHERE integration.provider = 'paypal';

TRUNCATE provisioning_claims;
INSERT INTO provisioning_claims (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'active-definitive-drift-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT extensions.is(
  (
    SELECT public.record_domain_provisioning_reconciliation(
      claim.job_id,
      claim.lease_token,
      'needs_apply',
      jsonb_build_object(
        'provider_status', 'drifted',
        'http_status', 200,
        'verified', false
      )
    )
    FROM provisioning_claims claim
  ),
  false,
  'definitive active provider drift withdraws eligibility before provider repair'
);

SELECT public.complete_domain_provisioning_job(
  claim.job_id,
  claim.lease_token,
  'failed',
  'definitive_drift_terminal',
  '{}'::jsonb
)
FROM provisioning_claims claim;

SELECT extensions.is(
  pg_temp.repair_failed_provider_integration(
    (SELECT domain_id FROM provisioning_start_result),
    'paypal',
    'repair-after-definitive-drift',
    'repair-after-definitive-drift-worker'
  ),
  'verifying',
  'verified repair after definitive drift stops at verifying'
);

TRUNCATE provisioning_replay_result;
SET LOCAL ROLE authenticated;
INSERT INTO provisioning_replay_result
SELECT *
FROM public.start_advocate_portal_provisioning(
  (SELECT advocate_id FROM provisioning_start_result),
  1,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'atomic-start-trace-001'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT replay.job_ids = original.job_ids
    FROM provisioning_replay_result replay
    CROSS JOIN provisioning_start_result original
  ),
  'exact start replay remains stable after later reconciliation history'
);

UPDATE public.advocates advocate
SET publication_status = 'provisioning'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'failed';

UPDATE public.advocate_domains domain
SET status = 'active'
FROM provisioning_start_result result
WHERE domain.id = result.domain_id
  AND domain.status = 'verifying';

UPDATE public.advocates advocate
SET publication_status = 'active'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'provisioning';

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
    integration.advocate_id,
    integration.domain_id,
    integration.id,
    'reconcile',
    integration.provider,
    1,
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  FROM public.advocate_domain_integrations integration
  JOIN provisioning_start_result result
    ON result.domain_id = integration.domain_id
  WHERE integration.provider = 'cloudflare'
  RETURNING id
)
INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'exhausted_retry_job', id FROM inserted;

TRUNCATE provisioning_claims;
INSERT INTO provisioning_claims (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'exhausted-retry-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT extensions.is(
  (
    SELECT public.retry_domain_provisioning_job(
      claim.job_id,
      claim.lease_token,
      interval '1 second',
      'retry_attempts_exhausted',
      '{}'::jsonb
    )::text
    FROM provisioning_claims claim
  ),
  'failed',
  'a retry at max attempts settles as terminal failure'
);

SELECT extensions.ok(
  (
    SELECT
      job.status = 'failed'
      AND job.last_error = 'retry_attempts_exhausted'
      AND integration.status = 'failed'
      AND domain.status = 'failed'
      AND advocate.publication_status = 'failed'
    FROM provisioning_claims claim
    JOIN public.domain_provisioning_jobs job ON job.id = claim.job_id
    JOIN public.advocate_domain_integrations integration
      ON integration.id = claim.integration_id
    JOIN public.advocate_domains domain ON domain.id = claim.domain_id
    JOIN public.advocates advocate ON advocate.id = domain.advocate_id
  ),
  'exhausted retry atomically fails job, integration, domain, and publication'
);

SELECT extensions.is(
  pg_temp.repair_failed_cloudflare_integration(
    (SELECT domain_id FROM provisioning_start_result),
    'repair-after-exhausted-retry',
    'repair-after-exhausted-retry-worker'
  ),
  'verifying',
  'verified repair after exhausted retry still stops at verifying'
);

UPDATE public.advocates advocate
SET publication_status = 'provisioning'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'failed';

UPDATE public.advocate_domains domain
SET status = 'active'
FROM provisioning_start_result result
WHERE domain.id = result.domain_id
  AND domain.status = 'verifying';

UPDATE public.advocates advocate
SET publication_status = 'active'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'provisioning';

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
    integration.advocate_id,
    integration.domain_id,
    integration.id,
    'reconcile',
    integration.provider,
    1,
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  FROM public.advocate_domain_integrations integration
  JOIN provisioning_start_result result
    ON result.domain_id = integration.domain_id
  WHERE integration.provider = 'cloudflare'
  RETURNING id
)
INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'expired_max_lease_job', id FROM inserted;

TRUNCATE provisioning_claims;
INSERT INTO provisioning_claims (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'expired-max-lease-worker',
  1,
  interval '5 seconds'
) claimed;

SELECT pg_sleep(5.1);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.claim_domain_provisioning_jobs(
      'expired-max-lease-recovery-worker',
      1,
      interval '10 minutes'
    )
  ),
  0,
  'the next claim pass settles an expired max-attempt lease before claiming work'
);

SELECT extensions.ok(
  (
    SELECT
      job.status = 'failed'
      AND job.last_error = 'lease_expired_max_attempts'
      AND integration.status = 'failed'
      AND domain.status = 'failed'
      AND advocate.publication_status = 'failed'
    FROM provisioning_test_context context
    JOIN public.domain_provisioning_jobs job
      ON job.id = context.uuid_value
     AND context.key = 'expired_max_lease_job'
    JOIN public.advocate_domain_integrations integration
      ON integration.id = job.integration_id
    JOIN public.advocate_domains domain ON domain.id = job.domain_id
    JOIN public.advocates advocate ON advocate.id = domain.advocate_id
  ),
  'expired max-attempt lease recovery fails the full active tenant chain closed'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN provisioning_test_context context
      ON event.record_pk ->> 'id' = context.uuid_value::text
     AND context.key = 'expired_max_lease_job'
    WHERE event.table_name = 'domain_provisioning_jobs'
      AND event.operation = 'UPDATE'
      AND event.system_actor = 'expired-max-lease-worker'
      AND event.reason =
        'Atomically settle an exhausted provider lease and domain lifecycle'
  ),
  'expired lease settlement preserves the original worker and forensic reason'
);

SELECT extensions.is(
  pg_temp.repair_failed_cloudflare_integration(
    (SELECT domain_id FROM provisioning_start_result),
    'repair-before-admin-suppression',
    'repair-before-admin-suppression-worker'
  ),
  'verifying',
  'the cancellation fixture first restores the failed integration only to verifying'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_domain_integrations integration
    SET reconciliation_suppression_reason = 'incomplete suppression'
    WHERE integration.domain_id = (
      SELECT domain_id FROM provisioning_start_result
    )
      AND integration.provider = 'cloudflare'
  $$,
  '23514',
  NULL,
  'reconciliation suppression actor, time, and reason are all required together'
);

WITH enqueued AS (
  SELECT public.enqueue_domain_provisioning_job_system(
    integration.domain_id,
    integration.id,
    'reconcile',
    clock_timestamp(),
    'queued-admin-cancel-fixture'
  ) AS id
  FROM public.advocate_domain_integrations integration
  JOIN provisioning_start_result result ON result.domain_id = integration.domain_id
  WHERE integration.provider = 'cloudflare'
)
INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'admin_cancel_job', id FROM enqueued;

SET LOCAL ROLE authenticated;
SELECT extensions.is(
  public.cancel_queued_domain_provisioning_job(
    (
      SELECT uuid_value
      FROM provisioning_test_context
      WHERE key = 'admin_cancel_job'
    ),
    'Pause automated repair while provider ownership is investigated',
    'admin-domain-cancel-request'
  ),
  true,
  'an authenticated super administrator can cancel unleased provider work'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      job.status = 'cancelled'
      AND job.last_error = 'administrator_cancelled'
      AND integration.reconciliation_suppressed_at IS NOT NULL
      AND integration.reconciliation_suppressed_by_user_id =
        'a9000000-0000-4000-8000-000000000001'::uuid
      AND integration.reconciliation_suppression_reason =
        'Pause automated repair while provider ownership is investigated'
      AND integration.status = 'failed'
      AND domain.status = 'failed'
    FROM provisioning_test_context context
    JOIN public.domain_provisioning_jobs job
      ON job.id = context.uuid_value
     AND context.key = 'admin_cancel_job'
    JOIN public.advocate_domain_integrations integration
      ON integration.id = job.integration_id
    JOIN public.advocate_domains domain ON domain.id = job.domain_id
  ),
  'queued cancellation durably suppresses the integration and fails its domain chain closed'
);

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok(
  $$
    SELECT public.enqueue_domain_provisioning_job_system(
      integration.domain_id,
      integration.id,
      'reconcile',
      clock_timestamp(),
      'suppressed-system-enqueue'
    )
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = (
      SELECT domain_id FROM provisioning_start_result
    )
      AND integration.provider = 'cloudflare'
  $$,
  '55000',
  'Domain integration work is administratively suppressed',
  'trusted-system enqueue cannot bypass an administrator suppression'
);
RESET ROLE;

UPDATE public.advocate_domain_integrations integration
SET last_checked_at = clock_timestamp() - interval '1 hour'
WHERE integration.domain_id = (
  SELECT domain_id FROM provisioning_start_result
)
  AND integration.provider = 'cloudflare';

TRUNCATE provisioning_reconciliation_result;
SET LOCAL ROLE service_role;
INSERT INTO provisioning_reconciliation_result
SELECT *
FROM public.enqueue_due_advocate_domain_reconciliations(
  100,
  'suppressed-scheduler-pass'
);
RESET ROLE;

SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM provisioning_reconciliation_result)
  AND NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    JOIN public.advocate_domain_integrations integration
      ON integration.id = job.integration_id
    WHERE integration.domain_id = (
      SELECT domain_id FROM provisioning_start_result
    )
      AND integration.provider = 'cloudflare'
      AND job.status IN ('queued', 'running')
  ),
  'the scheduler does not recreate durably suppressed work'
);

INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'admin_resume_integration', integration.id
FROM public.advocate_domain_integrations integration
WHERE integration.domain_id = (
  SELECT domain_id FROM provisioning_start_result
)
  AND integration.provider = 'cloudflare';

SET LOCAL ROLE authenticated;
WITH resumed AS (
  SELECT public.enqueue_domain_provisioning_job(
    (SELECT domain_id FROM provisioning_start_result),
    (
      SELECT uuid_value
      FROM provisioning_test_context
      WHERE key = 'admin_resume_integration'
    ),
    'reconcile',
    'Resume provider reconciliation after ownership was verified',
    clock_timestamp(),
    'admin-domain-resume-request'
  ) AS id
)
INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'admin_resume_job', id FROM resumed;
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      integration.reconciliation_suppressed_at IS NULL
      AND integration.reconciliation_suppressed_by_user_id IS NULL
      AND integration.reconciliation_suppression_reason IS NULL
      AND job.status = 'queued'
    FROM provisioning_test_context context
    JOIN public.domain_provisioning_jobs job
      ON job.id = context.uuid_value
     AND context.key = 'admin_resume_job'
    JOIN public.advocate_domain_integrations integration
      ON integration.id = job.integration_id
  ),
  'explicit administrator enqueue atomically clears suppression and creates one job'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.audit_events event
    JOIN public.advocate_domain_integrations integration
      ON event.record_pk ->> 'id' = integration.id::text
    WHERE integration.domain_id = (
      SELECT domain_id FROM provisioning_start_result
    )
      AND integration.provider = 'cloudflare'
      AND event.table_name = 'advocate_domain_integrations'
      AND event.operation = 'UPDATE'
      AND event.actor_type = 'creator_share_admin'
      AND event.actor_user_id =
        'a9000000-0000-4000-8000-000000000001'::uuid
      AND event.tool = 'creator-share-admin-domains'
      AND event.request_id = 'admin-domain-resume-request'
      AND event.reason =
        'Resume provider reconciliation after ownership was verified'
      AND event.changed_columns @> ARRAY[
        'reconciliation_suppressed_at',
        'reconciliation_suppressed_by_user_id',
        'reconciliation_suppression_reason'
      ]::text[]
  ),
  'explicit resume retains administrator, tool, request, reason, and changed suppression fields'
);

TRUNCATE provisioning_claims;
INSERT INTO provisioning_claims (
  job_id,
  domain_id,
  integration_id,
  provider,
  lease_token
)
SELECT
  claimed.job_id,
  claimed.domain_id,
  claimed.integration_id,
  claimed.provider,
  claimed.lease_token
FROM public.claim_domain_provisioning_jobs(
  'admin-resume-worker',
  1,
  interval '10 minutes'
) claimed;

SELECT public.record_domain_provisioning_reconciliation(
  claim.job_id,
  claim.lease_token,
  'matches_intent',
  jsonb_build_object(
    'provider_status', 'dns_only_cname_ready',
    'provider_resource_id', repeat('a', 32),
    'dns_record_id', repeat('a', 32),
    'http_status', 200,
    'verified', true
  )
)
FROM provisioning_claims claim;

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
FROM provisioning_claims claim;

SELECT extensions.is(
  (
    SELECT domain.status::text
    FROM public.advocate_domains domain
    JOIN provisioning_start_result result ON result.domain_id = domain.id
  ),
  'verifying',
  'resumed verified repair still requires an explicit publication approval'
);

UPDATE public.advocates advocate
SET publication_status = 'provisioning'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'failed';

UPDATE public.advocate_domains domain
SET status = 'active'
FROM provisioning_start_result result
WHERE domain.id = result.domain_id
  AND domain.status = 'verifying';

UPDATE public.advocates advocate
SET publication_status = 'active'
FROM provisioning_start_result result
WHERE advocate.id = result.advocate_id
  AND advocate.publication_status = 'provisioning';

INSERT INTO public.advocate_domain_integrations (
  advocate_id,
  domain_id,
  provider,
  environment,
  is_required
)
SELECT
  result.advocate_id,
  result.domain_id,
  'stripe_us',
  'test',
  false
FROM provisioning_start_result result;

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.start_advocate_portal_provisioning(
      (SELECT advocate_id FROM provisioning_start_result),
      1,
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'atomic-start-trace-001'
    )
  $$,
  '40001',
  'Advocate provisioning replay does not match the committed request',
  'strict replay rejects an extra provider integration even with the same request'
);
RESET ROLE;

WITH inserted AS (
  INSERT INTO public.advocates (
    slug,
    display_name,
    relationship_status,
    publication_status
  )
  VALUES (
    'partialquarantine',
    'Partial Quarantine',
    'active',
    'draft'
  )
  RETURNING id
)
INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'partial_quarantine_advocate', id FROM inserted;

INSERT INTO public.advocate_branding (advocate_id)
SELECT uuid_value
FROM provisioning_test_context
WHERE key = 'partial_quarantine_advocate';

TRUNCATE provisioning_replay_result;
SET LOCAL ROLE authenticated;
INSERT INTO provisioning_replay_result
SELECT *
FROM public.start_advocate_portal_provisioning(
  (
    SELECT uuid_value
    FROM provisioning_test_context
    WHERE key = 'partial_quarantine_advocate'
  ),
  1,
  'a1000000-0000-4000-8000-000000000020'::uuid,
  'partial-quarantine-start-trace'
);
RESET ROLE;

INSERT INTO provisioning_test_context (key, uuid_value)
SELECT 'partial_quarantine_domain', domain_id
FROM provisioning_replay_result;

SELECT extensions.is(
  pg_temp.settle_initial_provisioning_jobs(
    'partial-quarantine-provisioning-worker'
  ),
  5,
  'the partial-topology quarantine fixture first proves all five providers'
);

UPDATE public.advocate_domains domain
SET status = 'active'
WHERE domain.id = (
  SELECT uuid_value
  FROM provisioning_test_context
  WHERE key = 'partial_quarantine_domain'
);

UPDATE public.advocates advocate
SET publication_status = 'active'
WHERE advocate.id = (
  SELECT uuid_value
  FROM provisioning_test_context
  WHERE key = 'partial_quarantine_advocate'
);

SET LOCAL session_replication_role = replica;
UPDATE public.advocate_domain_integrations integration
SET is_required = false
WHERE integration.domain_id = (
  SELECT uuid_value
  FROM provisioning_test_context
  WHERE key = 'partial_quarantine_domain'
)
  AND integration.provider = 'paypal';
SET LOCAL session_replication_role = origin;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = (
      SELECT uuid_value
      FROM provisioning_test_context
      WHERE key = 'partial_quarantine_domain'
    )
      AND integration.is_required
  ),
  4,
  'the partial topology fixture is missing one logical required provider row'
);

TRUNCATE provisioning_reconciliation_result;
SET LOCAL ROLE service_role;
INSERT INTO provisioning_reconciliation_result
SELECT *
FROM public.enqueue_due_advocate_domain_reconciliations(
  1,
  'invalid-topology-bounded-001'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      count(*) = 1
      AND bool_and(result.enqueued_job_count = 0)
      AND bool_and(result.quarantined)
    FROM provisioning_reconciliation_result result
  )
  AND (
    SELECT count(*) = 1
    FROM public.advocate_domains domain
    WHERE domain.id IN (
      (SELECT domain_id FROM provisioning_start_result),
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'partial_quarantine_domain'
      )
    )
      AND domain.status = 'active'
  ),
  'a batch of one quarantines exactly one invalid active domain and returns no provider work'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.domain_id IN (
      (SELECT domain_id FROM provisioning_start_result),
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'partial_quarantine_domain'
      )
    )
      AND job.status IN ('queued', 'running')
  ),
  'invalid topology quarantine creates no provider mutation job'
);

TRUNCATE provisioning_reconciliation_result;
SET LOCAL ROLE service_role;
INSERT INTO provisioning_reconciliation_result
SELECT *
FROM public.enqueue_due_advocate_domain_reconciliations(
  1,
  'invalid-topology-bounded-002'
);
RESET ROLE;

SELECT extensions.ok(
  (
    SELECT
      count(*) = 1
      AND bool_and(result.enqueued_job_count = 0)
      AND bool_and(result.quarantined)
    FROM provisioning_reconciliation_result result
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.id IN (
      (SELECT domain_id FROM provisioning_start_result),
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'partial_quarantine_domain'
      )
    )
      AND domain.status = 'active'
  ),
  'the next bounded pass independently quarantines the remaining invalid domain'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 2
    FROM public.advocate_domains domain
    JOIN public.advocates advocate ON advocate.id = domain.advocate_id
    WHERE domain.id IN (
      (SELECT domain_id FROM provisioning_start_result),
      (
        SELECT uuid_value
        FROM provisioning_test_context
        WHERE key = 'partial_quarantine_domain'
      )
    )
      AND domain.status = 'failed'
      AND domain.failure_code = 'invalid_required_provider_topology'
      AND advocate.publication_status = 'failed'
  ),
  'extra and partial active topology both fail the domain and advocate closed'
);

SELECT extensions.ok(
  (
    SELECT count(*) >= 2
    FROM audit.audit_events event
    WHERE event.table_name = 'advocate_domains'
      AND event.operation = 'UPDATE'
      AND event.system_actor = 'advocate-domain-reconciler'
      AND event.tool = 'advocate-domain-topology-quarantine'
      AND event.reason =
        'Quarantine active advocate domain with invalid required provider topology'
      AND event.metadata ->> 'manual_review_code' =
        'invalid_required_provider_topology'
      AND event.metadata ->> 'outcome' = 'failed_closed'
  ),
  'each invalid topology quarantine emits a correlated auditable alert'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.request_id = 'a1000000-0000-4000-8000-000000000001'
      AND source.trace_id = 'atomic-start-trace-001'
      AND disclosed.event_key = 'domain.provisioning.requested'
      AND disclosed.areas = ARRAY[
        'dns',
        'payment_readiness',
        'provider_readiness',
        'tls'
      ]::text[]
      AND disclosed.actor_kind = 'creator_share_staff'
      AND disclosed.actor_display_name = 'Creator Share staff'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  ),
  'the real provisioning start command emits the exact privacy-safe requested event'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.tool = 'domain-provisioning-reconcile'
      AND source.metadata ->> 'outcome' = 'public_eligibility_withdrawn'
      AND disclosed.event_key = 'domain.publication.needs_attention'
      AND disclosed.areas = ARRAY[
        'dns',
        'payment_readiness',
        'provider_readiness',
        'publication',
        'tls'
      ]::text[]
      AND disclosed.actor_kind = 'automation'
      AND disclosed.actor_display_name = 'Creator Share automation'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  ),
  'the real active-drift worker emits the exact privacy-safe attention event'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM audit.advocate_delegate_events disclosed
    JOIN audit.audit_events source
      ON source.sequence_id = disclosed.source_audit_sequence
    WHERE source.tool = 'advocate-domain-topology-quarantine'
      AND source.table_name = 'advocates'
      AND source.metadata ->> 'manual_review_code' =
        'invalid_required_provider_topology'
      AND disclosed.event_key = 'domain.publication.needs_attention'
      AND disclosed.areas = ARRAY[
        'dns',
        'payment_readiness',
        'provider_readiness',
        'publication',
        'tls'
      ]::text[]
      AND disclosed.actor_kind = 'automation'
      AND disclosed.actor_display_name = 'Creator Share automation'
      AND NOT (to_jsonb(disclosed) ?| ARRAY[
        'reason',
        'metadata',
        'before_data',
        'after_data',
        'changed_columns',
        'actor_user_id',
        'effective_user_id',
        'system_actor',
        'client_ip',
        'user_agent'
      ]::text[])
  ),
  'the real topology quarantine worker emits the exact privacy-safe attention event'
);

SELECT * FROM extensions.finish();

ROLLBACK;
