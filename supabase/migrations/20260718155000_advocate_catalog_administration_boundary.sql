/*
 * Advocate catalog administration is an application-server boundary. The
 * browser supplies the desired ordered catalog to the application, while the
 * service supplies the verified actor and server-generated audit identifiers.
 */

BEGIN;

CREATE OR REPLACE FUNCTION private.require_advocate_catalog_service_role()
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
      RAISE EXCEPTION 'Advocate catalog RPCs require the service role'
        USING ERRCODE = '42501';
    END IF;
  ELSIF session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Advocate catalog RPCs require the service role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.require_advocate_catalog_service_role() IS
  'PostgREST-compatible service-role guard for advocate catalog administration RPCs.';

REVOKE ALL ON FUNCTION private.require_advocate_catalog_service_role()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.replace_advocate_beneficiary_configuration(
  uuid,
  bigint,
  public.advocate_beneficiary_mode,
  uuid[],
  uuid[],
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.replace_advocate_beneficiary_configuration(
  uuid,
  bigint,
  public.advocate_beneficiary_mode,
  uuid[],
  uuid[],
  text,
  text,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.read_advocate_catalog_administration(
  target_advocate_id uuid,
  acting_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate public.advocates%ROWTYPE;
  v_membership public.advocate_memberships%ROWTYPE;
  v_eligible_count integer;
  v_selected_count integer;
  v_result jsonb;
BEGIN
  PERFORM private.require_advocate_catalog_service_role();

  IF target_advocate_id IS NULL OR acting_user_id IS NULL THEN
    RAISE EXCEPTION 'Advocate catalog read input is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR SHARE;

  IF NOT FOUND OR v_advocate.relationship_status <> 'active' THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = acting_user_id
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
    AND membership.user_id = acting_user_id
  FOR SHARE;

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
    AND permission.key = 'portal.beneficiaries.manage'
  FOR SHARE OF membership_role, role_permission, permission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  /*
   * Candidate classification, bounds, ordered selections, and the response
   * are derived by one statement. PostgreSQL READ COMMITTED therefore cannot
   * combine counts from one snapshot with rows from a later snapshot.
   */
  WITH selections AS MATERIALIZED (
    SELECT
      selection.beneficiary_id,
      selection.is_featured,
      selection.display_order
    FROM public.advocate_beneficiaries selection
    WHERE selection.advocate_id = target_advocate_id
  ),
  classified AS MATERIALIZED (
    SELECT
      beneficiary.id,
      beneficiary.name,
      beneficiary.username,
      beneficiary.status,
      selection.beneficiary_id IS NOT NULL AS selected,
      selection.is_featured,
      selection.display_order,
      private.is_advocate_child_beneficiary_type(
        beneficiary.beneficiary_type
      ) AS child_type,
      private.is_public_beneficiary_projection_safe(
        beneficiary.name,
        beneficiary.username,
        beneficiary.biography,
        beneficiary.country,
        beneficiary.location_str,
        beneficiary.video_url,
        beneficiary.introduction,
        beneficiary.beneficiary_type
      ) AS projection_safe,
      private.is_advocate_child_eligible(
        beneficiary.status,
        beneficiary.budget_goal,
        beneficiary.goal_fulfilled_at,
        beneficiary.name,
        beneficiary.username,
        beneficiary.biography,
        beneficiary.country,
        beneficiary.location_str,
        beneficiary.video_url,
        beneficiary.introduction,
        beneficiary.beneficiary_type
      ) AS eligible
    FROM public.beneficiaries beneficiary
    LEFT JOIN selections selection
      ON selection.beneficiary_id = beneficiary.id
  ),
  candidates AS MATERIALIZED (
    SELECT
      classified.id,
      CASE
        WHEN classified.eligible THEN classified.name
        ELSE NULL
      END AS name,
      CASE
        WHEN classified.eligible THEN classified.username
        ELSE NULL
      END AS username,
      CASE
        WHEN classified.eligible THEN classified.status::text
        ELSE NULL
      END AS status,
      classified.eligible,
      CASE
        WHEN classified.eligible THEN NULL
        ELSE 'unavailable'
      END AS blocked_reason
    FROM classified
    WHERE classified.eligible OR classified.selected
  ),
  bounds AS MATERIALIZED (
    SELECT
      (SELECT count(*)::integer FROM classified WHERE eligible)
        AS eligible_count,
      (SELECT count(*)::integer FROM selections) AS selected_count
  )
  SELECT
    bounds.eligible_count,
    bounds.selected_count,
    CASE
      WHEN bounds.eligible_count <= 1000 AND bounds.selected_count <= 1000
        THEN jsonb_build_object(
          'advocate_version', v_advocate.version,
          'beneficiary_mode', v_advocate.beneficiary_mode::text,
          'beneficiary_selections', coalesce(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'beneficiary_id', selection.beneficiary_id,
                  'is_featured', selection.is_featured
                )
                ORDER BY
                  selection.display_order,
                  selection.beneficiary_id
              )
              FROM selections selection
            ),
            '[]'::jsonb
          ),
          'beneficiaries', coalesce(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', choice.id,
                  'name', choice.name,
                  'username', choice.username,
                  'status', choice.status,
                  'eligible', choice.eligible,
                  'blocked_reason', choice.blocked_reason
                )
                ORDER BY
                  lower(choice.name) COLLATE "C" NULLS LAST,
                  choice.name COLLATE "C" NULLS LAST,
                  choice.id
              )
              FROM candidates choice
            ),
            '[]'::jsonb
          ),
          'selection_limit', 1000
        )
      ELSE NULL
    END
  INTO v_eligible_count, v_selected_count, v_result
  FROM bounds;

  IF v_eligible_count > 1000 THEN
    RAISE EXCEPTION 'Eligible beneficiary catalog exceeds the administration boundary'
      USING ERRCODE = '54000';
  END IF;

  IF v_selected_count > 1000 THEN
    RAISE EXCEPTION 'Selected beneficiary catalog exceeds the administration boundary'
      USING ERRCODE = '54000';
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.read_advocate_catalog_administration(uuid, uuid) IS
  'Service only actor aware bounded single-snapshot catalog read. Returns version, mode, ordered selections, every safe eligible child, and an opaque repair record for each selected row that is no longer publicly eligible.';

REVOKE ALL ON FUNCTION public.read_advocate_catalog_administration(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_advocate_catalog_administration(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.replace_advocate_beneficiary_configuration(
  target_advocate_id uuid,
  acting_user_id uuid,
  expected_advocate_version bigint,
  target_beneficiary_mode public.advocate_beneficiary_mode,
  target_beneficiary_ids uuid[],
  target_featured_beneficiary_ids uuid[],
  change_reason text,
  request_id text,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL,
  client_ip text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate public.advocates%ROWTYPE;
  v_membership public.advocate_memberships%ROWTYPE;
  v_reason text := nullif(btrim(change_reason), '');
  v_request_id text := nullif(btrim(request_id), '');
  v_trace_id text := nullif(btrim(trace_id), '');
  v_session_id text := nullif(btrim(session_id), '');
  v_client_ip text := nullif(btrim(client_ip), '');
  v_user_agent text := nullif(btrim(user_agent), '');
  v_current_beneficiary_ids uuid[];
  v_current_featured_beneficiary_ids uuid[];
  v_eligible_count integer;
  v_resulting_version bigint;
BEGIN
  PERFORM private.require_advocate_catalog_service_role();

  IF target_advocate_id IS NULL
     OR acting_user_id IS NULL
     OR expected_advocate_version IS NULL
     OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'Beneficiary configuration input is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF target_beneficiary_mode IS NULL
     OR target_beneficiary_ids IS NULL
     OR target_featured_beneficiary_ids IS NULL
     OR coalesce(array_ndims(target_beneficiary_ids), 1) <> 1
     OR coalesce(array_ndims(target_featured_beneficiary_ids), 1) <> 1
     OR cardinality(target_beneficiary_ids) > 1000
     OR cardinality(target_featured_beneficiary_ids) > 1000
     OR array_position(target_beneficiary_ids, NULL) IS NOT NULL
     OR array_position(target_featured_beneficiary_ids, NULL) IS NOT NULL
     OR (
       SELECT count(DISTINCT requested.beneficiary_id)
       FROM unnest(target_beneficiary_ids) requested(beneficiary_id)
     ) <> cardinality(target_beneficiary_ids)
     OR (
       SELECT count(DISTINCT requested.beneficiary_id)
       FROM unnest(target_featured_beneficiary_ids) requested(beneficiary_id)
     ) <> cardinality(target_featured_beneficiary_ids) THEN
    RAISE EXCEPTION 'Beneficiary configuration requires at most 1000 ordered unique nonnull IDs'
      USING ERRCODE = '22023';
  END IF;

  IF NOT target_featured_beneficiary_ids <@ target_beneficiary_ids THEN
    RAISE EXCEPTION 'Featured beneficiaries must be a subset of selected beneficiaries'
      USING ERRCODE = '22023';
  END IF;

  IF target_beneficiary_mode = 'all'
     AND (
       cardinality(target_beneficiary_ids) <> 0
       OR cardinality(target_featured_beneficiary_ids) <> 0
     ) THEN
    RAISE EXCEPTION 'All mode does not accept stored beneficiary selections'
      USING ERRCODE = '22023';
  ELSIF target_beneficiary_mode = 'all_featured'
     AND (
       cardinality(target_beneficiary_ids) = 0
       OR NOT target_beneficiary_ids <@ target_featured_beneficiary_ids
     ) THEN
    RAISE EXCEPTION 'All featured mode requires one or more chosen beneficiaries and every chosen beneficiary must be featured'
      USING ERRCODE = '22023';
  ELSIF target_beneficiary_mode = 'selected'
     AND cardinality(target_beneficiary_ids) = 0 THEN
    RAISE EXCEPTION 'Selected mode requires at least one chosen beneficiary'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) > 500
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A beneficiary configuration reason between 1 and 500 characters without control characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_request_id IS NULL
     OR char_length(v_request_id) > 255
     OR v_request_id ~ '[[:cntrl:]]'
     OR char_length(coalesce(v_trace_id, '')) > 255
     OR coalesce(v_trace_id, '') ~ '[[:cntrl:]]'
     OR char_length(coalesce(v_session_id, '')) > 255
     OR coalesce(v_session_id, '') ~ '[[:cntrl:]]'
     OR char_length(coalesce(v_client_ip, '')) > 256
     OR coalesce(v_client_ip, '') ~ '[[:cntrl:]]'
     OR char_length(coalesce(v_user_agent, '')) > 1024
     OR coalesce(v_user_agent, '') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Beneficiary audit identifiers are malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND OR v_advocate.relationship_status <> 'active' THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users account
  WHERE account.id = acting_user_id
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
    AND membership.user_id = acting_user_id
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
    AND permission.key = 'portal.beneficiaries.manage'
  FOR SHARE OF membership_role, role_permission, permission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate settings changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  SELECT count(*)::integer
  INTO v_eligible_count
  FROM (
    SELECT beneficiary.id
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id = ANY(target_beneficiary_ids)
      AND private.is_advocate_child_eligible(
        beneficiary.status,
        beneficiary.budget_goal,
        beneficiary.goal_fulfilled_at,
        beneficiary.name,
        beneficiary.username,
        beneficiary.biography,
        beneficiary.country,
        beneficiary.location_str,
        beneficiary.video_url,
        beneficiary.introduction,
        beneficiary.beneficiary_type
      )
    ORDER BY beneficiary.id
    FOR SHARE
  ) locked_eligible_beneficiary;

  IF v_eligible_count <> cardinality(target_beneficiary_ids) THEN
    RAISE EXCEPTION 'Every configured beneficiary must currently be eligible for the advocate child catalog'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    coalesce(
      array_agg(
        selection.beneficiary_id
        ORDER BY selection.display_order, selection.beneficiary_id
      ),
      ARRAY[]::uuid[]
    ),
    coalesce(
      array_agg(
        selection.beneficiary_id
        ORDER BY selection.display_order, selection.beneficiary_id
      ) FILTER (WHERE selection.is_featured),
      ARRAY[]::uuid[]
    )
  INTO
    v_current_beneficiary_ids,
    v_current_featured_beneficiary_ids
  FROM public.advocate_beneficiaries selection
  WHERE selection.advocate_id = v_advocate.id;

  IF v_advocate.beneficiary_mode = target_beneficiary_mode
     AND v_current_beneficiary_ids = target_beneficiary_ids
     AND v_current_featured_beneficiary_ids <@ target_featured_beneficiary_ids
     AND target_featured_beneficiary_ids <@ v_current_featured_beneficiary_ids THEN
    RAISE EXCEPTION 'Advocate beneficiary configuration is unchanged'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => acting_user_id,
    context_tool => 'advocate-portal-beneficiaries',
    context_request_id => v_request_id,
    context_trace_id => v_trace_id,
    context_session_id => v_session_id,
    context_client_ip => v_client_ip,
    context_user_agent => v_user_agent,
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'replace_beneficiaries',
      'resource_kind', 'advocate_beneficiaries',
      'resource_id', v_advocate.id::text,
      'permission_key', 'portal.beneficiaries.manage'
    )
  );

  DELETE FROM public.advocate_beneficiaries selection
  WHERE selection.advocate_id = v_advocate.id;

  INSERT INTO public.advocate_beneficiaries (
    advocate_id,
    beneficiary_id,
    is_featured,
    display_order
  )
  SELECT
    v_advocate.id,
    requested.beneficiary_id,
    requested.beneficiary_id = ANY(target_featured_beneficiary_ids),
    (requested.ordinality - 1)::integer
  FROM unnest(target_beneficiary_ids) WITH ORDINALITY
    AS requested(beneficiary_id, ordinality)
  ORDER BY requested.ordinality;

  UPDATE public.advocates advocate
  SET beneficiary_mode = target_beneficiary_mode
  WHERE advocate.id = v_advocate.id
  RETURNING advocate.version INTO v_resulting_version;

  RETURN v_resulting_version;
END;
$$;

COMMENT ON FUNCTION public.replace_advocate_beneficiary_configuration(
  uuid,
  uuid,
  bigint,
  public.advocate_beneficiary_mode,
  uuid[],
  uuid[],
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Service only actor aware replacement of beneficiary mode, complete ordered publicly renderable child selection, and featured subset with locked authorization, optimistic aggregate versioning, bounded server audit context, and no-op rejection.';

REVOKE ALL ON FUNCTION public.replace_advocate_beneficiary_configuration(
  uuid,
  uuid,
  bigint,
  public.advocate_beneficiary_mode,
  uuid[],
  uuid[],
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_advocate_beneficiary_configuration(
  uuid,
  uuid,
  bigint,
  public.advocate_beneficiary_mode,
  uuid[],
  uuid[],
  text,
  text,
  text,
  text,
  text,
  text
) TO service_role;

COMMIT;
