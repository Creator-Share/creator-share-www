-- ============================================================================
-- Migration: Open sponsorships never auto-flip to 'Budget Fulfilled'
-- Date: 2026-04-22
-- Purpose:
--   Open sponsorships (budget_goal = -1) have no finite goal, so the
--   auto-status calculation in update_beneficiary_by_subscriptions was
--   semantically wrong: `total_monthly_amount >= current_goal` is true for
--   ANY non-zero amount when current_goal is -1, meaning a single dollar
--   of support would flip the beneficiary to 'Budget Fulfilled'.
--
--   This was previously papered over by scattered `.neq('budget_goal', -1)`
--   filters in application code (src/actions/index.tsx, src/app/api/stats/
--   route.ts). Moving the invariant into the schema makes the DB the single
--   source of truth and lets those application-layer guards be removed.
--
--   This is a refinement of 20251126004900_fix_beneficiary_calculations.sql.
--   Only the status-decision branch changes; everything else in the function
--   body is preserved verbatim.
--
--   Defensive sister migration 20260414001000_open_sponsorship_allow_fulfilled
--   is retained — it covers the admin-manual-override case where a 'Budget
--   Fulfilled' status is set by hand rather than by the calculation trigger.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_beneficiary_by_subscriptions(target_beneficiary_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  -- Current beneficiary state
  current_goal integer;
  current_status "PersonStatus";
  current_fulfilled_at timestamptz;

  -- Calculated values from subscriptions
  total_monthly_amount integer;
  subscription_count integer;
  calculated_status "PersonStatus";
  new_fulfilled_at timestamptz;
BEGIN
  -- Get current beneficiary state
  SELECT budget_goal, status, goal_fulfilled_at
  INTO current_goal, current_status, current_fulfilled_at
  FROM beneficiaries
  WHERE id = target_beneficiary_id;

  -- If beneficiary doesn't exist, exit early
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Calculate total monthly amount and count from ONLY complete subscriptions
  SELECT
    COALESCE(SUM(
      CASE
        WHEN s.interval = 'year' THEN s.amount / 12
        ELSE s.amount
      END
    ), 0),
    COALESCE(COUNT(*), 0)
  INTO total_monthly_amount, subscription_count
  FROM subscriptions s
  WHERE s.beneficiary_id = target_beneficiary_id
    AND s.status = 'complete';  -- Only count complete subscriptions

  -- Determine calculated status
  -- CRITICAL: Preserve admin-controlled statuses
  IF current_status IN ('Draft', 'Archived') THEN
    -- Never override admin-set statuses
    calculated_status := current_status;
  ELSIF current_goal <> -1 AND total_monthly_amount >= current_goal THEN
    calculated_status := 'Budget Fulfilled';
  ELSIF total_monthly_amount > 0 THEN
    calculated_status := 'Partially Funded';
  ELSE
    calculated_status := 'New';
  END IF;

  -- Manage goal_fulfilled_at timestamp
  -- Set to NOW() when transitioning TO 'Budget Fulfilled'
  -- Never clear it (preserves historical data)
  IF calculated_status = 'Budget Fulfilled' AND current_status != 'Budget Fulfilled' THEN
    new_fulfilled_at := NOW();
  ELSE
    -- Preserve existing timestamp
    new_fulfilled_at := current_fulfilled_at;
  END IF;

  -- Update beneficiary ONLY if values actually changed
  -- This prevents infinite trigger loops
  UPDATE beneficiaries
  SET
    budget_raised = total_monthly_amount,
    status = calculated_status,
    active_subscriptions = subscription_count,
    goal_fulfilled_at = new_fulfilled_at
  WHERE id = target_beneficiary_id
    AND (
      budget_raised IS DISTINCT FROM total_monthly_amount
      OR status IS DISTINCT FROM calculated_status
      OR active_subscriptions IS DISTINCT FROM subscription_count
      OR goal_fulfilled_at IS DISTINCT FROM new_fulfilled_at
    );

  -- Note: UPDATE returns nothing, function is void
END;
$$;

COMMENT ON FUNCTION update_beneficiary_by_subscriptions IS
  'Recalculates budget_raised, status, active_subscriptions, and goal_fulfilled_at for a beneficiary based on their complete subscriptions. Preserves Draft and Archived statuses. Open sponsorships (budget_goal = -1) never auto-flip to Budget Fulfilled — they have no finite goal to reach, so they remain New or Partially Funded regardless of accumulated support.';

-- ============================================================================
-- Backfill: reset any open beneficiaries stuck at 'Budget Fulfilled'
-- ============================================================================
-- In production this is a no-op: PR 98 is what introduces user-facing open
-- sponsorships, so none should currently be in this state. The UPDATE exists
-- to clean up dev/test data where open beneficiaries were auto-flipped by the
-- old function body before this migration ran. Idempotent — safe to re-run.
UPDATE beneficiaries
SET status = CASE
    WHEN active_subscriptions > 0 THEN 'Partially Funded'::"PersonStatus"
    ELSE 'New'::"PersonStatus"
END
WHERE budget_goal = -1 AND status = 'Budget Fulfilled';

-- ============================================================================
-- END MIGRATION
-- ============================================================================
