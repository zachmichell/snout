-- 6.6a: Processor payouts.
--
-- Stripe (and Helcim) deposit net amounts to the operator's bank
-- account: gross from cards minus fees. Snout's payments table holds
-- the gross; the fees only show up in the processor's payout API.
-- This cluster ingests payouts and creates QBO Bank Deposit entities
-- with a summary fee line so the operator's QBO bank account
-- reconciles to the actual bank statement deposit.
--
-- Tables:
--   processor_payouts: one row per processor payout / batch.
--     processor          'stripe' | 'helcim'
--     processor_payout_id processor's id (used for dedup)
--     gross_cents        sum of charges in the batch
--     fee_cents          processor fees withheld
--     net_cents          actual amount deposited to the bank
--     payout_date        when the bank received it
--     currency           CAD / USD
--     description        optional human-readable note
--   payment_payouts: junction. Each Snout payment that contributed
--     to the payout. Lets us reconcile per-payment against per-payout.
--
-- Per operator decisions:
--   - Bank Deposit lines: one summary fee line per payout (granularity = b)
--   - Stripe first; Helcim parity ports later
--   - Fee account: operator picks at QBO connect; persisted on
--     quickbooks_accounts.default_fee_account_id (added below)

create table if not exists public.processor_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processor text not null check (processor in ('stripe', 'helcim')),
  processor_payout_id text not null,
  gross_cents integer not null,
  fee_cents integer not null,
  net_cents integer not null,
  payout_date date not null,
  currency text not null check (currency in ('CAD', 'USD')),
  description text,
  -- Lifecycle: pending -> ready -> synced (in QBO) -> failed
  state text not null default 'ready' check (state in ('pending', 'ready', 'synced', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, processor, processor_payout_id)
);

create index if not exists idx_processor_payouts_org_state
  on public.processor_payouts (organization_id, state)
  where state in ('pending', 'ready');

create index if not exists idx_processor_payouts_payout_date
  on public.processor_payouts (organization_id, payout_date);

create table if not exists public.payment_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  payout_id uuid not null references public.processor_payouts(id) on delete cascade,
  fee_cents integer not null default 0,
  created_at timestamptz not null default now(),
  unique (payment_id, payout_id)
);

create index if not exists idx_payment_payouts_payout
  on public.payment_payouts (payout_id);
create index if not exists idx_payment_payouts_payment
  on public.payment_payouts (payment_id);

-- RLS: org members read; only edge functions (service role) write.
alter table public.processor_payouts enable row level security;
alter table public.payment_payouts enable row level security;

create policy processor_payouts_select_member on public.processor_payouts
  for select using (public.is_org_member(organization_id));

create policy payment_payouts_select_member on public.payment_payouts
  for select using (public.is_org_member(organization_id));

-- updated_at trigger
create or replace function public.tg_processor_payouts_set_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at = now(); return new; end;
$fn$;

create trigger trg_processor_payouts_updated_at
  before update on public.processor_payouts
  for each row execute function public.tg_processor_payouts_set_updated_at();

-- Persist the operator's chosen fee account.
alter table public.quickbooks_accounts
  add column if not exists default_fee_account_id text,
  add column if not exists default_fee_account_name text;

comment on table public.processor_payouts is
  '6.6a: Processor payout batches. Each row maps to one QBO Bank Deposit.';
comment on table public.payment_payouts is
  '6.6a: Junction linking Snout payments to the payout batch they were settled in. Per-payment fees stored here for audit.';
comment on column public.quickbooks_accounts.default_fee_account_id is
  '6.6a: QBO Expense account where merchant processing fees post. Operator picks at connect.';
