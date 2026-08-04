BEGIN;

CREATE OR REPLACE FUNCTION public.purge_expired_email_proof_issuance_gates(
  batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_deleted integer;
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
  PERFORM private.require_email_proof_issuance_service_role();

  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Email proof issuance retention batch size is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => CASE
      WHEN v_run_id IS NULL THEN 'email-proof-issuance-retention'
      ELSE 'retention-worker'
    END,
    context_tool => CASE
      WHEN v_run_id IS NULL THEN 'purge_expired_email_proof_issuance_gates'
      ELSE 'database-retention'
    END,
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_reason => 'Expired email proof issuance gate retention',
    context_metadata => jsonb_build_object(
      'operation', 'delete',
      'resource_kind', 'email_proof_issuance_gate',
      'batch_id', v_run_id
    )
  );

  WITH expired AS MATERIALIZED (
    SELECT gate.id
    FROM private.email_proof_issuance_gates gate
    WHERE gate.reservation_expires_at <= v_now
      AND COALESCE(gate.next_issuance_at, '-infinity'::timestamptz) <= v_now
      AND COALESCE(
        gate.proof_exclusivity_expires_at,
        '-infinity'::timestamptz
      ) <= v_now
    ORDER BY
      gate.proof_exclusivity_expires_at NULLS FIRST,
      gate.next_issuance_at NULLS FIRST,
      gate.reservation_expires_at,
      gate.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM private.email_proof_issuance_gates gate
  USING expired
  WHERE gate.id = expired.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

DROP FUNCTION public.purge_expired_sponsor_authentication_evidence(integer);

CREATE FUNCTION public.purge_expired_sponsor_authentication_evidence(
  batch_size integer DEFAULT 1000
)
RETURNS TABLE (
  recent_auth_receipts_deleted integer,
  passwordless_reservations_deleted integer,
  passwordless_verification_attempts_deleted integer,
  advocate_invitation_authentication_attempts_deleted integer,
  email_proof_issuance_gates_deleted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_receipts_deleted integer;
  v_reservations_deleted integer;
  v_verification_attempts_deleted integer;
  v_advocate_invitation_attempts_deleted integer;
  v_email_proof_issuance_gates_deleted integer;
BEGIN
  PERFORM private.require_data_retention_service_role();

  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Retention batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  WITH expired AS MATERIALIZED (
    SELECT receipt.auth_session_id
    FROM private.sponsor_email_authentication_receipts receipt
    WHERE receipt.expires_at <= v_now
    ORDER BY receipt.expires_at, receipt.auth_session_id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM private.sponsor_email_authentication_receipts receipt
    USING expired
    WHERE receipt.auth_session_id = expired.auth_session_id
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO v_receipts_deleted
  FROM deleted;

  WITH expired AS MATERIALIZED (
    SELECT reservation.id
    FROM private.sponsor_passwordless_email_delivery_reservations reservation
    WHERE reservation.requested_at < v_now - interval '24 hours'
    ORDER BY reservation.requested_at, reservation.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM private.sponsor_passwordless_email_delivery_reservations
      reservation
    USING expired
    WHERE reservation.id = expired.id
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO v_reservations_deleted
  FROM deleted;

  WITH expired AS MATERIALIZED (
    SELECT attempt.id
    FROM private.sponsor_passwordless_email_verification_attempts attempt
    WHERE attempt.attempted_at < v_now - interval '24 hours'
    ORDER BY attempt.attempted_at, attempt.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM private.sponsor_passwordless_email_verification_attempts
      attempt
    USING expired
    WHERE attempt.id = expired.id
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO v_verification_attempts_deleted
  FROM deleted;

  WITH expired AS MATERIALIZED (
    SELECT attempt.id
    FROM private.advocate_invitation_authentication_attempts attempt
    WHERE attempt.attempted_at <= v_now - interval '24 hours'
    ORDER BY attempt.attempted_at, attempt.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM private.advocate_invitation_authentication_attempts attempt
    USING expired
    WHERE attempt.id = expired.id
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO v_advocate_invitation_attempts_deleted
  FROM deleted;

  v_email_proof_issuance_gates_deleted :=
    public.purge_expired_email_proof_issuance_gates(batch_size);

  RETURN QUERY SELECT
    v_receipts_deleted,
    v_reservations_deleted,
    v_verification_attempts_deleted,
    v_advocate_invitation_attempts_deleted,
    v_email_proof_issuance_gates_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_sponsor_authentication_evidence(
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_sponsor_authentication_evidence(
  integer
) TO service_role;

COMMENT ON FUNCTION public.purge_expired_sponsor_authentication_evidence(
  integer
) IS
  'Deletes bounded batches of expired sponsor and advocate authentication evidence after complete authorization, quota, reservation, spacing, and proof exclusivity windows. Service role only and safe to retry.';

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
    WHEN 'sponsor_authentication' THEN jsonb_build_object(
      'recent_auth_receipts_deleted', 0,
      'passwordless_reservations_deleted', 0,
      'passwordless_verification_attempts_deleted', 0,
      'advocate_invitation_authentication_attempts_deleted', 0,
      'email_proof_issuance_gates_deleted', 0
    )
    WHEN 'advocate_tracking' THEN jsonb_build_object(
      'exposures_deleted', 0,
      'visitors_deleted', 0
    )
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION private.data_retention_zero_counts(text)
  FROM PUBLIC, anon, authenticated, service_role;

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
    WHEN 'sponsor_authentication' THEN
      v_allowed_keys := CASE
        WHEN target_counts ? 'email_proof_issuance_gates_deleted' THEN ARRAY[
          'recent_auth_receipts_deleted',
          'passwordless_reservations_deleted',
          'passwordless_verification_attempts_deleted',
          'advocate_invitation_authentication_attempts_deleted',
          'email_proof_issuance_gates_deleted'
        ]::text[]
        WHEN target_counts ?
          'advocate_invitation_authentication_attempts_deleted' THEN ARRAY[
          'recent_auth_receipts_deleted',
          'passwordless_reservations_deleted',
          'passwordless_verification_attempts_deleted',
          'advocate_invitation_authentication_attempts_deleted'
        ]::text[]
        ELSE ARRAY[
          'recent_auth_receipts_deleted',
          'passwordless_reservations_deleted',
          'passwordless_verification_attempts_deleted'
        ]::text[]
      END;
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

REVOKE ALL ON FUNCTION private.data_retention_counts_are_valid(text, jsonb)
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
  v_existing record;
  v_advocate_oldest timestamp with time zone;
  v_email_proof_oldest timestamp with time zone;
  v_oldest timestamp with time zone;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  PERFORM private.require_data_retention_service_role();

  SELECT backlog.*
  INTO STRICT v_existing
  FROM private.data_retention_backlog_v1(target_step_key) backlog;

  IF target_step_key = 'sponsor_authentication' THEN
    SELECT min(attempt.attempted_at + interval '24 hours')
    INTO v_advocate_oldest
    FROM private.advocate_invitation_authentication_attempts attempt
    WHERE attempt.attempted_at <= v_now - interval '24 hours';

    SELECT min(
      greatest(
        gate.reservation_expires_at,
        COALESCE(gate.next_issuance_at, gate.reservation_expires_at),
        COALESCE(
          gate.proof_exclusivity_expires_at,
          gate.reservation_expires_at
        )
      )
    )
    INTO v_email_proof_oldest
    FROM private.email_proof_issuance_gates gate
    WHERE gate.reservation_expires_at <= v_now
      AND COALESCE(gate.next_issuance_at, '-infinity'::timestamptz) <= v_now
      AND COALESCE(
        gate.proof_exclusivity_expires_at,
        '-infinity'::timestamptz
      ) <= v_now;
  END IF;

  SELECT min(candidate.expired_at)
  INTO v_oldest
  FROM (
    VALUES
      (v_existing.oldest_expired_at),
      (v_advocate_oldest),
      (v_email_proof_oldest)
  ) candidate(expired_at);

  RETURN QUERY SELECT v_oldest IS NOT NULL, v_oldest;
END;
$$;

REVOKE ALL ON FUNCTION private.data_retention_backlog(text)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_sponsor_authentication record;
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
      WHEN 'sponsor_authentication' THEN
        SELECT cleanup.*
        INTO STRICT v_sponsor_authentication
        FROM public.purge_expired_sponsor_authentication_evidence(batch_size)
          cleanup;
        v_counts := jsonb_build_object(
          'recent_auth_receipts_deleted',
          v_sponsor_authentication.recent_auth_receipts_deleted,
          'passwordless_reservations_deleted',
          v_sponsor_authentication.passwordless_reservations_deleted,
          'passwordless_verification_attempts_deleted',
          v_sponsor_authentication.passwordless_verification_attempts_deleted,
          'advocate_invitation_authentication_attempts_deleted',
          v_sponsor_authentication.advocate_invitation_authentication_attempts_deleted,
          'email_proof_issuance_gates_deleted',
          v_sponsor_authentication.email_proof_issuance_gates_deleted
        );
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

COMMENT ON FUNCTION public.run_data_retention_step(
  uuid,
  text,
  integer,
  text,
  text
) IS
  'Runs one idempotent bounded retention step and persists its sanitized outcome. Sponsor authentication includes email proof gate cleanup without adding a seventh top-level step.';

COMMIT;
