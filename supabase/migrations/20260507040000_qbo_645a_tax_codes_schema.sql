-- 6.4.5a: QBO tax codes and tax rates cached locally per org.
-- QBO is the source of truth for rates; Snout caches them so the
-- service-attribution UI has fast, offline-capable lookups and so the
-- invoice sync worker can compute per-line tax without round-tripping.

create table if not exists public.qbo_tax_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  qbo_id text not null,
  name text not null,
  description text,
  taxable boolean not null default true,
  active boolean not null default true,
  -- "Sales" or "Purchase". Snout only uses Sales for invoice sync but we
  -- import both for completeness so future bill-side flows can use them.
  tax_group text not null default 'sales' check (tax_group in ('sales','purchase')),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, qbo_id)
);

create index if not exists idx_qbo_tax_codes_org_active
  on public.qbo_tax_codes (organization_id, active)
  where active = true;

create table if not exists public.qbo_tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  qbo_id text not null,
  name text not null,
  -- Stored as basis points (1% = 100 bp) to avoid float drift.
  rate_basis_points integer not null,
  agency_name text,
  active boolean not null default true,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, qbo_id)
);

create index if not exists idx_qbo_tax_rates_org
  on public.qbo_tax_rates (organization_id);

-- Junction: a TaxCode can reference one or more TaxRates (e.g. Quebec's
-- "GST/QST" code references both 5% GST and 9.975% QST rates).
create table if not exists public.qbo_tax_code_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tax_code_id uuid not null references public.qbo_tax_codes(id) on delete cascade,
  tax_rate_id uuid not null references public.qbo_tax_rates(id) on delete cascade,
  rate_type text,
  applicable_on text,
  created_at timestamptz not null default now(),
  unique (tax_code_id, tax_rate_id)
);

create index if not exists idx_qbo_tax_code_rates_code
  on public.qbo_tax_code_rates (tax_code_id);

alter table public.qbo_tax_codes enable row level security;
alter table public.qbo_tax_rates enable row level security;
alter table public.qbo_tax_code_rates enable row level security;

create policy qbo_tax_codes_select_member on public.qbo_tax_codes
  for select using (public.is_org_member(organization_id));

create policy qbo_tax_rates_select_member on public.qbo_tax_rates
  for select using (public.is_org_member(organization_id));

create policy qbo_tax_code_rates_select_member on public.qbo_tax_code_rates
  for select using (public.is_org_member(organization_id));

create or replace function public.tg_qbo_tax_set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create trigger trg_qbo_tax_codes_updated_at
  before update on public.qbo_tax_codes
  for each row execute function public.tg_qbo_tax_set_updated_at();

create trigger trg_qbo_tax_rates_updated_at
  before update on public.qbo_tax_rates
  for each row execute function public.tg_qbo_tax_set_updated_at();

create or replace function public.qbo_tax_codes_for_org(_org uuid)
returns table (
  id uuid,
  qbo_id text,
  name text,
  description text,
  taxable boolean,
  combined_rate_basis_points integer,
  rate_summary text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    c.id,
    c.qbo_id,
    c.name,
    c.description,
    c.taxable,
    coalesce(sum(r.rate_basis_points)::int, 0) as combined_rate_basis_points,
    string_agg(r.name || ' ' || (r.rate_basis_points::numeric / 100)::text || '%', ' + ' order by r.name) as rate_summary
  from public.qbo_tax_codes c
  left join public.qbo_tax_code_rates cr on cr.tax_code_id = c.id
  left join public.qbo_tax_rates r on r.id = cr.tax_rate_id and r.active = true
  where c.organization_id = _org
    and c.active = true
    and c.tax_group = 'sales'
    and public.is_org_member(_org)
  group by c.id
  order by c.name;
$fn$;

revoke all on function public.qbo_tax_codes_for_org(uuid) from public;
grant execute on function public.qbo_tax_codes_for_org(uuid) to authenticated;
