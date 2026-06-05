-- 20260604000000_add_email_to_subscriptions_and_subscription_id_to_tledger.sql

BEGIN;

-- Step 1: Add subscription_id FK to transaction_ledger
DO $$ BEGIN
  ALTER TABLE public.transaction_ledger
    ADD COLUMN subscription_id uuid REFERENCES public.subscriptions(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tledger_subscription_id
  ON public.transaction_ledger (subscription_id)
  WHERE subscription_id IS NOT NULL;

-- Step 2: Add email to subscriptions
DO $$ BEGIN
  ALTER TABLE public.subscriptions
    ADD COLUMN email text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Composite index covering the notify query pattern:
-- WHERE beneficiary_id = ? AND status = 'complete' AND email IS NOT NULL
CREATE INDEX IF NOT EXISTS idx_subscriptions_beneficiary_status_email
  ON public.subscriptions (beneficiary_id, status)
  WHERE email IS NOT NULL;

COMMIT;
