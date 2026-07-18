BEGIN;

/*
 * PayPal webhook parity is deliberately layered on the existing immutable
 * gateway event and financial movement boundaries. Signature verification and
 * provider supplementation remain in the application process. These database
 * functions accept only typed, contact-free evidence that has already crossed
 * that boundary.
 */

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
        'PAYMENT.SALE.REVERSED',
        'CUSTOMER.DISPUTE.CREATED',
        'CUSTOMER.DISPUTE.UPDATED',
        'CUSTOMER.DISPUTE.RESOLVED'
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
              AND NOT (redacted_payload ? 'requires_operational_review')
            )
            OR (
              provider = 'PAYPAL'
              AND event_type IN (
                'CUSTOMER.DISPUTE.UPDATED',
                'CUSTOMER.DISPUTE.RESOLVED'
              )
              AND provider_object_type = 'dispute'
              AND redacted_payload @>
                '{"provider_event_disposition": "no_financial_effect"}'::jsonb
              AND redacted_payload ->> 'provider_state' ~
                '^[a-z][a-z0-9_]{1,79}$'
              AND NOT (redacted_payload ? 'quarantine')
              AND NOT (redacted_payload ? 'requires_operational_review')
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
        'PAYMENT.SALE.REVERSED',
        'CUSTOMER.DISPUTE.CREATED',
        'CUSTOMER.DISPUTE.UPDATED',
        'CUSTOMER.DISPUTE.RESOLVED'
      )
      AND original_financial_movement_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION private.resolve_sponsorship_financial_adjustment_kind(
  target_provider public.sponsorship_method,
  target_event_type text,
  target_provider_object_type text,
  target_adjustment_provider_movement_type text
)
RETURNS public.sponsorship_financial_entry_kind
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_provider = 'STRIPE'
     AND target_event_type IN ('refund.created', 'refund.updated')
     AND target_provider_object_type = 'refund'
     AND target_adjustment_provider_movement_type = 'refund' THEN
    RETURN 'sponsorship_refund';
  ELSIF target_provider = 'STRIPE'
     AND target_event_type = 'charge.dispute.funds_withdrawn'
     AND target_provider_object_type = 'dispute'
     AND target_adjustment_provider_movement_type = 'dispute' THEN
    RETURN 'sponsorship_dispute_debit';
  ELSIF target_provider = 'STRIPE'
     AND target_event_type = 'charge.dispute.funds_reinstated'
     AND target_provider_object_type = 'dispute'
     AND target_adjustment_provider_movement_type = 'dispute' THEN
    RETURN 'sponsorship_dispute_credit';
  ELSIF target_provider = 'PAYPAL'
     AND target_event_type IN (
       'PAYMENT.CAPTURE.REFUNDED',
       'PAYMENT.SALE.REFUNDED'
     )
     AND (
       (target_event_type = 'PAYMENT.CAPTURE.REFUNDED'
        AND target_provider_object_type = 'capture')
       OR
       (target_event_type = 'PAYMENT.SALE.REFUNDED'
        AND target_provider_object_type = 'sale')
     )
     AND target_adjustment_provider_movement_type = 'refund' THEN
    RETURN 'sponsorship_refund';
  ELSIF target_provider = 'PAYPAL'
     AND target_event_type IN (
       'PAYMENT.CAPTURE.REVERSED',
       'PAYMENT.SALE.REVERSED'
     )
     AND (
       (target_event_type = 'PAYMENT.CAPTURE.REVERSED'
        AND target_provider_object_type = 'capture')
       OR
       (target_event_type = 'PAYMENT.SALE.REVERSED'
        AND target_provider_object_type = 'sale')
     )
     AND target_adjustment_provider_movement_type = 'reversal' THEN
    RETURN 'sponsorship_reversal';
  ELSIF target_provider = 'PAYPAL'
     AND target_event_type = 'CUSTOMER.DISPUTE.CREATED'
     AND target_provider_object_type IN ('capture', 'sale')
     AND target_adjustment_provider_movement_type = 'dispute' THEN
    RETURN 'sponsorship_dispute_debit';
  ELSIF target_provider = 'PAYPAL'
     AND target_event_type = 'CUSTOMER.DISPUTE.RESOLVED'
     AND target_provider_object_type IN ('capture', 'sale')
     AND target_adjustment_provider_movement_type = 'dispute' THEN
    RETURN 'sponsorship_dispute_credit';
  END IF;

  RAISE EXCEPTION 'Unsupported financial adjustment event and object mapping'
    USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_sponsorship_financial_adjustment_kind(
  public.sponsorship_method,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_provider_event_type(
  target_provider public.sponsorship_method,
  target_event_type text,
  target_provider_object_type text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_provider = 'STRIPE' AND NOT (
    (target_event_type IN (
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired'
    ) AND target_provider_object_type = 'checkout_session')
    OR
    (target_event_type IN (
      'invoice.paid',
      'invoice.payment_succeeded',
      'invoice.payment_failed'
    ) AND target_provider_object_type = 'invoice')
    OR
    (target_event_type IN (
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    ) AND target_provider_object_type = 'subscription')
  ) THEN
    RAISE EXCEPTION 'Unsupported Stripe event and object type combination'
      USING ERRCODE = '22023';
  ELSIF target_provider = 'PAYPAL' AND NOT (
    (target_event_type IN (
      'PAYMENT.CAPTURE.COMPLETED',
      'PAYMENT.CAPTURE.DENIED',
      'PAYMENT.CAPTURE.DECLINED'
    ) AND target_provider_object_type = 'capture')
    OR
    (target_event_type IN (
      'PAYMENT.SALE.COMPLETED',
      'PAYMENT.SALE.DENIED'
    ) AND target_provider_object_type = 'sale')
    OR
    (target_event_type IN (
      'BILLING.SUBSCRIPTION.ACTIVATED',
      'BILLING.SUBSCRIPTION.CANCELLED',
      'BILLING.SUBSCRIPTION.SUSPENDED',
      'BILLING.SUBSCRIPTION.EXPIRED',
      'BILLING.SUBSCRIPTION.UPDATED',
      'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
    ) AND target_provider_object_type = 'billing_subscription')
  ) THEN
    RAISE EXCEPTION 'Unsupported PayPal event and object type combination'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_provider_event_type(
  public.sponsorship_method,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_paypal_webhook_expected_plan(
  target_payment_attempt_id uuid
)
RETURNS TABLE (provider_plan_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_plan_id text;
  v_plan_count integer;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = target_payment_attempt_id;

  IF NOT FOUND
     OR v_attempt.provider <> 'PAYPAL'
     OR v_attempt.provider_account_scope <> 'paypal' THEN
    RAISE EXCEPTION 'PayPal webhook payment attempt is unavailable'
      USING ERRCODE = '23514';
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_attempt.sponsorship_intent_id;

  IF NOT FOUND
     OR v_intent.payment_mode IS DISTINCT FROM v_attempt.payment_mode
     OR v_intent.base_amount_usd_cents IS DISTINCT FROM
       v_attempt.base_amount_usd_cents
     OR v_intent.charged_amount_minor IS DISTINCT FROM
       v_attempt.charged_amount_minor
     OR v_intent.charged_currency IS DISTINCT FROM
       v_attempt.charged_currency
     OR v_intent.conversion_rate IS DISTINCT FROM
       v_attempt.conversion_rate THEN
    RAISE EXCEPTION 'PayPal webhook intent and attempt terms conflict'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.payment_mode = 'one_time' THEN
    IF v_attempt.provider_object_type <> 'order'
       OR v_intent.recurrence_interval IS NOT NULL THEN
      RAISE EXCEPTION 'One time PayPal webhook boundary is malformed'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT NULL::text;
    RETURN;
  END IF;

  IF v_attempt.payment_mode <> 'recurring'
     OR v_attempt.provider_object_type <> 'billing_subscription'
     OR v_intent.subject_kind NOT IN ('standard', 'blind')
     OR v_intent.recurrence_interval NOT IN ('month', 'year') THEN
    RAISE EXCEPTION 'Recurring PayPal webhook boundary is malformed'
      USING ERRCODE = '23514';
  END IF;

  SELECT min(entry.provider_plan_id), count(*)::integer
  INTO v_plan_id, v_plan_count
  FROM public.paypal_billing_catalog_entries entry
  WHERE entry.provider = 'PAYPAL'
    AND entry.provider_account_scope = 'paypal'
    AND entry.status = 'active'
    AND entry.subject_kind = v_intent.subject_kind
    AND entry.beneficiary_id IS NOT DISTINCT FROM v_intent.beneficiary_id
    AND entry.recurrence_interval = v_intent.recurrence_interval
    AND entry.base_amount_usd_cents = v_intent.base_amount_usd_cents
    AND entry.charged_amount_minor = v_intent.charged_amount_minor
    AND entry.charged_currency = v_intent.charged_currency
    AND entry.conversion_rate = v_intent.conversion_rate
    AND entry.currency_rate_source = v_intent.currency_rate_source
    AND entry.provider_plan_id IS NOT NULL;

  IF v_plan_count <> 1 OR v_plan_id !~ '^P-[A-Z0-9]{24}$' THEN
    RAISE EXCEPTION 'Recurring PayPal payment does not resolve to one active server plan'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT v_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.read_paypal_webhook_expected_plan(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_paypal_webhook_expected_plan(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_verified_paypal_payment_failure_v2(
  target_payment_attempt_id uuid,
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
  target_verification_method text,
  target_fact_server_payment_attempt_id uuid,
  target_fact_parent_provider_object_type text,
  target_fact_parent_provider_object_id text,
  target_fact_provider_customer_id text,
  target_fact_provider_subscription_id text,
  target_fact_failure_code text,
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
  v_attempt public.sponsorship_payment_attempts%ROWTYPE;
  v_event public.payment_gateway_events%ROWTYPE;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_provider_account_scope <> 'paypal'
     OR target_provider_event_id IS NULL
     OR target_provider_event_id IS DISTINCT FROM btrim(target_provider_event_id)
     OR target_provider_event_id !~ '^WH-[A-Z0-9-]{8,252}$'
     OR target_provider_object_id IS NULL
     OR target_provider_object_id IS DISTINCT FROM btrim(target_provider_object_id)
     OR target_verification_method <> 'paypal_webhook_signature_api' THEN
    RAISE EXCEPTION 'PayPal failure provider evidence is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(target_redacted_payload) IS DISTINCT FROM 'object'
     OR pg_column_size(target_redacted_payload) > 65536
     OR target_redacted_payload ?| ARRAY[
       'sponsorship_intent_id',
       'payment_attempt_id',
       'sponsor_identity_id',
       'original_financial_movement_id',
       'fact_server_payment_attempt_id',
       'fact_provider_customer_id',
       'fact_provider_subscription_id',
       'fact_failure_code',
       'contact_email',
       'email_address'
     ]
     OR target_payload_ciphertext IS NULL
     OR octet_length(target_payload_ciphertext) NOT BETWEEN 1 AND 1048576
     OR octet_length(target_payload_sha256) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'PayPal failure payload evidence is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_signature_verified_at IS NULL
     OR target_occurred_at IS NULL
     OR target_signature_verified_at > clock_timestamp() + interval '5 minutes'
     OR target_signature_verified_at < target_occurred_at - interval '5 minutes'
     OR target_occurred_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'PayPal failure event time is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = target_payment_attempt_id
  FOR SHARE;

  IF NOT FOUND
     OR v_attempt.provider <> 'PAYPAL'
     OR v_attempt.provider_account_scope <> 'paypal'
     OR target_fact_server_payment_attempt_id IS DISTINCT FROM v_attempt.id
     OR target_occurred_at < v_attempt.started_at THEN
    RAISE EXCEPTION 'PayPal failure does not match its server payment attempt'
      USING ERRCODE = '23514';
  END IF;

  IF target_event_type = 'PAYMENT.CAPTURE.DECLINED' THEN
    IF target_provider_object_type <> 'capture'
       OR target_provider_object_id !~ '^[A-Z0-9]{10,64}$'
       OR v_attempt.payment_mode <> 'one_time'
       OR v_attempt.provider_object_type <> 'order'
       OR target_fact_parent_provider_object_type <> 'order'
       OR target_fact_parent_provider_object_id IS DISTINCT FROM
         v_attempt.provider_object_id
       OR target_fact_provider_customer_id IS NOT NULL
       OR target_fact_provider_subscription_id IS NOT NULL
       OR target_fact_failure_code <> 'paypal_capture_declined' THEN
      RAISE EXCEPTION 'PayPal declined capture chain is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF target_event_type = 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' THEN
    IF target_provider_object_type <> 'billing_subscription'
       OR target_provider_object_id !~ '^I-[A-Z0-9]{10,32}$'
       OR v_attempt.payment_mode <> 'recurring'
       OR v_attempt.provider_object_type <> 'billing_subscription'
       OR target_provider_object_id IS DISTINCT FROM v_attempt.provider_object_id
       OR target_fact_parent_provider_object_type IS NOT NULL
       OR target_fact_parent_provider_object_id IS NOT NULL
       OR target_fact_provider_customer_id IS NULL
       OR target_fact_provider_subscription_id IS DISTINCT FROM
         v_attempt.provider_object_id
       OR target_fact_failure_code <> 'paypal_subscription_payment_failed'
       OR (
         v_attempt.provider_customer_id IS NOT NULL
         AND target_fact_provider_customer_id IS DISTINCT FROM
           v_attempt.provider_customer_id
       ) THEN
      RAISE EXCEPTION 'PayPal subscription payment failure chain is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported PayPal typed payment failure'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        'PAYPAL',
        'paypal',
        target_provider_event_id
      )::text,
      0
    )
  );

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.provider = 'PAYPAL'
    AND gateway_event.provider_account_scope = 'paypal'
    AND gateway_event.provider_event_id = target_provider_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_event.payment_attempt_id IS DISTINCT FROM v_attempt.id
       OR v_event.sponsorship_intent_id IS DISTINCT FROM
         v_attempt.sponsorship_intent_id
       OR v_event.event_type IS DISTINCT FROM target_event_type
       OR v_event.provider_object_type IS DISTINCT FROM
         target_provider_object_type
       OR v_event.provider_object_id IS DISTINCT FROM target_provider_object_id
       OR v_event.payload_sha256 IS DISTINCT FROM target_payload_sha256
       OR v_event.occurred_at IS DISTINCT FROM target_occurred_at
       OR v_event.verification_method IS DISTINCT FROM
         target_verification_method
       OR v_event.fact_server_payment_attempt_id IS DISTINCT FROM v_attempt.id
       OR v_event.fact_parent_provider_object_type IS DISTINCT FROM
         target_fact_parent_provider_object_type
       OR v_event.fact_parent_provider_object_id IS DISTINCT FROM
         target_fact_parent_provider_object_id
       OR v_event.fact_provider_customer_id IS DISTINCT FROM
         target_fact_provider_customer_id
       OR v_event.fact_provider_subscription_id IS DISTINCT FROM
         target_fact_provider_subscription_id
       OR v_event.fact_failure_code IS DISTINCT FROM target_fact_failure_code THEN
      RAISE EXCEPTION 'PayPal failure event identifier conflicts with durable evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_event.id,
      v_event.sponsorship_intent_id,
      v_event.payment_attempt_id,
      v_event.processing_status,
      true;
    RETURN;
  END IF;

  PERFORM private.set_payment_audit_context(
    'ingest_verified_paypal_payment_failure_v2',
    'PAYPAL',
    'paypal',
    target_event_type,
    target_provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  PERFORM private.link_payment_provider_object(
    v_attempt.id,
    v_attempt.sponsorship_intent_id,
    'PAYPAL',
    'paypal',
    target_provider_object_type,
    target_provider_object_id,
    'event_subject',
    NULL
  );

  INSERT INTO public.payment_gateway_events (
    provider,
    provider_account_scope,
    provider_event_id,
    event_type,
    provider_object_type,
    provider_object_id,
    sponsorship_intent_id,
    payment_attempt_id,
    redacted_payload,
    payload_ciphertext,
    payload_sha256,
    signature_verified_at,
    occurred_at,
    verification_method,
    fact_server_payment_attempt_id,
    fact_parent_provider_object_type,
    fact_parent_provider_object_id,
    fact_provider_customer_id,
    fact_provider_subscription_id,
    fact_failure_code
  )
  VALUES (
    'PAYPAL',
    'paypal',
    target_provider_event_id,
    target_event_type,
    target_provider_object_type,
    target_provider_object_id,
    v_attempt.sponsorship_intent_id,
    v_attempt.id,
    target_redacted_payload,
    target_payload_ciphertext,
    target_payload_sha256,
    target_signature_verified_at,
    target_occurred_at,
    target_verification_method,
    v_attempt.id,
    target_fact_parent_provider_object_type,
    target_fact_parent_provider_object_id,
    target_fact_provider_customer_id,
    target_fact_provider_subscription_id,
    target_fact_failure_code
  )
  RETURNING * INTO v_event;

  RETURN QUERY SELECT
    v_event.id,
    v_event.sponsorship_intent_id,
    v_event.payment_attempt_id,
    v_event.processing_status,
    false;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_verified_paypal_payment_failure_v2(
  uuid, text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, uuid, text, text, text, text, text,
  text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_verified_paypal_payment_failure_v2(
  uuid, text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, uuid, text, text, text, text, text,
  text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_verified_paypal_dispute_no_effect(
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
  v_redacted_payload jsonb;
  v_lease_token uuid;
  v_ignored_reason text;
BEGIN
  PERFORM private.require_payment_service_role();

  IF target_provider_account_scope <> 'paypal'
     OR target_provider_event_id IS NULL
     OR target_provider_event_id IS DISTINCT FROM btrim(target_provider_event_id)
     OR target_provider_event_id !~ '^WH-[A-Z0-9-]{8,252}$'
     OR target_provider_object_type <> 'dispute'
     OR target_provider_object_id IS NULL
     OR target_provider_object_id IS DISTINCT FROM btrim(target_provider_object_id)
     OR target_provider_object_id !~ '^[A-Z0-9][A-Z0-9-]{4,127}$'
     OR target_provider_state IS NULL
     OR target_provider_state IS DISTINCT FROM lower(btrim(target_provider_state))
     OR target_provider_state !~ '^[a-z][a-z0-9_]{1,79}$'
     OR target_verification_method <> 'paypal_webhook_signature_api' THEN
    RAISE EXCEPTION 'PayPal no-effect dispute evidence is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF (
       target_event_type = 'CUSTOMER.DISPUTE.UPDATED'
       AND target_provider_state !~ '^updated_[a-z0-9_]+$'
     )
     OR (
       target_event_type = 'CUSTOMER.DISPUTE.RESOLVED'
       AND target_provider_state NOT IN (
         'resolved_buyer_favor',
         'resolved_buyer_favour'
       )
     )
     OR target_event_type NOT IN (
       'CUSTOMER.DISPUTE.UPDATED',
       'CUSTOMER.DISPUTE.RESOLVED'
     ) THEN
    RAISE EXCEPTION 'Unsupported PayPal no-effect dispute disposition'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(target_redacted_payload) IS DISTINCT FROM 'object'
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
       'contact_email',
       'email_address'
     ] THEN
    RAISE EXCEPTION 'PayPal no-effect evidence contains reserved facts'
      USING ERRCODE = '22023';
  END IF;

  v_redacted_payload := target_redacted_payload || jsonb_build_object(
    'provider', 'PAYPAL',
    'source', 'verified_webhook',
    'event_type', target_event_type,
    'provider_object_type', 'dispute',
    'provider_event_disposition', 'no_financial_effect',
    'provider_state', target_provider_state
  );

  IF pg_column_size(v_redacted_payload) > 65536
     OR target_payload_ciphertext IS NULL
     OR octet_length(target_payload_ciphertext) NOT BETWEEN 1 AND 1048576
     OR octet_length(target_payload_sha256) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'PayPal no-effect payload evidence is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_signature_verified_at IS NULL
     OR target_occurred_at IS NULL
     OR target_signature_verified_at > clock_timestamp() + interval '5 minutes'
     OR target_signature_verified_at < target_occurred_at - interval '5 minutes'
     OR target_occurred_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'PayPal no-effect dispute time is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_ignored_reason := left(
    'no_financial_effect:' || target_provider_state ||
      ': signed PayPal dispute event has no current financial effect',
    1000
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        'PAYPAL',
        'paypal',
        target_provider_event_id
      )::text,
      0
    )
  );

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.provider = 'PAYPAL'
    AND gateway_event.provider_account_scope = 'paypal'
    AND gateway_event.provider_event_id = target_provider_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_event.event_type IS DISTINCT FROM target_event_type
       OR v_event.provider_object_type IS DISTINCT FROM 'dispute'
       OR v_event.provider_object_id IS DISTINCT FROM target_provider_object_id
       OR v_event.payload_sha256 IS DISTINCT FROM target_payload_sha256
       OR v_event.occurred_at IS DISTINCT FROM target_occurred_at
       OR v_event.verification_method IS DISTINCT FROM target_verification_method
       OR v_event.redacted_payload ->> 'provider_event_disposition'
         IS DISTINCT FROM 'no_financial_effect'
       OR v_event.redacted_payload ->> 'provider_state'
         IS DISTINCT FROM target_provider_state
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
      RAISE EXCEPTION 'PayPal dispute event identifier conflicts with durable no-effect evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT v_event.id, v_event.processing_status, true;
    RETURN;
  END IF;

  PERFORM private.set_payment_audit_context(
    'ingest_verified_paypal_dispute_no_effect',
    'PAYPAL',
    'paypal',
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
    'PAYPAL',
    'paypal',
    target_provider_event_id,
    target_event_type,
    'dispute',
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
    processing_locked_by = 'paypal-dispute-no-effect:' || v_lease_token::text,
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

REVOKE ALL ON FUNCTION public.ingest_verified_paypal_dispute_no_effect(
  text, text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_verified_paypal_dispute_no_effect(
  text, text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_paypal_payment_failure_v2(
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
  v_subscription public.subscriptions%ROWTYPE;
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

  IF v_event.provider <> 'PAYPAL'
     OR v_event.provider_account_scope <> 'paypal'
     OR v_event.event_type NOT IN (
       'PAYMENT.CAPTURE.DECLINED',
       'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
     )
     OR v_event.fact_failure_code IS NULL
     OR v_event.fact_server_payment_attempt_id IS DISTINCT FROM
       v_event.payment_attempt_id THEN
    RAISE EXCEPTION 'Gateway event is not authoritative for PayPal payment failure'
      USING ERRCODE = '23514';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.sponsorship_payment_attempts attempt
  WHERE attempt.id = v_event.payment_attempt_id
    AND attempt.sponsorship_intent_id = v_event.sponsorship_intent_id
    AND attempt.provider = 'PAYPAL'
    AND attempt.provider_account_scope = 'paypal'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PayPal failure payment chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_attempt.sponsorship_intent_id
  FOR UPDATE;

  IF v_event.event_type = 'PAYMENT.CAPTURE.DECLINED' THEN
    IF v_attempt.payment_mode <> 'one_time'
       OR v_event.provider_object_type <> 'capture'
       OR v_event.fact_parent_provider_object_type <> 'order'
       OR v_event.fact_parent_provider_object_id IS DISTINCT FROM
         v_attempt.provider_object_id
       OR v_event.fact_failure_code <> 'paypal_capture_declined'
       OR v_attempt.status NOT IN ('pending', 'succeeded') THEN
      RAISE EXCEPTION 'PayPal declined capture cannot apply to this attempt'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_attempt.payment_mode <> 'recurring'
       OR v_event.provider_object_type <> 'billing_subscription'
       OR v_event.provider_object_id IS DISTINCT FROM
         v_attempt.provider_object_id
       OR v_event.fact_provider_subscription_id IS DISTINCT FROM
         v_attempt.provider_object_id
       OR v_event.fact_failure_code <>
         'paypal_subscription_payment_failed'
       OR v_attempt.status NOT IN ('pending', 'succeeded') THEN
      RAISE EXCEPTION 'PayPal subscription failure cannot apply to this attempt'
        USING ERRCODE = '23514';
    END IF;

    SELECT subscription.*
    INTO v_subscription
    FROM public.subscriptions subscription
    WHERE subscription.sponsorship_intent_id = v_intent.id
    LIMIT 1
    FOR UPDATE;

    IF v_attempt.status = 'succeeded' AND (
      v_subscription.id IS NULL
      OR v_event.fact_provider_customer_id IS DISTINCT FROM
        v_attempt.provider_customer_id
      OR v_event.fact_provider_subscription_id IS DISTINCT FROM
        v_attempt.provider_subscription_object_id
      OR v_subscription.customer_id IS DISTINCT FROM
        v_attempt.provider_customer_id
      OR v_subscription.provider_subscription_object_id IS DISTINCT FROM
        v_attempt.provider_subscription_object_id
    ) THEN
      RAISE EXCEPTION 'PayPal subscription failure does not match its materialized chain'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM private.set_payment_audit_context(
    'apply_paypal_payment_failure_v2',
    'PAYPAL',
    'paypal',
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  IF v_event.event_type = 'PAYMENT.CAPTURE.DECLINED'
     AND v_attempt.status = 'pending' THEN
    UPDATE public.sponsorship_payment_attempts
    SET
      status = 'failed',
      failure_code = v_event.fact_failure_code
    WHERE id = v_attempt.id;

    UPDATE public.sponsorship_intents
    SET status = 'failed'
    WHERE id = v_intent.id
      AND status IN ('committed', 'processing');

    UPDATE public.sponsorship_checkout_reservations
    SET
      status = 'released',
      provider_reconciled_at = v_event.signature_verified_at,
      release_reason = left(
        'failed: verified PayPal capture declined',
        500
      ),
      reconciliation_evidence_sha256 = v_event.payload_sha256
    WHERE payment_attempt_id = v_attempt.id
      AND status = 'active';
  END IF;

  IF v_subscription.id IS NOT NULL
     AND (
       v_event.occurred_at >
         v_subscription.last_provider_payment_event_occurred_at
       OR (
         v_event.occurred_at =
           v_subscription.last_provider_payment_event_occurred_at
         AND v_subscription.last_provider_payment_event_precedence < 200
       )
     ) THEN
    UPDATE public.subscriptions
    SET
      payment_health = 'delinquent',
      last_provider_payment_event_occurred_at = v_event.occurred_at,
      last_provider_payment_event_precedence = 200,
      last_provider_payment_event_id = v_event.provider_event_id
    WHERE id = v_subscription.id
    RETURNING * INTO v_subscription;
  END IF;

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    subscription_id,
    summary
  )
  VALUES (
    v_event.id,
    'payment_failed',
    v_subscription.id,
    jsonb_build_object(
      'provider', 'PAYPAL',
      'provider_account_scope', 'paypal',
      'event_type', v_event.event_type,
      'outcome', 'payment_failed'
    )
  )
  RETURNING * INTO v_application;

  UPDATE public.payment_gateway_events
  SET
    processing_status = 'processed',
    processing_lease_token = NULL
  WHERE id = v_event.id;

  RETURN QUERY SELECT
    v_event.id,
    v_attempt.id,
    v_intent.id,
    v_subscription.id,
    v_application.effect;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_paypal_payment_failure_v2(
  uuid, uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paypal_payment_failure_v2(
  uuid, uuid, text, text, text, text
) TO service_role;

/*
 * The contact erasure wrapper introduced in the prior migration accidentally
 * narrowed the success material boundary back to Stripe. Preserve its terminal
 * attempt protection while restoring the PayPal capture and sale mappings that
 * the underlying lease-fenced function already validates.
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
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_payment_gateway_event_success_material(
  uuid, uuid, text, text
) TO service_role;

COMMENT ON CONSTRAINT payment_gateway_events_financial_adjustment_link_check
  ON public.payment_gateway_events IS
  'Requires every monetary adjustment, including PayPal disputes, to link one immutable gross movement. Verified dispute updates and buyer wins may use the explicit fact-free no-effect shape.';

COMMENT ON FUNCTION public.read_paypal_webhook_expected_plan(uuid) IS
  'Returns the sole active server-selected PayPal billing plan matching one recurring payment attempt, or null for one-time orders. Ambiguous catalog matches fail closed.';

COMMENT ON FUNCTION public.ingest_verified_paypal_payment_failure_v2(
  uuid, text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, uuid, text, text, text, text, text,
  text, text, text, text
) IS
  'Durably ingests signature-verified PayPal capture declines and subscription payment failures against one server-owned payment chain.';

COMMENT ON FUNCTION public.ingest_verified_paypal_dispute_no_effect(
  text, text, text, text, text, text, jsonb, bytea, bytea,
  timestamptz, timestamptz, text, text, text, text, text
) IS
  'Records signed PayPal dispute lifecycle evidence with no monetary effect and atomically settles it as ignored.';

COMMENT ON FUNCTION public.apply_paypal_payment_failure_v2(
  uuid, uuid, text, text, text, text
) IS
  'Applies typed PayPal capture declines and subscription payment failures without trusting encrypted webhook payloads.';

COMMENT ON FUNCTION public.read_payment_gateway_event_success_material(
  uuid, uuid, text, text
) IS
  'Returns sealed welcome material for an actively leased typed Stripe or PayPal success. Terminal attempts return no secret material.';

COMMIT;
