-- Reliability Batch D: daily birthday-email cron.
--
-- Mirrors the pattern used by invoke_quickbooks_payouts_pipeline:
-- a SECURITY DEFINER function reads the service role key from vault
-- and posts to the edge function via net.http_post. pg_cron fires
-- the function once a day.
--
-- Wall-clock choice: 14:00 UTC = 8:00 AM Saskatchewan (CST, no DST,
-- America/Regina). That puts the email in the inbox over morning
-- coffee for our Western Canadian primary market. Operators in other
-- regions can adjust the schedule if/when the system goes
-- multi-region.

create or replace function public.invoke_send_birthday_emails()
returns text
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $fn$
declare
  _key text;
  _id bigint;
  _base text := 'https://empdnuzfjgfnphwauhah.supabase.co/functions/v1';
begin
  select decrypted_secret into _key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if _key is null then
    return 'service_role_key not found in vault; skipping';
  end if;

  select net.http_post(
    url := _base || '/send-birthday-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into _id;

  return format('birthday_emails_request_id=%s', _id);
end;
$fn$;

-- Schedule the cron. unschedule first so the migration is idempotent
-- (re-running it doesn't add a duplicate job).
do $$
begin
  perform cron.unschedule('birthday-emails-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'birthday-emails-daily',
  '0 14 * * *',
  'select public.invoke_send_birthday_emails();'
);
