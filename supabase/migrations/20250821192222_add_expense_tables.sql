create table "public"."expense_assignments" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "beneficiary_id" uuid not null default gen_random_uuid(),
    "expense_id" uuid default gen_random_uuid(),
    "weight" smallint default '0'::smallint,
    "fulfilled" boolean default false,
    "onetime_expense" boolean default false not null
);


alter table "public"."expense_assignments" enable row level security;

create table "public"."expenses" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "name" text not null,
    "description" text,
    "organization_id" uuid default gen_random_uuid(),
    "price" integer default 0,
    "icon" text
);


alter table "public"."expenses" enable row level security;

CREATE UNIQUE INDEX expense_assignments_pkey ON public.expense_assignments USING btree (id);

CREATE UNIQUE INDEX expenses_pkey ON public.expenses USING btree (id);

alter table "public"."expense_assignments" add constraint "expense_assignments_pkey" PRIMARY KEY using index "expense_assignments_pkey";

alter table "public"."expenses" add constraint "expenses_pkey" PRIMARY KEY using index "expenses_pkey";

alter table "public"."expense_assignments" add constraint "expense_assignments_beneficiary_id_fkey" FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id) ON DELETE CASCADE not valid;

alter table "public"."expense_assignments" validate constraint "expense_assignments_beneficiary_id_fkey";

alter table "public"."expense_assignments" add constraint "expense_assignments_expense_id_fkey" FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE not valid;

alter table "public"."expense_assignments" validate constraint "expense_assignments_expense_id_fkey";

alter table "public"."expenses" add constraint "expenses_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE SET NULL not valid;

alter table "public"."expenses" validate constraint "expenses_organization_id_fkey";

grant delete on table "public"."expense_assignments" to "anon";

grant insert on table "public"."expense_assignments" to "anon";

grant references on table "public"."expense_assignments" to "anon";

grant select on table "public"."expense_assignments" to "anon";

grant trigger on table "public"."expense_assignments" to "anon";

grant truncate on table "public"."expense_assignments" to "anon";

grant update on table "public"."expense_assignments" to "anon";

grant delete on table "public"."expense_assignments" to "authenticated";

grant insert on table "public"."expense_assignments" to "authenticated";

grant references on table "public"."expense_assignments" to "authenticated";

grant select on table "public"."expense_assignments" to "authenticated";

grant trigger on table "public"."expense_assignments" to "authenticated";

grant truncate on table "public"."expense_assignments" to "authenticated";

grant update on table "public"."expense_assignments" to "authenticated";

grant delete on table "public"."expense_assignments" to "service_role";

grant insert on table "public"."expense_assignments" to "service_role";

grant references on table "public"."expense_assignments" to "service_role";

grant select on table "public"."expense_assignments" to "service_role";

grant trigger on table "public"."expense_assignments" to "service_role";

grant truncate on table "public"."expense_assignments" to "service_role";

grant update on table "public"."expense_assignments" to "service_role";

grant delete on table "public"."expenses" to "anon";

grant insert on table "public"."expenses" to "anon";

grant references on table "public"."expenses" to "anon";

grant select on table "public"."expenses" to "anon";

grant trigger on table "public"."expenses" to "anon";

grant truncate on table "public"."expenses" to "anon";

grant update on table "public"."expenses" to "anon";

grant delete on table "public"."expenses" to "authenticated";

grant insert on table "public"."expenses" to "authenticated";

grant references on table "public"."expenses" to "authenticated";

grant select on table "public"."expenses" to "authenticated";

grant trigger on table "public"."expenses" to "authenticated";

grant truncate on table "public"."expenses" to "authenticated";

grant update on table "public"."expenses" to "authenticated";

grant delete on table "public"."expenses" to "service_role";

grant insert on table "public"."expenses" to "service_role";

grant references on table "public"."expenses" to "service_role";

grant select on table "public"."expenses" to "service_role";

grant trigger on table "public"."expenses" to "service_role";

grant truncate on table "public"."expenses" to "service_role";

grant update on table "public"."expenses" to "service_role";

create policy "Enable read access for all users"
on "public"."expense_assignments"
as permissive
for select
to public
using (true);


create policy "Enable read access for all users"
on "public"."expenses"
as permissive
for select
to public
using (true);