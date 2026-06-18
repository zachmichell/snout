-- Deposit-prepayment series (PR-5): go-live. Re-enables deposit→invoice netting
-- behind a per-org flag, adds the Accounts-Receivable config for the QBO
-- "apply" leg, tracks the applied amount, expands the work-queue RPC with the
-- apply / apply-reverse legs, wires the netting triggers, and schedules the
-- deposit-sync cron.
--
-- Accounting model (why apply credits A/R, not Income): each invoice is already
-- posted to QBO as a full Invoice (Dr A/R / Cr Income for the total). A deposit
-- applied to that invoice must therefore settle the receivable using the
-- prepayment liability — Dr Customer-Deposit Liability / Cr A/R (with the
-- customer as the JE-line Entity) — NOT credit Income again (which would
-- double-count revenue and strand a phantom receivable). Refunding an applied
-- deposit reverses that leg (Dr A/R / Cr Liability) and then refunds cash
-- (Dr Liability / Cr Undeposited Funds).
--
-- Nothing here changes behavior until an org's deposit_settings
-- .qbo_deposit_netting_enabled is set true.

-- ── Per-org feature flag ───────────────────────────────────────────────────
alter table public.deposit_settings
  add column if not exists qbo_deposit_netting_enabled boolean not null default false;

-- ── Applied-amount tracking ────────────────────────────────────────────────
-- The amount credited to the invoice (== the credit payment amount, capped at
-- the invoice balance). Kept intact through a reverse so the apply-reverse JE
-- knows the exact amount even after the credit payment is detached.
alter table public.deposits
  add column if not exists credited_to_invoice_cents integer not null default 0;

-- ── Accounts-Receivable account config (operator picks it) ─────────────────
alter table public.quickbooks_accounts
  add column if not exists default_accounts_receivable_account_id text,
  add column if not exists default_accounts_receivable_account_name text;

-- Extend the shared setter RPC with the A/R slot.
create or replace function public.qbo_set_credit_account(
  _slot text, _qbo_id text, _name text
) returns void
language plpgsql security definer set search_path = public
as $fn$
declare _org uuid;
begin
  if _slot not in (
    'deferred_daycare_full','deferred_daycare_half','deferred_boarding',
    'expired_credits_income','customer_deposit_liability',
    'forfeited_deposit_income','accounts_receivable'
  ) then
    raise exception 'qbo_set_credit_account: unknown slot %', _slot;
  end if;

  select organization_id into _org from public.memberships
  where profile_id = auth.uid() and active = true and role in ('owner','admin') limit 1;
  if _org is null then raise exception 'qbo_set_credit_account: not authorized'; end if;

  if _slot = 'deferred_daycare_full' then
    update public.quickbooks_accounts set default_deferred_daycare_full_account_id=_qbo_id, default_deferred_daycare_full_account_name=_name where organization_id=_org and deleted_at is null;
  elsif _slot = 'deferred_daycare_half' then
    update public.quickbooks_accounts set default_deferred_daycare_half_account_id=_qbo_id, default_deferred_daycare_half_account_name=_name where organization_id=_org and deleted_at is null;
  elsif _slot = 'deferred_boarding' then
    update public.quickbooks_accounts set default_deferred_boarding_account_id=_qbo_id, default_deferred_boarding_account_name=_name where organization_id=_org and deleted_at is null;
  elsif _slot = 'expired_credits_income' then
    update public.quickbooks_accounts set default_expired_credits_income_account_id=_qbo_id, default_expired_credits_income_account_name=_name where organization_id=_org and deleted_at is null;
  elsif _slot = 'customer_deposit_liability' then
    update public.quickbooks_accounts set default_customer_deposit_liability_account_id=_qbo_id, default_customer_deposit_liability_account_name=_name where organization_id=_org and deleted_at is null;
  elsif _slot = 'forfeited_deposit_income' then
    update public.quickbooks_accounts set default_forfeited_deposit_income_account_id=_qbo_id, default_forfeited_deposit_income_account_name=_name where organization_id=_org and deleted_at is null;
  elsif _slot = 'accounts_receivable' then
    update public.quickbooks_accounts set default_accounts_receivable_account_id=_qbo_id, default_accounts_receivable_account_name=_name where organization_id=_org and deleted_at is null;
  end if;
end;
$fn$;
revoke all on function public.qbo_set_credit_account(text, text, text) from public;
grant execute on function public.qbo_set_credit_account(text, text, text) to authenticated;

-- ── credit_deposit_to_invoice: also record the applied amount ──────────────
-- Identical to the PR-0 body except the final deposit update now also stores
-- credited_to_invoice_cents = _apply.
create or replace function public.credit_deposit_to_invoice(_deposit_id uuid, _invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _dep record; _inv record; _apply integer; _pid uuid;
begin
  select id, organization_id, amount_cents, status, currency, invoice_id
    into _dep from public.deposits where id = _deposit_id for update;
  if _dep.id is null then return; end if;
  if _dep.status <> 'paid' then return; end if;
  if coalesce(_dep.amount_cents, 0) <= 0 then return; end if;

  select id, organization_id, currency, status, total_cents, amount_paid_cents
    into _inv from public.invoices where id = _invoice_id and deleted_at is null for update;
  if _inv.id is null then return; end if;
  if _inv.status = 'void' then return; end if;

  if _dep.organization_id <> _inv.organization_id then
    raise exception 'credit_deposit_to_invoice: org mismatch (deposit % / invoice %)', _deposit_id, _invoice_id;
  end if;
  if lower(_dep.currency) <> lower(_inv.currency::text) then
    raise exception 'credit_deposit_to_invoice: currency mismatch (% vs %)', _dep.currency, _inv.currency;
  end if;

  if exists (select 1 from public.payments where source_deposit_id = _deposit_id) then
    update public.deposits set invoice_id = _invoice_id where id = _deposit_id and invoice_id is null;
    return;
  end if;

  _apply := least(_dep.amount_cents, greatest(0, _inv.total_cents - _inv.amount_paid_cents));
  if _apply <= 0 then
    update public.deposits set invoice_id = _invoice_id where id = _deposit_id and invoice_id is null;
    return;
  end if;

  insert into public.payments (invoice_id, organization_id, amount_cents, currency, method, status, source_deposit_id, processed_at)
  values (_invoice_id, _inv.organization_id, _apply, _inv.currency, 'in_person'::payment_method_enum, 'succeeded'::payment_status, _deposit_id, now())
  on conflict (source_deposit_id) where source_deposit_id is not null do nothing
  returning id into _pid;
  if _pid is null then return; end if;

  update public.invoices
  set amount_paid_cents      = amount_paid_cents + _apply,
      deposit_credited_cents = deposit_credited_cents + _apply,
      balance_due_cents      = greatest(0, total_cents - (amount_paid_cents + _apply)),
      status = case
                 when status in ('void','paid') then status
                 when amount_paid_cents + _apply >= total_cents then 'paid'::invoice_status
                 when amount_paid_cents + _apply > 0 then 'partial'::invoice_status
                 else status end,
      paid_at = case
                  when status in ('void','paid') then paid_at
                  when amount_paid_cents + _apply >= total_cents then now()
                  else paid_at end
  where id = _invoice_id;

  update public.deposits
    set invoice_id = _invoice_id, credited_to_invoice_cents = _apply
    where id = _deposit_id;
end; $$;

-- ── Work queue: paid deposits with any outstanding QBO leg ──────────────────
-- Adds the apply / apply-reverse legs and returns the fields the edge function
-- needs (invoice_id, owner_id, credited amount, and whether a LIVE credit
-- payment currently exists). Anti-joins the mapping table; oldest-first.
-- DROP first: PR-3/4 shipped this with fewer OUT columns and CREATE OR REPLACE
-- cannot change a function's return type.
drop function if exists public.deposits_needing_qbo_sync(uuid, integer);
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
  created_at timestamptz,
  invoice_id uuid,
  owner_id uuid,
  credited_to_invoice_cents integer,
  has_live_credit boolean,
  applied_at timestamptz
)
language sql stable security definer set search_path = public
as $fn$
  with cand as (
    select
      d.id, d.organization_id, d.amount_cents, d.status, d.paid_at,
      d.forfeited_at, d.refunded_at, d.created_at, d.invoice_id, d.owner_id,
      d.credited_to_invoice_cents,
      exists (
        select 1 from public.payments p
        where p.source_deposit_id = d.id and p.status = 'succeeded'
      ) as live_credit,
      (
        select max(p.processed_at) from public.payments p
        where p.source_deposit_id = d.id and p.status = 'succeeded'
      ) as applied_at
    from public.deposits d
    where d.paid_at is not null
      and coalesce(d.amount_cents, 0) > 0
      and (_org is null or d.organization_id = _org)
  )
  select c.id, c.organization_id, c.amount_cents, c.status, c.paid_at,
         c.forfeited_at, c.refunded_at, c.created_at, c.invoice_id, c.owner_id,
         c.credited_to_invoice_cents, c.live_credit, c.applied_at
  from cand c
  where (
    -- collect
    not exists (select 1 from public.quickbooks_entity_mappings m
      where m.snout_table='deposits' and m.snout_id=c.id and m.qbo_entity_type='DepositCollect' and m.deleted_at is null)
    -- apply: currently applied, not yet synced
    or (c.live_credit and not exists (select 1 from public.quickbooks_entity_mappings m
      where m.snout_table='deposits' and m.snout_id=c.id and m.qbo_entity_type='DepositApply' and m.deleted_at is null))
    -- apply reverse: was applied, now un-applied, reverse not yet synced
    or (not c.live_credit
        and exists (select 1 from public.quickbooks_entity_mappings m
          where m.snout_table='deposits' and m.snout_id=c.id and m.qbo_entity_type='DepositApply' and m.deleted_at is null)
        and not exists (select 1 from public.quickbooks_entity_mappings m
          where m.snout_table='deposits' and m.snout_id=c.id and m.qbo_entity_type='DepositApplyReverse' and m.deleted_at is null))
    -- forfeit
    or (c.forfeited_at is not null and not exists (select 1 from public.quickbooks_entity_mappings m
      where m.snout_table='deposits' and m.snout_id=c.id and m.qbo_entity_type='DepositForfeit' and m.deleted_at is null))
    -- refund
    or (c.refunded_at is not null and not exists (select 1 from public.quickbooks_entity_mappings m
      where m.snout_table='deposits' and m.snout_id=c.id and m.qbo_entity_type='DepositRefund' and m.deleted_at is null))
  )
  order by c.created_at asc
  limit greatest(1, least(coalesce(_limit, 50), 500));
$fn$;
revoke all on function public.deposits_needing_qbo_sync(uuid, integer) from public;
grant execute on function public.deposits_needing_qbo_sync(uuid, integer) to service_role;

-- ── Netting trigger: credit a paid deposit when its invoice is finalized ───
-- Fires on INSERT (rare — invoices are created draft) and when status leaves
-- draft. Gated on the per-org flag. credit_deposit_to_invoice is idempotent.
create or replace function public.tg_invoices_credit_deposit()
returns trigger language plpgsql security definer set search_path = public as $$
declare _dep_id uuid; _enabled boolean;
begin
  if new.reservation_id is null then return new; end if;
  if new.status in ('draft','void') then return new; end if;
  select coalesce(qbo_deposit_netting_enabled, false) into _enabled
    from public.deposit_settings where organization_id = new.organization_id;
  if not coalesce(_enabled, false) then return new; end if;

  select id into _dep_id from public.deposits
    where reservation_id = new.reservation_id and status = 'paid' and invoice_id is null
    limit 1;
  if _dep_id is not null then
    perform public.credit_deposit_to_invoice(_dep_id, new.id);
  end if;
  return new;
end; $$;

drop trigger if exists invoices_credit_deposit on public.invoices;
create trigger invoices_credit_deposit
  after insert or update of status on public.invoices
  for each row execute function public.tg_invoices_credit_deposit();

-- ── Netting trigger: on deposit status change ──────────────────────────────
-- paid  -> credit it to a finalized invoice for the reservation (covers the
--          deposit-paid-after-invoice ordering).
-- refunded -> reverse any credit (restores the invoice balance).
create or replace function public.tg_deposits_status_netting()
returns trigger language plpgsql security definer set search_path = public as $$
declare _inv_id uuid; _enabled boolean;
begin
  select coalesce(qbo_deposit_netting_enabled, false) into _enabled
    from public.deposit_settings where organization_id = new.organization_id;
  if not coalesce(_enabled, false) then return new; end if;

  if new.status = 'paid' and new.invoice_id is null and new.reservation_id is not null then
    select id into _inv_id from public.invoices
      where reservation_id = new.reservation_id and status not in ('draft','void') and deleted_at is null
      order by created_at desc limit 1;
    if _inv_id is not null then
      perform public.credit_deposit_to_invoice(new.id, _inv_id);
    end if;
  elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
    perform public.reverse_deposit_credit(new.id);
  end if;
  return new;
end; $$;

drop trigger if exists deposits_status_netting on public.deposits;
create trigger deposits_status_netting
  after update of status on public.deposits
  for each row execute function public.tg_deposits_status_netting();

-- ── Guard: cannot forfeit a deposit already applied to an invoice ──────────
-- "Forfeit" keeps the deposit as income. But an applied deposit was already
-- used to settle an invoice receivable, so also recognizing it as forfeited
-- income would double-count revenue and drive the customer-deposit liability
-- negative. Such a deposit must be refunded (which reverses the credit) or its
-- invoice handled first. Not flag-gated: a live credit can only exist if
-- netting created it, so the guard must hold regardless of the current flag.
create or replace function public.tg_deposits_block_forfeit_applied()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'forfeited' and old.status is distinct from 'forfeited'
     and exists (
       select 1 from public.payments p
       where p.source_deposit_id = new.id and p.status = 'succeeded'
     ) then
    raise exception
      'Cannot forfeit deposit % — it is already applied to an invoice; refund it (which reverses the credit) or handle the invoice first', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists deposits_block_forfeit_applied on public.deposits;
create trigger deposits_block_forfeit_applied
  before update of status on public.deposits
  for each row execute function public.tg_deposits_block_forfeit_applied();

-- ── Schedule the deposit-sync cron (every 15 min) ──────────────────────────
do $$
begin
  perform cron.unschedule('qbo-sync-deposits-tick');
exception when others then null;
end $$;
select cron.schedule('qbo-sync-deposits-tick', '*/15 * * * *', 'select public.invoke_quickbooks_sync_deposits();');

notify pgrst, 'reload schema';
