BEGIN;

CREATE TABLE private.advocate_invitation_email_proof_settlements (
  outbox_id uuid NOT NULL,
  lease_token_digest bytea NOT NULL
    CHECK (pg_catalog.octet_length(lease_token_digest) = 32),
  disposition text NOT NULL
    CHECK (
      disposition IN (
        'coalesced',
        'deferred',
        'ambiguous',
        'unavailable',
        'begin_ambiguous',
        'issued_not_handed_off',
        'issued_target_mismatch'
      )
    ),
  requested_retry_after_seconds integer NOT NULL
    CHECK (requested_retry_after_seconds BETWEEN 0 AND 86400),
  retryable boolean NOT NULL,
  attempt_refunded boolean NOT NULL,
  available_at timestamp with time zone NOT NULL,
  settled_at timestamp with time zone NOT NULL,
  PRIMARY KEY (outbox_id, lease_token_digest),
  CONSTRAINT advocate_invitation_email_proof_settlements_outbox_fkey
    FOREIGN KEY (outbox_id)
    REFERENCES public.advocate_invitation_email_outbox(id)
    ON DELETE RESTRICT,
  CONSTRAINT advocate_invitation_email_proof_settlements_refund_check CHECK (
    attempt_refunded = (
      disposition IN (
        'coalesced',
        'deferred',
        'unavailable',
        'begin_ambiguous'
      )
    )
  ),
  CONSTRAINT advocate_invitation_email_proof_settlements_delay_check CHECK (
    (
      disposition IN ('coalesced', 'deferred')
      AND requested_retry_after_seconds BETWEEN 0 AND 3900
    )
    OR (
      disposition IN (
        'ambiguous',
        'begin_ambiguous',
        'issued_not_handed_off',
        'issued_target_mismatch'
      )
      AND requested_retry_after_seconds = 3900
    )
    OR (
      disposition = 'unavailable'
      AND requested_retry_after_seconds BETWEEN 1 AND 86400
    )
  ),
  CONSTRAINT advocate_invitation_email_proof_settlements_time_check CHECK (
    available_at >= settled_at
  )
);

ALTER TABLE private.advocate_invitation_email_proof_settlements
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_invitation_email_proof_settlements
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.advocate_invitation_email_proof_settlements
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.advocate_invitation_email_proof_settlements IS
  'Immutable contact-free replay receipts for pre-handoff advocate invitation email proof outcomes. Rows contain only a lease digest, bounded disposition, retry result, and server timestamps.';
COMMENT ON COLUMN private.advocate_invitation_email_proof_settlements.lease_token_digest IS
  'SHA-256 digest of the invitation worker lease. The plaintext lease is never stored or returned.';

CREATE OR REPLACE FUNCTION private.protect_advocate_invitation_email_proof_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND pg_catalog.current_setting(
       'app.advocate.invitation_email_operation',
       true
     ) = 'settle_email_proof' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Advocate invitation email proof settlements are immutable'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.protect_advocate_invitation_email_proof_settlement()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.advocate_invitation_email_outbox
  DROP CONSTRAINT advocate_invitation_email_outbox_error_check,
  ADD CONSTRAINT advocate_invitation_email_outbox_error_check CHECK (
    last_error_code IS NULL
    OR last_error_code = ANY (ARRAY[
      'invitation_email_material_invalid',
      'invitation_target_unavailable',
      'auth_link_generation_failed',
      'email_provider_unavailable',
      'email_delivery_rejected',
      'internal_error',
      'email_proof_deferred',
      'email_proof_issuance_ambiguous',
      'email_proof_issued_not_handed_off',
      'email_proof_unavailable'
    ]::text[])
  );

CREATE TRIGGER advocate_invitation_email_proof_settlements_protect
BEFORE INSERT OR UPDATE OR DELETE
ON private.advocate_invitation_email_proof_settlements
FOR EACH ROW
EXECUTE FUNCTION private.protect_advocate_invitation_email_proof_settlement();

CREATE TRIGGER advocate_invitation_email_proof_settlements_no_truncate
BEFORE TRUNCATE
ON private.advocate_invitation_email_proof_settlements
FOR EACH STATEMENT
EXECUTE FUNCTION audit.prevent_audited_table_truncate();

CREATE TRIGGER advocate_invitation_email_proof_settlements_audit_row_change
AFTER INSERT OR UPDATE OR DELETE
ON private.advocate_invitation_email_proof_settlements
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change(
  '',
  'lease_token_digest'
);


CREATE FUNCTION public.claim_advocate_invitation_email_jobs(
  worker_id text,
  shared_email_proof_issuer_version smallint,
  batch_size integer DEFAULT 10,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL
)
RETURNS TABLE (
  outbox_id uuid,
  invitation_id uuid,
  advocate_id uuid,
  lease_token text,
  lease_expires_at timestamp with time zone,
  target_auth_user_id uuid,
  template_key text,
  template_data jsonb,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  secret_payload_ciphertext bytea,
  capability_digest bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  provider_idempotency_key text,
  attempt_count smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF worker_id IS NULL
     OR worker_id <> btrim(worker_id)
     OR char_length(worker_id) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Worker identity must contain between 1 and 120 characters'
      USING ERRCODE = '22023';
  END IF;

  IF shared_email_proof_issuer_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Shared advocate invitation email proof issuer version is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invitation email claim batch size must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255 THEN
    RAISE EXCEPTION 'Invitation worker request identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => worker_id,
    context_tool => 'advocate-invitation-email-worker',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_reason => 'Redact invitation delivery envelopes that are no longer usable',
    context_metadata => jsonb_build_object(
      'operation', 'redact',
      'resource_kind', 'advocate_invitation_email_outbox'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'purge',
    true
  );

  WITH candidates AS MATERIALIZED (
    SELECT outbox.id
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
     AND invitation.advocate_id = outbox.advocate_id
    WHERE outbox.contact_redacted_at IS NULL
      AND (
        invitation.accepted_at IS NOT NULL
        OR invitation.revoked_at IS NOT NULL
        OR invitation.expires_at <= v_now
      )
    ORDER BY invitation.expires_at, outbox.id
    LIMIT 500
    FOR UPDATE OF outbox SKIP LOCKED
  )
  UPDATE public.advocate_invitation_email_outbox outbox
  SET
    status = CASE
      WHEN outbox.status = 'sent'
        THEN 'sent'::public.email_outbox_status
      ELSE 'cancelled'::public.email_outbox_status
    END,
    recipient_email_ciphertext = NULL,
    recipient_email_hmac = NULL,
    email_normalization_version = NULL,
    email_hmac_key_version = NULL,
    email_encryption_key_version = NULL,
    secret_payload_ciphertext = NULL,
    secret_payload_ciphertext_sha256 = NULL,
    contact_redacted_at = v_now
  FROM candidates candidate
  WHERE outbox.id = candidate.id;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => worker_id,
    context_tool => 'advocate-invitation-email-worker',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_reason => 'Claim encrypted advocate invitation delivery envelopes',
    context_metadata => jsonb_build_object(
      'operation', 'claim',
      'resource_kind', 'advocate_invitation_email_outbox',
      'outcome', 'claimed'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'claim',
    true
  );

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT outbox.id
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
     AND invitation.advocate_id = outbox.advocate_id
    WHERE private.advocate_invitation_delivery_is_eligible(invitation.id)
      AND outbox.contact_redacted_at IS NULL
      AND outbox.attempt_count < outbox.max_attempts
      AND (
        (
          outbox.status IN ('pending', 'failed')
          AND outbox.available_at <= v_now
        )
        OR
        (
          outbox.status = 'processing'
          AND outbox.delivery_started_at IS NULL
          AND outbox.locked_at <= v_now - interval '5 minutes'
        )
      )
    ORDER BY outbox.available_at, outbox.created_at, outbox.id
    LIMIT batch_size
    FOR UPDATE OF outbox SKIP LOCKED
  ), leases AS MATERIALIZED (
    SELECT
      candidate.id,
      encode(extensions.gen_random_bytes(32), 'hex') AS plaintext_token
    FROM candidates candidate
  ), claimed AS (
    UPDATE public.advocate_invitation_email_outbox outbox
    SET
      status = 'processing',
      attempt_count = outbox.attempt_count + 1,
      locked_at = v_now,
      locked_by = worker_id,
      locked_lease_token_digest = extensions.digest(
        lease.plaintext_token,
        'sha256'
      ),
      delivery_started_at = NULL,
      provider_message_id = NULL,
      sent_at = NULL,
      last_error_code = NULL,
      cancelled_at = NULL
    FROM leases lease
    WHERE outbox.id = lease.id
    RETURNING outbox.*
  )
  SELECT
    claimed.id,
    claimed.invitation_id,
    claimed.advocate_id,
    lease.plaintext_token,
    claimed.locked_at + interval '5 minutes',
    invitation.target_auth_user_id,
    claimed.template_key,
    claimed.template_data,
    claimed.recipient_email_ciphertext,
    claimed.recipient_email_hmac,
    claimed.secret_payload_ciphertext,
    invitation.token_digest,
    claimed.email_normalization_version,
    claimed.email_hmac_key_version,
    claimed.email_encryption_key_version,
    claimed.provider_idempotency_key,
    claimed.attempt_count
  FROM claimed
  JOIN leases lease ON lease.id = claimed.id
  JOIN public.advocate_invitations invitation
    ON invitation.id = claimed.invitation_id
   AND invitation.advocate_id = claimed.advocate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_advocate_invitation_email_jobs(
  text,
  smallint,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_advocate_invitation_email_jobs(
  text,
  smallint,
  integer,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.claim_advocate_invitation_email_jobs(
  text,
  smallint,
  integer,
  text,
  text
) IS
  'Shared-issuer-only encrypted invitation email claim. The removed four-argument signature fences legacy workers at migration install, and version 1 claims remain closed until the one-time proof quarantine commits.';

CREATE OR REPLACE FUNCTION public.settle_advocate_invitation_email_proof_issuance(
  target_outbox_id uuid,
  lease_token text,
  proof_disposition text,
  retry_after_seconds integer,
  context_request_id uuid,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  retryable boolean,
  attempt_refunded boolean,
  available_at timestamp with time zone,
  settled_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamp with time zone;
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
  v_advocate_id uuid;
  v_outbox public.advocate_invitation_email_outbox%ROWTYPE;
  v_invitation public.advocate_invitations%ROWTYPE;
  v_receipt private.advocate_invitation_email_proof_settlements%ROWTYPE;
  v_lease_token_digest bytea;
  v_attempt_refunded boolean;
  v_result_attempt_count smallint;
  v_retryable boolean;
  v_available_at timestamp with time zone;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF target_outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR proof_disposition IS NULL
     OR proof_disposition NOT IN (
       'coalesced',
       'deferred',
       'ambiguous',
       'unavailable',
       'begin_ambiguous',
       'issued_not_handed_off',
       'issued_target_mismatch'
     )
     OR retry_after_seconds IS NULL
     OR (
       proof_disposition IN ('coalesced', 'deferred')
       AND retry_after_seconds NOT BETWEEN 0 AND 3900
     )
     OR (
       proof_disposition IN (
         'ambiguous',
         'begin_ambiguous',
         'issued_not_handed_off',
         'issued_target_mismatch'
       )
       AND retry_after_seconds <> 3900
     )
     OR (
       proof_disposition = 'unavailable'
       AND retry_after_seconds NOT BETWEEN 1 AND 86400
     )
     OR context_request_id IS NULL
     OR context_request_id =
       '00000000-0000-0000-0000-000000000000'::uuid
     OR (
       context_trace_id IS NOT NULL
       AND (
         v_trace_id IS NULL
         OR context_trace_id IS DISTINCT FROM v_trace_id
         OR pg_catalog.octet_length(v_trace_id) > 255
         OR v_trace_id ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Invitation email proof settlement is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_lease_token_digest := extensions.digest(lease_token, 'sha256');

  SELECT outbox.advocate_id
  INTO v_advocate_id
  FROM public.advocate_invitation_email_outbox outbox
  WHERE outbox.id = target_outbox_id;

  PERFORM 1
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation delivery lease is unavailable'
      USING ERRCODE = '55P03';
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM public.advocate_invitation_email_outbox outbox
  WHERE outbox.id = target_outbox_id
  FOR UPDATE;

  SELECT receipt.*
  INTO v_receipt
  FROM private.advocate_invitation_email_proof_settlements receipt
  WHERE receipt.outbox_id = target_outbox_id
    AND receipt.lease_token_digest = v_lease_token_digest;

  IF FOUND THEN
    IF v_receipt.disposition IS DISTINCT FROM proof_disposition
       OR v_receipt.requested_retry_after_seconds IS DISTINCT FROM
         retry_after_seconds THEN
      RAISE EXCEPTION 'Invitation email proof settlement replay conflicts'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY
    SELECT
      v_receipt.retryable,
      v_receipt.attempt_refunded,
      v_receipt.available_at,
      v_receipt.settled_at;
    RETURN;
  END IF;

  SELECT invitation.*
  INTO v_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.id = v_outbox.invitation_id
    AND invitation.advocate_id = v_outbox.advocate_id
  FOR UPDATE;

  v_now := clock_timestamp();

  IF NOT FOUND
     OR v_outbox.status <> 'processing'
     OR v_outbox.locked_at <= v_now - interval '5 minutes'
     OR v_outbox.delivery_started_at IS NOT NULL
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       v_lease_token_digest THEN
    RAISE EXCEPTION 'Invitation email proof settlement does not match the active lease'
      USING ERRCODE = '55P03';
  END IF;

  v_attempt_refunded := proof_disposition IN (
    'coalesced',
    'deferred',
    'unavailable',
    'begin_ambiguous'
  );
  v_result_attempt_count := v_outbox.attempt_count -
    CASE WHEN v_attempt_refunded THEN 1 ELSE 0 END;
  v_retryable :=
    proof_disposition <> 'issued_target_mismatch'
    AND v_result_attempt_count < v_outbox.max_attempts
    AND v_now + make_interval(secs => retry_after_seconds) <
      v_invitation.expires_at
    AND v_invitation.accepted_at IS NULL
    AND v_invitation.revoked_at IS NULL;
  v_available_at := CASE
    WHEN v_retryable
      THEN v_now + make_interval(secs => retry_after_seconds)
    ELSE GREATEST(v_invitation.expires_at, v_now)
  END;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_effective_user_id => v_invitation.target_auth_user_id,
    context_system_actor => v_outbox.locked_by,
    context_tool => 'advocate-invitation-email-worker',
    context_request_id => context_request_id::text,
    context_trace_id => v_trace_id,
    context_reason => 'Settle advocate invitation email proof issuance before provider handoff',
    context_metadata => jsonb_build_object(
      'operation', 'settle_email_proof',
      'resource_kind', 'advocate_invitation_email_outbox',
      'resource_id', v_outbox.id::text,
      'outcome', proof_disposition,
      'retry_count', v_result_attempt_count
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'settle_email_proof',
    true
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_proof_disposition',
    proof_disposition,
    true
  );

  INSERT INTO private.advocate_invitation_email_proof_settlements (
    outbox_id,
    lease_token_digest,
    disposition,
    requested_retry_after_seconds,
    retryable,
    attempt_refunded,
    available_at,
    settled_at
  ) VALUES (
    v_outbox.id,
    v_lease_token_digest,
    proof_disposition,
    retry_after_seconds,
    v_retryable,
    v_attempt_refunded,
    v_available_at,
    v_now
  );

  UPDATE public.advocate_invitation_email_outbox outbox
  SET
    status = 'failed',
    available_at = v_available_at,
    attempt_count = v_result_attempt_count,
    locked_at = NULL,
    locked_by = NULL,
    locked_lease_token_digest = NULL,
    delivery_started_at = NULL,
    provider_message_id = NULL,
    sent_at = NULL,
    last_error_code = CASE
      WHEN proof_disposition IN ('coalesced', 'deferred')
        THEN 'email_proof_deferred'
      WHEN proof_disposition IN ('ambiguous', 'begin_ambiguous')
        THEN 'email_proof_issuance_ambiguous'
      WHEN proof_disposition = 'issued_not_handed_off'
        THEN 'email_proof_issued_not_handed_off'
      WHEN proof_disposition = 'issued_target_mismatch'
        THEN 'invitation_target_unavailable'
      WHEN proof_disposition = 'unavailable'
        THEN 'email_proof_unavailable'
    END,
    cancelled_at = NULL
  WHERE outbox.id = v_outbox.id;

  RETURN QUERY
  SELECT
    v_retryable,
    v_attempt_refunded,
    v_available_at,
    v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_advocate_invitation_email_proof_issuance(
  uuid,
  text,
  text,
  integer,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_advocate_invitation_email_proof_issuance(
  uuid,
  text,
  text,
  integer,
  uuid,
  text
) TO service_role;

COMMENT ON FUNCTION public.settle_advocate_invitation_email_proof_issuance(
  uuid,
  text,
  text,
  integer,
  uuid,
  text
) IS
  'Service-only exact settlement for shared advocate invitation email proof outcomes before SMTP handoff. It preserves only a lease digest and contact-free immutable replay result, refunds attempts only when no operation owned provider work, and uses the supplied bounded delay without amplification.';

COMMIT;
