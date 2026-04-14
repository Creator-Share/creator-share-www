DO $$ BEGIN
  CREATE TYPE "public"."activity_source" AS ENUM ('admin', 'sponsorship', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."partnership_frequency" AS ENUM ('monthly', 'annually');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."project_type" AS ENUM ('emergency', 'education', 'shelter', 'nutrition', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

revoke delete on table "public"."spatial_ref_sys" from "anon";

revoke insert on table "public"."spatial_ref_sys" from "anon";

revoke references on table "public"."spatial_ref_sys" from "anon";

revoke select on table "public"."spatial_ref_sys" from "anon";

revoke trigger on table "public"."spatial_ref_sys" from "anon";

revoke truncate on table "public"."spatial_ref_sys" from "anon";

revoke update on table "public"."spatial_ref_sys" from "anon";

revoke delete on table "public"."spatial_ref_sys" from "authenticated";

revoke insert on table "public"."spatial_ref_sys" from "authenticated";

revoke references on table "public"."spatial_ref_sys" from "authenticated";

revoke select on table "public"."spatial_ref_sys" from "authenticated";

revoke trigger on table "public"."spatial_ref_sys" from "authenticated";

revoke truncate on table "public"."spatial_ref_sys" from "authenticated";

revoke update on table "public"."spatial_ref_sys" from "authenticated";

revoke delete on table "public"."spatial_ref_sys" from "postgres";

revoke insert on table "public"."spatial_ref_sys" from "postgres";

revoke references on table "public"."spatial_ref_sys" from "postgres";

revoke select on table "public"."spatial_ref_sys" from "postgres";

revoke trigger on table "public"."spatial_ref_sys" from "postgres";

revoke truncate on table "public"."spatial_ref_sys" from "postgres";

revoke update on table "public"."spatial_ref_sys" from "postgres";

revoke delete on table "public"."spatial_ref_sys" from "service_role";

revoke insert on table "public"."spatial_ref_sys" from "service_role";

revoke references on table "public"."spatial_ref_sys" from "service_role";

revoke select on table "public"."spatial_ref_sys" from "service_role";

revoke trigger on table "public"."spatial_ref_sys" from "service_role";

revoke truncate on table "public"."spatial_ref_sys" from "service_role";

revoke update on table "public"."spatial_ref_sys" from "service_role";

create table if not exists "public"."activity_subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "beneficiary_id" uuid not null,
    "email" text not null,
    "created_at" timestamp with time zone default now()
);


create table if not exists "public"."partnerships" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "amount" integer not null,
    "frequency" partnership_frequency not null,
    "project" project_type not null default 'general'::project_type,
    "status" text not null default 'pending'::text,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "updated_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "customer_id" text,
    "card_number" text,
    "sponsorship_id" text,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "card_type" text,
    "payment_intent" text
);

DO $$ BEGIN
  ALTER TYPE "public"."beneficiary_types" RENAME TO "beneficiary_types__old_version_to_be_dropped";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."beneficiary_types" AS ENUM ('CHILD', 'ANIMAL', 'FAMILY', 'STREET_INVOLVED', 'CHILD_LABORER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."beneficiaries" ALTER COLUMN beneficiary_type TYPE "public"."beneficiary_types" USING beneficiary_type::text::"public"."beneficiary_types";
EXCEPTION WHEN others THEN NULL;
END $$;

DROP TYPE IF EXISTS "public"."beneficiary_types__old_version_to_be_dropped";

DO $$ BEGIN
  ALTER TABLE "public"."activities" ADD COLUMN "created_by" activity_source;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."activities" ADD COLUMN "images_url" jsonb DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."activities" ADD COLUMN "videos_url" jsonb DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS beneficiary_subscriptions_beneficiary_id_email_key ON public.activity_subscriptions USING btree (beneficiary_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS beneficiary_subscriptions_pkey ON public.activity_subscriptions USING btree (id);

CREATE INDEX IF NOT EXISTS idx_beneficiary_subscriptions_beneficiary_id ON public.activity_subscriptions USING btree (beneficiary_id);

CREATE INDEX IF NOT EXISTS partnerships_created_at_idx ON public.partnerships USING btree (created_at);

CREATE INDEX IF NOT EXISTS partnerships_email_idx ON public.partnerships USING btree (email);

CREATE UNIQUE INDEX IF NOT EXISTS partnerships_pkey ON public.partnerships USING btree (id);

CREATE INDEX IF NOT EXISTS partnerships_status_idx ON public.partnerships USING btree (status);

DO $$ BEGIN
  alter table "public"."activity_subscriptions" add constraint "beneficiary_subscriptions_pkey" PRIMARY KEY using index "beneficiary_subscriptions_pkey";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."partnerships" add constraint "partnerships_pkey" PRIMARY KEY using index "partnerships_pkey";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."activity_subscriptions" add constraint "beneficiary_subscriptions_beneficiary_id_email_key" UNIQUE using index "beneficiary_subscriptions_beneficiary_id_email_key";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."activity_subscriptions" add constraint "beneficiary_subscriptions_beneficiary_id_fkey" FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id) ON DELETE CASCADE not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."activity_subscriptions" validate constraint "beneficiary_subscriptions_beneficiary_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."activity_subscriptions" to "anon";

grant insert on table "public"."activity_subscriptions" to "anon";

grant references on table "public"."activity_subscriptions" to "anon";

grant select on table "public"."activity_subscriptions" to "anon";

grant trigger on table "public"."activity_subscriptions" to "anon";

grant truncate on table "public"."activity_subscriptions" to "anon";

grant update on table "public"."activity_subscriptions" to "anon";

grant delete on table "public"."activity_subscriptions" to "authenticated";

grant insert on table "public"."activity_subscriptions" to "authenticated";

grant references on table "public"."activity_subscriptions" to "authenticated";

grant select on table "public"."activity_subscriptions" to "authenticated";

grant trigger on table "public"."activity_subscriptions" to "authenticated";

grant truncate on table "public"."activity_subscriptions" to "authenticated";

grant update on table "public"."activity_subscriptions" to "authenticated";

grant delete on table "public"."activity_subscriptions" to "service_role";

grant insert on table "public"."activity_subscriptions" to "service_role";

grant references on table "public"."activity_subscriptions" to "service_role";

grant select on table "public"."activity_subscriptions" to "service_role";

grant trigger on table "public"."activity_subscriptions" to "service_role";

grant truncate on table "public"."activity_subscriptions" to "service_role";

grant update on table "public"."activity_subscriptions" to "service_role";

grant delete on table "public"."partnerships" to "anon";

grant insert on table "public"."partnerships" to "anon";

grant references on table "public"."partnerships" to "anon";

grant select on table "public"."partnerships" to "anon";

grant trigger on table "public"."partnerships" to "anon";

grant truncate on table "public"."partnerships" to "anon";

grant update on table "public"."partnerships" to "anon";

grant delete on table "public"."partnerships" to "authenticated";

grant insert on table "public"."partnerships" to "authenticated";

grant references on table "public"."partnerships" to "authenticated";

grant select on table "public"."partnerships" to "authenticated";

grant trigger on table "public"."partnerships" to "authenticated";

grant truncate on table "public"."partnerships" to "authenticated";

grant update on table "public"."partnerships" to "authenticated";

grant delete on table "public"."partnerships" to "service_role";

grant insert on table "public"."partnerships" to "service_role";

grant references on table "public"."partnerships" to "service_role";

grant select on table "public"."partnerships" to "service_role";

grant trigger on table "public"."partnerships" to "service_role";

grant truncate on table "public"."partnerships" to "service_role";

grant update on table "public"."partnerships" to "service_role";

DO $$ BEGIN
  create policy "Allow public insert"
  on "public"."partnerships"
  as permissive
  for insert
  to public
  with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Allow users to view own partnerships"
  on "public"."partnerships"
  as permissive
  for select
  to authenticated
  using ((email = (auth.jwt() ->> 'email'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DROP TRIGGER IF EXISTS update_partnerships_updated_at ON public.partnerships;
CREATE TRIGGER update_partnerships_updated_at BEFORE UPDATE ON public.partnerships FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
