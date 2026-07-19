/*
 * Scheduled retention is executed through five independently committed,
 * idempotent service-role RPCs. Keeping the transactions separate lets a
 * worker report a later failure without rolling back work already completed.
 */

BEGIN;

CREATE OR REPLACE FUNCTION private.require_data_retention_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Data retention RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Data retention RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.require_data_retention_service_role()
  FROM PUBLIC, anon, authenticated, service_role;



CREATE OR REPLACE FUNCTION audit.purge_expired_forensics(
  batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  PERFORM private.require_data_retention_service_role();

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  WITH expired AS MATERIALIZED (
    SELECT forensic.audit_event_id
    FROM audit.audit_event_forensics forensic
    WHERE forensic.expires_at <= clock_timestamp()
    ORDER BY forensic.expires_at, forensic.audit_event_id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM audit.audit_event_forensics forensic
  USING expired
  WHERE forensic.audit_event_id = expired.audit_event_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION audit.purge_expired_forensics(integer)
  FROM PUBLIC, anon, authenticated, service_role;



REVOKE ALL ON FUNCTION public.purge_sponsorship_checkout_contact_envelopes(
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_sponsorship_checkout_contact_envelopes(
  integer,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.purge_sponsorship_checkout_contact_envelopes(
  integer,
  text,
  text
) IS
  'Erases one bounded batch of terminal checkout contact envelopes with safe aggregate outcomes. Service role only and safe to retry.';

/*
 * Scheduled runs leave a separate, sanitized, append only evidence trail.
 * The header owns correlation data. Step and terminal events contain only
 * bounded counts, backlog timestamps, and fixed vocabulary status values.
 */
CREATE OR REPLACE FUNCTION private.data_retention_step_is_valid(
  target_step_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT target_step_key = ANY (ARRAY[
    'checkout_contact_envelopes',
    'email_outbox_contact',
    'gateway_event_payloads',
    'audit_forensics',
    'advocate_tracking'
  ]::text[]);
$$;

CREATE OR REPLACE FUNCTION private.data_retention_zero_counts(
  target_step_key text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE target_step_key
    WHEN 'checkout_contact_envelopes' THEN jsonb_build_object(
      'erased_count', 0,
      'succeeded_count', 0,
      'failed_count', 0,
      'cancelled_count', 0,
      'expired_count', 0
    )
    WHEN 'email_outbox_contact' THEN jsonb_build_object('redacted_count', 0)
    WHEN 'gateway_event_payloads' THEN jsonb_build_object('redacted_count', 0)
    WHEN 'audit_forensics' THEN jsonb_build_object('deleted_count', 0)
    WHEN 'advocate_tracking' THEN jsonb_build_object(
      'exposures_deleted', 0,
      'visitors_deleted', 0
    )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION private.data_retention_counts_are_valid(
  target_step_key text,
  target_counts jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_value text;
  v_key text;
  v_allowed_keys text[];
  v_maximum bigint;
  v_total bigint := 0;
BEGIN
  IF NOT private.data_retention_step_is_valid(target_step_key)
     OR jsonb_typeof(target_counts) <> 'object'
     OR pg_column_size(target_counts) > 1024 THEN
    RETURN false;
  END IF;

  CASE target_step_key
    WHEN 'checkout_contact_envelopes' THEN
      v_allowed_keys := ARRAY[
        'erased_count',
        'succeeded_count',
        'failed_count',
        'cancelled_count',
        'expired_count'
      ]::text[];
      v_maximum := 500;
    WHEN 'email_outbox_contact' THEN
      v_allowed_keys := ARRAY['redacted_count']::text[];
      v_maximum := 5000;
    WHEN 'gateway_event_payloads' THEN
      v_allowed_keys := ARRAY['redacted_count']::text[];
      v_maximum := 5000;
    WHEN 'audit_forensics' THEN
      v_allowed_keys := ARRAY['deleted_count']::text[];
      v_maximum := 5000;
    WHEN 'advocate_tracking' THEN
      v_allowed_keys := ARRAY[
        'exposures_deleted',
        'visitors_deleted'
      ]::text[];
      v_maximum := 5000;
  END CASE;

  IF (SELECT array_agg(entry.key ORDER BY entry.key)
      FROM jsonb_each(target_counts) entry)
     IS DISTINCT FROM
     (SELECT array_agg(allowed_key ORDER BY allowed_key)
      FROM unnest(v_allowed_keys) allowed_key) THEN
    RETURN false;
  END IF;

  FOREACH v_key IN ARRAY v_allowed_keys LOOP
    IF jsonb_typeof(target_counts -> v_key) <> 'number' THEN
      RETURN false;
    END IF;

    v_value := target_counts ->> v_key;
    IF v_value !~ '^(0|[1-9][0-9]*)$'
       OR v_value::numeric > v_maximum THEN
      RETURN false;
    END IF;
  END LOOP;

  IF target_step_key = 'checkout_contact_envelopes' THEN
    v_total := (target_counts ->> 'succeeded_count')::bigint
      + (target_counts ->> 'failed_count')::bigint
      + (target_counts ->> 'cancelled_count')::bigint
      + (target_counts ->> 'expired_count')::bigint;
    IF v_total <> (target_counts ->> 'erased_count')::bigint THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

CREATE TABLE audit.data_retention_runs (
  run_id uuid PRIMARY KEY,
  started_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  batch_size integer NOT NULL,
  request_id text NOT NULL,
  trace_id text,
  CONSTRAINT data_retention_runs_run_id_check CHECK (
    run_id <> '00000000-0000-0000-0000-000000000000'::uuid
  ),
  CONSTRAINT data_retention_runs_batch_size_check CHECK (
    batch_size BETWEEN 1 AND 5000
  ),
  CONSTRAINT data_retention_runs_request_id_check CHECK (
    char_length(request_id) BETWEEN 1 AND 255
    AND request_id = btrim(request_id)
    AND request_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT data_retention_runs_trace_id_check CHECK (
    trace_id IS NULL
    OR (
      char_length(trace_id) BETWEEN 1 AND 255
      AND trace_id = btrim(trace_id)
      AND trace_id !~ '[[:cntrl:]]'
    )
  )
);

CREATE TABLE audit.data_retention_run_events (
  sequence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  run_id uuid NOT NULL
    REFERENCES audit.data_retention_runs(run_id) ON DELETE RESTRICT,
  recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  event_kind text NOT NULL,
  step_key text,
  status text NOT NULL,
  health_status text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  has_more boolean,
  oldest_expired_at timestamp with time zone,
  completed_steps text[] NOT NULL DEFAULT ARRAY[]::text[],
  failed_steps text[] NOT NULL DEFAULT ARRAY[]::text[],
  backlog_steps text[] NOT NULL DEFAULT ARRAY[]::text[],
  request_id text NOT NULL,
  trace_id text,
  CONSTRAINT data_retention_run_events_kind_check CHECK (
    event_kind IN ('step_outcome', 'terminal')
  ),
  CONSTRAINT data_retention_run_events_context_check CHECK (
    char_length(request_id) BETWEEN 1 AND 255
    AND request_id = btrim(request_id)
    AND request_id !~ '[[:cntrl:]]'
    AND (
      trace_id IS NULL
      OR (
        char_length(trace_id) BETWEEN 1 AND 255
        AND trace_id = btrim(trace_id)
        AND trace_id !~ '[[:cntrl:]]'
      )
    )
  ),
  CONSTRAINT data_retention_run_events_shape_check CHECK (
    (
      event_kind = 'step_outcome'
      AND private.data_retention_step_is_valid(step_key)
      AND status IN ('completed', 'failed')
      AND health_status IS NULL
      AND private.data_retention_counts_are_valid(step_key, counts)
      AND (
        (
          status = 'completed'
          AND has_more IS NOT NULL
          AND (
            (has_more AND oldest_expired_at IS NOT NULL)
            OR (NOT has_more AND oldest_expired_at IS NULL)
          )
        )
        OR (
          status = 'failed'
          AND has_more IS NULL
          AND oldest_expired_at IS NULL
        )
      )
      AND cardinality(completed_steps) = 0
      AND cardinality(failed_steps) = 0
      AND cardinality(backlog_steps) = 0
    )
    OR
    (
      event_kind = 'terminal'
      AND step_key IS NULL
      AND status IN ('completed', 'completed_with_failures', 'abandoned')
      AND health_status IN (
        'clean',
        'backlog_remaining',
        'failed',
        'abandoned'
      )
      AND counts = '{}'::jsonb
      AND has_more IS NULL
      AND oldest_expired_at IS NULL
      AND completed_steps <@ ARRAY[
        'checkout_contact_envelopes', 'email_outbox_contact',
        'gateway_event_payloads',
        'audit_forensics', 'advocate_tracking'
      ]::text[]
      AND failed_steps <@ ARRAY[
        'checkout_contact_envelopes', 'email_outbox_contact',
        'gateway_event_payloads',
        'audit_forensics', 'advocate_tracking'
      ]::text[]
      AND backlog_steps <@ ARRAY[
        'checkout_contact_envelopes', 'email_outbox_contact',
        'gateway_event_payloads',
        'audit_forensics', 'advocate_tracking'
      ]::text[]
      AND CASE
        WHEN status = 'abandoned' THEN health_status = 'abandoned'
        WHEN status = 'completed_with_failures' THEN health_status = 'failed'
        WHEN cardinality(backlog_steps) > 0 THEN health_status = 'backlog_remaining'
        ELSE health_status = 'clean'
      END
    )
  )
);

CREATE UNIQUE INDEX data_retention_run_step_outcome_unique_idx
  ON audit.data_retention_run_events (run_id, step_key)
  WHERE event_kind = 'step_outcome';
CREATE UNIQUE INDEX data_retention_run_terminal_unique_idx
  ON audit.data_retention_run_events (run_id)
  WHERE event_kind = 'terminal';
CREATE INDEX data_retention_run_events_terminal_idx
  ON audit.data_retention_run_events (recorded_at DESC)
  WHERE event_kind = 'terminal';

CREATE OR REPLACE FUNCTION private.prevent_data_retention_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Data retention run evidence is append only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER data_retention_runs_no_mutation
BEFORE UPDATE OR DELETE ON audit.data_retention_runs
FOR EACH ROW EXECUTE FUNCTION private.prevent_data_retention_evidence_mutation();
CREATE TRIGGER data_retention_runs_no_truncate
BEFORE TRUNCATE ON audit.data_retention_runs
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_data_retention_evidence_mutation();
CREATE TRIGGER data_retention_run_events_no_mutation
BEFORE UPDATE OR DELETE ON audit.data_retention_run_events
FOR EACH ROW EXECUTE FUNCTION private.prevent_data_retention_evidence_mutation();
CREATE TRIGGER data_retention_run_events_no_truncate
BEFORE TRUNCATE ON audit.data_retention_run_events
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_data_retention_evidence_mutation();

ALTER TABLE audit.data_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.data_retention_run_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit.data_retention_runs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON audit.data_retention_run_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE audit.data_retention_run_events_sequence_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE audit.data_retention_runs IS
  'Immutable sanitized scheduled retention run headers with bounded correlation identifiers.';
COMMENT ON TABLE audit.data_retention_run_events IS
  'Append only sanitized retention step outcomes and terminal evidence. No raw errors or row identifiers are retained.';

REVOKE ALL ON FUNCTION private.data_retention_step_is_valid(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.data_retention_zero_counts(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.data_retention_counts_are_valid(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prevent_data_retention_evidence_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.data_retention_backlog(
  target_step_key text
)
RETURNS TABLE (
  has_more boolean,
  oldest_expired_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_oldest timestamp with time zone;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  PERFORM private.require_data_retention_service_role();

  IF NOT private.data_retention_step_is_valid(target_step_key) THEN
    RAISE EXCEPTION 'Unknown data retention step'
      USING ERRCODE = '22023';
  END IF;

  CASE target_step_key
    WHEN 'checkout_contact_envelopes' THEN
      SELECT min(recovery.finalized_at)
      INTO v_oldest
      FROM public.sponsorship_checkout_recovery_states recovery
      WHERE recovery.status = 'closed'
        AND recovery.provider_request_contact_erased_at IS NULL
        AND private.checkout_contact_erasure_reason(
          recovery.payment_attempt_id
        ) IS NOT NULL;
    WHEN 'email_outbox_contact' THEN
      SELECT min(
        least(
          v_now,
          CASE
            WHEN outbox.contact_retention_expires_at <= v_now
              THEN outbox.contact_retention_expires_at
            WHEN claim.id IS NULL
              THEN outbox.created_at
            WHEN claim.revoked_at IS NOT NULL
              THEN claim.revoked_at
            WHEN claim.status = 'consumed'
              THEN COALESCE(claim.consumed_at, claim.updated_at)
            WHEN claim.expires_at <= v_now
              THEN claim.expires_at
            ELSE claim.updated_at
          END
        )
      )
      INTO v_oldest
      FROM public.email_outbox outbox
      LEFT JOIN public.sponsorship_account_claims claim
        ON claim.id = outbox.account_claim_id
      WHERE outbox.contact_redacted_at IS NULL
        AND (
          outbox.contact_retention_expires_at <= v_now
          OR claim.id IS NULL
          OR claim.status <> 'pending'
          OR claim.expires_at <= v_now
          OR claim.revoked_at IS NOT NULL
        );
    WHEN 'gateway_event_payloads' THEN
      SELECT min(event.payload_retention_expires_at)
      INTO v_oldest
      FROM public.payment_gateway_events event
      WHERE event.payload_ciphertext IS NOT NULL
        AND event.payload_retention_expires_at <= clock_timestamp();
    WHEN 'audit_forensics' THEN
      SELECT min(forensic.expires_at)
      INTO v_oldest
      FROM audit.audit_event_forensics forensic
      WHERE forensic.expires_at <= clock_timestamp();
    WHEN 'advocate_tracking' THEN
      SELECT min(expired_at)
      INTO v_oldest
      FROM (
        SELECT exposure.retention_expires_at AS expired_at
        FROM public.advocate_exposures exposure
        WHERE exposure.retention_expires_at <= clock_timestamp()
        UNION ALL
        SELECT visitor.retention_expires_at
        FROM public.browser_visitors visitor
        WHERE visitor.retention_expires_at <= clock_timestamp()
          AND NOT EXISTS (
            SELECT 1
            FROM public.advocate_exposures exposure
            WHERE exposure.browser_visitor_id = visitor.id
          )
      ) expired_tracking;
  END CASE;

  RETURN QUERY SELECT v_oldest IS NOT NULL, v_oldest;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_data_retention_run_context(
  target_run_id uuid,
  target_batch_size integer,
  context_request_id text,
  context_trace_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_data_retention_service_role();

  IF target_run_id IS NULL
     OR target_run_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Data retention run id must be a nonzero UUID'
      USING ERRCODE = '22023';
  END IF;

  IF target_batch_size IS NULL OR target_batch_size NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  IF context_request_id IS NULL
     OR char_length(context_request_id) NOT BETWEEN 1 AND 255
     OR context_request_id IS DISTINCT FROM btrim(context_request_id)
     OR context_request_id ~ '[[:cntrl:]]'
     OR (
       context_trace_id IS NOT NULL
       AND (
         char_length(context_trace_id) NOT BETWEEN 1 AND 255
         OR context_trace_id IS DISTINCT FROM btrim(context_trace_id)
         OR context_trace_id ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Data retention request id and optional trace id must be normalized values no longer than 255 characters'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.data_retention_backlog(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_data_retention_run_context(
  uuid,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

/*
 * These legacy one argument functions remain callable by existing workers.
 * During a scheduled run they consume transaction local correlation context.
 */
CREATE OR REPLACE FUNCTION public.purge_expired_advocate_tracking(
  batch_size integer DEFAULT 500
)
RETURNS TABLE (
  exposures_deleted bigint,
  visitors_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_exposures_deleted bigint;
  v_visitors_deleted bigint;
  v_request_id text := nullif(
    current_setting('app.data_retention.request_id', true),
    ''
  );
  v_trace_id text := nullif(
    current_setting('app.data_retention.trace_id', true),
    ''
  );
  v_run_id text := nullif(
    current_setting('app.data_retention.run_id', true),
    ''
  );
BEGIN
  PERFORM private.require_data_retention_service_role();

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'retention-worker',
    context_tool => 'database-retention',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Expired advocate tracking retention',
    context_metadata => jsonb_build_object(
      'operation', 'delete',
      'resource_kind', 'advocate_tracking',
      'batch_id', v_run_id
    )
  );

  WITH candidates AS MATERIALIZED (
    SELECT exposure.id
    FROM public.advocate_exposures exposure
    WHERE exposure.retention_expires_at <= v_now
    ORDER BY exposure.retention_expires_at, exposure.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.advocate_exposures exposure
    USING candidates candidate
    WHERE exposure.id = candidate.id
    RETURNING exposure.id
  )
  SELECT count(*) INTO v_exposures_deleted FROM deleted;

  WITH candidates AS MATERIALIZED (
    SELECT visitor.id
    FROM public.browser_visitors visitor
    WHERE visitor.retention_expires_at <= v_now
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_exposures exposure
        WHERE exposure.browser_visitor_id = visitor.id
      )
    ORDER BY visitor.retention_expires_at, visitor.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.browser_visitors visitor
    USING candidates candidate
    WHERE visitor.id = candidate.id
    RETURNING visitor.id
  )
  SELECT count(*) INTO v_visitors_deleted FROM deleted;

  RETURN QUERY SELECT v_exposures_deleted, v_visitors_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_gateway_event_payloads(
  batch_size integer DEFAULT 500
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_redacted_count bigint;
  v_request_id text := nullif(
    current_setting('app.data_retention.request_id', true),
    ''
  );
  v_trace_id text := nullif(
    current_setting('app.data_retention.trace_id', true),
    ''
  );
  v_run_id text := nullif(
    current_setting('app.data_retention.run_id', true),
    ''
  );
BEGIN
  PERFORM private.require_data_retention_service_role();

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'retention-worker',
    context_tool => 'database-retention',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Expired encrypted gateway payload retention',
    context_metadata => jsonb_build_object(
      'operation', 'redact',
      'resource_kind', 'payment_gateway_event_payload',
      'batch_id', v_run_id
    )
  );

  WITH candidates AS MATERIALIZED (
    SELECT event.id
    FROM public.payment_gateway_events event
    WHERE event.payload_ciphertext IS NOT NULL
      AND event.payload_retention_expires_at <= v_now
    ORDER BY event.payload_retention_expires_at, event.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), redacted AS (
    UPDATE public.payment_gateway_events event
    SET payload_ciphertext = NULL, payload_redacted_at = v_now
    FROM candidates candidate
    WHERE event.id = candidate.id
    RETURNING event.id
  )
  SELECT count(*) INTO v_redacted_count FROM redacted;

  RETURN v_redacted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_email_outbox_contact(
  batch_size integer DEFAULT 500
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_redacted_count bigint;
  v_request_id text := nullif(
    current_setting('app.data_retention.request_id', true),
    ''
  );
  v_trace_id text := nullif(
    current_setting('app.data_retention.trace_id', true),
    ''
  );
  v_run_id text := nullif(
    current_setting('app.data_retention.run_id', true),
    ''
  );
BEGIN
  PERFORM private.require_data_retention_service_role();

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'retention-worker',
    context_tool => 'email-outbox-retention',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Redact expired or undeliverable welcome email contact data',
    context_metadata => jsonb_build_object(
      'operation', 'redact',
      'resource_kind', 'email_outbox_contact',
      'batch_id', v_run_id
    )
  );
  PERFORM pg_catalog.set_config(
    'app.email_outbox.lifecycle_operation',
    'purge',
    true
  );

  WITH candidates AS MATERIALIZED (
    SELECT outbox.id
    FROM public.email_outbox outbox
    LEFT JOIN public.sponsorship_account_claims claim
      ON claim.id = outbox.account_claim_id
    WHERE outbox.contact_redacted_at IS NULL
      AND (
        outbox.contact_retention_expires_at <= v_now
        OR claim.id IS NULL
        OR claim.status <> 'pending'
        OR claim.expires_at <= v_now
        OR claim.revoked_at IS NOT NULL
      )
    ORDER BY outbox.contact_retention_expires_at, outbox.id
    LIMIT batch_size
    FOR UPDATE OF outbox SKIP LOCKED
  ), redacted AS (
    UPDATE public.email_outbox outbox
    SET
      status = CASE
        WHEN outbox.status = 'sent' THEN 'sent'::public.email_outbox_status
        WHEN outbox.status = 'cancelled' THEN 'cancelled'::public.email_outbox_status
        ELSE 'cancelled'::public.email_outbox_status
      END,
      recipient_email_ciphertext = NULL,
      recipient_email_hmac = NULL,
      email_normalization_version = NULL,
      email_hmac_key_version = NULL,
      email_encryption_key_version = NULL,
      secret_payload_ciphertext = NULL,
      contact_redacted_at = v_now
    FROM candidates candidate
    WHERE outbox.id = candidate.id
    RETURNING outbox.id
  )
  SELECT count(*) INTO v_redacted_count FROM redacted;

  RETURN v_redacted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_audit_forensics(
  batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request_id text := nullif(
    current_setting('app.data_retention.request_id', true),
    ''
  );
  v_trace_id text := nullif(
    current_setting('app.data_retention.trace_id', true),
    ''
  );
  v_run_id text := nullif(
    current_setting('app.data_retention.run_id', true),
    ''
  );
BEGIN
  PERFORM private.require_data_retention_service_role();

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'retention-worker',
    context_tool => 'database-retention',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Expired raw audit forensics retention',
    context_metadata => jsonb_build_object(
      'operation', 'delete',
      'resource_kind', 'audit_forensics',
      'batch_id', v_run_id
    )
  );

  RETURN audit.purge_expired_forensics(batch_size);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_advocate_tracking(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_advocate_tracking(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.purge_expired_gateway_event_payloads(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_gateway_event_payloads(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.purge_expired_email_outbox_contact(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_email_outbox_contact(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.purge_expired_audit_forensics(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_forensics(integer)
  TO service_role;

COMMENT ON FUNCTION public.purge_expired_advocate_tracking(integer) IS
  'Deletes one bounded batch of expired advocate exposures and then unreferenced browser visitors with optional scheduled-run correlation. Service role only.';
COMMENT ON FUNCTION public.purge_expired_gateway_event_payloads(integer) IS
  'Redacts one bounded batch of expired encrypted gateway payloads with optional scheduled-run correlation. Service role only.';
COMMENT ON FUNCTION public.purge_expired_email_outbox_contact(integer) IS
  'Redacts expired or undeliverable email contact envelopes with optional scheduled-run correlation. Service role only.';
COMMENT ON FUNCTION public.purge_expired_audit_forensics(integer) IS
  'Deletes one bounded batch of expired raw audit forensics with optional scheduled-run correlation. Service role only.';

CREATE OR REPLACE FUNCTION public.start_data_retention_run(
  run_id uuid,
  batch_size integer,
  request_id text,
  trace_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_existing record;
  v_stale_after constant interval := interval '15 minutes';
BEGIN
  PERFORM private.validate_data_retention_run_context(
    run_id,
    batch_size,
    request_id,
    trace_id
  );

  PERFORM pg_advisory_xact_lock(112927, 131000);

  SELECT header.*
  INTO v_existing
  FROM audit.data_retention_runs header
  WHERE header.run_id = start_data_retention_run.run_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.batch_size IS DISTINCT FROM batch_size
       OR v_existing.request_id IS DISTINCT FROM request_id
       OR v_existing.trace_id IS DISTINCT FROM trace_id THEN
      RAISE EXCEPTION 'Data retention run id context does not match its immutable header'
        USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM audit.data_retention_run_events event
      WHERE event.run_id = start_data_retention_run.run_id
        AND event.event_kind = 'terminal'
    ) THEN
      RAISE EXCEPTION 'Data retention run is already terminal'
        USING ERRCODE = '55000';
    END IF;

    IF v_existing.started_at <= v_now - v_stale_after THEN
      INSERT INTO audit.data_retention_run_events (
        run_id,
        recorded_at,
        event_kind,
        status,
        health_status,
        completed_steps,
        failed_steps,
        backlog_steps,
        request_id,
        trace_id
      )
      SELECT
        run_id,
        v_now,
        'terminal',
        'abandoned',
        'abandoned',
        COALESCE(outcomes.completed_steps, ARRAY[]::text[]),
        ARRAY[]::text[],
        COALESCE(outcomes.backlog_steps, ARRAY[]::text[]),
        request_id,
        trace_id
      FROM LATERAL (
        SELECT
          array_agg(event.step_key ORDER BY steps.ordinality)
            FILTER (WHERE event.status = 'completed') AS completed_steps,
          array_agg(event.step_key ORDER BY steps.ordinality)
            FILTER (WHERE event.has_more) AS backlog_steps
        FROM unnest(ARRAY[
          'checkout_contact_envelopes',
          'email_outbox_contact',
          'gateway_event_payloads',
          'audit_forensics',
          'advocate_tracking'
        ]::text[]) WITH ORDINALITY steps(step_key, ordinality)
        LEFT JOIN audit.data_retention_run_events event
          ON event.run_id = start_data_retention_run.run_id
         AND event.event_kind = 'step_outcome'
         AND event.step_key = steps.step_key
      ) outcomes;

      RETURN NULL;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM audit.data_retention_runs header
      WHERE header.run_id <> start_data_retention_run.run_id
        AND header.started_at > v_now - v_stale_after
        AND NOT EXISTS (
          SELECT 1
          FROM audit.data_retention_run_events terminal
          WHERE terminal.run_id = header.run_id
            AND terminal.event_kind = 'terminal'
        )
    ) THEN
      RAISE EXCEPTION 'Another data retention run is still active'
        USING ERRCODE = '55P03';
    END IF;

    RETURN run_id;
  END IF;

  WITH stale_runs AS MATERIALIZED (
    SELECT header.run_id, header.request_id, header.trace_id
    FROM audit.data_retention_runs header
    WHERE header.started_at <= v_now - v_stale_after
      AND NOT EXISTS (
        SELECT 1
        FROM audit.data_retention_run_events terminal
        WHERE terminal.run_id = header.run_id
          AND terminal.event_kind = 'terminal'
      )
    ORDER BY header.started_at, header.run_id
    FOR UPDATE
  )
  INSERT INTO audit.data_retention_run_events (
    run_id,
    recorded_at,
    event_kind,
    status,
    health_status,
    completed_steps,
    failed_steps,
    backlog_steps,
    request_id,
    trace_id
  )
  SELECT
    stale.run_id,
    v_now,
    'terminal',
    'abandoned',
    'abandoned',
    COALESCE(outcomes.completed_steps, ARRAY[]::text[]),
    ARRAY[]::text[],
    COALESCE(outcomes.backlog_steps, ARRAY[]::text[]),
    stale.request_id,
    stale.trace_id
  FROM stale_runs stale
  LEFT JOIN LATERAL (
    SELECT
      array_agg(event.step_key ORDER BY steps.ordinality)
        FILTER (WHERE event.status = 'completed') AS completed_steps,
      array_agg(event.step_key ORDER BY steps.ordinality)
        FILTER (WHERE event.has_more) AS backlog_steps
    FROM unnest(ARRAY[
      'checkout_contact_envelopes',
      'email_outbox_contact',
      'gateway_event_payloads',
      'audit_forensics',
      'advocate_tracking'
    ]::text[]) WITH ORDINALITY steps(step_key, ordinality)
    LEFT JOIN audit.data_retention_run_events event
      ON event.run_id = stale.run_id
     AND event.event_kind = 'step_outcome'
     AND event.step_key = steps.step_key
  ) outcomes ON true;

  IF EXISTS (
    SELECT 1
    FROM audit.data_retention_runs header
    WHERE header.started_at > v_now - v_stale_after
      AND NOT EXISTS (
        SELECT 1
        FROM audit.data_retention_run_events terminal
        WHERE terminal.run_id = header.run_id
          AND terminal.event_kind = 'terminal'
      )
  ) THEN
    RAISE EXCEPTION 'Another data retention run is still active'
      USING ERRCODE = '55P03';
  END IF;

  INSERT INTO audit.data_retention_runs (
    run_id,
    started_at,
    batch_size,
    request_id,
    trace_id
  )
  VALUES (run_id, v_now, batch_size, request_id, trace_id);

  RETURN run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_data_retention_step(
  run_id uuid,
  step_key text,
  batch_size integer,
  request_id text,
  trace_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_header record;
  v_existing record;
  v_counts jsonb;
  v_has_more boolean;
  v_oldest_expired_at timestamp with time zone;
  v_checkout record;
  v_tracking record;
  v_scalar bigint;
  v_expected_batch_size integer;
BEGIN
  PERFORM private.validate_data_retention_run_context(
    run_id,
    batch_size,
    request_id,
    trace_id
  );

  IF NOT private.data_retention_step_is_valid(step_key) THEN
    RAISE EXCEPTION 'Unknown data retention step'
      USING ERRCODE = '22023';
  END IF;

  SELECT header.*
  INTO v_header
  FROM audit.data_retention_runs header
  WHERE header.run_id = run_data_retention_step.run_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data retention run header does not exist'
      USING ERRCODE = '22023';
  END IF;

  IF v_header.request_id IS DISTINCT FROM request_id
     OR v_header.trace_id IS DISTINCT FROM trace_id THEN
    RAISE EXCEPTION 'Data retention run context does not match its immutable header'
      USING ERRCODE = '22023';
  END IF;

  v_expected_batch_size := CASE
    WHEN step_key = 'checkout_contact_envelopes'
      THEN least(v_header.batch_size, 500)
    ELSE v_header.batch_size
  END;

  IF batch_size IS DISTINCT FROM v_expected_batch_size THEN
    RAISE EXCEPTION 'Data retention step batch size does not match its immutable header'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM audit.data_retention_run_events event
    WHERE event.run_id = run_data_retention_step.run_id
      AND event.event_kind = 'terminal'
  ) THEN
    RAISE EXCEPTION 'Data retention run is already terminal'
      USING ERRCODE = '55000';
  END IF;

  SELECT event.*
  INTO v_existing
  FROM audit.data_retention_run_events event
  WHERE event.run_id = run_data_retention_step.run_id
    AND event.event_kind = 'step_outcome'
    AND event.step_key = run_data_retention_step.step_key;

  IF FOUND THEN
    IF v_existing.status <> 'completed' THEN
      RAISE EXCEPTION 'Data retention step previously failed'
        USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
      'step_key', v_existing.step_key,
      'counts', v_existing.counts,
      'has_more', v_existing.has_more,
      'oldest_expired_at', v_existing.oldest_expired_at
    );
  END IF;

  PERFORM set_config('app.data_retention.run_id', run_id::text, true);
  PERFORM set_config('app.data_retention.request_id', request_id, true);
  PERFORM set_config(
    'app.data_retention.trace_id',
    COALESCE(trace_id, ''),
    true
  );
  PERFORM set_config('app.data_retention.step_key', step_key, true);

  BEGIN
    CASE step_key
      WHEN 'checkout_contact_envelopes' THEN
        SELECT cleanup.*
        INTO STRICT v_checkout
        FROM public.purge_sponsorship_checkout_contact_envelopes(
          batch_size,
          request_id,
          trace_id
        ) cleanup;
        v_counts := jsonb_build_object(
          'erased_count', v_checkout.erased_count,
          'succeeded_count', v_checkout.succeeded_count,
          'failed_count', v_checkout.failed_count,
          'cancelled_count', v_checkout.cancelled_count,
          'expired_count', v_checkout.expired_count
        );
      WHEN 'email_outbox_contact' THEN
        v_scalar := public.purge_expired_email_outbox_contact(batch_size);
        v_counts := jsonb_build_object('redacted_count', v_scalar);
      WHEN 'gateway_event_payloads' THEN
        v_scalar := public.purge_expired_gateway_event_payloads(batch_size);
        v_counts := jsonb_build_object('redacted_count', v_scalar);
      WHEN 'audit_forensics' THEN
        v_scalar := public.purge_expired_audit_forensics(batch_size);
        v_counts := jsonb_build_object('deleted_count', v_scalar);
      WHEN 'advocate_tracking' THEN
        SELECT cleanup.*
        INTO STRICT v_tracking
        FROM public.purge_expired_advocate_tracking(batch_size) cleanup;
        v_counts := jsonb_build_object(
          'exposures_deleted', v_tracking.exposures_deleted,
          'visitors_deleted', v_tracking.visitors_deleted
        );
    END CASE;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Data retention cleanup step failed'
        USING ERRCODE = 'P0001';
  END;

  SELECT backlog.has_more, backlog.oldest_expired_at
  INTO STRICT v_has_more, v_oldest_expired_at
  FROM private.data_retention_backlog(step_key) backlog;

  INSERT INTO audit.data_retention_run_events (
    run_id,
    event_kind,
    step_key,
    status,
    counts,
    has_more,
    oldest_expired_at,
    request_id,
    trace_id
  )
  VALUES (
    run_id,
    'step_outcome',
    step_key,
    'completed',
    v_counts,
    v_has_more,
    v_oldest_expired_at,
    request_id,
    trace_id
  );

  RETURN jsonb_build_object(
    'step_key', step_key,
    'counts', v_counts,
    'has_more', v_has_more,
    'oldest_expired_at', v_oldest_expired_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_data_retention_run(
  run_id uuid,
  reported_failed_steps text[],
  request_id text,
  trace_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_header record;
  v_terminal record;
  v_all_steps constant text[] := ARRAY[
    'checkout_contact_envelopes',
    'email_outbox_contact',
    'gateway_event_payloads',
    'audit_forensics',
    'advocate_tracking'
  ]::text[];
  v_failed_steps text[];
  v_completed_steps text[];
  v_backlog_steps text[];
  v_step_key text;
  v_has_more boolean;
  v_oldest_expired_at timestamp with time zone;
  v_status text;
  v_health_status text;
BEGIN
  PERFORM private.validate_data_retention_run_context(
    run_id,
    1,
    request_id,
    trace_id
  );

  IF reported_failed_steps IS NULL
     OR cardinality(reported_failed_steps) > cardinality(v_all_steps)
     OR EXISTS (
       SELECT 1
       FROM unnest(reported_failed_steps) failed(step_key)
       WHERE failed.step_key IS NULL
          OR NOT private.data_retention_step_is_valid(failed.step_key)
     )
     OR (
       SELECT count(*)
       FROM unnest(reported_failed_steps) failed(step_key)
     ) <> (
       SELECT count(DISTINCT failed.step_key)
       FROM unnest(reported_failed_steps) failed(step_key)
     ) THEN
    RAISE EXCEPTION 'Reported failed retention steps must be a unique bounded list of known steps'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(steps.step_key ORDER BY steps.ordinality), ARRAY[]::text[])
  INTO v_failed_steps
  FROM unnest(v_all_steps) WITH ORDINALITY steps(step_key, ordinality)
  WHERE steps.step_key = ANY (reported_failed_steps);

  SELECT header.*
  INTO v_header
  FROM audit.data_retention_runs header
  WHERE header.run_id = finish_data_retention_run.run_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data retention run header does not exist'
      USING ERRCODE = '22023';
  END IF;

  IF v_header.request_id IS DISTINCT FROM request_id
     OR v_header.trace_id IS DISTINCT FROM trace_id THEN
    RAISE EXCEPTION 'Data retention run context does not match its immutable header'
      USING ERRCODE = '22023';
  END IF;

  /*
   * A committed completed outcome wins over a caller reported timeout. This
   * makes finish safe after the cleanup committed but its response was lost.
   */
  SELECT COALESCE(
    array_agg(steps.step_key ORDER BY steps.ordinality),
    ARRAY[]::text[]
  )
  INTO v_failed_steps
  FROM unnest(v_all_steps) WITH ORDINALITY steps(step_key, ordinality)
  WHERE steps.step_key = ANY (v_failed_steps)
    AND NOT EXISTS (
      SELECT 1
      FROM audit.data_retention_run_events outcome
      WHERE outcome.run_id = finish_data_retention_run.run_id
        AND outcome.event_kind = 'step_outcome'
        AND outcome.status = 'completed'
        AND outcome.step_key = steps.step_key
    );

  SELECT terminal.*
  INTO v_terminal
  FROM audit.data_retention_run_events terminal
  WHERE terminal.run_id = finish_data_retention_run.run_id
    AND terminal.event_kind = 'terminal';

  IF FOUND THEN
    IF v_terminal.status = 'abandoned'
       OR v_terminal.failed_steps IS DISTINCT FROM v_failed_steps THEN
      RAISE EXCEPTION 'Data retention terminal evidence does not match this finish request'
        USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
      'status', v_terminal.status,
      'completed_steps', to_jsonb(v_terminal.completed_steps),
      'failed_steps', to_jsonb(v_terminal.failed_steps),
      'backlog_steps', to_jsonb(v_terminal.backlog_steps)
    );
  END IF;

  FOREACH v_step_key IN ARRAY v_failed_steps LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM audit.data_retention_run_events outcome
      WHERE outcome.run_id = finish_data_retention_run.run_id
        AND outcome.event_kind = 'step_outcome'
        AND outcome.step_key = v_step_key
    ) THEN
      INSERT INTO audit.data_retention_run_events (
        run_id,
        event_kind,
        step_key,
        status,
        counts,
        has_more,
        oldest_expired_at,
        request_id,
        trace_id
      )
      VALUES (
        run_id,
        'step_outcome',
        v_step_key,
        'failed',
        private.data_retention_zero_counts(v_step_key),
        NULL,
        NULL,
        request_id,
        trace_id
      );
    END IF;
  END LOOP;

  IF (
    SELECT count(*)
    FROM audit.data_retention_run_events outcome
    WHERE outcome.run_id = finish_data_retention_run.run_id
      AND outcome.event_kind = 'step_outcome'
  ) <> cardinality(v_all_steps) THEN
    RAISE EXCEPTION 'Every retention step must complete or be reported failed before finish'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    COALESCE(
      array_agg(outcome.step_key ORDER BY steps.ordinality)
        FILTER (WHERE outcome.status = 'completed'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(outcome.step_key ORDER BY steps.ordinality)
        FILTER (WHERE outcome.status = 'failed'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(outcome.step_key ORDER BY steps.ordinality)
        FILTER (WHERE outcome.has_more),
      ARRAY[]::text[]
    )
  INTO v_completed_steps, v_failed_steps, v_backlog_steps
  FROM unnest(v_all_steps) WITH ORDINALITY steps(step_key, ordinality)
  JOIN audit.data_retention_run_events outcome
    ON outcome.run_id = finish_data_retention_run.run_id
   AND outcome.event_kind = 'step_outcome'
   AND outcome.step_key = steps.step_key;

  v_status := CASE
    WHEN cardinality(v_failed_steps) = 0 THEN 'completed'
    ELSE 'completed_with_failures'
  END;
  v_health_status := CASE
    WHEN cardinality(v_failed_steps) > 0 THEN 'failed'
    WHEN cardinality(v_backlog_steps) > 0 THEN 'backlog_remaining'
    ELSE 'clean'
  END;

  INSERT INTO audit.data_retention_run_events (
    run_id,
    event_kind,
    status,
    health_status,
    completed_steps,
    failed_steps,
    backlog_steps,
    request_id,
    trace_id
  )
  VALUES (
    run_id,
    'terminal',
    v_status,
    v_health_status,
    v_completed_steps,
    v_failed_steps,
    v_backlog_steps,
    request_id,
    trace_id
  );

  RETURN jsonb_build_object(
    'status', v_status,
    'completed_steps', to_jsonb(v_completed_steps),
    'failed_steps', to_jsonb(v_failed_steps),
    'backlog_steps', to_jsonb(v_backlog_steps)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.read_data_retention_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last_clean record;
  v_last_terminal record;
  v_unterminated_count integer;
  v_stale_unterminated_count integer;
BEGIN
  PERFORM private.require_data_retention_service_role();

  SELECT terminal.*
  INTO v_last_clean
  FROM audit.data_retention_run_events terminal
  WHERE terminal.event_kind = 'terminal'
    AND terminal.status = 'completed'
    AND terminal.health_status = 'clean'
    AND cardinality(terminal.backlog_steps) = 0
  ORDER BY terminal.recorded_at DESC, terminal.sequence_id DESC
  LIMIT 1;

  SELECT terminal.*
  INTO v_last_terminal
  FROM audit.data_retention_run_events terminal
  WHERE terminal.event_kind = 'terminal'
  ORDER BY terminal.recorded_at DESC, terminal.sequence_id DESC
  LIMIT 1;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE header.started_at <= clock_timestamp() - interval '15 minutes'
    )::integer
  INTO v_unterminated_count, v_stale_unterminated_count
  FROM audit.data_retention_runs header
  WHERE NOT EXISTS (
    SELECT 1
    FROM audit.data_retention_run_events terminal
    WHERE terminal.run_id = header.run_id
      AND terminal.event_kind = 'terminal'
  );

  RETURN jsonb_build_object(
    'last_clean_run_id', v_last_clean.run_id,
    'last_clean_completed_at', v_last_clean.recorded_at,
    'last_terminal_run_id', v_last_terminal.run_id,
    'last_terminal_at', v_last_terminal.recorded_at,
    'last_terminal_status', v_last_terminal.status,
    'last_terminal_health_status', v_last_terminal.health_status,
    'unterminated_run_count', v_unterminated_count,
    'stale_unterminated_run_count', v_stale_unterminated_count,
    'last_backlog_steps', COALESCE(
      to_jsonb(v_last_terminal.backlog_steps),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_data_retention_run(
  uuid,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_data_retention_run(
  uuid,
  integer,
  text,
  text
) TO service_role;
REVOKE ALL ON FUNCTION public.run_data_retention_step(
  uuid,
  text,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_data_retention_step(
  uuid,
  text,
  integer,
  text,
  text
) TO service_role;
REVOKE ALL ON FUNCTION public.finish_data_retention_run(
  uuid,
  text[],
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_data_retention_run(
  uuid,
  text[],
  text,
  text
) TO service_role;
REVOKE ALL ON FUNCTION public.read_data_retention_health()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_data_retention_health()
  TO service_role;

COMMENT ON FUNCTION public.start_data_retention_run(uuid, integer, text, text) IS
  'Creates one immutable correlated retention run header, abandons stale runs, and rejects overlapping fresh runs. Service role only.';
COMMENT ON FUNCTION public.run_data_retention_step(uuid, text, integer, text, text) IS
  'Runs one static bounded cleanup and appends one sanitized outcome with backlog evidence. Service role only.';
COMMENT ON FUNCTION public.finish_data_retention_run(uuid, text[], text, text) IS
  'Appends one terminal retention event after every step has a completed or reported failed outcome. Service role only.';
COMMENT ON FUNCTION public.read_data_retention_health() IS
  'Returns a sanitized service-only summary of clean completion, latest terminal status, active runs, and backlog.';

COMMIT;
