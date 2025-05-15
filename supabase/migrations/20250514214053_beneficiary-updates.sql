-- Update transaction_ledger: add beneficiary_id column
ALTER TABLE public.transaction_ledger
  RENAME COLUMN child_id TO beneficiary_id;

-- Update subscriptions: add beneficiary_id column, drop currency column
ALTER TABLE public.subscriptions
  RENAME COLUMN child_id TO beneficiary_id;

-- Rename people table to beneficiaries
ALTER TABLE public.sponsor_people RENAME TO beneficiaries;
ALTER TABLE public.beneficiaries
  ADD COLUMN IF NOT EXISTS metadata jsonb;


-- Rename people_activities to activities, add title and rename child_id column
ALTER TABLE public.people_activities RENAME TO activities;
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.activities
  RENAME COLUMN child_id TO beneficiary_id;

-- Rename sponsor_people_images to media
ALTER TABLE public.sponsor_people_images RENAME TO media;
ALTER TABLE public.media
  RENAME COLUMN sponsor_people_id TO beneficiary_id;
ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS activity_id uuid;
-- Constraints
ALTER TABLE public.media
  DROP CONSTRAINT IF EXISTS media_beneficiary_id_fkey;
ALTER TABLE public.media
  ADD CONSTRAINT media_beneficiary_id_fkey FOREIGN KEY (beneficiary_id) REFERENCES public.beneficiaries(id) ON DELETE SET NULL;
ALTER TABLE public.media
  ADD CONSTRAINT media_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;

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