-- Reliability Batch C: per-location columns on the operator-configured
-- pricing, promo, retail, and subscription tables, so a multi-location
-- operator can run different pricing and packages at different
-- facilities without a forked org.
--
-- All columns are nullable. NULL means "applies to all locations" so
-- single-location orgs and existing rows behave identically (no
-- backfill required). Multi-location orgs set the column when they
-- want a row to be location-specific.
--
-- Coverage:
--   - pricing_rules         — location-specific prices/discounts
--   - promotions            — promo codes that only work at one site
--   - owner_subscriptions   — capture which location sold the package
--   - subscription_packages — packages an operator only wants to offer
--                             at one location
--   - message_templates     — per-event templates per location (the
--                             schema already has service_module; this
--                             gives the operator a second axis)
--   - retail_products       — location-specific inventory and pricing
--
-- Each column is `references locations(id) on delete set null` so a
-- deleted location's rows automatically fall back to org-wide.

alter table public.pricing_rules
  add column if not exists location_id uuid
    references public.locations(id) on delete set null;
create index if not exists idx_pricing_rules_location
  on public.pricing_rules (organization_id, location_id)
  where location_id is not null;

alter table public.promotions
  add column if not exists location_id uuid
    references public.locations(id) on delete set null;
create index if not exists idx_promotions_location
  on public.promotions (organization_id, location_id)
  where location_id is not null;

alter table public.owner_subscriptions
  add column if not exists location_id uuid
    references public.locations(id) on delete set null;
create index if not exists idx_owner_subscriptions_location
  on public.owner_subscriptions (organization_id, location_id)
  where location_id is not null;

alter table public.subscription_packages
  add column if not exists location_id uuid
    references public.locations(id) on delete set null;
create index if not exists idx_subscription_packages_location
  on public.subscription_packages (organization_id, location_id)
  where location_id is not null;

alter table public.message_templates
  add column if not exists location_id uuid
    references public.locations(id) on delete set null;
create index if not exists idx_message_templates_location
  on public.message_templates (organization_id, location_id)
  where location_id is not null;

alter table public.retail_products
  add column if not exists location_id uuid
    references public.locations(id) on delete set null;
create index if not exists idx_retail_products_location
  on public.retail_products (organization_id, location_id)
  where location_id is not null;
