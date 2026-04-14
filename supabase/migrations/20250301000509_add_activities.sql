DO $$ BEGIN
  ALTER TABLE "public"."sponsor_people_images" DROP CONSTRAINT "sponsor_people_images_sponsor_people_id_fkey";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

create table if not exists "public"."people_activities" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "description" text,
    "child_id" uuid,
    "user_id" uuid
);


DO $$ BEGIN
  ALTER TABLE "public"."sponsor_people" DROP COLUMN "image_url";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."sponsor_people" ADD COLUMN "username" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

alter table "public"."sponsor_people" disable row level security;

alter table "public"."sponsor_people_images" alter column "order_index" set default 0;

alter table "public"."sponsor_people_images" alter column "order_index" drop not null;

CREATE UNIQUE INDEX IF NOT EXISTS people_activities_pkey ON public.people_activities USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS sponsor_people_username_key ON public.sponsor_people USING btree (username);

DO $$ BEGIN
  alter table "public"."people_activities" add constraint "people_activities_pkey" PRIMARY KEY using index "people_activities_pkey";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."people_activities" add constraint "people_activities_child_id_fkey" FOREIGN KEY (child_id) REFERENCES sponsor_people(id) not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."people_activities" validate constraint "people_activities_child_id_fkey";

DO $$ BEGIN
  alter table "public"."people_activities" add constraint "people_activities_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."people_activities" validate constraint "people_activities_user_id_fkey";

DO $$ BEGIN
  alter table "public"."sponsor_people" add constraint "sponsor_people_username_key" UNIQUE using index "sponsor_people_username_key";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."sponsor_people_images" add constraint "sponsor_people_images_sponsor_people_id_fkey" FOREIGN KEY (sponsor_people_id) REFERENCES sponsor_people(id) ON DELETE CASCADE not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."sponsor_people_images" validate constraint "sponsor_people_images_sponsor_people_id_fkey";

set check_function_bodies = off;

grant delete on table "public"."people_activities" to "anon";

grant insert on table "public"."people_activities" to "anon";

grant references on table "public"."people_activities" to "anon";

grant select on table "public"."people_activities" to "anon";

grant trigger on table "public"."people_activities" to "anon";

grant truncate on table "public"."people_activities" to "anon";

grant update on table "public"."people_activities" to "anon";

grant delete on table "public"."people_activities" to "authenticated";

grant insert on table "public"."people_activities" to "authenticated";

grant references on table "public"."people_activities" to "authenticated";

grant select on table "public"."people_activities" to "authenticated";

grant trigger on table "public"."people_activities" to "authenticated";

grant truncate on table "public"."people_activities" to "authenticated";

grant update on table "public"."people_activities" to "authenticated";

grant delete on table "public"."people_activities" to "service_role";

grant insert on table "public"."people_activities" to "service_role";

grant references on table "public"."people_activities" to "service_role";

grant select on table "public"."people_activities" to "service_role";

grant trigger on table "public"."people_activities" to "service_role";

grant truncate on table "public"."people_activities" to "service_role";

grant update on table "public"."people_activities" to "service_role";

DO $$ BEGIN
  create policy "insert_user"
  on "public"."transaction_ledger"
  as permissive
  for insert
  to public
  with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;