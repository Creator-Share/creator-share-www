create type "public"."activity_source" as enum ('admin', 'sponsorship', 'system');

create type "public"."partnership_frequency" as enum ('monthly', 'annually');

create type "public"."project_type" as enum ('emergency', 'education', 'shelter', 'nutrition', 'general');

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

create table "public"."activity_subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "beneficiary_id" uuid not null,
    "email" text not null,
    "created_at" timestamp with time zone default now()
);


create table "public"."partnerships" (
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
    "stripe_subscription_id" text,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "card_type" text,
    "payment_intent" text
);

alter type "public"."beneficiary_types" rename to "beneficiary_types__old_version_to_be_dropped";

create type "public"."beneficiary_types" as enum ('CHILD', 'ANIMAL', 'FAMILY', 'STREET_INVOLVED', 'CHILD_LABORER');

alter table "public"."beneficiaries" alter column beneficiary_type type "public"."beneficiary_types" using beneficiary_type::text::"public"."beneficiary_types";

drop type "public"."beneficiary_types__old_version_to_be_dropped";

alter table "public"."activities" add column "created_by" activity_source;

alter table "public"."activities" add column "images_url" jsonb default '[]'::jsonb;

alter table "public"."activities" add column "videos_url" jsonb default '[]'::jsonb;

CREATE UNIQUE INDEX beneficiary_subscriptions_beneficiary_id_email_key ON public.activity_subscriptions USING btree (beneficiary_id, email);

CREATE UNIQUE INDEX beneficiary_subscriptions_pkey ON public.activity_subscriptions USING btree (id);

CREATE INDEX idx_beneficiary_subscriptions_beneficiary_id ON public.activity_subscriptions USING btree (beneficiary_id);

CREATE INDEX partnerships_created_at_idx ON public.partnerships USING btree (created_at);

CREATE INDEX partnerships_email_idx ON public.partnerships USING btree (email);

CREATE UNIQUE INDEX partnerships_pkey ON public.partnerships USING btree (id);

CREATE INDEX partnerships_status_idx ON public.partnerships USING btree (status);

alter table "public"."activity_subscriptions" add constraint "beneficiary_subscriptions_pkey" PRIMARY KEY using index "beneficiary_subscriptions_pkey";

alter table "public"."partnerships" add constraint "partnerships_pkey" PRIMARY KEY using index "partnerships_pkey";

alter table "public"."activity_subscriptions" add constraint "beneficiary_subscriptions_beneficiary_id_email_key" UNIQUE using index "beneficiary_subscriptions_beneficiary_id_email_key";

alter table "public"."activity_subscriptions" add constraint "beneficiary_subscriptions_beneficiary_id_fkey" FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id) ON DELETE CASCADE not valid;

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

create policy "Allow public insert"
on "public"."partnerships"
as permissive
for insert
to public
with check (true);


create policy "Allow users to view own partnerships"
on "public"."partnerships"
as permissive
for select
to authenticated
using ((email = (auth.jwt() ->> 'email'::text)));


CREATE TRIGGER update_partnerships_updated_at BEFORE UPDATE ON public.partnerships FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();