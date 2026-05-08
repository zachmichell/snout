-- Reliability Batch B: sms_log mirrors email_log so every SMS Snout sends
-- has the same audit trail (status, provider message id, error message,
-- recipient, type, sent_at) as our email pipeline.
--
-- Why this matters: the Gingr corpus is full of "we never got the
-- reminder" complaints, and every operator who ships SMS without a
-- delivery log eventually loses an argument with a customer over
-- whether the message was sent. Snout's email_log already prevents
-- that on the email side; this table extends the discipline to SMS.
--
-- Provider: Twilio. The edge function send-sms uses a single
-- Snout-side Twilio account (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
-- TWILIO_FROM_NUMBER env vars). Per-org BYO Twilio is a follow-up.

create table if not exists public.sms_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_phone text not null,                 -- normalized to E.164 at write time
  sms_type text,                                 -- 'reservation_reminder', 'waiver_reminder', etc.
  body text not null,                            -- the rendered message body (post-template)
  status text not null,                          -- 'queued' | 'sent' | 'delivered' | 'failed'
  error_message text,
  message_sid text,                              -- Twilio's SM*** identifier (null on local fail)
  -- Foreign keys are nullable because not every send is tied to an entity
  -- (e.g., a one-off staff "send now" might not link to a reservation).
  reservation_id uuid references public.reservations(id) on delete set null,
  owner_id uuid references public.owners(id) on delete set null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_sms_log_org_recent
  on public.sms_log (organization_id, sent_at desc);

create index if not exists idx_sms_log_reservation
  on public.sms_log (reservation_id, sent_at desc)
  where reservation_id is not null;

create index if not exists idx_sms_log_owner
  on public.sms_log (owner_id, sent_at desc)
  where owner_id is not null;

-- Dedup helper for the reservation-reminder cron: cheap lookup of "did we
-- already send a reminder for this reservation today" so a re-run doesn't
-- double-send.
create index if not exists idx_sms_log_dedup
  on public.sms_log (organization_id, sms_type, reservation_id, sent_at desc)
  where reservation_id is not null;

alter table public.sms_log enable row level security;

drop policy if exists sms_log_select on public.sms_log;
create policy sms_log_select on public.sms_log
  for select
  using (public.is_org_member(organization_id));

-- No insert / update / delete policies — only the edge function (running as
-- service-role) writes to this table.
