-- Make suite-overlap protection capacity-aware.
--
-- The booking_exclusion_constraints migration (20260424130300) added
--   ALTER TABLE reservations ADD CONSTRAINT reservations_no_suite_overlap
--   EXCLUDE USING gist (suite_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) ...
-- which treats ANY overlap on a suite as a conflict. That's correct for
-- capacity=1 suites (the common case) but wrong for capacity>=2 suites
-- (sibling-boarding rooms): the constraint rejects a perfectly valid
-- second reservation that the capacity-aware trigger from
-- 20260507090000_oversell_guards.sql would allow.
--
-- The trigger has had the correct semantics since 2026-05-07; the
-- exclusion constraint just fires first. Since the trigger handles
-- capacity properly, we drop the binary exclusion constraint and make
-- the trigger race-safe by serializing concurrent inserts on the same
-- suite via a row-level lock on suites.
--
-- Under READ COMMITTED isolation, two concurrent inserts on the same
-- suite without serialization could both pass the count check (each
-- still sees count=0) and both commit. Locking the suites row first
-- forces them to serialize: the second waits for the first to commit,
-- then re-reads and counts the committed row.

alter table public.reservations
  drop constraint if exists reservations_no_suite_overlap;

create or replace function public.enforce_suite_capacity()
returns trigger
language plpgsql
as $fn$
declare
  _capacity int;
  _suite_name text;
  _overlap_count int;
begin
  if new.suite_id is null
     or new.deleted_at is not null
     or new.status in ('cancelled','no_show') then
    return new;
  end if;

  if new.start_at is null or new.end_at is null then
    return new;
  end if;

  -- FOR UPDATE serializes concurrent reservation inserts on the same
  -- suite. Without it, two transactions could both count zero overlaps
  -- and both insert, overselling a capacity-1 suite.
  select capacity, name into _capacity, _suite_name
  from public.suites
  where id = new.suite_id
  for update;
  if _capacity is null then
    return new;
  end if;

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
