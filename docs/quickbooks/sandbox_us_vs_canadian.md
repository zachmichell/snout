# US sandbox vs Canadian QBO — what verifies where

The currently connected QBO realm is `Sandbox Company US c536` (United
States). The 6.4.5d worker change sends a per-line `TaxCodeRef` on
each invoice line, and that pattern works in Canadian QBO but not in
US QBO with Automated Sales Tax.

## What we observed

After attaching the `California` tax code to a service and re-syncing
invoice `74d8009e-4df0-4540-b2fe-ec6c0c046d43`, QBO returned:

```
Invalid Line TaxCode in the request
```

US QBO with Automated Sales Tax (AST) ignores per-line `TaxCodeRef`
values like state codes (`California`, `Tucson`, etc.) and computes
tax automatically from the customer's address and the invoice's
ship-to. AST only accepts a small set of line-level codes:

- `TAX` — taxable per AST's auto-determination
- `NON` — explicitly non-taxable

Any other value returns the error above.

## What this means for the verification

The per-line `TaxCodeRef` flow we built is correct for **Canadian QBO**
(and US QBO companies that haven't enabled AST, which is increasingly
rare). It is not the right shape for US-AST companies.

To verify the fix end-to-end, you have three options in order of
preference:

1. **Connect to your real Canadian production realm.** This is the
   actual target, the actual tax code shape (GST/QST/HST), and the
   actual integration we're shipping for. Recommended.
2. **Connect a Canadian sandbox** at <https://developer.intuit.com/app/developer/sandbox>.
   Intuit lets you create up to two Canadian sandboxes per developer
   account. Tax codes will populate as GST/HST/PST after our refresh
   pulls them.
3. **Stay on the US sandbox** and build a US-AST-aware code path. This
   would require changing the worker to omit `TaxCodeRef` on lines and
   trust AST to compute. Not recommended because it forks the
   integration and the actual production target is Canadian.

## State right now

The test changes were rolled back so nothing's left broken:

- The boarding service (`76245b60-...`) has `qbo_tax_code_id = NULL` again.
- Invoice `74d8009e-...` recalculated to `tax_cents = 0` (no service
  tax code → no tax).
- The mapping at `qbo_id = 151` is back to `sync_state = 'synced'` so
  no spurious "failed" entry sits in the dashboard.

The QBO invoice 151 in your sandbox still shows `Total = $130.00` (the
broken state from before the fix). That's not relevant any more —
the right test is on a Canadian realm with proper Canadian tax codes.

## Recommendation

For the operator-return checklist's section 3 (end-to-end verification):
**skip the US sandbox entirely**. When you next connect to a Canadian
QBO realm or sandbox:

1. Click **Refresh** on the Tax codes card to pull GST/QST/HST etc.
2. Open `/services` (now in the sidebar under Billing) and attach the
   appropriate tax code to each service.
3. Create or re-enqueue an invoice and verify the QBO total matches
   Snout's total.

The worker code is correct; this is a sandbox-shape mismatch, not a
bug.
