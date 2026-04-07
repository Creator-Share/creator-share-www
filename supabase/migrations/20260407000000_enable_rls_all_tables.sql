-- =============================================================================
-- Migration: Enable RLS and create policies for all public tables
-- Date: 2026-04-07
-- Tables covered (20):
--   activities, activity_subscriptions, advocate, beneficiaries, email_logs,
--   expense_assignments, expenses, initiative, media, organization,
--   partnerships, permission_assignments, permissions, project,
--   role_assignments, roles, subscriptions, transaction_ledger, users
-- Skipped (no RLS): beneficiary_reservations, spatial_ref_sys
-- =============================================================================

-- =============================================================================
-- HELPER FUNCTION: is_super_admin()
-- Checks if the currently authenticated user has the SUPER_ADMIN role.
-- SECURITY DEFINER so it can read role_assignments safely even under RLS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    JOIN public.roles r ON r.id = ra.role_id
    WHERE ra.user_id = auth.uid()
      AND r.name = 'SUPER_ADMIN'
  )
$$;

COMMENT ON FUNCTION public.is_super_admin IS
  'Returns true if the current user has the SUPER_ADMIN role. Used by RLS policies.';


-- =============================================================================
-- 1. BENEFICIARIES
--    Anyone can browse beneficiary profiles.
--    Only SUPER_ADMIN can create/edit/delete.
-- =============================================================================

ALTER TABLE public.beneficiaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "beneficiaries_select_public"
  ON public.beneficiaries
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "beneficiaries_insert_super_admin"
  ON public.beneficiaries
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "beneficiaries_update_super_admin"
  ON public.beneficiaries
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "beneficiaries_delete_super_admin"
  ON public.beneficiaries
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 2. ACTIVITIES
--    Anonymous users can only see activities marked is_public = true.
--    Authenticated users (e.g. admin) can see all.
--    Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities_select_public"
  ON public.activities
  FOR SELECT
  TO public
  USING (is_public = true);

CREATE POLICY "activities_select_authenticated"
  ON public.activities
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "activities_insert_super_admin"
  ON public.activities
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "activities_update_super_admin"
  ON public.activities
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "activities_delete_super_admin"
  ON public.activities
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 3. MEDIA
--    Everyone can view media.
--    Authenticated users can insert and update (upload images/videos).
--    Only SUPER_ADMIN can delete.
-- =============================================================================

ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_select_public"
  ON public.media
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "media_insert_authenticated"
  ON public.media
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "media_update_authenticated"
  ON public.media
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "media_delete_super_admin"
  ON public.media
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 4. EXPENSE_ASSIGNMENTS
--    Public read (shown on beneficiary profile pages).
--    Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.expense_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_assignments_select_public"
  ON public.expense_assignments
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "expense_assignments_insert_super_admin"
  ON public.expense_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "expense_assignments_update_super_admin"
  ON public.expense_assignments
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "expense_assignments_delete_super_admin"
  ON public.expense_assignments
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 5. EXPENSES
--    Public read (expense catalogue for display).
--    Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_select_public"
  ON public.expenses
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "expenses_insert_super_admin"
  ON public.expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "expenses_update_super_admin"
  ON public.expenses
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "expenses_delete_super_admin"
  ON public.expenses
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 6. ADVOCATE
--    Public read-only reference data.
--    Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.advocate ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advocate_select_public"
  ON public.advocate
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "advocate_insert_super_admin"
  ON public.advocate
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "advocate_update_super_admin"
  ON public.advocate
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "advocate_delete_super_admin"
  ON public.advocate
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 7. INITIATIVE
--    Public read-only reference data.
--    Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.initiative ENABLE ROW LEVEL SECURITY;

CREATE POLICY "initiative_select_public"
  ON public.initiative
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "initiative_insert_super_admin"
  ON public.initiative
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "initiative_update_super_admin"
  ON public.initiative
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "initiative_delete_super_admin"
  ON public.initiative
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 8. ORGANIZATION
--    Public read-only reference data.
--    Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.organization ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_select_public"
  ON public.organization
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "organization_insert_super_admin"
  ON public.organization
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "organization_update_super_admin"
  ON public.organization
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "organization_delete_super_admin"
  ON public.organization
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 9. PROJECT
--    Public read-only reference data.
--    Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.project ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_select_public"
  ON public.project
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "project_insert_super_admin"
  ON public.project
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "project_update_super_admin"
  ON public.project
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "project_delete_super_admin"
  ON public.project
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 10. ROLES
--     Authenticated users can read roles (needed for permission checks).
--     Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_select_authenticated"
  ON public.roles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "roles_insert_super_admin"
  ON public.roles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "roles_update_super_admin"
  ON public.roles
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "roles_delete_super_admin"
  ON public.roles
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 11. PERMISSIONS
--     Authenticated users can read permissions.
--     Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permissions_select_authenticated"
  ON public.permissions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "permissions_insert_super_admin"
  ON public.permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "permissions_update_super_admin"
  ON public.permissions
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "permissions_delete_super_admin"
  ON public.permissions
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 12. PERMISSION_ASSIGNMENTS
--     Authenticated users can read (needed for client permission resolution).
--     Only SUPER_ADMIN can write.
-- =============================================================================

ALTER TABLE public.permission_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permission_assignments_select_authenticated"
  ON public.permission_assignments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "permission_assignments_insert_super_admin"
  ON public.permission_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "permission_assignments_update_super_admin"
  ON public.permission_assignments
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "permission_assignments_delete_super_admin"
  ON public.permission_assignments
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 13. ROLE_ASSIGNMENTS
--     Users can see their own role assignments.
--     SUPER_ADMIN can see and manage all.
-- =============================================================================

ALTER TABLE public.role_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_assignments_select_own"
  ON public.role_assignments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "role_assignments_insert_super_admin"
  ON public.role_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "role_assignments_update_super_admin"
  ON public.role_assignments
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "role_assignments_delete_super_admin"
  ON public.role_assignments
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 14. USERS
--     Users can read and update their own profile.
--     SUPER_ADMIN can read and manage all.
--     Insert is handled by the handle_user_registration() trigger (SECURITY DEFINER).
-- =============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_or_super_admin"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_super_admin());

CREATE POLICY "users_update_own"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.is_super_admin())
  WITH CHECK (id = auth.uid() OR public.is_super_admin());

CREATE POLICY "users_insert_super_admin"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "users_delete_super_admin"
  ON public.users
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 15. SUBSCRIPTIONS
--     Authenticated users can see their own subscriptions.
--     SUPER_ADMIN can see all.
--     Insert is allowed for authenticated users (checkout flow).
--     Server-side webhook updates use service_role (bypasses RLS).
-- =============================================================================

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own_or_super_admin"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "subscriptions_insert_authenticated"
  ON public.subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "subscriptions_update_super_admin"
  ON public.subscriptions
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "subscriptions_delete_super_admin"
  ON public.subscriptions
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 16. TRANSACTION_LEDGER
--     Authenticated users can see their own transaction entries.
--     SUPER_ADMIN can see all.
--     Inserts come from server-side webhooks (service_role bypasses RLS).
-- =============================================================================

ALTER TABLE public.transaction_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transaction_ledger_select_own_or_super_admin"
  ON public.transaction_ledger
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "transaction_ledger_insert_authenticated"
  ON public.transaction_ledger
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "transaction_ledger_update_super_admin"
  ON public.transaction_ledger
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "transaction_ledger_delete_super_admin"
  ON public.transaction_ledger
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 17. PARTNERSHIPS
--     Insert is public (checkout flow — anyone can create a partnership).
--     Select: users see their own by email; SUPER_ADMIN sees all.
--     Update/Delete: SUPER_ADMIN only.
-- =============================================================================

ALTER TABLE public.partnerships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partnerships_insert_public"
  ON public.partnerships
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "partnerships_select_own_or_super_admin"
  ON public.partnerships
  FOR SELECT
  TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
    OR public.is_super_admin()
  );

CREATE POLICY "partnerships_update_super_admin"
  ON public.partnerships
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "partnerships_delete_super_admin"
  ON public.partnerships
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());


-- =============================================================================
-- 18. ACTIVITY_SUBSCRIPTIONS
--     Anyone can subscribe (anon or logged in).
--     Users can read and delete their own subscriptions by email.
--     SUPER_ADMIN can manage all.
-- =============================================================================

ALTER TABLE public.activity_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_subscriptions_insert_public"
  ON public.activity_subscriptions
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "activity_subscriptions_select_own_or_super_admin"
  ON public.activity_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
    OR public.is_super_admin()
  );

CREATE POLICY "activity_subscriptions_delete_own_or_super_admin"
  ON public.activity_subscriptions
  FOR DELETE
  TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
    OR public.is_super_admin()
  );

CREATE POLICY "activity_subscriptions_update_super_admin"
  ON public.activity_subscriptions
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- =============================================================================
-- 19. EMAIL_LOGS
--     Internal system table — no public or user access.
--     Only SUPER_ADMIN can read.
--     Inserts handled server-side via service_role (bypasses RLS).
-- =============================================================================

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_logs_select_super_admin"
  ON public.email_logs
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "email_logs_insert_super_admin"
  ON public.email_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "email_logs_update_super_admin"
  ON public.email_logs
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "email_logs_delete_super_admin"
  ON public.email_logs
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- =============================================================================
-- END MIGRATION
-- =============================================================================
