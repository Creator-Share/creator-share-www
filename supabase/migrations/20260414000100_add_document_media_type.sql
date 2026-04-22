-- Add DOCUMENT value to media_type enum to match production.
-- This was added directly on production without a migration.

ALTER TYPE public.media_type ADD VALUE IF NOT EXISTS 'DOCUMENT';
