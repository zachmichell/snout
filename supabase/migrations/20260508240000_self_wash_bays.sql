-- Self-wash workflow.
--
-- Self-wash bays are a physical resource (a wash station with a
-- tub/sink and grooming tools) that customers rent for a chunk of
-- time and use to wash their own dog. They sit alongside daycare,
-- boarding, grooming, and training as a first-class service module.
--
-- Modeled after kennel_runs / playgroups: a per-org table of bays
-- with name + status + location + an active flag. Reservations carry
-- a self_wash_bay_id so the operator can assign a specific bay when
-- creating or checking-in a self-wash booking. Capacity is always 1
-- (one customer per bay at a time), so a BEFORE INSERT/UPDATE trigger
-- on reservations rejects overlapping bookings on the same bay.

-- 1. module_enum gains 'self_wash'.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'module_enum' and e.enumlabel = 'self_wash'
  ) then
    alter type public.module_enum add value 'self_wash' after 'training';
  end if;
end $$;

-- 2. self_wash_bays table — operator-managed list of physical bays.
create table if not exists public.self_wash_bays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,                              -- "Bay 1", "Front Bay", etc.
  description text,
  status text not null default 'active',           -- 'active' | 'maintenance'
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (status in ('active', 'maintenance'))
);

create index if not exists idx_self_wash_bays_org
  on public.self_wash_bays (organization_id)
  where deleted_at is null;

create index if not exists idx_self_wash_bays_location
  on public.self_wash_bays (organization_id, location_id)
  where deleted_at is null and location_id is not null;

-- 3. self_wash_bay_id on reservations — null for non-self-wash
--    reservations and for unassigned ones (the operator can assign a
--    bay at booking or at check-in). FK ON DELETE SET NULL so deleting
--    a bay doesn't orphan reservations.
alter table public.reservations
  add column if not exists self_wash_bay_id uuid
    references public.self_wash_bays(id) on delete set null;

create index if not exists idx_reservations_self_wash_bay
  on public.reservations (self_wash_bay_id)
  where self_wash_bay_id is not null;

-- 4. Capacity guard. A bay holds one customer at a time so two
--    overlapping reservations on the same bay is always wrong. Same
--    pattern as enforce_suite_capacity (with capacity hard-coded to 1).
create or replace function public.enforce_self_wash_bay_capacity()
returns trigger
language plpgsql
as $fn$
declare
  _overlap_count int;
  _bay_name text;
begin
  if new.self_wash_bay_id is null
     or new.deleted_at is not null
     or new.status in ('cancelled','no_show') then
    return new;
  end if;
  if new.start_at is null or new.end_at is null then
    return new;
  end if;

  select name into _bay_name from public.self_wash_bays where id = new.self_wash_bay_id;
  if _bay_name is null then return new; end if;

  select count(*) into _overlap_count
  from public.reservations r
  where r.self_wash_bay_id = new.self_wash_bay_id
    and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and r.deleted_at is null
    and r.status not in ('cancelled','no_show')
    and tstzrange(r.start_at, r.end_at, '[)') &&
        tstzrange(new.start_at, new.end_at, '[)');

  if _overlap_count >= 1 then
    raise exception
      'Self-wash bay % is already booked for the requested time. Pick a different bay or change the time.',
      _bay_name
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_self_wash_bay_capacity on public.reservations;
create trigger trg_self_wash_bay_capacity
  before insert or update of self_wash_bay_id, start_at, end_at, status, deleted_at
  on public.reservations
  for each row
  execute function public.enforce_self_wash_bay_capacity();

-- 5. RLS. Self-wash bays follow the same is_org_member pattern as
--    other org-scoped configuration tables.
alter table public.self_wash_bays enable row level security;

drop policy if exists self_wash_bays_select on public.self_wash_bays;
create policy self_wash_bays_select on public.self_wash_bays
  for select
  using (public.is_org_member(organization_id));

drop policy if exists self_wash_bays_insert on public.self_wash_bays;
create policy self_wash_bays_insert on public.self_wash_bays
  for insert
  with check (public.is_org_member(organization_id));

drop policy if exists self_wash_bays_update on public.self_wash_bays;
create policy self_wash_bays_update on public.self_wash_bays
  for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- updated_at maintenance
create or replace function public.touch_self_wash_bays_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_touch_self_wash_bays on public.self_wash_bays;
create trigger trg_touch_self_wash_bays
  before update on public.self_wash_bays
  for each row execute function public.touch_self_wash_bays_updated_at();
