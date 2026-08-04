BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.advocate_branding branding
    JOIN public.advocates advocate
      ON advocate.id = branding.advocate_id
    WHERE branding.logo_storage_path IS NOT NULL
      AND NOT (
        branding.logo_storage_path =
          'logos/' || advocate.slug || '/' || split_part(branding.logo_storage_path, '/', 3)
        AND array_length(string_to_array(branding.logo_storage_path, '/'), 1) = 3
        AND split_part(branding.logo_storage_path, '/', 3) ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
      )
  ) THEN
    RAISE EXCEPTION 'Existing advocate logo path violates the tenant asset boundary'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_advocate_logo_storage_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_advocate_slug text;
  v_path_segments text[];
BEGIN
  IF NEW.logo_storage_path IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT advocate.slug
  INTO v_advocate_slug
  FROM public.advocates advocate
  WHERE advocate.id = NEW.advocate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advocate branding owner does not exist'
      USING ERRCODE = '23503';
  END IF;

  v_path_segments := string_to_array(NEW.logo_storage_path, '/');
  IF coalesce(array_length(v_path_segments, 1), 0) <> 3
     OR v_path_segments[1] <> 'logos'
     OR v_path_segments[2] <> v_advocate_slug
     OR v_path_segments[3] !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' THEN
    RAISE EXCEPTION 'Advocate logo storage path violates the tenant asset boundary'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.validate_advocate_logo_storage_path() IS
  'Restricts advocate logos to logos/<advocate slug>/<lowercase UUID>.webp so one tenant cannot reference another tenant asset or active content.';

REVOKE ALL ON FUNCTION private.validate_advocate_logo_storage_path()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS advocate_branding_validate_logo_storage_path
  ON public.advocate_branding;
CREATE TRIGGER advocate_branding_validate_logo_storage_path
BEFORE INSERT OR UPDATE OF advocate_id, logo_storage_path
ON public.advocate_branding
FOR EACH ROW EXECUTE FUNCTION private.validate_advocate_logo_storage_path();

CREATE OR REPLACE FUNCTION public.read_public_advocate_presentation_snapshot(
  target_hostname text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'domain', jsonb_build_object(
      'advocate_id', domain.advocate_id,
      'hostname', domain.hostname,
      'status', domain.status,
      'dns_verified_at', domain.dns_verified_at,
      'tls_ready_at', domain.tls_ready_at,
      'payments_ready_at', domain.payments_ready_at,
      'activated_at', domain.activated_at
    ),
    'advocate', jsonb_build_object(
      'id', advocate.id,
      'slug', advocate.slug,
      'display_name', advocate.display_name,
      'relationship_status', advocate.relationship_status,
      'publication_status', advocate.publication_status,
      'beneficiary_mode', advocate.beneficiary_mode
    ),
    'branding', jsonb_build_object(
      'advocate_id', branding.advocate_id,
      'primary_color', branding.primary_color,
      'accent_color', branding.accent_color,
      'logo_storage_path', branding.logo_storage_path,
      'logo_alt_text', branding.logo_alt_text,
      'opening_header_html', branding.opening_header_html,
      'about_biography_html', branding.about_biography_html
    ),
    'metricSelections', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'advocate_id', metric.advocate_id,
            'metric_key', metric.metric_key,
            'display_order', metric.display_order
          )
          ORDER BY metric.display_order, metric.metric_key
        )
        FROM public.advocate_public_metric_selections metric
        WHERE metric.advocate_id = advocate.id
      ),
      '[]'::jsonb
    )
  )
  FROM public.advocate_domains domain
  JOIN public.advocates advocate
    ON advocate.id = domain.advocate_id
  JOIN public.advocate_branding branding
    ON branding.advocate_id = advocate.id
  WHERE target_hostname IS NOT NULL
    AND target_hostname = lower(btrim(target_hostname))
    AND target_hostname = domain.hostname
    AND domain.status = 'active'
    AND domain.dns_verified_at IS NOT NULL
    AND domain.tls_ready_at IS NOT NULL
    AND domain.payments_ready_at IS NOT NULL
    AND domain.activated_at IS NOT NULL
    AND advocate.relationship_status = 'active'
    AND advocate.publication_status = 'active'
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.read_public_advocate_presentation_snapshot(text) IS
  'Service role only, allowlisted, statement consistent presentation snapshot for one exact active advocate hostname. Beneficiary selections and private operational fields are intentionally excluded.';

REVOKE ALL ON FUNCTION public.read_public_advocate_presentation_snapshot(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_advocate_presentation_snapshot(text)
  TO service_role;

COMMIT;
