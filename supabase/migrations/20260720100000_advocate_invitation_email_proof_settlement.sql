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

ALTER TABLE public.advocate_invitation_email_outbox
  ADD COLUMN legacy_email_proof_quarantined_at timestamp with time zone,
  ADD COLUMN legacy_email_proof_quarantine_reason text,
  ADD CONSTRAINT advocate_invitation_email_outbox_legacy_proof_quarantine_check
    CHECK (
      (
        legacy_email_proof_quarantined_at IS NULL
        AND legacy_email_proof_quarantine_reason IS NULL
      )
      OR
      (
        legacy_email_proof_quarantined_at IS NOT NULL
        AND legacy_email_proof_quarantine_reason =
          'shared_issuer_cutover_unresolved_legacy_proof'
      )
    );

COMMENT ON COLUMN public.advocate_invitation_email_outbox.legacy_email_proof_quarantined_at IS
  'Server timestamp permanently excluding an unresolved legacy provider-proof attempt from automatic delivery. Recovery requires explicit invitation revocation and reissue.';

ALTER TABLE private.email_proof_issuance_gates
  ADD COLUMN legacy_proof_quarantine_expires_at timestamp with time zone;

CREATE INDEX email_proof_issuance_gates_legacy_quarantine_retention_idx
  ON private.email_proof_issuance_gates (
    legacy_proof_quarantine_expires_at,
    id
  )
  WHERE legacy_proof_quarantine_expires_at IS NOT NULL;

COMMENT ON COLUMN private.email_proof_issuance_gates.legacy_proof_quarantine_expires_at IS
  'One-time 3900-second cutover fence covering the maximum verified hosted OTP expiry plus a fixed 300-second margin. It cannot be shortened by operator input or extended by replay.';

CREATE TABLE private.advocate_invitation_legacy_email_proof_quarantine (
  quarantine_identity text PRIMARY KEY
    CHECK (
      quarantine_identity = 'advocate_invitation_legacy_email_proof_v1'
    ),
  legacy_claim_fenced_at timestamp with time zone,
  legacy_claim_fence_transaction_id xid8,
  execution_request_id uuid,
  execution_trace_id text,
  verified_provider_otp_expiry_seconds smallint,
  candidate_outbox_count integer,
  unique_recipient_count integer,
  quarantined_outbox_count integer,
  created_gate_count integer,
  preserved_gate_count integer,
  fence_expires_at timestamp with time zone,
  executed_at timestamp with time zone,
  CONSTRAINT advocate_invitation_legacy_email_proof_quarantine_shape_check CHECK (
    (
      legacy_claim_fenced_at IS NULL
      AND legacy_claim_fence_transaction_id IS NULL
      AND execution_request_id IS NULL
      AND execution_trace_id IS NULL
      AND verified_provider_otp_expiry_seconds IS NULL
      AND candidate_outbox_count IS NULL
      AND unique_recipient_count IS NULL
      AND quarantined_outbox_count IS NULL
      AND created_gate_count IS NULL
      AND preserved_gate_count IS NULL
      AND fence_expires_at IS NULL
      AND executed_at IS NULL
    )
    OR
    (
      legacy_claim_fenced_at IS NOT NULL
      AND legacy_claim_fence_transaction_id IS NOT NULL
      AND execution_request_id IS NULL
      AND execution_trace_id IS NULL
      AND verified_provider_otp_expiry_seconds IS NULL
      AND candidate_outbox_count IS NULL
      AND unique_recipient_count IS NULL
      AND quarantined_outbox_count IS NULL
      AND created_gate_count IS NULL
      AND preserved_gate_count IS NULL
      AND fence_expires_at IS NULL
      AND executed_at IS NULL
    )
    OR
    (
      legacy_claim_fenced_at IS NOT NULL
      AND legacy_claim_fence_transaction_id IS NOT NULL
      AND execution_request_id IS NOT NULL
      AND execution_request_id <>
        '00000000-0000-0000-0000-000000000000'::uuid
      AND (
        execution_trace_id IS NULL
        OR (
          execution_trace_id = pg_catalog.btrim(execution_trace_id)
          AND pg_catalog.octet_length(execution_trace_id) BETWEEN 1 AND 255
          AND execution_trace_id !~ '[[:cntrl:]]'
        )
      )
      AND verified_provider_otp_expiry_seconds BETWEEN 1 AND 3600
      AND candidate_outbox_count >= 0
      AND unique_recipient_count >= 0
      AND quarantined_outbox_count BETWEEN 0 AND candidate_outbox_count
      AND created_gate_count >= 0
      AND preserved_gate_count >= 0
      AND created_gate_count + preserved_gate_count = unique_recipient_count
      AND fence_expires_at = executed_at + interval '3900 seconds'
      AND legacy_claim_fenced_at <= executed_at - interval '70 seconds'
    )
  )
);

INSERT INTO private.advocate_invitation_legacy_email_proof_quarantine (
  quarantine_identity
) VALUES (
  'advocate_invitation_legacy_email_proof_v1'
);

ALTER TABLE private.advocate_invitation_legacy_email_proof_quarantine
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.advocate_invitation_legacy_email_proof_quarantine
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.advocate_invitation_legacy_email_proof_quarantine
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.advocate_invitation_legacy_email_proof_quarantine IS
  'Immutable singleton receipt for the coordinated legacy invitation proof cutover. A separate service-only arm transaction records the post-migration drain fence. Quarantine waits 70 seconds for the retired 60-second worker plus a 10-second margin before deployment of the later 120-second shared-issuer worker.';
COMMENT ON COLUMN private.advocate_invitation_legacy_email_proof_quarantine.legacy_claim_fenced_at IS
  'Server-recorded post-migration arm time for removal of the legacy claim signature. This value is immutable and is never supplied by a caller.';
COMMENT ON COLUMN private.advocate_invitation_legacy_email_proof_quarantine.legacy_claim_fence_transaction_id IS
  'Server transaction identity proving that quarantine runs only after the arm transaction commits.';

CREATE OR REPLACE FUNCTION private.protect_advocate_invitation_legacy_email_proof_quarantine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND pg_catalog.current_setting(
       'app.advocate.invitation_email_operation',
       true
     ) = 'arm_legacy_email_proof_quarantine'
     AND OLD.quarantine_identity =
       'advocate_invitation_legacy_email_proof_v1'
     AND NEW.quarantine_identity = OLD.quarantine_identity
     AND OLD.legacy_claim_fenced_at IS NULL
     AND OLD.legacy_claim_fence_transaction_id IS NULL
     AND NEW.legacy_claim_fenced_at IS NOT NULL
     AND NEW.legacy_claim_fence_transaction_id IS NOT NULL
     AND OLD.executed_at IS NULL
     AND NEW.executed_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND pg_catalog.current_setting(
       'app.advocate.invitation_email_operation',
       true
     ) = 'quarantine_legacy_email_proof'
     AND OLD.quarantine_identity =
       'advocate_invitation_legacy_email_proof_v1'
     AND NEW.quarantine_identity = OLD.quarantine_identity
     AND NEW.legacy_claim_fenced_at IS NOT DISTINCT FROM
       OLD.legacy_claim_fenced_at
     AND NEW.legacy_claim_fence_transaction_id IS NOT DISTINCT FROM
       OLD.legacy_claim_fence_transaction_id
     AND OLD.executed_at IS NULL
     AND NEW.executed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Legacy advocate invitation email proof quarantine receipt is immutable'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.protect_advocate_invitation_legacy_email_proof_quarantine()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_invitation_legacy_email_proof_quarantine_protect
BEFORE INSERT OR UPDATE OR DELETE
ON private.advocate_invitation_legacy_email_proof_quarantine
FOR EACH ROW
EXECUTE FUNCTION private.protect_advocate_invitation_legacy_email_proof_quarantine();

CREATE TRIGGER advocate_invitation_legacy_email_proof_quarantine_no_truncate
BEFORE TRUNCATE
ON private.advocate_invitation_legacy_email_proof_quarantine
FOR EACH STATEMENT
EXECUTE FUNCTION audit.prevent_audited_table_truncate();

CREATE TRIGGER advocate_invitation_legacy_email_proof_quarantine_audit_row_change
AFTER INSERT OR UPDATE OR DELETE
ON private.advocate_invitation_legacy_email_proof_quarantine
FOR EACH ROW
EXECUTE FUNCTION audit.capture_row_change(
  '',
  'execution_request_id',
  'execution_trace_id'
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

CREATE OR REPLACE FUNCTION public.arm_advocate_invitation_legacy_email_proof_quarantine(
  context_request_id uuid,
  context_trace_id text DEFAULT NULL
)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
  v_receipt private.advocate_invitation_legacy_email_proof_quarantine%ROWTYPE;
  v_fenced_at timestamp with time zone;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF context_request_id IS NULL
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
    RAISE EXCEPTION 'Legacy advocate invitation email proof quarantine arm context is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT quarantine.*
  INTO STRICT v_receipt
  FROM private.advocate_invitation_legacy_email_proof_quarantine quarantine
  WHERE quarantine.quarantine_identity =
    'advocate_invitation_legacy_email_proof_v1'
  FOR UPDATE;

  IF v_receipt.legacy_claim_fenced_at IS NOT NULL THEN
    RETURN v_receipt.legacy_claim_fenced_at;
  END IF;

  v_fenced_at := clock_timestamp();

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-invitation-email-proof-cutover',
    context_tool => 'arm_advocate_invitation_legacy_email_proof_quarantine',
    context_request_id => context_request_id::text,
    context_trace_id => v_trace_id,
    context_reason => 'Arm post-migration drain for the retired invitation proof worker',
    context_metadata => jsonb_build_object(
      'operation', 'arm_legacy_email_proof_quarantine',
      'resource_kind', 'advocate_invitation_email_proof',
      'resource_id', 'advocate_invitation_legacy_email_proof_v1',
      'outcome', 'armed'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'arm_legacy_email_proof_quarantine',
    true
  );

  UPDATE private.advocate_invitation_legacy_email_proof_quarantine quarantine
  SET
    legacy_claim_fenced_at = v_fenced_at,
    legacy_claim_fence_transaction_id = pg_catalog.pg_current_xact_id()
  WHERE quarantine.quarantine_identity =
    'advocate_invitation_legacy_email_proof_v1';

  RETURN v_fenced_at;
END;
$$;

REVOKE ALL ON FUNCTION public.arm_advocate_invitation_legacy_email_proof_quarantine(
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.arm_advocate_invitation_legacy_email_proof_quarantine(
  uuid,
  text
) TO service_role;

COMMENT ON FUNCTION public.arm_advocate_invitation_legacy_email_proof_quarantine(
  uuid,
  text
) IS
  'Idempotently records and audits a server-owned post-migration drain fence. Quarantine must run in a later transaction and at least 70 seconds after this timestamp.';

CREATE OR REPLACE FUNCTION private.protect_advocate_invitation_email_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := nullif(
    pg_catalog.current_setting(
      'app.advocate.invitation_email_operation',
      true
    ),
    ''
  );
  v_now timestamp with time zone := clock_timestamp();
  v_proof_disposition text := nullif(
    pg_catalog.current_setting(
      'app.advocate.invitation_email_proof_disposition',
      true
    ),
    ''
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Advocate invitation email rows cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_operation <> 'issue'
       OR NEW.status <> 'pending'
       OR NEW.attempt_count <> 0
       OR NEW.max_attempts <> 8
       OR NEW.contact_redacted_at IS NOT NULL
       OR NEW.legacy_email_proof_quarantined_at IS NOT NULL
       OR NEW.legacy_email_proof_quarantine_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Invitation email rows require atomic invitation issuance'
        USING ERRCODE = '42501';
    END IF;

    NEW.available_at := v_now;
    NEW.locked_at := NULL;
    NEW.locked_by := NULL;
    NEW.locked_lease_token_digest := NULL;
    NEW.delivery_started_at := NULL;
    NEW.provider_message_id := NULL;
    NEW.sent_at := NULL;
    NEW.last_error_code := NULL;
    NEW.cancelled_at := NULL;
    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
     OR NEW.template_key IS DISTINCT FROM OLD.template_key
     OR NEW.template_data IS DISTINCT FROM OLD.template_data
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Invitation email delivery envelope is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF v_operation NOT IN ('cancel', 'purge')
     AND (
       NEW.recipient_email_ciphertext IS DISTINCT FROM OLD.recipient_email_ciphertext
       OR NEW.recipient_email_hmac IS DISTINCT FROM OLD.recipient_email_hmac
       OR NEW.email_normalization_version IS DISTINCT FROM OLD.email_normalization_version
       OR NEW.email_hmac_key_version IS DISTINCT FROM OLD.email_hmac_key_version
       OR NEW.email_encryption_key_version IS DISTINCT FROM OLD.email_encryption_key_version
       OR NEW.secret_payload_ciphertext IS DISTINCT FROM OLD.secret_payload_ciphertext
       OR NEW.secret_payload_ciphertext_sha256 IS DISTINCT FROM OLD.secret_payload_ciphertext_sha256
       OR NEW.contact_redacted_at IS DISTINCT FROM OLD.contact_redacted_at
     ) THEN
    RAISE EXCEPTION 'Invitation email encrypted material is immutable outside redaction'
      USING ERRCODE = '42501';
  END IF;

  IF v_operation <> 'quarantine_legacy_email_proof'
     AND (
       NEW.legacy_email_proof_quarantined_at IS DISTINCT FROM
         OLD.legacy_email_proof_quarantined_at
       OR NEW.legacy_email_proof_quarantine_reason IS DISTINCT FROM
         OLD.legacy_email_proof_quarantine_reason
     ) THEN
    RAISE EXCEPTION 'Invitation email legacy proof quarantine is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF v_operation = 'quarantine_legacy_email_proof' THEN
    IF OLD.legacy_email_proof_quarantined_at IS NOT NULL
       OR NEW.legacy_email_proof_quarantined_at IS NULL
       OR NEW.legacy_email_proof_quarantine_reason <>
         'shared_issuer_cutover_unresolved_legacy_proof'
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.available_at IS DISTINCT FROM OLD.available_at
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
       OR NEW.locked_lease_token_digest IS DISTINCT FROM
         OLD.locked_lease_token_digest
       OR NEW.delivery_started_at IS DISTINCT FROM OLD.delivery_started_at
       OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
       OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.last_error_code IS DISTINCT FROM OLD.last_error_code
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
      RAISE EXCEPTION 'Invitation email legacy proof quarantine is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'claim' THEN
    IF OLD.attempt_count >= OLD.max_attempts
       OR OLD.contact_redacted_at IS NOT NULL
       OR OLD.legacy_email_proof_quarantined_at IS NOT NULL
       OR NOT (
         (
           OLD.status IN ('pending', 'failed')
           AND OLD.available_at <= v_now
         )
         OR
         (
           OLD.status = 'processing'
           AND OLD.delivery_started_at IS NULL
           AND OLD.locked_at <= v_now - interval '5 minutes'
         )
       )
       OR NEW.status <> 'processing'
       OR NEW.attempt_count <> OLD.attempt_count + 1
       OR NEW.locked_at IS NULL
       OR NEW.locked_by IS NULL
       OR octet_length(NEW.locked_lease_token_digest) <> 32
       OR NEW.delivery_started_at IS NOT NULL
       OR NEW.provider_message_id IS NOT NULL
       OR NEW.sent_at IS NOT NULL
       OR NEW.last_error_code IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Invitation email claim is not eligible'
        USING ERRCODE = '55P03';
    END IF;
  ELSIF v_operation = 'begin_delivery' THEN
    IF OLD.status <> 'processing'
       OR OLD.legacy_email_proof_quarantined_at IS NOT NULL
       OR OLD.delivery_started_at IS NOT NULL
       OR NEW.status <> 'processing'
       OR NEW.delivery_started_at IS NULL
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
       OR NEW.locked_lease_token_digest IS DISTINCT FROM OLD.locked_lease_token_digest
       OR NEW.provider_message_id IS NOT NULL
       OR NEW.sent_at IS NOT NULL
       OR NEW.last_error_code IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Invitation delivery handoff is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'complete' THEN
    IF OLD.status <> 'processing'
       OR OLD.delivery_started_at IS NULL
       OR NEW.status <> 'sent'
       OR NEW.provider_message_id IS NULL
       OR NEW.sent_at IS NULL
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.locked_at IS NOT NULL
       OR NEW.locked_by IS NOT NULL
       OR NEW.locked_lease_token_digest IS NOT NULL
       OR NEW.delivery_started_at IS DISTINCT FROM OLD.delivery_started_at
       OR NEW.last_error_code IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Invitation email completion is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation IN ('fail', 'settle_not_sent') THEN
    IF OLD.status <> 'processing'
       OR (
         v_operation = 'fail'
         AND OLD.delivery_started_at IS NOT NULL
       )
       OR (
         v_operation = 'settle_not_sent'
         AND OLD.delivery_started_at IS NULL
       )
       OR NEW.status <> 'failed'
       OR NEW.last_error_code IS NULL
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.locked_at IS NOT NULL
       OR NEW.locked_by IS NOT NULL
       OR NEW.locked_lease_token_digest IS NOT NULL
       OR NEW.delivery_started_at IS NOT NULL
       OR NEW.provider_message_id IS NOT NULL
       OR NEW.sent_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Invitation email failure settlement is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'settle_email_proof' THEN
    IF OLD.status <> 'processing'
       OR OLD.delivery_started_at IS NOT NULL
       OR NEW.status <> 'failed'
       OR v_proof_disposition NOT IN (
         'coalesced',
         'deferred',
         'ambiguous',
         'unavailable',
         'begin_ambiguous',
         'issued_not_handed_off',
         'issued_target_mismatch'
       )
       OR NEW.last_error_code IS DISTINCT FROM (CASE
         WHEN v_proof_disposition IN ('coalesced', 'deferred')
           THEN 'email_proof_deferred'
         WHEN v_proof_disposition IN ('ambiguous', 'begin_ambiguous')
           THEN 'email_proof_issuance_ambiguous'
         WHEN v_proof_disposition = 'issued_not_handed_off'
           THEN 'email_proof_issued_not_handed_off'
         WHEN v_proof_disposition = 'issued_target_mismatch'
           THEN 'invitation_target_unavailable'
         WHEN v_proof_disposition = 'unavailable'
           THEN 'email_proof_unavailable'
         ELSE NULL
       END)
       OR NEW.attempt_count IS DISTINCT FROM
         OLD.attempt_count - (CASE
           WHEN v_proof_disposition IN (
             'coalesced',
             'deferred',
             'unavailable',
             'begin_ambiguous'
           ) THEN 1
           ELSE 0
         END)
       OR NEW.attempt_count < 0
       OR NEW.locked_at IS NOT NULL
       OR NEW.locked_by IS NOT NULL
       OR NEW.locked_lease_token_digest IS NOT NULL
       OR NEW.delivery_started_at IS NOT NULL
       OR NEW.provider_message_id IS NOT NULL
       OR NEW.sent_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Invitation email proof settlement is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation IN ('cancel', 'purge') THEN
    IF OLD.contact_redacted_at IS NOT NULL
       OR NEW.contact_redacted_at IS NULL
       OR NEW.recipient_email_ciphertext IS NOT NULL
       OR NEW.recipient_email_hmac IS NOT NULL
       OR NEW.email_normalization_version IS NOT NULL
       OR NEW.email_hmac_key_version IS NOT NULL
       OR NEW.email_encryption_key_version IS NOT NULL
       OR NEW.secret_payload_ciphertext IS NOT NULL
       OR NEW.secret_payload_ciphertext_sha256 IS NOT NULL
       OR (
         OLD.status = 'sent'
         AND NEW.status <> 'sent'
       )
       OR (
         OLD.status <> 'sent'
         AND NEW.status <> 'cancelled'
       ) THEN
      RAISE EXCEPTION 'Invitation email redaction is invalid'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.status <> 'sent' THEN
      NEW.available_at := OLD.available_at;
      NEW.attempt_count := OLD.attempt_count;
      NEW.locked_at := NULL;
      NEW.locked_by := NULL;
      NEW.locked_lease_token_digest := NULL;
      NEW.delivery_started_at := NULL;
      NEW.provider_message_id := NULL;
      NEW.sent_at := NULL;
      NEW.cancelled_at := COALESCE(OLD.cancelled_at, v_now);
    END IF;
  ELSE
    RAISE EXCEPTION 'Invitation email changes require a narrow worker operation'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.reject_quarantined_advocate_invitation_target_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.target_auth_user_id IS NULL
     AND NEW.target_auth_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.advocate_invitation_email_outbox outbox
       WHERE outbox.invitation_id = OLD.id
         AND outbox.advocate_id = OLD.advocate_id
         AND outbox.legacy_email_proof_quarantined_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Quarantined invitation email proof cannot bind a target account'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_quarantined_advocate_invitation_target_binding()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_invitations_quarantined_target_binding_guard
BEFORE UPDATE OF target_auth_user_id
ON public.advocate_invitations
FOR EACH ROW
EXECUTE FUNCTION private.reject_quarantined_advocate_invitation_target_binding();

ALTER FUNCTION public.bind_advocate_invitation_email_target(
  uuid,
  text,
  uuid,
  bytea,
  bytea,
  text,
  text
) SET SCHEMA private;
ALTER FUNCTION private.bind_advocate_invitation_email_target(
  uuid,
  text,
  uuid,
  bytea,
  bytea,
  text,
  text
) RENAME TO bind_advocate_invitation_email_target_unguarded;
REVOKE ALL ON FUNCTION private.bind_advocate_invitation_email_target_unguarded(
  uuid,
  text,
  uuid,
  bytea,
  bytea,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.bind_advocate_invitation_email_target(
  target_outbox_id uuid,
  lease_token text,
  target_user_id uuid,
  verified_recipient_email_hmac bytea,
  verified_capability_digest bytea,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.id = target_outbox_id
      AND outbox.legacy_email_proof_quarantined_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invitation target-binding proof does not match the active lease'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.bind_advocate_invitation_email_target_unguarded(
    target_outbox_id,
    lease_token,
    target_user_id,
    verified_recipient_email_hmac,
    verified_capability_digest,
    request_id,
    trace_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bind_advocate_invitation_email_target(
  uuid,
  text,
  uuid,
  bytea,
  bytea,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bind_advocate_invitation_email_target(
  uuid,
  text,
  uuid,
  bytea,
  bytea,
  text,
  text
) TO service_role;

ALTER FUNCTION public.begin_advocate_invitation_email_delivery(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) SET SCHEMA private;
ALTER FUNCTION private.begin_advocate_invitation_email_delivery(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) RENAME TO begin_advocate_invitation_email_delivery_unguarded;
REVOKE ALL ON FUNCTION private.begin_advocate_invitation_email_delivery_unguarded(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.begin_advocate_invitation_email_delivery(
  target_outbox_id uuid,
  lease_token text,
  verified_recipient_email_hmac bytea,
  verified_capability_digest bytea,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.id = target_outbox_id
      AND outbox.legacy_email_proof_quarantined_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invitation delivery proof does not match the active lease'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.begin_advocate_invitation_email_delivery_unguarded(
    target_outbox_id,
    lease_token,
    verified_recipient_email_hmac,
    verified_capability_digest,
    request_id,
    trace_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_advocate_invitation_email_delivery(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_advocate_invitation_email_delivery(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.bind_advocate_invitation_email_target(
  uuid,
  text,
  uuid,
  bytea,
  bytea,
  text,
  text
) IS
  'Binds the exact healthy auth account only for an active, nonquarantined invitation delivery lease.';
COMMENT ON FUNCTION public.begin_advocate_invitation_email_delivery(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) IS
  'Begins SMTP handoff only for an active, nonquarantined invitation delivery lease.';

DROP FUNCTION public.claim_advocate_invitation_email_jobs(
  text,
  integer,
  text,
  text
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
  v_quarantine_executed_at timestamp with time zone;
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

  SELECT quarantine.executed_at
  INTO v_quarantine_executed_at
  FROM private.advocate_invitation_legacy_email_proof_quarantine quarantine
  WHERE quarantine.quarantine_identity =
    'advocate_invitation_legacy_email_proof_v1'
  FOR SHARE;

  IF NOT FOUND OR v_quarantine_executed_at IS NULL THEN
    RAISE EXCEPTION 'Legacy advocate invitation email proof quarantine is not complete'
      USING ERRCODE = '55000';
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
      AND outbox.legacy_email_proof_quarantined_at IS NULL
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
      WHEN 'reserved' THEN
        v_gate.reservation_expires_at <= v_now
        AND COALESCE(
          v_gate.legacy_proof_quarantine_expires_at,
          '-infinity'::timestamptz
        ) <= v_now
      ELSE
        v_gate.reservation_expires_at <= v_now
        AND v_gate.next_issuance_at <= v_now
        AND v_gate.proof_exclusivity_expires_at <= v_now
        AND COALESCE(
          v_gate.legacy_proof_quarantine_expires_at,
          '-infinity'::timestamptz
        ) <= v_now
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
        updated_at = v_now,
        legacy_proof_quarantine_expires_at = NULL
      WHERE gate.id = v_gate.id;

      RETURN QUERY SELECT 'acquired'::text, 0;
      RETURN;
    END IF;

    IF v_gate.operation_id = target_operation_id
       AND v_gate.issuance_flow = target_issuance_flow THEN
      IF v_gate.phase = 'reserved'
         AND v_gate.lease_token_digest = v_lease_token_digest
         AND COALESCE(
           v_gate.legacy_proof_quarantine_expires_at,
           '-infinity'::timestamptz
         ) <= v_now THEN
        RETURN QUERY SELECT 'acquired'::text, 0;
        RETURN;
      END IF;

      v_retry_at := CASE v_gate.phase
        WHEN 'reserved' THEN GREATEST(
          v_gate.reservation_expires_at,
          COALESCE(
            v_gate.legacy_proof_quarantine_expires_at,
            '-infinity'::timestamptz
          )
        )
        ELSE GREATEST(
          v_gate.reservation_expires_at,
          v_gate.next_issuance_at,
          v_gate.proof_exclusivity_expires_at,
          COALESCE(
            v_gate.legacy_proof_quarantine_expires_at,
            '-infinity'::timestamptz
          )
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
      WHEN 'reserved' THEN GREATEST(
        v_gate.reservation_expires_at,
        COALESCE(
          v_gate.legacy_proof_quarantine_expires_at,
          '-infinity'::timestamptz
        )
      )
      ELSE GREATEST(
        v_gate.reservation_expires_at,
        v_gate.next_issuance_at,
        v_gate.proof_exclusivity_expires_at,
        COALESCE(
          v_gate.legacy_proof_quarantine_expires_at,
          '-infinity'::timestamptz
        )
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
     OR COALESCE(
       v_gate.legacy_proof_quarantine_expires_at,
       '-infinity'::timestamptz
     ) > v_now
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
     OR v_outbox.legacy_email_proof_quarantined_at IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.fail_advocate_invitation_email_delivery(
  target_outbox_id uuid,
  lease_token text,
  error_code text,
  retry_after_seconds integer DEFAULT 300,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_advocate_id uuid;
  v_outbox public.advocate_invitation_email_outbox%ROWTYPE;
  v_invitation public.advocate_invitations%ROWTYPE;
  v_retry_delay integer;
  v_retryable boolean;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF target_outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR error_code IS NULL
     OR NOT (error_code = ANY (ARRAY[
       'invitation_email_material_invalid',
       'invitation_target_unavailable',
       'auth_link_generation_failed',
       'email_provider_unavailable',
       'email_delivery_rejected',
       'internal_error'
     ]::text[]))
     OR retry_after_seconds IS NULL
     OR retry_after_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Invitation delivery failure proof is malformed'
      USING ERRCODE = '22023';
  END IF;

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

  SELECT invitation.*
  INTO v_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.id = v_outbox.invitation_id
    AND invitation.advocate_id = v_outbox.advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_outbox.status <> 'processing'
     OR v_outbox.locked_at <= v_now - interval '5 minutes'
     OR v_outbox.delivery_started_at IS NOT NULL
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       extensions.digest(lease_token, 'sha256') THEN
    RAISE EXCEPTION 'Invitation failure proof does not match the active pre-delivery lease'
      USING ERRCODE = '55P03';
  END IF;

  v_retry_delay := LEAST(
    86400::numeric,
    retry_after_seconds::numeric
      * power(
          2::numeric,
          LEAST(GREATEST(v_outbox.attempt_count - 1, 0), 20)
        )
  )::integer;
  v_retryable :=
    error_code NOT IN (
      'invitation_email_material_invalid',
      'invitation_target_unavailable'
    )
    AND v_outbox.attempt_count < v_outbox.max_attempts
    AND v_now + make_interval(secs => v_retry_delay) < v_invitation.expires_at
    AND v_invitation.accepted_at IS NULL
    AND v_invitation.revoked_at IS NULL;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_effective_user_id => v_invitation.target_auth_user_id,
    context_system_actor => v_outbox.locked_by,
    context_tool => 'advocate-invitation-email-worker',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_reason => 'Record an advocate invitation failure before provider handoff',
    context_metadata => jsonb_build_object(
      'operation', 'fail',
      'resource_kind', 'advocate_invitation_email_outbox',
      'resource_id', v_outbox.id::text,
      'outcome', CASE WHEN v_retryable THEN 'retryable' ELSE 'terminal' END,
      'retry_count', v_outbox.attempt_count
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'fail',
    true
  );

  UPDATE public.advocate_invitation_email_outbox outbox
  SET
    status = 'failed',
    available_at = CASE
      WHEN v_retryable
        THEN v_now + make_interval(secs => v_retry_delay)
      ELSE v_invitation.expires_at
    END,
    locked_at = NULL,
    locked_by = NULL,
    locked_lease_token_digest = NULL,
    delivery_started_at = NULL,
    provider_message_id = NULL,
    sent_at = NULL,
    last_error_code = error_code,
    cancelled_at = NULL
  WHERE outbox.id = v_outbox.id;

  RETURN v_retryable;
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
      AND COALESCE(
        gate.legacy_proof_quarantine_expires_at,
        '-infinity'::timestamptz
      ) <= v_now
    ORDER BY
      gate.legacy_proof_quarantine_expires_at NULLS FIRST,
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
     OR v_gate.reservation_expires_at <= v_now
     OR COALESCE(
       v_gate.legacy_proof_quarantine_expires_at,
       '-infinity'::timestamptz
     ) > v_now THEN
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

CREATE OR REPLACE FUNCTION private.legacy_advocate_invitation_proof_may_be_live(
  evidence_created_at timestamp with time zone,
  evaluated_at timestamp with time zone
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    evidence_created_at IS NOT NULL
    AND evaluated_at IS NOT NULL
    AND evidence_created_at + interval '3900 seconds' > evaluated_at;
$$;

REVOKE ALL ON FUNCTION private.legacy_advocate_invitation_proof_may_be_live(
  timestamp with time zone,
  timestamp with time zone
) FROM PUBLIC, anon, authenticated, service_role;

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
        ),
        COALESCE(
          gate.legacy_proof_quarantine_expires_at,
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
      ) <= v_now
      AND COALESCE(
        gate.legacy_proof_quarantine_expires_at,
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

CREATE OR REPLACE FUNCTION public.quarantine_legacy_advocate_invitation_proofs(
  verified_provider_otp_expiry_seconds smallint,
  context_request_id uuid,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  candidate_outbox_count integer,
  unique_recipient_count integer,
  quarantined_outbox_count integer,
  created_gate_count integer,
  preserved_gate_count integer,
  fence_expires_at timestamp with time zone,
  executed_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamp with time zone;
  v_fence_expires_at timestamp with time zone;
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
  v_receipt private.advocate_invitation_legacy_email_proof_quarantine%ROWTYPE;
  v_recipient record;
  v_candidate_outbox_count integer;
  v_unique_recipient_count integer;
  v_quarantined_outbox_count integer;
  v_created_gate_count integer := 0;
  v_preserved_gate_count integer := 0;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF verified_provider_otp_expiry_seconds IS NULL
     OR verified_provider_otp_expiry_seconds NOT BETWEEN 1 AND 3600
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
    RAISE EXCEPTION 'Legacy advocate invitation email proof quarantine evidence is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT quarantine.*
  INTO STRICT v_receipt
  FROM private.advocate_invitation_legacy_email_proof_quarantine quarantine
  WHERE quarantine.quarantine_identity =
    'advocate_invitation_legacy_email_proof_v1'
  FOR UPDATE;

  v_now := clock_timestamp();

  IF v_receipt.legacy_claim_fenced_at IS NULL THEN
    RAISE EXCEPTION 'Legacy advocate invitation email proof quarantine is not armed'
      USING ERRCODE = '55000';
  END IF;

  IF v_receipt.legacy_claim_fence_transaction_id =
       pg_catalog.pg_current_xact_id() THEN
    RAISE EXCEPTION 'Legacy advocate invitation email proof quarantine arm must commit first'
      USING ERRCODE = '55000';
  END IF;

  IF v_now < v_receipt.legacy_claim_fenced_at + interval '70 seconds' THEN
    RAISE EXCEPTION 'Legacy advocate invitation worker quiescence is not complete'
      USING ERRCODE = '55000';
  END IF;

  IF v_receipt.executed_at IS NOT NULL THEN
    IF v_receipt.verified_provider_otp_expiry_seconds IS DISTINCT FROM
         verified_provider_otp_expiry_seconds THEN
      RAISE EXCEPTION 'Legacy advocate invitation email proof quarantine replay conflicts'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY
    SELECT
      v_receipt.candidate_outbox_count,
      v_receipt.unique_recipient_count,
      v_receipt.quarantined_outbox_count,
      v_receipt.created_gate_count,
      v_receipt.preserved_gate_count,
      v_receipt.fence_expires_at,
      v_receipt.executed_at;
    RETURN;
  END IF;

  LOCK TABLE
    public.advocate_invitations,
    public.advocate_invitation_email_outbox
    IN ACCESS EXCLUSIVE MODE NOWAIT;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.attempt_count > 0
      AND outbox.contact_redacted_at IS NOT NULL
      AND private.legacy_advocate_invitation_proof_may_be_live(
        outbox.contact_redacted_at,
        v_now
      )
  ) THEN
    RAISE EXCEPTION 'A recent redacted legacy invitation proof cannot be fenced'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_invitations invitation
    WHERE private.legacy_advocate_invitation_proof_may_be_live(
      invitation.last_sent_at,
      v_now
    )
      AND NOT EXISTS (
        SELECT 1
        FROM public.advocate_invitation_email_outbox outbox
        WHERE outbox.invitation_id = invitation.id
          AND outbox.advocate_id = invitation.advocate_id
          AND outbox.contact_redacted_at IS NULL
          AND pg_catalog.octet_length(outbox.recipient_email_hmac) = 32
          AND outbox.email_normalization_version = 1
          AND outbox.email_hmac_key_version = 1
      )
  ) THEN
    RAISE EXCEPTION 'A recent legacy invitation send has no recipient fence evidence'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
     AND invitation.advocate_id = outbox.advocate_id
    WHERE (
        outbox.attempt_count > 0
        OR private.legacy_advocate_invitation_proof_may_be_live(
          invitation.last_sent_at,
          v_now
        )
      )
      AND outbox.contact_redacted_at IS NULL
      AND (
        outbox.recipient_email_hmac IS NULL
        OR pg_catalog.octet_length(outbox.recipient_email_hmac) <> 32
        OR outbox.email_normalization_version IS DISTINCT FROM 1
        OR outbox.email_hmac_key_version IS DISTINCT FROM 1
      )
  ) THEN
    RAISE EXCEPTION 'Legacy invitation recipient evidence is incompatible with the shared proof gate'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer
  INTO v_candidate_outbox_count
  FROM public.advocate_invitation_email_outbox outbox
  JOIN public.advocate_invitations invitation
    ON invitation.id = outbox.invitation_id
   AND invitation.advocate_id = outbox.advocate_id
  WHERE (
      outbox.attempt_count > 0
      OR private.legacy_advocate_invitation_proof_may_be_live(
        invitation.last_sent_at,
        v_now
      )
    )
    AND outbox.contact_redacted_at IS NULL;

  SELECT count(*)::integer
  INTO v_unique_recipient_count
  FROM (
    SELECT
      outbox.email_normalization_version,
      outbox.email_hmac_key_version,
      outbox.recipient_email_hmac
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
     AND invitation.advocate_id = outbox.advocate_id
    WHERE (
        outbox.attempt_count > 0
        OR private.legacy_advocate_invitation_proof_may_be_live(
          invitation.last_sent_at,
          v_now
        )
      )
      AND outbox.contact_redacted_at IS NULL
    GROUP BY
      outbox.email_normalization_version,
      outbox.email_hmac_key_version,
      outbox.recipient_email_hmac
  ) recipient;

  v_fence_expires_at := v_now + interval '3900 seconds';

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'advocate-invitation-email-proof-cutover',
    context_tool => 'quarantine_legacy_advocate_invitation_proofs',
    context_request_id => context_request_id::text,
    context_trace_id => v_trace_id,
    context_reason => 'Fence legacy invitation email proofs before shared issuer cutover',
    context_metadata => jsonb_build_object(
      'operation', 'quarantine_legacy_email_proof',
      'resource_kind', 'advocate_invitation_email_proof',
      'resource_id', 'advocate_invitation_legacy_email_proof_v1',
      'outcome', 'executed'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'quarantine_legacy_email_proof',
    true
  );

  UPDATE public.advocate_invitation_email_outbox outbox
  SET
    legacy_email_proof_quarantined_at = v_now,
    legacy_email_proof_quarantine_reason =
      'shared_issuer_cutover_unresolved_legacy_proof'
  WHERE outbox.attempt_count > 0
    AND outbox.contact_redacted_at IS NULL
    AND outbox.status IN ('pending', 'failed', 'processing')
    AND outbox.legacy_email_proof_quarantined_at IS NULL;

  GET DIAGNOSTICS v_quarantined_outbox_count = ROW_COUNT;

  FOR v_recipient IN
    SELECT DISTINCT ON (
      outbox.email_normalization_version,
      outbox.email_hmac_key_version,
      outbox.recipient_email_hmac
    )
      outbox.email_normalization_version AS normalization_version,
      outbox.email_hmac_key_version AS hmac_key_version,
      outbox.recipient_email_hmac AS recipient_digest,
      outbox.id AS representative_outbox_id
    FROM public.advocate_invitation_email_outbox outbox
    JOIN public.advocate_invitations invitation
      ON invitation.id = outbox.invitation_id
     AND invitation.advocate_id = outbox.advocate_id
    WHERE (
        outbox.attempt_count > 0
        OR private.legacy_advocate_invitation_proof_may_be_live(
          invitation.last_sent_at,
          v_now
        )
      )
      AND outbox.contact_redacted_at IS NULL
    ORDER BY
      outbox.email_normalization_version,
      outbox.email_hmac_key_version,
      outbox.recipient_email_hmac,
      outbox.id
  LOOP
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
      updated_at,
      legacy_proof_quarantine_expires_at
    ) VALUES (
      v_recipient.normalization_version,
      v_recipient.hmac_key_version,
      v_recipient.recipient_digest,
      'advocate-invitation',
      v_recipient.representative_outbox_id,
      extensions.digest(extensions.gen_random_bytes(32), 'sha256'),
      'reserved',
      v_now,
      v_now + interval '30 seconds',
      v_now,
      v_fence_expires_at
    )
    ON CONFLICT (
      recipient_normalization_version,
      recipient_hmac_key_version,
      recipient_digest
    ) DO NOTHING;

    IF FOUND THEN
      v_created_gate_count := v_created_gate_count + 1;
    ELSE
      UPDATE private.email_proof_issuance_gates gate
      SET
        legacy_proof_quarantine_expires_at = GREATEST(
          COALESCE(
            gate.legacy_proof_quarantine_expires_at,
            '-infinity'::timestamptz
          ),
          v_fence_expires_at
        ),
        updated_at = GREATEST(gate.updated_at, v_now)
      WHERE gate.recipient_normalization_version =
          v_recipient.normalization_version
        AND gate.recipient_hmac_key_version = v_recipient.hmac_key_version
        AND gate.recipient_digest = v_recipient.recipient_digest;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Legacy invitation recipient fence changed concurrently'
          USING ERRCODE = '40001';
      END IF;
      v_preserved_gate_count := v_preserved_gate_count + 1;
    END IF;
  END LOOP;

  UPDATE private.advocate_invitation_legacy_email_proof_quarantine quarantine
  SET
    execution_request_id = context_request_id,
    execution_trace_id = v_trace_id,
    verified_provider_otp_expiry_seconds =
      quarantine_legacy_advocate_invitation_proofs.verified_provider_otp_expiry_seconds,
    candidate_outbox_count = v_candidate_outbox_count,
    unique_recipient_count = v_unique_recipient_count,
    quarantined_outbox_count = v_quarantined_outbox_count,
    created_gate_count = v_created_gate_count,
    preserved_gate_count = v_preserved_gate_count,
    fence_expires_at = v_fence_expires_at,
    executed_at = v_now
  WHERE quarantine.quarantine_identity =
    'advocate_invitation_legacy_email_proof_v1';

  RETURN QUERY
  SELECT
    v_candidate_outbox_count,
    v_unique_recipient_count,
    v_quarantined_outbox_count,
    v_created_gate_count,
    v_preserved_gate_count,
    v_fence_expires_at,
    v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.quarantine_legacy_advocate_invitation_proofs(
  smallint,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quarantine_legacy_advocate_invitation_proofs(
  smallint,
  uuid,
  text
) TO service_role;

COMMENT ON FUNCTION public.quarantine_legacy_advocate_invitation_proofs(
  smallint,
  uuid,
  text
) IS
  'One-time service-only cutover after verified hosted OTP evidence and a 70-second drain of the retired 60-second invitation worker. It applies a fixed 3900-second proof fence regardless of the supplied verified value, refuses recent redacted uncertainty, and permanently quarantines unresolved legacy delivery rows without returning contact or resource identifiers.';

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
