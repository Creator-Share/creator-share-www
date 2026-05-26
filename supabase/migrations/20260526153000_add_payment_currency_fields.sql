DO $$ BEGIN
  CREATE TYPE public.payment_currency AS ENUM ('USD', 'AUD', 'GBP', 'EUR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS charged_amount integer,
  ADD COLUMN IF NOT EXISTS charged_currency public.payment_currency NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS charged_currency_minor_unit integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(18, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conversion_rate_source text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS currency_config_version text NOT NULL DEFAULT '2026-05-26-static-v1',
  ADD COLUMN IF NOT EXISTS provider_event_id text;

ALTER TABLE public.partnerships
  ADD COLUMN IF NOT EXISTS charged_amount integer,
  ADD COLUMN IF NOT EXISTS charged_currency public.payment_currency NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS charged_currency_minor_unit integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(18, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conversion_rate_source text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS currency_config_version text NOT NULL DEFAULT '2026-05-26-static-v1',
  ADD COLUMN IF NOT EXISTS provider_event_id text;

ALTER TABLE public.transaction_ledger
  ADD COLUMN IF NOT EXISTS charged_amount integer,
  ADD COLUMN IF NOT EXISTS charged_currency public.payment_currency NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS charged_currency_minor_unit integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS conversion_rate numeric(18, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conversion_rate_source text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS currency_config_version text NOT NULL DEFAULT '2026-05-26-static-v1',
  ADD COLUMN IF NOT EXISTS provider_event_id text;

UPDATE public.subscriptions
SET charged_amount = COALESCE(charged_amount, amount)
WHERE charged_amount IS NULL;

UPDATE public.partnerships
SET charged_amount = COALESCE(charged_amount, amount)
WHERE charged_amount IS NULL;

UPDATE public.transaction_ledger
SET charged_amount = COALESCE(charged_amount, credit)
WHERE charged_amount IS NULL;

CREATE INDEX IF NOT EXISTS subscriptions_provider_event_id_idx
  ON public.subscriptions (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_event_id_uidx
  ON public.subscriptions (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS partnerships_provider_event_id_idx
  ON public.partnerships (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS partnerships_provider_event_id_uidx
  ON public.partnerships (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transaction_ledger_provider_event_id_idx
  ON public.transaction_ledger (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_ledger_provider_event_id_uidx
  ON public.transaction_ledger (provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_charged_currency_idx
  ON public.subscriptions (charged_currency);

CREATE INDEX IF NOT EXISTS transaction_ledger_reference_action_idx
  ON public.transaction_ledger (reference, tx_action)
  WHERE reference IS NOT NULL;
