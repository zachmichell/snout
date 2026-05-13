-- Map (organization, owner) → Stripe Customer ID on that org's connected
-- Stripe account. Required to attach saved payment methods to a customer
-- so they can be reused for future charges (e.g. Buy Credits, pay invoice
-- with one tap).
--
-- One Stripe Customer per (org, owner) pair because Stripe Customers are
-- scoped to a specific Stripe account (the org's Connect account) and a
-- single pet parent could be a customer of multiple facilities.
--
-- Idempotent — `CREATE TABLE IF NOT EXISTS` + guarded RLS policy adds.

create table if not exists public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, owner_id)
);

-- Look up by stripe_customer_id from webhook handlers (e.g. when a
-- setup_intent.succeeded event arrives, we resolve back to (org, owner)).
create index if not exists stripe_customers_stripe_id_idx
  on public.stripe_customers (stripe_customer_id);

-- Tenant-scoped index for the (org, owner) lookup path.
create index if not exists stripe_customers_org_owner_idx
  on public.stripe_customers (organization_id, owner_id);

alter table public.stripe_customers enable row level security;

-- Owners can read their own row (drives the iOS Payment Methods screen).
drop policy if exists stripe_customers_owner_select on public.stripe_customers;
create policy stripe_customers_owner_select on public.stripe_customers
  for select
  using (
    exists (
      select 1 from public.owners o
      where o.id = stripe_customers.owner_id
        and o.profile_id = auth.uid()
    )
  );

-- Staff (any org member) can read for invoicing flows.
drop policy if exists stripe_customers_staff_select on public.stripe_customers;
create policy stripe_customers_staff_select on public.stripe_customers
  for select
  using (public.is_org_member(organization_id));

-- All writes happen through SECURITY DEFINER edge functions (service role),
-- which bypass RLS. No INSERT/UPDATE/DELETE policies needed for client
-- traffic.

create trigger set_stripe_customers_updated_at
  before update on public.stripe_customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Unique constraint on payment_methods.stripe_payment_method_id so the
-- webhook handler's `ON CONFLICT (stripe_payment_method_id)` clause can
-- idempotently upsert when Stripe retries setup_intent.succeeded.
-- ---------------------------------------------------------------------
create unique index if not exists payment_methods_stripe_pm_id_uniq
  on public.payment_methods (stripe_payment_method_id)
  where stripe_payment_method_id is not null;
