-- Baseline schema migration. Captures the 18 tables, three custom enums,
-- the credit-cache columns on `owners`, and the credit-system RPCs +
-- trigger that exist on the live Supabase DB but were never landed as
-- migrations (originally applied via Supabase MCP / dashboard).
--
-- Fully idempotent — uses CREATE TYPE / TABLE / INDEX / POLICY with
-- IF NOT EXISTS guards (or DROP-then-CREATE for policies), so this
-- runs cleanly against:
--   * the live DB (no-op; the schema already matches)
--   * a fresh `supabase start` for CI integration tests (creates
--     everything the tests depend on)
--   * any new local dev DB
--
-- Ordering note: this file is timestamped 20260423234000 so it runs
-- AFTER the foundational migrations it depends on:
--   * 20260417160136 — creates module_enum, organizations, owners,
--     profiles, locations
--   * 20260423133631 — creates groomers
--   * 20260423233421 — creates staff_codes
-- and BEFORE the migrations that reference baseline objects:
--   * 20260507040400 — uses quickbooks_accounts
--   * 20260507080000 — uses credit_ledger
--
-- An earlier draft was committed as 20260417160100 but that placement
-- runs the baseline before module_enum exists, which breaks fresh CI
-- databases. The live DB has 20260417160100 recorded as applied in
-- supabase_migrations.schema_migrations; this file under its new
-- timestamp re-applies as a no-op (every statement is guarded).

-- =====================================================================
-- 0. Custom enum types
--    Must come before the tables that reference them as column types
--    (credit_ledger.kind, webcams.source_kind, helcim_accounts.processor).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'credit_ledger_kind' and typnamespace = 'public'::regnamespace) then
    create type public.credit_ledger_kind as enum ('opening_balance', 'purchase', 'consumption', 'refund', 'expiration', 'manual_adjustment');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_processor_kind' and typnamespace = 'public'::regnamespace) then
    create type public.payment_processor_kind as enum ('stripe', 'helcim');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'webcam_source_kind' and typnamespace = 'public'::regnamespace) then
    create type public.webcam_source_kind as enum ('hls', 'mp4', 'iframe');
  end if;
end $$;

-- =====================================================================
-- changelog_entries
-- =====================================================================
create table if not exists public.changelog_entries (
  id uuid not null default gen_random_uuid(),
  organization_id uuid,
  title text not null,
  body_md text not null,
  affects_modules module_enum[],
  severity text not null default 'info'::text,
  published_at timestamp with time zone,
  author_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'changelog_entries_pkey' and conrelid = 'public.changelog_entries'::regclass) then
    alter table public.changelog_entries add constraint changelog_entries_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'changelog_entries_author_id_fkey' and conrelid = 'public.changelog_entries'::regclass) then
    alter table public.changelog_entries add constraint changelog_entries_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE SET NULL;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'changelog_entries_organization_id_fkey' and conrelid = 'public.changelog_entries'::regclass) then
    alter table public.changelog_entries add constraint changelog_entries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'changelog_entries_severity_check' and conrelid = 'public.changelog_entries'::regclass) then
    alter table public.changelog_entries add constraint changelog_entries_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'update'::text, 'warning'::text, 'critical'::text])));
  end if;
end $$;

CREATE INDEX IF NOT EXISTS changelog_entries_feed_idx ON public.changelog_entries USING btree (organization_id, published_at DESC) WHERE ((deleted_at IS NULL) AND (published_at IS NOT NULL));

alter table public.changelog_entries enable row level security;

drop policy if exists changelog_entries_insert_admin on public.changelog_entries;
create policy changelog_entries_insert_admin on public.changelog_entries
  for insert to public
  with check (((organization_id IS NOT NULL) AND is_org_admin(organization_id)));

drop policy if exists changelog_entries_select_drafts_admin on public.changelog_entries;
create policy changelog_entries_select_drafts_admin on public.changelog_entries
  for select to public
  using (((deleted_at IS NULL) AND (organization_id IS NOT NULL) AND is_org_admin(organization_id)));

drop policy if exists changelog_entries_select_published on public.changelog_entries;
create policy changelog_entries_select_published on public.changelog_entries
  for select to public
  using (((deleted_at IS NULL) AND (published_at IS NOT NULL) AND ((organization_id IS NULL) OR is_org_member(organization_id))));

drop policy if exists changelog_entries_update_admin on public.changelog_entries;
create policy changelog_entries_update_admin on public.changelog_entries
  for update to public
  using (((organization_id IS NOT NULL) AND is_org_admin(organization_id)))
  with check (((organization_id IS NOT NULL) AND is_org_admin(organization_id)));

-- =====================================================================
-- changelog_reads
-- =====================================================================
create table if not exists public.changelog_reads (
  profile_id uuid not null,
  entry_id uuid not null,
  read_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'changelog_reads_pkey' and conrelid = 'public.changelog_reads'::regclass) then
    alter table public.changelog_reads add constraint changelog_reads_pkey PRIMARY KEY (profile_id, entry_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'changelog_reads_entry_id_fkey' and conrelid = 'public.changelog_reads'::regclass) then
    alter table public.changelog_reads add constraint changelog_reads_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES changelog_entries(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'changelog_reads_profile_id_fkey' and conrelid = 'public.changelog_reads'::regclass) then
    alter table public.changelog_reads add constraint changelog_reads_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  end if;
end $$;

CREATE INDEX IF NOT EXISTS changelog_reads_entry_idx ON public.changelog_reads USING btree (entry_id);

alter table public.changelog_reads enable row level security;

drop policy if exists changelog_reads_self on public.changelog_reads;
create policy changelog_reads_self on public.changelog_reads
  for all to public
  using ((profile_id = ( SELECT auth.uid() AS uid)))
  with check ((profile_id = ( SELECT auth.uid() AS uid)));

-- =====================================================================
-- checklist_templates
-- =====================================================================
create table if not exists public.checklist_templates (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  items jsonb not null default '[]'::jsonb,
  department text,
  active boolean not null default true,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'checklist_templates_pkey' and conrelid = 'public.checklist_templates'::regclass) then
    alter table public.checklist_templates add constraint checklist_templates_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_templates_organization_id_fkey' and conrelid = 'public.checklist_templates'::regclass) then
    alter table public.checklist_templates add constraint checklist_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
end $$;

alter table public.checklist_templates enable row level security;

drop policy if exists checklist_templates_delete on public.checklist_templates;
create policy checklist_templates_delete on public.checklist_templates
  for delete to public
  using (is_org_admin(organization_id));

drop policy if exists checklist_templates_insert on public.checklist_templates;
create policy checklist_templates_insert on public.checklist_templates
  for insert to public
  with check (is_org_admin(organization_id));

drop policy if exists checklist_templates_select on public.checklist_templates;
create policy checklist_templates_select on public.checklist_templates
  for select to public
  using (is_org_member(organization_id));

drop policy if exists checklist_templates_update on public.checklist_templates;
create policy checklist_templates_update on public.checklist_templates
  for update to public
  using (is_org_admin(organization_id));

-- =====================================================================
-- checklist_completions
-- =====================================================================
create table if not exists public.checklist_completions (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  template_id uuid not null,
  completion_date date not null,
  completed_items jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'checklist_completions_pkey' and conrelid = 'public.checklist_completions'::regclass) then
    alter table public.checklist_completions add constraint checklist_completions_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_completions_template_id_completion_date_key' and conrelid = 'public.checklist_completions'::regclass) then
    alter table public.checklist_completions add constraint checklist_completions_template_id_completion_date_key UNIQUE (template_id, completion_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_completions_organization_id_fkey' and conrelid = 'public.checklist_completions'::regclass) then
    alter table public.checklist_completions add constraint checklist_completions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_completions_template_id_fkey' and conrelid = 'public.checklist_completions'::regclass) then
    alter table public.checklist_completions add constraint checklist_completions_template_id_fkey FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE;
  end if;
end $$;

CREATE INDEX IF NOT EXISTS idx_checklist_completions_org_date ON public.checklist_completions USING btree (organization_id, completion_date);

alter table public.checklist_completions enable row level security;

drop policy if exists checklist_completions_delete on public.checklist_completions;
create policy checklist_completions_delete on public.checklist_completions
  for delete to public
  using (is_org_admin(organization_id));

drop policy if exists checklist_completions_insert on public.checklist_completions;
create policy checklist_completions_insert on public.checklist_completions
  for insert to public
  with check (is_org_member(organization_id));

drop policy if exists checklist_completions_select on public.checklist_completions;
create policy checklist_completions_select on public.checklist_completions
  for select to public
  using (is_org_member(organization_id));

drop policy if exists checklist_completions_update on public.checklist_completions;
create policy checklist_completions_update on public.checklist_completions
  for update to public
  using (is_org_member(organization_id));

-- =====================================================================
-- credit_ledger
-- =====================================================================
create table if not exists public.credit_ledger (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  owner_id uuid not null,
  kind credit_ledger_kind not null,
  delta_full integer not null default 0,
  delta_half integer not null default 0,
  delta_nights integer not null default 0,
  source_purchase_id uuid,
  reference_id uuid,
  reference_type text,
  expires_at timestamp with time zone,
  note text,
  actor_kind text not null default 'system'::text,
  actor_label text,
  staff_code_id uuid,
  created_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'credit_ledger_pkey' and conrelid = 'public.credit_ledger'::regclass) then
    alter table public.credit_ledger add constraint credit_ledger_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credit_ledger_organization_id_fkey' and conrelid = 'public.credit_ledger'::regclass) then
    alter table public.credit_ledger add constraint credit_ledger_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credit_ledger_owner_id_fkey' and conrelid = 'public.credit_ledger'::regclass) then
    alter table public.credit_ledger add constraint credit_ledger_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credit_ledger_source_purchase_id_fkey' and conrelid = 'public.credit_ledger'::regclass) then
    alter table public.credit_ledger add constraint credit_ledger_source_purchase_id_fkey FOREIGN KEY (source_purchase_id) REFERENCES credit_ledger(id) ON DELETE SET NULL;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credit_ledger_staff_code_id_fkey' and conrelid = 'public.credit_ledger'::regclass) then
    alter table public.credit_ledger add constraint credit_ledger_staff_code_id_fkey FOREIGN KEY (staff_code_id) REFERENCES staff_codes(id) ON DELETE SET NULL;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credit_ledger_actor_kind_check' and conrelid = 'public.credit_ledger'::regclass) then
    alter table public.credit_ledger add constraint credit_ledger_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['staff'::text, 'owner'::text, 'system'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credit_ledger_nonzero_delta' and conrelid = 'public.credit_ledger'::regclass) then
    alter table public.credit_ledger add constraint credit_ledger_nonzero_delta CHECK (((delta_full <> 0) OR (delta_half <> 0) OR (delta_nights <> 0)));
  end if;
end $$;

CREATE INDEX IF NOT EXISTS credit_ledger_owner_idx ON public.credit_ledger USING btree (owner_id);
CREATE INDEX IF NOT EXISTS credit_ledger_org_idx ON public.credit_ledger USING btree (organization_id);
CREATE INDEX IF NOT EXISTS credit_ledger_expires_at_idx ON public.credit_ledger USING btree (expires_at) WHERE ((kind = 'purchase'::credit_ledger_kind) AND (expires_at IS NOT NULL));
CREATE INDEX IF NOT EXISTS credit_ledger_source_purchase_idx ON public.credit_ledger USING btree (source_purchase_id) WHERE (source_purchase_id IS NOT NULL);

alter table public.credit_ledger enable row level security;

drop policy if exists "Tenant isolation delete" on public.credit_ledger;
create policy "Tenant isolation delete" on public.credit_ledger
  for delete to public
  using (is_org_member(organization_id));

drop policy if exists "Tenant isolation insert" on public.credit_ledger;
create policy "Tenant isolation insert" on public.credit_ledger
  for insert to public
  with check (is_org_member(organization_id));

drop policy if exists "Tenant isolation select" on public.credit_ledger;
create policy "Tenant isolation select" on public.credit_ledger
  for select to public
  using (is_org_member(organization_id));

drop policy if exists "Tenant isolation update" on public.credit_ledger;
create policy "Tenant isolation update" on public.credit_ledger
  for update to public
  using (is_org_member(organization_id));

-- =====================================================================
-- groomer_working_hours
-- =====================================================================
create table if not exists public.groomer_working_hours (
  id uuid not null default gen_random_uuid(),
  groomer_id uuid not null,
  day_of_week smallint not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'groomer_working_hours_pkey' and conrelid = 'public.groomer_working_hours'::regclass) then
    alter table public.groomer_working_hours add constraint groomer_working_hours_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groomer_working_hours_one_row_per_day' and conrelid = 'public.groomer_working_hours'::regclass) then
    alter table public.groomer_working_hours add constraint groomer_working_hours_one_row_per_day UNIQUE (groomer_id, day_of_week);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groomer_working_hours_groomer_id_fkey' and conrelid = 'public.groomer_working_hours'::regclass) then
    alter table public.groomer_working_hours add constraint groomer_working_hours_groomer_id_fkey FOREIGN KEY (groomer_id) REFERENCES groomers(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groomer_working_hours_day_of_week_check' and conrelid = 'public.groomer_working_hours'::regclass) then
    alter table public.groomer_working_hours add constraint groomer_working_hours_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groomer_working_hours_end_after_start' and conrelid = 'public.groomer_working_hours'::regclass) then
    alter table public.groomer_working_hours add constraint groomer_working_hours_end_after_start CHECK ((end_time > start_time));
  end if;
end $$;

CREATE INDEX IF NOT EXISTS idx_groomer_working_hours_lookup ON public.groomer_working_hours USING btree (groomer_id, day_of_week);

alter table public.groomer_working_hours enable row level security;

drop policy if exists groomer_working_hours_delete on public.groomer_working_hours;
create policy groomer_working_hours_delete on public.groomer_working_hours
  for delete to public
  using ((EXISTS ( SELECT 1
   FROM groomers g
  WHERE ((g.id = groomer_working_hours.groomer_id) AND is_org_admin(g.organization_id)))));

drop policy if exists groomer_working_hours_insert on public.groomer_working_hours;
create policy groomer_working_hours_insert on public.groomer_working_hours
  for insert to public
  with check ((EXISTS ( SELECT 1
   FROM groomers g
  WHERE ((g.id = groomer_working_hours.groomer_id) AND is_org_admin(g.organization_id)))));

drop policy if exists groomer_working_hours_select on public.groomer_working_hours;
create policy groomer_working_hours_select on public.groomer_working_hours
  for select to public
  using ((EXISTS ( SELECT 1
   FROM groomers g
  WHERE ((g.id = groomer_working_hours.groomer_id) AND is_org_member(g.organization_id)))));

drop policy if exists groomer_working_hours_update on public.groomer_working_hours;
create policy groomer_working_hours_update on public.groomer_working_hours
  for update to public
  using ((EXISTS ( SELECT 1
   FROM groomers g
  WHERE ((g.id = groomer_working_hours.groomer_id) AND is_org_admin(g.organization_id)))));

-- =====================================================================
-- groomer_availability
-- =====================================================================
create table if not exists public.groomer_availability (
  id uuid not null default gen_random_uuid(),
  groomer_id uuid not null,
  date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'groomer_availability_pkey' and conrelid = 'public.groomer_availability'::regclass) then
    alter table public.groomer_availability add constraint groomer_availability_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groomer_availability_one_per_date' and conrelid = 'public.groomer_availability'::regclass) then
    alter table public.groomer_availability add constraint groomer_availability_one_per_date UNIQUE (groomer_id, date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groomer_availability_groomer_id_fkey' and conrelid = 'public.groomer_availability'::regclass) then
    alter table public.groomer_availability add constraint groomer_availability_groomer_id_fkey FOREIGN KEY (groomer_id) REFERENCES groomers(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'groomer_availability_end_after_start' and conrelid = 'public.groomer_availability'::regclass) then
    alter table public.groomer_availability add constraint groomer_availability_end_after_start CHECK ((end_time > start_time));
  end if;
end $$;

CREATE INDEX IF NOT EXISTS idx_groomer_availability_lookup ON public.groomer_availability USING btree (groomer_id, date);

alter table public.groomer_availability enable row level security;

drop policy if exists groomer_availability_delete on public.groomer_availability;
create policy groomer_availability_delete on public.groomer_availability
  for delete to public
  using ((EXISTS ( SELECT 1
   FROM groomers g
  WHERE ((g.id = groomer_availability.groomer_id) AND is_org_admin(g.organization_id)))));

drop policy if exists groomer_availability_insert on public.groomer_availability;
create policy groomer_availability_insert on public.groomer_availability
  for insert to public
  with check ((EXISTS ( SELECT 1
   FROM groomers g
  WHERE ((g.id = groomer_availability.groomer_id) AND is_org_admin(g.organization_id)))));

drop policy if exists groomer_availability_select on public.groomer_availability;
create policy groomer_availability_select on public.groomer_availability
  for select to public
  using ((EXISTS ( SELECT 1
   FROM groomers g
  WHERE ((g.id = groomer_availability.groomer_id) AND is_org_member(g.organization_id)))));

drop policy if exists groomer_availability_update on public.groomer_availability;
create policy groomer_availability_update on public.groomer_availability
  for update to public
  using ((EXISTS ( SELECT 1
   FROM groomers g
  WHERE ((g.id = groomer_availability.groomer_id) AND is_org_admin(g.organization_id)))));

-- =====================================================================
-- helcim_accounts
-- =====================================================================
create table if not exists public.helcim_accounts (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  api_token_secret_id uuid not null,
  account_id text,
  business_name text,
  currency text not null default 'CAD'::text,
  charges_enabled boolean not null default false,
  status text not null default 'pending'::text,
  last_verified_at timestamp with time zone,
  last_verification_error text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  webhook_verifier_secret_id uuid
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'helcim_accounts_pkey' and conrelid = 'public.helcim_accounts'::regclass) then
    alter table public.helcim_accounts add constraint helcim_accounts_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'helcim_accounts_organization_id_fkey' and conrelid = 'public.helcim_accounts'::regclass) then
    alter table public.helcim_accounts add constraint helcim_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
end $$;

CREATE INDEX IF NOT EXISTS helcim_accounts_organization_id_idx ON public.helcim_accounts USING btree (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS helcim_accounts_one_per_org ON public.helcim_accounts USING btree (organization_id) WHERE (deleted_at IS NULL);

alter table public.helcim_accounts enable row level security;

drop policy if exists helcim_accounts_select_member on public.helcim_accounts;
create policy helcim_accounts_select_member on public.helcim_accounts
  for select to public
  using (is_org_member(organization_id));

-- =====================================================================
-- helcim_processed_events
-- =====================================================================
create table if not exists public.helcim_processed_events (
  id uuid not null default gen_random_uuid(),
  helcim_event_id text not null,
  event_type text not null,
  organization_id uuid,
  received_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'helcim_processed_events_pkey' and conrelid = 'public.helcim_processed_events'::regclass) then
    alter table public.helcim_processed_events add constraint helcim_processed_events_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'helcim_processed_events_helcim_event_id_key' and conrelid = 'public.helcim_processed_events'::regclass) then
    alter table public.helcim_processed_events add constraint helcim_processed_events_helcim_event_id_key UNIQUE (helcim_event_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'helcim_processed_events_organization_id_fkey' and conrelid = 'public.helcim_processed_events'::regclass) then
    alter table public.helcim_processed_events add constraint helcim_processed_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
  end if;
end $$;

CREATE INDEX IF NOT EXISTS helcim_processed_events_org_idx ON public.helcim_processed_events USING btree (organization_id);

alter table public.helcim_processed_events enable row level security;

drop policy if exists helcim_processed_events_select on public.helcim_processed_events;
create policy helcim_processed_events_select on public.helcim_processed_events
  for select to public
  using (((organization_id IS NULL) OR is_org_member(organization_id)));

-- =====================================================================
-- push_subscriptions
-- =====================================================================
create table if not exists public.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  profile_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_pkey' and conrelid = 'public.push_subscriptions'::regclass) then
    alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_profile_id_fkey' and conrelid = 'public.push_subscriptions'::regclass) then
    alter table public.push_subscriptions add constraint push_subscriptions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  end if;
end $$;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique ON public.push_subscriptions USING btree (endpoint) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS push_subscriptions_profile_idx ON public.push_subscriptions USING btree (profile_id) WHERE (deleted_at IS NULL);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_self on public.push_subscriptions;
create policy push_subscriptions_self on public.push_subscriptions
  for all to public
  using ((profile_id = ( SELECT auth.uid() AS uid)))
  with check ((profile_id = ( SELECT auth.uid() AS uid)));

-- =====================================================================
-- quickbooks_accounts
-- =====================================================================
create table if not exists public.quickbooks_accounts (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  realm_id text not null,
  company_name text,
  environment text not null default 'production'::text,
  access_token_secret_id uuid not null,
  refresh_token_secret_id uuid not null,
  access_token_expires_at timestamp with time zone,
  status text not null default 'pending'::text,
  last_verified_at timestamp with time zone,
  last_verification_error text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  default_income_account_id text,
  default_income_account_name text,
  default_deposit_account_id text,
  default_deposit_account_name text,
  default_fee_account_id text,
  default_fee_account_name text,
  default_bank_account_id text,
  default_bank_account_name text,
  default_tips_payable_account_id text,
  default_tips_payable_account_name text,
  default_deferred_daycare_full_account_id text,
  default_deferred_daycare_full_account_name text,
  default_deferred_daycare_half_account_id text,
  default_deferred_daycare_half_account_name text,
  default_deferred_boarding_account_id text,
  default_deferred_boarding_account_name text,
  default_expired_credits_income_account_id text,
  default_expired_credits_income_account_name text
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_accounts_pkey' and conrelid = 'public.quickbooks_accounts'::regclass) then
    alter table public.quickbooks_accounts add constraint quickbooks_accounts_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_accounts_organization_id_fkey' and conrelid = 'public.quickbooks_accounts'::regclass) then
    alter table public.quickbooks_accounts add constraint quickbooks_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_accounts_environment_check' and conrelid = 'public.quickbooks_accounts'::regclass) then
    alter table public.quickbooks_accounts add constraint quickbooks_accounts_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text])));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_accounts_status_check' and conrelid = 'public.quickbooks_accounts'::regclass) then
    alter table public.quickbooks_accounts add constraint quickbooks_accounts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'restricted'::text])));
  end if;
end $$;

CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_accounts_one_per_org ON public.quickbooks_accounts USING btree (organization_id) WHERE (deleted_at IS NULL);

alter table public.quickbooks_accounts enable row level security;

drop policy if exists quickbooks_accounts_select_member on public.quickbooks_accounts;
create policy quickbooks_accounts_select_member on public.quickbooks_accounts
  for select to public
  using (is_org_member(organization_id));

-- =====================================================================
-- quickbooks_entity_mappings
-- =====================================================================
create table if not exists public.quickbooks_entity_mappings (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  snout_table text not null,
  snout_id uuid not null,
  qbo_entity_type text not null,
  qbo_id text not null,
  sync_token text,
  sync_state text not null default 'pending'::text,
  last_synced_at timestamp with time zone,
  last_error text,
  payload_hash text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_entity_mappings_pkey' and conrelid = 'public.quickbooks_entity_mappings'::regclass) then
    alter table public.quickbooks_entity_mappings add constraint quickbooks_entity_mappings_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_entity_mappings_organization_id_fkey' and conrelid = 'public.quickbooks_entity_mappings'::regclass) then
    alter table public.quickbooks_entity_mappings add constraint quickbooks_entity_mappings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_entity_mappings_sync_state_check' and conrelid = 'public.quickbooks_entity_mappings'::regclass) then
    alter table public.quickbooks_entity_mappings add constraint quickbooks_entity_mappings_sync_state_check CHECK ((sync_state = ANY (ARRAY['pending'::text, 'synced'::text, 'failed'::text, 'orphaned'::text])));
  end if;
end $$;

CREATE UNIQUE INDEX IF NOT EXISTS qbo_mappings_one_per_qbo_entity ON public.quickbooks_entity_mappings USING btree (organization_id, qbo_entity_type, qbo_id) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS qbo_mappings_org_state_idx ON public.quickbooks_entity_mappings USING btree (organization_id, sync_state) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS qbo_mappings_one_per_snout_entity_qbo_type ON public.quickbooks_entity_mappings USING btree (organization_id, snout_table, snout_id, qbo_entity_type) WHERE (deleted_at IS NULL);

alter table public.quickbooks_entity_mappings enable row level security;

drop policy if exists qbo_mappings_select_member on public.quickbooks_entity_mappings;
create policy qbo_mappings_select_member on public.quickbooks_entity_mappings
  for select to public
  using (is_org_member(organization_id));

-- =====================================================================
-- quickbooks_oauth_pending
-- =====================================================================
create table if not exists public.quickbooks_oauth_pending (
  state text not null,
  organization_id uuid not null,
  initiated_by uuid,
  return_to text,
  expires_at timestamp with time zone not null default (now() + '00:15:00'::interval),
  created_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_oauth_pending_pkey' and conrelid = 'public.quickbooks_oauth_pending'::regclass) then
    alter table public.quickbooks_oauth_pending add constraint quickbooks_oauth_pending_pkey PRIMARY KEY (state);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_oauth_pending_initiated_by_fkey' and conrelid = 'public.quickbooks_oauth_pending'::regclass) then
    alter table public.quickbooks_oauth_pending add constraint quickbooks_oauth_pending_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES profiles(id) ON DELETE SET NULL;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_oauth_pending_organization_id_fkey' and conrelid = 'public.quickbooks_oauth_pending'::regclass) then
    alter table public.quickbooks_oauth_pending add constraint quickbooks_oauth_pending_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
end $$;

CREATE INDEX IF NOT EXISTS quickbooks_oauth_pending_org_idx ON public.quickbooks_oauth_pending USING btree (organization_id);

alter table public.quickbooks_oauth_pending enable row level security;

-- =====================================================================
-- quickbooks_sync_queue
-- =====================================================================
create table if not exists public.quickbooks_sync_queue (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  snout_table text not null,
  snout_id uuid not null,
  op text not null default 'upsert'::text,
  enqueued_at timestamp with time zone not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamp with time zone not null default now(),
  last_error text,
  processed_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_sync_queue_pkey' and conrelid = 'public.quickbooks_sync_queue'::regclass) then
    alter table public.quickbooks_sync_queue add constraint quickbooks_sync_queue_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_sync_queue_organization_id_fkey' and conrelid = 'public.quickbooks_sync_queue'::regclass) then
    alter table public.quickbooks_sync_queue add constraint quickbooks_sync_queue_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quickbooks_sync_queue_op_check' and conrelid = 'public.quickbooks_sync_queue'::regclass) then
    alter table public.quickbooks_sync_queue add constraint quickbooks_sync_queue_op_check CHECK ((op = ANY (ARRAY['upsert'::text, 'delete'::text])));
  end if;
end $$;

CREATE INDEX IF NOT EXISTS qbo_sync_queue_pickup_idx ON public.quickbooks_sync_queue USING btree (next_attempt_at, enqueued_at) WHERE (processed_at IS NULL);
CREATE INDEX IF NOT EXISTS qbo_sync_queue_entity_idx ON public.quickbooks_sync_queue USING btree (organization_id, snout_table, snout_id) WHERE (processed_at IS NULL);

alter table public.quickbooks_sync_queue enable row level security;

drop policy if exists qbo_sync_queue_select_member on public.quickbooks_sync_queue;
create policy qbo_sync_queue_select_member on public.quickbooks_sync_queue
  for select to public
  using (is_org_member(organization_id));

-- =====================================================================
-- shift_templates
-- =====================================================================
create table if not exists public.shift_templates (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  color text not null default '#CBA48F'::text,
  department text,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shift_templates_pkey' and conrelid = 'public.shift_templates'::regclass) then
    alter table public.shift_templates add constraint shift_templates_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shift_templates_organization_id_fkey' and conrelid = 'public.shift_templates'::regclass) then
    alter table public.shift_templates add constraint shift_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
end $$;

alter table public.shift_templates enable row level security;

drop policy if exists shift_templates_delete on public.shift_templates;
create policy shift_templates_delete on public.shift_templates
  for delete to public
  using (is_org_admin(organization_id));

drop policy if exists shift_templates_insert on public.shift_templates;
create policy shift_templates_insert on public.shift_templates
  for insert to public
  with check (is_org_member(organization_id));

drop policy if exists shift_templates_select on public.shift_templates;
create policy shift_templates_select on public.shift_templates
  for select to public
  using (is_org_member(organization_id));

drop policy if exists shift_templates_update on public.shift_templates;
create policy shift_templates_update on public.shift_templates
  for update to public
  using (is_org_member(organization_id));

-- =====================================================================
-- staff_shifts
-- =====================================================================
create table if not exists public.staff_shifts (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  shift_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  department text,
  shift_template_id uuid,
  notes text,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_shifts_pkey' and conrelid = 'public.staff_shifts'::regclass) then
    alter table public.staff_shifts add constraint staff_shifts_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_shifts_organization_id_fkey' and conrelid = 'public.staff_shifts'::regclass) then
    alter table public.staff_shifts add constraint staff_shifts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_shifts_shift_template_id_fkey' and conrelid = 'public.staff_shifts'::regclass) then
    alter table public.staff_shifts add constraint staff_shifts_shift_template_id_fkey FOREIGN KEY (shift_template_id) REFERENCES shift_templates(id) ON DELETE SET NULL;
  end if;
end $$;

CREATE INDEX IF NOT EXISTS idx_staff_shifts_org_date ON public.staff_shifts USING btree (organization_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_user_date ON public.staff_shifts USING btree (user_id, shift_date);

alter table public.staff_shifts enable row level security;

drop policy if exists staff_shifts_delete on public.staff_shifts;
create policy staff_shifts_delete on public.staff_shifts
  for delete to public
  using (is_org_admin(organization_id));

drop policy if exists staff_shifts_insert on public.staff_shifts;
create policy staff_shifts_insert on public.staff_shifts
  for insert to public
  with check (is_org_admin(organization_id));

drop policy if exists staff_shifts_select on public.staff_shifts;
create policy staff_shifts_select on public.staff_shifts
  for select to public
  using (is_org_member(organization_id));

drop policy if exists staff_shifts_update on public.staff_shifts;
create policy staff_shifts_update on public.staff_shifts
  for update to public
  using (is_org_admin(organization_id));

-- =====================================================================
-- surcharge_settings
-- =====================================================================
create table if not exists public.surcharge_settings (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  enabled boolean not null default false,
  rate_basis_points integer not null default 0,
  applies_to_credit_only boolean not null default true,
  customer_notice_text text,
  registered_with_card_networks boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'surcharge_settings_pkey' and conrelid = 'public.surcharge_settings'::regclass) then
    alter table public.surcharge_settings add constraint surcharge_settings_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'surcharge_settings_organization_id_fkey' and conrelid = 'public.surcharge_settings'::regclass) then
    alter table public.surcharge_settings add constraint surcharge_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'surcharge_settings_rate_basis_points_check' and conrelid = 'public.surcharge_settings'::regclass) then
    alter table public.surcharge_settings add constraint surcharge_settings_rate_basis_points_check CHECK (((rate_basis_points >= 0) AND (rate_basis_points <= 240)));
  end if;
end $$;

CREATE UNIQUE INDEX IF NOT EXISTS surcharge_settings_one_per_org ON public.surcharge_settings USING btree (organization_id) WHERE (deleted_at IS NULL);

alter table public.surcharge_settings enable row level security;

drop policy if exists "Tenant isolation delete" on public.surcharge_settings;
create policy "Tenant isolation delete" on public.surcharge_settings
  for delete to public
  using (is_org_member(organization_id));

drop policy if exists "Tenant isolation insert" on public.surcharge_settings;
create policy "Tenant isolation insert" on public.surcharge_settings
  for insert to public
  with check (is_org_member(organization_id));

drop policy if exists "Tenant isolation select" on public.surcharge_settings;
create policy "Tenant isolation select" on public.surcharge_settings
  for select to public
  using (is_org_member(organization_id));

drop policy if exists "Tenant isolation update" on public.surcharge_settings;
create policy "Tenant isolation update" on public.surcharge_settings
  for update to public
  using (is_org_member(organization_id));

-- =====================================================================
-- webcams
-- =====================================================================
create table if not exists public.webcams (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid,
  name text not null,
  provider text,
  source_kind webcam_source_kind not null default 'iframe'::webcam_source_kind,
  source_url text not null,
  description text,
  enabled boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'webcams_pkey' and conrelid = 'public.webcams'::regclass) then
    alter table public.webcams add constraint webcams_pkey PRIMARY KEY (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webcams_location_id_fkey' and conrelid = 'public.webcams'::regclass) then
    alter table public.webcams add constraint webcams_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webcams_organization_id_fkey' and conrelid = 'public.webcams'::regclass) then
    alter table public.webcams add constraint webcams_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  end if;
end $$;

CREATE INDEX IF NOT EXISTS webcams_org_location_idx ON public.webcams USING btree (organization_id, location_id) WHERE (deleted_at IS NULL);

alter table public.webcams enable row level security;

drop policy if exists "Owner webcams read" on public.webcams;
create policy "Owner webcams read" on public.webcams
  for select to public
  using ((organization_id IN ( SELECT owners.organization_id
   FROM owners
  WHERE (owners.profile_id = auth.uid()))));

drop policy if exists webcams_delete_admin on public.webcams;
create policy webcams_delete_admin on public.webcams
  for delete to public
  using (is_org_admin(organization_id));

drop policy if exists webcams_insert_admin on public.webcams;
create policy webcams_insert_admin on public.webcams
  for insert to public
  with check (is_org_admin(organization_id));

drop policy if exists webcams_select_member on public.webcams;
create policy webcams_select_member on public.webcams
  for select to public
  using (((deleted_at IS NULL) AND is_org_member(organization_id)));

drop policy if exists webcams_update_admin on public.webcams;
create policy webcams_update_admin on public.webcams
  for update to public
  using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));

-- =====================================================================
-- Owner credit-cache columns, credit-system fns, trigger.
-- (Custom enums are now at the top of this file so the table CREATEs
-- above this section can reference them.)
-- =====================================================================

-- ----------------------------------------------------------------------------
-- 2. Missing columns on public.owners (credit cache)
-- ----------------------------------------------------------------------------

alter table public.owners add column if not exists daycare_full_day_credits integer not null default 0;
alter table public.owners add column if not exists daycare_half_day_credits integer not null default 0;
alter table public.owners add column if not exists boarding_night_credits integer not null default 0;

-- ----------------------------------------------------------------------------
-- 2b. Missing columns on other pre-existing tables.
--
-- These columns exist on the live DB but were added via the Supabase
-- dashboard and never landed as migrations. Later migration files
-- reference them (e.g. 20260507040300_qbo_65_reconciliation_export.sql
-- selects payments.helcim_transaction_id), so a fresh CI Postgres
-- can't apply the chain without them.
--
-- Each statement is idempotent via ADD COLUMN IF NOT EXISTS.
-- ----------------------------------------------------------------------------

-- invoice_lines
alter table public.invoice_lines add column if not exists line_type text not null default 'item'::text;

-- invoices
alter table public.invoices add column if not exists surcharge_cents integer not null default 0;
alter table public.invoices add column if not exists helcim_checkout_token text;
alter table public.invoices add column if not exists helcim_checkout_secret_token text;
alter table public.invoices add column if not exists helcim_checkout_expires_at timestamptz;

-- message_templates
alter table public.message_templates add column if not exists event_type text;
alter table public.message_templates add column if not exists service_module module_enum;
alter table public.message_templates add column if not exists deleted_at timestamptz;

-- messages
alter table public.messages add column if not exists attachments jsonb not null default '[]'::jsonb;

-- organizations
alter table public.organizations add column if not exists credit_expiration_days integer;
alter table public.organizations add column if not exists payment_processor payment_processor_kind not null default 'stripe'::payment_processor_kind;
alter table public.organizations add column if not exists cancellation_policy_hours integer not null default 24;
alter table public.organizations add column if not exists grooming_cancellation_policy_hours integer not null default 48;

-- owner_subscriptions
alter table public.owner_subscriptions add column if not exists stripe_checkout_session_id text;

-- payments
alter table public.payments add column if not exists card_funding text;
alter table public.payments add column if not exists expected_payout_at timestamptz;
alter table public.payments add column if not exists helcim_transaction_id text;
alter table public.payments add column if not exists helcim_invoice_number text;

-- reservations
alter table public.reservations add column if not exists parent_reservation_id uuid;

-- services
alter table public.services add column if not exists default_duration_minutes integer;

-- ----------------------------------------------------------------------------
-- 3. Credit-system functions (verbatim from pg_get_functiondef)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_owner_credit_cache(p_owner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.owners SET
    daycare_full_day_credits = COALESCE((
      SELECT SUM(delta_full) FROM public.credit_ledger WHERE owner_id = p_owner_id
    ), 0),
    daycare_half_day_credits = COALESCE((
      SELECT SUM(delta_half) FROM public.credit_ledger WHERE owner_id = p_owner_id
    ), 0),
    boarding_night_credits = COALESCE((
      SELECT SUM(delta_nights) FROM public.credit_ledger WHERE owner_id = p_owner_id
    ), 0)
  WHERE id = p_owner_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_credits(p_owner_id uuid, p_reservation_id uuid, p_need_full integer, p_need_half integer, p_need_nights integer, p_actor_kind text, p_actor_label text, p_staff_code_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id      uuid;
  v_purchase    RECORD;
  v_take_full   integer;
  v_take_half   integer;
  v_take_nights integer;
  v_left_full   integer := COALESCE(p_need_full, 0);
  v_left_half   integer := COALESCE(p_need_half, 0);
  v_left_nights integer := COALESCE(p_need_nights, 0);
BEGIN
  IF v_left_full < 0 OR v_left_half < 0 OR v_left_nights < 0 THEN
    RAISE EXCEPTION 'consume_credits requires non-negative needs';
  END IF;
  IF v_left_full = 0 AND v_left_half = 0 AND v_left_nights = 0 THEN
    RETURN jsonb_build_object('used', false, 'reason', 'no_credits_needed');
  END IF;

  SELECT organization_id INTO v_org_id FROM owners WHERE id = p_owner_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Owner % not found', p_owner_id;
  END IF;

  FOR v_purchase IN
    SELECT
      cl.id,
      cl.delta_full   + COALESCE((SELECT SUM(c.delta_full)   FROM credit_ledger c WHERE c.source_purchase_id = cl.id), 0) AS rem_full,
      cl.delta_half   + COALESCE((SELECT SUM(c.delta_half)   FROM credit_ledger c WHERE c.source_purchase_id = cl.id), 0) AS rem_half,
      cl.delta_nights + COALESCE((SELECT SUM(c.delta_nights) FROM credit_ledger c WHERE c.source_purchase_id = cl.id), 0) AS rem_nights
    FROM credit_ledger cl
    WHERE cl.owner_id = p_owner_id
      AND cl.kind IN ('opening_balance', 'purchase')
      AND (cl.expires_at IS NULL OR cl.expires_at > now())
    ORDER BY cl.created_at ASC, cl.id ASC
    FOR UPDATE
  LOOP
    v_take_full   := LEAST(v_left_full,   GREATEST(v_purchase.rem_full,   0));
    v_take_half   := LEAST(v_left_half,   GREATEST(v_purchase.rem_half,   0));
    v_take_nights := LEAST(v_left_nights, GREATEST(v_purchase.rem_nights, 0));

    IF v_take_full > 0 OR v_take_half > 0 OR v_take_nights > 0 THEN
      INSERT INTO credit_ledger
        (organization_id, owner_id, kind,
         delta_full, delta_half, delta_nights,
         source_purchase_id, reference_id, reference_type,
         actor_kind, actor_label, staff_code_id)
      VALUES
        (v_org_id, p_owner_id, 'consumption',
         -v_take_full, -v_take_half, -v_take_nights,
         v_purchase.id, p_reservation_id, 'reservation',
         COALESCE(p_actor_kind, 'system'), p_actor_label, p_staff_code_id);

      v_left_full   := v_left_full   - v_take_full;
      v_left_half   := v_left_half   - v_take_half;
      v_left_nights := v_left_nights - v_take_nights;
    END IF;

    EXIT WHEN v_left_full = 0 AND v_left_half = 0 AND v_left_nights = 0;
  END LOOP;

  IF v_left_full > 0 OR v_left_half > 0 OR v_left_nights > 0 THEN
    RAISE EXCEPTION 'Insufficient credits: short by % full, % half, % nights',
      v_left_full, v_left_half, v_left_nights
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'used',   true,
    'full',   p_need_full,
    'half',   p_need_half,
    'nights', p_need_nights
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_credits(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase   RECORD;
  v_rem_full   integer;
  v_rem_half   integer;
  v_rem_nights integer;
  v_count      integer := 0;
BEGIN
  FOR v_purchase IN
    SELECT cl.id, cl.owner_id, cl.delta_full, cl.delta_half, cl.delta_nights
    FROM credit_ledger cl
    WHERE cl.organization_id = p_organization_id
      AND cl.kind IN ('opening_balance', 'purchase')
      AND cl.expires_at IS NOT NULL
      AND cl.expires_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM credit_ledger e
        WHERE e.kind = 'expiration' AND e.source_purchase_id = cl.id
      )
    FOR UPDATE
  LOOP
    SELECT
      v_purchase.delta_full   + COALESCE(SUM(delta_full),   0),
      v_purchase.delta_half   + COALESCE(SUM(delta_half),   0),
      v_purchase.delta_nights + COALESCE(SUM(delta_nights), 0)
    INTO v_rem_full, v_rem_half, v_rem_nights
    FROM credit_ledger
    WHERE source_purchase_id = v_purchase.id;

    IF v_rem_full > 0 OR v_rem_half > 0 OR v_rem_nights > 0 THEN
      INSERT INTO credit_ledger
        (organization_id, owner_id, kind,
         delta_full, delta_half, delta_nights,
         source_purchase_id, actor_kind, actor_label)
      VALUES
        (p_organization_id, v_purchase.owner_id, 'expiration',
         -GREATEST(v_rem_full,   0),
         -GREATEST(v_rem_half,   0),
         -GREATEST(v_rem_nights, 0),
         v_purchase.id, 'system', 'System');
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('expired_count', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_credit_adjustment(p_owner_id uuid, p_delta_full integer, p_delta_half integer, p_delta_nights integer, p_note text, p_actor_kind text, p_actor_label text, p_staff_code_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id      uuid;
  v_purchase    RECORD;
  v_pos_full    integer;
  v_pos_half    integer;
  v_pos_nights  integer;
  v_neg_full    integer;
  v_neg_half    integer;
  v_neg_nights  integer;
  v_take_full   integer;
  v_take_half   integer;
  v_take_nights integer;
BEGIN
  v_pos_full   := GREATEST(COALESCE(p_delta_full,   0), 0);
  v_pos_half   := GREATEST(COALESCE(p_delta_half,   0), 0);
  v_pos_nights := GREATEST(COALESCE(p_delta_nights, 0), 0);
  v_neg_full   := GREATEST(-COALESCE(p_delta_full,   0), 0);
  v_neg_half   := GREATEST(-COALESCE(p_delta_half,   0), 0);
  v_neg_nights := GREATEST(-COALESCE(p_delta_nights, 0), 0);

  IF v_pos_full = 0 AND v_pos_half = 0 AND v_pos_nights = 0
     AND v_neg_full = 0 AND v_neg_half = 0 AND v_neg_nights = 0 THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  SELECT organization_id INTO v_org_id FROM owners WHERE id = p_owner_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Owner % not found', p_owner_id;
  END IF;

  IF v_pos_full > 0 OR v_pos_half > 0 OR v_pos_nights > 0 THEN
    INSERT INTO credit_ledger
      (organization_id, owner_id, kind,
       delta_full, delta_half, delta_nights,
       note, actor_kind, actor_label, staff_code_id)
    VALUES
      (v_org_id, p_owner_id, 'manual_adjustment',
       v_pos_full, v_pos_half, v_pos_nights,
       p_note, COALESCE(p_actor_kind, 'staff'), p_actor_label, p_staff_code_id);
  END IF;

  IF v_neg_full > 0 OR v_neg_half > 0 OR v_neg_nights > 0 THEN
    FOR v_purchase IN
      SELECT
        cl.id,
        cl.delta_full   + COALESCE((SELECT SUM(c.delta_full)   FROM credit_ledger c WHERE c.source_purchase_id = cl.id), 0) AS rem_full,
        cl.delta_half   + COALESCE((SELECT SUM(c.delta_half)   FROM credit_ledger c WHERE c.source_purchase_id = cl.id), 0) AS rem_half,
        cl.delta_nights + COALESCE((SELECT SUM(c.delta_nights) FROM credit_ledger c WHERE c.source_purchase_id = cl.id), 0) AS rem_nights
      FROM credit_ledger cl
      WHERE cl.owner_id = p_owner_id
        AND cl.kind IN ('opening_balance', 'purchase')
        AND (cl.expires_at IS NULL OR cl.expires_at > now())
      ORDER BY cl.created_at ASC, cl.id ASC
      FOR UPDATE
    LOOP
      v_take_full   := LEAST(v_neg_full,   GREATEST(v_purchase.rem_full,   0));
      v_take_half   := LEAST(v_neg_half,   GREATEST(v_purchase.rem_half,   0));
      v_take_nights := LEAST(v_neg_nights, GREATEST(v_purchase.rem_nights, 0));

      IF v_take_full > 0 OR v_take_half > 0 OR v_take_nights > 0 THEN
        INSERT INTO credit_ledger
          (organization_id, owner_id, kind,
           delta_full, delta_half, delta_nights,
           source_purchase_id, note, actor_kind, actor_label, staff_code_id)
        VALUES
          (v_org_id, p_owner_id, 'manual_adjustment',
           -v_take_full, -v_take_half, -v_take_nights,
           v_purchase.id, p_note, COALESCE(p_actor_kind, 'staff'), p_actor_label, p_staff_code_id);

        v_neg_full   := v_neg_full   - v_take_full;
        v_neg_half   := v_neg_half   - v_take_half;
        v_neg_nights := v_neg_nights - v_take_nights;
      END IF;

      EXIT WHEN v_neg_full = 0 AND v_neg_half = 0 AND v_neg_nights = 0;
    END LOOP;

    IF v_neg_full > 0 OR v_neg_half > 0 OR v_neg_nights > 0 THEN
      RAISE EXCEPTION 'Adjustment would put balance below zero: short by % full, % half, % nights',
        v_neg_full, v_neg_half, v_neg_nights
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN jsonb_build_object('changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_credit_ledger_refresh_cache()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM public.refresh_owner_credit_cache(NEW.owner_id);
    IF TG_OP = 'UPDATE' AND OLD.owner_id <> NEW.owner_id THEN
      PERFORM public.refresh_owner_credit_cache(OLD.owner_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_owner_credit_cache(OLD.owner_id);
  END IF;
  RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Trigger on credit_ledger
-- ----------------------------------------------------------------------------

drop trigger if exists credit_ledger_cache_refresh on public.credit_ledger;
CREATE TRIGGER credit_ledger_cache_refresh AFTER INSERT OR DELETE OR UPDATE ON public.credit_ledger FOR EACH ROW EXECUTE FUNCTION trg_credit_ledger_refresh_cache();

-- End of v2 appendix.
