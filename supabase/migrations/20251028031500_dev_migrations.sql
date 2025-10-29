alter table "public"."activities" add column "activity_source" activity_source;

alter table "public"."activities" add column "metadata" jsonb;

alter table "public"."beneficiaries" add column "goal_fulfilled_at" timestamp with time zone;

alter table "public"."beneficiary_reservations" disable row level security;

alter table "public"."expense_assignments" disable row level security;

alter table "public"."expenses" disable row level security;

alter table "public"."media" disable row level security;

alter table "public"."organization" add column "name" text;

alter table "public"."partnerships" drop column "sponsorship_id";

alter table "public"."partnerships" add column "stripe_subscription_id" text;

alter table "public"."role_assignments" disable row level security;

alter table "public"."subscriptions" drop column "sponsorship_id";

alter table "public"."subscriptions" add column "email_notification" boolean;

CREATE TYPE public.sponsorship_method AS ENUM ('PAYPAL', 'STRIPE');

alter table "public"."subscriptions" add column "sponsorship_method" sponsorship_method;

alter table "public"."subscriptions" add column "stripe_subscription_id" text;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_user_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Check if the user already exists in public.users
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NEW.id) THEN
    -- Insert into public.users only if the user doesn't exist
    INSERT INTO public.users (id, first_name, last_name, email)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data ->> 'first_name',
        NEW.raw_user_meta_data ->> 'last_name',
        NEW.email
    );
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_user_registration();

create policy "Allow update/delete in beneficiaries bucket"
on "storage"."objects"
as permissive
for all
to public
using (((bucket_id = 'beneficiaries'::text) AND (auth.role() = 'authenticated'::text)));

create policy "View all items in media 1ps738_0"
on "storage"."objects"
as permissive
for select
to public
using ((bucket_id = 'media'::text));