-- Multi-touch, multi-channel reservation reminders (Milestone A, Track 1).
--
-- Generalizes the single 24h SMS-only reminder into a configurable
-- multi-touch (e.g. 7-day + 24-hour) multi-channel (SMS + email) schedule,
-- with a per-touch dedup ledger so the hourly cron can run with overlapping
-- windows and never double-send.
--
-- Two new tables:
--   reminder_settings — per-org config (offsets + channels), defaults baked
--                       in so an org with no row behaves sensibly.
--   reminder_log      — one row per (reservation, offset, channel) TOUCH.
--                       The UNIQUE index is the at-most-once lock: the cron
--                       claims a touch by inserting a 'pending' row; a unique
--                       violation means another run already claimed it. On a
--                       successful send the row flips to 'sent'; on a send
--                       failure the claim row is deleted so the next run can
--                       retry. This biases toward NEVER double-texting a
--                       customer (a missed touch is far less harmful than a
--                       duplicate) while still retrying genuine failures.

-- ── reminder_settings ────────────────────────────────────────────────────
create table if not exists public.reminder_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  -- Hours-before-start at which to send a touch. Default = 7 days + 24 hours.
  -- Short-lead touches (e.g. 2) are supported but intentionally NOT in the
  -- default set: the hourly cron can fire them, but a 2h-before reminder for
  -- an early-morning booking risks an odd-hour send until per-location
  -- quiet-hours / timezone handling lands. Orgs can opt in explicitly.
  offsets_hours integer[] not null default '{168,24}',
  -- Channels to attempt, intersected per-owner with communication_preference.
  channels text[] not null default '{sms,email}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reminder_settings enable row level security;

drop policy if exists reminder_settings_staff_all on public.reminder_settings;
create policy reminder_settings_staff_all on public.reminder_settings
  for all
  using (public.is_org_staff(organization_id))
  with check (public.is_org_staff(organization_id));

-- ── reminder_log ──────────────────────────────────────────────────────────
create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  owner_id uuid,
  offset_hours integer not null,
  channel text not null check (channel in ('sms', 'email', 'push')),
  status text not null default 'pending' check (status in ('pending', 'sent')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- The at-most-once lock: exactly one touch row per (reservation, offset,
-- channel). Insert = claim; unique violation = already claimed by another run.
create unique index if not exists reminder_log_touch_uniq
  on public.reminder_log (reservation_id, offset_hours, channel);

-- Tenant-scoped history lookups (a future "reminders sent" UI).
create index if not exists reminder_log_org_idx
  on public.reminder_log (organization_id, created_at desc);

alter table public.reminder_log enable row level security;

-- Staff can read their org's reminder history. Writes are service-role only
-- (the cron), which bypasses RLS — so no insert/update policy is granted.
drop policy if exists reminder_log_staff_select on public.reminder_log;
create policy reminder_log_staff_select on public.reminder_log
  for select
  using (public.is_org_staff(organization_id));

-- ── Cron: switch the existing daily reminder to hourly ─────────────────────
-- The reminder function now handles multiple offsets per run and dedups via
-- reminder_log, so hourly firing (with an overlapping look-ahead window) gives
-- accurate multi-touch coverage without gaps. The invoke wrapper
-- (invoke_send_reservation_reminders, unchanged) still posts an empty body;
-- the function reads per-org settings.
do $$
begin
  perform cron.unschedule('reservation-reminders-daily');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('reservation-reminders-hourly');
exception when others then
  null;
end $$;

select cron.schedule(
  'reservation-reminders-hourly',
  '0 * * * *',
  'select public.invoke_send_reservation_reminders();'
);
