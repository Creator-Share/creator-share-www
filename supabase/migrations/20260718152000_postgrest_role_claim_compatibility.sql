/*
 * Current PostgREST versions expose request roles through the consolidated
 * request.jwt.claims object. auth.role() supports that shape as well as the
 * legacy scalar claim. Runtime service guards must trust a presented claim
 * before considering the narrow fallback for direct PostgreSQL maintenance.
 */

BEGIN;

CREATE OR REPLACE FUNCTION private.require_payment_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Payment transaction RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Payment transaction RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.require_data_retention_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Data retention RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Data retention RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.require_advocate_logo_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Advocate logo RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Advocate logo RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.require_advocate_invitation_service_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role text := nullif(auth.role(), '');
BEGIN
  IF v_jwt_role IS NOT NULL THEN
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Advocate invitation service role is required'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Advocate invitation service role is required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.require_payment_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_data_retention_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_advocate_logo_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.require_advocate_invitation_service_role()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
