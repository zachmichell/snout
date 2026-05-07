-- 6.6a: Daily cron to ingest Stripe payouts and sync any 'ready'
-- ones to QBO. Two-step orchestrator runs at 03:15 UTC every day.

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
  _base text := 'https://empdnuzfjgfnphwauhah.supabase.co/functions/v1';
begin
  select decrypted_secret into _key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if _key is null then
    return 'service_role_key not found in vault; skipping';
  end if;

  -- Step 1: ingest Stripe payouts. No org_id filter = all orgs.
  select net.http_post(
    url := _base || '/quickbooks-ingest-stripe-payouts',
    headers := jsonb_build_object('Authorization', 'Bearer '||_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into _ingest_id;

  -- Step 2: sync ready payouts to QBO.
  select net.http_post(
    url := _base || '/quickbooks-sync-payouts',
    headers := jsonb_build_object('Authorization', 'Bearer '||_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into _sync_id;

  return format('ingest=%s sync=%s', _ingest_id, _sync_id);
end;
$fn$;

select cron.schedule(
  'qbo-payouts-pipeline',
  '15 3 * * *',
  $$select public.invoke_quickbooks_payouts_pipeline();$$
);
