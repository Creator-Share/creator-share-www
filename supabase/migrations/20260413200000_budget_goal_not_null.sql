-- Make budget_goal non-nullable with a default of 0.
-- All existing rows already have non-null values (verified).

ALTER TABLE beneficiaries ALTER COLUMN budget_goal SET DEFAULT 0;
ALTER TABLE beneficiaries ALTER COLUMN budget_goal SET NOT NULL;
