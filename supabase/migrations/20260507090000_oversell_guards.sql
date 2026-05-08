-- Reliability Batch 2b: capacity-aware oversell guards on kennel runs
-- and boarding/daycare suites.
--
-- Today, every facility's kennel runs and suites have a `capacity`
-- column (mostly 1, sometimes 2 for sibling pets). The existing GIST
-- indexes (kennel_no_pet_double_assign, reservations_no_suite_overlap)
-- only support overlap *queries* — they're not exclusion constraints
-- and don't reject double-bookings at write time. So in practice
-- nothing stops a second pet from being assigned to a full run, or a
-- second reservation from being booked into a full suite.
--
-- A simple unique partial index would be too aggressive (it'd break
-- the capacity=2 cases). So we use a BEFORE INSERT OR UPDATE trigger
-- per table that counts overlapping active rows and rejects when the
-- count would exceed the unit's declared capacity.

-- ---------------------------------------------------------------
-- Kennel run assignments — point-in-time check
-- ---------------------------------------------------------------
-- An assignment is "active" while removed_at IS NULL. Two active
-- assignments to the same kennel_run_id collide; we reject if the
-- count of *other* active rows already meets capacity.

create or replace function public.enforce_kennel_run_capacity()
returns trigger
language plpgsql
as $fn$
declare
  _capacity int;
  _active_count int;
  _run_name text;
begin
  -- Only run the check when the new state is active. If the row is
  -- being soft-removed (removed_at set) we let it through — we don't
  -- care about archived assignments piling up.
  if new.removed_at is not null then
    return new;
  end if;

  select capacity, name into _capacity, _run_name
  from public.kennel_runs
  where id = new.kennel_run_id;
  if _capacity is null then
    -- run was just deleted or never existed — let the FK error speak
    return new;
  end if;

  select count(*) into _active_count
  from public.kennel_run_assignments
  where kennel_run_id = new.kennel_run_id
    and removed_at is null
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if _active_count + 1 > _capacity then
    raise exception
      'Kennel run % is full (capacity %, % active assignment(s)). Remove an existing pet before assigning another.',
      coalesce(_run_name, new.kennel_run_id::text), _capacity, _active_count
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_kennel_run_capacity on public.kennel_run_assignments;
create trigger trg_kennel_run_capacity
  before insert or update of kennel_run_id, removed_at
  on public.kennel_run_assignments
  for each row
  execute function public.enforce_kennel_run_capacity();

-- ---------------------------------------------------------------
-- Suite reservations — time-range overlap check
-- ---------------------------------------------------------------
-- Suites are reserved over a time range. A reservation participates
-- in suite occupancy when it has a suite_id, isn't deleted, and is
-- in an "occupies the suite" status (not cancelled, not no_show).
-- (We allow checked_out reservations to still participate so an
-- early-return doesn't free the suite for someone else mid-stay.)
-- Capacity > 1 is rare (sibling boarding); we honor it.

create or replace function public.enforce_suite_capacity()
returns trigger
language plpgsql
as $fn$
declare
  _capacity int;
  _suite_name text;
  _overlap_count int;
begin
  -- Only run the check when the new row WILL occupy the suite.
  if new.suite_id is null
     or new.deleted_at is not null
     or new.status in ('cancelled','no_show') then
    return new;
  end if;

  -- Defensive: start_at/end_at must be present and ordered.
  if new.start_at is null or new.end_at is null then
    return new;
  end if;

  select capacity, name into _capacity, _suite_name
  from public.suites
  where id = new.suite_id;
  if _capacity is null then
    return new;
  end if;

  -- Count other reservations that:
  --   - point at the same suite
  --   - are not the row being upserted
  --   - are still active (not deleted, not cancelled/no_show)
  --   - overlap the new row's time range (half-open: [start_at, end_at))
  select count(*) into _overlap_count
  from public.reservations r
  where r.suite_id = new.suite_id
    and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and r.deleted_at is null
    and r.status not in ('cancelled','no_show')
    and tstzrange(r.start_at, r.end_at, '[)') &&
        tstzrange(new.start_at, new.end_at, '[)');

  if _overlap_count + 1 > _capacity then
    raise exception
      'Suite % is full for the requested dates (capacity %, % overlapping reservation(s)). Pick a different suite or change the dates.',
      coalesce(_suite_name, new.suite_id::text), _capacity, _overlap_count
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_suite_capacity on public.reservations;
create trigger trg_suite_capacity
  before insert or update of suite_id, start_at, end_at, status, deleted_at
  on public.reservations
  for each row
  execute function public.enforce_suite_capacity();
