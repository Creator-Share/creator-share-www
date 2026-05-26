-- Promote payment_region from a free-text + CHECK constraint pair to a real
-- Postgres ENUM. Two reasons:
--   1. `supabase gen types typescript` reads enums into a discriminated union
--      automatically, so the manual TS narrowing in src/lib/types/db.types.ts
--      stops being a hand-maintained drift risk that the next type
--      regeneration would silently revert.
--   2. ENUMs surface a clearer error from the DB driver ("invalid input
--      value for enum stripe_region") than a CHECK violation, which our
--      logs grep for during incident response.
--
-- Also documents column intent via COMMENT ON COLUMN so non-Stripe rows
-- (PayPal, future providers) stop carrying a meaningless 'us' that future
-- readers would mistake for a real routing decision.

DO $$ BEGIN
  CREATE TYPE public.stripe_region AS ENUM ('us', 'uk');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop the now-redundant CHECK before swapping the column type so the
-- USING cast doesn't fight the constraint mid-migration.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_payment_region_check;
ALTER TABLE public.partnerships
  DROP CONSTRAINT IF EXISTS partnerships_payment_region_check;

ALTER TABLE public.subscriptions
  ALTER COLUMN payment_region TYPE public.stripe_region
  USING payment_region::public.stripe_region;

ALTER TABLE public.partnerships
  ALTER COLUMN payment_region TYPE public.stripe_region
  USING payment_region::public.stripe_region;

COMMENT ON COLUMN public.subscriptions.payment_region IS
  'Stripe routing region for this subscription. For non-Stripe providers '
  '(currently sponsorship_method = PAYPAL) the column is set to the default '
  'region for schema NOT NULL compatibility but carries no semantic meaning; '
  'PayPal has a single global account today.';

COMMENT ON COLUMN public.partnerships.payment_region IS
  'Stripe routing region for this partnership. Always Stripe today; if a '
  'non-Stripe partnership provider is added in future, treat the column as '
  'meaningless for those rows (see subscriptions.payment_region comment).';
