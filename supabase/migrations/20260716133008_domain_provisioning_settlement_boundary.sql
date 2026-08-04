BEGIN;

ALTER TABLE public.domain_provisioning_jobs
  ADD COLUMN settlement_lease_token_digest bytea,
  ADD COLUMN settlement_fingerprint bytea,
  ADD COLUMN settlement_schema_version smallint;

ALTER TABLE public.domain_provisioning_jobs
  ADD CONSTRAINT domain_provisioning_jobs_settlement_evidence_check CHECK (
    (
      settlement_lease_token_digest IS NULL
      AND settlement_fingerprint IS NULL
      AND settlement_schema_version IS NULL
    )
    OR (
      status IN ('succeeded', 'failed')
      AND octet_length(settlement_lease_token_digest) = 32
      AND octet_length(settlement_fingerprint) = 32
      AND settlement_schema_version = 1
    )
  );

ALTER TABLE public.advocate_domain_integrations
  ADD COLUMN last_verified_job_id uuid,
  ADD COLUMN last_verified_kind public.domain_provisioning_job_kind,
  ADD COLUMN last_verified_at timestamp with time zone,
  ADD COLUMN last_verified_evidence_digest bytea;

ALTER TABLE public.advocate_domain_integrations
  ADD CONSTRAINT advocate_domain_integrations_verified_evidence_check CHECK (
    (
      last_verified_job_id IS NULL
      AND last_verified_kind IS NULL
      AND last_verified_at IS NULL
      AND last_verified_evidence_digest IS NULL
    )
    OR (
      last_verified_job_id IS NOT NULL
      AND last_verified_kind IS NOT NULL
      AND last_verified_at IS NOT NULL
      AND octet_length(last_verified_evidence_digest) = 32
    )
  );

ALTER TABLE public.domain_provisioning_jobs
  ADD CONSTRAINT domain_provisioning_jobs_verified_chain_unique UNIQUE (
    id,
    integration_id,
    domain_id,
    advocate_id,
    provider,
    kind
  );

ALTER TABLE public.advocate_domain_integrations
  ADD CONSTRAINT advocate_domain_integrations_verified_job_chain_fkey
  FOREIGN KEY (
    last_verified_job_id,
    id,
    domain_id,
    advocate_id,
    provider,
    last_verified_kind
  )
  REFERENCES public.domain_provisioning_jobs (
    id,
    integration_id,
    domain_id,
    advocate_id,
    provider,
    kind
  )
  ON UPDATE RESTRICT
  ON DELETE RESTRICT;

COMMENT ON COLUMN public.domain_provisioning_jobs.settlement_lease_token_digest IS
  'SHA-256 digest of the terminal worker lease token. It supports exact idempotent replay without retaining a reusable token.';
COMMENT ON COLUMN public.domain_provisioning_jobs.settlement_fingerprint IS
  'SHA-256 digest of the exact job, provider chain, terminal outcome, and allowlisted result supplied by the settling worker.';
COMMENT ON COLUMN public.advocate_domain_integrations.last_verified_job_id IS
  'The immutable provider job whose verified result most recently established this integration lifecycle state.';
COMMENT ON COLUMN public.advocate_domain_integrations.last_verified_evidence_digest IS
  'SHA-256 digest of the allowlisted provider evidence accepted by the atomic settlement boundary.';

CREATE OR REPLACE FUNCTION private.domain_settlement_fingerprint(
  target_job_id uuid,
  target_domain_id uuid,
  target_integration_id uuid,
  target_kind public.domain_provisioning_job_kind,
  target_provider public.advocate_domain_integration_provider,
  target_environment text,
  target_hostname text,
  target_operation text,
  target_status public.domain_provisioning_job_status,
  target_code text,
  target_result jsonb
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_object(
        'schema_version', 1,
        'job_id', target_job_id,
        'domain_id', target_domain_id,
        'integration_id', target_integration_id,
        'kind', target_kind,
        'provider', target_provider,
        'environment', target_environment,
        'hostname', target_hostname,
        'operation', target_operation,
        'status', target_status,
        'code', target_code,
        'result', target_result
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

REVOKE ALL ON FUNCTION private.domain_settlement_fingerprint(
  uuid,
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  public.advocate_domain_integration_provider,
  text,
  text,
  text,
  public.domain_provisioning_job_status,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.cloudflare_dns_removal_is_verified(
  target_domain_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.advocate_domain_integrations integration
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
     AND job.advocate_id = integration.advocate_id
     AND job.domain_id = integration.domain_id
     AND job.integration_id = integration.id
     AND job.provider = integration.provider
    WHERE integration.domain_id = target_domain_id
      AND integration.provider = 'cloudflare'
      AND integration.environment = 'production'
      AND integration.status = 'disabled'
      AND integration.disabled_at IS NOT NULL
      AND integration.last_verified_kind = 'deprovision'
      AND integration.last_verified_at IS NOT NULL
      AND job.kind = 'deprovision'
      AND job.status = 'succeeded'
      AND job.result_payload @> jsonb_build_object(
        'verified', true,
        'provider_status', 'absent'
      )
      AND job.settlement_lease_token_digest IS NOT NULL
      AND job.settlement_fingerprint IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION private.domain_deprovisioning_is_complete(
  target_domain_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.cloudflare_dns_removal_is_verified(target_domain_id)
    AND EXISTS (
      SELECT 1
      FROM public.advocate_domain_integrations integration
      JOIN public.domain_provisioning_jobs job
        ON job.id = integration.last_verified_job_id
       AND job.advocate_id = integration.advocate_id
       AND job.domain_id = integration.domain_id
       AND job.integration_id = integration.id
       AND job.provider = integration.provider
      WHERE integration.domain_id = target_domain_id
        AND integration.provider = 'vercel'
        AND integration.environment = 'production'
        AND integration.status = 'disabled'
        AND integration.disabled_at IS NOT NULL
        AND integration.last_verified_kind = 'deprovision'
        AND job.kind = 'deprovision'
        AND job.status = 'succeeded'
        AND job.result_payload @> jsonb_build_object(
          'verified', true,
          'provider_status', 'absent'
        )
        AND job.settlement_lease_token_digest IS NOT NULL
        AND job.settlement_fingerprint IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.advocate_domain_integrations integration
      WHERE integration.domain_id = target_domain_id
        AND integration.is_required
        AND (
          integration.status <> 'disabled'
          OR integration.disabled_at IS NULL
          OR integration.last_verified_kind <> 'deprovision'
          OR integration.last_verified_job_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.domain_provisioning_jobs job
            WHERE job.id = integration.last_verified_job_id
              AND job.advocate_id = integration.advocate_id
              AND job.domain_id = integration.domain_id
              AND job.integration_id = integration.id
              AND job.provider = integration.provider
              AND job.kind = 'deprovision'
              AND job.status = 'succeeded'
              AND job.result_payload @> jsonb_build_object(
                'verified', true,
                'provider_status', 'absent'
              )
              AND job.settlement_lease_token_digest IS NOT NULL
              AND job.settlement_fingerprint IS NOT NULL
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION private.cloudflare_dns_removal_is_verified(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.domain_deprovisioning_is_complete(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.domain_job_lifecycle_is_eligible(
  target_kind public.domain_provisioning_job_kind,
  target_domain_status public.advocate_domain_status,
  target_integration_status public.advocate_domain_integration_status,
  target_relationship_status public.advocate_relationship_status,
  target_publication_status public.advocate_publication_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE target_kind
    WHEN 'provision' THEN
      target_relationship_status = 'active'
      AND target_publication_status <> 'suspended'
      AND target_domain_status IN ('pending', 'provisioning', 'failed', 'disabled')
      AND target_integration_status IN (
        'pending',
        'provisioning',
        'ready',
        'failed',
        'disabled'
      )
    WHEN 'reconcile' THEN
      target_relationship_status = 'active'
      AND target_publication_status <> 'suspended'
      AND target_domain_status IN ('provisioning', 'verifying', 'active', 'failed')
      AND target_integration_status <> 'disabled'
    WHEN 'deprovision' THEN
      target_domain_status IN ('redirecting', 'disabled')
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION private.domain_job_lifecycle_is_eligible(
  public.domain_provisioning_job_kind,
  public.advocate_domain_status,
  public.advocate_domain_integration_status,
  public.advocate_relationship_status,
  public.advocate_publication_status
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_verified_domain_provider_result(
  target_kind public.domain_provisioning_job_kind,
  target_provider public.advocate_domain_integration_provider,
  target_environment text,
  target_hostname text,
  target_result jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider_status text := target_result ->> 'provider_status';
  v_provider_resource_id text := target_result ->> 'provider_resource_id';
  v_dns_record_id text := target_result ->> 'dns_record_id';
  v_payment_path_resource_id text := target_provider::text || ':hosted_checkout';
BEGIN
  PERFORM private.assert_safe_domain_provisioning_payload(target_result, 'result');

  IF NOT target_result @> '{"verified":true}'::jsonb THEN
    RAISE EXCEPTION 'Verified provider state is required before successful completion'
      USING ERRCODE = '55000';
  END IF;

  IF target_kind = 'deprovision' THEN
    IF v_provider_status IS DISTINCT FROM 'absent' THEN
      RAISE EXCEPTION 'Verified provider absence is required before deprovisioning completion'
        USING ERRCODE = '55000';
    END IF;

    IF target_provider IN ('stripe_us', 'stripe_uk', 'paypal')
       AND v_provider_resource_id IS DISTINCT FROM v_payment_path_resource_id THEN
      RAISE EXCEPTION 'Verified payment path evidence does not match the integration'
        USING ERRCODE = '55000';
    END IF;

    RETURN;
  END IF;

  IF target_provider = 'cloudflare' THEN
    IF target_environment <> 'production'
       OR v_provider_status IS DISTINCT FROM 'dns_only_cname_ready'
       OR nullif(v_dns_record_id, '') IS NULL
       OR nullif(v_provider_resource_id, '') IS NULL
       OR v_dns_record_id IS DISTINCT FROM v_provider_resource_id THEN
      RAISE EXCEPTION 'Verified Cloudflare DNS evidence does not match the integration'
        USING ERRCODE = '55000';
    END IF;
  ELSIF target_provider = 'vercel' THEN
    IF target_environment <> 'production'
       OR v_provider_status IS DISTINCT FROM 'attached_verified'
       OR v_provider_resource_id IS DISTINCT FROM target_hostname
       OR nullif(target_result ->> 'deployment_id', '') IS NULL THEN
      RAISE EXCEPTION 'Verified Vercel domain evidence does not match the integration'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF (
         target_provider IN ('stripe_us', 'stripe_uk')
         AND target_environment NOT IN ('test', 'live')
       )
       OR (
         target_provider = 'paypal'
         AND target_environment NOT IN ('sandbox', 'live')
       )
       OR v_provider_status IS DISTINCT FROM 'payment_path_ready'
       OR v_provider_resource_id IS DISTINCT FROM v_payment_path_resource_id THEN
      RAISE EXCEPTION 'Verified payment path evidence does not match the integration'
        USING ERRCODE = '55000';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_verified_domain_provider_result(
  public.domain_provisioning_job_kind,
  public.advocate_domain_integration_provider,
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_and_prepare_advocate_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug text;
  v_now timestamp with time zone := clock_timestamp();
  v_ready_count integer;
  v_required_not_ready integer;
  v_dns_ready_at timestamp with time zone;
  v_tls_ready_at timestamp with time zone;
  v_payments_ready_at timestamp with time zone;
  v_quiescing_domain_id text := nullif(
    pg_catalog.current_setting('app.advocate_domain.quiescing_domain_id', true),
    ''
  );
BEGIN
  SELECT advocate.slug
  INTO v_slug
  FROM public.advocates advocate
  WHERE advocate.id = NEW.advocate_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate domain references an unknown advocate'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.hostname <> v_slug || '.creatorshare.com' THEN
    RAISE EXCEPTION 'Advocate domain hostname must match the immutable advocate slug'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = split_part(NEW.hostname, '.', 1)
  ) THEN
    RAISE EXCEPTION 'Advocate domain hostname uses a reserved label'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.dns_verified_at IS NOT NULL
       OR NEW.tls_ready_at IS NOT NULL
       OR NEW.payments_ready_at IS NOT NULL
       OR NEW.activated_at IS NOT NULL
       OR NEW.deactivated_at IS NOT NULL
       OR NEW.redirect_to_domain_id IS NOT NULL
       OR NEW.failure_code IS NOT NULL
       OR NEW.failure_detail IS NOT NULL THEN
      RAISE EXCEPTION 'Advocate domains must begin pending without caller supplied lifecycle evidence'
        USING ERRCODE = '23514';
    END IF;

    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.hostname IS DISTINCT FROM OLD.hostname
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Advocate domain identity fields are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.dns_verified_at IS DISTINCT FROM OLD.dns_verified_at
       OR NEW.tls_ready_at IS DISTINCT FROM OLD.tls_ready_at
       OR NEW.payments_ready_at IS DISTINCT FROM OLD.payments_ready_at
       OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
       OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
       OR NEW.redirect_to_domain_id IS DISTINCT FROM OLD.redirect_to_domain_id THEN
      RAISE EXCEPTION 'Advocate domain lifecycle evidence requires a legal status transition'
        USING ERRCODE = '42501';
    END IF;

    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('provisioning', 'disabled'))
    OR (OLD.status = 'provisioning' AND NEW.status IN ('verifying', 'failed', 'redirecting', 'disabled'))
    OR (OLD.status = 'verifying' AND NEW.status IN ('active', 'failed', 'redirecting', 'disabled'))
    OR (OLD.status = 'failed' AND NEW.status IN ('provisioning', 'redirecting', 'disabled'))
    OR (OLD.status = 'active' AND NEW.status IN ('failed', 'redirecting'))
    OR (OLD.status = 'redirecting' AND NEW.status IN ('active', 'disabled'))
    OR (OLD.status = 'disabled' AND NEW.status = 'provisioning')
  ) THEN
    RAISE EXCEPTION 'Illegal advocate domain status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' THEN
    WITH expected(provider, environment) AS (
      VALUES
        ('cloudflare', 'production'),
        ('vercel', 'production'),
        ('stripe_us', 'live'),
        ('stripe_uk', 'live'),
        ('paypal', 'live')
    )
    SELECT count(*)::integer
    INTO v_ready_count
    FROM expected
    JOIN public.advocate_domain_integrations integration
      ON integration.domain_id = NEW.id
     AND integration.advocate_id = NEW.advocate_id
     AND integration.provider::text = expected.provider
     AND integration.environment = expected.environment
     AND integration.is_required
     AND integration.status = 'ready'
     AND integration.ready_at IS NOT NULL
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
    WHERE integration.domain_id = NEW.id
      AND integration.is_required
      AND (
        integration.status <> 'ready'
        OR integration.ready_at IS NULL
        OR integration.last_verified_job_id IS NULL
      );

    IF v_ready_count <> 5 OR v_required_not_ready <> 0 THEN
      RAISE EXCEPTION 'Advocate domain cannot activate until every required integration is ready'
        USING ERRCODE = '55000';
    END IF;

    SELECT
      max(integration.ready_at) FILTER (WHERE integration.provider = 'cloudflare'),
      max(integration.ready_at) FILTER (WHERE integration.provider = 'vercel'),
      max(integration.ready_at) FILTER (
        WHERE integration.provider IN ('stripe_us', 'stripe_uk', 'paypal')
      )
    INTO v_dns_ready_at, v_tls_ready_at, v_payments_ready_at
    FROM public.advocate_domain_integrations integration
    WHERE integration.domain_id = NEW.id
      AND integration.is_required
      AND integration.status = 'ready';

    NEW.dns_verified_at := v_dns_ready_at;
    NEW.tls_ready_at := v_tls_ready_at;
    NEW.payments_ready_at := v_payments_ready_at;
    NEW.activated_at := COALESCE(OLD.activated_at, v_now);
    NEW.deactivated_at := NULL;
    NEW.redirect_to_domain_id := NULL;
    NEW.failure_code := NULL;
    NEW.failure_detail := NULL;
  ELSIF NEW.status = 'failed' THEN
    IF nullif(btrim(NEW.failure_code), '') IS NULL THEN
      RAISE EXCEPTION 'Failed advocate domains require a failure code'
        USING ERRCODE = '23514';
    END IF;
    NEW.redirect_to_domain_id := NULL;
  ELSIF NEW.status = 'redirecting' THEN
    IF NEW.redirect_to_domain_id IS NULL
       AND v_quiescing_domain_id IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'A targetless redirecting domain requires the audited quiescing boundary'
        USING ERRCODE = '42501';
    END IF;
    NEW.deactivated_at := v_now;
  ELSIF NEW.status = 'disabled' THEN
    IF OLD.status = 'redirecting'
       AND NOT private.domain_deprovisioning_is_complete(NEW.id) THEN
      RAISE EXCEPTION 'Advocate domain cannot disable before verified provider deprovisioning completes'
        USING ERRCODE = '55000';
    END IF;
    NEW.deactivated_at := COALESCE(OLD.deactivated_at, v_now);
    NEW.redirect_to_domain_id := NULL;
  ELSE
    NEW.redirect_to_domain_id := NULL;
    NEW.failure_code := NULL;
    NEW.failure_detail := NULL;
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_and_prepare_advocate_domain()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_advocate_domain_deprovisioning(
  target_domain_id uuid,
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
  v_domain public.advocate_domains%ROWTYPE;
  v_reason text := btrim(change_reason);
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A deprovisioning reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255 THEN
    RAISE EXCEPTION 'Deprovisioning request id exceeds 255 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT domain.*
  INTO v_domain
  FROM public.advocate_domains domain
  WHERE domain.id = target_domain_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate domain does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_domain.status = 'redirecting'
     AND v_domain.redirect_to_domain_id IS NULL THEN
    RETURN true;
  END IF;

  IF v_domain.status NOT IN ('provisioning', 'verifying', 'active', 'failed') THEN
    RAISE EXCEPTION 'Advocate domain is not eligible for deprovisioning'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.domain_id = v_domain.id
      AND job.status IN ('queued', 'running')
      AND job.kind <> 'deprovision'
  ) THEN
    RAISE EXCEPTION 'Non-deprovisioning provider work is still open for this domain'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-domains',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'begin_deprovisioning',
      'resource_kind', 'advocate_domain',
      'resource_id', v_domain.id::text,
      'domain_hostname', v_domain.hostname,
      'outcome', 'quiescing'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate_domain.quiescing_domain_id',
    v_domain.id::text,
    true
  );

  UPDATE public.advocate_domains domain
  SET
    status = 'redirecting',
    redirect_to_domain_id = NULL
  WHERE domain.id = v_domain.id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.begin_advocate_domain_deprovisioning(uuid, text, text) IS
  'Creator Share administrator boundary that removes an exact hostname from active public resolution by entering an audited targetless quiescing state before provider teardown.';

REVOKE ALL ON FUNCTION public.begin_advocate_domain_deprovisioning(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_advocate_domain_deprovisioning(uuid, text, text)
  TO authenticated;

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

    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.id = v_domain.id;

    IF v_expected_ready_count = 5
       AND v_required_not_ready = 0
       AND v_domain.status IN ('provisioning', 'verifying') THEN
      IF v_domain.status = 'provisioning' THEN
        UPDATE public.advocate_domains domain
        SET status = 'verifying'
        WHERE domain.id = v_domain.id;
      END IF;

      UPDATE public.advocate_domains domain
      SET status = 'active'
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
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_domain_job_retry(
  target_job_id uuid
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
     AND v_domain.status IN ('pending', 'failed', 'disabled') THEN
    UPDATE public.advocate_domains domain
    SET status = 'provisioning'
    WHERE domain.id = v_domain.id;
  END IF;

  IF v_integration.status IN ('pending', 'failed', 'disabled') THEN
    UPDATE public.advocate_domain_integrations integration
    SET status = 'provisioning'
    WHERE integration.id = v_integration.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_domain_job_success(uuid, jsonb, timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.apply_domain_job_failure(uuid, text, timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.apply_domain_job_retry(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

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
    integration.status
  INTO
    v_advocate_id,
    v_provider,
    v_integration_status
  FROM public.advocate_domain_integrations integration
  WHERE integration.id = target_integration_id
    AND integration.domain_id = target_domain_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain integration does not exist'
      USING ERRCODE = '23503';
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

REVOKE ALL ON FUNCTION private.enqueue_domain_provisioning_job_internal(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_domain_provisioning_jobs(
  worker_id text,
  batch_size integer DEFAULT 10,
  lease_duration interval DEFAULT interval '5 minutes'
)
RETURNS TABLE (
  job_id uuid,
  advocate_id uuid,
  domain_id uuid,
  integration_id uuid,
  kind public.domain_provisioning_job_kind,
  provider public.advocate_domain_integration_provider,
  attempt_count integer,
  max_attempts integer,
  provider_idempotency_key text,
  request_payload jsonb,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  reconciliation_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_batch_id uuid := gen_random_uuid();
  v_exhausted_identity record;
  v_exhausted_job public.domain_provisioning_jobs%ROWTYPE;
  v_exhausted_integration public.advocate_domain_integrations%ROWTYPE;
  v_exhausted_domain public.advocate_domains%ROWTYPE;
  v_exhausted_token_digest bytea;
  v_exhausted_fingerprint bytea;
BEGIN
  IF worker_id IS NULL
     OR char_length(worker_id) NOT BETWEEN 1 AND 128
     OR worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' THEN
    RAISE EXCEPTION 'Domain provisioning worker id is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 100 THEN
    RAISE EXCEPTION 'Domain provisioning claim batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  IF lease_duration IS NULL
     OR lease_duration < interval '5 seconds'
     OR lease_duration > interval '15 minutes' THEN
    RAISE EXCEPTION 'Domain provisioning lease must be between 5 seconds and 15 minutes'
      USING ERRCODE = '22023';
  END IF;

  FOR v_exhausted_identity IN
    SELECT
      job.id,
      job.integration_id,
      job.domain_id,
      job.advocate_id
    FROM public.domain_provisioning_jobs job
    WHERE job.status = 'running'
      AND job.lease_expires_at <= v_now
      AND job.attempt_count >= job.max_attempts
    ORDER BY job.lease_expires_at, job.created_at, job.id
    LIMIT batch_size
  LOOP
    SELECT integration.*
    INTO v_exhausted_integration
    FROM public.advocate_domain_integrations integration
    WHERE integration.id = v_exhausted_identity.integration_id
      AND integration.domain_id = v_exhausted_identity.domain_id
      AND integration.advocate_id = v_exhausted_identity.advocate_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Domain provisioning integration chain is unavailable'
        USING ERRCODE = '42501';
    END IF;

    SELECT domain.*
    INTO v_exhausted_domain
    FROM public.advocate_domains domain
    WHERE domain.id = v_exhausted_identity.domain_id
      AND domain.advocate_id = v_exhausted_identity.advocate_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Domain provisioning domain chain is unavailable'
        USING ERRCODE = '42501';
    END IF;

    SELECT job.*
    INTO v_exhausted_job
    FROM public.domain_provisioning_jobs job
    WHERE job.id = v_exhausted_identity.id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_exhausted_job.status <> 'running'
       OR v_exhausted_job.lease_expires_at > v_now
       OR v_exhausted_job.attempt_count < v_exhausted_job.max_attempts THEN
      CONTINUE;
    END IF;

    IF v_exhausted_job.integration_id IS DISTINCT FROM v_exhausted_integration.id
       OR v_exhausted_job.domain_id IS DISTINCT FROM v_exhausted_domain.id
       OR v_exhausted_job.advocate_id IS DISTINCT FROM v_exhausted_domain.advocate_id
       OR v_exhausted_job.advocate_id IS DISTINCT FROM v_exhausted_integration.advocate_id
       OR v_exhausted_job.provider IS DISTINCT FROM v_exhausted_integration.provider THEN
      RAISE EXCEPTION 'Domain provisioning settlement chain does not match'
        USING ERRCODE = '42501';
    END IF;

    v_exhausted_token_digest := extensions.digest(
      pg_catalog.convert_to(v_exhausted_job.lease_token::text, 'UTF8'),
      'sha256'
    );
    v_exhausted_fingerprint := private.domain_settlement_fingerprint(
      v_exhausted_job.id,
      v_exhausted_domain.id,
      v_exhausted_integration.id,
      v_exhausted_job.kind,
      v_exhausted_job.provider,
      v_exhausted_integration.environment,
      v_exhausted_domain.hostname,
      'lease_expired',
      'failed',
      'lease_expired_max_attempts',
      v_exhausted_job.result_payload
    );

    PERFORM audit.set_actor_context(
      context_actor_type => 'system'::audit.audit_actor_type,
      context_system_actor => v_exhausted_job.lease_owner,
      context_tool => 'domain-provisioning-settlement',
      context_reason => 'Atomically settle an exhausted provider lease and domain lifecycle',
      context_metadata => jsonb_build_object(
        'operation', 'lease_expired',
        'resource_kind', 'domain_provisioning_job',
        'resource_id', v_exhausted_job.id::text,
        'job_id', v_exhausted_job.id::text,
        'provider', v_exhausted_job.provider::text,
        'provider_account_scope', v_exhausted_integration.environment,
        'domain_hostname', v_exhausted_domain.hostname,
        'outcome', 'failed',
        'retry_count', GREATEST(v_exhausted_job.attempt_count - 1, 0)
      )
    );

    UPDATE public.domain_provisioning_jobs job
    SET
      status = 'failed',
      lease_owner = NULL,
      lease_token = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      finished_at = v_now,
      last_error = 'lease_expired_max_attempts',
      settlement_lease_token_digest = v_exhausted_token_digest,
      settlement_fingerprint = v_exhausted_fingerprint,
      settlement_schema_version = 1
    WHERE job.id = v_exhausted_job.id;

    PERFORM private.apply_domain_job_failure(
      v_exhausted_job.id,
      'lease_expired_max_attempts',
      v_now
    );
  END LOOP;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-domain-worker',
    context_tool => 'domain-provisioning-claim',
    context_reason => 'Atomic domain provisioning lease claim and stale lease recovery',
    context_metadata => jsonb_build_object(
      'operation', 'claim',
      'resource_kind', 'domain_provisioning_job',
      'batch_id', v_batch_id::text
    )
  );

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.domain_provisioning_jobs job
    JOIN public.advocate_domain_integrations integration
      ON integration.id = job.integration_id
     AND integration.domain_id = job.domain_id
     AND integration.advocate_id = job.advocate_id
     AND integration.provider = job.provider
    JOIN public.advocate_domains domain
      ON domain.id = job.domain_id
     AND domain.advocate_id = job.advocate_id
    JOIN public.advocates advocate
      ON advocate.id = job.advocate_id
    WHERE (
        (
          job.status = 'queued'
          AND job.run_after <= v_now
          AND job.attempt_count < job.max_attempts
        )
        OR (
          job.status = 'running'
          AND job.lease_expires_at <= v_now
          AND job.attempt_count < job.max_attempts
        )
      )
      AND private.domain_job_lifecycle_is_eligible(
        job.kind,
        domain.status,
        integration.status,
        advocate.relationship_status,
        advocate.publication_status
      )
      AND (
        job.kind <> 'deprovision'
        OR job.provider <> 'vercel'
        OR private.cloudflare_dns_removal_is_verified(job.domain_id)
      )
    ORDER BY
      CASE WHEN job.status = 'running' THEN 0 ELSE 1 END,
      job.run_after,
      job.created_at,
      job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT batch_size
  ), claimed AS (
    UPDATE public.domain_provisioning_jobs job
    SET
      status = 'running',
      attempt_count = job.attempt_count + 1,
      lease_owner = worker_id,
      lease_token = gen_random_uuid(),
      leased_at = v_now,
      lease_expires_at = v_now + lease_duration,
      started_at = COALESCE(job.started_at, v_now),
      finished_at = NULL,
      reconciliation_required = true,
      reconciliation_outcome = NULL,
      reconciled_at = NULL,
      result_payload = '{}'::jsonb,
      last_error = NULL,
      settlement_lease_token_digest = NULL,
      settlement_fingerprint = NULL,
      settlement_schema_version = NULL
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  )
  SELECT
    claimed.id,
    claimed.advocate_id,
    claimed.domain_id,
    claimed.integration_id,
    claimed.kind,
    claimed.provider,
    claimed.attempt_count,
    claimed.max_attempts,
    claimed.provider_idempotency_key,
    claimed.request_payload,
    claimed.lease_token,
    claimed.lease_expires_at,
    claimed.reconciliation_required
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_domain_provisioning_jobs(text, integer, interval)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_domain_provisioning_jobs(text, integer, interval)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_domain_provisioning_job(
  target_job_id uuid,
  target_lease_token uuid,
  completion_status public.domain_provisioning_job_status,
  completion_code text DEFAULT NULL,
  provider_result jsonb DEFAULT '{}'::jsonb
)
RETURNS public.domain_provisioning_job_status
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
  v_relationship_status public.advocate_relationship_status;
  v_publication_status public.advocate_publication_status;
  v_final_result jsonb;
  v_token_digest bytea;
  v_fingerprint bytea;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF target_job_id IS NULL OR target_lease_token IS NULL THEN
    RAISE EXCEPTION 'Domain provisioning completion proof is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF completion_status IS NULL
     OR completion_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'Completion status must be succeeded or failed'
      USING ERRCODE = '22023';
  END IF;

  IF (completion_status = 'succeeded' AND completion_code IS NOT NULL)
     OR (
       completion_status = 'failed'
       AND (
         completion_code IS NULL
         OR completion_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
       )
     ) THEN
    RAISE EXCEPTION 'Domain provisioning completion code is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_safe_domain_provisioning_payload(
    COALESCE(provider_result, '{}'::jsonb),
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

  v_final_result := v_job.result_payload || COALESCE(provider_result, '{}'::jsonb);
  v_token_digest := extensions.digest(
    pg_catalog.convert_to(target_lease_token::text, 'UTF8'),
    'sha256'
  );
  v_fingerprint := private.domain_settlement_fingerprint(
    v_job.id,
    v_domain.id,
    v_integration.id,
    v_job.kind,
    v_job.provider,
    v_integration.environment,
    v_domain.hostname,
    'complete',
    completion_status,
    completion_code,
    v_final_result
  );

  IF v_job.status IN ('succeeded', 'failed') THEN
    IF v_job.status = completion_status
       AND v_job.settlement_lease_token_digest = v_token_digest
       AND v_job.settlement_fingerprint = v_fingerprint
       AND v_job.settlement_schema_version = 1 THEN
      RETURN v_job.status;
    END IF;

    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM target_lease_token
     OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF completion_status = 'succeeded' AND v_job.reconciliation_required THEN
    RAISE EXCEPTION 'Provider reconciliation is required before successful completion'
      USING ERRCODE = '55000';
  END IF;

  IF completion_status = 'succeeded' THEN
    SELECT advocate.relationship_status, advocate.publication_status
    INTO v_relationship_status, v_publication_status
    FROM public.advocates advocate
    WHERE advocate.id = v_job.advocate_id
    FOR SHARE;

    IF NOT FOUND
       OR NOT private.domain_job_lifecycle_is_eligible(
         v_job.kind,
         v_domain.status,
         v_integration.status,
         v_relationship_status,
         v_publication_status
       ) THEN
      RAISE EXCEPTION 'Domain provider success is no longer lifecycle eligible'
        USING ERRCODE = '55000';
    END IF;

    PERFORM private.assert_verified_domain_provider_result(
      v_job.kind,
      v_job.provider,
      v_integration.environment,
      v_domain.hostname,
      v_final_result
    );

    IF v_job.kind = 'deprovision'
       AND v_job.provider = 'vercel'
       AND NOT private.cloudflare_dns_removal_is_verified(v_domain.id) THEN
      RAISE EXCEPTION 'Cloudflare DNS removal must be verified before Vercel release'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => v_job.lease_owner,
    context_tool => 'domain-provisioning-settlement',
    context_reason => CASE
      WHEN completion_status = 'succeeded'
        THEN 'Atomically settle verified provider success and domain lifecycle'
      ELSE 'Atomically settle terminal provider failure and domain lifecycle'
    END,
    context_metadata => jsonb_build_object(
      'operation', 'complete',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'provider_account_scope', v_integration.environment,
      'domain_hostname', v_domain.hostname,
      'outcome', completion_status::text,
      'retry_count', GREATEST(v_job.attempt_count - 1, 0)
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    status = completion_status,
    lease_owner = NULL,
    lease_token = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    finished_at = v_now,
    result_payload = v_final_result,
    last_error = completion_code,
    settlement_lease_token_digest = v_token_digest,
    settlement_fingerprint = v_fingerprint,
    settlement_schema_version = 1
  WHERE job.id = v_job.id;

  IF completion_status = 'succeeded' THEN
    PERFORM private.apply_domain_job_success(v_job.id, v_final_result, v_now);
  ELSE
    PERFORM private.apply_domain_job_failure(v_job.id, completion_code, v_now);
  END IF;

  RETURN completion_status;
END;
$$;

COMMENT ON FUNCTION public.complete_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_status,
  text,
  jsonb
) IS
  'Lease-fenced atomic provider settlement. Exact allowlisted evidence updates the job, its matching integration, and eligible hostname lifecycle in one transaction; exact terminal replay is idempotent.';

REVOKE ALL ON FUNCTION public.complete_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_status,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_domain_provisioning_job(
  uuid,
  uuid,
  public.domain_provisioning_job_status,
  text,
  jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.retry_domain_provisioning_job(
  target_job_id uuid,
  target_lease_token uuid,
  retry_delay interval,
  retry_code text,
  provider_result jsonb DEFAULT '{}'::jsonb
)
RETURNS public.domain_provisioning_job_status
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
  v_next_status public.domain_provisioning_job_status;
  v_final_result jsonb;
  v_token_digest bytea;
  v_fingerprint bytea;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF target_job_id IS NULL OR target_lease_token IS NULL THEN
    RAISE EXCEPTION 'Domain provisioning retry proof is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF retry_delay IS NULL
     OR retry_delay < interval '1 second'
     OR retry_delay > interval '24 hours' THEN
    RAISE EXCEPTION 'Domain provisioning retry delay must be between 1 second and 24 hours'
      USING ERRCODE = '22023';
  END IF;

  IF retry_code IS NULL
     OR retry_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' THEN
    RAISE EXCEPTION 'Domain provisioning retry code is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.assert_safe_domain_provisioning_payload(
    COALESCE(provider_result, '{}'::jsonb),
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

  SELECT domain.*
  INTO v_domain
  FROM public.advocate_domains domain
  WHERE domain.id = v_job_domain_id
    AND domain.advocate_id = v_job_advocate_id
  FOR UPDATE;

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

  v_next_status := CASE
    WHEN v_job.attempt_count >= v_job.max_attempts
      THEN 'failed'::public.domain_provisioning_job_status
    ELSE 'queued'::public.domain_provisioning_job_status
  END;
  v_final_result := v_job.result_payload || COALESCE(provider_result, '{}'::jsonb);
  v_token_digest := extensions.digest(
    pg_catalog.convert_to(target_lease_token::text, 'UTF8'),
    'sha256'
  );
  v_fingerprint := private.domain_settlement_fingerprint(
    v_job.id,
    v_domain.id,
    v_integration.id,
    v_job.kind,
    v_job.provider,
    v_integration.environment,
    v_domain.hostname,
    'retry',
    v_next_status,
    retry_code,
    v_final_result
  );

  IF v_job.status = 'failed' THEN
    IF v_job.settlement_lease_token_digest = v_token_digest
       AND v_job.settlement_fingerprint = v_fingerprint
       AND v_job.settlement_schema_version = 1 THEN
      RETURN 'failed'::public.domain_provisioning_job_status;
    END IF;

    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_job.status <> 'running'
     OR v_job.lease_token IS DISTINCT FROM target_lease_token
     OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Domain provisioning lease is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => v_job.lease_owner,
    context_tool => 'domain-provisioning-settlement',
    context_reason => CASE
      WHEN v_next_status = 'queued'
        THEN 'Atomically schedule bounded provider retry without asserting readiness'
      ELSE 'Atomically settle exhausted provider retry and domain lifecycle'
    END,
    context_metadata => jsonb_build_object(
      'operation', 'retry',
      'resource_kind', 'domain_provisioning_job',
      'resource_id', v_job.id::text,
      'job_id', v_job.id::text,
      'provider', v_job.provider::text,
      'provider_account_scope', v_integration.environment,
      'domain_hostname', v_domain.hostname,
      'outcome', v_next_status::text,
      'retry_count', v_job.attempt_count
    )
  );

  UPDATE public.domain_provisioning_jobs job
  SET
    status = v_next_status,
    run_after = CASE
      WHEN v_next_status = 'queued' THEN v_now + retry_delay
      ELSE job.run_after
    END,
    lease_owner = NULL,
    lease_token = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    finished_at = CASE WHEN v_next_status = 'failed' THEN v_now ELSE NULL END,
    reconciliation_required = true,
    reconciliation_outcome = NULL,
    reconciled_at = NULL,
    result_payload = v_final_result,
    last_error = retry_code,
    settlement_lease_token_digest = CASE
      WHEN v_next_status = 'failed' THEN v_token_digest
      ELSE NULL
    END,
    settlement_fingerprint = CASE
      WHEN v_next_status = 'failed' THEN v_fingerprint
      ELSE NULL
    END,
    settlement_schema_version = CASE
      WHEN v_next_status = 'failed' THEN 1
      ELSE NULL
    END
  WHERE job.id = v_job.id;

  IF v_next_status = 'failed' THEN
    PERFORM private.apply_domain_job_failure(v_job.id, retry_code, v_now);
  ELSE
    PERFORM private.apply_domain_job_retry(v_job.id);
  END IF;

  RETURN v_next_status;
END;
$$;

COMMENT ON FUNCTION public.retry_domain_provisioning_job(uuid, uuid, interval, text, jsonb) IS
  'Lease-fenced atomic retry. It never creates readiness evidence, updates in-progress lifecycle state, and atomically fails the integration when attempts are exhausted.';

REVOKE ALL ON FUNCTION public.retry_domain_provisioning_job(uuid, uuid, interval, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_domain_provisioning_job(uuid, uuid, interval, text, jsonb)
  TO service_role;

DROP TRIGGER IF EXISTS domain_provisioning_jobs_audit_row_change
  ON public.domain_provisioning_jobs;
CREATE TRIGGER domain_provisioning_jobs_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.domain_provisioning_jobs
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  'provider_idempotency_key',
  'lease_token',
  'request_payload',
  'result_payload',
  'last_error',
  'settlement_lease_token_digest',
  'settlement_fingerprint'
);

DROP TRIGGER IF EXISTS advocate_domain_integrations_audit_row_change
  ON public.advocate_domain_integrations;
CREATE TRIGGER advocate_domain_integrations_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_domain_integrations
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  'provider_metadata',
  'last_error',
  'last_verified_evidence_digest'
);

REVOKE UPDATE, DELETE ON public.advocate_domains FROM service_role;
REVOKE UPDATE, DELETE ON public.advocate_domain_integrations FROM service_role;

COMMENT ON TABLE public.advocate_domain_integrations IS
  'Per-host external provider state. Readiness and disablement are mutated only by the lease-fenced atomic settlement boundary and carry a durable verified job chain.';
COMMENT ON FUNCTION public.claim_domain_provisioning_jobs(text, integer, interval) IS
  'Atomically claims due work with fenced leases. Vercel deprovisioning remains unclaimable until durable Cloudflare absence evidence is committed.';

COMMIT;
