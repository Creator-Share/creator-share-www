BEGIN;

/*
 * A quote idempotency key identifies one immutable checkout quote globally.
 * Exact retries recover that quote after payment has begun. A different
 * intent, provider scope, or set of financial terms cannot reuse the key.
 */

REVOKE ALL ON FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.issue_sponsorship_payment_quote(
  uuid,
  public.sponsorship_method,
  text,
  text,
  interval,
  text,
  text
) IS
  'Issues one immutable provider scoped quote per global idempotency key, and recovers an exact quote after checkout begins without changing terms or expiry.';

COMMIT;
