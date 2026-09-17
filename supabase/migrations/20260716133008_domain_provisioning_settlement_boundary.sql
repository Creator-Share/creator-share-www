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

REVOKE ALL ON FUNCTION private.enqueue_domain_provisioning_job_internal(
  uuid,
  uuid,
  public.domain_provisioning_job_kind,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_domain_provisioning_jobs(text, integer, interval)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_domain_provisioning_jobs(text, integer, interval)
  TO service_role;

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
