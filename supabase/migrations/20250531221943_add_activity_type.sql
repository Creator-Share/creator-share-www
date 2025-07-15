-- Create activity_type enum
create type public.activity_type as enum (
  'INFO',
  'UPDATE',
  'SUBSCRIPTION'
);

-- Add activity_type column to activities
alter table public.activities
  add column activity_type public.activity_type default 'INFO';