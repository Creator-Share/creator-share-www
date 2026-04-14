-- Add email_logs table and email_status enum to match production schema.
-- These were created directly on production without a migration.

DO $$ BEGIN
  CREATE TYPE public.email_status AS ENUM ('sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.email_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email text NOT NULL,
    subject text NOT NULL,
    status public.email_status NOT NULL,
    error text,
    message_id text,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    email_type text,
    CONSTRAINT email_logs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS email_logs_created_at_idx ON public.email_logs (created_at);
CREATE INDEX IF NOT EXISTS email_logs_email_idx ON public.email_logs (email);
CREATE INDEX IF NOT EXISTS email_logs_email_type_idx ON public.email_logs (email_type);
