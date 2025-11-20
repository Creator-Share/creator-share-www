-- Add unique constraint to prevent multiple active subscriptions per beneficiary
-- This provides defense-in-depth by ensuring the database prevents duplicates

-- Step 1: First, identify and fix existing duplicates
-- For each beneficiary with multiple 'complete' subscriptions, keep the oldest one
-- and cancel the rest
DO $$
DECLARE
  duplicate_record RECORD;
BEGIN
  -- Find beneficiaries with duplicate complete subscriptions
  FOR duplicate_record IN
    SELECT beneficiary_id, COUNT(*) as duplicate_count
    FROM public.subscriptions
    WHERE status = 'complete'
    GROUP BY beneficiary_id
    HAVING COUNT(*) > 1
  LOOP
    -- For each duplicate, cancel all but the oldest subscription
    UPDATE public.subscriptions
    SET status = 'cancelled',
        canceled_at = NOW()
    WHERE beneficiary_id = duplicate_record.beneficiary_id
      AND status = 'complete'
      AND id NOT IN (
        -- Keep the oldest subscription (first created)
        SELECT id 
        FROM public.subscriptions
        WHERE beneficiary_id = duplicate_record.beneficiary_id
          AND status = 'complete'
        ORDER BY created_at ASC
        LIMIT 1
      );
    
    RAISE NOTICE 'Fixed % duplicate subscriptions for beneficiary %', 
      duplicate_record.duplicate_count - 1, 
      duplicate_record.beneficiary_id;
  END LOOP;
END $$;

-- Step 2: Now create the unique partial index
-- This only applies to complete subscriptions (incomplete are still being set up, cancelled are no longer active)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_subscription_per_beneficiary
ON public.subscriptions(beneficiary_id)
WHERE status = 'complete';

-- Add a comment explaining the constraint
COMMENT ON INDEX uniq_active_subscription_per_beneficiary IS 
'Ensures only one complete subscription exists per beneficiary at any time. Prevents duplicate sponsorships through database constraint.';
