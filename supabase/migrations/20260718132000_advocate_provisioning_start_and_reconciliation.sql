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
  v_actor_user_id uuid;
BEGIN
  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'start_advocate_provisioning'
  );

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

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_advocate_id::text, 932741)
  );

  RETURN QUERY
  SELECT result.advocate_id,
    result.advocate_version,
    result.domain_id,
    result.hostname,
    result.job_ids
  FROM private.start_advocate_portal_provisioning_internal(
    target_advocate_id,
    expected_advocate_version,
    request_id,
    trace_id,
    v_actor_user_id,
    'creator_share_admin',
    NULL
  ) result;
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
