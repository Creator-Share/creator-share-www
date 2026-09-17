DROP TRIGGER IF EXISTS email_outbox_protect
  ON public.email_outbox;

ALTER TABLE public.email_outbox
  ADD COLUMN locked_lease_token_digest bytea;

SELECT audit.set_actor_context(
  context_actor_type => 'system'::audit.audit_actor_type,
  context_system_actor => 'schema-migration',
  context_tool => 'database-migration',
  context_reason => 'Apply an absolute welcome email contact retention deadline'
);

UPDATE public.email_outbox
SET contact_retention_expires_at = created_at + interval '90 days'
WHERE contact_retention_expires_at IS NULL
   OR contact_retention_expires_at > created_at + interval '90 days';

ALTER TABLE public.email_outbox
  ALTER COLUMN contact_retention_expires_at SET NOT NULL,
  DROP CONSTRAINT email_outbox_status_shape_check,
  DROP CONSTRAINT email_outbox_contact_retention_check;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_contact_retention_check CHECK (
    contact_retention_expires_at = created_at + interval '90 days'
  ),
  ADD CONSTRAINT email_outbox_locked_by_check CHECK (
    locked_by IS NULL
    OR (
      locked_by = btrim(locked_by)
      AND length(locked_by) BETWEEN 1 AND 120
    )
  ),
  ADD CONSTRAINT email_outbox_provider_message_id_check CHECK (
    provider_message_id IS NULL
    OR (
      provider_message_id = btrim(provider_message_id)
      AND length(provider_message_id) BETWEEN 1 AND 255
    )
  ),
  ADD CONSTRAINT email_outbox_last_error_check CHECK (
    last_error IS NULL
    OR length(last_error) BETWEEN 1 AND 500
  ),
  ADD CONSTRAINT email_outbox_status_shape_check CHECK (
    (
      status = 'pending'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND sent_at IS NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'processing'
      AND locked_at IS NOT NULL
      AND nullif(btrim(locked_by), '') IS NOT NULL
      AND octet_length(locked_lease_token_digest) = 32
      AND sent_at IS NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'sent'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND sent_at IS NOT NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'failed'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND sent_at IS NULL
      AND cancelled_at IS NULL
      AND nullif(btrim(last_error), '') IS NOT NULL
    )
    OR
    (
      status = 'cancelled'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND locked_lease_token_digest IS NULL
      AND sent_at IS NULL
      AND cancelled_at IS NOT NULL
    )
  );

CREATE TRIGGER email_outbox_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.email_outbox
FOR EACH ROW EXECUTE FUNCTION private.protect_email_outbox();

CREATE OR REPLACE FUNCTION public.claim_email_outbox_jobs(
  worker_id text,
  batch_size integer DEFAULT 20
)
RETURNS TABLE (
  outbox_id uuid,
  lease_token text,
  lease_expires_at timestamptz,
  kind public.email_outbox_kind,
  template_key text,
  template_data jsonb,
  recipient_email_ciphertext bytea,
  secret_payload_ciphertext bytea,
  email_normalization_version smallint,
  email_hmac_key_version smallint,
  email_encryption_key_version smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM private.require_payment_service_role();

  IF worker_id IS NULL
     OR worker_id <> btrim(worker_id)
     OR length(worker_id) < 1
     OR length(worker_id) > 120 THEN
    RAISE EXCEPTION 'Worker identity must contain between 1 and 120 characters'
      USING ERRCODE = '22023';
  END IF;

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 100 THEN
    RAISE EXCEPTION 'Email claim batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.purge_expired_email_outbox_contact(500);
  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => worker_id,
    context_tool => 'email-delivery-worker',
    context_reason => 'Claim encrypted welcome email delivery envelopes',
    context_metadata => jsonb_build_object(
      'operation', 'claim',
      'resource_kind', 'email_outbox',
      'outcome', 'claimed'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.email_outbox.lifecycle_operation',
    'claim',
    true
  );

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT outbox.id
    FROM public.email_outbox outbox
    JOIN public.sponsorship_account_claims claim
      ON claim.id = outbox.account_claim_id
    WHERE outbox.contact_redacted_at IS NULL
      AND outbox.contact_retention_expires_at > v_now
      AND outbox.attempt_count < outbox.max_attempts
      AND claim.status = 'pending'
      AND claim.expires_at > v_now
      AND claim.revoked_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.email_outbox_delivery_handoffs handoff
        WHERE handoff.email_outbox_id = outbox.id
          AND handoff.status = 'acceptance_uncertain'
      )
      AND (
        (
          outbox.status IN ('pending', 'failed')
          AND outbox.available_at <= v_now
        )
        OR
        (
          outbox.status = 'processing'
          AND outbox.locked_at <= v_now - interval '10 minutes'
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
    UPDATE public.email_outbox outbox
    SET
      status = 'processing',
      locked_by = worker_id,
      locked_lease_token_digest = extensions.digest(
        lease.plaintext_token,
        'sha256'
      )
    FROM leases lease
    WHERE outbox.id = lease.id
    RETURNING
      outbox.id,
      outbox.locked_at,
      outbox.kind,
      outbox.template_key,
      outbox.template_data,
      outbox.recipient_email_ciphertext,
      outbox.secret_payload_ciphertext,
      outbox.email_normalization_version,
      outbox.email_hmac_key_version,
      outbox.email_encryption_key_version
  )
  SELECT
    claimed.id,
    lease.plaintext_token,
    claimed.locked_at + interval '10 minutes',
    claimed.kind,
    claimed.template_key,
    claimed.template_data,
    claimed.recipient_email_ciphertext,
    claimed.secret_payload_ciphertext,
    claimed.email_normalization_version,
    claimed.email_hmac_key_version,
    claimed.email_encryption_key_version
  FROM claimed
  JOIN leases lease ON lease.id = claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_email_outbox_delivery(
  outbox_id uuid,
  lease_token text,
  verified_recipient_email_hmac bytea,
  provider_message_id text,
  email_log_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_outbox public.email_outbox%ROWTYPE;
  v_sent_at timestamptz;
BEGIN
  IF outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR octet_length(verified_recipient_email_hmac) <> 32
     OR provider_message_id IS NULL
     OR provider_message_id <> btrim(provider_message_id)
     OR length(provider_message_id) < 1
     OR length(provider_message_id) > 255 THEN
    RAISE EXCEPTION 'Email completion proof is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM public.email_outbox outbox
  WHERE outbox.id = outbox_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_outbox.status <> 'processing'
     OR v_outbox.locked_at <= v_now - interval '10 minutes'
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       extensions.digest(lease_token, 'sha256')
     OR v_outbox.recipient_email_hmac IS DISTINCT FROM
       verified_recipient_email_hmac THEN
    RAISE EXCEPTION 'Email completion proof does not match the active delivery lease'
      USING ERRCODE = '42501';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => v_outbox.locked_by,
    context_tool => 'email-delivery-worker',
    context_reason => 'Record verified welcome email delivery',
    context_metadata => jsonb_build_object(
      'operation', 'complete',
      'resource_kind', 'email_outbox',
      'resource_id', outbox_id::text,
      'outcome', 'sent'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.email_outbox.lifecycle_operation',
    'complete',
    true
  );

  UPDATE public.email_outbox outbox
  SET
    status = 'sent',
    provider_message_id = complete_email_outbox_delivery.provider_message_id,
    email_log_id = complete_email_outbox_delivery.email_log_id
  WHERE outbox.id = outbox_id
  RETURNING outbox.sent_at INTO v_sent_at;

  RETURN v_sent_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_email_outbox_delivery(
  outbox_id uuid,
  lease_token text,
  error_summary text,
  retry_after_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_outbox public.email_outbox%ROWTYPE;
  v_retryable boolean;
  v_effective_retry_after_seconds integer;
BEGIN
  PERFORM private.require_payment_service_role();

  IF outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR error_summary IS NULL
     OR error_summary <> btrim(error_summary)
     OR length(error_summary) < 1
     OR length(error_summary) > 500
     OR retry_after_seconds IS NULL
     OR retry_after_seconds < 1
     OR retry_after_seconds > 86400 THEN
    RAISE EXCEPTION 'Email failure proof is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM public.email_outbox outbox
  WHERE outbox.id = fail_email_outbox_delivery.outbox_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_outbox.status <> 'processing'
     OR v_outbox.locked_at <= v_now - interval '10 minutes'
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       extensions.digest(lease_token, 'sha256') THEN
    RAISE EXCEPTION 'Email failure proof does not match the active delivery lease'
      USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.email_outbox_delivery_handoffs handoff
    WHERE handoff.email_outbox_id = v_outbox.id
      AND handoff.attempt_count = v_outbox.attempt_count
      AND handoff.status = 'acceptance_uncertain'
  ) THEN
    RAISE EXCEPTION 'An uncertain SMTP handoff requires manual review'
      USING ERRCODE = '55P03';
  END IF;

  v_effective_retry_after_seconds := LEAST(
    86400::numeric,
    retry_after_seconds::numeric
    * power(
        2::numeric,
        LEAST(GREATEST(v_outbox.attempt_count - 1, 0), 30)
      )
  )::integer;

  v_retryable :=
    error_summary <> 'welcome_email_material_invalid'
    AND v_outbox.attempt_count < v_outbox.max_attempts
    AND v_now + make_interval(secs => v_effective_retry_after_seconds)
      < v_outbox.contact_retention_expires_at;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => v_outbox.locked_by,
    context_tool => 'email-delivery-worker',
    context_reason => 'Record welcome email delivery failure',
    context_metadata => jsonb_build_object(
      'operation', 'fail',
      'resource_kind', 'email_outbox',
      'resource_id', outbox_id::text,
      'outcome', CASE WHEN v_retryable THEN 'retryable' ELSE 'terminal' END
    )
  );
  PERFORM pg_catalog.set_config(
    'app.email_outbox.lifecycle_operation',
    'fail',
    true
  );

  UPDATE public.email_outbox outbox
  SET
    status = 'failed',
    available_at = CASE
      WHEN v_retryable
        THEN v_now + make_interval(secs => v_effective_retry_after_seconds)
      ELSE outbox.contact_retention_expires_at
    END,
    last_error = error_summary
  WHERE outbox.id = fail_email_outbox_delivery.outbox_id;

  RETURN v_retryable;
END;
$$;

REVOKE SELECT, UPDATE, DELETE ON public.email_outbox
  FROM service_role;
GRANT INSERT ON public.email_outbox TO service_role;

REVOKE ALL ON FUNCTION public.purge_expired_email_outbox_contact(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_email_outbox_contact(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_email_outbox_jobs(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox_jobs(text, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_email_outbox_delivery(
  uuid,
  text,
  bytea,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_email_outbox_delivery(
  uuid,
  text,
  bytea,
  text,
  uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.fail_email_outbox_delivery(
  uuid,
  text,
  text,
  integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_email_outbox_delivery(
  uuid,
  text,
  text,
  integer
) TO service_role;
