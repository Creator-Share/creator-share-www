BEGIN;

-- Advocate configuration is one aggregate even though its presentation rows
-- are normalized. Every mutation below locks the tenant root and advances the
-- root version so stale editors and publication evidence cannot silently win.

CREATE OR REPLACE FUNCTION public.get_my_advocate_portal_access()
RETURNS TABLE (
  advocate_id uuid,
  slug text,
  display_name text,
  relationship_status public.advocate_relationship_status,
  publication_status public.advocate_publication_status,
  beneficiary_mode public.advocate_beneficiary_mode,
  advocate_version bigint,
  canonical_hostname text,
  domain_status public.advocate_domain_status,
  permissions text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    advocate.id,
    advocate.slug,
    advocate.display_name,
    advocate.relationship_status,
    advocate.publication_status,
    advocate.beneficiary_mode,
    advocate.version,
    canonical_domain.hostname,
    canonical_domain.status,
    array_agg(DISTINCT permission.key ORDER BY permission.key)
  FROM public.advocate_memberships membership
  JOIN public.advocates advocate
    ON advocate.id = membership.advocate_id
  JOIN public.advocate_membership_roles membership_role
    ON membership_role.advocate_id = membership.advocate_id
   AND membership_role.membership_id = membership.id
  JOIN public.advocate_role_permissions role_permission
    ON role_permission.role_id = membership_role.role_id
  JOIN public.advocate_permissions permission
    ON permission.id = role_permission.permission_id
  LEFT JOIN LATERAL (
    SELECT domain.hostname, domain.status
    FROM public.advocate_domains domain
    WHERE domain.advocate_id = advocate.id
      AND domain.is_primary
    LIMIT 1
  ) canonical_domain ON true
  WHERE membership.user_id = (SELECT auth.uid())
    AND membership.status = 'active'
    AND advocate.relationship_status <> 'archived'
  GROUP BY
    advocate.id,
    canonical_domain.hostname,
    canonical_domain.status
  HAVING bool_or(permission.key = 'portal.view')
  ORDER BY lower(advocate.display_name), advocate.id;
$$;

COMMENT ON FUNCTION public.get_my_advocate_portal_access() IS
  'Returns one allowlisted advocate root and exact sorted permission set for each active nonarchived portal membership, plus the primary hostname and status when present.';

CREATE OR REPLACE FUNCTION public.get_advocate_admin_settings(
  target_advocate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.has_advocate_permission(
    target_advocate_id,
    'portal.view'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'advocate', jsonb_build_object(
      'id', advocate.id,
      'slug', advocate.slug,
      'display_name', advocate.display_name,
      'advocate_type', advocate.advocate_type,
      'relationship_status', advocate.relationship_status,
      'publication_status', advocate.publication_status,
      'beneficiary_mode', advocate.beneficiary_mode,
      'advocate_version', advocate.version
    ),
    'branding', jsonb_build_object(
      'primary_color', branding.primary_color,
      'accent_color', branding.accent_color,
      'logo_storage_path', branding.logo_storage_path,
      'logo_alt_text', branding.logo_alt_text,
      'opening_header_html', branding.opening_header_html,
      'about_biography_html', branding.about_biography_html
    ),
    'public_metric_selections', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'metric_key', metric.metric_key,
            'display_order', metric.display_order
          )
          ORDER BY metric.display_order, metric.metric_key
        )
        FROM public.advocate_public_metric_selections metric
        WHERE metric.advocate_id = advocate.id
      ),
      '[]'::jsonb
    ),
    'beneficiary_selections', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'beneficiary_id', selection.beneficiary_id,
            'is_featured', selection.is_featured,
            'display_order', selection.display_order
          )
          ORDER BY selection.display_order, selection.beneficiary_id
        )
        FROM public.advocate_beneficiaries selection
        WHERE selection.advocate_id = advocate.id
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM public.advocates advocate
  LEFT JOIN public.advocate_branding branding
    ON branding.advocate_id = advocate.id
  WHERE advocate.id = target_advocate_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_advocate_admin_settings(uuid) IS
  'Returns one fixed, sponsor-free administrative presentation snapshot to an active portal member with portal.view. Suspended portals remain inspectable; archived portals do not.';

CREATE OR REPLACE FUNCTION public.update_advocate_branding(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  target_primary_color text,
  target_accent_color text,
  target_logo_storage_path text,
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
AS $$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_advocate public.advocates%ROWTYPE;
  v_reason text := btrim(change_reason);
  v_logo_alt_text text := NULLIF(btrim(target_logo_alt_text), '');
  v_resulting_version bigint;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF expected_advocate_version IS NULL OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'A positive expected advocate version is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.has_advocate_mutation_permission(
    target_advocate_id,
    'portal.branding.update'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT private.has_advocate_mutation_permission(
       target_advocate_id,
       'portal.branding.update'
     ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate settings changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF target_primary_color IS NULL
     OR btrim(target_primary_color) !~ '^#[0-9A-Fa-f]{6}$'
     OR target_accent_color IS NULL
     OR btrim(target_accent_color) !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Advocate colors must use six digit hexadecimal notation'
      USING ERRCODE = '22023';
  END IF;

  IF target_opening_header_html IS NULL
     OR octet_length(target_opening_header_html) > 16384
     OR target_about_biography_html IS NULL
     OR octet_length(target_about_biography_html) > 16384 THEN
    RAISE EXCEPTION 'Advocate rich text must not exceed 16384 bytes per field'
      USING ERRCODE = '22023';
  END IF;

  IF v_logo_alt_text IS NOT NULL
     AND char_length(v_logo_alt_text) > 300 THEN
    RAISE EXCEPTION 'Advocate logo alternative text exceeds 300 characters'
      USING ERRCODE = '22023';
  END IF;

  IF target_logo_storage_path IS NULL THEN
    IF v_logo_alt_text IS NOT NULL THEN
      RAISE EXCEPTION 'Logo alternative text requires an attached logo'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF target_logo_storage_path <> btrim(target_logo_storage_path)
       OR array_length(string_to_array(target_logo_storage_path, '/'), 1) <> 3
       OR split_part(target_logo_storage_path, '/', 1) <> 'logos'
       OR split_part(target_logo_storage_path, '/', 2) <> v_advocate.slug
       OR split_part(target_logo_storage_path, '/', 3) !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' THEN
      RAISE EXCEPTION 'Advocate logo storage path violates the tenant asset boundary'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM storage.objects object
      WHERE object.bucket_id = 'advocate-assets'
        AND object.name = target_logo_storage_path
    ) THEN
      RAISE EXCEPTION 'Advocate logo object does not exist'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A branding change reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255 THEN
    RAISE EXCEPTION 'Branding audit identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'advocate-portal-branding',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => NULLIF(btrim(session_id), ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'update_branding',
      'resource_kind', 'advocate_branding',
      'resource_id', v_advocate.id::text,
      'permission_key', 'portal.branding.update'
    )
  );

  INSERT INTO public.advocate_branding (
    advocate_id,
    primary_color,
    accent_color,
    logo_storage_path,
    logo_alt_text,
    opening_header_html,
    about_biography_html
  )
  VALUES (
    v_advocate.id,
    upper(btrim(target_primary_color)),
    upper(btrim(target_accent_color)),
    target_logo_storage_path,
    v_logo_alt_text,
    target_opening_header_html,
    target_about_biography_html
  )
  ON CONFLICT (advocate_id) DO UPDATE
  SET
    primary_color = EXCLUDED.primary_color,
    accent_color = EXCLUDED.accent_color,
    logo_storage_path = EXCLUDED.logo_storage_path,
    logo_alt_text = EXCLUDED.logo_alt_text,
    opening_header_html = EXCLUDED.opening_header_html,
    about_biography_html = EXCLUDED.about_biography_html;

  UPDATE public.advocates advocate
  SET display_name = advocate.display_name
  WHERE advocate.id = v_advocate.id
  RETURNING advocate.version INTO v_resulting_version;

  RETURN v_resulting_version;
END;
$$;

COMMENT ON FUNCTION public.update_advocate_branding(
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) IS
  'Authenticated tenant-locked branding replacement with exact permission recheck, aggregate optimistic concurrency, immutable same-tenant logo attachment, and complete sanitized audit context.';

CREATE OR REPLACE FUNCTION public.replace_advocate_public_metrics(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  target_metric_keys public.advocate_public_metric_key[],
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
  v_advocate public.advocates%ROWTYPE;
  v_reason text := btrim(change_reason);
  v_resulting_version bigint;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF expected_advocate_version IS NULL OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'A positive expected advocate version is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.has_advocate_mutation_permission(
    target_advocate_id,
    'portal.public_metrics.update'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT private.has_advocate_mutation_permission(
       target_advocate_id,
       'portal.public_metrics.update'
     ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate settings changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF target_metric_keys IS NULL
     OR array_position(target_metric_keys, NULL) IS NOT NULL
     OR (
       SELECT count(DISTINCT requested.metric_key)
       FROM unnest(target_metric_keys) requested(metric_key)
     ) <> cardinality(target_metric_keys) THEN
    RAISE EXCEPTION 'Public metric keys must be an ordered unique allowlisted array'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A public metric change reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255 THEN
    RAISE EXCEPTION 'Public metric audit identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'advocate-portal-public-metrics',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => NULLIF(btrim(session_id), ''),
    context_reason => v_reason,
    context_metadata => jsonb_build_object(
      'operation', 'replace_public_metrics',
      'resource_kind', 'advocate_public_metric_selections',
      'resource_id', v_advocate.id::text,
      'permission_key', 'portal.public_metrics.update'
    )
  );

  DELETE FROM public.advocate_public_metric_selections metric
  WHERE metric.advocate_id = v_advocate.id;

  INSERT INTO public.advocate_public_metric_selections (
    advocate_id,
    metric_key,
    display_order
  )
  SELECT
    v_advocate.id,
    requested.metric_key,
    (requested.ordinality - 1)::integer
  FROM unnest(target_metric_keys) WITH ORDINALITY
    AS requested(metric_key, ordinality)
  ORDER BY requested.ordinality;

  UPDATE public.advocates advocate
  SET display_name = advocate.display_name
  WHERE advocate.id = v_advocate.id
  RETURNING advocate.version INTO v_resulting_version;

  RETURN v_resulting_version;
END;
$$;

COMMENT ON FUNCTION public.replace_advocate_public_metrics(
  uuid,
  bigint,
  public.advocate_public_metric_key[],
  text,
  text,
  text,
  text
) IS
  'Authenticated tenant-locked replacement of the complete ordered public metric allowlist with optimistic aggregate versioning and complete audit context.';

CREATE OR REPLACE FUNCTION public.replace_advocate_beneficiary_configuration(
  target_advocate_id uuid,
  expected_advocate_version bigint,
  target_beneficiary_mode public.advocate_beneficiary_mode,
  target_beneficiary_ids uuid[],
  target_featured_beneficiary_ids uuid[],
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
  v_advocate public.advocates%ROWTYPE;
  v_reason text := btrim(change_reason);
  v_resulting_version bigint;
  v_eligible_count integer;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = '28000';
  END IF;

  IF expected_advocate_version IS NULL OR expected_advocate_version < 1 THEN
    RAISE EXCEPTION 'A positive expected advocate version is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.has_advocate_mutation_permission(
    target_advocate_id,
    'portal.beneficiaries.manage'
  ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  SELECT advocate.*
  INTO v_advocate
  FROM public.advocates advocate
  WHERE advocate.id = target_advocate_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT private.has_advocate_mutation_permission(
       target_advocate_id,
       'portal.beneficiaries.manage'
     ) THEN
    RAISE EXCEPTION 'Insufficient portal permission'
      USING ERRCODE = '42501';
  END IF;

  IF v_advocate.version IS DISTINCT FROM expected_advocate_version THEN
    RAISE EXCEPTION 'Advocate settings changed; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF target_beneficiary_mode IS NULL
     OR target_beneficiary_ids IS NULL
     OR target_featured_beneficiary_ids IS NULL
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
    RAISE EXCEPTION 'Beneficiary configuration requires ordered unique nonnull arrays'
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

  SELECT count(*)::integer
  INTO v_eligible_count
  FROM (
    SELECT beneficiary.id
    FROM public.beneficiaries beneficiary
    WHERE beneficiary.id = ANY(target_beneficiary_ids)
      AND private.is_beneficiary_canonically_sponsorable(
        beneficiary.status,
        beneficiary.budget_goal,
        beneficiary.goal_fulfilled_at
      )
    ORDER BY beneficiary.id
    FOR SHARE
  ) locked_eligible_beneficiary;

  IF v_eligible_count <> cardinality(target_beneficiary_ids) THEN
    RAISE EXCEPTION 'Every configured beneficiary must currently be canonically eligible for sponsorship'
      USING ERRCODE = '23514';
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A beneficiary configuration reason between 1 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(request_id, '')) > 255
     OR char_length(COALESCE(trace_id, '')) > 255
     OR char_length(COALESCE(session_id, '')) > 255 THEN
    RAISE EXCEPTION 'Beneficiary audit identifiers exceed 255 characters'
      USING ERRCODE = '22023';
  END IF;

  PERFORM audit.set_actor_context(
    context_actor_type => 'user'::audit.audit_actor_type,
    context_actor_user_id => v_actor_user_id,
    context_tool => 'advocate-portal-beneficiaries',
    context_request_id => NULLIF(btrim(request_id), ''),
    context_trace_id => NULLIF(btrim(trace_id), ''),
    context_session_id => NULLIF(btrim(session_id), ''),
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
  bigint,
  public.advocate_beneficiary_mode,
  uuid[],
  uuid[],
  text,
  text,
  text,
  text
) IS
  'Authenticated tenant-locked replacement of beneficiary mode, complete ordered eligible selection, and featured subset with optimistic aggregate versioning and complete audit context.';

-- Rich text is public presentation content, but retaining complete historical
-- copies indefinitely creates an unnecessary secondary store for accidental
-- personal data. The audit ledger keeps actor, request, changed columns, and
-- reason while omitting row images for this table.
DROP TRIGGER IF EXISTS advocate_branding_audit_row_change
  ON public.advocate_branding;
CREATE TRIGGER advocate_branding_audit_row_change
AFTER INSERT OR UPDATE OR DELETE ON public.advocate_branding
FOR EACH ROW EXECUTE FUNCTION audit.capture_row_change(
  'advocate_id',
  '@columns_only'
);

REVOKE INSERT, UPDATE, DELETE
  ON public.advocate_branding
  FROM service_role;
REVOKE INSERT, UPDATE, DELETE
  ON public.advocate_public_metric_selections
  FROM service_role;
REVOKE INSERT, UPDATE, DELETE
  ON public.advocate_beneficiaries
  FROM service_role;

REVOKE ALL ON FUNCTION public.get_my_advocate_portal_access()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_advocate_admin_settings(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_advocate_branding(
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_advocate_public_metrics(
  uuid,
  bigint,
  public.advocate_public_metric_key[],
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
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

GRANT EXECUTE ON FUNCTION public.get_my_advocate_portal_access()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_advocate_admin_settings(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_advocate_branding(
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_advocate_public_metrics(
  uuid,
  bigint,
  public.advocate_public_metric_key[],
  text,
  text,
  text,
  text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_advocate_beneficiary_configuration(
  uuid,
  bigint,
  public.advocate_beneficiary_mode,
  uuid[],
  uuid[],
  text,
  text,
  text,
  text
) TO authenticated;

COMMIT;
