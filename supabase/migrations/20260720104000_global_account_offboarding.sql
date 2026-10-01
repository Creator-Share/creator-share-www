-- Offboarding retains identity and financial history while removing access.
-- Each target has one immutable receipt; repeating the command is harmless.
-- Historical actor identifiers do not prevent later approved Auth erasure.
CREATE TABLE audit.creator_share_account_offboardings (
  user_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  actor_session_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id <> actor_user_id)
);
ALTER TABLE audit.creator_share_account_offboardings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.creator_share_account_offboardings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit.creator_share_account_offboardings FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.prevent_account_offboarding_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Account offboarding receipts are immutable' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.prevent_account_offboarding_mutation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER account_offboarding_no_change BEFORE UPDATE OR DELETE
  ON audit.creator_share_account_offboardings FOR EACH ROW
  EXECUTE FUNCTION private.prevent_account_offboarding_mutation();
CREATE TRIGGER account_offboarding_no_truncate BEFORE TRUNCATE
  ON audit.creator_share_account_offboardings FOR EACH STATEMENT
  EXECUTE FUNCTION private.prevent_account_offboarding_mutation();

CREATE FUNCTION public.offboard_creator_share_accounts(target_user_ids uuid[], request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE
  v_actor uuid;
  v_session text;
  v_ids uuid[];
  v_found integer;
BEGIN
  v_actor := private.require_healthy_creator_share_super_admin('offboard_accounts');
  v_session := private.require_active_signed_auth_session_id(v_actor);
  IF request_id IS NULL OR target_user_ids IS NULL
     OR cardinality(target_user_ids) NOT BETWEEN 1 AND 500
     OR array_position(target_user_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'A bounded account selection is required' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_ids FROM unnest(target_user_ids) id;
  IF v_actor = ANY(v_ids) THEN
    RAISE EXCEPTION 'You cannot disable your own account' USING ERRCODE = '23514';
  END IF;

  -- Authority checks and all ownership commands share the administrator fence.
  -- Lock target accounts before testing ownership so redemption cannot race a ban.
  PERFORM account.id FROM auth.users account WHERE account.id = ANY(v_ids)
    ORDER BY account.id FOR UPDATE;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'A selected account does not exist' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.advocates advocate
    JOIN public.advocate_memberships owner ON owner.id = advocate.owner_membership_id
    WHERE owner.user_id = ANY(v_ids) AND advocate.relationship_status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Transfer Advocate ownership before disabling access' USING ERRCODE = '55000';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_actor,
    context_effective_user_id => v_actor,
    context_tool => 'creator-share-account-offboarding',
    context_request_id => request_id::text,
    context_session_id => v_session,
    context_reason => 'Administrator disabled account access',
    context_metadata => jsonb_build_object('operation', 'offboard_accounts')
  );

  -- GoTrue reads the ban; RLS and financial RPCs also recheck account health
  -- rather than relying on the expiry of an already-issued bearer token.
  UPDATE auth.users SET banned_until = greatest(banned_until, '9999-12-31 23:59:59+00'::timestamptz), updated_at = now()
    WHERE id = ANY(v_ids);
  DELETE FROM auth.sessions WHERE user_id = ANY(v_ids);
  DELETE FROM public.role_assignments WHERE user_id = ANY(v_ids);
  INSERT INTO audit.creator_share_account_offboardings(user_id, actor_user_id, actor_session_id, request_id)
    SELECT id, v_actor, v_session::uuid, request_id FROM unnest(v_ids) id
    ON CONFLICT (user_id) DO NOTHING;
  RETURN jsonb_build_object('disabled_count', cardinality(v_ids));
END;
$$;
REVOKE ALL ON FUNCTION public.offboard_creator_share_accounts(uuid[],uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offboard_creator_share_accounts(uuid[],uuid) TO authenticated;

-- A fixed administrative projection keeps managed Auth rows out of the Data API.
CREATE FUNCTION public.get_creator_share_disabled_accounts(target_user_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.require_healthy_creator_share_super_admin('read_disabled_accounts');
  IF target_user_ids IS NULL OR cardinality(target_user_ids) > 1000
     OR array_position(target_user_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid account selection' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(user_id ORDER BY user_id), '[]'::jsonb) INTO v_result
    FROM audit.creator_share_account_offboardings WHERE user_id = ANY(target_user_ids);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_share_disabled_accounts(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_share_disabled_accounts(uuid[]) TO authenticated;
