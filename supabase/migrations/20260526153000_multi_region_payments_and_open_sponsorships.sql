BEGIN;

DO $$ BEGIN
  CREATE TYPE public.stripe_region AS ENUM ('us', 'uk');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_currency AS ENUM ('USD', 'AUD', 'GBP', 'EUR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_region public.stripe_region NOT NULL DEFAULT 'us',
  ADD COLUMN IF NOT EXISTS charged_amount integer,
  ADD COLUMN IF NOT EXISTS charged_currency public.payment_currency NOT NULL DEFAULT 'USD',
  -- charged_currency_minor_unit removed: always 2 for our supported currencies
  -- ADD COLUMN IF NOT EXISTS charged_currency_minor_unit integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(18, 8) NOT NULL DEFAULT 1,
  -- conversion_rate_source removed: "default" vs "env" is an implementation detail, not audit data
  -- ADD COLUMN IF NOT EXISTS conversion_rate_source text NOT NULL DEFAULT 'default',
  -- currency_config_version removed: hardcoded string with no version system
  -- ADD COLUMN IF NOT EXISTS currency_config_version text NOT NULL DEFAULT '2026-05-26-static-v1',
  ADD COLUMN IF NOT EXISTS provider_event_id text;

ALTER TABLE public.partnerships
  ADD COLUMN IF NOT EXISTS payment_region public.stripe_region NOT NULL DEFAULT 'us',
  ADD COLUMN IF NOT EXISTS charged_amount integer,
  ADD COLUMN IF NOT EXISTS charged_currency public.payment_currency NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(18, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS provider_event_id text;

ALTER TABLE public.transaction_ledger
  ADD COLUMN IF NOT EXISTS charged_amount integer,
  ADD COLUMN IF NOT EXISTS charged_currency public.payment_currency NOT NULL DEFAULT 'USD',
  -- charged_currency_minor_unit removed: always 2 for our supported currencies
  -- ADD COLUMN IF NOT EXISTS charged_currency_minor_unit integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(18, 8) NOT NULL DEFAULT 1,
  -- conversion_rate_source removed: "default" vs "env" is an implementation detail, not audit data
  -- ADD COLUMN IF NOT EXISTS conversion_rate_source text NOT NULL DEFAULT 'default',
  -- currency_config_version removed: hardcoded string with no version system
  -- ADD COLUMN IF NOT EXISTS currency_config_version text NOT NULL DEFAULT '2026-05-26-static-v1',
  ADD COLUMN IF NOT EXISTS provider_event_id text;

-- Backfill charged_amount for all pre-migration rows (per migration all charged_amount is null)
UPDATE public.subscriptions SET charged_amount = amount;
-- WHERE charged_amount IS NULL;

-- Backfill partnerships: charged_amount and charged_currency (all pre-migration rows are USD-only)
UPDATE public.partnerships
SET charged_amount = amount;
-- WHERE charged_amount IS NULL;

-- Same backfill for transaction_ledger: all pre-migration rows are USD-only.
UPDATE public.transaction_ledger
SET charged_amount = credit;
-- WHERE charged_amount IS NULL;

-- Commented out: this backfill duplicates migration
-- 20260414002000_backfill_open_sponsorship_budget_goal.sql which has already
-- run against production. It is a no-op at this point and unrelated to the
-- multi-region or currency concerns of this migration.
-- UPDATE public.beneficiaries
-- SET budget_goal = -1
-- WHERE beneficiary_type IN ('SPECIAL_NEEDS', 'IN_OUR_CARE', 'ANIMAL')
--   AND budget_goal IS DISTINCT FROM -1;

-- Commented out: this was a speculative cleanup that resets 'Budget Fulfilled'
-- status on open-sponsorship types. There is no evidence these rows exist in
-- production — the open_sponsorship_never_auto_fulfilled trigger already
-- prevented auto-fulfillment for budget_goal = -1. Wholesale status resets
-- belong in a targeted data fix, not in a schema migration.
-- UPDATE public.beneficiaries
-- SET status = CASE
--     WHEN COALESCE(active_subscriptions, 0) > 0
--       OR COALESCE(budget_raised, 0) > 0
--       THEN 'Partially Funded'::"PersonStatus"
--     ELSE 'New'::"PersonStatus"
--   END
-- WHERE beneficiary_type IN ('SPECIAL_NEEDS', 'IN_OUR_CARE', 'ANIMAL')
--   AND status = 'Budget Fulfilled';

COMMENT ON COLUMN public.subscriptions.payment_region IS
  'Stripe routing region for this subscription. For non-Stripe providers '
  '(currently sponsorship_method = PAYPAL) the column is set to the default '
  'region for schema NOT NULL compatibility but carries no semantic meaning; '
  'PayPal has a single global account today.';

COMMENT ON COLUMN public.partnerships.payment_region IS
  'Stripe routing region for this partnership. Always Stripe today; if a '
  'non-Stripe partnership provider is added in future, treat the column as '
  'meaningless for those rows (see subscriptions.payment_region comment).';

CREATE INDEX IF NOT EXISTS subscriptions_payment_region_idx
  ON public.subscriptions (payment_region);

CREATE INDEX IF NOT EXISTS partnerships_payment_region_idx
  ON public.partnerships (payment_region);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_event_id_uidx
  ON public.subscriptions (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS partnerships_provider_event_id_uidx
  ON public.partnerships (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_ledger_provider_event_id_uidx
  ON public.transaction_ledger (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_charged_currency_idx
  ON public.subscriptions (charged_currency);

CREATE INDEX IF NOT EXISTS transaction_ledger_reference_action_idx
  ON public.transaction_ledger (reference, tx_action)
  WHERE reference IS NOT NULL;

-- ============================================================================
-- Budget fulfillment with 90% margin for multi-currency rounding
--
-- Multi-currency conversions (GBP→USD, AUD→USD, etc.) introduce rounding
-- error up to ~1¢ per conversion. Exchange rate drift between the rate we
-- stored and the actual rate at display time can introduce more variance.
-- Since this is charitable giving (not margin trading), we use a generous
-- 90% threshold: if total_monthly_amount >= 90% of budget_goal, we treat
-- the goal as fulfilled.
--
-- See docs/abandon_fractional_sponsorship.md for the full rationale.
-- Replaces the function from 20251126004900_fix_beneficiary_calculations.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_beneficiary_by_subscriptions(target_beneficiary_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  current_goal integer;
  current_status "PersonStatus";
  current_fulfilled_at timestamptz;
  total_monthly_amount integer;
  subscription_count integer;
  calculated_status "PersonStatus";
  new_fulfilled_at timestamptz;
BEGIN
  SELECT budget_goal, status, goal_fulfilled_at
  INTO current_goal, current_status, current_fulfilled_at
  FROM beneficiaries
  WHERE id = target_beneficiary_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(
      CASE
        WHEN s.interval = 'year' THEN s.amount / 12
        ELSE s.amount
      END
    ), 0),
    COALESCE(COUNT(*), 0)
  INTO total_monthly_amount, subscription_count
  FROM subscriptions s
  WHERE s.beneficiary_id = target_beneficiary_id
    AND s.status = 'complete';

  -- Determine calculated status
  IF current_status IN ('Draft', 'Archived') THEN
    calculated_status := current_status;
  -- 90% margin: multi-currency rounding + FOREX drift /timing can produce minor variance
  ELSIF total_monthly_amount * 100 >= current_goal * 90 THEN
    calculated_status := 'Budget Fulfilled';
  ELSIF total_monthly_amount > 0 THEN
    calculated_status := 'Partially Funded';
  ELSE
    calculated_status := 'New';
  END IF;

  -- Set goal_fulfilled_at on first crossing of the goal. Never clear it.
  IF calculated_status = 'Budget Fulfilled' AND current_status != 'Budget Fulfilled' THEN
    new_fulfilled_at := NOW();
  ELSE
    new_fulfilled_at := current_fulfilled_at;
  END IF;

  UPDATE beneficiaries
  SET
    budget_raised = total_monthly_amount,
    status = calculated_status,
    active_subscriptions = subscription_count,
    goal_fulfilled_at = new_fulfilled_at
  WHERE id = target_beneficiary_id
    AND (
      budget_raised IS DISTINCT FROM total_monthly_amount
      OR status IS DISTINCT FROM calculated_status
      OR active_subscriptions IS DISTINCT FROM subscription_count
      OR goal_fulfilled_at IS DISTINCT FROM new_fulfilled_at
    );
END;
$$;

COMMENT ON FUNCTION public.update_beneficiary_by_subscriptions IS
  'Recalculates budget_raised, status, active_subscriptions, and goal_fulfilled_at for a beneficiary. Uses a 90% threshold to account for multi-currency rounding and FX rate drift in charitable sponsorship conversions.';

COMMIT;
