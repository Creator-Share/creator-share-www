BEGIN;

UPDATE public.beneficiaries
SET budget_goal = -1
WHERE beneficiary_type IN ('SPECIAL_NEEDS', 'IN_OUR_CARE', 'ANIMAL')
  AND budget_goal IS DISTINCT FROM -1;

UPDATE public.beneficiaries
SET status = CASE
    WHEN COALESCE(active_subscriptions, 0) > 0
      OR COALESCE(budget_raised, 0) > 0
      THEN 'Partially Funded'::"PersonStatus"
    ELSE 'New'::"PersonStatus"
  END
WHERE beneficiary_type IN ('SPECIAL_NEEDS', 'IN_OUR_CARE', 'ANIMAL')
  AND status = 'Budget Fulfilled';

COMMIT;
