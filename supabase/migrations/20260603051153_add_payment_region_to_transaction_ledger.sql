BEGIN;

DO $$ BEGIN
  ALTER TABLE "public"."transaction_ledger" ADD COLUMN "payment_region" public.stripe_region;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

COMMIT;
