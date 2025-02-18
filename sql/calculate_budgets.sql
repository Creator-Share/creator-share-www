-- Every time a subscription is inserted, updated, or deleted
-- Updates the budget for the child
CREATE OR REPLACE FUNCTION calc_budget_raised() RETURNS TRIGGER AS $$
DECLARE
  total_amount int;
BEGIN
  SELECT SUM(
    CASE 
      WHEN s.interval = 'year' THEN s.amount / 12
      ELSE s.amount
    END
  )
  INTO total_amount
  FROM subscriptions s
  WHERE s.child_id = NEW.child_id
  AND s.status != 'cancelled';

  UPDATE sponsor_people 
  SET budget_raised = total_amount 
  WHERE id = NEW.child_id;

  RETURN NEW;
END; 
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_budget_raised
AFTER INSERT OR UPDATE OR DELETE ON subscriptions 
FOR EACH ROW EXECUTE FUNCTION calc_budget_raised();