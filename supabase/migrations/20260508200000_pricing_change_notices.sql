-- Reliability Batch F: Snout-side pricing change notification scaffolding.
--
-- When Snout adjusts its own SaaS pricing, the brief expects 30 days of
-- in-product notice with a visible banner so operators aren't blindsided
-- on their next bill. This batch builds the schema + acknowledgment
-- mechanism. Snout admins create rows in `pricing_change_notices` via
-- direct SQL (or a future Snout-side admin app); the staff portal reads
-- the unacknowledged set on every session and shows a banner.
--
-- Cross-tenant by design: pricing changes apply to all paying orgs, so
-- the notices table has no `organization_id`. Acknowledgments are
-- per-profile.

create table if not exists public.pricing_change_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,                              -- "New pricing effective June 1"
  body_md text not null,                            -- markdown — banner renders the first paragraph + a link to the full text
  effective_at timestamptz not null,
  link_url text,                                    -- optional "read more" link
  severity text not null default 'info',            -- 'info' | 'warning' (warning gets a brighter color)
  created_at timestamptz not null default now(),
  created_by uuid,                                  -- Snout admin profile id (for audit)
  deleted_at timestamptz,
  check (severity in ('info', 'warning'))
);

create index if not exists idx_pricing_change_notices_active
  on public.pricing_change_notices (effective_at)
  where deleted_at is null;

-- Per-staff acknowledgment so a notice that's been dismissed doesn't
-- keep showing up. (notice_id, profile_id) is unique so re-clicking
-- "got it" is a no-op.
create table if not exists public.pricing_change_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.pricing_change_notices(id) on delete cascade,
  profile_id uuid not null,
  acknowledged_at timestamptz not null default now(),
  unique (notice_id, profile_id)
);

create index if not exists idx_pricing_change_ack_profile
  on public.pricing_change_acknowledgments (profile_id);

-- RLS: every authenticated user reads notices; only authenticated users
-- write their own acknowledgments. Snout admins write notices via
-- service-role.

alter table public.pricing_change_notices enable row level security;
alter table public.pricing_change_acknowledgments enable row level security;

drop policy if exists pricing_change_notices_select on public.pricing_change_notices;
create policy pricing_change_notices_select on public.pricing_change_notices
  for select
  to authenticated
  using (deleted_at is null);

drop policy if exists pricing_change_ack_select on public.pricing_change_acknowledgments;
create policy pricing_change_ack_select on public.pricing_change_acknowledgments
  for select
  to authenticated
  using (profile_id = auth.uid());

drop policy if exists pricing_change_ack_insert on public.pricing_change_acknowledgments;
create policy pricing_change_ack_insert on public.pricing_change_acknowledgments
  for insert
  to authenticated
  with check (profile_id = auth.uid());

-- Convenience RPC the banner component calls when the user clicks "Got it".
-- SECURITY INVOKER (default) — relies on the insert policy above. Idempotent
-- via the unique constraint and ON CONFLICT.
create or replace function public.acknowledge_pricing_change_notice(_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _user uuid := auth.uid();
begin
  if _user is null then
    raise exception 'acknowledge_pricing_change_notice: not authenticated' using errcode = '28000';
  end if;
  insert into public.pricing_change_acknowledgments (notice_id, profile_id)
       values (_notice_id, _user)
  on conflict (notice_id, profile_id) do nothing;
end;
$fn$;

revoke all on function public.acknowledge_pricing_change_notice(uuid) from public;
grant execute on function public.acknowledge_pricing_change_notice(uuid) to authenticated;
