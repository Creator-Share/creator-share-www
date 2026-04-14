set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.calc_budget_raised()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  amount int;
BEGIN
  SELECT SUM(credit)
  FROM transaction_ledger
  WHERE child_id = NEW.child_id
  --AND status != 'void'
  INTO amount;

  UPDATE sponsor_people 
  SET budget_raised = amount 
  WHERE id = NEW.child_id;

  RETURN NEW;
END; 
$function$
;

DROP TRIGGER IF EXISTS update_budget_raised ON public.transaction_ledger;
CREATE TRIGGER update_budget_raised AFTER INSERT OR DELETE OR UPDATE ON public.transaction_ledger FOR EACH ROW EXECUTE FUNCTION calc_budget_raised();


