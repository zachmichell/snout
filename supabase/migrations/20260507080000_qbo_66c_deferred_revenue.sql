-- 6.6c: Per-credit-type Deferred Revenue accounts on the QBO connection.
--
-- Operator decision: split deferred revenue by credit type so the
-- balance sheet shows daycare half day, daycare full day, and
-- boarding-night liability separately.
--
-- Per credit_ledger row, Snout posts a Journal Entry. The shape
-- depends on the row's kind:
--
--   purchase:
--     Debit  Undeposited Funds      (price the customer paid)
--     Credit Deferred Daycare Full  (allocated by credit count × price-per-credit)
--     Credit Deferred Daycare Half
--     Credit Deferred Boarding
--
--   consumption (credit redeemed for a service):
--     Debit  Deferred [type]        (per-credit price × credits used)
--     Credit Service Income         (same amount — revenue recognized)
--
--   expiration (credit went stale):
--     Debit  Deferred [type]        (per-credit price × credits expired)
--     Credit Expired Credits Income (or fallback: same Service Income)
--
--   refund (credit purchase reversed):
--     Debit  Deferred [type]
--     Credit Undeposited Funds      (refund issued back)
--
--   opening_balance, manual_adjustment: skipped (no canonical GL).
--   Operator handles those manually if needed.
--
-- Per-credit price is derived from the source purchase row's linked
-- subscription_package: price_cents / sum(included_credits). All
-- credit types in a package share the same per-credit price.

alter table public.quickbooks_accounts
  add column if not exists default_deferred_daycare_full_account_id text,
  add column if not exists default_deferred_daycare_full_account_name text,
  add column if not exists default_deferred_daycare_half_account_id text,
  add column if not exists default_deferred_daycare_half_account_name text,
  add column if not exists default_deferred_boarding_account_id text,
  add column if not exists default_deferred_boarding_account_name text,
  add column if not exists default_expired_credits_income_account_id text,
  add column if not exists default_expired_credits_income_account_name text;

-- Per-credit-type setter RPC. Single function with a slot enum so the
-- four UI dropdowns share one mutation hook.
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
    'expired_credits_income'
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
  end if;
end;
$fn$;

revoke all on function public.qbo_set_credit_account(text, text, text) from public;
grant execute on function public.qbo_set_credit_account(text, text, text) to authenticated;
