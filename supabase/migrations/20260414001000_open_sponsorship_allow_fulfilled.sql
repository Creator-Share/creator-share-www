-- ============================================================================
-- Migration: Allow subscriptions for open (infinite budget) beneficiaries
-- Date: 2026-04-14
-- Purpose:
--   Open sponsorships (budget_goal = -1) have no budget ceiling, so the
--   "Budget Fulfilled" status is a natural side-effect of the existing
--   calculation triggers (any amount >= -1). That's fine — status is
--   meaningless for these beneficiaries. The only thing that breaks is
--   this validation trigger rejecting new subscriptions once fulfilled.
--   Fix: skip the status check when budget_goal = -1.
-- ============================================================================

CREATE OR REPLACE FUNCTION reject_fulfilled_beneficiary_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  beneficiary_status "PersonStatus";
  beneficiary_goal integer;
BEGIN
  -- Blind sponsorships (NULL beneficiary_id) skip validation entirely
  IF NEW.beneficiary_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get current beneficiary state
  SELECT status, budget_goal
  INTO beneficiary_status, beneficiary_goal
  FROM beneficiaries
  WHERE id = NEW.beneficiary_id;

  -- Reject if beneficiary doesn't exist
  IF NOT FOUND THEN
    RAISE EXCEPTION 'beneficiary_not_found: Beneficiary % does not exist', NEW.beneficiary_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Open sponsorships (no budget ceiling) always accept, unless Draft/Archived
  IF beneficiary_goal = -1 AND beneficiary_status NOT IN ('Draft', 'Archived') THEN
    RETURN NEW;
  END IF;

  -- Fixed sponsorships: only allow 'New' and 'Partially Funded'
  IF beneficiary_status NOT IN ('New', 'Partially Funded') THEN
    RAISE EXCEPTION 'beneficiary_not_accepting_subscriptions: Beneficiary % has status "%" and cannot accept new subscriptions',
      NEW.beneficiary_id, beneficiary_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION reject_fulfilled_beneficiary_subscription IS
  'Prevents inserting subscriptions for fulfilled fixed-budget beneficiaries. Open sponsorships (budget_goal = -1) always accept new subscriptions unless Draft or Archived. Allows NULL beneficiary_id for blind sponsorships.';
