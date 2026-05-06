# Operator return checklist — Cluster 6 progress

What shipped while you were away, what to verify, and what's deferred
with operator decisions needed.

## What shipped

| Batch | Status | Commit |
|---|---|---|
| 6.4.5a — QBO TaxCode/TaxRate cache + refresh function + UI | Shipped | `b2736b1` |
| 6.4.5b — `qbo_tax_code_id` FK on services + retail_products + dropdown | Shipped | `4dab560` |
| 6.4.5c — `recalculate_invoice_taxes` engine + per-line breakdown | Shipped | `e2f3a12` |
| 6.4.5d — Worker invoice sync sends per-line `TaxCodeRef` | Shipped | `e2f3a12` |
| 6.5 — `qbo_mapping_report` RPC + CSV download button | Shipped | (pending commit) |

## What's deferred (with planning docs)

| Batch | Why deferred | Plan |
|---|---|---|
| 6.4b — Refunds (RefundReceipt) | 3 operator decisions on partial refunds, deposit account, same-day reversal | `docs/quickbooks/6.4b_refund_handling_plan.md` |
| 6.6 — Fees / tips / deferred revenue | Each requires accounting policy meeting | `docs/quickbooks/6.6_fees_tips_deferred_revenue_plan.md` |

## Checks to do when you're back

### 1. UI sanity (5 minutes)

1. Open the QuickBooks settings tab. Confirm three cards are visible
   side by side: **Tax codes** (with imported codes), **Reconciliation**
   (with Download CSV button).
2. Click **Download CSV** in Reconciliation. A file
   `quickbooks-mappings-YYYY-MM-DD.csv` should download. Open it in
   any spreadsheet — confirm the columns are `Entity Type, Snout ID,
   QBO Entity, QBO ID, Display Name, Amount, Currency, Sync State,
   Last Synced At, Last Error` and that you see rows for owners,
   services, invoices, and payments.

### 2. Service editor — tax code attribution (5 minutes)

This is the part you flagged you couldn't see services to edit. Two
likely causes:

1. **Permissions.** The Edit affordance on `/services` only renders
   for users with the `services.manage` permission. Confirm your role
   is `owner` or `admin` and that the role grants that permission.
2. **Module gating.** Your org has 11 services across `boarding`,
   `daycare`, `grooming`, and `training` modules. The list page
   filters by your org's enabled modules. If only some modules are
   enabled at the org level, you'll see fewer than 11 services. To
   check: open `/services`, look at the module filter dropdown — it
   should list the modules with services. If only a few show up, your
   org module config is restrictive. We can fix that as a separate
   task if needed.

If you do see services and can edit one:

1. Open one (e.g. a Daycare service). Scroll to the **Pricing**
   section.
2. Pick a tax code from the new **Tax Code** dropdown. In your
   sandbox you'll see California, Tucson, NON, TAX, CustomSalesTax.
   Pick **Tucson**.
3. Below the dropdown, the hint should read:
   `Resolves to AZ State tax 7.10% + Tucson City 2.00% (9.10% total).`
4. Save the service. Reload — the dropdown should remember your
   choice.

### 3. End-to-end tax verification — 6.4.5e

This is the one I couldn't run for you because it requires checking
your QBO sandbox. Step-by-step:

1. **Attribute tax codes** to every service that appears on a real
   invoice. (You only need to do this for services whose invoices you
   want to re-sync; new services going forward will inherit whatever
   you set from creation.)
2. **Re-enqueue an invoice** to test. Pick an invoice you know the
   tax breakdown for. Easiest: invoice
   `74d8009e-4df0-4540-b2fe-ec6c0c046d43` (the $130 + $6.50 = $136.50
   invoice that surfaced this whole bug). Run this SQL via the MCP
   to recalc its taxes from the new attribution and re-enqueue:

   ```sql
   -- Recompute Snout-side taxes from the service's qbo_tax_code_id
   SELECT public.recalculate_invoice_taxes(
     '74d8009e-4df0-4540-b2fe-ec6c0c046d43'::uuid
   );

   -- Force a re-sync by invalidating the payload hash
   UPDATE public.quickbooks_entity_mappings
   SET payload_hash = NULL, sync_state = 'pending'
   WHERE snout_id::uuid = '74d8009e-4df0-4540-b2fe-ec6c0c046d43'::uuid
     AND snout_table = 'invoices';

   -- Enqueue
   INSERT INTO public.quickbooks_sync_queue
     (organization_id, snout_table, snout_id, op)
   VALUES (
     'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid,
     'invoices',
     '74d8009e-4df0-4540-b2fe-ec6c0c046d43'::uuid,
     'upsert'
   ) ON CONFLICT DO NOTHING;
   ```

3. Wait ~60s for the cron worker to pick it up, or invoke manually:
   ```sql
   SELECT public.invoke_quickbooks_process_queue();
   -- then check after a few seconds:
   SELECT id, status_code, content::text AS body
   FROM net._http_response ORDER BY created DESC LIMIT 3;
   ```
4. Open the synced invoice in QBO sandbox (Invoice id 151). Confirm:
   - **Total** = $136.50 (was $130.00 with $6.50 unapplied credit
     before the fix).
   - **Tax breakdown** shows the rate from the tax code you attached
     (e.g. if you used Tucson, it'll show `AZ State tax` and
     `Tucson City` lines).
   - The customer should no longer have a $6.50 unapplied credit; the
     payment should fully apply.

If the QBO total still doesn't match Snout's $136.50, screenshot the
QBO invoice (showing the tax breakdown / TxnTaxDetail) and post it —
it'll be one of:

- Tax code on the line is referencing a code QBO doesn't recognize
  (would be a bug in our `qbo_id` cache; refresh tax codes from the
  settings tab to repair).
- QBO is computing tax on an inclusive basis (we sent
  `GlobalTaxCalculation = TaxExcluded` so this shouldn't happen).
- Service mapping pointed the line at the wrong QBO Item.

### 4. Decisions for next round

Read the two planning docs:

- `docs/quickbooks/6.4b_refund_handling_plan.md` — three operator
  decisions on refund modeling.
- `docs/quickbooks/6.6_fees_tips_deferred_revenue_plan.md` — accounting
  policy decisions for processor fees, tips, and deferred revenue.

When you're ready to schedule them, tell me which one is highest
priority and we'll start.

## Open issue noted from your last message

> "I don't see any services that I can pick and edit."

Diagnostic SQL run while you were away:

```
organization_id           | active | deleted | total
-------------------------+--------+---------+------
a1b2c3d4-e5f6-7890-...    |    11 |       0 |    11
d08719d6-a451-4121-...    |     4 |       0 |     4
```

Your test org has 11 active services. The cause of "can't pick and
edit" is one of the two reasons in section 2 above (permission gate
or module gating). Once you confirm which, we can either flip the
permission on your role or expand the org's enabled modules.

## Branch state

All work is on `feature/quickbooks-sync-62`, ahead of `main` by 4
commits as of `e2f3a12`. The 6.5 reconciliation export commit lands
shortly after this checklist. PR can be opened whenever you're ready
to merge.
