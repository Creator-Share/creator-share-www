-- Add sort_weight column to beneficiaries table
-- This will be used to deprioritize beneficiaries when daily sponsorship quota is exceeded

alter table "public"."beneficiaries" add column if not exists "sort_weight" integer default 100;

-- Create index for sort_weight to improve query performance
create index if not exists idx_beneficiaries_sort_weight on public.beneficiaries(sort_weight desc);

-- Create a function to get count of beneficiaries fulfilled today
create or replace function get_today_fulfilled_count()
returns integer
language plpgsql
as $$
declare
  fulfilled_count integer;
begin
  select count(*)
  into fulfilled_count
  from beneficiaries
  where date_trunc('day', goal_fulfilled_at) = date_trunc('day', now() at time zone 'UTC');
  
  return fulfilled_count;
end;
$$;

-- Create a function to adjust sort weight based on daily sponsorship count
create or replace function adjust_sort_weight_on_fulfillment()
returns trigger
language plpgsql
as $$
declare
  daily_count integer;
begin
  -- Only proceed if goal_fulfilled_at was just set (changed from NULL to a value)
  if OLD.goal_fulfilled_at is null and NEW.goal_fulfilled_at is not null then
    -- Get count of beneficiaries fulfilled today (including this one)
    daily_count := get_today_fulfilled_count();
    
    -- If more than 25 children sponsored today, reduce sort weight
    if daily_count > 25 then
      NEW.sort_weight := 50; -- Lower weight means lower priority
      raise notice 'Beneficiary % sort weight reduced to 50 (daily count: %)', NEW.id, daily_count;
    else
      NEW.sort_weight := 100; -- Normal weight
      raise notice 'Beneficiary % sort weight kept at 100 (daily count: %)', NEW.id, daily_count;
    end if;
  end if;
  
  return NEW;
end;
$$;

-- Create trigger to automatically adjust sort weight when goal is fulfilled
drop trigger if exists trigger_adjust_sort_weight on public.beneficiaries;
create trigger trigger_adjust_sort_weight
  before update on public.beneficiaries
  for each row
  execute function adjust_sort_weight_on_fulfillment();

-- Add comment to document the feature
comment on column public.beneficiaries.sort_weight is 'Weight used for sorting beneficiaries. Reduced to 50 when more than 25 children sponsored in a day, otherwise 100.';
