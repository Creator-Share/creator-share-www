BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(4);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.policyname IN (
        'Allow authenticated to insert 1ps738_0',
        'Allow update/delete in beneficiaries bucket',
        'Allow update/delete to activities-media bucket 15im58k_0',
        'Allow update/delete to activities-media bucket 15im58k_1',
        'Allow upload to beneficiaries bucket 13n3f43_0',
        'Allow upload to beneficiaries bucket 15im58k_0',
        'View all items in media 1ps738_0'
      )
  ),
  0,
  'legacy storage policies no longer grant every signed in account write access'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.policyname = 'media_objects_public_read'
      AND policy.cmd = 'SELECT'
      AND policy.roles = ARRAY['public']::name[]
      AND policy.qual = '(bucket_id = ''media''::text)'
  ),
  1,
  'the public can read only objects in the public media bucket'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.policyname IN (
        'media_objects_super_admin_insert',
        'media_objects_super_admin_update',
        'media_objects_super_admin_delete'
      )
      AND policy.roles = ARRAY['authenticated']::name[]
      AND concat_ws(' ', policy.qual, policy.with_check)
        LIKE '%is_creator_share_super_admin%'
  ),
  3,
  'all media storage mutations require a Creator Share super administrator'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_policies policy
    WHERE policy.schemaname = 'storage'
      AND policy.tablename = 'objects'
      AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (
        policy.roles && ARRAY['public', 'anon']::name[]
        OR concat_ws(' ', policy.qual, policy.with_check)
          NOT LIKE '%is_creator_share_super_admin%'
      )
  ),
  0,
  'storage has no public or unguarded mutation policy'
);

SELECT * FROM extensions.finish();

ROLLBACK;
