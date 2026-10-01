BEGIN;

/*
 * The browser authenticates the delegate before the application crosses into
 * these service-role RPCs. That first check is necessary, but it is not the
 * mutation authority. Lock and revalidate the account, membership, and exact
 * role evidence in the same transaction that creates a logo reservation or
 * changes branding.
 */

ALTER FUNCTION public.reserve_advocate_logo_upload(
  uuid,
  uuid,
  bigint,
  text,
  text
)
  SET SCHEMA private;

ALTER FUNCTION private.reserve_advocate_logo_upload(
  uuid,
  uuid,
  bigint,
  text,
  text
)
  RENAME TO reserve_advocate_logo_upload_unguarded_v1;

ALTER FUNCTION public.update_advocate_branding(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
  SET SCHEMA private;

ALTER FUNCTION private.update_advocate_branding(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
)
  RENAME TO update_advocate_branding_unguarded_v1;

REVOKE ALL ON FUNCTION private.reserve_advocate_logo_upload_unguarded_v1(
  uuid,
  uuid,
  bigint,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.update_advocate_branding_unguarded_v1(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.lock_advocate_branding_actor_authority(
  target_advocate_id uuid,
  target_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership public.advocate_memberships%ROWTYPE;
BEGIN
  PERFORM 1
  FROM auth.users account
  WHERE account.id = target_actor_user_id
    AND account.email IS NOT NULL
    AND account.email_confirmed_at IS NOT NULL
    AND account.deleted_at IS NULL
    AND account.is_anonymous IS NOT TRUE
    AND (
      account.banned_until IS NULL
      OR account.banned_until <= clock_timestamp()
    )
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.user_id = target_actor_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_membership.status <> 'active' THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.advocate_membership_roles membership_role
  JOIN public.advocate_role_permissions role_permission
    ON role_permission.role_id = membership_role.role_id
  JOIN public.advocate_permissions permission
    ON permission.id = role_permission.permission_id
  WHERE membership_role.advocate_id = v_membership.advocate_id
    AND membership_role.membership_id = v_membership.id
    AND permission.key = 'portal.branding.update'
  FOR SHARE OF membership_role, role_permission, permission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.lock_advocate_branding_actor_authority(
  uuid,
  uuid
) IS
  'Locks and revalidates one healthy account, active tenant membership, and exact branding permission after the advocate root lock. It is callable only from the service-only public wrappers.';

REVOKE ALL ON FUNCTION private.lock_advocate_branding_actor_authority(
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_advocate_logo_upload(
  target_advocate_id uuid,
  target_actor_user_id uuid,
  expected_advocate_version bigint,
  request_id text,
  trace_id text DEFAULT NULL
)
RETURNS TABLE (
  reservation_id uuid,
  object_path text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_advocate_id IS NULL
     OR target_actor_user_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1
     OR v_request_id IS NULL
     OR char_length(v_request_id) > 255
     OR char_length(COALESCE(v_trace_id, '')) > 255 THEN
    RAISE EXCEPTION 'Logo reservation input is malformed'
      USING ERRCODE = '22023';
  END IF;

  -- Keep the established cross-tenant per-actor serialization first.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'advocate-logo-actor:' || target_actor_user_id::text,
      0
    )
  );

  PERFORM 1
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM private.lock_advocate_branding_actor_authority(
    target_advocate_id,
    target_actor_user_id
  );

  RETURN QUERY
  SELECT internal.reservation_id, internal.object_path, internal.expires_at
  FROM private.reserve_advocate_logo_upload_unguarded_v1(
    target_advocate_id,
    target_actor_user_id,
    expected_advocate_version,
    request_id,
    trace_id
  ) internal;
END;
$$;

COMMENT ON FUNCTION public.reserve_advocate_logo_upload(
  uuid,
  uuid,
  bigint,
  text,
  text
) IS
  'Service-only logo reservation with stable per-actor serialization and transaction-locked healthy account, active membership, and exact branding permission authority.';

CREATE FUNCTION public.update_advocate_branding(
  target_advocate_id uuid,
  target_actor_user_id uuid,
  expected_advocate_version bigint,
  target_primary_color text,
  target_accent_color text,
  target_logo_storage_path text,
  target_logo_upload_reservation_id uuid,
  target_logo_alt_text text,
  target_opening_header_html text,
  target_about_biography_html text,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_result bigint;
BEGIN
  PERFORM private.require_advocate_logo_service_role();

  IF target_advocate_id IS NULL
     OR target_actor_user_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'Branding mutation identity is malformed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM private.lock_advocate_branding_actor_authority(
    target_advocate_id,
    target_actor_user_id
  );

  SELECT private.update_advocate_branding_unguarded_v1(
    target_advocate_id,
    target_actor_user_id,
    expected_advocate_version,
    target_primary_color,
    target_accent_color,
    target_logo_storage_path,
    target_logo_upload_reservation_id,
    target_logo_alt_text,
    target_opening_header_html,
    target_about_biography_html,
    change_reason,
    request_id,
    trace_id,
    session_id
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.update_advocate_branding(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Service-only tenant-locked branding replacement with transaction-locked healthy account, active membership, and exact branding permission authority before the existing atomic mutation boundary.';

REVOKE ALL ON FUNCTION public.reserve_advocate_logo_upload(
  uuid,
  uuid,
  bigint,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_advocate_branding(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reserve_advocate_logo_upload(
  uuid,
  uuid,
  bigint,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.update_advocate_branding(
  uuid,
  uuid,
  bigint,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO service_role;

COMMIT;
