-- Operator-UX Batch 3b: cache each pet's most-recently-used kennel run on
-- the pet record itself so it can be surfaced on the pet profile and used
-- as the booking/check-in default.
--
-- The CheckInFlow already queries kennel_run_assignments dynamically each
-- time, but that's a per-flow lookup with no canonical column to display
-- elsewhere ("Sparky usually goes in Run 3"). A cached column lets us:
--   - surface the preference on the pet profile
--   - pin a manual override (operator picks a specific run)
--   - report on it (e.g. group pets by preferred run)
--   - skip the dynamic query at check-in time on busy orgs

alter table public.pets
  add column if not exists preferred_kennel_run_id uuid
    references public.kennel_runs(id) on delete set null;

create index if not exists idx_pets_preferred_kennel_run
  on public.pets (preferred_kennel_run_id)
  where preferred_kennel_run_id is not null;

-- Trigger: every time a kennel_run_assignment lands, refresh the pet's
-- preferred run to that one. Operators can manually override the column
-- and it will hold until the next assignment.
create or replace function public.refresh_pet_preferred_kennel_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.kennel_run_id is null or new.pet_id is null then
    return new;
  end if;
  -- Only update on insert / when the assignment is active. Soft-removed
  -- rows shouldn't churn the preference.
  if new.removed_at is not null then
    return new;
  end if;
  update public.pets
     set preferred_kennel_run_id = new.kennel_run_id
   where id = new.pet_id
     and (preferred_kennel_run_id is distinct from new.kennel_run_id);
  return new;
end;
$fn$;

drop trigger if exists trg_refresh_pet_preferred_kennel_run on public.kennel_run_assignments;
create trigger trg_refresh_pet_preferred_kennel_run
  after insert
  on public.kennel_run_assignments
  for each row
  execute function public.refresh_pet_preferred_kennel_run();

-- Backfill: for every pet without a preferred run set, pick their most
-- recent active-or-historical kennel_run_assignments row.
update public.pets p
   set preferred_kennel_run_id = sub.kennel_run_id
  from (
    select distinct on (pet_id) pet_id, kennel_run_id
      from public.kennel_run_assignments
     order by pet_id, assigned_at desc
  ) sub
 where sub.pet_id = p.id
   and p.preferred_kennel_run_id is null;
