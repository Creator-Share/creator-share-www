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

REVOKE ALL ON FUNCTION private.data_retention_zero_counts(text)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE audit.data_retention_run_events
  DROP CONSTRAINT data_retention_run_events_shape_check;

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

REVOKE ALL ON FUNCTION private.data_retention_backlog_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.data_retention_backlog(text)
  FROM PUBLIC, anon, authenticated, service_role;

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
