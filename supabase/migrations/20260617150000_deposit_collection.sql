-- Deposit collection (Milestone A, Track 3a).
--
-- The deposits table tracked status as a manual string ('pending' → 'paid')
-- with no money movement. This adds the columns needed to record a REAL
-- charge against a deposit: which PaymentIntent collected it and how. The
-- collect-deposit edge function composes the charge-saved-card keystone and
-- writes these on success.
--
-- No RLS change: deposits already has tenant RLS, and the edge function
-- records via the service role.

alter table public.deposits
  add column if not exists stripe_payment_intent_id text,
  add column if not exists collected_via text,
  add column if not exists currency text not null default 'cad';

-- How the deposit was collected. NULL until paid.
--   saved_card — charged off-session via charge-saved-card
--   checkout   — owner paid via a hosted checkout link (future)
--   manual     — staff marked paid (e.g. e-transfer / external)
--   cash       — paid in person
alter table public.deposits
  drop constraint if exists deposits_collected_via_check;
alter table public.deposits
  add constraint deposits_collected_via_check
    check (collected_via is null or collected_via in ('saved_card', 'checkout', 'manual', 'cash'));

-- Look up a deposit by its PaymentIntent (e.g. from a webhook / reconciliation).
create index if not exists deposits_payment_intent_idx
  on public.deposits (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
