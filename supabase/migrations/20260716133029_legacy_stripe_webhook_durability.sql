BEGIN;

/*
 * Retained Stripe checkouts and subscriptions created before server-owned
 * sponsorship intents still need the historical application handler. Their
 * signed events share the immutable gateway inbox, regional event identity,
 * encrypted evidence retention, leases, retry budget, and audit boundary used
 * by modern payments. The legacy verification marker is structurally unable
 * to carry a server intent chain or typed payment facts.
 */

ALTER TABLE public.payment_gateway_events
  ADD CONSTRAINT payment_gateway_events_legacy_stripe_shape_check CHECK (
    verification_method <> 'stripe_webhook_signature_legacy'
    OR (
      provider = 'STRIPE'
      AND provider_account_scope IN ('stripe_us', 'stripe_uk')
      AND event_type IN (
        'checkout.session.completed',
        'invoice.paid',
        'invoice.payment_succeeded',
        'invoice.payment_failed',
        'customer.subscription.updated',
        'customer.subscription.deleted'
      )
      AND payment_attempt_id IS NULL
      AND sponsorship_intent_id IS NULL
      AND original_financial_movement_id IS NULL
      AND fact_payment_status IS NULL
      AND fact_server_payment_attempt_id IS NULL
      AND fact_parent_provider_object_type IS NULL
      AND fact_parent_provider_object_id IS NULL
      AND fact_provider_movement_type IS NULL
      AND fact_provider_movement_id IS NULL
      AND fact_provider_customer_id IS NULL
      AND fact_provider_subscription_id IS NULL
      AND fact_base_amount_usd_cents IS NULL
      AND fact_charged_amount_minor IS NULL
      AND fact_charged_currency IS NULL
      AND fact_conversion_rate IS NULL
      AND fact_period_start IS NULL
      AND fact_period_end IS NULL
      AND fact_failure_code IS NULL
      AND fact_lifecycle_state IS NULL
      AND redacted_payload @> jsonb_build_object(
        'redaction_version', 'stripe_legacy_durable_v1',
        'provider', 'STRIPE',
        'source', 'verified_webhook',
        'processing_lane', 'legacy'
      )
      AND NOT (redacted_payload ? 'quarantine')
    )
  );

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
      effect IN ('checkout_expired', 'legacy_applied')
      AND financial_movement_id IS NULL
      AND subscription_id IS NULL
    )
    OR effect IN (
      'payment_failed',
      'subscription_lifecycle',
      'ignored'
    )
  );

CREATE OR REPLACE FUNCTION public.ingest_verified_legacy_stripe_gateway_event(
  target_provider_account_scope text,
  target_provider_event_id text,
  target_event_type text,
  target_provider_object_type text,
  target_provider_object_id text,
  target_redacted_payload jsonb,
  target_payload_ciphertext bytea,
  target_payload_sha256 bytea,
  target_signature_verified_at timestamptz,
  target_occurred_at timestamptz,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  processing_status public.gateway_event_processing_status,
  is_duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_provider_account_scope NOT IN ('stripe_us', 'stripe_uk') THEN
    RAISE EXCEPTION 'Legacy Stripe events require an exact regional account scope'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.validate_provider_event_type(
    'STRIPE',
    target_event_type,
    target_provider_object_type
  );

  IF target_event_type NOT IN (
       'checkout.session.completed',
       'invoice.paid',
       'invoice.payment_succeeded',
       'invoice.payment_failed',
       'customer.subscription.updated',
       'customer.subscription.deleted'
     ) THEN
    RAISE EXCEPTION 'Stripe event is not handled by the retained legacy application lane'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(target_redacted_payload) IS DISTINCT FROM 'object'
     OR pg_column_size(target_redacted_payload) > 65536
     OR target_redacted_payload IS DISTINCT FROM jsonb_strip_nulls(
       target_redacted_payload
     )
     OR NOT target_redacted_payload @> jsonb_build_object(
       'redaction_version', 'stripe_legacy_durable_v1',
       'provider', 'STRIPE',
       'source', 'verified_webhook',
       'processing_lane', 'legacy',
       'event_type', target_event_type,
       'provider_object_type', target_provider_object_type
     )
     OR target_redacted_payload ? 'quarantine' THEN
    RAISE EXCEPTION 'Legacy Stripe redacted evidence is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF target_payload_ciphertext IS NULL
     OR octet_length(target_payload_ciphertext) < 1
     OR octet_length(target_payload_ciphertext) > 1048576
     OR octet_length(target_payload_sha256) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Legacy Stripe encrypted evidence is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF target_signature_verified_at > clock_timestamp() + interval '5 minutes'
     OR target_signature_verified_at < target_occurred_at - interval '5 minutes'
     OR target_occurred_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Legacy Stripe verification or occurrence time is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        'STRIPE',
        target_provider_account_scope,
        target_provider_event_id
      )::text,
      0
    )
  );

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.provider = 'STRIPE'
    AND gateway_event.provider_account_scope = target_provider_account_scope
    AND gateway_event.provider_event_id = target_provider_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_event.verification_method IS DISTINCT FROM 'stripe_webhook_signature_legacy'
       OR v_event.event_type IS DISTINCT FROM target_event_type
       OR v_event.provider_object_type IS DISTINCT FROM target_provider_object_type
       OR v_event.provider_object_id IS DISTINCT FROM target_provider_object_id
       OR v_event.payload_sha256 IS DISTINCT FROM target_payload_sha256
       OR v_event.occurred_at IS DISTINCT FROM target_occurred_at
       OR v_event.payment_attempt_id IS NOT NULL
       OR v_event.sponsorship_intent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Provider event identifier was replayed with different evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT v_event.id, v_event.processing_status, true;
    RETURN;
  END IF;

  PERFORM private.set_payment_audit_context(
    'ingest_verified_legacy_stripe_gateway_event',
    'STRIPE',
    target_provider_account_scope,
    target_event_type,
    target_provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  INSERT INTO public.payment_gateway_events (
    provider,
    provider_account_scope,
    provider_event_id,
    event_type,
    provider_object_type,
    provider_object_id,
    redacted_payload,
    payload_ciphertext,
    payload_sha256,
    signature_verified_at,
    occurred_at,
    verification_method
  )
  VALUES (
    'STRIPE',
    target_provider_account_scope,
    target_provider_event_id,
    target_event_type,
    target_provider_object_type,
    target_provider_object_id,
    target_redacted_payload,
    target_payload_ciphertext,
    target_payload_sha256,
    target_signature_verified_at,
    target_occurred_at,
    'stripe_webhook_signature_legacy'
  )
  RETURNING * INTO v_event;

  RETURN QUERY SELECT v_event.id, v_event.processing_status, false;
END;
$$;

DROP FUNCTION public.claim_payment_gateway_events(text, integer, text, text);

CREATE FUNCTION public.claim_payment_gateway_events(
  target_worker_id text,
  target_batch_size integer DEFAULT 20,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  processing_lease_token uuid,
  provider public.sponsorship_method,
  provider_account_scope text,
  provider_event_id text,
  event_type text,
  provider_object_type text,
  provider_object_id text,
  sponsorship_intent_id uuid,
  payment_attempt_id uuid,
  verification_method text,
  occurred_at timestamptz,
  processing_attempt_count smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  PERFORM private.require_payment_service_role();

  IF nullif(btrim(target_worker_id), '') IS NULL
     OR length(target_worker_id) > 140 THEN
    RAISE EXCEPTION 'Gateway worker identifier must contain 1 to 140 characters'
      USING ERRCODE = '22023';
  END IF;

  IF target_batch_size IS NULL
     OR target_batch_size < 1
     OR target_batch_size > 100 THEN
    RAISE EXCEPTION 'Gateway claim batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  PERFORM private.set_payment_audit_context(
    'claim_payment_gateway_events',
    'STRIPE',
    'worker_batch',
    NULL,
    NULL,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  RETURN QUERY
  WITH candidates AS (
    SELECT
      gateway_event.id,
      gen_random_uuid() AS lease_token
    FROM public.payment_gateway_events gateway_event
    WHERE gateway_event.processing_attempt_count < gateway_event.max_processing_attempts
      AND (
        (
          gateway_event.processing_status IN ('received', 'failed')
          AND gateway_event.available_at <= clock_timestamp()
        )
        OR (
          gateway_event.processing_status = 'processing'
          AND gateway_event.processing_locked_at <= clock_timestamp() - interval '10 minutes'
        )
      )
    ORDER BY gateway_event.available_at, gateway_event.received_at, gateway_event.id
    LIMIT target_batch_size
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.payment_gateway_events gateway_event
    SET
      processing_status = 'processing',
      processing_locked_by = left(target_worker_id, 140) || ':' || candidates.lease_token::text,
      processing_lease_token = candidates.lease_token
    FROM candidates
    WHERE gateway_event.id = candidates.id
    RETURNING gateway_event.*
  )
  SELECT
    claimed.id,
    claimed.processing_lease_token,
    claimed.provider,
    claimed.provider_account_scope,
    claimed.provider_event_id,
    claimed.event_type,
    claimed.provider_object_type,
    claimed.provider_object_id,
    claimed.sponsorship_intent_id,
    claimed.payment_attempt_id,
    claimed.verification_method,
    claimed.occurred_at,
    claimed.processing_attempt_count
  FROM claimed
  ORDER BY claimed.available_at, claimed.received_at, claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_legacy_stripe_gateway_event_payload(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  provider_account_scope text,
  provider_event_id text,
  event_type text,
  payload_ciphertext bytea,
  payload_sha256 bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR SHARE;

  IF NOT FOUND
     OR v_event.provider IS DISTINCT FROM 'STRIPE'
     OR v_event.verification_method IS DISTINCT FROM 'stripe_webhook_signature_legacy'
     OR v_event.processing_status IS DISTINCT FROM 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM target_processing_lease_token
     OR v_event.payload_ciphertext IS NULL THEN
    RAISE EXCEPTION 'Legacy Stripe event payload requires its exact active lease'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM private.set_payment_audit_context(
    'read_legacy_stripe_gateway_event_payload',
    'STRIPE',
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  RETURN QUERY SELECT
    v_event.id,
    v_event.provider_account_scope,
    v_event.provider_event_id,
    v_event.event_type,
    v_event.payload_ciphertext,
    v_event.payload_sha256;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_legacy_stripe_gateway_event(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  processing_status public.gateway_event_processing_status,
  application_effect public.gateway_event_application_effect
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_event.provider IS DISTINCT FROM 'STRIPE'
     OR v_event.verification_method IS DISTINCT FROM 'stripe_webhook_signature_legacy'
     OR v_event.processing_status IS DISTINCT FROM 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM target_processing_lease_token THEN
    RAISE EXCEPTION 'Legacy Stripe event completion requires its exact active lease'
      USING ERRCODE = '55P03';
  END IF;

  PERFORM private.set_payment_audit_context(
    'complete_legacy_stripe_gateway_event',
    'STRIPE',
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    NULL,
    NULL
  );

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    summary
  )
  VALUES (
    v_event.id,
    'legacy_applied',
    jsonb_build_object(
      'processing_lane', 'legacy',
      'event_type', v_event.event_type
    )
  );

  UPDATE public.payment_gateway_events gateway_event
  SET
    processing_status = 'processed',
    processing_lease_token = NULL
  WHERE gateway_event.id = v_event.id
  RETURNING * INTO v_event;

  RETURN QUERY SELECT
    v_event.id,
    v_event.processing_status,
    'legacy_applied'::public.gateway_event_application_effect;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_verified_legacy_stripe_gateway_event(
  text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_payment_gateway_events(
  text, integer, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_legacy_stripe_gateway_event_payload(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_legacy_stripe_gateway_event(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.ingest_verified_legacy_stripe_gateway_event(
  text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_payment_gateway_events(
  text, integer, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_legacy_stripe_gateway_event_payload(
  uuid, uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_legacy_stripe_gateway_event(
  uuid, uuid, text, text
) TO service_role;

COMMENT ON CONSTRAINT payment_gateway_events_legacy_stripe_shape_check
  ON public.payment_gateway_events IS
  'The retained Stripe application lane can carry encrypted signed evidence, but never a server intent link or typed payment facts.';
COMMENT ON FUNCTION public.ingest_verified_legacy_stripe_gateway_event(
  text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, text, text, text
) IS
  'Durably captures one region-scoped signed Stripe event for the retained pre-intent application handler. Exact redelivery is idempotent and conflicting evidence fails closed.';
COMMENT ON FUNCTION public.claim_payment_gateway_events(
  text, integer, text, text
) IS
  'Claims typed or retained legacy gateway events without returning encrypted payloads. The verification method is the only application lane discriminator.';
COMMENT ON FUNCTION public.read_legacy_stripe_gateway_event_payload(
  uuid, uuid, text, text
) IS
  'Releases encrypted legacy Stripe evidence only to the exact active worker lease.';
COMMENT ON FUNCTION public.complete_legacy_stripe_gateway_event(
  uuid, uuid, text, text
) IS
  'Atomically records retained legacy application and settles the exact worker lease.';

COMMIT;
