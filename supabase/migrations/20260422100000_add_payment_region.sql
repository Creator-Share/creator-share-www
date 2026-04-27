-- Multi-region Stripe support: tag each subscription/partnership with the
-- Stripe account that owns it so downstream ops (cancel, refund, portal link,
-- webhook handlers) know which Stripe client and secret to use.
--
-- Existing rows predate multi-region and all belong to the primary account;
-- backfill them as 'us' (the legacy default). New rows should always set this
-- at insert time.

DO $$ BEGIN
  ALTER TABLE public.subscriptions
    ADD COLUMN payment_region text NOT NULL DEFAULT 'us';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.partnerships
    ADD COLUMN payment_region text NOT NULL DEFAULT 'us';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

UPDATE public.subscriptions SET payment_region = 'us' WHERE payment_region IS NULL;
UPDATE public.partnerships  SET payment_region = 'us' WHERE payment_region IS NULL;

CREATE INDEX IF NOT EXISTS subscriptions_payment_region_idx
  ON public.subscriptions (payment_region);

CREATE INDEX IF NOT EXISTS partnerships_payment_region_idx
  ON public.partnerships (payment_region);
