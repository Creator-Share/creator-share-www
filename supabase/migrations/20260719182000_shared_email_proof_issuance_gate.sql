BEGIN;

CREATE TABLE private.email_proof_issuance_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_normalization_version smallint NOT NULL
    CHECK (recipient_normalization_version = 1),
  recipient_hmac_key_version smallint NOT NULL
    CHECK (recipient_hmac_key_version = 1),
  recipient_digest bytea NOT NULL
    CHECK (pg_catalog.octet_length(recipient_digest) = 32),
  issuance_flow text NOT NULL
    CHECK (
      issuance_flow IN (
        'advocate-invitation',
        'generic-sign-in',
        'registration',
        'reauthentication',
        'initial-claim',
        'account-claim',
        'password-reset',
        'creator-share-admin-invitation'
      )
    ),
  operation_id uuid NOT NULL
    CHECK (operation_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  lease_token_digest bytea NOT NULL
    CHECK (pg_catalog.octet_length(lease_token_digest) = 32),
  phase text NOT NULL
    CHECK (phase IN ('reserved', 'begun', 'finished')),
  reservation_acquired_at timestamptz NOT NULL,
  reservation_expires_at timestamptz NOT NULL,
  issuance_started_at timestamptz,
  next_issuance_at timestamptz,
  proof_exclusivity_expires_at timestamptz,
  finish_disposition text
    CHECK (
      finish_disposition IS NULL
      OR finish_disposition IN ('issued', 'ambiguous')
    ),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT email_proof_issuance_gates_recipient_unique UNIQUE (
    recipient_normalization_version,
    recipient_hmac_key_version,
    recipient_digest
  ),
  CONSTRAINT email_proof_issuance_gates_reservation_window_check CHECK (
    reservation_expires_at = reservation_acquired_at + interval '30 seconds'
  ),
  CONSTRAINT email_proof_issuance_gates_updated_at_check CHECK (
    updated_at >= reservation_acquired_at
  ),
  CONSTRAINT email_proof_issuance_gates_state_shape_check CHECK (
    CASE phase
      WHEN 'reserved' THEN
        issuance_started_at IS NULL
        AND next_issuance_at IS NULL
        AND proof_exclusivity_expires_at IS NULL
        AND finish_disposition IS NULL
        AND finished_at IS NULL
      WHEN 'begun' THEN
        issuance_started_at IS NOT NULL
        AND next_issuance_at = issuance_started_at + interval '65 seconds'
        AND proof_exclusivity_expires_at =
          issuance_started_at + interval '65 minutes'
        AND finish_disposition IS NULL
        AND finished_at IS NULL
        AND updated_at >= issuance_started_at
      WHEN 'finished' THEN
        issuance_started_at IS NOT NULL
        AND next_issuance_at = issuance_started_at + interval '65 seconds'
        AND finish_disposition IS NOT NULL
        AND finished_at IS NOT NULL
        AND finished_at >= issuance_started_at
        AND updated_at >= finished_at
        AND proof_exclusivity_expires_at =
          issuance_started_at + interval '65 minutes'
      ELSE false
    END
  )
);

ALTER TABLE private.email_proof_issuance_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.email_proof_issuance_gates FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.email_proof_issuance_gates
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX email_proof_issuance_gates_retention_idx
  ON private.email_proof_issuance_gates (
    reservation_expires_at,
    next_issuance_at,
    proof_exclusivity_expires_at
  );

COMMENT ON TABLE private.email_proof_issuance_gates IS
  'One privacy preserving issuance fence per versioned recipient HMAC. MVP accepts only normalization and HMAC key version 1 so a rolling key change cannot split one recipient across parallel fences. It contains no raw email, request source, provider response, or email proof material.';
COMMENT ON COLUMN private.email_proof_issuance_gates.lease_token_digest IS
  'SHA-256 digest of a caller generated 256-bit lease token. The plaintext lease is never stored.';
COMMENT ON COLUMN private.email_proof_issuance_gates.next_issuance_at IS
  'Earliest time another issuance may begin after the 65-second provider spacing window.';
COMMENT ON COLUMN private.email_proof_issuance_gates.proof_exclusivity_expires_at IS
  'Conservative 65-minute exclusivity fence. It never contracts after issuance begins because provider failure cannot prove nonissuance.';

CREATE OR REPLACE FUNCTION private.require_email_proof_issuance_service_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Email proof issuance requires the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Email proof issuance requires the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_email_proof_issuance_fence_input(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_issuance_flow text,
  target_operation_id uuid,
  target_lease_token bytea,
  context_request_id uuid,
  context_trace_id text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_recipient_digest IS NULL
     OR pg_catalog.octet_length(target_recipient_digest) <> 32
     OR target_recipient_normalization_version IS NULL
     OR target_recipient_normalization_version <> 1
     OR target_recipient_hmac_key_version IS NULL
     OR target_recipient_hmac_key_version <> 1
     OR target_issuance_flow IS NULL
     OR target_issuance_flow NOT IN (
       'advocate-invitation',
       'generic-sign-in',
       'registration',
       'reauthentication',
       'initial-claim',
       'account-claim',
       'password-reset',
       'creator-share-admin-invitation'
     )
     OR target_operation_id IS NULL
     OR target_operation_id =
       '00000000-0000-0000-0000-000000000000'::uuid
     OR target_lease_token IS NULL
     OR pg_catalog.octet_length(target_lease_token) <> 32
     OR context_request_id IS NULL
     OR context_request_id =
       '00000000-0000-0000-0000-000000000000'::uuid
     OR (
       context_trace_id IS NOT NULL
       AND (
         pg_catalog.octet_length(context_trace_id) NOT BETWEEN 1 AND 255
         OR context_trace_id ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Email proof issuance fence input is invalid'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.prevent_email_proof_issuance_gate_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Email proof issuance gates cannot be truncated'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_email_proof_issuance_gate(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_issuance_flow text,
  target_operation_id uuid,
  target_lease_token bytea,
  context_request_id uuid,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  acquisition_result text,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate private.email_proof_issuance_gates%ROWTYPE;
  v_now timestamptz;
  v_lease_token_digest bytea;
  v_retry_at timestamptz;
  v_retry_after_seconds integer;
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
  v_all_fences_expired boolean;
BEGIN
  PERFORM private.require_email_proof_issuance_service_role();
  PERFORM private.validate_email_proof_issuance_fence_input(
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_issuance_flow,
    target_operation_id,
    target_lease_token,
    context_request_id,
    v_trace_id
  );

  v_lease_token_digest := extensions.digest(target_lease_token, 'sha256');

  LOOP
    v_now := clock_timestamp();
    PERFORM audit.set_actor_context(
      context_actor_type => 'system'::audit.audit_actor_type,
      context_system_actor => 'email-proof-issuance-gate',
      context_tool => 'acquire_email_proof_issuance_gate',
      context_request_id => context_request_id::text,
      context_trace_id => v_trace_id,
      context_metadata => jsonb_build_object(
        'operation', 'acquire',
        'outcome', 'acquired'
      )
    );

    INSERT INTO private.email_proof_issuance_gates (
      recipient_normalization_version,
      recipient_hmac_key_version,
      recipient_digest,
      issuance_flow,
      operation_id,
      lease_token_digest,
      phase,
      reservation_acquired_at,
      reservation_expires_at,
      updated_at
    ) VALUES (
      target_recipient_normalization_version,
      target_recipient_hmac_key_version,
      target_recipient_digest,
      target_issuance_flow,
      target_operation_id,
      v_lease_token_digest,
      'reserved',
      v_now,
      v_now + interval '30 seconds',
      v_now
    )
    ON CONFLICT (
      recipient_normalization_version,
      recipient_hmac_key_version,
      recipient_digest
    ) DO NOTHING
    RETURNING * INTO v_gate;

    IF FOUND THEN
      RETURN QUERY SELECT 'acquired'::text, 0;
      RETURN;
    END IF;

    SELECT gate.*
    INTO v_gate
    FROM private.email_proof_issuance_gates gate
    WHERE gate.recipient_normalization_version =
        target_recipient_normalization_version
      AND gate.recipient_hmac_key_version =
        target_recipient_hmac_key_version
      AND gate.recipient_digest = target_recipient_digest
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_now := clock_timestamp();

    v_all_fences_expired := CASE v_gate.phase
      WHEN 'reserved' THEN v_gate.reservation_expires_at <= v_now
      ELSE
        v_gate.reservation_expires_at <= v_now
        AND v_gate.next_issuance_at <= v_now
        AND v_gate.proof_exclusivity_expires_at <= v_now
    END;

    IF v_all_fences_expired THEN
      IF v_gate.operation_id = target_operation_id
         AND v_gate.issuance_flow = target_issuance_flow
         AND v_gate.lease_token_digest = v_lease_token_digest THEN
        RAISE EXCEPTION 'Email proof issuance fence is stale'
          USING ERRCODE = '55000';
      END IF;

      UPDATE private.email_proof_issuance_gates gate
      SET
        issuance_flow = target_issuance_flow,
        operation_id = target_operation_id,
        lease_token_digest = v_lease_token_digest,
        phase = 'reserved',
        reservation_acquired_at = v_now,
        reservation_expires_at = v_now + interval '30 seconds',
        issuance_started_at = NULL,
        next_issuance_at = NULL,
        proof_exclusivity_expires_at = NULL,
        finish_disposition = NULL,
        finished_at = NULL,
        updated_at = v_now
      WHERE gate.id = v_gate.id;

      RETURN QUERY SELECT 'acquired'::text, 0;
      RETURN;
    END IF;

    IF v_gate.operation_id = target_operation_id
       AND v_gate.issuance_flow = target_issuance_flow THEN
      IF v_gate.phase = 'reserved'
         AND v_gate.lease_token_digest = v_lease_token_digest THEN
        RETURN QUERY SELECT 'acquired'::text, 0;
        RETURN;
      END IF;

      v_retry_at := CASE v_gate.phase
        WHEN 'reserved' THEN v_gate.reservation_expires_at
        ELSE GREATEST(
          v_gate.reservation_expires_at,
          v_gate.next_issuance_at,
          v_gate.proof_exclusivity_expires_at
        )
      END;
      v_retry_after_seconds := LEAST(
        3900,
        GREATEST(
          0,
          ceil(extract(epoch FROM v_retry_at - v_now))::integer
        )
      );

      RETURN QUERY SELECT 'coalesced'::text, v_retry_after_seconds;
      RETURN;
    END IF;

    v_retry_at := CASE v_gate.phase
      WHEN 'reserved' THEN v_gate.reservation_expires_at
      ELSE GREATEST(
        v_gate.reservation_expires_at,
        v_gate.next_issuance_at,
        v_gate.proof_exclusivity_expires_at
      )
    END;
    v_retry_after_seconds := LEAST(
      3900,
      GREATEST(
        1,
        ceil(extract(epoch FROM v_retry_at - v_now))::integer
      )
    );

    RETURN QUERY SELECT 'deferred'::text, v_retry_after_seconds;
    RETURN;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_email_proof_issuance(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_issuance_flow text,
  target_operation_id uuid,
  target_lease_token bytea,
  context_request_id uuid,
  context_trace_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate private.email_proof_issuance_gates%ROWTYPE;
  v_now timestamptz;
  v_lease_token_digest bytea;
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
BEGIN
  PERFORM private.require_email_proof_issuance_service_role();
  PERFORM private.validate_email_proof_issuance_fence_input(
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_issuance_flow,
    target_operation_id,
    target_lease_token,
    context_request_id,
    v_trace_id
  );

  v_lease_token_digest := extensions.digest(target_lease_token, 'sha256');

  SELECT gate.*
  INTO v_gate
  FROM private.email_proof_issuance_gates gate
  WHERE gate.recipient_normalization_version =
      target_recipient_normalization_version
    AND gate.recipient_hmac_key_version = target_recipient_hmac_key_version
    AND gate.recipient_digest = target_recipient_digest
  FOR UPDATE;

  v_now := clock_timestamp();

  IF NOT FOUND
     OR v_gate.issuance_flow IS DISTINCT FROM target_issuance_flow
     OR v_gate.operation_id IS DISTINCT FROM target_operation_id
     OR v_gate.lease_token_digest IS DISTINCT FROM v_lease_token_digest
     OR (
       v_gate.phase = 'reserved'
       AND v_gate.reservation_expires_at <= v_now
     )
     OR v_gate.phase IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'Email proof issuance fence is stale'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'email-proof-issuance-gate',
    context_tool => 'begin_email_proof_issuance',
    context_request_id => context_request_id::text,
    context_trace_id => v_trace_id,
    context_metadata => jsonb_build_object('operation', 'begin')
  );

  UPDATE private.email_proof_issuance_gates gate
  SET
    phase = 'begun',
    issuance_started_at = v_now,
    next_issuance_at = v_now + interval '65 seconds',
    proof_exclusivity_expires_at = v_now + interval '65 minutes',
    updated_at = v_now
  WHERE gate.id = v_gate.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_email_proof_issuance(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_issuance_flow text,
  target_operation_id uuid,
  target_lease_token bytea,
  target_finish_disposition text,
  context_request_id uuid,
  context_trace_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate private.email_proof_issuance_gates%ROWTYPE;
  v_now timestamptz;
  v_lease_token_digest bytea;
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
BEGIN
  PERFORM private.require_email_proof_issuance_service_role();
  PERFORM private.validate_email_proof_issuance_fence_input(
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_issuance_flow,
    target_operation_id,
    target_lease_token,
    context_request_id,
    v_trace_id
  );

  IF target_finish_disposition IS NULL
     OR target_finish_disposition NOT IN (
       'issued',
       'ambiguous'
     ) THEN
    RAISE EXCEPTION 'Email proof issuance finish disposition is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_lease_token_digest := extensions.digest(target_lease_token, 'sha256');

  SELECT gate.*
  INTO v_gate
  FROM private.email_proof_issuance_gates gate
  WHERE gate.recipient_normalization_version =
      target_recipient_normalization_version
    AND gate.recipient_hmac_key_version = target_recipient_hmac_key_version
    AND gate.recipient_digest = target_recipient_digest
  FOR UPDATE;

  IF NOT FOUND
     OR v_gate.issuance_flow IS DISTINCT FROM target_issuance_flow
     OR v_gate.operation_id IS DISTINCT FROM target_operation_id
     OR v_gate.lease_token_digest IS DISTINCT FROM v_lease_token_digest
     OR v_gate.phase = 'reserved' THEN
    RAISE EXCEPTION 'Email proof issuance fence is stale'
      USING ERRCODE = '55000';
  END IF;

  IF v_gate.phase = 'finished' THEN
    IF v_gate.finish_disposition IS DISTINCT FROM target_finish_disposition THEN
      RAISE EXCEPTION 'Email proof issuance fence is stale'
        USING ERRCODE = '55000';
    END IF;
    RETURN;
  END IF;

  v_now := clock_timestamp();

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'email-proof-issuance-gate',
    context_tool => 'finish_email_proof_issuance',
    context_request_id => context_request_id::text,
    context_trace_id => v_trace_id,
    context_metadata => jsonb_build_object(
      'operation', 'finish',
      'outcome', target_finish_disposition
    )
  );

  UPDATE private.email_proof_issuance_gates gate
  SET
    phase = 'finished',
    finish_disposition = target_finish_disposition,
    finished_at = v_now,
    updated_at = v_now
  WHERE gate.id = v_gate.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_email_proof_issuance(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_issuance_flow text,
  target_operation_id uuid,
  target_lease_token bytea,
  context_request_id uuid,
  context_trace_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate private.email_proof_issuance_gates%ROWTYPE;
  v_now timestamptz;
  v_lease_token_digest bytea;
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
BEGIN
  PERFORM private.require_email_proof_issuance_service_role();
  PERFORM private.validate_email_proof_issuance_fence_input(
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_issuance_flow,
    target_operation_id,
    target_lease_token,
    context_request_id,
    v_trace_id
  );

  v_lease_token_digest := extensions.digest(target_lease_token, 'sha256');

  SELECT gate.*
  INTO v_gate
  FROM private.email_proof_issuance_gates gate
  WHERE gate.recipient_normalization_version =
      target_recipient_normalization_version
    AND gate.recipient_hmac_key_version = target_recipient_hmac_key_version
    AND gate.recipient_digest = target_recipient_digest
  FOR UPDATE;

  v_now := clock_timestamp();

  IF NOT FOUND
     OR v_gate.issuance_flow IS DISTINCT FROM target_issuance_flow
     OR v_gate.operation_id IS DISTINCT FROM target_operation_id
     OR v_gate.lease_token_digest IS DISTINCT FROM v_lease_token_digest
     OR v_gate.phase IS DISTINCT FROM 'reserved'
     OR v_gate.reservation_expires_at <= v_now THEN
    RAISE EXCEPTION 'Email proof issuance fence is stale'
      USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'email-proof-issuance-gate',
    context_tool => 'abandon_email_proof_issuance',
    context_request_id => context_request_id::text,
    context_trace_id => v_trace_id,
    context_metadata => jsonb_build_object('operation', 'abandon')
  );

  DELETE FROM private.email_proof_issuance_gates gate
  WHERE gate.id = v_gate.id;
END;
$$;

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
BEGIN
  PERFORM private.require_email_proof_issuance_service_role();

  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Email proof issuance retention batch size is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'email-proof-issuance-retention',
    context_tool => 'purge_expired_email_proof_issuance_gates',
    context_metadata => jsonb_build_object('operation', 'retention')
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

CREATE TRIGGER email_proof_issuance_gates_audit_row_change
AFTER INSERT OR UPDATE OR DELETE
ON private.email_proof_issuance_gates
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change(
  '',
  'recipient_digest',
  'lease_token_digest'
);

CREATE TRIGGER email_proof_issuance_gates_no_truncate
BEFORE TRUNCATE
ON private.email_proof_issuance_gates
FOR EACH STATEMENT
EXECUTE FUNCTION private.prevent_email_proof_issuance_gate_truncate();

REVOKE ALL ON FUNCTION private.require_email_proof_issuance_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prevent_email_proof_issuance_gate_truncate()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_email_proof_issuance_fence_input(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.acquire_email_proof_issuance_gate(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finish_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  text,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.abandon_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_expired_email_proof_issuance_gates(integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.acquire_email_proof_issuance_gate(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  text,
  uuid,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.abandon_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_email_proof_issuance_gates(integer)
  TO service_role;

COMMENT ON FUNCTION public.acquire_email_proof_issuance_gate(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) IS
  'Service-only row-key acquisition. It returns exactly acquired, coalesced, or deferred plus only a capped rounded retry delay. It never returns incumbent operation, lease, timestamp, or state details.';
COMMENT ON FUNCTION public.begin_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) IS
  'Service-only fenced transition immediately before provider work. It pessimistically starts both the 65-second spacing window and 65-minute proof exclusivity window.';
COMMENT ON FUNCTION public.finish_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  text,
  uuid,
  text
) IS
  'Service-only fenced terminal transition. Issued and ambiguous are the only outcomes because no provider error can prove nonissuance. Both retain the full proof fence.';
COMMENT ON FUNCTION public.abandon_email_proof_issuance(
  bytea,
  smallint,
  smallint,
  text,
  uuid,
  bytea,
  uuid,
  text
) IS
  'Service-only exact pre-begin abandonment. It cannot release a fence after provider work may have started.';
COMMENT ON FUNCTION public.purge_expired_email_proof_issuance_gates(integer) IS
  'Service-only bounded retention. A row is eligible only after its reservation, spacing, and proof fences have all expired.';

COMMIT;
