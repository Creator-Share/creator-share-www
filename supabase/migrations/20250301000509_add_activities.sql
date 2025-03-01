alter table "public"."sponsor_people_images" drop constraint "sponsor_people_images_sponsor_people_id_fkey";

create table "public"."people_activities" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "description" text,
    "child_id" uuid,
    "user_id" uuid
);


alter table "public"."sponsor_people" drop column "image_url";

alter table "public"."sponsor_people" add column "username" text;

alter table "public"."sponsor_people" disable row level security;

alter table "public"."sponsor_people_images" alter column "order_index" set default 0;

alter table "public"."sponsor_people_images" alter column "order_index" drop not null;

CREATE UNIQUE INDEX people_activities_pkey ON public.people_activities USING btree (id);

CREATE UNIQUE INDEX sponsor_people_username_key ON public.sponsor_people USING btree (username);

alter table "public"."people_activities" add constraint "people_activities_pkey" PRIMARY KEY using index "people_activities_pkey";

alter table "public"."people_activities" add constraint "people_activities_child_id_fkey" FOREIGN KEY (child_id) REFERENCES sponsor_people(id) not valid;

alter table "public"."people_activities" validate constraint "people_activities_child_id_fkey";

alter table "public"."people_activities" add constraint "people_activities_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) not valid;

alter table "public"."people_activities" validate constraint "people_activities_user_id_fkey";

alter table "public"."sponsor_people" add constraint "sponsor_people_username_key" UNIQUE using index "sponsor_people_username_key";

alter table "public"."sponsor_people_images" add constraint "sponsor_people_images_sponsor_people_id_fkey" FOREIGN KEY (sponsor_people_id) REFERENCES sponsor_people(id) ON DELETE CASCADE not valid;

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

create policy "insert_user"
on "public"."transaction_ledger"
as permissive
for insert
to public
with check (true);