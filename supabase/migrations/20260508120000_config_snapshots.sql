-- Reliability Batch A: per-row snapshots of operator-edited settings
-- so a misclick on the Settings tab doesn't silently flip a whole
-- facility's config. Closes the Gingr-era "operators woke up to flipped
-- configurations after a rollout" complaint.
--
-- Design:
--
--   1. config_snapshots table holds one row per UPDATE / DELETE on any
--      instrumented settings table. Captures the FULL row state before
--      and after as jsonb, so restore is a generic UPDATE that doesn't
--      need to know the source schema.
--
--   2. snapshot_config_change() trigger function is generic — it reads
--      TG_TABLE_NAME and TG_OP, looks up organization_id from the row,
--      and writes a snapshot. Attached to every settings table (one
--      AFTER trigger per table).
--
--   3. restore_config_snapshot(_snapshot_id) RPC validates that the
--      caller is an org admin, then applies before_json back to the
--      target row. Sets a session GUC so the snapshot trigger skips
--      writing a new snapshot for the restore itself.

-- ---------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------

create table if not exists public.config_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('update','delete')),
  before_json jsonb not null,
  after_json jsonb,                  -- null on delete
  actor_id uuid,                     -- auth.uid() at the time of the change; null for service-role / cron
  actor_label text,                  -- best-effort display string ("Sarah Mitchell" or "system")
  created_at timestamptz not null default now(),
  restored_at timestamptz,           -- non-null once restore_config_snapshot has run
  restored_by uuid,
  restore_snapshot_id uuid references public.config_snapshots(id) on delete set null
    -- pointer back to the snapshot that this restore created (so the UI
    -- can show "Restored — undo" on the original row's snapshot).
);

create index if not exists idx_config_snapshots_org_recent
  on public.config_snapshots (organization_id, created_at desc);

create index if not exists idx_config_snapshots_table_row
  on public.config_snapshots (organization_id, table_name, row_id, created_at desc);

-- RLS: organization members read their own snapshots; only admins write
-- via the RPC (which uses service-role under SECURITY DEFINER). The
-- triggers themselves run with the table-owner's privileges so they
-- bypass RLS for the insert.

alter table public.config_snapshots enable row level security;

drop policy if exists config_snapshots_select on public.config_snapshots;
create policy config_snapshots_select on public.config_snapshots
  for select
  using (public.is_org_member(organization_id));

-- No insert / update / delete policies — the trigger writes via the
-- table-owner (service-role) and the RPC also uses SECURITY DEFINER.

-- ---------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------

create or replace function public.snapshot_config_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _org_id uuid;
  _row_id uuid;
  _before jsonb := to_jsonb(old);
  _after jsonb;
  _action text;
  _actor_id uuid;
  _actor_label text;
begin
  -- Bypass during a restore to avoid recursive snapshots. The
  -- restore_config_snapshot() RPC sets this GUC for the duration of
  -- its UPDATE statement.
  if coalesce(current_setting('snout.skip_config_snapshot', true), '') = 'true' then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    _action := 'update';
    _after := to_jsonb(new);
    _row_id := new.id;
    _org_id := new.organization_id;
    -- Inserts that didn't actually change anything generate a snapshot
    -- with identical before/after — skip those, they're noise.
    if _before = _after then
      return null;
    end if;
  elsif tg_op = 'DELETE' then
    _action := 'delete';
    _after := null;
    _row_id := old.id;
    _org_id := old.organization_id;
  else
    -- INSERTs are not snapshotted — there's no prior state to restore.
    return null;
  end if;

  -- Defensive: every settings table has organization_id and id; if
  -- either is missing, skip silently rather than break the write path.
  if _org_id is null or _row_id is null then
    return null;
  end if;

  begin
    _actor_id := auth.uid();
  exception when others then
    _actor_id := null;
  end;

  if _actor_id is not null then
    select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))
      into _actor_label
      from public.profiles
     where id = _actor_id
     limit 1;
    if _actor_label is null or _actor_label = '' then _actor_label := 'Staff'; end if;
  else
    _actor_label := 'System';
  end if;

  insert into public.config_snapshots (
    organization_id, table_name, row_id, action, before_json, after_json,
    actor_id, actor_label
  )
  values (
    _org_id, tg_table_name, _row_id, _action, _before, _after,
    _actor_id, _actor_label
  );

  return null;
end;
$fn$;

-- ---------------------------------------------------------------
-- Per-table triggers
-- ---------------------------------------------------------------
-- The trigger is attached AFTER UPDATE OR DELETE so the row state is
-- already committed when we capture it. Ordered to keep the migration
-- readable; order doesn't matter at runtime.

do $$
declare
  _t text;
  _tables text[] := array[
    'organizations',
    'email_settings',
    'notification_settings',
    'location_hours',
    'auto_reply_settings',
    'capacity_settings',
    'deposit_settings',
    'loyalty_settings',
    'portal_settings',
    'precheck_settings',
    'surcharge_settings',
    'survey_settings'
  ];
begin
  foreach _t in array _tables loop
    -- Only attach if the table actually exists; some envs may not have
    -- every settings table provisioned yet.
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name = _t) then
      execute format(
        'drop trigger if exists trg_snapshot_config on public.%I',
        _t
      );
      execute format(
        'create trigger trg_snapshot_config
           after update or delete on public.%I
           for each row execute function public.snapshot_config_change()',
        _t
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Restore RPC
-- ---------------------------------------------------------------
-- Applies the snapshot's before_json back to the target row by id.
-- Admin-only. Sets the bypass GUC so restoring doesn't recursively
-- create a new snapshot of itself; instead, after the restore lands we
-- write a single "restore" snapshot manually so the operator can undo
-- the undo.

create or replace function public.restore_config_snapshot(_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _snap public.config_snapshots%rowtype;
  _is_admin boolean;
  _user uuid := auth.uid();
  _set_clause text;
  _restore_snapshot_id uuid;
  _result jsonb;
begin
  if _user is null then
    raise exception 'restore_config_snapshot: not authenticated' using errcode = '28000';
  end if;

  select * into _snap from public.config_snapshots where id = _snapshot_id;
  if not found then
    raise exception 'restore_config_snapshot: snapshot not found' using errcode = 'P0002';
  end if;

  -- Caller must be an admin of the snapshot's organization.
  select exists (
    select 1 from public.memberships
     where profile_id = _user
       and organization_id = _snap.organization_id
       and active = true
       and role in ('owner','admin')
  ) into _is_admin;
  if not _is_admin then
    raise exception 'restore_config_snapshot: not authorized' using errcode = '42501';
  end if;

  if _snap.restored_at is not null then
    raise exception 'restore_config_snapshot: already restored' using errcode = '40000';
  end if;

  -- Bypass the snapshot trigger for the duration of the restore UPDATE
  -- so we don't loop. We'll write the restore snapshot manually below.
  perform set_config('snout.skip_config_snapshot', 'true', true);

  if _snap.action = 'update' then
    -- Build a SET clause that assigns every key in before_json back to
    -- its column. We drop id / organization_id since those don't change
    -- during a restore. The format spec %I quotes identifiers.
    select string_agg(
      format('%I = ($1->>%L)::%s', c.column_name, c.column_name,
        case c.data_type
          when 'uuid' then 'uuid'
          when 'integer' then 'integer'
          when 'bigint' then 'bigint'
          when 'numeric' then 'numeric'
          when 'boolean' then 'boolean'
          when 'jsonb' then 'jsonb'
          when 'json' then 'json'
          when 'timestamp with time zone' then 'timestamptz'
          when 'timestamp without time zone' then 'timestamp'
          when 'date' then 'date'
          when 'time without time zone' then 'time'
          when 'ARRAY' then 'text[]'
          else 'text'
        end
      ),
      ', '
    ) into _set_clause
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = _snap.table_name
      and c.column_name not in ('id','organization_id')
      and c.column_name = any(array(select jsonb_object_keys(_snap.before_json)));

    if _set_clause is null then
      raise exception 'restore_config_snapshot: no columns to restore for %', _snap.table_name;
    end if;

    execute format(
      'update public.%I set %s where id = $2 and organization_id = $3',
      _snap.table_name, _set_clause
    ) using _snap.before_json, _snap.row_id, _snap.organization_id;
  elsif _snap.action = 'delete' then
    -- Re-insert the deleted row from before_json. Easier path because
    -- jsonb_populate_record handles type coercion.
    execute format(
      'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
      _snap.table_name, _snap.table_name
    ) using _snap.before_json;
  end if;

  -- Mark this snapshot as restored.
  update public.config_snapshots
     set restored_at = now(),
         restored_by = _user
   where id = _snapshot_id;

  -- Write a manual snapshot of the restore op itself so an operator can
  -- undo the undo. We write this OUTSIDE the bypass by clearing the GUC
  -- briefly... but we set it on the local txn so we can't easily clear
  -- it. Simpler: just insert directly, marking action='update' from
  -- after_json -> before_json (i.e., the inverse of the snapshot we
  -- just restored).
  if _snap.action = 'update' and _snap.after_json is not null then
    insert into public.config_snapshots (
      organization_id, table_name, row_id, action, before_json, after_json,
      actor_id, actor_label
    ) values (
      _snap.organization_id, _snap.table_name, _snap.row_id, 'update',
      _snap.after_json,    -- before the restore we had after_json
      _snap.before_json,   -- after the restore we have before_json
      _user, 'Restore (' || _snap.id::text || ')'
    ) returning id into _restore_snapshot_id;

    update public.config_snapshots
       set restore_snapshot_id = _restore_snapshot_id
     where id = _snapshot_id;
  end if;

  _result := jsonb_build_object(
    'ok', true,
    'snapshot_id', _snapshot_id,
    'restore_snapshot_id', _restore_snapshot_id,
    'table_name', _snap.table_name,
    'row_id', _snap.row_id
  );
  return _result;
end;
$fn$;

revoke all on function public.restore_config_snapshot(uuid) from public;
grant execute on function public.restore_config_snapshot(uuid) to authenticated;
