create type "public"."SubscriptionStatus" as enum ('complete', 'incomplete', 'cancelled');

drop trigger if exists "update_budget_raised" on "public"."transaction_ledger";

alter table "public"."transaction_ledger" drop constraint "transaction_ledger_child_id_fkey";

create table "public"."sponsor_people_images" (
    "id" uuid not null default uuid_generate_v4(),
    "sponsor_people_id" uuid,
    "image_url" text not null,
    "created_at" timestamp with time zone default now(),
    "order_index" integer not null
);


create table "public"."subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid,
    "child_id" uuid,
    "sponsorship_id" text,
    "status" "SubscriptionStatus",
    "amount" integer,
    "interval" text,
    "current_period_start" timestamp without time zone,
    "current_period_end" timestamp without time zone,
    "canceled_at" timestamp without time zone,
    "customer_id" text
);


alter table "public"."sponsor_people" add column "active_subscriptions" integer default 0;

alter table "public"."sponsor_people" enable row level security;

CREATE UNIQUE INDEX sponsor_people_images_pkey ON public.sponsor_people_images USING btree (id);

CREATE UNIQUE INDEX subscriptions_pkey ON public.subscriptions USING btree (id);

alter table "public"."sponsor_people_images" add constraint "sponsor_people_images_pkey" PRIMARY KEY using index "sponsor_people_images_pkey";

alter table "public"."subscriptions" add constraint "subscriptions_pkey" PRIMARY KEY using index "subscriptions_pkey";

alter table "public"."sponsor_people_images" add constraint "sponsor_people_images_sponsor_people_id_fkey" FOREIGN KEY (sponsor_people_id) REFERENCES sponsor_people(id) not valid;

alter table "public"."sponsor_people_images" validate constraint "sponsor_people_images_sponsor_people_id_fkey";

alter table "public"."subscriptions" add constraint "subscriptions_child_id_fkey" FOREIGN KEY (child_id) REFERENCES sponsor_people(id) ON UPDATE CASCADE ON DELETE SET NULL not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_child_id_fkey";

alter table "public"."subscriptions" add constraint "subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_user_id_fkey";

alter table "public"."transaction_ledger" add constraint "transaction_ledger_child_id_fkey" FOREIGN KEY (child_id) REFERENCES sponsor_people(id) ON UPDATE CASCADE ON DELETE SET NULL not valid;

alter table "public"."transaction_ledger" validate constraint "transaction_ledger_child_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_active_subscription_total(child_uuid uuid)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(sum(amount), 0)
  from subscriptions 
  where child_id = child_uuid
  and status = 'active'
  and (canceled_at is null or canceled_at > now());
$function$
;

CREATE OR REPLACE FUNCTION public.handle_active_subscriptions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.active_subscriptions = old.active_subscriptions;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.calc_budget_raised()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  total_amount int;
BEGIN
  SELECT SUM(
    CASE 
      WHEN s.interval = 'year' THEN s.amount / 12
      ELSE s.amount
    END
  )
  INTO total_amount
  FROM subscriptions s
  WHERE s.child_id = NEW.child_id
  AND s.status != 'cancelled';

  UPDATE sponsor_people 
  SET budget_raised = total_amount 
  WHERE id = NEW.child_id;

  RETURN NEW;
END; 
$function$
;

grant delete on table "public"."sponsor_people_images" to "anon";

grant insert on table "public"."sponsor_people_images" to "anon";

grant references on table "public"."sponsor_people_images" to "anon";

grant select on table "public"."sponsor_people_images" to "anon";

grant trigger on table "public"."sponsor_people_images" to "anon";

grant truncate on table "public"."sponsor_people_images" to "anon";

grant update on table "public"."sponsor_people_images" to "anon";

grant delete on table "public"."sponsor_people_images" to "authenticated";

grant insert on table "public"."sponsor_people_images" to "authenticated";

grant references on table "public"."sponsor_people_images" to "authenticated";

grant select on table "public"."sponsor_people_images" to "authenticated";

grant trigger on table "public"."sponsor_people_images" to "authenticated";

grant truncate on table "public"."sponsor_people_images" to "authenticated";

grant update on table "public"."sponsor_people_images" to "authenticated";

grant delete on table "public"."sponsor_people_images" to "service_role";

grant insert on table "public"."sponsor_people_images" to "service_role";

grant references on table "public"."sponsor_people_images" to "service_role";

grant select on table "public"."sponsor_people_images" to "service_role";

grant trigger on table "public"."sponsor_people_images" to "service_role";

grant truncate on table "public"."sponsor_people_images" to "service_role";

grant update on table "public"."sponsor_people_images" to "service_role";

grant delete on table "public"."subscriptions" to "anon";

grant insert on table "public"."subscriptions" to "anon";

grant references on table "public"."subscriptions" to "anon";

grant select on table "public"."subscriptions" to "anon";

grant trigger on table "public"."subscriptions" to "anon";

grant truncate on table "public"."subscriptions" to "anon";

grant update on table "public"."subscriptions" to "anon";

grant delete on table "public"."subscriptions" to "authenticated";

grant insert on table "public"."subscriptions" to "authenticated";

grant references on table "public"."subscriptions" to "authenticated";

grant select on table "public"."subscriptions" to "authenticated";

grant trigger on table "public"."subscriptions" to "authenticated";

grant truncate on table "public"."subscriptions" to "authenticated";

grant update on table "public"."subscriptions" to "authenticated";

grant delete on table "public"."subscriptions" to "service_role";

grant insert on table "public"."subscriptions" to "service_role";

grant references on table "public"."subscriptions" to "service_role";

grant select on table "public"."subscriptions" to "service_role";

grant trigger on table "public"."subscriptions" to "service_role";

grant truncate on table "public"."subscriptions" to "service_role";

grant update on table "public"."subscriptions" to "service_role";

create policy "Enable delete for SUPER_ADMIN users only"
on "public"."sponsor_people"
as permissive
for delete
to public
using ((EXISTS ( SELECT 1
   FROM (role_assignments ra
     JOIN roles r ON ((r.id = ra.role_id)))
  WHERE ((ra.user_id = auth.uid()) AND (r.name = 'SUPER_ADMIN'::text)))));


create policy "Enable insert for SUPER_ADMIN users only"
on "public"."sponsor_people"
as permissive
for insert
to public
with check ((EXISTS ( SELECT 1
   FROM (role_assignments ra
     JOIN roles r ON ((r.id = ra.role_id)))
  WHERE ((ra.user_id = auth.uid()) AND (r.name = 'SUPER_ADMIN'::text)))));


create policy "Enable update for SUPER_ADMIN users only"
on "public"."sponsor_people"
as permissive
for update
to public
using ((EXISTS ( SELECT 1
   FROM (role_assignments ra
     JOIN roles r ON ((r.id = ra.role_id)))
  WHERE ((ra.user_id = auth.uid()) AND (r.name = 'SUPER_ADMIN'::text)))));


CREATE TRIGGER preserve_active_subscriptions BEFORE UPDATE ON public.sponsor_people FOR EACH ROW EXECUTE FUNCTION handle_active_subscriptions();

CREATE TRIGGER update_budget_raised AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION calc_budget_raised();


