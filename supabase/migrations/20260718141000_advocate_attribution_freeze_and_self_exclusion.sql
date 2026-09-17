BEGIN;

/*
 * Attribution is decided when the server creates the sponsorship intent.
 * Verified payment success may finalize that decision, but it may not use
 * later browsing activity to rewrite the advocate, exposure, kind, or lag.
 */

REVOKE ALL ON FUNCTION private.finalize_sponsorship_attribution(
  uuid,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

/*
 * Creator Share staff and members of the portal they are viewing are not
 * audience traffic. Their authenticated visits return no row and create no
 * browser visitor or exposure. Guest traffic and users from another portal
 * remain eligible under the existing qualification rules.
 */

COMMENT ON FUNCTION public.record_qualified_advocate_exposure(
  uuid,
  bytea,
  text,
  public.visitor_consent_state,
  text,
  text,
  uuid,
  text,
  text
) IS
  'Upserts one opaque 400 day browser visitor and appends one idempotent, server-qualified exposure for an exact active advocate domain. Authenticated Creator Share staff and same-portal members are silently excluded.';

REVOKE ALL ON FUNCTION public.record_qualified_advocate_exposure(
  uuid,
  bytea,
  text,
  public.visitor_consent_state,
  text,
  text,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.record_qualified_advocate_exposure(
  uuid,
  bytea,
  text,
  public.visitor_consent_state,
  text,
  text,
  uuid,
  text,
  text
) TO service_role;

COMMIT;
