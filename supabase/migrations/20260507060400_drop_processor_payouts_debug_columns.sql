-- 6.6a cleanup: debug columns no longer needed now that the
-- Journal Entry shape works. Failed Syncs surface last_error from
-- the queue if anything goes wrong, which is enough.
alter table public.processor_payouts
  drop column if exists last_request_body,
  drop column if exists last_response_body;
