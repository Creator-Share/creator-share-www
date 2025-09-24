create type "public"."media_type" as enum ('IMAGE', 'VIDEO');

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

alter table "public"."media" drop constraint "media_activity_id_fkey";

alter table "public"."media" drop constraint "media_beneficiary_id_fkey";

alter table "public"."media" drop constraint "sponsor_people_images_sponsor_people_id_fkey";

alter table "public"."media" drop column "activity_id";

alter table "public"."media" drop column "beneficiary_id";

alter table "public"."media" drop column "image_url";

alter table "public"."media" drop column "order_index";

alter table "public"."media" add column "extension" text not null;

alter table "public"."media" add column "parent_id" uuid not null;

alter table "public"."media" add column "type" media_type;

alter table "public"."media" add column "weight" integer default 0;

alter table "public"."media" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."media" enable row level security;

create policy "Enable insert for authenticated users only"
on "public"."media"
as permissive
for insert
to authenticated
with check (true);


create policy "Enable read access for all users"
on "public"."media"
as permissive
for select
to public
using (true);


create policy "Enable update for authenticated users only"
on "public"."media"
as permissive
for update
to authenticated
using (true);
