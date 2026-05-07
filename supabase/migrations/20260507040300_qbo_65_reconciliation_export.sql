-- 6.5: Reconciliation export RPC.
create or replace function public.qbo_mapping_report(_org uuid)
returns table (
  snout_table text,
  snout_id text,
  qbo_entity_type text,
  qbo_id text,
  display_name text,
  amount_cents integer,
  currency text,
  sync_state text,
  last_synced_at timestamptz,
  last_error text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    m.snout_table,
    m.snout_id::text,
    m.qbo_entity_type,
    m.qbo_id,
    case m.snout_table
      when 'owners' then trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, ''))
      when 'services' then s.name
      when 'invoices' then coalesce(inv.invoice_number, 'INV-' || left(inv.id::text, 8))
      when 'payments' then coalesce(p.stripe_payment_intent_id, p.helcim_transaction_id, 'PMT-' || left(p.id::text, 8))
      else null
    end as display_name,
    case m.snout_table
      when 'invoices' then inv.total_cents
      when 'payments' then p.amount_cents
      else null
    end as amount_cents,
    case m.snout_table
      when 'invoices' then inv.currency
      when 'payments' then p.currency
      else null
    end as currency,
    m.sync_state,
    m.last_synced_at,
    m.last_error
  from public.quickbooks_entity_mappings m
  left join public.owners o
    on m.snout_table = 'owners' and m.snout_id::uuid = o.id
  left join public.services s
    on m.snout_table = 'services' and m.snout_id::uuid = s.id
  left join public.invoices inv
    on m.snout_table = 'invoices' and m.snout_id::uuid = inv.id
  left join public.payments p
    on m.snout_table = 'payments' and m.snout_id::uuid = p.id
  where m.organization_id = _org
    and m.deleted_at is null
    and public.is_org_member(_org)
  order by m.snout_table, m.last_synced_at desc nulls last;
$fn$;

revoke all on function public.qbo_mapping_report(uuid) from public;
grant execute on function public.qbo_mapping_report(uuid) to authenticated;
