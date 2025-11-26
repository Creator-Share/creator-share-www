-- Remove the incorrect unique constraint that prevents multiple sponsors per beneficiary
-- This constraint was incorrectly limiting beneficiaries to one sponsor regardless of budget
-- Beneficiaries should accept multiple sponsors until their budget goal is met

-- Drop the unique index
DROP INDEX IF EXISTS public.uniq_active_subscription_per_beneficiary;

-- Add comment explaining the correct behavior
COMMENT ON TABLE public.subscriptions IS 
  'Subscriptions table. Multiple active subscriptions per beneficiary are allowed until budget goal is met. Status validation is handled by trigger reject_fulfilled_beneficiary_subscription().';