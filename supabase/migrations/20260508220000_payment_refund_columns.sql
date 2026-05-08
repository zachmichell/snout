-- Click-count fix Flow 5 supporting schema: capture when a refund
-- happened and recognize partial-refund state. Both shapes are
-- already supported by Stripe and by the QBO sync (6.4b). Snout's
-- payments table just hasn't been wired for them yet.

-- 1. refunded_at — timestamp the refund landed. The existing
--    refund_amount_cents column was already there but had no twin
--    timestamp.
alter table public.payments
  add column if not exists refunded_at timestamptz;

-- 2. partially_refunded enum value — Stripe distinguishes between
--    full and partial refunds; we want the same so reports can
--    differentiate. The existing 'refunded' label keeps its meaning
--    (full refund); 'partially_refunded' is new.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'payment_status' and e.enumlabel = 'partially_refunded'
  ) then
    alter type public.payment_status add value 'partially_refunded' after 'refunded';
  end if;
end $$;
