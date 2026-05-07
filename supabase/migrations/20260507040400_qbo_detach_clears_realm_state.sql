-- Permanent fix: detaching a QBO connection clears realm-specific state.
-- Without this, all entity_mappings and account caches continue
-- pointing at IDs that exist only on the previous realm.
create or replace function public.detach_quickbooks_account(_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $fn$
declare
  _existing public.quickbooks_accounts%rowtype;
begin
  select * into _existing
  from public.quickbooks_accounts
  where organization_id = _org_id and deleted_at is null
  for update;

  if not found then
    return;
  end if;

  delete from vault.secrets where id = _existing.access_token_secret_id;
  delete from vault.secrets where id = _existing.refresh_token_secret_id;

  update public.quickbooks_entity_mappings
     set deleted_at = now()
   where organization_id = _org_id and deleted_at is null;

  delete from public.qbo_tax_code_rates where organization_id = _org_id;
  delete from public.qbo_tax_codes where organization_id = _org_id;
  delete from public.qbo_tax_rates where organization_id = _org_id;

  update public.quickbooks_accounts
     set deleted_at = now(),
         status = 'pending',
         default_income_account_id = null,
         default_income_account_name = null,
         default_deposit_account_id = null,
         default_deposit_account_name = null
   where id = _existing.id;
end;
$fn$;
