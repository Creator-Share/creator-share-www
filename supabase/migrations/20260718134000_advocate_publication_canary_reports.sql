BEGIN;

-- Publication canaries cross several external systems. Keep the authorization
-- decision and the provider observations separate: one immutable row binds the
-- exact target before network work begins, and one immutable row records the
-- canonical report after the runner finishes.
CREATE TABLE audit.advocate_publication_canary_starts (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  initiating_user_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  expected_advocate_version bigint NOT NULL,
  domain_id uuid NOT NULL,
  hostname text NOT NULL,
  deployment_id text NOT NULL,
  git_revision text NOT NULL,
  trace_id text NOT NULL,
  admin_reason text NOT NULL,
  provider_evidence_binding_sha256 bytea NOT NULL,
  stripe_us_attempt_id uuid NOT NULL UNIQUE,
  stripe_uk_attempt_id uuid NOT NULL UNIQUE,
  paypal_attempt_id uuid NOT NULL UNIQUE,
  started_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT advocate_publication_canary_starts_version_check CHECK (
    expected_advocate_version > 0
  ),
  CONSTRAINT advocate_publication_canary_starts_hostname_check CHECK (
    hostname = lower(hostname)
    AND char_length(hostname) BETWEEN 1 AND 253
    AND hostname ~
      '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.creatorshare\.com$'
  ),
  CONSTRAINT advocate_publication_canary_starts_deployment_check CHECK (
    deployment_id = btrim(deployment_id)
    AND char_length(deployment_id) BETWEEN 1 AND 255
    AND deployment_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT advocate_publication_canary_starts_revision_check CHECK (
    git_revision ~ '^[0-9a-f]{40}$'
  ),
  CONSTRAINT advocate_publication_canary_starts_trace_check CHECK (
    trace_id = btrim(trace_id)
    AND char_length(trace_id) BETWEEN 1 AND 255
    AND trace_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT advocate_publication_canary_starts_reason_check CHECK (
    admin_reason = btrim(admin_reason)
    AND char_length(admin_reason) BETWEEN 1 AND 2000
  ),
  CONSTRAINT advocate_publication_canary_starts_binding_check CHECK (
    octet_length(provider_evidence_binding_sha256) = 32
  ),
  CONSTRAINT advocate_publication_canary_starts_attempts_distinct_check CHECK (
    stripe_us_attempt_id <> stripe_uk_attempt_id
    AND stripe_us_attempt_id <> paypal_attempt_id
    AND stripe_uk_attempt_id <> paypal_attempt_id
  ),
  CONSTRAINT advocate_publication_canary_starts_completion_binding_unique
    UNIQUE (
      run_id,
      initiating_user_id,
      advocate_id,
      expected_advocate_version,
      domain_id,
      hostname,
      deployment_id,
      git_revision
    )
);

CREATE INDEX advocate_publication_canary_starts_target_idx
  ON audit.advocate_publication_canary_starts (
    advocate_id,
    domain_id,
    started_at DESC
  );

CREATE INDEX advocate_publication_canary_starts_single_flight_idx
  ON audit.advocate_publication_canary_starts (
    advocate_id,
    expected_advocate_version,
    deployment_id,
    git_revision,
    started_at DESC
  );

COMMENT ON TABLE audit.advocate_publication_canary_starts IS
  'Private append-only authorization and provider-evidence binding captured before an exact advocate publication canary performs network work.';
COMMENT ON COLUMN audit.advocate_publication_canary_starts.provider_evidence_binding_sha256 IS
  'SHA256 of the exact ordered five-provider readiness evidence chain locked when the canary began.';
COMMENT ON COLUMN audit.advocate_publication_canary_starts.stripe_us_attempt_id IS
  'Server-issued opaque attempt identity for the nonfinancial Stripe US publication canary.';
COMMENT ON COLUMN audit.advocate_publication_canary_starts.stripe_uk_attempt_id IS
  'Server-issued opaque attempt identity for the nonfinancial Stripe UK publication canary.';
COMMENT ON COLUMN audit.advocate_publication_canary_starts.paypal_attempt_id IS
  'Server-issued opaque attempt identity for the nonfinancial PayPal publication canary.';

CREATE TABLE audit.advocate_publication_canary_reports (
  run_id uuid PRIMARY KEY,
  completion_request_id uuid NOT NULL UNIQUE,
  completing_user_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  expected_advocate_version bigint NOT NULL,
  domain_id uuid NOT NULL,
  hostname text NOT NULL,
  deployment_id text NOT NULL,
  git_revision text NOT NULL,
  outcome text NOT NULL,
  failure_code text,
  completed_at timestamp with time zone NOT NULL,
  canonical_report_text text NOT NULL,
  report_sha256 bytea NOT NULL,
  trace_id text NOT NULL,
  admin_reason text NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT advocate_publication_canary_reports_start_fkey
    FOREIGN KEY (
      run_id,
      completing_user_id,
      advocate_id,
      expected_advocate_version,
      domain_id,
      hostname,
      deployment_id,
      git_revision
    )
    REFERENCES audit.advocate_publication_canary_starts (
      run_id,
      initiating_user_id,
      advocate_id,
      expected_advocate_version,
      domain_id,
      hostname,
      deployment_id,
      git_revision
    )
    ON DELETE RESTRICT,
  CONSTRAINT advocate_publication_canary_reports_outcome_check CHECK (
    outcome IN ('succeeded', 'failed')
  ),
  CONSTRAINT advocate_publication_canary_reports_failure_check CHECK (
    (
      outcome = 'succeeded'
      AND failure_code IS NULL
    )
    OR (
      outcome = 'failed'
      AND failure_code IN (
        'dns_exact_host_failed',
        'tls_exact_host_failed',
        'protected_exact_host_challenge_failed',
        'verifying_tenant_root_not_hidden',
        'unprovisioned_sibling_not_hidden',
        'stripe_us_payment_canary_failed',
        'stripe_uk_payment_canary_failed',
        'paypal_payment_canary_failed'
      )
    )
  ),
  CONSTRAINT advocate_publication_canary_reports_digest_check CHECK (
    octet_length(report_sha256) = 32
    AND report_sha256 = extensions.digest(
      pg_catalog.convert_to(canonical_report_text, 'UTF8'),
      'sha256'
    )
  ),
  CONSTRAINT advocate_publication_canary_reports_size_check CHECK (
    octet_length(canonical_report_text) BETWEEN 2 AND 65536
  ),
  CONSTRAINT advocate_publication_canary_reports_json_check CHECK (
    jsonb_typeof(canonical_report_text::jsonb) = 'object'
  ),
  CONSTRAINT advocate_publication_canary_reports_trace_check CHECK (
    trace_id = btrim(trace_id)
    AND char_length(trace_id) BETWEEN 1 AND 255
    AND trace_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT advocate_publication_canary_reports_reason_check CHECK (
    admin_reason = btrim(admin_reason)
    AND char_length(admin_reason) BETWEEN 1 AND 2000
  ),
  CONSTRAINT advocate_publication_canary_reports_recorded_after_completion_check
    CHECK (recorded_at >= completed_at - interval '1 minute')
);

CREATE INDEX advocate_publication_canary_reports_publishable_idx
  ON audit.advocate_publication_canary_reports (
    advocate_id,
    domain_id,
    deployment_id,
    completed_at DESC
  )
  WHERE outcome = 'succeeded';

COMMENT ON TABLE audit.advocate_publication_canary_reports IS
  'Private append-only exact report bytes, digest, result, administrator provenance, and target binding for one publication canary start.';
COMMENT ON COLUMN audit.advocate_publication_canary_reports.canonical_report_text IS
  'Exact UTF8 version-one runner-canonicalized report text. Its SHA256 is recomputed by both the RPC and a table constraint.';

ALTER TABLE audit.advocate_publication_canary_starts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.advocate_publication_canary_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON audit.advocate_publication_canary_starts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON audit.advocate_publication_canary_reports
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prevent_advocate_publication_canary_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Advocate publication canary evidence is append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_advocate_publication_canary_evidence_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_publication_canary_starts_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.advocate_publication_canary_starts
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_publication_canary_evidence_mutation();

CREATE TRIGGER advocate_publication_canary_starts_no_truncate
BEFORE TRUNCATE ON audit.advocate_publication_canary_starts
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_publication_canary_evidence_mutation();

CREATE TRIGGER advocate_publication_canary_reports_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.advocate_publication_canary_reports
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_publication_canary_evidence_mutation();

CREATE TRIGGER advocate_publication_canary_reports_no_truncate
BEFORE TRUNCATE ON audit.advocate_publication_canary_reports
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_publication_canary_evidence_mutation();

-- Audit the existence and provenance of each forensic row without copying the
-- report body into the general audit ledger.
CREATE TRIGGER advocate_publication_canary_starts_audit_insert
AFTER INSERT ON audit.advocate_publication_canary_starts
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change('advocate_id', '@columns_only');

CREATE TRIGGER advocate_publication_canary_reports_audit_insert
AFTER INSERT ON audit.advocate_publication_canary_reports
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change('advocate_id', '@columns_only');

CREATE OR REPLACE FUNCTION private.jsonb_has_exact_keys(
  source_object jsonb,
  expected_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    jsonb_typeof(source_object) = 'object'
    AND ARRAY(
      SELECT key_name
      FROM jsonb_object_keys(source_object) AS key_name
      ORDER BY key_name
    ) = ARRAY(
      SELECT key_name
      FROM unnest(expected_keys) AS key_name
      ORDER BY key_name
    );
$$;

REVOKE ALL ON FUNCTION private.jsonb_has_exact_keys(jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.advocate_publication_provider_binding_sha256(
  target_advocate_id uuid,
  target_domain_id uuid,
  evidence_observed_at timestamp with time zone
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_integration_count integer;
  v_exact_evidence_count integer;
  v_evidence jsonb;
BEGIN
  IF target_advocate_id IS NULL
     OR target_domain_id IS NULL
     OR evidence_observed_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::integer
  INTO v_total_integration_count
  FROM public.advocate_domain_integrations integration
  WHERE integration.advocate_id = target_advocate_id
    AND integration.domain_id = target_domain_id;

  WITH expected(ordinal, provider, environment) AS (
    VALUES
      (1, 'cloudflare', 'production'),
      (2, 'vercel', 'production'),
      (3, 'stripe_us', 'live'),
      (4, 'stripe_uk', 'live'),
      (5, 'paypal', 'live')
  ), exact_evidence AS (
    SELECT
      expected.ordinal,
      integration.id AS integration_id,
      integration.provider::text AS provider,
      integration.environment,
      integration.ready_at,
      integration.last_verified_job_id,
      integration.last_verified_at,
      integration.last_verified_evidence_digest
    FROM expected
    JOIN public.advocate_domain_integrations integration
      ON integration.advocate_id = target_advocate_id
     AND integration.domain_id = target_domain_id
     AND integration.provider::text = expected.provider
     AND integration.environment = expected.environment
     AND integration.is_required
     AND integration.status = 'ready'
     AND integration.ready_at IS NOT NULL
     AND integration.last_verified_at IS NOT NULL
     AND integration.last_verified_at >=
       evidence_observed_at - interval '30 minutes'
     AND integration.last_verified_at <=
       evidence_observed_at + interval '1 minute'
     AND octet_length(integration.last_verified_evidence_digest) = 32
     AND integration.reconciliation_suppressed_at IS NULL
    JOIN public.domain_provisioning_jobs job
      ON job.id = integration.last_verified_job_id
     AND job.advocate_id = integration.advocate_id
     AND job.domain_id = integration.domain_id
     AND job.integration_id = integration.id
     AND job.provider = integration.provider
     AND job.status = 'succeeded'
     AND job.kind IN ('provision', 'reconcile')
     AND job.result_payload @> '{"verified":true}'::jsonb
  )
  SELECT
    count(*)::integer,
    jsonb_agg(
      jsonb_build_object(
        'ordinal', evidence.ordinal,
        'integration_id', evidence.integration_id,
        'provider', evidence.provider,
        'environment', evidence.environment,
        'ready_at', to_char(
          evidence.ready_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'last_verified_job_id', evidence.last_verified_job_id,
        'last_verified_at', to_char(
          evidence.last_verified_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'evidence_sha256', encode(
          evidence.last_verified_evidence_digest,
          'hex'
        )
      )
      ORDER BY evidence.ordinal
    )
  INTO v_exact_evidence_count, v_evidence
  FROM exact_evidence evidence;

  IF v_total_integration_count <> 5
     OR v_exact_evidence_count <> 5
     OR EXISTS (
       SELECT 1
       FROM public.domain_provisioning_jobs job
       WHERE job.advocate_id = target_advocate_id
         AND job.status IN ('queued', 'running')
     ) THEN
    RETURN NULL;
  END IF;

  RETURN extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_object(
        'schema_version', 1,
        'advocate_id', target_advocate_id,
        'domain_id', target_domain_id,
        'integrations', v_evidence
      )::text,
      'UTF8'
    ),
    'sha256'
  );
END;
$$;

COMMENT ON FUNCTION private.advocate_publication_provider_binding_sha256(
  uuid,
  uuid,
  timestamp with time zone
) IS
  'Returns a digest only for an exact five-provider, fresh, ready, unsuppressed, job-closed publication topology.';

REVOKE ALL ON FUNCTION private.advocate_publication_provider_binding_sha256(
  uuid,
  uuid,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_advocate_publication_canary(
  target_advocate_id uuid,
  target_expected_advocate_version bigint,
  target_request_id uuid,
  target_deployment_id text,
  target_git_revision text,
  target_trace_id text,
  target_admin_reason text
)
RETURNS TABLE (
  run_id uuid,
  advocate_id uuid,
  domain_id uuid,
  hostname text,
  expected_advocate_version bigint,
  deployment_id text,
  revision text,
  stripe_us_attempt_id uuid,
  stripe_uk_attempt_id uuid,
  paypal_attempt_id uuid,
  started_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_role_assignment_id uuid;
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_existing audit.advocate_publication_canary_starts%ROWTYPE;
  v_deployment_id text := btrim($4);
  v_trace_id text := btrim($6);
  v_admin_reason text := btrim($7);
  v_now timestamp with time zone := clock_timestamp();
  v_binding_sha256 bytea;
  v_run_id uuid := gen_random_uuid();
  v_stripe_us_attempt_id uuid := gen_random_uuid();
  v_stripe_uk_attempt_id uuid := gen_random_uuid();
  v_paypal_attempt_id uuid := gen_random_uuid();
  v_started_at timestamp with time zone;
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
     OR $2 IS NULL
     OR $2 < 1
     OR $3 IS NULL
     OR $4 IS NULL
     OR $4 IS DISTINCT FROM v_deployment_id
     OR char_length(v_deployment_id) NOT BETWEEN 1 AND 255
     OR v_deployment_id ~ '[[:cntrl:]]'
     OR $5 IS NULL
     OR $5 !~ '^[0-9a-f]{40}$'
     OR $6 IS NULL
     OR $6 IS DISTINCT FROM v_trace_id
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]'
     OR $7 IS NULL
     OR $7 IS DISTINCT FROM v_admin_reason
     OR char_length(v_admin_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Advocate publication canary start input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  IF NOT private.is_creator_share_super_admin() THEN
    RAISE EXCEPTION 'Creator Share super administrator access changed during canary start'
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
    RAISE EXCEPTION 'Creator Share super administrator access changed during canary start'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = v_actor_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT start.*
  INTO v_existing
  FROM audit.advocate_publication_canary_starts start
  WHERE start.request_id = $3
  FOR SHARE;

  IF FOUND AND (
    v_existing.initiating_user_id IS DISTINCT FROM v_actor_user_id
    OR v_existing.advocate_id IS DISTINCT FROM target_advocate_id
    OR v_existing.expected_advocate_version IS DISTINCT FROM $2
    OR v_existing.deployment_id IS DISTINCT FROM $4
    OR v_existing.git_revision IS DISTINCT FROM $5
    OR v_existing.admin_reason IS DISTINCT FROM $7
  ) THEN
    RAISE EXCEPTION 'Advocate publication canary replay does not match the committed request'
      USING ERRCODE = '40001';
  END IF;

  v_now := clock_timestamp();
  IF v_existing.run_id IS NULL AND EXISTS (
    SELECT 1
    FROM audit.advocate_publication_canary_starts start
    WHERE start.request_id <> $3
      AND start.advocate_id = target_advocate_id
      AND start.expected_advocate_version = $2
      AND start.deployment_id = $4
      AND start.git_revision = $5
      AND start.started_at + interval '30 minutes' > v_now
      AND NOT EXISTS (
        SELECT 1
        FROM audit.advocate_publication_canary_reports report
        WHERE report.run_id = start.run_id
      )
  ) THEN
    RAISE EXCEPTION 'An equivalent advocate publication canary is already in progress'
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

  IF v_advocate.version IS DISTINCT FROM $2 THEN
    RAISE EXCEPTION 'Advocate portal version changed before canary start'
      USING ERRCODE = '40001';
  END IF;

  IF v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN (
       'draft',
       'provisioning',
       'failed',
       'active'
     ) THEN
    RAISE EXCEPTION 'Advocate portal is not eligible for a publication canary'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
      AND domain.is_primary
      AND domain.hostname = v_advocate.slug || '.creatorshare.com'
      AND domain.status = 'verifying'
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during canary start'
      USING ERRCODE = '40001';
  END;

  IF NOT FOUND OR EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
      AND domain.id <> v_domain.id
  ) THEN
    RAISE EXCEPTION 'Exact verifying advocate primary domain does not match'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    PERFORM integration.id
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = v_advocate.id
      AND integration.domain_id = v_domain.id
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
    WHERE integration.advocate_id = v_advocate.id
      AND integration.domain_id = v_domain.id
    ORDER BY integration.provider::text, integration.environment
    FOR SHARE OF job NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during canary start'
      USING ERRCODE = '40001';
  END;

  v_now := clock_timestamp();
  v_binding_sha256 :=
    private.advocate_publication_provider_binding_sha256(
      v_advocate.id,
      v_domain.id,
      v_now
    );

  IF v_binding_sha256 IS NULL THEN
    RAISE EXCEPTION 'Exact five-provider readiness evidence is not publishable'
      USING ERRCODE = '55000';
  END IF;

  IF v_existing.run_id IS NOT NULL THEN
    IF v_existing.domain_id IS DISTINCT FROM v_domain.id
       OR v_existing.hostname IS DISTINCT FROM v_domain.hostname
       OR v_existing.provider_evidence_binding_sha256 IS DISTINCT FROM
          v_binding_sha256 THEN
      RAISE EXCEPTION 'Advocate publication canary replay binding changed'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_existing.run_id,
      v_existing.advocate_id,
      v_existing.domain_id,
      v_existing.hostname,
      v_existing.expected_advocate_version,
      v_existing.deployment_id,
      v_existing.git_revision,
      v_existing.stripe_us_attempt_id,
      v_existing.stripe_uk_attempt_id,
      v_existing.paypal_attempt_id,
      v_existing.started_at;
    RETURN;
  END IF;

  v_started_at := clock_timestamp();

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-publication-canary',
    context_request_id => $3::text,
    context_trace_id => $6,
    context_reason => $7,
    context_metadata => jsonb_build_object(
      'operation', 'begin_publication_canary',
      'resource_kind', 'advocate_publication_canary',
      'resource_id', v_run_id::text,
      'outcome', 'started',
      'correlation_id', v_run_id::text,
      'deployment_id', $4,
      'domain_hostname', v_domain.hostname,
      'publication_binding_sha256', encode(v_binding_sha256, 'hex')
    )
  );

  INSERT INTO audit.advocate_publication_canary_starts (
    run_id,
    request_id,
    initiating_user_id,
    advocate_id,
    expected_advocate_version,
    domain_id,
    hostname,
    deployment_id,
    git_revision,
    trace_id,
    admin_reason,
    provider_evidence_binding_sha256,
    stripe_us_attempt_id,
    stripe_uk_attempt_id,
    paypal_attempt_id,
    started_at
  )
  VALUES (
    v_run_id,
    $3,
    v_actor_user_id,
    v_advocate.id,
    $2,
    v_domain.id,
    v_domain.hostname,
    $4,
    $5,
    $6,
    $7,
    v_binding_sha256,
    v_stripe_us_attempt_id,
    v_stripe_uk_attempt_id,
    v_paypal_attempt_id,
    v_started_at
  );

  RETURN QUERY SELECT
    v_run_id,
    v_advocate.id,
    v_domain.id,
    v_domain.hostname,
    $2,
    $4,
    $5,
    v_stripe_us_attempt_id,
    v_stripe_uk_attempt_id,
    v_paypal_attempt_id,
    v_started_at;
END;
$$;

COMMENT ON FUNCTION public.begin_advocate_publication_canary(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text
) IS
  'Authenticated super-administrator boundary that locks and binds one exact verifying portal and its fresh five-provider evidence before issuing a private canary run and three payment attempt identities.';

REVOKE ALL ON FUNCTION public.begin_advocate_publication_canary(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_advocate_publication_canary(
  uuid,
  bigint,
  uuid,
  text,
  text,
  text,
  text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_advocate_publication_canary(
  target_run_id uuid,
  canonical_report_text text,
  target_report_sha256 bytea,
  target_outcome text,
  target_failure_code text,
  target_completed_at timestamp with time zone,
  target_request_id uuid,
  target_trace_id text,
  target_admin_reason text
)
RETURNS TABLE (
  run_id uuid,
  outcome text,
  report_sha256 bytea,
  completed_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start audit.advocate_publication_canary_starts%ROWTYPE;
  v_existing audit.advocate_publication_canary_reports%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_report jsonb;
  v_report_started_at timestamp with time zone;
  v_report_completed_at timestamp with time zone;
  v_trace_id text := btrim($8);
  v_admin_reason text := btrim($9);
  v_failure_code text := nullif(btrim($5), '');
  v_now timestamp with time zone := clock_timestamp();
  v_current_binding_sha256 bytea;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Publication canary runner service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF $1 IS NULL
     OR $2 IS NULL
     OR octet_length($2) NOT BETWEEN 2 AND 65536
     OR $3 IS NULL
     OR octet_length($3) <> 32
     OR $4 NOT IN ('succeeded', 'failed')
     OR $6 IS NULL
     OR $7 IS NULL
     OR $8 IS NULL
     OR $8 IS DISTINCT FROM v_trace_id
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]'
     OR $9 IS NULL
     OR $9 IS DISTINCT FROM v_admin_reason
     OR char_length(v_admin_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Advocate publication canary completion input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF ($4 = 'succeeded' AND $5 IS NOT NULL)
     OR ($4 = 'failed' AND (
       $5 IS NULL
       OR $5 IS DISTINCT FROM v_failure_code
       OR v_failure_code NOT IN (
         'dns_exact_host_failed',
         'tls_exact_host_failed',
         'protected_exact_host_challenge_failed',
         'verifying_tenant_root_not_hidden',
         'unprovisioned_sibling_not_hidden',
         'stripe_us_payment_canary_failed',
         'stripe_uk_payment_canary_failed',
         'paypal_payment_canary_failed'
       )
     )) THEN
    RAISE EXCEPTION 'Publication canary outcome and failure code do not match'
      USING ERRCODE = '22023';
  END IF;

  IF extensions.digest(
       pg_catalog.convert_to($2, 'UTF8'),
       'sha256'
     ) IS DISTINCT FROM $3 THEN
    RAISE EXCEPTION 'Publication canary report SHA256 does not match its exact UTF8 bytes'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_report := $2::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Publication canary report must be a valid JSON object'
      USING ERRCODE = '22023';
  END;

  IF jsonb_typeof(v_report) <> 'object'
     OR NOT private.jsonb_has_exact_keys(
       v_report,
       ARRAY[
         'schema_version',
         'report_type',
         'canonicalization_version',
         'target',
         'started_at',
         'completed_at',
         'outcome',
         'error_code',
         'safety_claims',
         'steps'
       ]
     )
     OR v_report ->> 'schema_version' <> '1'
     OR v_report ->> 'report_type' <> 'advocate_publication_canary'
     OR v_report ->> 'canonicalization_version' <> '1'
     OR NOT private.jsonb_has_exact_keys(
       v_report -> 'target',
       ARRAY[
         'run_id',
         'advocate_id',
         'domain_id',
         'hostname',
         'expected_advocate_version',
         'deployment_id',
         'revision',
         'payment_attempt_ids'
       ]
     )
     OR NOT private.jsonb_has_exact_keys(
       v_report #> '{target,payment_attempt_ids}',
       ARRAY['stripe_us', 'stripe_uk', 'paypal']
     )
     OR NOT private.jsonb_has_exact_keys(
       v_report -> 'safety_claims',
       ARRAY[
         'financial_charge_attempted',
         'provider_capture_attempted',
         'sponsorship_state_created',
         'webhook_delivery_verified'
       ]
     )
     OR v_report -> 'safety_claims' IS DISTINCT FROM jsonb_build_object(
       'financial_charge_attempted', false,
       'provider_capture_attempted', false,
       'sponsorship_state_created', false,
       'webhook_delivery_verified', false
     )
     OR jsonb_typeof(v_report -> 'steps') <> 'array'
     OR jsonb_array_length(v_report -> 'steps') < 1
     OR v_report ->> 'outcome' IS DISTINCT FROM $4
     OR (
       $4 = 'succeeded'
       AND v_report -> 'error_code' IS DISTINCT FROM 'null'::jsonb
     )
     OR (
       $4 = 'failed'
       AND v_report ->> 'error_code' IS DISTINCT FROM v_failure_code
     ) THEN
    RAISE EXCEPTION 'Publication canary report canonical schema is invalid'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_report_started_at := (v_report ->> 'started_at')::timestamp with time zone;
    v_report_completed_at :=
      (v_report ->> 'completed_at')::timestamp with time zone;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Publication canary report timestamps are invalid'
      USING ERRCODE = '22023';
  END;

  IF v_report_completed_at IS DISTINCT FROM $6 THEN
    RAISE EXCEPTION 'Publication canary report completion timestamp does not match'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Publication canary runner authority changed during completion'
      USING ERRCODE = '40001';
  END IF;

  SELECT start.*
  INTO v_start
  FROM audit.advocate_publication_canary_starts start
  WHERE start.run_id = $1
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate publication canary run does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_start.admin_reason IS DISTINCT FROM $9 THEN
    RAISE EXCEPTION 'Advocate publication canary completion reason changed'
      USING ERRCODE = '40001';
  END IF;

  SELECT report.*
  INTO v_existing
  FROM audit.advocate_publication_canary_reports report
  WHERE report.run_id = $1
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.completing_user_id IS DISTINCT FROM
          v_start.initiating_user_id
       OR v_existing.completion_request_id IS DISTINCT FROM $7
       OR v_existing.canonical_report_text IS DISTINCT FROM $2
       OR v_existing.report_sha256 IS DISTINCT FROM $3
       OR v_existing.outcome IS DISTINCT FROM $4
       OR v_existing.failure_code IS DISTINCT FROM v_failure_code
       OR v_existing.completed_at IS DISTINCT FROM $6
       OR v_existing.admin_reason IS DISTINCT FROM $9 THEN
      RAISE EXCEPTION 'Advocate publication canary completion replay conflicts'
        USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_existing.run_id,
      v_existing.outcome,
      v_existing.report_sha256,
      v_existing.completed_at;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM audit.advocate_publication_canary_reports report
    WHERE report.completion_request_id = $7
  ) THEN
    RAISE EXCEPTION 'Publication canary completion request is already bound'
      USING ERRCODE = '40001';
  END IF;

  v_now := clock_timestamp();
  IF v_start.started_at < v_now - interval '30 minutes'
     OR v_start.started_at > v_now + interval '1 minute'
     OR $6 < v_start.started_at - interval '1 second'
     OR $6 > v_start.started_at + interval '30 minutes'
     OR $6 < v_now - interval '30 minutes'
     OR $6 > v_now + interval '1 minute' THEN
    RAISE EXCEPTION 'Publication canary start or completion is stale'
      USING ERRCODE = '55000';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = v_start.advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_advocate.version IS DISTINCT FROM
        v_start.expected_advocate_version
     OR v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN (
       'draft',
       'provisioning',
       'failed',
       'active'
     ) THEN
    RAISE EXCEPTION 'Advocate publication canary target changed before completion'
      USING ERRCODE = '40001';
  END IF;

  BEGIN
    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.id = v_start.domain_id
      AND domain.advocate_id = v_start.advocate_id
      AND domain.is_primary
      AND domain.hostname = v_start.hostname
      AND domain.status = 'verifying'
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during canary completion'
      USING ERRCODE = '40001';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate publication canary domain changed before completion'
      USING ERRCODE = '40001';
  END IF;

  BEGIN
    PERFORM integration.id
    FROM public.advocate_domain_integrations integration
    WHERE integration.advocate_id = v_start.advocate_id
      AND integration.domain_id = v_start.domain_id
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
    WHERE integration.advocate_id = v_start.advocate_id
      AND integration.domain_id = v_start.domain_id
    ORDER BY integration.provider::text, integration.environment
    FOR SHARE OF job NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during canary completion'
      USING ERRCODE = '40001';
  END;

  v_current_binding_sha256 :=
    private.advocate_publication_provider_binding_sha256(
      v_start.advocate_id,
      v_start.domain_id,
      v_now
    );

  IF v_current_binding_sha256 IS NULL
     OR v_current_binding_sha256 IS DISTINCT FROM
        v_start.provider_evidence_binding_sha256 THEN
    RAISE EXCEPTION 'Publication canary provider evidence binding changed'
      USING ERRCODE = '40001';
  END IF;

  -- A durable worker may begin or reclaim execution well after the immutable
  -- authorization start. Keep this lower validator truthful to the overall
  -- run window. The lease-fenced wrapper added by the next migration binds the
  -- actual execution start to its current owner.
  IF v_report_started_at < v_start.started_at - interval '1 second'
     OR v_report_started_at > v_start.started_at + interval '30 minutes'
     OR v_report_completed_at < v_report_started_at
     OR v_report_completed_at > v_report_started_at + interval '30 minutes' THEN
    RAISE EXCEPTION 'Publication canary report timestamp binding is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_report #>> '{target,run_id}' IS DISTINCT FROM v_start.run_id::text
     OR v_report #>> '{target,advocate_id}' IS DISTINCT FROM
        v_start.advocate_id::text
     OR v_report #>> '{target,domain_id}' IS DISTINCT FROM
        v_start.domain_id::text
     OR v_report #>> '{target,hostname}' IS DISTINCT FROM v_start.hostname
     OR v_report #>> '{target,expected_advocate_version}' IS DISTINCT FROM
        v_start.expected_advocate_version::text
     OR v_report #>> '{target,deployment_id}' IS DISTINCT FROM
        v_start.deployment_id
     OR v_report #>> '{target,revision}' IS DISTINCT FROM
        v_start.git_revision
     OR v_report #>> '{target,payment_attempt_ids,stripe_us}' IS DISTINCT FROM
        v_start.stripe_us_attempt_id::text
     OR v_report #>> '{target,payment_attempt_ids,stripe_uk}' IS DISTINCT FROM
        v_start.stripe_uk_attempt_id::text
     OR v_report #>> '{target,payment_attempt_ids,paypal}' IS DISTINCT FROM
        v_start.paypal_attempt_id::text THEN
    RAISE EXCEPTION 'Publication canary report target binding does not match its start'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_effective_user_id => v_start.initiating_user_id,
    context_system_actor => 'advocate-publication-canary-runner',
    context_tool => 'advocate-publication-canary-runner',
    context_request_id => $7::text,
    context_trace_id => $8,
    context_reason => $9,
    context_metadata => jsonb_build_object(
      'operation', 'complete_publication_canary',
      'resource_kind', 'advocate_publication_canary',
      'resource_id', v_start.run_id::text,
      'outcome', $4,
      'correlation_id', v_start.run_id::text,
      'deployment_id', v_start.deployment_id,
      'domain_hostname', v_start.hostname,
      'evidence_sha256', encode($3, 'hex'),
      'canary_completed_at', to_char(
        $6 AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'publication_binding_sha256', encode(
        v_start.provider_evidence_binding_sha256,
        'hex'
      )
    )
  );

  INSERT INTO audit.advocate_publication_canary_reports (
    run_id,
    completion_request_id,
    completing_user_id,
    advocate_id,
    expected_advocate_version,
    domain_id,
    hostname,
    deployment_id,
    git_revision,
    outcome,
    failure_code,
    completed_at,
    canonical_report_text,
    report_sha256,
    trace_id,
    admin_reason
  )
  VALUES (
    v_start.run_id,
    $7,
    v_start.initiating_user_id,
    v_start.advocate_id,
    v_start.expected_advocate_version,
    v_start.domain_id,
    v_start.hostname,
    v_start.deployment_id,
    v_start.git_revision,
    $4,
    v_failure_code,
    $6,
    $2,
    $3,
    $8,
    $9
  );

  RETURN QUERY SELECT v_start.run_id, $4, $3, $6;
END;
$$;

COMMENT ON FUNCTION public.complete_advocate_publication_canary(
  uuid,
  text,
  bytea,
  text,
  text,
  timestamp with time zone,
  uuid,
  text,
  text
) IS
  'Service-role-only append-only completion boundary that validates exact canonical report bytes, SHA256, target, deployment, revision, timing, safety claims, and unchanged provider evidence while retaining the initiating administrator as forensic provenance.';

REVOKE ALL ON FUNCTION public.complete_advocate_publication_canary(
  uuid,
  text,
  bytea,
  text,
  text,
  timestamp with time zone,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_advocate_publication_canary(
  uuid,
  text,
  bytea,
  text,
  text,
  timestamp with time zone,
  uuid,
  text,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION private.advocate_publication_canary_report_is_publishable(
  target_advocate_id uuid,
  target_domain_id uuid,
  target_advocate_version bigint,
  target_deployment_id text,
  target_report_sha256 bytea
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM audit.advocate_publication_canary_reports report
    JOIN audit.advocate_publication_canary_starts start
      ON start.run_id = report.run_id
     AND start.initiating_user_id = report.completing_user_id
     AND start.advocate_id = report.advocate_id
     AND start.expected_advocate_version = report.expected_advocate_version
     AND start.domain_id = report.domain_id
     AND start.hostname = report.hostname
     AND start.deployment_id = report.deployment_id
     AND start.git_revision = report.git_revision
    JOIN public.advocates advocate
      ON advocate.id = start.advocate_id
     AND advocate.version = start.expected_advocate_version
     AND advocate.relationship_status = 'active'
     AND advocate.publication_status IN (
       'draft',
       'provisioning',
       'failed',
       'active'
     )
    JOIN public.advocate_domains domain
      ON domain.id = start.domain_id
     AND domain.advocate_id = start.advocate_id
     AND domain.is_primary
     AND domain.hostname = start.hostname
     AND domain.status = 'verifying'
    WHERE start.advocate_id = target_advocate_id
      AND start.domain_id = target_domain_id
      AND start.expected_advocate_version = target_advocate_version
      AND start.deployment_id = target_deployment_id
      AND report.report_sha256 = target_report_sha256
      AND report.outcome = 'succeeded'
      AND report.failure_code IS NULL
      AND start.started_at >= statement_timestamp() - interval '30 minutes'
      AND start.started_at <= statement_timestamp() + interval '1 minute'
      AND report.completed_at >= start.started_at - interval '1 second'
      AND report.completed_at <= start.started_at + interval '30 minutes'
      AND report.completed_at >=
        statement_timestamp() - interval '30 minutes'
      AND report.completed_at <=
        statement_timestamp() + interval '1 minute'
      AND private.advocate_publication_provider_binding_sha256(
        start.advocate_id,
        start.domain_id,
        statement_timestamp()
      ) = start.provider_evidence_binding_sha256
  );
$$;

COMMENT ON FUNCTION private.advocate_publication_canary_report_is_publishable(
  uuid,
  uuid,
  bigint,
  text,
  bytea
) IS
  'Stable private proof that one exact successful recent report still matches its nonpublic portal version, deployment, digest, and unchanged five-provider evidence.';

REVOKE ALL ON FUNCTION private.advocate_publication_canary_report_is_publishable(
  uuid,
  uuid,
  bigint,
  text,
  bytea
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
