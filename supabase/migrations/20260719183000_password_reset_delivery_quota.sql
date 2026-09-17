BEGIN;

ALTER TABLE private.sponsor_passwordless_email_delivery_reservations
  ADD CONSTRAINT sponsor_passwordless_delivery_flow_check
  CHECK (
    delivery_flow IN (
      'generic-sign-in',
      'registration',
      'password-reset',
      'reauthentication',
      'initial-claim',
      'account-claim'
    )
  )
  NOT VALID;

ALTER TABLE private.sponsor_passwordless_email_delivery_reservations
  VALIDATE CONSTRAINT sponsor_passwordless_delivery_flow_check;

ALTER TABLE private.sponsor_passwordless_email_delivery_reservations
  DROP CONSTRAINT sponsor_passwordless_email_delivery_reserva_delivery_flow_check;

REVOKE ALL ON FUNCTION public.reserve_sponsor_passwordless_email_delivery(
  bytea,
  smallint,
  smallint,
  bytea,
  smallint,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_sponsor_passwordless_email_delivery(
  bytea,
  smallint,
  smallint,
  bytea,
  smallint,
  text,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.reserve_sponsor_passwordless_email_delivery(
  bytea,
  smallint,
  smallint,
  bytea,
  smallint,
  text,
  text,
  text
) IS
  'Service-only atomic recipient, trusted-source, flow-class, and global delivery reservation for sponsor authentication email. Public sign-in, registration, and password reset cannot consume capacity reserved for database-validated claims and authenticated reauthentication. A false result is intentionally indistinguishable at the public HTTP boundary.';

COMMIT;
