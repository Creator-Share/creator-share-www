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

REVOKE ALL ON FUNCTION private.validate_provider_event_type(
  public.sponsorship_method,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.validate_provider_event_type(
  public.sponsorship_method,
  text,
  text
) IS
  'Restricts verified payment evidence to supported provider event and object pairs, including durable Stripe Checkout expiration evidence.';
