BEGIN;

/*
 * Delegate administration uses a membership version, not the advocate
 * presentation version. This keeps concurrent team edits independent from
 * branding and catalog edits while still making every authorization change
 * optimistic and explicit.
 */
ALTER TABLE public.advocate_memberships
  ADD COLUMN version bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT advocate_memberships_version_positive_check
    CHECK (version > 0);

COMMENT ON COLUMN public.advocate_memberships.version IS
  'Optimistic concurrency token for membership lifecycle and role assignments. Every membership or role mutation advances this value.';

CREATE OR REPLACE FUNCTION private.prepare_advocate_membership_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reactivation_membership_id text := nullif(
    current_setting('app.advocate.reactivation_membership_id', true),
    ''
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'New advocate memberships must begin at version 1'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'active' THEN
      NEW.suspended_at := NULL;
      NEW.revoked_at := NULL;
    ELSIF NEW.status = 'suspended' THEN
      NEW.suspended_at := clock_timestamp();
      NEW.revoked_at := NULL;
    ELSE
      NEW.suspended_at := NULL;
      NEW.revoked_at := clock_timestamp();
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.advocate_id IS DISTINCT FROM OLD.advocate_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Advocate membership identity fields are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'Advocate membership updates must advance the version exactly once'
      USING ERRCODE = '40001';
  END IF;

  IF OLD.status = 'revoked'
     AND NEW.status = 'active'
     AND v_reactivation_membership_id IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'A revoked membership requires a fresh invitation for reactivation'
      USING ERRCODE = '42501';
  END IF;

  IF (OLD.status = 'active' AND NEW.status NOT IN ('active', 'suspended', 'revoked'))
     OR (OLD.status = 'suspended' AND NEW.status NOT IN ('active', 'suspended', 'revoked'))
     OR (OLD.status = 'revoked' AND NEW.status NOT IN ('active', 'revoked')) THEN
    RAISE EXCEPTION 'Advocate membership lifecycle transition is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'active' THEN
    NEW.suspended_at := NULL;
    NEW.revoked_at := NULL;
  ELSIF NEW.status = 'suspended' THEN
    IF OLD.status <> 'suspended' THEN
      NEW.suspended_at := clock_timestamp();
    ELSE
      NEW.suspended_at := OLD.suspended_at;
    END IF;
    NEW.revoked_at := NULL;
  ELSE
    NEW.suspended_at := NULL;
    IF OLD.status <> 'revoked' THEN
      NEW.revoked_at := clock_timestamp();
    ELSE
      NEW.revoked_at := OLD.revoked_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prepare_advocate_membership_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_memberships_prepare_lifecycle
BEFORE INSERT OR UPDATE ON public.advocate_memberships
FOR EACH ROW EXECUTE FUNCTION private.prepare_advocate_membership_lifecycle();

/*
 * Role assignment rows are immutable facts. Replacements use delete plus
 * insert, and each statement advances the affected membership version once.
 * This also versions ownership transfers without broadening their authority.
 */
CREATE OR REPLACE FUNCTION private.prevent_advocate_membership_role_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Advocate membership role rows must be replaced, not updated'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION private.bump_advocate_membership_role_versions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.advocate_memberships membership
    SET version = membership.version + 1
    WHERE EXISTS (
      SELECT 1
      FROM new_advocate_membership_roles changed_role
      WHERE changed_role.advocate_id = membership.advocate_id
        AND changed_role.membership_id = membership.id
    );
  ELSE
    UPDATE public.advocate_memberships membership
    SET version = membership.version + 1
    WHERE EXISTS (
      SELECT 1
      FROM old_advocate_membership_roles changed_role
      WHERE changed_role.advocate_id = membership.advocate_id
        AND changed_role.membership_id = membership.id
    );
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_advocate_membership_role_update()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.bump_advocate_membership_role_versions()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER advocate_membership_roles_no_update
BEFORE UPDATE ON public.advocate_membership_roles
FOR EACH ROW EXECUTE FUNCTION private.prevent_advocate_membership_role_update();

CREATE TRIGGER advocate_membership_roles_bump_version_after_insert
AFTER INSERT ON public.advocate_membership_roles
REFERENCING NEW TABLE AS new_advocate_membership_roles
FOR EACH STATEMENT EXECUTE FUNCTION private.bump_advocate_membership_role_versions();

CREATE TRIGGER advocate_membership_roles_bump_version_after_delete
AFTER DELETE ON public.advocate_membership_roles
REFERENCING OLD TABLE AS old_advocate_membership_roles
FOR EACH STATEMENT EXECUTE FUNCTION private.bump_advocate_membership_role_versions();

/*
 * Team readers receive only a membership identifier, a privacy limited display
 * label, lifecycle state, predefined role keys, and concurrency metadata.
 * Email addresses, auth identifiers, sponsor records, contact data, and raw
 * attribution records are deliberately absent.
 */
CREATE OR REPLACE FUNCTION public.get_advocate_team(
  target_advocate_id uuid
)
RETURNS TABLE (
  membership_id uuid,
  member_display_name text,
  membership_status public.advocate_membership_status,
  role_keys text[],
  membership_version bigint,
  is_owner boolean,
  membership_created_at timestamp with time zone,
  membership_updated_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users actor
    WHERE actor.id = auth.uid()
      AND actor.email IS NOT NULL
      AND actor.email_confirmed_at IS NOT NULL
      AND actor.deleted_at IS NULL
      AND actor.is_anonymous IS NOT TRUE
      AND (actor.banned_until IS NULL OR actor.banned_until <= clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT private.has_advocate_permission(
    target_advocate_id,
    'portal.members.view'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    membership.id,
    COALESCE(
      nullif(
        btrim(
          concat_ws(
            ' ',
            nullif(
              left(
                btrim(
                  regexp_replace(
                    COALESCE(profile.first_name, ''),
                    '[[:cntrl:]]',
                    '',
                    'g'
                  )
                ),
                190
              ),
              ''
            ),
            CASE
              WHEN nullif(
                btrim(
                  regexp_replace(
                    COALESCE(profile.last_name, ''),
                    '[[:cntrl:]]',
                    '',
                    'g'
                  )
                ),
                ''
              ) IS NOT NULL
                THEN left(
                  btrim(
                    regexp_replace(
                      profile.last_name,
                      '[[:cntrl:]]',
                      '',
                      'g'
                    )
                  ),
                  1
                ) || '.'
              ELSE NULL
            END
          )
        ),
        ''
      ),
      'Portal member'
    ) AS member_display_name,
    membership.status,
    COALESCE(
      array_agg(role.key ORDER BY role.key)
        FILTER (WHERE role.key IS NOT NULL),
      ARRAY[]::text[]
    ) AS role_keys,
    membership.version,
    membership.id = advocate.owner_membership_id,
    membership.created_at,
    membership.updated_at
  FROM public.advocates advocate
  JOIN public.advocate_memberships membership
    ON membership.advocate_id = advocate.id
  LEFT JOIN public.users profile
    ON profile.id = membership.user_id
  LEFT JOIN public.advocate_membership_roles membership_role
    ON membership_role.advocate_id = membership.advocate_id
   AND membership_role.membership_id = membership.id
  LEFT JOIN public.advocate_roles role
    ON role.id = membership_role.role_id
  WHERE advocate.id = target_advocate_id
    AND advocate.relationship_status <> 'archived'
  GROUP BY
    advocate.owner_membership_id,
    membership.id,
    profile.first_name,
    profile.last_name
  ORDER BY
    membership.id = advocate.owner_membership_id DESC,
    lower(
      COALESCE(
        nullif(
          btrim(
            concat_ws(
              ' ',
              nullif(
                left(
                  btrim(
                    regexp_replace(
                      COALESCE(profile.first_name, ''),
                      '[[:cntrl:]]',
                      '',
                      'g'
                    )
                  ),
                  190
                ),
                ''
              ),
              CASE
                WHEN nullif(
                  btrim(
                    regexp_replace(
                      COALESCE(profile.last_name, ''),
                      '[[:cntrl:]]',
                      '',
                      'g'
                    )
                  ),
                  ''
                ) IS NOT NULL
                  THEN left(
                    btrim(
                      regexp_replace(
                        profile.last_name,
                        '[[:cntrl:]]',
                        '',
                        'g'
                      )
                    ),
                    1
                  ) || '.'
                ELSE NULL
              END
            )
          ),
          ''
        ),
        'Portal member'
      )
    ),
    membership.id;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_team(uuid) IS
  'Permission checked, sponsor free team projection with first name and last initial only. It exposes no email, auth user identifier, contact data, or raw attribution data.';

CREATE OR REPLACE FUNCTION public.replace_advocate_member_roles(
  target_advocate_id uuid,
  target_membership_id uuid,
  expected_membership_version bigint,
  target_role_keys text[],
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_actor_membership_id uuid;
  v_target_membership public.advocate_memberships%ROWTYPE;
  v_normalized_role_keys text[];
  v_current_role_keys text[];
  v_reason text := nullif(btrim(change_reason), '');
  v_resulting_version bigint;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF target_advocate_id IS NULL OR target_membership_id IS NULL THEN
    RAISE EXCEPTION 'An advocate and membership are required'
      USING ERRCODE = '22023';
  END IF;

  IF expected_membership_version IS NULL OR expected_membership_version < 1 THEN
    RAISE EXCEPTION 'A positive expected membership version is required'
      USING ERRCODE = '22023';
  END IF;

  IF target_role_keys IS NULL
     OR cardinality(target_role_keys) NOT BETWEEN 1 AND 5
     OR array_position(target_role_keys, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'One to five predefined delegate roles are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(normalized.role_key ORDER BY normalized.role_key)
  INTO v_normalized_role_keys
  FROM (
    SELECT DISTINCT lower(btrim(requested.role_key)) AS role_key
    FROM unnest(target_role_keys) requested(role_key)
  ) normalized;

  IF cardinality(v_normalized_role_keys) <> cardinality(target_role_keys)
     OR EXISTS (
       SELECT 1
       FROM unnest(v_normalized_role_keys) requested(role_key)
       WHERE requested.role_key <> ALL (ARRAY[
         'administrator',
         'brand_editor',
         'catalog_curator',
         'analytics_viewer',
         'audit_viewer'
       ]::text[])
     ) THEN
    RAISE EXCEPTION 'Only unique predefined nonowner delegate roles may be assigned'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) > 2000
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A role change reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255 THEN
    RAISE EXCEPTION 'Team audit identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.has_advocate_mutation_permission(
    target_advocate_id,
    'portal.members.manage'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.id
  INTO v_actor_membership_id
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.user_id = v_actor_user_id;

  IF v_actor_membership_id IS NULL THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.id = ANY (ARRAY[
      v_actor_membership_id,
      target_membership_id
    ]::uuid[])
  ORDER BY membership.id
  FOR UPDATE;

  SELECT membership.*
  INTO v_target_membership
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.id = target_membership_id;

  IF NOT FOUND
     OR NOT private.has_advocate_mutation_permission(
       target_advocate_id,
       'portal.members.manage'
     ) THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = v_actor_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (actor.banned_until IS NULL OR actor.banned_until <= clock_timestamp())
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.id = target_advocate_id
      AND advocate.owner_membership_id = target_membership_id
  ) THEN
    RAISE EXCEPTION 'Portal ownership is immutable through delegate administration'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_membership.status = 'revoked' THEN
    RAISE EXCEPTION 'Revoked memberships require a fresh invitation'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_membership.version IS DISTINCT FROM expected_membership_version THEN
    RAISE EXCEPTION 'Portal membership changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(
    array_agg(role.key ORDER BY role.key),
    ARRAY[]::text[]
  )
  INTO v_current_role_keys
  FROM public.advocate_membership_roles membership_role
  JOIN public.advocate_roles role
    ON role.id = membership_role.role_id
  WHERE membership_role.advocate_id = target_advocate_id
    AND membership_role.membership_id = target_membership_id;

  IF v_current_role_keys = v_normalized_role_keys THEN
    RETURN v_target_membership.version;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_target_membership.user_id,
    context_tool => 'advocate-portal-team',
    context_request_id => nullif(btrim(request_id), ''),
    context_trace_id => nullif(btrim(trace_id), ''),
    context_session_id => nullif(btrim(session_id), ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'replace_member_roles',
      'resource_kind', 'advocate_membership',
      'resource_id', v_target_membership.id::text,
      'permission_key', 'portal.members.manage'
    )
  );

  DELETE FROM public.advocate_membership_roles membership_role
  WHERE membership_role.advocate_id = target_advocate_id
    AND membership_role.membership_id = target_membership_id;

  INSERT INTO public.advocate_membership_roles (
    advocate_id,
    membership_id,
    role_id,
    assigned_by_user_id
  )
  SELECT
    target_advocate_id,
    target_membership_id,
    role.id,
    v_actor_user_id
  FROM public.advocate_roles role
  WHERE role.key = ANY(v_normalized_role_keys)
    AND role.can_be_invited
  ORDER BY role.key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only predefined nonowner delegate roles may be assigned'
      USING ERRCODE = '22023';
  END IF;

  SELECT membership.version
  INTO v_resulting_version
  FROM public.advocate_memberships membership
  WHERE membership.id = target_membership_id
    AND membership.advocate_id = target_advocate_id;

  RETURN v_resulting_version;
END;
$$;

COMMENT ON FUNCTION public.replace_advocate_member_roles(
  uuid,
  uuid,
  bigint,
  text[],
  text,
  text,
  text,
  text
) IS
  'Tenant locked, permission checked, optimistic replacement of one nonowner membership predefined role set. Global Creator Share administration and ownership remain separate boundaries.';

CREATE OR REPLACE FUNCTION public.change_advocate_member_status(
  target_advocate_id uuid,
  target_membership_id uuid,
  expected_membership_version bigint,
  target_status public.advocate_membership_status,
  change_reason text,
  request_id text DEFAULT NULL,
  trace_id text DEFAULT NULL,
  session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_actor_membership_id uuid;
  v_target_membership public.advocate_memberships%ROWTYPE;
  v_reason text := nullif(btrim(change_reason), '');
  v_resulting_version bigint;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF target_advocate_id IS NULL OR target_membership_id IS NULL OR target_status IS NULL THEN
    RAISE EXCEPTION 'An advocate, membership, and lifecycle status are required'
      USING ERRCODE = '22023';
  END IF;

  IF expected_membership_version IS NULL OR expected_membership_version < 1 THEN
    RAISE EXCEPTION 'A positive expected membership version is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL
     OR char_length(v_reason) > 2000
     OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A membership status reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255 THEN
    RAISE EXCEPTION 'Team audit identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.has_advocate_mutation_permission(
    target_advocate_id,
    'portal.members.manage'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.id
  INTO v_actor_membership_id
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.user_id = v_actor_user_id;

  IF v_actor_membership_id IS NULL THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.id = ANY (ARRAY[
      v_actor_membership_id,
      target_membership_id
    ]::uuid[])
  ORDER BY membership.id
  FOR UPDATE;

  SELECT membership.*
  INTO v_target_membership
  FROM public.advocate_memberships membership
  WHERE membership.advocate_id = target_advocate_id
    AND membership.id = target_membership_id;

  IF NOT FOUND
     OR NOT private.has_advocate_mutation_permission(
       target_advocate_id,
       'portal.members.manage'
     ) THEN
    RAISE EXCEPTION 'Insufficient portal member permission'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM auth.users actor
  WHERE actor.id = v_actor_user_id
    AND actor.email IS NOT NULL
    AND actor.email_confirmed_at IS NOT NULL
    AND actor.deleted_at IS NULL
    AND actor.is_anonymous IS NOT TRUE
    AND (actor.banned_until IS NULL OR actor.banned_until <= clock_timestamp())
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active authenticated account with a verified email is required'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.id = target_advocate_id
      AND advocate.owner_membership_id = target_membership_id
  ) THEN
    RAISE EXCEPTION 'Portal ownership is immutable through delegate administration'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_membership.version IS DISTINCT FROM expected_membership_version THEN
    RAISE EXCEPTION 'Portal membership changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF v_target_membership.status = target_status THEN
    RETURN v_target_membership.version;
  END IF;

  IF target_status = 'active' AND v_target_membership.status = 'revoked' THEN
    RAISE EXCEPTION 'Revoked memberships require a fresh invitation'
      USING ERRCODE = '42501';
  END IF;

  IF (target_status = 'active' AND v_target_membership.status <> 'suspended')
     OR (target_status = 'suspended' AND v_target_membership.status <> 'active')
     OR (
       target_status = 'revoked'
       AND v_target_membership.status NOT IN ('active', 'suspended')
     ) THEN
    RAISE EXCEPTION 'Requested membership lifecycle transition is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF target_status = 'active' THEN
    PERFORM 1
    FROM auth.users target_account
    WHERE target_account.id = v_target_membership.user_id
      AND target_account.email IS NOT NULL
      AND target_account.email_confirmed_at IS NOT NULL
      AND target_account.deleted_at IS NULL
      AND target_account.is_anonymous IS NOT TRUE
      AND (
        target_account.banned_until IS NULL
        OR target_account.banned_until <= clock_timestamp()
      )
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only a healthy verified account can be reactivated'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.advocate_membership_roles membership_role
      JOIN public.advocate_roles role
        ON role.id = membership_role.role_id
      WHERE membership_role.advocate_id = target_advocate_id
        AND membership_role.membership_id = target_membership_id
        AND role.can_be_invited
    ) THEN
      RAISE EXCEPTION 'A suspended membership requires at least one predefined delegate role'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_effective_user_id => v_target_membership.user_id,
    context_tool => 'advocate-portal-team',
    context_request_id => nullif(btrim(request_id), ''),
    context_trace_id => nullif(btrim(trace_id), ''),
    context_session_id => nullif(btrim(session_id), ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'change_member_status',
      'resource_kind', 'advocate_membership',
      'resource_id', v_target_membership.id::text,
      'permission_key', 'portal.members.manage',
      'prior_status', v_target_membership.status::text
    )
  );

  UPDATE public.advocate_memberships membership
  SET
    status = target_status,
    version = membership.version + 1
  WHERE membership.id = target_membership_id
    AND membership.advocate_id = target_advocate_id
    AND membership.version = expected_membership_version
  RETURNING membership.version INTO v_resulting_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portal membership changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF target_status IN ('suspended', 'revoked') THEN
    PERFORM pg_catalog.set_config(
      'app.advocate.invitation_operation',
      'issuer_membership_revocation',
      true
    );

    UPDATE public.advocate_invitations invitation
    SET
      revoked_at = clock_timestamp(),
      revoked_by_user_id = v_actor_user_id
    WHERE invitation.advocate_id = target_advocate_id
      AND invitation.created_by_user_id = v_target_membership.user_id
      AND invitation.accepted_at IS NULL
      AND invitation.revoked_at IS NULL;
  END IF;

  RETURN v_resulting_version;
END;
$$;

COMMENT ON FUNCTION public.change_advocate_member_status(
  uuid,
  uuid,
  bigint,
  public.advocate_membership_status,
  text,
  text,
  text,
  text
) IS
  'Tenant locked, permission checked, optimistic nonowner lifecycle boundary. Suspension and revocation remove authorization immediately and cancel capabilities issued by that delegate. Revocation can be reversed only through a fresh invitation.';

/* Membership row images are unnecessary in the indefinite audit store. */
DROP TRIGGER IF EXISTS advocate_memberships_audit_row_change
  ON public.advocate_memberships;
CREATE TRIGGER advocate_memberships_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_memberships
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  '@columns_only'
);

DROP TRIGGER IF EXISTS advocate_membership_roles_audit_row_change
  ON public.advocate_membership_roles;
CREATE TRIGGER advocate_membership_roles_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_membership_roles
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  '@columns_only'
);

/*
 * Authenticated sessions use fixed security definer projections and mutation
 * functions after this migration. Base RBAC tables are not a user interface.
 */
DROP POLICY IF EXISTS advocate_memberships_select_manager
  ON public.advocate_memberships;
DROP POLICY IF EXISTS advocate_membership_roles_select_manager
  ON public.advocate_membership_roles;
DROP POLICY IF EXISTS advocate_roles_select_authenticated
  ON public.advocate_roles;
DROP POLICY IF EXISTS advocate_permissions_select_authenticated
  ON public.advocate_permissions;
DROP POLICY IF EXISTS advocate_role_permissions_select_authenticated
  ON public.advocate_role_permissions;

REVOKE ALL ON public.advocate_memberships
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.advocate_membership_roles
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.advocate_roles
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.advocate_permissions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.advocate_role_permissions
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_advocate_team(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_advocate_member_roles(
  uuid,
  uuid,
  bigint,
  text[],
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.change_advocate_member_status(
  uuid,
  uuid,
  bigint,
  public.advocate_membership_status,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_advocate_team(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_advocate_member_roles(
  uuid,
  uuid,
  bigint,
  text[],
  text,
  text,
  text,
  text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_advocate_member_status(
  uuid,
  uuid,
  bigint,
  public.advocate_membership_status,
  text,
  text,
  text,
  text
) TO authenticated;

COMMIT;
