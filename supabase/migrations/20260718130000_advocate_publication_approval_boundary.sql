BEGIN;

-- Provider workers establish evidence, but they do not decide that a branded
-- portal is publicly available. Once every exact provider chain is ready the
-- domain stops in the nonpublic verifying state until a Creator Share super
-- administrator approves the independently captured canary evidence.
CREATE OR REPLACE FUNCTION private.apply_domain_job_success(
  target_job_id uuid,
  target_result jsonb,
  verified_at timestamp with time zone
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
  v_external_identifier text;
  v_expected_ready_count integer;
  v_required_count integer;
  v_required_not_ready integer;
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

  IF v_job.kind IN ('provision', 'reconcile') THEN
    IF v_domain.status IN ('pending', 'failed', 'disabled') THEN
      UPDATE public.advocate_domains domain
      SET status = 'provisioning'
      WHERE domain.id = v_domain.id;
    END IF;

    IF v_integration.status IN ('pending', 'failed', 'disabled') THEN
      UPDATE public.advocate_domain_integrations integration
      SET status = 'provisioning'
      WHERE integration.id = v_integration.id;
    END IF;

    v_external_identifier := CASE
      WHEN v_job.provider = 'cloudflare' THEN COALESCE(
        target_result ->> 'dns_record_id',
        target_result ->> 'provider_resource_id',
        v_integration.external_identifier
      )
      ELSE COALESCE(
        target_result ->> 'provider_resource_id',
        v_integration.external_identifier
      )
    END;

    UPDATE public.advocate_domain_integrations integration
    SET
      status = 'ready',
      external_identifier = v_external_identifier,
      provider_metadata = integration.provider_metadata || jsonb_build_object(
        'settlement_schema_version', 1,
        'last_verified_job_id', v_job.id,
        'last_verified_kind', v_job.kind,
        'last_verified_provider_status', target_result ->> 'provider_status',
        'last_verified_evidence_sha256', encode(
          extensions.digest(
            pg_catalog.convert_to(target_result::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      ),
      last_checked_at = verified_at,
      last_error = NULL,
      last_verified_job_id = v_job.id,
      last_verified_kind = v_job.kind,
      last_verified_at = verified_at,
      last_verified_evidence_digest = extensions.digest(
        pg_catalog.convert_to(target_result::text, 'UTF8'),
        'sha256'
      )
    WHERE integration.id = v_integration.id;

    WITH expected(provider, environment) AS (
      VALUES
        ('cloudflare', 'production'),
        ('vercel', 'production'),
        ('stripe_us', 'live'),
        ('stripe_uk', 'live'),
        ('paypal', 'live')
    )
    SELECT count(*)::integer
    INTO v_expected_ready_count
    FROM expected
    JOIN public.advocate_domain_integrations integration
      ON integration.domain_id = v_domain.id
     AND integration.provider::text = expected.provider
     AND integration.environment = expected.environment
     AND integration.is_required
     AND integration.status = 'ready'
     AND integration.ready_at IS NOT NULL
     AND integration.last_verified_job_id IS NOT NULL
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
     AND job.advocate_id = integration.advocate_id
     AND job.domain_id = integration.domain_id
     AND job.integration_id = integration.id
     AND job.provider = integration.provider
     AND job.status = 'succeeded'
     AND job.kind IN ('provision', 'reconcile')
     AND job.result_payload @> '{"verified":true}'::jsonb;

    SELECT count(*)::integer
    INTO v_required_not_ready
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = v_domain.id
      AND integration.is_required
      AND (
        integration.status <> 'ready'
        OR integration.ready_at IS NULL
        OR integration.last_verified_job_id IS NULL
      );

    SELECT count(*)::integer
    INTO v_required_count
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = v_domain.id
      AND integration.is_required;

    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.id = v_domain.id;

    IF v_expected_ready_count = 5
       AND v_required_count = 5
       AND v_required_not_ready = 0
       AND v_domain.status = 'provisioning' THEN
      UPDATE public.advocate_domains domain
      SET status = 'verifying'
      WHERE domain.id = v_domain.id;
    END IF;

    RETURN;
  END IF;

  IF v_job.provider = 'vercel'
     AND NOT private.cloudflare_dns_removal_is_verified(v_domain.id) THEN
    RAISE EXCEPTION 'Cloudflare DNS removal must be verified before Vercel release'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.advocate_domain_integrations integration
  SET
    status = 'disabled',
    provider_metadata = integration.provider_metadata || jsonb_build_object(
      'settlement_schema_version', 1,
      'last_verified_job_id', v_job.id,
      'last_verified_kind', v_job.kind,
      'last_verified_provider_status', target_result ->> 'provider_status',
      'last_verified_evidence_sha256', encode(
        extensions.digest(
          pg_catalog.convert_to(target_result::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
    ),
    last_checked_at = verified_at,
    last_error = NULL,
    last_verified_job_id = v_job.id,
    last_verified_kind = v_job.kind,
    last_verified_at = verified_at,
    last_verified_evidence_digest = extensions.digest(
      pg_catalog.convert_to(target_result::text, 'UTF8'),
      'sha256'
    )
  WHERE integration.id = v_integration.id;

  IF private.domain_deprovisioning_is_complete(v_domain.id) THEN
    UPDATE public.advocate_domains domain
    SET status = 'disabled'
    WHERE domain.id = v_domain.id
      AND domain.status = 'redirecting';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.apply_domain_job_success(uuid, jsonb, timestamp with time zone) IS
  'Applies exact provider evidence and advances a fully ready hostname only to verifying. Public activation requires the separate audited administrator approval boundary.';

REVOKE ALL ON FUNCTION private.apply_domain_job_success(uuid, jsonb, timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;

-- Publication adds two scalar, nonsecret evidence fields to the audit metadata
-- vocabulary. The strict allowlist remains in force for every other caller.
CREATE OR REPLACE FUNCTION audit.set_actor_context(
  context_actor_type audit.audit_actor_type,
  context_actor_user_id uuid DEFAULT NULL,
  context_effective_user_id uuid DEFAULT NULL,
  context_system_actor text DEFAULT NULL,
  context_tool text DEFAULT NULL,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_session_id text DEFAULT NULL,
  context_provider_event_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL,
  context_reason text DEFAULT NULL,
  context_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF jsonb_typeof(context_metadata) <> 'object' THEN
    RAISE EXCEPTION 'Audit context metadata must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF pg_column_size(context_metadata) > 4096 THEN
    RAISE EXCEPTION 'Audit context metadata exceeds 4096 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(context_metadata) entry
    WHERE entry.key <> ALL (ARRAY[
      'operation',
      'resource_kind',
      'resource_id',
      'outcome',
      'job_id',
      'batch_id',
      'provider',
      'provider_account_scope',
      'event_type',
      'retry_count',
      'correlation_id',
      'deployment_id',
      'domain_hostname',
      'permission_key',
      'role_key',
      'prior_status',
      'manual_review_code',
      'ownership_conflict',
      'observed_provider_product_id',
      'observed_provider_plan_id',
      'evidence_sha256',
      'canary_completed_at',
      'publication_binding_sha256'
    ]::text[])
      OR jsonb_typeof(entry.value) NOT IN ('string', 'number', 'boolean', 'null')
  ) THEN
    RAISE EXCEPTION 'Audit context metadata contains an unsupported key or value type'
      USING ERRCODE = '22023';
  END IF;

  IF context_actor_type = 'system'
     AND nullif(btrim(context_system_actor), '') IS NULL THEN
    RAISE EXCEPTION 'System audit context requires a named system actor'
      USING ERRCODE = '22023';
  END IF;

  IF context_actor_type IN ('user', 'creator_share_admin')
     AND context_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'User audit context requires an actor user id'
      USING ERRCODE = '22023';
  END IF;

  IF length(COALESCE(context_system_actor, '')) > 200
     OR length(COALESCE(context_tool, '')) > 200
     OR length(COALESCE(context_request_id, '')) > 255
     OR length(COALESCE(context_trace_id, '')) > 255
     OR length(COALESCE(context_session_id, '')) > 255
     OR length(COALESCE(context_provider_event_id, '')) > 255
     OR length(COALESCE(context_reason, '')) > 2000 THEN
    RAISE EXCEPTION 'Audit context field exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.audit.actor_type', context_actor_type::text, true);
  PERFORM pg_catalog.set_config('app.audit.actor_user_id', COALESCE(context_actor_user_id::text, ''), true);
  PERFORM pg_catalog.set_config('app.audit.effective_user_id', COALESCE(context_effective_user_id::text, ''), true);
  PERFORM pg_catalog.set_config('app.audit.system_actor', COALESCE(context_system_actor, ''), true);
  PERFORM pg_catalog.set_config('app.audit.tool', COALESCE(context_tool, ''), true);
  PERFORM pg_catalog.set_config('app.audit.request_id', COALESCE(context_request_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.trace_id', COALESCE(context_trace_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.session_id', COALESCE(context_session_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.provider_event_id', COALESCE(context_provider_event_id, ''), true);
  PERFORM pg_catalog.set_config('app.audit.client_ip', COALESCE(context_client_ip, ''), true);
  PERFORM pg_catalog.set_config('app.audit.user_agent', COALESCE(context_user_agent, ''), true);
  PERFORM pg_catalog.set_config('app.audit.reason', COALESCE(context_reason, ''), true);
  PERFORM pg_catalog.set_config('app.audit.metadata', context_metadata::text, true);
END;
$$;

-- These guards are defense in depth for runtime roles calling any current or
-- future security definer. PostgreSQL migration and test sessions remain able
-- to construct fixtures because privileged database administration is covered
-- by the separate PGAudit and provider log layer described in the audit model.
CREATE OR REPLACE FUNCTION private.require_advocate_publication_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim_role text := NULLIF(auth.role(), '');
BEGIN
  IF NEW.publication_status <> 'active'
     OR OLD.publication_status = 'active' THEN
    RETURN NEW;
  END IF;

  IF (session_user <> 'postgres' OR v_claim_role IS NOT NULL)
     AND (
       current_setting(
         'app.advocate_publication.approved_advocate_id',
         true
       ) IS DISTINCT FROM NEW.id::text
       OR NOT private.is_creator_share_super_admin()
     ) THEN
    RAISE EXCEPTION 'Advocate publication requires an approved administrator transaction'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.require_advocate_domain_publication_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim_role text := NULLIF(auth.role(), '');
BEGIN
  IF NEW.status <> 'active' OR OLD.status = 'active' THEN
    RETURN NEW;
  END IF;

  IF (session_user <> 'postgres' OR v_claim_role IS NOT NULL)
     AND (
       current_setting(
         'app.advocate_publication.approved_advocate_id',
         true
       ) IS DISTINCT FROM NEW.advocate_id::text
       OR current_setting(
         'app.advocate_publication.approved_domain_id',
         true
       ) IS DISTINCT FROM NEW.id::text
       OR NOT private.is_creator_share_super_admin()
     ) THEN
    RAISE EXCEPTION 'Advocate domain activation requires an approved administrator transaction'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_advocate_publication_approval()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_advocate_domain_publication_approval()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.stamp_advocate_publication_canary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_canary_verified_at timestamp with time zone;
BEGIN
  IF NEW.status <> 'active' OR OLD.status = 'active' THEN
    RETURN NEW;
  END IF;

  IF current_setting(
       'app.advocate_publication.approved_advocate_id',
       true
     ) IS DISTINCT FROM NEW.advocate_id::text
     OR current_setting(
       'app.advocate_publication.approved_domain_id',
       true
     ) IS DISTINCT FROM NEW.id::text THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_canary_verified_at := NULLIF(
      current_setting(
        'app.advocate_publication.canary_completed_at',
        true
      ),
      ''
    )::timestamp with time zone;
  EXCEPTION WHEN invalid_datetime_format THEN
    RAISE EXCEPTION 'Publication canary timestamp is invalid'
      USING ERRCODE = '42501';
  END;

  IF v_canary_verified_at IS NULL THEN
    RAISE EXCEPTION 'Publication canary timestamp is required'
      USING ERRCODE = '42501';
  END IF;

  -- The earlier lifecycle trigger validates the five provider chains. Replace
  -- its infrastructure timestamps with the honest exact-host canary time.
  NEW.dns_verified_at := v_canary_verified_at;
  NEW.tls_ready_at := v_canary_verified_at;
  NEW.payments_ready_at := v_canary_verified_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_advocate_publication_canary()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS advocates_publication_approval_gate
  ON public.advocates;
CREATE TRIGGER advocates_publication_approval_gate
BEFORE UPDATE ON public.advocates
FOR EACH ROW EXECUTE FUNCTION private.require_advocate_publication_approval();

DROP TRIGGER IF EXISTS advocate_domains_publication_approval_gate
  ON public.advocate_domains;
CREATE TRIGGER advocate_domains_publication_approval_gate
BEFORE UPDATE ON public.advocate_domains
FOR EACH ROW EXECUTE FUNCTION private.require_advocate_domain_publication_approval();

DROP TRIGGER IF EXISTS advocate_domains_z_stamp_publication_canary
  ON public.advocate_domains;
CREATE TRIGGER advocate_domains_z_stamp_publication_canary
BEFORE UPDATE ON public.advocate_domains
FOR EACH ROW EXECUTE FUNCTION private.stamp_advocate_publication_canary();

CREATE OR REPLACE FUNCTION public.publish_advocate_portal(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  target_primary_domain_id uuid,
  expected_primary_hostname text,
  evidence_sha256 bytea,
  canary_completed_at timestamp with time zone,
  change_reason text,
  deployment_id text,
  request_id text,
  trace_id text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_reason text := btrim(change_reason);
  v_deployment_id text := btrim(deployment_id);
  v_request_id text := btrim(request_id);
  v_trace_id text := btrim(trace_id);
  v_expected_ready_count integer;
  v_required_count integer;
  v_required_not_ready integer;
  v_latest_integration_verified_at timestamp with time zone;
  v_integration_evidence jsonb;
  v_publication_binding_sha256 bytea;
  v_role_assignment_id uuid;
  v_final_version bigint;
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

  IF target_advocate_id IS NULL
     OR target_primary_domain_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'Advocate publication identity and version are required'
      USING ERRCODE = '22023';
  END IF;

  IF expected_primary_hostname IS NULL
     OR expected_primary_hostname IS DISTINCT FROM lower(btrim(expected_primary_hostname))
     OR char_length(expected_primary_hostname) NOT BETWEEN 1 AND 253 THEN
    RAISE EXCEPTION 'The exact lowercase primary hostname is required'
      USING ERRCODE = '22023';
  END IF;

  IF evidence_sha256 IS NULL OR octet_length(evidence_sha256) <> 32 THEN
    RAISE EXCEPTION 'Publication evidence SHA256 must contain exactly 32 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF canary_completed_at IS NULL
     OR canary_completed_at < v_now - interval '30 minutes'
     OR canary_completed_at > v_now + interval '1 minute' THEN
    RAISE EXCEPTION 'Publication canary evidence must be completed within the last 30 minutes'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A publication reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_deployment_id IS NULL
     OR char_length(v_deployment_id) NOT BETWEEN 1 AND 255
     OR v_deployment_id ~ '[[:cntrl:]]'
     OR v_request_id IS NULL
     OR char_length(v_request_id) NOT BETWEEN 1 AND 255
     OR v_request_id ~ '[[:cntrl:]]'
     OR v_trace_id IS NULL
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Deployment, request, and trace identifiers are required and limited to 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access changed during publication approval'
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
    RAISE EXCEPTION 'Creator Share super administrator access changed during publication approval'
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

  v_now := clock_timestamp();
  IF canary_completed_at < v_now - interval '30 minutes'
     OR canary_completed_at > v_now + interval '1 minute' THEN
    RAISE EXCEPTION 'Publication canary evidence must be completed within the last 30 minutes'
      USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Advocate portal version changed before publication approval'
      USING ERRCODE = '40001';
  END IF;

  IF v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN (
       'draft',
       'provisioning',
       'failed',
       'active'
     ) THEN
    RAISE EXCEPTION 'Advocate portal is not eligible for publication approval'
      USING ERRCODE = '55000';
  END IF;

  -- Settlement locks integration, domain, then job. Publication already holds
  -- the advocate row, so it must never wait on that inverse lock order. The
  -- domain and evidence locks are NOWAIT and convert any overlap into an
  -- optimistic retry. Once held, the domain update lock also fences new
  -- FK-bound integration and job inserts until publication commits.
  BEGIN
    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.id = target_primary_domain_id
      AND domain.advocate_id = target_advocate_id
      AND domain.is_primary
      AND domain.hostname = expected_primary_hostname
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during approval'
      USING ERRCODE = '40001';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exact advocate primary domain does not match'
      USING ERRCODE = '23503';
  END IF;

  BEGIN
    PERFORM integration.id
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = v_domain.id
      AND integration.advocate_id = v_advocate.id
      AND integration.is_required
    ORDER BY integration.provider::text, integration.environment
    FOR SHARE NOWAIT;

    PERFORM job.id
    FROM public.advocate_domain_integrations integration
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
     AND job.advocate_id = integration.advocate_id
     AND job.domain_id = integration.domain_id
     AND job.integration_id = integration.id
     AND job.provider = integration.provider
    WHERE integration.domain_id = v_domain.id
      AND integration.advocate_id = v_advocate.id
      AND integration.is_required
    ORDER BY integration.provider::text, integration.environment
    FOR SHARE OF job NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during approval'
      USING ERRCODE = '40001';
  END;

  WITH expected(provider, environment) AS (
    VALUES
      ('cloudflare', 'production'),
      ('vercel', 'production'),
      ('stripe_us', 'live'),
      ('stripe_uk', 'live'),
      ('paypal', 'live')
  )
  SELECT count(*)::integer
  INTO v_expected_ready_count
  FROM expected
  JOIN public.advocate_domain_integrations integration
    ON integration.domain_id = v_domain.id
   AND integration.advocate_id = v_advocate.id
   AND integration.provider::text = expected.provider
   AND integration.environment = expected.environment
   AND integration.is_required
   AND integration.status = 'ready'
   AND integration.ready_at IS NOT NULL
   AND integration.last_verified_at IS NOT NULL
   AND integration.last_verified_at >= v_now - interval '30 minutes'
   AND integration.last_verified_at <= v_now + interval '1 minute'
   AND octet_length(integration.last_verified_evidence_digest) = 32
  JOIN public.domain_provisioning_jobs job
    ON job.id = integration.last_verified_job_id
   AND job.advocate_id = integration.advocate_id
   AND job.domain_id = integration.domain_id
   AND job.integration_id = integration.id
   AND job.provider = integration.provider
   AND job.status = 'succeeded'
   AND job.kind IN ('provision', 'reconcile')
   AND job.result_payload @> '{"verified":true}'::jsonb;

  SELECT count(*)::integer
  INTO v_required_not_ready
  FROM public.advocate_domain_integrations integration
  WHERE integration.domain_id = v_domain.id
    AND integration.is_required
    AND (
      integration.status <> 'ready'
      OR integration.ready_at IS NULL
      OR integration.last_verified_job_id IS NULL
      OR integration.last_verified_at IS NULL
      OR integration.last_verified_at < v_now - interval '30 minutes'
      OR integration.last_verified_at > v_now + interval '1 minute'
      OR octet_length(integration.last_verified_evidence_digest) <> 32
    );

  SELECT
    count(*)::integer,
    max(integration.last_verified_at)
  INTO
    v_required_count,
    v_latest_integration_verified_at
  FROM public.advocate_domain_integrations integration
  WHERE integration.domain_id = v_domain.id
    AND integration.is_required;

  IF v_expected_ready_count <> 5
     OR v_required_count <> 5
     OR v_required_not_ready <> 0 THEN
    RAISE EXCEPTION 'Every required domain integration must carry verified readiness evidence'
      USING ERRCODE = '55000';
  END IF;

  IF v_domain.status <> 'verifying' THEN
    RAISE EXCEPTION 'Advocate primary domain is not awaiting publication approval'
      USING ERRCODE = '55000';
  END IF;

  IF canary_completed_at < v_latest_integration_verified_at THEN
    RAISE EXCEPTION 'Publication canary evidence predates provider readiness'
      USING ERRCODE = '55000';
  END IF;

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
  INTO v_integration_evidence
  FROM public.advocate_domain_integrations integration
  WHERE integration.domain_id = v_domain.id
    AND integration.is_required;

  v_publication_binding_sha256 := extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_object(
        'schema_version', 1,
        'advocate_id', v_advocate.id,
        'domain_id', v_domain.id,
        'evidence_sha256', encode(evidence_sha256, 'hex'),
        'domain_hostname', v_domain.hostname,
        'deployment_id', v_deployment_id,
        'canary_completed_at', to_char(
          canary_completed_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'integrations', v_integration_evidence
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  IF EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = v_advocate.id
      AND job.status IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION 'Advocate publication cannot proceed while provider jobs are open'
      USING ERRCODE = '55000';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access changed during publication approval'
      USING ERRCODE = '40001';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-publication',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'publish_portal',
      'resource_kind', 'advocate',
      'resource_id', v_advocate.id::text,
      'outcome', 'active',
      'deployment_id', v_deployment_id,
      'domain_hostname', v_domain.hostname,
      'evidence_sha256', encode(evidence_sha256, 'hex'),
      'canary_completed_at', to_char(
        canary_completed_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'publication_binding_sha256', encode(
        v_publication_binding_sha256,
        'hex'
      )
    )
  );

  PERFORM pg_catalog.set_config(
    'app.advocate_publication.approved_advocate_id',
    v_advocate.id::text,
    true
  );
  PERFORM pg_catalog.set_config(
    'app.advocate_publication.approved_domain_id',
    v_domain.id::text,
    true
  );
  PERFORM pg_catalog.set_config(
    'app.advocate_publication.canary_completed_at',
    canary_completed_at::text,
    true
  );

  UPDATE public.advocate_domains domain
  SET status = 'active'
  WHERE domain.id = v_domain.id
    AND domain.advocate_id = v_advocate.id
    AND domain.status = 'verifying';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate primary domain changed before publication approval'
      USING ERRCODE = '40001';
  END IF;

  IF v_advocate.publication_status IN ('draft', 'failed') THEN
    UPDATE public.advocates advocate
    SET publication_status = 'provisioning'
    WHERE advocate.id = v_advocate.id
      AND advocate.version = expected_advocate_version;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Advocate portal version changed before publication approval'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.advocates advocate
  SET publication_status = 'active'
  WHERE advocate.id = v_advocate.id
    AND advocate.publication_status = CASE
      WHEN v_advocate.publication_status = 'active'
        THEN 'active'::public.advocate_publication_status
      ELSE 'provisioning'::public.advocate_publication_status
    END
  RETURNING advocate.version INTO v_final_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal changed before publication approval'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_final_version;
END;
$$;

COMMENT ON FUNCTION public.publish_advocate_portal(
  uuid,
  bigint,
  uuid,
  text,
  bytea,
  timestamp with time zone,
  text,
  text,
  text,
  text
) IS
  'Super-administrator-only optimistic publication approval. The authenticated administrator attests that the supplied protected report digest covers DNS, TLS, exact tenant HTTP, rejected sibling, and supported checkout initiation canaries. The database binds that attestation to the exact advocate, domain, deployment, canary time, and fresh ordered provider evidence, rejects open work, stamps readiness from the canary completion time, and atomically activates the domain and advocate with an immutable audit record.';

REVOKE ALL ON FUNCTION public.publish_advocate_portal(
  uuid,
  bigint,
  uuid,
  text,
  bytea,
  timestamp with time zone,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_advocate_portal(
  uuid,
  bigint,
  uuid,
  text,
  bytea,
  timestamp with time zone,
  text,
  text,
  text,
  text
) TO authenticated;

-- Service clients can still administer the nonpublication advocate fields,
-- but lifecycle publication changes must pass through the audited RPC.
REVOKE UPDATE (publication_status) ON public.advocates FROM service_role;

COMMIT;
