-- Reliability Batch B: daily reservation-reminder cron.
--
-- Mirrors the birthday and QBO-payouts cron pattern: a SECURITY
-- DEFINER function reads the service-role key from vault and posts to
-- the edge function via net.http_post. pg_cron fires the function once
-- per day.
--
-- Wall-clock choice: 17:00 UTC = 11 AM Saskatchewan / 10 AM Mountain.
-- That puts the "your reservation is tomorrow" reminder in the customer's
-- inbox / phone over lunchtime — late enough that they're not getting
-- it during their morning routine, early enough that they have plenty of
-- runway to reschedule if needed.

create or replace function public.invoke_send_reservation_reminders()
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
    url := _base || '/send-reservation-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into _id;

  return format('reservation_reminders_request_id=%s', _id);
end;
$fn$;

do $$
begin
  perform cron.unschedule('reservation-reminders-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'reservation-reminders-daily',
  '0 17 * * *',
  'select public.invoke_send_reservation_reminders();'
);
