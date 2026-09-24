-- Capture the PRODUCTION Row Level Security posture into version control.
-- BACKGROUND: production RLS/policies + the is_super_admin() function were
-- authored by hand in the Supabase dashboard and never written to a migration,
-- so a rebuild-from-migrations produced an INSECURE database. This migration
-- closes that drift. Generated from live prod state; safe to re-run (idempotent).
-- See docs/modernization/findings-production-verification.md (M-DRIFT-1).

-- 1) is_super_admin(): the predicate every admin policy depends on (was in no migration).
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    JOIN public.roles r ON r.id = ra.role_id
    WHERE ra.user_id = auth.uid()
      AND r.name = 'SUPER_ADMIN'
  )
$function$;

-- 2) Enable RLS on every table that has it enabled in production.
ALTER TABLE public."activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."activity_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."advocate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."beneficiaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."expense_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."initiative" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."partnerships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."permission_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."transaction_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;

-- 3) Recreate every production policy (DROP IF EXISTS first for idempotency).

-- activities
DROP POLICY IF EXISTS "activities_delete_super_admin" ON public."activities";
CREATE POLICY "activities_delete_super_admin" ON public."activities"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "activities_insert_super_admin" ON public."activities";
CREATE POLICY "activities_insert_super_admin" ON public."activities"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "activities_select_authenticated" ON public."activities";
CREATE POLICY "activities_select_authenticated" ON public."activities"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "activities_select_public" ON public."activities";
CREATE POLICY "activities_select_public" ON public."activities"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_public = true));
DROP POLICY IF EXISTS "activities_update_super_admin" ON public."activities";
CREATE POLICY "activities_update_super_admin" ON public."activities"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- activity_subscriptions
DROP POLICY IF EXISTS "activity_subscriptions_delete_own_or_super_admin" ON public."activity_subscriptions";
CREATE POLICY "activity_subscriptions_delete_own_or_super_admin" ON public."activity_subscriptions"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((email = (auth.jwt() ->> 'email'::text)) OR is_super_admin()));
DROP POLICY IF EXISTS "activity_subscriptions_insert_public" ON public."activity_subscriptions";
CREATE POLICY "activity_subscriptions_insert_public" ON public."activity_subscriptions"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
DROP POLICY IF EXISTS "activity_subscriptions_select_own_or_super_admin" ON public."activity_subscriptions";
CREATE POLICY "activity_subscriptions_select_own_or_super_admin" ON public."activity_subscriptions"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((email = (auth.jwt() ->> 'email'::text)) OR is_super_admin()));
DROP POLICY IF EXISTS "activity_subscriptions_update_super_admin" ON public."activity_subscriptions";
CREATE POLICY "activity_subscriptions_update_super_admin" ON public."activity_subscriptions"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- advocate
DROP POLICY IF EXISTS "advocate_delete_super_admin" ON public."advocate";
CREATE POLICY "advocate_delete_super_admin" ON public."advocate"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "advocate_insert_super_admin" ON public."advocate";
CREATE POLICY "advocate_insert_super_admin" ON public."advocate"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable read access for all users" ON public."advocate";
CREATE POLICY "Enable read access for all users" ON public."advocate"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "advocate_select_public" ON public."advocate";
CREATE POLICY "advocate_select_public" ON public."advocate"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "advocate_update_super_admin" ON public."advocate";
CREATE POLICY "advocate_update_super_admin" ON public."advocate"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- beneficiaries
DROP POLICY IF EXISTS "Enable delete for SUPER_ADMIN users only" ON public."beneficiaries";
CREATE POLICY "Enable delete for SUPER_ADMIN users only" ON public."beneficiaries"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM (role_assignments ra
     JOIN roles r ON ((r.id = ra.role_id)))
  WHERE ((ra.user_id = auth.uid()) AND (r.name = 'SUPER_ADMIN'::text)))));
DROP POLICY IF EXISTS "beneficiaries_delete_super_admin" ON public."beneficiaries";
CREATE POLICY "beneficiaries_delete_super_admin" ON public."beneficiaries"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "Enable insert for SUPER_ADMIN users only" ON public."beneficiaries";
CREATE POLICY "Enable insert for SUPER_ADMIN users only" ON public."beneficiaries"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (role_assignments ra
     JOIN roles r ON ((r.id = ra.role_id)))
  WHERE ((ra.user_id = auth.uid()) AND (r.name = 'SUPER_ADMIN'::text)))));
DROP POLICY IF EXISTS "beneficiaries_insert_super_admin" ON public."beneficiaries";
CREATE POLICY "beneficiaries_insert_super_admin" ON public."beneficiaries"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable read access for all users" ON public."beneficiaries";
CREATE POLICY "Enable read access for all users" ON public."beneficiaries"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "beneficiaries_select_public" ON public."beneficiaries";
CREATE POLICY "beneficiaries_select_public" ON public."beneficiaries"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "Enable update for SUPER_ADMIN users only" ON public."beneficiaries";
CREATE POLICY "Enable update for SUPER_ADMIN users only" ON public."beneficiaries"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM (role_assignments ra
     JOIN roles r ON ((r.id = ra.role_id)))
  WHERE ((ra.user_id = auth.uid()) AND (r.name = 'SUPER_ADMIN'::text)))));
DROP POLICY IF EXISTS "beneficiaries_update_super_admin" ON public."beneficiaries";
CREATE POLICY "beneficiaries_update_super_admin" ON public."beneficiaries"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- email_logs
DROP POLICY IF EXISTS "email_logs_delete_super_admin" ON public."email_logs";
CREATE POLICY "email_logs_delete_super_admin" ON public."email_logs"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "email_logs_insert_super_admin" ON public."email_logs";
CREATE POLICY "email_logs_insert_super_admin" ON public."email_logs"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "email_logs_select_super_admin" ON public."email_logs";
CREATE POLICY "email_logs_select_super_admin" ON public."email_logs"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "email_logs_update_super_admin" ON public."email_logs";
CREATE POLICY "email_logs_update_super_admin" ON public."email_logs"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- expense_assignments
DROP POLICY IF EXISTS "expense_assignments_delete_super_admin" ON public."expense_assignments";
CREATE POLICY "expense_assignments_delete_super_admin" ON public."expense_assignments"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "expense_assignments_insert_super_admin" ON public."expense_assignments";
CREATE POLICY "expense_assignments_insert_super_admin" ON public."expense_assignments"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable read access for all users" ON public."expense_assignments";
CREATE POLICY "Enable read access for all users" ON public."expense_assignments"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "expense_assignments_select_public" ON public."expense_assignments";
CREATE POLICY "expense_assignments_select_public" ON public."expense_assignments"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "expense_assignments_update_super_admin" ON public."expense_assignments";
CREATE POLICY "expense_assignments_update_super_admin" ON public."expense_assignments"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- expenses
DROP POLICY IF EXISTS "expenses_delete_super_admin" ON public."expenses";
CREATE POLICY "expenses_delete_super_admin" ON public."expenses"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "expenses_insert_super_admin" ON public."expenses";
CREATE POLICY "expenses_insert_super_admin" ON public."expenses"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable read access for all users" ON public."expenses";
CREATE POLICY "Enable read access for all users" ON public."expenses"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "expenses_select_public" ON public."expenses";
CREATE POLICY "expenses_select_public" ON public."expenses"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "expenses_update_super_admin" ON public."expenses";
CREATE POLICY "expenses_update_super_admin" ON public."expenses"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- initiative
DROP POLICY IF EXISTS "initiative_delete_super_admin" ON public."initiative";
CREATE POLICY "initiative_delete_super_admin" ON public."initiative"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "initiative_insert_super_admin" ON public."initiative";
CREATE POLICY "initiative_insert_super_admin" ON public."initiative"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable read access for all users" ON public."initiative";
CREATE POLICY "Enable read access for all users" ON public."initiative"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "initiative_select_public" ON public."initiative";
CREATE POLICY "initiative_select_public" ON public."initiative"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "initiative_update_super_admin" ON public."initiative";
CREATE POLICY "initiative_update_super_admin" ON public."initiative"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- media
DROP POLICY IF EXISTS "media_delete_super_admin" ON public."media";
CREATE POLICY "media_delete_super_admin" ON public."media"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public."media";
CREATE POLICY "Enable insert for authenticated users only" ON public."media"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "media_insert_authenticated" ON public."media";
CREATE POLICY "media_insert_authenticated" ON public."media"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "Enable read access for all users" ON public."media";
CREATE POLICY "Enable read access for all users" ON public."media"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "media_select_public" ON public."media";
CREATE POLICY "media_select_public" ON public."media"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public."media";
CREATE POLICY "Enable update for authenticated users only" ON public."media"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "media_update_authenticated" ON public."media";
CREATE POLICY "media_update_authenticated" ON public."media"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- organization
DROP POLICY IF EXISTS "organization_delete_super_admin" ON public."organization";
CREATE POLICY "organization_delete_super_admin" ON public."organization"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "organization_insert_super_admin" ON public."organization";
CREATE POLICY "organization_insert_super_admin" ON public."organization"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable read access for all users" ON public."organization";
CREATE POLICY "Enable read access for all users" ON public."organization"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "organization_select_public" ON public."organization";
CREATE POLICY "organization_select_public" ON public."organization"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "organization_update_super_admin" ON public."organization";
CREATE POLICY "organization_update_super_admin" ON public."organization"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- partnerships
DROP POLICY IF EXISTS "partnerships_delete_super_admin" ON public."partnerships";
CREATE POLICY "partnerships_delete_super_admin" ON public."partnerships"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "Allow public insert" ON public."partnerships";
CREATE POLICY "Allow public insert" ON public."partnerships"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
DROP POLICY IF EXISTS "partnerships_insert_public" ON public."partnerships";
CREATE POLICY "partnerships_insert_public" ON public."partnerships"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
DROP POLICY IF EXISTS "Allow users to view own partnerships" ON public."partnerships";
CREATE POLICY "Allow users to view own partnerships" ON public."partnerships"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((email = (auth.jwt() ->> 'email'::text)));
DROP POLICY IF EXISTS "partnerships_select_own_or_super_admin" ON public."partnerships";
CREATE POLICY "partnerships_select_own_or_super_admin" ON public."partnerships"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((email = (auth.jwt() ->> 'email'::text)) OR is_super_admin()));
DROP POLICY IF EXISTS "partnerships_update_super_admin" ON public."partnerships";
CREATE POLICY "partnerships_update_super_admin" ON public."partnerships"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- permission_assignments
DROP POLICY IF EXISTS "permission_assignments_delete_super_admin" ON public."permission_assignments";
CREATE POLICY "permission_assignments_delete_super_admin" ON public."permission_assignments"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "permission_assignments_insert_super_admin" ON public."permission_assignments";
CREATE POLICY "permission_assignments_insert_super_admin" ON public."permission_assignments"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable select for authenticated users only" ON public."permission_assignments";
CREATE POLICY "Enable select for authenticated users only" ON public."permission_assignments"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "permission_assignments_select_authenticated" ON public."permission_assignments";
CREATE POLICY "permission_assignments_select_authenticated" ON public."permission_assignments"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "permission_assignments_update_super_admin" ON public."permission_assignments";
CREATE POLICY "permission_assignments_update_super_admin" ON public."permission_assignments"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- permissions
DROP POLICY IF EXISTS "permissions_delete_super_admin" ON public."permissions";
CREATE POLICY "permissions_delete_super_admin" ON public."permissions"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "permissions_insert_super_admin" ON public."permissions";
CREATE POLICY "permissions_insert_super_admin" ON public."permissions"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable select for authenticated users only" ON public."permissions";
CREATE POLICY "Enable select for authenticated users only" ON public."permissions"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "permissions_select_authenticated" ON public."permissions";
CREATE POLICY "permissions_select_authenticated" ON public."permissions"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "permissions_update_super_admin" ON public."permissions";
CREATE POLICY "permissions_update_super_admin" ON public."permissions"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- project
DROP POLICY IF EXISTS "project_delete_super_admin" ON public."project";
CREATE POLICY "project_delete_super_admin" ON public."project"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "project_insert_super_admin" ON public."project";
CREATE POLICY "project_insert_super_admin" ON public."project"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable read access for all users" ON public."project";
CREATE POLICY "Enable read access for all users" ON public."project"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "project_select_public" ON public."project";
CREATE POLICY "project_select_public" ON public."project"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
DROP POLICY IF EXISTS "project_update_super_admin" ON public."project";
CREATE POLICY "project_update_super_admin" ON public."project"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- role_assignments
DROP POLICY IF EXISTS "role_assignments_delete_super_admin" ON public."role_assignments";
CREATE POLICY "role_assignments_delete_super_admin" ON public."role_assignments"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "role_assignments_insert_super_admin" ON public."role_assignments";
CREATE POLICY "role_assignments_insert_super_admin" ON public."role_assignments"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable select for authenticated users only" ON public."role_assignments";
CREATE POLICY "Enable select for authenticated users only" ON public."role_assignments"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "role_assignments_select_own" ON public."role_assignments";
CREATE POLICY "role_assignments_select_own" ON public."role_assignments"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR is_super_admin()));
DROP POLICY IF EXISTS "role_assignments_update_super_admin" ON public."role_assignments";
CREATE POLICY "role_assignments_update_super_admin" ON public."role_assignments"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- roles
DROP POLICY IF EXISTS "roles_delete_super_admin" ON public."roles";
CREATE POLICY "roles_delete_super_admin" ON public."roles"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "roles_insert_super_admin" ON public."roles";
CREATE POLICY "roles_insert_super_admin" ON public."roles"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "Enable select for authenticated users only" ON public."roles";
CREATE POLICY "Enable select for authenticated users only" ON public."roles"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "roles_select_authenticated" ON public."roles";
CREATE POLICY "roles_select_authenticated" ON public."roles"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "roles_update_super_admin" ON public."roles";
CREATE POLICY "roles_update_super_admin" ON public."roles"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- subscriptions
DROP POLICY IF EXISTS "subscriptions_delete_super_admin" ON public."subscriptions";
CREATE POLICY "subscriptions_delete_super_admin" ON public."subscriptions"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "subscriptions_insert_authenticated" ON public."subscriptions";
CREATE POLICY "subscriptions_insert_authenticated" ON public."subscriptions"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "subscriptions_select_own_or_super_admin" ON public."subscriptions";
CREATE POLICY "subscriptions_select_own_or_super_admin" ON public."subscriptions"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR is_super_admin()));
DROP POLICY IF EXISTS "subscriptions_update_super_admin" ON public."subscriptions";
CREATE POLICY "subscriptions_update_super_admin" ON public."subscriptions"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- transaction_ledger
DROP POLICY IF EXISTS "transaction_ledger_delete_super_admin" ON public."transaction_ledger";
CREATE POLICY "transaction_ledger_delete_super_admin" ON public."transaction_ledger"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "insert_user" ON public."transaction_ledger";
CREATE POLICY "insert_user" ON public."transaction_ledger"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
DROP POLICY IF EXISTS "transaction_ledger_insert_authenticated" ON public."transaction_ledger";
CREATE POLICY "transaction_ledger_insert_authenticated" ON public."transaction_ledger"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "transaction_ledger_select_own_or_super_admin" ON public."transaction_ledger";
CREATE POLICY "transaction_ledger_select_own_or_super_admin" ON public."transaction_ledger"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR is_super_admin()));
DROP POLICY IF EXISTS "transaction_ledger_update_super_admin" ON public."transaction_ledger";
CREATE POLICY "transaction_ledger_update_super_admin" ON public."transaction_ledger"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- users
DROP POLICY IF EXISTS "users_delete_super_admin" ON public."users";
CREATE POLICY "users_delete_super_admin" ON public."users"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_super_admin());
DROP POLICY IF EXISTS "users_insert_super_admin" ON public."users";
CREATE POLICY "users_insert_super_admin" ON public."users"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "users_select_own_or_super_admin" ON public."users";
CREATE POLICY "users_select_own_or_super_admin" ON public."users"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((id = auth.uid()) OR is_super_admin()));
DROP POLICY IF EXISTS "users_update_own" ON public."users";
CREATE POLICY "users_update_own" ON public."users"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((id = auth.uid()) OR is_super_admin()))
  WITH CHECK (((id = auth.uid()) OR is_super_admin()));
