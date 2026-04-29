-- Rename mark_invoice_paid_offline parameters from _invoice_id/_method to
-- invoice_id/method. PostgREST resolves RPC arguments by their name in
-- the schema cache; the underscore-prefixed names that worked elsewhere
-- caused a resolution failure on this specific function. The fix was
-- already applied to the live DB manually; this migration records the
-- change in version history so a fresh setup lands the corrected shape.
--
-- Parameter name changes cannot be done via CREATE OR REPLACE; we drop
-- and recreate.

DROP FUNCTION IF EXISTS public.mark_invoice_paid_offline(uuid, text);

CREATE FUNCTION public.mark_invoice_paid_offline(
  invoice_id uuid,
  method text DEFAULT 'in_person'
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
   WHERE id = invoice_id AND deleted_at IS NULL
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
    _inv.currency, method::payment_method_enum, 'succeeded', now()
  );

  UPDATE public.invoices
  SET status = 'paid',
      amount_paid_cents = total_cents,
      balance_due_cents = 0,
      paid_at = now()
  WHERE id = invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.mark_invoice_paid_offline(uuid, text)
  TO authenticated;
