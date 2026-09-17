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



COMMIT;
