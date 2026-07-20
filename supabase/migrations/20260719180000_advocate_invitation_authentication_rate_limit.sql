BEGIN;

CREATE TABLE private.advocate_invitation_authentication_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_digest bytea NOT NULL
    CHECK (pg_catalog.octet_length(source_digest) = 32),
  source_hmac_key_version smallint NOT NULL
    CHECK (source_hmac_key_version = 1),
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.advocate_invitation_authentication_attempts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_invitation_authentication_attempts
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.advocate_invitation_authentication_attempts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE private.advocate_invitation_authentication_attempts_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX advocate_invitation_auth_attempt_source_time_idx
  ON private.advocate_invitation_authentication_attempts (
    source_hmac_key_version,
    source_digest,
    attempted_at DESC
  );

CREATE INDEX advocate_invitation_auth_attempt_time_idx
  ON private.advocate_invitation_authentication_attempts (attempted_at DESC);

COMMENT ON TABLE private.advocate_invitation_authentication_attempts IS
  'Short-lived availability reservations for advocate invitation email-proof authentication. Inline pruning and the durable hourly retention worker remove rows beyond the active 24-hour quota horizon. The only source signal is a purpose-separated HMAC digest. Raw network addresses, token material or hashes, capabilities, user identifiers, email addresses, and other contact data are prohibited.';

CREATE OR REPLACE FUNCTION public.reserve_advocate_invitation_authentication_attempt(
  target_source_digest bytea,
  target_source_hmac_key_version smallint
)
RETURNS TABLE (authentication_allowed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Advocate invitation authentication reservation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF target_source_digest IS NULL
     OR pg_catalog.octet_length(target_source_digest) <> 32
     OR target_source_hmac_key_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Advocate invitation authentication reservation is invalid'
      USING ERRCODE = '22023';
  END IF;

  /*
   * A single transaction-wide mutex makes every source and global count plus
   * its resulting insert one atomic decision. These deliberately conservative
   * MVP limits support hundreds of legitimate invitations while bounding
   * online proof guessing: 20 attempts per source per 10 minutes, 100 per
   * source per 24 hours, 300 globally per hour, and 1,500 globally per day.
   */
  PERFORM pg_catalog.pg_advisory_xact_lock(1129530707, 1800);

  DELETE FROM private.advocate_invitation_authentication_attempts
  WHERE attempted_at <= v_now - interval '24 hours';

  IF (
       SELECT count(*)
       FROM private.advocate_invitation_authentication_attempts attempt
       WHERE attempt.source_digest = target_source_digest
         AND attempt.source_hmac_key_version = target_source_hmac_key_version
         AND attempt.attempted_at > v_now - interval '10 minutes'
     ) >= 20
     OR (
       SELECT count(*)
       FROM private.advocate_invitation_authentication_attempts attempt
       WHERE attempt.source_digest = target_source_digest
         AND attempt.source_hmac_key_version = target_source_hmac_key_version
         AND attempt.attempted_at > v_now - interval '24 hours'
     ) >= 100
     OR (
       SELECT count(*)
       FROM private.advocate_invitation_authentication_attempts attempt
       WHERE attempt.attempted_at > v_now - interval '1 hour'
     ) >= 300
     OR (
       SELECT count(*)
       FROM private.advocate_invitation_authentication_attempts attempt
       WHERE attempt.attempted_at > v_now - interval '24 hours'
     ) >= 1500 THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO private.advocate_invitation_authentication_attempts (
    source_digest,
    source_hmac_key_version,
    attempted_at
  ) VALUES (
    target_source_digest,
    target_source_hmac_key_version,
    v_now
  );

  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_advocate_invitation_authentication_attempt(
  bytea,
  smallint
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_advocate_invitation_authentication_attempt(
  bytea,
  smallint
) TO service_role;

COMMENT ON FUNCTION public.reserve_advocate_invitation_authentication_attempt(
  bytea,
  smallint
) IS
  'Service-role-only atomic source and global availability reservation for advocate invitation email-proof authentication. It returns one uniform boolean decision and stores only a purpose-separated source HMAC for the active 24-hour quota horizon.';

DROP FUNCTION public.purge_expired_sponsor_authentication_evidence(integer);

CREATE FUNCTION public.purge_expired_sponsor_authentication_evidence(
  batch_size integer DEFAULT 1000
)
RETURNS TABLE (
  recent_auth_receipts_deleted integer,
  passwordless_reservations_deleted integer,
  passwordless_verification_attempts_deleted integer,
  advocate_invitation_authentication_attempts_deleted integer
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

  RETURN QUERY SELECT
    v_receipts_deleted,
    v_reservations_deleted,
    v_verification_attempts_deleted,
    v_advocate_invitation_attempts_deleted;
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
  'Deletes bounded batches of expired sponsor and advocate invitation authentication evidence outside their complete authorization and quota windows. Service role only and safe to retry.';

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
      'advocate_invitation_authentication_attempts_deleted', 0
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

ALTER TABLE audit.data_retention_run_events
  DROP CONSTRAINT data_retention_run_events_shape_check;

ALTER FUNCTION private.data_retention_counts_are_valid(text, jsonb)
  RENAME TO data_retention_counts_are_valid_v1;

CREATE FUNCTION private.data_retention_counts_are_valid(
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
  v_advocate_count text;
BEGIN
  IF target_step_key = 'sponsor_authentication'
     AND target_counts ?
       'advocate_invitation_authentication_attempts_deleted' THEN
    v_advocate_count := target_counts ->>
      'advocate_invitation_authentication_attempts_deleted';
    IF jsonb_typeof(
         target_counts ->
           'advocate_invitation_authentication_attempts_deleted'
       ) <> 'number'
       OR v_advocate_count !~ '^(0|[1-9][0-9]*)$'
       OR v_advocate_count::numeric > 5000 THEN
      RETURN false;
    END IF;

    RETURN private.data_retention_counts_are_valid_v1(
      target_step_key,
      target_counts -
        'advocate_invitation_authentication_attempts_deleted'
    );
  END IF;

  RETURN private.data_retention_counts_are_valid_v1(
    target_step_key,
    target_counts
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.data_retention_counts_are_valid_v1(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.data_retention_counts_are_valid(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE audit.data_retention_run_events
  ADD CONSTRAINT data_retention_run_events_shape_check CHECK (
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
    OR (
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
      AND completed_steps <@ private.data_retention_step_keys()
      AND failed_steps <@ private.data_retention_step_keys()
      AND backlog_steps <@ private.data_retention_step_keys()
      AND CASE
        WHEN status = 'abandoned' THEN health_status = 'abandoned'
        WHEN status = 'completed_with_failures' THEN health_status = 'failed'
        WHEN cardinality(backlog_steps) > 0
          THEN health_status = 'backlog_remaining'
        ELSE health_status = 'clean'
      END
    )
  );

ALTER FUNCTION private.data_retention_backlog(text)
  RENAME TO data_retention_backlog_v1;

CREATE FUNCTION private.data_retention_backlog(
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
  END IF;

  v_oldest := CASE
    WHEN v_existing.oldest_expired_at IS NULL THEN v_advocate_oldest
    WHEN v_advocate_oldest IS NULL THEN v_existing.oldest_expired_at
    ELSE least(v_existing.oldest_expired_at, v_advocate_oldest)
  END;

  RETURN QUERY SELECT v_oldest IS NOT NULL, v_oldest;
END;
$$;

REVOKE ALL ON FUNCTION private.data_retention_backlog_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;
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
          v_sponsor_authentication.advocate_invitation_authentication_attempts_deleted
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

COMMIT;
