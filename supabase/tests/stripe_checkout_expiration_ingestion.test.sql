BEGIN;

SELECT plan(3);

SELECT lives_ok(
  $$SELECT private.validate_provider_event_type(
    'STRIPE',
    'checkout.session.expired',
    'checkout_session'
  )$$,
  'Stripe Checkout expiration is a supported durable event'
);

SELECT throws_ok(
  $$SELECT private.validate_provider_event_type(
    'STRIPE',
    'checkout.session.expired',
    'invoice'
  )$$,
  '22023',
  'Unsupported Stripe event and object type combination',
  'Stripe Checkout expiration cannot masquerade as an invoice event'
);

SELECT throws_ok(
  $$SELECT private.validate_provider_event_type(
    'STRIPE',
    'payment_intent.succeeded',
    'checkout_session'
  )$$,
  '22023',
  'Unsupported Stripe event and object type combination',
  'unregistered Stripe event types remain rejected'
);

SELECT * FROM finish();

ROLLBACK;
