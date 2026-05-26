-- Tighten payment_region to the values our application code understands.
-- Without this CHECK constraint, any string can land in the column and
-- coerceRegion() will quietly remap it to STRIPE_DEFAULT_REGION on read,
-- masking corruption (e.g. a typo in a future writer, a data migration
-- accident, or a hand-edited row).
--
-- Existing rows were backfilled to 'us' in 20260422100000; this migration
-- defensively normalises anything outside the allowed set before adding
-- the constraint so it can never fail on legacy data.

UPDATE public.subscriptions
SET payment_region = 'us'
WHERE payment_region NOT IN ('us', 'uk');

UPDATE public.partnerships
SET payment_region = 'us'
WHERE payment_region NOT IN ('us', 'uk');

DO $$ BEGIN
  ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_payment_region_check
    CHECK (payment_region IN ('us', 'uk'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.partnerships
    ADD CONSTRAINT partnerships_payment_region_check
    CHECK (payment_region IN ('us', 'uk'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
