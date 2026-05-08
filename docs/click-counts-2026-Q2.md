# Front-Desk Click-Count Benchmark — 2026 Q2

The Gingr complaint corpus is full of "every routine action takes too
many clicks." The competitive bar in the brief is **four clicks or
fewer** for the five most-frequent staff actions. This document
records:

1. Predictions from a code read on 2026-05-08.
2. A manual benchmark template the operator should run on the live
   app to confirm or refute the predictions.
3. The smallest UI change that brings each over-budget flow under the
   threshold.

**Status update (2026-05-08, after batch `feature/click-count-fixes`):**
all three over-budget flows are fixed. Section "Recommended fix" under
each flow describes what shipped; "Predicted (post-fix)" is the new
click count.

## Why this matters

A staff member at a busy facility runs check-in / check-out hundreds
of times per day. Every extra click compounds. The brief specifically
calls out Gingr's "type of reservation switching takes too many
clicks" as a recurring complaint. Snout's dashboard already wins on
the simple cases (one-click check-in, one-click check-out) but
some flows have inherited a "click row → open detail → click action
→ confirm → save" pattern that fails the benchmark.

A "click" is any pointing-device action (mouse click, button tap).
Typing into a search box and keystrokes inside an open dialog are not
clicks. The staff member is signed in, on the Dashboard, and the
target reservation is visible in one of the four tabs.

## Predictions (code read, 2026-05-08)

### Flow 1 — Check in a confirmed reservation arriving today

| Step | Click | Source |
|---|---|---|
| 1 | "Check In" button on the Coming In tab row | `Dashboard.tsx:738` |

**Predicted: 1 click. PASSES.**

### Flow 2 — Check out a checked-in reservation

| Step | Click | Source |
|---|---|---|
| 1 | "Check Out" button on the In The Pack tab row | `Dashboard.tsx:752` |

**Predicted: 1 click. PASSES.**

### Flow 3 — Switch a confirmed reservation's service type (daycare → boarding)

| Step | Click | Source |
|---|---|---|
| 1 | Reservation row (opens detail page) | `Dashboard.tsx:735` (`ResTable`) |
| 2 | "Switch service" button on detail page | `ReservationDetail.tsx:430` |
| 3 | Service dropdown trigger inside the modal | `ReservationDetail.tsx:589-592` |
| 4 | Service item in the dropdown list | `ReservationDetail.tsx:594-599` |
| 5 | "Switch" submit button | `ReservationDetail.tsx:606-611` |

**Predicted: 5 clicks. FAILS by 1.**

#### Recommended fix

Add an inline service-swap action on the Dashboard row — a small
"…" overflow menu or a `<Repeat>` icon directly beside Check In on
the Coming In tab. The action opens the same `Switch service`
dialog inline (no detail page round-trip), reducing the flow to:

| New step | Click |
|---|---|
| 1 | Inline "Switch service" icon on the Dashboard row |
| 2 | Service dropdown trigger |
| 3 | Service item |
| 4 | "Switch" submit |

**Projected: 4 clicks. Just makes the budget.** A one-tab row
addition; the dialog already exists.

### Flow 4 — Add an add-on service (e.g., a bath) to an existing daycare reservation

| Step | Click | Source |
|---|---|---|
| 1 | Reservation row (opens detail page) | `Dashboard.tsx:735` |
| 2 | "Add add-on" button | `ReservationDetail.tsx` (find the AddOnDialog trigger) |
| 3 | Service dropdown trigger | `AddOnDialog.tsx:175` |
| 4 | Service item | `AddOnDialog.tsx:180` |
| 5 | "Attach" submit | `AddOnDialog.tsx:217` |

**Predicted: 5 clicks. FAILS by 1.**

Worse: today the `AddOnDialog` is mounted only on the **Requested**
tab in `Dashboard.tsx:1182-1196`. To add an add-on to a
**confirmed** reservation that's already in the Coming In or In The
Pack tabs, the staff member has to click into the detail page first,
which costs the extra click.

#### Recommended fix

Mount the `AddOnDialog` on the regular `ResTable` (Coming In, In The
Pack, Going Home tabs) with a "+" affordance per row, mirroring the
Requested-tab pattern. Same dialog, same writes, just exposed on more
rows. Brings the flow to:

| New step | Click |
|---|---|
| 1 | "+" inline action on the row |
| 2 | Service dropdown |
| 3 | Service item |
| 4 | "Attach" |

**Projected: 4 clicks. Passes.**

### Flow 5 — Refund a payment on an invoice

| Step | Click | Source |
|---|---|---|
| ? | _No operator-facing refund UI exists today._ | — |

`grep -rn "[Rr]efund" apps/web/src/pages/portal/invoices/` returns
nothing. References to "refund" only appear in the activity log
display (`ActivityLog.tsx:137,176`) and in the QBO sync path that
mirrors Stripe-side refunds to QBO. The operator currently has to
issue refunds through the Stripe Dashboard — Snout records them
after the fact via the Stripe webhook.

**Predicted: refund is impossible from the staff portal. ∞ clicks.**

#### Recommended fix

Add a "Refund" button on `InvoiceDetail.tsx`'s payment row that opens
a confirmation dialog (amount + reason) and calls
`stripe.refunds.create` via an edge function. The `payments` table
already has the structure for refunded status; the QBO sync already
handles RefundReceipt creation when it sees a refunded payment.

Target click count once shipped:

| Step | Click |
|---|---|
| 1 | Open invoice detail (from invoices list, owner detail, or a search jump) |
| 2 | "Refund" on the payment row |
| 3 | "Confirm" in the dialog |

**Projected: 3 clicks. Passes.** The actual implementation is the
size of a small batch (edge function + UI dialog + Stripe wiring);
the QBO sync is already in place.

## Summary

| Flow | Predicted | Status | Fix size |
|---|---|---|---|
| 1. Check in | 1 | PASS | — |
| 2. Check out | 1 | PASS | — |
| 3. Switch service | 5 | FAIL by 1 | tiny (mount Switch dialog on Dashboard row) |
| 4. Add add-on | 5 | FAIL by 1 | tiny (mount AddOnDialog on ResTable rows) |
| 5. Refund payment | ∞ | MISSING | small batch (Stripe refund edge function + dialog) |

## Manual benchmark template

Run this on the live app and fill in the **Actual** column. Discrepancies
between Predicted and Actual point to either a code change since
2026-05-08 or a click I missed in the code read.

| Flow | Predicted | Actual | Notes |
|---|---|---|---|
| 1. Check in | 1 | __ | |
| 2. Check out | 1 | __ | |
| 3. Switch service | 5 | __ | |
| 4. Add add-on (confirmed reservation) | 5 | __ | |
| 4b. Add add-on (requested reservation) | __ | __ | |
| 5. Refund payment | ∞ (UI missing) | __ | |

For each FAIL row, pick whether to:

- **Ship the recommended fix** (sizes given above).
- **Document as a known sharp edge** in `gap-audit.md` and accept
  the over-budget click count for now.

Once any UI changes ship, re-run this benchmark and update the
"Predicted" column. The doc lives in `docs/` so it's versioned with
the code that backs the predictions.
