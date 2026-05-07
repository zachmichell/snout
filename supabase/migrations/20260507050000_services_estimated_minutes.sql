-- 7.2: Per-service estimated duration.
--
-- Required for "flat" duration services (grooming) so the booking
-- wizard can compute a sensible end_at on reservations and downstream
-- staff schedules show the right block on calendars.
--
-- Optional for time-window services (half_day / full_day / overnight)
-- where the customer or staff explicitly picks the end time. We store
-- it for those too as informational metadata; the wizard only consults
-- it for "flat" today.
--
-- Default kept null so operators have to consciously pick a duration
-- for new flat services rather than inheriting a possibly-wrong 60.
-- Existing grooming services get backfilled by name in this same
-- migration so the production data is not blank on day one.

alter table public.services
  add column if not exists estimated_minutes integer
    check (estimated_minutes is null or estimated_minutes between 5 and 1440);

comment on column public.services.estimated_minutes is
  '7.2: Per-service appointment duration in minutes. Required for flat-duration services; informational for time-window services. Range 5-1440.';

-- Backfill the three known grooming services per the cluster scope.
-- Match by name + module so we don''t hit other-org services or the
-- wrong record. UPDATEs silently no-op if the rows aren''t present
-- (e.g., a fresh DB without the seed).
update public.services
   set estimated_minutes = 15
 where lower(name) = 'nail trim'
   and module = 'grooming'
   and estimated_minutes is null;

update public.services
   set estimated_minutes = 60
 where lower(name) like 'grooming — bath %'
   and module = 'grooming'
   and estimated_minutes is null;

update public.services
   set estimated_minutes = 90
 where lower(name) like 'grooming — full groom%'
   and module = 'grooming'
   and estimated_minutes is null;
