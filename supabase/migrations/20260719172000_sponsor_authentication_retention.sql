BEGIN;

/*
 * Sponsor authentication evidence is intentionally short lived. The public
 * boundary below removes bounded batches even when authentication traffic is
 * quiet, while preserving the complete authorization and rate-limit windows.
 */
CREATE OR REPLACE FUNCTION public.purge_expired_sponsor_authentication_evidence(
  batch_size integer DEFAULT 1000
)
RETURNS TABLE (
  recent_auth_receipts_deleted integer,
  passwordless_reservations_deleted integer,
  passwordless_verification_attempts_deleted integer
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

  RETURN QUERY SELECT
    v_receipts_deleted,
    v_reservations_deleted,
    v_verification_attempts_deleted;
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
  'Deletes bounded batches of expired recent-email-auth receipts, passwordless delivery reservations, and passwordless verification attempts outside their complete quota windows. Service role only and safe to retry.';

CREATE OR REPLACE FUNCTION private.data_retention_step_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'checkout_contact_envelopes',
    'email_outbox_contact',
    'gateway_event_payloads',
    'audit_forensics',
    'sponsor_authentication',
    'advocate_tracking'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION private.data_retention_step_is_valid(
  target_step_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT target_step_key = ANY (private.data_retention_step_keys());
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
    WHEN 'sponsor_authentication' THEN jsonb_build_object(
      'recent_auth_receipts_deleted', 0,
      'passwordless_reservations_deleted', 0,
      'passwordless_verification_attempts_deleted', 0
    )
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
    WHEN 'sponsor_authentication' THEN
      v_allowed_keys := ARRAY[
        'recent_auth_receipts_deleted',
        'passwordless_reservations_deleted',
        'passwordless_verification_attempts_deleted'
      ]::text[];
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

ALTER TABLE audit.data_retention_run_events
  DROP CONSTRAINT data_retention_run_events_shape_check;
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
        AND event.payload_retention_expires_at <= v_now;
    WHEN 'audit_forensics' THEN
      SELECT min(forensic.expires_at)
      INTO v_oldest
      FROM audit.audit_event_forensics forensic
      WHERE forensic.expires_at <= v_now;
    WHEN 'sponsor_authentication' THEN
      SELECT min(expired_at)
      INTO v_oldest
      FROM (
        SELECT receipt.expires_at AS expired_at
        FROM private.sponsor_email_authentication_receipts receipt
        WHERE receipt.expires_at <= v_now
        UNION ALL
        SELECT reservation.requested_at + interval '24 hours'
        FROM private.sponsor_passwordless_email_delivery_reservations
          reservation
        WHERE reservation.requested_at < v_now - interval '24 hours'
        UNION ALL
        SELECT attempt.attempted_at + interval '24 hours'
        FROM private.sponsor_passwordless_email_verification_attempts attempt
        WHERE attempt.attempted_at < v_now - interval '24 hours'
      ) expired_authentication_evidence;
    WHEN 'advocate_tracking' THEN
      SELECT min(expired_at)
      INTO v_oldest
      FROM (
        SELECT exposure.retention_expires_at AS expired_at
        FROM public.advocate_exposures exposure
        WHERE exposure.retention_expires_at <= v_now
        UNION ALL
        SELECT visitor.retention_expires_at
        FROM public.browser_visitors visitor
        WHERE visitor.retention_expires_at <= v_now
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

REVOKE ALL ON FUNCTION private.data_retention_step_keys()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.data_retention_step_is_valid(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.data_retention_zero_counts(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.data_retention_counts_are_valid(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.data_retention_backlog(text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.run_data_retention_step(
  uuid,
  text,
  integer,
  text,
  text
) IS
  'Executes one independently committed bounded retention step, including sponsor authentication evidence, and records a sanitized idempotent outcome. Service role only.';

COMMIT;
