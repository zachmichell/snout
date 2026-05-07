-- 7.3: Pre-flight booking conflict check.
--
-- The owner-facing booking wizard calls this before submitting a
-- reservation. Returns whether the requested time slot collides with
-- any active reservation on the same service. We don't expose other
-- customers' booking details — the caller only learns "yes it's
-- taken" or "no it's free".
--
-- The DB also enforces this via booking_exclusion_constraints, so a
-- successful pre-flight check followed by a slow second user grabbing
-- the same slot still surfaces an insert error. Pre-flight is just
-- UX polish.
--
-- Conflict detection rules:
--   - Same organization
--   - Same service_id
--   - Status NOT IN ('cancelled', 'no_show')
--   - start_at < proposed_end_at AND end_at > proposed_start_at
--     (canonical overlap predicate; touching boundaries don't conflict)
--
-- Grooming services additionally check the grooming_appointments
-- table for groomer-level overlaps. If any groomer in the org is busy
-- across the requested window, we conservatively report busy. Better
-- to send a customer a slightly-too-restrictive view than to let them
-- submit a request that staff will reject.

create or replace function public.check_booking_conflict(
  _organization_id uuid,
  _service_id uuid,
  _start_at timestamptz,
  _end_at timestamptz
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  _conflicts integer;
  _service_module text;
begin
  if _start_at is null or _end_at is null or _end_at <= _start_at then
    raise exception 'check_booking_conflict: invalid time window';
  end if;

  -- Membership check: only org members can query availability.
  if not public.is_org_member(_organization_id) then
    return false;
  end if;

  select count(*) into _conflicts
  from public.reservations r
  where r.organization_id = _organization_id
    and r.service_id = _service_id
    and r.status not in ('cancelled', 'no_show')
    and r.deleted_at is null
    and r.start_at < _end_at
    and r.end_at > _start_at;

  if _conflicts > 0 then
    return true;
  end if;

  -- Grooming-specific: also block if any groomer is fully booked
  -- through the proposed window. Without a "pick groomer" step in
  -- the wizard, this is the best signal we have on actual capacity.
  select s.module into _service_module
  from public.services s where s.id = _service_id;

  if _service_module = 'grooming' then
    select count(*) into _conflicts
    from public.grooming_appointments ga
    where ga.organization_id = _organization_id
      and ga.status not in ('cancelled', 'no_show')
      and ga.appointment_date = _start_at::date
      and (
        ga.start_time::time < _end_at::time
        and (ga.start_time + (ga.estimated_duration_minutes * interval '1 minute'))::time > _start_at::time
      );
    if _conflicts > 0 then
      return true;
    end if;
  end if;

  return false;
end;
$fn$;

revoke all on function public.check_booking_conflict(uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.check_booking_conflict(uuid, uuid, timestamptz, timestamptz) to authenticated;

comment on function public.check_booking_conflict(uuid, uuid, timestamptz, timestamptz) is
  '7.3: Returns true if the requested service+time window collides with any active reservation (or groomer appointment for grooming services). Privacy-preserving: never returns the conflicting record details.';
