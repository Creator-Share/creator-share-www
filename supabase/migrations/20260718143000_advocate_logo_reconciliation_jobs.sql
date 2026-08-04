BEGIN;

-- Provider writes can succeed after the request that initiated them loses its
-- response. This queue deletes only immutable logo objects that the database
-- can prove are abandoned. The worker receives one short-lived plaintext
-- fencing token. Only its SHA-256 digest is retained.

DO $$ BEGIN
  CREATE TYPE private.advocate_logo_reconciliation_status AS ENUM (
    'queued',
    'processing',
    'retry_wait',
    'succeeded',
    'exhausted',
    'quarantined'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX advocate_logo_upload_pending_expiry_idx
  ON private.advocate_logo_upload_reservations (expires_at, id)
  WHERE status = 'pending';

CREATE INDEX advocate_logo_upload_cleanup_grace_idx
  ON private.advocate_logo_upload_reservations (
    GREATEST(expires_at, settled_at),
    id
  )
  WHERE status IN ('expired', 'cleanup_required', 'cancelled');

CREATE TABLE private.advocate_logo_reconciliation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE
    REFERENCES private.advocate_logo_upload_reservations(id)
    ON DELETE RESTRICT,
  advocate_id uuid NOT NULL
    REFERENCES public.advocates(id)
    ON DELETE RESTRICT,
  object_path text NOT NULL,
  status private.advocate_logo_reconciliation_status NOT NULL DEFAULT 'queued',
  attempt_count smallint NOT NULL DEFAULT 0,
  maximum_attempts smallint NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  worker_id text,
  lease_token_digest bytea,
  lease_expires_at timestamptz,
  last_failure_code text,
  quarantine_reason_code text,
  terminal_outcome text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT advocate_logo_reconciliation_path_check CHECK (
    object_path ~
      '^logos/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    AND split_part(object_path, '/', 3) = reservation_id::text || '.webp'
  ),
  CONSTRAINT advocate_logo_reconciliation_attempts_check CHECK (
    maximum_attempts = 8
    AND attempt_count BETWEEN 0 AND maximum_attempts
  ),
  CONSTRAINT advocate_logo_reconciliation_worker_check CHECK (
    worker_id IS NULL
    OR (
      worker_id = btrim(worker_id)
      AND char_length(worker_id) BETWEEN 1 AND 120
      AND worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    )
  ),
  CONSTRAINT advocate_logo_reconciliation_lease_check CHECK (
    (
      status = 'processing'
      AND worker_id IS NOT NULL
      AND octet_length(lease_token_digest) = 32
      AND lease_expires_at IS NOT NULL
      AND claimed_at IS NOT NULL
      AND lease_expires_at > claimed_at
      AND lease_expires_at <= claimed_at + interval '120 seconds'
    )
    OR (
      status = 'succeeded'
      AND worker_id IS NOT NULL
      AND octet_length(lease_token_digest) = 32
      AND lease_expires_at IS NULL
      AND claimed_at IS NOT NULL
    )
    OR (
      status NOT IN ('processing', 'succeeded')
      AND worker_id IS NULL
      AND lease_token_digest IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CONSTRAINT advocate_logo_reconciliation_failure_code_check CHECK (
    last_failure_code IS NULL
    OR last_failure_code IN (
      'storage_delete_failed',
      'storage_rate_limited',
      'storage_timeout',
      'storage_unavailable',
      'unexpected_storage_response',
      'worker_interrupted',
      'lease_expired_after_maximum_attempts'
    )
  ),
  CONSTRAINT advocate_logo_reconciliation_quarantine_code_check CHECK (
    quarantine_reason_code IS NULL
    OR quarantine_reason_code IN (
      'advocate_mismatch',
      'branding_path_in_use',
      'object_path_mismatch',
      'reservation_not_cleanup_eligible'
    )
  ),
  CONSTRAINT advocate_logo_reconciliation_outcome_check CHECK (
    terminal_outcome IS NULL
    OR terminal_outcome IN (
      'deleted',
      'already_absent',
      'exhausted',
      'quarantined'
    )
  ),
  CONSTRAINT advocate_logo_reconciliation_lifecycle_check CHECK (
    (
      status = 'queued'
      AND attempt_count = 0
      AND last_failure_code IS NULL
      AND quarantine_reason_code IS NULL
      AND terminal_outcome IS NULL
      AND claimed_at IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'processing'
      AND attempt_count BETWEEN 1 AND maximum_attempts
      AND last_failure_code IS NULL
      AND quarantine_reason_code IS NULL
      AND terminal_outcome IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'retry_wait'
      AND attempt_count BETWEEN 1 AND maximum_attempts - 1
      AND last_failure_code IS NOT NULL
      AND quarantine_reason_code IS NULL
      AND terminal_outcome IS NULL
      AND claimed_at IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'succeeded'
      AND attempt_count BETWEEN 1 AND maximum_attempts
      AND last_failure_code IS NULL
      AND quarantine_reason_code IS NULL
      AND terminal_outcome IN ('deleted', 'already_absent')
      AND claimed_at IS NOT NULL
      AND completed_at IS NOT NULL
    )
    OR (
      status = 'exhausted'
      AND attempt_count = maximum_attempts
      AND last_failure_code IS NOT NULL
      AND quarantine_reason_code IS NULL
      AND terminal_outcome = 'exhausted'
      AND claimed_at IS NOT NULL
      AND completed_at IS NOT NULL
    )
    OR (
      status = 'quarantined'
      AND attempt_count BETWEEN 1 AND maximum_attempts
      AND last_failure_code IS NULL
      AND quarantine_reason_code IS NOT NULL
      AND terminal_outcome = 'quarantined'
      AND claimed_at IS NOT NULL
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT advocate_logo_reconciliation_timestamps_check CHECK (
    updated_at >= created_at
    AND (claimed_at IS NULL OR claimed_at >= created_at)
    AND (completed_at IS NULL OR completed_at >= claimed_at)
  )
);

CREATE INDEX advocate_logo_reconciliation_queue_idx
  ON private.advocate_logo_reconciliation_jobs (
    available_at,
    created_at,
    id
  )
  WHERE status IN ('queued', 'retry_wait', 'processing');

COMMENT ON TABLE private.advocate_logo_reconciliation_jobs IS
  'Default-deny one-to-one queue for deleting only database-proven abandoned immutable advocate logo objects.';
COMMENT ON COLUMN private.advocate_logo_reconciliation_jobs.object_path IS
  'Immutable copy of the exact server-issued reservation path. It is returned only after an active lease passes the deletion authorization fence.';
COMMENT ON COLUMN private.advocate_logo_reconciliation_jobs.lease_token_digest IS
  'SHA-256 digest of the one-time 256-bit worker lease token. Plaintext lease tokens are never persisted.';
COMMENT ON COLUMN private.advocate_logo_reconciliation_jobs.last_failure_code IS
  'Bounded operational code only. Provider responses, object bytes, credentials, and free-form errors are prohibited.';

ALTER TABLE private.advocate_logo_reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_logo_reconciliation_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.advocate_logo_reconciliation_jobs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TYPE private.advocate_logo_reconciliation_status
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.protect_advocate_logo_reconciliation_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := nullif(
    pg_catalog.current_setting(
      'app.advocate_logo_reconciliation.operation',
      true
    ),
    ''
  );
  v_reservation private.advocate_logo_upload_reservations%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Advocate logo reconciliation evidence cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_operation <> 'enqueue'
       OR NEW.status <> 'queued'
       OR NEW.attempt_count <> 0
       OR NEW.maximum_attempts <> 8 THEN
      RAISE EXCEPTION 'Logo reconciliation creation requires the narrow enqueue operation'
        USING ERRCODE = '42501';
    END IF;

    SELECT reservation.*
    INTO v_reservation
    FROM private.advocate_logo_upload_reservations reservation
    WHERE reservation.id = NEW.reservation_id;

    IF NOT FOUND
       OR NEW.advocate_id IS DISTINCT FROM v_reservation.advocate_id
       OR NEW.object_path IS DISTINCT FROM v_reservation.object_path THEN
      RAISE EXCEPTION 'Logo reconciliation identity must match its immutable reservation'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.object_path IS DISTINCT FROM OLD.object_path
     OR NEW.maximum_attempts IS DISTINCT FROM OLD.maximum_attempts
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Logo reconciliation identity and reservation evidence are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF (
    v_operation = 'claim'
    AND NEW.status = 'processing'
    AND NEW.attempt_count = OLD.attempt_count + 1
    AND (
      (OLD.status IN ('queued', 'retry_wait') AND OLD.available_at <= clock_timestamp())
      OR (
        OLD.status = 'processing'
        AND OLD.lease_expires_at <= clock_timestamp()
      )
    )
  ) OR (
    v_operation = 'exhaust'
    AND OLD.status = 'processing'
    AND OLD.attempt_count = OLD.maximum_attempts
    AND OLD.lease_expires_at <= clock_timestamp()
    AND NEW.status = 'exhausted'
    AND NEW.attempt_count = OLD.attempt_count
  ) OR (
    v_operation = 'authorize'
    AND OLD.status = 'processing'
    AND NEW.status = 'quarantined'
    AND NEW.attempt_count = OLD.attempt_count
  ) OR (
    v_operation = 'complete'
    AND OLD.status = 'processing'
    AND NEW.status IN ('succeeded', 'quarantined')
    AND NEW.attempt_count = OLD.attempt_count
  ) OR (
    v_operation = 'fail'
    AND OLD.status = 'processing'
    AND NEW.status IN ('retry_wait', 'exhausted')
    AND NEW.attempt_count = OLD.attempt_count
  ) THEN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Logo reconciliation lifecycle transition is invalid'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.protect_advocate_logo_reconciliation_job()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_logo_reconciliation_jobs_protect
BEFORE INSERT OR UPDATE OR DELETE
ON private.advocate_logo_reconciliation_jobs
FOR EACH ROW EXECUTE FUNCTION private.protect_advocate_logo_reconciliation_job();

CREATE TRIGGER advocate_logo_reconciliation_jobs_no_truncate
BEFORE TRUNCATE ON private.advocate_logo_reconciliation_jobs
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER advocate_logo_reconciliation_jobs_audit_row_change
AFTER INSERT OR UPDATE OR DELETE
ON private.advocate_logo_reconciliation_jobs
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  '@columns_only'
);

-- Reconciliation is operationally sensitive but contains no sponsor data.
-- Portal auditors receive the same columns-only view as other advocate
-- changes, while the raw audit ledger remains private.
CREATE OR REPLACE FUNCTION public.get_advocate_audit_events(
  target_advocate_id uuid,
  before_sequence bigint DEFAULT NULL,
  page_size integer DEFAULT 50
)
RETURNS TABLE (
  sequence_id bigint,
  event_id uuid,
  occurred_at timestamp with time zone,
  table_name text,
  operation audit.audit_operation,
  actor_type audit.audit_actor_type,
  actor_user_id uuid,
  actor_display_name text,
  effective_user_id uuid,
  system_actor text,
  tool text,
  changed_columns text[],
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_advocate_permission(
    target_advocate_id,
    'portal.audit.view'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal audit permission'
      USING ERRCODE = '42501';
  END IF;

  IF page_size IS NULL OR page_size < 1 OR page_size > 200 THEN
    RAISE EXCEPTION 'Audit page size must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    event.sequence_id,
    event.id,
    event.occurred_at,
    event.table_name,
    event.operation,
    event.actor_type,
    event.actor_user_id,
    CASE
      WHEN event.actor_type = 'system' THEN event.system_actor
      WHEN event.actor_user_id IS NOT NULL THEN nullif(
        btrim(
          concat_ws(
            ' ',
            nullif(profile.first_name, ''),
            CASE
              WHEN nullif(profile.last_name, '') IS NOT NULL
                THEN left(profile.last_name, 1) || '.'
              ELSE NULL
            END
          )
        ),
        ''
      )
      ELSE event.actor_type::text
    END AS actor_display_name,
    event.effective_user_id,
    event.system_actor,
    event.tool,
    event.changed_columns,
    event.reason
  FROM audit.audit_events event
  LEFT JOIN public.users profile ON profile.id = event.actor_user_id
  WHERE event.advocate_id = target_advocate_id
    AND event.table_name = ANY (ARRAY[
      'advocates',
      'advocate_domains',
      'advocate_domain_integrations',
      'domain_provisioning_jobs',
      'advocate_branding',
      'advocate_public_metric_selections',
      'advocate_beneficiaries',
      'advocate_memberships',
      'advocate_membership_roles',
      'advocate_invitations',
      'advocate_invitation_roles',
      'advocate_logo_upload_reservations',
      'advocate_logo_reconciliation_jobs'
    ]::text[])
    AND (before_sequence IS NULL OR event.sequence_id < before_sequence)
  ORDER BY event.sequence_id DESC
  LIMIT page_size;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_audit_events(
  uuid,
  bigint,
  integer
) IS
  'Returns only the sanitized advocate-scoped audit ledger, including columns-only logo reservation and reconciliation lifecycle events, to members with portal.audit.view. Raw 90-day forensic evidence is never exposed.';

CREATE OR REPLACE FUNCTION public.claim_advocate_logo_reconciliation_jobs(
  worker_id text,
  batch_size integer,
  request_id text,
  trace_id text DEFAULT NULL
)
RETURNS TABLE (
  job_id uuid,
  reservation_id uuid,
  advocate_id uuid,
  object_path text,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count smallint,
  maximum_attempts smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_worker_id text := nullif(btrim(worker_id), '');
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF v_worker_id IS NULL
     OR v_worker_id IS DISTINCT FROM worker_id
     OR char_length(v_worker_id) > 120
     OR v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     OR batch_size IS NULL
     OR batch_size < 1
     OR batch_size > 20
     OR v_request_id IS NULL
     OR v_request_id IS DISTINCT FROM request_id
     OR char_length(v_request_id) > 255
     OR (
       trace_id IS NOT NULL
       AND (
         v_trace_id IS NULL
         OR v_trace_id IS DISTINCT FROM trace_id
         OR char_length(v_trace_id) > 255
       )
     ) THEN
    RAISE EXCEPTION 'Logo reconciliation claim input is malformed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-logo-reconciliation-worker',
    context_tool => 'advocate-logo-reconciliation',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Expire abandoned logo reservations and claim bounded reconciliation work',
    context_metadata => jsonb_build_object(
      'operation', 'claim',
      'resource_kind', 'advocate_logo_reconciliation_job',
      'outcome', 'claimed'
    )
  );

  -- The reservation row lock races atomically with branding attachment. Exactly
  -- one transaction can turn a pending reservation into attached or expired.
  UPDATE private.advocate_logo_upload_reservations reservation
  SET
    status = 'expired',
    failure_code = 'reservation_expired',
    settled_at = v_now
  WHERE reservation.status = 'pending'
    AND reservation.expires_at <= v_now;

  PERFORM pg_catalog.set_config(
    'app.advocate_logo_reconciliation.operation',
    'enqueue',
    true
  );

  INSERT INTO private.advocate_logo_reconciliation_jobs (
    reservation_id,
    advocate_id,
    object_path,
    available_at,
    created_at,
    updated_at
  )
  SELECT
    reservation.id,
    reservation.advocate_id,
    reservation.object_path,
    v_now,
    v_now,
    v_now
  FROM private.advocate_logo_upload_reservations reservation
  WHERE reservation.status IN ('expired', 'cleanup_required', 'cancelled')
    AND v_now >= GREATEST(
      reservation.expires_at,
      reservation.settled_at
    ) + interval '2 minutes'
    AND (
      reservation.status <> 'cancelled'
      OR EXISTS (
        SELECT 1
        FROM storage.objects object
        WHERE object.bucket_id = 'advocate-assets'
          AND object.name = reservation.object_path
      )
    )
  ON CONFLICT (reservation_id) DO NOTHING;

  -- An eighth abandoned lease is terminal. It cannot be silently reclaimed
  -- into a ninth provider attempt.
  PERFORM pg_catalog.set_config(
    'app.advocate_logo_reconciliation.operation',
    'exhaust',
    true
  );

  UPDATE private.advocate_logo_reconciliation_jobs job
  SET
    status = 'exhausted',
    worker_id = NULL,
    lease_token_digest = NULL,
    lease_expires_at = NULL,
    last_failure_code = 'lease_expired_after_maximum_attempts',
    terminal_outcome = 'exhausted',
    completed_at = v_now
  WHERE job.status = 'processing'
    AND job.attempt_count = job.maximum_attempts
    AND job.lease_expires_at <= v_now;

  PERFORM pg_catalog.set_config(
    'app.advocate_logo_reconciliation.operation',
    'claim',
    true
  );

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT job.id
    FROM private.advocate_logo_reconciliation_jobs job
    WHERE job.attempt_count < job.maximum_attempts
      AND (
        (
          job.status IN ('queued', 'retry_wait')
          AND job.available_at <= v_now
        )
        OR (
          job.status = 'processing'
          AND job.lease_expires_at <= v_now
        )
      )
    ORDER BY job.available_at, job.created_at, job.id
    LIMIT batch_size
    FOR UPDATE OF job SKIP LOCKED
  ), leases AS MATERIALIZED (
    SELECT
      candidate.id,
      encode(extensions.gen_random_bytes(32), 'hex') AS plaintext_token
    FROM candidates candidate
  ), claimed AS (
    UPDATE private.advocate_logo_reconciliation_jobs job
    SET
      status = 'processing',
      attempt_count = job.attempt_count + 1,
      worker_id = v_worker_id,
      lease_token_digest = extensions.digest(
        lease.plaintext_token,
        'sha256'
      ),
      lease_expires_at = v_now + interval '120 seconds',
      last_failure_code = NULL,
      quarantine_reason_code = NULL,
      terminal_outcome = NULL,
      claimed_at = v_now,
      completed_at = NULL
    FROM leases lease
    WHERE job.id = lease.id
    RETURNING
      job.id,
      job.reservation_id,
      job.advocate_id,
      job.object_path,
      job.lease_expires_at,
      job.attempt_count,
      job.maximum_attempts
  )
  SELECT
    claimed.id,
    claimed.reservation_id,
    claimed.advocate_id,
    claimed.object_path,
    lease.plaintext_token,
    claimed.lease_expires_at,
    claimed.attempt_count,
    claimed.maximum_attempts
  FROM claimed
  JOIN leases lease ON lease.id = claimed.id
  ORDER BY claimed.id;
END;
$$;

COMMENT ON FUNCTION public.claim_advocate_logo_reconciliation_jobs(
  text,
  integer,
  text,
  text
) IS
  'Service-only claim boundary. It expires pending reservations under lock, waits through the safety grace period, enqueues one immutable job per eligible reservation, and returns a one-time 120 second 256-bit fencing token.';

CREATE OR REPLACE FUNCTION public.authorize_advocate_logo_reconciliation_deletion(
  target_job_id uuid,
  lease_token text,
  request_id text,
  trace_id text DEFAULT NULL
)
RETURNS TABLE (
  outcome text,
  object_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
  v_token_digest bytea;
  v_job private.advocate_logo_reconciliation_jobs%ROWTYPE;
  v_reservation private.advocate_logo_upload_reservations%ROWTYPE;
  v_quarantine_code text;
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_job_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR v_request_id IS NULL
     OR v_request_id IS DISTINCT FROM request_id
     OR char_length(v_request_id) > 255
     OR (
       trace_id IS NOT NULL
       AND (
         v_trace_id IS NULL
         OR v_trace_id IS DISTINCT FROM trace_id
         OR char_length(v_trace_id) > 255
       )
     ) THEN
    RAISE EXCEPTION 'Logo reconciliation authorization input is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_token_digest := extensions.digest(lease_token, 'sha256');

  SELECT job.*
  INTO v_job
  FROM private.advocate_logo_reconciliation_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.status <> 'processing'
     OR v_job.lease_token_digest IS DISTINCT FROM v_token_digest
     OR v_job.lease_expires_at <= v_now THEN
    RETURN QUERY SELECT 'lease_lost'::text, NULL::text;
    RETURN;
  END IF;

  SELECT reservation.*
  INTO v_reservation
  FROM private.advocate_logo_upload_reservations reservation
  WHERE reservation.id = v_job.reservation_id
  FOR UPDATE;

  v_quarantine_code := CASE
    WHEN NOT FOUND
      OR v_reservation.advocate_id IS DISTINCT FROM v_job.advocate_id
      THEN 'advocate_mismatch'
    WHEN v_reservation.object_path IS DISTINCT FROM v_job.object_path
      THEN 'object_path_mismatch'
    WHEN v_reservation.status NOT IN ('expired', 'cleanup_required', 'cancelled')
      THEN 'reservation_not_cleanup_eligible'
    WHEN EXISTS (
      SELECT 1
      FROM public.advocate_branding branding
      WHERE branding.logo_storage_path = v_job.object_path
    ) THEN 'branding_path_in_use'
    ELSE NULL
  END;

  IF v_quarantine_code IS NOT NULL THEN
    PERFORM audit.set_actor_context(
      context_actor_type => 'system'::audit.audit_actor_type,
      context_system_actor => 'advocate-logo-reconciliation-worker',
      context_tool => 'advocate-logo-reconciliation',
      context_request_id => v_request_id,
      context_trace_id => v_trace_id,
      context_reason => 'Quarantine a logo deletion whose database invariants are no longer safe',
      context_metadata => jsonb_build_object(
        'operation', 'authorize_delete',
        'resource_kind', 'advocate_logo_reconciliation_job',
        'resource_id', v_job.id::text,
        'outcome', 'quarantined'
      )
    );
    PERFORM pg_catalog.set_config(
      'app.advocate_logo_reconciliation.operation',
      'authorize',
      true
    );

    UPDATE private.advocate_logo_reconciliation_jobs job
    SET
      status = 'quarantined',
      worker_id = NULL,
      lease_token_digest = NULL,
      lease_expires_at = NULL,
      quarantine_reason_code = v_quarantine_code,
      terminal_outcome = 'quarantined',
      completed_at = v_now
    WHERE job.id = v_job.id;

    RETURN QUERY SELECT 'quarantined'::text, NULL::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects object
    WHERE object.bucket_id = 'advocate-assets'
      AND object.name = v_job.object_path
  ) THEN
    RETURN QUERY SELECT 'already_absent'::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'delete'::text, v_job.object_path;
END;
$$;

COMMENT ON FUNCTION public.authorize_advocate_logo_reconciliation_deletion(
  uuid,
  text,
  text,
  text
) IS
  'Service-only final pre-delete fence. It returns a path only for an active lease whose immutable reservation is terminal, unattached, exact-path matched, and unreferenced by current branding.';

CREATE OR REPLACE FUNCTION public.complete_advocate_logo_reconciliation_job(
  target_job_id uuid,
  lease_token text,
  target_outcome text,
  request_id text,
  trace_id text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
  v_token_digest bytea;
  v_job private.advocate_logo_reconciliation_jobs%ROWTYPE;
  v_reservation private.advocate_logo_upload_reservations%ROWTYPE;
  v_quarantine_code text;
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_job_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR target_outcome NOT IN ('deleted', 'already_absent')
     OR v_request_id IS NULL
     OR v_request_id IS DISTINCT FROM request_id
     OR char_length(v_request_id) > 255
     OR (
       trace_id IS NOT NULL
       AND (
         v_trace_id IS NULL
         OR v_trace_id IS DISTINCT FROM trace_id
         OR char_length(v_trace_id) > 255
       )
     ) THEN
    RAISE EXCEPTION 'Logo reconciliation completion input is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_token_digest := extensions.digest(lease_token, 'sha256');

  SELECT job.*
  INTO v_job
  FROM private.advocate_logo_reconciliation_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logo reconciliation completion lease was lost'
      USING ERRCODE = '55P03';
  END IF;

  IF v_job.status = 'succeeded'
     AND v_job.lease_token_digest IS NOT DISTINCT FROM v_token_digest
     AND v_job.terminal_outcome = target_outcome THEN
    IF EXISTS (
      SELECT 1
      FROM storage.objects object
      WHERE object.bucket_id = 'advocate-assets'
        AND object.name = v_job.object_path
    ) THEN
      RAISE EXCEPTION 'Logo reconciliation completion requires an absent object'
        USING ERRCODE = '55000';
    END IF;

    RETURN 'completed';
  END IF;

  IF v_job.status <> 'processing'
     OR v_job.lease_token_digest IS DISTINCT FROM v_token_digest
     OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Logo reconciliation completion lease was lost'
      USING ERRCODE = '55P03';
  END IF;

  SELECT reservation.*
  INTO v_reservation
  FROM private.advocate_logo_upload_reservations reservation
  WHERE reservation.id = v_job.reservation_id
  FOR UPDATE;

  v_quarantine_code := CASE
    WHEN NOT FOUND
      OR v_reservation.advocate_id IS DISTINCT FROM v_job.advocate_id
      THEN 'advocate_mismatch'
    WHEN v_reservation.object_path IS DISTINCT FROM v_job.object_path
      THEN 'object_path_mismatch'
    WHEN v_reservation.status NOT IN ('expired', 'cleanup_required', 'cancelled')
      THEN 'reservation_not_cleanup_eligible'
    WHEN EXISTS (
      SELECT 1
      FROM public.advocate_branding branding
      WHERE branding.logo_storage_path = v_job.object_path
    ) THEN 'branding_path_in_use'
    ELSE NULL
  END;

  IF v_quarantine_code IS NOT NULL THEN
    PERFORM audit.set_actor_context(
      context_actor_type => 'system'::audit.audit_actor_type,
      context_system_actor => 'advocate-logo-reconciliation-worker',
      context_tool => 'advocate-logo-reconciliation',
      context_request_id => v_request_id,
      context_trace_id => v_trace_id,
      context_reason => 'Quarantine a logo completion whose database invariants are no longer safe',
      context_metadata => jsonb_build_object(
        'operation', 'complete',
        'resource_kind', 'advocate_logo_reconciliation_job',
        'resource_id', v_job.id::text,
        'outcome', 'quarantined'
      )
    );
    PERFORM pg_catalog.set_config(
      'app.advocate_logo_reconciliation.operation',
      'complete',
      true
    );

    UPDATE private.advocate_logo_reconciliation_jobs job
    SET
      status = 'quarantined',
      worker_id = NULL,
      lease_token_digest = NULL,
      lease_expires_at = NULL,
      quarantine_reason_code = v_quarantine_code,
      terminal_outcome = 'quarantined',
      completed_at = v_now
    WHERE job.id = v_job.id;

    RETURN 'quarantined';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects object
    WHERE object.bucket_id = 'advocate-assets'
      AND object.name = v_job.object_path
  ) THEN
    RAISE EXCEPTION 'Logo reconciliation completion requires an absent object'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-logo-reconciliation-worker',
    context_tool => 'advocate-logo-reconciliation',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Complete a fenced advocate logo reconciliation after proving object absence',
    context_metadata => jsonb_build_object(
      'operation', 'complete',
      'resource_kind', 'advocate_logo_reconciliation_job',
      'resource_id', v_job.id::text,
      'outcome', target_outcome
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate_logo_reconciliation.operation',
    'complete',
    true
  );

  UPDATE private.advocate_logo_reconciliation_jobs job
  SET
    status = 'succeeded',
    lease_expires_at = NULL,
    terminal_outcome = target_outcome,
    completed_at = v_now
  WHERE job.id = v_job.id;

  RETURN 'completed';
END;
$$;

COMMENT ON FUNCTION public.complete_advocate_logo_reconciliation_job(
  uuid,
  text,
  text,
  text,
  text
) IS
  'Service-only fenced completion. Success requires the exact storage row to be absent, preserves the final token digest for same-token idempotency, and accepts only deleted or already_absent outcomes.';

CREATE OR REPLACE FUNCTION public.fail_advocate_logo_reconciliation_job(
  target_job_id uuid,
  lease_token text,
  failure_code text,
  request_id text,
  trace_id text DEFAULT NULL
)
RETURNS TABLE (
  status text,
  next_attempt_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
  v_failure_code text := nullif(btrim(failure_code), '');
  v_token_digest bytea;
  v_job private.advocate_logo_reconciliation_jobs%ROWTYPE;
  v_next_attempt_at timestamptz;
  v_exhausted boolean;
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_job_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR v_failure_code IS NULL
     OR v_failure_code IS DISTINCT FROM failure_code
     OR v_failure_code NOT IN (
       'storage_delete_failed',
       'storage_rate_limited',
       'storage_timeout',
       'storage_unavailable',
       'unexpected_storage_response',
       'worker_interrupted'
     )
     OR v_request_id IS NULL
     OR v_request_id IS DISTINCT FROM request_id
     OR char_length(v_request_id) > 255
     OR (
       trace_id IS NOT NULL
       AND (
         v_trace_id IS NULL
         OR v_trace_id IS DISTINCT FROM trace_id
         OR char_length(v_trace_id) > 255
       )
     ) THEN
    RAISE EXCEPTION 'Logo reconciliation failure input is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_token_digest := extensions.digest(lease_token, 'sha256');

  SELECT job.*
  INTO v_job
  FROM private.advocate_logo_reconciliation_jobs job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.status <> 'processing'
     OR v_job.lease_token_digest IS DISTINCT FROM v_token_digest
     OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'Logo reconciliation failure lease was lost'
      USING ERRCODE = '55P03';
  END IF;

  v_exhausted := v_job.attempt_count >= v_job.maximum_attempts;
  IF NOT v_exhausted THEN
    v_next_attempt_at := v_now + pg_catalog.make_interval(
      secs => LEAST(
        21600,
        (
          300::numeric
          * power(2::numeric, v_job.attempt_count - 1)
        )::integer
      )
    );
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-logo-reconciliation-worker',
    context_tool => 'advocate-logo-reconciliation',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Record a bounded advocate logo reconciliation failure',
    context_metadata => jsonb_build_object(
      'operation', 'fail',
      'resource_kind', 'advocate_logo_reconciliation_job',
      'resource_id', v_job.id::text,
      'retry_count', v_job.attempt_count,
      'outcome', CASE WHEN v_exhausted THEN 'exhausted' ELSE 'retry_scheduled' END
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate_logo_reconciliation.operation',
    'fail',
    true
  );

  UPDATE private.advocate_logo_reconciliation_jobs job
  SET
    status = CASE
      WHEN v_exhausted THEN 'exhausted'
      ELSE 'retry_wait'
    END::private.advocate_logo_reconciliation_status,
    available_at = COALESCE(v_next_attempt_at, job.available_at),
    worker_id = NULL,
    lease_token_digest = NULL,
    lease_expires_at = NULL,
    last_failure_code = v_failure_code,
    terminal_outcome = CASE WHEN v_exhausted THEN 'exhausted' ELSE NULL END,
    completed_at = CASE WHEN v_exhausted THEN v_now ELSE NULL END
  WHERE job.id = v_job.id;

  RETURN QUERY
  SELECT
    CASE WHEN v_exhausted THEN 'exhausted' ELSE 'retry_scheduled' END,
    v_next_attempt_at;
END;
$$;

COMMENT ON FUNCTION public.fail_advocate_logo_reconciliation_job(
  uuid,
  text,
  text,
  text,
  text
) IS
  'Service-only fenced failure settlement. Static failure codes retry from five minutes with exponential backoff capped at six hours, and attempt eight exhausts permanently.';

REVOKE ALL ON FUNCTION public.claim_advocate_logo_reconciliation_jobs(
  text,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.authorize_advocate_logo_reconciliation_deletion(
  uuid,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_advocate_logo_reconciliation_job(
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_advocate_logo_reconciliation_job(
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_advocate_logo_reconciliation_jobs(
  text,
  integer,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_advocate_logo_reconciliation_deletion(
  uuid,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_advocate_logo_reconciliation_job(
  uuid,
  text,
  text,
  text,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_advocate_logo_reconciliation_job(
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

COMMIT;
