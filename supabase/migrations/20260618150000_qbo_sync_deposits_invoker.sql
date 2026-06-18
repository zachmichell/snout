-- Deposit-prepayment series (PR-3/4): backing DB objects for
-- quickbooks-sync-deposits — a mutual-exclusion guard, a work-queue RPC, and the
-- cron invoker.
--
-- The cron invoker is defined ONLY and intentionally NOT scheduled here.
-- Activating the schedule (cron.schedule) is deferred to PR-5 — the live-books
-- "go" — together with the netting trigger re-enable and the DepositApply leg.
-- Until then the function exists and is callable but nothing invokes it
-- automatically, and a manual invocation soft-fails to no-op for any org that
-- has not configured its deposit accounts.

-- ── A deposit is forfeited OR refunded, never both ─────────────────────────
-- The sync posts one release leg (forfeit or refund) that debits the
-- Customer-Deposit liability. Both set would double-debit it. The shipping UI
-- already makes these mutually exclusive; this makes it impossible to persist.
alter table public.deposits
  add constraint deposits_forfeit_xor_refund
  check (forfeited_at is null or refunded_at is null) not valid;
alter table public.deposits validate constraint deposits_forfeit_xor_refund;

-- ── Work queue: paid deposits with at least one outstanding QBO leg ────────
-- Anti-joins the mapping table so fully-synced deposits are never returned;
-- oldest-first so a backlog drains deterministically and no unsynced leg is
-- ever starved by newer activity. Used by quickbooks-sync-deposits.
create or replace function public.deposits_needing_qbo_sync(
  _org uuid default null,
  _limit integer default 50
)
returns table (
  id uuid,
  organization_id uuid,
  amount_cents integer,
  status text,
  paid_at timestamptz,
  forfeited_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select d.id, d.organization_id, d.amount_cents, d.status,
         d.paid_at, d.forfeited_at, d.refunded_at, d.created_at
  from public.deposits d
  where d.paid_at is not null
    and coalesce(d.amount_cents, 0) > 0
    and (_org is null or d.organization_id = _org)
    and (
      not exists (
        select 1 from public.quickbooks_entity_mappings m
        where m.snout_table = 'deposits' and m.snout_id = d.id
          and m.qbo_entity_type = 'DepositCollect' and m.deleted_at is null
      )
      or (d.forfeited_at is not null and not exists (
        select 1 from public.quickbooks_entity_mappings m
        where m.snout_table = 'deposits' and m.snout_id = d.id
          and m.qbo_entity_type = 'DepositForfeit' and m.deleted_at is null
      ))
      or (d.refunded_at is not null and not exists (
        select 1 from public.quickbooks_entity_mappings m
        where m.snout_table = 'deposits' and m.snout_id = d.id
          and m.qbo_entity_type = 'DepositRefund' and m.deleted_at is null
      ))
    )
  order by d.created_at asc
  limit greatest(1, least(coalesce(_limit, 50), 500));
$fn$;

revoke all on function public.deposits_needing_qbo_sync(uuid, integer) from public;
grant execute on function public.deposits_needing_qbo_sync(uuid, integer) to service_role;

-- ── Cron invoker (NOT scheduled until PR-5) ────────────────────────────────

create or replace function public.invoke_quickbooks_sync_deposits()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions', 'net'
as $function$
declare
  _service_role_key text;
  _request_id bigint;
  _function_url text := 'https://empdnuzfjgfnphwauhah.supabase.co/functions/v1/quickbooks-sync-deposits';
begin
  select decrypted_secret into _service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if _service_role_key is null then
    raise warning 'invoke_quickbooks_sync_deposits: service_role_key not found in vault; skipping.';
    return 0;
  end if;

  select net.http_post(
    url := _function_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _service_role_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into _request_id;

  return _request_id;
end;
$function$;
