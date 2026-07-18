BEGIN;

/*
 * A welcome claim remains a passwordless account entry point for 400 days.
 * This does not change the email outbox contact envelope. Reversible email
 * material is still redacted at the existing 90 day deadline.
 */
ALTER TABLE public.sponsorship_account_claims
  DROP CONSTRAINT sponsorship_account_claims_expiry_check;

DROP TRIGGER sponsorship_account_claims_protect
  ON public.sponsorship_account_claims;

SELECT audit.set_actor_context(
  context_actor_type => 'system'::audit.audit_actor_type,
  context_system_actor => 'schema-migration',
  context_tool => 'database-migration',
  context_reason => 'Extend pending sponsor account claim links to 400 days',
  context_metadata => jsonb_build_object(
    'operation', 'extend_pending_claim_expiry',
    'resource_kind', 'sponsorship_account_claim'
  )
);

UPDATE public.sponsorship_account_claims
SET expires_at = requested_at + interval '400 days'
WHERE status = 'pending'
  AND expires_at < requested_at + interval '400 days';

DO $migration$
DECLARE
  v_definition text;
  v_patched_definition text;
  v_needle constant text := $needle$    NEW.requested_at := v_now;
    NEW.created_at := v_now;
$needle$;
  v_replacement constant text := $replacement$    NEW.requested_at := v_now;
    NEW.expires_at := v_now + interval '400 days';
    NEW.created_at := v_now;
$replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'private.protect_account_claim()'::regprocedure
  )
  INTO v_definition;

  IF v_definition IS NULL
     OR length(v_definition) - length(replace(v_definition, v_needle, ''))
       IS DISTINCT FROM length(v_needle) THEN
    RAISE EXCEPTION 'Account claim expiry patch source is not exact'
      USING ERRCODE = '55000';
  END IF;

  v_patched_definition := replace(
    v_definition,
    v_needle,
    v_replacement
  );
  EXECUTE v_patched_definition;
END;
$migration$;

CREATE TRIGGER sponsorship_account_claims_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.sponsorship_account_claims
FOR EACH ROW EXECUTE FUNCTION private.protect_account_claim();

ALTER TABLE public.sponsorship_account_claims
  ADD CONSTRAINT sponsorship_account_claims_expiry_check CHECK (
    expires_at > requested_at
    AND expires_at <= requested_at + interval '400 days'
  );

DO $migration$
DECLARE
  v_definition text;
  v_patched_definition text;
  v_needle constant text :=
    $needle$clock_timestamp() + interval '6 days 23 hours 59 minutes'$needle$;
  v_replacement constant text :=
    $replacement$clock_timestamp() + interval '400 days'$replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.apply_sponsorship_payment_success(uuid,uuid,bytea,bytea,smallint,bytea,text,jsonb,text,text,text,text)'::regprocedure
  )
  INTO v_definition;

  IF v_definition IS NULL
     OR length(v_definition) - length(replace(v_definition, v_needle, ''))
       IS DISTINCT FROM length(v_needle) THEN
    RAISE EXCEPTION 'Welcome claim creation expiry patch source is not exact'
      USING ERRCODE = '55000';
  END IF;

  v_patched_definition := replace(
    v_definition,
    v_needle,
    v_replacement
  );
  EXECUTE v_patched_definition;
END;
$migration$;

DO $$ BEGIN
  CREATE TYPE public.email_delivery_handoff_status AS ENUM (
    'acceptance_uncertain',
    'confirmed_delivered',
    'confirmed_not_accepted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.email_delivery_handoff_resolution_source AS ENUM (
    'worker',
    'operator'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

/*
 * The worker inserts this evidence before it starts SMTP. An unresolved row
 * blocks stale lease recovery. This closes the crash window where an SMTP
 * server may accept a message while the application never receives the reply.
 */
CREATE TABLE public.email_outbox_delivery_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_outbox_id uuid NOT NULL
    REFERENCES public.email_outbox(id) ON DELETE RESTRICT,
  attempt_count smallint NOT NULL,
  lease_token_digest bytea NOT NULL,
  provider_message_id text NOT NULL,
  status public.email_delivery_handoff_status NOT NULL
    DEFAULT 'acceptance_uncertain',
  handoff_started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_source public.email_delivery_handoff_resolution_source,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_delivery_handoffs_attempt_check CHECK (
    attempt_count > 0
  ),
  CONSTRAINT email_outbox_delivery_handoffs_lease_check CHECK (
    octet_length(lease_token_digest) = 32
  ),
  CONSTRAINT email_outbox_delivery_handoffs_message_id_check CHECK (
    provider_message_id = btrim(provider_message_id)
    AND length(provider_message_id) BETWEEN 1 AND 255
  ),
  CONSTRAINT email_outbox_delivery_handoffs_resolution_reason_check CHECK (
    resolution_reason IS NULL
    OR (
      resolution_reason = btrim(resolution_reason)
      AND length(resolution_reason) BETWEEN 1 AND 500
    )
  ),
  CONSTRAINT email_outbox_delivery_handoffs_state_check CHECK (
    (
      status = 'acceptance_uncertain'
      AND resolved_at IS NULL
      AND resolution_source IS NULL
      AND resolution_reason IS NULL
    )
    OR
    (
      status IN ('confirmed_delivered', 'confirmed_not_accepted')
      AND resolved_at IS NOT NULL
      AND resolution_source IS NOT NULL
      AND resolution_reason IS NOT NULL
    )
  ),
  CONSTRAINT email_outbox_delivery_handoffs_attempt_unique
    UNIQUE (email_outbox_id, attempt_count)
);

CREATE INDEX email_outbox_delivery_handoffs_review_idx
  ON public.email_outbox_delivery_handoffs (
    handoff_started_at,
    email_outbox_id
  )
  WHERE status = 'acceptance_uncertain';

COMMENT ON TABLE public.email_outbox_delivery_handoffs IS
  'Append-only per-attempt SMTP handoff evidence. An unresolved handoff is a manual review quarantine and prevents stale lease redelivery.';

CREATE OR REPLACE FUNCTION private.protect_email_outbox_delivery_handoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := nullif(
    pg_catalog.current_setting('app.email_outbox.handoff_operation', true),
    ''
  );
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Email delivery handoff evidence cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_operation <> 'begin' THEN
      RAISE EXCEPTION 'Email delivery handoff creation requires the narrow worker operation'
        USING ERRCODE = '42501';
    END IF;

    NEW.status := 'acceptance_uncertain';
    NEW.handoff_started_at := v_now;
    NEW.resolved_at := NULL;
    NEW.resolution_source := NULL;
    NEW.resolution_reason := NULL;
    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    RETURN NEW;
  END IF;

  IF v_operation <> 'resolve'
     OR OLD.status <> 'acceptance_uncertain'
     OR NEW.status NOT IN ('confirmed_delivered', 'confirmed_not_accepted')
     OR NEW.resolution_source IS NULL
     OR nullif(btrim(NEW.resolution_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Email delivery handoff resolution is not legal'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email_outbox_id IS DISTINCT FROM OLD.email_outbox_id
     OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
     OR NEW.lease_token_digest IS DISTINCT FROM OLD.lease_token_digest
     OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
     OR NEW.handoff_started_at IS DISTINCT FROM OLD.handoff_started_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Email delivery handoff identity evidence is immutable'
      USING ERRCODE = '42501';
  END IF;

  NEW.resolved_at := v_now;
  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

CREATE TRIGGER email_outbox_delivery_handoffs_protect
BEFORE INSERT OR UPDATE OR DELETE ON public.email_outbox_delivery_handoffs
FOR EACH ROW EXECUTE FUNCTION private.protect_email_outbox_delivery_handoff();

REVOKE ALL ON FUNCTION private.protect_email_outbox_delivery_handoff()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER email_outbox_delivery_handoffs_no_truncate
BEFORE TRUNCATE ON public.email_outbox_delivery_handoffs
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

CREATE TRIGGER email_outbox_delivery_handoffs_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.email_outbox_delivery_handoffs
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'lease_token_digest',
  'provider_message_id'
);

ALTER TABLE public.email_outbox_delivery_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox_delivery_handoffs
  FROM PUBLIC, anon, authenticated, service_role;

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

/*
 * This is the last database operation before SMTP. Once it commits, any
 * uncertain provider outcome remains quarantined until an operator resolves
 * it. The worker never converts this evidence into an automatic retry.
 */
CREATE OR REPLACE FUNCTION public.begin_email_outbox_delivery_handoff(
  target_outbox_id uuid,
  target_lease_token text,
  verified_recipient_email_hmac bytea,
  target_provider_message_id text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz;
  v_outbox public.email_outbox%ROWTYPE;
  v_started_at timestamptz;
  v_lease_digest bytea;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_outbox_id IS NULL
     OR target_lease_token IS NULL
     OR target_lease_token !~ '^[0-9a-f]{64}$'
     OR octet_length(verified_recipient_email_hmac) IS DISTINCT FROM 32
     OR target_provider_message_id IS DISTINCT FROM
       '<sponsor-welcome.' || target_outbox_id::text || '@creatorshare.com>' THEN
    RAISE EXCEPTION 'Email delivery handoff proof is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_lease_digest := extensions.digest(target_lease_token, 'sha256');

  SELECT outbox.*
  INTO v_outbox
  FROM public.email_outbox outbox
  WHERE outbox.id = target_outbox_id
  FOR UPDATE;

  v_now := clock_timestamp();

  IF NOT FOUND
     OR v_outbox.status <> 'processing'
     OR v_outbox.locked_at IS NULL
     OR v_outbox.locked_at <= v_now - interval '10 minutes'
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM v_lease_digest THEN
    RAISE EXCEPTION 'Email delivery handoff does not match the active outbox lease'
      USING ERRCODE = '55P03';
  END IF;

  IF v_outbox.kind <> 'sponsor_welcome'
     OR v_outbox.contact_redacted_at IS NOT NULL
     OR v_outbox.recipient_email_hmac IS DISTINCT FROM
       verified_recipient_email_hmac
     OR NOT EXISTS (
       SELECT 1
       FROM public.sponsorship_secret_material_accesses access
       WHERE access.access_kind = 'email_delivery_material_verification'
         AND access.email_outbox_id = v_outbox.id
         AND access.account_claim_id = v_outbox.account_claim_id
         AND access.lease_attempt_count = v_outbox.attempt_count
         AND access.accessed_at >= v_outbox.locked_at
         AND access.accessed_at <= v_now
     ) THEN
    RAISE EXCEPTION 'Email delivery handoff lacks verified material evidence'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => v_outbox.locked_by,
    context_tool => 'email-delivery-worker',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Record SMTP handoff before provider acceptance can become ambiguous',
    context_metadata => jsonb_build_object(
      'operation', 'begin_handoff',
      'resource_kind', 'email_outbox_delivery_handoff',
      'resource_id', v_outbox.id::text,
      'retry_count', v_outbox.attempt_count,
      'outcome', 'acceptance_uncertain'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.email_outbox.handoff_operation',
    'begin',
    true
  );

  INSERT INTO public.email_outbox_delivery_handoffs (
    email_outbox_id,
    attempt_count,
    lease_token_digest,
    provider_message_id
  )
  VALUES (
    v_outbox.id,
    v_outbox.attempt_count,
    v_lease_digest,
    target_provider_message_id
  )
  RETURNING handoff_started_at INTO v_started_at;

  RETURN v_started_at;
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
  v_now timestamptz;
  v_outbox public.email_outbox%ROWTYPE;
  v_handoff public.email_outbox_delivery_handoffs%ROWTYPE;
  v_sent_at timestamptz;
  v_lease_digest bytea;
BEGIN
  PERFORM private.require_payment_service_role();

  IF outbox_id IS NULL
     OR lease_token IS NULL
     OR lease_token !~ '^[0-9a-f]{64}$'
     OR octet_length(verified_recipient_email_hmac) IS DISTINCT FROM 32
     OR provider_message_id IS NULL
     OR provider_message_id <> btrim(provider_message_id)
     OR length(provider_message_id) < 1
     OR length(provider_message_id) > 255 THEN
    RAISE EXCEPTION 'Email completion proof is malformed'
      USING ERRCODE = '22023';
  END IF;

  v_lease_digest := extensions.digest(lease_token, 'sha256');

  SELECT outbox.*
  INTO v_outbox
  FROM public.email_outbox outbox
  WHERE outbox.id = complete_email_outbox_delivery.outbox_id
  FOR UPDATE;

  v_now := clock_timestamp();

  IF NOT FOUND
     OR v_outbox.status <> 'processing'
     OR v_outbox.locked_at IS NULL
     OR v_outbox.locked_at <= v_now - interval '10 minutes'
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM v_lease_digest
     OR v_outbox.recipient_email_hmac IS DISTINCT FROM
       verified_recipient_email_hmac THEN
    RAISE EXCEPTION 'Email completion proof does not match the active delivery lease'
      USING ERRCODE = '42501';
  END IF;

  SELECT handoff.*
  INTO v_handoff
  FROM public.email_outbox_delivery_handoffs handoff
  WHERE handoff.email_outbox_id = v_outbox.id
    AND handoff.attempt_count = v_outbox.attempt_count
  FOR UPDATE;

  IF NOT FOUND
     OR v_handoff.status <> 'acceptance_uncertain'
     OR v_handoff.lease_token_digest IS DISTINCT FROM v_lease_digest
     OR v_handoff.provider_message_id IS DISTINCT FROM provider_message_id THEN
    RAISE EXCEPTION 'Email completion proof does not match an unresolved SMTP handoff'
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
    'app.email_outbox.handoff_operation',
    'resolve',
    true
  );

  UPDATE public.email_outbox_delivery_handoffs handoff
  SET
    status = 'confirmed_delivered',
    resolution_source = 'worker',
    resolution_reason = 'smtp_acceptance_returned_to_worker'
  WHERE handoff.id = v_handoff.id;

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
  WHERE outbox.id = complete_email_outbox_delivery.outbox_id
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

/*
 * Operators may release a retry only after provider evidence proves the SMTP
 * server did not accept the message. If delivery is confirmed, this function
 * settles the original handoff without revealing or accepting contact data.
 */
CREATE OR REPLACE FUNCTION public.resolve_email_outbox_delivery_ambiguity(
  target_handoff_id uuid,
  target_resolution text,
  target_reason text,
  context_operator_reference text,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  email_outbox_id uuid,
  outbox_status public.email_outbox_status,
  handoff_status public.email_delivery_handoff_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_handoff public.email_outbox_delivery_handoffs%ROWTYPE;
  v_outbox public.email_outbox%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_handoff_id IS NULL
     OR target_resolution NOT IN ('confirmed_delivered', 'confirmed_not_accepted')
     OR target_reason IS NULL
     OR target_reason <> btrim(target_reason)
     OR length(target_reason) < 8
     OR length(target_reason) > 500
     OR context_operator_reference IS NULL
     OR context_operator_reference <> btrim(context_operator_reference)
     OR length(context_operator_reference) < 3
     OR length(context_operator_reference) > 120
     OR context_operator_reference !~ '^[A-Za-z0-9:._/]+$' THEN
    RAISE EXCEPTION 'Email delivery ambiguity resolution is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT handoff.*
  INTO v_handoff
  FROM public.email_outbox_delivery_handoffs handoff
  WHERE handoff.id = target_handoff_id
  FOR UPDATE;

  IF NOT FOUND OR v_handoff.status <> 'acceptance_uncertain' THEN
    RAISE EXCEPTION 'Email delivery ambiguity is not open for resolution'
      USING ERRCODE = '23514';
  END IF;

  SELECT outbox.*
  INTO v_outbox
  FROM public.email_outbox outbox
  WHERE outbox.id = v_handoff.email_outbox_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_outbox.status <> 'processing'
     OR v_outbox.attempt_count IS DISTINCT FROM v_handoff.attempt_count
     OR v_outbox.locked_lease_token_digest IS DISTINCT FROM
       v_handoff.lease_token_digest THEN
    RAISE EXCEPTION 'Email delivery ambiguity does not match its quarantined outbox attempt'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'email-delivery-operator',
    context_tool => 'resolve_email_outbox_delivery_ambiguity',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => target_reason,
    context_metadata => jsonb_build_object(
      'operation', 'resolve_handoff',
      'resource_kind', 'email_outbox_delivery_handoff',
      'resource_id', v_handoff.id::text,
      'correlation_id', context_operator_reference,
      'outcome', target_resolution
    )
  );
  PERFORM pg_catalog.set_config(
    'app.email_outbox.handoff_operation',
    'resolve',
    true
  );

  UPDATE public.email_outbox_delivery_handoffs handoff
  SET
    status = target_resolution::public.email_delivery_handoff_status,
    resolution_source = 'operator',
    resolution_reason = target_reason
  WHERE handoff.id = v_handoff.id;

  IF target_resolution = 'confirmed_delivered' THEN
    PERFORM pg_catalog.set_config(
      'app.email_outbox.lifecycle_operation',
      'complete',
      true
    );
    UPDATE public.email_outbox outbox
    SET
      status = 'sent',
      provider_message_id = v_handoff.provider_message_id,
      email_log_id = NULL
    WHERE outbox.id = v_outbox.id;
  ELSE
    PERFORM pg_catalog.set_config(
      'app.email_outbox.lifecycle_operation',
      'fail',
      true
    );
    UPDATE public.email_outbox outbox
    SET
      status = 'failed',
      available_at = v_now,
      last_error = 'welcome_email_operator_confirmed_not_accepted'
    WHERE outbox.id = v_outbox.id;
  END IF;

  RETURN QUERY
  SELECT
    outbox.id,
    outbox.status,
    target_resolution::public.email_delivery_handoff_status
  FROM public.email_outbox outbox
  WHERE outbox.id = v_outbox.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_email_outbox_delivery_ambiguities(
  batch_size integer DEFAULT 100
)
RETURNS TABLE (
  handoff_id uuid,
  email_outbox_id uuid,
  attempt_count smallint,
  provider_message_id text,
  handoff_started_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_payment_service_role();

  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 500 THEN
    RAISE EXCEPTION 'Email delivery ambiguity batch size must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    handoff.id,
    handoff.email_outbox_id,
    handoff.attempt_count,
    handoff.provider_message_id,
    handoff.handoff_started_at
  FROM public.email_outbox_delivery_handoffs handoff
  WHERE handoff.status = 'acceptance_uncertain'
  ORDER BY handoff.handoff_started_at, handoff.id
  LIMIT batch_size;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_email_outbox_delivery_handoff(
  uuid,
  text,
  bytea,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_email_outbox_delivery_handoff(
  uuid,
  text,
  bytea,
  text,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_email_outbox_delivery_ambiguity(
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_email_outbox_delivery_ambiguity(
  uuid,
  text,
  text,
  text,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.list_email_outbox_delivery_ambiguities(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_email_outbox_delivery_ambiguities(integer)
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

COMMENT ON FUNCTION public.begin_email_outbox_delivery_handoff(
  uuid,
  text,
  bytea,
  text,
  text,
  text
) IS
  'Persists an unresolved SMTP handoff before network delivery. A stale outbox lease with this evidence cannot be claimed automatically.';

COMMENT ON FUNCTION public.resolve_email_outbox_delivery_ambiguity(
  uuid,
  text,
  text,
  text,
  text,
  text
) IS
  'Resolves quarantined SMTP acceptance only from provider evidence. A retry is released solely after the operator confirms the provider did not accept the message.';

COMMENT ON FUNCTION public.list_email_outbox_delivery_ambiguities(integer) IS
  'Returns the contact-free SMTP manual review queue to the service role.';

COMMIT;
