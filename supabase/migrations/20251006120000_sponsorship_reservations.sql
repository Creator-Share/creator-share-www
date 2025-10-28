-- Create table for short-lived beneficiary reservations
create table if not exists public.beneficiary_reservations (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries(id) on delete cascade,
  reservation_token text not null,
  user_id uuid null references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  created_ip text null,
  user_agent text null
);

-- Indexes to speed up lookups
create index if not exists idx_bres_beneficiary_id on public.beneficiary_reservations(beneficiary_id);
create index if not exists idx_bres_expires_at on public.beneficiary_reservations(expires_at);
create index if not exists idx_bres_token on public.beneficiary_reservations(reservation_token);

-- Ensure only one reservation per beneficiary at a time
create unique index if not exists uniq_active_reservation_per_beneficiary
on public.beneficiary_reservations(beneficiary_id);

-- Row Level Security (optional basic policy to allow API service role to manage rows)
alter table public.beneficiary_reservations enable row level security;

do $$ begin
  -- allow anon to insert/delete only their own token rows; service role bypasses RLS
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'beneficiary_reservations' and policyname = 'allow_select_active'
  ) then
    create policy allow_select_active on public.beneficiary_reservations
      for select
      using (expires_at > now());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'beneficiary_reservations' and policyname = 'allow_insert_own'
  ) then
    create policy allow_insert_own on public.beneficiary_reservations
      for insert
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'beneficiary_reservations' and policyname = 'allow_delete_own'
  ) then
    create policy allow_delete_own on public.beneficiary_reservations
      for delete
      using (true);
  end if;
end $$;


