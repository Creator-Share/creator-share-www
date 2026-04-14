DO $$ BEGIN
  ALTER TABLE "public"."transaction_ledger" ADD COLUMN "customer_id" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."transaction_ledger" ADD COLUMN "payment_intent" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "public"."transaction_ledger" ADD COLUMN "payment_method_id" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.calc_budget_raised()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$DECLARE
  total_amount int;
  updated_status "PersonStatus";
BEGIN
  SELECT SUM(
    CASE
      WHEN s.interval = 'year' THEN s.amount / 12
      ELSE s.amount
    END
  ) INTO total_amount
  FROM subscriptions s
  WHERE s.beneficiary_id = COALESCE(NEW.beneficiary_id, OLD.beneficiary_id)
  AND s.status != 'cancelled';

  -- Determine the status based on total amount and budget goal
  IF total_amount >= (SELECT budget_goal FROM beneficiaries WHERE id = NEW.beneficiary_id)::numeric THEN
    updated_status = 'Budget Fulfilled';
  ELSE
    updated_status = 'Partially Funded';
  END IF;

  -- Update the beneficiaries record with the new total and status
  UPDATE beneficiaries
  SET
    budget_raised = total_amount,
    status = updated_status
  WHERE id = COALESCE(NEW.beneficiary_id, OLD.beneficiary_id);

  RETURN NEW;
END;$function$
;


