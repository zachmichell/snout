-- Atomic payment application with dedup.
--
-- Problem this replaces: stripe-connect-webhook did a read-then-update
-- pattern that was racy and could either double-credit an invoice (two
-- concurrent handlers reading stale amount_paid_cents) or miscredit it
-- (replayed events overwriting each other's writes).
--
-- Design:
--   1. Unique index on payments.stripe_payment_intent_id makes Stripe-PI
--      dedup a DB-level guarantee instead of a check-then-insert race.
--   2. apply_stripe_payment(...) RPC does BOTH the payment insert and the
--      invoice accumulation in one function. The payment insert uses
--      ON CONFLICT DO NOTHING against the new unique index — if we hit a
--      conflict it means another handler already applied this PI, so we
--      return without updating the invoice. Otherwise we apply the delta
--      atomically (single UPDATE, column arithmetic, not read-modify-write).
--
-- Pre-check before running — if this returns rows, existing payments data
-- has duplicate PIs and the unique index creation will fail:
--
--   SELECT stripe_payment_intent_id, count(*)
--   FROM public.payments
--   WHERE stripe_payment_intent_id IS NOT NULL
--   GROUP BY stripe_payment_intent_id HAVING count(*) > 1;

-- 1. Partial unique index — NULL PIs are common for non-Stripe payments
--    (POS cash, etc.) and should remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_stripe_intent
  ON public.payments(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- 2. Atomic payment + invoice accumulator.
CREATE OR REPLACE FUNCTION public.apply_stripe_payment(
  _invoice_id uuid,
  _payment_intent_id text,
  _amount_cents integer,
  _currency text,
  _method text DEFAULT 'card'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _payment_id uuid;
BEGIN
  IF _payment_intent_id IS NULL OR _payment_intent_id = '' THEN
    RAISE EXCEPTION 'payment_intent_id is required for idempotency';
  END IF;

  SELECT organization_id
    INTO _org
    FROM public.invoices
   WHERE id = _invoice_id AND deleted_at IS NULL;

  IF _org IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found or deleted', _invoice_id;
  END IF;

  -- Atomic dedup via the unique index. If the PI was already recorded,
  -- ON CONFLICT DO NOTHING yields zero rows and _payment_id stays NULL,
  -- which means some earlier handler already credited this payment.
  INSERT INTO public.payments (
    invoice_id, organization_id, amount_cents, currency, method, status,
    stripe_payment_intent_id, processed_at
  ) VALUES (
    _invoice_id, _org, _amount_cents,
    _currency::currency_enum, _method::payment_method_enum, 'succeeded',
    _payment_intent_id, now()
  )
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING id INTO _payment_id;

  IF _payment_id IS NULL THEN
    RETURN;
  END IF;

  -- Accumulate invoice totals atomically. Column arithmetic under the
  -- implicit row lock means two concurrent payments can't lose each
  -- other's delta. CASE guards block regression from 'paid'/'void'.
  UPDATE public.invoices
  SET amount_paid_cents = amount_paid_cents + _amount_cents,
      balance_due_cents = GREATEST(0, total_cents - (amount_paid_cents + _amount_cents)),
      status = CASE
                 WHEN status IN ('void', 'paid') THEN status
                 WHEN amount_paid_cents + _amount_cents >= total_cents THEN 'paid'::invoice_status
                 WHEN amount_paid_cents + _amount_cents > 0 THEN 'partial'::invoice_status
                 ELSE status
               END,
      paid_at = CASE
                  WHEN status IN ('void', 'paid') THEN paid_at
                  WHEN amount_paid_cents + _amount_cents >= total_cents THEN now()
                  ELSE paid_at
                END
  WHERE id = _invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.apply_stripe_payment(uuid, text, integer, text, text)
  TO service_role;
