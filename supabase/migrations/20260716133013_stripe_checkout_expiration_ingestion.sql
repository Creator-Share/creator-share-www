

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
