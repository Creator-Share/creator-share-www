BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(16);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM storage.buckets bucket
    WHERE bucket.id = 'advocate-assets'
      AND bucket.name = 'advocate-assets'
      AND bucket.public
      AND bucket.file_size_limit = 1048576
      AND bucket.allowed_mime_types = ARRAY['image/webp']::text[]
  ),
  'the fixed public advocate asset bucket accepts only WebP files up to 1 MiB'
);

SELECT extensions.ok(
  (
    SELECT function_definition.prosecdef
      AND coalesce(array_to_string(function_definition.proconfig, ','), '') =
        'search_path=""'
    FROM pg_proc function_definition
    WHERE function_definition.oid =
      'private.validate_advocate_logo_storage_object()'::regprocedure
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.validate_advocate_logo_storage_object()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.validate_advocate_logo_storage_object()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.validate_advocate_logo_storage_object()',
    'EXECUTE'
  ),
  'the storage trigger has fixed definer authority and is not directly callable'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.policyname = 'advocate_assets_public_read'
      AND policy.cmd = 'SELECT'
      AND policy.roles = ARRAY['public']::name[]
      AND policy.qual LIKE '%bucket_id = ''advocate-assets''%'
      AND policy.qual LIKE '%logos/%'
  ),
  1,
  'public storage reads are limited to structurally valid advocate logo paths'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND concat_ws(' ', policy.qual, policy.with_check)
        LIKE '%advocate-assets%'
  ),
  0,
  'the advocate bucket grants no browser mutation policy'
);

INSERT INTO public.advocates (
  slug,
  display_name,
  relationship_status,
  publication_status
)
VALUES (
  'logoassettest',
  'Logo Asset Test',
  'active',
  'draft'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT extensions.lives_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'advocate-assets',
      'logos/logoassettest/41111111-1111-4111-8111-111111111111.webp',
      jsonb_build_object('mimetype', 'image/webp', 'size', 4096)
    )
  $$,
  'the server role can create one valid immutable advocate logo'
);

RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM storage.objects object
    WHERE object.bucket_id = 'advocate-assets'
      AND object.name =
        'logos/logoassettest/41111111-1111-4111-8111-111111111111.webp'
  ),
  1,
  'an anonymous visitor can read the valid public logo object'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'advocate-assets',
      'logos/logoassettest/42222222-2222-4222-8222-222222222222.webp',
      jsonb_build_object('mimetype', 'image/webp', 'size', 4096)
    )
  $$,
  '42501',
  NULL,
  'an anonymous visitor cannot upload an advocate logo'
);

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'advocate-assets',
      'logos/logoassettest/43333333-3333-4333-8333-333333333333.webp',
      jsonb_build_object('mimetype', 'image/webp', 'size', 4096)
    )
  $$,
  '42501',
  NULL,
  'an authenticated browser cannot upload an advocate logo'
);

RESET ROLE;

SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'advocate-assets',
      'logos/missingadvocate/44444444-4444-4444-8444-444444444444.webp',
      jsonb_build_object('mimetype', 'image/webp', 'size', 4096)
    )
  $$,
  '23503',
  'Advocate logo namespace does not exist',
  'a server upload cannot invent a tenant namespace'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'advocate-assets',
      'logos/logoassettest/45555555-5555-4555-8555-555555555555.svg',
      jsonb_build_object('mimetype', 'image/webp', 'size', 4096)
    )
  $$,
  '23514',
  'Advocate logo object path violates the tenant asset boundary',
  'active content extensions are rejected even when the claimed MIME type is WebP'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'advocate-assets',
      'logos/logoassettest/46666666-6666-4666-8666-666666666666.webp',
      jsonb_build_object('mimetype', 'image/svg+xml', 'size', 4096)
    )
  $$,
  '23514',
  'Advocate logo object must be a nonempty WebP no larger than 1 MiB',
  'a WebP extension cannot disguise an active content MIME type'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'advocate-assets',
      'logos/logoassettest/47777777-7777-4777-8777-777777777777.webp',
      jsonb_build_object('mimetype', 'image/webp', 'size', 1048577)
    )
  $$,
  '23514',
  'Advocate logo object must be a nonempty WebP no larger than 1 MiB',
  'an oversized logo is rejected at the database boundary'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES (
      'advocate-assets',
      'logos/logoassettest/48888888-8888-4888-8888-888888888888.webp',
      jsonb_build_object('mimetype', 'image/webp', 'size', 0)
    )
  $$,
  '23514',
  'Advocate logo object must be a nonempty WebP no larger than 1 MiB',
  'an empty logo object is rejected'
);

SELECT extensions.throws_ok(
  $$
    UPDATE storage.objects
    SET metadata = jsonb_build_object('mimetype', 'image/webp', 'size', 8192)
    WHERE bucket_id = 'advocate-assets'
      AND name =
        'logos/logoassettest/41111111-1111-4111-8111-111111111111.webp'
  $$,
  '42501',
  'Advocate logo storage objects are immutable',
  'an existing public logo cannot be overwritten in place'
);

SELECT extensions.throws_ok(
  $$
    UPDATE storage.objects
    SET name =
      'logos/logoassettest/49999999-9999-4999-8999-999999999999.webp'
    WHERE bucket_id = 'advocate-assets'
      AND name =
        'logos/logoassettest/41111111-1111-4111-8111-111111111111.webp'
  $$,
  '42501',
  'Advocate logo storage objects are immutable',
  'an existing public logo cannot be renamed'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM storage.objects object
    WHERE object.bucket_id = 'advocate-assets'
  ),
  1,
  'failed browser and malformed writes leave only the one trusted logo object'
);

SELECT * FROM extensions.finish();

ROLLBACK;
