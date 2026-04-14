create table if not exists "public"."transaction_ledger" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid,
    "child_id" uuid,
    "credit" integer,
    "customer_email" text,
    "customer_name" text,
    "reference" text,
    "description" text,
    "tx_action" text,
    "subscription_type" text
);


alter table "public"."sponsor_people" disable row level security;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_ledger_pkey ON public.transaction_ledger USING btree (id);

DO $$ BEGIN
  alter table "public"."transaction_ledger" add constraint "transaction_ledger_pkey" PRIMARY KEY using index "transaction_ledger_pkey";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  alter table "public"."transaction_ledger" add constraint "transaction_ledger_child_id_fkey" FOREIGN KEY (child_id) REFERENCES sponsor_people(id) not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."transaction_ledger" validate constraint "transaction_ledger_child_id_fkey";

DO $$ BEGIN
  alter table "public"."transaction_ledger" add constraint "transaction_ledger_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) not valid;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

alter table "public"."transaction_ledger" validate constraint "transaction_ledger_user_id_fkey";

grant delete on table "public"."transaction_ledger" to "anon";

grant insert on table "public"."transaction_ledger" to "anon";

grant references on table "public"."transaction_ledger" to "anon";

grant select on table "public"."transaction_ledger" to "anon";

grant trigger on table "public"."transaction_ledger" to "anon";

grant truncate on table "public"."transaction_ledger" to "anon";

grant update on table "public"."transaction_ledger" to "anon";

grant delete on table "public"."transaction_ledger" to "authenticated";

grant insert on table "public"."transaction_ledger" to "authenticated";

grant references on table "public"."transaction_ledger" to "authenticated";

grant select on table "public"."transaction_ledger" to "authenticated";

grant trigger on table "public"."transaction_ledger" to "authenticated";

grant truncate on table "public"."transaction_ledger" to "authenticated";

grant update on table "public"."transaction_ledger" to "authenticated";

grant delete on table "public"."transaction_ledger" to "service_role";

grant insert on table "public"."transaction_ledger" to "service_role";

grant references on table "public"."transaction_ledger" to "service_role";

grant select on table "public"."transaction_ledger" to "service_role";

grant trigger on table "public"."transaction_ledger" to "service_role";

grant truncate on table "public"."transaction_ledger" to "service_role";

grant update on table "public"."transaction_ledger" to "service_role";


