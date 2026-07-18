BEGIN;

ALTER TABLE public.payment_gateway_events
  DROP CONSTRAINT payment_gateway_events_financial_adjustment_link_check,
  ADD CONSTRAINT payment_gateway_events_financial_adjustment_link_check CHECK (
    (
      event_type IN (
        'refund.created',
        'refund.updated',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated',
        'PAYMENT.CAPTURE.REFUNDED',
        'PAYMENT.CAPTURE.REVERSED',
        'PAYMENT.SALE.REFUNDED',
        'PAYMENT.SALE.REVERSED'
      )
      AND (
        (
          original_financial_movement_id IS NOT NULL
          AND payment_attempt_id IS NOT NULL
          AND sponsorship_intent_id IS NOT NULL
          AND fact_server_payment_attempt_id IS NOT NULL
          AND fact_parent_provider_object_type IS NOT NULL
          AND fact_parent_provider_object_id IS NOT NULL
          AND fact_provider_movement_type IS NOT NULL
          AND fact_provider_movement_id IS NOT NULL
          AND fact_base_amount_usd_cents IS NOT NULL
          AND fact_charged_amount_minor IS NOT NULL
          AND fact_charged_currency IS NOT NULL
          AND fact_conversion_rate IS NOT NULL
          AND fact_payment_status IS NULL
          AND fact_provider_customer_id IS NULL
          AND fact_provider_subscription_id IS NULL
          AND fact_period_start IS NULL
          AND fact_period_end IS NULL
          AND fact_failure_code IS NULL
          AND fact_lifecycle_state IS NULL
        )
        OR (
          original_financial_movement_id IS NULL
          AND payment_attempt_id IS NULL
          AND sponsorship_intent_id IS NULL
          AND fact_server_payment_attempt_id IS NULL
          AND fact_parent_provider_object_type IS NULL
          AND fact_parent_provider_object_id IS NULL
          AND fact_provider_movement_type IS NULL
          AND fact_provider_movement_id IS NULL
          AND fact_base_amount_usd_cents IS NULL
          AND fact_charged_amount_minor IS NULL
          AND fact_charged_currency IS NULL
          AND fact_conversion_rate IS NULL
          AND fact_payment_status IS NULL
          AND fact_provider_customer_id IS NULL
          AND fact_provider_subscription_id IS NULL
          AND fact_period_start IS NULL
          AND fact_period_end IS NULL
          AND fact_failure_code IS NULL
          AND fact_lifecycle_state IS NULL
          AND (
            redacted_payload @> '{"quarantine": true}'::jsonb
            OR (
              provider = 'STRIPE'
              AND event_type IN ('refund.created', 'refund.updated')
              AND provider_object_type = 'refund'
              AND redacted_payload @>
                '{"provider_event_disposition": "no_financial_effect"}'::jsonb
              AND redacted_payload ->> 'provider_state' IN (
                'pending',
                'requires_action',
                'failed',
                'canceled'
              )
              AND NOT (redacted_payload ? 'quarantine')
              AND NOT (
                redacted_payload ? 'requires_operational_review'
              )
            )
          )
        )
      )
    )
    OR (
      event_type NOT IN (
        'refund.created',
        'refund.updated',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated',
        'PAYMENT.CAPTURE.REFUNDED',
        'PAYMENT.CAPTURE.REVERSED',
        'PAYMENT.SALE.REFUNDED',
        'PAYMENT.SALE.REVERSED'
      )
      AND original_financial_movement_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.ingest_verified_payment_gateway_event_no_effect(
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_event_id text,
  target_event_type text,
  target_provider_object_type text,
  target_provider_object_id text,
  target_provider_state text,
  target_redacted_payload jsonb,
  target_payload_ciphertext bytea,
  target_payload_sha256 bytea,
  target_signature_verified_at timestamptz,
  target_occurred_at timestamptz,
  target_verification_method text,
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
  v_lease_token uuid;
  v_ignored_reason text;
  v_redacted_payload jsonb;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_provider IS NULL
     OR target_provider_account_scope IS NULL
     OR target_provider_account_scope IS DISTINCT FROM
       lower(btrim(target_provider_account_scope))
     OR length(target_provider_account_scope) NOT BETWEEN 1 AND 120
     OR target_provider_event_id IS NULL
     OR target_provider_event_id IS DISTINCT FROM btrim(target_provider_event_id)
     OR length(target_provider_event_id) NOT BETWEEN 1 AND 255
     OR target_event_type IS NULL
     OR target_event_type IS DISTINCT FROM btrim(target_event_type)
     OR length(target_event_type) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'No-effect provider identifiers are malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_provider_object_type IS NULL
     OR target_provider_object_id IS NULL
     OR target_provider_object_type IS DISTINCT FROM
       lower(btrim(target_provider_object_type))
     OR length(target_provider_object_type) NOT BETWEEN 1 AND 80
     OR target_provider_object_id IS DISTINCT FROM
       btrim(target_provider_object_id)
     OR length(target_provider_object_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'No-effect provider object is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_provider_state IS NULL
     OR target_provider_state IS DISTINCT FROM
       lower(btrim(target_provider_state))
     OR length(target_provider_state) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'No-effect provider state is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (
    target_provider = 'STRIPE'
    AND target_provider_account_scope IN ('stripe_us', 'stripe_uk')
    AND target_provider_event_id ~ '^evt_[A-Za-z0-9_]+$'
    AND target_event_type IN ('refund.created', 'refund.updated')
    AND target_provider_object_type = 'refund'
    AND target_provider_object_id ~ '^re_[A-Za-z0-9_]+$'
    AND target_provider_state IN (
      'pending',
      'requires_action',
      'failed',
      'canceled'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported no-effect provider event disposition'
      USING ERRCODE = '22023';
  END IF;

  IF target_redacted_payload IS NULL
     OR jsonb_typeof(target_redacted_payload) IS DISTINCT FROM 'object'
     OR target_redacted_payload ?| ARRAY[
       'provider_event_disposition',
       'provider_state',
       'quarantine',
       'requires_operational_review',
       'sponsorship_intent_id',
       'payment_attempt_id',
       'sponsor_identity_id',
       'original_financial_movement_id',
       'fact_server_payment_attempt_id',
       'fact_parent_provider_object_type',
       'fact_parent_provider_object_id',
       'fact_provider_movement_type',
       'fact_provider_movement_id',
       'fact_provider_customer_id',
       'fact_provider_subscription_id',
       'fact_base_amount_usd_cents',
       'fact_charged_amount_minor',
       'fact_charged_currency',
       'fact_conversion_rate',
       'fact_period_start',
       'fact_period_end'
     ] THEN
    RAISE EXCEPTION 'No-effect redacted evidence contains reserved facts'
      USING ERRCODE = '22023';
  END IF;

  v_redacted_payload := target_redacted_payload || jsonb_build_object(
    'provider', target_provider::text,
    'source', 'verified_webhook',
    'event_type', target_event_type,
    'provider_object_type', target_provider_object_type,
    'provider_event_disposition', 'no_financial_effect',
    'provider_state', target_provider_state
  );

  IF pg_column_size(v_redacted_payload) > 65536
     OR target_payload_ciphertext IS NULL
     OR octet_length(target_payload_ciphertext) NOT BETWEEN 1 AND 1048576
     OR target_payload_sha256 IS NULL
     OR octet_length(target_payload_sha256) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'No-effect provider evidence is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_signature_verified_at IS NULL
     OR target_occurred_at IS NULL
     OR target_signature_verified_at > clock_timestamp() + interval '5 minutes'
     OR target_occurred_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'No-effect provider event time is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF target_verification_method IS NULL
     OR target_verification_method <> 'stripe_webhook_signature' THEN
    RAISE EXCEPTION 'No-effect verification method does not match provider'
      USING ERRCODE = '22023';
  END IF;

  v_ignored_reason := left(
    'no_financial_effect:' || target_provider_state ||
      ': signed provider event has no current financial effect',
    1000
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        target_provider::text,
        target_provider_account_scope,
        target_provider_event_id
      )::text,
      0
    )
  );

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.provider = target_provider
    AND gateway_event.provider_account_scope = target_provider_account_scope
    AND gateway_event.provider_event_id = target_provider_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_event.event_type IS DISTINCT FROM target_event_type
       OR v_event.provider_object_type IS DISTINCT FROM
         target_provider_object_type
       OR v_event.provider_object_id IS DISTINCT FROM target_provider_object_id
       OR v_event.payload_sha256 IS DISTINCT FROM target_payload_sha256
       OR v_event.occurred_at IS DISTINCT FROM target_occurred_at
       OR v_event.verification_method IS DISTINCT FROM
         target_verification_method
       OR v_event.redacted_payload ->> 'provider_event_disposition'
         IS DISTINCT FROM 'no_financial_effect'
       OR v_event.redacted_payload ->> 'provider_state'
         IS DISTINCT FROM target_provider_state
       OR (
         v_event.redacted_payload - ARRAY[
           'delivery_payload_sha256',
           'stripe_signature',
           'webhook_secret_version'
         ]::text[]
       ) IS DISTINCT FROM (
         v_redacted_payload - ARRAY[
           'delivery_payload_sha256',
           'stripe_signature',
           'webhook_secret_version'
         ]::text[]
       )
       OR v_event.redacted_payload ? 'quarantine'
       OR v_event.redacted_payload ? 'requires_operational_review'
       OR v_event.processing_status IS DISTINCT FROM 'ignored'
       OR v_event.ignored_reason IS DISTINCT FROM v_ignored_reason
       OR v_event.sponsorship_intent_id IS NOT NULL
       OR v_event.payment_attempt_id IS NOT NULL
       OR v_event.original_financial_movement_id IS NOT NULL
       OR v_event.fact_payment_status IS NOT NULL
       OR v_event.fact_server_payment_attempt_id IS NOT NULL
       OR v_event.fact_parent_provider_object_type IS NOT NULL
       OR v_event.fact_parent_provider_object_id IS NOT NULL
       OR v_event.fact_provider_movement_type IS NOT NULL
       OR v_event.fact_provider_movement_id IS NOT NULL
       OR v_event.fact_provider_customer_id IS NOT NULL
       OR v_event.fact_provider_subscription_id IS NOT NULL
       OR v_event.fact_base_amount_usd_cents IS NOT NULL
       OR v_event.fact_charged_amount_minor IS NOT NULL
       OR v_event.fact_charged_currency IS NOT NULL
       OR v_event.fact_conversion_rate IS NOT NULL
       OR v_event.fact_period_start IS NOT NULL
       OR v_event.fact_period_end IS NOT NULL
       OR v_event.fact_failure_code IS NOT NULL
       OR v_event.fact_lifecycle_state IS NOT NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.payment_gateway_event_applications application
         WHERE application.gateway_event_id = v_event.id
           AND application.effect = 'ignored'
       ) THEN
      RAISE EXCEPTION 'Verified provider event identifier conflicts with durable no-effect evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT v_event.id, v_event.processing_status, true;
    RETURN;
  END IF;

  PERFORM private.set_payment_audit_context(
    'ingest_verified_payment_gateway_event_no_effect',
    target_provider,
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
    target_provider,
    target_provider_account_scope,
    target_provider_event_id,
    target_event_type,
    target_provider_object_type,
    target_provider_object_id,
    v_redacted_payload,
    target_payload_ciphertext,
    target_payload_sha256,
    target_signature_verified_at,
    target_occurred_at,
    target_verification_method
  )
  RETURNING * INTO v_event;

  v_lease_token := gen_random_uuid();
  UPDATE public.payment_gateway_events
  SET
    processing_status = 'processing',
    processing_locked_by =
      'verified-event-no-effect:' || v_lease_token::text,
    processing_lease_token = v_lease_token
  WHERE id = v_event.id;

  SELECT *
  INTO v_event
  FROM public.ignore_sponsorship_payment_gateway_event(
    v_event.id,
    v_lease_token,
    v_ignored_reason,
    context_request_id,
    context_trace_id
  );

  RETURN QUERY SELECT v_event.id, v_event.processing_status, false;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_verified_payment_gateway_event_no_effect(
  public.sponsorship_method,
  text,
  text,
  text,
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
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_verified_payment_gateway_event_no_effect(
  public.sponsorship_method,
  text,
  text,
  text,
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
  text,
  text
) TO service_role;

COMMENT ON CONSTRAINT payment_gateway_events_financial_adjustment_link_check
  ON public.payment_gateway_events IS
  'Requires typed financial adjustments to link an immutable gross movement. Fact-free adjustment events are limited to durable quarantine or an approved signed provider state with an explicit no-financial-effect disposition.';

COMMENT ON FUNCTION public.ingest_verified_payment_gateway_event_no_effect(
  public.sponsorship_method,
  text,
  text,
  text,
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
  text,
  text
) IS
  'Durably preserves signature-verified provider evidence for an approved state with no current financial effect, then atomically records an ignored application without creating sponsorship or monetary facts.';

COMMIT;
