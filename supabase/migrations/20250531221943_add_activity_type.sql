-- Create activity_type enum
DO $$ BEGIN
  CREATE TYPE public.activity_type AS ENUM (
    'INFO',
    'UPDATE',
    'SUBSCRIPTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add activity_type column to activities
DO $$ BEGIN
  ALTER TABLE public.activities
    ADD COLUMN activity_type public.activity_type DEFAULT 'INFO';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
