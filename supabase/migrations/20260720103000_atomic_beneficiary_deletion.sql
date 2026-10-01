-- Related content must survive any failed beneficiary deletion. In particular,
-- financial foreign keys remain authoritative and may reject the final delete.
CREATE FUNCTION public.delete_creator_share_beneficiaries(
  target_beneficiary_ids uuid[],
  request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_actor_user_id uuid;
  v_session_id text;
  v_media jsonb;
  v_deleted_count bigint;
BEGIN
  v_actor_user_id := private.require_healthy_creator_share_super_admin(
    'delete_beneficiaries'
  );
  v_session_id := private.require_active_signed_auth_session_id(v_actor_user_id);

  IF request_id IS NULL
     OR target_beneficiary_ids IS NULL
     OR cardinality(target_beneficiary_ids) NOT BETWEEN 1 AND 500
     OR array_position(target_beneficiary_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'A bounded list of beneficiary identifiers is required'
      USING ERRCODE = '22023';
  END IF;

  -- A concurrent financial reference must settle before this decision, or wait
  -- until deletion commits and fail its own FK check. Lock in stable order.
  PERFORM beneficiary.id
  FROM public.beneficiaries beneficiary
  WHERE beneficiary.id = ANY(target_beneficiary_ids)
  ORDER BY beneficiary.id
  FOR UPDATE;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_actor_user_id,
    context_tool => 'creator-share-beneficiary-deletion',
    context_request_id => request_id::text,
    context_session_id => v_session_id,
    context_reason => 'Delete selected beneficiary records',
    context_metadata => jsonb_build_object('operation', 'delete_beneficiaries')
  );

  DELETE FROM public.activities activity
  WHERE activity.beneficiary_id = ANY(target_beneficiary_ids);

  WITH removed AS (
    DELETE FROM public.media media
    WHERE media.parent_id = ANY(target_beneficiary_ids)
    RETURNING media.id, media.parent_id, media.type, media.extension
  )
  SELECT coalesce(jsonb_agg(to_jsonb(removed) ORDER BY removed.id), '[]'::jsonb)
  INTO v_media
  FROM removed;

  DELETE FROM public.beneficiaries beneficiary
  WHERE beneficiary.id = ANY(target_beneficiary_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- One JSON result avoids PostgREST row limits truncating cleanup candidates.
  -- No candidate can reach a storage caller if any statement above rolls back.
  RETURN jsonb_build_object('deleted_count', v_deleted_count, 'media', v_media);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_creator_share_beneficiaries(uuid[], uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_creator_share_beneficiaries(uuid[], uuid)
  TO authenticated;
