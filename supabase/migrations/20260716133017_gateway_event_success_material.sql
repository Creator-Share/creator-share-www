BEGIN;

CREATE TABLE public.sponsorship_secret_material_accesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_kind text NOT NULL,
  gateway_event_id uuid
    REFERENCES public.payment_gateway_events(id) ON DELETE RESTRICT,
  payment_attempt_id uuid
    REFERENCES public.sponsorship_payment_attempts(id) ON DELETE RESTRICT,
  email_outbox_id uuid
    REFERENCES public.email_outbox(id) ON DELETE RESTRICT,
  account_claim_id uuid
    REFERENCES public.sponsorship_account_claims(id) ON DELETE RESTRICT,
  lease_attempt_count integer NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_secret_material_accesses_kind_check CHECK (
    access_kind IN (
      'gateway_success_material',
      'email_delivery_material_verification'
    )
  ),
  CONSTRAINT sponsorship_secret_material_accesses_lease_check CHECK (
    lease_attempt_count > 0
  ),
  CONSTRAINT sponsorship_secret_material_accesses_shape_check CHECK (
    (
      access_kind = 'gateway_success_material'
      AND gateway_event_id IS NOT NULL
      AND payment_attempt_id IS NOT NULL
      AND email_outbox_id IS NULL
      AND account_claim_id IS NULL
    )
    OR (
      access_kind = 'email_delivery_material_verification'
      AND gateway_event_id IS NULL
      AND payment_attempt_id IS NULL
      AND email_outbox_id IS NOT NULL
      AND account_claim_id IS NOT NULL
    )
  )
);

CREATE INDEX sponsorship_secret_material_accesses_gateway_idx
  ON public.sponsorship_secret_material_accesses (
    gateway_event_id,
    accessed_at DESC
  )
  WHERE gateway_event_id IS NOT NULL;

CREATE INDEX sponsorship_secret_material_accesses_outbox_idx
  ON public.sponsorship_secret_material_accesses (
    email_outbox_id,
    accessed_at DESC
  )
  WHERE email_outbox_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.prevent_secret_material_access_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Secret material access records are append-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_secret_material_access_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER sponsorship_secret_material_accesses_no_mutation
BEFORE UPDATE OR DELETE ON public.sponsorship_secret_material_accesses
FOR EACH ROW EXECUTE FUNCTION private.prevent_secret_material_access_mutation();

CREATE TRIGGER sponsorship_secret_material_accesses_no_truncate
BEFORE TRUNCATE ON public.sponsorship_secret_material_accesses
FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_audited_table_truncate();

CREATE TRIGGER sponsorship_secret_material_accesses_audit
AFTER INSERT OR UPDATE OR DELETE ON public.sponsorship_secret_material_accesses
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only'
);

ALTER TABLE public.sponsorship_secret_material_accesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsorship_secret_material_accesses
  FROM PUBLIC, anon, authenticated, service_role;

/*
 * A successful payment application needs the sponsor email solely to create
 * the encrypted welcome outbox bundle. The email is already sealed inside the
 * server-owned provider request. Expose that envelope only to the worker that
 * holds the current gateway event lease, and return the immutable intent HMAC
 * beside it so the application can verify the decrypted email before use.
 */
CREATE OR REPLACE FUNCTION public.read_payment_gateway_event_success_material(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  payment_attempt_id uuid,
  welcome_required boolean,
  checkout_operation_id uuid,
  sponsorship_intent_id uuid,
  payment_quote_id uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_idempotency_key text,
  provider_request_schema_version smallint,
  provider_request_fingerprint bytea,
  provider_request_expires_at timestamptz,
  provider_request_ciphertext bytea,
  provider_request_encryption_key_version smallint,
  provider_request_ciphertext_sha256 bytea,
  contact_email_hmac bytea,
  contact_email_normalization_version smallint,
  contact_email_hmac_key_version smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_welcome_required boolean;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_gateway_event_id IS NULL
     OR target_processing_lease_token IS NULL THEN
    RAISE EXCEPTION 'Gateway success material lease proof is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF v_event.processing_status <> 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM
       target_processing_lease_token
     OR v_event.processing_locked_at IS NULL
     OR v_event.processing_locked_at <=
       clock_timestamp() - interval '10 minutes' THEN
    RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  IF NOT (
       (
         v_event.provider = 'STRIPE'
         AND (
           (
             v_event.event_type IN (
               'checkout.session.completed',
               'checkout.session.async_payment_succeeded'
             )
             AND v_event.provider_object_type = 'checkout_session'
           )
           OR (
             v_event.event_type IN (
               'invoice.paid',
               'invoice.payment_succeeded'
             )
             AND v_event.provider_object_type = 'invoice'
           )
         )
       )
       OR (
         v_event.provider = 'PAYPAL'
         AND (
           (
             v_event.event_type = 'PAYMENT.CAPTURE.COMPLETED'
             AND v_event.provider_object_type = 'capture'
           )
           OR (
             v_event.event_type = 'PAYMENT.SALE.COMPLETED'
             AND v_event.provider_object_type = 'sale'
           )
         )
       )
     )
     OR v_event.fact_payment_status IS DISTINCT FROM 'paid'
     OR v_event.payment_attempt_id IS NULL
     OR v_event.sponsorship_intent_id IS NULL
     OR v_event.fact_server_payment_attempt_id IS DISTINCT FROM
       v_event.payment_attempt_id THEN
    RAISE EXCEPTION 'Gateway event is not a typed sponsorship payment success'
      USING ERRCODE = '23514';
  END IF;

  /*
   * Determine whether this event can create the sponsor's one welcome before
   * touching any encrypted checkout evidence. These rows are immutable. A
   * concurrent first success may make this a conservative true, which is safe
   * because the application RPC serializes on the sponsor identity and checks
   * the outbox again.
   */
  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = v_event.payment_attempt_id;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_event.sponsorship_intent_id;

  IF v_attempt.id IS NULL
     OR v_intent.id IS NULL
     OR v_attempt.sponsorship_intent_id IS DISTINCT FROM v_intent.id
     OR v_attempt.provider IS DISTINCT FROM v_event.provider
     OR v_attempt.provider_account_scope IS DISTINCT FROM
       v_event.provider_account_scope THEN
    RAISE EXCEPTION 'Gateway success does not match one payment chain'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    v_intent.subject_kind IN ('standard', 'blind')
    AND NOT EXISTS (
      SELECT 1
      FROM public.sponsorship_financial_movements movement
      WHERE movement.sponsorship_intent_id = v_intent.id
        AND movement.entry_kind = 'sponsorship_payment'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.email_outbox email
      WHERE email.kind = 'sponsor_welcome'
        AND email.sponsor_identity_id = v_intent.sponsor_identity_id
    )
  INTO v_welcome_required;

  IF NOT v_welcome_required THEN
    IF v_event.processing_locked_at <=
         clock_timestamp() - interval '10 minutes' THEN
      RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
        USING ERRCODE = '55P03';
    END IF;

    RETURN QUERY SELECT
      v_event.id,
      v_attempt.id,
      false,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      NULL::public.sponsorship_method,
      NULL::text,
      NULL::text,
      NULL::smallint,
      NULL::bytea,
      NULL::timestamptz,
      NULL::bytea,
      NULL::smallint,
      NULL::bytea,
      NULL::bytea,
      NULL::smallint,
      NULL::smallint;
    RETURN;
  END IF;

  /*
   * Foreground checkout recovery locks operation, attempt, then recovery.
   * Match that canonical order so a browser resume and webhook application
   * cannot deadlock while the event lease remains the outer fence.
   */
  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = v_event.payment_attempt_id;

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = v_recovery.checkout_operation_id
  FOR SHARE;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = v_event.payment_attempt_id
  FOR SHARE;

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = v_event.payment_attempt_id
  FOR SHARE;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_event.sponsorship_intent_id
  FOR SHARE;

  IF v_attempt.id IS NULL
     OR v_recovery.payment_attempt_id IS NULL
     OR v_operation.operation_id IS NULL
     OR v_intent.id IS NULL
     OR v_attempt.sponsorship_intent_id IS DISTINCT FROM v_intent.id
     OR v_attempt.payment_quote_id IS DISTINCT FROM
       v_recovery.payment_quote_id
     OR v_attempt.provider IS DISTINCT FROM v_event.provider
     OR v_attempt.provider_account_scope IS DISTINCT FROM
       v_event.provider_account_scope
     OR v_recovery.sponsorship_intent_id IS DISTINCT FROM v_intent.id
     OR v_recovery.provider IS DISTINCT FROM v_event.provider
     OR v_recovery.provider_account_scope IS DISTINCT FROM
       v_event.provider_account_scope
     OR v_operation.sponsorship_intent_id IS DISTINCT FROM v_intent.id
     OR v_operation.provider IS DISTINCT FROM v_event.provider
     OR v_operation.provider_account_scope IS DISTINCT FROM
       v_event.provider_account_scope
     OR v_operation.provider_idempotency_key IS DISTINCT FROM
       v_attempt.provider_idempotency_key THEN
    RAISE EXCEPTION 'Gateway success material does not match one checkout chain'
      USING ERRCODE = '23514';
  END IF;

  PERFORM private.validate_provider_request_template_v2(
    v_operation.operation_id,
    v_intent.id,
    v_recovery.payment_quote_id,
    v_recovery.provider_request_schema_version,
    v_recovery.provider_request_template_claims,
    v_recovery.provider_request_fingerprint,
    v_recovery.provider_request_expires_at
  );

  IF v_event.processing_locked_at <=
       clock_timestamp() - interval '10 minutes' THEN
    RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'sponsorship_payment_service',
    context_tool => 'read_payment_gateway_event_success_material',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Read sealed welcome material under gateway event lease',
    context_metadata => jsonb_build_object(
      'operation', 'read',
      'resource_kind', 'payment_gateway_event',
      'resource_id', v_event.id::text,
      'outcome', 'lease_verified'
    )
  );

  INSERT INTO public.sponsorship_secret_material_accesses (
    access_kind,
    gateway_event_id,
    payment_attempt_id,
    lease_attempt_count
  )
  VALUES (
    'gateway_success_material',
    v_event.id,
    v_attempt.id,
    v_event.processing_attempt_count
  );

  RETURN QUERY SELECT
    v_event.id,
    v_attempt.id,
    true,
    v_operation.operation_id,
    v_intent.id,
    v_recovery.payment_quote_id,
    v_event.provider,
    v_event.provider_account_scope,
    v_operation.provider_idempotency_key,
    v_recovery.provider_request_schema_version,
    v_recovery.provider_request_fingerprint,
    v_recovery.provider_request_expires_at,
    v_recovery.provider_request_ciphertext,
    v_recovery.provider_request_encryption_key_version,
    v_recovery.provider_request_ciphertext_sha256,
    v_intent.contact_email_hmac,
    v_intent.contact_email_normalization_version,
    v_intent.contact_email_hmac_key_version;
END;
$$;

REVOKE ALL ON FUNCTION public.read_payment_gateway_event_success_material(
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.read_payment_gateway_event_success_material(
  uuid,
  uuid,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.read_payment_gateway_event_success_material(
  uuid,
  uuid,
  text,
  text
) IS
  'Returns sealed server-owned checkout and email binding only when an actively leased typed Stripe success can create the sponsor welcome. Later successes return welcome_required false and no secret material. Plaintext sponsor identity and webhook payloads are never exposed.';

/*
 * Email delivery decrypts two independent envelopes. Before any provider send,
 * prove the recipient email maps to the outbox and account claim, and prove the
 * decrypted claim token maps to the same pending account claim. The plaintext
 * values never cross this boundary.
 */
CREATE OR REPLACE FUNCTION public.verify_email_outbox_delivery_material(
  target_outbox_id uuid,
  target_lease_token text,
  verified_recipient_email_hmac bytea,
  verified_claim_token_digest bytea,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  outbox_id uuid,
  account_claim_id uuid,
  verified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz;
  v_outbox public.email_outbox%ROWTYPE;
  v_claim public.sponsorship_account_claims%ROWTYPE;
  v_lease_digest bytea;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_outbox_id IS NULL
     OR target_lease_token IS NULL
     OR target_lease_token !~ '^[0-9a-f]{64}$'
     OR octet_length(verified_recipient_email_hmac) IS DISTINCT FROM 32
     OR octet_length(verified_claim_token_digest) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Email delivery material proof is malformed'
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
    RAISE EXCEPTION 'Email delivery material does not match the active outbox lease'
      USING ERRCODE = '55P03';
  END IF;

  IF v_outbox.kind <> 'sponsor_welcome'
     OR v_outbox.contact_redacted_at IS NOT NULL
     OR v_outbox.recipient_email_hmac IS DISTINCT FROM
       verified_recipient_email_hmac
     OR v_outbox.account_claim_id IS NULL THEN
    RAISE EXCEPTION 'Email delivery material does not match its outbox envelope'
      USING ERRCODE = '23514';
  END IF;

  SELECT claim.*
  INTO v_claim
  FROM public.sponsorship_account_claims claim
  WHERE claim.id = v_outbox.account_claim_id
  FOR SHARE;

  v_now := clock_timestamp();

  IF v_outbox.locked_at <= v_now - interval '10 minutes' THEN
    RAISE EXCEPTION 'Email delivery material does not match the active outbox lease'
      USING ERRCODE = '55P03';
  END IF;

  IF NOT FOUND
     OR v_claim.status <> 'pending'
     OR v_claim.expires_at <= v_now
     OR v_claim.revoked_at IS NOT NULL
     OR v_claim.email_hmac IS DISTINCT FROM verified_recipient_email_hmac
     OR v_claim.email_hmac IS DISTINCT FROM v_outbox.recipient_email_hmac
     OR v_claim.email_normalization_version IS DISTINCT FROM
       v_outbox.email_normalization_version
     OR v_claim.email_hmac_key_version IS DISTINCT FROM
       v_outbox.email_hmac_key_version
     OR v_claim.token_digest IS DISTINCT FROM verified_claim_token_digest THEN
    RAISE EXCEPTION 'Email delivery material does not match its pending account claim'
      USING ERRCODE = '23514';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => v_outbox.locked_by,
    context_tool => 'verify_email_outbox_delivery_material',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Verify decrypted welcome material before provider send',
    context_metadata => jsonb_build_object(
      'operation', 'verify',
      'resource_kind', 'email_outbox',
      'resource_id', v_outbox.id::text,
      'outcome', 'lease_and_claim_verified'
    )
  );

  INSERT INTO public.sponsorship_secret_material_accesses (
    access_kind,
    email_outbox_id,
    account_claim_id,
    lease_attempt_count
  )
  VALUES (
    'email_delivery_material_verification',
    v_outbox.id,
    v_claim.id,
    v_outbox.attempt_count
  );

  RETURN QUERY SELECT v_outbox.id, v_claim.id, true;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_email_outbox_delivery_material(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verify_email_outbox_delivery_material(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.verify_email_outbox_delivery_material(
  uuid,
  text,
  bytea,
  bytea,
  text,
  text
) IS
  'Lease-fenced pre-send proof that the decrypted recipient email and claim token match one active welcome outbox and pending account claim. Plaintext values are never accepted.';

/*
 * Preserve the existing delivery completion contract while requiring proof
 * that this exact lease completed the pre-send material verification above.
 */
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

  IF NOT EXISTS (
       SELECT 1
       FROM public.sponsorship_secret_material_accesses access
       WHERE access.access_kind = 'email_delivery_material_verification'
         AND access.email_outbox_id = v_outbox.id
         AND access.account_claim_id = v_outbox.account_claim_id
         AND access.lease_attempt_count = v_outbox.attempt_count
         AND access.accessed_at >= v_outbox.locked_at
         AND access.accessed_at <= v_now
     ) THEN
    RAISE EXCEPTION 'Email completion proof does not match a verified active delivery lease'
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
  WHERE outbox.id = complete_email_outbox_delivery.outbox_id
  RETURNING outbox.sent_at INTO v_sent_at;

  RETURN v_sent_at;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_email_outbox_delivery(
  uuid,
  text,
  bytea,
  text,
  uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_email_outbox_delivery(
  uuid,
  text,
  bytea,
  text,
  uuid
) TO service_role;

/*
 * Partnership payments are financially valid, but they do not own the
 * sponsor welcome contract. Patch the preceding explicit function generation
 * at one asserted source location so partnership success never requires a
 * welcome bundle and never consumes the identity-wide welcome dedupe key.
 */
DO $migration$
DECLARE
  v_definition text;
  v_patched_definition text;
  v_needle constant text := $needle$    IF v_is_initial_payment THEN
      PERFORM 1
      FROM public.sponsor_identities identity
$needle$;
  v_replacement constant text := $replacement$    IF v_is_initial_payment
       AND v_intent.subject_kind IN ('standard', 'blind') THEN
      PERFORM 1
      FROM public.sponsor_identities identity
$replacement$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.apply_sponsorship_payment_success(uuid,uuid,bytea,bytea,smallint,bytea,text,jsonb,text,text,text,text)'::regprocedure
  )
  INTO v_definition;

  IF v_definition IS NULL
     OR length(v_definition) - length(replace(v_definition, v_needle, ''))
       IS DISTINCT FROM length(v_needle) THEN
    RAISE EXCEPTION 'Atomic welcome eligibility patch source is not exact'
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

COMMENT ON FUNCTION public.apply_sponsorship_payment_success(
  uuid,
  uuid,
  bytea,
  bytea,
  smallint,
  bytea,
  text,
  jsonb,
  text,
  text,
  text,
  text
) IS
  'Lease-fenced atomic payment application. Standard and blind initial sponsorships may create one encrypted identity-wide welcome. Partnership success applies without welcome material and leaves that dedupe opportunity available for a later eligible sponsorship.';

COMMIT;
