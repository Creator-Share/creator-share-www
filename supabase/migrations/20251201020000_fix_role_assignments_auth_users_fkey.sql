-- Fix role_assignments to reference auth.users.id instead of public.users.id
-- This is the correct security practice - auth.users is the source of truth for authentication

-- Step 1: Migrate any role_assignments that reference public.users.id to auth.users.id
-- If a public.users.id doesn't exist in auth.users, we need to find the matching auth.users.id by email
UPDATE "public"."role_assignments" ra
SET "user_id" = au.id
FROM "public"."users" pu
JOIN "auth"."users" au ON pu.email = au.email
WHERE ra.user_id = pu.id
  AND ra.user_id != au.id;

-- Step 2: Delete any role_assignments that can't be matched to auth.users
-- (These are orphaned records that shouldn't exist)
DELETE FROM "public"."role_assignments" ra
WHERE NOT EXISTS (
  SELECT 1 FROM "auth"."users" au WHERE au.id = ra.user_id
);

-- Step 3: Drop the existing foreign key constraint
ALTER TABLE "public"."role_assignments" 
  DROP CONSTRAINT IF EXISTS "role_assignments_user_id_fkey";

-- Step 4: Add the correct foreign key constraint referencing auth.users
ALTER TABLE "public"."role_assignments" 
  ADD CONSTRAINT "role_assignments_user_id_fkey" 
  FOREIGN KEY ("user_id") 
  REFERENCES "auth"."users"("id") 
  ON DELETE CASCADE;

