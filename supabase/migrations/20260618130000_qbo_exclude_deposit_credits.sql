-- Exclude deposit-credit payment rows from the normal QuickBooks payment sync
-- (Milestone A, QBO deposit-prepayment series, PR-1).
--
-- credit_deposit_to_invoice (PR-0) posts an internal payments row tagged with
-- source_deposit_id and NO Stripe PaymentIntent. That row makes Snout's invoice
-- balance net correctly, but it must NEVER be synced as an ordinary QBO Payment:
-- the deposit's cash has already been recorded against a customer-deposit
-- liability, so re-posting it as invoice revenue would double-count income.
-- The dedicated quickbooks-sync-deposits path (later PRs) posts the deposit's
-- accounting instead.
--
-- This migration also codifies enqueue_qbo_sync_payment(), which until now lived
-- only in the live DB (never captured in a committed migration). The body below
-- is the current live definition PLUS the new source_deposit_id guard.

create or replace function public.enqueue_qbo_sync_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only succeeded (and refunded, for 6.4b) are sync-eligible.
  if new.status not in ('succeeded', 'refunded') then
    return new;
  end if;

  -- Deposit-credit netting rows (source_deposit_id set) carry no Stripe
  -- PaymentIntent and represent prepayment-liability movement, not invoice
  -- revenue. Their QBO accounting is posted by quickbooks-sync-deposits, so
  -- they must never enter the normal payment-sync queue (else income is
  -- double-counted).
  if new.source_deposit_id is not null then
    return new;
  end if;

  if exists (
    select 1 from public.quickbooks_accounts
    where organization_id = new.organization_id
      and deleted_at is null
      and status = 'active'
  ) then
    insert into public.quickbooks_sync_queue (organization_id, snout_table, snout_id, op)
    values (new.organization_id, 'payments', new.id, 'upsert');
  end if;
  return new;
end;
$function$;
