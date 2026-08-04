/*
 * Checkout provider request envelopes contain the normalized sponsor email.
 * Financial and provider evidence is retained, but the reversible contact
 * envelope is erased after durable settlement plus any applicable welcome,
 * or after exact terminal no-payment evidence.
 */
BEGIN;

DO $$ BEGIN
  CREATE TYPE public.sponsorship_checkout_contact_erasure_reason AS ENUM (
    'settled_welcome_materialized',
    'settled_welcome_not_applicable',
    'settled_refund_required',
    'gateway_terminal_failure',
    'provider_terminal_failure',
    'provider_terminal_cancelled',
    'gateway_terminal_expired',
    'provider_terminal_expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.payment_gateway_event_applications
  DROP CONSTRAINT payment_gateway_event_applications_effect_check,
  ADD CONSTRAINT payment_gateway_event_applications_effect_check CHECK (
    (
      effect = 'payment_succeeded'
      AND financial_movement_id IS NOT NULL
    )
    OR (
      effect = 'duplicate_movement'
      AND financial_movement_id IS NOT NULL
    )
    OR (
      effect = 'refund_required'
      AND financial_movement_id IS NOT NULL
      AND subscription_id IS NULL
    )
    OR (
      effect IN (
        'refund_applied',
        'reversal_applied',
        'dispute_debit_applied',
        'dispute_credit_applied'
      )
      AND financial_movement_id IS NOT NULL
      AND subscription_id IS NULL
    )
    OR (
      effect = 'checkout_expired'
      AND financial_movement_id IS NULL
      AND subscription_id IS NULL
    )
    OR effect IN (
      'payment_failed',
      'subscription_lifecycle',
      'ignored'
    )
  );

ALTER TABLE public.sponsorship_checkout_recovery_states
  DROP CONSTRAINT sponsorship_checkout_recovery_states_request_check,
  ALTER COLUMN provider_request_ciphertext DROP NOT NULL,
  ALTER COLUMN provider_request_encryption_key_version DROP NOT NULL,
  ALTER COLUMN provider_request_ciphertext_sha256 DROP NOT NULL,
  ADD COLUMN provider_request_contact_erased_at timestamptz,
  ADD COLUMN provider_request_contact_erasure_reason
    public.sponsorship_checkout_contact_erasure_reason,
  ADD CONSTRAINT sponsorship_checkout_recovery_states_request_check CHECK (
    provider_request_schema_version = 1
    AND jsonb_typeof(provider_request_template_claims) = 'object'
    AND pg_column_size(provider_request_template_claims) <= 8192
    AND octet_length(provider_request_fingerprint) = 32
    AND provider_request_expires_at > created_at
    AND provider_request_expires_at <= created_at + interval '24 hours'
  ),
  ADD CONSTRAINT sponsorship_checkout_recovery_states_contact_shape_check CHECK (
    (
      provider_request_contact_erased_at IS NULL
      AND provider_request_contact_erasure_reason IS NULL
      AND provider_request_ciphertext IS NOT NULL
      AND octet_length(provider_request_ciphertext) BETWEEN 32 AND 65536
      AND provider_request_encryption_key_version IS NOT NULL
      AND provider_request_encryption_key_version BETWEEN 1 AND 32767
      AND provider_request_ciphertext_sha256 IS NOT NULL
      AND octet_length(provider_request_ciphertext_sha256) = 32
      AND provider_request_ciphertext_sha256 = extensions.digest(
        provider_request_ciphertext,
        'sha256'
      )
    )
    OR (
      provider_request_contact_erased_at IS NOT NULL
      AND provider_request_contact_erasure_reason IS NOT NULL
      AND provider_request_ciphertext IS NULL
      AND provider_request_encryption_key_version IS NULL
      AND provider_request_ciphertext_sha256 IS NULL
      AND status = 'closed'
      AND finalized_at IS NOT NULL
      AND provider_request_contact_erased_at >= finalized_at
    )
  );

CREATE INDEX sponsorship_checkout_recovery_contact_erasure_idx
  ON public.sponsorship_checkout_recovery_states (
    finalized_at,
    payment_attempt_id
  )
  WHERE status = 'closed'
    AND provider_request_contact_erased_at IS NULL;

/*
 * Stripe expiration is typed separately from general financial event facts.
 * This preserves the existing rule that an expiration carries no movement,
 * while durably proving the exact signed expired and unpaid state.
 */
CREATE TABLE public.sponsorship_checkout_expiration_facts (
  gateway_event_id uuid PRIMARY KEY
    REFERENCES public.payment_gateway_events(id) ON DELETE RESTRICT,
  payment_attempt_id uuid NOT NULL
    REFERENCES public.sponsorship_payment_attempts(id) ON DELETE RESTRICT,
  checkout_status text NOT NULL,
  payment_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_checkout_expiration_facts_status_check CHECK (
    checkout_status = 'expired'
    AND payment_status = 'unpaid'
  ),
  CONSTRAINT sponsorship_checkout_expiration_facts_event_attempt_unique
    UNIQUE (gateway_event_id, payment_attempt_id)
);

CREATE OR REPLACE FUNCTION private.protect_checkout_expiration_fact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Checkout expiration facts are append-only'
      USING ERRCODE = '42501';
  END IF;

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = NEW.gateway_event_id
  FOR SHARE;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = NEW.payment_attempt_id
  FOR SHARE;

  IF v_event.id IS NULL
     OR v_attempt.id IS NULL
     OR v_event.provider <> 'STRIPE'
     OR v_event.event_type <> 'checkout.session.expired'
     OR v_event.provider_object_type <> 'checkout_session'
     OR v_event.provider_object_id IS DISTINCT FROM
       v_attempt.provider_object_id
     OR v_attempt.provider_object_type <> 'checkout_session'
     OR v_event.payment_attempt_id IS DISTINCT FROM v_attempt.id
     OR v_event.sponsorship_intent_id IS DISTINCT FROM
       v_attempt.sponsorship_intent_id
     OR v_event.provider_account_scope IS DISTINCT FROM
       v_attempt.provider_account_scope
     OR v_event.verification_method <> 'stripe_webhook_signature'
     OR v_event.signature_verified_at IS NULL
     OR NEW.checkout_status <> 'expired'
     OR NEW.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Checkout expiration fact does not match exact signed provider evidence'
      USING ERRCODE = '23514';
  END IF;

  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsorship_checkout_expiration_facts_protect
BEFORE INSERT OR UPDATE OR DELETE
ON public.sponsorship_checkout_expiration_facts
FOR EACH ROW EXECUTE FUNCTION private.protect_checkout_expiration_fact();

CREATE TRIGGER sponsorship_checkout_expiration_facts_no_truncate
BEFORE TRUNCATE ON public.sponsorship_checkout_expiration_facts
FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_audited_table_truncate();

CREATE TRIGGER sponsorship_checkout_expiration_facts_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.sponsorship_checkout_expiration_facts
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change('', '@columns_only');

ALTER TABLE public.sponsorship_checkout_expiration_facts
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsorship_checkout_expiration_facts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ingest_verified_stripe_checkout_expiration(
  target_payment_attempt_id uuid,
  target_provider_account_scope text,
  target_provider_event_id text,
  target_provider_object_id text,
  target_redacted_payload jsonb,
  target_payload_ciphertext bytea,
  target_payload_sha256 bytea,
  target_signature_verified_at timestamptz,
  target_occurred_at timestamptz,
  target_verification_method text,
  target_checkout_status text,
  target_payment_status text,
  target_fact_server_payment_attempt_id uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  sponsorship_intent_id uuid,
  payment_attempt_id uuid,
  processing_status public.gateway_event_processing_status,
  is_duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_result record;
  v_fact public.sponsorship_checkout_expiration_facts%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_checkout_status IS DISTINCT FROM 'expired'
     OR target_payment_status IS DISTINCT FROM 'unpaid'
     OR target_fact_server_payment_attempt_id IS DISTINCT FROM
       target_payment_attempt_id
     OR target_verification_method IS DISTINCT FROM
       'stripe_webhook_signature' THEN
    RAISE EXCEPTION 'Stripe Checkout expiration requires exact signed expired and unpaid facts'
      USING ERRCODE = '22023';
  END IF;

  SELECT ingested.*
  INTO STRICT v_result
  FROM public.ingest_verified_payment_gateway_event(
    target_payment_attempt_id => target_payment_attempt_id,
    target_provider => 'STRIPE',
    target_provider_account_scope => target_provider_account_scope,
    target_provider_event_id => target_provider_event_id,
    target_event_type => 'checkout.session.expired',
    target_provider_object_type => 'checkout_session',
    target_provider_object_id => target_provider_object_id,
    target_redacted_payload => target_redacted_payload,
    target_payload_ciphertext => target_payload_ciphertext,
    target_payload_sha256 => target_payload_sha256,
    target_signature_verified_at => target_signature_verified_at,
    target_occurred_at => target_occurred_at,
    target_verification_method => target_verification_method,
    target_fact_payment_status => NULL,
    target_fact_server_payment_attempt_id => NULL,
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_client_ip => context_client_ip,
    context_user_agent => context_user_agent
  ) ingested;

  INSERT INTO public.sponsorship_checkout_expiration_facts (
    gateway_event_id,
    payment_attempt_id,
    checkout_status,
    payment_status
  )
  VALUES (
    v_result.gateway_event_id,
    target_payment_attempt_id,
    target_checkout_status,
    target_payment_status
  )
  ON CONFLICT (gateway_event_id) DO NOTHING
  RETURNING * INTO v_fact;

  IF v_fact.gateway_event_id IS NULL THEN
    SELECT fact.*
    INTO STRICT v_fact
    FROM public.sponsorship_checkout_expiration_facts fact
    WHERE fact.gateway_event_id = v_result.gateway_event_id;

    IF v_fact.payment_attempt_id IS DISTINCT FROM
         target_payment_attempt_id
       OR v_fact.checkout_status IS DISTINCT FROM target_checkout_status
       OR v_fact.payment_status IS DISTINCT FROM target_payment_status THEN
      RAISE EXCEPTION 'Stripe Checkout expiration was replayed with different typed facts'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_result.gateway_event_id,
    v_result.sponsorship_intent_id,
    v_result.payment_attempt_id,
    v_result.processing_status,
    v_result.is_duplicate;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_verified_stripe_checkout_expiration(
  uuid,
  text,
  text,
  text,
  jsonb,
  bytea,
  bytea,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_verified_stripe_checkout_expiration(
  uuid,
  text,
  text,
  text,
  jsonb,
  bytea,
  bytea,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_sponsorship_checkout_expiration(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  application_effect public.gateway_event_application_effect
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_application public.payment_gateway_event_applications%ROWTYPE;
  v_fact public.sponsorship_checkout_expiration_facts%ROWTYPE;
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT application.*
  INTO v_application
  FROM public.payment_gateway_event_applications application
  WHERE application.gateway_event_id = v_event.id;

  IF FOUND THEN
    IF v_application.effect <> 'checkout_expired' THEN
      RAISE EXCEPTION 'Gateway event already has a conflicting application'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_event.id,
      v_event.payment_attempt_id,
      v_event.sponsorship_intent_id,
      v_application.effect;
    RETURN;
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

  SELECT fact.*
  INTO v_fact
  FROM public.sponsorship_checkout_expiration_facts fact
  WHERE fact.gateway_event_id = v_event.id;

  IF v_fact.gateway_event_id IS NULL
     OR v_event.provider <> 'STRIPE'
     OR v_event.event_type <> 'checkout.session.expired'
     OR v_event.provider_object_type <> 'checkout_session'
     OR v_event.verification_method <> 'stripe_webhook_signature'
     OR v_event.signature_verified_at IS NULL
     OR v_event.payment_attempt_id IS NULL
     OR v_event.sponsorship_intent_id IS NULL
     OR v_fact.payment_attempt_id IS DISTINCT FROM
       v_event.payment_attempt_id
     OR v_fact.checkout_status <> 'expired'
     OR v_fact.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Gateway event is not an exact signed Stripe Checkout expiration'
      USING ERRCODE = '23514';
  END IF;

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
  FOR UPDATE;

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = v_attempt.id
  FOR UPDATE;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_attempt.sponsorship_intent_id
  FOR UPDATE;

  IF v_operation.operation_id IS NULL
     OR v_attempt.id IS NULL
     OR v_recovery.payment_attempt_id IS NULL
     OR v_intent.id IS NULL
     OR v_attempt.status <> 'pending'
     OR v_intent.status <> 'processing'
     OR v_recovery.status = 'closed'
     OR v_attempt.sponsorship_intent_id IS DISTINCT FROM v_event.sponsorship_intent_id
     OR v_attempt.provider <> 'STRIPE'
     OR v_attempt.provider_account_scope IS DISTINCT FROM
       v_event.provider_account_scope
     OR v_attempt.provider_object_type <> 'checkout_session'
     OR v_attempt.provider_object_id IS DISTINCT FROM
       v_event.provider_object_id
     OR v_recovery.checkout_operation_id IS DISTINCT FROM
       v_operation.operation_id
     OR v_recovery.sponsorship_intent_id IS DISTINCT FROM v_intent.id
     OR v_operation.sponsorship_intent_id IS DISTINCT FROM v_intent.id
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_financial_movements movement
       WHERE movement.sponsorship_intent_id = v_intent.id
          OR movement.payment_attempt_id = v_attempt.id
     ) THEN
    RAISE EXCEPTION 'Stripe Checkout expiration does not match one active no-payment chain'
      USING ERRCODE = '23514';
  END IF;

  PERFORM private.set_payment_audit_context(
    'apply_sponsorship_checkout_expiration',
    v_event.provider,
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  UPDATE public.sponsorship_payment_attempts attempt
  SET status = 'expired'
  WHERE attempt.id = v_attempt.id;

  UPDATE public.sponsorship_intents intent
  SET status = 'failed'
  WHERE intent.id = v_intent.id;

  IF EXISTS (
    SELECT 1
    FROM public.sponsorship_checkout_reservations reservation
    WHERE reservation.payment_attempt_id = v_attempt.id
      AND reservation.status = 'active'
  ) THEN
    PERFORM public.release_sponsorship_checkout_reservation(
      v_attempt.id,
      'expired',
      v_event.signature_verified_at,
      v_event.payload_sha256,
      'Signed Stripe Checkout Session is expired and unpaid',
      context_request_id,
      context_trace_id
    );
  END IF;

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    summary
  )
  VALUES (
    v_event.id,
    'checkout_expired',
    jsonb_build_object(
      'provider', v_event.provider::text,
      'provider_account_scope', v_event.provider_account_scope,
      'event_type', v_event.event_type,
      'operation', 'checkout_expired'
    )
  )
  RETURNING * INTO v_application;

  UPDATE public.payment_gateway_events gateway_event
  SET
    processing_status = 'processed',
    processing_lease_token = NULL
  WHERE gateway_event.id = v_event.id;

  RETURN QUERY SELECT
    v_event.id,
    v_attempt.id,
    v_intent.id,
    v_application.effect;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_sponsorship_checkout_expiration(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sponsorship_checkout_expiration(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

/*
 * A Stripe invoice failure is retryable. Preserve the active initial checkout
 * so a later paid invoice can still settle it and materialize the welcome.
 * Renewal failures on an already successful attempt continue through the
 * original lifecycle implementation.
 */
ALTER FUNCTION public.apply_sponsorship_payment_failure(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) RENAME TO apply_sponsorship_payment_failure_pre_contact_erasure;

REVOKE ALL ON FUNCTION public.apply_sponsorship_payment_failure_pre_contact_erasure(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_sponsorship_payment_failure(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  subscription_id uuid,
  application_effect public.gateway_event_application_effect
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_application public.payment_gateway_event_applications%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id;

  IF v_event.id IS NOT NULL
     AND v_event.event_type = 'checkout.session.async_payment_failed'
     AND v_event.fact_payment_status IS DISTINCT FROM 'unpaid' THEN
    RAISE EXCEPTION 'Asynchronous Checkout failure requires exact unpaid status'
      USING ERRCODE = '23514';
  END IF;

  IF v_event.id IS NULL OR v_event.event_type <> 'invoice.payment_failed' THEN
    RETURN QUERY
    SELECT legacy.*
    FROM public.apply_sponsorship_payment_failure_pre_contact_erasure(
      target_gateway_event_id,
      target_processing_lease_token,
      context_request_id,
      context_trace_id,
      context_client_ip,
      context_user_agent
    ) legacy;
    RETURN;
  END IF;

  SELECT gateway_event.*
  INTO STRICT v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  SELECT application.*
  INTO v_application
  FROM public.payment_gateway_event_applications application
  WHERE application.gateway_event_id = v_event.id;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_event.id,
      v_event.payment_attempt_id,
      v_event.sponsorship_intent_id,
      v_application.subscription_id,
      v_application.effect;
    RETURN;
  END IF;

  IF v_event.processing_status <> 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM
       target_processing_lease_token THEN
    RAISE EXCEPTION 'Gateway event processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = v_event.payment_attempt_id
    AND attempt.sponsorship_intent_id = v_event.sponsorship_intent_id
    AND attempt.provider = v_event.provider
    AND attempt.provider_account_scope = v_event.provider_account_scope
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway event payment chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.status <> 'pending' THEN
    RETURN QUERY
    SELECT legacy.*
    FROM public.apply_sponsorship_payment_failure_pre_contact_erasure(
      target_gateway_event_id,
      target_processing_lease_token,
      context_request_id,
      context_trace_id,
      context_client_ip,
      context_user_agent
    ) legacy;
    RETURN;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_attempt.sponsorship_intent_id
  FOR UPDATE;

  IF v_event.provider <> 'STRIPE'
     OR v_event.provider_object_type <> 'invoice'
     OR v_event.fact_failure_code IS NULL
     OR v_event.fact_server_payment_attempt_id IS DISTINCT FROM v_attempt.id
     OR v_attempt.payment_mode <> 'recurring'
     OR v_intent.status <> 'processing'
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_financial_movements movement
       WHERE movement.sponsorship_intent_id = v_intent.id
          OR movement.payment_attempt_id = v_attempt.id
     ) THEN
    RAISE EXCEPTION 'Retryable invoice failure does not match one active initial checkout'
      USING ERRCODE = '23514';
  END IF;

  PERFORM private.set_payment_audit_context(
    'apply_sponsorship_payment_failure',
    v_event.provider,
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    summary
  )
  VALUES (
    v_event.id,
    'payment_failed',
    jsonb_build_object(
      'provider', v_event.provider::text,
      'provider_account_scope', v_event.provider_account_scope,
      'event_type', v_event.event_type,
      'operation', 'retryable_invoice_payment_failed'
    )
  )
  RETURNING * INTO v_application;

  UPDATE public.payment_gateway_events gateway_event
  SET
    processing_status = 'processed',
    processing_lease_token = NULL
  WHERE gateway_event.id = v_event.id;

  RETURN QUERY SELECT
    v_event.id,
    v_attempt.id,
    v_intent.id,
    NULL::uuid,
    v_application.effect;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_sponsorship_payment_failure(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sponsorship_payment_failure(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

/*
 * A terminal attempt cannot create the first sponsor welcome. Do not reopen
 * sponsor contact material for a contradictory late success. The application
 * boundary remains responsible for rejecting or settling that conflict.
 */
ALTER FUNCTION public.read_payment_gateway_event_success_material(
  uuid,
  uuid,
  text,
  text
) RENAME TO read_payment_gateway_event_success_material_pre_contact_erasure;

REVOKE ALL ON FUNCTION public.read_payment_gateway_event_success_material_pre_contact_erasure(
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

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
BEGIN
  PERFORM private.require_payment_service_role();

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

  IF v_event.provider <> 'STRIPE'
     OR v_event.event_type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded',
       'invoice.paid',
       'invoice.payment_succeeded'
     )
     OR (
       v_event.event_type IN (
         'checkout.session.completed',
         'checkout.session.async_payment_succeeded'
       )
       AND v_event.provider_object_type IS DISTINCT FROM 'checkout_session'
     )
     OR (
       v_event.event_type IN (
         'invoice.paid',
         'invoice.payment_succeeded'
       )
       AND v_event.provider_object_type IS DISTINCT FROM 'invoice'
     )
     OR v_event.fact_payment_status IS DISTINCT FROM 'paid'
     OR v_event.payment_attempt_id IS NULL
     OR v_event.sponsorship_intent_id IS NULL
     OR v_event.fact_server_payment_attempt_id IS DISTINCT FROM
       v_event.payment_attempt_id THEN
    RAISE EXCEPTION 'Gateway event is not a typed Stripe payment success'
      USING ERRCODE = '23514';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = v_event.payment_attempt_id
    AND attempt.sponsorship_intent_id = v_event.sponsorship_intent_id
    AND attempt.provider = v_event.provider
    AND attempt.provider_account_scope = v_event.provider_account_scope
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gateway success does not match one payment chain'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.status IN ('failed', 'cancelled', 'expired') THEN
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

  RETURN QUERY
  SELECT material.*
  FROM public.read_payment_gateway_event_success_material_pre_contact_erasure(
    target_gateway_event_id,
    target_processing_lease_token,
    context_request_id,
    context_trace_id
  ) material;
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

CREATE OR REPLACE FUNCTION private.require_gateway_secret_access_for_welcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claim public.sponsorship_account_claims%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' OR NEW.kind <> 'sponsor_welcome' THEN
    RETURN NEW;
  END IF;

  SELECT claim.*
  INTO v_claim
  FROM public.sponsorship_account_claims claim
  WHERE claim.id = NEW.account_claim_id
  FOR SHARE;

  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'Sponsor welcome does not match one account claim'
      USING ERRCODE = '23514';
  END IF;

  /*
   * Legacy payment attempts have no server-owned provider request envelope.
   * Their existing welcome boundary remains unchanged. Every v2 checkout with
   * reversible contact material must prove the exact gateway lease access.
   */
  IF NOT EXISTS (
    SELECT 1
    FROM public.sponsorship_payment_attempts attempt
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = attempt.id
    WHERE attempt.sponsorship_intent_id = v_claim.sponsorship_intent_id
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.sponsorship_secret_material_accesses access
       JOIN public.payment_gateway_events gateway_event
         ON gateway_event.id = access.gateway_event_id
       JOIN public.sponsorship_payment_attempts attempt
         ON attempt.id = access.payment_attempt_id
       WHERE access.access_kind = 'gateway_success_material'
         AND attempt.sponsorship_intent_id = v_claim.sponsorship_intent_id
         AND gateway_event.payment_attempt_id = attempt.id
         AND gateway_event.sponsorship_intent_id =
           v_claim.sponsorship_intent_id
         AND gateway_event.processing_status = 'processing'
         AND gateway_event.processing_lease_token IS NOT NULL
         AND access.lease_attempt_count =
           gateway_event.processing_attempt_count
         AND access.accessed_at >= gateway_event.processing_locked_at
         AND gateway_event.event_type IN (
           'checkout.session.completed',
           'checkout.session.async_payment_succeeded',
           'invoice.paid',
           'invoice.payment_succeeded'
         )
         AND gateway_event.fact_payment_status = 'paid'
     ) THEN
    RAISE EXCEPTION 'First sponsor welcome requires sealed material access under the active success lease'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER email_outbox_gateway_secret_access
BEFORE INSERT ON public.email_outbox
FOR EACH ROW EXECUTE FUNCTION private.require_gateway_secret_access_for_welcome();

REVOKE ALL ON FUNCTION private.require_gateway_secret_access_for_welcome()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.checkout_contact_erasure_reason(
  target_payment_attempt_id uuid
)
RETURNS public.sponsorship_checkout_contact_erasure_reason
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_source_effect public.gateway_event_application_effect;
  v_source_gateway_event_id uuid;
  v_movement_id uuid;
  v_has_movement boolean;
BEGIN
  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.payment_attempt_id = target_payment_attempt_id;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = target_payment_attempt_id;

  IF v_recovery.payment_attempt_id IS NULL
     OR v_attempt.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_attempt.sponsorship_intent_id;

  IF v_intent.id IS NULL
     OR v_recovery.status <> 'closed'
     OR v_recovery.finalized_at IS NULL
     OR v_recovery.provider_request_contact_erased_at IS NOT NULL
     OR v_recovery.provider_request_contact_erasure_reason IS NOT NULL
     OR v_recovery.provider_request_ciphertext IS NULL
     OR v_recovery.provider_request_encryption_key_version IS NULL
     OR v_recovery.provider_request_ciphertext_sha256 IS NULL
     OR EXISTS (
       SELECT 1
       FROM public.sponsorship_checkout_reservations reservation
       WHERE reservation.payment_attempt_id = v_attempt.id
         AND reservation.status = 'active'
     )
     OR EXISTS (
       SELECT 1
       FROM public.payment_gateway_events gateway_event
       WHERE gateway_event.payment_attempt_id = v_attempt.id
         AND gateway_event.processing_status = 'processing'
     ) THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.sponsorship_financial_movements movement
    WHERE movement.sponsorship_intent_id = v_intent.id
       OR movement.payment_attempt_id = v_attempt.id
  )
  INTO v_has_movement;

  IF v_attempt.status = 'succeeded' THEN
    IF v_recovery.final_outcome <> 'attempt_terminal'
       OR NOT v_has_movement THEN
      RETURN NULL;
    END IF;

    SELECT
      application.effect,
      movement.source_gateway_event_id,
      movement.id
    INTO
      v_source_effect,
      v_source_gateway_event_id,
      v_movement_id
    FROM public.sponsorship_financial_movements movement
    JOIN public.payment_gateway_event_applications application
      ON application.gateway_event_id = movement.source_gateway_event_id
     AND application.financial_movement_id = movement.id
    JOIN public.payment_gateway_events gateway_event
      ON gateway_event.id = movement.source_gateway_event_id
    WHERE movement.payment_attempt_id = v_attempt.id
      AND movement.sponsorship_intent_id = v_intent.id
      AND movement.entry_kind = 'sponsorship_payment'
      AND gateway_event.processing_status = 'processed'
      AND application.effect IN ('payment_succeeded', 'refund_required')
    ORDER BY movement.occurred_at, movement.id
    LIMIT 1;

    IF v_source_effect = 'refund_required' AND EXISTS (
      SELECT 1
      FROM public.sponsorship_refund_requirements requirement
      WHERE requirement.financial_movement_id = v_movement_id
        AND requirement.source_gateway_event_id =
          v_source_gateway_event_id
        AND requirement.payment_attempt_id = v_attempt.id
        AND requirement.sponsorship_intent_id = v_intent.id
    ) THEN
      RETURN 'settled_refund_required';
    END IF;

    IF v_source_effect = 'payment_succeeded'
       AND v_intent.subject_kind = 'partnership' THEN
      RETURN 'settled_welcome_not_applicable';
    END IF;

    IF v_source_effect = 'payment_succeeded' AND EXISTS (
      SELECT 1
      FROM public.email_outbox email
      JOIN public.sponsorship_account_claims claim
        ON claim.id = email.account_claim_id
      WHERE email.kind = 'sponsor_welcome'
        AND email.sponsor_identity_id = v_intent.sponsor_identity_id
        AND claim.sponsor_identity_id = v_intent.sponsor_identity_id
        AND email.dedupe_key =
          'sponsor_welcome:' || v_intent.sponsor_identity_id::text
        AND (
          claim.sponsorship_intent_id <> v_intent.id
          OR EXISTS (
            SELECT 1
            FROM public.sponsorship_secret_material_accesses access
            JOIN public.payment_gateway_events gateway_event
              ON gateway_event.id = access.gateway_event_id
            JOIN public.payment_gateway_event_applications application
              ON application.gateway_event_id = gateway_event.id
            WHERE access.access_kind = 'gateway_success_material'
              AND access.gateway_event_id = v_source_gateway_event_id
              AND access.payment_attempt_id = v_attempt.id
              AND access.lease_attempt_count =
                gateway_event.processing_attempt_count
              AND access.accessed_at <= application.applied_at
              AND application.effect = 'payment_succeeded'
              AND application.financial_movement_id = v_movement_id
          )
        )
    ) THEN
      RETURN 'settled_welcome_materialized';
    END IF;

    RETURN NULL;
  END IF;

  IF v_has_movement THEN
    RETURN NULL;
  END IF;

  IF v_attempt.status = 'failed' THEN
    IF v_recovery.final_outcome = 'provider_terminal'
       AND v_recovery.provider_terminal_status = 'failed'
       AND v_recovery.provider_reconciled_at IS NOT NULL
       AND octet_length(v_recovery.reconciliation_evidence_sha256) = 32
       AND v_recovery.reconciliation_evidence_ciphertext IS NOT NULL
       AND v_recovery.reconciliation_evidence_encryption_key_version
         IS NOT NULL THEN
      RETURN 'provider_terminal_failure';
    END IF;

    /*
     * A declined one-time PayPal capture proves that this checkout never moved
     * money. Subscription failures belong to post-settlement servicing and do
     * not qualify through this no-payment path.
     */
    IF v_recovery.final_outcome = 'attempt_terminal' AND EXISTS (
      SELECT 1
      FROM public.payment_gateway_events gateway_event
      JOIN public.payment_gateway_event_applications application
        ON application.gateway_event_id = gateway_event.id
      WHERE gateway_event.payment_attempt_id = v_attempt.id
        AND gateway_event.sponsorship_intent_id = v_intent.id
        AND gateway_event.fact_server_payment_attempt_id = v_attempt.id
        AND gateway_event.signature_verified_at IS NOT NULL
        AND gateway_event.processing_status = 'processed'
        AND gateway_event.processing_lease_token IS NULL
        AND application.effect = 'payment_failed'
        AND application.financial_movement_id IS NULL
        AND application.subscription_id IS NULL
        AND application.applied_at IS NOT NULL
        AND (
          (
            v_attempt.provider = 'STRIPE'
            AND gateway_event.provider = 'STRIPE'
            AND gateway_event.event_type =
              'checkout.session.async_payment_failed'
            AND gateway_event.provider_object_type = 'checkout_session'
            AND gateway_event.provider_object_id =
              v_attempt.provider_object_id
            AND gateway_event.fact_payment_status = 'unpaid'
            AND gateway_event.fact_failure_code IS NOT NULL
          )
          OR (
            v_attempt.provider = 'PAYPAL'
            AND v_attempt.provider_account_scope = 'paypal'
            AND v_attempt.payment_mode = 'one_time'
            AND v_attempt.provider_object_type = 'order'
            AND v_attempt.provider_object_id ~ '^[A-Z0-9]{10,64}$'
            AND v_attempt.failure_code = 'paypal_capture_declined'
            AND v_intent.status = 'failed'
            AND gateway_event.provider = 'PAYPAL'
            AND gateway_event.provider_account_scope = 'paypal'
            AND gateway_event.provider_event_id ~
              '^WH-[A-Z0-9-]{8,252}$'
            AND gateway_event.event_type = 'PAYMENT.CAPTURE.DECLINED'
            AND gateway_event.provider_object_type = 'capture'
            AND gateway_event.provider_object_id ~ '^[A-Z0-9]{10,64}$'
            AND gateway_event.original_financial_movement_id IS NULL
            AND gateway_event.fact_parent_provider_object_type = 'order'
            AND gateway_event.fact_parent_provider_object_id =
              v_attempt.provider_object_id
            AND gateway_event.fact_payment_status IS NULL
            AND gateway_event.fact_provider_movement_type IS NULL
            AND gateway_event.fact_provider_movement_id IS NULL
            AND gateway_event.fact_base_amount_usd_cents IS NULL
            AND gateway_event.fact_charged_amount_minor IS NULL
            AND gateway_event.fact_charged_currency IS NULL
            AND gateway_event.fact_conversion_rate IS NULL
            AND gateway_event.fact_provider_customer_id IS NULL
            AND gateway_event.fact_provider_subscription_id IS NULL
            AND gateway_event.fact_period_start IS NULL
            AND gateway_event.fact_period_end IS NULL
            AND gateway_event.fact_lifecycle_state IS NULL
            AND gateway_event.fact_failure_code =
              'paypal_capture_declined'
            AND gateway_event.verification_method =
              'paypal_webhook_signature_api'
            AND gateway_event.payload_ciphertext IS NOT NULL
            AND octet_length(gateway_event.payload_sha256) = 32
            AND application.summary = jsonb_build_object(
              'provider', 'PAYPAL',
              'provider_account_scope', 'paypal',
              'event_type', 'PAYMENT.CAPTURE.DECLINED',
              'outcome', 'payment_failed'
            )
          )
        )
    ) THEN
      RETURN 'gateway_terminal_failure';
    END IF;

    RETURN NULL;
  END IF;

  IF v_attempt.status = 'cancelled' THEN
    IF v_recovery.final_outcome = 'provider_terminal'
       AND v_recovery.provider_terminal_status IN ('cancelled', 'voided')
       AND v_recovery.provider_reconciled_at IS NOT NULL
       AND octet_length(v_recovery.reconciliation_evidence_sha256) = 32
       AND v_recovery.reconciliation_evidence_ciphertext IS NOT NULL
       AND v_recovery.reconciliation_evidence_encryption_key_version
         IS NOT NULL THEN
      RETURN 'provider_terminal_cancelled';
    END IF;

    RETURN NULL;
  END IF;

  IF v_attempt.status = 'expired' THEN
    IF v_recovery.final_outcome = 'provider_terminal'
       AND v_recovery.provider_terminal_status = 'expired'
       AND v_recovery.provider_reconciled_at IS NOT NULL
       AND octet_length(v_recovery.reconciliation_evidence_sha256) = 32
       AND v_recovery.reconciliation_evidence_ciphertext IS NOT NULL
       AND v_recovery.reconciliation_evidence_encryption_key_version
         IS NOT NULL THEN
      RETURN 'provider_terminal_expired';
    END IF;

    IF v_recovery.final_outcome = 'attempt_terminal' AND EXISTS (
      SELECT 1
      FROM public.payment_gateway_events gateway_event
      JOIN public.sponsorship_checkout_expiration_facts fact
        ON fact.gateway_event_id = gateway_event.id
      JOIN public.payment_gateway_event_applications application
        ON application.gateway_event_id = gateway_event.id
      WHERE gateway_event.payment_attempt_id = v_attempt.id
        AND gateway_event.sponsorship_intent_id = v_intent.id
        AND gateway_event.provider = 'STRIPE'
        AND gateway_event.event_type = 'checkout.session.expired'
        AND gateway_event.provider_object_type = 'checkout_session'
        AND gateway_event.provider_object_id = v_attempt.provider_object_id
        AND gateway_event.signature_verified_at IS NOT NULL
        AND gateway_event.processing_status = 'processed'
        AND fact.payment_attempt_id = v_attempt.id
        AND fact.checkout_status = 'expired'
        AND fact.payment_status = 'unpaid'
        AND application.effect = 'checkout_expired'
    ) THEN
      RETURN 'gateway_terminal_expired';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.checkout_contact_erasure_reason(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.protect_checkout_contact_erasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_reason public.sponsorship_checkout_contact_erasure_reason;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR pg_catalog.current_setting(
       'app.checkout_recovery.lifecycle_operation',
       true
     ) IS DISTINCT FROM 'erase_contact' THEN
    RAISE EXCEPTION 'Checkout contact erasure requires the narrow retention lifecycle'
      USING ERRCODE = '42501';
  END IF;

  v_reason := private.checkout_contact_erasure_reason(
    OLD.payment_attempt_id
  );

  IF v_reason IS NULL
     OR OLD.status <> 'closed'
     OR OLD.provider_request_contact_erased_at IS NOT NULL
     OR OLD.provider_request_contact_erasure_reason IS NOT NULL
     OR OLD.provider_request_ciphertext IS NULL
     OR OLD.provider_request_encryption_key_version IS NULL
     OR OLD.provider_request_ciphertext_sha256 IS NULL
     OR NEW.provider_request_ciphertext IS NOT NULL
     OR NEW.provider_request_encryption_key_version IS NOT NULL
     OR NEW.provider_request_ciphertext_sha256 IS NOT NULL
     OR NEW.provider_request_contact_erased_at IS NOT NULL
     OR NEW.provider_request_contact_erasure_reason IS DISTINCT FROM v_reason
     OR (
       to_jsonb(NEW) - ARRAY[
         'provider_request_ciphertext',
         'provider_request_encryption_key_version',
         'provider_request_ciphertext_sha256',
         'provider_request_contact_erased_at',
         'provider_request_contact_erasure_reason',
         'updated_at'
       ]::text[]
     ) IS DISTINCT FROM (
       to_jsonb(OLD) - ARRAY[
         'provider_request_ciphertext',
         'provider_request_encryption_key_version',
         'provider_request_ciphertext_sha256',
         'provider_request_contact_erased_at',
         'provider_request_contact_erasure_reason',
         'updated_at'
       ]::text[]
     ) THEN
    RAISE EXCEPTION 'Checkout contact envelope is not eligible for exact erasure'
      USING ERRCODE = '23514';
  END IF;

  NEW.provider_request_contact_erased_at := v_now;
  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

DROP TRIGGER sponsorship_checkout_recovery_states_protect
  ON public.sponsorship_checkout_recovery_states;

CREATE TRIGGER sponsorship_checkout_recovery_states_protect
BEFORE INSERT OR DELETE ON public.sponsorship_checkout_recovery_states
FOR EACH ROW EXECUTE FUNCTION private.protect_sponsorship_checkout_recovery_state();

CREATE TRIGGER sponsorship_checkout_recovery_states_protect_update
BEFORE UPDATE ON public.sponsorship_checkout_recovery_states
FOR EACH ROW
WHEN (
  COALESCE(
    pg_catalog.current_setting(
      'app.checkout_recovery.lifecycle_operation',
      true
    ),
    ''
  ) <> 'erase_contact'
)
EXECUTE FUNCTION private.protect_sponsorship_checkout_recovery_state();

CREATE TRIGGER sponsorship_checkout_recovery_states_erase_contact
BEFORE UPDATE ON public.sponsorship_checkout_recovery_states
FOR EACH ROW
WHEN (
  pg_catalog.current_setting(
    'app.checkout_recovery.lifecycle_operation',
    true
  ) = 'erase_contact'
)
EXECUTE FUNCTION private.protect_checkout_contact_erasure();

REVOKE ALL ON FUNCTION private.protect_checkout_contact_erasure()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purge_sponsorship_checkout_contact_envelopes(
  target_batch_size integer DEFAULT 100,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  erased_count bigint,
  succeeded_count bigint,
  failed_count bigint,
  cancelled_count bigint,
  expired_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_previous_lifecycle_operation text := COALESCE(
    pg_catalog.current_setting(
      'app.checkout_recovery.lifecycle_operation',
      true
    ),
    ''
  );
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_batch_size IS NULL
     OR target_batch_size NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Checkout contact erasure batch size must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'system'::audit.audit_actor_type,
    context_system_actor => 'retention-worker',
    context_tool => 'checkout-contact-erasure',
    context_request_id => context_request_id,
    context_trace_id => context_trace_id,
    context_reason => 'Erase terminal checkout sponsor contact envelope',
    context_metadata => jsonb_build_object(
      'operation', 'redact',
      'resource_kind', 'sponsorship_checkout_contact_envelope',
      'outcome', 'eligible_terminal_or_materialized'
    )
  );
  PERFORM pg_catalog.set_config(
    'app.checkout_recovery.lifecycle_operation',
    'erase_contact',
    true
  );

  RETURN QUERY
  WITH candidate_ids AS MATERIALIZED (
    SELECT
      recovery.checkout_operation_id,
      recovery.payment_attempt_id,
      recovery.finalized_at
    FROM public.sponsorship_checkout_recovery_states recovery
    WHERE recovery.status = 'closed'
      AND recovery.provider_request_contact_erased_at IS NULL
      AND private.checkout_contact_erasure_reason(
        recovery.payment_attempt_id
      ) IS NOT NULL
    ORDER BY recovery.finalized_at, recovery.payment_attempt_id
    LIMIT target_batch_size * 4
  ), locked_operations AS MATERIALIZED (
    SELECT
      candidate.checkout_operation_id,
      candidate.payment_attempt_id,
      candidate.finalized_at
    FROM candidate_ids candidate
    JOIN public.sponsorship_checkout_operations operation
      ON operation.operation_id = candidate.checkout_operation_id
    ORDER BY candidate.finalized_at, candidate.payment_attempt_id
    LIMIT target_batch_size
    FOR UPDATE OF operation SKIP LOCKED
  ), locked_attempts AS MATERIALIZED (
    SELECT locked_operation.*
    FROM locked_operations locked_operation
    JOIN public.sponsorship_payment_attempts attempt
      ON attempt.id = locked_operation.payment_attempt_id
    ORDER BY
      locked_operation.finalized_at,
      locked_operation.payment_attempt_id
    FOR UPDATE OF attempt SKIP LOCKED
  ), locked_recoveries AS MATERIALIZED (
    SELECT locked_attempt.*
    FROM locked_attempts locked_attempt
    JOIN public.sponsorship_checkout_recovery_states recovery
      ON recovery.payment_attempt_id = locked_attempt.payment_attempt_id
    WHERE private.checkout_contact_erasure_reason(
      recovery.payment_attempt_id
    ) IS NOT NULL
    ORDER BY
      locked_attempt.finalized_at,
      locked_attempt.payment_attempt_id
    FOR UPDATE OF recovery SKIP LOCKED
  ), erased AS (
    UPDATE public.sponsorship_checkout_recovery_states recovery
    SET
      provider_request_ciphertext = NULL,
      provider_request_encryption_key_version = NULL,
      provider_request_ciphertext_sha256 = NULL,
      provider_request_contact_erasure_reason =
        private.checkout_contact_erasure_reason(
          recovery.payment_attempt_id
        )
    FROM locked_recoveries locked_recovery
    WHERE recovery.payment_attempt_id =
      locked_recovery.payment_attempt_id
    RETURNING recovery.provider_request_contact_erasure_reason AS reason
  )
  SELECT
    count(*)::bigint,
    count(*) FILTER (
      WHERE erased.reason IN (
        'settled_welcome_materialized',
        'settled_welcome_not_applicable',
        'settled_refund_required'
      )
    )::bigint,
    count(*) FILTER (
      WHERE erased.reason IN (
        'gateway_terminal_failure',
        'provider_terminal_failure'
      )
    )::bigint,
    count(*) FILTER (
      WHERE erased.reason = 'provider_terminal_cancelled'
    )::bigint,
    count(*) FILTER (
      WHERE erased.reason IN (
        'gateway_terminal_expired',
        'provider_terminal_expired'
      )
    )::bigint
  FROM erased;

  PERFORM pg_catalog.set_config(
    'app.checkout_recovery.lifecycle_operation',
    v_previous_lifecycle_operation,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_sponsorship_checkout_contact_envelopes(
  integer,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_sponsorship_checkout_contact_envelopes(
  integer,
  text,
  text
) TO service_role;

/*
 * Exact terminal replays retain their typed request evidence but cannot
 * compare ciphertext after erasure. New and live operations still execute the
 * original v2 boundary unchanged.
 */
ALTER FUNCTION public.begin_sponsorship_payment_v2(
  uuid,
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  smallint,
  jsonb,
  bytea,
  timestamptz,
  bytea,
  smallint,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) RENAME TO begin_sponsorship_payment_v2_pre_contact_erasure;

REVOKE ALL ON FUNCTION public.begin_sponsorship_payment_v2_pre_contact_erasure(
  uuid,
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  smallint,
  jsonb,
  bytea,
  timestamptz,
  bytea,
  smallint,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_sponsorship_payment_v2(
  target_checkout_operation_id uuid,
  target_sponsorship_intent_id uuid,
  target_payment_quote_id uuid,
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_idempotency_key text,
  target_checkout_receipt_digest bytea,
  target_provider_request_schema_version smallint,
  target_provider_request_template_claims jsonb,
  target_provider_request_fingerprint bytea,
  target_provider_request_expires_at timestamptz,
  target_provider_request_ciphertext bytea,
  target_provider_request_encryption_key_version smallint,
  target_provider_request_ciphertext_sha256 bytea,
  target_checkout_receipt_valid_for interval DEFAULT interval '24 hours',
  target_metadata jsonb DEFAULT '{}'::jsonb,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  checkout_operation_id uuid,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  attempt_number smallint,
  provider public.sponsorship_method,
  provider_account_scope text,
  status public.sponsorship_payment_attempt_status,
  payment_mode public.sponsorship_payment_mode,
  base_amount_usd_cents bigint,
  charged_amount_minor bigint,
  charged_currency public.payment_currency,
  conversion_rate numeric,
  currency_quote_at timestamptz,
  provider_request_expires_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_erased_at timestamptz;
  v_operation public.sponsorship_checkout_operations%ROWTYPE;
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_quote public.sponsorship_payment_quotes%ROWTYPE;
  v_recovery public.sponsorship_checkout_recovery_states%ROWTYPE;
  v_expected_metadata jsonb;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT recovery.provider_request_contact_erased_at
  INTO v_erased_at
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.checkout_operation_id = target_checkout_operation_id;

  IF v_erased_at IS NULL THEN
    BEGIN
      RETURN QUERY
      SELECT original.*
      FROM public.begin_sponsorship_payment_v2_pre_contact_erasure(
        target_checkout_operation_id,
        target_sponsorship_intent_id,
        target_payment_quote_id,
        target_provider,
        target_provider_account_scope,
        target_provider_idempotency_key,
        target_checkout_receipt_digest,
        target_provider_request_schema_version,
        target_provider_request_template_claims,
        target_provider_request_fingerprint,
        target_provider_request_expires_at,
        target_provider_request_ciphertext,
        target_provider_request_encryption_key_version,
        target_provider_request_ciphertext_sha256,
        target_checkout_receipt_valid_for,
        target_metadata,
        context_request_id,
        context_trace_id,
        context_client_ip,
        context_user_agent
      ) original;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      SELECT recovery.provider_request_contact_erased_at
      INTO v_erased_at
      FROM public.sponsorship_checkout_recovery_states recovery
      WHERE recovery.checkout_operation_id = target_checkout_operation_id;

      IF v_erased_at IS NULL THEN
        RAISE;
      END IF;
    END;
  END IF;

  IF target_checkout_operation_id IS NULL
     OR octet_length(target_checkout_receipt_digest) IS DISTINCT FROM 32
     OR target_checkout_receipt_valid_for IS NULL
     OR target_checkout_receipt_valid_for < interval '5 minutes'
     OR target_checkout_receipt_valid_for > interval '7 days'
     OR jsonb_typeof(target_metadata) IS DISTINCT FROM 'object'
     OR pg_column_size(target_metadata) > 4096
     OR target_provider_request_schema_version IS DISTINCT FROM 1
     OR jsonb_typeof(target_provider_request_template_claims)
       IS DISTINCT FROM 'object'
     OR pg_column_size(target_provider_request_template_claims) > 8192
     OR octet_length(target_provider_request_fingerprint) IS DISTINCT FROM 32
     OR target_provider_request_expires_at IS NULL
     OR target_provider_request_ciphertext IS NULL
     OR octet_length(target_provider_request_ciphertext)
       NOT BETWEEN 32 AND 65536
     OR target_provider_request_encryption_key_version IS NULL
     OR target_provider_request_encryption_key_version
       NOT BETWEEN 1 AND 32767
     OR octet_length(target_provider_request_ciphertext_sha256)
       IS DISTINCT FROM 32
     OR target_provider_request_ciphertext_sha256 IS DISTINCT FROM
       extensions.digest(target_provider_request_ciphertext, 'sha256') THEN
    RAISE EXCEPTION 'Erased provider checkout replay evidence is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.sponsorship_checkout_operations operation
  WHERE operation.operation_id = target_checkout_operation_id
  FOR UPDATE;

  IF v_operation.operation_id IS NULL
     OR v_operation.checkout_boundary_version <> 2
     OR v_operation.sponsorship_intent_id IS DISTINCT FROM
       target_sponsorship_intent_id
     OR v_operation.checkout_receipt_digest IS DISTINCT FROM
       target_checkout_receipt_digest
     OR v_operation.provider IS DISTINCT FROM target_provider
     OR v_operation.provider_account_scope IS DISTINCT FROM
       target_provider_account_scope
     OR v_operation.provider_idempotency_key IS DISTINCT FROM
       target_provider_idempotency_key THEN
    RAISE EXCEPTION 'Erased payment replay conflicts with immutable checkout operation evidence'
      USING ERRCODE = '23505';
  END IF;

  SELECT quote.*
  INTO v_quote
  FROM public.sponsorship_payment_quotes quote
  WHERE quote.id = target_payment_quote_id
    AND quote.sponsorship_intent_id = v_operation.sponsorship_intent_id
    AND quote.provider = v_operation.provider
    AND quote.provider_account_scope = v_operation.provider_account_scope
    AND quote.quote_idempotency_key =
      'quote:' || v_operation.operation_id::text
  FOR SHARE;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Erased payment replay quote does not match its checkout operation'
      USING ERRCODE = '23505';
  END IF;

  PERFORM private.validate_provider_request_template_v2(
    v_operation.operation_id,
    v_operation.sponsorship_intent_id,
    v_quote.id,
    target_provider_request_schema_version,
    target_provider_request_template_claims,
    target_provider_request_fingerprint,
    target_provider_request_expires_at
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        target_provider::text,
        target_provider_account_scope,
        target_provider_idempotency_key
      )::text,
      0
    )
  );

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.provider = target_provider
    AND attempt.provider_account_scope = target_provider_account_scope
    AND attempt.provider_idempotency_key = target_provider_idempotency_key
  FOR UPDATE;

  SELECT recovery.*
  INTO v_recovery
  FROM public.sponsorship_checkout_recovery_states recovery
  WHERE recovery.checkout_operation_id = v_operation.operation_id
    AND recovery.payment_attempt_id = v_attempt.id
  FOR UPDATE;

  v_expected_metadata := target_metadata || pg_catalog.jsonb_build_object(
    'checkout_boundary_version', 2,
    'checkout_operation_id', v_operation.operation_id
  );

  IF v_attempt.id IS NULL
     OR v_recovery.payment_attempt_id IS NULL
     OR v_attempt.status NOT IN ('succeeded', 'failed', 'cancelled', 'expired')
     OR v_recovery.status <> 'closed'
     OR v_recovery.provider_request_contact_erased_at IS NULL
     OR v_recovery.provider_request_contact_erasure_reason IS NULL
     OR v_recovery.provider_request_ciphertext IS NOT NULL
     OR v_recovery.provider_request_encryption_key_version IS NOT NULL
     OR v_recovery.provider_request_ciphertext_sha256 IS NOT NULL
     OR v_attempt.sponsorship_intent_id IS DISTINCT FROM
       v_operation.sponsorship_intent_id
     OR v_attempt.payment_quote_id IS DISTINCT FROM v_quote.id
     OR v_attempt.checkout_receipt_digest IS DISTINCT FROM
       v_operation.checkout_receipt_digest
     OR v_attempt.metadata IS DISTINCT FROM v_expected_metadata
     OR v_recovery.provider_request_schema_version IS DISTINCT FROM
       target_provider_request_schema_version
     OR v_recovery.provider_request_template_claims IS DISTINCT FROM
       target_provider_request_template_claims
     OR v_recovery.provider_request_fingerprint IS DISTINCT FROM
       target_provider_request_fingerprint
     OR v_recovery.provider_request_expires_at IS DISTINCT FROM
       target_provider_request_expires_at THEN
    RAISE EXCEPTION 'Erased payment replay changed immutable noncontact evidence'
      USING ERRCODE = '23505';
  END IF;

  RETURN QUERY SELECT
    v_operation.operation_id,
    v_attempt.id,
    v_attempt.sponsorship_intent_id,
    v_attempt.attempt_number,
    v_attempt.provider,
    v_attempt.provider_account_scope,
    v_attempt.status,
    v_attempt.payment_mode,
    v_attempt.base_amount_usd_cents,
    v_attempt.charged_amount_minor,
    v_attempt.charged_currency,
    v_attempt.conversion_rate,
    v_attempt.currency_quote_at,
    v_recovery.provider_request_expires_at,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_sponsorship_payment_v2(
  uuid,
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  smallint,
  jsonb,
  bytea,
  timestamptz,
  bytea,
  smallint,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_sponsorship_payment_v2(
  uuid,
  uuid,
  uuid,
  public.sponsorship_method,
  text,
  text,
  bytea,
  smallint,
  jsonb,
  bytea,
  timestamptz,
  bytea,
  smallint,
  bytea,
  interval,
  jsonb,
  text,
  text,
  text,
  text
) TO service_role;

COMMIT;
