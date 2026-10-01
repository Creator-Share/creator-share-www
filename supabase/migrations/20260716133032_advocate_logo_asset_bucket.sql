BEGIN;

-- Advocate logos are public presentation assets, but every write is mediated by
-- the application service. Immutable object names make public cache lifetimes
-- safe: replacing a logo requires a new UUID and a branding row update.
LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets bucket
    WHERE (bucket.id = 'advocate-assets' OR bucket.name = 'advocate-assets')
      AND (bucket.id <> 'advocate-assets' OR bucket.name <> 'advocate-assets')
  ) THEN
    RAISE EXCEPTION 'Advocate asset bucket identity conflicts with an existing bucket'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects object
    LEFT JOIN public.advocates advocate
      ON advocate.slug = split_part(object.name, '/', 2)
    WHERE object.bucket_id = 'advocate-assets'
      AND NOT (
        array_length(string_to_array(object.name, '/'), 1) = 3
        AND split_part(object.name, '/', 1) = 'logos'
        AND advocate.id IS NOT NULL
        AND split_part(object.name, '/', 3) ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
        AND object.metadata ->> 'mimetype' = 'image/webp'
        AND CASE
          WHEN jsonb_typeof(object.metadata -> 'size') = 'number'
            AND object.metadata ->> 'size' ~ '^[0-9]{1,7}$'
          THEN (object.metadata ->> 'size')::bigint BETWEEN 1 AND 1048576
          ELSE false
        END
      )
  ) THEN
    RAISE EXCEPTION 'Existing advocate asset violates the immutable logo boundary'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'advocate-assets',
  'advocate-assets',
  true,
  1048576,
  ARRAY['image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();

COMMENT ON COLUMN public.advocate_branding.logo_storage_path IS
  'Immutable object path in the public advocate-assets bucket. The application uploads a transcoded WebP to logos/<advocate slug>/<lowercase UUID>.webp before storing this path.';

CREATE OR REPLACE FUNCTION private.validate_advocate_logo_storage_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_path_segments text[];
  v_size_text text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       OLD.bucket_id = 'advocate-assets'
       OR NEW.bucket_id = 'advocate-assets'
     ) THEN
    RAISE EXCEPTION 'Advocate logo storage objects are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.bucket_id <> 'advocate-assets' THEN
    RETURN NEW;
  END IF;

  v_path_segments := string_to_array(NEW.name, '/');
  IF coalesce(array_length(v_path_segments, 1), 0) <> 3
     OR v_path_segments[1] <> 'logos'
     OR v_path_segments[2] !~
       '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
     OR v_path_segments[3] !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' THEN
    RAISE EXCEPTION 'Advocate logo object path violates the tenant asset boundary'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.slug = v_path_segments[2]
  ) THEN
    RAISE EXCEPTION 'Advocate logo namespace does not exist'
      USING ERRCODE = '23503';
  END IF;

  v_size_text := NEW.metadata ->> 'size';
  IF NEW.metadata ->> 'mimetype' IS DISTINCT FROM 'image/webp'
     OR jsonb_typeof(NEW.metadata -> 'size') IS DISTINCT FROM 'number'
     OR coalesce(v_size_text, '') !~ '^[0-9]{1,7}$' THEN
    RAISE EXCEPTION 'Advocate logo object must be a nonempty WebP no larger than 1 MiB'
      USING ERRCODE = '23514';
  END IF;

  IF v_size_text::bigint NOT BETWEEN 1 AND 1048576 THEN
    RAISE EXCEPTION 'Advocate logo object must be a nonempty WebP no larger than 1 MiB'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.validate_advocate_logo_storage_object() IS
  'Enforces one immutable, size-bounded WebP object under an existing advocate slug namespace. The application service must sniff and transcode source bytes before upload.';

REVOKE ALL ON FUNCTION private.validate_advocate_logo_storage_object()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS advocate_logo_storage_object_boundary
  ON storage.objects;
CREATE TRIGGER advocate_logo_storage_object_boundary
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION private.validate_advocate_logo_storage_object();

DROP POLICY IF EXISTS advocate_assets_public_read
  ON storage.objects;
CREATE POLICY advocate_assets_public_read
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'advocate-assets'
  AND name ~
    '^logos/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
);

COMMIT;
