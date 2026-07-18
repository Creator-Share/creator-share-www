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
          AND redacted_payload @> '{"quarantine": true}'::jsonb
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

REVOKE ALL ON FUNCTION private.resolve_sponsorship_financial_adjustment_kind(
  public.sponsorship_method,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON CONSTRAINT payment_gateway_events_financial_adjustment_link_check
  ON public.payment_gateway_events IS
  'Requires typed financial adjustments to link an immutable gross movement. Verified events that cannot be linked may only enter through the fact-free durable quarantine shape.';

COMMENT ON FUNCTION private.resolve_sponsorship_financial_adjustment_kind(
  public.sponsorship_method,
  text,
  text,
  text
) IS
  'Maps supported provider adjustment event and object pairs to one canonical signed financial movement kind, including successful Stripe refund updates.';

COMMIT;
