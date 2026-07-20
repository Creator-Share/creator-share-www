BEGIN;

/*
 * Password recovery is the one sponsor email proof flow that must be
 * single-use. The existing receipt already binds a successful server-side
 * email proof to one healthy Auth user, one live Auth session, and a fixed
 * fifteen minute lifetime. This boundary consumes that exact receipt before
 * the password provider is allowed to mutate credentials.
 */
CREATE OR REPLACE FUNCTION public.consume_password_recovery_authorization()
RETURNS TABLE (
  authorized_auth_user_id uuid,
  authorized_auth_session_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_session_id uuid;
  v_session_id_text text;
  v_deleted_auth_user_id uuid;
  v_deleted_auth_session_id uuid;
BEGIN
  /*
   * This helper validates the provider-signed JWT user, JWT session, AAL,
   * token issuance time, live auth.sessions row, healthy auth.users row, and
   * unexpired fifteen minute email authentication receipt in one transaction.
   */
  v_session_id_text := private.require_recent_sponsor_email_authentication();

  BEGIN
    v_session_id := v_session_id_text::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_session_id := NULL;
  END;

  IF v_auth_user_id IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION
      'recent-verification-required: verify your email again to continue'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM private.sponsor_email_authentication_receipts receipt
  WHERE receipt.auth_session_id = v_session_id
    AND receipt.auth_user_id = v_auth_user_id
    AND receipt.expires_at > clock_timestamp()
  RETURNING receipt.auth_user_id, receipt.auth_session_id
  INTO v_deleted_auth_user_id, v_deleted_auth_session_id;

  IF NOT FOUND
     OR v_deleted_auth_user_id IS DISTINCT FROM v_auth_user_id
     OR v_deleted_auth_session_id IS DISTINCT FROM v_session_id THEN
    RAISE EXCEPTION
      'recent-verification-required: verify your email again to continue'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_deleted_auth_user_id, v_deleted_auth_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_password_recovery_authorization()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_password_recovery_authorization()
  TO authenticated;

COMMENT ON FUNCTION public.consume_password_recovery_authorization() IS
  'Atomically consumes the caller exact session-bound fifteen minute server-recorded email proof before one password recovery mutation. Replay and every mismatched, expired, ordinary, or unhealthy session fail closed.';

COMMIT;
