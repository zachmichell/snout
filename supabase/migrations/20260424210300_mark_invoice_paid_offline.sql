-- mark_invoice_paid_offline: staff-initiated "Mark Paid" for payments
-- collected outside Stripe (cash, check, ACH handed over in person, etc.).
--
-- Before: the client ran a blind UPDATE on invoices.amount_paid_cents =
-- total_cents with no corresponding payments row. If a partial Stripe
-- credit existed prior, SUM(payments) diverged from amount_paid_cents.
--
-- This RPC closes the hole by writing both in one transaction under a
-- row lock:
--   1. FOR UPDATE on the invoice row (serializes Mark Paid against
--      concurrent Stripe webhook applications).
--   2. Status-transition guard (only from 'sent' or 'partial').
--   3. INSERT the offline portion into payments with matching delta.
--   4. UPDATE the invoice to 'paid' and zero the balance.

CREATE OR REPLACE FUNCTION public.mark_invoice_paid_offline(
  _invoice_id uuid,
  _method text DEFAULT 'in_person'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inv RECORD;
  _delta int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, organization_id, status, total_cents, amount_paid_cents, currency
    INTO _inv
    FROM public.invoices
   WHERE id = _invoice_id AND deleted_at IS NULL
   FOR UPDATE;

  IF _inv IS NULL THEN
    RAISE EXCEPTION 'Invoice not found or deleted';
  END IF;

  IF NOT public.is_org_member(_inv.organization_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  IF _inv.status NOT IN ('sent', 'partial') THEN
    RAISE EXCEPTION 'Invoice is not in a payable state (status: %)', _inv.status;
  END IF;

  _delta := COALESCE(_inv.total_cents, 0) - COALESCE(_inv.amount_paid_cents, 0);
  IF _delta <= 0 THEN
    RAISE EXCEPTION 'Invoice has no outstanding balance';
  END IF;

  INSERT INTO public.payments (
    invoice_id, organization_id, amount_cents, currency, method, status, processed_at
  ) VALUES (
    _inv.id, _inv.organization_id, _delta,
    _inv.currency, _method::payment_method_enum, 'succeeded', now()
  );

  UPDATE public.invoices
  SET status = 'paid',
      amount_paid_cents = total_cents,
      balance_due_cents = 0,
      paid_at = now()
  WHERE id = _invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.mark_invoice_paid_offline(uuid, text)
  TO authenticated;
