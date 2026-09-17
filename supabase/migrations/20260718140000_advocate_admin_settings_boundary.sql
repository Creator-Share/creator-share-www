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

GRANT EXECUTE ON FUNCTION public.get_my_advocate_portal_access()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_advocate_admin_settings(uuid)
  TO authenticated;

COMMIT;
