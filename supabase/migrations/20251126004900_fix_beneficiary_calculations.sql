-- ============================================================================
-- Migration: Fix Beneficiary Subscription Calculations
-- Date: 2025-11-26
-- Purpose: 
--   1. Replace broken active_subscriptions trigger
--   2. Implement atomic subscription validation
--   3. Create shared calculation function
--   4. Add triggers for subscription changes and budget goal changes
-- ============================================================================

-- ============================================================================
-- STEP 1: Remove old broken triggers and functions
-- ============================================================================

DROP TRIGGER IF EXISTS preserve_active_subscriptions ON beneficiaries;
DROP FUNCTION IF EXISTS handle_active_subscriptions();

DROP TRIGGER IF EXISTS update_budget_raised ON subscriptions;
DROP TRIGGER IF EXISTS update_subscription_budget ON subscriptions;
DROP FUNCTION IF EXISTS calc_budget_raised();

-- ============================================================================
-- STEP 2: Create shared calculation function
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
  ELSIF total_monthly_amount >= current_goal THEN
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
  'Recalculates budget_raised, status, active_subscriptions, and goal_fulfilled_at for a beneficiary based on their complete subscriptions. Preserves Draft and Archived statuses.';

-- ============================================================================
-- STEP 3: Create BEFORE INSERT trigger on subscriptions (validation)
-- ============================================================================

CREATE OR REPLACE FUNCTION reject_fulfilled_beneficiary_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  beneficiary_status "PersonStatus";
BEGIN
  -- Get current beneficiary status
  SELECT status INTO beneficiary_status
  FROM beneficiaries
  WHERE id = NEW.beneficiary_id;
  
  -- Reject if beneficiary doesn't exist
  IF NOT FOUND THEN
    RAISE EXCEPTION 'beneficiary_not_found: Beneficiary % does not exist', NEW.beneficiary_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  
  -- Only allow subscriptions for 'New' and 'Partially Funded' statuses
  -- Reject all others: 'Budget Fulfilled', 'Archived', 'Draft'
  IF beneficiary_status NOT IN ('New', 'Partially Funded') THEN
    RAISE EXCEPTION 'beneficiary_not_accepting_subscriptions: Beneficiary % has status "%" and cannot accept new subscriptions', 
      NEW.beneficiary_id, beneficiary_status
      USING ERRCODE = 'check_violation';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_beneficiary_not_fulfilled ON subscriptions;
CREATE TRIGGER validate_beneficiary_not_fulfilled
  BEFORE INSERT ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION reject_fulfilled_beneficiary_subscription();

COMMENT ON FUNCTION reject_fulfilled_beneficiary_subscription IS 
  'Prevents inserting subscriptions for beneficiaries with status other than New or Partially Funded';

-- ============================================================================
-- STEP 4: Create AFTER trigger on subscriptions (recalculation)
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_update_beneficiary_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Call shared calculation function with the affected beneficiary_id
  -- Use COALESCE to handle both INSERT/UPDATE (NEW) and DELETE (OLD)
  PERFORM update_beneficiary_by_subscriptions(
    COALESCE(NEW.beneficiary_id, OLD.beneficiary_id)
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Drop old triggers if they exist (from previous migrations)
DROP TRIGGER IF EXISTS recalculate_beneficiary_after_subscription_change ON subscriptions;
CREATE TRIGGER recalculate_beneficiary_after_subscription_change
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_beneficiary_from_subscription();

COMMENT ON FUNCTION trigger_update_beneficiary_from_subscription IS 
  'Triggers beneficiary recalculation after subscription INSERT, UPDATE, or DELETE';

-- ============================================================================
-- STEP 5: Create AFTER UPDATE trigger on beneficiaries (goal changes)
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_update_beneficiary_from_goal_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only recalculate if budget_goal actually changed
  IF OLD.budget_goal IS DISTINCT FROM NEW.budget_goal THEN
    PERFORM update_beneficiary_by_subscriptions(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recalculate_on_budget_goal_change ON beneficiaries;
CREATE TRIGGER recalculate_on_budget_goal_change
  AFTER UPDATE ON beneficiaries
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_beneficiary_from_goal_change();

COMMENT ON FUNCTION trigger_update_beneficiary_from_goal_change IS 
  'Recalculates beneficiary status when budget_goal is changed by admin';

-- ============================================================================
-- STEP 6: Recalculate all existing beneficiaries
-- ============================================================================

-- Run calculation for all beneficiaries to fix existing data
DO $$
DECLARE
  beneficiary_record RECORD;
BEGIN
  FOR beneficiary_record IN SELECT id FROM beneficiaries
  LOOP
    PERFORM update_beneficiary_by_subscriptions(beneficiary_record.id);
  END LOOP;
END $$;

-- ============================================================================
-- END MIGRATION
-- ============================================================================