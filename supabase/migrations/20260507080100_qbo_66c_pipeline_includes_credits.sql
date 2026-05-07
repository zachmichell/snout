-- 6.6c: Extend the daily QBO pipeline so it (a) materializes any
-- newly-expired credits as ledger rows and (b) syncs the ledger to QBO
-- right after the existing payouts ingest+sync and tips legs.
--
-- Order matters: expire_credits must run BEFORE quickbooks-sync-credit-ledger
-- so the day's expiration rows are visible to the sync function in the same
-- pipeline tick. Otherwise expirations land a day late.

create or replace function public.invoke_quickbooks_payouts_pipeline()
returns text
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $fn$
declare
  _key text;
  _ingest_id bigint;
  _sync_id bigint;
  _tips_id bigint;
  _credits_id bigint;
  _base text := 'https://empdnuzfjgfnphwauhah.supabase.co/functions/v1';
  _org record;
  _expired_orgs int := 0;
begin
  select decrypted_secret into _key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if _key is null then
    return 'service_role_key not found in vault; skipping';
  end if;

  -- 1. Materialize expired credits per active org. Cheap (single update +
  --    a small set of credit_ledger inserts per stale row), so we run it
  --    inline rather than via http.
  for _org in
    select id from public.organizations
    where deleted_at is null and (status is null or status <> 'cancelled')
  loop
    perform public.expire_credits(_org.id);
    _expired_orgs := _expired_orgs + 1;
  end loop;

  -- 2. Ingest fresh Stripe payouts.
  select net.http_post(
    url := _base || '/quickbooks-ingest-stripe-payouts',
    headers := jsonb_build_object('Authorization', 'Bearer '||_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into _ingest_id;

  -- 3. Sync ready payouts to QBO.
  select net.http_post(
    url := _base || '/quickbooks-sync-payouts',
    headers := jsonb_build_object('Authorization', 'Bearer '||_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into _sync_id;

  -- 4. Sync tips.
  select net.http_post(
    url := _base || '/quickbooks-sync-tips',
    headers := jsonb_build_object('Authorization', 'Bearer '||_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into _tips_id;

  -- 5. Sync credit-ledger rows (purchases, consumption, expirations,
  --    refunds) as Journal Entries.
  select net.http_post(
    url := _base || '/quickbooks-sync-credit-ledger',
    headers := jsonb_build_object('Authorization', 'Bearer '||_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into _credits_id;

  return format(
    'expired_orgs=%s ingest=%s sync=%s tips=%s credits=%s',
    _expired_orgs, _ingest_id, _sync_id, _tips_id, _credits_id
  );
end;
$fn$;
