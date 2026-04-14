-- Allow NULL beneficiary_id for blind sponsorships
-- This migration updates the triggers to handle NULL beneficiary_id for blind sponsorships

-- ============================================================================
-- STEP 1: Update validation trigger to allow NULL beneficiary_id
-- ============================================================================

CREATE OR REPLACE FUNCTION reject_fulfilled_beneficiary_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  beneficiary_status "PersonStatus";
BEGIN
  -- Allow NULL beneficiary_id for blind sponsorships
  -- Skip validation if beneficiary_id is NULL
  IF NEW.beneficiary_id IS NULL THEN
    RETURN NEW;
  END IF;
  
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

COMMENT ON FUNCTION reject_fulfilled_beneficiary_subscription IS 
  'Prevents inserting subscriptions for beneficiaries with status other than New or Partially Funded. Allows NULL beneficiary_id for blind sponsorships.';

-- ============================================================================
-- STEP 2: Update recalculation trigger to skip NULL beneficiary_id
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_update_beneficiary_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_beneficiary_id uuid;
BEGIN
  -- Get the affected beneficiary_id (from NEW or OLD)
  affected_beneficiary_id := COALESCE(NEW.beneficiary_id, OLD.beneficiary_id);
  
  -- Skip recalculation for blind sponsorships (NULL beneficiary_id)
  IF affected_beneficiary_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Call shared calculation function with the affected beneficiary_id
  PERFORM update_beneficiary_by_subscriptions(affected_beneficiary_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION trigger_update_beneficiary_from_subscription IS 
  'Triggers beneficiary recalculation after subscription INSERT, UPDATE, or DELETE. Skips blind sponsorships (NULL beneficiary_id).';

-- ============================================================================
-- STEP 3: Drop the unique-subscription-per-beneficiary index
-- ============================================================================
-- The old unique index enforced one active subscription per beneficiary.
-- This is incompatible with open sponsorship types (e.g. SPECIAL_NEEDS)
-- which allow multiple sponsors per beneficiary. The application layer
-- already prevents duplicate sponsorships for fixed types via status
-- checks and the reject_fulfilled_beneficiary_subscription trigger.

DROP INDEX IF EXISTS uniq_active_subscription_per_beneficiary;

