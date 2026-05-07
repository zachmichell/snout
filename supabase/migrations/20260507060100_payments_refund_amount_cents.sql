-- 6.4b: Track the actual refunded amount on a payment so partial
-- refunds can be modeled. NULL means "full refund" (back-compat with
-- existing rows). When set, refund_amount_cents <= amount_cents.

alter table public.payments
  add column if not exists refund_amount_cents integer
    check (refund_amount_cents is null or (refund_amount_cents >= 0 and refund_amount_cents <= amount_cents));

comment on column public.payments.refund_amount_cents is
  '6.4b: Actual refunded amount in cents. NULL means full refund (= amount_cents). Drives partial-refund modeling on QBO RefundReceipt.';
