-- QBO Customer Deposits account config (Milestone A, deposit-prepayment series, PR-2).
--
-- A deposit collected before service is a customer PREPAYMENT — cash received
-- against a liability, not yet earned revenue. The dedicated
-- quickbooks-sync-deposits path (PR-3/4) posts a Journal Entry per deposit
-- lifecycle event, and needs two operator-chosen GL accounts:
--
--   collect:  Debit  Undeposited Funds            (existing default_deposit_account)
--             Credit Customer Deposits (liability) ← default_customer_deposit_liability_account
--
--   forfeit:  Debit  Customer Deposits (liability)
--             Credit Forfeited Deposit Income      ← default_forfeited_deposit_income_account
--
--   refund:   Debit  Customer Deposits (liability)
--             Credit Undeposited Funds             (existing default_deposit_account)
--
--   apply (PR-5): Debit Customer Deposits (liability) / Credit Service Income
--
-- This migration adds the two new account columns and extends the existing
-- qbo_set_credit_account setter with two new slots so the UI reuses the same
-- mutation hook.

alter table public.quickbooks_accounts
  add column if not exists default_customer_deposit_liability_account_id text,
  add column if not exists default_customer_deposit_liability_account_name text,
  add column if not exists default_forfeited_deposit_income_account_id text,
  add column if not exists default_forfeited_deposit_income_account_name text;

create or replace function public.qbo_set_credit_account(
  _slot text,
  _qbo_id text,
  _name text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _org uuid;
begin
  if _slot not in (
    'deferred_daycare_full',
    'deferred_daycare_half',
    'deferred_boarding',
    'expired_credits_income',
    'customer_deposit_liability',
    'forfeited_deposit_income'
  ) then
    raise exception 'qbo_set_credit_account: unknown slot %', _slot;
  end if;

  select organization_id into _org
  from public.memberships
  where profile_id = auth.uid()
    and active = true
    and role in ('owner','admin')
  limit 1;
  if _org is null then
    raise exception 'qbo_set_credit_account: not authorized';
  end if;

  if _slot = 'deferred_daycare_full' then
    update public.quickbooks_accounts
       set default_deferred_daycare_full_account_id = _qbo_id,
           default_deferred_daycare_full_account_name = _name
     where organization_id = _org and deleted_at is null;
  elsif _slot = 'deferred_daycare_half' then
    update public.quickbooks_accounts
       set default_deferred_daycare_half_account_id = _qbo_id,
           default_deferred_daycare_half_account_name = _name
     where organization_id = _org and deleted_at is null;
  elsif _slot = 'deferred_boarding' then
    update public.quickbooks_accounts
       set default_deferred_boarding_account_id = _qbo_id,
           default_deferred_boarding_account_name = _name
     where organization_id = _org and deleted_at is null;
  elsif _slot = 'expired_credits_income' then
    update public.quickbooks_accounts
       set default_expired_credits_income_account_id = _qbo_id,
           default_expired_credits_income_account_name = _name
     where organization_id = _org and deleted_at is null;
  elsif _slot = 'customer_deposit_liability' then
    update public.quickbooks_accounts
       set default_customer_deposit_liability_account_id = _qbo_id,
           default_customer_deposit_liability_account_name = _name
     where organization_id = _org and deleted_at is null;
  elsif _slot = 'forfeited_deposit_income' then
    update public.quickbooks_accounts
       set default_forfeited_deposit_income_account_id = _qbo_id,
           default_forfeited_deposit_income_account_name = _name
     where organization_id = _org and deleted_at is null;
  end if;
end;
$fn$;

revoke all on function public.qbo_set_credit_account(text, text, text) from public;
grant execute on function public.qbo_set_credit_account(text, text, text) to authenticated;

notify pgrst, 'reload schema';
