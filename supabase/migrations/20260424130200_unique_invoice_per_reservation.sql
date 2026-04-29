-- Enforce one live invoice per reservation at the DB layer.
--
-- Problem this replaces: src/lib/invoice.ts::createInvoiceForReservation
-- does SELECT-then-INSERT. Two concurrent callers (e.g. double-click on
-- "Create invoice") could both pass the existence check and both insert,
-- producing two invoices for one reservation.
--
-- Partial unique index (not a table constraint) so that:
--   - multiple invoices can coexist when reservation_id is NULL (e.g. POS
--     walk-in invoices with no reservation);
--   - soft-deleted invoices (deleted_at IS NOT NULL) don't block a fresh
--     invoice being created for the same reservation later.
--
-- Pre-check before running — if this fails on the live DB, you already
-- have duplicates from the old code path. Find them with:
--
--   SELECT reservation_id, count(*) AS c, array_agg(id) AS invoice_ids
--   FROM public.invoices
--   WHERE reservation_id IS NOT NULL AND deleted_at IS NULL
--   GROUP BY reservation_id HAVING count(*) > 1;
--
-- Resolve (soft-delete the losers) before running this migration.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_reservation_live
  ON public.invoices(reservation_id)
  WHERE reservation_id IS NOT NULL
    AND deleted_at IS NULL;
