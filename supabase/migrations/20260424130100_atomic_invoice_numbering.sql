-- Atomic, per-org invoice number allocation.
--
-- Problem this replaces: src/lib/invoice.ts::nextInvoiceNumber() did
--   SELECT count(*) FROM invoices WHERE organization_id = $1
-- and returned count+1. Two concurrent callers both saw N, both returned
-- N+1, both inserted invoices with the same number. And because invoices
-- can be soft-deleted, count+1 could also collide with an undeleted row
-- after a deletion.
--
-- This migration:
--   1. Adds a monotonic counter on organizations, backfilled from the
--      current max invoice_number per org.
--   2. Adds a partial unique index to guarantee no duplicates land (live,
--      non-deleted rows only).
--   3. Exposes next_invoice_number(_org_id) as a SECURITY DEFINER RPC
--      that atomically bumps the counter and returns the formatted number.

-- 1. Counter column
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS invoice_counter integer NOT NULL DEFAULT 0;

-- 2. Backfill from existing data. Parses the trailing digits of any
--    invoice_number matching INV-<digits>; non-matching numbers (custom
--    formats typed manually) are ignored for the counter floor.
UPDATE public.organizations o
SET invoice_counter = GREATEST(
  o.invoice_counter,
  COALESCE((
    SELECT MAX((regexp_replace(invoice_number, '^INV-0*', ''))::int)
    FROM public.invoices
    WHERE organization_id = o.id
      AND invoice_number ~ '^INV-[0-9]+$'
  ), 0)
);

-- 3. Uniqueness safety net. Partial index so soft-deleted invoices and
--    NULL invoice_numbers (drafts before allocation) don't block writes.
--    If this creation fails, existing data already contains duplicates;
--    resolve those manually before rerunning the migration.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_org_number_live
  ON public.invoices(organization_id, invoice_number)
  WHERE invoice_number IS NOT NULL
    AND deleted_at IS NULL;

-- 4. RPC: atomic allocator.
CREATE OR REPLACE FUNCTION public.next_invoice_number(_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _next int;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_org_member(_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  -- Atomic: row lock on the organizations row serializes concurrent bumps.
  UPDATE public.organizations
  SET invoice_counter = invoice_counter + 1
  WHERE id = _org_id
  RETURNING invoice_counter INTO _next;

  IF _next IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  RETURN 'INV-' || lpad(_next::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO authenticated;
