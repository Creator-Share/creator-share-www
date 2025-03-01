set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.calc_budget_raised()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
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
  WHERE s.child_id = COALESCE(NEW.child_id, OLD.child_id)
  AND s.status != 'cancelled';

  -- Determine the status based on total amount and budget goal
  IF total_amount >= (SELECT budget_goal FROM sponsor_people WHERE id = NEW.child_id)::numeric THEN
    updated_status = 'Budget Fulfilled';
  ELSE
    updated_status = 'Partially Funded';
  END IF;

  -- Update the sponsor_people record with the new total and status
  UPDATE sponsor_people
  SET
    budget_raised = total_amount,
    status = updated_status
  WHERE id = COALESCE(NEW.child_id, OLD.child_id);

  RETURN NEW;
END;
$function$
;

CREATE TRIGGER update_subscription_budget AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION calc_budget_raised();