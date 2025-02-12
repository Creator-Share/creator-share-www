-- Every time a transaction is inserted, updated, or deleted
-- Updates the budget for the child
-- TODO: Handle different statuses for when people cancel subscriptions
CREATE OR REPLACE FUNCTION calc_budget_raised() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_budget_raised
AFTER INSERT OR UPDATE OR DELETE ON transaction_ledger 
FOR EACH ROW EXECUTE FUNCTION calc_budget_raised();