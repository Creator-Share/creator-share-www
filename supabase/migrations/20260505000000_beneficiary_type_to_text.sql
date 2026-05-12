-- Convert beneficiary_type from the beneficiary_types enum to plain text.
-- The application (src/types/admin.types.ts BENEFICIARY_TYPES) is now the
-- source of truth for valid values. No CHECK constraint by design — adding
-- new types should be a TS-only change with no DB migration churn.

BEGIN;

ALTER TABLE public.beneficiaries
  ALTER COLUMN beneficiary_type TYPE text
  USING beneficiary_type::text;

DROP TYPE IF EXISTS public.beneficiary_types;

COMMIT;
