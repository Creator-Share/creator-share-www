drop extension if exists "pg_net";

DO $$ BEGIN
  CREATE TYPE "public"."sponsorship_method" AS ENUM ('PAYPAL', 'STRIPE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

create table if not exists "public"."beneficiary_reservations" (
  "id" uuid not null default gen_random_uuid(),
  "beneficiary_id" uuid not null,
  "reservation_token" text not null,
  "user_id" uuid,
  "expires_at" timestamp with time zone not null default (now() + '00:15:00'::interval),
  "created_at" timestamp with time zone not null default now(),
  "created_ip" text,
  "user_agent" text
    );

DO $$ BEGIN
  ALTER TABLE "public"."activities" ADD COLUMN "activity_source" public.activity_source;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."activities" ADD COLUMN "metadata" jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."beneficiaries" ADD COLUMN "goal_fulfilled_at" timestamp with time zone;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."beneficiaries" ADD COLUMN "sort_weight" integer;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

alter table "public"."beneficiaries" enable row level security;

alter table "public"."expense_assignments" disable row level security;

alter table "public"."expenses" disable row level security;

alter table "public"."media" disable row level security;

DO $$ BEGIN
  ALTER TABLE "public"."organization" ADD COLUMN "name" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."partnerships" DROP COLUMN "sponsorship_id";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."partnerships" ADD COLUMN "stripe_subscription_id" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

alter table "public"."role_assignments" disable row level security;

DO $$ BEGIN
  ALTER TABLE "public"."subscriptions" DROP COLUMN "sponsorship_id";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."subscriptions" ADD COLUMN "email_notification" boolean;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."subscriptions" ADD COLUMN "sponsorship_method" public.sponsorship_method;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."subscriptions" ADD COLUMN "stripe_subscription_id" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS beneficiary_reservations_pkey ON public.beneficiary_reservations USING btree (id);

CREATE INDEX IF NOT EXISTS idx_bres_beneficiary_id ON public.beneficiary_reservations USING btree (beneficiary_id);

CREATE INDEX IF NOT EXISTS idx_bres_expires_at ON public.beneficiary_reservations USING btree (expires_at);

CREATE INDEX IF NOT EXISTS idx_bres_token ON public.beneficiary_reservations USING btree (reservation_token);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_reservation_per_beneficiary ON public.beneficiary_reservations USING btree (beneficiary_id);

DO $$ BEGIN
  alter table "public"."beneficiary_reservations" add constraint "beneficiary_reservations_pkey" PRIMARY KEY using index "beneficiary_reservations_pkey";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."beneficiary_reservations" add constraint "beneficiary_reservations_beneficiary_id_fkey" FOREIGN KEY (beneficiary_id) REFERENCES public.beneficiaries(id) ON DELETE CASCADE not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."beneficiary_reservations" validate constraint "beneficiary_reservations_beneficiary_id_fkey";

DO $$ BEGIN
  alter table "public"."beneficiary_reservations" add constraint "beneficiary_reservations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."beneficiary_reservations" validate constraint "beneficiary_reservations_user_id_fkey";

set check_function_bodies = off;

drop function if exists "public"."handle_new_user"();

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

grant delete on table "public"."beneficiary_reservations" to "anon";

grant insert on table "public"."beneficiary_reservations" to "anon";

grant references on table "public"."beneficiary_reservations" to "anon";

grant select on table "public"."beneficiary_reservations" to "anon";

grant trigger on table "public"."beneficiary_reservations" to "anon";

grant truncate on table "public"."beneficiary_reservations" to "anon";

grant update on table "public"."beneficiary_reservations" to "anon";

grant delete on table "public"."beneficiary_reservations" to "authenticated";

grant insert on table "public"."beneficiary_reservations" to "authenticated";

grant references on table "public"."beneficiary_reservations" to "authenticated";

grant select on table "public"."beneficiary_reservations" to "authenticated";

grant trigger on table "public"."beneficiary_reservations" to "authenticated";

grant truncate on table "public"."beneficiary_reservations" to "authenticated";

grant update on table "public"."beneficiary_reservations" to "authenticated";

grant delete on table "public"."beneficiary_reservations" to "service_role";

grant insert on table "public"."beneficiary_reservations" to "service_role";

grant references on table "public"."beneficiary_reservations" to "service_role";

grant select on table "public"."beneficiary_reservations" to "service_role";

grant trigger on table "public"."beneficiary_reservations" to "service_role";

grant truncate on table "public"."beneficiary_reservations" to "service_role";

grant update on table "public"."beneficiary_reservations" to "service_role";

grant delete on table "public"."media" to "anon";

grant insert on table "public"."media" to "anon";

grant references on table "public"."media" to "anon";

grant select on table "public"."media" to "anon";

grant trigger on table "public"."media" to "anon";

grant truncate on table "public"."media" to "anon";

grant update on table "public"."media" to "anon";

grant delete on table "public"."media" to "authenticated";

grant insert on table "public"."media" to "authenticated";

grant references on table "public"."media" to "authenticated";

grant select on table "public"."media" to "authenticated";

grant trigger on table "public"."media" to "authenticated";

grant truncate on table "public"."media" to "authenticated";

grant update on table "public"."media" to "authenticated";

grant delete on table "public"."media" to "service_role";

grant insert on table "public"."media" to "service_role";

grant references on table "public"."media" to "service_role";

grant select on table "public"."media" to "service_role";

grant trigger on table "public"."media" to "service_role";

grant truncate on table "public"."media" to "service_role";

grant update on table "public"."media" to "service_role";


DO $$ BEGIN
  create policy "allow_delete_own"
  on "public"."beneficiary_reservations"
  as permissive
  for delete
  to public
  using (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "allow_insert_own"
  on "public"."beneficiary_reservations"
  as permissive
  for insert
  to public
  with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "allow_select_active"
  on "public"."beneficiary_reservations"
  as permissive
  for select
  to public
  using ((expires_at > now()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_user_registration();


DO $$ BEGIN
  create policy "Allow authenticated to insert 1ps738_0"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
  with check (((bucket_id = 'media'::text) AND (auth.role() = 'authenticated'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Allow update/delete in beneficiaries bucket"
  on "storage"."objects"
  as permissive
  for all
  to public
  using (((bucket_id = 'beneficiaries'::text) AND (auth.role() = 'authenticated'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Allow update/delete to activities-media bucket 15im58k_0"
  on "storage"."objects"
  as permissive
  for update
  to public
  using (((bucket_id = 'activities-media'::text) AND (auth.role() = 'authenticated'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Allow update/delete to activities-media bucket 15im58k_1"
  on "storage"."objects"
  as permissive
  for delete
  to public
  using (((bucket_id = 'activities-media'::text) AND (auth.role() = 'authenticated'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Allow upload to beneficiaries bucket 13n3f43_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
  with check (((bucket_id = 'beneficiaries'::text) AND (auth.role() = 'authenticated'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "Allow upload to beneficiaries bucket 15im58k_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
  with check (((bucket_id = 'activities-media'::text) AND (auth.role() = 'authenticated'::text)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


DO $$ BEGIN
  create policy "View all items in media 1ps738_0"
  on "storage"."objects"
  as permissive
  for select
  to public
  using ((bucket_id = 'media'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
