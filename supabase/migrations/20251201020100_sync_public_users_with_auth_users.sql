-- Sync public.users.id with auth.users.id
-- This ensures public.users.id matches auth.users.id for all users (matched by email)
-- 
-- Note: PostgreSQL doesn't support ON UPDATE CASCADE, so we need to:
-- 1. Update foreign keys in tables that reference public.users.id
-- 2. Then sync public.users.id to match auth.users.id
--
-- Tables that still reference public.users.id (need updating):
-- - subscriptions
-- - activities  
-- - transaction_ledger
-- (role_assignments is handled in a separate migration to reference auth.users.id)

-- Step 1: Update foreign keys in related tables to use auth.users.id
-- This ensures data integrity before we sync public.users

UPDATE "public"."subscriptions" s
SET "user_id" = au.id
FROM "public"."users" pu
JOIN "auth"."users" au ON pu.email = au.email
WHERE s.user_id = pu.id AND s.user_id != au.id;

UPDATE "public"."activities" a
SET "user_id" = au.id
FROM "public"."users" pu
JOIN "auth"."users" au ON pu.email = au.email
WHERE a.user_id = pu.id AND a.user_id != au.id;

UPDATE "public"."transaction_ledger" tl
SET "user_id" = au.id
FROM "public"."users" pu
JOIN "auth"."users" au ON pu.email = au.email
WHERE tl.user_id = pu.id AND tl.user_id != au.id;

-- Step 2: Store data from old public.users records in a temp table before deletion
CREATE TEMP TABLE user_data_backup AS
SELECT 
  pu.email,
  pu.first_name,
  pu.last_name,
  pu.created_at
FROM "public"."users" pu
WHERE EXISTS (
  SELECT 1 FROM "auth"."users" au 
  WHERE au.email = pu.email 
    AND au.id != pu.id
);

-- Step 3: Delete old public.users records with wrong IDs
-- This must happen BEFORE inserting to avoid email unique constraint violations
DELETE FROM "public"."users" pu
WHERE EXISTS (
  SELECT 1 FROM "auth"."users" au 
  WHERE au.email = pu.email 
    AND au.id != pu.id
);

-- Step 4: Insert new records with correct IDs, using backed up data where available
INSERT INTO "public"."users" (id, email, first_name, last_name, created_at)
SELECT 
  au.id,
  au.email,
  COALESCE(backup.first_name, au.raw_user_meta_data->>'first_name') as first_name,
  COALESCE(backup.last_name, au.raw_user_meta_data->>'last_name') as last_name,
  COALESCE(backup.created_at, au.created_at) as created_at
FROM "auth"."users" au
LEFT JOIN user_data_backup backup ON backup.email = au.email
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."users" WHERE id = au.id
)
ON CONFLICT (id) DO NOTHING;

-- Clean up temp table
DROP TABLE IF EXISTS user_data_backup;

-- Step 4: Delete orphaned public.users records (no matching auth.users)
DELETE FROM "public"."users" pu
WHERE NOT EXISTS (
  SELECT 1 FROM "auth"."users" au WHERE au.email = pu.email
);

