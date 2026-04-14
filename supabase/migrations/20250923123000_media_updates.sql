DO $$ BEGIN
  CREATE TYPE "public"."media_type" AS ENUM ('IMAGE', 'VIDEO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

revoke delete on table "public"."media" from "anon";

revoke insert on table "public"."media" from "anon";

revoke references on table "public"."media" from "anon";

revoke select on table "public"."media" from "anon";

revoke trigger on table "public"."media" from "anon";

revoke truncate on table "public"."media" from "anon";

revoke update on table "public"."media" from "anon";

revoke delete on table "public"."media" from "authenticated";

revoke insert on table "public"."media" from "authenticated";

revoke references on table "public"."media" from "authenticated";

revoke select on table "public"."media" from "authenticated";

revoke trigger on table "public"."media" from "authenticated";

revoke truncate on table "public"."media" from "authenticated";

revoke update on table "public"."media" from "authenticated";

revoke delete on table "public"."media" from "service_role";

revoke insert on table "public"."media" from "service_role";

revoke references on table "public"."media" from "service_role";

revoke select on table "public"."media" from "service_role";

revoke trigger on table "public"."media" from "service_role";

revoke truncate on table "public"."media" from "service_role";

revoke update on table "public"."media" from "service_role";

ALTER TABLE "public"."media" DROP CONSTRAINT IF EXISTS "media_activity_id_fkey";

ALTER TABLE "public"."media" DROP CONSTRAINT IF EXISTS "media_beneficiary_id_fkey";

ALTER TABLE "public"."media" DROP CONSTRAINT IF EXISTS "sponsor_people_images_sponsor_people_id_fkey";

DO $$ BEGIN
  ALTER TABLE "public"."media" DROP COLUMN "activity_id";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."media" DROP COLUMN "beneficiary_id";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."media" DROP COLUMN "image_url";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."media" DROP COLUMN "order_index";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."media" ADD COLUMN "extension" text NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."media" ADD COLUMN "parent_id" uuid NOT NULL DEFAULT gen_random_uuid();
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."media" ADD COLUMN "type" media_type;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."media" ADD COLUMN "weight" integer DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

alter table "public"."media" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."media" enable row level security;

DO $$ BEGIN
  create policy "Enable insert for authenticated users only"
  on "public"."media"
  as permissive
  for insert
  to authenticated
  with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Enable read access for all users"
  on "public"."media"
  as permissive
  for select
  to public
  using (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Enable update for authenticated users only"
  on "public"."media"
  as permissive
  for update
  to authenticated
  using (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
