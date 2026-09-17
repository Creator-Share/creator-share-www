/*
 * Current PostgREST versions expose request roles through the consolidated
 * request.jwt.claims object. auth.role() supports that shape as well as the
 * legacy scalar claim. Runtime service guards must trust a presented claim
 * before considering the narrow fallback for direct PostgreSQL maintenance.
 */

BEGIN;

REVOKE ALL ON FUNCTION private.require_payment_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_data_retention_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_advocate_logo_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_advocate_invitation_service_role()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
