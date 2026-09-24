-- Forward hardening + index fixes from the modernization audit's
-- production-verified findings. SAFE SUBSET ONLY: no RLS/policy behavioral
-- changes (those may have external Webflow-form dependencies and are left as
-- documented follow-ups). Test on dev before promoting to prod.
-- Refs: docs/modernization/findings-production-verification.md, upgrade-plan.md (Phase 0.6, 1, 5).

-- 1) Pin search_path on every SECURITY DEFINER function that lacks one.
--    is_super_admin() underpins every admin RLS policy, so a mutable search_path
--    there is a schema-shadowing risk against the core authorization predicate.
--    [findings-data-layer-rls.md M5 / findings-production-verification.md M-DEFINER]
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (p.proconfig IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
      -- exclude functions owned by extensions (e.g. PostGIS in public) — not ours to alter
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
                   r.proname, r.args);
  END LOOP;
END $$;

-- 2) beneficiaries index hygiene. [findings-data-layer-rls.md L1 / findings-production-verification.md §3]
--    Add an index for the hot public-listing filter (beneficiary_type + status)...
CREATE INDEX IF NOT EXISTS idx_beneficiaries_type_status
  ON public.beneficiaries (beneficiary_type, status);
--    ...and remove two of three IDENTICAL GIST indexes on location_geo
--    (keep idx_beneficiaries_location_geo).
DROP INDEX IF EXISTS public.idx_people_location;
DROP INDEX IF EXISTS public.idx_people_location_geo;

-- 3) Missing payment-idempotency constraints. Verified 0 duplicates in prod at
--    authoring time; these enforce invariants the app currently only assumes.
--    [findings-payments.md / findings-production-verification.md §3]
--    Prevent duplicate subscription rows from the success-page insert-on-GET race:
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_uidx
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
--    Enforce PayPal one-time dedup across the client-capture and webhook paths
--    (they key on different provider_event_id values, so this is the real guard).
--    Replaces the existing NON-unique (reference, tx_action) index.
DROP INDEX IF EXISTS public.transaction_ledger_reference_action_idx;
CREATE UNIQUE INDEX IF NOT EXISTS transaction_ledger_reference_action_uidx
  ON public.transaction_ledger (reference, tx_action)
  WHERE reference IS NOT NULL;

-- NOTE (not applied here, on purpose):
--  * Tightening the permissive {public}/authenticated `WITH CHECK (true)` INSERT
--    policies on transaction_ledger / partnerships / media / subscriptions, and
--    dropping the leftover `USING (true)` SELECT on roles / role_assignments.
--    All ledger/partnership writes in THIS repo are server-side via the
--    service-role client (which bypasses RLS), so these look safe to tighten —
--    but a Webflow-embedded form could write via the anon key directly, which we
--    cannot verify from here. Confirm the external surfaces, then tighten.
--  * Dropping the dead functions get_active_subscription_total / filter_by_polygon
--    (no code callers) — deferred so db.types.ts can be regenerated in the same change.
