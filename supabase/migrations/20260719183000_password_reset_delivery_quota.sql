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

CREATE OR REPLACE FUNCTION public.reserve_sponsor_passwordless_email_delivery(
  target_recipient_digest bytea,
  target_recipient_normalization_version smallint,
  target_recipient_hmac_key_version smallint,
  target_source_digest bytea,
  target_source_hmac_key_version smallint,
  delivery_flow text,
  context_request_id text,
  context_trace_id text DEFAULT NULL
)
RETURNS TABLE (delivery_allowed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_trace_id text := NULLIF(pg_catalog.btrim(context_trace_id), '');
  v_is_public_flow boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Sponsor passwordless delivery reservation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF target_recipient_digest IS NULL
     OR pg_catalog.octet_length(target_recipient_digest) <> 32
     OR target_recipient_normalization_version IS NULL
     OR target_recipient_normalization_version <= 0
     OR target_recipient_hmac_key_version IS NULL
     OR target_recipient_hmac_key_version <= 0
     OR target_source_digest IS NULL
     OR pg_catalog.octet_length(target_source_digest) <> 32
     OR target_source_hmac_key_version IS NULL
     OR target_source_hmac_key_version <= 0
     OR delivery_flow IS NULL
     OR delivery_flow NOT IN (
       'generic-sign-in',
       'registration',
       'password-reset',
       'reauthentication',
       'initial-claim',
       'account-claim'
     )
     OR context_request_id IS NULL
     OR context_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR (
       v_trace_id IS NOT NULL
       AND (
         pg_catalog.octet_length(v_trace_id) > 255
         OR v_trace_id ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'Sponsor passwordless delivery reservation is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_is_public_flow := delivery_flow IN (
    'generic-sign-in',
    'registration',
    'password-reset'
  );

  /*
   * This short transaction-wide mutex makes every count and insertion one
   * atomic global decision. Authentication mail volume is intentionally small,
   * so correctness is worth the sub-millisecond serialization point.
   */
  PERFORM pg_catalog.pg_advisory_xact_lock(1129530707, 1701);

  DELETE FROM private.sponsor_passwordless_email_delivery_reservations
  WHERE requested_at < v_now - interval '24 hours';

  IF EXISTS (
       SELECT 1
       FROM private.sponsor_passwordless_email_delivery_reservations reservation
       WHERE reservation.recipient_digest = target_recipient_digest
         AND reservation.recipient_normalization_version =
           target_recipient_normalization_version
         AND reservation.recipient_hmac_key_version =
           target_recipient_hmac_key_version
         AND reservation.single_flight_expires_at > v_now
         AND (
           v_is_public_flow
           OR reservation.delivery_flow NOT IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
         )
     )
     OR (
       SELECT count(*)
       FROM private.sponsor_passwordless_email_delivery_reservations reservation
       WHERE reservation.recipient_digest = target_recipient_digest
         AND reservation.recipient_normalization_version =
           target_recipient_normalization_version
         AND reservation.recipient_hmac_key_version =
           target_recipient_hmac_key_version
         AND reservation.requested_at > v_now - interval '10 minutes'
     ) >= 4
     OR (
       SELECT count(*)
       FROM private.sponsor_passwordless_email_delivery_reservations reservation
       WHERE reservation.recipient_digest = target_recipient_digest
         AND reservation.recipient_normalization_version =
           target_recipient_normalization_version
         AND reservation.recipient_hmac_key_version =
           target_recipient_hmac_key_version
         AND reservation.requested_at > v_now - interval '24 hours'
     ) >= 12
     OR (
       v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.recipient_digest = target_recipient_digest
           AND reservation.recipient_normalization_version =
             target_recipient_normalization_version
           AND reservation.recipient_hmac_key_version =
             target_recipient_hmac_key_version
           AND reservation.delivery_flow IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '10 minutes'
       ) >= 2
     )
     OR (
       v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.recipient_digest = target_recipient_digest
           AND reservation.recipient_normalization_version =
             target_recipient_normalization_version
           AND reservation.recipient_hmac_key_version =
             target_recipient_hmac_key_version
           AND reservation.delivery_flow IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '24 hours'
       ) >= 6
     )
     OR (
       NOT v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.recipient_digest = target_recipient_digest
           AND reservation.recipient_normalization_version =
             target_recipient_normalization_version
           AND reservation.recipient_hmac_key_version =
             target_recipient_hmac_key_version
           AND reservation.delivery_flow NOT IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '10 minutes'
       ) >= 3
     )
     OR (
       NOT v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.recipient_digest = target_recipient_digest
           AND reservation.recipient_normalization_version =
             target_recipient_normalization_version
           AND reservation.recipient_hmac_key_version =
             target_recipient_hmac_key_version
           AND reservation.delivery_flow NOT IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '24 hours'
       ) >= 10
     )
     OR (
       SELECT count(*)
       FROM private.sponsor_passwordless_email_delivery_reservations reservation
       WHERE reservation.source_digest = target_source_digest
         AND reservation.source_hmac_key_version = target_source_hmac_key_version
         AND reservation.requested_at > v_now - interval '10 minutes'
     ) >= 40
     OR (
       SELECT count(*)
       FROM private.sponsor_passwordless_email_delivery_reservations reservation
       WHERE reservation.source_digest = target_source_digest
         AND reservation.source_hmac_key_version = target_source_hmac_key_version
         AND reservation.requested_at > v_now - interval '24 hours'
     ) >= 240
     OR (
       v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.source_digest = target_source_digest
           AND reservation.source_hmac_key_version =
             target_source_hmac_key_version
           AND reservation.delivery_flow IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '10 minutes'
       ) >= 20
     )
     OR (
       v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.source_digest = target_source_digest
           AND reservation.source_hmac_key_version =
             target_source_hmac_key_version
           AND reservation.delivery_flow IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '24 hours'
       ) >= 120
     )
     OR (
       NOT v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.source_digest = target_source_digest
           AND reservation.source_hmac_key_version =
             target_source_hmac_key_version
           AND reservation.delivery_flow NOT IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '10 minutes'
       ) >= 30
     )
     OR (
       NOT v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.source_digest = target_source_digest
           AND reservation.source_hmac_key_version =
             target_source_hmac_key_version
           AND reservation.delivery_flow NOT IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '24 hours'
       ) >= 180
     )
     OR (
       v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.delivery_flow IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '1 hour'
       ) >= 700
     )
     OR (
       v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.delivery_flow IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '24 hours'
       ) >= 3500
     )
     OR (
       NOT v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.delivery_flow NOT IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '1 hour'
       ) >= 800
     )
     OR (
       NOT v_is_public_flow
       AND (
         SELECT count(*)
         FROM private.sponsor_passwordless_email_delivery_reservations
           reservation
         WHERE reservation.delivery_flow NOT IN (
             'generic-sign-in',
             'registration',
             'password-reset'
           )
           AND reservation.requested_at > v_now - interval '24 hours'
       ) >= 4000
     )
     OR (
       SELECT count(*)
       FROM private.sponsor_passwordless_email_delivery_reservations reservation
       WHERE reservation.requested_at > v_now - interval '1 hour'
     ) >= 1000
     OR (
       SELECT count(*)
       FROM private.sponsor_passwordless_email_delivery_reservations reservation
       WHERE reservation.requested_at > v_now - interval '24 hours'
     ) >= 5000 THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO private.sponsor_passwordless_email_delivery_reservations (
    recipient_digest,
    recipient_normalization_version,
    recipient_hmac_key_version,
    source_digest,
    source_hmac_key_version,
    delivery_flow,
    requested_at,
    single_flight_expires_at,
    request_id,
    trace_id
  ) VALUES (
    target_recipient_digest,
    target_recipient_normalization_version,
    target_recipient_hmac_key_version,
    target_source_digest,
    target_source_hmac_key_version,
    delivery_flow,
    v_now,
    v_now + interval '60 seconds',
    context_request_id,
    v_trace_id
  );

  RETURN QUERY SELECT true;
END;
$$;

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
