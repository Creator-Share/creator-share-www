-- Update transaction_ledger: rename child_id to beneficiary_id
DO $$ BEGIN
  ALTER TABLE public.transaction_ledger RENAME COLUMN child_id TO beneficiary_id;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Update subscriptions: rename child_id to beneficiary_id
DO $$ BEGIN
  ALTER TABLE public.subscriptions RENAME COLUMN child_id TO beneficiary_id;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Rename people table to beneficiaries
DO $$ BEGIN
  ALTER TABLE public.sponsor_people RENAME TO beneficiaries;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
ALTER TABLE public.beneficiaries
  ADD COLUMN IF NOT EXISTS metadata jsonb;


-- Rename people_activities to activities, add title and rename child_id column
DO $$ BEGIN
  ALTER TABLE public.people_activities RENAME TO activities;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS title text;
DO $$ BEGIN
  ALTER TABLE public.activities RENAME COLUMN child_id TO beneficiary_id;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Rename sponsor_people_images to media
DO $$ BEGIN
  ALTER TABLE public.sponsor_people_images RENAME TO media;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.media RENAME COLUMN sponsor_people_id TO beneficiary_id;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;
ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS activity_id uuid;
-- Constraints
ALTER TABLE public.media
  DROP CONSTRAINT IF EXISTS media_beneficiary_id_fkey;
DO $$ BEGIN
  ALTER TABLE public.media
    ADD CONSTRAINT media_beneficiary_id_fkey FOREIGN KEY (beneficiary_id) REFERENCES public.beneficiaries(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.media
    ADD CONSTRAINT media_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Triggers and Indexes
DROP TRIGGER IF EXISTS preserve_active_subscriptions ON public.beneficiaries;
CREATE TRIGGER preserve_active_subscriptions BEFORE UPDATE ON public.beneficiaries FOR EACH ROW EXECUTE FUNCTION handle_active_subscriptions();

DROP TRIGGER IF EXISTS update_subscription_budget ON public.subscriptions;
CREATE TRIGGER update_subscription_budget AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION calc_budget_raised();

-- Add any additional necessary constraints and indexes for new columns
CREATE INDEX IF NOT EXISTS idx_beneficiaries_location_geo ON public.beneficiaries USING gist (location_geo);
CREATE INDEX IF NOT EXISTS idx_subscriptions_beneficiary_id ON public.subscriptions USING btree (beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_transaction_ledger_beneficiary_id ON public.transaction_ledger USING btree (beneficiary_id);

DROP TRIGGER IF EXISTS preserve_active_subscriptions ON public.beneficiaries;
CREATE TRIGGER preserve_active_subscriptions BEFORE UPDATE ON public.beneficiaries FOR EACH ROW EXECUTE FUNCTION handle_active_subscriptions();

DROP TRIGGER IF EXISTS update_subscription_budget ON public.subscriptions;
CREATE TRIGGER update_subscription_budget AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION calc_budget_raised();

-- Add any additional necessary constraints and indexes for new columns
CREATE INDEX IF NOT EXISTS idx_beneficiaries_location_geo ON public.beneficiaries USING gist (location_geo);
CREATE INDEX IF NOT EXISTS idx_subscriptions_beneficiary_id ON public.subscriptions USING btree (beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_transaction_ledger_beneficiary_id ON public.transaction_ledger USING btree (beneficiary_id);

-- Add beneficiary_types enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'beneficiary_types') THEN
    CREATE TYPE beneficiary_types AS ENUM ('CHILD', 'ANIMAL', 'FAMILY');
  END IF;
END
$$;

ALTER TABLE public.beneficiaries
  ADD COLUMN IF NOT EXISTS beneficiary_type beneficiary_types;