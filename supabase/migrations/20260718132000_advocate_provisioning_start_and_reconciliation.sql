BEGIN;

-- Runtime provisioning begins at one narrow transaction boundary. The caller
-- supplies only the existing advocate identity, its optimistic version, and
-- correlation identifiers. Hostname, provider topology, and provider work are
-- all derived and committed together by the database.
CREATE TABLE audit.advocate_portal_provisioning_starts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  trace_id text NOT NULL,
  initiating_user_id uuid NOT NULL,
  advocate_id uuid NOT NULL UNIQUE,
  expected_advocate_version bigint NOT NULL,
  resulting_advocate_version bigint NOT NULL,
  domain_id uuid NOT NULL UNIQUE,
  hostname text NOT NULL UNIQUE,
  provider_topology_digest bytea NOT NULL,
  job_ids uuid[] NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT advocate_portal_provisioning_starts_trace_id_check CHECK (
    trace_id = btrim(trace_id)
    AND char_length(trace_id) BETWEEN 1 AND 255
  ),
  CONSTRAINT advocate_portal_provisioning_starts_version_check CHECK (
    expected_advocate_version > 0
    AND resulting_advocate_version = expected_advocate_version + 1
  ),
  CONSTRAINT advocate_portal_provisioning_starts_hostname_check CHECK (
    hostname = lower(hostname)
    AND hostname ~
      '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.creatorshare\.com$'
  ),
  CONSTRAINT advocate_portal_provisioning_starts_topology_digest_check CHECK (
    octet_length(provider_topology_digest) = 32
  ),
  CONSTRAINT advocate_portal_provisioning_starts_job_ids_check CHECK (
    cardinality(job_ids) = 5
    AND array_position(job_ids, NULL) IS NULL
  )
);

COMMENT ON TABLE audit.advocate_portal_provisioning_starts IS
  'Append-only idempotency and correlation evidence for the atomic creation of one exact Creator Share hostname, five required production integrations, and their initial provider jobs.';
COMMENT ON COLUMN audit.advocate_portal_provisioning_starts.job_ids IS
  'Initial provision jobs ordered as Cloudflare, Vercel, Stripe US, Stripe UK, and PayPal.';
COMMENT ON COLUMN audit.advocate_portal_provisioning_starts.initiating_user_id IS
  'Authenticated Creator Share super administrator whose verified account initiated the immutable provisioning request. The UUID is retained as historical evidence even if the account is later removed.';

ALTER TABLE public.advocate_domain_integrations
  ADD COLUMN reconciliation_suppressed_at timestamp with time zone,
  ADD COLUMN reconciliation_suppressed_by_user_id uuid,
  ADD COLUMN reconciliation_suppression_reason text;

ALTER TABLE public.advocate_domain_integrations
  ADD CONSTRAINT advocate_domain_integrations_reconciliation_suppression_check
  CHECK (
    (
      reconciliation_suppressed_at IS NULL
      AND reconciliation_suppressed_by_user_id IS NULL
      AND reconciliation_suppression_reason IS NULL
    )
    OR (
      reconciliation_suppressed_at IS NOT NULL
      AND reconciliation_suppressed_by_user_id IS NOT NULL
      AND reconciliation_suppression_reason =
        btrim(reconciliation_suppression_reason)
      AND char_length(reconciliation_suppression_reason) BETWEEN 1 AND 2000
    )
  );

COMMENT ON COLUMN public.advocate_domain_integrations.reconciliation_suppressed_at IS
  'Durable administrator stop for automated and trusted-system provisioning work. Only an explicit authenticated super administrator enqueue clears it.';
COMMENT ON COLUMN public.advocate_domain_integrations.reconciliation_suppressed_by_user_id IS
  'Historical authenticated administrator UUID that imposed the durable stop. It intentionally remains durable if the auth account is later removed.';
COMMENT ON COLUMN public.advocate_domain_integrations.reconciliation_suppression_reason IS
  'Required administrator explanation for the durable stop.';

ALTER TABLE audit.advocate_portal_provisioning_starts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit.advocate_portal_provisioning_starts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prevent_advocate_provisioning_start_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Advocate provisioning start evidence is append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_advocate_provisioning_start_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_portal_provisioning_starts_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.advocate_portal_provisioning_starts
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_provisioning_start_mutation();

CREATE TRIGGER advocate_portal_provisioning_starts_no_truncate
BEFORE TRUNCATE ON audit.advocate_portal_provisioning_starts
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_provisioning_start_mutation();

CREATE OR REPLACE FUNCTION private.advocate_required_provider_topology_digest()
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_array(
        jsonb_build_object(
          'ordinal', 1,
          'provider', 'cloudflare',
          'environment', 'production',
          'required', true
        ),
        jsonb_build_object(
          'ordinal', 2,
          'provider', 'vercel',
          'environment', 'production',
          'required', true
        ),
        jsonb_build_object(
          'ordinal', 3,
          'provider', 'stripe_us',
          'environment', 'live',
          'required', true
        ),
        jsonb_build_object(
          'ordinal', 4,
          'provider', 'stripe_uk',
          'environment', 'live',
          'required', true
        ),
        jsonb_build_object(
          'ordinal', 5,
          'provider', 'paypal',
          'environment', 'live',
          'required', true
        )
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

REVOKE ALL ON FUNCTION private.advocate_required_provider_topology_digest()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.advocate_provisioning_replay_is_exact(
  target_advocate_id uuid,
  target_domain_id uuid,
  target_hostname text,
  target_resulting_advocate_version bigint,
  target_job_ids uuid[],
  target_provider_topology_digest bytea
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    target_provider_topology_digest =
      private.advocate_required_provider_topology_digest()
    AND cardinality(target_job_ids) = 5
    AND array_position(target_job_ids, NULL) IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.advocates advocate
      WHERE advocate.id = target_advocate_id
        AND advocate.slug || '.creatorshare.com' = target_hostname
        AND advocate.version >= target_resulting_advocate_version
    )
    AND (
      SELECT count(*)
      FROM public.advocate_domains domain
      WHERE domain.advocate_id = target_advocate_id
    ) = 1
    AND EXISTS (
      SELECT 1
      FROM public.advocate_domains domain
      WHERE domain.id = target_domain_id
        AND domain.advocate_id = target_advocate_id
        AND domain.hostname = target_hostname
        AND domain.is_primary
    )
    AND (
      SELECT count(*)
      FROM public.advocate_domain_integrations integration
      WHERE integration.advocate_id = target_advocate_id
        AND integration.domain_id = target_domain_id
    ) = 5
    AND NOT EXISTS (
      SELECT 1
      FROM public.advocate_domain_integrations integration
      WHERE integration.advocate_id = target_advocate_id
        AND integration.domain_id = target_domain_id
        AND NOT (
          integration.is_required
          AND (
            (integration.provider = 'cloudflare' AND integration.environment = 'production')
            OR (integration.provider = 'vercel' AND integration.environment = 'production')
            OR (integration.provider = 'stripe_us' AND integration.environment = 'live')
            OR (integration.provider = 'stripe_uk' AND integration.environment = 'live')
            OR (integration.provider = 'paypal' AND integration.environment = 'live')
          )
        )
    )
    AND (
      SELECT count(*)
      FROM public.domain_provisioning_jobs job
      JOIN public.advocate_domain_integrations integration
        ON integration.id = job.integration_id
       AND integration.advocate_id = job.advocate_id
       AND integration.domain_id = job.domain_id
       AND integration.provider = job.provider
      WHERE job.id = ANY(target_job_ids)
        AND job.advocate_id = target_advocate_id
        AND job.domain_id = target_domain_id
        AND job.kind = 'provision'
        AND (
          (job.id = target_job_ids[1]
            AND job.provider = 'cloudflare'
            AND integration.environment = 'production')
          OR (job.id = target_job_ids[2]
            AND job.provider = 'vercel'
            AND integration.environment = 'production')
          OR (job.id = target_job_ids[3]
            AND job.provider = 'stripe_us'
            AND integration.environment = 'live')
          OR (job.id = target_job_ids[4]
            AND job.provider = 'stripe_uk'
            AND integration.environment = 'live')
          OR (job.id = target_job_ids[5]
            AND job.provider = 'paypal'
            AND integration.environment = 'live')
        )
    ) = 5;
$$;

REVOKE ALL ON FUNCTION private.advocate_provisioning_replay_is_exact(
  uuid,
  uuid,
  text,
  bigint,
  uuid[],
  bytea
) FROM PUBLIC, anon, authenticated, service_role;

-- A required provider regression must remove an active tenant from public
-- resolution in the same transaction that settles the provider job. The
-- domain moves first so the integration lifecycle trigger never observes an
-- active domain with a failed required integration. Publication history is
-- then marked failed, while a later verified repair remains free to advance
-- the domain only through provisioning to the nonpublic verifying state.
CREATE OR REPLACE FUNCTION private.apply_domain_job_failure(
  target_job_id uuid,
  target_failure_code text,
  failed_at timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_integration public.advocate_domain_integrations%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
BEGIN
  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id;

  SELECT integration.*
  INTO v_integration
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = v_job.integration_id
    AND integration.advocate_id = v_job.advocate_id
    AND integration.domain_id = v_job.domain_id;

  SELECT domain.*
  INTO v_domain
  FROM public.advocate_domains domain
  WHERE domain.id = v_job.domain_id
    AND domain.advocate_id = v_job.advocate_id;

  IF v_job.kind IN ('provision', 'reconcile')
     AND v_integration.is_required
     AND v_domain.status NOT IN ('redirecting', 'disabled') THEN
    IF v_domain.status IN ('pending', 'failed') THEN
      UPDATE public.advocate_domains domain
      SET status = 'provisioning'
      WHERE domain.id = v_domain.id;
    END IF;

    UPDATE public.advocate_domains domain
    SET
      status = 'failed',
      failure_code = target_failure_code,
      failure_detail = NULL
    WHERE domain.id = v_domain.id;

  END IF;

  IF v_job.kind = 'deprovision' AND v_integration.status = 'disabled' THEN
    RETURN;
  END IF;

  IF v_integration.status IN ('pending', 'failed', 'disabled') THEN
    UPDATE public.advocate_domain_integrations integration
    SET status = 'provisioning'
    WHERE integration.id = v_integration.id;
  END IF;

  UPDATE public.advocate_domain_integrations integration
  SET
    status = 'failed',
    last_checked_at = failed_at,
    last_error = target_failure_code
  WHERE integration.id = v_integration.id;

  IF v_job.kind IN ('provision', 'reconcile')
     AND v_integration.is_required
     AND v_domain.status NOT IN ('redirecting', 'disabled') THEN
    UPDATE public.advocates advocate
    SET publication_status = 'failed'
    WHERE advocate.id = v_job.advocate_id
      AND advocate.publication_status IN ('provisioning', 'active');
  END IF;
END;
$$;

COMMENT ON FUNCTION private.apply_domain_job_failure(
  uuid,
  text,
  timestamp with time zone
) IS
  'Atomically settles required provider failure by failing the domain before its integration and marking active or provisioning publication failed. Verified repair can return the domain only to verifying.';

REVOKE ALL ON FUNCTION private.apply_domain_job_failure(
  uuid,
  text,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

-- Every automatic and trusted-system enqueue passes through this boundary.
-- A durable administrator stop is therefore enforced once, below every
-- scheduler and service wrapper. The explicit administrator wrapper clears
-- the stop under its own authenticated audit context before calling here.
CREATE OR REPLACE FUNCTION private.enqueue_domain_provisioning_job_internal(
  target_domain_id uuid,
  target_integration_id uuid,
  job_kind public.domain_provisioning_job_kind,
  requested_run_at timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate_id uuid;
  v_provider public.advocate_domain_integration_provider;
  v_domain_status public.advocate_domain_status;
  v_integration_status public.advocate_domain_integration_status;
  v_relationship_status public.advocate_relationship_status;
  v_publication_status public.advocate_publication_status;
  v_reconciliation_suppressed_at timestamp with time zone;
  v_existing_job_id uuid;
  v_existing_kind public.domain_provisioning_job_kind;
  v_job_id uuid;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF target_domain_id IS NULL
     OR target_integration_id IS NULL
     OR job_kind IS NULL
     OR requested_run_at IS NULL
     OR requested_run_at < v_now - interval '5 seconds'
     OR requested_run_at > v_now + interval '30 days' THEN
    RAISE EXCEPTION 'Domain provisioning enqueue input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    integration.advocate_id,
    integration.provider,
    integration.status,
    integration.reconciliation_suppressed_at
  INTO
    v_advocate_id,
    v_provider,
    v_integration_status,
    v_reconciliation_suppressed_at
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = target_integration_id
    AND integration.domain_id = target_domain_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_reconciliation_suppressed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Domain integration work is administratively suppressed'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    domain.status,
    advocate.relationship_status,
    advocate.publication_status
  INTO
    v_domain_status,
    v_relationship_status,
    v_publication_status
  FROM public.advocate_domains domain
  JOIN public.advocates advocate
    ON advocate.id = domain.advocate_id
  WHERE domain.id = target_domain_id
    AND domain.advocate_id = v_advocate_id
  FOR UPDATE OF domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF NOT private.domain_job_lifecycle_is_eligible(
    job_kind,
    v_domain_status,
    v_integration_status,
    v_relationship_status,
    v_publication_status
  ) THEN
    CASE job_kind
      WHEN 'provision' THEN
        RAISE EXCEPTION 'Domain integration is not eligible for provisioning'
          USING ERRCODE = '55000';
      WHEN 'reconcile' THEN
        RAISE EXCEPTION 'Domain integration is not eligible for reconciliation'
          USING ERRCODE = '55000';
      WHEN 'deprovision' THEN
        RAISE EXCEPTION 'Domain must be quiescing or disabled before deprovisioning'
          USING ERRCODE = '55000';
      ELSE
        RAISE EXCEPTION 'Unsupported domain provisioning job kind'
          USING ERRCODE = '22023';
    END CASE;
  END IF;

  IF job_kind = 'deprovision'
     AND v_provider = 'vercel'
     AND NOT private.cloudflare_dns_removal_is_verified(target_domain_id) THEN
    RAISE EXCEPTION 'Cloudflare DNS removal must be verified before Vercel release'
      USING ERRCODE = '55000';
  END IF;

  SELECT job.id, job.kind
  INTO v_existing_job_id, v_existing_kind
  FROM public.domain_provisioning_jobs job
  WHERE job.integration_id = target_integration_id
    AND job.status IN ('queued', 'running')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_kind = job_kind THEN
      RETURN v_existing_job_id;
    END IF;

    RAISE EXCEPTION 'A conflicting domain integration operation is already open'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.domain_provisioning_jobs (
    advocate_id,
    domain_id,
    integration_id,
    kind,
    provider,
    run_after,
    request_payload
  )
  VALUES (
    v_advocate_id,
    target_domain_id,
    target_integration_id,
    job_kind,
    v_provider,
    requested_run_at,
    jsonb_build_object(
      'schema_version', 1,
      'reconciliation_policy', 'lookup_before_mutation'
    )
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

COMMENT ON FUNCTION private.enqueue_domain_provisioning_job_internal(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone
) IS
  'Lowest trusted enqueue boundary. It preserves lifecycle and one-open-job fences and refuses every administratively suppressed integration.';

REVOKE ALL ON FUNCTION private.enqueue_domain_provisioning_job_internal(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.start_advocate_portal_provisioning(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  request_id uuid,
  trace_id text
)
RETURNS TABLE (
  advocate_id uuid,
  advocate_version bigint,
  domain_id uuid,
  hostname text,
  job_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_role_assignment_id uuid;
  v_advocate public.advocates%ROWTYPE;
  v_existing audit.advocate_portal_provisioning_starts%ROWTYPE;
  v_domain_id uuid := gen_random_uuid();
  v_hostname text;
  v_integration_id uuid;
  v_job_id uuid;
  v_job_ids uuid[] := ARRAY[]::uuid[];
  v_resulting_version bigint;
  v_topology_digest bytea :=
    private.advocate_required_provider_topology_digest();
  v_provider record;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  IF target_advocate_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1
     OR request_id IS NULL
     OR trace_id IS NULL
     OR trace_id <> btrim(trace_id)
     OR char_length(trace_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Advocate provisioning start input is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Use the same global role-assignment and account-health fence as final
  -- publication. This prevents an unhealthy or concurrently demoted account
  -- from creating provider topology through a security-definer function.
  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access changed during provisioning start'
      USING ERRCODE = '40001';
  END IF;

  SELECT assignment.id
  INTO v_role_assignment_id
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id
  WHERE assignment.user_id = v_actor_user_id
    AND assignment.organization_id IS NULL
    AND assignment.advocate_id IS NULL
    AND role.name = 'SUPER_ADMIN'
  FOR SHARE OF assignment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Creator Share super administrator access changed during provisioning start'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = v_actor_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (
      actor.banned_until IS NULL
      OR actor.banned_until <= now()
    )
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize every start or replay for one advocate without taking a broad
  -- global lock. A request UUID reused for another advocate still conflicts on
  -- the immutable evidence row and rolls back the complete transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_advocate_id::text, 932741)
  );

  SELECT start.*
  INTO v_existing
  FROM audit.advocate_portal_provisioning_starts start
  WHERE start.request_id = $3
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.advocate_id IS DISTINCT FROM target_advocate_id
       OR v_existing.initiating_user_id IS DISTINCT FROM v_actor_user_id
       OR v_existing.expected_advocate_version IS DISTINCT FROM
          expected_advocate_version
       OR NOT private.advocate_provisioning_replay_is_exact(
         v_existing.advocate_id,
         v_existing.domain_id,
         v_existing.hostname,
         v_existing.resulting_advocate_version,
         v_existing.job_ids,
         v_existing.provider_topology_digest
       ) THEN
      RAISE EXCEPTION 'Advocate provisioning replay does not match the committed request'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_existing.advocate_id,
      v_existing.resulting_advocate_version,
      v_existing.domain_id,
      v_existing.hostname,
      v_existing.job_ids;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM audit.advocate_portal_provisioning_starts start
    WHERE start.advocate_id = target_advocate_id
  ) THEN
    RAISE EXCEPTION 'Advocate provisioning already began with another request'
      USING ERRCODE = '40001';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate portal version changed before provisioning began'
      USING ERRCODE = '40001';
  END IF;

  IF v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN ('draft', 'failed') THEN
    RAISE EXCEPTION 'Advocate portal is not eligible to begin provisioning'
      USING ERRCODE = '55000';
  END IF;

  v_hostname := v_advocate.slug || '.creatorshare.com';

  IF EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = v_advocate.slug
  ) THEN
    RAISE EXCEPTION 'Advocate portal uses a reserved subdomain label'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
       OR domain.hostname = v_hostname
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = v_advocate.id
  ) OR EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = v_advocate.id
  ) THEN
    RAISE EXCEPTION 'Advocate provisioning requires an empty domain topology'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-domains',
    context_request_id => $3::text,
    context_trace_id => $4,
    context_reason => 'Atomically begin exact advocate portal provisioning',
    context_metadata => jsonb_build_object(
      'operation', 'start_provisioning',
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'domain_hostname', v_hostname,
      'correlation_id', $4,
      'outcome', 'queued'
    )
  );

  INSERT INTO public.advocate_domains (
    id,
    advocate_id,
    hostname,
    is_primary
  )
  VALUES (
    v_domain_id,
    v_advocate.id,
    v_hostname,
    true
  );

  FOR v_provider IN
    SELECT expected.provider, expected.environment
    FROM (
      VALUES
        (1, 'cloudflare'::public.advocate_domain_integration_provider, 'production'::text),
        (2, 'vercel'::public.advocate_domain_integration_provider, 'production'::text),
        (3, 'stripe_us'::public.advocate_domain_integration_provider, 'live'::text),
        (4, 'stripe_uk'::public.advocate_domain_integration_provider, 'live'::text),
        (5, 'paypal'::public.advocate_domain_integration_provider, 'live'::text)
    ) AS expected(ordinal, provider, environment)
    ORDER BY expected.ordinal
  LOOP
    INSERT INTO public.advocate_domain_integrations (
      advocate_id,
      domain_id,
      provider,
      environment,
      is_required
    )
    VALUES (
      v_advocate.id,
      v_domain_id,
      v_provider.provider,
      v_provider.environment,
      true
    )
    RETURNING id INTO v_integration_id;

    v_job_id := private.enqueue_domain_provisioning_job_internal(
      v_domain_id,
      v_integration_id,
      'provision',
      clock_timestamp()
    );
    v_job_ids := array_append(v_job_ids, v_job_id);
  END LOOP;

  UPDATE public.advocate_domains domain
  SET status = 'provisioning'
  WHERE domain.id = v_domain_id
    AND domain.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate primary domain changed while provisioning began'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.advocates advocate
  SET publication_status = 'provisioning'
  WHERE advocate.id = v_advocate.id
    AND advocate.version = $2
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status IN ('draft', 'failed')
  RETURNING advocate.version INTO v_resulting_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal changed while provisioning began'
      USING ERRCODE = '40001';
  END IF;

  IF cardinality(v_job_ids) <> 5 THEN
    RAISE EXCEPTION 'Advocate provider topology did not produce five initial jobs'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO audit.advocate_portal_provisioning_starts (
    request_id,
    trace_id,
    initiating_user_id,
    advocate_id,
    expected_advocate_version,
    resulting_advocate_version,
    domain_id,
    hostname,
    provider_topology_digest,
    job_ids
  )
  VALUES (
    $3,
    $4,
    v_actor_user_id,
    v_advocate.id,
    $2,
    v_resulting_version,
    v_domain_id,
    v_hostname,
    v_topology_digest,
    v_job_ids
  );

  RETURN QUERY SELECT
    v_advocate.id,
    v_resulting_version,
    v_domain_id,
    v_hostname,
    v_job_ids;
END;
$$;

COMMENT ON FUNCTION public.start_advocate_portal_provisioning(
  uuid,
  bigint,
  uuid,
  text
) IS
  'Authenticated Creator Share super-administrator optimistic and idempotent transaction that derives the immutable Creator Share hostname, creates exactly five required live production integrations and their initial provision jobs, advances the inactive advocate to provisioning, and binds the initiating administrator, request, trace, and result to append-only evidence. Exact request replay is limited to the same administrator and returns the original relational result only while the complete topology and initial job chain still match.';

REVOKE ALL ON FUNCTION public.start_advocate_portal_provisioning(
  uuid,
  bigint,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_advocate_portal_provisioning(
  uuid,
  bigint,
  uuid,
  text
) TO authenticated;

-- An active portal must disappear from public resolution as soon as a
-- required provider lookup stops proving the exact intended state. The lock
-- order mirrors terminal settlement: integration, domain, job, then advocate.
-- Publication takes the advocate first but uses NOWAIT for these evidence
-- rows, so the two paths cannot form a blocking cycle.
CREATE OR REPLACE FUNCTION public.record_domain_provisioning_reconciliation(
  target_job_id uuid,
  target_lease_token uuid,
  reconciliation_result text,
  evidence_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_integration public.advocate_domain_integrations%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_job_integration_id uuid;
  v_job_domain_id uuid;
  v_job_advocate_id uuid;
  v_publication_status public.advocate_publication_status;
  v_withdraw_public_eligibility boolean := false;
  v_evidence jsonb := COALESCE(evidence_payload, '{}'::jsonb);
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF reconciliation_result IS NULL
     OR reconciliation_result NOT IN (
       'not_found',
       'matches_intent',
       'needs_apply',
       'conflict',
       'inconclusive'
     ) THEN
    RAISE EXCEPTION 'Domain provisioning reconciliation outcome is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_safe_domain_provisioning_payload(
    v_evidence,
    'result'
  );

  SELECT job.integration_id, job.domain_id, job.advocate_id
  INTO v_job_integration_id, v_job_domain_id, v_job_advocate_id
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT integration.*
  INTO v_integration
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = v_job_integration_id
    AND integration.domain_id = v_job_domain_id
    AND integration.advocate_id = v_job_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain provisioning integration chain is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT domain.*
  INTO v_domain
  FROM public.advocate_domains domain
  WHERE domain.id = v_job_domain_id
    AND domain.advocate_id = v_job_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain provisioning domain chain is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF v_job.integration_id IS DISTINCT FROM v_integration.id
     OR v_job.domain_id IS DISTINCT FROM v_domain.id
     OR v_job.advocate_id IS DISTINCT FROM v_domain.advocate_id
     OR v_job.advocate_id IS DISTINCT FROM v_integration.advocate_id
     OR v_job.provider IS DISTINCT FROM v_integration.provider THEN
    RAISE EXCEPTION 'Domain provisioning settlement chain does not match'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM target_lease_token
     OR v_job.lease_expires_at <= v_now
     OR NOT v_job.reconciliation_required
     OR v_job.reconciliation_outcome IS NOT NULL THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT advocate.publication_status
  INTO v_publication_status
  FROM public.advocates advocate
  WHERE advocate.id = v_job.advocate_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain provisioning advocate chain is unavailable'
      USING ERRCODE = '42501';
  END IF;

  v_withdraw_public_eligibility :=
    v_job.kind = 'reconcile'
    AND v_integration.is_required
    AND (
      v_domain.status = 'active'
      OR v_publication_status = 'active'
    )
    AND NOT (
      reconciliation_result = 'matches_intent'
      AND v_evidence @> '{"verified":true}'::jsonb
    );

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => v_job.lease_owner,
    context_tool => 'domain-provisioning-reconcile',
    context_reason => CASE
      WHEN v_withdraw_public_eligibility
        THEN 'Withdraw public eligibility after required provider state was not verified'
      ELSE 'Provider state reconciled before external mutation or completion'
    END,
    context_metadata => jsonb_build_object(
      'operation', 'reconcile',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'provider_account_scope', v_integration.environment,
      'domain_hostname', v_domain.hostname,
      'outcome', CASE
        WHEN v_withdraw_public_eligibility THEN 'public_eligibility_withdrawn'
        ELSE reconciliation_result
      END
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    reconciliation_required = reconciliation_result IN (
      'conflict',
      'inconclusive'
    ),
    reconciliation_outcome = reconciliation_result,
    reconciled_at = v_now,
    result_payload = job.result_payload || v_evidence
  WHERE job.id = v_job.id;

  IF v_withdraw_public_eligibility THEN
    PERFORM private.apply_domain_job_failure(
      v_job.id,
      'active_provider_reconciliation_unverified',
      v_now
    );
  END IF;

  RETURN NOT v_withdraw_public_eligibility;
END;
$$;

COMMENT ON FUNCTION public.record_domain_provisioning_reconciliation(
  uuid,
  uuid,
  text,
  jsonb
) IS
  'Records allowlisted provider lookup evidence under the current fenced lease. True preserves existing public eligibility. False means a required active-provider check did not prove verified matches_intent and atomically withdrew the integration, domain, and advocate before any repair or retry.';

REVOKE ALL ON FUNCTION public.record_domain_provisioning_reconciliation(
  uuid,
  uuid,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_domain_provisioning_reconciliation(
  uuid,
  uuid,
  text,
  jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_domain_provisioning_job(
  target_domain_id uuid,
  target_integration_id uuid,
  job_kind public.domain_provisioning_job_kind,
  change_reason text,
  requested_run_at timestamp with time zone DEFAULT now(),
  request_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_hostname text;
  v_provider public.advocate_domain_integration_provider;
  v_was_suppressed boolean;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = v_actor_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (
      actor.banned_until IS NULL
      OR actor.banned_until <= now()
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF nullif(btrim(change_reason), '') IS NULL
     OR char_length(change_reason) > 2000 THEN
    RAISE EXCEPTION 'A provisioning reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255 THEN
    RAISE EXCEPTION 'Provisioning request id exceeds 255 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    domain.hostname,
    integration.provider,
    integration.reconciliation_suppressed_at IS NOT NULL
  INTO v_hostname, v_provider, v_was_suppressed
  FROM public.advocate_domain_integrations integration
  JOIN public.advocate_domains domain
    ON domain.id = integration.domain_id
   AND domain.advocate_id = integration.advocate_id
  WHERE integration.id = target_integration_id
    AND integration.domain_id = target_domain_id
  FOR UPDATE OF integration;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-domains',
    context_request_id => request_id,
    context_reason => btrim(change_reason),
    context_metadata => jsonb_build_object(
      'operation', CASE
        WHEN v_was_suppressed THEN 'resume_and_enqueue'
        ELSE 'enqueue'
      END,
      'resource_kind', 'domain_integration',
      'resource_id', target_integration_id::text,
      'provider', v_provider::text,
      'domain_hostname', v_hostname,
      'prior_status', CASE
        WHEN v_was_suppressed THEN 'reconciliation_suppressed'
        ELSE 'reconciliation_enabled'
      END
    )
  );

  IF v_was_suppressed THEN
    UPDATE public.advocate_domain_integrations integration
    SET
      reconciliation_suppressed_at = NULL,
      reconciliation_suppressed_by_user_id = NULL,
      reconciliation_suppression_reason = NULL
    WHERE integration.id = target_integration_id
      AND integration.domain_id = target_domain_id;
  END IF;

  RETURN private.enqueue_domain_provisioning_job_internal(
    target_domain_id,
    target_integration_id,
    job_kind,
    requested_run_at
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  text,
  timestamp with time zone,
  text
) IS
  'Creator Share super-administrator enqueue. An explicit authenticated call atomically clears any durable administrator suppression under the same audit action before creating one fenced job.';

REVOKE ALL ON FUNCTION public.enqueue_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  text,
  timestamp with time zone,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  text,
  timestamp with time zone,
  text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_queued_domain_provisioning_job(
  target_job_id uuid,
  change_reason text,
  request_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_job public.domain_provisioning_jobs%ROWTYPE;
  v_integration public.advocate_domain_integrations%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_job_integration_id uuid;
  v_job_domain_id uuid;
  v_job_advocate_id uuid;
  v_reason text := btrim(change_reason);
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = v_actor_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (
      actor.banned_until IS NULL
      OR actor.banned_until <= now()
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A cancellation reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255 THEN
    RAISE EXCEPTION 'Cancellation request id exceeds 255 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.integration_id, job.domain_id, job.advocate_id
  INTO v_job_integration_id, v_job_domain_id, v_job_advocate_id
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only queued domain provisioning work can be administratively cancelled'
      USING ERRCODE = '55000';
  END IF;

  SELECT integration.*
  INTO v_integration
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = v_job_integration_id
    AND integration.domain_id = v_job_domain_id
    AND integration.advocate_id = v_job_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain provisioning integration chain is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT domain.*
  INTO v_domain
  FROM public.advocate_domains domain
  WHERE domain.id = v_job_domain_id
    AND domain.advocate_id = v_job_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain provisioning domain chain is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.domain_provisioning_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF v_job.integration_id IS DISTINCT FROM v_integration.id
     OR v_job.domain_id IS DISTINCT FROM v_domain.id
     OR v_job.advocate_id IS DISTINCT FROM v_domain.advocate_id
     OR v_job.advocate_id IS DISTINCT FROM v_integration.advocate_id
     OR v_job.provider IS DISTINCT FROM v_integration.provider THEN
    RAISE EXCEPTION 'Domain provisioning settlement chain does not match'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.status <> 'queued' THEN
    RAISE EXCEPTION 'Only queued domain provisioning work can be administratively cancelled'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-domains',
    context_request_id => request_id,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'cancel_and_suppress',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'provider_account_scope', v_integration.environment,
      'domain_hostname', v_domain.hostname,
      'outcome', 'cancelled_and_suppressed'
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    status = 'cancelled',
    finished_at = v_now,
    last_error = 'administrator_cancelled'
  WHERE job.id = v_job.id;

  UPDATE public.advocate_domain_integrations integration
  SET
    reconciliation_suppressed_at = v_now,
    reconciliation_suppressed_by_user_id = v_actor_user_id,
    reconciliation_suppression_reason = v_reason
  WHERE integration.id = v_integration.id;

  PERFORM private.apply_domain_job_failure(
    v_job.id,
    'administrator_cancelled',
    v_now
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.cancel_queued_domain_provisioning_job(
  uuid,
  text,
  text
) IS
  'Authenticated Creator Share super-administrator cancellation. It cancels only unleased work, fails the affected lifecycle chain closed as appropriate, and durably suppresses automatic recreation until another explicit administrator enqueue.';

REVOKE ALL ON FUNCTION public.cancel_queued_domain_provisioning_job(
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_queued_domain_provisioning_job(
  uuid,
  text,
  text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_due_advocate_domain_reconciliations(
  batch_size integer DEFAULT 20,
  correlation_id text DEFAULT NULL
)
RETURNS TABLE (
  domain_id uuid,
  enqueued_job_count integer,
  quarantined boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_candidate record;
  v_now timestamp with time zone := clock_timestamp();
  v_domain_ids uuid[] := ARRAY[]::uuid[];
  v_domain_counts integer[] := ARRAY[]::integer[];
  v_domain_quarantined boolean[] := ARRAY[]::boolean[];
  v_domain_position integer;
  v_index integer;
  v_budget_used integer := 0;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 100 THEN
    RAISE EXCEPTION 'Reconciliation enqueue batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  IF correlation_id IS NULL
     OR correlation_id <> btrim(correlation_id)
     OR char_length(correlation_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Reconciliation correlation id is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Quarantine invalid public topology before considering provider work. The
  -- domain lock makes each exact topology snapshot stable against inserts and
  -- deletes. SKIP LOCKED keeps one concurrently managed portal from blocking
  -- or rolling back unrelated candidates in this bounded batch.
  FOR v_candidate IN
    SELECT
      domain.id AS domain_id,
      domain.advocate_id,
      domain.hostname
    FROM public.advocate_domains domain
    JOIN public.advocates advocate
      ON advocate.id = domain.advocate_id
    WHERE domain.status = 'active'
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status = 'active'
      AND (
        (
          SELECT count(*)
          FROM public.advocate_domain_integrations exact_integration
          WHERE exact_integration.advocate_id = domain.advocate_id
            AND exact_integration.domain_id = domain.id
        ) <> 5
        OR EXISTS (
          SELECT 1
          FROM public.advocate_domain_integrations exact_integration
          WHERE exact_integration.advocate_id = domain.advocate_id
            AND exact_integration.domain_id = domain.id
            AND NOT (
              exact_integration.is_required
              AND (
                (exact_integration.provider = 'cloudflare'
                  AND exact_integration.environment = 'production')
                OR (exact_integration.provider = 'vercel'
                  AND exact_integration.environment = 'production')
                OR (exact_integration.provider = 'stripe_us'
                  AND exact_integration.environment = 'live')
                OR (exact_integration.provider = 'stripe_uk'
                  AND exact_integration.environment = 'live')
                OR (exact_integration.provider = 'paypal'
                  AND exact_integration.environment = 'live')
              )
            )
          )
      )
    ORDER BY domain.updated_at, domain.id
    LIMIT batch_size
    FOR UPDATE OF domain SKIP LOCKED
  LOOP
    PERFORM audit.set_actor_context(
      context_actor_type => 'system'::audit.audit_actor_type,
      context_system_actor => 'advocate-domain-reconciler',
      context_tool => 'advocate-domain-topology-quarantine',
      context_trace_id => correlation_id,
      context_reason => 'Quarantine active advocate domain with invalid required provider topology',
      context_metadata => jsonb_build_object(
        'operation', 'quarantine_invalid_topology',
        'resource_kind', 'advocate_domain',
        'resource_id', v_candidate.domain_id::text,
        'batch_id', correlation_id,
        'domain_hostname', v_candidate.hostname,
        'manual_review_code', 'invalid_required_provider_topology',
        'outcome', 'failed_closed'
      )
    );

    UPDATE public.advocate_domains domain
    SET
      status = 'failed',
      failure_code = 'invalid_required_provider_topology',
      failure_detail = NULL
    WHERE domain.id = v_candidate.domain_id
      AND domain.advocate_id = v_candidate.advocate_id
      AND domain.status = 'active';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.advocates advocate
    SET publication_status = 'failed'
    WHERE advocate.id = v_candidate.advocate_id
      AND advocate.publication_status IN ('provisioning', 'active');

    v_domain_ids := array_append(v_domain_ids, v_candidate.domain_id);
    v_domain_counts := array_append(v_domain_counts, 0);
    v_domain_quarantined := array_append(v_domain_quarantined, true);
    v_budget_used := v_budget_used + 1;
  END LOOP;

  IF v_budget_used < batch_size THEN
    PERFORM audit.set_actor_context(
      context_actor_type => 'system'::audit.audit_actor_type,
      context_system_actor => 'advocate-domain-reconciler',
      context_tool => 'advocate-domain-reconciliation-enqueue',
      context_trace_id => correlation_id,
      context_reason => 'Enqueue bounded due exact-host provider reconciliation',
      context_metadata => jsonb_build_object(
        'operation', 'enqueue_reconciliation',
        'resource_kind', 'advocate_domain_integration',
        'batch_id', correlation_id,
        'outcome', 'queued'
      )
    );

    FOR v_candidate IN
      SELECT
        integration.id AS integration_id,
        integration.domain_id
      FROM public.advocate_domain_integrations integration
      JOIN public.advocate_domains domain
        ON domain.id = integration.domain_id
       AND domain.advocate_id = integration.advocate_id
      JOIN public.advocates advocate
        ON advocate.id = integration.advocate_id
      WHERE integration.is_required
        AND integration.status <> 'disabled'
        AND integration.reconciliation_suppressed_at IS NULL
        AND domain.status IN ('provisioning', 'verifying', 'active', 'failed')
        AND advocate.relationship_status = 'active'
        AND advocate.publication_status <> 'suspended'
        AND COALESCE(
          integration.last_checked_at,
          '-infinity'::timestamp with time zone
        ) <= v_now - CASE domain.status
          WHEN 'active' THEN interval '6 hours'
          ELSE interval '15 minutes'
        END
        AND NOT EXISTS (
          SELECT 1
          FROM public.domain_provisioning_jobs open_job
          WHERE open_job.integration_id = integration.id
            AND open_job.status IN ('queued', 'running')
        )
        AND (
          SELECT count(*)
          FROM public.advocate_domain_integrations exact_integration
          WHERE exact_integration.advocate_id = integration.advocate_id
            AND exact_integration.domain_id = integration.domain_id
        ) = 5
        AND NOT EXISTS (
          SELECT 1
          FROM public.advocate_domain_integrations exact_integration
          WHERE exact_integration.advocate_id = integration.advocate_id
            AND exact_integration.domain_id = integration.domain_id
            AND NOT (
              exact_integration.is_required
              AND (
                (exact_integration.provider = 'cloudflare'
                  AND exact_integration.environment = 'production')
                OR (exact_integration.provider = 'vercel'
                  AND exact_integration.environment = 'production')
                OR (exact_integration.provider = 'stripe_us'
                  AND exact_integration.environment = 'live')
                OR (exact_integration.provider = 'stripe_uk'
                  AND exact_integration.environment = 'live')
                OR (exact_integration.provider = 'paypal'
                  AND exact_integration.environment = 'live')
              )
            )
        )
      ORDER BY
        COALESCE(
          integration.last_checked_at,
          '-infinity'::timestamp with time zone
        ),
        integration.domain_id,
        integration.provider
      LIMIT batch_size - v_budget_used
      FOR UPDATE OF integration SKIP LOCKED
    LOOP
      PERFORM private.enqueue_domain_provisioning_job_internal(
        v_candidate.domain_id,
        v_candidate.integration_id,
        'reconcile',
        clock_timestamp()
      );

      v_domain_position := array_position(
        v_domain_ids,
        v_candidate.domain_id
      );

      IF v_domain_position IS NULL THEN
        v_domain_ids := array_append(v_domain_ids, v_candidate.domain_id);
        v_domain_counts := array_append(v_domain_counts, 1);
        v_domain_quarantined := array_append(v_domain_quarantined, false);
      ELSE
        v_domain_counts[v_domain_position] :=
          v_domain_counts[v_domain_position] + 1;
      END IF;
    END LOOP;
  END IF;

  IF cardinality(v_domain_ids) IS NULL THEN
    RETURN;
  END IF;

  FOR v_index IN 1..cardinality(v_domain_ids)
  LOOP
    domain_id := v_domain_ids[v_index];
    enqueued_job_count := v_domain_counts[v_index];
    quarantined := v_domain_quarantined[v_index];
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.enqueue_due_advocate_domain_reconciliations(
  integer,
  text
) IS
  'Service-only bounded scheduler boundary. It first atomically quarantines invalid active provider topology without enqueuing work, then checks valid active domains every six hours and valid nonpublic domains every fifteen minutes. It skips durable administrator suppressions, reuses one-open-job fences, uses a fresh enqueue timestamp per integration, and never publishes or reactivates a portal.';

REVOKE ALL ON FUNCTION public.enqueue_due_advocate_domain_reconciliations(
  integer,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_advocate_domain_reconciliations(
  integer,
  text
) TO service_role;

-- The service role may inspect topology for worker and application decisions,
-- but every runtime insert and lifecycle change now passes through an audited
-- security-definer boundary.
REVOKE INSERT, UPDATE, DELETE ON public.advocate_domains FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON public.advocate_domain_integrations FROM service_role;

COMMIT;
