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
