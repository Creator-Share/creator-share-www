DROP POLICY IF EXISTS "Allow authenticated to insert 1ps738_0"
  ON storage.objects;
DROP POLICY IF EXISTS "Allow update/delete in beneficiaries bucket"
  ON storage.objects;
DROP POLICY IF EXISTS "Allow update/delete to activities-media bucket 15im58k_0"
  ON storage.objects;
DROP POLICY IF EXISTS "Allow update/delete to activities-media bucket 15im58k_1"
  ON storage.objects;
DROP POLICY IF EXISTS "Allow upload to beneficiaries bucket 13n3f43_0"
  ON storage.objects;
DROP POLICY IF EXISTS "Allow upload to beneficiaries bucket 15im58k_0"
  ON storage.objects;
DROP POLICY IF EXISTS "View all items in media 1ps738_0"
  ON storage.objects;

DROP POLICY IF EXISTS media_objects_public_read
  ON storage.objects;
DROP POLICY IF EXISTS media_objects_super_admin_insert
  ON storage.objects;
DROP POLICY IF EXISTS media_objects_super_admin_update
  ON storage.objects;
DROP POLICY IF EXISTS media_objects_super_admin_delete
  ON storage.objects;

CREATE POLICY media_objects_public_read
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'media');

CREATE POLICY media_objects_super_admin_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (SELECT private.is_creator_share_super_admin())
);

CREATE POLICY media_objects_super_admin_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND (SELECT private.is_creator_share_super_admin())
)
WITH CHECK (
  bucket_id = 'media'
  AND (SELECT private.is_creator_share_super_admin())
);

CREATE POLICY media_objects_super_admin_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND (SELECT private.is_creator_share_super_admin())
);
