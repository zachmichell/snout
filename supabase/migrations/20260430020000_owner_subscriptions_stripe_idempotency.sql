-- Migration: owner_subscriptions_stripe_idempotency
--
-- Adds stripe_checkout_session_id to owner_subscriptions so the webhook can
-- safely re-process a `checkout.session.completed` event (Stripe occasionally
-- replays events) without granting credits twice. The unique index is
-- partial — null is allowed for legacy / manually-created subscriptions
-- (staff entering a credit package without a Stripe checkout flow).
--
-- Reversal: DROP INDEX uniq_owner_sub_stripe_session; ALTER TABLE … DROP COLUMN.

ALTER TABLE public.owner_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_owner_sub_stripe_session
  ON public.owner_subscriptions(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
