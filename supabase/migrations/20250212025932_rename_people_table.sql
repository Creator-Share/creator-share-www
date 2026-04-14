DO $$ BEGIN
  CREATE TYPE "public"."Gender" AS ENUM ('Boy', 'Girl');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  drop policy "Enable read access for all users" on "public"."people";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

revoke delete on table "public"."people" from "anon";

revoke insert on table "public"."people" from "anon";

revoke references on table "public"."people" from "anon";

revoke select on table "public"."people" from "anon";

revoke trigger on table "public"."people" from "anon";

revoke truncate on table "public"."people" from "anon";

revoke update on table "public"."people" from "anon";

revoke delete on table "public"."people" from "authenticated";

revoke insert on table "public"."people" from "authenticated";

revoke references on table "public"."people" from "authenticated";

revoke select on table "public"."people" from "authenticated";

revoke trigger on table "public"."people" from "authenticated";

revoke truncate on table "public"."people" from "authenticated";

revoke update on table "public"."people" from "authenticated";

revoke delete on table "public"."people" from "service_role";

revoke insert on table "public"."people" from "service_role";

revoke references on table "public"."people" from "service_role";

revoke select on table "public"."people" from "service_role";

revoke trigger on table "public"."people" from "service_role";

revoke truncate on table "public"."people" from "service_role";

revoke update on table "public"."people" from "service_role";

DO $$ BEGIN
  ALTER TABLE "public"."role_assignments" DROP CONSTRAINT "role_assignments_user_id_fkey";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."people" DROP CONSTRAINT "people_pkey";
EXCEPTION WHEN undefined_table THEN NULL;
       WHEN undefined_object THEN NULL;
END $$;

drop index if exists "public"."people_pkey";

drop table if exists "public"."people";

DO $$ BEGIN
  ALTER TYPE "public"."PersonStatus" RENAME TO "PersonStatus__old_version_to_be_dropped";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."PersonStatus" AS ENUM ('New', 'Partially Funded', 'Budget Fulfilled', 'Archived', 'Draft');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

create table if not exists "public"."sponsor_people" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "name" text,
    "birth_date" date,
    "biography" text,
    "budget_goal" integer default 0,
    "budget_raised" integer default 0,
    "status" "PersonStatus" default 'New'::"PersonStatus",
    "country" text,
    "location_str" text,
    "location_geo" geometry,
    "image_url" text,
    "gender" "Gender",
    "video_url" text,
    "introduction" text
);


alter table "public"."sponsor_people" enable row level security;

create table if not exists "public"."users" (
    "id" uuid not null default gen_random_uuid(),
    "first_name" text,
    "last_name" text,
    "email" text not null,
    "created_at" timestamp without time zone default now()
);


DROP TYPE IF EXISTS "public"."PersonStatus__old_version_to_be_dropped";

DO $$ BEGIN
  ALTER TABLE "public"."role_assignments" ALTER COLUMN "advocate_id" DROP DEFAULT;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."roles" ADD COLUMN "display_name" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_people_location ON public.sponsor_people USING gist (location_geo);

CREATE INDEX IF NOT EXISTS idx_people_location_geo ON public.sponsor_people USING gist (location_geo);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON public.users USING btree (email);

CREATE UNIQUE INDEX IF NOT EXISTS users_pkey ON public.users USING btree (id);

CREATE UNIQUE INDEX IF NOT EXISTS people_pkey ON public.sponsor_people USING btree (id);

DO $$ BEGIN
  alter table "public"."sponsor_people" add constraint "people_pkey" PRIMARY KEY using index "people_pkey";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."users" add constraint "users_email_key" UNIQUE using index "users_email_key";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."role_assignments" add constraint "role_assignments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."role_assignments" validate constraint "role_assignments_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.filter_by_polygon(sw_lng double precision, sw_lat double precision, ne_lng double precision, ne_lat double precision)
 RETURNS SETOF sponsor_people
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT *
    FROM people
    WHERE ST_Contains(
        ST_MakeEnvelope(sw_lng, sw_lat, ne_lng, ne_lat, 4326),
        location_geo::geometry
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$BEGIN
  INSERT INTO public.users (id, first_name, last_name, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.email
  );
  RETURN NEW;
END;$function$
;

grant delete on table "public"."sponsor_people" to "anon";

grant insert on table "public"."sponsor_people" to "anon";

grant references on table "public"."sponsor_people" to "anon";

grant select on table "public"."sponsor_people" to "anon";

grant trigger on table "public"."sponsor_people" to "anon";

grant truncate on table "public"."sponsor_people" to "anon";

grant update on table "public"."sponsor_people" to "anon";

grant delete on table "public"."sponsor_people" to "authenticated";

grant insert on table "public"."sponsor_people" to "authenticated";

grant references on table "public"."sponsor_people" to "authenticated";

grant select on table "public"."sponsor_people" to "authenticated";

grant trigger on table "public"."sponsor_people" to "authenticated";

grant truncate on table "public"."sponsor_people" to "authenticated";

grant update on table "public"."sponsor_people" to "authenticated";

grant delete on table "public"."sponsor_people" to "service_role";

grant insert on table "public"."sponsor_people" to "service_role";

grant references on table "public"."sponsor_people" to "service_role";

grant select on table "public"."sponsor_people" to "service_role";

grant trigger on table "public"."sponsor_people" to "service_role";

grant truncate on table "public"."sponsor_people" to "service_role";

grant update on table "public"."sponsor_people" to "service_role";

grant delete on table "public"."users" to "anon";

grant insert on table "public"."users" to "anon";

grant references on table "public"."users" to "anon";

grant select on table "public"."users" to "anon";

grant trigger on table "public"."users" to "anon";

grant truncate on table "public"."users" to "anon";

grant update on table "public"."users" to "anon";

grant delete on table "public"."users" to "authenticated";

grant insert on table "public"."users" to "authenticated";

grant references on table "public"."users" to "authenticated";

grant select on table "public"."users" to "authenticated";

grant trigger on table "public"."users" to "authenticated";

grant truncate on table "public"."users" to "authenticated";

grant update on table "public"."users" to "authenticated";

grant delete on table "public"."users" to "service_role";

grant insert on table "public"."users" to "service_role";

grant references on table "public"."users" to "service_role";

grant select on table "public"."users" to "service_role";

grant trigger on table "public"."users" to "service_role";

grant truncate on table "public"."users" to "service_role";

grant update on table "public"."users" to "service_role";

DO $$ BEGIN
  create policy "Enable read access for all users"
  on "public"."sponsor_people"
  as permissive
  for select
  to public
  using (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



