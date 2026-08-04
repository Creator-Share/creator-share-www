BEGIN;

ALTER TABLE public.payment_gateway_events
  ADD COLUMN original_financial_movement_id uuid
    REFERENCES public.sponsorship_financial_movements(id) ON DELETE RESTRICT,
  ADD CONSTRAINT payment_gateway_events_financial_adjustment_link_check CHECK (
    (
      event_type IN (
        'refund.created',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated',
        'PAYMENT.CAPTURE.REFUNDED',
        'PAYMENT.CAPTURE.REVERSED',
        'PAYMENT.SALE.REFUNDED',
        'PAYMENT.SALE.REVERSED'
      )
      AND original_financial_movement_id IS NOT NULL
    )
    OR (
      event_type NOT IN (
        'refund.created',
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

ALTER TABLE public.sponsorship_financial_movements
  ADD COLUMN original_financial_movement_id uuid,
  ADD COLUMN net_base_amount_usd_cents bigint GENERATED ALWAYS AS (
    CASE
      WHEN entry_kind IN (
        'sponsorship_refund',
        'sponsorship_reversal',
        'sponsorship_dispute_debit'
      ) THEN -base_amount_usd_cents
      ELSE base_amount_usd_cents
    END
  ) STORED,
  ADD COLUMN net_charged_amount_minor bigint GENERATED ALWAYS AS (
    CASE
      WHEN entry_kind IN (
        'sponsorship_refund',
        'sponsorship_reversal',
        'sponsorship_dispute_debit'
      ) THEN -charged_amount_minor
      ELSE charged_amount_minor
    END
  ) STORED,
  ADD CONSTRAINT sponsorship_financial_movements_original_shape_check CHECK (
    (
      entry_kind = 'sponsorship_payment'
      AND original_financial_movement_id IS NULL
    )
    OR (
      entry_kind IN (
        'sponsorship_refund',
        'sponsorship_reversal',
        'sponsorship_dispute_debit',
        'sponsorship_dispute_credit'
      )
      AND original_financial_movement_id IS NOT NULL
      AND original_financial_movement_id <> id
    )
  ),
  ADD CONSTRAINT sponsorship_financial_movements_adjustment_chain_unique
  UNIQUE (
    id,
    payment_attempt_id,
    sponsorship_intent_id,
    sponsor_identity_id,
    provider,
    provider_account_scope,
    payment_mode,
    charged_currency
  );

ALTER TABLE public.sponsorship_financial_movements
  ADD CONSTRAINT sponsorship_financial_movements_original_chain_fkey
  FOREIGN KEY (
    original_financial_movement_id,
    payment_attempt_id,
    sponsorship_intent_id,
    sponsor_identity_id,
    provider,
    provider_account_scope,
    payment_mode,
    charged_currency
  )
  REFERENCES public.sponsorship_financial_movements (
    id,
    payment_attempt_id,
    sponsorship_intent_id,
    sponsor_identity_id,
    provider,
    provider_account_scope,
    payment_mode,
    charged_currency
  )
  ON DELETE RESTRICT;

DROP INDEX public.sponsorship_financial_movements_one_time_attempt_uidx;

CREATE UNIQUE INDEX sponsorship_financial_movements_one_time_attempt_uidx
  ON public.sponsorship_financial_movements (payment_attempt_id)
  WHERE payment_mode = 'one_time'
    AND entry_kind = 'sponsorship_payment';

ALTER TABLE public.payment_gateway_event_applications
  DROP CONSTRAINT payment_gateway_event_applications_effect_check,
  ADD CONSTRAINT payment_gateway_event_applications_effect_check CHECK (
    (
      effect IN ('payment_succeeded', 'duplicate_movement')
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
    OR effect IN (
      'payment_failed',
      'subscription_lifecycle',
      'ignored'
    )
  );

ALTER TABLE public.sponsorship_refund_requirements
  ADD CONSTRAINT sponsorship_refund_requirements_resolution_chain_unique
  UNIQUE (id, financial_movement_id);

ALTER TABLE public.sponsorship_financial_movements
  ADD CONSTRAINT sponsorship_financial_movements_resolution_chain_unique
  UNIQUE (
    id,
    original_financial_movement_id,
    source_gateway_event_id,
    entry_kind
  );

CREATE TABLE public.sponsorship_refund_requirement_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_requirement_id uuid NOT NULL UNIQUE,
  original_financial_movement_id uuid NOT NULL UNIQUE,
  resolving_gateway_event_id uuid NOT NULL UNIQUE,
  resolving_financial_movement_id uuid NOT NULL UNIQUE,
  resolution_kind public.sponsorship_financial_entry_kind NOT NULL,
  final_net_base_amount_usd_cents bigint NOT NULL,
  final_net_charged_amount_minor bigint NOT NULL,
  evidence jsonb NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sponsorship_refund_requirement_resolutions_kind_check CHECK (
    resolution_kind IN ('sponsorship_refund', 'sponsorship_reversal')
  ),
  CONSTRAINT sponsorship_refund_requirement_resolutions_net_check CHECK (
    final_net_base_amount_usd_cents = 0
    AND final_net_charged_amount_minor = 0
  ),
  CONSTRAINT sponsorship_refund_requirement_resolutions_evidence_check CHECK (
    jsonb_typeof(evidence) = 'object'
    AND pg_column_size(evidence) <= 4096
  ),
  CONSTRAINT sponsorship_refund_requirement_resolutions_requirement_fkey
  FOREIGN KEY (refund_requirement_id, original_financial_movement_id)
  REFERENCES public.sponsorship_refund_requirements (
    id,
    financial_movement_id
  )
  ON DELETE RESTRICT,
  CONSTRAINT sponsorship_refund_requirement_resolutions_movement_fkey
  FOREIGN KEY (
    resolving_financial_movement_id,
    original_financial_movement_id,
    resolving_gateway_event_id,
    resolution_kind
  )
  REFERENCES public.sponsorship_financial_movements (
    id,
    original_financial_movement_id,
    source_gateway_event_id,
    entry_kind
  )
  ON DELETE RESTRICT
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
     AND target_event_type = 'refund.created'
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
     AND (
       (
         target_event_type = 'PAYMENT.CAPTURE.REFUNDED'
         AND target_provider_object_type = 'capture'
       )
       OR (
         target_event_type = 'PAYMENT.SALE.REFUNDED'
         AND target_provider_object_type = 'sale'
       )
     )
     AND target_adjustment_provider_movement_type = 'refund' THEN
    RETURN 'sponsorship_refund';
  ELSIF target_provider = 'PAYPAL'
     AND (
       (
         target_event_type = 'PAYMENT.CAPTURE.REVERSED'
         AND target_provider_object_type = 'capture'
       )
       OR (
         target_event_type = 'PAYMENT.SALE.REVERSED'
         AND target_provider_object_type = 'sale'
       )
     )
     AND target_adjustment_provider_movement_type = 'reversal' THEN
    RETURN 'sponsorship_reversal';
  END IF;

  RAISE EXCEPTION 'Unsupported financial adjustment event and object mapping'
    USING ERRCODE = '22023';
END;
$$;

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
      'checkout.session.async_payment_failed'
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
      'PAYMENT.CAPTURE.DENIED'
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
      'BILLING.SUBSCRIPTION.UPDATED'
    ) AND target_provider_object_type = 'billing_subscription')
  ) THEN
    RAISE EXCEPTION 'Unsupported PayPal event and object type combination'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_financial_adjustment_event_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.original_financial_movement_id IS DISTINCT FROM
       OLD.original_financial_movement_id THEN
    RAISE EXCEPTION 'Gateway event financial adjustment link is immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_gateway_events_adjustment_link_protect
BEFORE UPDATE ON public.payment_gateway_events
FOR EACH ROW EXECUTE FUNCTION private.protect_financial_adjustment_event_link();

CREATE TRIGGER sponsorship_refund_requirement_resolutions_protect
BEFORE UPDATE OR DELETE ON public.sponsorship_refund_requirement_resolutions
FOR EACH ROW EXECUTE FUNCTION private.protect_payment_transaction_evidence();

CREATE TRIGGER sponsorship_refund_requirement_resolutions_no_truncate
BEFORE TRUNCATE ON public.sponsorship_refund_requirement_resolutions
FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_operational_table_truncate();

ALTER TABLE public.sponsorship_refund_requirement_resolutions
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sponsorship_refund_requirement_resolutions
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.sponsorship_refund_requirement_resolutions
  TO service_role;

CREATE TRIGGER sponsorship_refund_requirement_resolutions_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.sponsorship_refund_requirement_resolutions
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  '',
  '@columns_only',
  'evidence'
);

CREATE OR REPLACE FUNCTION public.ingest_verified_sponsorship_financial_adjustment(
  target_original_financial_movement_id uuid,
  target_provider public.sponsorship_method,
  target_provider_account_scope text,
  target_provider_event_id text,
  target_event_type text,
  target_provider_object_type text,
  target_provider_object_id text,
  target_adjustment_provider_movement_type text,
  target_adjustment_provider_movement_id text,
  target_base_amount_usd_cents bigint,
  target_charged_amount_minor bigint,
  target_charged_currency public.payment_currency,
  target_conversion_rate numeric,
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
  original_financial_movement_id uuid,
  payment_attempt_id uuid,
  sponsorship_intent_id uuid,
  processing_status public.gateway_event_processing_status,
  adjustment_kind public.sponsorship_financial_entry_kind,
  is_duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_original public.sponsorship_financial_movements%ROWTYPE;
  v_event public.payment_gateway_events%ROWTYPE;
  v_kind public.sponsorship_financial_entry_kind;
BEGIN
  PERFORM private.require_payment_service_role();

  IF jsonb_typeof(target_redacted_payload) IS DISTINCT FROM 'object'
     OR pg_column_size(target_redacted_payload) > 65536 THEN
    RAISE EXCEPTION 'Redacted adjustment payload must be an object no larger than 65536 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF target_payload_ciphertext IS NOT NULL
     AND octet_length(target_payload_ciphertext) > 1048576 THEN
    RAISE EXCEPTION 'Encrypted adjustment payload exceeds 1048576 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF octet_length(target_payload_sha256) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Adjustment payload digest must contain 32 bytes'
      USING ERRCODE = '22023';
  END IF;

  IF target_signature_verified_at > clock_timestamp() + interval '5 minutes'
     OR target_signature_verified_at < target_occurred_at - interval '5 minutes'
     OR target_occurred_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Adjustment verification or occurrence time is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (target_provider = 'STRIPE' AND target_verification_method NOT IN (
        'stripe_webhook_signature',
        'provider_api_response'
      ))
     OR (target_provider = 'PAYPAL' AND target_verification_method NOT IN (
        'paypal_webhook_signature_api',
        'provider_api_response'
      )) THEN
    RAISE EXCEPTION 'Adjustment verification method does not match the payment provider'
      USING ERRCODE = '22023';
  END IF;

  IF target_provider_account_scope IS DISTINCT FROM
       lower(btrim(target_provider_account_scope))
     OR length(target_provider_account_scope) NOT BETWEEN 1 AND 120
     OR target_provider_event_id IS DISTINCT FROM btrim(target_provider_event_id)
     OR length(target_provider_event_id) NOT BETWEEN 1 AND 255
     OR target_provider_object_id IS DISTINCT FROM btrim(target_provider_object_id)
     OR length(target_provider_object_id) NOT BETWEEN 1 AND 255
     OR target_adjustment_provider_movement_id IS DISTINCT FROM
       btrim(target_adjustment_provider_movement_id)
     OR length(target_adjustment_provider_movement_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Adjustment provider identifiers are malformed'
      USING ERRCODE = '22023';
  END IF;

  v_kind := private.resolve_sponsorship_financial_adjustment_kind(
    target_provider,
    target_event_type,
    target_provider_object_type,
    target_adjustment_provider_movement_type
  );

  SELECT movement.*
  INTO v_original
  FROM public.sponsorship_financial_movements movement
  WHERE movement.id = target_original_financial_movement_id
  FOR SHARE;

  IF NOT FOUND
     OR v_original.entry_kind <> 'sponsorship_payment'
     OR v_original.original_financial_movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Financial adjustment original movement is not an immutable gross sponsorship payment'
      USING ERRCODE = '23514';
  END IF;

  IF v_original.provider IS DISTINCT FROM target_provider
     OR v_original.provider_account_scope IS DISTINCT FROM
       target_provider_account_scope
     OR NOT EXISTS (
       SELECT 1
       FROM public.payment_gateway_event_applications application
       WHERE application.gateway_event_id = v_original.source_gateway_event_id
         AND application.financial_movement_id = v_original.id
         AND application.effect IN ('payment_succeeded', 'refund_required')
     ) THEN
    RAISE EXCEPTION 'Financial adjustment does not match a materialized provider payment chain'
      USING ERRCODE = '23514';
  END IF;

  IF target_occurred_at < v_original.occurred_at THEN
    RAISE EXCEPTION 'Financial adjustment cannot precede its original gross payment'
      USING ERRCODE = '23514';
  END IF;

  IF target_base_amount_usd_cents IS NULL
     OR target_base_amount_usd_cents <= 0
     OR target_base_amount_usd_cents > v_original.base_amount_usd_cents
     OR target_charged_amount_minor IS NULL
     OR target_charged_amount_minor <= 0
     OR target_charged_amount_minor > v_original.charged_amount_minor
     OR target_charged_currency IS DISTINCT FROM v_original.charged_currency
     OR target_conversion_rate IS DISTINCT FROM v_original.conversion_rate
     OR target_charged_amount_minor IS DISTINCT FROM
       round(target_base_amount_usd_cents * target_conversion_rate) THEN
    RAISE EXCEPTION 'Financial adjustment amounts do not match the original charged currency terms'
      USING ERRCODE = '23514';
  END IF;

  IF target_provider = 'STRIPE' AND (
       target_provider_object_id IS DISTINCT FROM
         target_adjustment_provider_movement_id
     ) THEN
    RAISE EXCEPTION 'Stripe adjustment subject must be the verified refund or dispute movement'
      USING ERRCODE = '23514';
  ELSIF target_provider = 'PAYPAL' AND (
       target_provider_object_type IS DISTINCT FROM
         v_original.provider_movement_type
       OR target_provider_object_id IS DISTINCT FROM
         v_original.provider_movement_id
     ) THEN
    RAISE EXCEPTION 'PayPal adjustment subject must be the original capture or sale movement'
      USING ERRCODE = '23514';
  END IF;

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
    IF v_event.original_financial_movement_id IS DISTINCT FROM v_original.id
       OR v_event.payment_attempt_id IS DISTINCT FROM v_original.payment_attempt_id
       OR v_event.sponsorship_intent_id IS DISTINCT FROM v_original.sponsorship_intent_id
       OR v_event.event_type IS DISTINCT FROM target_event_type
       OR v_event.provider_object_type IS DISTINCT FROM target_provider_object_type
       OR v_event.provider_object_id IS DISTINCT FROM target_provider_object_id
       OR v_event.payload_sha256 IS DISTINCT FROM target_payload_sha256
       OR v_event.occurred_at IS DISTINCT FROM target_occurred_at
       OR v_event.verification_method IS DISTINCT FROM target_verification_method
       OR v_event.fact_server_payment_attempt_id IS DISTINCT FROM
         v_original.payment_attempt_id
       OR v_event.fact_parent_provider_object_type IS DISTINCT FROM
         v_original.provider_movement_type
       OR v_event.fact_parent_provider_object_id IS DISTINCT FROM
         v_original.provider_movement_id
       OR v_event.fact_provider_movement_type IS DISTINCT FROM
         target_adjustment_provider_movement_type
       OR v_event.fact_provider_movement_id IS DISTINCT FROM
         target_adjustment_provider_movement_id
       OR v_event.fact_base_amount_usd_cents IS DISTINCT FROM
         target_base_amount_usd_cents
       OR v_event.fact_charged_amount_minor IS DISTINCT FROM
         target_charged_amount_minor
       OR v_event.fact_charged_currency IS DISTINCT FROM target_charged_currency
       OR v_event.fact_conversion_rate IS DISTINCT FROM target_conversion_rate THEN
      RAISE EXCEPTION 'Provider adjustment event identifier was replayed with different evidence'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      v_event.id,
      v_event.original_financial_movement_id,
      v_event.payment_attempt_id,
      v_event.sponsorship_intent_id,
      v_event.processing_status,
      v_kind,
      true;
    RETURN;
  END IF;

  PERFORM private.set_payment_audit_context(
    'ingest_verified_sponsorship_financial_adjustment',
    target_provider,
    target_provider_account_scope,
    target_event_type,
    target_provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  PERFORM private.link_payment_provider_object(
    v_original.payment_attempt_id,
    v_original.sponsorship_intent_id,
    v_original.provider,
    v_original.provider_account_scope,
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
    fact_provider_movement_type,
    fact_provider_movement_id,
    fact_base_amount_usd_cents,
    fact_charged_amount_minor,
    fact_charged_currency,
    fact_conversion_rate,
    original_financial_movement_id
  )
  VALUES (
    v_original.provider,
    v_original.provider_account_scope,
    target_provider_event_id,
    target_event_type,
    target_provider_object_type,
    target_provider_object_id,
    v_original.sponsorship_intent_id,
    v_original.payment_attempt_id,
    target_redacted_payload,
    target_payload_ciphertext,
    target_payload_sha256,
    target_signature_verified_at,
    target_occurred_at,
    target_verification_method,
    v_original.payment_attempt_id,
    v_original.provider_movement_type,
    v_original.provider_movement_id,
    target_adjustment_provider_movement_type,
    target_adjustment_provider_movement_id,
    target_base_amount_usd_cents,
    target_charged_amount_minor,
    target_charged_currency,
    target_conversion_rate,
    v_original.id
  )
  RETURNING * INTO v_event;

  RETURN QUERY SELECT
    v_event.id,
    v_event.original_financial_movement_id,
    v_event.payment_attempt_id,
    v_event.sponsorship_intent_id,
    v_event.processing_status,
    v_kind,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sponsorship_financial_adjustment(
  target_gateway_event_id uuid,
  target_processing_lease_token uuid,
  context_request_id text DEFAULT NULL,
  context_trace_id text DEFAULT NULL,
  context_client_ip text DEFAULT NULL,
  context_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  gateway_event_id uuid,
  original_financial_movement_id uuid,
  financial_movement_id uuid,
  transaction_ledger_id uuid,
  refund_requirement_resolution_id uuid,
  application_effect public.gateway_event_application_effect,
  net_base_amount_usd_cents bigint,
  net_charged_amount_minor bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_event public.payment_gateway_events%ROWTYPE;
  v_application public.payment_gateway_event_applications%ROWTYPE;
  v_original public.sponsorship_financial_movements%ROWTYPE;
  v_existing public.sponsorship_financial_movements%ROWTYPE;
  v_movement public.sponsorship_financial_movements%ROWTYPE;
  v_intent public.sponsorship_intents%ROWTYPE;
  v_ledger public.transaction_ledger%ROWTYPE;
  v_resolution public.sponsorship_refund_requirement_resolutions%ROWTYPE;
  v_kind public.sponsorship_financial_entry_kind;
  v_effect public.gateway_event_application_effect;
  v_signed_base bigint;
  v_signed_charged bigint;
  v_current_net_base bigint;
  v_current_net_charged bigint;
  v_new_net_base bigint;
  v_new_net_charged bigint;
  v_dispute_outstanding_base bigint;
  v_dispute_outstanding_charged bigint;
BEGIN
  PERFORM private.require_payment_service_role();

  SELECT gateway_event.*
  INTO v_event
  FROM public.payment_gateway_events gateway_event
  WHERE gateway_event.id = target_gateway_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial adjustment gateway event does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT application.*
  INTO v_application
  FROM public.payment_gateway_event_applications application
  WHERE application.gateway_event_id = v_event.id;

  IF FOUND THEN
    SELECT movement.*
    INTO v_movement
    FROM public.sponsorship_financial_movements movement
    WHERE movement.id = v_application.financial_movement_id;

    SELECT ledger.*
    INTO v_ledger
    FROM public.transaction_ledger ledger
    WHERE ledger.gateway_event_id = v_event.id;

    SELECT resolution.*
    INTO v_resolution
    FROM public.sponsorship_refund_requirement_resolutions resolution
    WHERE resolution.resolving_gateway_event_id = v_event.id;

    SELECT
      sum(movement.net_base_amount_usd_cents),
      sum(movement.net_charged_amount_minor)
    INTO v_new_net_base, v_new_net_charged
    FROM public.sponsorship_financial_movements movement
    WHERE movement.id = v_event.original_financial_movement_id
       OR movement.original_financial_movement_id =
         v_event.original_financial_movement_id;

    RETURN QUERY SELECT
      v_event.id,
      v_event.original_financial_movement_id,
      v_application.financial_movement_id,
      v_ledger.id,
      v_resolution.id,
      v_application.effect,
      v_new_net_base,
      v_new_net_charged;
    RETURN;
  END IF;

  IF v_event.processing_status <> 'processing'
     OR v_event.processing_lease_token IS DISTINCT FROM
       target_processing_lease_token THEN
    RAISE EXCEPTION 'Financial adjustment processing lease is missing or stale'
      USING ERRCODE = '55P03';
  END IF;

  IF v_event.original_financial_movement_id IS NULL THEN
    RAISE EXCEPTION 'Gateway event is not linked to an original gross movement'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'sponsorship_financial_adjustment:' ||
        v_event.original_financial_movement_id::text,
      0
    )
  );

  SELECT movement.*
  INTO v_original
  FROM public.sponsorship_financial_movements movement
  WHERE movement.id = v_event.original_financial_movement_id
  FOR SHARE;

  IF NOT FOUND
     OR v_original.entry_kind <> 'sponsorship_payment'
     OR v_original.original_financial_movement_id IS NOT NULL
     OR v_event.payment_attempt_id IS DISTINCT FROM v_original.payment_attempt_id
     OR v_event.sponsorship_intent_id IS DISTINCT FROM
       v_original.sponsorship_intent_id
     OR v_event.provider IS DISTINCT FROM v_original.provider
     OR v_event.provider_account_scope IS DISTINCT FROM
       v_original.provider_account_scope
     OR v_event.fact_server_payment_attempt_id IS DISTINCT FROM
       v_original.payment_attempt_id
     OR v_event.fact_parent_provider_object_type IS DISTINCT FROM
       v_original.provider_movement_type
     OR v_event.fact_parent_provider_object_id IS DISTINCT FROM
       v_original.provider_movement_id THEN
    RAISE EXCEPTION 'Financial adjustment original payment chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  v_kind := private.resolve_sponsorship_financial_adjustment_kind(
    v_event.provider,
    v_event.event_type,
    v_event.provider_object_type,
    v_event.fact_provider_movement_type
  );

  IF v_event.provider = 'STRIPE' AND (
       v_event.provider_object_id IS DISTINCT FROM
         v_event.fact_provider_movement_id
     ) THEN
    RAISE EXCEPTION 'Stripe adjustment movement chain is invalid'
      USING ERRCODE = '23514';
  ELSIF v_event.provider = 'PAYPAL' AND (
       v_event.provider_object_type IS DISTINCT FROM
         v_original.provider_movement_type
       OR v_event.provider_object_id IS DISTINCT FROM
         v_original.provider_movement_id
     ) THEN
    RAISE EXCEPTION 'PayPal adjustment movement chain is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF v_event.fact_base_amount_usd_cents IS NULL
     OR v_event.fact_base_amount_usd_cents <= 0
     OR v_event.fact_charged_amount_minor IS NULL
     OR v_event.fact_charged_amount_minor <= 0
     OR v_event.fact_charged_currency IS DISTINCT FROM
       v_original.charged_currency
     OR v_event.fact_conversion_rate IS DISTINCT FROM
       v_original.conversion_rate
     OR v_event.fact_charged_amount_minor IS DISTINCT FROM
       round(
         v_event.fact_base_amount_usd_cents *
           v_event.fact_conversion_rate
       ) THEN
    RAISE EXCEPTION 'Financial adjustment typed amounts are invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT movement.*
  INTO v_existing
  FROM public.sponsorship_financial_movements movement
  WHERE movement.provider = v_event.provider
    AND movement.provider_account_scope = v_event.provider_account_scope
    AND movement.provider_movement_type = v_event.fact_provider_movement_type
    AND movement.provider_movement_id = v_event.fact_provider_movement_id
    AND movement.entry_kind = v_kind
  FOR SHARE;

  IF FOUND THEN
    IF v_existing.original_financial_movement_id IS DISTINCT FROM v_original.id
       OR v_existing.payment_attempt_id IS DISTINCT FROM
         v_original.payment_attempt_id
       OR v_existing.sponsorship_intent_id IS DISTINCT FROM
         v_original.sponsorship_intent_id
       OR v_existing.sponsor_identity_id IS DISTINCT FROM
         v_original.sponsor_identity_id
       OR v_existing.payment_mode IS DISTINCT FROM v_original.payment_mode
       OR v_existing.base_amount_usd_cents IS DISTINCT FROM
         v_event.fact_base_amount_usd_cents
       OR v_existing.charged_amount_minor IS DISTINCT FROM
         v_event.fact_charged_amount_minor
       OR v_existing.charged_currency IS DISTINCT FROM
         v_event.fact_charged_currency
       OR v_existing.conversion_rate IS DISTINCT FROM
         v_event.fact_conversion_rate THEN
      RAISE EXCEPTION 'Provider adjustment movement conflicts with another payment chain'
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.payment_gateway_event_applications (
      gateway_event_id,
      effect,
      financial_movement_id,
      summary
    )
    VALUES (
      v_event.id,
      'duplicate_movement',
      v_existing.id,
      jsonb_build_object(
        'provider', v_event.provider::text,
        'provider_account_scope', v_event.provider_account_scope,
        'event_type', v_event.event_type,
        'operation', 'duplicate_movement',
        'original_financial_movement_id', v_original.id
      )
    )
    RETURNING * INTO v_application;

    UPDATE public.payment_gateway_events
    SET
      processing_status = 'ignored',
      ignored_reason = 'Duplicate verified provider adjustment movement',
      processing_lease_token = NULL
    WHERE id = v_event.id;

    SELECT
      sum(movement.net_base_amount_usd_cents),
      sum(movement.net_charged_amount_minor)
    INTO v_new_net_base, v_new_net_charged
    FROM public.sponsorship_financial_movements movement
    WHERE movement.id = v_original.id
       OR movement.original_financial_movement_id = v_original.id;

    RETURN QUERY SELECT
      v_event.id,
      v_original.id,
      v_existing.id,
      NULL::uuid,
      NULL::uuid,
      v_application.effect,
      v_new_net_base,
      v_new_net_charged;
    RETURN;
  END IF;

  IF v_kind = 'sponsorship_dispute_credit' THEN
    SELECT
      COALESCE(sum(
        CASE movement.entry_kind
          WHEN 'sponsorship_dispute_debit' THEN movement.base_amount_usd_cents
          WHEN 'sponsorship_dispute_credit' THEN -movement.base_amount_usd_cents
          ELSE 0
        END
      ), 0),
      COALESCE(sum(
        CASE movement.entry_kind
          WHEN 'sponsorship_dispute_debit' THEN movement.charged_amount_minor
          WHEN 'sponsorship_dispute_credit' THEN -movement.charged_amount_minor
          ELSE 0
        END
      ), 0)
    INTO
      v_dispute_outstanding_base,
      v_dispute_outstanding_charged
    FROM public.sponsorship_financial_movements movement
    WHERE movement.original_financial_movement_id = v_original.id
      AND movement.provider = v_event.provider
      AND movement.provider_account_scope = v_event.provider_account_scope
      AND movement.provider_movement_type = v_event.fact_provider_movement_type
      AND movement.provider_movement_id = v_event.fact_provider_movement_id
      AND movement.entry_kind IN (
        'sponsorship_dispute_debit',
        'sponsorship_dispute_credit'
      );

    IF v_event.fact_base_amount_usd_cents > v_dispute_outstanding_base
       OR v_event.fact_charged_amount_minor >
         v_dispute_outstanding_charged THEN
      RAISE EXCEPTION 'Dispute reinstatement exceeds the verified outstanding dispute debit'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT
    sum(movement.net_base_amount_usd_cents),
    sum(movement.net_charged_amount_minor)
  INTO v_current_net_base, v_current_net_charged
  FROM public.sponsorship_financial_movements movement
  WHERE movement.id = v_original.id
     OR movement.original_financial_movement_id = v_original.id;

  v_signed_base := CASE
    WHEN v_kind IN (
      'sponsorship_refund',
      'sponsorship_reversal',
      'sponsorship_dispute_debit'
    ) THEN -v_event.fact_base_amount_usd_cents
    ELSE v_event.fact_base_amount_usd_cents
  END;
  v_signed_charged := CASE
    WHEN v_kind IN (
      'sponsorship_refund',
      'sponsorship_reversal',
      'sponsorship_dispute_debit'
    ) THEN -v_event.fact_charged_amount_minor
    ELSE v_event.fact_charged_amount_minor
  END;
  v_new_net_base := v_current_net_base + v_signed_base;
  v_new_net_charged := v_current_net_charged + v_signed_charged;

  IF v_new_net_base < 0
     OR v_new_net_base > v_original.base_amount_usd_cents
     OR v_new_net_charged < 0
     OR v_new_net_charged > v_original.charged_amount_minor THEN
    RAISE EXCEPTION 'Financial adjustment would move aggregate net outside the original gross payment'
      USING ERRCODE = '23514';
  END IF;

  PERFORM private.set_payment_audit_context(
    'apply_sponsorship_financial_adjustment',
    v_event.provider,
    v_event.provider_account_scope,
    v_event.event_type,
    v_event.provider_event_id,
    context_request_id,
    context_trace_id,
    context_client_ip,
    context_user_agent
  );

  INSERT INTO public.sponsorship_financial_movements (
    source_gateway_event_id,
    payment_attempt_id,
    sponsorship_intent_id,
    sponsor_identity_id,
    provider,
    provider_account_scope,
    provider_movement_type,
    provider_movement_id,
    entry_kind,
    payment_mode,
    base_amount_usd_cents,
    charged_amount_minor,
    charged_currency,
    conversion_rate,
    occurred_at,
    original_financial_movement_id
  )
  VALUES (
    v_event.id,
    v_original.payment_attempt_id,
    v_original.sponsorship_intent_id,
    v_original.sponsor_identity_id,
    v_original.provider,
    v_original.provider_account_scope,
    v_event.fact_provider_movement_type,
    v_event.fact_provider_movement_id,
    v_kind,
    v_original.payment_mode,
    v_event.fact_base_amount_usd_cents,
    v_event.fact_charged_amount_minor,
    v_event.fact_charged_currency,
    v_event.fact_conversion_rate,
    v_event.occurred_at,
    v_original.id
  )
  ON CONFLICT (
    provider,
    provider_account_scope,
    provider_movement_type,
    provider_movement_id,
    entry_kind
  ) DO NOTHING
  RETURNING * INTO v_movement;

  IF v_movement.id IS NULL THEN
    SELECT movement.*
    INTO v_existing
    FROM public.sponsorship_financial_movements movement
    WHERE movement.provider = v_event.provider
      AND movement.provider_account_scope = v_event.provider_account_scope
      AND movement.provider_movement_type = v_event.fact_provider_movement_type
      AND movement.provider_movement_id = v_event.fact_provider_movement_id
      AND movement.entry_kind = v_kind
    FOR SHARE;

    IF NOT FOUND
       OR v_existing.original_financial_movement_id IS DISTINCT FROM v_original.id
       OR v_existing.base_amount_usd_cents IS DISTINCT FROM
         v_event.fact_base_amount_usd_cents
       OR v_existing.charged_amount_minor IS DISTINCT FROM
         v_event.fact_charged_amount_minor THEN
      RAISE EXCEPTION 'Provider adjustment movement identity is conflicting or unavailable'
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.payment_gateway_event_applications (
      gateway_event_id,
      effect,
      financial_movement_id,
      summary
    )
    VALUES (
      v_event.id,
      'duplicate_movement',
      v_existing.id,
      jsonb_build_object(
        'provider', v_event.provider::text,
        'provider_account_scope', v_event.provider_account_scope,
        'event_type', v_event.event_type,
        'operation', 'duplicate_movement',
        'original_financial_movement_id', v_original.id
      )
    )
    RETURNING * INTO v_application;

    UPDATE public.payment_gateway_events
    SET
      processing_status = 'ignored',
      ignored_reason = 'Duplicate verified provider adjustment movement',
      processing_lease_token = NULL
    WHERE id = v_event.id;

    RETURN QUERY SELECT
      v_event.id,
      v_original.id,
      v_existing.id,
      NULL::uuid,
      NULL::uuid,
      v_application.effect,
      v_current_net_base,
      v_current_net_charged;
    RETURN;
  END IF;

  SELECT intent.*
  INTO v_intent
  FROM public.sponsorship_intents intent
  WHERE intent.id = v_original.sponsorship_intent_id
  FOR SHARE;

  INSERT INTO public.transaction_ledger (
    user_id,
    beneficiary_id,
    credit,
    customer_email,
    customer_name,
    reference,
    description,
    tx_action,
    subscription_type,
    customer_id,
    payment_intent,
    payment_method_id,
    charged_amount,
    charged_currency,
    conversion_rate,
    provider_event_id,
    subscription_id,
    sponsorship_intent_id,
    sponsor_identity_id,
    payment_attempt_id,
    gateway_event_id,
    payment_provider,
    provider_account_scope,
    provider_movement_type,
    provider_movement_id,
    financial_entry_kind,
    financial_movement_id,
    base_amount_usd_cents,
    provider_occurred_at
  )
  VALUES (
    v_intent.auth_user_id,
    v_intent.beneficiary_id,
    v_movement.net_base_amount_usd_cents::integer,
    NULL,
    NULL,
    v_event.fact_provider_movement_id,
    CASE v_kind
      WHEN 'sponsorship_refund' THEN 'Verified sponsorship refund'
      WHEN 'sponsorship_reversal' THEN 'Verified sponsorship reversal'
      WHEN 'sponsorship_dispute_debit' THEN 'Verified sponsorship dispute debit'
      ELSE 'Verified sponsorship dispute credit'
    END,
    'SPONSORSHIP_ADJUSTMENT',
    COALESCE(v_intent.recurrence_interval, 'one_time'),
    NULL,
    NULL,
    NULL,
    v_movement.charged_amount_minor::integer,
    v_movement.charged_currency,
    v_movement.conversion_rate,
    v_event.provider_event_id,
    NULL,
    v_intent.id,
    v_intent.sponsor_identity_id,
    v_original.payment_attempt_id,
    v_event.id,
    v_event.provider,
    v_event.provider_account_scope,
    v_movement.provider_movement_type,
    v_movement.provider_movement_id,
    v_movement.entry_kind,
    v_movement.id,
    v_movement.base_amount_usd_cents,
    v_movement.occurred_at
  )
  RETURNING * INTO v_ledger;

  v_effect := CASE v_kind
    WHEN 'sponsorship_refund' THEN 'refund_applied'
    WHEN 'sponsorship_reversal' THEN 'reversal_applied'
    WHEN 'sponsorship_dispute_debit' THEN 'dispute_debit_applied'
    ELSE 'dispute_credit_applied'
  END;

  INSERT INTO public.payment_gateway_event_applications (
    gateway_event_id,
    effect,
    financial_movement_id,
    summary
  )
  VALUES (
    v_event.id,
    v_effect,
    v_movement.id,
    jsonb_build_object(
      'provider', v_event.provider::text,
      'provider_account_scope', v_event.provider_account_scope,
      'event_type', v_event.event_type,
      'operation', v_effect::text,
      'original_financial_movement_id', v_original.id,
      'signed_base_amount_usd_cents', v_signed_base,
      'signed_charged_amount_minor', v_signed_charged,
      'net_base_amount_usd_cents', v_new_net_base,
      'net_charged_amount_minor', v_new_net_charged
    )
  )
  RETURNING * INTO v_application;

  IF v_kind IN ('sponsorship_refund', 'sponsorship_reversal')
     AND v_new_net_base = 0
     AND v_new_net_charged = 0 THEN
    INSERT INTO public.sponsorship_refund_requirement_resolutions (
      refund_requirement_id,
      original_financial_movement_id,
      resolving_gateway_event_id,
      resolving_financial_movement_id,
      resolution_kind,
      final_net_base_amount_usd_cents,
      final_net_charged_amount_minor,
      evidence
    )
    SELECT
      requirement.id,
      v_original.id,
      v_event.id,
      v_movement.id,
      v_kind,
      v_new_net_base,
      v_new_net_charged,
      jsonb_build_object(
        'provider', v_event.provider::text,
        'provider_account_scope', v_event.provider_account_scope,
        'provider_event_id', v_event.provider_event_id,
        'original_financial_movement_id', v_original.id,
        'resolving_financial_movement_id', v_movement.id
      )
    FROM public.sponsorship_refund_requirements requirement
    WHERE requirement.financial_movement_id = v_original.id
    ON CONFLICT (refund_requirement_id) DO NOTHING
    RETURNING * INTO v_resolution;
  END IF;

  UPDATE public.payment_gateway_events
  SET
    processing_status = 'processed',
    processing_lease_token = NULL
  WHERE id = v_event.id;

  RETURN QUERY SELECT
    v_event.id,
    v_original.id,
    v_movement.id,
    v_ledger.id,
    v_resolution.id,
    v_application.effect,
    v_new_net_base,
    v_new_net_charged;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_sponsorship_financial_adjustment_kind(
  public.sponsorship_method,
  text,
  text,
  text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION private.protect_financial_adjustment_event_link()
  FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ingest_verified_sponsorship_financial_adjustment(
  uuid,
  public.sponsorship_method,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
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

REVOKE ALL ON FUNCTION public.apply_sponsorship_financial_adjustment(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_verified_sponsorship_financial_adjustment(
  uuid,
  public.sponsorship_method,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
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

GRANT EXECUTE ON FUNCTION public.apply_sponsorship_financial_adjustment(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

COMMENT ON COLUMN public.payment_gateway_events.original_financial_movement_id IS
  'Immutable gross sponsorship payment linked to a verified refund, reversal, or dispute event.';

COMMENT ON COLUMN public.sponsorship_financial_movements.net_base_amount_usd_cents IS
  'Canonical signed USD contribution of this immutable movement. Gross and dispute credits are positive. Refunds, reversals, and dispute debits are negative.';

COMMENT ON COLUMN public.sponsorship_financial_movements.net_charged_amount_minor IS
  'Canonical signed contribution in the original charged currency minor units.';

COMMENT ON TABLE public.sponsorship_refund_requirement_resolutions IS
  'Append-only evidence that a refund-required gross sponsorship payment was fully offset by a verified refund or reversal.';

COMMENT ON FUNCTION public.ingest_verified_sponsorship_financial_adjustment(
  uuid,
  public.sponsorship_method,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  public.payment_currency,
  numeric,
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
  'Ingests one verified provider financial adjustment against an immutable gross sponsorship movement. Exact replays are idempotent and conflicting replays are rejected.';

COMMENT ON FUNCTION public.apply_sponsorship_financial_adjustment(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) IS
  'Lease-fenced service boundary that appends one offsetting financial movement and signed ledger entry without changing attribution or subscription lifecycle.';

COMMIT;
