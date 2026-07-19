BEGIN;

-- A publication response can be lost after the transaction commits. Retain
-- one immutable receipt so an exact retry can return the committed version
-- without reusing a canary after the domain has already become public.
CREATE TABLE audit.advocate_publication_approvals (
  request_id uuid PRIMARY KEY,
  canary_run_id uuid NOT NULL UNIQUE,
  approving_user_id uuid NOT NULL,
  advocate_id uuid NOT NULL,
  expected_advocate_version bigint NOT NULL,
  resulting_advocate_version bigint NOT NULL,
  domain_id uuid NOT NULL,
  hostname text NOT NULL,
  deployment_id text NOT NULL,
  report_sha256 bytea NOT NULL,
  canary_completed_at timestamp with time zone NOT NULL,
  provider_evidence_binding_sha256 bytea NOT NULL,
  publication_binding_sha256 bytea NOT NULL,
  admin_reason text NOT NULL,
  trace_id text NOT NULL,
  approved_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT advocate_publication_approvals_version_check CHECK (
    expected_advocate_version > 0
    AND resulting_advocate_version > expected_advocate_version
    AND resulting_advocate_version <= expected_advocate_version + 2
  ),
  CONSTRAINT advocate_publication_approvals_hostname_check CHECK (
    hostname = lower(hostname)
    AND char_length(hostname) BETWEEN 1 AND 253
    AND hostname ~
      '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.creatorshare\.com$'
  ),
  CONSTRAINT advocate_publication_approvals_deployment_check CHECK (
    deployment_id = btrim(deployment_id)
    AND char_length(deployment_id) BETWEEN 1 AND 255
    AND deployment_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT advocate_publication_approvals_digests_check CHECK (
    octet_length(report_sha256) = 32
    AND octet_length(provider_evidence_binding_sha256) = 32
    AND octet_length(publication_binding_sha256) = 32
  ),
  CONSTRAINT advocate_publication_approvals_reason_check CHECK (
    admin_reason = btrim(admin_reason)
    AND char_length(admin_reason) BETWEEN 1 AND 2000
  ),
  CONSTRAINT advocate_publication_approvals_trace_check CHECK (
    trace_id = btrim(trace_id)
    AND char_length(trace_id) BETWEEN 1 AND 255
    AND trace_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT advocate_publication_approvals_time_check CHECK (
    approved_at >= canary_completed_at - interval '1 minute'
  )
);

CREATE INDEX advocate_publication_approvals_advocate_idx
  ON audit.advocate_publication_approvals (
    advocate_id,
    approved_at DESC
  );

COMMENT ON TABLE audit.advocate_publication_approvals IS
  'Private append-only publication receipt binding one administrator request and one completed canary to the exact domain activation and resulting advocate version.';
COMMENT ON COLUMN audit.advocate_publication_approvals.publication_binding_sha256 IS
  'SHA256 of the immutable administrator, canary, deployment, domain, version, request, trace, reason, completion, report, and provider-evidence publication inputs.';

ALTER TABLE audit.advocate_publication_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit.advocate_publication_approvals
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prevent_advocate_publication_approval_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Advocate publication approvals are append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_advocate_publication_approval_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_advocate_publication_approval_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM audit.advocate_publication_canary_reports report
  JOIN audit.advocate_publication_canary_starts start
    ON start.run_id = report.run_id
   AND start.advocate_id = report.advocate_id
   AND start.expected_advocate_version = report.expected_advocate_version
   AND start.domain_id = report.domain_id
   AND start.hostname = report.hostname
   AND start.deployment_id = report.deployment_id
  WHERE report.run_id = NEW.canary_run_id
    AND report.outcome = 'succeeded'
    AND report.failure_code IS NULL
    AND report.advocate_id = NEW.advocate_id
    AND report.expected_advocate_version = NEW.expected_advocate_version
    AND report.domain_id = NEW.domain_id
    AND report.hostname = NEW.hostname
    AND report.deployment_id = NEW.deployment_id
    AND report.report_sha256 = NEW.report_sha256
    AND report.completed_at = NEW.canary_completed_at
    AND report.admin_reason = NEW.admin_reason
    AND start.admin_reason = NEW.admin_reason
    AND start.provider_evidence_binding_sha256 =
      NEW.provider_evidence_binding_sha256;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publication approval receipt does not match a successful canary'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_advocate_publication_approval_receipt()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_publication_approvals_validate_insert
BEFORE INSERT ON audit.advocate_publication_approvals
FOR EACH ROW
EXECUTE FUNCTION private.validate_advocate_publication_approval_receipt();

CREATE TRIGGER advocate_publication_approvals_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit.advocate_publication_approvals
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_publication_approval_mutation();

CREATE TRIGGER advocate_publication_approvals_no_truncate
BEFORE TRUNCATE ON audit.advocate_publication_approvals
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_advocate_publication_approval_mutation();

CREATE TRIGGER advocate_publication_approvals_audit_insert
AFTER INSERT ON audit.advocate_publication_approvals
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change('advocate_id', '@columns_only');

-- A durable lease serializes the expensive external runner. The table is not
-- directly available to any runtime role. Every claim, reclaim, and terminal
-- completion is both transactionally fenced and captured by the audit layer.
CREATE TABLE audit.advocate_publication_canary_execution_leases (
  run_id uuid PRIMARY KEY,
  advocate_id uuid NOT NULL,
  domain_id uuid NOT NULL,
  start_request_id uuid NOT NULL UNIQUE,
  lease_token uuid NOT NULL UNIQUE,
  lease_version bigint NOT NULL DEFAULT 1,
  leased_at timestamp with time zone NOT NULL,
  leased_until timestamp with time zone NOT NULL,
  completed_at timestamp with time zone,
  completion_request_id uuid UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT advocate_publication_canary_execution_leases_version_check
    CHECK (lease_version > 0),
  CONSTRAINT advocate_publication_canary_execution_leases_window_check
    CHECK (leased_until > leased_at),
  CONSTRAINT advocate_publication_canary_execution_leases_completion_check
    CHECK (
      (
        completed_at IS NULL
        AND completion_request_id IS NULL
      )
      OR (
        completed_at IS NOT NULL
        AND completion_request_id IS NOT NULL
        AND completed_at >= leased_at
      )
    )
);

CREATE INDEX advocate_publication_canary_execution_leases_active_idx
  ON audit.advocate_publication_canary_execution_leases (leased_until)
  WHERE completed_at IS NULL;

COMMENT ON TABLE audit.advocate_publication_canary_execution_leases IS
  'Private durable single-owner execution lease for one immutable publication canary start. Expired work may be reclaimed with a rotated token, while completion is terminal.';
COMMENT ON COLUMN audit.advocate_publication_canary_execution_leases.lease_token IS
  'Opaque server-issued fencing token. A reclaim always rotates it so the previous runner can no longer commit.';

ALTER TABLE audit.advocate_publication_canary_execution_leases
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit.advocate_publication_canary_execution_leases
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_publication_canary_execution_leases_audit_change
AFTER INSERT OR UPDATE ON audit.advocate_publication_canary_execution_leases
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change('advocate_id', '@columns_only');

CREATE OR REPLACE FUNCTION public.claim_advocate_publication_canary_execution(
  target_run_id uuid,
  target_lease_seconds integer
)
RETURNS TABLE (
  lease_token uuid,
  leased_until timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start audit.advocate_publication_canary_starts%ROWTYPE;
  v_lease audit.advocate_publication_canary_execution_leases%ROWTYPE;
  v_now timestamp with time zone;
  v_lease_token uuid;
  v_leased_until timestamp with time zone;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Publication canary runner service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF $1 IS NULL OR $2 IS NULL OR $2 NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Publication canary execution lease input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($1::text, 731927)
  );

  SELECT start.*
  INTO v_start
  FROM audit.advocate_publication_canary_starts start
  WHERE start.run_id = $1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate publication canary start does not exist'
      USING ERRCODE = '23503';
  END IF;

  v_now := clock_timestamp();
  IF v_start.started_at + interval '30 minutes'
       <= v_now + make_interval(secs => $2) THEN
    RAISE EXCEPTION 'Publication canary execution freshness window is insufficient'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM audit.advocate_publication_canary_reports report
    WHERE report.run_id = v_start.run_id
  ) THEN
    RAISE EXCEPTION 'Publication canary execution is already completed'
      USING ERRCODE = '55000';
  END IF;

  SELECT execution_lease.*
  INTO v_lease
  FROM audit.advocate_publication_canary_execution_leases execution_lease
  WHERE execution_lease.run_id = v_start.run_id
  FOR UPDATE;

  IF FOUND AND v_lease.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Publication canary execution is already completed'
      USING ERRCODE = '55000';
  END IF;

  IF FOUND AND v_lease.leased_until > v_now THEN
    RETURN;
  END IF;

  v_lease_token := gen_random_uuid();
  v_leased_until := v_now + make_interval(secs => $2);

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-publication-canary-runner',
    context_tool => 'advocate-publication-canary-execution-lease',
    context_request_id => v_start.request_id::text,
    context_trace_id => v_start.trace_id,
    context_reason => 'Claim exact advocate publication canary execution',
    context_metadata => jsonb_build_object(
      'operation', CASE
        WHEN v_lease.run_id IS NULL THEN 'claim_canary_execution'
        ELSE 'reclaim_canary_execution'
      END,
      'resource_kind', 'advocate_publication_canary',
      'resource_id', v_start.run_id::text,
      'outcome', 'leased',
      'correlation_id', v_start.run_id::text,
      'deployment_id', v_start.deployment_id,
      'domain_hostname', v_start.hostname
    )
  );

  IF v_lease.run_id IS NULL THEN
    INSERT INTO audit.advocate_publication_canary_execution_leases (
      run_id,
      advocate_id,
      domain_id,
      start_request_id,
      lease_token,
      lease_version,
      leased_at,
      leased_until,
      created_at,
      updated_at
    )
    VALUES (
      v_start.run_id,
      v_start.advocate_id,
      v_start.domain_id,
      v_start.request_id,
      v_lease_token,
      1,
      v_now,
      v_leased_until,
      v_now,
      v_now
    );
  ELSE
    UPDATE audit.advocate_publication_canary_execution_leases execution_lease
    SET
      lease_token = v_lease_token,
      lease_version = execution_lease.lease_version + 1,
      leased_at = v_now,
      leased_until = v_leased_until,
      updated_at = v_now
    WHERE execution_lease.run_id = v_start.run_id
      AND execution_lease.lease_token = v_lease.lease_token
      AND execution_lease.completed_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Publication canary execution lease changed during reclaim'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN QUERY SELECT v_lease_token, v_leased_until;
END;
$$;

COMMENT ON FUNCTION public.claim_advocate_publication_canary_execution(
  uuid,
  integer
) IS
  'Service-role-only durable execution claim. Returns one opaque fencing token for a new or expired incomplete run, zero rows while another unexpired owner holds it, and rejects completed runs.';

REVOKE ALL ON FUNCTION public.claim_advocate_publication_canary_execution(
  uuid,
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_advocate_publication_canary_execution(
  uuid,
  integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_next_advocate_publication_canary_execution(
  target_deployment_id text,
  target_git_revision text,
  target_lease_seconds integer
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
  started_at timestamp with time zone,
  start_request_id uuid,
  trace_id text,
  admin_reason text,
  lease_token uuid,
  leased_until timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deployment_id text := btrim($1);
  v_start audit.advocate_publication_canary_starts%ROWTYPE;
  v_lease_token uuid;
  v_leased_until timestamp with time zone;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Publication canary runner service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF $1 IS NULL
     OR $1 IS DISTINCT FROM v_deployment_id
     OR char_length(v_deployment_id) NOT BETWEEN 1 AND 255
     OR v_deployment_id ~ '[[:cntrl:]]'
     OR $2 IS NULL
     OR $2 !~ '^[0-9a-f]{40}$'
     OR $3 IS NULL
     OR $3 NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Publication canary queue claim input is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Queue claims for one exact deployment and revision serialize only during
  -- their short database transaction. Different deployments remain
  -- independent, while the per-run claim below also fences direct retries.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_deployment_id || ':' || $2,
      731928
    )
  );

  LOOP
    v_start := NULL;
    v_lease_token := NULL;
    v_leased_until := NULL;

    SELECT start.*
    INTO v_start
    FROM audit.advocate_publication_canary_starts start
    LEFT JOIN audit.advocate_publication_canary_execution_leases execution_lease
      ON execution_lease.run_id = start.run_id
    WHERE start.deployment_id = v_deployment_id
      AND start.git_revision = $2
      AND start.started_at + interval '30 minutes'
        > clock_timestamp() + make_interval(secs => $3)
      AND NOT EXISTS (
        SELECT 1
        FROM audit.advocate_publication_canary_reports report
        WHERE report.run_id = start.run_id
      )
      AND (
        execution_lease.run_id IS NULL
        OR (
          execution_lease.completed_at IS NULL
          AND execution_lease.leased_until <= clock_timestamp()
        )
    )
    ORDER BY start.started_at, start.run_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN;
    END IF;

    BEGIN
      SELECT claim.lease_token, claim.leased_until
      INTO v_lease_token, v_leased_until
      FROM public.claim_advocate_publication_canary_execution(
        v_start.run_id,
        $3
      ) claim;
    EXCEPTION WHEN SQLSTATE '55000' THEN
      v_lease_token := NULL;
      v_leased_until := NULL;
    END;

    IF v_lease_token IS NOT NULL THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    v_start.run_id,
    v_start.advocate_id,
    v_start.domain_id,
    v_start.hostname,
    v_start.expected_advocate_version,
    v_start.deployment_id,
    v_start.git_revision,
    v_start.stripe_us_attempt_id,
    v_start.stripe_uk_attempt_id,
    v_start.paypal_attempt_id,
    v_start.started_at,
    v_start.request_id,
    v_start.trace_id,
    v_start.admin_reason,
    v_lease_token,
    v_leased_until;
END;
$$;

COMMENT ON FUNCTION public.claim_next_advocate_publication_canary_execution(
  text,
  text,
  integer
) IS
  'Service-role-only atomic FIFO queue claim for the oldest incomplete canary start matching one exact deployment and revision. Active leases are skipped, expired leases rotate their fencing token, and zero rows means no eligible work.';

REVOKE ALL ON FUNCTION public.claim_next_advocate_publication_canary_execution(
  text,
  text,
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_advocate_publication_canary_execution(
  text,
  text,
  integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_claimed_advocate_publication_canary(
  target_run_id uuid,
  canonical_report_text text,
  target_report_sha256 bytea,
  target_outcome text,
  target_failure_code text,
  target_completed_at timestamp with time zone,
  target_request_id uuid,
  target_trace_id text,
  target_admin_reason text,
  target_lease_token uuid
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
  v_lease audit.advocate_publication_canary_execution_leases%ROWTYPE;
  v_result_run_id uuid;
  v_result_outcome text;
  v_result_report_sha256 bytea;
  v_result_completed_at timestamp with time zone;
  v_report_started_at timestamp with time zone;
  v_now timestamp with time zone;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Publication canary runner service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF $1 IS NULL OR $10 IS NULL THEN
    RAISE EXCEPTION 'Publication canary execution lease identity is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended($1::text, 731927)
  );

  SELECT execution_lease.*
  INTO v_lease
  FROM audit.advocate_publication_canary_execution_leases execution_lease
  WHERE execution_lease.run_id = $1
  FOR UPDATE;

  IF NOT FOUND OR v_lease.lease_token IS DISTINCT FROM $10 THEN
    RAISE EXCEPTION 'Publication canary execution lease does not match'
      USING ERRCODE = '40001';
  END IF;

  IF v_lease.completed_at IS NOT NULL OR EXISTS (
    SELECT 1
    FROM audit.advocate_publication_canary_reports report
    WHERE report.run_id = v_lease.run_id
  ) THEN
    RAISE EXCEPTION 'Publication canary execution is already completed'
      USING ERRCODE = '55000';
  END IF;

  v_now := clock_timestamp();
  IF v_lease.leased_until <= v_now THEN
    RAISE EXCEPTION 'Publication canary execution lease expired'
      USING ERRCODE = '40001';
  END IF;

  BEGIN
    v_report_started_at :=
      ($2::jsonb ->> 'started_at')::timestamp with time zone;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Publication canary lease report start is invalid'
      USING ERRCODE = '22023';
  END;

  -- The canonical runner truncates to milliseconds while PostgreSQL retains
  -- microseconds. Permit one second before the database lease clock and up to
  -- 30 seconds for worker handoff, then require all execution timestamps to
  -- remain inside the current fencing lease.
  IF v_report_started_at < v_lease.leased_at - interval '1 second'
     OR v_report_started_at > v_lease.leased_at + interval '30 seconds'
     OR v_report_started_at >= v_lease.leased_until
     OR $6 IS NULL
     OR v_report_started_at > $6
     OR $6 > v_lease.leased_until THEN
    RAISE EXCEPTION 'Publication canary report start does not match the current execution lease'
      USING ERRCODE = '40001';
  END IF;

  SELECT
    completion.run_id,
    completion.outcome,
    completion.report_sha256,
    completion.completed_at
  INTO
    v_result_run_id,
    v_result_outcome,
    v_result_report_sha256,
    v_result_completed_at
  FROM public.complete_advocate_publication_canary(
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9
  ) completion;

  IF v_result_run_id IS NULL THEN
    RAISE EXCEPTION 'Publication canary completion returned no result'
      USING ERRCODE = '55000';
  END IF;

  UPDATE audit.advocate_publication_canary_execution_leases execution_lease
  SET
    completed_at = clock_timestamp(),
    completion_request_id = $7,
    updated_at = clock_timestamp()
  WHERE execution_lease.run_id = v_lease.run_id
    AND execution_lease.lease_token = v_lease.lease_token
    AND execution_lease.completed_at IS NULL
    AND execution_lease.leased_until > clock_timestamp();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publication canary execution lease changed during completion'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    v_result_run_id,
    v_result_outcome,
    v_result_report_sha256,
    v_result_completed_at;
END;
$$;

COMMENT ON FUNCTION public.complete_claimed_advocate_publication_canary(
  uuid,
  text,
  bytea,
  text,
  text,
  timestamp with time zone,
  uuid,
  text,
  text,
  uuid
) IS
  'Service-role-only terminal boundary that fences completion with the exact current unexpired execution lease, commits the immutable canary report through the existing validator, and marks the lease terminal in the same transaction.';

REVOKE ALL ON FUNCTION public.complete_claimed_advocate_publication_canary(
  uuid,
  text,
  bytea,
  text,
  text,
  timestamp with time zone,
  uuid,
  text,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_claimed_advocate_publication_canary(
  uuid,
  text,
  bytea,
  text,
  text,
  timestamp with time zone,
  uuid,
  text,
  text,
  uuid
) TO service_role;

-- The lower-level validator remains owner-callable by the wrapper but is no
-- longer directly callable by any application runtime role.
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

-- This is the only server-side recovery view of canary execution state. It is
-- keyed by the deterministic begin request rather than the run so a transport
-- retry can discover a lost start response. The report bytes, administrator,
-- reason, trace, and provider evidence remain private.
CREATE OR REPLACE FUNCTION public.get_advocate_publication_canary_execution(
  target_request_id uuid
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
  started_at timestamp with time zone,
  outcome text,
  failure_code text,
  report_sha256 bytea,
  completed_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Publication canary runner service role is required'
      USING ERRCODE = '42501';
  END IF;

  IF target_request_id IS NULL THEN
    RAISE EXCEPTION 'Publication canary request identity is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    start.run_id,
    start.advocate_id,
    start.domain_id,
    start.hostname,
    start.expected_advocate_version,
    start.deployment_id,
    start.git_revision,
    start.stripe_us_attempt_id,
    start.stripe_uk_attempt_id,
    start.paypal_attempt_id,
    start.started_at,
    report.outcome,
    report.failure_code,
    report.report_sha256,
    report.completed_at
  FROM audit.advocate_publication_canary_starts start
  LEFT JOIN audit.advocate_publication_canary_reports report
    ON report.run_id = start.run_id
  WHERE start.request_id = target_request_id;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_publication_canary_execution(uuid) IS
  'Service-role-only bounded recovery lookup for one deterministic canary begin request. Returns its immutable target and payment attempt identities plus an optional completion summary, never report bytes or administrator and provider evidence.';

REVOKE ALL ON FUNCTION public.get_advocate_publication_canary_execution(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_advocate_publication_canary_execution(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.publish_advocate_portal_from_canary(
  target_advocate_id uuid,
  target_expected_advocate_version bigint,
  target_canary_run_id uuid,
  target_deployment_id text,
  target_report_sha256 bytea,
  target_admin_reason text,
  target_request_id uuid,
  target_trace_id text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_deployment_id text := btrim($4);
  v_admin_reason text := btrim($6);
  v_trace_id text := btrim($8);
  v_advocate public.advocates%ROWTYPE;
  v_domain public.advocate_domains%ROWTYPE;
  v_start audit.advocate_publication_canary_starts%ROWTYPE;
  v_report audit.advocate_publication_canary_reports%ROWTYPE;
  v_existing audit.advocate_publication_approvals%ROWTYPE;
  v_run_approval audit.advocate_publication_approvals%ROWTYPE;
  v_role_assignment_id uuid;
  v_current_provider_binding_sha256 bytea;
  v_publication_binding_sha256 bytea;
  v_resulting_version bigint;
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

  IF $1 IS NULL
     OR $2 IS NULL
     OR $2 < 1
     OR $3 IS NULL
     OR $4 IS NULL
     OR $4 IS DISTINCT FROM v_deployment_id
     OR char_length(v_deployment_id) NOT BETWEEN 1 AND 255
     OR v_deployment_id ~ '[[:cntrl:]]'
     OR $5 IS NULL
     OR octet_length($5) <> 32
     OR $6 IS NULL
     OR $6 IS DISTINCT FROM v_admin_reason
     OR char_length(v_admin_reason) NOT BETWEEN 1 AND 2000
     OR $7 IS NULL
     OR $8 IS NULL
     OR $8 IS DISTINCT FROM v_trace_id
     OR char_length(v_trace_id) NOT BETWEEN 1 AND 255
     OR v_trace_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Advocate publication approval input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(112927, 1);

  SELECT approval.*
  INTO v_existing
  FROM audit.advocate_publication_approvals approval
  WHERE approval.request_id = $7;

  IF FOUND AND (
    v_existing.approving_user_id IS DISTINCT FROM v_actor_user_id
    OR v_existing.advocate_id IS DISTINCT FROM $1
    OR v_existing.expected_advocate_version IS DISTINCT FROM $2
    OR v_existing.canary_run_id IS DISTINCT FROM $3
    OR v_existing.deployment_id IS DISTINCT FROM $4
    OR v_existing.report_sha256 IS DISTINCT FROM $5
    OR v_existing.admin_reason IS DISTINCT FROM $6
  ) THEN
    RAISE EXCEPTION 'Advocate publication approval replay does not match the committed request'
      USING ERRCODE = '40001';
  END IF;

  SELECT report.*
  INTO v_report
  FROM audit.advocate_publication_canary_reports report
  WHERE report.run_id = $3;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completed advocate publication canary does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT start.*
  INTO v_start
  FROM audit.advocate_publication_canary_starts start
  WHERE start.run_id = v_report.run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate publication canary start does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_start.advocate_id IS DISTINCT FROM $1
     OR v_start.expected_advocate_version IS DISTINCT FROM $2
     OR v_start.deployment_id IS DISTINCT FROM $4
     OR v_start.admin_reason IS DISTINCT FROM $6
     OR v_report.advocate_id IS DISTINCT FROM $1
     OR v_report.expected_advocate_version IS DISTINCT FROM $2
     OR v_report.domain_id IS DISTINCT FROM v_start.domain_id
     OR v_report.hostname IS DISTINCT FROM v_start.hostname
     OR v_report.deployment_id IS DISTINCT FROM $4
     OR v_report.admin_reason IS DISTINCT FROM $6
     OR v_report.report_sha256 IS DISTINCT FROM $5 THEN
    RAISE EXCEPTION 'Advocate publication canary does not match the exact approval target'
      USING ERRCODE = '40001';
  END IF;

  IF v_existing.request_id IS NULL THEN
    SELECT approval.*
    INTO v_run_approval
    FROM audit.advocate_publication_approvals approval
    WHERE approval.canary_run_id = $3;

    IF FOUND THEN
      RAISE EXCEPTION 'Advocate publication canary has already been used'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  -- The resource lock order is deliberate. Provider settlement locks in the
  -- inverse direction, so every lock after the advocate uses NOWAIT and turns
  -- overlap into an optimistic retry instead of a deadlock.
  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = $1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal does not exist'
      USING ERRCODE = '23503';
  END IF;

  BEGIN
    SELECT domain.*
    INTO v_domain
    FROM public.advocate_domains domain
    WHERE domain.id = v_start.domain_id
      AND domain.advocate_id = v_advocate.id
      AND domain.is_primary
      AND domain.hostname = v_start.hostname
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Advocate publication evidence changed during approval'
      USING ERRCODE = '40001';
  END;

  IF NOT FOUND OR EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = v_advocate.id
      AND domain.id <> v_domain.id
  ) THEN
    RAISE EXCEPTION 'Exact advocate primary domain does not match'
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
    RAISE EXCEPTION 'Advocate publication evidence changed during approval'
      USING ERRCODE = '40001';
  END;

  -- Reauthorize only after the publication target and every evidence row are
  -- locked. The role and account rows stay share locked until commit.
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
    AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_existing.request_id IS NOT NULL THEN
    IF v_advocate.version IS DISTINCT FROM v_existing.resulting_advocate_version
       OR v_advocate.publication_status <> 'active'
       OR v_domain.status <> 'active'
       OR v_domain.dns_verified_at IS DISTINCT FROM
          v_existing.canary_completed_at
       OR v_domain.tls_ready_at IS DISTINCT FROM
          v_existing.canary_completed_at
       OR v_domain.payments_ready_at IS DISTINCT FROM
          v_existing.canary_completed_at THEN
      RAISE EXCEPTION 'Committed advocate publication state changed before replay'
        USING ERRCODE = '40001';
    END IF;

    RETURN v_existing.resulting_advocate_version;
  END IF;

  IF v_advocate.version IS DISTINCT FROM $2 THEN
    RAISE EXCEPTION 'Advocate portal version changed before publication approval'
      USING ERRCODE = '40001';
  END IF;

  IF v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN (
       'draft',
       'provisioning',
       'failed',
       'active'
     )
     OR v_domain.status <> 'verifying' THEN
    RAISE EXCEPTION 'Advocate portal is not eligible for publication approval'
      USING ERRCODE = '55000';
  END IF;

  v_now := clock_timestamp();
  IF v_report.outcome <> 'succeeded'
     OR v_report.failure_code IS NOT NULL
     OR v_start.started_at < v_now - interval '30 minutes'
     OR v_start.started_at > v_now + interval '1 minute'
     OR v_report.completed_at < v_start.started_at
     OR v_report.completed_at > v_start.started_at + interval '30 minutes'
     OR v_report.completed_at < v_now - interval '30 minutes'
     OR v_report.completed_at > v_now + interval '1 minute' THEN
    RAISE EXCEPTION 'Advocate publication canary is failed or stale'
      USING ERRCODE = '55000';
  END IF;

  IF NOT private.advocate_publication_canary_report_is_publishable(
    v_advocate.id,
    v_domain.id,
    $2,
    $4,
    $5
  ) THEN
    RAISE EXCEPTION 'Advocate publication canary is not publishable'
      USING ERRCODE = '55000';
  END IF;

  v_current_provider_binding_sha256 :=
    private.advocate_publication_provider_binding_sha256(
      v_advocate.id,
      v_domain.id,
      v_now
    );

  IF v_current_provider_binding_sha256 IS NULL
     OR v_current_provider_binding_sha256 IS DISTINCT FROM
        v_start.provider_evidence_binding_sha256 THEN
    RAISE EXCEPTION 'Advocate provider evidence changed after the canary began'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.domain_provisioning_jobs job
    WHERE job.advocate_id = v_advocate.id
      AND job.status IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION 'Advocate publication cannot proceed while provider jobs are open'
      USING ERRCODE = '55000';
  END IF;

  v_publication_binding_sha256 := extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_object(
        'schema_version', 1,
        'approving_user_id', v_actor_user_id,
        'advocate_id', v_advocate.id,
        'expected_advocate_version', $2,
        'canary_run_id', v_start.run_id,
        'domain_id', v_domain.id,
        'domain_hostname', v_domain.hostname,
        'deployment_id', $4,
        'report_sha256', encode($5, 'hex'),
        'canary_completed_at', to_char(
          v_report.completed_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'provider_evidence_binding_sha256', encode(
          v_current_provider_binding_sha256,
          'hex'
        ),
        'request_id', $7,
        'trace_id', $8,
        'admin_reason', $6
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  PERFORM audit.set_actor_context(
    context_actor_type => 'creator_share_admin'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'creator-share-admin-publication',
    context_request_id => $7::text,
    context_trace_id => $8,
    context_reason => $6,
    context_metadata => jsonb_build_object(
      'operation', 'publish_portal_from_canary',
      'resource_kind', 'advocate_domain',
      'resource_id', v_domain.id::text,
      'outcome', 'active',
      'correlation_id', v_start.run_id::text,
      'deployment_id', $4,
      'domain_hostname', v_domain.hostname,
      'evidence_sha256', encode($5, 'hex'),
      'canary_completed_at', to_char(
        v_report.completed_at AT TIME ZONE 'UTC',
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
    v_report.completed_at::text,
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
      AND advocate.version = $2;

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
  RETURNING advocate.version INTO v_resulting_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate portal changed before publication approval'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO audit.advocate_publication_approvals (
    request_id,
    canary_run_id,
    approving_user_id,
    advocate_id,
    expected_advocate_version,
    resulting_advocate_version,
    domain_id,
    hostname,
    deployment_id,
    report_sha256,
    canary_completed_at,
    provider_evidence_binding_sha256,
    publication_binding_sha256,
    admin_reason,
    trace_id,
    approved_at
  )
  VALUES (
    $7,
    v_start.run_id,
    v_actor_user_id,
    v_advocate.id,
    $2,
    v_resulting_version,
    v_domain.id,
    v_domain.hostname,
    $4,
    $5,
    v_report.completed_at,
    v_current_provider_binding_sha256,
    v_publication_binding_sha256,
    $6,
    $8,
    clock_timestamp()
  );

  RETURN v_resulting_version;
END;
$$;

COMMENT ON FUNCTION public.publish_advocate_portal_from_canary(
  uuid,
  bigint,
  uuid,
  text,
  bytea,
  text,
  uuid,
  text
) IS
  'Authenticated healthy global super-administrator boundary that locks and reauthorizes one exact nonpublic portal, requires one exact recent successful completed canary and unchanged five-provider evidence, atomically activates its domain and advocate, and retains an immutable idempotency and forensic receipt.';

REVOKE ALL ON FUNCTION public.publish_advocate_portal_from_canary(
  uuid,
  bigint,
  uuid,
  text,
  bytea,
  text,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_advocate_portal_from_canary(
  uuid,
  bigint,
  uuid,
  text,
  bytea,
  text,
  uuid,
  text
) TO authenticated;

-- Supersede the earlier administrator-attested digest boundary. No runtime
-- role may publish without the exact immutable canary report receipt.
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

COMMIT;
