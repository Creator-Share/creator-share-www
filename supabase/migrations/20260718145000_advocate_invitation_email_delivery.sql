BEGIN;

/*
 * Advocate invitation capabilities are generated and envelope encrypted by the
 * trusted application service. PostgreSQL receives only the SHA-256 capability
 * digest and the existing versioned application ciphertext. Issuance and
 * durable delivery enqueue occur in one transaction, and no RPC returns the
 * plaintext capability.
 */
DROP FUNCTION IF EXISTS public.create_advocate_invitation(
  uuid,
  text,
  text[],
  interval
);
DROP FUNCTION IF EXISTS public.redeem_advocate_invitation(text);

ALTER TABLE public.advocate_invitations
  ALTER COLUMN last_sent_at DROP NOT NULL,
  ADD COLUMN target_auth_user_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN issuance_idempotency_key text,
  ADD COLUMN issuance_fingerprint bytea,
  ADD CONSTRAINT advocate_invitations_target_acceptance_check CHECK (
    accepted_by_user_id IS NULL
    OR target_auth_user_id = accepted_by_user_id
  ),
  ADD CONSTRAINT advocate_invitations_idempotency_shape_check CHECK (
    (
      issuance_idempotency_key IS NULL
      AND issuance_fingerprint IS NULL
    )
    OR
    (
      issuance_idempotency_key = btrim(issuance_idempotency_key)
      AND char_length(issuance_idempotency_key) BETWEEN 16 AND 200
      AND issuance_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]+$'
      AND octet_length(issuance_fingerprint) = 32
    )
  );

CREATE UNIQUE INDEX advocate_invitations_issuance_idempotency_uidx
  ON public.advocate_invitations (advocate_id, issuance_idempotency_key)
  WHERE issuance_idempotency_key IS NOT NULL;

CREATE INDEX advocate_invitations_target_user_pending_idx
  ON public.advocate_invitations (target_auth_user_id, advocate_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON COLUMN public.advocate_invitations.token_digest IS
  'SHA-256 digest of the lower-case hexadecimal representation of a server-generated 256-bit random capability. Plaintext is never returned by a database RPC or stored in a relational column.';
COMMENT ON COLUMN public.advocate_invitations.target_auth_user_id IS
  'Auth account bound to delivery and redemption after an exact normalized-email match. Redemption requires this exact healthy verified account.';
COMMENT ON COLUMN public.advocate_invitations.issuance_idempotency_key IS
  'Service request identity unique within one advocate tenant. Reuse returns the original invitation only when the complete immutable issuance fingerprint matches.';

CREATE TABLE public.advocate_invitation_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id uuid NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  secret_payload_ciphertext bytea,
  secret_payload_ciphertext_sha256 bytea,
  template_key text NOT NULL DEFAULT 'advocate_delegate_invitation_v1',
  template_data jsonb NOT NULL,
  status public.email_outbox_status NOT NULL DEFAULT 'pending',
  available_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 8,
  locked_at timestamp with time zone,
  locked_by text,
  locked_lease_token_digest bytea,
  delivery_started_at timestamp with time zone,
  provider_idempotency_key text NOT NULL,
  provider_message_id text,
  sent_at timestamp with time zone,
  last_error_code text,
  cancelled_at timestamp with time zone,
  contact_redacted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT advocate_invitation_email_outbox_invitation_fkey
    FOREIGN KEY (invitation_id, advocate_id)
    REFERENCES public.advocate_invitations(id, advocate_id)
    ON DELETE RESTRICT,
  CONSTRAINT advocate_invitation_email_outbox_invitation_unique
    UNIQUE (invitation_id),
  CONSTRAINT advocate_invitation_email_outbox_id_advocate_unique
    UNIQUE (id, advocate_id),
  CONSTRAINT advocate_invitation_email_outbox_recipient_shape_check CHECK (
    (
      contact_redacted_at IS NULL
      AND recipient_email_ciphertext IS NOT NULL
      AND octet_length(recipient_email_ciphertext) BETWEEN 32 AND 4096
      AND octet_length(recipient_email_hmac) = 32
      AND email_normalization_version BETWEEN 1 AND 32767
      AND email_hmac_key_version BETWEEN 1 AND 32767
      AND email_encryption_key_version BETWEEN 1 AND 32767
      AND secret_payload_ciphertext IS NOT NULL
      AND octet_length(secret_payload_ciphertext) BETWEEN 32 AND 16384
      AND octet_length(secret_payload_ciphertext_sha256) = 32
    )
    OR
    (
      contact_redacted_at IS NOT NULL
      AND recipient_email_ciphertext IS NULL
      AND recipient_email_hmac IS NULL
      AND email_normalization_version IS NULL
      AND email_hmac_key_version IS NULL
      AND email_encryption_key_version IS NULL
      AND secret_payload_ciphertext IS NULL
      AND secret_payload_ciphertext_sha256 IS NULL
    )
  ),
  CONSTRAINT advocate_invitation_email_outbox_template_check CHECK (
    template_key = 'advocate_delegate_invitation_v1'
    AND jsonb_typeof(template_data) = 'object'
    AND jsonb_typeof(template_data -> 'role_keys') = 'array'
    AND template_data ? 'advocate_display_name'
    AND template_data ? 'invitation_id'
  ),
  CONSTRAINT advocate_invitation_email_outbox_attempt_check CHECK (
    max_attempts = 8
    AND attempt_count BETWEEN 0 AND max_attempts
  ),
  CONSTRAINT advocate_invitation_email_outbox_worker_check CHECK (
    locked_by IS NULL
    OR (
      locked_by = btrim(locked_by)
      AND char_length(locked_by) BETWEEN 1 AND 120
    )
  ),
  CONSTRAINT advocate_invitation_email_outbox_provider_key_check CHECK (
    provider_idempotency_key = 'advocate-invitation:' || id::text
  ),
  CONSTRAINT advocate_invitation_email_outbox_provider_message_check CHECK (
    provider_message_id IS NULL
    OR (
      provider_message_id = btrim(provider_message_id)
      AND char_length(provider_message_id) BETWEEN 1 AND 255
    )
  ),
  CONSTRAINT advocate_invitation_email_outbox_error_check CHECK (
    last_error_code IS NULL
    OR last_error_code = ANY (ARRAY[
      'invitation_email_material_invalid',
      'invitation_target_unavailable',
      'auth_link_generation_failed',
      'email_provider_unavailable',
      'email_delivery_rejected',
      'internal_error'
    ]::text[])
  ),
  CONSTRAINT advocate_invitation_email_outbox_status_shape_check CHECK (
    (
      status = 'pending'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND delivery_started_at IS NULL
      AND provider_message_id IS NULL
      AND sent_at IS NULL
      AND last_error_code IS NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'processing'
      AND locked_at IS NOT NULL
      AND locked_by IS NOT NULL
      AND octet_length(locked_lease_token_digest) = 32
      AND provider_message_id IS NULL
      AND sent_at IS NULL
      AND last_error_code IS NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'sent'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND delivery_started_at IS NOT NULL
      AND provider_message_id IS NOT NULL
      AND sent_at IS NOT NULL
      AND last_error_code IS NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'failed'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND delivery_started_at IS NULL
      AND provider_message_id IS NULL
      AND sent_at IS NULL
      AND last_error_code IS NOT NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'cancelled'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND delivery_started_at IS NULL
      AND provider_message_id IS NULL
      AND sent_at IS NULL
      AND cancelled_at IS NOT NULL
    )
  )
);

CREATE INDEX advocate_invitation_email_outbox_claim_idx
  ON public.advocate_invitation_email_outbox (
    available_at,
    created_at,
    id
  )
  WHERE status IN ('pending', 'failed');

CREATE INDEX advocate_invitation_email_outbox_stale_claim_idx
  ON public.advocate_invitation_email_outbox (locked_at, id)
  WHERE status = 'processing' AND delivery_started_at IS NULL;

CREATE INDEX advocate_invitation_email_outbox_ambiguous_idx
  ON public.advocate_invitation_email_outbox (delivery_started_at, id)
  WHERE status = 'processing' AND delivery_started_at IS NOT NULL;

COMMENT ON TABLE public.advocate_invitation_email_outbox IS
  'Dedicated encrypted delivery queue for advocate invitations. It is not part of the sponsor welcome outbox, has no direct role access, and never stores plaintext contact or capability material.';
COMMENT ON COLUMN public.advocate_invitation_email_outbox.secret_payload_ciphertext IS
  'Existing application envelope ciphertext containing the invitation capability. A worker must decrypt it and prove the invitation digest before link generation or delivery.';
COMMENT ON COLUMN public.advocate_invitation_email_outbox.delivery_started_at IS
  'Provider handoff fence. An expired lease is reclaimable only before this field is set. A started but unsettled handoff is deliberately quarantined from automatic retry.';

ALTER TABLE public.advocate_invitation_email_outbox
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advocate_invitation_email_outbox
  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.advocate_invitation_email_outbox
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_invitations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.advocate_invitation_roles
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.require_advocate_invitation_service_role()
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
      RAISE EXCEPTION 'Advocate invitation service role is required'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Advocate invitation service role is required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.require_advocate_invitation_service_role()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.protect_advocate_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := nullif(
    pg_catalog.current_setting('app.advocate.invitation_operation', true),
    ''
  );
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Advocate invitation rows cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_operation <> 'issue'
       OR NEW.accepted_at IS NOT NULL
       OR NEW.accepted_by_user_id IS NOT NULL
       OR NEW.revoked_at IS NOT NULL
       OR NEW.revoked_by_user_id IS NOT NULL
       OR NEW.last_sent_at IS NOT NULL
       OR NEW.expires_at IS DISTINCT FROM NEW.created_at + interval '7 days'
       OR NEW.issuance_idempotency_key IS NULL
       OR octet_length(NEW.issuance_fingerprint) <> 32 THEN
      RAISE EXCEPTION 'Advocate invitations require the secure issuance boundary'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.issuance_idempotency_key IS DISTINCT FROM OLD.issuance_idempotency_key
     OR NEW.issuance_fingerprint IS DISTINCT FROM OLD.issuance_fingerprint THEN
    RAISE EXCEPTION 'Advocate invitation issuance facts are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF v_operation = 'bind_target' THEN
    IF OLD.target_auth_user_id IS NOT NULL
       OR NEW.target_auth_user_id IS NULL
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id
       OR NEW.last_sent_at IS DISTINCT FROM OLD.last_sent_at THEN
      RAISE EXCEPTION 'Invitation target binding is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'record_delivery' THEN
    IF OLD.accepted_at IS NOT NULL
       OR OLD.revoked_at IS NOT NULL
       OR NEW.target_auth_user_id IS DISTINCT FROM OLD.target_auth_user_id
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id
       OR NEW.last_sent_at IS NULL
       OR NEW.last_sent_at < COALESCE(OLD.last_sent_at, OLD.created_at) THEN
      RAISE EXCEPTION 'Invitation delivery update is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation IN (
    'revoke',
    'issuer_membership_revocation'
  ) THEN
    IF OLD.accepted_at IS NOT NULL
       OR OLD.revoked_at IS NOT NULL
       OR NEW.revoked_at IS NULL
       OR NEW.revoked_by_user_id IS NULL
       OR NEW.target_auth_user_id IS DISTINCT FROM OLD.target_auth_user_id
       OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
       OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
       OR NEW.last_sent_at IS DISTINCT FROM OLD.last_sent_at THEN
      RAISE EXCEPTION 'Invitation revocation update is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_operation = 'redeem' THEN
    IF OLD.accepted_at IS NOT NULL
       OR OLD.revoked_at IS NOT NULL
       OR NEW.accepted_at IS NULL
       OR NEW.accepted_by_user_id IS NULL
       OR NEW.target_auth_user_id IS DISTINCT FROM OLD.target_auth_user_id
       OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.target_auth_user_id
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id
       OR NEW.last_sent_at IS DISTINCT FROM OLD.last_sent_at THEN
      RAISE EXCEPTION 'Invitation redemption update is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Advocate invitation lifecycle changes require a narrow operation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_advocate_invitation_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND pg_catalog.current_setting(
       'app.advocate.invitation_operation',
       true
     ) = 'issue' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Advocate invitation roles are immutable issuance facts'
    USING ERRCODE = '42501';
END;
$$;

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
       OR NEW.contact_redacted_at IS NOT NULL THEN
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

  IF v_operation = 'claim' THEN
    IF OLD.attempt_count >= OLD.max_attempts
       OR OLD.contact_redacted_at IS NOT NULL
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

CREATE OR REPLACE FUNCTION private.redact_terminal_advocate_invitation_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF (
    OLD.accepted_at IS NULL
    AND NEW.accepted_at IS NOT NULL
  ) OR (
    OLD.revoked_at IS NULL
    AND NEW.revoked_at IS NOT NULL
  ) THEN
    PERFORM pg_catalog.set_config(
      'app.advocate.invitation_email_operation',
      'cancel',
      true
    );

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
    WHERE outbox.invitation_id = NEW.id
      AND outbox.advocate_id = NEW.advocate_id
      AND outbox.contact_redacted_at IS NULL;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_advocate_invitation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_advocate_invitation_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_advocate_invitation_email_outbox()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.redact_terminal_advocate_invitation_email()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_invitations_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_invitations
FOR EACH ROW EXECUTE FUNCTION private.protect_advocate_invitation();

CREATE TRIGGER advocate_invitations_redact_terminal_email
AFTER UPDATE ON public.advocate_invitations
FOR EACH ROW EXECUTE FUNCTION private.redact_terminal_advocate_invitation_email();

CREATE TRIGGER advocate_invitation_roles_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_invitation_roles
FOR EACH ROW EXECUTE FUNCTION private.protect_advocate_invitation_role();

CREATE TRIGGER advocate_invitation_email_outbox_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_invitation_email_outbox
FOR EACH ROW EXECUTE FUNCTION private.protect_advocate_invitation_email_outbox();

CREATE TRIGGER advocate_invitation_email_outbox_no_truncate
BEFORE TRUNCATE ON public.advocate_invitation_email_outbox
FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_audited_table_truncate();

CREATE TRIGGER advocate_invitation_email_outbox_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_invitation_email_outbox
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  '@columns_only',
  'recipient_email_ciphertext',
  'recipient_email_hmac',
  'email_normalization_version',
  'email_hmac_key_version',
  'email_encryption_key_version',
  'secret_payload_ciphertext',
  'secret_payload_ciphertext_sha256',
  'template_data',
  'locked_lease_token_digest',
  'provider_message_id',
  'last_error_code'
);

CREATE OR REPLACE FUNCTION public.issue_advocate_invitation_email(
  target_advocate_id uuid,
  acting_user_id uuid,
  invited_email text,
  role_keys text[],
  idempotency_key text,
  capability_digest bytea,
  recipient_email_ciphertext bytea,
  recipient_email_hmac bytea,
  secret_payload_ciphertext bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  invitation_id uuid,
  outbox_id uuid,
  expires_at timestamp with time zone,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_email text := lower(btrim(invited_email));
  v_idempotency_key text := btrim(idempotency_key);
  v_reason text := nullif(btrim(change_reason), '');
  v_role_keys text[];
  v_target_user_id uuid;
  v_invitation_id uuid;
  v_outbox_id uuid;
  v_expires_at timestamp with time zone;
  v_fingerprint bytea;
  v_existing public.advocate_invitations%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_actor_membership public.advocate_memberships%ROWTYPE;
  v_secret_ciphertext_sha256 bytea;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF target_advocate_id IS NULL OR acting_user_id IS NULL THEN
    RAISE EXCEPTION 'Advocate and acting user are required'
      USING ERRCODE = '22023';
  END IF;

  IF v_email IS NULL
     OR char_length(v_email) NOT BETWEEN 3 AND 320
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invalid invitation email'
      USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
     OR char_length(v_idempotency_key) NOT BETWEEN 16 AND 200
     OR v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]+$' THEN
    RAISE EXCEPTION 'Invalid invitation idempotency key'
      USING ERRCODE = '22023';
  END IF;

  IF octet_length(capability_digest) <> 32
     OR octet_length(recipient_email_ciphertext) NOT BETWEEN 32 AND 4096
     OR octet_length(recipient_email_hmac) <> 32
     OR octet_length(secret_payload_ciphertext) NOT BETWEEN 32 AND 16384
     OR email_normalization_version NOT BETWEEN 1 AND 32767
     OR email_hmac_key_version NOT BETWEEN 1 AND 32767
     OR email_encryption_key_version NOT BETWEEN 1 AND 32767 THEN
    RAISE EXCEPTION 'Invalid encrypted invitation delivery material'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'An invitation reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255
     OR octet_length(COALESCE(client_ip, '')) > 1024
     OR octet_length(COALESCE(user_agent, '')) > 4096 THEN
    RAISE EXCEPTION 'Invitation request context exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(requested.role_key ORDER BY requested.role_key)
  INTO v_role_keys
  FROM (
    SELECT DISTINCT lower(btrim(value)) AS role_key
    FROM unnest(COALESCE(role_keys, ARRAY[]::text[])) AS supplied(value)
    WHERE value IS NOT NULL AND btrim(value) <> ''
  ) requested;

  IF COALESCE(cardinality(v_role_keys), 0) NOT BETWEEN 1 AND 5
     OR EXISTS (
       SELECT 1
       FROM unnest(v_role_keys) AS requested(role_key)
       LEFT JOIN public.advocate_roles role_definition
         ON role_definition.key = requested.role_key
        AND role_definition.can_be_invited
        AND role_definition.key = ANY (ARRAY[
          'administrator',
          'brand_editor',
          'catalog_curator',
          'analytics_viewer',
          'audit_viewer'
        ]::text[])
       WHERE role_definition.id IS NULL
     ) THEN
    RAISE EXCEPTION 'Invitation contains an invalid or non-invitable role'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = acting_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (actor.banned_until IS NULL OR actor.banned_until <= v_now)
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active verified acting account is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN (
       'draft',
       'provisioning',
       'active',
       'failed'
     ) THEN
    RAISE EXCEPTION 'Advocate portal is not accepting membership changes'
      USING ERRCODE = '55000';
  END IF;

  SELECT membership.*
  INTO v_actor_membership
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.user_id = acting_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_actor_membership.status <> 'active'
     OR NOT EXISTS (
       SELECT 1
       FROM public.advocate_membership_roles membership_role
       JOIN public.advocate_role_permissions role_permission
         ON role_permission.role_id = membership_role.role_id
       JOIN public.advocate_permissions permission
         ON permission.id = role_permission.permission_id
       WHERE membership_role.advocate_id = target_advocate_id
         AND membership_role.membership_id = v_actor_membership.id
         AND permission.key = 'portal.members.invite'
     ) THEN
    RAISE EXCEPTION 'Insufficient portal invitation permission'
      USING ERRCODE = '42501';
  END IF;

  v_fingerprint := extensions.digest(
    pg_catalog.convert_to(
      concat_ws(
        E'\n',
        'advocate-invitation-issuance-v1',
        target_advocate_id::text,
        acting_user_id::text,
        v_email,
        array_to_string(v_role_keys, ','),
        email_normalization_version::text,
        email_hmac_key_version::text,
        email_encryption_key_version::text,
        v_reason
      ),
      'UTF8'
    ),
    'sha256'
  );

  SELECT invitation.*
  INTO v_existing
  FROM public.advocate_invitations invitation
  WHERE invitation.advocate_id = target_advocate_id
    AND invitation.issuance_idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.issuance_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Invitation idempotency key was reused with different material'
        USING ERRCODE = '23505';
    END IF;

    SELECT outbox.id
    INTO v_outbox_id
    FROM public.advocate_invitation_email_outbox outbox
    WHERE outbox.invitation_id = v_existing.id;

    IF v_outbox_id IS NULL THEN
      RAISE EXCEPTION 'Idempotent invitation is missing its delivery envelope'
        USING ERRCODE = '23514';
    END IF;

    RETURN QUERY
    SELECT v_existing.id, v_outbox_id, v_existing.expires_at, false;
    RETURN;
  END IF;

  SELECT account.id
  INTO v_target_user_id
  FROM auth.users account
  WHERE lower(btrim(account.email)) = v_email
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  ORDER BY account.created_at, account.id
  LIMIT 1
  FOR KEY SHARE;

  IF v_target_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.advocate_memberships membership
       WHERE membership.advocate_id = target_advocate_id
         AND membership.user_id = v_target_user_id
         AND membership.status IN ('active', 'suspended')
     ) THEN
    RAISE EXCEPTION 'The account already has a manageable portal membership'
      USING ERRCODE = '23505';
  END IF;

  v_secret_ciphertext_sha256 := extensions.digest(
    secret_payload_ciphertext,
    'sha256'
  );

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => acting_user_id,
    context_effective_user_id => v_target_user_id,
    context_tool => 'advocate-portal-team',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => NULLIF(btrim(session_id), ''),
    context_client_ip => NULLIF(client_ip, ''),
    context_user_agent => NULLIF(user_agent, ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'issue_invitation',
      'resource_kind', 'advocate_invitation',
      'resource_id', target_advocate_id::text,
      'outcome', 'queued'
    )
  );

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'revoke',
    true
  );

  UPDATE public.advocate_invitations invitation
  SET
    revoked_at = v_now,
    revoked_by_user_id = acting_user_id
  WHERE invitation.advocate_id = target_advocate_id
    AND invitation.email = v_email
    AND invitation.accepted_at IS NULL
    AND invitation.revoked_at IS NULL;

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'cancel',
    true
  );

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
  FROM public.advocate_invitations invitation
  WHERE invitation.id = outbox.invitation_id
    AND invitation.advocate_id = target_advocate_id
    AND invitation.email = v_email
    AND invitation.revoked_at = v_now
    AND outbox.contact_redacted_at IS NULL;

  v_invitation_id := gen_random_uuid();
  v_outbox_id := gen_random_uuid();
  v_expires_at := v_now + interval '7 days';

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'issue',
    true
  );

  INSERT INTO public.advocate_invitations (
    id,
    advocate_id,
    email,
    token_digest,
    expires_at,
    target_auth_user_id,
    created_by_user_id,
    created_at,
    last_sent_at,
    issuance_idempotency_key,
    issuance_fingerprint
  )
  VALUES (
    v_invitation_id,
    target_advocate_id,
    v_email,
    capability_digest,
    v_expires_at,
    v_target_user_id,
    acting_user_id,
    v_now,
    NULL,
    v_idempotency_key,
    v_fingerprint
  );

  INSERT INTO public.advocate_invitation_roles (
    advocate_id,
    invitation_id,
    role_id
  )
  SELECT
    target_advocate_id,
    v_invitation_id,
    role_definition.id
  FROM public.advocate_roles role_definition
  WHERE role_definition.key = ANY (v_role_keys)
    AND role_definition.can_be_invited
  ORDER BY role_definition.key;

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'issue',
    true
  );

  INSERT INTO public.advocate_invitation_email_outbox (
    id,
    advocate_id,
    invitation_id,
    recipient_email_ciphertext,
    recipient_email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    email_encryption_key_version,
    secret_payload_ciphertext,
    secret_payload_ciphertext_sha256,
    template_data,
    provider_idempotency_key
  )
  VALUES (
    v_outbox_id,
    target_advocate_id,
    v_invitation_id,
    recipient_email_ciphertext,
    recipient_email_hmac,
    email_normalization_version,
    email_hmac_key_version,
    email_encryption_key_version,
    secret_payload_ciphertext,
    v_secret_ciphertext_sha256,
    jsonb_build_object(
      'advocate_display_name', v_advocate.display_name,
      'invitation_id', v_invitation_id::text,
      'role_keys', to_jsonb(v_role_keys)
    ),
    'advocate-invitation:' || v_outbox_id::text
  );

  RETURN QUERY
  SELECT v_invitation_id, v_outbox_id, v_expires_at, true;
END;
$$;

COMMENT ON FUNCTION public.issue_advocate_invitation_email(
  uuid,
  uuid,
  text,
  text[],
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Service-only atomic invitation and dedicated encrypted-email enqueue. The application service supplies a 256-bit capability digest plus its versioned ciphertext, and the database returns no secret material.';

CREATE OR REPLACE FUNCTION public.claim_advocate_invitation_email_jobs(
  worker_id text,
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
    JOIN public.advocates advocate
      ON advocate.id = outbox.advocate_id
    WHERE invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NULL
      AND invitation.expires_at > v_now
      AND advocate.relationship_status = 'active'
      AND advocate.publication_status IN (
        'draft',
        'provisioning',
        'active',
        'failed'
      )
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

CREATE OR REPLACE FUNCTION public.bind_advocate_invitation_email_target(
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
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_advocate_id uuid;
  v_outbox public.advocate_invitation_email_outbox%ROWTYPE;
  v_invitation public.advocate_invitations%ROWTYPE;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF target_outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR target_user_id IS NULL
     OR octet_length(verified_recipient_email_hmac) <> 32
     OR octet_length(verified_capability_digest) <> 32 THEN
    RAISE EXCEPTION 'Invitation target-binding proof is malformed'
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

  IF v_outbox.status <> 'processing'
     OR v_outbox.locked_at <= v_now - interval '5 minutes'
     OR v_outbox.delivery_started_at IS NOT NULL
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       extensions.digest(lease_token, 'sha256')
     OR v_outbox.recipient_email_hmac IS DISTINCT FROM
       verified_recipient_email_hmac
     OR v_invitation.token_digest IS DISTINCT FROM
       verified_capability_digest
     OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL
     OR v_invitation.expires_at <= v_now THEN
    RAISE EXCEPTION 'Invitation target-binding proof does not match the active lease'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = target_user_id
    AND lower(btrim(account.email)) = v_invitation.email
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation target account is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation.target_auth_user_id IS NOT NULL
     AND v_invitation.target_auth_user_id IS DISTINCT FROM target_user_id THEN
    RAISE EXCEPTION 'Invitation is already bound to a different account'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation.target_auth_user_id IS NULL THEN
    PERFORM audit.set_actor_context(
      context_actor_type => 'system'::audit.audit_actor_type,
      context_effective_user_id => target_user_id,
      context_system_actor => v_outbox.locked_by,
      context_tool => 'advocate-invitation-email-worker',
      context_request_id => NULLIF(btrim(request_id), ''),
      context_trace_id => NULLIF(btrim(trace_id), ''),
      context_reason => 'Bind an exact auth account before invitation delivery',
      context_metadata => jsonb_build_object(
        'operation', 'bind_target',
        'resource_kind', 'advocate_invitation',
        'resource_id', v_invitation.id::text,
        'outcome', 'bound'
      )
    );
    PERFORM pg_catalog.set_config(
      'app.advocate.invitation_operation',
      'bind_target',
      true
    );

    UPDATE public.advocate_invitations invitation
    SET target_auth_user_id = target_user_id
    WHERE invitation.id = v_invitation.id;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_advocate_invitation_email_delivery(
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
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_advocate_id uuid;
  v_outbox public.advocate_invitation_email_outbox%ROWTYPE;
  v_invitation public.advocate_invitations%ROWTYPE;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF target_outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR octet_length(verified_recipient_email_hmac) <> 32
     OR octet_length(verified_capability_digest) <> 32 THEN
    RAISE EXCEPTION 'Invitation delivery proof is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT outbox.advocate_id
  INTO v_advocate_id
  FROM public.advocate_invitation_email_outbox outbox
  WHERE outbox.id = target_outbox_id;

  PERFORM 1
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate_id
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status IN (
      'draft',
      'provisioning',
      'active',
      'failed'
    )
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

  IF v_outbox.status <> 'processing'
     OR v_outbox.locked_at <= v_now - interval '5 minutes'
     OR v_outbox.delivery_started_at IS NOT NULL
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       extensions.digest(lease_token, 'sha256')
     OR v_outbox.recipient_email_hmac IS DISTINCT FROM
       verified_recipient_email_hmac
     OR v_invitation.token_digest IS DISTINCT FROM
       verified_capability_digest
     OR v_invitation.target_auth_user_id IS NULL
     OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL
     OR v_invitation.expires_at <= v_now THEN
    RAISE EXCEPTION 'Invitation delivery proof does not match the active lease'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = v_invitation.target_auth_user_id
    AND lower(btrim(account.email)) = v_invitation.email
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation target account is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_effective_user_id => v_invitation.target_auth_user_id,
    context_system_actor => v_outbox.locked_by,
    context_tool => 'advocate-invitation-email-worker',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_reason => 'Fence advocate invitation provider delivery',
    context_metadata => jsonb_build_object(
      'operation', 'begin_delivery',
      'resource_kind', 'advocate_invitation_email_outbox',
      'resource_id', v_outbox.id::text,
      'outcome', 'started'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'begin_delivery',
    true
  );

  UPDATE public.advocate_invitation_email_outbox outbox
  SET delivery_started_at = v_now
  WHERE outbox.id = v_outbox.id;

  RETURN v_outbox.provider_idempotency_key;
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
    error_code <> 'invitation_email_material_invalid'
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

CREATE OR REPLACE FUNCTION public.settle_advocate_invitation_email_delivery(
  target_outbox_id uuid,
  lease_token text,
  delivery_outcome text,
  provider_message_id text DEFAULT NULL,
  error_code text DEFAULT NULL,
  retry_after_seconds integer DEFAULT 300,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL
)
RETURNS TABLE (
  status public.email_outbox_status,
  retryable boolean,
  settled_at timestamp with time zone
)
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
  v_retryable boolean := false;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF target_outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR delivery_outcome NOT IN ('sent', 'confirmed_not_sent')
     OR retry_after_seconds IS NULL
     OR retry_after_seconds NOT BETWEEN 1 AND 86400
     OR (
       delivery_outcome = 'sent'
       AND (
         provider_message_id IS NULL
         OR provider_message_id <> btrim(provider_message_id)
         OR char_length(provider_message_id) NOT BETWEEN 1 AND 255
         OR error_code IS NOT NULL
       )
     )
     OR (
       delivery_outcome = 'confirmed_not_sent'
       AND (
         provider_message_id IS NOT NULL
         OR error_code IS NULL
         OR NOT (error_code = ANY (ARRAY[
           'invitation_email_material_invalid',
           'invitation_target_unavailable',
           'auth_link_generation_failed',
           'email_provider_unavailable',
           'email_delivery_rejected',
           'internal_error'
         ]::text[]))
       )
     ) THEN
    RAISE EXCEPTION 'Invitation delivery settlement is malformed'
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
     OR v_outbox.delivery_started_at IS NULL
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       extensions.digest(lease_token, 'sha256') THEN
    RAISE EXCEPTION 'Invitation settlement does not match the active provider handoff'
      USING ERRCODE = '55P03';
  END IF;

  IF delivery_outcome = 'sent' THEN
    PERFORM audit.set_actor_context(
      context_actor_type => 'system'::audit.audit_actor_type,
      context_effective_user_id => v_invitation.target_auth_user_id,
      context_system_actor => v_outbox.locked_by,
      context_tool => 'advocate-invitation-email-worker',
      context_request_id => NULLIF(btrim(request_id), ''),
      context_trace_id => NULLIF(btrim(trace_id), ''),
      context_reason => 'Record verified advocate invitation delivery',
      context_metadata => jsonb_build_object(
        'operation', 'complete',
        'resource_kind', 'advocate_invitation_email_outbox',
        'resource_id', v_outbox.id::text,
        'outcome', 'sent'
      )
    );
    PERFORM pg_catalog.set_config(
      'app.advocate.invitation_email_operation',
      'complete',
      true
    );

    UPDATE public.advocate_invitation_email_outbox outbox
    SET
      status = 'sent',
      locked_at = NULL,
      locked_by = NULL,
      locked_lease_token_digest = NULL,
      provider_message_id = settle_advocate_invitation_email_delivery.provider_message_id,
      sent_at = v_now,
      last_error_code = NULL,
      cancelled_at = NULL
    WHERE outbox.id = v_outbox.id;

    PERFORM pg_catalog.set_config(
      'app.advocate.invitation_operation',
      'record_delivery',
      true
    );

    UPDATE public.advocate_invitations invitation
    SET last_sent_at = v_now
    WHERE invitation.id = v_invitation.id;

    RETURN QUERY
    SELECT
      'sent'::public.email_outbox_status,
      false,
      v_now;
    RETURN;
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
    error_code <> 'invitation_email_material_invalid'
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
    context_reason => 'Record a provider-confirmed invitation non-delivery',
    context_metadata => jsonb_build_object(
      'operation', 'settle_not_sent',
      'resource_kind', 'advocate_invitation_email_outbox',
      'resource_id', v_outbox.id::text,
      'outcome', CASE WHEN v_retryable THEN 'retryable' ELSE 'terminal' END,
      'retry_count', v_outbox.attempt_count
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'settle_not_sent',
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

  RETURN QUERY
  SELECT
    'failed'::public.email_outbox_status,
    v_retryable,
    v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_advocate_invitation(
  target_advocate_id uuid,
  target_invitation_id uuid,
  acting_user_id uuid,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_reason text := nullif(btrim(change_reason), '');
  v_advocate public.advocates%ROWTYPE;
  v_actor_membership public.advocate_memberships%ROWTYPE;
  v_invitation public.advocate_invitations%ROWTYPE;
BEGIN
  PERFORM private.require_advocate_invitation_service_role();

  IF target_advocate_id IS NULL
     OR target_invitation_id IS NULL
     OR acting_user_id IS NULL THEN
    RAISE EXCEPTION 'Advocate, invitation, and acting user are required'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'An invitation revocation reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255
     OR octet_length(COALESCE(client_ip, '')) > 1024
     OR octet_length(COALESCE(user_agent, '')) > 4096 THEN
    RAISE EXCEPTION 'Invitation revocation context exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = acting_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (actor.banned_until IS NULL OR actor.banned_until <= v_now)
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active verified acting account is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND OR v_advocate.relationship_status = 'archived' THEN
    RAISE EXCEPTION 'Advocate portal is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO v_actor_membership
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.user_id = acting_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_actor_membership.status <> 'active'
     OR NOT EXISTS (
       SELECT 1
       FROM public.advocate_membership_roles membership_role
       JOIN public.advocate_role_permissions role_permission
         ON role_permission.role_id = membership_role.role_id
       JOIN public.advocate_permissions permission
         ON permission.id = role_permission.permission_id
       WHERE membership_role.advocate_id = target_advocate_id
         AND membership_role.membership_id = v_actor_membership.id
         AND permission.key = 'portal.members.invite'
     ) THEN
    RAISE EXCEPTION 'Insufficient portal invitation permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT invitation.*
  INTO v_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.id = target_invitation_id
    AND invitation.advocate_id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Accepted invitations cannot be revoked'
      USING ERRCODE = '55000';
  END IF;

  IF v_invitation.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => acting_user_id,
    context_effective_user_id => v_invitation.target_auth_user_id,
    context_tool => 'advocate-portal-team',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => NULLIF(btrim(session_id), ''),
    context_client_ip => NULLIF(client_ip, ''),
    context_user_agent => NULLIF(user_agent, ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'revoke_invitation',
      'resource_kind', 'advocate_invitation',
      'resource_id', v_invitation.id::text,
      'outcome', 'revoked'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'revoke',
    true
  );

  UPDATE public.advocate_invitations invitation
  SET
    revoked_at = v_now,
    revoked_by_user_id = acting_user_id
  WHERE invitation.id = v_invitation.id;

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'cancel',
    true
  );

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
  WHERE outbox.invitation_id = v_invitation.id
    AND outbox.contact_redacted_at IS NULL;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_advocate_invitation(
  plaintext_capability text,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS TABLE (
  advocate_id uuid,
  membership_id uuid,
  membership_version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(change_reason), '');
  v_claims jsonb := COALESCE(auth.jwt(), '{}'::jsonb);
  v_issued_at_epoch bigint;
  v_magiclink_authenticated_at_epoch bigint;
  v_session_claim text;
  v_aal text;
  v_user_email text;
  v_invitation_id uuid;
  v_advocate_id uuid;
  v_invitation public.advocate_invitations%ROWTYPE;
  v_advocate public.advocates%ROWTYPE;
  v_membership public.advocate_memberships%ROWTYPE;
  v_membership_id uuid;
  v_membership_version bigint;
  v_role_count integer;
  v_valid_role_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF plaintext_capability IS NULL
     OR plaintext_capability !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) NOT BETWEEN 1 AND 2000
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'An invitation acceptance reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255
     OR octet_length(COALESCE(client_ip, '')) > 1024
     OR octet_length(COALESCE(user_agent, '')) > 4096 THEN
    RAISE EXCEPTION 'Invitation acceptance context exceeds its size limit'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_issued_at_epoch := (v_claims ->> 'iat')::bigint;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_issued_at_epoch := NULL;
  END;

  v_session_claim := nullif(btrim(v_claims ->> 'session_id'), '');
  v_aal := nullif(btrim(v_claims ->> 'aal'), '');

  IF jsonb_typeof(v_claims -> 'amr') = 'array' THEN
    SELECT max((authentication_method.entry ->> 'timestamp')::bigint)
    INTO v_magiclink_authenticated_at_epoch
    FROM jsonb_array_elements(v_claims -> 'amr') AS authentication_method(entry)
    WHERE authentication_method.entry ->> 'method' = 'magiclink'
      AND authentication_method.entry ->> 'timestamp' ~ '^[0-9]{1,12}$';
  END IF;

  IF v_issued_at_epoch IS NULL
     OR v_session_claim IS NULL
     OR char_length(v_session_claim) > 255
     OR v_aal NOT IN ('aal1', 'aal2')
     OR v_issued_at_epoch > extract(epoch FROM v_now)::bigint + 60
     OR v_magiclink_authenticated_at_epoch IS NULL
     OR v_magiclink_authenticated_at_epoch >
       extract(epoch FROM v_now)::bigint + 60
     OR v_magiclink_authenticated_at_epoch <
       extract(epoch FROM v_now)::bigint - 900 THEN
    RAISE EXCEPTION 'Fresh email authentication is required to accept an invitation'
      USING ERRCODE = '42501';
  END IF;

  SELECT invitation.id, invitation.advocate_id
  INTO v_invitation_id, v_advocate_id
  FROM public.advocate_invitations invitation
  WHERE invitation.token_digest = extensions.digest(
    plaintext_capability,
    'sha256'
  );

  IF v_invitation_id IS NULL THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = v_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_advocate.relationship_status <> 'active'
     OR v_advocate.publication_status NOT IN (
       'draft',
       'provisioning',
       'active',
       'failed'
     ) THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT invitation.*
  INTO v_invitation
  FROM public.advocate_invitations invitation
  WHERE invitation.id = v_invitation_id
    AND invitation.advocate_id = v_advocate.id
    AND invitation.token_digest = extensions.digest(
      plaintext_capability,
      'sha256'
    )
  FOR UPDATE;

  IF NOT FOUND
     OR v_invitation.accepted_at IS NOT NULL
     OR v_invitation.revoked_at IS NOT NULL
     OR v_invitation.expires_at <= v_now
     OR v_invitation.target_auth_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = v_advocate.id
    AND membership.user_id = v_user_id
  FOR UPDATE;

  SELECT lower(btrim(account.email))
  INTO v_user_email
  FROM auth.users account
  WHERE account.id = v_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (account.banned_until IS NULL OR account.banned_until <= v_now)
  FOR SHARE;

  IF NOT FOUND OR v_user_email IS DISTINCT FROM v_invitation.email THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE role_definition.can_be_invited
        AND role_definition.key = ANY (ARRAY[
          'administrator',
          'brand_editor',
          'catalog_curator',
          'analytics_viewer',
          'audit_viewer'
        ]::text[])
    )
  INTO v_role_count, v_valid_role_count
  FROM public.advocate_invitation_roles invitation_role
  JOIN public.advocate_roles role_definition
    ON role_definition.id = invitation_role.role_id
  WHERE invitation_role.invitation_id = v_invitation.id
    AND invitation_role.advocate_id = v_invitation.advocate_id;

  IF v_role_count NOT BETWEEN 1 AND 5
     OR v_valid_role_count <> v_role_count THEN
    RAISE EXCEPTION 'Invitation is invalid or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF v_membership.id IS NOT NULL
     AND (
       v_membership.status <> 'revoked'
       OR v_membership.id = v_advocate.owner_membership_id
     ) THEN
    RAISE EXCEPTION 'Existing active or suspended memberships must be managed separately'
      USING ERRCODE = '23505';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_user_id,
    context_effective_user_id => v_user_id,
    context_tool => 'advocate-invitation-acceptance',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => v_session_claim,
    context_client_ip => NULL,
    context_user_agent => NULL,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'redeem_invitation',
      'resource_kind', 'advocate_invitation',
      'resource_id', v_invitation.id::text,
      'outcome', 'accepted'
    )
  );

  IF v_membership.id IS NULL THEN
    INSERT INTO public.advocate_memberships (
      advocate_id,
      user_id,
      status
    )
    VALUES (
      v_advocate.id,
      v_user_id,
      'active'
    )
    RETURNING id INTO v_membership_id;
  ELSE
    v_membership_id := v_membership.id;
    PERFORM pg_catalog.set_config(
      'app.advocate.reactivation_membership_id',
      v_membership.id::text,
      true
    );

    UPDATE public.advocate_memberships membership
    SET
      status = 'active',
      version = membership.version + 1
    WHERE membership.id = v_membership.id
      AND membership.advocate_id = v_advocate.id
      AND membership.status = 'revoked';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Membership changed during invitation redemption'
        USING ERRCODE = '40001';
    END IF;

    DELETE FROM public.advocate_membership_roles membership_role
    WHERE membership_role.advocate_id = v_advocate.id
      AND membership_role.membership_id = v_membership.id;
  END IF;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  SELECT
    v_advocate.id,
    v_membership_id,
    invitation_role.role_id,
    v_invitation.created_by_user_id
  FROM public.advocate_invitation_roles invitation_role
  JOIN public.advocate_roles role_definition
    ON role_definition.id = invitation_role.role_id
   AND role_definition.can_be_invited
  WHERE invitation_role.invitation_id = v_invitation.id
    AND invitation_role.advocate_id = v_advocate.id
  ORDER BY role_definition.key;

  SELECT membership.version
  INTO v_membership_version
  FROM public.advocate_memberships membership
  WHERE membership.id = v_membership_id;

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_operation',
    'redeem',
    true
  );

  UPDATE public.advocate_invitations invitation
  SET
    accepted_at = v_now,
    accepted_by_user_id = v_user_id
  WHERE invitation.id = v_invitation.id;

  PERFORM pg_catalog.set_config(
    'app.advocate.invitation_email_operation',
    'cancel',
    true
  );

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
  WHERE outbox.invitation_id = v_invitation.id
    AND outbox.contact_redacted_at IS NULL;

  RETURN QUERY
  SELECT v_advocate.id, v_membership_id, v_membership_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_advocate_pending_invitations(
  target_advocate_id uuid
)
RETURNS TABLE (
  invitation_id uuid,
  invited_email text,
  role_keys text[],
  invitation_status text,
  expires_at timestamp with time zone,
  created_at timestamp with time zone,
  created_by_current_user boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users actor
    WHERE actor.id = auth.uid()
      AND actor.email IS NOT NULL
      AND actor.email_confirmed_at IS NOT NULL
      AND actor.deleted_at IS NULL
      AND actor.is_anonymous IS NOT TRUE
      AND (actor.banned_until IS NULL OR actor.banned_until <= clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.has_advocate_permission(
    target_advocate_id,
    'portal.members.view'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    invitation.id,
    invitation.email,
    array_agg(role_definition.key ORDER BY role_definition.key),
    CASE
      WHEN invitation.expires_at <= clock_timestamp() THEN 'expired'
      ELSE 'pending'
    END,
    invitation.expires_at,
    invitation.created_at,
    invitation.created_by_user_id = auth.uid()
  FROM public.advocate_invitations invitation
  JOIN public.advocate_invitation_roles invitation_role
    ON invitation_role.invitation_id = invitation.id
   AND invitation_role.advocate_id = invitation.advocate_id
  JOIN public.advocate_roles role_definition
    ON role_definition.id = invitation_role.role_id
  WHERE invitation.advocate_id = target_advocate_id
    AND invitation.accepted_at IS NULL
    AND invitation.revoked_at IS NULL
  GROUP BY invitation.id
  ORDER BY invitation.created_at DESC, invitation.id;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_pending_invitations(uuid) IS
  'Permission-checked owner and administrator projection for pending or expired delegate invitations. It exposes normalized team contact email and predefined roles, but no auth identifier, capability, digest, encrypted delivery material, provider state, or outbox identifier.';

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users actor
    WHERE actor.id = auth.uid()
      AND actor.email IS NOT NULL
      AND actor.email_confirmed_at IS NOT NULL
      AND actor.deleted_at IS NULL
      AND actor.is_anonymous IS NOT TRUE
      AND (actor.banned_until IS NULL OR actor.banned_until <= clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

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
      'advocate_invitation_email_outbox',
      'advocate_logo_upload_reservations',
      'advocate_logo_reconciliation_jobs'
    ]::text[])
    AND (before_sequence IS NULL OR event.sequence_id < before_sequence)
  ORDER BY event.sequence_id DESC
  LIMIT page_size;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_audit_events(uuid, bigint, integer) IS
  'Returns only the sanitized, advocate-scoped audit ledger, including invitation delivery lifecycle events, to members with portal.audit.view. Raw forensic evidence and encrypted delivery material are never exposed.';

REVOKE ALL ON FUNCTION public.issue_advocate_invitation_email(
  uuid,
  uuid,
  text,
  text[],
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_advocate_invitation_email(
  uuid,
  uuid,
  text,
  text[],
  text,
  bytea,
  bytea,
  bytea,
  bytea,
  smallint,
  smallint,
  smallint,
  text,
  text,
  text,
  text,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.claim_advocate_invitation_email_jobs(
  text,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_advocate_invitation_email_jobs(
  text,
  integer,
  text,
  text
) TO service_role;

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

REVOKE ALL ON FUNCTION public.fail_advocate_invitation_email_delivery(
  uuid,
  text,
  text,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_advocate_invitation_email_delivery(
  uuid,
  text,
  text,
  integer,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.settle_advocate_invitation_email_delivery(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_advocate_invitation_email_delivery(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.revoke_advocate_invitation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_advocate_invitation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_advocate_pending_invitations(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_advocate_pending_invitations(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.claim_advocate_invitation_email_jobs(
  text,
  integer,
  text,
  text
) IS
  'Service-only bounded skip-locked claim. It returns encrypted material and a one-time 256-bit lease only while the invitation and tenant remain deliverable. Started provider handoffs are never automatically reclaimed.';
COMMENT ON FUNCTION public.bind_advocate_invitation_email_target(
  uuid,
  text,
  uuid,
  bytea,
  bytea,
  text,
  text
) IS
  'Binds the exact healthy auth account after the worker decrypts and verifies both recipient and capability evidence under an active lease.';
COMMENT ON FUNCTION public.begin_advocate_invitation_email_delivery(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) IS
  'Final authorization fence before provider handoff. It requires a bound exact account and verified encrypted material, then returns the durable provider idempotency key.';
COMMENT ON FUNCTION public.fail_advocate_invitation_email_delivery(
  uuid,
  text,
  text,
  integer,
  text,
  text
) IS
  'Records a sanitized pre-provider failure under the active lease with exponential backoff, an eight-attempt ceiling, and the invitation expiry as an absolute retry deadline.';
COMMENT ON FUNCTION public.settle_advocate_invitation_email_delivery(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  text
) IS
  'Settles a fenced provider handoff as sent or confirmed not sent. Unknown delivery outcomes remain processing and cannot be automatically reclaimed.';
COMMENT ON FUNCTION public.revoke_advocate_invitation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Service-mediated permission-checked invitation revocation that locks the tenant and redacts its dedicated encrypted delivery material.';
COMMENT ON FUNCTION public.redeem_advocate_invitation(
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Single-use redemption requiring a fresh authenticated session, exact verified normalized email, bound auth user, healthy account, capability proof, tenant locks, and an entirely invitable predefined role set. A revoked non-owner membership is reactivated only through this boundary.';

COMMIT;
